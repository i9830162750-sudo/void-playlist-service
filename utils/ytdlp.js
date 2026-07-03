const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const YTDLP_BIN = (() => {
  const local = path.join(__dirname, '../bin/yt-dlp');
  try { fs.accessSync(local, fs.constants.X_OK); return local; }
  catch { return 'yt-dlp'; }
})();

const COOKIES_PATH = path.join(__dirname, '../cookies.txt');
const COOKIES_EXISTS = fs.existsSync(COOKIES_PATH);
console.log('[void-handler] cookies path:', COOKIES_PATH, '| exists:', COOKIES_EXISTS);

const COMMON_FLAGS = [
  '--no-warnings',
  '--no-check-certificates',
  '--extractor-retries', '3',
  '--socket-timeout', '60',
  ...(COOKIES_EXISTS ? ['--cookies', COOKIES_PATH] : []),
];

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
 * Get a direct audio stream URL - for localhost testing
 * List available formats first to debug
 */
async function getStreamUrl(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    console.log(`[yt-dlp] Getting formats for ${videoId}`);
    // First, list all available formats
    const formatList = await run([
      '--no-playlist',
      '--list-formats',
      ...COMMON_FLAGS,
      ytUrl,
    ]);
    console.log(`[yt-dlp] Available formats:\n${formatList}`);
    
    // Now get the URL with no format filter
    console.log(`[yt-dlp] Getting audio URL for ${videoId}`);
    const output = await run([
      '--no-playlist',
      '--get-url',
      ...COMMON_FLAGS,
      ytUrl,
    ]);
    
    const url = output.split('\n')[0].trim();
    if (url && url.startsWith('http')) {
      console.log(`[yt-dlp] ✓ Got stream URL`);
      return { url, mimeType: 'audio/mp4' };
    }
    throw new Error('No valid URL returned');
  } catch (e) {
    console.error(`[yt-dlp] Failed:`, e.message);
    throw e;
  }
}

async function getVideoInfo(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const raw = await run(['--dump-json', '--no-playlist', ...COMMON_FLAGS, ytUrl]);
  return normalizeYTTrack(JSON.parse(raw));
}

async function getPlaylistTracks(url) {
  const raw = await run(['--flat-playlist', '--dump-json', ...COMMON_FLAGS, url]);
  return raw.split('\n').filter(Boolean).map(line => {
    try {
      const e = JSON.parse(line);
      return {
        id: e.id, title: e.title || e.ie_key,
        artist: e.uploader || e.channel || '',
        thumbnail: e.thumbnails?.[0]?.url || e.thumbnail || `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
        duration: e.duration || 0, source: 'youtube', videoId: e.id,
      };
    } catch { return null; }
  }).filter(Boolean);
}

async function searchYouTube(query) {
  const raw = await run([`ytsearch1:${query}`, '--dump-json', '--no-playlist', ...COMMON_FLAGS]);
  if (!raw) return null;
  try { return JSON.parse(raw.split('\n')[0])?.id || null; }
  catch { return null; }
}

/**
 * Stream audio - for localhost testing with format visibility
 */
function streamAudio(videoId, res) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[stream] Starting stream for ${videoId}`);
  
  const proc = spawn(YTDLP_BIN, [
    url,
    '--no-playlist',
    '-f', 'best',
    '-o', '-',
    '--quiet',
    ...COMMON_FLAGS,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let headersSent = false;
  proc.stdout.once('data', () => {
    if (!headersSent) {
      headersSent = true;
      console.log(`[stream] Got data, sending headers`);
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
  });
  proc.stdout.pipe(res);
  proc.stderr.on('data', d => {
    const msg = d.toString();
    console.log(`[yt-dlp stderr] ${msg}`);
  });
  proc.on('error', err => { 
    console.error(`[stream] Process error:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed', detail: err.message }); 
  });
  proc.on('close', code => { 
    console.log(`[stream] Process closed with code ${code}`);
    if (code !== 0 && !res.headersSent) res.status(500).json({ error: `yt-dlp exited ${code}` }); 
  });
  res.on('close', () => {
    console.log(`[stream] Response closed, killing process`);
    proc.kill('SIGTERM');
  });
}

function normalizeYTTrack(info) {
  return {
    id: info.id, title: info.title,
    artist: info.uploader || info.channel || '',
    album: info.album || '',
    thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || '',
    duration: info.duration || 0, source: 'youtube', videoId: info.id,
  };
}

module.exports = { getStreamUrl, getVideoInfo, getPlaylistTracks, searchYouTube, streamAudio };
