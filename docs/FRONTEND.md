# Frontend — component guide (`retroo-tv`)

Angular 20 · standalone components · signals · **zoneless** change detection · SCSS · RxJS · `@stomp/rx-stomp`.

```
src/
├── main.ts                       bootstrapApplication(App, appConfig)
├── index.html                    fonts, preconnects, <app-root>
├── styles.scss                   design tokens + global primitives (.glass, .pill-btn)
├── environments/                 apiBaseUrl / wsPath per build
└── app/
    ├── app.config.ts             providers (zoneless, HttpClient + interceptor)
    ├── app.ts/.html/.scss        layout, CSS room, keyboard shortcuts
    ├── core/                     no UI — state and integrations
    │   ├── models.ts             TS mirrors of backend DTOs
    │   ├── api/retroo-api.service.ts         typed REST gateway
    │   ├── api/problem-detail.interceptor.ts errors → ApiError
    │   ├── realtime/realtime.service.ts      STOMP connection
    │   ├── player/youtube-player.service.ts  YouTube IFrame API adapter
    │   ├── player/player.store.ts            playback state machine
    │   ├── feed/feed.store.ts                shared-playlist feed state
    │   └── ui/toast.service.ts
    ├── features/                 UI
    │   ├── header/               listeners badge · wordmark · YT Music link
    │   ├── tv/                   CRT TV + static-noise directive
    │   ├── decade-bar/           "Travel to…" radiogroup
    │   ├── now-playing/          transport bar
    │   ├── feed/                 auto-scrolling playlist wall
    │   ├── share/                "Share your playlist" dialog + validator
    │   └── toast-host.component.ts
    └── shared/duration.pipe.ts
```

## 1. Architectural pattern

**Unidirectional data flow with signal stores** — a lightweight version of Flux/NgRx without the boilerplate:

```
 Component ──(intent: selectDecade('90s'))──▶ Store ──▶ API / YouTube adapter
     ▲                                          │
     └──────────── reads signals ◀──────────────┘
```

* **Components** are presentational: read signals, call store methods. All use `ChangeDetectionStrategy.OnPush`.
* **Stores** (`PlayerStore`, `FeedStore`) own state as `signal()`s and expose derived state as `computed()`.
* **Adapters** (`RetrooApi`, `RealtimeService`, `YouTubePlayerService`) isolate external systems — the only places
  that know about `HttpClient`, STOMP or `window.YT`. Each can be swapped for a fake in tests.

### Why zoneless?
Zone.js monkey-patches every async API to guess when to re-render. With signals Angular *knows* what changed, so
`provideZonelessChangeDetection()` removes zone.js from the bundle and avoids wasted checks. A practical bonus here:
YouTube player callbacks run outside any zone — with signals they still update the view, no `NgZone.run()` needed.

---

## 2. Core (state & integrations)

### `app.config.ts`
`provideBrowserGlobalErrorListeners()`, `provideZonelessChangeDetection()`,
`provideHttpClient(withFetch(), withInterceptors([problemDetailInterceptor]))`.

### `models.ts`
Interfaces mirroring the backend DTOs (`Decade`, `Song`, `SharedPlaylist`, `PageResponse<T>`, …) and `ApiError`, the
one error shape the whole UI deals with. `DecadeSlug` is a string-literal union, so a typo like `'1990s'` is a
compile error.

### `RetrooApi` (`core/api/retroo-api.service.ts`)
Stateless, typed methods — one per endpoint — returning cold `Observable`s. No URL building anywhere else.

### `problemDetailInterceptor`
Functional `HttpInterceptorFn`. Converts every failure into `ApiError {status, title, detail, fieldErrors,
retryAfterSeconds}`: RFC 7807 bodies, non-JSON bodies (e.g. an nginx 502 page) and network failures (status 0 →
"Offline").

### `RealtimeService` (`core/realtime/realtime.service.ts`)
* One `RxStomp` client for the app, URL derived from `location` (`ws:`/`wss:` automatically).
* `reconnectDelay: 3000`, heart-beats 10 s both ways (lets the server detect dead tabs → accurate count).
* `listeners` signal fed by **two** subscriptions merged: `/app/listeners` (one-shot snapshot via the server's
  `@SubscribeMapping`) and `/topic/listeners` (every change). `watch()` re-subscribes after reconnects.
* `connected` = `computed(state === OPEN)` → the badge dot turns grey while reconnecting.
* `playlistShared$` stream from `/topic/playlists`.
* Uses `takeUntilDestroyed` / `DestroyRef` for clean teardown.

### `YouTubePlayerService` (adapter)
* Loads `https://www.youtube.com/iframe_api` **once** (module-level promise; chains any existing
  `onYouTubeIframeAPIReady`).
* `mount(host)` creates `new YT.Player(host, …)` with `controls:0, disablekb:1, playsinline:1, rel:0,
  iv_load_policy:3, origin`. Idempotent for the same element; if the host element changes (component re-created,
  hot reload) it destroys the stale player and builds a new one.
* Signals: `state` (`playing`/`paused`/`buffering`/`ended`/…), `currentTime`, `duration`, `muted`.
* Streams: `ended$`, `unplayable$` (YT error codes 2/5/100/101/150).
* The API has no time-update event → samples `getCurrentTime()` every 500 ms only while playing.
* `cue()` vs `load()`: cue before the first user gesture (no autoplay), load afterwards.

### `PlayerStore` (`core/player/player.store.ts`) — the brain
State signals: `decades`, `activeDecade`, `current`, `status` (`off | tuning | on | error`), `errorMessage`,
`awaitingGesture`. Derived: `activeDecadeInfo`, `isPlaying`, `showStatic`, `progress`, `duration`, `muted`.

| Method | Behaviour |
|---|---|
| `init(host)` | parallel: fetch decades + mount player; then cue a random "Now" song |
| `tuneIn()` | first gesture — calls `play()` synchronously so the browser allows sound |
| `selectDecade(slug)` | reset history, tune to a random song of that decade |
| `next()` | random song of the active decade **excluding the current one** |
| `previous()` | restart if > 3 s in (like Spotify/YT Music), else go back in history |
| `togglePlay()`, `seek()`, `toggleMute()` | delegate to the adapter |

Internals:
* `tuneTo()` — status `tuning` (static on), `Promise.all([fetch, delay(600ms)])` so the static is visible long
  enough to read as a channel change, then `load()`.
* **Race guard:** each call increments `requestSeq`; a response whose seq is stale is dropped. Clicking 60s then 80s
  quickly always ends on 80s even if the 60s response arrives last.
* **Skip loop guard:** unplayable videos are skipped; after 5 in a row the TV shows "NO SIGNAL". An `effect()` resets
  the counter whenever something actually plays.

### `StaticHissService`
Web Audio "snow" sound: a looped 2 s white-noise buffer → band-pass filter (~3.2 kHz, small-TV-speaker timbre) →
gain node with short fades. Created lazily after the first click (autoplay policy), silent when muted. The store
starts it whenever the screen shows static.

### Signal transitions (90s-TV realism)
`PlayerStore.transition` is `'channel'` (user turned the dial — ≥1.5 s) or `'signal-loss'` (song ended by itself —
≥3.2 s); `arriving` is true for 0.9 s once the new video really plays. The TV maps these to CSS classes:

| Class | Effect |
|---|---|
| `.t-channel` | snow + jitter, a bright band rolling down (lost vertical hold), random brightness flicker |
| `.t-signal-loss` | the old picture rolls/skews and fades to grey, snow stutters in, faster roll |
| `.arriving` | new picture starts over-bright and vertically squashed, then settles (CRT warming up) |
| `.live` | barely visible 50 Hz-style hum on the scanlines |

The noise canvas also adds random horizontal interference streaks to ~6 % of rows each frame.

### Themes = scenes (`ThemeService`, `RoomComponent`, TV models, `ThemePickerComponent`)
A theme bundles three things:

| Theme id | Scene (room) | TV model | Palette |
|---|---|---|---|
| `living` (default) | window + sheer curtains, sun beam, frame, wood floor | `console`: teak, side panel, rabbit ears | sunset orange, YT red |
| `rural` | lime-wash wall + ochre dado, shutters with iron bars onto fields, ceiling fan, calendar, red-oxide floor | `portable`: cream plastic, carry handle, one antenna, lace doily, washed-out picture | green accent |
| `city` | striped wallpaper, blinds over a dusk skyline, band poster, floor lamp, parquet | `sleek`: silver, stereo side speakers, push-button strip, no antenna | dusk purple |
| `villa` | arched garden/pool window, velvet drapes, chandelier, wainscot, potted palm, marble checkerboard | `cabinet`: walnut with gold trim, crest, louvered doors open, tall legs | cream & gold |
| `midnight` | living-room layout + moon | `console` | blue night |
| `neon` | synthwave sun window, neon sign, glowing tube, perspective grid floor | `gloss`: black with accent rim glow | magenta & cyan |

* **Colours**: CSS custom properties per `html[data-theme]` in `src/themes.scss`. Switching is one attribute write.
* **Scene**: `RoomComponent` `@switch`es over `theme.scene()` and renders one scene component
  (`features/room/scenes/*`). Only the active scene exists in the DOM; each is pure CSS and `aria-hidden`.
* **TV model**: `CrtTvComponent` sets `data-model` on its host; `crt-tv.models.scss` restyles the same DOM per
  model with `:host([data-model=…])`. Optional parts (handle, doily, crest, doors, side speakers) are always in the
  template and hidden unless the model uses them, so the YouTube iframe is never re-created on a theme change.
* `ThemeService` keeps `current` / `option` / `scene` / `tvModel` signals, writes the attribute and
  `<meta name="theme-color">` in an `effect()`, persists to localStorage and is applied at bootstrap with
  `provideAppInitializer`. `ThemePickerComponent` is a menu button (`menuitemradio` items with swatch, name and
  description); `T` cycles.

### Jam sessions (`JamStore`, `JamPanelComponent`, PlayerStore follow mode)
* **`JamStore`** (`core/jam/jam.store.ts`): lobby (REST, polled every 20 s while browsing); `create` stores the host
  token in sessionStorage; `join` loads the REST snapshot, then STOMP `watch('/topic/jam/{code}')` +
  `watch('/user/queue/jam-errors')` and `publish('/app/jam/{code}/join')`. Handles `STATE`, `CHAT`, `MEMBERS`,
  `EXTENDED`, `ENDING_SOON`, `ENDED`. A 1 s ticker drives the countdown, computed on the server's clock via the
  `serverTime` offset. `join` is re-sent on every socket reconnect (membership is per STOMP session).
* **Host mirroring**: an `effect()` watches the host's `PlayerStore.current` / `isPlaying` / `transition` and sends
  `LOAD` (new song, once the picture is up), `PLAY` / `PAUSE` on changes, `SEEK` from `PlayerStore.seeked$`, and a
  `PLAY` heartbeat every 15 s.
* **Guest follow mode**: `PlayerStore.setFollowMode(true)` turns `next`, `previous`, `selectDecade`, `togglePlay`
  and `seek` into no-ops (`canControl()` disables the buttons and decade bar). `applyRemote(state, offsetMs)` loads a
  new song with the usual channel static, then `syncToRemote()` seeks if drift > 2 s and matches play/pause. Before
  the guest's first click the host's song is only cued; "Tap to tune in" then plays and syncs inside the gesture.
  When a guest's song ends, the TV shows signal-loss snow and waits for the host instead of auto-advancing.
* **URL & reload**: the jam URL `/jam/CODE` is pushed into history (it *is* the invite link). Opening it shows an
  invite card; reloading a tab that was in the jam re-joins automatically (`retroo.jam.active` and a per-tab name in
  sessionStorage; the host token restores host rights).
* **`JamPanelComponent`**: right-hand column. Lobby (your name, start a jam, live jams, invite card) or session
  (name, HOST badge, copyable code, member list, countdown that pulses red in the last 5 min, +1 hour / End jam for
  the host, Leave for guests) with chat (system lines, messages, playlist-link cards, auto-scroll, Enter to send).
* **Gotcha fixed**: submit buttons must not be `[disabled]` based on input text. With zoneless rendering the button
  re-enables on the next frame, and a disabled default button silently blocks Enter-to-submit. Emptiness is checked
  in the handler instead, and the chat input is cleared synchronously.

### Design system (v2.3 — "premium, minimal, photographic")
* **Composition**: like a shallow-depth-of-field photo — the TV is the only sharp object; rooms (`features/room/scenes/*`)
  are only soft light (window light on the wall with mullion/bar shadows, haze, bokeh, an arch of daylight, a studio
  spotlight), never drawn objects. The TV stands on a console surface with a contact shadow.
* **Layers**: `RoomComponent` (backdrop + scene + floor + vignette) → `AmbientComponent` (current artwork blurred 80 px,
  cross-faded with `linkedSignal`, masked to the TV area, `--ambient-a`) → stage → `FilmGrainComponent` (SVG fractal
  noise, overlay blend, stepped shift).
* **Type**: Inter for UI, *Instrument Serif* for the wordmark, song and playlist titles, IBM Plex Mono for the OSD,
  times and codes. **Chrome**: hairline borders (`--line`), soft glass, ink-filled primary buttons, one easing curve.
* **Motion**: no blinking/buzzing; CRT power-on line on first tune-in, calmer roll/flicker, picture "settles" on arrival.
* **Themes** (`src/themes.scss`): token groups UI / Room / TV / Picture. Rooms: living, rural, city, villa, midnight, neon.
  Minimal: studio, noir (grayscale video). The old light `ivory` theme was merged into `villa` ("Ivory Villa":
  creamy beige, the only light theme — ink flips dark; larger walnut cabinet TV); a stored `ivory` choice migrates.
* **Jams in a drawer** (`JamDrawerComponent`, `inert` when closed) keep the main view minimal.

### Playlist mode (listener channels)
`PlayerStore.playPlaylist(p)` reads the playlist's video ids through the IFrame API (`cuePlaylist` + poll
`getPlaylist()` — there is no fetch API), then plays them in order through the normal `tuneTo` transitions; titles come
from `getVideoData()` once each video plays. `source` signal = `decade | playlist`; next/previous step through the list;
decade buttons or "Back to decades" leave it. The jam host's LOAD is keyed on id + title so guests get the real title.

### `FeedStore`
`items` signal (max 40), `loading`, `freshId` (for the highlight animation). `load()` fetches page 0;
`share()` posts and inserts the result; WebSocket pushes go through the same `upsert()` which **de-duplicates by
id** (the sharer gets the entry both from the HTTP response and from the broadcast).

### `ToastService` + `ToastHostComponent`
A signal array of toasts that auto-dismiss after 4 s, rendered in an `aria-live="polite"` region.

---

## 3. Feature components

### `App` (root)
* Layout: fixed CSS **room** (window, curtains, sun beam, frame, wooden floor, vignette — all gradients) and a CSS
  **grid** stage: header / feed / TV / controls. Below 960 px it collapses to one column.
* `@HostListener('document:keydown')` shortcuts: Space, N, P, M, 1–7; ignored while typing in inputs or a dialog.

### `HeaderComponent`
Badge "● N listening" (`role="status"`, pulsing green dot; grey "connecting…" while offline), letter-spaced
wordmark, and a link to the active decade on YouTube Music (`rel="noopener noreferrer"`).

### `CrtTvComponent` + `StaticNoiseDirective`
* Cabinet, bezel, antenna, side panel (brand, knobs, speaker grille, power LED), feet — pure CSS.
* Tube layers: YouTube iframe (16:9 centre-cropped into 4:3, `pointer-events:none`, slight sepia) → noise canvas →
  scanlines → glare/vignette → OSD.
* **Channel knob** rotates to the active decade (`--angle` CSS variable from a `computed`) and changes channel on
  click; **volume knob** mutes.
* OSD "CH 90s" flashes on every channel change (an `effect()` on `activeDecade`), plus "Tap to tune in" and
  "NO SIGNAL / Try again" states.
* `afterNextRender()` hands the host element to `PlayerStore.init()` — the DOM must exist first.
* `StaticNoiseDirective`: 160×120 canvas, `Uint32Array` view over `ImageData` (one write per pixel),
  `requestAnimationFrame` loop only while active, single frame for `prefers-reduced-motion`.

> Lesson learned: the overlay was first named `.glass`, which collided with the global `.glass` utility
> (`backdrop-filter: blur`) and blurred the video. Emulated encapsulation stops component styles leaking *out*,
> not global styles leaking *in*.

### `DecadeBarComponent`
WAI-ARIA **radiogroup** with **roving tabindex** (only the selected chip is tabbable; ←/→ move and select).
Skeleton chips while loading (`@for … @empty`), disabled chips for empty decades, active chip in YouTube red.

### `NowPlayingBarComponent`
Artwork, title, "artist · year", native `<input type="range">` seek bar (keyboard accessible; filled portion via a
`--pct` CSS variable), prev / play-pause / next. Uses `@let` and the `DurationPipe`.

### `PlaylistFeedComponent`
Ticker-style wall. Renders the list **twice** and animates `translateY(0 → -50%)` for a seamless loop; the duplicate
is `aria-hidden` with `tabindex=-1` links. Pauses on hover/focus, fades top/bottom with `mask-image`, highlights the
newest entry, and is a normal scrollable list under `prefers-reduced-motion`. Links use
`rel="noopener noreferrer nofollow"`.

### `SharePlaylistDialogComponent`
* Native `<dialog>` + `showModal()` → focus trap, Esc, inert background, top layer — no library.
* Typed reactive form (`NonNullableFormBuilder`) with validators mirroring the server (`required`, `maxLength`,
  and `youtubePlaylistValidator`).
* Server errors mapped back: 400 `fieldErrors` → `control.setErrors({server})`, 429 → "try again in N min",
  409/other → form-level message.
* Remembers the display name in `localStorage` (try/catch — storage can be blocked).

### `DurationPipe`
Pure pipe: seconds → `m:ss` / `h:mm:ss`.

---

## 4. Styling system
* Tokens in `:root` (`--ink`, `--accent` YouTube red, `--glass`, radii, fonts Inter + VT323 for the CRT OSD).
* Global primitives only: `.glass`, `.pill-btn`, `.visually-hidden`, a reduced-motion reset.
* Everything else is component-scoped SCSS.

## 5. Build, proxy & deployment
* `npm start` → `ng serve --proxy-config proxy.conf.json` (`/api` and `/ws` with `ws: true` → `:8080`).
* Production build: ~270 kB raw / **~74 kB transferred** initial JS+CSS.
* Docker: Node build stage → `nginx:alpine` serving `dist/retroo-tv/browser`. `nginx.conf` reverse-proxies
  `/api` and upgrades `/ws`, caches hashed assets for a year, never caches `index.html`, sets a CSP that allows only
  YouTube frames/scripts and same-origin API/WebSocket.

## 6. Tests
`npm run test:ci` (Karma + ChromeHeadless, 17 specs):
* `player.store.spec.ts` — decade selection, **race condition guard**, exclusion of the current song, skip-loop
  limit, longer signal loss between songs, jam follow mode (local intents ignored; host song loaded and seeked to
  the drift-corrected position), with a fake YouTube adapter and `fakeAsync` (zone.js is loaded only for tests).
* `problem-detail.interceptor.spec.ts` — 400/429/0/502 mapping.
* `youtube-playlist.validator.spec.ts` — accepted/rejected links.
* `duration.pipe.spec.ts`.
