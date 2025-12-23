// Background service worker for LinkedIn Feed Cleaner
// Handles auth messages and token refresh

// Import configuration
importScripts('config.js');

// Listen for auth messages from web app
chrome.runtime.onMessageExternal.addListener(
    (request, sender, sendResponse) => {
        if (request.action === 'AUTH_SUCCESS') {
            chrome.storage.local.set({
                accessToken: request.accessToken,
                refreshToken: request.refreshToken,
                expiresAt: request.expiresAt,
                isAuthrUser: true
            }, () => {
                // Notify all LinkedIn tabs to start filtering
                chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'AUTH_COMPLETE',
                            message: 'Authentication successful, you can now start filtering'
                        }).catch(() => {});
                    });
                });

                sendResponse({ success: true });
            });
            return true; // Will respond asynchronously
        }
    }
);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'CHECK_AUTH') {
        chrome.storage.local.get(['accessToken', 'customGeminiKey'], (result) => {
            sendResponse({ 
                authenticated: !!(result.accessToken || result.customGeminiKey) 
            });
        });
        return true; // Will respond asynchronously
    }
});

// Auto-refresh token before expiry
chrome.alarms.create('checkTokenExpiry', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkTokenExpiry') {
        await checkAndRefreshToken();
    }
});

async function checkAndRefreshToken() {
    const { refreshToken, expiresAt, isAuthrUser } = await chrome.storage.local.get([
        'refreshToken', 'expiresAt', 'isAuthrUser'
    ]);

    // Only refresh for authr users
    if (!isAuthrUser || !refreshToken || !expiresAt) {
        return;
    }

    // Refresh if expiring in next 10 minutes
    const expiresIn = expiresAt - Math.floor(Date.now() / 1000);

    if (expiresIn > 600) {
        return; // Still valid for 10+ min
    }

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/extension/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });

        const data = await response.json();

        if (data.accessToken) {
            await chrome.storage.local.set({
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                expiresAt: data.expiresAt
            });
        }
    } catch (error) {
        // Silent fail
    }
}

