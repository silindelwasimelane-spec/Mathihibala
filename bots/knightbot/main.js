const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useSingleFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@adiwajshing/baileys');

const sessionDir = path.join(__dirname, 'session');
const authFile = path.join(sessionDir, 'creds.json');

if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

const { state, saveState } = useSingleFileAuthState(authFile);

async function startBot() {
  try {
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveState);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log('✅ WhatsApp connection established');
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
        console.log('⚠️ WhatsApp connection closed', reason || lastDisconnect?.error);

        if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
          console.error('❌ Auth state is no longer valid. Remove creds.json and re-link your session.');
        }
      }
    });

    sock.ev.on('messages.upsert', async (messages) => {
      if (messages.type !== 'notify') return;
      const message = messages.messages?.[0];
      if (!message || message.key.fromMe) return;
      if (!message.message) return;

      const sender = message.key.remoteJid;
      const text =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        message.message.imageMessage?.caption ||
        '';

      if (!text) return;

      const trimmed = text.trim();
      const lowercase = trimmed.toLowerCase();
      let reply = null;

      if (lowercase === '!help') {
        reply = 'Mathithibala bot commands:\n!help - show this help text\n!ping - reply pong\n!echo <text> - repeat your text';
      } else if (lowercase === '!ping') {
        reply = 'pong';
      } else if (lowercase.startsWith('!echo ')) {
        reply = trimmed.slice(6).trim() || 'Please provide text after !echo';
      } else if (trimmed.startsWith('!')) {
        reply = `Unknown command: ${trimmed}. Send !help for valid commands.`;
      }

      if (reply) {
        try {
          await sock.sendMessage(sender, { text: reply });
          console.log(`↩️ Replied to ${sender}: ${reply}`);
        } catch (err) {
          console.error('Failed to send message reply:', err);
        }
      }
    });

    console.log('🚀 Mathithibala WhatsApp bot ready');
  } catch (error) {
    console.error('Failed to start WhatsApp bot:', error);
    process.exit(1);
  }
}

startBot();
