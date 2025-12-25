// Popup script with authr authentication flow

const EXTENSION_ID = chrome.runtime.id;
const AUTH_URL = `${CONFIG.API_BASE_URL}/extension-auth?extensionId=${EXTENSION_ID}`;

// Screen management
const screens = {
  auth: document.getElementById('auth-screen'),
  manualKey: document.getElementById('manual-key-screen'),
  main: document.getElementById('main-screen'),
  settings: document.getElementById('settings-screen')
};

function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen?.classList.add('hidden'));
  screens[screenName]?.classList.remove('hidden');
}

// Initialize on load
async function init() {
  const { customGeminiKey, accessToken, customICP, filterEnabled, postAction } = await chrome.storage.local.get([
    'customGeminiKey',
    'accessToken',
    'customICP',
    'filterEnabled',
    'postAction'
  ]);

  // Determine which screen to show
  if (customGeminiKey || accessToken) {
    showScreen('main');
    updateMainScreen(filterEnabled !== false);
    
    // Populate settings if navigating there
    if (customICP) {
      document.getElementById('icp-input').value = customICP;
    }
    if (postAction) {
      document.getElementById(`action-${postAction}`).checked = true;
    }
  } else {
    showScreen('auth');
  }
}

function updateMainScreen(isEnabled) {
  const filterToggle = document.getElementById('filter-toggle');
  const statusDot = document.getElementById('status-dot');
  const toggleSublabel = document.getElementById('toggle-sublabel');

  if (isEnabled) {
    filterToggle.classList.add('active');
    statusDot.classList.add('active');
    toggleSublabel.textContent = 'Filtering your feed';
  } else {
    filterToggle.classList.remove('active');
    statusDot.classList.remove('active');
    toggleSublabel.textContent = 'Click to enable';
  }
}

function showStatus(elementId, message, type) {
  const statusMsg = document.getElementById(elementId);
  if (statusMsg) {
    statusMsg.textContent = message;
    statusMsg.className = `status-msg ${type}`;
  }
}

function hideStatus(elementId) {
  const statusMsg = document.getElementById(elementId);
  if (statusMsg) {
    statusMsg.className = 'status-msg';
  }
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

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Load saved theme (default to light mode)
  chrome.storage.local.get(['theme'], ({ theme }) => {
    if (theme === 'dark') {
      document.body.classList.remove('light-mode');
    } else {
      // Default to light mode
      document.body.classList.add('light-mode');
    }
  });

  // Theme toggle handlers
  const themeToggles = [
    'theme-toggle-auth',
    'theme-toggle-manual',
    'theme-toggle-main',
    'theme-toggle-settings'
  ];

  themeToggles.forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
      const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
      chrome.storage.local.set({ theme });
    });
  });

  // Auth screen - Sign in with authr
  document.getElementById('signin-authr-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: AUTH_URL });
  });

  // Auth screen - Continue without authr
  document.getElementById('continue-without-btn')?.addEventListener('click', () => {
    showScreen('manualKey');
  });

  // Manual key screen - Back button
  document.getElementById('back-to-auth-btn')?.addEventListener('click', () => {
    showScreen('auth');
  });

  // Manual key screen - Toggle password visibility
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

  // Manual key screen - Save key
  document.getElementById('save-key-btn')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const saveBtn = document.getElementById('save-key-btn');

    if (!apiKey) {
      showStatus('key-status-msg', 'Please enter an API key', 'error');
      return;
    }

    if (!apiKey.startsWith('AIza')) {
      showStatus('key-status-msg', 'Invalid key format', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Validating...';
    showStatus('key-status-msg', 'Checking API key...', 'loading');

    const isValid = await validateGeminiKey(apiKey);

    if (!isValid) {
      showStatus('key-status-msg', 'Invalid API key', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Continue';
      return;
    }

    await chrome.storage.local.set({
      customGeminiKey: apiKey,
      filterEnabled: true,
      postAction: 'blur',
      showCounter: true
    });

    showStatus('key-status-msg', 'Saved! Redirecting...', 'success');
    
    setTimeout(() => {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Continue';
      showScreen('main');
      updateMainScreen(true);
      notifyContentScripts();
    }, 1000);
  });

  // Main screen - Settings button
  document.getElementById('settings-btn')?.addEventListener('click', async () => {
    const { customICP, postAction, showCounter, isAuthrUser, customGeminiKey } = await chrome.storage.local.get([
      'customICP', 
      'postAction', 
      'showCounter',
      'isAuthrUser',
      'customGeminiKey'
    ]);
    
    // Show/hide ICP section based on user type
    const icpSection = document.getElementById('icp-section');
    if (isAuthrUser) {
      // Hide ICP for authr users (they have it in backend)
      icpSection.style.display = 'none';
    } else {
      // Show ICP for free users
      icpSection.style.display = 'block';
      if (customICP) {
        document.getElementById('icp-input').value = customICP;
      }
    }
    
    const actionToCheck = postAction || 'blur';
    document.getElementById(`action-${actionToCheck}`).checked = true;
    
    // Set counter toggle state (default to true)
    const counterToggle = document.getElementById('counter-toggle');
    if (showCounter !== false) {
      counterToggle.classList.add('active');
    } else {
      counterToggle.classList.remove('active');
    }
    
    // Show appropriate button based on auth type
    const signoutBtn = document.getElementById('signout-btn');
    const removeKeyBtn = document.getElementById('remove-key-btn');
    
    if (isAuthrUser) {
      // User signed in with authr
      signoutBtn.style.display = 'block';
      removeKeyBtn.style.display = 'none';
    } else if (customGeminiKey) {
      // User added their own API key
      signoutBtn.style.display = 'none';
      removeKeyBtn.style.display = 'block';
    } else {
      // No auth (shouldn't happen in settings)
      signoutBtn.style.display = 'none';
      removeKeyBtn.style.display = 'none';
    }
    
    showScreen('settings');
  });

  // Main screen - Filter toggle
  document.getElementById('filter-toggle')?.addEventListener('click', async () => {
    const { filterEnabled } = await chrome.storage.local.get(['filterEnabled']);
    const newState = filterEnabled === false ? true : false;
    
    await chrome.storage.local.set({ filterEnabled: newState });
    updateMainScreen(newState);
    notifyContentScripts();
  });

  // Settings screen - Back button
  document.getElementById('back-to-main-btn')?.addEventListener('click', () => {
    showScreen('main');
  });

  // Settings screen - Counter toggle
  document.getElementById('counter-toggle')?.addEventListener('click', async () => {
    const toggle = document.getElementById('counter-toggle');
    const isActive = toggle.classList.contains('active');
    
    if (isActive) {
      toggle.classList.remove('active');
    } else {
      toggle.classList.add('active');
    }
  });

  // Settings screen - Save settings
  document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
    const postAction = document.querySelector('input[name="post-action"]:checked').value;
    const showCounter = document.getElementById('counter-toggle').classList.contains('active');
    
    const { isAuthrUser } = await chrome.storage.local.get(['isAuthrUser']);
    
    const settingsToSave = {
      postAction: postAction,
      showCounter: showCounter
    };
    
    // Only save ICP for free users (authr users have it in backend)
    if (!isAuthrUser) {
      const customICP = document.getElementById('icp-input').value.trim();
      settingsToSave.customICP = customICP || null;
    }

    await chrome.storage.local.set(settingsToSave);

    showStatus('settings-status-msg', 'Settings saved!', 'success');
    notifyContentScripts();

    setTimeout(() => {
      hideStatus('settings-status-msg');
    }, 2000);
  });

  // Settings screen - Sign out (for authr users)
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    if (confirm('Sign out from authr? You\'ll need to sign in again to use the extension.')) {
      await chrome.storage.local.clear();
      
      document.getElementById('api-key-input').value = '';
      document.getElementById('icp-input').value = '';
      document.getElementById('action-blur').checked = true;
      
      showStatus('settings-status-msg', 'Signed out successfully', 'success');
      
      setTimeout(() => {
        showScreen('auth');
        hideStatus('settings-status-msg');
      }, 1500);
    }
  });

  // Settings screen - Remove API key (for free users)
  document.getElementById('remove-key-btn')?.addEventListener('click', async () => {
    if (confirm('Remove your API key? You\'ll need to add it again to use the extension.')) {
      await chrome.storage.local.clear();
      
      document.getElementById('api-key-input').value = '';
      document.getElementById('icp-input').value = '';
      document.getElementById('action-blur').checked = true;
      
      showStatus('settings-status-msg', 'API key removed', 'success');
      
      setTimeout(() => {
        showScreen('auth');
        hideStatus('settings-status-msg');
      }, 1500);
    }
  });

  // Settings screen - Clear settings
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all settings? This will sign you out.')) {
      await chrome.storage.local.clear();
      
      document.getElementById('api-key-input').value = '';
      document.getElementById('icp-input').value = '';
      document.getElementById('action-blur').checked = true;
      
      showStatus('settings-status-msg', 'Settings cleared', 'success');
      
      setTimeout(() => {
        showScreen('auth');
        hideStatus('settings-status-msg');
      }, 1500);
    }
  });

  // Initialize
  init();
});

// Notify content scripts of changes
function notifyContentScripts() {
  chrome.tabs.query({ url: 'https://www.linkedin.com/feed/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'SETTINGS_UPDATED'
      }).catch(() => {});
    });
  });
}

// Listen for messages from auth flow
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'AUTH_SUCCESS' && message.apiKey) {
    chrome.storage.local.set({
      customGeminiKey: message.apiKey,
      filterEnabled: true,
      postAction: 'blur',
      showCounter: true
    }).then(() => {
      showScreen('main');
      updateMainScreen(true);
      notifyContentScripts();
    });
  }
});
