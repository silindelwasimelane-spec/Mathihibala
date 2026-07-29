const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const botsDir = path.join(__dirname, 'bots');
const instances = {}; // Track running bot instances { username: { process, pid, status } }

// Helper: Get user bot working directory
function getUserBotDir(username) {
  return path.join(botsDir, 'instances', username);
}

// Helper: Create session folder with creds.json for a user
function setupUserSession(username, credsJson) {
  const userBotDir = getUserBotDir(username);
  const sessionDir = path.join(userBotDir, 'session');
  const botTemplateDir = path.join(botsDir, 'knightbot');
  
  // Copy bot template to user instance if not already there
  if (!fs.existsSync(userBotDir)) {
    fs.mkdirSync(userBotDir, { recursive: true });
    
    // Copy all bot files from template
    try {
      copyDirRecursive(botTemplateDir, userBotDir);
      console.log(`📋 Bot template copied for ${username}`);
    } catch (e) {
      console.error(`❌ Failed to copy bot template:`, e);
      return false;
    }
  }
  
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  
  // Write creds.json to user's session folder
  try {
    const credsPath = path.join(sessionDir, 'creds.json');
    fs.writeFileSync(credsPath, credsJson);
    console.log(`✅ Creds saved for ${username} at ${credsPath}`);
    return true;
  } catch (e) {
    console.error(`❌ Failed to save creds for ${username}:`, e);
    return false;
  }
}

// Helper: Recursively copy directory
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  
  const files = fs.readdirSync(src);
  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    const stats = fs.statSync(srcPath);
    
    if (stats.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Start a bot instance for a user
async function startBotInstance(username) {
  if (instances[username] && instances[username].process) {
    return { status: 'already-running', message: `Bot already running for ${username}` };
  }

  const userBotDir = getUserBotDir(username);
  if (!fs.existsSync(userBotDir)) {
    return { status: 'error', message: `Bot directory not found for ${username}` };
  }

  try {
    // Start bot process (runs main.js with user-specific working directory)
    const botProcess = spawn('node', ['main.js'], {
      cwd: userBotDir,
      env: { ...process.env, BOT_OWNER_USERNAME: username },
      detached: false
    });

    instances[username] = {
      process: botProcess,
      pid: botProcess.pid,
      status: 'running',
      startedAt: new Date(),
      username
    };

    botProcess.stdout.on('data', (data) => {
      console.log(`[${username}] stdout: ${data}`);
    });

    botProcess.stderr.on('data', (data) => {
      console.error(`[${username}] stderr: ${data}`);
    });

    botProcess.on('close', (code) => {
      console.log(`[${username}] Bot process exited with code ${code}`);
      delete instances[username];
    });

    botProcess.on('error', (err) => {
      console.error(`[${username}] Bot process error:`, err);
      delete instances[username];
    });

    return { status: 'started', message: `Bot started for ${username}`, pid: botProcess.pid };
  } catch (err) {
    console.error(`Failed to start bot for ${username}:`, err);
    return { status: 'error', message: err.message };
  }
}

// Stop a bot instance
function stopBotInstance(username) {
  if (!instances[username]) {
    return { status: 'not-running', message: `Bot not running for ${username}` };
  }

  try {
    const { process } = instances[username];
    process.kill('SIGTERM');
    
    // Give it 5 seconds to gracefully shutdown, then kill hard
    setTimeout(() => {
      if (instances[username]) {
        process.kill('SIGKILL');
        delete instances[username];
      }
    }, 5000);

    return { status: 'stopped', message: `Bot stopped for ${username}` };
  } catch (err) {
    delete instances[username];
    return { status: 'error', message: err.message };
  }
}

// Get bot status for user
function getBotStatus(username) {
  const instance = instances[username];
  if (!instance) {
    return { status: 'stopped', message: `No bot running for ${username}` };
  }

  return {
    status: 'running',
    pid: instance.pid,
    startedAt: instance.startedAt,
    uptime: Math.floor((Date.now() - instance.startedAt.getTime()) / 1000)
  };
}

// Get all running instances
function getAllInstances() {
  const summary = {};
  for (const [username, instance] of Object.entries(instances)) {
    summary[username] = {
      pid: instance.pid,
      startedAt: instance.startedAt,
      uptime: Math.floor((Date.now() - instance.startedAt.getTime()) / 1000)
    };
  }
  return summary;
}

module.exports = {
  startBotInstance,
  stopBotInstance,
  getBotStatus,
  getAllInstances,
  setupUserSession,
  getUserBotDir,
  instances
};
