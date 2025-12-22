// LinkedIn Feed Cleaner - Content Script
// Filters LinkedIn feed posts using Gemini AI

const processedProfiles = new Map();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TOGGLE_FILTER') {
        if (request.enabled) {
            processExistingPosts();
        } else {
            unblurAllPosts();
        }
    } else if (request.action === 'AUTH_COMPLETE') {
        init();
    }
});

async function init() {
    const { filterEnabled, customGeminiKey } = await chrome.storage.local.get([
        'filterEnabled',
        'customGeminiKey'
    ]);

    if (!customGeminiKey) {
        return;
    }

    if (filterEnabled === false) {
        return;
    }

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
    
    if (processedProfiles.has(cacheKey)) {
        const shouldShow = processedProfiles.get(cacheKey);
        if (!shouldShow) blurPost(postElement);
        return;
    }

    const { customGeminiKey, customICP } = await chrome.storage.local.get([
        'customGeminiKey',
        'customICP'
    ]);

    if (!customGeminiKey) return;

    try {
        const result = await analyzeWithGemini(profileData, customGeminiKey, customICP);
        processedProfiles.set(cacheKey, result.shouldShow);

        if (!result.shouldShow) {
            blurPost(postElement);
        }
    } catch (error) {
        console.error('Profile analysis failed:', error);
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

function blurPost(postElement) {
    const parent = postElement.closest('.feed-shared-update-v2__control-menu-container');
    if (!parent) return;

    if (parent.dataset.blurred === 'true') return;
    parent.dataset.blurred = 'true';

    const wrapper = document.createElement('div');
    while (parent.firstChild) wrapper.appendChild(parent.firstChild);
    wrapper.style.filter = 'blur(10px)';
    wrapper.style.transition = 'all 0.3s ease';

    const btn = document.createElement('button');
    btn.innerHTML = `
        <span style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
            <span>Show Post</span>
            <span style="opacity: 0.9; font-size: 11px; font-weight: 500; letter-spacing: 0.3px;">authr</span>
        </span>
    `;
    btn.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10;
        background: #1AB394;
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
        parent.dataset.revealed = 'true';
    };

    parent.style.position = 'relative';
    parent.appendChild(wrapper);
    parent.appendChild(btn);
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
}

async function analyzeWithGemini(profileData, apiKey, customICP) {
    try {
        // Always hide promoted content and job postings
        if (profileData.isPromoted || profileData.isJobPosting) {
            return { shouldShow: false };
        }

        // If no ICP specified, show all non-promoted posts
        if (!customICP) {
            return { shouldShow: true };
        }

        // Improved ICP matching prompt
        const postPreview = profileData.postText ? profileData.postText.substring(0, 400).trim() : '';
        
        const prompt = `You are filtering LinkedIn posts to show only content from your target audience.

TARGET AUDIENCE:
${customICP}

PROFILE:
Name: ${profileData.name || 'Unknown'}
Headline: ${profileData.headline || 'Not available'}
${postPreview ? `Post: ${postPreview}` : ''}

Question: Does this profile or their post content match the target audience above?

Instructions:
- Compare the profile headline and post content to the target audience description
- SHOW if the person fits the target audience OR if their post discusses topics relevant to the target audience
- HIDE if the person clearly doesn't fit AND their post isn't relevant to the target audience
- Be practical: if there's any reasonable connection, SHOW it

Answer with exactly one word: SHOW or HIDE`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
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
            const errorText = await response.text();
            console.error('Gemini API error:', response.status, errorText);
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
        
        // Debug logging (can be removed in production)
        if (responseText && responseText !== 'SHOW' && responseText !== 'HIDE') {
            console.log('[authr] ICP Analysis:', {
                profile: profileData.name,
                headline: profileData.headline.substring(0, 50),
                response: responseText,
                decision: shouldShow ? 'SHOW' : 'HIDE'
            });
        }
        
        return { shouldShow };
    } catch (error) {
        console.error('Gemini analysis failed:', error);
        return { shouldShow: true }; // Default to show on error
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
