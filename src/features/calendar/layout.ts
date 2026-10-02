import type { AppointmentView } from '@/domain/types'

export interface PositionedEvent {
  appt: AppointmentView
  lane: number
  lanes: number
}

/**
 * Assigns overlapping events to side-by-side lanes (classic calendar layout).
 * Events are grouped into clusters of transitive overlap; each cluster shares
 * one lane count so widths line up.
 */
export function layoutEvents(events: AppointmentView[]): PositionedEvent[] {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
  const out: PositionedEvent[] = []
  let cluster: PositionedEvent[] = []
  let laneEnds: string[] = []
  let clusterEnd = ''

  const flush = () => {
    const lanes = laneEnds.length
    cluster.forEach((e) => (e.lanes = lanes))
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }

  for (const appt of sorted) {
    if (cluster.length && appt.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= appt.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(appt.end)
    } else laneEnds[lane] = appt.end
    cluster.push({ appt, lane, lanes: 1 })
    clusterEnd = cluster.length === 1 || appt.end > clusterEnd ? appt.end : clusterEnd
  }
  if (cluster.length) flush()
  return out
}
