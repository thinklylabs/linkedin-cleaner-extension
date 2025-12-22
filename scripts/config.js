// // Configuration for the extension
// // Update this before deploying

// const CONFIG = {
//     API_BASE_URL: 'http://localhost:3000', // TODO: Replace with your actual domain

//     // API_BASE_URL: 'https://www.authr-ai.com/',
// };

// console.log('CONFIG loaded:', CONFIG);

// // Export for use in other scripts
// if (typeof module !== 'undefined' && module.exports) {
//     module.exports = CONFIG;
// }


// Configuration for the extension
// Update this before deploying

const CONFIG = {
    API_BASE_URL: 'http://localhost:3000', // Local development
    // API_BASE_URL: 'https://subcontiguous-scowlingly-shiela.ngrok-free.dev', // TODO: Replace with your ngrok URL (e.g., https://xxxx-xx-xx-xx-xx.ngrok-free.app)
    // API_BASE_URL: 'https://www.authr-ai.com/', // Production
    GEMINI_API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'
};

console.log('⚙️ [Config] CONFIG loaded:', CONFIG);

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
