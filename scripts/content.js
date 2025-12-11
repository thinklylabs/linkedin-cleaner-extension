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
    }
});

async function init() {
    const { accessToken, filterEnabled } = await chrome.storage.local.get(['accessToken', 'filterEnabled']);

    if (!accessToken) {
        console.warn('Extension not authenticated');
        return;
    }

    // Check if filtering is enabled (default to true if not set)
    if (filterEnabled === false) {
        console.log('LinkedIn Profile Filter: Disabled');
        return;
    }

    console.log('LinkedIn Profile Filter: Active');
    processExistingPosts();
    observeNewPosts();
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
        if (!processedProfiles.get(cacheKey)) blurPost(postElement);
        return;
    }

    const { accessToken } = await chrome.storage.local.get('accessToken');

    try {
        const response = await fetch(`${API_BASE}/api/extension/filtering`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ profileData })
        });

        if (!response.ok) {
            console.error('API error:', response.status);
            return;
        }

        const result = await response.json();
        processedProfiles.set(cacheKey, result.shouldShow);

        if (!result.shouldShow) {
            console.log('Blurring post from:', profileData.name);
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
                    node.querySelectorAll?.('.feed-shared-update-v2__control-menu-container')
                        .forEach(processPost);
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

