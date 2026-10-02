/**
 * Versioned schema migrations. Applied in order, each once, inside a transaction
 * (see migrate.ts). Never edit a shipped migration — add a new one.
 *
 * Dialect: SQLite, written to port 1:1 to PostgreSQL (TEXT ids/ISO timestamps →
 * uuid/timestamptz; INTEGER flags → boolean; JSON text → jsonb).
 *
 * Tenant boundary: every business-owned table carries business_id, and every
 * reference between business-owned rows is a composite (business_id, id) foreign
 * key — the database itself refuses a row that points at another business's data.
 */
export interface Migration {
  id: string
  sql: string
}

export const migrations: Migration[] = [
  {
    id: '0001_init',
    sql: /* sql */ `
-- ---------- Tenants ----------
CREATE TABLE businesses (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE business_settings (
  business_id                TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  default_language           TEXT NOT NULL DEFAULT 'en' CHECK (default_language IN ('en', 'he')),
  currency                   TEXT NOT NULL DEFAULT 'auto' CHECK (currency IN ('auto', 'USD', 'ILS')),
  min_notice_hours           INTEGER NOT NULL DEFAULT 2 CHECK (min_notice_hours >= 0),
  max_advance_days           INTEGER NOT NULL DEFAULT 60 CHECK (max_advance_days >= 0),
  cancellation_window_hours  INTEGER NOT NULL DEFAULT 24 CHECK (cancellation_window_hours >= 0),
  require_deposit            INTEGER NOT NULL DEFAULT 0 CHECK (require_deposit IN (0, 1)),
  deposit_percent            INTEGER NOT NULL DEFAULT 0 CHECK (deposit_percent BETWEEN 0 AND 100),
  auto_confirm               INTEGER NOT NULL DEFAULT 1 CHECK (auto_confirm IN (0, 1)),
  reminder_hours_before      TEXT NOT NULL DEFAULT '[24]',       -- JSON array of ints
  waitlist_enabled           INTEGER NOT NULL DEFAULT 0 CHECK (waitlist_enabled IN (0, 1)),
  updated_at                 TEXT NOT NULL
);

CREATE TABLE business_hours (
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  is_open      INTEGER NOT NULL CHECK (is_open IN (0, 1)),
  opens_at     TEXT NOT NULL CHECK (opens_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  closes_at    TEXT NOT NULL CHECK (closes_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  PRIMARY KEY (business_id, weekday)
);

-- Public booking links. Several per business (old links keep working after a rename);
-- exactly one is primary. Slugs are globally unique.
CREATE TABLE booking_links (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*'),
  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX booking_links_one_primary ON booking_links (business_id) WHERE is_primary = 1;

-- ---------- Identity & access ----------
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

-- Business ownership: which users may act for which business, and how.
CREATE TABLE memberships (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX memberships_business ON memberships (business_id);

-- Server-side sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_business_id  TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  FOREIGN KEY (user_id, active_business_id) REFERENCES memberships (user_id, business_id) ON DELETE CASCADE
);
CREATE INDEX sessions_user ON sessions (user_id);

-- ---------- Catalog & people ----------
CREATE TABLE staff (
  id               TEXT PRIMARY KEY,
  business_id      TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT '',
  color            TEXT NOT NULL CHECK (color IN ('indigo', 'teal', 'amber', 'rose')),
  avatar_initials  TEXT NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (business_id, id)
);

CREATE TABLE services (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(trim(name)) >= 1),
  category      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  duration_min  INTEGER NOT NULL CHECK (duration_min > 0),
  buffer_min    INTEGER NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  price_minor   INTEGER NOT NULL CHECK (price_minor >= 0),        -- cents / agorot
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (business_id, id)
);

-- Which staff member performs which service (same business only).
CREATE TABLE staff_services (
  business_id  TEXT NOT NULL,
  staff_id     TEXT NOT NULL,
  service_id   TEXT NOT NULL,
  PRIMARY KEY (staff_id, service_id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id) ON DELETE CASCADE
);

CREATE TABLE customers (
  id                TEXT PRIMARY KEY,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL,
  phone_digits      TEXT NOT NULL,                                 -- normalized for lookup
  tags              TEXT NOT NULL DEFAULT '[]',                    -- JSON array
  notes             TEXT,
  marketing_opt_in  INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0, 1)),
  created_at        TEXT NOT NULL,
  UNIQUE (business_id, id)
);
CREATE INDEX customers_phone ON customers (business_id, phone_digits);

-- ---------- Bookings ----------
CREATE TABLE appointments (
  id                   TEXT PRIMARY KEY,
  business_id          TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id          TEXT NOT NULL,
  staff_id             TEXT NOT NULL,
  service_id           TEXT NOT NULL,
  start_at             TEXT NOT NULL,
  end_at               TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('confirmed', 'pending', 'completed', 'cancelled', 'no_show')),
  source               TEXT NOT NULL CHECK (source IN ('online', 'phone', 'walk_in', 'instagram')),
  price_minor          INTEGER NOT NULL CHECK (price_minor >= 0),  -- price at booking time
  notes                TEXT,
  reminder_sent        INTEGER NOT NULL DEFAULT 0 CHECK (reminder_sent IN (0, 1)),
  reference            TEXT UNIQUE,                                -- public booking reference
  cancelled_at         TEXT,
  cancelled_by         TEXT CHECK (cancelled_by IN ('customer', 'business')),
  cancellation_reason  TEXT CHECK (cancellation_reason IN ('schedule_conflict', 'unwell', 'found_alternative', 'other')),
  rescheduled_at       TEXT,
  previous_start_at    TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK (end_at > start_at),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id),
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id)
);
CREATE INDEX appointments_time ON appointments (business_id, start_at);
CREATE INDEX appointments_staff_time ON appointments (business_id, staff_id, start_at);
CREATE INDEX appointments_customer ON appointments (business_id, customer_id);

-- Smart Fill: an open slot offered to selected clients.
CREATE TABLE availability_offers (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id  TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  created_at      TEXT NOT NULL,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE CASCADE
);

CREATE TABLE offer_recipients (
  business_id  TEXT NOT NULL,
  offer_id     TEXT NOT NULL,
  customer_id  TEXT NOT NULL,
  address      TEXT NOT NULL,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (offer_id, customer_id),
  FOREIGN KEY (business_id, offer_id) REFERENCES availability_offers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE
);
`,
  },
  {
    id: '0002_notifications',
    sql: /* sql */ `
-- Channel for confirmations/reminders, the client's message language and reminder consent.
ALTER TABLE business_settings ADD COLUMN notification_channel TEXT NOT NULL DEFAULT 'sms' CHECK (notification_channel IN ('sms', 'whatsapp', 'email'));
ALTER TABLE customers ADD COLUMN preferred_language TEXT CHECK (preferred_language IN ('en', 'he'));
ALTER TABLE appointments ADD COLUMN reminders_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (reminders_opt_in IN (0, 1));

-- Transactional outbox for every outbound message. Rows are created in the same transaction
-- as the business change that causes them, and delivered by the background dispatcher.
CREATE TABLE notifications (
  id                   TEXT PRIMARY KEY,
  business_id          TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK (kind IN ('confirmation', 'reminder', 'reschedule', 'cancellation', 'smart_fill_offer')),
  channel              TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  appointment_id       TEXT,
  customer_id          TEXT NOT NULL,
  offer_id             TEXT,
  recipient            TEXT NOT NULL,                 -- phone or email at enqueue time
  locale               TEXT NOT NULL CHECK (locale IN ('en', 'he')),
  payload              TEXT NOT NULL DEFAULT '{}',    -- JSON: facts the message was planned on (e.g. appointment start)
  -- Idempotency: one row per logical message, e.g. "reminder:<appointment>:<start>:24h".
  dedupe_key           TEXT NOT NULL UNIQUE,
  scheduled_for        TEXT NOT NULL,
  attempts             INTEGER NOT NULL DEFAULT 0,
  max_attempts         INTEGER NOT NULL DEFAULT 3,
  last_error           TEXT,
  -- Lease: a dispatcher owns a due row until this time (prevents double sending across workers).
  locked_until         TEXT,
  provider             TEXT,
  provider_message_id  TEXT,
  subject              TEXT,
  body                 TEXT,                          -- rendered text actually sent (audit)
  sent_at              TEXT,
  delivered_at         TEXT,
  cancelled_reason     TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, offer_id) REFERENCES availability_offers (business_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_due ON notifications (status, scheduled_for);
CREATE INDEX notifications_appointment ON notifications (business_id, appointment_id);
CREATE INDEX notifications_provider_message ON notifications (provider, provider_message_id);
`,
  },
  {
    id: '0003_onboarding',
    sql: /* sql */ `
-- Branding, publishing and onboarding state.
ALTER TABLE businesses ADD COLUMN logo_url TEXT;
ALTER TABLE businesses ADD COLUMN cover_url TEXT;
ALTER TABLE businesses ADD COLUMN published_at TEXT;
ALTER TABLE businesses ADD COLUMN onboarding_completed_at TEXT;
-- Businesses that existed before self-service onboarding were set up by hand: treat as done & live.
UPDATE businesses SET published_at = created_at, onboarding_completed_at = created_at;

-- Removing a service or team member keeps history intact (past appointments still reference them).
ALTER TABLE services ADD COLUMN deleted_at TEXT;
ALTER TABLE staff ADD COLUMN deleted_at TEXT;

-- Personal working hours. No rows for a staff member = works all opening hours.
CREATE TABLE staff_hours (
  business_id  TEXT NOT NULL,
  staff_id     TEXT NOT NULL,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_working   INTEGER NOT NULL CHECK (is_working IN (0, 1)),
  starts_at    TEXT NOT NULL CHECK (starts_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  ends_at      TEXT NOT NULL CHECK (ends_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  PRIMARY KEY (staff_id, weekday),
  FOREIGN KEY (business_id, staff_id) REFERENCES staff (business_id, id) ON DELETE CASCADE
);

-- Password reset tokens. Only a SHA-256 hash of the emailed token is stored; single use.
CREATE TABLE password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX password_resets_user ON password_resets (user_id);
`,
  },
  {
    id: '0004_management',
    sql: /* sql */ `
-- Free-text messages from the business to a client ('message'). SQLite can't alter a CHECK
-- constraint, so the outbox table is rebuilt (same columns, same data).
CREATE TABLE notifications_v2 (
  id                   TEXT PRIMARY KEY,
  business_id          TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK (kind IN ('confirmation', 'reminder', 'reschedule', 'cancellation', 'smart_fill_offer', 'message')),
  channel              TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  appointment_id       TEXT,
  customer_id          TEXT NOT NULL,
  offer_id             TEXT,
  recipient            TEXT NOT NULL,
  locale               TEXT NOT NULL CHECK (locale IN ('en', 'he')),
  payload              TEXT NOT NULL DEFAULT '{}',
  dedupe_key           TEXT NOT NULL UNIQUE,
  scheduled_for        TEXT NOT NULL,
  attempts             INTEGER NOT NULL DEFAULT 0,
  max_attempts         INTEGER NOT NULL DEFAULT 3,
  last_error           TEXT,
  locked_until         TEXT,
  provider             TEXT,
  provider_message_id  TEXT,
  subject              TEXT,
  body                 TEXT,
  sent_at              TEXT,
  delivered_at         TEXT,
  cancelled_reason     TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (business_id, appointment_id) REFERENCES appointments (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, offer_id) REFERENCES availability_offers (business_id, id) ON DELETE CASCADE
);
INSERT INTO notifications_v2 SELECT id, business_id, kind, channel, status, appointment_id, customer_id, offer_id, recipient, locale, payload,
  dedupe_key, scheduled_for, attempts, max_attempts, last_error, locked_until, provider, provider_message_id, subject, body, sent_at,
  delivered_at, cancelled_reason, created_at, updated_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_v2 RENAME TO notifications;
CREATE INDEX notifications_due ON notifications (status, scheduled_for);
CREATE INDEX notifications_appointment ON notifications (business_id, appointment_id);
CREATE INDEX notifications_provider_message ON notifications (provider, provider_message_id);
CREATE INDEX notifications_customer ON notifications (business_id, customer_id);

-- Clients: opt-out of all messages (STOP), erasure (personal data removed, visit history kept), edit time.
ALTER TABLE customers ADD COLUMN messaging_opt_out_at TEXT;
ALTER TABLE customers ADD COLUMN erased_at TEXT;
ALTER TABLE customers ADD COLUMN updated_at TEXT;
`,
  },
  {
    id: '0005_team_accounts',
    sql: /* sql */ `
-- Team logins: an owner invites someone by email; accepting creates (or reuses) their user and a
-- membership. Only a SHA-256 hash of the emailed token is stored. A membership can be linked to a
-- team member's calendar (staff_id).
CREATE TABLE invitations (
  id           TEXT PRIMARY KEY,                 -- sha256(token)
  public_id    TEXT NOT NULL UNIQUE,             -- safe to show / revoke by
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email        TEXT NOT NULL COLLATE NOCASE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  staff_id     TEXT,
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  revoked_at   TEXT
);
CREATE INDEX invitations_business ON invitations (business_id);
ALTER TABLE memberships ADD COLUMN staff_id TEXT;

-- Email verification (single-use, hashed token).
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
CREATE TABLE email_verifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX email_verifications_user ON email_verifications (user_id);

-- Session metadata for "signed in devices".
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
`,
  },
  {
    id: '0006_messaging_providers',
    sql: /* sql */ `
-- How to read local phone numbers (E.164 conversion for SMS/WhatsApp providers).
ALTER TABLE business_settings ADD COLUMN phone_country TEXT NOT NULL DEFAULT 'US';
UPDATE business_settings SET phone_country = 'IL' WHERE default_language = 'he';
UPDATE business_settings SET phone_country = 'IL' WHERE business_id IN (SELECT id FROM businesses WHERE timezone IN ('Asia/Jerusalem', 'Asia/Tel_Aviv'));

-- Inbound messages (replies, STOP) received from providers, kept for the business's records.
CREATE TABLE inbound_messages (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  channel      TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address   TEXT NOT NULL,
  body         TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
CREATE INDEX inbound_messages_from ON inbound_messages (from_address);
`,
  },
  {
    id: '0007_billing',
    sql: /* sql */ `
-- One subscription per business. Billing state is owned by the payment provider (Stripe) and
-- mirrored here from its webhooks; the app only reads it to decide what a business may use.
CREATE TABLE subscriptions (
  business_id             TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  plan                    TEXT NOT NULL CHECK (plan IN ('solo', 'team', 'business')),
  status                  TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid', 'comped')),
  trial_ends_at           TEXT,
  current_period_end      TEXT,
  cancel_at_period_end    INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  provider_customer_id    TEXT UNIQUE,
  provider_subscription_id TEXT UNIQUE,
  updated_at              TEXT NOT NULL
);
-- Businesses created before billing existed are complimentary (pilot / demo).
INSERT INTO subscriptions (business_id, plan, status, updated_at) SELECT id, 'business', 'comped', created_at FROM businesses;

-- Processed webhook events (idempotency: each provider event is applied once).
CREATE TABLE billing_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
`,
  },
  {
    id: '0008_manage_tokens_activity',
    sql: /* sql */ `
-- Manage-booking links carry an unguessable token (128 bits) instead of the short, human-readable
-- reference, so links can't be found by guessing. Existing bookings get one now.
ALTER TABLE appointments ADD COLUMN manage_token TEXT;
UPDATE appointments SET manage_token = lower(hex(randomblob(16))) WHERE manage_token IS NULL;
CREATE UNIQUE INDEX appointments_manage_token ON appointments (manage_token);
-- Who moved an appointment (client online, or the business) — for the activity feed.
ALTER TABLE appointments ADD COLUMN rescheduled_by TEXT CHECK (rescheduled_by IN ('customer', 'business'));
CREATE INDEX appointments_created ON appointments (business_id, created_at);
`,
  },
]
