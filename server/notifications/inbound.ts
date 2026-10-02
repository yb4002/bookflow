import { newId } from '../../src/domain/bookingRules'
import { isPhoneCountry, toE164 } from '../../src/domain/phone'
import type { Sql } from '../db/sqlite'
import type { DomainEvent } from '../domainEvents'
import { keyword, OPT_IN_WORDS, OPT_OUT_WORDS } from './providers/twilio'

/**
 * A reply from a client's phone (SMS/WhatsApp). STOP-style keywords opt that number out of all
 * messages from every business on this platform (the sending number is shared); START opts back in.
 * Everything is stored for the record.
 */
export function handleInboundMessage(
  sql: Sql,
  emit: (e: DomainEvent) => void,
  msg: { provider: string; channel: 'sms' | 'whatsapp'; from: string; to: string; body: string },
  now: Date,
): { action: 'opted_out' | 'opted_in' | 'stored'; customers: number } {
  const from = msg.from.replace(/^whatsapp:/, '')
  sql.run('INSERT INTO inbound_messages (id, provider, channel, from_address, to_address, body, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    newId('inb'), msg.provider, msg.channel, from, msg.to.replace(/^whatsapp:/, ''), msg.body.slice(0, 2000), now.toISOString(),
  ])
  const word = keyword(msg.body)
  const action = OPT_OUT_WORDS.has(word) ? 'opted_out' : OPT_IN_WORDS.has(word) && word !== 'yes' ? 'opted_in' : 'stored'
  if (action === 'stored') return { action, customers: 0 }

  // Clients whose stored number is this phone (compared in E.164, per business country).
  const tail = from.replace(/\D/g, '').slice(-7)
  const candidates = sql.all<{ id: string; business_id: string; phone: string; phone_country: string }>(
    `SELECT c.id, c.business_id, c.phone, s.phone_country FROM customers c JOIN business_settings s ON s.business_id = c.business_id
     WHERE c.erased_at IS NULL AND c.phone_digits LIKE ?`,
    [`%${tail}`],
  )
  const matches = candidates.filter((c) => toE164(c.phone, isPhoneCountry(c.phone_country) ? c.phone_country : 'US') === from)
  sql.transaction(() => {
    for (const c of matches) {
      sql.run('UPDATE customers SET messaging_opt_out_at = ?, updated_at = ? WHERE id = ?', [action === 'opted_out' ? now.toISOString() : null, now.toISOString(), c.id])
      if (action === 'opted_out') emit({ type: 'customer.opted_out', businessId: c.business_id, customerId: c.id })
    }
  })
  return { action, customers: matches.length }
}
