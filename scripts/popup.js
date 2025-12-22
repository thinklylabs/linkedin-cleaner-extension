// Check if CONFIG is loaded
if (typeof CONFIG === 'undefined') {
    console.error('❌ [Popup] CONFIG is not defined. Make sure config.js is loaded first.');
}

const API_BASE = CONFIG?.API_BASE_URL || 'http://localhost:3000';

async function init() {
    try {
        const storageData = await chrome.storage.local.get([
            'accessToken',
            'filterEnabled',
            'refreshToken',
            'expiresAt',
            'customGeminiKey',
            'customICP'
        ]);

        // console.log('📊 [Popup] Storage data:', {
        //     hasAccessToken: !!storageData.accessToken,
        //     accessTokenLength: storageData.accessToken?.length || 0,
        //     hasRefreshToken: !!storageData.refreshToken,
        //     refreshTokenLength: storageData.refreshToken?.length || 0,
        //     filterEnabled: storageData.filterEnabled,
        //     expiresAt: storageData.expiresAt,
        //     expiresIn: storageData.expiresAt ? (storageData.expiresAt - Math.floor(Date.now() / 1000)) : 'N/A',
        //     hasCustomGeminiKey: !!storageData.customGeminiKey,
        //     hasCustomICP: !!storageData.customICP
        // });

        // Check if using custom Gemini API key
        if (storageData.customGeminiKey) {
            showLoggedIn(true); // Show logged in with custom key indicator
            const isEnabled = storageData.filterEnabled !== false;
            updateToggleUI(isEnabled);
            return;
        }

        // Check for server authentication
        if (!storageData.accessToken) {
            showLoggedOut();
            return;
        }

        // Verify session is still valid
        const valid = await verifySession(storageData.accessToken);

        if (valid) {
            showLoggedIn(false);
            // Initialize toggle state (default to enabled if not set)
            const isEnabled = storageData.filterEnabled !== false;
            updateToggleUI(isEnabled);
        } else {
            showLoggedOut();
        }
    } catch (error) {
        showLoggedOut();
    }
}

async function verifySession(token) {
    try {
        const res = await fetch(`${API_BASE}/api/extension/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: token })
        });


        const data = await res.json();

        return data.authenticated;
    } catch (error) {
        return false;
    }
}

function showLoggedOut() {
    const loggedOut = document.getElementById('logged-out');
    const loggedIn = document.getElementById('logged-in');
    const apiKeyConfig = document.getElementById('api-key-config');
    if (loggedOut && loggedIn && apiKeyConfig) {
        loggedOut.classList.remove('hidden');
        loggedIn.classList.add('hidden');
        apiKeyConfig.classList.add('hidden');
    }
}

function showLoggedIn(isUsingCustomKey = false) {
    const loggedIn = document.getElementById('logged-in');
    const loggedOut = document.getElementById('logged-out');
    const apiKeyConfig = document.getElementById('api-key-config');
    if (loggedIn && loggedOut && apiKeyConfig) {
        loggedIn.classList.remove('hidden');
        loggedOut.classList.add('hidden');
        apiKeyConfig.classList.add('hidden');
    }
}

function showApiKeyConfig() {
    const loggedOut = document.getElementById('logged-out');
    const loggedIn = document.getElementById('logged-in');
    const apiKeyConfig = document.getElementById('api-key-config');
    if (loggedOut && loggedIn && apiKeyConfig) {
        loggedOut.classList.add('hidden');
        loggedIn.classList.add('hidden');
        apiKeyConfig.classList.remove('hidden');
    }
}

function updateToggleUI(isEnabled) {
    const toggle = document.getElementById('filter-toggle');
    if (toggle) {
        if (isEnabled) {
            toggle.classList.add('active');
        } else {
            toggle.classList.remove('active');
        }
    }
}

// Initialize event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {

    // Login button - opens web app auth page
    document.getElementById('login-btn')?.addEventListener('click', () => {
        const extensionId = chrome.runtime.id;  // Get extension's own ID
        const authUrl = `${API_BASE}/extension-auth?extensionId=${extensionId}`;
        chrome.tabs.create({ url: authUrl });
    });

    // Use custom key link - navigate to API key config screen
    document.getElementById('use-custom-key-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showApiKeyConfig();
    });

    // Back to sign in button
    document.getElementById('back-to-signin-btn')?.addEventListener('click', () => {
        showLoggedOut();
    });

    // Toggle password visibility
    document.getElementById('toggle-key-visibility')?.addEventListener('click', () => {
        const input = document.getElementById('gemini-key-input');
        const eyeIcon = document.getElementById('eye-icon');
        if (input.type === 'password') {
            input.type = 'text';
            eyeIcon.innerHTML = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/>';
        } else {
            input.type = 'password';
            eyeIcon.innerHTML = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
        }
    });

    // Save API key button
    document.getElementById('save-api-key-btn')?.addEventListener('click', async () => {
        const keyInput = document.getElementById('gemini-key-input');
        const icpInput = document.getElementById('custom-icp-input');
        const statusDiv = document.getElementById('api-key-status');

        const apiKey = keyInput.value.trim();
        const customICP = icpInput.value.trim();

        if (!apiKey) {
            statusDiv.textContent = '❌ Please enter an API key';
            statusDiv.style.color = '#c51515';
            statusDiv.style.display = 'block';
            return;
        }

        // Basic validation - Gemini API keys start with 'AIza'
        if (!apiKey.startsWith('AIza')) {
            statusDiv.textContent = '❌ Invalid API key format';
            statusDiv.style.color = '#c51515';
            statusDiv.style.display = 'block';
            return;
        }

        statusDiv.textContent = '⏳ Validating API key...';
        statusDiv.style.color = '#0D1717';
        statusDiv.style.display = 'block';

        // Test the API key with a simple request
        const isValid = await validateGeminiKey(apiKey);

        if (!isValid) {
            statusDiv.textContent = '❌ Invalid API key or quota exceeded';
            statusDiv.style.color = '#c51515';
            return;
        }

        await chrome.storage.local.set({
            customGeminiKey: apiKey,
            customICP: customICP || null,
            filterEnabled: true // Enable filtering by default
        });

        statusDiv.textContent = '✅ API key saved successfully!';
        statusDiv.style.color = '#1DC6A1';

        // Notify content scripts to start filtering
        chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'AUTH_COMPLETE',
                    message: 'Custom API key configured, you can now start filtering'
                }).catch(err => {
                });
            });
        });

        setTimeout(() => {
            showLoggedIn(true);
        }, 1000);
    });

    // Logout button - clears stored tokens  
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await chrome.storage.local.clear();
        showLoggedOut();
    });

    // Toggle button - enables/disables filtering
    document.getElementById('filter-toggle')?.addEventListener('click', async () => {
        const { filterEnabled } = await chrome.storage.local.get('filterEnabled');
        const newState = filterEnabled === false ? true : false;


        await chrome.storage.local.set({ filterEnabled: newState });

        updateToggleUI(newState);

        // Notify content script to refresh filtering
        chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_FILTER', enabled: newState });
            });
        });
    });

    // Run init after event listeners are set up
    init();
});

// Validate Gemini API key by making a test request
async function validateGeminiKey(apiKey) {
    try {

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: 'test' }]
                    }]
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
        }

        return response.ok;
    } catch (error) {
        console.error('❌ [Popup] Gemini API validation error:', error);
        console.error('❌ [Popup] Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return false;
    }
}
