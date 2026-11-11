# Task Plan: Retroo TV (B.L.A.S.T. Protocol)

## Phase 1: B — Blueprint
Discovery answers (from the user's brief, 2026-11-12; assumptions marked *):
- **North Star:** A production-grade "time-travel TV" for YouTube Music, modelled on tv.codvyn.in, built with Spring Boot + Angular, fully documented, with an interview-prep question bank.
- **Integrations:** YouTube IFrame Player API (no key), YouTube oEmbed (no key) for metadata enrichment. *No paid APIs or keys required.
- **Source of Truth:** Database (`SONGS`, `SHARED_PLAYLISTS`), seeded by Flyway with verified YouTube video IDs; admins can add more via API.
- **Delivery Payload:** Web app (Angular SPA served by nginx) + REST/WebSocket API; Docker images + compose. *Cloud deploy is a later step that needs explicit approval.
- **Behavioral Rules:** see `gemini.md` §6.

- [x] Discovery questions answered (above)
- [x] Data schema defined (`gemini.md` v2)
- [x] Blueprint approved (user instruction: "build it")

## Phase 2: L — Link
- [x] Verify seed video IDs resolve (YouTube oEmbed) — 64 confirmed
- [x] Maven 3.9.11 / JDK 21 / Node 24 available locally
- [ ] Oracle connectivity (only via docker-compose; Docker not installed on this machine)

## Phase 3: A — Architect
- [x] Backend: config, domain, repositories, services, controllers, WebSocket presence, error handling, rate limit, admin key
- [x] Flyway migrations (schema + seed)
- [x] Backend tests (unit + slice + integration)
- [x] Frontend: core services (API, realtime, YouTube player, player store), feature components
- [x] Dev proxy + nginx reverse proxy

## Phase 4: S — Stylize
- [x] CSS-only room + CRT TV, static noise canvas, scanlines, glass panels, YT-Music red accent
- [ ] User visual review

## Phase 5: T — Trigger
- [x] Dockerfiles + docker-compose (Oracle Free)
- [x] GitHub Actions CI workflow
- [ ] Cloud deployment (needs user approval + target)

## Documentation
- [x] README.md (run guide)
- [x] docs/ARCHITECTURE.md, docs/BACKEND.md, docs/FRONTEND.md, docs/API.md
- [x] docs/INTERVIEW_QUESTIONS.md
