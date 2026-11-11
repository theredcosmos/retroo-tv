# Findings & Research

## Reference site (tv.codvyn.in, inspected 2026-11-12)
- Full-bleed warm room photo, CRT TV centre, static noise when idle.
- Top: "N listening" pill (left), "ERA TV" wordmark (centre), "<decade> playlist on Spotify ↗" (right).
- Left: auto-scrolling feed "<name> shared a spotify playlist <name> ↗" + italic quoted note; "Share your playlist" button.
- Bottom: "TRAVEL TO…" bar (60s 70s 80s 90s 2000s 2010s Now) and a now-playing bar (art, title, artists, progress, prev/play/next).
- Our version: YouTube Music instead of Spotify; room/TV drawn in CSS (no copied assets).

## YouTube constraints
- Playback must use the IFrame Player API (ToS). Player needs ≥200×200 visible area.
- Autoplay with sound is blocked until a user gesture → cue first, `playVideo()` inside the first click.
- No time-update event → poll `getCurrentTime()`.
- Error codes 100 (removed), 101/150 (embedding disabled), 2 (bad id), 5 (HTML5 error) → skip.
- oEmbed `https://www.youtube.com/oembed?url=…&format=json` returns title + channel without an API key; used to
  verify all 71 seed ids and to enrich admin-added songs. Some ids guessed from memory failed (removed/private) and were dropped.
- Playlist links: `list=` param on music.youtube.com / youtube.com / m.youtube.com; ids like PL…, OLAK5uy_…, RD….

## Platform constraints
- Machine: JDK 21, Maven 3.9.11 (wrapper cache, no global `mvn`), Node 24, no Docker.
- Angular 17 CLI flags Node 24 as unsupported → upgraded to Angular 20.
- H2 `MODE=Oracle` still reports `NUMBER(19)` as NUMERIC → vendor-specific DDL needed with `ddl-auto: validate`.
- Hibernate 6 maps `Instant` to TIMESTAMP_UTC by default → set `type.preferred_instant_jdbc_type: TIMESTAMP`.
- Spring STOMP: `SessionSubscribeEvent` fires before the broker registers the subscription → use `@SubscribeMapping` for initial state.
- Global CSS utility classes leak into components (emulated encapsulation is one-way) → namespace them.

## v2.1 / v2.2 findings
- Searching YouTube for film songs often returns fan uploads, lyric videos and same-title songs from other films;
  official label channels (T-Series, Saregama, Shemaroo, YRF, Sony Music India, Zee Music, Tips) are reliable.
- Some VEVO/label videos block embedding (error 101/150) — the skip logic and, in jams, the guest error message handle it.
- Spring STOMP needs ordered per-session processing, or a SEND right after SUBSCRIBE can overtake it.
- `convertAndSendToUser(sessionId, …)` with a session-id header accessor targets a single anonymous connection.
- Zoneless Angular: `[disabled]` derived from input text lags one frame and blocks Enter-to-submit.
- Same-browser tabs share localStorage; anything that is per-participant must live in sessionStorage.
