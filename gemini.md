# Retroo TV — Project Constitution

> `gemini.md` is law. Update only when a schema changes, a rule is added, or the architecture is modified.
> Last revised: 2026-11-12 (v2 — YouTube Music rebuild).

## 1. North Star
A full-screen "time-travel TV": a retro CRT television in a warm room that plays music videos from a chosen
decade (60s → Now) via YouTube, with a live listener count and a live feed of YouTube Music playlists shared
by visitors. Reference UX: https://tv.codvyn.in/ (layout only — no assets copied).

## 2. Architectural Invariants
| Layer | Technology |
|---|---|
| Backend | Java 17+, Spring Boot 3.4 (Web, Data JPA, Validation, WebSocket/STOMP, Actuator), Flyway, springdoc-openapi |
| Database | H2 (Oracle compatibility mode) for `dev`/`test`; Oracle Free 23ai for `prod` |
| Frontend | Angular 17 standalone components + Signals, RxJS, `@stomp/rx-stomp`, SCSS (no Tailwind) |
| Playback | YouTube IFrame Player API (the only legal way to play YouTube / YT Music content in a browser) |
| Delivery | Docker images (backend JRE, frontend nginx) + docker-compose; nginx reverse-proxies `/api` and `/ws` |

Rules:
1. Schema changes go through Flyway migrations only (`ddl-auto: validate`). Never edit an applied migration.
2. Queries must be portable between H2 (MODE=Oracle) and Oracle — no `DBMS_RANDOM`, no vendor-only functions.
   DDL lives in `db/migration/{vendor}` (`oracle/`, `h2/`) because H2 reports `NUMBER(19)` as NUMERIC, which fails
   Hibernate's `validate` against `Long`; data-only migrations live in `db/migration/common`. Both vendor folders
   must define identical tables, columns and constraints.
3. Controllers never touch repositories; Controller → Service → Repository. Entities never leave the service layer (DTO records only).
4. All errors are returned as RFC 7807 `ProblemDetail` JSON.
5. Config comes from `application.yml` + environment variables; no secrets in source.

## 3. Data Schemas (Database)

### SONGS
| Column | Type | Notes |
|---|---|---|
| ID | NUMBER IDENTITY PK | |
| VIDEO_ID | VARCHAR2(11) NOT NULL UNIQUE | YouTube video id — natural key (idempotent seeding) |
| TITLE | VARCHAR2(200) NOT NULL | |
| ARTIST | VARCHAR2(200) NOT NULL | |
| DECADE | VARCHAR2(10) NOT NULL | one of `60s,70s,80s,90s,2000s,2010s,now` (indexed) |
| RELEASE_YEAR | NUMBER(4) NULL | |
| LANG | VARCHAR2(2) NOT NULL DEFAULT 'en' | `hi` (Bollywood) or `en` (Hollywood/international); added in V4 |
| THUMBNAIL_URL | VARCHAR2(500) NULL | |
| CREATED_AT | TIMESTAMP NOT NULL | |

### SHARED_PLAYLISTS (replaces v1 USER_PLAYLISTS)
| Column | Type | Notes |
|---|---|---|
| ID | NUMBER IDENTITY PK | |
| DISPLAY_NAME | VARCHAR2(40) NOT NULL | |
| PLAYLIST_ID | VARCHAR2(64) NOT NULL | extracted `list=` id |
| PLAYLIST_URL | VARCHAR2(300) NOT NULL | canonical `https://music.youtube.com/playlist?list=<id>` |
| PLAYLIST_NAME | VARCHAR2(80) NOT NULL | |
| NOTE | VARCHAR2(140) NULL | |
| CREATED_AT | TIMESTAMP NOT NULL | indexed DESC for the feed |
| UNIQUE (PLAYLIST_ID, DISPLAY_NAME) | | duplicate share → 409 |

### SESSIONS — **removed in v2.**
Listener presence is now derived from live STOMP WebSocket sessions held in memory (connect/disconnect events),
which is exact, needs no polling and no DB writes. Trade-off: per-instance count (see docs for scale-out via Redis).

## 4. API Payloads (JSON)

`GET /api/decades` → `DecadeResponse[]`
```json
{ "slug": "90s", "label": "90s", "songCount": 7, "ytMusicUrl": "https://music.youtube.com/search?q=90s%20hits" }
```
`GET /api/songs?decade=90s` → `SongResponse[]`; `GET /api/songs/random?decade=90s&lang=hi&exclude=<id>,<id>` → `SongResponse`
(`lang` optional; `exclude` = comma-separated recent video ids, max 20. Fallbacks, in order: drop `exclude`, then drop `lang`.)
```json
{ "id": 12, "videoId": "hTWKbfoikeg", "title": "Smells Like Teen Spirit", "artist": "Nirvana",
  "decade": "90s", "lang": "en", "releaseYear": 1991, "thumbnailUrl": "https://i.ytimg.com/vi/hTWKbfoikeg/hqdefault.jpg" }
```
`GET /api/playlists?page=0&size=30` → `PageResponse<PlaylistResponse>`
`POST /api/playlists` (body `SharePlaylistRequest`) → `201 PlaylistResponse`
```json
// request
{ "displayName": "Avanti", "playlistUrl": "https://music.youtube.com/playlist?list=PL123", "playlistName": "Energetic songs", "note": "I listen to this when I feel low" }
// response
{ "id": 5, "displayName": "Avanti", "playlistUrl": "https://music.youtube.com/playlist?list=PL123", "playlistName": "Energetic songs", "note": "...", "createdAt": "2026-11-12T10:00:00Z" }
```
`POST /api/admin/songs` (header `X-Admin-Key`) body `{ "video": "<id or url>", "decade": "90s", "title"?: "", "artist"?: "", "releaseYear"?: 1991 }` → `201 SongResponse` (missing title/artist enriched via YouTube oEmbed).
`DELETE /api/admin/songs/{id}` → `204`.
`GET /api/stats` → `{ "listeners": 3, "songs": 64, "playlists": 10 }`

Errors (all endpoints) → `application/problem+json`:
```json
{ "type": "about:blank", "title": "Validation failed", "status": 400, "detail": "...", "errors": { "playlistUrl": "must be a YouTube Music playlist link" } }
```

## 5. Realtime Payloads (STOMP over native WebSocket, endpoint `/ws`)
| Destination | Payload | When |
|---|---|---|
| `/app/listeners` (subscribe) | `{ "count": 3 }` | one-shot reply to that client only (`@SubscribeMapping`) — initial state |
| `/topic/listeners` | `{ "count": 3 }` | on connect / disconnect + heartbeat every 15 s |
| `/topic/playlists` | `PlaylistResponse` | each successful share |

## 6. Behavioral Rules
1. Selecting a decade: switch the playlist link in the header, show TV static + CRT flicker for ≥1.5 s, play a random song from that decade.
2. Auto-play continues with a random song from the same decade, never repeating the song just played. Between
   songs the TV "loses signal" like a 90s set: static, rolling bar, flicker and a soft hiss for ≥3 s.
3. If a video cannot be embedded (YT errors 100/101/150) skip to the next song automatically.
4. Shared playlists must be YouTube / YouTube Music playlist links; stored in canonical YT Music form.
5. Playlist submissions are rate limited per client IP (default 3 per 10 minutes) → 429.
6. Admin endpoints require `X-Admin-Key` (constant-time compare). If no key configured, admin API is disabled.
7. Browsers block autoplay with sound: first play requires a user gesture ("Tap to tune in" overlay).
8. The catalog is a mix of Hindi (Bollywood) and English (Hollywood/international) songs in every decade.
   Playback ratio is **2:1 — Bollywood, Bollywood, Hollywood, repeat** (client-side rotation, passed as `lang`).
   The last 10 played songs are excluded from random picks when the decade has enough songs.
11. Shared playlists are **playable**: "Tune in" plays a shared YouTube Music playlist on the TV (ids read through
   the IFrame API's `cuePlaylist` + `getPlaylist`, then played song by song with the normal TV transitions).
   In a jam only the host can put a playlist on; guests follow as usual.
12. Design direction: **premium, minimal, photographic.** Rooms are soft, out-of-focus light (shallow depth of field),
   never sharp cartoon objects; the TV is the only sharp object. Ambient glow from the current artwork, film grain,
   hairline UI, restrained motion (no blinking, no buzzing). Secondary panels (jams) live in a drawer.
9. Themes are *scenes*: each one changes the room decor **and** the TV model, not only colours. Purely
   presentational (`html[data-theme]` + scene/TV-model components), per-browser (localStorage), never sent to the
   server. Scenes: `living` (default, sunset living room, wood console TV), `rural` (village home, portable TV,
   slightly washed-out picture), `city` (90s city apartment, silver plastic TV with side speakers), `villa`
   (arched garden window, marble floor, big cabinet TV with doors), `midnight` (night living room),
   `neon` (synthwave den, glossy black TV).
10. Jam sessions — see §8. Ephemeral by design: in memory only, never in the database.

## 8. Jam Sessions (watch-together rooms)

### 8.1 Rules
- A jam has a **host** (creator) and **guests**. Identity = display name; the host additionally holds a secret
  `hostToken` (32 random bytes, base64url) returned once at creation; compared in constant time.
- Only the host controls playback (load song / play / pause / seek) and can extend or end the jam.
  Guests' TVs follow the host's state; guests may mute locally, chat and share playlist links.
- Lifetime: **60 min**. The host may extend **once** by **+60 min** (max 120 min total). An `ENDING_SOON` event is
  sent at 5 min left; at expiry the server sends `ENDED` and deletes the jam. A sweeper runs every 15 s.
- Storage: `ConcurrentHashMap<code, JamSession>` in memory; per-jam mutations synchronized on the session.
- Limits (configurable `retroo.jam.*`): max 50 active jams (create → 503), max 50 members per jam (join → error),
  create rate 3 per IP per hour (429 + Retry-After), chat 5 messages per 10 s per member, text 1–280 chars,
  last 100 chat messages kept, names trimmed/whitespace-collapsed (jam name 1–40, display name 1–30).
- Chat text containing a YouTube playlist link (YouTubeLinkParser) becomes kind `PLAYLIST` with the canonical URL.
- Code: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), SecureRandom, unique among active jams.
- Membership is tied to the STOMP session: `join` registers it, `leave`/UNSUBSCRIBE/disconnect removes it.
  If the host's socket drops the jam keeps running (host can rejoin with the token).

### 8.2 REST (`/api/jams`)
| Method | Path | Body / headers | Response |
|---|---|---|---|
| POST | `/api/jams` | `{ "name": "Friday night", "hostName": "Omkar" }` | `201 { "jam": JamSnapshot, "hostToken": "…" }` · 400 · 429 · 503 |
| GET | `/api/jams` | — | `200 JamSummary[]` (active, newest first) |
| GET | `/api/jams/{code}` | — | `200 JamSnapshot` · 404 |
| POST | `/api/jams/{code}/extend` | header `X-Jam-Token` | `200 JamSnapshot` · 403 bad token · 404 · 409 already extended |
| DELETE | `/api/jams/{code}` | header `X-Jam-Token` | `204` · 403 · 404 |

```json
// JamSummary
{ "code": "K7Q2XM", "name": "Friday night", "hostName": "Omkar", "memberCount": 3,
  "createdAt": "2026-11-12T10:00:00Z", "expiresAt": "2026-11-12T11:00:00Z" }
// JamSnapshot = JamSummary + { "extended": false, "members": ["Omkar", "Riya"], "playback": PlaybackState|null,
//                              "chat": ChatMessage[] (last 50), "serverTime": 1794420000000 }
// PlaybackState
{ "song": SongResponse, "playing": true, "positionSec": 42.5, "updatedAt": 1794420000000 }
// ChatMessage
{ "id": "uuid", "kind": "TEXT" | "PLAYLIST" | "SYSTEM", "author": "Riya", "text": "this one!",
  "playlistUrl": "https://music.youtube.com/playlist?list=PL…" /* PLAYLIST only */, "sentAt": 1794420000000 }
```

### 8.3 STOMP
| Direction | Destination | Payload |
|---|---|---|
| client SUBSCRIBE | `/topic/jam/{code}` | `JamEvent` stream (below) |
| client SUBSCRIBE | `/user/queue/jam-errors` | `{ "code": "RATE_LIMITED" \| "JAM_FULL" \| "NOT_FOUND" \| "FORBIDDEN" \| "INVALID", "message": "…" }` (this session only) |
| client SEND | `/app/jam/{code}/join` | `{ "name": "Riya", "hostToken": "…"? }` |
| client SEND | `/app/jam/{code}/leave` | `{}` |
| client SEND | `/app/jam/{code}/chat` | `{ "text": "…" }` (author = registered member name, never client-supplied) |
| client SEND | `/app/jam/{code}/control` | `{ "hostToken": "…", "action": "LOAD" \| "PLAY" \| "PAUSE" \| "SEEK", "song": SongResponse?, "positionSec": 0 }` |

`JamEvent` envelope: `{ "type": "STATE" | "CHAT" | "MEMBERS" | "EXTENDED" | "ENDING_SOON" | "ENDED", "payload": …, "serverTime": epochMs }`
- `STATE` → PlaybackState · `CHAT` → ChatMessage · `MEMBERS` → `{ "members": ["…"], "memberCount": n }`
- `EXTENDED` → JamSnapshot · `ENDING_SOON` → `{ "expiresAt": "…" }` · `ENDED` → `{ "reason": "EXPIRED" | "HOST_ENDED" }`
- Join/leave also emit a `SYSTEM` chat message ("Riya joined").

### 8.4 Client sync (guests)
`offset = serverTime − Date.now()` on every event; expected position = `positionSec + (playing ? (Date.now() + offset − updatedAt) / 1000 : 0)`.
On STATE: load the song if different (with channel static), seek if drift > 2 s, then play/pause to match.
The host's client emits LOAD on song change, PLAY/PAUSE on player state change and SEEK on user seek, plus a
PLAY heartbeat every 15 s (keeps late joiners and drifting guests aligned).

## 7. Maintenance Log
- 2026-08-20 v1 schema (SONGS, USER_PLAYLISTS, SESSIONS) drafted.
- 2026-11-12 v2.3: LANG column (V4) + 2:1 rotation, playable shared playlists, premium redesign + minimal themes.
- 2026-11-12 v2.2: Jam sessions (in-memory, §8); themes become scenes (room + TV model).
- 2026-11-12 v2.1: Hindi songs added (migration V3), longer tuning static, between-song signal loss, themes.
- 2026-11-12 v2: rebuilt for YouTube Music; SESSIONS dropped (WebSocket presence); USER_PLAYLISTS → SHARED_PLAYLISTS; Flyway introduced; H2 dev profile added.
