# 📺 Retroo TV — time-travel through music

A retro CRT television in a warm living room that plays music videos from any decade — **60s, 70s, 80s, 90s,
2000s, 2010s or Now** — through YouTube, with a **live listener count** and a **live wall of YouTube Music
playlists** shared by visitors.

Built with **Java 17 · Spring Boot 3.4** (REST + STOMP WebSocket, JPA, Flyway, Oracle/H2) and
**Angular 20** (standalone components, signals, zoneless change detection).

> UX inspired by [tv.codvyn.in](https://tv.codvyn.in/). No assets were copied — the room and the TV are drawn
> entirely in CSS.

---

## Features

| | |
|---|---|
| 🎛️ **7 channels** | Pick a decade from the bar, press 1–7, or click the TV's channel knob. 1.5 s of static, rolling bar and "CH 90s" OSD while tuning. |
| 🇮🇳🇺🇸 **Bollywood + Hollywood** | Every decade mixes Hindi film songs with English hits. |
| 📼 **90s signal loss** | Between songs the set loses the signal for ~3 s: the picture rolls and flickers out, snow + hiss, then the new picture warms up. |
| ✨ **Premium look** | Photographic composition: the TV is the only sharp object, rooms are soft out-of-focus light, artwork ambient glow, film grain, serif typography, calm motion. |
| 📺 **Listener channels** | Shared YouTube Music playlists are playable: **▶ Tune in** puts a listener's playlist on the TV (in a jam, the host can play one shared in chat for everyone). |
| 🇮🇳 **2:1 Bollywood/Hollywood** | Every decade plays Bollywood, Bollywood, Hollywood — repeat, never one of the last 10 songs. |
| 🏡 **9 scenes** | Rooms — Sunset Lounge, Village Afternoon (portable set), City Night (silver stereo set), Villa (walnut cabinet), Midnight, Neon Den — and Minimal — Studio, Ivory, Noir. Each changes room light, TV model and palette. Picker in the header or `T`. |
| 🎧 **Jam sessions** | Create a room and share the `/jam/CODE` link; the host controls the TV and every guest's TV follows (drift-corrected). Live chat with playlist-link cards. 1 hour, extendable once by 1 hour, then removed automatically. |
| 🔀 **Endless shuffle** | When a song ends, a random song from the same decade plays — never the one that just finished. |
| ⏮️ **Transport** | Previous / play-pause / next, seekable progress, mute (volume knob or `M`). |
| 🟢 **Live listeners** | "N listening" is the number of open WebSocket sessions, pushed instantly. |
| 📝 **Share your playlist** | Validated YouTube Music links, rate-limited, broadcast to everyone in real time. |
| 🛡️ **Resilient** | Unplayable/blocked videos are skipped automatically; offline and empty states handled. |
| ♿ **Accessible** | Keyboard shortcuts, ARIA radiogroup for decades, native `<dialog>`, reduced-motion support. |
| 🛠️ **Admin API** | Add songs by YouTube link — title/artist auto-filled via oEmbed. |

## Repository layout

```
RETROO TV/
├── retroo-tv-api/          Spring Boot backend (REST + WebSocket)
├── retroo-tv/              Angular frontend
├── docs/
│   ├── ARCHITECTURE.md     big picture, data flow, design decisions
│   ├── BACKEND.md          every backend component explained
│   ├── FRONTEND.md         every frontend component explained
│   ├── API.md              REST + WebSocket contract with examples
│   └── INTERVIEW_QUESTIONS.md   150+ interview questions with answers
├── docker-compose.yml      Oracle + API + nginx/Angular
├── .github/workflows/ci.yml
├── gemini.md               project constitution (schemas, rules)
└── task_plan.md · progress.md · findings.md   project memory
```

## Run it locally (no Docker needed)

Prerequisites: **JDK 17+**, **Node 20.19+ / 22 / 24**.

```bash
# 1) API on http://localhost:8080 — uses an H2 file database, migrated + seeded by Flyway
cd retroo-tv-api
./mvnw spring-boot:run          # Windows: mvnw.cmd spring-boot:run
```

```bash
# 2) UI on http://localhost:4200 — /api and /ws are proxied to :8080
cd retroo-tv
npm install
npm start
```

Open http://localhost:4200 and click **Tap to tune in** (browsers require one click before playing sound).

Useful dev URLs: Swagger UI http://localhost:8080/swagger-ui.html · H2 console http://localhost:8080/h2-console
(JDBC URL `jdbc:h2:file:./data/retroo`, user `sa`) · health http://localhost:8080/actuator/health

## Run the full stack with Docker (Oracle)

```bash
cp .env.example .env            # then edit the passwords
docker compose up --build       # → http://localhost
```

## Tests

```bash
cd retroo-tv-api && ./mvnw test     # 70 tests: unit, MockMvc integration, real WebSocket (presence + jams)
cd retroo-tv && npm run test:ci     # 18 tests: store logic incl. jam follow mode, validators, error mapping
```

## Keyboard shortcuts

`Space` play/pause · `N` next · `P` previous · `M` mute · `T` next theme · `1`–`7` jump to a decade · `←/→` inside the decade bar

## Adding songs (admin)

```bash
curl -X POST http://localhost:8080/api/admin/songs \
  -H "X-Admin-Key: dev-admin-key" -H "Content-Type: application/json" \
  -d '{"video":"https://youtu.be/dQw4w9WgXcQ","decade":"80s","releaseYear":1987}'
```

The dev key is `dev-admin-key`; in production set `RETROO_ADMIN_API_KEY` (empty = admin API disabled).

## Learn the codebase

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), then [docs/BACKEND.md](docs/BACKEND.md) and
[docs/FRONTEND.md](docs/FRONTEND.md). Preparing for an interview? → [docs/INTERVIEW_QUESTIONS.md](docs/INTERVIEW_QUESTIONS.md).
