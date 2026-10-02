import { useState } from 'react'
import { useI18n } from '@/i18n'

export interface BookingsDatum {
  date: Date
  count: number
  revenue: number
}

/**
 * Single-series bar chart (bookings per day). One hue, so no legend — the card
 * title names the series. Thin bars, 4px rounded tops anchored to the baseline,
 * recessive grid, hover tooltip, and a screen-reader table fallback.
 *
 * RTL: time flows right-to-left and the value axis sits on the right. The SVG
 * itself is forced to `direction="ltr"` so text anchors stay physical and predictable.
 */
export function BookingsChart({ data }: { data: BookingsDatum[] }) {
  const { t, f, plural, dir } = useI18n()
  const c = t.dashboard.chart
  const rtl = dir === 'rtl'
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(4, ...data.map((d) => d.count))
  const niceMax = Math.ceil(max / 4) * 4
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax]

  const W = 640
  const H = 240
  const axisW = 28
  const padB = 22
  const plotW = W - axisW
  const plotH = H - padB
  const plotX0 = rtl ? 0 : axisW
  const slot = plotW / data.length
  const barW = Math.min(22, slot * 0.56)
  const y = (v: number) => plotH - (v / niceMax) * plotH
  /** Physical slot index for data index i (mirrored in RTL). */
  const pos = (i: number) => (rtl ? data.length - 1 - i : i)
  const slotX = (i: number) => plotX0 + slot * pos(i)

  const h = hover !== null ? data[hover] : null

  return (
    <div className="relative">
      <svg direction="ltr" viewBox={`0 0 ${W} ${H}`} className="h-60 w-full overflow-visible sm:h-64" role="img" aria-label={c.ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={plotX0} x2={plotX0 + plotW} y1={y(tick)} y2={y(tick)} className="stroke-slate-100" strokeWidth={1} />
            <text
              x={rtl ? plotW + 8 : axisW - 8}
              y={y(tick)}
              dy="0.32em"
              textAnchor={rtl ? 'start' : 'end'}
              className="fill-slate-400 text-[10px] tabular-nums"
            >
              {f.number(tick)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = slotX(i) + slot / 2
          const bh = Math.max(0, plotH - y(d.count))
          const r = Math.min(4, bh)
          const x0 = cx - barW / 2
          const top = y(d.count)
          const isToday = i === data.length - 1
          const active = hover === i
          // Path with rounded top corners only, flat on the baseline.
          const path = bh > 0
            ? `M${x0},${plotH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${plotH} Z`
            : ''
          // "Today" sits at the outer edge, so anchor it inward to stay inside the plot.
          const labelX = isToday ? (rtl ? x0 : x0 + barW) : cx
          const labelAnchor = isToday ? (rtl ? 'start' : 'end') : 'middle'
          return (
            <g key={d.date.toISOString()}>
              {active && <rect x={slotX(i) + 2} y={0} width={slot - 4} height={plotH} rx={6} className="fill-slate-100/80" />}
              {path && <path d={path} className={isToday ? 'fill-brand-400' : 'fill-brand-600'} opacity={hover !== null && !active ? 0.55 : 1} />}
              {/* Every other day, counted back from today so today is always labelled. */}
              {((data.length - 1 - i) % 2 === 0 || data.length <= 7) && (
                <text x={labelX} y={H - 6} textAnchor={labelAnchor} className={isToday ? 'fill-slate-700 text-[10px] font-semibold' : 'fill-slate-400 text-[10px]'}>
                  {isToday ? c.today : f.day(d.date)}
                </text>
              )}
              {/* Hit target wider than the mark */}
              <rect x={slotX(i)} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          )
        })}
        <line x1={plotX0} x2={plotX0 + plotW} y1={plotH} y2={plotH} className="stroke-slate-200" strokeWidth={1} />
      </svg>

      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs whitespace-nowrap text-white shadow-pop"
          style={{ left: `${((slotX(hover) + slot / 2) / W) * 100}%` }}
        >
          <p className="font-semibold">{f.dateMedium(h.date)}</p>
          <p className="mt-0.5 text-slate-300">
            <span className="font-semibold text-white tabular-nums">{f.number(h.count)}</span> {plural(c.bookings, h.count)} · {f.money(h.revenue)}
          </p>
        </div>
      )}

      <table className="sr-only">
        <caption>{c.caption}</caption>
        <thead><tr><th>{c.colDate}</th><th>{c.colBookings}</th><th>{c.colRevenue}</th></tr></thead>
        <tbody>
          {data.map((d) => <tr key={d.date.toISOString()}><td>{f.monthDay(d.date)}</td><td>{f.number(d.count)}</td><td>{f.money(d.revenue)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}
