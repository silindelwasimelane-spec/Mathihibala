# WA-Hub Dashboard — Deployment

This repository contains a static front-end under `public/` and a minimal Node server to serve it.

Local (Node):

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
# then open http://localhost:3000
```

Docker:

1. Build image:

```bash
docker build -t wa-hub-dashboard .
```

2. Run container:

```bash
docker run -p 3000:3000 wa-hub-dashboard
```

Health check: `http://localhost:3000/health`
# Mathithibala - WhatsApp Bot Server

Multi-tenant WhatsApp bot platform with dashboard. Users pair their WhatsApp, upload session config (creds.json), and their bot runs 24/7.

## Setup (Local)

### 1. Install dependencies
```bash
cd C:\Users\slinde.lwa\WA-Hub
npm install
```

### 2. Run locally
```bash
npm start
```

Visit **http://localhost:3000** in your browser.

### 3. Test flow
1. Sign in (username: `test`, password: anything)
2. Click `Link Bot` → fill in bot name, phone number, owner name
3. Copy the pairing code
4. On your phone: WhatsApp → Linked Devices → Tap pairing code and scan QR or enter code
5. After linking, you'll get `creds.json` sent to your personal WhatsApp
6. **Paste that `creds.json`** into the dashboard textarea and click "Save Session Config"
7. The bot will auto-start! It will connect and respond to messages

## Deploy on Render

### 1. Push to GitHub
```bash
cd C:\Users\slinde.lwa\WA-Hub
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/wa-hub.git
git push -u origin main
```

### 2. Create Render Web Service
- Go to https://render.com/dashboard
- Click **New** → **Web Service**
- Connect your GitHub repo
- Set:
  - **Build Command:** `npm install`
  - **Start Command:** `npm start`
  - **Environment** → Add variables (if needed):
    - `NODE_ENV=production`

### 3. Deploy
- Click **Deploy**
- Render will build and start your server

## How It Works

### User Flow
1. **Login** → Each user gets isolated account
2. **Link Bot** → Generate WhatsApp pairing code
3. **Pair on Phone** → Use WhatsApp Linked Devices
4. **Get creds.json** → WhatsApp sends it to your DM
5. **Paste & Save** → Dashboard stores creds server-side
6. **Bot Starts** → Auto-spawns per-user bot instance
7. **Bot Runs 24/7** → Responds to messages with Knightbot commands

### File Structure
```
WA-Hub/
├── server.js          # Express server + API endpoints
├── bot-manager.js     # Spawn/manage bot instances
├── bots/
│   ├── knightbot/     # Bot template (Knightbot-MD)
│   └── instances/     # Per-user bot instances
│       └── <username>/
│           ├── main.js (copied from template)
│           ├── session/
│           │   └── creds.json (user's auth)
│           └── commands/ (copied from template)
├── data/
│   └── sessions_<username>.json  # Saved session configs
└── public/
    ├── index.html     # Dashboard UI
    ├── app.js         # Frontend logic
    └── styles.css     # Styling
```

### API Endpoints

**User Management:**
- `POST /api/link-session` → Generate pairing code
- `POST /api/save-config` → Save creds.json + auto-start bot
- `GET /api/get-session-settings/<username>/<sessionId>` → Fetch bot settings

**Bot Control:**
- `POST /api/bot-control/start` → Start a user's bot
- `POST /api/bot-control/stop` → Stop a user's bot
- `GET /api/bot-control/status/<username>` → Check bot status

## Notes

- **Session Security:** In production, encrypt `creds.json` before storing
- **Process Isolation:** Each bot runs as a separate Node process
- **Auto-Cleanup:** Stopped/crashed bots don't stay in memory
- **Multi-user:** Fully isolated per user (separate session data, bot processes, etc.)

## Customization

### Change Bot Logic
Edit files in `bots/knightbot/commands/` to add/modify commands.
Changes apply to all new bot instances.

### Change Dashboard UI
Edit `public/index.html`, `public/app.js`, `public/styles.css`

### Add More Settings
Update `settings.js` in bot template and add fields to dashboard form in `public/index.html`

---

**Ready to go live!** Deploy to Render and share the public URL with users.
