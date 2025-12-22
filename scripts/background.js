// Background service worker for LinkedIn Feed Cleaner
// Minimal - just handles extension lifecycle

chrome.runtime.onInstalled.addListener(() => {
    console.log('LinkedIn Feed Cleaner installed');
});
