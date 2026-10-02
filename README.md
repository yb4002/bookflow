# BookFlow

Appointment booking for small businesses (salons, clinics, studios): a public booking page,
a business dashboard, automatic confirmations and reminders by SMS / WhatsApp / email,
Smart Fill for cancelled slots, team logins, client management and subscriptions —
in English (LTR) and Hebrew (RTL).

**Deploying for a real business?** Start with [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), then
[docs/PROVIDERS.md](docs/PROVIDERS.md) (Twilio, Resend, Stripe), [docs/OPERATIONS.md](docs/OPERATIONS.md)
(backups, restore, monitoring) and [docs/SECURITY.md](docs/SECURITY.md).

## Run it locally

```bash
npm install
npm run dev        # API on :8787 + web on http://localhost:5173 (proxies /api)
npm run build      # typecheck + web app (dist/) + server bundle (dist-server/)
npm start          # production mode: one process serves API + web app

npm test           # unit, contract and API integration tests (Vitest)
npm run test:e2e   # end-to-end tests, mobile + desktop (Playwright; throwaway database)
npm run check      # typecheck + tests + build
npm run ops -- <command>   # operator CLI: check-config | migrate | backup | verify | set-plan
```

Requires Node.js 22.5+ (built-in `node:sqlite`). Development runs in **demo mode**: two sample
businesses are seeded — `maya@lunahair.studio` (Luna Hair Studio, New York) and
`lena@glowlab.studio` (Glow Lab), password `bookflow-demo` — and messages are simulated
(nothing is sent). Public booking pages: `/book/luna-hair`, `/book/glow-lab`. Production
turns demo mode off; configuration is described in [`.env.example`](.env.example).

## What a business can do

| Area | Capabilities |
|---|---|
| **Sign-up & setup** | Self-service sign-up, email verification, 8-step setup wizard (details, logo & cover, language / currency / time zone / phone country, hours, services, team, booking rules, booking link), preview, publish |
| **Booking page** | `/book/<slug>`: service → team member (optional) → date & time → details → confirmation with booking code, calendar file and a private manage link (`/book/<slug>/manage/<token>`) to reschedule or cancel within the business's change window |
| **Calendar** | Week and per-person day views, new appointments for phone / walk-in clients (new or existing client, any time without overlaps), move to another time or person, notes, confirm, complete, no-show, cancel with or without notifying the client, send a reminder now, message history |
| **Clients** | Search, tags, add / edit, CSV import (English or Hebrew column names) and export, private notes, visit history, lifetime value, messaging opt-out, free-text messages, right-to-erasure |
| **Messages** | Confirmation, reminders (configurable lead times), reschedule and cancellation notices, Smart Fill offers and direct messages — in the client's language, on SMS, WhatsApp or email, with delivery status. STOP replies opt clients out. |
| **Smart Fill** | When a client cancels, ranks the clients most likely to take the slot (history, preferred staff and times, cadence, reliability) and sends them a link that opens the booking page on that slot |
| **Team** | Team members with services and personal working hours; logins by invitation with roles (owner: everything; team member: bookings and clients) |
| **Dashboard** | Today's schedule, 7-day revenue, no-show rate, new clients, open time to fill, top services, bookings chart, activity feed (online bookings, client cancellations/moves, failed messages) |
| **Account** | Change password, sign out other devices, switch between businesses |
| **Plan & billing** | 14-day trial, Solo/Team plans via Stripe Checkout and Billing Portal (optional; without Stripe everything is free) |

All dates and times follow the **business's time zone** — for the business, its clients and
its messages — wherever the server or the viewer is.

## Architecture

```
Browser (React SPA) ──fetch /api, SSE──> Hono API (server/app.ts)
  repo = HttpRepository                  ├─ /api/auth/*      sign-up, login, sessions, invitations, password, verification
  (BookFlowRepository interface)         ├─ /api/app/*       dashboard — session required, scoped to its business, role-checked
                                         ├─ /api/public/*    booking pages — by booking link; manage links by token
                                         ├─ /api/webhooks/*  Twilio, Resend, Stripe (signature-verified)
                                         └─ SqlRepository ─> domain rules (shared with the client) ─> SQLite
SqlRepository ──domain events (same transaction)──> NotificationEngine ──> notifications outbox
Scheduler: dispatch due messages · purge sessions · backups        ProviderRegistry: Twilio · Resend · (dev simulator)
```

```
src/domain/         Pure rules: types, availability engine, booking rules, time zones, phone numbers
src/data/           Repository interface + HTTP and local implementations, API client
src/features/       One folder per area (booking, calendar, customers, onboarding, billing, …)
src/i18n/           Typed catalogs (en = source of truth, he), Intl formatters in the business zone
server/             API, auth (sessions, team, accounts), billing, notifications, storage, db, jobs, CLI
e2e/                Playwright specs (mobile 390×844 and desktop 1440×900, browsers in other time zones)
deploy/, docs/      Caddy, systemd, deployment / providers / operations / security guides
```

- **Multi-tenancy:** every business-owned row has `business_id`, related rows use composite
  `(business_id, id)` foreign keys, and the API binds each request's repository to the session's
  business. A shared contract suite (`src/test/repositoryContract.ts`) runs against both
  repository implementations, including cross-business isolation checks.
- **Database:** SQLite (WAL) with versioned migrations (`server/db/migrations.ts`), applied at
  start. Portable SQL; moving to PostgreSQL only touches `server/db/sqlite.ts` and repositories.
- **Notifications:** a transactional outbox with dedupe keys and leases; messages are re-checked
  before sending (a reminder for a cancelled visit is withdrawn), retried with backoff, and
  addressed in E.164 using the business's phone country.

## Languages

English (LTR) and Hebrew (RTL), switchable anywhere (`?lang=he` also works). Catalogs are typed
(`src/i18n/locales/en.ts` defines the shape; a missing Hebrew key is a compile error). Use logical
Tailwind utilities (`ms-`, `ps-`, `start-`, `text-start`), wrap LTR data in `<Ltr>`, give user text
`dir="auto"`, and format dates/numbers only via `useI18n().f`.

## Not included (yet)

- Collecting **deposits or payments from clients** (needs a payment account per business, e.g. Stripe Connect).
- **WhatsApp message templates** for business-initiated WhatsApp outside the 24-hour window (see docs/PROVIDERS.md).
- Calendar sync (Google/Outlook), review requests, multiple locations.
