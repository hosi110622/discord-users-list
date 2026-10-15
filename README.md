# Discord User Register

A Chrome Manifest V3 extension for registering usernames selected on Discord and managing the saved records in Chrome's side panel.

## Install

1. Open `chrome://extensions` in Chrome 116 or later.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the `extension` folder.
4. Reload the Discord tab after installing or updating the extension.
5. Hold **Ctrl** and drag to select a username on Discord. Use the prompt beside the pointer to save it.
6. Click the extension icon to open the registered-users table on the right.

## Shared MongoDB setup

The Chrome extension is in `extension/`. The separate Node.js/MongoDB API is in `server/`. Records are stored in MongoDB Atlas through `server/server.js`. The database URI is only configured on the API host; never paste it into extension files or the extension settings. Chrome profiles connect to the same API URL to share records.

1. **Rotate the MongoDB password** for the credential that was shared in chat. Update the Atlas database user's password, then create a fresh Atlas connection URI. Do not reuse the exposed password.
2. Push this project to a private GitHub repository (exclude `.env` and never commit real credentials).
3. In Render, create a new Blueprint from that repository and deploy the root `render.yaml`. It sets the API service's root directory to `server/`.
4. In the Render service's environment settings, set:
   - `MONGODB_URI`: the new Atlas connection URI.
   - `MONGODB_DATABASE` defaults to `discord_user_register`.
5. In MongoDB Atlas Network Access, allow connections from Render. Render's outbound IPs can change; if Atlas requires `0.0.0.0/0`, use that only with a strong database password and least-privilege database user.
6. The extension is configured for `https://discord-users-list.onrender.com`. To change it, edit the `API_URL` constant near the top of `extension/service-worker.js`, then reload the extension in each Chrome profile.

The API is public: anyone who knows the service URL can read, add, edit, or delete records. Browser requests are accepted from Chrome extension origins, updates are validated, and MongoDB enforces a unique case-insensitive `otherUser` key. The MongoDB URI remains server-side. Do not put sensitive or private information in this shared database.

On first use of the configured API URL, records from the earlier local/Chrome Sync versions are imported without replacing existing cloud records. Local backups are retained. The extension does not fall back to Chrome Sync if the API is unavailable; errors are shown in the side panel.

Select the Chrome profile name from the dropdown at the top of the side panel; the extension cannot read Chrome's profile menu itself. The selected profile name is kept separately in local storage for each Chrome profile and copied into each registration. The selected text is stored as `otherUser` and duplicate-checked without regard to letter case. Each record contains `date`, `server`, `chromeProfile`, `myUser`, `otherUser`, `isAccept` (initially `false`), `replay` (initially `0`), and `status` (initially `living`).

The table provides an independent search field for each data column. Click **View All Data** to fetch and display all cloud records; opening the panel, connecting, and registering do not fetch the full list. Saving a registration displays only that specific user in an already-open panel. Accepted state, replay count, and status are saved when their controls change; **Delete** removes a record immediately.
