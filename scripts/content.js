const API_BASE = CONFIG.API_BASE_URL;
const processedProfiles = new Map();

// Listen for toggle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TOGGLE_FILTER') {
        if (request.enabled) {
            // Re-process all posts when filter is enabled
            processExistingPosts();
        } else {
            // Un-blur all posts when filter is disabled
            unblurAllPosts();
        }
    } else if (request.action === 'AUTH_COMPLETE') {
        // Re-initialize to start filtering with new tokens
        init();
    }
});

async function init() {
    const { accessToken, filterEnabled, customGeminiKey } = await chrome.storage.local.get([
        'accessToken',
        'filterEnabled',
        'customGeminiKey'
    ]);

    // console.log('📊 [Content] Storage state:', {
    //     hasAccessToken: !!accessToken,
    //     accessTokenLength: accessToken?.length || 0,
    //     filterEnabled: filterEnabled,
    //     hasCustomGeminiKey: !!customGeminiKey
    // });

    // Check if we have either authentication method
    if (!accessToken && !customGeminiKey) {
        console.warn('⚠️ [Content] Extension not authenticated - no accessToken or custom Gemini key');
        return;
    }

    // if (customGeminiKey) {
    //     console.log('✅ [Content] Custom Gemini API key found');
    // } else {
    //     console.log('✅ [Content] AccessToken found');
    // }

    // Check if filtering is enabled (default to true if not set)
    if (filterEnabled === false) {
        return;
    }

    // console.log('✅ [Content] LinkedIn Profile Filter: Active');
    // if (accessToken) {
    //     console.log('ℹ️ [Content] Token will be validated when making API calls');
    // }
    processExistingPosts();
    observeNewPosts();
}

async function verifyToken(token) {
    try {
        const response = await fetch(`${API_BASE}/api/extension/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: token })
        });


        if (!response.ok) {
            console.error('❌ [Content] Token verification failed:', response.status);
            return false;
        }

        const data = await response.json();

        return data.authenticated === true;
    } catch (error) {
        console.error('❌ [Content] Token verification error:', error);
        return false;
    }
}

async function processPost(postElement) {
    // Skip if already processed
    if (postElement.dataset.profileFiltered) return;

    const profileData = extractProfileData(postElement);
    if (!profileData) return;

    // Mark as processed immediately to prevent re-processing
    postElement.dataset.profileFiltered = 'true';

    const cacheKey = `${profileData.name}_${profileData.headline}`;
    if (processedProfiles.has(cacheKey)) {
        const shouldShow = processedProfiles.get(cacheKey);
        if (!shouldShow) blurPost(postElement);
        return;
    }

    const { customGeminiKey, customICP, accessToken } = await chrome.storage.local.get([
        'customGeminiKey',
        'customICP',
        'accessToken'
    ]);

    try {
        let result;

        // Use custom Gemini API key if available
        if (customGeminiKey) {
            result = await analyzeWithCustomKey(profileData, customGeminiKey, customICP);
        }
        // Otherwise use server API
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
                console.error('❌ [Content] Token is invalid/expired (401), clearing storage');
                await chrome.storage.local.clear();
                console.error('🔄 [Content] Please sign in again via the extension popup');
                return;
            }

            if (!response.ok) {
                console.error('❌ [Content] API error:', response.status);
                return;
            }

            result = await response.json();
        } else {
            console.warn('⚠️ [Content] No authentication method available');
            return;
        }


        processedProfiles.set(cacheKey, result.shouldShow);

        if (!result.shouldShow) {
            blurPost(postElement);
        }

    } catch (error) {
        console.error('❌ [Content] Profile analysis failed:', error);
    }
}

function extractProfileData(postElement) {
    const actor = postElement.querySelector('.update-components-actor__container');
    if (!actor) return null;

    const nameEl = actor.querySelector('.update-components-actor__title span[aria-hidden="true"]');
    const headlineEl = actor.querySelector('.update-components-actor__description span[aria-hidden="true"]');

    // Check multiple ways LinkedIn marks promoted content
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

    // Don't re-blur if already blurred
    if (parent.dataset.blurred === 'true') return;
    parent.dataset.blurred = 'true';


    const wrapper = document.createElement('div');
    while (parent.firstChild) wrapper.appendChild(parent.firstChild);
    wrapper.style.filter = 'blur(10px)';
    wrapper.style.transition = 'all 0.3s ease';

    const btn = document.createElement('button');
    btn.textContent = 'Click to View';
    btn.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10;
    background: #0a66c2;
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 24px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: all 0.2s ease;
  `;

    btn.onmouseover = () => btn.style.background = '#004182';
    btn.onmouseout = () => btn.style.background = '#0a66c2';
    btn.onclick = () => {
        wrapper.style.filter = '';
        btn.remove();
        // Mark as revealed so it won't be re-blurred
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
        // Remove blur effect and button
        const wrapper = parent.querySelector('div[style*="filter"]');
        const button = parent.querySelector('button');

        if (wrapper) {
            wrapper.style.filter = '';
        }
        if (button && button.textContent === 'Click to View') {
            button.remove();
        }

        // Reset data attributes
        parent.dataset.blurred = 'false';
        parent.dataset.revealed = 'true';
    });
}

// Analyze profile using custom Gemini API key
async function analyzeWithCustomKey(profileData, apiKey, customICP) {
    try {
        // Build the prompt
        let prompt = `You are analyzing LinkedIn profiles to determine if they match the target audience criteria.

Profile Information:
- Name: ${profileData.name}
- Headline: ${profileData.headline}
- Is Promoted/Sponsored: ${profileData.isPromoted}

`;

        if (customICP) {
            prompt += `Target Audience (ICP):
${customICP}

Based on the profile information and the target audience description, determine if this profile is relevant and should be shown.
`;
        } else {
            prompt += `Determine if this profile represents a professional, high-value individual worth engaging with. Consider:
- Is it a real person (not a company or promotional account)?
- Does the headline indicate expertise or a meaningful professional role?
- Is it NOT promotional or sponsored content?
`;
        }

        prompt += `
IMPORTANT: Respond with ONLY "SHOW" or "HIDE" - nothing else.
- SHOW if the profile matches the criteria
- HIDE if it doesn't match or is promotional/spam`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 10
                    }
                })
            }
        );

        console.log('📡 [Content] Gemini API response:', response.status);

        if (!response.ok) {
            console.error('❌ [Content] Gemini API error:', response.status);
            const errorData = await response.json();
            console.error('❌ [Content] Gemini API error details:', errorData);

            // If quota exceeded or API error, fall back to showing the post
            return { shouldShow: true };
        }

        const data = await response.json();
        console.log('📊 [Content] Gemini API result:', data);

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || 'SHOW';
        const shouldShow = text.includes('SHOW');

        console.log('🤖 [Content] Gemini decision:', text, '-> shouldShow:', shouldShow);

        return { shouldShow };
    } catch (error) {
        console.error('❌ [Content] Custom key analysis failed:', error);
        // On error, default to showing the post
        return { shouldShow: true };
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    console.log('⏳ [Content] Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', init);
} else {
    console.log('✅ [Content] DOM already loaded, initializing immediately');
    init();
}
