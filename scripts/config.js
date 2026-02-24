// Configuration for the extension

const CONFIG = {
    GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
    GEMINI_DEFAULT_MODEL: 'gemini-2.5-flash-lite',
    POST_ACTIONS: {
        BLUR: 'blur',
        REMOVE: 'remove'
    },
    // Production API base URL
    API_BASE_URL: 'https://authr-ai.com'
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
