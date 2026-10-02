import type { LanguageCode } from '../../src/domain/types'
import type { ProviderRegistry } from './provider'

/**
 * Account emails to business users (password reset). Separate from the customer
 * notification engine, same provider layer — swap the email provider, both follow.
 */
export async function sendPasswordResetEmail(providers: ProviderRegistry, opts: { to: string; name: string; link: string; locale: LanguageCode; idempotencyKey: string }) {
  const provider = providers.for('email')
  if (!provider) return { ok: false as const, error: 'no email provider' }
  const he = opts.locale === 'he'
  return provider.send({
    idempotencyKey: `pwreset:${opts.idempotencyKey}`,
    channel: 'email',
    to: opts.to,
    locale: opts.locale,
    subject: he ? 'איפוס הסיסמה ל-BookFlow' : 'Reset your BookFlow password',
    body: he
      ? `היי ${opts.name}, ביקשתם לאפס את הסיסמה. לבחירת סיסמה חדשה (הקישור תקף לשעה): ${opts.link} — אם לא ביקשתם, אפשר להתעלם מההודעה.`
      : `Hi ${opts.name}, you asked to reset your password. Choose a new one (link valid for 1 hour): ${opts.link} — if this wasn't you, you can ignore this email.`,
  })
}

/** Team invitation to sign in to a business. */
export async function sendInvitationEmail(providers: ProviderRegistry, opts: { to: string; inviter: string; businessName: string; link: string; locale: LanguageCode; idempotencyKey: string }) {
  const provider = providers.for('email')
  if (!provider) return { ok: false as const, error: 'no email provider' }
  const he = opts.locale === 'he'
  return provider.send({
    idempotencyKey: `invite:${opts.idempotencyKey}`,
    channel: 'email',
    to: opts.to,
    locale: opts.locale,
    subject: he ? `${opts.inviter} הזמין/ה אותך ל-${opts.businessName} ב-BookFlow` : `${opts.inviter} invited you to ${opts.businessName} on BookFlow`,
    body: he
      ? `שלום, ${opts.inviter} הזמין/ה אותך להצטרף לצוות של ${opts.businessName} ב-BookFlow. לקבלת ההזמנה (בתוקף ל-7 ימים): ${opts.link}`
      : `Hi, ${opts.inviter} invited you to join ${opts.businessName} on BookFlow. Accept the invitation (valid for 7 days): ${opts.link}`,
  })
}

/** Confirms that the account's email address is real. */
export async function sendVerificationEmail(providers: ProviderRegistry, opts: { to: string; name: string; link: string; locale: LanguageCode; idempotencyKey: string }) {
  const provider = providers.for('email')
  if (!provider) return { ok: false as const, error: 'no email provider' }
  const he = opts.locale === 'he'
  return provider.send({
    idempotencyKey: `verify:${opts.idempotencyKey}`,
    channel: 'email',
    to: opts.to,
    locale: opts.locale,
    subject: he ? 'אימות כתובת האימייל ב-BookFlow' : 'Confirm your BookFlow email',
    body: he
      ? `היי ${opts.name}, כדי לאשר שזו כתובת האימייל שלך (הקישור תקף ל-3 ימים): ${opts.link}`
      : `Hi ${opts.name}, please confirm this is your email address (link valid for 3 days): ${opts.link}`,
  })
}
