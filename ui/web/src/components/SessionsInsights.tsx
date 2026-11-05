import { FolderGit2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { relTime } from '../i18n'
import { lastDays, unionMs } from '../logic'
import { useStore } from '../store'
import type { AgentSession } from '../types'
import { duration } from './Sessions'

const DAY = 86_400_000
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
/** Work with an agent: an AI app left open is not. */
const work = (list: AgentSession[]) => list.filter((s) => s.via !== 'app')

/**
 * Cards that fill their rows: as many columns as fit (each at least `min` wide, at most `max` of them), the rows as
 * even as they can be, and the last card spanning what is left of its row. No holes beside a short last row.
 */
export function useFill(n: number, min: number, max: number): { ref: RefObject<HTMLDivElement | null>; style: CSSProperties } {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = Math.max(1, Math.min(max, Math.floor((w + 12) / (min + 12)) || 1))
  const rows = Math.max(1, Math.ceil(n / fit))
  const cols = Math.max(1, Math.ceil(n / rows))
  const last = n - cols * (rows - 1)
  return { ref, style: { ['--cols' as string]: cols, ['--span' as string]: cols - last + 1 } }
}

/** A grid of cards laid out by useFill. */
export function FillGrid({ n, min, max, className, children }: { n: number; min: number; max: number; className?: string; children: ReactNode }) {
  const { ref, style } = useFill(n, min, max)
  return <div ref={ref} className={`sess-grid${className ? ` ${className}` : ''}`} style={style}>{children}</div>
}

/** Hours with AI per day (parallel sessions once, whatever the agent) and three figures: streak, daily mean, longest. */
export function ActivityStrip({ sessions, days: n, now, children }: { sessions: AgentSession[]; days: number; now: number; children?: ReactNode }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const data = useMemo(() => {
    const days = lastDays(n, now)
    const list = work(sessions)
    const bars = days.map((day, i) => {
      const next = i + 1 < days.length ? days[i + 1] : day + DAY
      const spans = list.map((s) => [Math.max(s.start, day), Math.min(s.end ?? now, next)] as [number, number])
      return { day, ms: unionMs(spans) }
    })
    // Days in a row with AI, up to today (or yesterday, while today has not started yet).
    let streak = 0
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].ms > 0) streak++
      else if (i === bars.length - 1) continue
      else break
    }
    const active = bars.filter((b) => b.ms > 0)
    const mean = active.length ? active.reduce((s, b) => s + b.ms, 0) / active.length : 0
    const inRange = list.filter((s) => (s.end ?? now) > days[0])
    const longest = inRange.reduce<AgentSession | null>((m, s) => (!m || (s.end ?? now) - s.start > (m.end ?? now) - m.start ? s : m), null)
    // The scale in whole hours, at least two: one short day does not fill the chart.
    const top = Math.max(2, Math.ceil(Math.max(...bars.map((b) => b.ms)) / 3_600_000)) * 3_600_000
    return { bars, streak, mean, longest, top }
  }, [sessions, n, now])

  const tick = new Intl.DateTimeFormat(lang, n <= 7 ? { weekday: 'short' } : { day: 'numeric' })
  const long = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' })
  const today = data.bars[data.bars.length - 1]?.day
  const hours = data.top / 3_600_000

  return (
    <section className="sess-panel sess-strip" aria-label={t('stripTitle')}>
      {/* Figures and the repositories on the side; the chart takes whatever height that side needs. */}
      <div className="sess-strip-side">
      <h2 className="pane-kicker">{t('stripTitle')}</h2>
      <div className="sess-figs">
        <div className="sess-fig"><span>{t('stripStreak')}</span><b>{t(data.streak === 1 ? 'stripDay' : 'stripDays', { n: data.streak })}</b></div>
        <div className="sess-fig"><span>{t('stripMean')}</span><b>{duration(data.mean)}</b></div>
        <div className="sess-fig">
          <span>{t('stripLongest')}</span>
          <b>{data.longest ? duration((data.longest.end ?? now) - data.longest.start) : '—'}</b>
          {data.longest && <em>{data.longest.repo ? base(data.longest.repo) : t('outsideRepo')}</em>}
        </div>
      </div>
      {children}
      </div>
      <div className="sess-chart">
        <span className="sess-axis" aria-hidden="true"><i>{hours} h</i><i>{hours / 2} h</i><i>0</i></span>
        <div className="sess-bars" role="img" aria-label={t('stripTitle')}>
          {data.bars.map((b, i) => (
            <span key={b.day} className={`sess-bar${b.day === today ? ' is-today' : ''}`} title={`${long.format(b.day)} · ${duration(b.ms)}`}>
              <span className="sess-bar-col">
                {b.ms > 0 && <i style={{ height: `max(3px, ${(b.ms / data.top) * 100}%)` }}>{n <= 7 && <em>{duration(b.ms)}</em>}</i>}
              </span>
              <small>{n <= 7 || i % 5 === (data.bars.length - 1) % 5 ? tick.format(b.day) : ''}</small>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The repositories with sessions this week, as a list: time with AI as a bar, sessions, branches and when. */
export function RepoWeek({ sessions, now, onOpen }: { sessions: AgentSession[]; now: number; onOpen: (repo: string) => void }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const repos = useStore((s) => s.repos)
  const rows = useMemo(() => {
    const from = now - 7 * DAY
    const by = new Map<string, { spans: [number, number][]; n: number; branches: Set<string>; last: number }>()
    for (const s of work(sessions)) {
      const end = s.end ?? now
      if (!s.repo || end < from) continue
      const e = by.get(s.repo) ?? { spans: [], n: 0, branches: new Set<string>(), last: 0 }
      e.spans.push([Math.max(s.start, from), end])
      e.n++
      if (s.branch) e.branches.add(s.branch)
      e.last = Math.max(e.last, end)
      by.set(s.repo, e)
    }
    return [...by].map(([repo, e]) => ({ repo, ms: unionMs(e.spans), n: e.n, branches: e.branches.size, last: e.last, live: sessions.some((s) => s.repo === repo && s.end === null) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 6)
  }, [sessions, now])
  if (rows.length === 0) return null
  const known = (r: string) => repos.some((x) => x.path === r)
  const max = Math.max(1, ...rows.map((r) => r.ms))

  return (
    <section className="repo-week" aria-label={t('repoWeekTitle')}>
      <h3 className="pane-kicker">{t('repoWeekTitle')}</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.repo}>
            <button type="button" disabled={!known(r.repo)} onClick={() => onOpen(r.repo)} title={r.repo}>
              <span className="repo-week-name"><FolderGit2 size={14} /><b>{base(r.repo)}</b>{r.live && <i className="pulse" />}</span>
              <span className="repo-week-time mono">{duration(r.ms)}</span>
              <span className="repo-week-bar"><i style={{ width: `${Math.max(2, (r.ms / max) * 100)}%` }} /></span>
              <span className="repo-week-sub muted">
                {t(r.n === 1 ? 'repoWeekSession' : 'repoWeekSessions', { n: r.n })}
                {r.branches > 1 && ` · ${t('repoWeekBranches', { n: r.branches })}`}
                {' · '}{r.live ? t('repoWeekNow') : relTime(lang, Math.floor(r.last / 1000), Math.floor(now / 1000))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
