# void-handler

Standalone microservice for VOID Player — resolves YouTube & Spotify playlists into track lists and streams audio via yt-dlp.

## Endpoints

### `GET /health`
Returns `{ ok: true }`. Use this as the Render health check.

---

### `POST /playlist/resolve`
Resolve a YouTube or Spotify playlist URL into a list of tracks.

**Body:**
```json
{ "url": "https://open.spotify.com/playlist/..." }
```

**Response:**
```json
{
  "name": "My Playlist",
  "source": "spotify",
  "thumbnail": "https://...",
  "tracks": [
    {
      "id": "spotify_track_id",
      "title": "Song Name",
      "artist": "Artist Name",
      "album": "Album Name",
      "thumbnail": "https://...",
      "duration": 214,
      "source": "spotify",
      "videoId": null,
      "searchQuery": "Song Name Artist Name"
    }
  ]
}
```

For **Spotify tracks**, `videoId` is `null` — call `/playlist/resolve-track` to find the YouTube match before streaming.

---

### `POST /playlist/resolve-track`
Find the best YouTube video for a Spotify track.

**Body:**
```json
{ "searchQuery": "Song Name Artist Name" }
```

**Response:**
```json
{ "videoId": "dQw4w9WgXcQ" }
```

---

### `GET /stream/:videoId`
Stream audio for a YouTube video ID. Pipe this directly into an `<audio>` element or Web Audio API.

```
GET https://void-handler.onrender.com/stream/dQw4w9WgXcQ
```

Returns a chunked `audio/webm` stream.

---

### `GET /stream/info/:videoId`
Get metadata for a single video (no audio download).

**Response:**
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "...",
  "artist": "...",
  "thumbnail": "...",
  "duration": 212
}
```

---

## Setup

### Local
```bash
cp .env.example .env
# fill in Spotify credentials
npm install
npm run setup   # downloads yt-dlp binary to ./bin/
npm run dev
```

### Render
1. Push to GitHub
2. New Web Service → connect repo
3. Render will detect `render.yaml` automatically
4. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in the Render dashboard

---

## VOID Player Integration

In VOID's frontend, replace the current streaming URL with:

```js
const HANDLER_URL = 'https://void-handler.onrender.com';

// 1. Resolve a playlist
const { tracks } = await fetch(`${HANDLER_URL}/playlist/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: playlistUrl }),
}).then(r => r.json());

// 2. For Spotify tracks, resolve videoId lazily before playback
if (track.source === 'spotify' && !track.videoId) {
  const { videoId } = await fetch(`${HANDLER_URL}/playlist/resolve-track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchQuery: track.searchQuery }),
  }).then(r => r.json());
  track.videoId = videoId;
}

// 3. Stream
audio.src = `${HANDLER_URL}/stream/${track.videoId}`;
audio.play();
```

---

## Notes

- yt-dlp binary is downloaded to `./bin/yt-dlp` at build time. On Render, the `npm run setup` build command handles this.
- Spotify's API requires a free app registered at [developer.spotify.com](https://developer.spotify.com/dashboard) — client credentials flow works for any public playlist without user login.
- YouTube rate-limiting: Render's IPs can hit quota limits for heavy use. If this becomes an issue, consider routing through a residential proxy or adding cookie auth to yt-dlp.
