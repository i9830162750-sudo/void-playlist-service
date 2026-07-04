const { Innertube } = require('youtubei.js');

let _yt = null;

async function getClient() {
  if (!_yt) {
    _yt = await Innertube.create({ cache: new Map(), generate_session_locally: true });
    console.log('[youtube] Innertube client ready');
  }
  return _yt;
}

// Reset client on error so it reinits fresh next call
function resetClient() {
  _yt = null;
}

async function getPlaylistTracks(url) {
  const yt = await getClient();
  const listId = extractPlaylistId(url);
  if (!listId) throw new Error('Could not extract playlist ID from URL');

  console.log(`[youtube] Fetching playlist ${listId}`);
  const playlist = await yt.getPlaylist(listId);

  const tracks = [];
  let page = playlist;
  while (true) {
    for (const v of page.videos || []) {
      if (!v.id) continue;
      tracks.push({
        id:        v.id,
        title:     v.title?.text || 'Unknown',
        artist:    v.author?.name || '',
        album:     '',
        thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
        duration:  v.duration?.seconds || 0,
        source:    'youtube',
        videoId:   v.id,
      });
    }
    if (!page.has_continuation) break;
    page = await page.getContinuation();
  }

  console.log(`[youtube] Playlist resolved: ${tracks.length} tracks`);
  return tracks;
}

async function getVideoInfo(videoId) {
  const yt = await getClient();
  const info = await yt.getBasicInfo(videoId);
  const b = info.basic_info;
  return {
    id:        videoId,
    title:     b.title || 'Unknown',
    artist:    b.author || '',
    album:     '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    duration:  b.duration || 0,
    source:    'youtube',
    videoId,
  };
}

async function streamAudio(videoId, res) {
  console.log(`[stream] Getting stream for ${videoId}`);
  try {
    const yt = await getClient();
    const info = await yt.getInfo(videoId);

    // Pick best audio-only format
    const format = info.chooseFormat({ quality: 'best', type: 'audio' });
    if (!format) throw new Error('No audio format available');

    const streamUrl = format.url || (yt.session.player ? format.decipher(yt.session.player) : null);
    if (!streamUrl || !streamUrl.startsWith('http')) throw new Error('Could not get stream URL');

    console.log(`[stream] Redirecting ${videoId} → ${streamUrl.substring(0, 60)}...`);
    res.redirect(302, streamUrl);
  } catch (e) {
    console.error(`[stream] Failed for ${videoId}:`, e.message);
    resetClient();
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
}

async function getStreamUrl(videoId) {
  const yt = await getClient();
  const info = await yt.getInfo(videoId);
  const format = info.chooseFormat({ quality: 'best', type: 'audio' });
  if (!format) throw new Error('No audio format available');
  // Use streaming URL directly if already deciphered, else decipher
  const url = format.url || (yt.session.player ? format.decipher(yt.session.player) : null);
  if (!url) throw new Error('Could not get stream URL');
  return { url, mimeType: format.mime_type || 'audio/mp4' };
}

async function searchYouTube(query) {
  const yt = await getClient();
  const results = await yt.search(query, { type: 'video' });
  const first = results.videos?.[0];
  return first?.id || null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPlaylistId(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.searchParams.get('list');
  } catch {
    const m = url.match(/[?&]list=([^&]+)/);
    return m ? m[1] : null;
  }
}

module.exports = { getClient, getPlaylistTracks, getVideoInfo, streamAudio, getStreamUrl, searchYouTube };
