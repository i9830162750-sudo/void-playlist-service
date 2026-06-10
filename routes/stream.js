const router = require('express').Router();
const ytdlp  = require('../utils/ytdlp');

/**
 * GET /stream/:videoId
 *
 * Streams audio for a YouTube videoId in m4a format directly to the client.
 * Returns Content-Type: audio/mp4 with m4a audio stream.
 */
router.get('/:videoId', (req, res) => {
  const { videoId } = req.params;
  if (!isValidVideoId(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }
  ytdlp.streamAudio(videoId, res);
});

/**
 * GET /stream/info/:videoId
 *
 * Returns { url, mimeType } — a direct playable m4a audio URL.
 * mimeType will be 'audio/mp4' for m4a format streams.
 * The main VOID server calls this and forwards the URL to the client.
 */
router.get('/info/:videoId', async (req, res, next) => {
  try {
    const { videoId } = req.params;
    if (!isValidVideoId(videoId)) {
      return res.status(400).json({ error: 'Invalid videoId' });
    }
    const result = await ytdlp.getStreamUrl(videoId);
    res.json(result);
  } catch (err) {
    console.error('[stream/info]', err.message);
    next(err);
  }
});

function isValidVideoId(id) {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

module.exports = router;
