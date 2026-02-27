// LinkedIn Feed Cleaner - Content Script
// Filters LinkedIn feed posts using Gemini AI

const API_BASE = CONFIG.API_BASE_URL;
const processedProfiles = new Map();
let hiddenPostsCount = 0;
let counterBadge = null;

// Selectors tried in order - first one that returns results wins
const POST_SELECTORS = [
    '.feed-shared-update-v2__control-menu-container',
    '.occludable-update',
    '.feed-shared-update-v2',
    '[data-urn^="urn:li:activity"]',
    '[data-urn^="urn:li:ugcPost"]',
    '[data-urn^="urn:li:share"]',
];

// Resolved at runtime once we find what works on current LinkedIn DOM
let resolvedPostSelector = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'TOGGLE_FILTER') {
        if (request.enabled) {
            processExistingPosts();
        } else {
            unblurAllPosts();
        }
    } else if (request.action === 'AUTH_COMPLETE' || request.action === 'SETTINGS_UPDATED') {
        console.log('[authr] Settings updated, reinitializing...');
        hiddenPostsCount = 0;
        updateCounterBadge();
        init();
    }
});

async function init() {
    const { filterEnabled, customGeminiKey, accessToken } = await chrome.storage.local.get([
        'filterEnabled',
        'customGeminiKey',
        'accessToken'
    ]);

    console.log('[authr] init() — key:', !!customGeminiKey, '| token:', !!accessToken, '| filterEnabled:', filterEnabled);

    if (!customGeminiKey && !accessToken) {
        console.warn('[authr] No API key or access token. Open extension popup to add your Gemini key.');
        return;
    }

    if (filterEnabled === false) {
        console.log('[authr] Filtering is disabled.');
        return;
    }

    createCounterBadge();
    processExistingPosts();
    observeNewPosts();
}

async function processPost(postElement) {
    if (postElement.dataset.profileFiltered) return;

    const profileData = extractProfileData(postElement);
    if (!profileData) {
        // LinkedIn DOM structure didn't match — mark so we don't keep retrying
        postElement.dataset.profileFiltered = 'no-actor';
        return;
    }

    postElement.dataset.profileFiltered = 'true';

    const postHash = profileData.postText ? profileData.postText.substring(0, 100).replace(/\s+/g, ' ') : '';
    const cacheKey = `${profileData.name}_${profileData.headline}_${postHash}`;

    const { customGeminiKey, customGeminiModel, customICP, postAction, accessToken } = await chrome.storage.local.get([
        'customGeminiKey',
        'customGeminiModel',
        'customICP',
        'postAction',
        'accessToken'
    ]);

    if (!customGeminiKey && !accessToken) return;

    const action = postAction || 'blur';

    if (processedProfiles.has(cacheKey)) {
        const shouldShow = processedProfiles.get(cacheKey);
        if (!shouldShow) {
            action === 'remove' ? removePost(postElement) : blurPost(postElement);
        }
        return;
    }

    try {
        let result;

        if (customGeminiKey) {
            result = await analyzeWithGemini(profileData, customGeminiKey, customGeminiModel, customICP);
        } else if (accessToken) {
            const response = await fetch(`${API_BASE}/api/extension/filtering`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({ profileData })
            });

            if (response.status === 401) {
                console.warn('[authr] Access token expired. Clearing auth state.');
                await chrome.storage.local.remove(['accessToken', 'refreshToken', 'expiresAt']);
                return;
            }

            if (!response.ok) {
                console.error('[authr] Backend API error:', response.status);
                return;
            }

            result = await response.json();
        }

        if (!result) return;

        console.log(`[authr] "${profileData.name}" (${profileData.headline.substring(0, 40)}) → ${result.shouldShow ? 'SHOW' : 'HIDE'}`);

        processedProfiles.set(cacheKey, result.shouldShow);

        if (!result.shouldShow) {
            action === 'remove' ? removePost(postElement) : blurPost(postElement);
        }
    } catch (error) {
        console.error('[authr] processPost error:', error);
    }
}

function extractProfileData(postElement) {
    // Try primary actor container
    let actor = postElement.querySelector('.update-components-actor__container');

    // Fallback: search within parent if not found directly
    if (!actor) {
        actor = postElement.closest('.feed-shared-update-v2')
            ?.querySelector('.update-components-actor__container');
    }

    if (!actor) return null;

    const nameEl = actor.querySelector('.update-components-actor__title span[aria-hidden="true"]');
    const headlineEl = actor.querySelector('.update-components-actor__description span[aria-hidden="true"]');

    const postContainer = postElement.closest('.feed-shared-update-v2') || postElement;

    const postTextEl =
        postContainer.querySelector('.feed-shared-text-view__text-view span[aria-hidden="true"]') ||
        postContainer.querySelector('.update-components-text span[aria-hidden="true"]') ||
        postContainer.querySelector('.feed-shared-update-v2__description span[aria-hidden="true"]') ||
        postContainer.querySelector('.feed-shared-text-view') ||
        postContainer.querySelector('[data-test-id="main-feed-activity-card__commentary"]');

    let postText = postTextEl ? (postTextEl.innerText || postTextEl.textContent || '').trim() : '';

    const headlineText = headlineEl?.textContent?.toLowerCase() || '';
    const fullText = (postContainer.textContent || '').toLowerCase();

    const isPromoted =
        headlineText.includes('promoted') ||
        headlineText.includes('sponsored') ||
        postContainer.querySelector('.update-components-actor__label')?.textContent.toLowerCase().includes('promoted') ||
        !!postContainer.querySelector('[data-ad-banner-container]') ||
        fullText.includes('promoted') ||
        postText.toLowerCase().includes('sponsored');

    const isJobPosting =
        !!postContainer.querySelector('.job-card-container') ||
        !!postContainer.querySelector('[data-job-id]') ||
        postText.toLowerCase().includes('we are hiring') ||
        postText.toLowerCase().includes('join our team') ||
        headlineText.includes('recruiter');

    return {
        name: nameEl?.textContent.trim() || '',
        headline: headlineEl?.textContent.trim() || '',
        postText: postText.substring(0, 500),
        isPromoted,
        isJobPosting
    };
}

function getPostContainer(postElement) {
    if (resolvedPostSelector) {
        return postElement.closest(resolvedPostSelector) || postElement;
    }
    return postElement.closest('[data-urn]') ||
           postElement.closest('.feed-shared-update-v2') ||
           postElement.closest('.occludable-update') ||
           postElement;
}

function removePost(postElement) {
    const parent = getPostContainer(postElement);
    if (parent.dataset.removed === 'true') return;
    parent.dataset.removed = 'true';

    hiddenPostsCount++;
    updateCounterBadge();

    parent.style.transition = 'opacity 0.3s ease, max-height 0.3s ease, margin 0.3s ease';
    parent.style.opacity = '0';
    parent.style.maxHeight = '0';
    parent.style.overflow = 'hidden';
    parent.style.marginTop = '0';
    parent.style.marginBottom = '0';

    setTimeout(() => parent.remove(), 300);
}

function blurPost(postElement) {
    const parent = getPostContainer(postElement);
    if (parent.dataset.blurred === 'true') return;
    parent.dataset.blurred = 'true';

    hiddenPostsCount++;
    updateCounterBadge();

    const wrapper = document.createElement('div');
    while (parent.firstChild) wrapper.appendChild(parent.firstChild);
    wrapper.style.filter = 'blur(10px)';
    wrapper.style.transition = 'all 0.3s ease';

    const btn = document.createElement('button');
    btn.innerHTML = `<span style="display:flex;align-items:center;gap:8px;white-space:nowrap;"><span>View Post</span></span>`;
    btn.style.cssText = `
        position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);z-index:10;
        background:#37a791e8;color:white;border:none;
        padding:10px 22px;border-radius:20px;cursor:pointer;
        font-size:13px;font-weight:600;
        font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;
        box-shadow:0 2px 8px rgba(26,179,148,0.3);transition:all 0.2s ease;
    `;
    btn.onmouseover = () => { btn.style.background = '#0D9488'; btn.style.transform = 'translate(-50%,-50%) scale(1.05)'; };
    btn.onmouseout  = () => { btn.style.background = '#37a791e8'; btn.style.transform = 'translate(-50%,-50%)'; };

    const label = document.createElement('span');
    label.innerHTML = `<span style="opacity:0.9;font-size:13px;font-weight:300;color:rgba(255,255,255,0.7);">Hidden by <span style="color:#fff;font-weight:500;">authr</span></span>`;
    label.style.cssText = `
        position:absolute;top:calc(50% + 28px);left:50%;
        transform:translateX(-50%);font-size:12px;opacity:0.6;z-index:10;
        font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;
    `;

    btn.onclick = () => {
        wrapper.style.filter = '';
        btn.remove();
        label.remove();
        parent.dataset.revealed = 'true';
        hiddenPostsCount--;
        updateCounterBadge();
    };

    parent.style.position = 'relative';
    parent.appendChild(wrapper);
    parent.appendChild(btn);
    parent.appendChild(label);
}

function resolvePostSelector() {
    if (resolvedPostSelector) return resolvedPostSelector;

    // Try each candidate selector and use whichever finds posts
    for (const selector of POST_SELECTORS) {
        if (document.querySelector(selector)) {
            resolvedPostSelector = selector;
            console.log(`[authr] Using post selector: "${selector}"`);
            return selector;
        }
    }

    // Fallback: find posts by their inner actor container and walk up
    const actors = document.querySelectorAll('.update-components-actor__container');
    if (actors.length > 0) {
        console.log('[authr] Falling back to actor-based post detection');
        return null; // signals to use actor-based path
    }

    console.warn('[authr] Could not find any post elements. LinkedIn DOM may have changed.');
    return null;
}

function collectPosts(root) {
    const selector = resolvePostSelector();

    if (selector) {
        return Array.from(root.querySelectorAll?.(selector) || []);
    }

    // Actor-based fallback: find each actor and return its outermost post container
    const actors = root.querySelectorAll?.('.update-components-actor__container') || [];
    const containers = new Set();
    actors.forEach(actor => {
        // Walk up looking for a meaningful post wrapper
        const container =
            actor.closest('[data-urn]') ||
            actor.closest('.feed-shared-update-v2') ||
            actor.closest('.occludable-update') ||
            actor.parentElement?.parentElement?.parentElement;
        if (container) containers.add(container);
    });
    return Array.from(containers);
}

function processExistingPosts() {
    const posts = collectPosts(document);
    console.log(`[authr] Found ${posts.length} posts to scan`);
    posts.forEach(processPost);
}

function observeNewPosts() {
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    const newPosts = collectPosts(node);
                    if (newPosts.length) newPosts.forEach(processPost);
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[authr] Observer attached');
}

function unblurAllPosts() {
    document.querySelectorAll('[data-blurred="true"]').forEach(parent => {
        const wrapper = parent.querySelector('div[style*="filter"]');
        if (wrapper) wrapper.style.filter = '';
        parent.querySelector('button')?.remove();
        parent.dataset.blurred = 'false';
        parent.dataset.revealed = 'true';
    });
    hiddenPostsCount = 0;
    updateCounterBadge();
}

function createCounterBadge() {
    if (counterBadge) return;

    counterBadge = document.createElement('div');
    counterBadge.id = 'authr-counter-badge';
    counterBadge.style.cssText = `
        position:fixed;bottom:24px;right:24px;
        background:linear-gradient(135deg,#1AB394 0%,#0D9488 100%);
        color:white;padding:10px 12px 10px 16px;border-radius:20px;
        font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;
        font-size:13px;font-weight:600;
        box-shadow:0 4px 12px rgba(26,179,148,0.4);
        z-index:9999;display:flex;align-items:center;gap:8px;
        transition:all 0.3s ease;cursor:default;
    `;
    counterBadge.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            <line x1="2" y1="2" x2="22" y2="22"/>
        </svg>
        <span id="authr-counter-text">authr active</span>
        <button id="authr-counter-close" style="background:transparent;border:none;cursor:pointer;padding:2px;margin-left:4px;display:flex;align-items:center;justify-content:center;opacity:0.7;transition:opacity 0.2s;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    document.body.appendChild(counterBadge);

    const closeBtn = document.getElementById('authr-counter-close');
    if (closeBtn) {
        closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseout  = () => closeBtn.style.opacity = '0.7';
        closeBtn.onclick = () => {
            counterBadge.style.display = 'none';
            chrome.storage.local.set({ showCounter: false });
        };
    }
}

function updateCounterBadge() {
    if (!counterBadge) return;
    chrome.storage.local.get(['showCounter'], ({ showCounter }) => {
        if (showCounter === false) {
            counterBadge.style.display = 'none';
            return;
        }
        const counterText = document.getElementById('authr-counter-text');
        if (counterText) {
            counterText.textContent = hiddenPostsCount === 0
                ? 'authr active'
                : `${hiddenPostsCount} post${hiddenPostsCount === 1 ? '' : 's'} hidden`;
        }
        counterBadge.style.display = 'flex';
    });
}

async function analyzeWithGemini(profileData, apiKey, customGeminiModel, customICP) {
    try {
        const { accessToken, isAuthrUser } = await chrome.storage.local.get(['accessToken', 'isAuthrUser']);
        if (isAuthrUser && accessToken) {
            return await analyzeWithAuthrAPI(profileData, accessToken);
        }
        return await analyzeWithDirectGemini(profileData, apiKey, customGeminiModel, customICP);
    } catch (error) {
        console.error('[authr] analyzeWithGemini error:', error);
        return { shouldShow: true };
    }
}

async function analyzeWithAuthrAPI(profileData, accessToken) {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/extension/filtering`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ profileData })
        });
        if (!response.ok) return { shouldShow: true };
        const data = await response.json();
        return { shouldShow: data.shouldShow };
    } catch (error) {
        console.error('[authr] analyzeWithAuthrAPI error:', error);
        return { shouldShow: true };
    }
}

async function analyzeWithDirectGemini(profileData, apiKey, customGeminiModel, customICP) {
    try {
        if (profileData.isPromoted || profileData.isJobPosting) {
            return { shouldShow: false };
        }

        if (!customICP) {
            customICP = 'People in product, engineering, design, AI, startups, founders, operators, and investors sharing practical insights';
        }

        const postPreview = profileData.postText ? profileData.postText.substring(0, 400).trim() : '';

        const prompt = `You are filtering LinkedIn posts to EXCLUSIVELY show only content from people who match the target audience. Your goal is to create a high-quality, relevant feed.

TARGET AUDIENCE (ICP):
${customICP}

PROFILE:
Name: ${profileData.name || 'Unknown'}
Headline: ${profileData.headline || 'Not available'}
${postPreview ? `Post Content: ${postPreview}` : ''}

CRITICAL FILTERING RULES:

1. ICP MATCHING (STRICT):
   - SHOW ONLY if the person's profile (headline, role, industry) clearly matches the target audience description
   - HIDE if the person doesn't fit the ICP, even if their post discusses relevant topics

2. SPAM DETECTION - HIDE if the post contains:
   - Excessive emojis (more than 3-4)
   - Clickbait phrases
   - Excessive hashtags (more than 5-7)
   - "Follow for more" or engagement bait
   - Aggressive self-promotion without value

3. AI-GENERATED/SLOP DETECTION - HIDE if the post:
   - Has generic formulaic structure ("Here are 5 ways...")
   - Contains overly polished corporate-speak
   - Lacks personal voice or genuine insights
   - Contains phrases like "In today's fast-paced world..."

4. QUALITY CHECK:
   - Even if someone matches ICP, HIDE if their post is spam or AI slop

Answer with exactly one word: SHOW or HIDE`;

        const modelName = customGeminiModel || CONFIG.GEMINI_DEFAULT_MODEL;
        const endpoint = `${CONFIG.GEMINI_API_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 10, topP: 0.9 }
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error('[authr] Gemini API error:', response.status, err?.error?.message || '');
            return { shouldShow: true };
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || '';

        let shouldShow = true;
        if (responseText.includes('HIDE')) shouldShow = false;
        else if (responseText.includes('SHOW')) shouldShow = true;

        return { shouldShow };
    } catch (error) {
        console.error('[authr] analyzeWithDirectGemini error:', error);
        return { shouldShow: true };
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
