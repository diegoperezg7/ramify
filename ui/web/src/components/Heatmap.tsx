import { useMemo, type KeyboardEvent } from 'react'
import { levels } from '../logic'
import { useStore } from '../store'

const WEEKS = 26

/** Day start (local) in unix seconds. */
const dayStart = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000)

/** The contribution grid: one square per day for the last 26 weeks, columns are weeks. */
export function Heatmap({ days, onOpen }: { days: Record<number, number>; onOpen?: () => void }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const grid = useMemo(() => {
    const today = new Date()
    const end = dayStart(today)
    // Weeks run Monday to Sunday; the last column is this week. Days advance by calendar date, so
    // daylight-saving changes never shift a square.
    const toSunday = 6 - ((today.getDay() + 6) % 7)
    const cells: { day: number; n: number }[] = []
    for (let i = WEEKS * 7 - 1; i >= 0; i--) {
      const d = dayStart(new Date(today.getFullYear(), today.getMonth(), today.getDate() + toSunday - i))
      cells.push({ day: d, n: d > end ? -1 : days[d] ?? 0 })
    }
    const level = levels(cells.map((c) => c.n))
    const total = cells.reduce((s, c) => s + Math.max(0, c.n), 0)
    const active = cells.filter((c) => c.n > 0).length
    return { cells, level, total, active }
  }, [days])
  const fmt = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' })
  const month = new Intl.DateTimeFormat(lang, { month: 'short' })
  const weeks = Array.from({ length: Math.ceil(grid.cells.length / 7) }, (_, w) => grid.cells.slice(w * 7, w * 7 + 7))

  return (
    <figure className={`heatmap${onOpen ? ' cc-clickable' : ''}`} aria-label={t('heatTitle')}
      {...(onOpen && { role: 'button', tabIndex: 0, onClick: onOpen, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } })}>
      <figcaption>
        <b>{t('heatTotal', { n: grid.total })}</b>
        <span className="muted">{t('heatActive', { n: grid.active, w: WEEKS })}</span>
      </figcaption>
      <div className="heat-grid" role="img" aria-label={t('heatTotal', { n: grid.total })}>
        {weeks.map((week, w) => {
          const first = new Date(week[0].day * 1000)
          const showMonth = w === 0 || first.getDate() <= 7
          return (
            <div key={w} className="heat-week">
              <span className="heat-month">{showMonth ? month.format(first) : ''}</span>
              {week.map((c) => (
                <i key={c.day} className={c.n < 0 ? 'is-future' : `l${grid.level(c.n)}`}
                  title={c.n < 0 ? undefined : `${c.n === 1 ? t('heatCellOne') : t('heatCell', { n: c.n })} · ${fmt.format(c.day * 1000)}`} />
              ))}
            </div>
          )
        })}
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>{t('heatLess')}</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`l${l}`} />)}<span>{t('heatMore')}</span>
      </div>
    </figure>
  )
}
