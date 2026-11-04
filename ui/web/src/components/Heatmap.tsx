import { useEffect, useMemo, useRef, useState } from 'react'
import { levels } from '../logic'
import { useStore } from '../store'

/** Days of commit counts the control center asks for: enough for the widest grid (53 weeks). */
export const HEAT_DAYS = 371
const MAX_WEEKS = 53
const MIN_WEEKS = 12
const CELL = 11
const GAP = 3

/** Day start (local) in unix seconds. */
const dayStart = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000)

/**
 * The contribution grid: one square per day, columns are weeks, as many weeks as fit (up to a year).
 * Each square opens that day. `days` is null while the counts load (the grid shows as a skeleton).
 */
export function Heatmap({ days, picked, onPick }: { days: Record<number, number> | null; picked: number | null; onPick: (day: number | null) => void }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // As many weeks as fit; past a year the squares grow a little instead (up to 15 px).
  const fit = Math.floor((width + GAP) / (CELL + GAP))
  const weeksN = Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, fit || 26))
  const cell = fit > MAX_WEEKS ? Math.min(15, Math.floor((width + GAP) / MAX_WEEKS) - GAP) : CELL

  const grid = useMemo(() => {
    const today = new Date()
    const end = dayStart(today)
    // Weeks run Monday to Sunday; the last column is this week. Days advance by calendar date, so
    // daylight-saving changes never shift a square.
    const toSunday = 6 - ((today.getDay() + 6) % 7)
    const cells: { day: number; n: number }[] = []
    for (let i = weeksN * 7 - 1; i >= 0; i--) {
      const d = dayStart(new Date(today.getFullYear(), today.getMonth(), today.getDate() + toSunday - i))
      cells.push({ day: d, n: d > end ? -1 : days?.[d] ?? 0 })
    }
    const past = cells.filter((c) => c.n >= 0)
    const level = levels(past.map((c) => c.n))
    const total = past.reduce((s, c) => s + c.n, 0)
    const active = past.filter((c) => c.n > 0).length
    // Streak: consecutive days with commits up to today (today without commits yet does not break it).
    let streak = 0
    for (let i = past.length - 1; i >= 0; i--) {
      if (past[i].n > 0) streak++
      else if (i === past.length - 1) continue
      else break
    }
    const best = past.reduce((m, c) => (c.n > m.n ? c : m), { day: 0, n: 0 })
    return { cells, level, total, active, streak, best, perWeek: total / weeksN }
  }, [days, weeksN])

  const fmt = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' })
  const month = new Intl.DateTimeFormat(lang, { month: 'short' })
  const weeks = Array.from({ length: weeksN }, (_, w) => grid.cells.slice(w * 7, w * 7 + 7))

  return (
    <figure className="heatmap" aria-label={t('heatTitle')} style={{ ['--cell' as string]: `${cell}px` }}>
      <figcaption>
        {days ? (
          <>
            <b>{t('heatTotal', { n: grid.total, w: weeksN })}</b>
            <span className="muted">{t('heatActive', { n: grid.active })}</span>
            <span className="muted small heat-hint">{t('heatPickHint')}</span>
          </>
        ) : <><i className="skel" style={{ width: 220, height: 14 }} /><i className="skel" style={{ width: 120, height: 14 }} /></>}
      </figcaption>
      <div className="heat-body">
        <div className="heat-wrap" ref={wrap}>
          <div className={`heat-grid${days ? '' : ' is-loading'}`} aria-busy={!days}>
            {weeks.map((week, w) => {
              const first = new Date(week[0].day * 1000)
              const showMonth = w === 0 ? first.getDate() <= 21 : first.getDate() <= 7
              return (
                <div key={w} className="heat-week">
                  <span className="heat-month">{showMonth ? month.format(first) : ''}</span>
                  {week.map((c) => c.n < 0
                    ? <i key={c.day} className="is-future" />
                    : (
                      <button key={c.day} type="button" disabled={!days} className={`l${grid.level(c.n)}${picked === c.day ? ' is-picked' : ''}`}
                        aria-pressed={picked === c.day}
                        aria-label={`${c.n === 1 ? t('heatCellOne') : t('heatCell', { n: c.n })} · ${fmt.format(c.day * 1000)}`}
                        title={days ? `${c.n === 1 ? t('heatCellOne') : t('heatCell', { n: c.n })} · ${fmt.format(c.day * 1000)}` : undefined}
                        onClick={() => onPick(picked === c.day ? null : c.day)} />
                    ))}
                </div>
              )
            })}
          </div>
          <div className="heat-legend" aria-hidden="true">
            <span>{t('heatLess')}</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`l${l}`} />)}<span>{t('heatMore')}</span>
          </div>
        </div>
        {days && (
          <dl className="heat-stats">
            <div><dt>{t('heatStreak')}</dt><dd>{grid.streak === 1 ? t('heatDayOne') : t('heatDays', { n: grid.streak })}</dd></div>
            <div>
              <dt>{t('heatBestDay')}</dt>
              <dd>{grid.best.n > 0
                ? <button type="button" className="link" onClick={() => onPick(grid.best.day)}>{fmt.format(grid.best.day * 1000)} · {grid.best.n}</button>
                : '—'}</dd>
            </div>
            <div><dt>{t('heatPerWeek')}</dt><dd>{grid.perWeek >= 10 ? Math.round(grid.perWeek) : grid.perWeek.toFixed(1)}</dd></div>
          </dl>
        )}
      </div>
    </figure>
  )
}
