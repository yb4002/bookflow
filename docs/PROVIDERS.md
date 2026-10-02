# Messaging and billing providers

BookFlow talks to providers over their HTTPS APIs (no SDKs). Each provider is optional:
without it, that capability is visibly unavailable — never faked — in production.

## SMS and WhatsApp — Twilio

1. Create a Twilio account and buy a phone number that can send SMS to your clients'
   country (for Israel, use an alphanumeric sender or an Israeli-capable number; check
   Twilio's country guidelines and register a sender ID where required).
2. Recommended: create a **Messaging Service**, add the number to it, and enable Advanced
   Opt-Out. Copy its SID (`MG…`).
3. In `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID`
   (or `TWILIO_SMS_FROM=+1…` for a single number).
4. In the number / Messaging Service settings, set **"A message comes in"** →
   `https://<DOMAIN>/api/webhooks/twilio/inbound` (HTTP POST). Replies like STOP / הסר opt
   the client out of all messages; START opts them back in.
5. Delivery statuses arrive automatically at `/api/webhooks/twilio/status` (requested per
   message). Every webhook is checked against Twilio's HMAC signature.

**WhatsApp** (`TWILIO_WHATSAPP_FROM=+…`): requires an approved WhatsApp Business sender in
Twilio. WhatsApp only allows free-form messages within 24 hours of the client's last
message; business-initiated confirmations and reminders outside that window need
**Meta-approved message templates**. Until templates are approved and wired in, use SMS as
the businesses' notification channel (Settings → Booking policies → Channel).

Phone numbers: clients type local numbers ("052-555-0101"); each business's **Phone
numbers** country (Settings → Business profile) converts them to international E.164
format for Twilio. Numbers that can't be valid fail with "invalid phone number".

## Email — Resend

1. Create a Resend account, add and **verify your sending domain** (DNS records: SPF, DKIM).
2. Create an API key → `RESEND_API_KEY`. Set `EMAIL_FROM="BookFlow <bookings@mail.yourdomain.com>"`
   (must be on the verified domain) and optionally `EMAIL_REPLY_TO`.
3. Webhooks → add endpoint `https://<DOMAIN>/api/webhooks/resend` with events
   `email.delivered`, `email.bounced`, `email.complained`; copy the signing secret →
   `RESEND_WEBHOOK_SECRET`. Spam complaints opt that address out.

Used for: password resets, team invitations, email verification, and client messages when a
business chooses the Email channel (clients without an email address get SMS instead).

## Paid plans — Stripe (optional)

Without Stripe every business has full access (ideal for a pilot). With Stripe:

1. Create two recurring **Prices** (Solo, Team) in your Stripe account → `STRIPE_PRICE_STARTER`
   (Solo) and `STRIPE_PRICE_PRO` (Team). "Business" is arranged manually
   (`node dist-server/cli.mjs set-plan <businessId> business comped|active`).
2. `STRIPE_SECRET_KEY` (use a restricted key with write access to Customers, Checkout
   Sessions, Billing Portal sessions).
3. Developers → Webhooks → endpoint `https://<DOMAIN>/api/webhooks/stripe`, events:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted` → `STRIPE_WEBHOOK_SECRET`.
4. Configure the **Customer Portal** (Settings → Billing → Customer portal): allow updating
   payment methods, viewing invoices, switching between your two prices and cancelling.

Rules: new businesses get a 14-day trial (`TRIAL_DAYS`) without a card. After the trial — or
7 days after a failed payment — **online booking pauses** (the booking page says so and shows
the business's contact details). The dashboard, existing appointments and reminders keep
working, and data is never locked. Plans limit team members (Solo 1, Team 8). Businesses that
existed before billing was enabled are complimentary.

## Testing providers safely

- Twilio test credentials don't deliver real messages; use your own phone number first.
- Stripe: use test-mode keys and the Stripe CLI (`stripe listen --forward-to https://<DOMAIN>/api/webhooks/stripe`).
