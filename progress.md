# Progress Log

- **[2026-08-20]** Project memory initialised (`gemini.md`, `task_plan.md`, `findings.md`, `progress.md`).
- **[2026-08-20]** v1 scaffold written (Spring Boot 3.4 + Angular 17), never built or tested.

## 2026-11-12 — v2 rebuild for YouTube Music
**Done**
- Constitution (`gemini.md`) revised first: v2 schema (SESSIONS dropped, SHARED_PLAYLISTS), API + STOMP payloads, rules.
- v1 sources moved (not deleted) to `.tmp/legacy-v1/` (api, web app, old lockfile/node_modules).
- Backend rebuilt: typed config, Flyway (vendor DDL + verified seed of 71 songs), entities, repositories, services
  (catalog/random, share + after-commit broadcast, WebSocket presence, rate limiter, link parser, oEmbed client),
  controllers, RFC 7807 errors, admin key interceptor, OpenAPI, actuator, 3-stage Dockerfile.
- Frontend rebuilt on Angular 20 (Node 24 compatible): zoneless + signals, RetrooApi, problem-detail interceptor,
  RealtimeService (RxStomp), YouTubePlayerService adapter, PlayerStore, FeedStore, CSS room + CRT TV, decade bar,
  now-playing bar, ticker feed, share dialog, toasts, keyboard shortcuts, nginx.conf, Dockerfile.
- docker-compose (Oracle Free 23 + API + nginx), `.env.example`, GitHub Actions CI.
- Docs: README, docs/ARCHITECTURE.md, BACKEND.md, FRONTEND.md, API.md, INTERVIEW_QUESTIONS.md (166 Q&A).

**Tests / results**
- Backend `mvn test`: 38/38 pass (parser 20, rate limiter 2, song service 6, API integration 9, WebSocket 1).
- Frontend `ng test` (ChromeHeadless): 14/14 pass. `ng build` production: 74 kB transferred initial.
- Manual run (API :8080 + `ng serve` :4200): tune-in, playback, decade switch via keyboard, static/OSD, share
  dialog (client + server validation), live feed push, 429 + Retry-After, admin add/delete with oEmbed, mobile layout.

**Errors hit & fixed (self-annealing)**
1. Stale v1 classes in `target/` → bean name conflict → `mvn clean`.
2. Hibernate validate: H2 reports `NUMBER(19)` as NUMERIC ≠ BIGINT → Flyway `{vendor}` DDL folders (rule added to gemini.md).
3. Two constructors in SongService → "No default constructor" → `@Autowired` on the public one.
4. Listener count lost for new subscribers (broadcast raced SUBSCRIBE) → `@SubscribeMapping("/listeners")`.
5. TV black after hot reload (player bound to detached iframe) → `mount()` re-creates on new host.
6. Video blurred: TV overlay `.glass` collided with global `.glass` (backdrop-filter) → renamed `.glare`.
7. Feed text unreadable over the bright window / empty-state hidden by mask → frosted backing, mask only when scrolling.

**Not done / open**
- Docker is not installed on this machine → Dockerfiles and compose are written but not built here (CI builds them).
- No Oracle connectivity test yet (only via compose).
- Cloud deployment not started (needs user approval + target).

## 2026-11-12 — v2.1 / v2.2: Hindi songs, 90s signal loss, scenes, jam sessions
**Done**
- `gemini.md` updated first: rules 8–10, §8 Jam Sessions contract, vendor-DDL rule.
- Catalog: `tools/find_youtube_ids.py` (search + oEmbed + scoring) → 46 candidates → 40 kept after manual review
  (wrong-song and unofficial uploads dropped) → `V3__seed_hindi_songs.sql`. Catalog = 111 songs (71 EN + 40 HI).
- TV: channel static 1.5 s, signal loss between songs 3.2 s (picture rolls out, snow stutters in, rolling bar,
  flicker, Web Audio hiss), CRT warm-up on arrival, mains-hum flicker, interference streaks in the snow.
- Themes → 6 scenes (living, rural, city, villa, midnight, neon): per-scene room components + 5 TV models
  (console, portable, sleek, cabinet, gloss) + palettes; menu picker; `T` cycles.
- Jam sessions: backend by a parallel fork (`com.retroo.jam`, 65 backend tests); frontend JamStore, follow mode in
  PlayerStore, JamPanel (lobby / invite / session / chat), auto-rejoin on reload.

**Tests / results**
- Backend 65/65, frontend 17/17, production build 86 kB transferred.
- Manual two-tab test: create, invite link, join, sync (guest within ~1 s), pause, host channel change followed,
  guest controls locked, chat + playlist card, leave, reload auto-rejoin (host keeps rights), extend once, end.

**Errors hit & fixed**
1. Resolver crashed on '♪' (cp1252 console) → stdout UTF-8. First-match picked remixes/contest promos → scoring.
2. Python patch for the resolver failed silently and the old script ran → rewrote the file whole.
3. Restarted API landed on 8081 (old process still releasing 8080) → stop/start again.
4. Chat Enter ignored / messages merged → no `[disabled]` on emptiness, clear input synchronously.
5. Two tabs shared the display name → per-tab name in sessionStorage.

**Not done / open**
- Jam expiry verified by unit tests (fake clock), not by waiting 60 min live.
- Jams are per-instance (in memory); multi-instance needs Redis or a broker relay.

## 2026-11-12 — v2.3: listener channels, 2:1 ratio, premium redesign
**Done**
- gemini.md first: LANG column, rules 8 (2:1) / 11 (playable playlists) / 12 (design direction).
- V4 `LANG` column (+ CHECK, + DECADE/LANG index), V5 12 more Hindi songs (catalog 123: 71 EN, 52 HI).
- `GET /api/songs/random?lang=&exclude=a,b` with ordered fallbacks; PlayerStore rotation hi,hi,en + last-10 exclusion.
- Shared playlists playable ("▶ Tune in", playlist mode via cuePlaylist/getPlaylist); jam host "Play on TV" from chat.
- Redesign: photographic rooms (soft light only), artwork ambient glow, film grain, new TV materials and stand,
  serif/mono type, hairline glass chrome, calm motion, CRT power-on, jams in a drawer; 9 themes (6 rooms + Studio,
  Ivory, Noir).

**Tests / results**
- Backend 70 (incl. lang/fallback unit tests + integration), frontend 18 (incl. rotation test). Build 89 kB transferred.
- Live: rotation hi,hi,en verified on the API with no repeats; playlist tune-in played a real public playlist with
  titles from the player; all 9 themes checked in the browser.

**Errors hit & fixed**
1. Two WebSocket tests flaky after more tests shared the context (join order; leftover sockets) → order-insensitive
   assertion, presence test relative to a baseline.
2. Dev server stuck on errors from mid-edit compiles → restarted; production build was clean.
