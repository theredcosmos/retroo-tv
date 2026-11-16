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
3. **Memory for Oracle.** Oracle Database Free needs about 2 GB on its own. Plan for **4 GB RAM or more** in total.

That rules out serverless and sleeping free tiers, and points to **one small virtual machine (VM)**.

## Where to host

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
