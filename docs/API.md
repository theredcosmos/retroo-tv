# API reference

Base URL: same origin (`/api`). JSON everywhere. Errors are `application/problem+json` (RFC 7807).
Live OpenAPI spec in dev: `GET /v3/api-docs`, UI at `/swagger-ui.html`.

## Catalog

### `GET /api/decades`
`200` · `Cache-Control: max-age=300, public`
```json
[
  { "slug": "60s", "label": "60s", "songCount": 9, "ytMusicUrl": "https://music.youtube.com/search?q=60s%20hits" },
  { "slug": "now", "label": "Now", "songCount": 9, "ytMusicUrl": "https://music.youtube.com/search?q=top%20hits%20this%20year" }
]
```

### `GET /api/songs?decade={slug}`
`200` songs ordered by release year. `400` unknown decade.

### `GET /api/songs/random?decade={slug}&lang={hi|en?}&exclude={id,id,…?}`
`lang` picks Bollywood (`hi`) or Hollywood (`en`) — the client rotates `hi, hi, en` for the 2:1 ratio. `exclude` is a
comma-separated list (max 20) of recently played video ids. If nothing matches, the server relaxes in this order:
drop `exclude`, then drop `lang`. `400` for an unknown `lang`.
`200` · `Cache-Control: no-store`
```json
{ "id": 29, "videoId": "hTWKbfoikeg", "title": "Smells Like Teen Spirit", "artist": "Nirvana",
  "decade": "90s", "lang": "en", "releaseYear": 1991, "thumbnailUrl": "https://i.ytimg.com/vi/hTWKbfoikeg/hqdefault.jpg" }
```
`404` decade has no songs · `400` unknown decade.

## Shared playlists

### `GET /api/playlists?page=0&size=30`
`size` is clamped to 1–50.
```json
{ "content": [ { "id": 3, "displayName": "Avanti", "playlistUrl": "https://music.youtube.com/playlist?list=PL123",
                 "playlistName": "Energetic songs", "note": "I listen to this when I feel low",
                 "createdAt": "2026-11-12T10:00:00Z" } ],
  "page": 0, "size": 30, "totalElements": 1, "last": true }
```

### `POST /api/playlists`
```json
{ "displayName": "Avanti", "playlistUrl": "https://www.youtube.com/playlist?list=PL123&si=x",
  "playlistName": "Energetic songs", "note": "optional, ≤140 chars" }
```
| Status | When |
|---|---|
| `201` | created — body is the stored entry (URL canonicalised to music.youtube.com, whitespace normalised) |
| `400` | validation (`errors` map) or not a YouTube playlist link |
| `409` | same playlist already shared under the same name |
| `429` | more than 3 shares per IP in 10 minutes — `Retry-After` header in seconds |

Example 400:
```json
{ "type": "about:blank", "title": "Validation failed", "status": 400,
  "detail": "One or more fields are invalid.", "instance": "/api/playlists",
  "errors": { "displayName": "is required" } }
```

## Stats

### `GET /api/stats`
```json
{ "listeners": 3, "songs": 71, "playlists": 12 }
```

## Admin (header `X-Admin-Key`)

### `POST /api/admin/songs`
```json
{ "video": "https://youtu.be/dQw4w9WgXcQ", "decade": "80s", "title": null, "artist": null, "releaseYear": 1987 }
```
`video` may be an id, watch URL, youtu.be or shorts link. Missing title/artist are fetched from YouTube oEmbed.
`201` song · `400` bad id/decade or oEmbed lookup failed · `401` wrong key · `403` admin API disabled · `409` exists.

### `DELETE /api/admin/songs/{id}`
`204` · `404`.

## Jam sessions (watch-together rooms)

Lifecycle over REST, everything live over STOMP (below). Jams live in memory: 60 min, extendable **once** by
+60 min, then deleted. Host-only calls send the token from create in `X-Jam-Token`.

### `POST /api/jams`
```json
{ "name": "Friday night", "hostName": "Omkar" }
```
`201`
```json
{ "jam": { "code": "K7Q2XM", "name": "Friday night", "hostName": "Omkar", "memberCount": 0,
           "createdAt": "2026-11-12T10:00:00Z", "expiresAt": "2026-11-12T11:00:00Z",
           "extended": false, "members": [], "playback": null, "chat": [], "serverTime": 1794420000000 },
  "hostToken": "q3W…(43 chars, base64url)" }
```
| Status | When |
|---|---|
| `400` | `errors` map (name 1–40, hostName 1–30, after whitespace normalisation) |
| `429` | more than 3 jams per IP per hour — `Retry-After` header |
| `503` | 50 jams already active |

The `hostToken` is returned **only here** — it never appears in snapshots or events.

### `GET /api/jams`
`200` · `no-store` — active jams, newest first:
```json
[ { "code": "K7Q2XM", "name": "Friday night", "hostName": "Omkar", "memberCount": 3,
    "createdAt": "2026-11-12T10:00:00Z", "expiresAt": "2026-11-12T11:00:00Z" } ]
```

### `GET /api/jams/{code}`
`200` · `no-store` (code is case-insensitive) · `404` unknown or ended.
```json
{ "code": "K7Q2XM", "name": "Friday night", "hostName": "Omkar", "memberCount": 2,
  "createdAt": "2026-11-12T10:00:00Z", "expiresAt": "2026-11-12T11:00:00Z", "extended": false,
  "members": ["Omkar", "Riya"],
  "playback": { "song": { "id": 20, "videoId": "Zi_XLOBDo_Y", "title": "Billie Jean", "artist": "Michael Jackson",
                          "decade": "80s", "releaseYear": 1982, "thumbnailUrl": "https://i.ytimg.com/vi/Zi_XLOBDo_Y/hqdefault.jpg" },
                "playing": true, "positionSec": 42.5, "updatedAt": 1794420000000 },
  "chat": [
    { "id": "3f1c…", "kind": "SYSTEM", "text": "Riya joined", "sentAt": 1794419990000 },
    { "id": "8a2d…", "kind": "PLAYLIST", "author": "Riya", "text": "try https://youtube.com/playlist?list=PL123",
      "playlistUrl": "https://music.youtube.com/playlist?list=PL123", "sentAt": 1794419995000 }
  ],
  "serverTime": 1794420001234 }
```
Notes: `playback` is `null` until the host loads the first song. **SYSTEM messages have no `author` field**;
`playlistUrl` is present only on `PLAYLIST` messages. `chat` holds the last 50 messages (100 kept server-side).

### `POST /api/jams/{code}/extend` (header `X-Jam-Token`)
`200` JamSnapshot with `extended: true` and `expiresAt` +60 min · `403` wrong/missing token · `404` · `409` already extended.

### `DELETE /api/jams/{code}` (header `X-Jam-Token`)
`204` — everyone receives `ENDED {HOST_ENDED}` · `403` · `404`.

### Open & private jams
`POST /api/jams` takes an optional `"visibility": "OPEN" | "PRIVATE"` (default `OPEN`); the response adds
`inviteToken` (host-only). JamSummary / JamSnapshot carry `visibility`; JamSnapshot also has `locked`.

- **Private jams are not listed** by `GET /api/jams`.
- `GET /api/jams/{code}` with header `X-Jam-Key` (invite token, a guest's pass, or the host token). A private jam
  without a valid key returns `200` with `"locked": true` and empty `members` / `chat`, `playback: null`.
- `POST /api/jams/{code}/visibility` `{"visibility": "PRIVATE"}` (header `X-Jam-Token`) → JamSnapshot. Going `OPEN`
  admits everyone waiting. `403` not the host.
- `GET /api/jams/{code}/invite` (header `X-Jam-Token`) → `{"inviteToken": "…"}`; `POST` the same path rotates it
  (old links stop working; people already in and their passes stay). Invite link: `/jam/{code}#k={inviteToken}`.

## Health
`GET /actuator/health` · `/actuator/health/liveness` · `/actuator/health/readiness`

---

## WebSocket (STOMP 1.2 over WebSocket)

Endpoint: `ws(s)://<host>/ws` (no SockJS). Heart-beats: client 10 s/10 s.

| Frame | Destination | Payload |
|---|---|---|
| `SUBSCRIBE` | `/app/listeners` | one reply to this session: `{"count": 3}` |
| `SUBSCRIBE` | `/topic/listeners` | `{"count": 3}` on every connect/disconnect, and every 15 s |
| `SUBSCRIBE` | `/topic/playlists` | a `PlaylistResponse` after each successful share (sent after DB commit) |
| `SUBSCRIBE` | `/topic/jam/{code}` | `JamEvent` stream for that jam (below) |
| `SUBSCRIBE` | `/user/queue/jam-errors` | errors for **this connection only** (below) |
| `SEND` | `/app/jam/{code}/join` | `{"name": "Riya"}` — the host rejoins with `{"name": "…", "hostToken": "…"}` (the jam's host name is used) |
| `SEND` | `/app/jam/{code}/leave` | `{}` |
| `SEND` | `/app/jam/{code}/chat` | `{"text": "this one! https://music.youtube.com/playlist?list=PL123"}` (1–280 chars, 5 per 10 s) |
| `SEND` | `/app/jam/{code}/control` | host only — see below |
| `SUBSCRIBE` | `/user/queue/jam-access` | answer to a join request, this connection only: `{"type": "APPROVED", "code", "pass", "jam": JamSnapshot}` or `{"type": "DECLINED", "code"}` |
| `SEND` | `/app/jam/{code}/request` | `{"name": "Riya"}` — ask to join a private jam (max 20 waiting; `leave`/disconnect withdraws) |
| `SEND` | `/app/jam/{code}/admit` | host only: `{"hostToken": "…", "requestId": "…", "allow": true}` |

**Private jams:** SUBSCRIBE to `/topic/jam/{code}` must carry a `jam-key` header (invite token, pass or host token)
unless the session is already a member — otherwise the subscription is silently dropped (no ERROR frame, the socket
stays up). `join` takes `"key"` the same way and is refused with `FORBIDDEN` without one. Extra events: `REQUESTS`
`{"requests": [{"id", "name"}]}` (pending join requests) and `VISIBILITY` `{"visibility": "OPEN" | "PRIVATE"}`.

Frames from one connection are processed in order, so a client can SUBSCRIBE to `/topic/jam/{code}` and SEND
`join` straight after.

### Jam events (`/topic/jam/{code}`)
Every message is an envelope; `serverTime` lets clients compute `offset = serverTime − Date.now()`.
```json
{ "type": "STATE", "serverTime": 1794420000000,
  "payload": { "song": { "videoId": "Zi_XLOBDo_Y", "title": "Billie Jean", "artist": "Michael Jackson", "decade": "80s" },
               "playing": true, "positionSec": 0, "updatedAt": 1794420000000 } }
```
| `type` | `payload` |
|---|---|
| `STATE` | PlaybackState (after every host LOAD / PLAY / PAUSE / SEEK) |
| `CHAT` | ChatMessage — `TEXT`, `PLAYLIST` (+`playlistUrl`) or `SYSTEM` (no `author`; joins, leaves, extension) |
| `MEMBERS` | `{"members": ["Omkar", "Riya"], "memberCount": 2}` |
| `EXTENDED` | JamSnapshot |
| `ENDING_SOON` | `{"expiresAt": "2026-11-12T10:59:59Z"}` — once, 5 min before the end |
| `ENDED` | `{"reason": "EXPIRED"}` or `{"reason": "HOST_ENDED"}` — the jam is gone |

Guest position: `positionSec + (playing ? (Date.now() + offset − updatedAt) / 1000 : 0)`.

### Host control (`/app/jam/{code}/control`)
```json
{ "hostToken": "q3W…", "action": "LOAD",
  "song": { "id": 20, "videoId": "Zi_XLOBDo_Y", "title": "Billie Jean", "artist": "Michael Jackson", "decade": "80s" },
  "positionSec": 0 }
{ "hostToken": "q3W…", "action": "PAUSE" }
{ "hostToken": "q3W…", "action": "SEEK", "positionSec": 95.5 }
```
`LOAD` needs a song with a valid 11-char `videoId`. If `positionSec` is omitted for PLAY/PAUSE/SEEK the server uses
its own extrapolated position. The server stamps `updatedAt`.

### Jam errors (`/user/queue/jam-errors`)
```json
{ "code": "FORBIDDEN", "message": "Only the host controls playback." }
```
| `code` | When |
|---|---|
| `NOT_FOUND` | unknown code, or the jam has expired/ended |
| `FORBIDDEN` | wrong host token on control, or chatting without joining |
| `JAM_FULL` | 50 members already |
| `RATE_LIMITED` | more than 5 chat messages in 10 s |
| `INVALID` | bad name / message length / videoId, PLAY/PAUSE/SEEK before any LOAD, or a malformed command |

Example with the browser console:
```js
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.onopen = () => {
  ws.send('CONNECT\naccept-version:1.2\nheart-beat:0,0\n\n\0');
  ws.send('SUBSCRIBE\nid:0\ndestination:/topic/listeners\n\n\0');
};
ws.onmessage = (e) => console.log(e.data);
```
