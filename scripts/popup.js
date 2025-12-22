// Elements
let filterToggle, toggleSwitch, toggleTitle, toggleSub, statusBadge;
let icpInput, saveStatus;
let saveTimeout;

async function init() {
    const { filterEnabled, icpTargets } = await chrome.storage.local.get(['filterEnabled', 'icpTargets']);
    const isEnabled = filterEnabled !== false;
    
    updateToggleUI(isEnabled);
    if (icpTargets) {
        icpInput.value = icpTargets;
    }
}

function updateToggleUI(isEnabled) {
    toggleSwitch.classList.toggle('active', isEnabled);
    filterToggle.setAttribute('aria-checked', String(isEnabled));
    
    toggleTitle.textContent = isEnabled ? 'Filter Enabled' : 'Filter Disabled';
    toggleSub.textContent = isEnabled ? 'Non-matching posts are blurred' : 'All posts are visible';
    
    statusBadge.textContent = isEnabled ? 'Active' : 'Paused';
    statusBadge.classList.toggle('paused', !isEnabled);
}

async function handleToggle(e) {
    e?.preventDefault();
    
    const { filterEnabled } = await chrome.storage.local.get('filterEnabled');
    const newState = filterEnabled === false;
    
    await chrome.storage.local.set({ filterEnabled: newState });
    updateToggleUI(newState);
    
    // Notify LinkedIn tabs
    chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_FILTER', enabled: newState });
        });
    });
}

async function handleSaveICP() {
    const value = icpInput.value.trim();
    await chrome.storage.local.set({ icpTargets: value });
    
    // Show feedback
    clearTimeout(saveTimeout);
    saveStatus.textContent = 'Saved!';
    saveTimeout = setTimeout(() => {
        saveStatus.textContent = '';
    }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
    filterToggle = document.getElementById('filter-toggle');
    toggleSwitch = document.getElementById('toggle-switch');
    toggleTitle = document.getElementById('toggle-title');
    toggleSub = document.getElementById('toggle-sub');
    statusBadge = document.getElementById('status-badge');
    icpInput = document.getElementById('icp-input');
    saveStatus = document.getElementById('save-status');

    filterToggle.addEventListener('click', handleToggle);
    filterToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') handleToggle(e);
    });

    document.getElementById('save-icp').addEventListener('click', handleSaveICP);

    init();
});
