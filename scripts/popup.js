// Simplified popup script for Gemini-only filtering

async function init() {
    const { customGeminiKey, customICP, filterEnabled } = await chrome.storage.local.get([
        'customGeminiKey',
        'customICP',
        'filterEnabled'
    ]);

    const apiKeyInput = document.getElementById('api-key-input');
    const icpInput = document.getElementById('icp-input');
    const filterToggle = document.getElementById('filter-toggle');
    const statusDot = document.getElementById('status-dot');
    const toggleSublabel = document.getElementById('toggle-sublabel');
    const clearBtn = document.getElementById('clear-btn');
    const clearDivider = document.getElementById('clear-divider');

    // Populate saved values
    if (customGeminiKey) {
        apiKeyInput.value = customGeminiKey;
        filterToggle.disabled = false;
        clearBtn.classList.remove('hidden');
        clearDivider.style.display = 'block';
    }

    if (customICP) {
        icpInput.value = customICP;
    }

    // Set toggle state
    const isEnabled = customGeminiKey && filterEnabled !== false;
    updateToggleState(isEnabled);
}

function updateToggleState(isEnabled) {
    const filterToggle = document.getElementById('filter-toggle');
    const statusDot = document.getElementById('status-dot');
    const toggleSublabel = document.getElementById('toggle-sublabel');
    const apiKeyInput = document.getElementById('api-key-input');

    if (isEnabled) {
        filterToggle.classList.add('active');
        statusDot.classList.add('active');
        toggleSublabel.textContent = 'Filtering your feed';
    } else if (apiKeyInput.value.trim()) {
        filterToggle.classList.remove('active');
        statusDot.classList.remove('active');
        toggleSublabel.textContent = 'Click to enable';
    } else {
        filterToggle.classList.remove('active');
        statusDot.classList.remove('active');
        toggleSublabel.textContent = 'Add API key to start';
    }
}

function showStatus(message, type) {
    const statusMsg = document.getElementById('status-msg');
    statusMsg.textContent = message;
    statusMsg.className = `status-msg ${type}`;
}

function hideStatus() {
    const statusMsg = document.getElementById('status-msg');
    statusMsg.className = 'status-msg';
}

async function validateGeminiKey(apiKey) {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Hi' }] }]
                })
            }
        );
        return response.ok;
    } catch (error) {
        console.error('API validation error:', error);
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Toggle password visibility
    document.getElementById('toggle-visibility')?.addEventListener('click', () => {
        const input = document.getElementById('api-key-input');
        const eyeIcon = document.getElementById('eye-icon');
        
        if (input.type === 'password') {
            input.type = 'text';
            eyeIcon.innerHTML = `
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                <circle cx="12" cy="12" r="3"/>
                <line x1="2" y1="2" x2="22" y2="22"/>
            `;
        } else {
            input.type = 'password';
            eyeIcon.innerHTML = `
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                <circle cx="12" cy="12" r="3"/>
            `;
        }
    });

    // Save button
    document.getElementById('save-btn')?.addEventListener('click', async () => {
        const apiKey = document.getElementById('api-key-input').value.trim();
        const customICP = document.getElementById('icp-input').value.trim();
        const saveBtn = document.getElementById('save-btn');

        if (!apiKey) {
            showStatus('Please enter an API key', 'error');
            return;
        }

        if (!apiKey.startsWith('AIza')) {
            showStatus('Invalid key format', 'error');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Validating...';
        showStatus('Checking API key...', 'loading');

        const isValid = await validateGeminiKey(apiKey);

        if (!isValid) {
            showStatus('Invalid API key', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Settings';
            return;
        }

        await chrome.storage.local.set({
            customGeminiKey: apiKey,
            customICP: customICP || null,
            filterEnabled: true
        });

        showStatus('Saved! Filtering enabled', 'success');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';

        // Enable toggle
        document.getElementById('filter-toggle').disabled = false;
        document.getElementById('clear-btn').classList.remove('hidden');
        document.getElementById('clear-divider').style.display = 'block';
        updateToggleState(true);

        // Notify content scripts
        chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'AUTH_COMPLETE',
                    message: 'API key configured'
                }).catch(() => {});
            });
        });

        setTimeout(hideStatus, 2000);
    });

    // Filter toggle
    document.getElementById('filter-toggle')?.addEventListener('click', async () => {
        const toggle = document.getElementById('filter-toggle');
        if (toggle.disabled) return;

        const { filterEnabled, customGeminiKey } = await chrome.storage.local.get(['filterEnabled', 'customGeminiKey']);
        
        if (!customGeminiKey) return;

        const newState = filterEnabled === false ? true : false;
        await chrome.storage.local.set({ filterEnabled: newState });
        updateToggleState(newState);

        // Notify content scripts
        chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'TOGGLE_FILTER', 
                    enabled: newState 
                }).catch(() => {});
            });
        });
    });

    // Clear settings
    document.getElementById('clear-btn')?.addEventListener('click', async () => {
        await chrome.storage.local.clear();
        
        document.getElementById('api-key-input').value = '';
        document.getElementById('icp-input').value = '';
        document.getElementById('filter-toggle').disabled = true;
        document.getElementById('clear-btn').classList.add('hidden');
        document.getElementById('clear-divider').style.display = 'none';
        
        updateToggleState(false);
        showStatus('Settings cleared', 'success');
        
        setTimeout(hideStatus, 2000);
    });

    // Initialize
    init();
});
