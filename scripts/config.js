// Configuration for the extension

const CONFIG = {
    GEMINI_API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    POST_ACTIONS: {
        BLUR: 'blur',
        REMOVE: 'remove'
    },
    // API Base URL - Change this for your environment
    // Use 'http://localhost:3000' for development
    // Use 'https://authr-ai.com' for production
    API_BASE_URL: 'http://localhost:3000'
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
