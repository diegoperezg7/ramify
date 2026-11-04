import { FolderGit2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { agentName, agentVar } from '../agents'
import { bridge } from '../bridge'
import { relTime } from '../i18n'
import { agentTimeByDay, lastActivity, lastDays, timeBy } from '../logic'
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
  const recent = useMemo(() => lastActivity(sessions ?? [], now - 7 * DAY, now).slice(0, 6), [sessions, now])

  if (sessions === null) return <section className="cc-now" aria-busy="true"><i className="skel" style={{ width: 160, height: 14 }} /></section>

  return (
    <section className="cc-now" aria-label={t('ccNowTitle')}>
      <h2 className={`cc-h2${live.length > 0 ? ' is-live' : ''}`}>{live.length > 0 && <i className="pulse" />}{t('ccNowTitle')}{live.length > 0 && <span className="muted"> · {live.length}</span>}</h2>
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

/** Agent activity over 7 or 30 days: hours per day stacked by agent, then time by project and by agent. */
export function ActivityCharts({ sessions, now }: { sessions: AgentSession[] | null; now: number }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const [range, setRange] = useState<7 | 30>(() => { try { return localStorage.getItem('ramify-cc-range') === '30' ? 30 : 7 } catch { return 7 } })
  const [hover, setHover] = useState<number | null>(null)
  const pick = (r: 7 | 30) => { setRange(r); try { localStorage.setItem('ramify-cc-range', String(r)) } catch { /* storage unavailable */ } }

  const data = useMemo(() => {
    const list = sessions ?? []
    const days = lastDays(range, now)
    const rows = agentTimeByDay(list, days, now)
    const totals = new Map<string, number>()
    for (const r of rows) for (const [a, ms] of Object.entries(r.byAgent)) totals.set(a, (totals.get(a) ?? 0) + ms)
    // Stack order and legend: busiest agent first, at the bottom; colour still follows the agent.
    const agents = [...totals].sort((a, b) => b[1] - a[1]).map(([a]) => a)
    const peak = Math.max(0, ...rows.map((r) => Object.values(r.byAgent).reduce((s, ms) => s + ms, 0)))
    const from = days[0]
    const projects = timeBy(list, (s) => s.repo, from, now)
    const byAgent = timeBy(list, (s) => s.agent, from, now)
    return { rows, agents, max: niceHours(peak), projects, byAgent }
  }, [sessions, range, now])

  const day = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' })
  const tick = new Intl.DateTimeFormat(lang, range === 7 ? { weekday: 'short' } : { day: 'numeric' })
  const shown = hover ?? data.rows.length - 1
  const shownRow = data.rows[shown]
  const shownTotal = shownRow ? Object.values(shownRow.byAgent).reduce((s, ms) => s + ms, 0) : 0
  const empty = data.agents.length === 0
  const top = data.projects.slice(0, 6)
  const rest = data.projects.slice(6).reduce((s, p) => s + p.ms, 0)
  const projMax = Math.max(1, ...data.projects.map((p) => p.ms))
  const agentMax = Math.max(1, ...data.byAgent.map((p) => p.ms))

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

      <div className="chart-grid">
        <figure className="chart-card chart-wide">
          <figcaption>
            <b>{t('ccDailyTitle')}</b>
            <span className="muted small chart-readout" aria-live="polite">
              {shownRow && t('ccDayTotal', { date: day.format(shownRow.day), time: duration(shownTotal) })}
              {shownRow && data.agents.filter((a) => shownRow.byAgent[a]).map((a) => (
                <span key={a} className="readout-item"><i style={{ background: agentVar(a) }} />{agentName(a)} {duration(shownRow.byAgent[a])}</span>
              ))}
            </span>
          </figcaption>
          {empty ? <p className="muted small chart-empty">{t('ccNoActivity')}</p> : (
            <>
              <div className="bars" role="img" aria-label={`${t('ccDailyTitle')}: ${data.rows.map((r) => `${day.format(r.day)} ${duration(Object.values(r.byAgent).reduce((s, ms) => s + ms, 0))}`).join(', ')}`}
                onMouseLeave={() => setHover(null)}>
                <span className="bars-axis" aria-hidden="true"><span>{duration(data.max)}</span><span>{duration(data.max / 2)}</span><span>0</span></span>
                <span className="bars-plot">
                  {data.rows.map((r, i) => (
                    <span key={r.day} className={`bar-col${hover === i ? ' is-hover' : ''}`} onMouseEnter={() => setHover(i)}
                      title={`${day.format(r.day)}${data.agents.filter((a) => r.byAgent[a]).map((a) => `\n${agentName(a)}: ${duration(r.byAgent[a])}`).join('')}`}>
                      <span className="bar-stack">
                        {data.agents.filter((a) => r.byAgent[a]).map((a) => (
                          <i key={a} style={{ height: `${(r.byAgent[a] / data.max) * 100}%`, background: agentVar(a) }} />
                        ))}
                      </span>
                      <span className="bar-tick">{range === 7 || i % 5 === (data.rows.length - 1) % 5 ? tick.format(r.day) : ''}</span>
                    </span>
                  ))}
                </span>
              </div>
              {data.agents.length > 1 && (
                <div className="chart-legend">
                  {data.agents.map((a) => <span key={a}><i style={{ background: agentVar(a) }} />{agentName(a)}</span>)}
                </div>
              )}
            </>
          )}
          <p className="muted small chart-note">{t('ccDailyHint')}</p>
        </figure>

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

function HBar({ label, title, agent, ms, max, muted }: { label: string; title?: string; agent?: string; ms: number; max: number; muted?: boolean }) {
  return (
    <li className="hbar" title={title ?? label}>
      <span className="hbar-label">{agent && <AgentBadge agent={agent} size={16} />}<span>{label}</span></span>
      <span className="hbar-track"><i style={{ width: `${Math.max(2, (ms / max) * 100)}%`, background: agent ? agentVar(agent) : muted ? 'var(--lane-base)' : 'var(--accent)' }} /></span>
      <span className="hbar-value mono">{duration(ms)}</span>
    </li>
  )
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
