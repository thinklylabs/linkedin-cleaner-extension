// LinkedIn Feed Cleaner - Content Script
// Filters LinkedIn feed posts using Gemini AI

const API_BASE = CONFIG.API_BASE_URL;
const processedProfiles = new Map();
let hiddenPostsCount = 0;
let counterBadge = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'TOGGLE_FILTER') {
        if (request.enabled) {
            processExistingPosts();
        } else {
            unblurAllPosts();
        }
    } else if (request.action === 'AUTH_COMPLETE' || request.action === 'SETTINGS_UPDATED') {
        // Reset and reinitialize when settings change
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

    // Must have either custom key or access token
    if (!customGeminiKey && !accessToken) {
        return;
    }

    if (filterEnabled === false) {
        return;
    }

    createCounterBadge();
    processExistingPosts();
    observeNewPosts();
}

async function processPost(postElement) {
    if (postElement.dataset.profileFiltered) return;

    const profileData = extractProfileData(postElement);
    if (!profileData) return;

    postElement.dataset.profileFiltered = 'true';

    // Create cache key from profile + post content hash (first 100 chars)
    const postHash = profileData.postText ? profileData.postText.substring(0, 100).replace(/\s+/g, ' ') : '';
    const cacheKey = `${profileData.name}_${profileData.headline}_${postHash}`;
    
    const { customGeminiKey, customICP, postAction, accessToken } = await chrome.storage.local.get([
        'customGeminiKey',
        'customICP',
        'postAction',
        'accessToken'
    ]);

    // Must have either custom key or access token
    if (!customGeminiKey && !accessToken) {
        return;
    }

    const action = postAction || 'blur';
    
    if (processedProfiles.has(cacheKey)) {
        const shouldShow = processedProfiles.get(cacheKey);
        if (!shouldShow) {
            if (action === 'remove') {
                removePost(postElement);
            } else {
                blurPost(postElement);
            }
        }
        return;
    }

    try {
        let result;
        
        // Prefer custom Gemini key if available
        if (customGeminiKey) {
            result = await analyzeWithGemini(profileData, customGeminiKey, customICP);
        } 
        // Otherwise use authr backend API with access token
        else if (accessToken) {
            const response = await fetch(`${API_BASE}/api/extension/filtering`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({ profileData })
            });

            if (response.status === 401) {
                await chrome.storage.local.remove(['accessToken', 'refreshToken', 'expiresAt']);
                return;
            }

            if (!response.ok) {
                return;
            }

            result = await response.json();
        }

        processedProfiles.set(cacheKey, result.shouldShow);

        if (!result.shouldShow) {
            if (action === 'remove') {
                removePost(postElement);
            } else {
                blurPost(postElement);
            }
        }
    } catch (error) {
        // Silent fail
    }
}

function extractProfileData(postElement) {
    const actor = postElement.querySelector('.update-components-actor__container');
    if (!actor) return null;

    const nameEl = actor.querySelector('.update-components-actor__title span[aria-hidden="true"]');
    const headlineEl = actor.querySelector('.update-components-actor__description span[aria-hidden="true"]');

    const postContainer = postElement.closest('.feed-shared-update-v2');
    
    // Extract post text content - try multiple selectors
    const postTextEl = postContainer?.querySelector('.feed-shared-text-view__text-view span[aria-hidden="true"]') ||
                       postContainer?.querySelector('.feed-shared-update-v2__description span[aria-hidden="true"]') ||
                       postContainer?.querySelector('.update-components-text span[aria-hidden="true"]') ||
                       postContainer?.querySelector('.feed-shared-text-view') ||
                       postContainer?.querySelector('[data-test-id="main-feed-activity-card__commentary"]');
    
    // Get text from element, handling nested spans
    let postText = '';
    if (postTextEl) {
        // Try to get all text content, including nested elements
        postText = postTextEl.innerText || postTextEl.textContent || '';
        postText = postText.trim();
    }

    // Check for promoted/sponsored content
    const isPromoted =
        headlineEl?.textContent.toLowerCase().includes('promoted') ||
        headlineEl?.textContent.toLowerCase().includes('sponsored') ||
        postContainer?.querySelector('.update-components-actor__label')?.textContent.toLowerCase().includes('promoted') ||
        postContainer?.querySelector('[data-ad-banner-container]') !== null ||
        postContainer?.querySelector('.feed-shared-actor__supplementary-actor-info')?.textContent.toLowerCase().includes('promoted') ||
        postContainer?.textContent.toLowerCase().includes('promoted') ||
        postText.toLowerCase().includes('promoted') ||
        postText.toLowerCase().includes('sponsored') ||
        false;

    // Check for job posting indicators
    const isJobPosting = 
        postContainer?.querySelector('.job-card-container') !== null ||
        postContainer?.querySelector('[data-job-id]') !== null ||
        postText.toLowerCase().includes('we are hiring') ||
        postText.toLowerCase().includes('join our team') ||
        headlineEl?.textContent.toLowerCase().includes('recruiter') ||
        false;

    return {
        name: nameEl?.textContent.trim() || '',
        headline: headlineEl?.textContent.trim() || '',
        postText: postText.substring(0, 500), // Limit to 500 chars for API efficiency
        isPromoted: isPromoted,
        isJobPosting: isJobPosting
    };
}

function removePost(postElement) {
    const parent = postElement.closest('.feed-shared-update-v2__control-menu-container');
    if (!parent) return;

    if (parent.dataset.removed === 'true') return;
    parent.dataset.removed = 'true';

    // Increment counter
    hiddenPostsCount++;
    updateCounterBadge();

    // Smoothly fade out and remove
    parent.style.transition = 'opacity 0.3s ease, max-height 0.3s ease, margin 0.3s ease';
    parent.style.opacity = '0';
    parent.style.maxHeight = '0';
    parent.style.overflow = 'hidden';
    parent.style.marginTop = '0';
    parent.style.marginBottom = '0';

    setTimeout(() => {
        parent.remove();
    }, 300);
}

function blurPost(postElement) {
    const parent = postElement.closest('.feed-shared-update-v2__control-menu-container');
    if (!parent) return;

    if (parent.dataset.blurred === 'true') return;
    parent.dataset.blurred = 'true';

    // Increment counter
    hiddenPostsCount++;
    updateCounterBadge();

    const wrapper = document.createElement('div');
    while (parent.firstChild) wrapper.appendChild(parent.firstChild);
    wrapper.style.filter = 'blur(10px)';
    wrapper.style.transition = 'all 0.3s ease';

    const btn = document.createElement('button');
    btn.innerHTML = `
        <span style="display: flex; align-items: center; text-align:center; gap: 8px; white-space: nowrap;">
            <span>View Post</span>
        </span>
    `;

    const text = document.createElement('span');
    btn.style.cssText = `
    position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10;
        background: #37a791e8;
        color: white;
        border: none;
        padding: 10px 22px;
        border-radius: 20px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'DM Sans', sans-serif;
        box-shadow: 0 2px 8px rgba(26, 179, 148, 0.3);
        transition: all 0.2s ease;
        `;
        
        btn.onmouseover = () => {
            btn.style.background = '#0D9488';
            btn.style.transform = 'translate(-50%, -50%) scale(1.05)';
    };
    btn.onmouseout = () => {
        btn.style.background = '#1AB394';
        btn.style.transform = 'translate(-50%, -50%)';
    };
    btn.onclick = () => {
        wrapper.style.filter = '';
        btn.remove();
        text.remove();
        parent.dataset.revealed = 'true';
        
        // Decrement counter when revealed
        hiddenPostsCount--;
        updateCounterBadge();
    };

   text.innerHTML = `
  <span style="opacity: 0.9; font-size: 13px; font-weight: 300; letter-spacing: 0.3px; color: rgba(255,255,255,0.7);">
    Hidden by <span style="color: #ffffff; font-weight: 500;">authr</span>
  </span>
`;

    text.style.cssText = `
  position: absolute;
  top: calc(50% + 28px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  opacity: 0.6;
  z-index: 10;
  font-family: -apple-system, BlinkMacSystemFont, 'DM Sans', sans-serif;
`;


    parent.style.position = 'relative';
    parent.appendChild(wrapper);
    parent.appendChild(btn);
    parent.appendChild(text);

}

function processExistingPosts() {
    const posts = document.querySelectorAll('.feed-shared-update-v2__control-menu-container');
    posts.forEach(processPost);
}

function observeNewPosts() {
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    const newPosts = node.querySelectorAll?.('.feed-shared-update-v2__control-menu-container');
                    if (newPosts && newPosts.length > 0) {
                        newPosts.forEach(processPost);
                    }
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function unblurAllPosts() {
    const posts = document.querySelectorAll('.feed-shared-update-v2__control-menu-container[data-blurred="true"]');
    posts.forEach(parent => {
        const wrapper = parent.querySelector('div[style*="filter"]');
        const button = parent.querySelector('button');

        if (wrapper) {
            wrapper.style.filter = '';
        }
        if (button && (button.textContent.includes('Show Post') || button.innerHTML.includes('Show Post'))) {
            button.remove();
        }

        parent.dataset.blurred = 'false';
        parent.dataset.revealed = 'true';
    });
    
    // Reset counter
    hiddenPostsCount = 0;
    updateCounterBadge();
}

function createCounterBadge() {
    if (counterBadge) return;

    counterBadge = document.createElement('div');
    counterBadge.id = 'authr-counter-badge';
    counterBadge.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: linear-gradient(135deg, #1AB394 0%, #0D9488 100%);
        color: white;
        padding: 10px 16px 10px 16px;
        padding-right: 12px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'DM Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(26, 179, 148, 0.4);
        z-index: 9999;
        display: none;
        align-items: center;
        gap: 8px;
        transition: all 0.3s ease;
        cursor: default;
    `;

    counterBadge.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
            <line x1="2" y1="2" x2="22" y2="22"/>
        </svg>
        <span id="authr-counter-text">0 posts hidden</span>
        <button id="authr-counter-close" style="
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 2px;
            margin-left: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
        ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;

    document.body.appendChild(counterBadge);

    // Add close button handler
    const closeBtn = document.getElementById('authr-counter-close');
    if (closeBtn) {
        closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseout = () => closeBtn.style.opacity = '0.7';
        closeBtn.onclick = () => {
            counterBadge.style.display = 'none';
            // Save preference to hide counter
            chrome.storage.local.set({ showCounter: false });
        };
    }
}

function updateCounterBadge() {
    if (!counterBadge) return;

    chrome.storage.local.get(['showCounter'], ({ showCounter }) => {
        const counterText = document.getElementById('authr-counter-text');
        if (!counterText) return;

        // Default to true if not set
        const shouldShow = showCounter !== false;

        if (hiddenPostsCount > 0 && shouldShow) {
            counterText.textContent = `${hiddenPostsCount} post${hiddenPostsCount === 1 ? '' : 's'} hidden`;
            counterBadge.style.display = 'flex';
        } else {
            counterBadge.style.display = 'none';
        }
    });
}

async function analyzeWithGemini(profileData, apiKey, customICP) {
    try {
        // Check if user is an authr user (has access token)
        const { accessToken, isAuthrUser } = await chrome.storage.local.get(['accessToken', 'isAuthrUser']);

        if (isAuthrUser && accessToken) {
            // Use authr API for authenticated users
            return await analyzeWithAuthrAPI(profileData, accessToken);
        }

        // Fall back to direct Gemini API for free users
        return await analyzeWithDirectGemini(profileData, apiKey, customICP);
    } catch (error) {
        return { shouldShow: true }; // Default to show on error
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

        if (!response.ok) {
            return { shouldShow: true }; // Default to show on error
        }

        const data = await response.json();
        return { shouldShow: data.shouldShow };
    } catch (error) {
        return { shouldShow: true }; // Default to show on error
    }
}

async function analyzeWithDirectGemini(profileData, apiKey, customICP) {
    try {
        // Always hide promoted content and job postings
        if (profileData.isPromoted || profileData.isJobPosting) {
            return { shouldShow: false };
        }

        // If no ICP specified, show all non-promoted posts
        if (!customICP) {
            return { shouldShow: true };
        }

        // Improved ICP matching prompt with spam and AI detection
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
   - The person must be in the ICP - do NOT show posts just because the topic is relevant if the person doesn't match
   - HIDE if the person doesn't fit the ICP, even if their post discusses relevant topics

2. SPAM DETECTION - HIDE if the post contains:
   - Excessive emojis or special characters (more than 3-4 emojis)
   - Clickbait phrases ("You won't believe...", "This will shock you...", "Number 3 will amaze you!")
   - Excessive hashtags (more than 5-7 hashtags)
   - Repetitive promotional content
   - "Follow for more" or similar engagement bait
   - Links to external products/services with aggressive sales language
   - Posts that are clearly self-promotional without value

3. AI-GENERATED/SLOP DETECTION - HIDE if the post:
   - Has generic, formulaic structure ("Here are 5 ways...", "3 things you need to know...")
   - Contains overly polished, corporate-speak language that lacks authenticity
   - Has repetitive patterns typical of AI-generated content
   - Lacks personal voice, anecdotes, or genuine insights
   - Feels like it was written by a template or AI tool
   - Contains phrases like "In today's fast-paced world..." or similar generic AI patterns

4. QUALITY CHECK:
   - Even if someone matches ICP, HIDE if their post is spam or AI slop
   - Prioritize authentic, valuable content from ICP-matched profiles

DECISION PROCESS:
1. First, check if the person matches the ICP (based on headline/role/industry)
2. If NO match → HIDE
3. If YES match → Check for spam indicators → If spam → HIDE
4. If YES match and not spam → Check for AI slop → If AI slop → HIDE
5. Only SHOW if: Person matches ICP AND post is not spam AND post is not AI slop

Answer with exactly one word: SHOW or HIDE`;

        const response = await fetch(
            `${CONFIG.GEMINI_API_ENDPOINT}?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 10,
                        topP: 0.9
                    }
                })
            }
        );

        if (!response.ok) {
            return { shouldShow: true }; // Default to show on error
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || '';
        
        // More robust parsing - check for SHOW or HIDE
        let shouldShow = true; // Default to show
        
        if (responseText.includes('HIDE')) {
            shouldShow = false;
        } else if (responseText.includes('SHOW')) {
            shouldShow = true;
        } else if (responseText.length > 0) {
            // If we got a response but it's not clear, check first word
            const firstWord = responseText.split(/\s+/)[0];
            shouldShow = firstWord === 'SHOW';
        }
        
        return { shouldShow };
    } catch (error) {
        return { shouldShow: true }; // Default to show on error
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}