## Privacy Policy

Authr Extension helps users filter their LinkedIn feed.

### Data we process
- LinkedIn post/profile text visible on the `https://www.linkedin.com/feed/*` page.
- User settings stored locally in the browser (for example: filter toggle, post action, optional ICP text, API key).
- Authentication tokens when a user signs in with Authr.

### How data is used
- Data is used only to decide whether a post should be shown, blurred, or removed.
- For users with their own Gemini API key, requests are sent directly to Google Gemini API.
- For signed-in Authr users, filtering requests are sent to Authr backend endpoints.

### Data storage
- Extension settings are stored in `chrome.storage.local` on the user's device.
- The extension does not sell personal data.

### Data sharing
- Data is shared only with service providers required for filtering:
  - Google Gemini API (`generativelanguage.googleapis.com`) when user provides a Gemini key.
  - Authr backend (`authr-ai.com`) when user signs in with Authr.

### User controls
- Users can remove their API key or sign out from the extension settings.
- Users can disable filtering at any time.

### Contact
- Website: `https://authr-ai.com`

