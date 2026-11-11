# Backend — component guide (`retroo-tv-api`)

Spring Boot 3.4 · Java 17 · Maven. Package root `com.retroo`.

```
com.retroo
├── RetrooTvApplication          entry point
├── config/                      wiring & settings
│   ├── RetrooProperties         typed retroo.* settings
│   ├── WebConfig                CORS, admin interceptor, Clock bean
│   ├── WebSocketConfig          STOMP endpoint + broker (+ /queue, /user, ordering)
│   ├── RateLimitConfig          one named RateLimiter bean per use-case
│   └── OpenApiConfig            Swagger metadata
├── domain/                      JPA entities + enum
│   ├── Decade, DecadeConverter
│   ├── Song
│   └── SharedPlaylist
├── repository/                  Spring Data JPA interfaces
├── service/                     business logic
│   ├── SongService              catalog + random pick + admin add
│   ├── PlaylistService          share flow + after-commit broadcast
│   ├── PresenceService          live listener count
│   ├── RateLimiter              fixed-window limiter (plain class, built by RateLimitConfig)
│   ├── YouTubeLinkParser        URL parsing/allow-listing (+ links inside free text)
│   └── YouTubeMetadataClient    oEmbed HTTP client
├── jam/                         watch-together rooms (in memory)
│   ├── JamModels                wire records (requests, snapshot, events, errors)
│   ├── JamSession               one live jam + its lock
│   ├── JamService               all jam use-cases + sweeper
│   ├── JamController            REST /api/jams
│   ├── JamStompController       STOMP /app/jam/{code}/… + per-session errors
│   ├── JamMembershipListener    leave on disconnect / UNSUBSCRIBE
│   └── JamException             STOMP error codes
└── web/                         HTTP/STOMP adapters
    ├── CatalogController, PlaylistController, StatsController, PresenceStompController
    ├── admin/ AdminSongController, AdminKeyInterceptor
    ├── dto/   request/response records
    └── error/ ApiException hierarchy, GlobalExceptionHandler
```

---

## 1. Bootstrapping

### `RetrooTvApplication`
* `@SpringBootApplication` = `@Configuration` + `@EnableAutoConfiguration` + `@ComponentScan` of `com.retroo`.
* `@ConfigurationPropertiesScan` registers `RetrooProperties`.
* `@EnableScheduling` activates `@Scheduled` methods (presence heartbeat, rate-limiter eviction).

### `application.yml` (profiles)
* Shared block: JPA `ddl-auto: validate` (Flyway owns the schema), `open-in-view: false`, Instants stored as UTC
  `TIMESTAMP`, Flyway locations `db/migration/{vendor}` + `db/migration/common`, graceful shutdown,
  `forward-headers-strategy: framework` (trust nginx's `X-Forwarded-*`), actuator health probes.
* `dev` (default): H2 **file** DB in Oracle mode, H2 console, admin key `dev-admin-key`.
* `test` (`src/test/resources/application-test.yml`): in-memory H2, key `test-key`, slow heartbeat.
* `prod`: Oracle via `SPRING_DATASOURCE_*` env vars, Hikari pool, Swagger off.

---

## 2. Configuration (`config/`)

### `RetrooProperties`
An immutable `record` bound to `retroo.*`. Nested records: `Cors`, `Admin` (with `enabled()`), `Playlists.RateLimit`
(`maxRequests`, `window` as `Duration` — Spring converts `10m`), `Presence.heartbeat`, `Youtube` (oEmbed URL +
timeout). `@Validated` + Jakarta constraints make the app **fail fast at start-up** if config is wrong.

### `WebConfig`
* **CORS** for `/api/**` with an explicit origin allow-list (only used in dev without the proxy; prod is
  same-origin).
* Registers `AdminKeyInterceptor` on `/api/admin/**`.
* Exposes a `Clock` bean (`Clock.systemUTC()`), injected wherever "now" matters so tests can control time.

### `WebSocketConfig`
* `@EnableWebSocketMessageBroker` turns on STOMP messaging.
* Endpoint **`/ws`** (native WebSocket, no SockJS).
* `enableSimpleBroker("/topic")` — in-memory pub/sub. `setApplicationDestinationPrefixes("/app")` routes client
  SUBSCRIBE/SEND on `/app/**` to `@MessageMapping`/`@SubscribeMapping` methods.

Since jams it also: adds `/queue` to the simple broker and `setUserDestinationPrefix("/user")` (per-session
delivery, §6.5); `setPreserveReceiveOrder(true)` on the endpoint (each connection's frames are handled in arrival
order, so SUBSCRIBE-then-join can't be reordered by the inbound thread pool); `setPreservePublishOrder(true)` on
the broker (each session receives events in publish order, e.g. STATE before the CHAT that follows it).

### `RateLimitConfig`
Declares three independent `RateLimiter` beans — `playlistShareRateLimiter` (3 / 10 min / IP),
`jamCreateRateLimiter` (3 / hour / IP) and `jamChatRateLimiter` (5 / 10 s / member) — each from its
`retroo.*.rate-limit` block. Separate instances keep budgets independent (sharing a playlist never eats into chat).
Consumers select one with `@Qualifier(RateLimitConfig.…)`.

### `OpenApiConfig`
Title/version and the `X-Admin-Key` API-key security scheme for Swagger UI.

---

## 3. Domain & persistence

### `Decade` (enum) + `DecadeConverter`
* Seven constants with `slug` ("90s" — wire + DB value, `@JsonValue`), `label` ("90s"/"Now") and a YouTube Music
  search URL (`ytMusicUrl()`).
* `fromSlug()` — case-insensitive lookup returning `Optional`.
* `DecadeConverter` (`@Converter(autoApply = true)`) stores the slug, not the ordinal (re-ordering would corrupt
  data) or the name (would not match the CHECK constraint).

### `Song` entity → table `SONGS`
`id` (identity), `videoId` (11 chars, **unique natural key**), `title`, `artist`, `decade`, `releaseYear`,
`thumbnailUrl` (derived from the id), `createdAt` (`@PrePersist`). Protected no-arg constructor for JPA, no setters
— state is set via the constructor (immutability by default).

### `SharedPlaylist` entity → table `SHARED_PLAYLISTS`
`displayName`, `playlistId` (the `list=` value), canonical `playlistUrl`, `playlistName`, optional `note`,
`createdAt`. Unique `(PLAYLIST_ID, DISPLAY_NAME)`.

### Flyway migrations (`src/main/resources/db/migration`)
| Path | Content |
|---|---|
| `oracle/V1__create_schema.sql` | DDL for Oracle (`NUMBER(19)` ids) |
| `h2/V1__create_schema.sql` | Same DDL for H2 (`BIGINT` ids) — must stay structurally identical |
| `common/V2__seed_songs.sql` | 71 songs, every video id verified against YouTube oEmbed |

Indexes: `IX_SONGS_DECADE` (every playback query filters by decade) and `IX_SHARED_PLAYLISTS_CREATED`
(feed is newest-first). CHECK constraint restricts `DECADE` to the seven slugs.

### Repositories (`repository/`)
Spring Data generates implementations at start-up from method names.
* `SongRepository`: `findByDecadeOrderByReleaseYearAscTitleAsc`, `countByDecade`, `countByDecadeAndVideoIdNot`,
  paged `findByDecade…OrderByIdAsc(…, Pageable)` (used with page size 1 for the random pick), `existsByVideoId`,
  and a JPQL `GROUP BY` with an **interface projection** (`DecadeCount`) for the decade bar counts.
* `SharedPlaylistRepository`: `findAllByOrderByCreatedAtDescIdDesc(Pageable)` and a duplicate check.

---

## 4. Services (`service/`)

### `SongService`
* Class-level `@Transactional(readOnly = true)`; write methods override with `@Transactional`.
* `listDecades()` — one grouped COUNT query → `DecadeResponse` for all seven decades (0 for empty ones).
* `randomSong(decade, exclude)` — **portable random pick**: count candidates excluding the song that just played,
  pick `offset = random(n)`, fetch `PageRequest.of(offset, 1)`. Falls back to including it when it is the only
  song; 404 when the decade is empty. Randomness is an injected `RandomGenerator` (deterministic in tests).
* `addSong(request)` — parse id/URL → 409 if it exists → if title/artist missing, look them up via oEmbed (400 if
  that fails) → strip " - Topic"/"VEVO" from channel names → save.
* `deleteSong(id)` — 404 if missing.
* Two constructors: the public one is `@Autowired`; the package-private one takes a `RandomGenerator` for tests.

### `PlaylistService`
`share(request, clientIp)` runs in one transaction:
1. `RateLimiter.tryAcquire(ip)` → `TooManyRequests` (429 + `Retry-After`).
2. `YouTubeLinkParser.parsePlaylist` → `BadRequest`.
3. Normalise text (collapse whitespace, strip control chars); duplicate check → `Conflict`.
4. Save, then publish a `PlaylistShared` application event.

`broadcast(event)` is a `@TransactionalEventListener(phase = AFTER_COMMIT)` → `SimpMessagingTemplate.convertAndSend
("/topic/playlists", dto)`. Clients never receive an entry whose transaction rolled back.

`feed(page, size)` clamps size to 1–50 and returns a `PageResponse`.

### `PresenceService`
A `ConcurrentHashMap.newKeySet()` of STOMP session ids.
* `@EventListener SessionConnectedEvent` → add + broadcast `{count}` to `/topic/listeners`.
* `@EventListener SessionDisconnectEvent` → remove + broadcast (fires on clean close **and** heart-beat timeout).
* `@Scheduled` heartbeat re-broadcasts every `retroo.presence.heartbeat` (15 s) as a safety net.
* A **set** (not a counter) makes duplicate/out-of-order events harmless.

### `RateLimiter`
Fixed-window counter per key in a `ConcurrentHashMap<String, Window>`; `compute()` makes the read-modify-write
atomic per key. Returns `Decision(allowed, retryAfter)`. `@Scheduled` eviction every minute keeps memory bounded.
Uses the injected `Clock` → unit tests move time forward deterministically.

*Refactor for jams:* it used to be a `@Component` reading the playlist limits itself. It is now a plain class
constructed with `(maxRequests, window, clock)`, so several differently-configured instances can exist; they are
created as `@Bean`s in `RateLimitConfig` (`@Scheduled` eviction still works on `@Bean` objects). `PlaylistService`
behaviour is unchanged.

### `YouTubeLinkParser`
Pure functions, no I/O:
* `parsePlaylist(url)` — adds `https://` if missing, requires a host in the allow-list
  (`music.youtube.com`, `youtube.com`, `www.`, `m.`, `youtu.be`), extracts `list=`, validates
  `[A-Za-z0-9_-]{2,64}`, returns the canonical `https://music.youtube.com/playlist?list=<id>`.
  The allow-list blocks phishing links and look-alike hosts (`music.youtube.com.evil.com`).
* `parseVideoId(input)` — bare 11-char id, `watch?v=`, `youtu.be/<id>`, `/shorts/<id>`.
* `findPlaylistInText(text)` — for jam chat: splits on whitespace, strips punctuation people type around links
  (`(…)!`), and runs every token containing `list=` through `parsePlaylist`, so the same allow-list applies.

### `YouTubeMetadataClient`
`RestClient` call to `https://www.youtube.com/oembed?url=…&format=json` with 3 s connect/read timeouts. Any failure
→ `Optional.empty()` (enrichment must never take the API down). `@JsonIgnoreProperties(ignoreUnknown = true)` record
for the response.

---

## 5. Web layer (`web/`)

### Controllers
| Class | Routes | Notes |
|---|---|---|
| `CatalogController` | `GET /api/decades`, `GET /api/songs?decade=`, `GET /api/songs/random?decade=&exclude=` | decades cached 5 min (`Cache-Control: public`); random is `no-store` |
| `PlaylistController` | `GET /api/playlists?page&size`, `POST /api/playlists` | `@Valid` body; client key = `request.getRemoteAddr()` (already the real client IP thanks to forwarded-headers support) |
| `StatsController` | `GET /api/stats` | listeners, songs, playlists |
| `AdminSongController` | `POST /api/admin/songs`, `DELETE /api/admin/songs/{id}` | guarded by the interceptor |
| `PresenceStompController` | STOMP `SUBSCRIBE /app/listeners` | `@SubscribeMapping` → one-shot reply to that session only |

Controllers are thin: translate HTTP ⇄ method call; no business rules.

### DTOs (`web/dto/`)
Java **records**. Requests carry Bean Validation (`@NotBlank`, `@Size`, `@Min/@Max`); responses have a static
`from(entity)` factory. `PageResponse<T>` is a stable pagination envelope (Spring's `PageImpl` JSON is not a
contract).

### `AdminKeyInterceptor`
`HandlerInterceptor.preHandle`: lets CORS pre-flight through, 403 if no key configured (fail-closed), 401 if
missing/wrong. Compares with `MessageDigest.isEqual` — constant-time, defeats timing attacks.

### Error handling (`web/error/`)
* `ApiException` (abstract, carries `HttpStatus` + title) with subclasses `NotFound`, `BadRequest`, `Conflict`,
  `TooManyRequests` (+ retry seconds), `Unauthorized`, `Forbidden`.
* `GlobalExceptionHandler extends ResponseEntityExceptionHandler` (`@RestControllerAdvice`):
  * `ApiException` → `ProblemDetail` with its status (and `Retry-After` for 429).
  * `MethodArgumentNotValidException` → 400 with `errors: {field: message}`.
  * `ConstraintViolationException` → 400.
  * `DataIntegrityViolationException` → 409 (covers the race between duplicate check and insert).
  * Anything else → logged, generic 500 (no stack traces leaked).

---

## 5b. Language & the 2:1 rotation (v2.3)
* **Schema**: `V4__add_song_language.sql` adds `SONGS.LANG VARCHAR2(2) DEFAULT 'en' NOT NULL` (CHECK `hi|en`), marks the
  V3 songs `hi`, and adds `IX_SONGS_DECADE_LANG (DECADE, LANG)`. `V5__seed_more_hindi_songs.sql` adds 12 more Hindi songs
  for thin decades. Both are vendor-neutral (`ALTER TABLE … ADD (…)` works on Oracle and H2) so they live in `common/`.
* **`SongService.randomSong(decade, lang, exclude)`** tries strategies in order until one has candidates — language +
  not recent → language only → any language + not recent → anything — each as COUNT + one-row fetch at a random offset.
  Four simple derived queries instead of one dynamic query, and `NOT IN ()` with an empty list is never generated.
* The **ratio itself is client-side** (PlayerStore keeps a rotation counter and the last 10 ids): the server stays
  stateless, and in a jam the host's rotation drives everyone.

## 6. Jam sessions (`com.retroo.jam`)

Watch-together rooms: one **host** drives playback, **guests** follow, everyone chats (contract: gemini.md §8).
Lifecycle is REST; everything live inside a jam is STOMP.

### 6.1 In-memory model — why no database?
A jam lives at most two hours and nothing in it is worth keeping, so the store is a
`ConcurrentHashMap<String code, JamSession>` inside `JamService`: no schema, no cleanup job, no stale rows.
Trade-offs: a restart ends every jam, and state is per instance (scale-out → Redis hash per jam + pub/sub).
Memory is bounded by the limits: `maxActive (50) × (maxMembers (50) + chatHistory (100))`.

### 6.2 `JamSession` — one jam and its lock
Holds code, name, host name, the host token (bytes), `createdAt`, `expiresAt`, `extended`, the one-shot
`endingSoonSent` flag, the current `PlaybackState`, members (`LinkedHashMap<stompSessionId, displayName>`, join
order) and chat (`ArrayDeque` ring buffer trimmed to `chatHistory`).
* **Locking:** STOMP frames for one jam arrive on different inbound threads and the sweeper runs on the scheduler
  thread, so every method touching mutable state is `synchronized` on the session. The lock is **per jam** (two
  jams never contend), critical sections are tiny, and nothing is broadcast while holding it.
* `isHost(token)` compares with `MessageDigest.isEqual` (constant time); the token never leaves the class.
* `extend()` succeeds once; `shouldWarnEndingSoon()` returns true exactly once per deadline (reset by extend).
* `addMember()` is idempotent for the same session and enforces the member cap.
* `summary()` / `snapshot()` return immutable records, so a slow subscriber can't observe later changes.

### 6.3 `JamService` — the use-cases
| Method | Notes |
|---|---|
| `create(req, ip)` | create rate limit → 429; normalise names (trim, collapse whitespace, strip control chars) → 400 if empty/too long; active cap → **503** (`ApiException.ServiceUnavailable`); 6-char code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `SecureRandom`, `putIfAbsent` retries on collision; 32-byte base64url host token returned **once** |
| `list()` / `snapshot(code)` | lobby newest-first (expired-but-unswept jams hidden); snapshot = summary + members + playback + last 50 chat + `serverTime`; codes are case-insensitive |
| `extend(code, token)` | 403 wrong token, 409 already extended; +60 min, SYSTEM chat, `EXTENDED` event |
| `end(code, token)` | 403 wrong token; removes the jam, `ENDED {HOST_ENDED}` |
| `join(code, sessionId, name, token?)` | valid host token → joins under the host's own name; cap → `JAM_FULL`; first join emits SYSTEM "X joined" + `MEMBERS` |
| `leave` / `leaveAll(sessionId)` | SYSTEM "X left" + `MEMBERS` |
| `chat(code, sessionId, text)` | must be a member (`FORBIDDEN`); per-member limit (`RATE_LIMITED`); 1–280 chars (`INVALID`); author taken from the member registry, never from the client; playlist link → kind `PLAYLIST` + canonical URL |
| `control(code, cmd)` | host token required (`FORBIDDEN`); `LOAD` needs a song with an 11-char videoId; `PLAY`/`PAUSE`/`SEEK` before any LOAD → `INVALID`; missing `positionSec` = server-extrapolated position; the **server stamps `updatedAt`** so all guests extrapolate from one clock |

REST-side failures throw `ApiException` (→ ProblemDetail); STOMP-side failures throw `JamException(code)`.
Commands for an unknown or expired jam give `NOT_FOUND`; malformed commands give `INVALID`.

### 6.4 Lifecycle & sweeper
`@Scheduled(fixedDelayString = "${retroo.jam.sweep-interval}")` (15 s) walks a copy of the jams:
expired → remove + `ENDED {EXPIRED}`; ≤ `ending-soon-before` (5 min) left → `ENDING_SOON {expiresAt}` once.
Precision is ± one interval — fine for a 60-minute room. Expired jams are also treated as missing by every
read/command even before the sweeper runs. Removal uses `map.remove(code, session)` so a jam is only ended once.

### 6.5 STOMP flow & per-session errors (`JamStompController`)
```
client ── SUBSCRIBE /topic/jam/{code} ───────────────▶ broker   (events for everyone in the jam)
client ── SUBSCRIBE /user/queue/jam-errors ───────────▶ broker   (rewritten to /queue/jam-errors-user{sessionId})
client ── SEND /app/jam/{code}/join|leave|chat|control ─▶ @MessageMapping → JamService
JamService ── convertAndSend(/topic/jam/{code}, JamEvent{type,payload,serverTime}) ──▶ all subscribers
JamException ── @MessageExceptionHandler ── convertAndSendToUser(sessionId, /queue/jam-errors) ──▶ sender only
```
**Errors without a login:** there is no `Principal`, so the handler addresses the STOMP *session id* and sets that
id in the message headers (`SimpMessageHeaderAccessor.setSessionId` + `setLeaveMutable`). Spring's
`DefaultUserDestinationResolver` then targets exactly that session's `/user/queue/jam-errors` subscription.
Unexpected exceptions (malformed JSON, …) are answered with `INVALID` instead of being dropped silently.

**Ordering:** with the inbound/outbound ordering flags in `WebSocketConfig`, a client can SUBSCRIBE and immediately
SEND `join` on the same connection, and receives events in the order they were published.

### 6.6 Membership cleanup (`JamMembershipListener`)
* `SessionDisconnectEvent` (tab closed, network lost, heart-beat timeout) → `leaveAll(sessionId)`.
* UNSUBSCRIBE frames carry only a subscription id, so on `SessionSubscribeEvent` for `/topic/jam/{code}` the listener
  records `sessionId:subscriptionId → code`, and on `SessionUnsubscribeEvent` looks it up and leaves that jam.
* The host dropping off does **not** end the jam — they can rejoin with their token.

### 6.7 `JamController` (REST)
`POST /api/jams` (201), `GET /api/jams`, `GET /api/jams/{code}` (both `no-store`), `POST /api/jams/{code}/extend`,
`DELETE /api/jams/{code}`. Host-only routes read the token from the `X-Jam-Token` header (headers stay out of access
logs and browser history, unlike query strings).

### 6.8 Serialisation detail
The app uses `default-property-inclusion: non_null`. `JamSnapshot.playback` is annotated
`@JsonInclude(ALWAYS)` so it is sent as `null` before the first LOAD (contract: `PlaybackState | null`). Other null
fields are omitted: SYSTEM chat messages have **no `author`**, non-playlist messages have no `playlistUrl`.

### 6.9 Configuration (`retroo.jam.*`)
`ttl 60m`, `extension 60m`, `ending-soon-before 5m`, `max-active 50`, `max-members 50`,
`create-rate-limit 3/1h`, `chat-rate-limit 5/10s`, `chat-history 100`, `snapshot-chat 50`, `sweep-interval 15s`.
The test profile raises the create limit (many jams from 127.0.0.1) and slows the sweeper (unit tests call
`sweep()` directly with a fake clock).

---

## 7. Tests (`src/test`)
| Test | Type | Proves |
|---|---|---|
| `YouTubeLinkParserTest` | parameterised unit | 26 cases: accepted/rejected links incl. look-alike hosts, XSS strings, playlist links inside chat text |
| `RateLimiterTest` | unit with fake `Clock` | limit, `Retry-After`, per-key isolation, window reset |
| `SongServiceTest` | unit, Mockito | exclusion logic, fallback, 404/400, oEmbed enrichment, duplicates |
| `ApiIntegrationTest` | `@SpringBootTest` + MockMvc + H2 | migrations + `validate`, JSON shapes, ProblemDetail, 409, 429, admin auth, actuator |
| `PresenceWebSocketTest` | `RANDOM_PORT` + real STOMP clients | count goes 1 → 2 → 1 on connect/disconnect |
| `JamServiceTest` | unit, fake `Clock`, mocked broker (17) | create/code/token/TTL, create rate limit, 503 cap, extend once, host-only end, sweeper warns once then removes, extension outlives first deadline, join/leave/cap/idempotency, host rejoin name, chat membership + server-side author, playlist detection, chat rate limit + length, bounded history, host-only control, server-stamped position extrapolation, invalid videoId |
| `JamApiIntegrationTest` | `@SpringBootTest` + MockMvc (3) | create → list → get (case-insensitive, no token leak, `playback: null`) → extend (403/200/409) → end (403/204) → 404; validation errors; unknown code |
| `JamWebSocketTest` | `RANDOM_PORT` + two real STOMP clients (1) | REST create, host+guest join, MEMBERS, chat to both (PLAYLIST kind), guest control → private `FORBIDDEN` on `/user/queue/jam-errors` (host gets nothing), host LOAD → STATE to guest, disconnect shrinks members |

Run: `./mvnw test` (**65 tests**).

---

## 8. Operational notes
* Health: `/actuator/health`, `/actuator/health/liveness`, `/actuator/health/readiness` (Docker HEALTHCHECK uses
  readiness).
* Docker image: 3-stage build (Maven → layer extraction → JRE-alpine, non-root user, `MaxRAMPercentage=75`).
* Graceful shutdown lets in-flight requests finish on deploy.
