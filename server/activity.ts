import type { Sql } from './db/sqlite'

/** Things that happened without the business doing them — shown in the dashboard's activity menu. */
export interface ActivityItem {
  id: string
  type: 'booked' | 'cancelled' | 'rescheduled' | 'message_failed'
  at: string
  appointmentId?: string
  customerName: string
  serviceName?: string
  start?: string
}

/** Most recent first: online bookings, client cancellations and moves, failed messages. */
export function listActivity(sql: Sql, businessId: string, since: Date, limit = 30): ActivityItem[] {
  const iso = since.toISOString()
  const rows = sql.all<{ id: string; type: ActivityItem['type']; at: string; appointment_id: string | null; first_name: string; last_name: string; service_name: string | null; start_at: string | null }>(
    `SELECT * FROM (
       SELECT 'b:' || a.id AS id, 'booked' AS type, a.created_at AS at, a.id AS appointment_id, c.first_name, c.last_name, s.name AS service_name, a.start_at
       FROM appointments a JOIN customers c ON c.business_id = a.business_id AND c.id = a.customer_id JOIN services s ON s.business_id = a.business_id AND s.id = a.service_id
       WHERE a.business_id = :biz AND a.source = 'online' AND a.created_at >= :since
       UNION ALL
       SELECT 'c:' || a.id, 'cancelled', a.cancelled_at, a.id, c.first_name, c.last_name, s.name, a.start_at
       FROM appointments a JOIN customers c ON c.business_id = a.business_id AND c.id = a.customer_id JOIN services s ON s.business_id = a.business_id AND s.id = a.service_id
       WHERE a.business_id = :biz AND a.cancelled_by = 'customer' AND a.cancelled_at >= :since
       UNION ALL
       SELECT 'r:' || a.id || ':' || a.rescheduled_at, 'rescheduled', a.rescheduled_at, a.id, c.first_name, c.last_name, s.name, a.start_at
       FROM appointments a JOIN customers c ON c.business_id = a.business_id AND c.id = a.customer_id JOIN services s ON s.business_id = a.business_id AND s.id = a.service_id
       WHERE a.business_id = :biz AND a.rescheduled_by = 'customer' AND a.rescheduled_at >= :since
       UNION ALL
       SELECT 'f:' || n.id, 'message_failed', n.updated_at, n.appointment_id, c.first_name, c.last_name, NULL, NULL
       FROM notifications n JOIN customers c ON c.business_id = n.business_id AND c.id = n.customer_id
       WHERE n.business_id = :biz AND n.status = 'failed' AND n.updated_at >= :since
     ) ORDER BY at DESC LIMIT :limit`,
    { biz: businessId, since: iso, limit },
  )
  return rows.map((r) => {
    const item: ActivityItem = { id: r.id, type: r.type, at: r.at, customerName: `${r.first_name} ${r.last_name}`.trim() }
    if (r.appointment_id) item.appointmentId = r.appointment_id
    if (r.service_name) item.serviceName = r.service_name
    if (r.start_at) item.start = r.start_at
    return item
  })
}
