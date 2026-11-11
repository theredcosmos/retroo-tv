# Interview question bank — Retroo TV

Questions an interviewer may ask about this project, grouped by topic, with model answers grounded in this
codebase. Answers are deliberately short — expand with your own words and the file references.

**How to use this:** be able to (1) explain *what* the code does, (2) *why* this design was chosen, and (3) *what
you'd change* at larger scale. Section 15 has the "tell me about a bug you fixed" stories.

---

## 1. Project overview (the 2-minute pitch)

**1. Describe the project in one minute.**
A full-stack "time-travel TV": a CSS-drawn retro CRT plays YouTube music videos from a chosen decade. Spring Boot
serves a catalog, random-song selection and a shared-playlist feed over REST, and pushes live listener counts and
new playlists over STOMP WebSockets. Angular 20 (signals, zoneless) renders the UI and drives the YouTube IFrame
player. Flyway manages an Oracle (prod) / H2 (dev) schema, and everything ships as Docker images behind nginx.

**2. What was the hardest part?**
Coordinating three asynchronous sources — HTTP, WebSocket and the YouTube player's callbacks — without race
conditions: rapid channel changes (sequence-number guard), unplayable videos (skip with a loop limit), autoplay
policies (cue first, play on the first click), and the WebSocket "initial state" race (`@SubscribeMapping`).

**3. What would you improve with more time?**
Testcontainers-based Oracle integration tests, Redis for presence and rate limits so the API can scale
horizontally, a moderation queue for shared playlists, Playwright end-to-end tests, and a per-decade
pre-shuffled queue to avoid repeats across a whole session.

**4. Why YouTube Music rather than hosting audio?**
Licensing. The YouTube IFrame Player API is the ToS-compliant way to play that content; we store only video ids
and metadata.

**5. How is this "industry-level" rather than a toy?**
Layered architecture, DTOs, validation, RFC 7807 errors, Flyway migrations, profiles, typed config with fail-fast
validation, rate limiting, constant-time auth, after-commit events, health probes, multi-stage non-root Docker
images, CSP headers, CI, 52 automated tests, accessibility and reduced-motion support, and documentation.

**6. Walk me through what happens when I click "90s".**
See `docs/ARCHITECTURE.md §2.2`: store sets `tuning` (static shown), calls `GET /api/songs/random?decade=90s`,
waits ≥600 ms, checks the request is still the latest, then `player.loadVideoById()`; the header link, knob angle
and OSD update reactively from signals.

## 2. System design & architecture

**7. Draw the architecture.** Browser (Angular) → nginx (static + reverse proxy) → Spring Boot (REST, STOMP broker)
→ Oracle. Browser ↔ YouTube directly for video. (Diagram in ARCHITECTURE.md.)

**8. Why a layered (controller/service/repository) design?**
Separation of concerns: HTTP translation, business rules and persistence change for different reasons; each layer
can be tested in isolation (MockMvc, Mockito, `@DataJpaTest`).

**9. Why DTOs instead of returning entities?**
Stable API contract independent of the schema, no lazy-loading/serialization surprises, no accidental exposure of
internal columns, and validation lives on input DTOs.

**10. How do the frontend and backend share the contract?**
DTO records in Java mirrored by TypeScript interfaces in `core/models.ts`, documented in `gemini.md §4` and the
OpenAPI spec. Next step: generate the TS client from `/v3/api-docs` (openapi-generator) to remove drift.

**11. REST vs WebSocket — how did you decide what goes where?**
Request/response data the client asks for (catalog, random song, feed page, share) is REST — cacheable,
idempotent where possible, easy to test. Server-initiated, many-recipient events (listener count, new playlists)
are WebSocket pushes.

**12. Why STOMP on top of WebSocket?**
Raw WebSocket is just frames; STOMP adds destinations, subscriptions, headers and heart-beats, and Spring has a
broker for it. That gives pub/sub (`/topic/...`) and request/reply (`/app/...`) for free.

**13. Why no SockJS?**
All supported browsers have native WebSocket; SockJS adds weight and long-polling fallbacks we don't need. Behind a
corporate proxy that blocks WS it could be re-enabled with `.withSockJS()`.

**14. How would you scale to 100k concurrent listeners?**
Multiple API nodes; replace the simple broker with a STOMP broker relay (RabbitMQ) or Redis pub/sub so every node
sees every message; aggregate presence in Redis (per-node counts or a set with TTL); Redis-backed rate limits; CDN
for static assets and `/api/decades`; read replicas if the DB becomes hot; tune nginx `worker_connections`.

**15. What is the single point of failure today?**
The single API instance (in-memory broker, presence and rate limiter) and the single DB. Mitigations above.

**16. What is eventual consistency here?**
The listener count can be briefly stale (heartbeat every 15 s corrects missed messages); the feed may show an
entry slightly before/after other clients. Neither needs strong consistency.

**17. Where did you apply the "single source of truth" principle?**
Schema → Flyway; config → `RetrooProperties`; UI state → `PlayerStore`/`FeedStore`; API contract → `gemini.md`.

**18. Monolith or microservices? Why?**
A modular monolith: one deployable with clear packages. The domain is small; microservices would add network
hops, distributed transactions and ops cost with no benefit.

## 3. Spring Boot fundamentals

**19. What does `@SpringBootApplication` do?**
`@Configuration` + `@EnableAutoConfiguration` + `@ComponentScan` of the package and sub-packages.

**20. How does auto-configuration work?**
Starters put libraries on the classpath; auto-config classes (listed in `AutoConfiguration.imports`) are guarded by
`@ConditionalOnClass/OnMissingBean/OnProperty` and create beans (DataSource, EntityManagerFactory, Jackson…) unless
you define your own.

**21. Constructor vs field injection — which and why?**
Constructor injection everywhere: dependencies are explicit and `final`, objects are never half-built, and unit
tests can `new` the class with mocks (see `SongServiceTest`).

**22. `SongService` has two constructors. How does Spring choose?**
With more than one constructor Spring needs a hint; the public one is `@Autowired`. The package-private one accepts a
`RandomGenerator` for deterministic tests. (We hit "No default constructor found" before adding it.)

**23. What are profiles and how are they used here?**
`dev` (default, H2 file DB, dev admin key), `test` (in-memory H2), `prod` (Oracle from env vars, Swagger off).
`spring.profiles.default=dev` applies only when no profile is active.

**24. `@ConfigurationProperties` vs `@Value`?**
Type-safe, grouped, immutable (record), IDE-completable, and validated at start-up with `@Validated`. `@Value` is
fine for one-offs but scatters configuration.

**25. How does `10m` become a `Duration`?**
Spring Boot's conversion service understands simple duration formats (`10m`, `15s`) for `Duration` properties.

**26. What is the bean scope of your services?**
Singleton (default). That's why `PresenceService`/`RateLimiter` state uses concurrent collections.

**27. What does `@EnableScheduling` enable and what runs on it?**
`@Scheduled` methods on a scheduler thread: presence heartbeat (`fixedRateString` from config) and rate-limiter
eviction (`fixedDelay`).

**28. `fixedRate` vs `fixedDelay` vs `cron`?**
`fixedRate` = start-to-start interval; `fixedDelay` = end-to-start; `cron` = calendar expression.

**29. What is `open-in-view` and why disable it?**
OSIV keeps the Hibernate session open during view rendering so lazy loading works in controllers — hiding N+1
queries and holding connections longer. We map to DTOs inside transactions, so it's off.

**30. What does graceful shutdown do?**
On SIGTERM, the server stops accepting new requests and lets in-flight ones finish (default 30 s) — important for
rolling deployments.

**31. What does `server.forward-headers-strategy: framework` do?**
Installs `ForwardedHeaderFilter` so `request.getRemoteAddr()`/scheme reflect `X-Forwarded-*` from nginx — needed for
per-IP rate limiting. Only safe when the app is reachable solely through the trusted proxy.

**32. What is Spring Boot Actuator used for here?**
`/actuator/health` with liveness/readiness groups for Docker/Kubernetes probes; only `health,info` are exposed.

**33. How would you add metrics?**
Micrometer is already pulled in by Actuator; add `micrometer-registry-prometheus`, expose `/actuator/prometheus`,
and record custom counters (shares, skips) and a gauge for listeners.

## 4. REST API design

**34. Why `GET /api/songs/random` instead of `/api/songs/{id}`?**
The client doesn't know ids; the server owns randomness and exclusion logic, keeping the client thin.

**35. Why is `/random` marked `Cache-Control: no-store` but `/decades` cacheable?**
Every random call must be a fresh draw; the decade list changes rarely, so 5 minutes of caching is safe.

**36. Which status codes does the API use and why?**
200, 201 (created + body), 204 (delete), 400 (validation/semantic), 401 (bad/missing key), 403 (admin disabled),
404, 409 (duplicate), 429 (rate limited + `Retry-After`), 500 (unexpected).

**37. 401 vs 403?**
401: "who are you?" — credentials missing/invalid. 403: "I know, but no" — here, the admin API is disabled.

**38. What is RFC 7807 / ProblemDetail?**
A standard JSON error format (`type, title, status, detail, instance` + extensions). Spring 6 has `ProblemDetail`
built in; we add an `errors` map for field validation.

**39. Why a custom `PageResponse` instead of returning `Page<T>`?**
`PageImpl`'s JSON is an implementation detail (Spring Data even warns about it); our envelope is a stable contract.

**40. How do you prevent huge page sizes?**
`size` is clamped to 1–50 in `PlaylistService.feed`.

**41. Is `POST /api/playlists` idempotent? How do you avoid duplicates?**
POST isn't idempotent by definition, but duplicates are rejected: canonical playlist id + display name are unique
(pre-check for a friendly 409, DB unique constraint as the real guarantee, `DataIntegrityViolationException` → 409
for the race). An `Idempotency-Key` header would be the general solution.

**42. How do you version the API?**
Not versioned yet (single client deployed together). I'd add `/api/v2/...` or a media-type version only when a
breaking change is required, keeping v1 alive during migration.

**43. Why does the server canonicalise playlist URLs?**
The same playlist can be linked via youtube.com, m.youtube.com, music.youtube.com with tracking params (`si=`).
Canonicalising gives one identity for dedupe and strips tracking.

## 5. JPA, Hibernate & database

**44. Why `GenerationType.IDENTITY`?**
Both Oracle 12c+ and H2 support identity columns; simple and portable. Trade-off: disables JDBC batch inserts in
Hibernate (a `SEQUENCE` with pooled optimizer would allow batching).

**45. How do you pick a random row without `ORDER BY RAND()`?**
`COUNT(*)` for the decade, random offset in Java, then fetch one row with `PageRequest.of(offset, 1)` (Hibernate
renders `OFFSET … FETCH NEXT 1 ROWS ONLY`). Avoids sorting the whole table and vendor functions like
`DBMS_RANDOM`.

**46. What's the weakness of the offset approach?**
Two queries and a tiny race if rows change between them (we'd get an empty list — could retry). Large offsets cost
O(offset) scanning; for millions of rows pick a random id in `[min,max]` with `id >= ?` or pre-shuffle.

**47. Why store the enum as a slug with an `AttributeConverter`?**
`ORDINAL` breaks when constants are reordered; `STRING` would store `NINETIES`, not matching the API/CHECK
constraint. The converter stores `"90s"`.

**48. What is the N+1 problem? Is it present here?**
Loading N parents then lazily loading each child = N+1 queries. There are no associations, and the decade counts use
one `GROUP BY` query instead of seven `COUNT`s.

**49. What's an interface projection?**
`SongRepository.DecadeCount` — Spring Data maps the JPQL aliases `decade`/`total` onto interface getters, so we fetch
only what we need instead of entities.

**50. Why `@Transactional(readOnly = true)` at class level?**
Hibernate skips dirty checking/flush, the driver can optimise or route to a replica, and it documents intent. Write
methods override with `@Transactional`.

**51. What indexes exist and why?**
`IX_SONGS_DECADE` (every playback query filters by decade), `IX_SHARED_PLAYLISTS_CREATED DESC` (feed ordering),
plus the unique indexes behind `UK_SONGS_VIDEO_ID` and `UK_SHARED_PLAYLIST`.

**52. Why a CHECK constraint on DECADE when the enum already validates?**
Defence in depth: the database stays consistent even if someone writes SQL directly or another service writes.

**53. Why does `Song` have no setters?**
Immutability by default: state is set through a constructor; JPA uses field access and a protected no-arg
constructor.

**54. Why is `createdAt` set with `@PrePersist` in `Song` but with an injected `Clock` in `SharedPlaylist`?**
Feed ordering is behaviour we want deterministic in tests, so it takes the `Clock`; the song timestamp is only
audit info.

**55. How are `Instant`s stored?**
`hibernate.type.preferred_instant_jdbc_type=TIMESTAMP` + `jdbc.time_zone=UTC` → plain `TIMESTAMP` in UTC, matching
the DDL and avoiding `TIMESTAMP WITH TIME ZONE` validation mismatches.

**56. Why Oracle in production?**
Requirement of the target environment (common in enterprise). Free 23ai image for local/compose. The code avoids
vendor lock-in except in the DDL folder.

**57. How do you connect to Oracle in Docker?**
`jdbc:oracle:thin:@database:1521/FREEPDB1` — service name of the pluggable DB; the compose service waits on the
image's `healthcheck.sh`.

**58. What's HikariCP and what did you configure?**
Spring Boot's default connection pool; prod sets `maximum-pool-size: 10` and a 10 s connection timeout.

## 6. Flyway & migrations

**59. Why Flyway instead of `ddl-auto: update`?**
Versioned, reviewable, repeatable migrations; `update` can't drop/rename safely and differs between environments.
Hibernate runs in `validate` mode to catch drift at start-up.

**60. Why are there `oracle/` and `h2/` folders?**
Under `validate`, Hibernate expected `BIGINT` for `Long` but H2 reported `NUMBER(19)` as `NUMERIC` and failed.
Flyway's `{vendor}` placeholder picks the right DDL folder; seed data in `common/` is shared.

**61. What happens if you edit an applied migration?**
Flyway's checksum validation fails on start-up. You add a new `V3__...` instead.

**62. How is the seed data idempotent?**
Flyway runs each versioned migration exactly once (tracked in `flyway_schema_history`), and `VIDEO_ID` is unique.

**63. How did you make sure seed video ids are real?**
Each id was verified against YouTube's oEmbed endpoint before writing the migration (documented in the SQL header).

**64. How do you handle a zero-downtime column rename?**
Expand/contract: add the new column, dual-write, backfill, switch reads, then drop the old column in a later release.

## 7. WebSockets, STOMP & realtime

**65. How is the listener count computed?**
`PresenceService` keeps a concurrent set of STOMP session ids, adding on `SessionConnectedEvent`, removing on
`SessionDisconnectEvent`, broadcasting the size to `/topic/listeners`.

**66. Why a `Set` instead of an `AtomicInteger`?**
Events can be duplicated or arrive out of order; set add/remove is idempotent, a counter would drift.

**67. How are closed tabs or dead connections detected?**
STOMP heart-beats (client 10 s) and TCP close. Missing heart-beats make the server close the session, firing
`SessionDisconnectEvent`.

**68. Why did the v1 design (SESSIONS table + ping endpoint) get replaced?**
It needed a DB write per client every few seconds, a cleanup job, `sendBeacon` on unload, and was only
approximately right. WebSocket presence is exact and free.

**69. Explain `@SubscribeMapping` and why it's needed.**
When a client subscribes to `/app/listeners`, the return value is sent once, directly to that session — the
standard "initial state" pattern. Broadcasting on `SessionSubscribeEvent` raced the broker registering the
subscription, so new clients sometimes missed the value (our WebSocket test caught it).

**70. What's the difference between `/app` and `/topic` destinations?**
`/app/**` goes to `@MessageMapping`/`@SubscribeMapping` controller methods; `/topic/**` goes straight to the broker
for fan-out to subscribers.

**71. How does a new playlist reach all browsers?**
`PlaylistService` publishes a domain event; `@TransactionalEventListener(AFTER_COMMIT)` calls
`SimpMessagingTemplate.convertAndSend("/topic/playlists", dto)`.

**72. Why after commit?**
If the transaction rolled back (e.g. unique violation), clients would otherwise show an entry that doesn't exist.

**73. What if the server crashes between commit and broadcast?**
That message is lost (clients still see it on next load). If it mattered: transactional outbox table + relay.

**74. How does the simple broker behave with multiple instances?**
Each instance has its own broker; clients on node A won't get messages produced on node B. Fix: broker relay
(RabbitMQ STOMP) or Redis pub/sub bridge.

**75. Sticky sessions — needed?**
A WebSocket stays on one node anyway; with a broker relay you don't need stickiness for correctness.

**76. How does the client handle reconnects?**
RxStomp reconnects every 3 s; `watch()` re-subscribes automatically, and the `/app/listeners` subscription delivers
a fresh snapshot; the badge dot turns grey while not `OPEN`.

**77. How is the WebSocket secured?**
Same origin behind nginx; in dev, `setAllowedOrigins` restricts origins (prevents cross-site WebSocket hijacking).
No sensitive data is pushed. For authenticated channels, validate a token in a `ChannelInterceptor` on CONNECT.

**78. How did you test WebSockets?**
`PresenceWebSocketTest` starts the app on a random port and connects two real `WebSocketStompClient`s, asserting
1 → 2 → 1 as clients connect/disconnect.

## 8. Concurrency & Java

**79. Which shared mutable state exists and how is it made thread-safe?**
Presence set (`ConcurrentHashMap.newKeySet()`), rate-limiter map (`ConcurrentHashMap.compute`, atomic per key).
Everything else is stateless or request-scoped.

**80. Why `compute()` rather than `get` then `put`?**
`get`+`put` is check-then-act — two threads could both read count 2 and both write 3. `compute` runs the remapping
atomically for that key.

**81. Explain the rate-limiting algorithm and its weakness.**
Fixed window: counter + window start per IP; reset when the window passes. Weakness: up to 2× the limit around a
window boundary. Sliding log / sliding window counter / token bucket fix that.

**82. How do you prevent the rate-limiter map from growing forever?**
Scheduled eviction removes expired windows every minute.

**83. Why inject a `Clock`?**
Time-dependent logic becomes testable: `RateLimiterTest` advances a fake clock instead of sleeping.

**84. Why `RandomGenerator` (Java 17) instead of `new Random()`?**
Modern interface, pluggable algorithms, and injectable — tests pass a deterministic implementation.

**85. Where are Java records used and why?**
DTOs, config properties, internal value types (`Decision`, `PlaylistRef`, `Window`) — immutable, concise, with
`equals/hashCode/toString`.

**86. What does `MessageDigest.isEqual` protect against?**
Timing attacks: `String.equals` returns at the first different byte, leaking how much of the key matched.

**87. Text blocks, `var`, pattern matching — where used?**
Text blocks in test JSON bodies; `var` for obvious local types; pattern matching `instanceof` in the exception handler
(`ex instanceof ApiException.TooManyRequests tmr`).

## 9. Security

**88. What are the main threats and mitigations?**
Spam/abuse → rate limit + validation + length limits; phishing links → host allow-list + canonical URLs; XSS →
Angular escapes interpolation, no `innerHTML`, CSP; admin abuse → secret header, constant-time compare,
fail-closed; info leaks → generic 500s; CSRF → no cookies/sessions are used.

**89. Is the app vulnerable to XSS via shared notes?**
No: Angular interpolation escapes by default, we never bind `[innerHTML]`, and nginx sends a CSP. The server also
strips control characters.

**90. Why `rel="noopener noreferrer"` on external links?**
`noopener` prevents the opened page from controlling `window.opener` (reverse tabnabbing); `noreferrer` hides our URL;
`nofollow` on user-submitted links avoids rewarding spam.

**91. Why is the admin API disabled when no key is set?**
Fail-closed: a forgotten environment variable must not leave an open admin endpoint.

**92. Why not Spring Security?**
One operator and two endpoints — an interceptor is smaller and clearer. With multiple admins or roles I'd use Spring
Security with OAuth2/JWT and method security.

**93. How are secrets managed?**
Environment variables / `.env` (git-ignored, `.env.example` committed). In Kubernetes: Secrets or a vault.

**94. Is `X-Forwarded-For` spoofable?**
Yes if the app is reachable directly. That's why the backend isn't published in compose — only nginx can reach it,
and nginx overwrites the header chain.

**95. Explain the CSP in nginx.conf.**
Only same-origin scripts plus YouTube's player scripts; frames only from youtube.com; images from self/ytimg;
fonts/styles from Google Fonts; `connect-src 'self' ws: wss:` for API and WebSocket.

**96. How is the Docker image hardened?**
JRE-only alpine base, non-root user, no build tools in the final stage, healthcheck, memory-aware JVM flags.

## 10. Validation & error handling

**97. Where does validation happen?**
Three places: Angular form validators (instant UX), Bean Validation on DTOs (shape), service rules (semantics:
YouTube host, duplicates, rate limit). The client is never trusted.

**98. How do field errors reach the right form control?**
`GlobalExceptionHandler` returns `errors: {field: message}`; the interceptor maps it to `ApiError.fieldErrors`;
the dialog calls `form.get(field).setErrors({server: message})`.

**99. Why an exception hierarchy instead of returning `ResponseEntity` from services?**
Keeps HTTP out of the service layer; one handler decides the representation; services stay reusable (e.g. from a
STOMP controller or a batch job).

**100. What happens on an unexpected exception?**
Logged with stack trace server-side; client gets a generic 500 ProblemDetail without internals.

**101. How do you handle the duplicate-insert race?**
Pre-check gives a friendly message; if two requests race past it, the unique constraint throws
`DataIntegrityViolationException`, mapped to 409.

## 11. Testing

**102. What's your test pyramid here?**
Many fast unit tests (parser, rate limiter, services, pipe, validator, store), fewer integration tests (MockMvc with
real DB and migrations), one real-socket WebSocket test. Next: a few Playwright E2E tests.

**103. Why test with H2 if prod is Oracle? Risks?**
Speed and zero setup; Oracle mode and vendor DDL reduce differences. Risk: dialect gaps. Mitigation: Testcontainers
Oracle in a nightly CI job.

**104. What does `ApiIntegrationTest` prove that unit tests can't?**
That migrations run, entities match the schema (`validate`), JSON serialisation, validation, exception mapping,
interceptor registration, headers like `Retry-After`, and actuator wiring all work together.

**105. How do you test randomness?**
Inject a deterministic `RandomGenerator` in unit tests; in integration tests assert invariants over many calls
(right decade, never the excluded id).

**106. How do you test time?**
A fake `Clock` that the test advances.

**107. How did you test the frontend store without YouTube?**
`FakeYouTube` replaces `YouTubePlayerService` via DI; `RetrooApi` is a Jasmine spy; `fakeAsync`/`tick` control the
600 ms tuning delay and RxJS `delay`.

**108. Why is zone.js in devDependencies if the app is zoneless?**
Only for `fakeAsync` in tests (test-only polyfill); the production bundle doesn't include it.

**109. How would you test the CRT visual design?**
Visual regression snapshots (Playwright screenshots) at desktop/mobile widths.

## 12. Angular

**110. What are standalone components and why use them?**
Components that declare their own `imports` — no NgModules. Less boilerplate, better tree-shaking, clearer
dependencies; the default since Angular 17+.

**111. What are signals?**
Reactive values (`signal`, `computed`, `effect`) that track who reads them, so Angular updates exactly the affected
views. Synchronous, glitch-free, no subscriptions to manage.

**112. Signals vs RxJS — when do you use which?**
Signals for state (current song, listeners, status). RxJS for streams over time (HTTP, WebSocket frames, `ended$`).
Bridge with `firstValueFrom`, `takeUntilDestroyed`, or `toSignal`.

**113. What is zoneless change detection?**
Angular no longer relies on zone.js to detect async activity; signal writes, events and `markForCheck` schedule
rendering. Smaller bundle, fewer checks; callbacks from third-party code (YouTube) work without `NgZone.run`.

**114. Why `OnPush` on every component?**
Components re-render only when inputs/signals they read change or events fire — predictable and fast (and aligned
with zoneless).

**115. What do `afterNextRender` and `viewChild.required` do in `CrtTvComponent`?**
`viewChild.required` is a signal query for the iframe host element; `afterNextRender` runs once the DOM exists (and
only in the browser), which the YouTube API needs.

**116. What does `effect()` do and where is it used?**
Runs a side effect when signals it reads change: flash the OSD on channel change (with `untracked` for the timer
logic), run/stop the noise animation, reset the skip counter when a video plays.

**117. What's `untracked` for?**
Reading signals inside an effect without making them dependencies — prevents accidental re-runs/loops.

**118. Explain the new control flow (`@if`, `@for`, `@let`).**
Built-in template syntax replacing `*ngIf/*ngFor`; `@for` requires `track` (we track by id/slug) and supports
`@empty`; `@let` declares a template variable (`@let song = player.current()`).

**119. Why `track p.id` in `@for`?**
So Angular reuses DOM nodes for the same item instead of re-creating the list — important for the animated feed.

**120. How do you inject dependencies in Angular 20 style?**
`inject()` function in field initialisers — works in services, components, directives and functional interceptors.

**121. What is a functional interceptor?**
`HttpInterceptorFn` — a plain function `(req, next) => …`, registered with `withInterceptors([...])`.

**122. Why `withFetch()`?**
Uses the Fetch API backend for HttpClient (better streaming, SSR-friendly).

**123. Root-provided singletons — any pitfalls?**
State survives component re-creation. We hit this: after a hot reload the TV component re-rendered but the
singleton player still pointed at the detached iframe. Fix: `mount()` re-creates the player when the host element
changes.

**124. How do you avoid memory leaks with subscriptions?**
`takeUntilDestroyed(destroyRef)` on long-lived streams, HTTP observables complete on their own, `DestroyRef.onDestroy`
deactivates STOMP, the noise directive cancels `requestAnimationFrame` in `ngOnDestroy`.

**125. What does `PlayerStore.tuneTo` protect against?**
Out-of-order responses: each call takes a sequence number; stale results are ignored — the async/await equivalent
of RxJS `switchMap`.

**126. Why not NgRx?**
State is small and local; signal stores give the same one-way flow without actions/reducers boilerplate. NgRx
SignalStore would be the next step for a larger team.

**127. How are environment-specific settings handled?**
`environment.ts` / `environment.development.ts` with `fileReplacements` in `angular.json`; API base is same-origin and
the WS URL derives from `location`.

**128. How does the dev proxy work?**
`proxy.conf.json` forwards `/api` and `/ws` (with `ws: true`) from `:4200` to `:8080`, so the browser sees one origin
— no CORS in dev either.

## 13. Forms, UX & accessibility

**129. Typed reactive forms — benefit?**
`NonNullableFormBuilder` gives `form.getRawValue()` a precise type; misspelled controls are compile errors.

**130. Why a native `<dialog>`?**
`showModal()` provides focus trapping, Esc to close, an inert background and top-layer stacking — accessibility
features you'd otherwise rebuild.

**131. How is the decade bar accessible?**
`role="radiogroup"` + `role="radio"` + `aria-checked`, roving tabindex, arrow-key navigation, label via
`aria-labelledby`.

**132. What about screen readers and the auto-scrolling feed?**
The duplicated copy is `aria-hidden` with untabbable links; the scroll pauses on hover/focus; reduced-motion users get
a static scrollable list.

**133. How do you respect `prefers-reduced-motion`?**
Global CSS reset for animations; the noise directive draws one frame; the feed stops scrolling.

**134. Why "Tap to tune in"?**
Browsers block autoplay with sound until the user interacts. We cue the first video, and the first click calls
`playVideo()` synchronously inside the gesture.

**135. Keyboard shortcuts — how do you avoid hijacking typing?**
The document listener ignores events whose target is inside inputs, textareas, dialogs or contenteditable, and
ignores modifier combos.

## 14. CSS, performance & YouTube integration

**136. How is the TV drawn without images?**
Layered gradients (wood grain via `repeating-linear-gradient`), inset/outer `box-shadow` for depth,
`repeating-conic-gradient` knobs, `border-radius: 16% / 12%` for the CRT curve, a scanline gradient with
`mix-blend-mode`.

**137. How do you crop a 16:9 video into a 4:3 screen?**
The iframe gets `height: 100%`, `aspect-ratio: 16/9`, centred with `left: 50%; translateX(-50%)` inside an
`overflow: hidden` tube — CSS "object-fit: cover" for an iframe.

**138. How is the static noise efficient?**
Tiny 160×120 canvas scaled with `image-rendering: pixelated`; a `Uint32Array` over `ImageData` writes one 32-bit value
per pixel; `requestAnimationFrame` only while visible.

**139. How does the knob rotate to the right decade?**
A `computed` angle (-135° + index·45°) bound to a CSS custom property `--angle`, with a springy cubic-bezier
transition.

**140. Bundle size and how you kept it small?**
~74 kB transferred initial. Zoneless (no zone.js), standalone tree-shaking, no UI library, CSS instead of images,
budgets in `angular.json` to fail the build on regressions.

**141. How does the app track playback progress?**
The IFrame API has no time event, so the adapter polls `getCurrentTime()` every 500 ms while playing and stops
otherwise.

**142. What if a video can't be embedded?**
YouTube fires `onError` with 101/150 (or 100 if removed); the store skips to the next song, max 5 in a row, then
shows NO SIGNAL with a retry button.

**143. Can you hide YouTube branding/ads?**
No — and we shouldn't; the ToS requires the player be visible and unmodified functionally. We only disable
controls/annotations via documented `playerVars`.

**144. How does the admin "add song" get title/artist without an API key?**
YouTube's public oEmbed endpoint returns title and channel name; we strip "- Topic"/"VEVO" suffixes.

## 15. DevOps, deployment & "war stories"

**145. Explain the backend Dockerfile.**
Stage 1 Maven build (dependency layer cached via `dependency:go-offline`); stage 2 extracts Spring Boot layers
(`-Djarmode=tools`) so dependency layers are reused between releases; stage 3 JRE-alpine, non-root, healthcheck on
readiness.

**146. Why nginx in front of the SPA?**
Serves static files efficiently with correct caching (hashed assets immutable, `index.html` no-cache), SPA fallback,
gzip, security headers, and a reverse proxy for `/api` and `/ws` → one origin.

**147. How does nginx proxy WebSockets?**
`proxy_http_version 1.1` plus `Upgrade`/`Connection` headers (via a `map`), and a long `proxy_read_timeout` so idle
listeners aren't cut.

**148. What does the CI pipeline do?**
Backend `mvnw verify` (uploads surefire reports), frontend `npm ci`, headless unit tests and a production build, then
both Docker images are built after tests pass.

**149. How would you deploy to the cloud?**
Push images to a registry; run on Kubernetes/ECS/Cloud Run with managed Oracle (Autonomous DB) or Postgres; wire
liveness/readiness probes to actuator; secrets from the platform; TLS at the load balancer. (Needs a broker relay
before scaling to more than one API replica.)

**150. Story: "Tell me about a bug you found through testing."**
The WebSocket integration test failed: new clients never received the listener count. Root cause — broadcasting on
`SessionSubscribeEvent` happens before the broker registers the subscription, so the message was dropped. Fix:
`@SubscribeMapping("/listeners")` request/reply for initial state + `/topic` for changes.

**151. Story: "A bug that only appeared in a specific environment."**
Schema validation failed only on H2: Oracle `NUMBER(19)` maps to `Long`, but H2 reported it as `NUMERIC` while
Hibernate expected `BIGINT`. Solution: vendor-specific DDL via Flyway `{vendor}` and a rule in the constitution
that both files stay identical.

**152. Story: "A UI bug that was hard to diagnose."**
The video looked blurred. Bisecting overlays showed the TV's `.glass` glare div matched the global `.glass` utility,
which adds `backdrop-filter: blur(14px)`. Renamed to `.glare`. Lesson: emulated encapsulation stops styles leaking
out of components, not global classes leaking in — namespace global utilities.

**153. Story: "A state bug."**
After a hot reload the TV stayed black: the root-scoped player service kept a player bound to a detached iframe.
`mount()` now detects a new host element, destroys the stale player and re-creates it.

**154. What would you monitor in production?**
Error rate and latency per endpoint, WebSocket session count, share rate and 429s, YouTube skip rate (catalog
health), JVM memory/GC, DB pool usage.

**155. How would you roll back a bad release?**
Images are immutable and tagged; redeploy the previous tag. Migrations are forward-only, so schema changes follow
expand/contract to remain backward compatible with the previous app version.

## 15b. Themes, flicker and the song catalog (v2.1)

**167. How did you implement themes without re-rendering components?**
Every colour is a CSS custom property; a theme is a block of variables under `html[data-theme='…']`. Switching is
one attribute write, the browser re-paints, and Angular change detection isn't involved. Components never hard-code
colours (we grepped for leftovers and replaced them with `var(--accent)` etc.).

**168. Why CSS variables rather than Angular-generated styles or multiple stylesheets?**
They cascade into encapsulated component styles, can be transitioned, need no rebuild, and are tiny. Multiple
stylesheets would require swapping `<link>`s (flash of unstyled content) or shipping everything anyway.

**169. Where is the theme stored and why not on the server?**
localStorage — it's a per-device presentation preference, not user data. Applied via `provideAppInitializer` so the
saved theme is set during bootstrap.

**170. Why not an inline `<script>` in index.html to avoid a theme flash?**
Our CSP (`script-src 'self'`) forbids inline scripts; adding a hash/nonce is possible but the initializer runs before
the first app paint anyway.

**171. How is the "90s TV losing signal" effect built?**
The store distinguishes a user channel change (≥1.5 s) from a song ending (≥3.2 s) via a `transition` signal; the
TV maps it to CSS classes that animate a rolling bright band (vertical hold), stepped brightness flicker, picture
roll/skew, and a "warm-up" when the next picture starts. A Web Audio noise generator adds the hiss.

**172. Why `steps()` timing functions for flicker?**
Real flicker is discontinuous; `steps(1, end)` jumps between keyframe values instead of tweening smoothly.

**173. How do you generate TV hiss without an audio file?**
Web Audio: a looped buffer of `Math.random()` samples → band-pass `BiquadFilter` → `GainNode` with
`setTargetAtTime` fades (avoids clicks). The AudioContext is created after the first click (autoplay policy).

**174. How did you find official YouTube ids for the Hindi songs?**
A deterministic Python tool (`tools/find_youtube_ids.py`): YouTube search page → candidate ids → oEmbed verification
→ scoring (all title keywords present with loose transliteration matching, reject remix/cover/lyrics/contest,
bonus for official labels like T-Series, Shemaroo, YRF, Saregama). Output reviewed by hand, then written as a new
Flyway migration (V3) — never editing the applied V2.

**175. Why add songs in V3 instead of editing V2?**
Flyway checksums applied migrations; editing V2 would fail validation on every database that already ran it.

**176. Your themes change the furniture, not just colours — how?**
Three layers per theme: CSS variables for colours, a scene component chosen by `@switch` for the room, and a
`data-model` attribute on the TV host that `:host([data-model=…])` rules use to restyle the same DOM. The TV DOM is
never swapped, so the YouTube iframe (and playback) survives a theme change.

## 15c. Jam sessions (watch-together)

**177. Explain the jam feature in one minute.**
A host creates a room and shares `/jam/CODE`. Everyone's browser plays its own YouTube player; the server relays the
host's playback state (song, playing, position, server timestamp) over STOMP and each guest corrects drift > 2 s.
A chat turns playlist links into cards. Jams live in server memory for 60 min, extendable once by 60 min, then a
sweeper deletes them.

**178. Why not stream the audio/video from the host?**
Licensing and bandwidth: YouTube content may only be played through the official player, and relaying media would
cost server bandwidth per guest. Syncing *state* costs a few bytes per event.

**179. How do you keep guests in sync?**
STATE events carry `positionSec` + `updatedAt` (server epoch ms); every event also carries `serverTime`, so the
client computes `offset = serverTime - Date.now()` and expected position =
`positionSec + (Date.now() + offset - updatedAt) / 1000` while playing. Guests seek only when off by more than 2 s
(avoids stutter), and the host sends a PLAY heartbeat every 15 s.

**180. Why use the server's clock instead of the device clock?**
Device clocks can be minutes off. Measuring against the server's timestamps removes that error; one-way latency
(tens of ms) is far below the 2 s tolerance.

**181. How is the host authenticated without accounts?**
On create the server returns a 32-byte random `hostToken` (SecureRandom, base64url) once. The client keeps it in
sessionStorage and sends it with control/extend/end; the server compares in constant time. Guests never see it.
Trade-off: whoever holds the token is the host — acceptable for an anonymous, short-lived room.

**182. Why is the chat author set by the server?**
To prevent spoofing: the name is bound to the STOMP session at `join`; chat frames contain only text.

**183. Why are jams in memory and not in the database?**
They are ephemeral by design (max 2 h), high-churn (chat, state every few seconds) and worthless after expiry.
Memory gives zero DB load and automatic cleanup. Costs: lost on restart and per-instance; for scale-out use Redis
(hash per jam + pub/sub) or a STOMP broker relay.

**184. How does expiry work?**
A `@Scheduled` sweeper every 15 s sends `ENDING_SOON` once at 5 min left, then `ENDED` and removes the jam at
expiry. Extending moves `expiresAt` by 60 min once (`extended` flag; a second attempt is 409).

**185. How do you protect the server from abuse?**
Caps: 50 active jams (503), 50 members per jam, 3 creates per IP per hour (429 + Retry-After), 5 chat messages per
10 s per member, 280-char messages, last 100 messages kept. All configurable under `retroo.jam.*`.

**186. How do you send an error to only one WebSocket client without login?**
User destinations: the client subscribes to `/user/queue/jam-errors`; the server calls
`convertAndSendToUser(sessionId, "/queue/jam-errors", payload, headers)` with headers carrying that session id, so it
resolves to exactly that connection — no `Principal` needed.

**187. What race did you hit with STOMP, and how was it fixed?**
A client's SUBSCRIBE followed by SEND `join` could be processed out of order by Spring's thread pools, so the join
broadcast could miss the new subscriber. Enabling ordered per-session processing (inbound and outbound) fixed it —
the same family as the earlier `@SubscribeMapping` initial-state race.

**188. What happens if the host's internet drops?**
The jam keeps running server-side and guests keep playing the current song. When the host reconnects, RxStomp
re-subscribes and the store re-sends `join` with the token, restoring host control. A page refresh auto-rejoins too.

**189. How are guests prevented from controlling playback?**
UI: `PlayerStore.followMode` turns intents into no-ops and disables buttons. Server: every control frame is checked
against the host token, and a guest's command gets a private `FORBIDDEN`. The server is the real gate.

**190. Bug story: "Enter didn't send the chat message."**
The submit button was `[disabled]` while the input was empty. With zoneless change detection, typing and pressing
Enter quickly meant the button was still disabled in the DOM, and a disabled default button blocks implicit form
submission. Fix: validate in the handler instead of disabling, and clear the input synchronously.

**191. Bug story: "Two tabs, one identity."**
Both test tabs shared `localStorage`, so a reloaded guest tab re-joined under the host's name. The per-tab name now
lives in `sessionStorage`; `localStorage` only pre-fills the form.

**192. How would you test synchronisation end to end?**
Two browser contexts (Playwright): host creates, guest joins; assert both show the same song and |Δposition| < 2 s
after play, pause and a channel change; assert guest controls are disabled and a forged control frame is FORBIDDEN.

## 15d. Product & design decisions (v2.3)

**193. The shared-playlist feed was "just links". How did you give it a purpose?**
Made playlists playable inside the product: "▶ Tune in" plays a listener's playlist on the TV with the same
transitions, and the jam host can put a chat-shared playlist on everyone's TV. A feature that only links out sends
users away; one that plays in place becomes content ("listener channels").

**194. How do you play an arbitrary YouTube playlist song-by-song with your own transitions?**
The IFrame API can't fetch a playlist, but `cuePlaylist()` loads its index into the player; polling `getPlaylist()`
returns the video ids. We then drive playback ourselves with `loadVideoById`, so static, signal-loss and jam sync work
exactly like decade songs. Metadata comes from `getVideoData()` after each video starts.

**195. How is the 2:1 Bollywood/Hollywood ratio implemented, and why client-side?**
A `LANG` column + `lang` query parameter; the client rotates `hi, hi, en` and sends the last 10 ids as `exclude`.
Keeping the counter on the client keeps the API stateless (no per-listener session) and in a jam the host's rotation
naturally applies to everyone. The server guarantees progress with ordered fallbacks.

**196. What made the first UI look "cheap", and what changed?**
Sharp, cartoon-like CSS objects (fans, palms, calendars), blinking text and neon buzz. Premium visuals borrow from
photography: one sharp subject, everything else out of focus; consistent light direction; film grain; ambient colour
spill from the screen; restrained typography and motion; fewer visible panels (jams moved to a drawer).

**197. How do you get a "photographic" look without images?**
Heavily blurred gradients that model *light* rather than objects (window light patches with mullion shadows, bokeh,
spotlights), `mix-blend-mode: screen` for light and `multiply` for texture, SVG `feTurbulence` for wood grain and
limewash, and a page-wide film grain at a few percent opacity.

**198. How does the ambient glow cross-fade without flicker?**
A `linkedSignal` keeps `[previous, current]` artwork URLs; `@for … track url` keeps the previous layer mounted while
the new one fades in on top, then the oldest drops out.

## 16. Quick-fire

156. Default port? **8080** (overridable via `PORT`). 157. Where's the OpenAPI spec? **`/v3/api-docs`**.
158. How many seeded songs? **123: 71 English (V2) + 52 Hindi (V3 + V5)**, tagged by `LANG` (V4). 159. Rate limit? **3 shares / 10 min / IP**.
160. Heartbeat? **15 s server broadcast; 10 s STOMP heart-beats**. 161. Minimum static time? **1.5 s channel change, 3.2 s between songs**.
162. Max feed size client-side? **40**. 163. "Previous" restarts the song when? **After 3 s of playback**.
164. Max consecutive skips? **5**. 165. Java version? **17 (runs on 21)**. 166. Angular version? **20**.
