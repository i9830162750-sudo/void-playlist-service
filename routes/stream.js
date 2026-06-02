const router = require('express').Router();
const ytdlp  = require('../utils/ytdlp');

/**
 * GET /stream/:videoId
 *
 * Streams audio for a YouTube videoId directly to the client.
 * VOID Player can use this URL as the <audio> src.
 *
 * Query params:
 *   (none currently — format is auto-selected as best audio)
 *
 * Response: chunked audio/webm stream
 */
router.get('/:videoId', (req, res) => {
  const { videoId } = req.params;

  if (!isValidVideoId(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  // Let yt-dlp handle the rest — it pipes directly into res
  ytdlp.streamAudio(videoId, res);
});

/**
 * GET /stream/info/:videoId
 *
 * Returns metadata for a single video without streaming.
 * Useful for getting the canonical title/thumbnail before playback.
 */
router.get('/info/:videoId', async (req, res, next) => {
  try {
    const { videoId } = req.params;
    if (!isValidVideoId(videoId)) {
      return res.status(400).json({ error: 'Invalid videoId' });
    }
    const info = await ytdlp.getVideoInfo(videoId);
    res.json(info);
  } catch (err) {
    next(err);
  }
});

function isValidVideoId(id) {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

module.exports = router;
