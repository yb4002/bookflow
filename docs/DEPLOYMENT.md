# Deploying BookFlow

BookFlow is one Node.js process (API + web app) with an embedded SQLite database. A small
VM is enough for a pilot (1 vCPU, 1 GB RAM, 10 GB disk). HTTPS is provided by Caddy, which
obtains and renews Let's Encrypt certificates automatically.

## What you need

| | Required for | Notes |
|---|---|---|
| A server with Docker (or Node 22.5+) | everything | Ubuntu 24.04 LTS works well |
| A domain name | HTTPS, links in messages | e.g. `book.yoursalon.com` |
| DNS A/AAAA record → server IP | HTTPS | Caddy needs ports 80 and 443 reachable |
| Twilio account | SMS / WhatsApp | see [PROVIDERS.md](PROVIDERS.md) |
| Resend account + verified domain | email (password reset, invitations) | see [PROVIDERS.md](PROVIDERS.md) |
| Stripe account | paid plans (optional) | leave empty for a free pilot |

## Option A — Docker Compose (recommended)

```bash
git clone <your repo> bookflow && cd bookflow
cp .env.example .env
nano .env                      # DOMAIN, PUBLIC_BASE_URL, ACME_EMAIL, provider keys
docker compose run --rm app node dist-server/cli.mjs check-config   # validates .env
docker compose up -d --build
docker compose logs -f app     # JSON logs; look for "BookFlow listening"
```

Open `https://<DOMAIN>` → **Start free trial** → sign up the first business.

Updating to a new version:

```bash
git pull
docker compose run --rm app node dist-server/cli.mjs backup   # safety backup first
docker compose up -d --build                                   # migrations run automatically on start
```

The database, uploads and backups live in the `bookflow-data` volume (`/data` in the
container). Certificates live in `caddy-data`. **Never delete these volumes.**

## Option B — Node + systemd (no Docker)

```bash
npm ci && npm run build
sudo useradd --system --home /srv/bookflow bookflow
sudo mkdir -p /srv/bookflow/data && sudo cp -r dist dist-server package.json /srv/bookflow/
sudo cp .env.example /srv/bookflow/.env && sudo nano /srv/bookflow/.env
sudo chown -R bookflow: /srv/bookflow
sudo cp deploy/bookflow.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bookflow
```

Then put Caddy in front (`reverse_proxy 127.0.0.1:8787` with `flush_interval -1`, see
`deploy/Caddyfile`) or nginx with TLS. Keep `TRUST_PROXY=1` only when exactly one proxy
sits in front of the app.

## Production safety checks

The server refuses to start in production (`NODE_ENV=production`) when:

- `PUBLIC_BASE_URL` isn't `https://…`
- secure cookies are disabled
- the test-only reset endpoint (`BOOKFLOW_TEST`) is on
- demo mode is on with the default demo password
- a provider is half-configured (e.g. Twilio SID without token)
- Stripe is configured without its webhook secret or prices

It starts but **warns** when SMS/email aren't configured, backups are off, or `TRUST_PROXY`
is off. Messages on an unconfigured channel are recorded as **failed** (visible on each
appointment) — they are never silently "sent".

## Health checks

| Endpoint | Meaning |
|---|---|
| `GET /api/health` | process is up (liveness) |
| `GET /api/ready` | database answers and the notification dispatcher ran in the last 5 minutes (readiness; 503 otherwise) |
| `GET /api/metrics` | Prometheus metrics, `Authorization: Bearer $METRICS_TOKEN` |

The Docker image has a `HEALTHCHECK` on `/api/ready`. Point an uptime monitor (e.g.
UptimeRobot, Better Stack) at `https://<DOMAIN>/api/ready`.
