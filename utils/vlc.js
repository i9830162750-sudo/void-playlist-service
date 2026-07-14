/**
 * utils/vlc.js
 *
 * YouTube audio stream extraction using VLC's built-in lua scripts.
 * VLC runs headless (dummy interface) and its youtube.lua script resolves
 * the real googlevideo.com stream URL — no yt-dlp, no Innertube.
 *
 * Requirements:
 *   - VLC installed on the server (see render.yaml buildCommand)
 *   - VLC >= 3.x (ships with a maintained youtube.lua by default)
 */

const { spawn }  = require('child_process');

const VLC_BIN     = process.env.VLC_BIN || 'vlc';
const RESOLVE_TIMEOUT_MS = parseInt(process.env.VLC_TIMEOUT_MS || '25000', 10);

// Priority order for audio itags (best → worst)
// 141 = m4a 256k, 251 = opus 160k, 140 = m4a 128k, 250 = opus 70k, 249 = opus 50k, 139 = m4a 48k
const ITAG_RANK = [141, 251, 140, 250, 249, 139];

/**
 * Resolves a YouTube videoId to a direct audio stream URL using VLC.
 *
 * Strategy:
 *   VLC is spawned with --intf dummy and --verbose 2. Its youtube.lua Lua
 *   extension intercepts the YouTube URL, calls the YT API internally, and
 *   fetches the real adaptive stream URLs. These appear in VLC's verbose log
 *   output as the actual googlevideo.com URLs it tries to open.
 *
 *   We parse stderr/stdout for googlevideo.com URLs, score them by itag rank,
 *   and return the best one. VLC is killed as soon as we have a winner.
 *
 * @param {string} videoId  11-char YouTube video ID
 * @returns {Promise<string>} Direct audio stream URL
 */
function resolveWithVLC(videoId) {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`[vlc] Resolving stream for ${videoId}`);

    const vlc = spawn(VLC_BIN, [
      '--intf',        'dummy',       // no GUI
      '--no-video',                   // skip video decoding
      '--no-audio',                   // skip audio output
      '--play-and-exit',              // exit after first item
      '--verbose',     '2',           // verbose enough to log resolved URLs
      '--no-loop',
      '--no-repeat',
      '--http-reconnect',
      '--network-caching', '0',       // don't buffer, just resolve & exit
      ytUrl,
    ], {
      timeout: RESOLVE_TIMEOUT_MS,
    });

    const candidates = new Map(); // itag → url
    let settled = false;
    let timer = null;

    // Collect output from both stdout and stderr — VLC logs to stderr by default
    function onData(chunk) {
      if (settled) return;
      const text = chunk.toString();

      // Match googlevideo.com URLs in VLC's verbose log output
      const urlRegex = /https?:\/\/[^\s"'<>]+googlevideo\.com[^\s"'<>]*/g;
      let match;
      while ((match = urlRegex.exec(text)) !== null) {
        const url = match[0].replace(/[,;)]+$/, ''); // strip trailing punctuation
        const itagMatch = url.match(/[?&]itag=(\d+)/);
        const itag = itagMatch ? parseInt(itagMatch[1], 10) : null;
        const rank = itag !== null ? ITAG_RANK.indexOf(itag) : -1;

        if (rank >= 0) {
          // Known audio itag — store it
          if (!candidates.has(rank)) {
            console.log(`[vlc] Found audio stream itag=${itag} rank=${rank}`);
            candidates.set(rank, url);
          }
        } else if (url.includes('itag=') && !url.includes('mime=video')) {
          // Unknown itag but looks like audio — store as lowest priority fallback
          if (!candidates.has(999)) {
            console.log(`[vlc] Found unknown-itag audio stream as fallback`);
            candidates.set(999, url);
          }
        }

        // Once we have the best possible itag (rank 0 = itag 141), deliver immediately
        if (candidates.has(0)) {
          deliver();
        }
      }

      // Also schedule a flush shortly after any candidate appears
      if (candidates.size > 0 && !timer) {
        timer = setTimeout(deliver, 400);
      }
    }

    function deliver() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      vlc.kill('SIGKILL');

      // Pick best candidate by rank
      const bestRank = [...candidates.keys()].sort((a, b) => a - b)[0];
      if (bestRank === undefined) {
        return reject(new Error(`VLC: no audio stream URL found for ${videoId}`));
      }

      const url = candidates.get(bestRank);
      console.log(`[vlc] Delivering stream (rank=${bestRank}): ${url.substring(0, 80)}...`);
      resolve(url);
    }

    vlc.stdout.on('data', onData);
    vlc.stderr.on('data', onData);

    vlc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Common misconfiguration: VLC not installed
      if (err.code === 'ENOENT') {
        reject(new Error(`VLC not found at '${VLC_BIN}'. Is VLC installed on this server?`));
      } else {
        reject(new Error(`VLC process error: ${err.message}`));
      }
    });

    vlc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      // Process exited — flush whatever we have
      if (candidates.size > 0) {
        deliver();
      } else {
        settled = true;
        reject(new Error(`VLC exited (code ${code}) without resolving a stream for ${videoId}`));
      }
    });

    // Hard timeout — kill VLC and flush candidates (or fail)
    setTimeout(() => {
      if (settled) return;
      console.warn(`[vlc] Timeout hit for ${videoId} — flushing ${candidates.size} candidate(s)`);
      deliver();
    }, RESOLVE_TIMEOUT_MS);
  });
}

module.exports = { resolveWithVLC };
