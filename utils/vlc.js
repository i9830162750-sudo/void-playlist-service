/**
 * utils/vlc.js  (yt-dlp backend — replaces VLC)
 *
 * Resolves a YouTube videoId to a direct audio stream URL using yt-dlp.
 * Drop-in replacement: exports resolveWithVLC() with identical signature.
 *
 * Requirements:
 *   - yt-dlp installed on the server (see Dockerfile)
 */

const { spawn } = require('child_process');

const YTDLP_BIN         = process.env.YTDLP_BIN || 'yt-dlp';
const RESOLVE_TIMEOUT_MS = parseInt(process.env.YTDLP_TIMEOUT_MS || '30000', 10);

// Preferred audio format: best m4a, fallback to best audio
const FORMAT_SELECTOR = 'bestaudio[ext=m4a]/bestaudio';

/**
 * Resolves a YouTube videoId to a direct audio stream URL using yt-dlp.
 *
 * @param {string} videoId  11-char YouTube video ID
 * @returns {Promise<string>} Direct audio stream URL
 */
function resolveWithVLC(videoId) {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[vlc] Resolving stream for ${videoId}`);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(YTDLP_BIN, [
      '--get-url',
      '--format', FORMAT_SELECTOR,
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      ytUrl,
    ]);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`yt-dlp timed out resolving stream for ${videoId}`));
    }, RESOLVE_TIMEOUT_MS);

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        reject(new Error(`yt-dlp not found at '${YTDLP_BIN}'. Is yt-dlp installed?`));
      } else {
        reject(new Error(`yt-dlp process error: ${err.message}`));
      }
    });

    proc.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const url = stdout.trim().split('\n')[0]; // take first URL if multiple
      if (url && url.startsWith('http')) {
        console.log(`[vlc] Resolved stream for ${videoId}: ${url.substring(0, 80)}...`);
        resolve(url);
      } else {
        reject(new Error(
          `yt-dlp exited (code ${code}) without resolving a stream for ${videoId}` +
          (stderr ? `: ${stderr.trim().split('\n').pop()}` : '')
        ));
      }
    });
  });
}

module.exports = { resolveWithVLC };
