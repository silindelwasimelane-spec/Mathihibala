const navButtons = document.querySelectorAll('.nav-item');
const sections = {
  login: document.getElementById('login-panel'),
  dashboard: document.getElementById('dashboard-panel'),
  link: document.getElementById('link-panel'),
  sessions: document.getElementById('sessions-panel'),
  filemanager: document.getElementById('filemanager-panel'),
  'bot-status': document.getElementById('bot-status-panel'),
  'start-bot': document.getElementById('start-bot-panel')
};
const panelTitle = document.getElementById('panel-title');
const linkForm = document.getElementById('link-form');
const pairingResult = document.getElementById('pairing-result');
const codeBox = document.getElementById('code-box');
const sessionsList = document.getElementById('sessions-list');
const fileManagerList = document.getElementById('file-manager-list');
const botStatusList = document.getElementById('bot-status-list');
const startBotList = document.getElementById('start-bot-list');
const linkNewBot = document.getElementById('link-new-bot');
const loginForm = document.getElementById('login-form');
const togglePasswordBtn = document.getElementById('toggle-password');
const passwordInput = document.getElementById('login-password');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authSwitchText = document.getElementById('auth-switch-text');
const logoutButton = document.querySelector('.logout');
const userNameText = document.getElementById('user-name');
const userEmailText = document.getElementById('user-email');

let currentUser = null;

const storageKey = (username) => `waHubSessions_${username}`;
let lastSessionId = null;

const renderPanel = (panel) => {
  const titles = {
    login: 'Login',
    dashboard: 'Dashboard',
    link: 'Link a Bot',
    sessions: 'Sessions',
    filemanager: 'File Management',
    'bot-status': 'Bot Status',
    'start-bot': 'Start Bot'
  };
  panelTitle.textContent = titles[panel] || 'Dashboard';
  Object.keys(sections).forEach((key) => {
    sections[key].classList.toggle('hidden', key !== panel);
  });
  navButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.panel === panel));
};

linkNewBot.addEventListener('click', () => {
  if (!currentUser) {
    renderPanel('login');
    alert('Please sign in first to link a bot.');
    return;
  }
  renderPanel('link');
});

const getStatusLabel = (status) => {
  if (status === 'connected') return 'Connected';
  if (status === 'disconnected') return 'Disconnected';
  if (status === 'pending') return 'Pending';
  if (status === 'paired') return 'Paired';
  return status || 'Unknown';
};

const buildStatusIndicator = (status) => {
  const state = status === 'connected' ? 'connected' : status === 'disconnected' ? 'disconnected' : status === 'pending' ? 'pending' : 'paired';
  return `<span class="status-led ${state}"></span><strong>${getStatusLabel(state)}</strong>`;
};

const loadSessions = async () => {
  if (!currentUser) {
    sessionsList.innerHTML = '<div class="card"><p>Please sign in to see your sessions.</p></div>';
    return;
  }

  let saved = [];
  try {
    const resp = await fetch(`/api/sessions/${encodeURIComponent(currentUser.username)}`);
    if (resp.ok) {
      saved = await resp.json();
      localStorage.setItem(storageKey(currentUser.username), JSON.stringify(saved));
    } else {
      const err = await resp.json();
      console.warn('Failed to load sessions from server:', err.error || resp.statusText);
      saved = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
    }
  } catch (err) {
    console.warn('Unable to reach server for sessions:', err);
    saved = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
  }

  sessionsList.innerHTML = saved.length
    ? saved.map((session) => `
        <div class="session-card">
          <div>
            <h4>${session.name}</h4>
            <p>${session.phone || 'No phone configured'}</p>
            <p style="font-size: 0.85rem; color: #64748b; margin-top: 4px;">Bot: ${session.botName || 'N/A'}</p>
            <p style="font-size: 0.85rem; color: #64748b;">Owner: ${session.botOwnerName || 'N/A'}</p>
            <div class="session-meta">
              ${buildStatusIndicator(session.status)}
              <span>${session.createdAt}</span>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="primary-btn" id="bot-start-${session.id}" onclick="startBot('${currentUser.username}', '${session.id}')">Start Bot</button>
            <button class="" id="bot-stop-${session.id}" onclick="stopBot('${currentUser.username}', '${session.id}')" style="padding:10px 16px; border-radius:12px; background:transparent; border:1px solid rgba(16,56,99,0.08); color:#111111; font-size:0.9rem;">Stop Bot</button>
            <span id="bot-status-${session.id}" style="font-size:0.8rem; color:#334155; text-align:center;">--</span>
          </div>
        </div>
      `).join('')
    : '<div class="card"><p>No sessions yet. Use Link Bot to create your first WhatsApp connection.</p></div>';
  
  // Load bot statuses after rendering
  saved.forEach(session => {
    checkBotStatus(currentUser.username, session.id);
  });
};

window.loadSessions = loadSessions;

const saveSession = async (session) => {
  if (!currentUser) return;
  const sessions = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
  const updated = [session, ...sessions];
  localStorage.setItem(storageKey(currentUser.username), JSON.stringify(updated));
  try {
    await fetch(`/api/sessions/${encodeURIComponent(currentUser.username)}`);
  } catch {
    // Ignore errors: local storage is fallback only
  }
};

const updateProfileDisplay = () => {
  if (!currentUser) {
    userNameText.textContent = 'Not signed in';
    userEmailText.textContent = 'Please log in';
    return;
  }
  userNameText.textContent = currentUser.username;
  userEmailText.textContent = currentUser.email;
};

const signOut = () => {
  localStorage.removeItem('waHubCurrentUser');
  currentUser = null;
  updateProfileDisplay();
  renderPanel('login');
};

let authMode = 'login';

if (togglePasswordBtn && passwordInput) {
  togglePasswordBtn.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    togglePasswordBtn.textContent = isHidden ? 'Hide' : 'Show';
    togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });
}

if (authToggleBtn && authSubmitBtn && authSwitchText) {
  authToggleBtn.addEventListener('click', () => {
    authMode = authMode === 'login' ? 'register' : 'login';
    authSubmitBtn.textContent = authMode === 'login' ? 'Login' : 'Create account';
    authSwitchText.textContent = authMode === 'login' ? 'New here?' : 'Already have an account?';
    authToggleBtn.textContent = authMode === 'login' ? 'Create account' : 'Login instead';
  });
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();

  if (!username || !password) {
    alert('Please enter both username and password.');
    return;
  }

  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || (authMode === 'login' ? 'Login failed' : 'Registration failed'));
    }

    if (authMode === 'register') {
      alert(result.message || 'Account created successfully. You can now log in.');
      authMode = 'login';
      authSubmitBtn.textContent = 'Login';
      authSwitchText.textContent = 'New here?';
      authToggleBtn.textContent = 'Create account';
      return;
    }

    currentUser = {
      username: result.username,
      email: result.email || `${result.username}@example.com`
    };
    localStorage.setItem('waHubCurrentUser', JSON.stringify(currentUser));
    updateProfileDisplay();
    renderPanel('dashboard');
    loadSessions();
    updateDashboardStats();
    alert(result.message || 'Signed in successfully.');
  } catch (err) {
    alert(err.message);
  }
});

logoutButton.addEventListener('click', (event) => {
  event.preventDefault();
  signOut();
});

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUser) {
    alert('Please sign in first.');
    return;
  }

  const phone = document.getElementById('phone-number').value.trim();
  const botOwnerName = document.getElementById('bot-owner-name').value.trim();
  const botName = 'WhatsApp Bot';

  if (!phone) {
    alert('Please enter a phone number.');
    return;
  }

  try {
    const response = await fetch('/api/link-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: currentUser.username, 
        name: botName,
        phone,
        botName,
        botOwnerName
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Unable to generate code.');
    }

    const data = await response.json();
    codeBox.textContent = data.session.pairingCode;
    pairingResult.classList.remove('hidden');
    lastSessionId = data.session.id || data.session.pairingCode;

    // save pending session locally so user can see it
    saveSession(data.session);
    loadSessions();
    // keep user on the pairing panel so they can paste config
  } catch (err) {
    alert(err.message);
  }
});

// Save session config pasted by user and send to server
const saveConfigBtn = document.getElementById('save-config-btn');
const dismissConfigBtn = document.getElementById('dismiss-config-btn');
saveConfigBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  const txt = document.getElementById('session-config').value.trim();
  if (!currentUser) return alert('Please sign in first.');
  if (!txt) return alert('Please paste the session config.');

  try {
    const resp = await fetch('/api/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, sessionId: lastSessionId, config: txt })
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Failed saving config');
    }
    const result = await resp.json();
    // update local sessions store
    const sessions = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
    const idx = sessions.findIndex(s => String(s.id) === String(lastSessionId) || String(s.pairingCode) === String(lastSessionId));
    if (idx !== -1) {
      sessions[idx] = result.session;
      localStorage.setItem(storageKey(currentUser.username), JSON.stringify(sessions));
    }
    alert('Session config saved successfully.');
    pairingResult.classList.add('hidden');
    document.getElementById('session-config').value = '';
    loadSessions();
    renderPanel('sessions');
  } catch (err) {
    alert(err.message);
  }
});

dismissConfigBtn.addEventListener('click', (e) => {
  e.preventDefault();
  pairingResult.classList.add('hidden');
  document.getElementById('session-config').value = '';
});

// Upload bot package (zip)
const botUploadInput = document.getElementById('bot-upload-file');
const botUploadBtn = document.getElementById('bot-upload-btn');
const botBrowseBtn = document.getElementById('bot-browse-btn');
const botUploadFilename = document.getElementById('bot-upload-filename');
const creadFileInput = document.getElementById('cread-file');
const creadBrowseBtn = document.getElementById('cread-browse-btn');
const creadUploadBtn = document.getElementById('cread-upload-btn');
const creadUploadFilename = document.getElementById('cread-upload-filename');

if (botBrowseBtn && botUploadInput) {
  botBrowseBtn.addEventListener('click', () => botUploadInput.click());
}

if (creadBrowseBtn && creadFileInput) {
  creadBrowseBtn.addEventListener('click', () => creadFileInput.click());
}

if (botUploadInput && botUploadFilename) {
  botUploadInput.addEventListener('change', () => {
    botUploadFilename.textContent = botUploadInput.files[0]?.name || 'No file selected';
  });
}

if (creadFileInput && creadUploadFilename) {
  creadFileInput.addEventListener('change', () => {
    creadUploadFilename.textContent = creadFileInput.files[0]?.name || 'No file selected';
  });
}

if (botUploadBtn) {
  botUploadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert('Please sign in first.');
    const file = botUploadInput.files[0];
    if (!file) return alert('Please choose a file.');
    if (!confirm('Upload selected bot package to the server?')) return;
    const sessionKey = lastSessionId || Date.now();
    const fileName = file.name.replace(/\.[^/.]+$/, '');
    const form = new FormData();
    form.append('botFile', file);
    form.append('username', currentUser.username);
    form.append('sessionId', sessionKey);
    form.append('botName', fileName);

    try {
      const resp = await fetch('/api/upload-bot', { method: 'POST', body: form });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Upload failed');
      alert(result.message || 'Upload successful');
      const newSession = {
        id: sessionKey,
        name: fileName,
        phone: '',
        botName: fileName,
        botOwnerName: currentUser.username,
        status: 'paired',
        createdAt: new Date().toLocaleDateString()
      };
      saveSession(newSession);
      loadSessions();
      renderPanel('sessions');
      botUploadInput.value = '';
      loadFileManager();
    } catch (err) {
      alert('Upload error: ' + err.message);
    }
  });
}

if (creadUploadBtn) {
  creadUploadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert('Please sign in first.');
    const file = creadFileInput.files[0];
    const target = document.getElementById('cread-target').value;
    if (!file) return alert('Please choose a credentials file.');
    if (!target) return alert('Please select a target bot folder.');
    if (!confirm('Upload selected credentials to the bot folder?')) return;
    try {
      const form = new FormData();
      form.append('credentials', file);
      form.append('username', currentUser.username);
      form.append('targetFolder', target);
      const resp = await fetch('/api/upload-creds', { method: 'POST', body: form });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || 'Upload failed');
      alert(result.message || 'Credentials uploaded');
      creadFileInput.value = '';
      loadFileManager();
    } catch (err) {
      alert('Upload error: ' + err.message);
    }
  });
}

const setStatusIndicator = (status) => {
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'disconnected';
  if (status === 'pending') return 'pending';
  return 'paired';
};

const formatStatusLabel = (status) => {
  if (status === 'connected') return 'Connected';
  if (status === 'disconnected') return 'Disconnected';
  if (status === 'pending') return 'Connecting';
  return 'Paired';
};

const renderBotStatusPage = async () => {
  if (!currentUser) {
    botStatusList.innerHTML = '<div class="card"><p>Please sign in to see bot status.</p></div>';
    return;
  }

  const sessions = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
  if (!sessions.length) {
    botStatusList.innerHTML = '<div class="card"><p>No sessions available. Add a session from the Link Bot page.</p></div>';
    return;
  }

  const statusCards = sessions.map((session) => {
    const statusClass = setStatusIndicator(session.status);
    const statusLabel = formatStatusLabel(session.status);
    const logs = session.logs || [
      '[System] Awaiting configuration.',
      '[Connection] Disconnected from WhatsApp.',
      '[System] Bot manually stopped.'
    ];

    return `
      <div class="bot-status-card">
        <div class="bot-status-left">
          <div class="status-indicator ${statusClass}">${statusLabel}</div>
          <div class="status-label">${session.botName || session.name}</div>
          <div class="bot-info-row"><span class="bot-info-label">Phone</span><span class="bot-info-value">${session.phone || 'No phone configured'}</span></div>
          <div class="bot-info-row"><span class="bot-info-label">Last seen</span><span class="bot-info-value">${session.createdAt || 'Unknown'}</span></div>
          <div class="bot-info-row"><span class="bot-info-label">Session status</span><span class="bot-info-value">${statusLabel}</span></div>
        </div>
        <div class="bot-status-right">
          <div class="activity-logs">
            <h4>System Logs</h4>
            ${logs.map(log => `<div class="log-entry"><span class="log-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span><span>${log}</span></div>`).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  botStatusList.innerHTML = statusCards;
  sessions.forEach((session) => checkBotStatus(currentUser.username, session.id));
};

const renderStartBotPage = () => {
  if (!currentUser) {
    startBotList.innerHTML = '<div class="card"><p>Please sign in to start bots.</p></div>';
    return;
  }

  const sessions = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
  if (!sessions.length) {
    startBotList.innerHTML = '<div class="card"><p>No sessions available yet. Link a bot to get started.</p></div>';
    return;
  }

  startBotList.innerHTML = sessions.map((session) => {
    const statusText = formatStatusLabel(session.status);
    const statusClass = setStatusIndicator(session.status);
    return `
      <div class="start-bot-card">
        <div class="start-bot-left">
          <div class="bot-name"><h3>${session.botName || session.name}</h3></div>
          <p>${session.phone || 'No phone configured'}</p>
          <div class="status-chip ${statusClass}">${statusText}</div>
        </div>
        <div class="start-bot-actions">
          <button class="primary-btn" onclick="startBot('${currentUser.username}', '${session.id}')">Start Bot</button>
          <button class="secondary-btn" onclick="stopBot('${currentUser.username}', '${session.id}')">Stop Bot</button>
        </div>
      </div>
    `;
  }).join('');

  sessions.forEach((session) => checkBotStatus(currentUser.username, session.id));
};

const loadFileManager = async () => {
  if (!currentUser) {
    fileManagerList.innerHTML = '<div class="card"><p>Please sign in to manage files.</p></div>';
    return;
  }
  try {
    const resp = await fetch('/api/list-bots');
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Unable to load file packages');

    const targetSelect = document.getElementById('cread-target');
    if (targetSelect) {
      targetSelect.innerHTML = '<option value="">Select target bot folder</option>' +
        result.bots.map(bot => `<option value="${bot.id}">${bot.name}</option>`).join('');
    }

    fileManagerList.innerHTML = result.bots.length
      ? result.bots.map(bot => `
          <div class="file-card">
            <div>
              <strong>${bot.name}</strong>
              <div class="file-meta">${bot.type}</div>
            </div>
            <button class="secondary-btn file-delete-btn" onclick="deleteBotFile('${bot.id}')">Delete</button>
          </div>
        `).join('')
      : '<div class="card"><p>No uploaded bot packages found.</p></div>';
  } catch (err) {
    fileManagerList.innerHTML = '<div class="card"><p>No uploaded bot packages found.</p></div>';
  }
};

const updateDashboardStats = async () => {
  const sessions = JSON.parse(localStorage.getItem(storageKey(currentUser.username)) || '[]');
  document.getElementById('sessions-count-value').textContent = sessions.length;
  document.getElementById('active-bots-value').textContent = sessions.filter(s => s.status === 'connected').length;
  document.getElementById('active-bots-meta').textContent = sessions.some(s => s.status === 'connected') ? '● Online' : '● Offline';
  document.getElementById('uptime-value').textContent = sessions.some(s => s.status === 'connected') ? 'Live' : '0m';
  document.getElementById('uptime-meta').textContent = sessions.some(s => s.status === 'connected') ? '↓ This Session' : '↓ Not connected';
  try {
    const resp = await fetch('/api/list-bots');
    const result = await resp.json();
    document.getElementById('files-count-value').textContent = Array.isArray(result.bots) ? result.bots.length : 0;
  } catch {
    document.getElementById('files-count-value').textContent = 0;
  }
};

const updatePanelViews = (panel) => {
  if (panel === 'filemanager') loadFileManager();
  if (panel === 'bot-status') renderBotStatusPage();
  if (panel === 'dashboard') updateDashboardStats();
  if (panel === 'sessions') loadSessions();
  if (panel === 'start-bot') renderStartBotPage();
};

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!currentUser) {
      renderPanel('login');
      alert('Please sign in first to access your dashboard.');
      return;
    }
    renderPanel(button.dataset.panel);
    updatePanelViews(button.dataset.panel);
  });
});
// Bot control functions
window.startBot = async (username, sessionId) => {
  try {
    const resp = await fetch('/api/bot-control/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const result = await resp.json();
    alert(result.message || 'Bot started');
    checkBotStatus(username, sessionId);
  } catch (err) {
    alert('Error starting bot: ' + err.message);
  }
};

window.stopBot = async (username, sessionId) => {
  try {
    const resp = await fetch('/api/bot-control/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const result = await resp.json();
    alert(result.message || 'Bot stopped');
    checkBotStatus(username, sessionId);
  } catch (err) {
    alert('Error stopping bot: ' + err.message);
  }
};

window.deleteBotFile = async (botId) => {
  if (!currentUser) return; 
  if (!confirm('Delete this uploaded bot package?')) return;
  try {
    const resp = await fetch('/api/list-bots/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, botId })
    });
    const result = await resp.json();
    alert(result.message || 'File deleted');
    loadFileManager();
    updateDashboardStats();
  } catch (err) {
    alert('Error deleting file: ' + err.message);
  }
};

window.checkBotStatus = async (username, sessionId) => {
  try {
    const resp = await fetch(`/api/bot-control/status/${username}`);
    const result = await resp.json();
    const statusEl = document.getElementById(`bot-status-${sessionId}`);
    if (statusEl) {
      if (result.status === 'running') {
        statusEl.textContent = `✅ Running (${result.uptime}s uptime)`;
        statusEl.style.color = '#22c55e';
      } else {
        statusEl.textContent = '⚫ Stopped';
        statusEl.style.color = '#64748b';
      }
    }
  } catch (err) {
    console.error('Error checking bot status:', err);
  }
};

const storedUser = JSON.parse(localStorage.getItem('waHubCurrentUser') || 'null');
if (storedUser) {
  currentUser = storedUser;
  updateProfileDisplay();
  renderPanel('dashboard');
  updatePanelViews('dashboard');
} else {
  renderPanel('login');
}
loadSessions();

