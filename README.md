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

The Chrome extension is in `extension/`. The separate Node.js/MongoDB API is in `server/`. Records are stored in MongoDB Atlas through `server/server.js`. The database URI is only configured on the API host; never paste it into extension files or the extension settings. Chrome profiles connect to the same API URL and API token to share records.

1. **Rotate the MongoDB password** for the credential that was shared in chat. Update the Atlas database user's password, then create a fresh Atlas connection URI. Do not reuse the exposed password.
2. Push this project to a private GitHub repository (exclude `.env` and never commit real credentials).
3. In Render, create a new Blueprint from that repository and deploy the root `render.yaml`. It sets the API service's root directory to `server/`.
4. In the Render service's environment settings, set:
   - `MONGODB_URI`: the new Atlas connection URI.
   - `API_TOKEN`: a new random token of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
   - `MONGODB_DATABASE` defaults to `discord_user_register`.
5. In MongoDB Atlas Network Access, allow connections from Render. Render's outbound IPs can change; if Atlas requires `0.0.0.0/0`, use that only with a strong database password and least-privilege database user, since the API token is not a MongoDB network firewall.
6. Copy the deployed HTTPS service URL and `API_TOKEN`. In Chrome, load the unpacked extension from the repository's `extension/` folder. For every Chrome profile, reload the extension and open its side panel. Expand **Cloud database connection**, enter the Render API URL and the same API token, then click **Connect**.

The API requires the bearer token for all data endpoints, allows browser requests only from Chrome extension origins, validates updates, and enforces a unique case-insensitive `otherUser` key in MongoDB. The API token is stored in the extension's local storage and is visible to anyone who can inspect that Chrome profile, so only install the extension in profiles you trust. The MongoDB URI remains server-side.

On first connection to each configured API URL, records from the earlier local/Chrome Sync versions are imported without replacing existing cloud records. Local backups are retained. The extension does not fall back to Chrome Sync if the API is unavailable; errors are shown in the side panel.

Select the Chrome profile name from the dropdown at the top of the side panel; the extension cannot read Chrome's profile menu itself. The selected profile name is kept separately in local storage for each Chrome profile and copied into each registration. The selected text is stored as `otherUser` and duplicate-checked without regard to letter case. Each record contains `date`, `server`, `chromeProfile`, `myUser`, `otherUser`, `isAccept` (initially `false`), `replay` (initially `0`), and `status` (initially `living`).

The table provides an independent search field for each data column. Accepted state, replay count, and status are saved when their controls change; **Delete** removes a record immediately.
