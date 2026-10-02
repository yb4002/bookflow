# Operations: backups, restore, monitoring

## Backups

- **Automatic**: every `BACKUP_INTERVAL_HOURS` (default 6 in production) the app writes a
  consistent online copy (`VACUUM INTO`) to `BACKUP_DIR` (`/data/backups`) and keeps the
  newest `BACKUP_KEEP` (default 28 ≈ one week).
- **On demand**: `docker compose exec app node dist-server/cli.mjs backup`
- **Off-site** (strongly recommended): copy `/data/backups` and `/data/uploads` to another
  location daily, e.g. with restic/rclone to S3/Backblaze, or your VM provider's volume
  snapshots. A backup on the same disk doesn't survive losing the disk.

## Restore

```bash
docker compose exec app node dist-server/cli.mjs verify /data/backups/<file>.sqlite   # integrity: ok
docker compose stop app
docker compose run --rm --entrypoint sh app -c "cp /data/bookflow.sqlite /data/bookflow.before-restore.sqlite && cp /data/backups/<file>.sqlite /data/bookflow.sqlite && rm -f /data/bookflow.sqlite-wal /data/bookflow.sqlite-shm"
docker compose start app
```

Practise a restore before the pilot starts.

## Monitoring

- **Uptime**: monitor `https://<DOMAIN>/api/ready` (returns 503 if the database or the
  message dispatcher is unhealthy).
- **Metrics**: `/api/metrics` with `Authorization: Bearer $METRICS_TOKEN` (Prometheus text):
  requests, 5xx errors, rate limiting, pending/overdue/failed notifications.
  Alert on `bookflow_notifications_overdue > 0` for 15 minutes or
  `increase(bookflow_http_5xx_total[15m]) > 5`.
- **Logs**: JSON lines on stdout/stderr (`docker compose logs app`). Each request has an
  `x-request-id`. Tokens and message bodies are never logged; query strings are dropped.
- **Error alerts**: set `ERROR_WEBHOOK_URL` to a Slack/Discord/Teams incoming-webhook URL to
  get a message for server errors (rate-limited per error).
- **Browser errors**: front-end crashes are reported to `/api/client-errors` and logged as
  `client error`.

## Routine tasks

| Task | Command |
|---|---|
| Validate configuration | `node dist-server/cli.mjs check-config` |
| Apply migrations (also automatic at start) | `node dist-server/cli.mjs migrate` |
| Give a business a plan manually | `node dist-server/cli.mjs set-plan <businessId> team active` |

## Scaling notes

SQLite (WAL mode) on one server comfortably serves many small businesses. When you need
several app servers, move to PostgreSQL: the schema uses portable SQL and all access goes
through `server/db/sqlite.ts` and the repository layer. The notification outbox already
uses leases, so several dispatchers can run safely.
