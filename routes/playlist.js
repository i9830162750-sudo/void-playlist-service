const router  = require('express').Router();
const ytdlp   = require('../utils/youtube');
const spotify = require('../controllers/spotify');

/**
 * POST /playlist/resolve
 * Body: { url: string }
 *
 * Returns:
 * {
 *   name: string,
 *   source: 'youtube' | 'spotify',
 *   thumbnail: string,
 *   tracks: Track[]
 * }
 *
 * Track shape:
 * {
 *   id, title, artist, album, thumbnail, duration,
 *   source, videoId, searchQuery?
 * }
 */
router.post('/resolve', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const source = detectSource(url);

    if (source === 'youtube') {
      const tracks = await ytdlp.getPlaylistTracks(url);
      return res.json({
        name:      'YouTube Playlist',
        source:    'youtube',
        thumbnail: tracks[0]?.thumbnail || '',
        tracks,
      });
    }

    if (source === 'spotify') {
      const result = await spotify.getPlaylistTracks(url);
      return res.json(result);
    }

    res.status(400).json({ error: 'URL must be a YouTube or Spotify playlist' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /playlist/resolve-track
 * Body: { searchQuery: string }
 *
 * For Spotify tracks that don't have a videoId yet — find the best
 * YouTube match and return the videoId.
 */
router.post('/resolve-track', async (req, res, next) => {
  try {
    const { searchQuery } = req.body;
    if (!searchQuery) return res.status(400).json({ error: 'searchQuery is required' });

    const videoId = await ytdlp.searchYouTube(searchQuery);
    if (!videoId) return res.status(404).json({ error: 'No YouTube match found' });

    res.json({ videoId });
  } catch (err) {
    next(err);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectSource(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/spotify\.com/.test(url))           return 'spotify';
  return 'unknown';
}

module.exports = router;
