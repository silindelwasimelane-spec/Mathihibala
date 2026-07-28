// main server implementation continues below
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const { startBotInstance, stopBotInstance, getBotStatus, setupUserSession } = require('./bot-manager');

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function userSessionsPath(username) {
  return path.join(dataDir, `sessions_${username}.json`);
}

// file upload helpers
const multer = require('multer');
const AdmZip = require('adm-zip');
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

function sanitizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
}

app.post('/api/link-session', (req, res) => {
  const { phone, name, username, botName, botOwnerName } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const code = Math.floor(10000000 + Math.random() * 90000000).toString();
  const session = {
    id: Date.now(),
    name: name || 'New Bot',
    phone,
    botName: botName || 'Bot',
    botOwnerName: botOwnerName || '',
    botOwnerNumber: phone,
    status: 'pending',
    createdAt: new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }),
    pairingCode: code,
    config: null
  };

  // persist server-side if username provided
  if (username) {
    const file = userSessionsPath(username);
    let sessions = [];
    try {
      if (fs.existsSync(file)) sessions = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
    } catch (e) {
      console.error('read sessions error', e);
    }
    sessions.unshift(session);
    try { fs.writeFileSync(file, JSON.stringify(sessions, null, 2)); } catch (e) { console.error('write sessions error', e); }
  }

  res.json({ session, message: 'Pairing code generated successfully.' });
});

app.post('/api/save-config', (req, res) => {
  const { username, sessionId, config } = req.body;
  if (!username || !sessionId || !config) return res.status(400).json({ error: 'username, sessionId and config are required.' });

  const file = userSessionsPath(username);
  let sessions = [];
  try {
    if (fs.existsSync(file)) sessions = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    console.error('read sessions error', e);
    return res.status(500).json({ error: 'Failed reading sessions' });
  }

  const idx = sessions.findIndex(s => String(s.id) === String(sessionId) || String(s.pairingCode) === String(sessionId));
  if (idx === -1) return res.status(404).json({ error: 'Session not found' });

  sessions[idx].config = config;
  sessions[idx].status = 'paired';

  try {
    fs.writeFileSync(file, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error('write sessions error', e);
    return res.status(500).json({ error: 'Failed saving session' });
  }

  // Auto-setup bot and start it
  const setupResult = setupUserSession(username, config);
  if (!setupResult) {
    return res.status(500).json({ error: 'Failed to setup bot session' });
  }

  startBotInstance(username).then(botStart => {
    console.log(`Bot start result for ${username}:`, botStart);
  }).catch(err => {
    console.error(`Failed to auto-start bot for ${username}:`, err);
  });

  return res.json({ session: sessions[idx], message: 'Session config saved and bot started.' });
});

// Bot can fetch its settings by sessionId/phone
app.get('/api/get-session-settings/:username/:sessionId', (req, res) => {
  const { username, sessionId } = req.params;
  if (!username || !sessionId) {
    return res.status(400).json({ error: 'username and sessionId required.' });
  }

  const file = userSessionsPath(username);
  let sessions = [];
  try {
    if (fs.existsSync(file)) sessions = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    console.error('read sessions error', e);
    return res.status(500).json({ error: 'Failed reading sessions' });
  }

  const session = sessions.find(s => String(s.id) === String(sessionId) || String(s.phone) === String(sessionId) || String(s.pairingCode) === String(sessionId));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Return settings in a format the bot can use
  const settings = {
    packagename: session.name,
    botName: session.botName,
    botOwner: session.botOwnerName || 'Bot',
    ownerNumber: session.botOwnerNumber,
    sessionConfig: session.config ? JSON.parse(session.config) : null,
    status: session.status,
    phone: session.phone
  };

  return res.json(settings);
});

// Bot controls: start
app.post('/api/bot-control/start', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const result = await startBotInstance(username);
  res.json(result);
});

// Bot controls: stop
app.post('/api/bot-control/stop', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const result = stopBotInstance(username);
  res.json(result);
});

// Bot controls: status
app.get('/api/bot-control/status/:username', (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'username required' });

  const result = getBotStatus(username);
  res.json(result);
});

// List uploaded bot folders
app.get('/api/list-bots', (req, res) => {
  const botsDir = path.join(__dirname, 'bots');
  if (!fs.existsSync(botsDir)) return res.json({ bots: [] });
  try {
    const items = fs.readdirSync(botsDir, { withFileTypes: true });
    const bots = items.filter((item) => item.isDirectory()).map((item) => ({ name: item.name, type: 'bot folder' }));
    return res.json({ bots });
  } catch (err) {
    console.error('list bots error', err);
    return res.status(500).json({ error: 'Unable to list bots' });
  }
});

// Manual bot upload endpoint - accepts a zip or folder archive
app.post('/api/upload-bot', upload.single('botFile'), (req, res) => {
  const { username, sessionId, botName } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field name "botFile".' });

  const sessionKey = sessionId || Date.now();
  const dirName = sanitizeName(botName) || `${sanitizeName(username)}-${sessionKey}`;
  const dest = path.join(__dirname, 'bots', dirName);
  try {
    fs.mkdirSync(dest, { recursive: true });

    const uploadedPath = req.file.path;
    // Attempt to unzip if the file looks like a zip
    try {
      const zip = new AdmZip(uploadedPath);
      zip.extractAllTo(dest, true);
      fs.unlinkSync(uploadedPath);
      return res.json({ success: true, dest: path.relative(__dirname, dest), message: 'Bot package extracted.' });
    } catch (e) {
      // not a zip or failed to extract; move file into dest
      const target = path.join(dest, req.file.originalname);
      fs.renameSync(uploadedPath, target);
      return res.json({ success: true, dest: path.relative(__dirname, target), message: 'File uploaded.' });
    }
  } catch (err) {
    console.error('upload processing error', err);
    return res.status(500).json({ error: 'Failed processing upload' });
  }
});

app.listen(PORT, () => {
  console.log(`Mathithibala server running on port ${PORT}`);
});
