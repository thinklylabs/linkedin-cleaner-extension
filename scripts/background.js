// Import configuration
importScripts('config.js');
const API_BASE = CONFIG.API_BASE_URL;

// Listen for auth messages from web app
chrome.runtime.onMessageExternal.addListener(
    (request, sender, sendResponse) => {


        if (request.action === 'AUTH_SUCCESS') {
            chrome.storage.local.set({
                accessToken: request.accessToken,
                refreshToken: request.refreshToken,
                expiresAt: request.expiresAt
            }, () => {


                // Notify all LinkedIn tabs to start filtering
                chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'AUTH_COMPLETE',
                            message: 'Authentication successful, you can now start filtering'
                        }).catch(err => {
                            console.error("Error: ", err)
                        });
                    });
                });

                sendResponse({ success: true });
            });
            return true;
        }
    }
);

// Auto-refresh token before expiry
chrome.alarms.create('checkTokenExpiry', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkTokenExpiry') {
        await checkAndRefreshToken();
    }
});

async function checkAndRefreshToken() {
    const { accessToken, refreshToken, expiresAt } = await chrome.storage.local.get([
        'accessToken', 'refreshToken', 'expiresAt'
    ]);


    if (!refreshToken || !expiresAt) {
        return;
    }

    // Refresh if expiring in next 10 minutes
    const expiresIn = expiresAt - Math.floor(Date.now() / 1000);

    if (expiresIn > 600) {
        return; // Still valid for 10+ min
    }


    try {
        const response = await fetch(`${API_BASE}/api/extension/auth/refresh`, {
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
        } else {
            console.error('❌ [Background] Token refresh failed:', data.error);
        }
    } catch (error) {
        console.error('❌ [Background] Token refresh error:', error);
    }
}
