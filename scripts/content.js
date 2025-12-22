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

    const cacheKey = `${profileData.name}_${profileData.headline}`;
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
    const isPromoted =
        headlineEl?.textContent.toLowerCase().includes('promoted') ||
        headlineEl?.textContent.toLowerCase().includes('sponsored') ||
        postContainer?.querySelector('.update-components-actor__label')?.textContent.toLowerCase().includes('promoted') ||
        postContainer?.querySelector('[data-ad-banner-container]') !== null ||
        postContainer?.querySelector('.feed-shared-actor__supplementary-actor-info')?.textContent.toLowerCase().includes('promoted') ||
        postContainer?.textContent.toLowerCase().includes('promoted') ||
        false;

    return {
        name: nameEl?.textContent.trim() || '',
        headline: headlineEl?.textContent.trim() || '',
        isPromoted: isPromoted
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
    btn.textContent = 'Show Post';
    btn.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10;
        background: #1AB394;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 20px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
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
        if (button && button.textContent === 'Show Post') {
            button.remove();
        }

        parent.dataset.blurred = 'false';
        parent.dataset.revealed = 'true';
    });
}

async function analyzeWithGemini(profileData, apiKey, customICP) {
    try {
        let prompt = `Analyze this LinkedIn profile:
- Name: ${profileData.name}
- Headline: ${profileData.headline}
- Promoted/Sponsored: ${profileData.isPromoted}

`;

        if (customICP) {
            prompt += `Target audience: ${customICP}

Should this profile be shown based on the target audience? `;
        } else {
            prompt += `Is this a real professional worth engaging with (not spam/promotional)? `;
        }

        prompt += `Reply ONLY with "SHOW" or "HIDE".`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 10
                    }
                })
            }
        );

        if (!response.ok) {
            return { shouldShow: true };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || 'SHOW';
        
        return { shouldShow: text.includes('SHOW') };
    } catch (error) {
        console.error('Gemini analysis failed:', error);
        return { shouldShow: true };
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
