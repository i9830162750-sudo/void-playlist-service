const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Prefer local binary (deployed on Render), fall back to system PATH
const YTDLP_BIN = (() => {
  const local = path.join(__dirname, '../bin/yt-dlp');
  try { fs.accessSync(local, fs.constants.X_OK); return local; }
  catch { return 'yt-dlp'; }
})();

const COOKIES_PATH = path.join(__dirname, '../cookies.txt');

// Common flags to reduce bot-detection and speed up requests
const COMMON_FLAGS = [
  '--no-warnings',
  '--no-check-certificates',
  '--extractor-retries', '3',
  '--socket-timeout', '15',
  '--extractor-args', 'youtube:player_client=ios,web',
  ...(fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : []),
];

/**
 * Run yt-dlp and collect stdout as a string.
 */
function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || `yt-dlp exited ${code}`));
      resolve(out.trim());
    });
    proc.on('error', reject);
  });
}

/**
 * Get a direct audio stream URL for a YouTube video (fast — just URL extraction).
 * Returns { url, mimeType } — the shape the main VOID server expects.
 */
async function getStreamUrl(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const url = await run([
    '-g',
    '--no-playlist',
    ...COMMON_FLAGS,
    ytUrl,
  ]);
  if (!url) throw new Error('yt-dlp returned empty URL');
  const mimeType = url.includes('.m4a') || url.includes('mime=audio%2Fmp4')
    ? 'audio/mp4'
    : 'audio/webm';
  return { url, mimeType };
}

/**
 * Get metadata for a single YouTube video.
 */
async function getVideoInfo(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const raw = await run(['--dump-json', '--no-playlist', ...COMMON_FLAGS, ytUrl]);
  const info = JSON.parse(raw);
  return normalizeYTTrack(info);
}

/**
 * Fetch all tracks from a YouTube playlist (flat, no download).
 */
async function getPlaylistTracks(url) {
  const raw = await run([
    '--flat-playlist',
    '--dump-json',
    ...COMMON_FLAGS,
    url,
  ]);
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        const entry = JSON.parse(line);
        return {
          id:        entry.id,
          title:     entry.title || entry.ie_key,
          artist:    entry.uploader || entry.channel || '',
          thumbnail: entry.thumbnails?.[0]?.url || entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
          duration:  entry.duration || 0,
          source:    'youtube',
          videoId:   entry.id,
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Search YouTube for a query and return the first result's videoId.
 */
async function searchYouTube(query) {
  const raw = await run([
    `ytsearch1:${query}`,
    '--dump-json',
    '--no-playlist',
    ...COMMON_FLAGS,
  ]);
  if (!raw) return null;
  try {
    const info = JSON.parse(raw.split('\n')[0]);
    return info?.id || null;
  } catch { return null; }
}

/**
 * Pipe yt-dlp audio output directly into an Express response stream.
 */
function streamAudio(videoId, res) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const proc = spawn(YTDLP_BIN, [
    url,
    '--no-playlist',
    '-o', '-',
    '--quiet',
    ...COMMON_FLAGS,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let headersSent = false;

  proc.stdout.once('data', () => {
    if (!headersSent) {
      headersSent = true;
      res.setHeader('Content-Type', 'audio/webm');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Video-Id', videoId);
    }
  });

  proc.stdout.pipe(res);

  proc.stderr.on('data', d => {
    const msg = d.toString();
    if (!msg.startsWith('[download]') && !msg.startsWith('[info]')) {
      console.error('[yt-dlp stderr]', msg.trim());
    }
  });

  proc.on('error', err => {
    console.error('[yt-dlp spawn error]', err);
    if (!headersSent && !res.headersSent) {
      res.status(500).json({ error: 'yt-dlp failed to start' });
    }
  });

  proc.on('close', code => {
    if (code !== 0 && !headersSent && !res.headersSent) {
      res.status(500).json({ error: `yt-dlp exited with code ${code}` });
    }
  });

  res.on('close', () => proc.kill('SIGTERM'));
}

function normalizeYTTrack(info) {
  return {
    id:        info.id,
    title:     info.title,
    artist:    info.uploader || info.channel || '',
    album:     info.album || '',
    thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || '',
    duration:  info.duration || 0,
    source:    'youtube',
    videoId:   info.id,
  };
}

module.exports = { getStreamUrl, getVideoInfo, getPlaylistTracks, searchYouTube, streamAudio };
