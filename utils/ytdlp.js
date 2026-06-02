const { spawn } = require('child_process');
const path = require('path');

// Prefer local binary (deployed on Render), fall back to system PATH
const YTDLP_BIN = path.join(__dirname, '../bin/yt-dlp');

/**
 * Run yt-dlp and collect stdout as a string.
 * @param {string[]} args
 * @returns {Promise<string>}
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
 * Get metadata for a single YouTube video.
 * Returns a clean track object.
 */
async function getVideoInfo(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const raw = await run(['--dump-json', '--no-playlist', '--no-warnings', url]);
  const info = JSON.parse(raw);
  return normalizeYTTrack(info);
}

/**
 * Fetch all tracks from a YouTube playlist (flat, no audio download).
 * Returns array of track objects.
 */
async function getPlaylistTracks(url) {
  const raw = await run([
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    url,
  ]);
  // yt-dlp dumps one JSON object per line for playlists
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const entry = JSON.parse(line);
      return {
        id:        entry.id,
        title:     entry.title || entry.ie_key,
        artist:    entry.uploader || entry.channel || '',
        thumbnail: entry.thumbnails?.[0]?.url || entry.thumbnail || '',
        duration:  entry.duration || 0,
        source:    'youtube',
        videoId:   entry.id,
      };
    });
}

/**
 * Search YouTube for a query and return the first result's videoId.
 */
async function searchYouTube(query) {
  const raw = await run([
    `ytsearch1:${query}`,
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
  ]);
  if (!raw) return null;
  const info = JSON.parse(raw.split('\n')[0]);
  return info?.id || null;
}

/**
 * Pipe yt-dlp audio output directly into an Express response stream.
 * @param {string} videoId
 * @param {import('express').Response} res
 */
function streamAudio(videoId, res) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const proc = spawn(YTDLP_BIN, [
    url,
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    '-o', '-',          // output to stdout
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let headersSent = false;

  // Set headers on first data chunk so we know the stream started
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
    // Only log real errors, not progress lines
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

  // If the client disconnects, kill yt-dlp
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

module.exports = { getVideoInfo, getPlaylistTracks, searchYouTube, streamAudio };
