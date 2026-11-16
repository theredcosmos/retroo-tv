# Deploying Retroo TV

How to put Retroo TV on the internet so anyone can open it, tune in and start jams.

## The short version

One Linux server with Docker, a domain name pointing at it, and two commands:

```bash
cp .env.example .env        # then fill in passwords and DOMAIN
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Caddy gets an HTTPS certificate for your domain automatically. Visitors open `https://your-domain`.

## What runs

```
Internet ──443/80──▶ Caddy (HTTPS, certificates)
                       └──▶ nginx (Angular app, proxies /api and the /ws WebSocket)
                              └──▶ Spring Boot API (REST + STOMP, jams in memory)
                                     └──▶ Oracle Database Free (songs, shared playlists)
```

Only Caddy is reachable from the internet. nginx, the API and Oracle talk over Docker's private network.

## Three things that decide where you can host it

1. **Exactly one API instance.** Jams, the listener count and pending join requests live in the API's memory.
   Two copies behind a load balancer would each have half the jams. So: no autoscaling, no "2 replicas".
2. **Long-lived WebSockets.** The TV, the playlist feed and jams use `/ws`. The host must keep connections open
   for an hour or more. Platforms that sleep idle apps (most free tiers) end every jam when they sleep.
3. **Memory for Oracle.** Oracle Database Free needs about 2 GB on its own. Plan for **4 GB RAM or more** in total
   for the full stack, or use **lite mode** (H2 on disk instead of Oracle) on a small machine.

That rules out serverless and sleeping free tiers, and points to **one always-on machine**: a VM, or your own
computer behind a tunnel. For $0 options, see [Free options](#free-options-ranked).

## Free options (ranked)

Two things make free hosting possible:

- **Lite mode** (`docker-compose.lite.yml`): the same app with an H2 database in a file instead of the Oracle
  container. It runs in well under 1 GB of RAM, so it fits the small free servers. Data (songs, shared playlists)
  lives in the `h2data` volume.
- **Cloudflare quick tunnel** (`docker-compose.tunnel.yml`): a free public `https://….trycloudflare.com` address
  with no domain, no open ports and no router setup.

Free tiers change often. Check each provider's current terms before you sign up; the notes below were checked in
November 2026.

| # | Option | Cost | Stays on? | Catch |
|---|---|---|---|---|
| 1 | **Oracle Cloud Always Free, ARM VM** | Free | Yes | Card needed to sign up (verification). Popular regions are often "out of capacity". The ARM allowance was reportedly cut in 2026 to 2 CPUs / 12 GB, which is still plenty, even for the full Oracle stack. |
| 2 | **Your own computer / old laptop / Raspberry Pi + quick tunnel** | Free | While it's switched on | Address changes on every restart; no uptime guarantee; about 200 open connections at once. No card, no account. |
| 3 | **Your own computer + free DuckDNS name + router port forward** | Free | While it's switched on | Stable address and real HTTPS (Caddy), but your internet provider must allow inbound connections (many mobile/fibre plans use CGNAT, which blocks this). |
| 4 | **Oracle Cloud Always Free, AMD micro VM (1 GB)** | Free | Yes | Lite mode only. Same sign-up as #1. |
| 5 | **Google Cloud e2-micro (1 GB)** | Almost free | Yes | Lite mode only. The VM is free in three US regions, but a public IPv4 address is billed (about $0.005/hour, ~$3.60/month) and only 1 GB of outbound traffic per month is free. Videos stream from YouTube, so traffic stays small. |

Not suitable for Retroo TV:

- **Render free**: sleeps after 15 minutes without traffic, which drops every WebSocket and wipes live jams. OK only
  for a quick demo link.
- **Fly.io**: no free tier for new accounts.
- **Hugging Face Spaces**: Docker Spaces now need a paid plan.
- **Railway**: about $1 of free usage a month; runs out quickly.
- **Koyeb**: reports conflict (card required, scales to zero when idle); check before relying on it.

### Recipe 1: Oracle Cloud Always Free (best free option)

1. Sign up for Oracle Cloud Free Tier and pick a home region near your listeners (it can't be changed later).
2. Create a VM: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (ARM), e.g. 2 OCPU / 12 GB. If it says
   "out of capacity", try another availability domain, or try again later.
3. Open ports **80 and 443** in two places: the VCN's *security list* (ingress rules) **and** the VM's own firewall:
   ```bash
   sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save
   ```
4. Free domain: create a name at **duckdns.org** and point it at the VM's public IP.
5. Install Docker and clone the repo (steps 3–4 of "Step by step" below), set `DOMAIN=yourname.duckdns.org` in
   `.env`, then either the full stack:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   or the lighter one (starts faster, no Oracle):
   ```bash
   docker compose -f docker-compose.lite.yml -f docker-compose.prod.yml up -d --build
   ```
6. Open `https://yourname.duckdns.org`.

Oracle may reclaim Always Free VMs that sit almost completely idle for a long time; a site people use isn't idle,
but check Oracle's current idle policy.

### Recipe 2: your own computer + quick tunnel (zero sign-ups)

Needs Docker Desktop (Windows/Mac) or Docker (Linux / Raspberry Pi 4 or newer).

```bash
git clone https://github.com/theredcosmos/retroo-tv.git && cd retroo-tv
docker compose -f docker-compose.lite.yml -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.lite.yml -f docker-compose.tunnel.yml logs tunnel | grep trycloudflare.com
```

Share the `https://….trycloudflare.com` address it prints. It stays the same until the tunnel restarts (reboot,
`docker compose down`), then you get a new one. Keep the computer awake (turn off sleep).

**Want a fixed address?** Put a domain on Cloudflare (domains cost money; the tunnel itself is free), create a
*named* tunnel in the Cloudflare dashboard (Zero Trust → Networks → Tunnels), point its public hostname at
`http://frontend:80`, and change the tunnel service's `command` to `tunnel --no-autoupdate run --token <token>`.

### Recipe 3: your own computer + DuckDNS + port forwarding

1. Give the computer a fixed LAN IP and forward ports 80 and 443 on your router to it.
2. Create a DuckDNS name and keep it updated with your home IP (DuckDNS offers a small updater; many routers support it).
3. Set `DOMAIN=yourname.duckdns.org` in `.env`, then
   `docker compose -f docker-compose.lite.yml -f docker-compose.prod.yml up -d --build`.

If `https://yourname.duckdns.org` doesn't load from mobile data, your provider is probably using CGNAT: use
Recipe 2 instead.

### Lite mode: what to know

- One database file in one volume: back up `h2data` the same way as `oradata` in [Backups](#backups) (stop
  `backend` first).
- The songs and migrations are the same as with Oracle, but moving data from lite to the full stack later means
  re-seeding (shared playlists would need exporting). If you expect to keep the server, start with the full stack.
- On a 1 GB machine, add swap so the image builds don't run out of memory:
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  ```
  (Or build the images on your own computer and push them to a registry.)

## Where to host (paid)

| Option | Fits? | Notes |
|---|---|---|
| **Any Linux VM with 4 GB+ RAM** (Hetzner, DigitalOcean, AWS Lightsail, Azure, GCP…) | Yes | The simplest path. Ubuntu 24.04 LTS works well. |
| **Oracle Cloud "Always Free" ARM VM** | Yes, usually | Plenty of RAM for Oracle. It's ARM (arm64): the images used here publish arm64 builds, but check before relying on it. Also open ports in *both* the cloud "security list" and the VM's own firewall. |
| Free PaaS tiers that sleep (Render free, etc.) | No | Sleeping drops WebSockets and wipes in-memory jams. |
| Serverless / multiple replicas | No | Breaks in-memory jams (see rule 1). |

Check each provider's current pricing and free-tier terms yourself; they change often.

## Step by step

### 1. Create the server

- Ubuntu 24.04 LTS, 2 vCPU, **4 GB RAM** or more, 30 GB disk.
- Allow inbound **TCP 22** (SSH), **TCP 80** and **TCP 443** (and UDP 443 for HTTP/3) in the provider's firewall.

### 2. Point a domain at it

Create a DNS **A record** (and AAAA if you have IPv6) such as `retroo.example.com → <server IP>`.
No domain yet? A free dynamic-DNS subdomain (e.g. DuckDNS) works too; Caddy can get a certificate for it.

### 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER     # log out and back in afterwards
docker compose version            # needs 2.24 or newer (for "ports: !reset" in the prod overlay)
```

### 4. Get the code and configure it

```bash
git clone https://github.com/theredcosmos/retroo-tv.git
cd retroo-tv
cp .env.example .env
nano .env
```

Fill in:

| Variable | What to put |
|---|---|
| `ORACLE_PASSWORD` | Long random password (`openssl rand -base64 24`) |
| `DB_PASSWORD` | Another long random password |
| `ADMIN_API_KEY` | Leave empty to switch the admin API off, or a long random key |
| `DOMAIN` | Your hostname, e.g. `retroo.example.com` (no `https://`) |
| `ACME_EMAIL` | Optional: certificate expiry notices |

`.env` is git-ignored. Never commit it.

### 5. Start it

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The first start takes a few minutes: images build, Oracle initialises its database (1–2 min), Flyway creates the
tables and seeds the songs, then the API reports healthy and nginx starts. Caddy fetches the certificate on the
first HTTPS request.

Open `https://your-domain`. You should see the TV, the decade bar and "N listening".

### 6. Check it

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend   # API logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs caddy        # certificate problems show here
```

- Open the site in two browsers: the listener count should say 2.
- Start a jam in one, join by code in the other: the guest's TV should follow the host.

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Restarting the API **ends every live jam** (they're in memory) and briefly disconnects listeners, who reconnect
automatically. Deploy when nobody is mid-jam. Songs and shared playlists are in Oracle and survive.

## Backups

The only data worth keeping is in the `oradata` volume (songs, shared playlists). Simplest consistent backup:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop database backend
docker run --rm -v retroo-tv_oradata:/data -v "$PWD":/backup alpine tar czf /backup/oradata-$(date +%F).tgz -C /data .
docker compose -f docker-compose.yml -f docker-compose.prod.yml start database backend
```

(The volume name is `<folder>_oradata`; `docker volume ls` shows it.) Copy the archive off the server.
Also keep the `caddy_data` volume: losing it means re-issuing certificates, and Let's Encrypt rate-limits that.

## Security checklist

- [x] Only ports 80/443 (Caddy) are public; Oracle's port isn't published.
- [x] HTTPS everywhere, with HSTS.
- [x] Rate limits use the visitor's real IP. Caddy replaces any `X-Forwarded-For` a visitor sends; nginx only
      accepts that header from the private network and passes the API exactly one address.
- [x] Clients can only STOMP-send to `/app/**`; private jams are enforced by the server.
- [x] Swagger UI and the H2 console are off in the `prod` profile; `/actuator` isn't proxied to the internet.
- [ ] Strong, unique `ORACLE_PASSWORD` and `DB_PASSWORD`.
- [ ] `ADMIN_API_KEY` empty unless you need the admin API.
- [ ] OS security updates on (`sudo apt install unattended-upgrades`).
- [ ] SSH key login only.

## Alternative: no open ports (Cloudflare Tunnel)

If you can't open 80/443 (home server, strict network), skip `docker-compose.prod.yml` and run Cloudflare's
`cloudflared` container on the same Docker network, pointing the tunnel at `http://frontend:80`. Cloudflare then
handles HTTPS and WebSockets. Because `cloudflared` connects from the private network, nginx's client-IP handling
still works.

## When one server isn't enough

Scaling out needs the in-memory state moved out of the API first:

- Jams, presence and join requests → Redis (a hash per jam, pub/sub for events).
- Spring's simple broker → a STOMP broker relay (RabbitMQ / ActiveMQ) so every API node sees every message.
- Sticky sessions on the load balancer for the WebSocket.

Until then, one well-sized VM comfortably handles a lot of listeners: the API mostly forwards small messages.
