# Security overview

| Area | Measure |
|---|---|
| Passwords | scrypt (N=16384, r=8, p=1), per-user salt; min. 8 characters, not trivially repetitive |
| Sessions | random 256-bit token in an `HttpOnly`, `Secure` (production), `SameSite=Lax` cookie; only a SHA-256 hash is stored; 30-day expiry; password change/reset signs out other sessions; removing a team member ends their sessions |
| CSRF | state-changing API calls must be JSON (forms can't send it cross-site) and, in production, come from the app's own `Origin` |
| Brute force | rate limits on login, sign-up, password reset, invitations, verification, client error reports |
| Account enumeration | identical answers and timing for unknown emails (login, forgot password) |
| Multi-tenancy | every business-owned row carries `business_id`; composite `(business_id, id)` foreign keys; each request's repository is bound to the session's business — a client can't choose a business id |
| Authorization | roles per membership: owner (settings, team, billing, erasure) and team member (bookings, clients); enforced by the API |
| Tokens in links | password reset (1 h), invitations (7 days), email verification (3 days): random, single-use, stored hashed |
| Webhooks | Twilio (HMAC-SHA1), Resend/Svix (HMAC-SHA256 + timestamp), Stripe (HMAC-SHA256 + timestamp, idempotent per event id) |
| Uploads | PNG/JPEG/WebP only, verified by file signature, ≤ 2 MB, random file names, served with `nosniff` |
| Headers | strict Content-Security-Policy (no third-party origins; fonts are self-hosted), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `nosniff` |
| Input | server-side validation of every field (types, lengths, formats); request size limits (100 KB, 3 MB for images) |
| Messaging consent | clients can opt out (STOP / dashboard toggle); Smart Fill only messages clients who agreed to offers; addresses are taken from the client record, never from the request |
| Privacy | right to erasure (personal data removed, anonymous history kept); CSV export with formula-injection protection; no third-party trackers or font CDNs |
| Logs | no secrets, tokens, passwords or message bodies; query strings dropped |
| Production guardrails | the server refuses to start with unsafe settings (see DEPLOYMENT.md) |

Report vulnerabilities to the operator's security contact (set one up before the pilot).
