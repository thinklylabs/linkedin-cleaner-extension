// // Check if CONFIG is loaded
// if (typeof CONFIG === 'undefined') {
//     console.error('CONFIG is not defined. Make sure config.js is loaded first.');
// }

// const API_BASE = CONFIG?.API_BASE_URL || 'http://localhost:3000';

// async function init() {
//     try {
//         const { accessToken, filterEnabled } = await chrome.storage.local.get(['accessToken', 'filterEnabled']);

//         if (!accessToken) {
//             showLoggedOut();
//             return;
//         }

//         // Verify session is still valid
//         const valid = await verifySession(accessToken);
//         if (valid) {
//             showLoggedIn();
//             // Initialize toggle state (default to enabled if not set)
//             const isEnabled = filterEnabled !== false;
//             updateToggleUI(isEnabled);
//         } else {
//             showLoggedOut();
//         }
//     } catch (error) {
//         console.error('Initialization error:', error);
//         showLoggedOut();
//     }
// }

// async function verifySession(token) {
//     try {
//         const res = await fetch(`${API_BASE}/api/extension/auth/verify`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ sessionToken: token })
//         });

//         const data = await res.json();
//         return data.authenticated;
//     } catch (error) {
//         console.error('Session verification failed:', error);
//         return false;
//     }
// }

// function showLoggedOut() {
//     const loggedOut = document.getElementById('logged-out');
//     const loggedIn = document.getElementById('logged-in');
//     if (loggedOut && loggedIn) {
//         loggedOut.classList.remove('hidden');
//         loggedIn.classList.add('hidden');
//     }
// }

// function showLoggedIn() {
//     const loggedIn = document.getElementById('logged-in');
//     const loggedOut = document.getElementById('logged-out');
//     if (loggedIn && loggedOut) {
//         loggedIn.classList.remove('hidden');
//         loggedOut.classList.add('hidden');
//     }
// }

// function updateToggleUI(isEnabled) {
//     const toggle = document.getElementById('filter-toggle');
//     if (toggle) {
//         if (isEnabled) {
//             toggle.classList.add('active');
//         } else {
//             toggle.classList.remove('active');
//         }
//     }
// }

// // Initialize event listeners when DOM is ready
// document.addEventListener('DOMContentLoaded', () => {
//     // Login button - opens web app auth page
//     document.getElementById('login-btn')?.addEventListener('click', () => {
//         chrome.tabs.create({ url: `${API_BASE}/extension-auth` });
//     });

//     // Logout button - clears stored tokens  
//     document.getElementById('logout-btn')?.addEventListener('click', async () => {
//         await chrome.storage.local.clear();
//         showLoggedOut();
//     });

//     // Toggle button - enables/disables filtering
//     document.getElementById('filter-toggle')?.addEventListener('click', async () => {
//         const { filterEnabled } = await chrome.storage.local.get('filterEnabled');
//         const newState = filterEnabled === false ? true : false;

//         await chrome.storage.local.set({ filterEnabled: newState });
//         updateToggleUI(newState);

//         // Notify content script to refresh filtering
//         chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
//             tabs.forEach(tab => {
//                 chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_FILTER', enabled: newState });
//             });
//         });
//     });

//     // Run init after event listeners are set up
//     init();
// });

const STORAGE_KEYS = ['filterEnabled', 'icpTargets'];

let filterToggle;
let statusPill;
let statusNote;
let toggleTitle;
let toggleSub;
let icpInput;
let saveStatus;
let icpStat;
let saveTimeout;

async function init() {
    try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS);
        const isEnabled = stored.filterEnabled !== false;
        updateToggleUI(isEnabled);
        setICPInput(stored.icpTargets || '');
        updateICPStat(stored.icpTargets || '');
    } catch (error) {
        console.error('Failed to initialize popup state:', error);
    }
}

function updateToggleUI(isEnabled) {
    if (!filterToggle) return;

    filterToggle.classList.toggle('active', isEnabled);
    filterToggle.setAttribute('aria-checked', isEnabled.toString());
    statusPill.textContent = isEnabled ? 'Filter Active' : 'Filter Paused';
    statusNote.textContent = isEnabled ? 'Prioritizing your ICP keywords' : 'Filtering is on standby';
    toggleTitle.textContent = isEnabled ? 'Filtering on' : 'Filter paused';
    toggleSub.textContent = isEnabled ? 'Non-ICP posts are blurred' : 'Everything remains visible';
}

function updateICPStat(value) {
    if (!icpStat) return;
    icpStat.textContent = value ? 'Custom' : 'Set yours';
}

function setICPInput(value) {
    if (!icpInput) return;
    icpInput.value = value;
}

async function handleToggle(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const { filterEnabled } = await chrome.storage.local.get('filterEnabled');
    const newState = filterEnabled === false ? true : false;

    await chrome.storage.local.set({ filterEnabled: newState });
    updateToggleUI(newState);
    notifyTabs(newState);
}

function notifyTabs(enabled) {
    chrome.tabs?.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_FILTER', enabled });
        });
    });
}

function showSaveFeedback(message = 'Saved') {
    if (!saveStatus) return;
    clearTimeout(saveTimeout);
    saveStatus.textContent = message;
    saveTimeout = setTimeout(() => {
        saveStatus.textContent = '';
    }, 2200);
}

async function handleICPSave() {
    if (!icpInput) return;
    const value = icpInput.value.trim();
    await chrome.storage.local.set({ icpTargets: value });
    updateICPStat(value);
    showSaveFeedback('ICP saved');
}

document.addEventListener('DOMContentLoaded', () => {
    filterToggle = document.getElementById('filter-toggle');
    statusPill = document.getElementById('status-pill');
    statusNote = document.getElementById('status-note');
    toggleTitle = document.getElementById('toggle-title');
    toggleSub = document.getElementById('toggle-sub');
    icpInput = document.getElementById('icp-input');
    saveStatus = document.getElementById('save-status');
    icpStat = document.getElementById('stat-icp');

    filterToggle?.addEventListener('click', handleToggle);
    filterToggle?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            handleToggle(event);
        }
    });

    document.getElementById('save-icp')?.addEventListener('click', handleICPSave);

    init();
});
