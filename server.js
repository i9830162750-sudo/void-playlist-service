require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { execFile } = require('child_process');

const playlistRouter = require('./routes/playlist');
const streamRouter   = require('./routes/stream');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.VOID_ORIGIN || '*' }));
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/playlist', playlistRouter);
app.use('/stream',   streamRouter);

app.get('/health', (req, res) => {
  const binPath = path.join(__dirname, 'bin/yt-dlp');
  const binExists = fs.existsSync(binPath);
  res.json({ ok: true, service: 'void-handler', ts: Date.now(), ytdlp: binExists });
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error ─────────────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[void-handler error]', err.message || err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`void-handler running on :${PORT}`);

  // Verify yt-dlp binary exists and is executable
  const binPath = path.join(__dirname, 'bin/yt-dlp');
  if (!fs.existsSync(binPath)) {
    console.error('[void-handler] WARNING: bin/yt-dlp not found! Run: npm run setup');
  } else {
    // Log yt-dlp version on startup for debugging
    execFile(binPath, ['--version'], (err, stdout) => {
      if (err) console.error('[void-handler] yt-dlp version check failed:', err.message);
      else console.log('[void-handler] yt-dlp version:', stdout.trim());
    });
    // Auto-update yt-dlp to avoid bot detection from stale versions
    execFile(binPath, ['-U'], (err, stdout, stderr) => {
      if (err) console.warn('[void-handler] yt-dlp update skipped:', stderr?.trim() || err.message);
      else console.log('[void-handler] yt-dlp update:', stdout.trim() || 'already up to date');
    });
  }
});
