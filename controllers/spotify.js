const fetch = require('node-fetch');

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE  = 'https://api.spotify.com/v1';

let _token     = null;
let _expiresAt = 0;

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getToken() {
  if (_token && Date.now() < _expiresAt - 5000) return _token;

  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = await res.json();

  _token     = data.access_token;
  _expiresAt = Date.now() + data.expires_in * 1000;
  return _token;
}

async function apiFetch(path) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify API ${path} → ${res.status}`);
  return res.json();
}

// ── Playlist ─────────────────────────────────────────────────────────────────

/**
 * Extract playlist ID from any Spotify playlist URL.
 */
function extractPlaylistId(url) {
  // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('Invalid Spotify playlist URL');
  return m[1];
}

/**
 * Fetch all tracks from a Spotify playlist.
 * Handles pagination automatically.
 * Returns array of normalized track objects.
 */
async function getPlaylistTracks(url) {
  const playlistId = extractPlaylistId(url);

  // Fetch playlist metadata first for name/cover
  const meta = await apiFetch(`/playlists/${playlistId}?fields=name,images`);

  const tracks = [];
  let endpoint = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,artists,album,duration_ms,external_urls))`;

  while (endpoint) {
    const page = await apiFetch(endpoint);
    for (const { track } of page.items) {
      if (!track || !track.id) continue; // skip null/local tracks
      tracks.push(normalizeSpotifyTrack(track));
    }
    // next is a full URL; strip the base for apiFetch
    if (page.next) {
      endpoint = page.next.replace(API_BASE, '');
    } else {
      endpoint = null;
    }
  }

  return {
    name:      meta.name,
    thumbnail: meta.images?.[0]?.url || '',
    source:    'spotify',
    tracks,
  };
}

function normalizeSpotifyTrack(track) {
  const artist = track.artists?.map(a => a.name).join(', ') || '';
  return {
    id:        track.id,
    title:     track.name,
    artist,
    album:     track.album?.name || '',
    thumbnail: track.album?.images?.[0]?.url || '',
    duration:  Math.round((track.duration_ms || 0) / 1000),
    source:    'spotify',
    videoId:   null,   // resolved later via YouTube search
    searchQuery: `${track.name} ${artist}`,
  };
}

module.exports = { getPlaylistTracks };
