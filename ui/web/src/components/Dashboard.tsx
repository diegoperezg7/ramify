import { FolderGit2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { agentName, agentVar } from '../agents'
import { bridge } from '../bridge'
import { relTime } from '../i18n'
import { agentTimeByDay, dayLanes, isActive, lastActivity, lastDays, peakParallel, splitMinor, timeBy, unionMs } from '../logic'
import { useStore } from '../store'
import type { AgentSession, BranchHealth, TimelineCommit } from '../types'
import { AgentBadge } from './AgentBadge'
import { duration } from './Sessions'

const DAY = 86_400_000
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

/** Sessions that are work with an agent: not an AI app left open. */
const isWork = (s: AgentSession) => s.via !== 'app'

type Branches = Map<string, BranchHealth> // `${repo}#${branch}`

/**
 * Right now: one card per agent working, with where it works and what it has changed.
 * With nobody working, the latest work per project: when, with which agents and for how long.
 */
export function NowPanel({ sessions, branches, now }: { sessions: AgentSession[] | null; branches: Branches; now: number }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const repos = useStore((s) => s.repos)
  const setRepo = useStore((s) => s.setRepo)
  const select = useStore((s) => s.select)
  const known = (repo: string | null) => !!repo && repos.some((r) => r.path === repo)
  const open = (repo: string | null, path?: string) => { if (!repo || !known(repo)) return; setRepo(repo); if (path) select(path) }

  const live = useMemo(() => (sessions ?? []).filter((s) => s.end === null && !s.inferred && isWork(s))
    .sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting') || a.start - b.start), [sessions])
  // The count is what is running: sessions idle at their prompt are listed but not counted.
  const active = live.filter(isActive).length
  const recent = useMemo(() => lastActivity(sessions ?? [], now - 7 * DAY, now).slice(0, 6), [sessions, now])

  if (sessions === null) return <section className="cc-now" aria-busy="true"><i className="skel" style={{ width: 160, height: 14 }} /></section>

  return (
    <section className="cc-now" aria-label={t('ccNowTitle')}>
      <h2 className={`cc-h2${active > 0 ? ' is-live' : ''}`}>{active > 0 && <i className="pulse" />}{t('ccNowTitle')}{active > 0 && <span className="muted"> · {active}</span>}</h2>
      {live.length > 0 ? (
        <div className="now-grid">
          {live.map((s) => {
            const b = s.repo && s.branch ? branches.get(`${s.repo}#${s.branch}`) : undefined
            const state = s.state === 'waiting' ? 'waiting' : s.state === 'idle' ? 'idle' : 'working'
            const clickable = known(s.repo)
            return (
              <button key={s.id} type="button" className={`now-card${clickable ? '' : ' is-static'}`} disabled={!clickable}
                onClick={() => open(s.repo, b?.path)} style={{ ['--c' as string]: agentVar(s.agent) }}>
                <span className="now-top">
                  <AgentBadge agent={s.agent} size={30} live={state === 'working'} />
                  <span className="now-who"><b>{agentName(s.agent)}</b><span className="muted small">{s.host}</span></span>
                  <span className={`state-chip is-${state}`}>{t(state === 'waiting' ? 'stateWaiting' : state === 'idle' ? 'stateIdle' : 'stateWorking')}</span>
                </span>
                <span className="now-where">
                  <FolderGit2 size={13} /><b>{s.repo ? base(s.repo) : s.cwd ? base(s.cwd) : '—'}</b>
                  {s.branch && <span className="mono muted">⎇ {s.branch}</span>}
                </span>
                <span className="cc-facts">
                  <span className="muted small">{t('ccStarted', { when: relTime(lang, Math.floor(s.start / 1000), Math.floor(now / 1000)) })}</span>
                  {b && b.ahead > 0 && <span className="chip">{b.ahead === 1 ? t('ccAheadOne') : t('ccAhead', { n: b.ahead })}</span>}
                  {b && b.uncommitted > 0 && <span className="chip chip-warn">{t('ccUncommitted', { n: b.uncommitted })}</span>}
                  {b && b.added + b.deleted > 0 && <span className="chip cc-size"><ins>+{b.added}</ins> <del>−{b.deleted}</del></span>}
                  {b?.main && <span className="chip chip-warn">{t('ccOnMain')}</span>}
                </span>
              </button>
            )
          })}
        </div>
      ) : recent.length > 0 ? (
        <>
          <p className="muted small cc-lead">{t('ccNowNone')}</p>
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.repo}>
                <button type="button" className="recent-row" disabled={!known(r.repo)} onClick={() => open(r.repo)}>
                  <FolderGit2 size={15} /><b>{base(r.repo)}</b>
                  <span className="recent-agents">{r.agents.slice(0, 4).map((a) => <AgentBadge key={a} agent={a} size={20} />)}</span>
                  <span className="muted small">{t('ccLastSeen', { when: relTime(lang, Math.floor(r.last / 1000), Math.floor(now / 1000)) })}</span>
                  {r.ms > 0 && <span className="mono small">{t('ccTimeWeek', { time: duration(r.ms) })}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="muted small">{t('ccNoHistory')}</p>}
    </section>
  )
}

/**
 * Agent activity over 7 or 30 days: the figures that matter, hours per day stacked by agent (a day can be
 * picked), that day hour by hour with one lane per agent, then time by project and by agent.
 */
export function ActivityCharts({ sessions, now }: { sessions: AgentSession[] | null; now: number }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const [range, setRange] = useState<7 | 30>(() => { try { return localStorage.getItem('ramify-cc-range') === '30' ? 30 : 7 } catch { return 7 } })
  const [hover, setHover] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const pick = (r: 7 | 30) => { setRange(r); setPicked(null); try { localStorage.setItem('ramify-cc-range', String(r)) } catch { /* storage unavailable */ } }

  const data = useMemo(() => {
    const list = sessions ?? []
    const days = lastDays(range, now)
    const from = days[0]
    const rows = agentTimeByDay(list, days, now)
    const totals = new Map<string, number>()
    for (const r of rows) for (const [a, ms] of Object.entries(r.byAgent)) totals.set(a, (totals.get(a) ?? 0) + ms)
    // Agents with a sliver of the time fold into "others": a 2-minute stripe is noise, not information.
    const { main, minor } = splitMinor([...totals])
    const bars = rows.map((r) => {
      const segs = main.filter((a) => r.byAgent[a]).map((a) => ({ agent: a as string | null, ms: r.byAgent[a] }))
      const other = minor.reduce((s, a) => s + (r.byAgent[a] ?? 0), 0)
      if (other > 0) segs.push({ agent: null, ms: other })
      return { day: r.day, segs, total: segs.reduce((s, x) => s + x.ms, 0) }
    })
    const peakDay = Math.max(0, ...bars.map((b) => b.total))
    const projects = timeBy(list, (s) => s.repo, from, now)
    const work = list.filter((s) => s.via !== 'app' && (s.end ?? now) > from)
    return {
      bars, main, hasOther: minor.length > 0, max: niceHours(peakDay), projects,
      byAgent: timeBy(list, (s) => s.agent, from, now),
      time: unionMs(work.map((s) => [Math.max(s.start, from), s.end ?? now] as [number, number])),
      peak: peakParallel(list, from, now, now),
      count: work.length,
    }
  }, [sessions, range, now])

  const longDay = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' })
  const tick = new Intl.DateTimeFormat(lang, range === 7 ? { weekday: 'short' } : { day: 'numeric' })
  const clock = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
  const empty = data.main.length === 0
  const dayIndex = picked !== null ? data.bars.findIndex((b) => b.day === picked) : -1
  const selected = dayIndex >= 0 ? dayIndex : data.bars.length - 1
  const top = data.projects.slice(0, 6)
  const rest = data.projects.slice(6).reduce((s, p) => s + p.ms, 0)
  const projMax = Math.max(1, ...data.projects.map((p) => p.ms))
  const agentMax = Math.max(1, ...data.byAgent.map((p) => p.ms))
  const color = (agent: string | null) => (agent ? agentVar(agent) : 'var(--lane-base)')
  const label = (agent: string | null) => (agent ? agentName(agent) : t('ccOthers'))

  return (
    <section className="cc-activity" aria-label={t('ccActivityTitle')}>
      <div className="cc-section-head">
        <h2 className="cc-h2">{t('ccActivityTitle')}</h2>
        <div className="seg" role="radiogroup" aria-label={t('ccActivityTitle')}>
          {([7, 30] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} className={range === r ? 'is-on' : ''} onClick={() => pick(r)}>{t('ccRange', { n: r })}</button>
          ))}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile"><span className="stat-label">{t('ccStatTime')}</span><b className="stat-value">{duration(data.time)}</b></div>
        <div className="stat-tile">
          <span className="stat-label">{t('ccStatPeak')}</span><b className="stat-value">{data.peak.n}</b>
          {data.peak.at !== null && <span className="stat-sub">{longDay.format(data.peak.at)} · {clock.format(data.peak.at)}</span>}
        </div>
        <div className="stat-tile"><span className="stat-label">{t('ccStatSessions')}</span><b className="stat-value">{data.count}</b></div>
        <div className="stat-tile">
          <span className="stat-label">{t('ccStatTop')}</span>
          <b className="stat-value stat-text" title={data.projects[0]?.key}>{data.projects[0] ? base(data.projects[0].key) : '—'}</b>
          {data.projects[0] && <span className="stat-sub">{duration(data.projects[0].ms)}</span>}
        </div>
      </div>

      <div className="chart-grid">
        <figure className="chart-card chart-wide">
          <figcaption><b>{t('ccDailyTitle')}</b><span className="muted small">{t('ccPickDay')}</span></figcaption>
          {empty ? <p className="muted small chart-empty">{t('ccNoActivity')}</p> : (
            <>
              <div className="bars">
                <span className="bars-axis" aria-hidden="true"><span>{hours(data.max)}</span><span>{hours(data.max / 2)}</span><span>0</span></span>
                <span className="bars-plot" onMouseLeave={() => setHover(null)}>
                  {data.bars.map((b, i) => (
                    <button key={b.day} type="button" className={`bar-col${i === selected ? ' is-picked' : ''}${hover === i ? ' is-hover' : ''}`}
                      aria-pressed={i === selected}
                      aria-label={`${longDay.format(b.day)}: ${duration(b.total)}${b.segs.map((x) => `, ${label(x.agent)} ${duration(x.ms)}`).join('')}`}
                      onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                      onClick={() => setPicked(b.day)}>
                      <span className="bar-stack">
                        {b.segs.map((x) => <i key={x.agent ?? 'other'} style={{ height: `${(x.ms / data.max) * 100}%`, background: color(x.agent) }} />)}
                      </span>
                      <span className="bar-tick">{range === 7 || i % 5 === (data.bars.length - 1) % 5 ? tick.format(b.day) : ''}</span>
                      {hover === i && b.total > 0 && (
                        <span className={`chart-tip${i > data.bars.length * 0.66 ? ' is-left' : ''}`} role="tooltip">
                          <b>{longDay.format(b.day)}</b><span className="tip-total">{duration(b.total)}</span>
                          {b.segs.map((x) => <span key={x.agent ?? 'other'} className="tip-row"><i style={{ background: color(x.agent) }} />{label(x.agent)}<span>{duration(x.ms)}</span></span>)}
                        </span>
                      )}
                    </button>
                  ))}
                </span>
              </div>
              <div className="chart-legend">
                {data.main.map((a) => <span key={a}><i style={{ background: agentVar(a) }} />{agentName(a)}</span>)}
                {data.hasOther && <span><i style={{ background: 'var(--lane-base)' }} />{t('ccOthers')}</span>}
              </div>
            </>
          )}
        </figure>

        {!empty && <DayTimeline sessions={sessions ?? []} day={data.bars[selected].day} now={now} />}

        <figure className="chart-card">
          <figcaption><b>{t('ccByProject')}</b></figcaption>
          {top.length === 0 ? <p className="muted small chart-empty">{t('ccNoActivity')}</p> : (
            <ul className="hbars">
              {top.map((p) => <HBar key={p.key} label={base(p.key)} title={p.key} ms={p.ms} max={projMax} />)}
              {rest > 0 && <HBar label={t('ccOthers')} ms={rest} max={projMax} muted />}
            </ul>
          )}
        </figure>

        <figure className="chart-card">
          <figcaption><b>{t('ccByAgent')}</b></figcaption>
          {data.byAgent.length === 0 ? <p className="muted small chart-empty">{t('ccNoActivity')}</p> : (
            <ul className="hbars">
              {data.byAgent.slice(0, 7).map((a) => <HBar key={a.key} label={agentName(a.key)} agent={a.key} ms={a.ms} max={agentMax} />)}
            </ul>
          )}
        </figure>
      </div>
    </section>
  )
}

/** One day hour by hour: a lane per agent from 00:00 to 24:00, the moment now, and the peak of agents at once. */
function DayTimeline({ sessions, day, now }: { sessions: AgentSession[]; day: number; now: number }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const d = new Date(day)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  const lanes = useMemo(() => dayLanes(sessions, day, next, now), [sessions, day, next, now])
  const peak = useMemo(() => peakParallel(sessions, day, next, now), [sessions, day, next, now])
  const total = useMemo(() => unionMs(lanes.flatMap((l) => l.spans)), [lanes])
  const span = next - day
  const x = (ms: number) => `${((ms - day) / span) * 100}%`
  const clock = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
  const title = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(day)
  const hoursAt = [0, 3, 6, 9, 12, 15, 18, 21, 24]

  return (
    <figure className="chart-card chart-wide day-timeline">
      <figcaption>
        <b className="first-up">{t('ccDayTimeline', { date: title })}</b>
        <span className="muted small">
          {lanes.length ? t('ccTimeWithAgents', { time: duration(total) }) : t('ccNoActivity')}
          {peak.n > 1 && peak.at !== null && ` · ${t('ccPeakAt', { n: peak.n, time: clock.format(peak.at) })}`}
        </span>
      </figcaption>
      {lanes.length > 0 && (
        <div className="tl-day">
          <div className="tl-day-axis" aria-hidden="true">
            <span />
            <span className="tl-day-scale">{hoursAt.map((h) => <i key={h} style={{ left: `${(h / 24) * 100}%` }}>{String(h % 24).padStart(2, '0')}</i>)}</span>
            <span />
          </div>
          {lanes.map((l) => (
            <div key={l.agent} className="tl-day-lane">
              <span className="tl-day-who"><AgentBadge agent={l.agent} size={18} />{agentName(l.agent)}</span>
              <span className="tl-day-track">
                {hoursAt.slice(1, -1).map((h) => <i key={h} className="tl-day-grid" style={{ left: `${(h / 24) * 100}%` }} />)}
                {now >= day && now < next && <i className="tl-day-now" style={{ left: x(now) }} />}
                {l.spans.map(([a, b]) => (
                  <i key={a} className="tl-day-span" style={{ left: x(a), width: `max(3px, ${((b - a) / span) * 100}%)`, background: agentVar(l.agent) }}
                    title={`${agentName(l.agent)} · ${clock.format(a)}–${clock.format(b)} · ${duration(b - a)}`} />
                ))}
              </span>
              <span className="tl-day-total mono">{duration(l.ms)}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  )
}

function HBar({ label, title, agent, ms, max, muted }: { label: string; title?: string; agent?: string; ms: number; max: number; muted?: boolean }) {
  return (
    <li className="hbar" title={title ?? label}>
      <span className="hbar-label">{agent && <AgentBadge agent={agent} size={16} />}<span>{label}</span></span>
      <span className="hbar-track"><i style={{ width: `${Math.max(2, (ms / max) * 100)}%`, background: agent ? agentVar(agent) : muted ? 'var(--lane-base)' : 'var(--accent)' }} /></span>
      <span className="hbar-value mono">{duration(ms)}</span>
    </li>
  )
}

/** An axis label: "8 h", or "30 min" under an hour. */
function hours(ms: number): string {
  return ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 60_000)} min`
}

/** A round top for the hour axis: 1, 2, 4, 6, 8, 12 or 24 h (at least 1 h). */
function niceHours(ms: number): number {
  const h = ms / 3_600_000
  const step = [1, 2, 4, 6, 8, 12, 16, 24].find((s) => s >= h) ?? Math.ceil(h / 24) * 24
  return step * 3_600_000
}

/** One day, opened from the contribution grid: its commits per repository and its AI sessions. */
export function DayPanel({ day, sessions, onClose }: { day: number; sessions: AgentSession[] | null; onClose: () => void }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const repos = useStore((s) => s.repos)
  const setRepo = useStore((s) => s.setRepo)
  const [commits, setCommits] = useState<{ repo: string; list: TimelineCommit[] }[] | null>(null)
  const reposKey = repos.map((r) => r.path).join('\n')

  useEffect(() => {
    let alive = true
    setCommits(null)
    void Promise.all((reposKey ? reposKey.split('\n') : []).map(async (repo) => ({ repo, list: await bridge.dayCommits(repo, day).catch(() => [] as TimelineCommit[]) })))
      .then((all) => { if (alive) setCommits(all.filter((x) => x.list.length).sort((a, b) => b.list.length - a.list.length)) })
    return () => { alive = false }
  }, [day, reposKey])

  const start = day * 1000
  const d = new Date(start)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  const daySessions = useMemo(() => (sessions ?? []).filter((s) => isWork(s) && s.start < end && (s.end ?? Date.now()) > start).sort((a, b) => a.start - b.start), [sessions, start, end])
  const title = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start)
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
  const total = commits?.reduce((s, c) => s + c.list.length, 0) ?? 0

  return (
    <section className="day-panel" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}><X size={15} /></button>
      </header>
      <div className="day-cols">
        <div>
          <h4 className="pane-kicker">{t('dayCommits')}{commits && <span className="muted"> · {total}</span>}</h4>
          {commits === null ? <p aria-busy="true"><i className="skel" style={{ width: '70%' }} /></p>
            : commits.length === 0 ? <p className="muted small">{t('dayNoCommits')}</p>
            : commits.map((c) => (
              <div key={c.repo} className="day-repo">
                <button type="button" className="link day-repo-name" onClick={() => setRepo(c.repo)}><FolderGit2 size={13} />{base(c.repo)}<span className="muted"> · {c.list.length}</span></button>
                <ul>
                  {c.list.slice(0, 8).map((x) => <li key={x.hash}><span className="mono muted">{time.format(x.time * 1000)}</span><span className="day-subject">{x.subject}</span></li>)}
                  {c.list.length > 8 && <li className="muted small">{t('dayMore', { n: c.list.length - 8 })}</li>}
                </ul>
              </div>
            ))}
        </div>
        <div>
          <h4 className="pane-kicker">{t('daySessions')}<span className="muted"> · {daySessions.length}</span></h4>
          {daySessions.length === 0 ? <p className="muted small">{t('dayNoSessions')}</p> : (
            <ul className="day-sessions">
              {daySessions.slice(0, 12).map((s) => (
                <li key={s.id}>
                  <AgentBadge agent={s.agent} size={18} live={s.end === null} />
                  <b>{agentName(s.agent)}</b>
                  <span className="muted">{s.repo ? base(s.repo) : s.cwd ? base(s.cwd) : s.host}{s.branch && ` ⎇ ${s.branch}`}</span>
                  <span className="mono muted day-when">{time.format(Math.max(s.start, start))} · {duration(Math.min(s.end ?? Date.now(), end) - Math.max(s.start, start))}</span>
                </li>
              ))}
              {daySessions.length > 12 && <li className="muted small">{t('dayMore', { n: daySessions.length - 12 })}</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
