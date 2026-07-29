// main server implementation continues below
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { Pool } = require('pg');
const app = express();
const { startBotInstance, stopBotInstance, getBotStatus, setupUserSession } = require('./bot-manager');

const PORT = process.env.PORT || 3000;

function getWhatsAppConfig() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiUrl = process.env.WHATSAPP_API_URL || (phoneNumberId ? `https://graph.facebook.com/v17.0/${phoneNumberId}/messages` : undefined);
  return { token, phoneNumberId, apiUrl };
}

function sanitizePhoneNumber(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sendWhatsAppMessage(phone, message) {
  const { token, apiUrl } = getWhatsAppConfig();
  if (!token || !apiUrl) {
    return Promise.resolve({ success: false, message: 'WhatsApp API not configured.' });
  }

  const to = sanitizePhoneNumber(phone);
  if (!to) {
    return Promise.resolve({ success: false, message: 'Invalid phone number.' });
  }

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message }
  });

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let responseText = '';
        res.on('data', (chunk) => { responseText += chunk; });
        res.on('end', () => {
          const payload = safeJsonParse(responseText);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode, payload });
          } else {
            resolve({ success: false, statusCode: res.statusCode, payload });
          }
        });
      }
    );

    request.on('error', (err) => reject(err));
    request.write(body);
    request.end();
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, databaseConfigured: Boolean(process.env.DATABASE_URL) });
});

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const usersFile = path.join(dataDir, 'users.json');
const authSessionsFile = path.join(dataDir, 'auth-sessions.json');

function loadJsonFile(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8') || JSON.stringify(fallback));
    }
  } catch (e) {
    console.error('read json error', e);
  }
  return fallback;
}

function saveJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('write json error', e);
  }
}

function sanitizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
}

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;
let dbReady = false;

async function initializeDatabase() {
  if (!pool) {
    dbReady = true;
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      bot_name TEXT,
      bot_owner_name TEXT,
      bot_owner_number TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      pairing_code TEXT,
      config TEXT
    )
  `);
  dbReady = true;
}

async function loadUsers() {
  if (pool && dbReady) {
    const result = await pool.query('SELECT username, password, email FROM users ORDER BY username');
    return Object.fromEntries(result.rows.map((row) => [sanitizeName(row.username), {
      password: row.password,
      email: row.email || `${sanitizeName(row.username)}@example.com`
    }]));
  }
  return loadJsonFile(usersFile, {});
}

async function saveUsers(users) {
  if (pool && dbReady) {
    const entries = Object.entries(users || {});
    if (!entries.length) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [username, entry] of entries) {
        await client.query(
          `INSERT INTO users(username, password, email) VALUES ($1, $2, $3)
           ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, email = EXCLUDED.email`,
          [sanitizeName(username), entry.password || '', entry.email || '']
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  saveJsonFile(usersFile, users);
}

async function isUserRegistered(username) {
  const safeUsername = sanitizeName(username);
  if (!safeUsername) return false;
  const users = await loadUsers();
  return Boolean(users[safeUsername]);
}

function userSessionsPath(username) {
  const safeUsername = sanitizeName(username || 'anonymous');
  return path.join(dataDir, `sessions_${safeUsername}.json`);
}

// file upload helpers
const multer = require('multer');
const AdmZip = require('adm-zip');
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

async function loadAuthSessions() {
  if (pool && dbReady) {
    const result = await pool.query('SELECT token, username, created_at, expires_at FROM auth_sessions');
    return Object.fromEntries(result.rows.map((row) => [row.token, {
      username: row.username,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : new Date().toISOString()
    }]));
  }
  return loadJsonFile(authSessionsFile, {});
}

async function saveAuthSessions(sessions) {
  if (pool && dbReady) {
    const entries = Object.entries(sessions || {});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM auth_sessions');
      for (const [token, session] of entries) {
        await client.query(
          'INSERT INTO auth_sessions(token, username, created_at, expires_at) VALUES ($1, $2, $3, $4)',
          [token, session.username, session.createdAt || new Date().toISOString(), session.expiresAt || new Date().toISOString()]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  saveJsonFile(authSessionsFile, sessions);
}

async function createAuthSession(username) {
  const safeUsername = sanitizeName(username);
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = await loadAuthSessions();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  sessions[token] = {
    username: safeUsername,
    createdAt: new Date().toISOString(),
    expiresAt
  };
  await saveAuthSessions(sessions);
  return { token, username: safeUsername, expiresAt };
}

async function getAuthSession(token) {
  if (!token) return null;
  const sessions = await loadAuthSessions();
  const session = sessions[token];
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    delete sessions[token];
    await saveAuthSessions(sessions);
    return null;
  }

  return session;
}

async function removeAuthSession(token) {
  if (!token) return null;
  const sessions = await loadAuthSessions();
  if (!sessions[token]) return null;
  delete sessions[token];
  await saveAuthSessions(sessions);
  return true;
}

async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').startsWith('Bearer ') ? (req.headers.authorization || '').slice(7).trim() : '';
  const session = await getAuthSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Please log in again.' });
  }

  req.user = session.username;
  next();
}

async function loadUserSessions(username) {
  const safeUsername = sanitizeName(username);
  if (pool && dbReady) {
    const result = await pool.query(
      `SELECT id, name, phone, bot_name, bot_owner_name, bot_owner_number, status, created_at, pairing_code, config
       FROM user_sessions WHERE username = $1 ORDER BY created_at DESC`,
      [safeUsername]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      botName: row.bot_name,
      botOwnerName: row.bot_owner_name,
      botOwnerNumber: row.bot_owner_number,
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      pairingCode: row.pairing_code,
      config: row.config
    }));
  }

  const file = userSessionsPath(safeUsername);
  let sessions = [];
  try {
    if (fs.existsSync(file)) sessions = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    console.error('read sessions error', e);
  }
  return sessions;
}

async function saveUserSession(username, session) {
  const safeUsername = sanitizeName(username);
  const normalizedSession = {
    id: String(session.id || Date.now()),
    name: session.name || 'New Bot',
    phone: session.phone || '',
    botName: session.botName || 'Bot',
    botOwnerName: session.botOwnerName || '',
    botOwnerNumber: session.botOwnerNumber || session.phone || '',
    status: session.status || 'pending',
    createdAt: session.createdAt || new Date().toISOString(),
    pairingCode: session.pairingCode ? String(session.pairingCode) : null,
    config: session.config ?? null
  };

  if (pool && dbReady) {
    await pool.query(
      `INSERT INTO user_sessions(id, username, name, phone, bot_name, bot_owner_name, bot_owner_number, status, created_at, pairing_code, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         bot_name = EXCLUDED.bot_name,
         bot_owner_name = EXCLUDED.bot_owner_name,
         bot_owner_number = EXCLUDED.bot_owner_number,
         status = EXCLUDED.status,
         pairing_code = EXCLUDED.pairing_code,
         config = EXCLUDED.config`,
      [normalizedSession.id, safeUsername, normalizedSession.name, normalizedSession.phone, normalizedSession.botName, normalizedSession.botOwnerName, normalizedSession.botOwnerNumber, normalizedSession.status, normalizedSession.createdAt, normalizedSession.pairingCode, normalizedSession.config]
    );
    return normalizedSession;
  }

  const file = userSessionsPath(safeUsername);
  let sessions = [];
  try {
    if (fs.existsSync(file)) sessions = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    console.error('read sessions error', e);
  }
  sessions.unshift(normalizedSession);
  fs.writeFileSync(file, JSON.stringify(sessions, null, 2));
  return normalizedSession;
}

async function updateUserSession(username, sessionId, updates) {
  const safeUsername = sanitizeName(username);
  const safeSessionId = String(sessionId);
  if (pool && dbReady) {
    const fields = [];
    const values = [];
    const allowedKeys = ['name', 'phone', 'bot_name', 'bot_owner_name', 'bot_owner_number', 'status', 'pairing_code', 'config'];
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (allowedKeys.includes(key)) {
        fields.push(`${key} = $${fields.length + 2}`);
        values.push(value);
      }
    });
    if (!fields.length) return null;
    values.unshift(safeUsername, safeSessionId);
    const result = await pool.query(`UPDATE user_sessions SET ${fields.join(', ')} WHERE username = $1 AND id = $2`, values);
    return result.rowCount > 0;
  }

  const file = userSessionsPath(safeUsername);
  let sessions = [];
  try {
    if (fs.existsSync(file)) sessions = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    console.error('read sessions error', e);
    return false;
  }

  const idx = sessions.findIndex((s) => String(s.id) === safeSessionId || String(s.pairingCode) === safeSessionId);
  if (idx === -1) return false;

  Object.entries(updates || {}).forEach(([key, value]) => {
    const mappedKey = key === 'bot_name' ? 'botName' : key === 'bot_owner_name' ? 'botOwnerName' : key === 'bot_owner_number' ? 'botOwnerNumber' : key === 'pairing_code' ? 'pairingCode' : key;
    sessions[idx][mappedKey] = value;
  });
  fs.writeFileSync(file, JSON.stringify(sessions, null, 2));
  return true;
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const safeUsername = sanitizeName(username);
  if (!safeUsername) {
    return res.status(400).json({ error: 'Invalid username.' });
  }

  const users = await loadUsers();
  if (!users[safeUsername]) {
    return res.status(401).json({ error: 'User not found. Please create an account first.' });
  }

  if (users[safeUsername].password !== password) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const session = await createAuthSession(safeUsername);
  return res.json({
    username: safeUsername,
    email: users[safeUsername].email || `${safeUsername}@example.com`,
    token: session.token,
    expiresAt: session.expiresAt,
    message: 'Signed in successfully.'
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const safeUsername = sanitizeName(username);
  if (!safeUsername) {
    return res.status(400).json({ error: 'Invalid username.' });
  }

  const users = await loadUsers();
  if (users[safeUsername]) {
    return res.status(409).json({ error: 'Username already exists. Please log in instead.' });
  }

  users[safeUsername] = { password, email: `${safeUsername}@example.com` };
  await saveUsers(users);

  const session = await createAuthSession(safeUsername);
  return res.json({
    username: safeUsername,
    email: `${safeUsername}@example.com`,
    token: session.token,
    expiresAt: session.expiresAt,
    message: 'Account created successfully. You are now signed in.'
  });
});

app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = await getAuthSession(token);

  if (!session) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  return res.json({
    username: session.username,
    email: `${session.username}@example.com`
  });
});

app.post('/api/auth/logout', async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'Session token is required.' });
  }

  const removed = await removeAuthSession(token);
  if (!removed) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  return res.json({ message: 'Signed out successfully.' });
});

app.post('/api/link-session', requireAuth, async (req, res) => {
  const { phone, name, botName, botOwnerName } = req.body;
  const username = req.user;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const code = Math.floor(10000000 + Math.random() * 90000000).toString();
  const session = {
    id: String(Date.now()),
    name: name || 'New Bot',
    phone,
    botName: botName || 'Bot',
    botOwnerName: botOwnerName || '',
    botOwnerNumber: phone,
    status: 'pending',
    createdAt: new Date().toISOString(),
    pairingCode: code,
    config: null
  };

  if (username) {
    try {
      await saveUserSession(username, session);
    } catch (error) {
      console.error('save user session error', error);
      return res.status(500).json({ error: 'Failed to save session.' });
    }
  }

  // Send pairing notification if a WhatsApp API provider is configured.
  const notifyText = `Your WhatsApp pairing code is ${code}. Open WhatsApp → Linked Devices and enter this code to pair.`;
  sendWhatsAppMessage(phone, notifyText)
    .then((notifyResult) => {
      if (!notifyResult.success) {
        console.warn('WhatsApp notify failed:', notifyResult);
      } else {
        console.log('WhatsApp pairing notification sent:', notifyResult.payload);
      }
    })
    .catch((err) => {
      console.error('WhatsApp notify error:', err);
    });

  res.json({ session, message: 'Pairing code generated successfully.' });
});

app.get('/api/sessions/:username', requireAuth, async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (sanitizeName(username) !== sanitizeName(req.user)) {
    return res.status(403).json({ error: 'You can only view your own sessions.' });
  }

  try {
    const sessions = await loadUserSessions(username);
    return res.json(sessions);
  } catch (error) {
    console.error('read sessions error', error);
    return res.status(500).json({ error: 'Failed reading sessions' });
  }
});

app.post('/api/save-config', requireAuth, async (req, res) => {
  const { username, sessionId, config } = req.body;
  if (!username || !sessionId || !config) return res.status(400).json({ error: 'username, sessionId and config are required.' });
  if (sanitizeName(username) !== sanitizeName(req.user)) {
    return res.status(403).json({ error: 'You can only save your own session config.' });
  }

  try {
    const updated = await updateUserSession(username, sessionId, { status: 'paired', config });
    if (!updated) {
      return res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error('write sessions error', error);
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

  const sessions = await loadUserSessions(username);
  const session = sessions.find((item) => String(item.id) === String(sessionId) || String(item.pairingCode) === String(sessionId));
  return res.json({ session, message: 'Session config saved and bot started.' });
});

// Bot can fetch its settings by sessionId/phone
app.get('/api/get-session-settings/:username/:sessionId', requireAuth, async (req, res) => {
  const { username, sessionId } = req.params;
  if (sanitizeName(username) !== sanitizeName(req.user)) {
    return res.status(403).json({ error: 'You can only view your own session settings.' });
  }
  if (!username || !sessionId) {
    return res.status(400).json({ error: 'username and sessionId required.' });
  }

  try {
    const sessions = await loadUserSessions(username);
    const session = sessions.find((item) => String(item.id) === String(sessionId) || String(item.phone) === String(sessionId) || String(item.pairingCode) === String(sessionId));
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
  } catch (error) {
    console.error('read sessions error', error);
    return res.status(500).json({ error: 'Failed reading sessions' });
  }
});

// Bot controls: start
app.post('/api/bot-control/start', requireAuth, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (sanitizeName(username) !== sanitizeName(req.user)) {
    return res.status(403).json({ error: 'You can only control your own bot.' });
  }

  const result = await startBotInstance(username);
  res.json(result);
});

// Bot controls: stop
app.post('/api/bot-control/stop', requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (sanitizeName(username) !== sanitizeName(req.user)) {
    return res.status(403).json({ error: 'You can only control your own bot.' });
  }

  const result = stopBotInstance(username);
  res.json(result);
});

// Bot controls: status
app.get('/api/bot-control/status/:username', requireAuth, (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (sanitizeName(username) !== sanitizeName(req.user)) {
    return res.status(403).json({ error: 'You can only view your own bot status.' });
  }

  const result = getBotStatus(username);
  res.json(result);
});

// List uploaded bot folders
app.get('/api/list-bots', (req, res) => {
  const botsDir = path.join(__dirname, 'bots');
  if (!fs.existsSync(botsDir)) return res.json({ bots: [] });
  try {
    const items = fs.readdirSync(botsDir, { withFileTypes: true });
    const bots = items.filter((item) => item.isDirectory()).map((item) => ({ id: item.name, name: item.name, type: 'bot folder' }));
    return res.json({ bots });
  } catch (err) {
    console.error('list bots error', err);
    return res.status(500).json({ error: 'Unable to list bots' });
  }
});

app.post('/api/upload-creds', requireAuth, upload.single('credentials'), (req, res) => {
  const { targetFolder } = req.body;
  const username = req.user;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!targetFolder) return res.status(400).json({ error: 'targetFolder required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field name "credentials".' });

  const targetDir = path.join(__dirname, 'bots', sanitizeName(targetFolder));
  if (!fs.existsSync(targetDir)) return res.status(404).json({ error: 'Target bot folder not found.' });

  const sessionDir = path.join(targetDir, 'session');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const destPath = path.join(sessionDir, 'creds.json');
  try {
    fs.renameSync(req.file.path, destPath);
    return res.json({ success: true, message: 'Credentials uploaded to bot folder.' });
  } catch (err) {
    console.error('upload creds error', err);
    return res.status(500).json({ error: 'Failed saving credentials' });
  }
});

app.post('/api/list-bots/delete', express.json(), (req, res) => {
  const { username, botId } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!botId) return res.status(400).json({ error: 'botId required' });

  const targetDir = path.join(__dirname, 'bots', sanitizeName(botId));
  if (!fs.existsSync(targetDir)) return res.status(404).json({ error: 'Bot folder not found.' });

  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return res.json({ success: true, message: 'Bot folder deleted.' });
  } catch (err) {
    console.error('delete bot folder error', err);
    return res.status(500).json({ error: 'Failed deleting bot folder.' });
  }
});

// Manual bot upload endpoint - accepts a zip or folder archive
app.post('/api/upload-bot', requireAuth, upload.single('botFile'), (req, res) => {
  const { sessionId, botName } = req.body;
  const username = req.user;
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

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Mathithibala server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
}

startServer();
