// Configuration for the extension
// Update this before deploying

const CONFIG = {
    API_BASE_URL: 'http://localhost:3000', // TODO: Replace with your actual domain

    // API_BASE_URL: 'https://www.authr-ai.com/',
};

console.log('CONFIG loaded:', CONFIG);

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
