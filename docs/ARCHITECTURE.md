# Architecture

## 1. The big picture

```
                        ┌──────────────────────────── Browser ────────────────────────────┐
                        │  Angular 20 SPA (signals, zoneless)                              │
                        │                                                                  │
                        │  Components ──intent──▶ PlayerStore / FeedStore                  │
                        │      ▲                     │        │                            │
                        │      └──── signals ◀───────┘        │                            │
                        │                     ┌───────────────┼──────────────┐             │
                        │                     ▼               ▼              ▼             │
                        │               RetrooApi     RealtimeService  YouTubePlayerService│
                        │              (HttpClient)     (RxStomp)       (IFrame API)       │
                        └─────────────────────┬───────────────┬──────────────┬─────────────┘
                                   HTTP /api  │     WS /ws    │              │ iframe
                                              ▼               ▼              ▼
                        ┌──────────── nginx (prod) / ng serve proxy (dev) ──┐   YouTube
                        └───────────────────────┬───────────────────────────┘   (video,
                                                ▼                                oEmbed)
     ┌──────────────────────────── Spring Boot API ────────────────────────────────┐ ▲
     │  web layer      CatalogController  PlaylistController  StatsController       │ │
     │                 AdminSongController (+ AdminKeyInterceptor)                   │ │
     │                 PresenceStompController (@SubscribeMapping)                   │ │
     │                 GlobalExceptionHandler → RFC 7807 ProblemDetail               │ │
     │  service layer  SongService  PlaylistService  PresenceService  RateLimiter    │ │
     │                 YouTubeLinkParser  YouTubeMetadataClient ─────────────────────┼─┘
     │  messaging      SimpleBroker  /topic/listeners  /topic/playlists              │
     │  data layer     SongRepository  SharedPlaylistRepository (Spring Data JPA)    │
     └───────────────────────────────────────┬──────────────────────────────────────┘
                                             ▼
                          H2 (dev/test, Oracle mode)  ·  Oracle 23ai Free (prod)
                          schema + seed owned by Flyway
```

## 2. Request flows

### 2.1 First load
1. Angular boots; `CrtTvComponent` renders the TV and, after render, calls `PlayerStore.init(hostElement)`.
2. In parallel: `GET /api/decades` (bar + header link) and the YouTube IFrame API script loads and builds a player.
3. `GET /api/songs/random?decade=now` → the song is **cued** (not played) — autoplay with sound is blocked.
4. `FeedStore.load()` → `GET /api/playlists?page=0&size=40`.
5. `RealtimeService` opens `ws://host/ws` (STOMP CONNECT). The server's `SessionConnectedEvent` adds the
   session to the presence set and broadcasts the new count to `/topic/listeners`. The client also subscribes to
   `/app/listeners` and gets a one-shot reply with the current count (`@SubscribeMapping`).
6. User clicks **Tap to tune in** → `player.playVideo()` runs synchronously inside the click (user gesture).

### 2.2 Changing channel (e.g. pressing "90s")
```
DecadeBar ─click─▶ PlayerStore.selectDecade('90s')
   status = 'tuning' (static + OSD shown), seq = ++requestSeq
   ├─ GET /api/songs/random?decade=90s ─▶ SongService.randomSong
   │        COUNT(*) WHERE DECADE='90s'  → n
   │        SELECT … OFFSET random(n) FETCH NEXT 1 ROWS ONLY
   └─ wait ≥ 600 ms (the "tuning" effect)
   if seq is still the latest → yt.load(videoId) → status = 'on'
```
Rapid clicks are safe: only the latest request touches the player (sequence-number guard ≈ `switchMap`).

### 2.3 Song ends / video is blocked
* YouTube state `ENDED` → `ended$` → `PlayerStore.next()` → random song from the same decade, excluding the one
  that just played.
* YouTube error 100/101/150 (removed / embedding disabled) → `unplayable$` → skip; after 5 consecutive failures
  show "NO SIGNAL" instead of looping forever.

### 2.4 Sharing a playlist
```
Dialog ─POST /api/playlists─▶ PlaylistController ─▶ PlaylistService.share   (@Transactional)
   1 RateLimiter.tryAcquire(ip)          → 429 + Retry-After
   2 YouTubeLinkParser.parsePlaylist     → 400 if not an allow-listed YouTube playlist link
   3 duplicate check (playlist+name)     → 409   (DB unique constraint is the real guarantee)
   4 save → publish PlaylistShared event
   ── COMMIT ──
   5 @TransactionalEventListener(AFTER_COMMIT) → convertAndSend('/topic/playlists', dto)
                                                          │
every connected browser ◀── STOMP MESSAGE ────────────────┘  FeedStore.upsert (dedupe by id)
```

### 2.5 Jam session flow
```
Host: POST /api/jams ──▶ JamService.create ── 201 { jam, hostToken }   (token kept by the host's browser)
Host & guests: SUBSCRIBE /topic/jam/{code} + /user/queue/jam-errors, SEND /app/jam/{code}/join
                                      └─▶ member registry (STOMP session → name) ─▶ MEMBERS + SYSTEM "X joined"
Host picks a song ─ SEND …/control {LOAD, song, hostToken} ─▶ token check ─▶ server stamps updatedAt
                                      └─▶ /topic/jam/{code} STATE ─▶ every guest: load song, seek to
                                          positionSec + (now + offset − updatedAt), play/pause to match
Anyone ─ SEND …/chat {text} ─▶ author from registry, rate limit, playlist-link detection ─▶ CHAT to all
Guest sends control ─▶ FORBIDDEN delivered only to that guest on /user/queue/jam-errors
Sweeper (15 s): 5 min left ─▶ ENDING_SOON · expired ─▶ ENDED + jam deleted · host may extend once (+60 min)
Socket closes / UNSUBSCRIBE ─▶ member removed ─▶ MEMBERS + SYSTEM "X left"
```

## 3. Key design decisions (and the trade-offs)

| Decision | Why | Trade-off / when to revisit |
|---|---|---|
| **Presence from WebSocket sessions** (not a SESSIONS table + HTTP pings) | Exact, instant, zero DB writes; STOMP heart-beats detect dead clients | Count is per instance → with N replicas, aggregate in Redis |
| **Simple in-memory STOMP broker** | No extra infrastructure | Multi-instance needs a broker relay (RabbitMQ) or Redis pub/sub |
| **Random row via COUNT + OFFSET** | Portable (H2 + Oracle), touches one row | Two queries; for millions of rows use a random-id range or pre-shuffled queue |
| **Flyway with `{vendor}` folders** | H2 and Oracle disagree on numeric types under `ddl-auto: validate` | Two DDL files must be kept in sync (rule in gemini.md) |
| **H2 in Oracle mode for dev/test** | Zero-setup dev loop, fast tests | Not 100 % Oracle; prod-parity tests would use Testcontainers + Oracle |
| **Admin API key (interceptor)** | One operator, tiny surface, constant-time compare | Multiple admins/roles → Spring Security + OAuth2/JWT |
| **Fixed-window rate limiter in memory** | Simple, O(1), bounded by eviction | Boundary bursts; per instance → Redis/Bucket4j |
| **After-commit broadcast** | Clients never see data that was rolled back | Message lost if the node dies between commit and send (outbox pattern if that matters) |
| **Angular signals + small stores** instead of NgRx | App state is small; signals give fine-grained, glitch-free updates | Larger teams/state → NgRx SignalStore |
| **Zoneless change detection** | Smaller bundle; YouTube callbacks update UI without `NgZone.run` | Third-party libs relying on zone.js need care |
| **YouTube IFrame API** for playback | Only ToS-compliant way to play YouTube/YT Music content | YouTube controls ads/availability; some videos block embedding (handled by skip) |
| **Same-origin via nginx reverse proxy** | No CORS in prod, cookies/WS simple, one TLS cert | nginx becomes part of the deployment |
| **Pure-CSS room and TV** | No image licensing, crisp at any size, tiny payload | More CSS to maintain |
| **Jams in memory** (ConcurrentHashMap + per-jam lock), not in the DB | Max 2 h lifetime and nothing worth keeping → no schema, no cleanup job; expiry is just a map removal | Restart ends every jam; per instance → Redis hash + pub/sub to scale out |
| **Host token instead of accounts** | Zero sign-up friction; 256-bit random secret returned once, constant-time compare, re-checked on every privileged command | Clearing storage loses host rights; no cross-device identity |
| **Per-session error queue** (`/user/queue/jam-errors` addressed by STOMP session id) | Command failures reach only the sender without a Principal; everyone else's event stream stays clean | Relies on Spring's user-destination rewriting; with a broker relay it needs a user registry shared across nodes |

## 4. Layering rules (enforced by convention, documented in gemini.md)
1. Controller → Service → Repository. Controllers never touch repositories.
2. Entities never leave the service layer; DTO records form the API contract.
3. All errors become RFC 7807 `ProblemDetail` JSON in one place (`GlobalExceptionHandler`).
4. Components never call `HttpClient` or `window.YT` directly — only stores/services do.
5. Schema changes only through new Flyway migrations.

## 5. Environments
| | dev | test | prod |
|---|---|---|---|
| Profile | `dev` (default) | `test` | `prod` |
| DB | H2 file `./data/retroo` | H2 in-memory | Oracle (env vars) |
| Admin key | `dev-admin-key` | `test-key` | `RETROO_ADMIN_API_KEY` or disabled |
| Swagger UI | on | on | off |
| Frontend → API | Angular dev-server proxy | — | nginx reverse proxy |

## 6. Scaling path (if this became popular)
1. Put 2+ API instances behind a load balancer with **sticky sessions** for `/ws` (or none if using a relay).
2. Replace the simple broker with `enableStompBrokerRelay` → RabbitMQ (STOMP plugin).
3. Move presence counts and rate-limit buckets to **Redis** (`INCR`/`EXPIRE`, sorted sets).
4. Cache `GET /api/decades` (already `Cache-Control: max-age=300`) at a CDN.
5. Pre-compute per-decade shuffled queues if the catalog grows to millions of songs.
