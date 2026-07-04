require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const playlistRouter = require('./routes/playlist');
const streamRouter   = require('./routes/stream');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.VOID_ORIGIN || '*' }));
app.use(express.json());

app.use('/playlist', playlistRouter);
app.use('/stream',   streamRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'void-handler', ts: Date.now() });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, _next) => {
  console.error('[void-handler error]', err.message || err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`void-handler running on :${PORT}`);
  // Warm up Innertube client on startup
  require('./utils/youtube').getStreamUrl('dQw4w9WgXcQ')
    .then(() => console.log('[youtube] Innertube warmed up'))
    .catch(e => console.warn('[youtube] Warmup failed (non-fatal):', e.message));
});
