import { AppWindow, Bot, CircleAlert, Code2, Download, FileText, FolderGit2, GitBranch, GitPullRequest, MoreHorizontal, Pencil, Search, SquareTerminal, Trash2, Upload, Users, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { bridge } from '../bridge'
import { agentName } from '../agents'
import { relTime } from '../i18n'
import { isActive, unionMs } from '../logic'
import { useStore } from '../store'
import type { AgentChild, AgentSession, BranchHealth } from '../types'
import { AgentBadge } from './AgentBadge'
import { Dialog } from './Dialog'
import { BrandIcon, hasBrand } from './BrandIcon'
import { GithubIcon } from './GithubIcon'
import { ActivityStrip, FillGrid, RepoWeek } from './SessionsInsights'
import { Bar, SessionsSkeleton } from './Skeletons'

type Range = 'today' | 'week' | 'all'

/** Why a session needs you (the desktop app decides it, see core/attention.ts), as text keys. */
const ATTN = { waiting: 'attnWaiting', shared: 'attnShared', main: 'attnMain', ready: 'attnReady' } as const

const base = (p: string | null) => (p ? p.split('/').filter(Boolean).pop() ?? p : '')
/** ['claude', 'claude', 'codex'] → "claude ×2, codex" */
const countAgents = (list: string[]) => [...new Set(list)].map((a) => { const n = list.filter((x) => x === a).length; return n > 1 ? `${a} ×${n}` : a }).join(', ')
/** /Users/me/x → ~/x (also /home/me and C:/Users/me). */
const tilde = (p: string) => p.replace(/^(?:\/Users\/|\/home\/|[A-Za-z]:\/Users\/)[^/]+/, '~')

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} d ${h % 24} h`
}

function ViaIcon({ via, host }: { via: AgentSession['via']; host?: string }) {
  if (hasBrand(host)) return <BrandIcon name={host} size={14} />
  if (via === 'ide') return <Code2 size={13} />
  if (via === 'app') return <AppWindow size={13} />
  return <SquareTerminal size={13} />
}

function ChildIcon({ kind }: { kind: AgentChild['kind'] }) {
  if (kind === 'teammate') return <Users size={13} />
  if (kind === 'worktree') return <GitBranch size={13} />
  if (kind === 'codex') return <AppWindow size={13} />
  return <Bot size={13} />
}

export function Sessions() {
  const sessions = useStore((s) => s.sessions)
  const repos = useStore((s) => s.repos)
  const setRepo = useStore((s) => s.setRepo)
  const toast = useStore((s) => s.toast)
  const lang = useStore((s) => s.lang)
  const t = useStore((s) => s.t)
  const [range, setRange] = useState<Range>('week')
  const [publishing, setPublishing] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [moving, setMoving] = useState<{ repo: string; agent: string } | null>(null)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const children = useStore((s) => s.children)
  const [closing, setClosing] = useState<string | null>(null)
  const closeSession = async (key: string, ids: string[]) => {
    setClosing(key)
    try { for (const id of ids) await bridge.closeSession(id); await refreshSessions() } catch (e) { toast('error', (e as Error).message) } finally { setClosing(null) }
  }
  const now = Date.now()
  const known = (repo: string | null) => !!repo && repos.some((r) => r.path === repo)

  const live = useMemo(() => (sessions ?? []).filter((s) => s.end === null), [sessions])
  // Running now: open and not idle at its prompt.
  const active = useMemo(() => live.filter(isActive).length, [live])
  // Identical sessions (same agent, same place, same folder) read as one card with a count.
  const groups = useMemo(() => {
    const m = new Map<string, { s: AgentSession; n: number; ids: string[]; keys: string[] }>()
    for (const s of [...live].sort((a, b) => a.start - b.start)) {
      const k = [s.agent, s.host, s.via, s.cwd, s.branch, s.state].join('\u0000')
      const g = m.get(k)
      if (g) { g.n++; g.ids.push(s.id); g.keys.push(s.key ?? '') }
      else m.set(k, { s, n: 1, ids: [s.id], keys: [s.key ?? ''] })
    }
    // Real conversations first, then inferred ones; busiest first.
    return [...m.values()].sort((a, b) => Number(a.s.inferred) - Number(b.s.inferred) || Number(!!b.s.repo) - Number(!!a.s.repo) || a.s.start - b.s.start)
  }, [live])
  const from = range === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : range === 'week' ? now - 7 * 86400_000 : 0
  const history = useMemo(() => (sessions ?? []).filter((s) => (s.end ?? now) >= from), [sessions, from, now])

  const stats = useMemo(() => {
    // Wall-clock time with at least one AI session open (parallel sessions count once). Open apps are not work.
    // Only the part inside the chosen range counts: a session that started yesterday adds today's hours to "Today".
    const spans = history.filter((s) => s.via !== 'app').map((s) => [Math.max(s.start, from), s.end ?? now] as const).sort((a, b) => a[0] - b[0])
    let time = 0, curS = 0, curE = 0
    for (const [a, b] of spans) {
      if (a > curE) { time += curE - curS; curS = a; curE = b } else curE = Math.max(curE, b)
    }
    time += curE - curS
    const projects = new Set(history.map((s) => s.repo).filter(Boolean)).size
    const byAgent = new Map<string, number>()
    for (const s of history) byAgent.set(s.agent, (byAgent.get(s.agent) ?? 0) + 1)
    const top = [...byAgent.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return { time, projects, top }
  }, [history, from, now])

  // Agents that will step on each other: two on one branch of one folder, or one straight on the main branch.
  const warnings = useMemo(() => {
    const out: { key: string; kind: 'shared' | 'main'; repo: string; branch: string; agents: string[] }[] = []
    const byPlace = new Map<string, AgentSession[]>()
    for (const s of live) {
      // Paused sessions are not touching files: only the ones working (or waiting on you) can collide.
      if (s.inferred || !s.repo || !s.branch || s.state === 'idle') continue
      // git checks a branch out in one folder only: same repo and branch means same files.
      const k = `${s.repo}#${s.branch}`
      byPlace.set(k, [...(byPlace.get(k) ?? []), s])
    }
    for (const [k, list] of byPlace) {
      const { repo, branch } = list[0] as { repo: string; branch: string }
      if (list.length > 1) out.push({ key: k, kind: 'shared', repo, branch, agents: list.map((s) => s.agent) })
      else if (/^(main|master|trunk|develop)$/.test(branch)) out.push({ key: k, kind: 'main', repo, branch, agents: [list[0].agent] })
    }
    return out
  }, [live])
  const newWorktreeFor = useStore((s) => s.newWorktreeFor)
  const giveBranch = (repo: string, agent: string) => {
    const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
    void newWorktreeFor(repo, { branch: `${agent}/${stamp}`, agent })
  }

  // Repositories AI worked in that are not on GitHub yet.
  const unpublished = useMemo(() => {
    const seen = new Map<string, AgentSession>()
    for (const s of sessions ?? []) if (s.repo && !s.github && !seen.has(s.repo)) seen.set(s.repo, s)
    return [...seen.keys()]
  }, [sessions])

  const exportAs = async (format: 'csv' | 'json') => {
    try {
      const { message } = await bridge.exportSessions(format)
      if (message) toast('ok', t('exported', { path: message }))
    } catch (e) { toast('error', (e as Error).message) }
  }

  // A card per live session: repositories before the rest, busy before paused, then oldest first.
  const liveCards = useMemo(() => {
    const busy = (x: AgentSession) => Number(x.state === 'working' || x.state === 'waiting')
    const outside = (x: AgentSession) => Number(x.via === 'app') * 2 + Number(!x.repo)
    return [...groups].sort((a, b) => Number(a.s.inferred) - Number(b.s.inferred) || outside(a.s) - outside(b.s) || busy(b.s) - busy(a.s) || a.s.start - b.s.start)
  }, [groups])
  // Finished sessions of a minute or more (shorter ones still count in the figures), by the day they started.
  const done = useMemo(() => history.filter((s) => s.end !== null && s.end - s.start >= 60_000), [history])
  const shown = useMemo(() => done.slice(0, 400), [done])
  const days = useMemo(() => {
    const out: { day: number; list: AgentSession[]; ms: number }[] = []
    for (const s of shown) {
      const day = new Date(s.start).setHours(0, 0, 0, 0)
      const last = out[out.length - 1]
      if (last?.day === day) last.list.push(s)
      else out.push({ day, list: [s], ms: 0 })
    }
    for (const d of out) d.ms = unionMs(d.list.filter((s) => s.via !== 'app').map((s) => [s.start, s.end ?? now] as [number, number]))
    return out
  }, [shown, now])
  const today = new Date(now).setHours(0, 0, 0, 0)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const dayFmt = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' })
  const clockFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
  const dayTitle = (day: number) => {
    const ago = Math.round((today - day) / 86_400_000)
    const text = ago <= 1 ? rtf.format(-ago, 'day') : dayFmt.format(day)
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  // Branch health of the repositories with an open session, for the commits and changes on each card.
  const liveRepos = [...new Set(live.map((s) => s.repo).filter((r): r is string => !!r && known(r)))].sort().join('\n')
  const [health, setHealth] = useState<Map<string, BranchHealth>>(new Map())
  useEffect(() => {
    if (!liveRepos) return
    let alive = true
    const load = async () => {
      const out = new Map<string, BranchHealth>()
      for (const repo of liveRepos.split('\n')) {
        try { for (const b of (await bridge.health(repo)).branches) out.set(`${repo}#${b.branch}`, b) } catch { /* unreadable: no facts */ }
      }
      if (alive) setHealth(out)
    }
    void load()
    const id = setInterval(() => { if (!document.hidden) void load() }, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [liveRepos])

  // Not on GitHub: the first few, the rest behind "show more" so the card does not outgrow the others.
  const UNPUB = 3
  const [allUnpub, setAllUnpub] = useState(false)
  const shownUnpub = allUnpub ? unpublished : unpublished.slice(0, UNPUB)
  // A session (or its subagent, teammate, worktree) opens its repository on the branch it works on, once the
  // repository's state has loaded.
  const select = useStore((s) => s.select)
  const openAt = (repo: string | null, branch: string | null) => {
    if (!repo || !known(repo)) return
    setRepo(repo)
    if (!branch) return
    // Once: selecting changes the store, which would call the subscription again.
    let stop: (() => void) | null = null
    const pick = () => {
      const st = useStore.getState()
      if (st.repo !== repo || st.state) { stop?.(); stop = null }
      if (st.repo !== repo || !st.state) return st.repo !== repo
      const w = st.state.worktrees.find((x) => x.branch === branch)
      if (w) select(w.path)
      return true
    }
    if (!pick()) stop = useStore.subscribe(pick)
  }
  // Rows of a known repository open it on click or Enter/Space; the others are not buttons.
  const opener = (repo: string | null, branch: string | null) => (known(repo) ? {
    role: 'button', tabIndex: 0, onClick: () => openAt(repo, branch),
    onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(repo, branch) } },
  } : {})

  return (
    <main className="sessions">
      <header className="sessions-head">
        <div>
          <h1>{t('sessions')}</h1>
          <p className="muted small">{t('sessionsHint')}</p>
        </div>
        <div className="sessions-actions">
          <div className="seg" role="tablist" aria-label={t('sessionsHistory')}>
            {(['today', 'week', 'all'] as Range[]).map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-on' : ''} onClick={() => setRange(r)}>
                {t(r === 'today' ? 'sessionsToday' : r === 'week' ? 'sessionsWeek' : 'sessionsAll')}
              </button>
            ))}
          </div>
          <MoreMenu onExport={exportAs} onClear={() => setClearing(true)} />
        </div>
      </header>

      {sessions === null && (
        <p className="sess-summary" aria-hidden="true"><span><Bar w={70} /></span><span><Bar w={100} /></span><span><Bar w={90} /></span><span><Bar w={70} /></span></p>
      )}
      {sessions !== null && <p className="sess-summary">
        <span className={active ? 'is-live' : ''}>{active > 0 && <i className="pulse" />}<b>{active}</b> {t('sumNow')}</span>
        <span><b>{history.length}</b> {t('sumSessions')}</span>
        <span><b>{duration(stats.time)}</b> {t('sumTime')}</span>
        <span><b>{stats.projects}</b> {t('sumRepos')}</span>
        {stats.top !== '—' && <span>{t('sumTop')} <AgentBadge agent={stats.top} size={16} /> <b>{agentName(stats.top)}</b></span>}
      </p>}

      {sessions === null ? (
        <SessionsSkeleton />
      ) : (
        <>
          {warnings.length > 0 && (
            <section className="attention" role="alert">
              <h2 className="pane-kicker"><GitBranch size={13} />{t('attention')}</h2>
              <ul>
                {warnings.map((w) => {
                  const agent = w.agents[w.agents.length - 1]
                  return (
                    <li key={w.key} className={`is-${w.kind}`}>
                      <span className="att-dot" />
                      <span className="att-text">
                        <b>{base(w.repo)} · {w.branch}</b>
                        <span className="muted">{w.kind === 'shared' ? t('warnShared', { agents: countAgents(w.agents) }) : t('warnMain', { agent })}</span>
                      </span>
                      <button type="button" className="link att-action" onClick={() => (w.kind === 'main' ? setMoving({ repo: w.repo, agent }) : giveBranch(w.repo, agent))}>{t('ownBranch', { agent })} →</button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <section className="sessions-section">
            {live.length === 0 && <p className="muted small">{sessions.length ? t('sessionsNoneLive') : t('sessionsNone')}</p>}
            {groups.length > 0 && (
              // A card per session, rows filled edge to edge: the width carries them, not a long list.
              <FillGrid n={liveCards.length} min={320} max={3}>
                {liveCards.map(({ s, n, ids, keys }) => {
                  const kids = keys.flatMap((k) => children[k] ?? [])
                  const b = s.repo && s.branch ? health.get(`${s.repo}#${s.branch}`) : undefined
                  return (
                    <article key={s.id} className={`sess-card${s.inferred ? ' is-inferred' : ''}${known(s.repo) ? ' is-open' : ''}${s.state ? ` is-${s.state}` : ''}`}
                      title={s.cwd ?? undefined} {...opener(s.repo, s.branch)}>
                      <div className="sess-card-top">
                        <AgentBadge agent={s.agent} size={24} live={s.state === 'working'} />
                        <b>{agentName(s.agent)}</b>
                        {n > 1 && <span className="live-count">×{n}</span>}
                        {s.state && <span className={`state-chip is-${s.state}`}>{t(s.state === 'working' ? 'stateWorking' : s.state === 'waiting' ? 'stateWaiting' : 'stateIdle')}</span>}
                        {s.inferred && <span className="tag" title={t('inferredHint')}>{t('inferred')}</span>}
                        {!!s.attention?.length && (
                          <span className="sess-attn" role="img" aria-label={s.attention.map((r) => t(ATTN[r])).join(', ')} title={s.attention.map((r) => t(ATTN[r])).join(' · ')}><CircleAlert size={15} /></span>
                        )}
                        <span className="sess-card-time mono">{duration(now - s.start)}</span>
                        <button type="button" className="icon-btn row-close" title={t('closeSession')} aria-label={t('closeSession')}
                          disabled={closing === s.id} onClick={(e) => { e.stopPropagation(); void closeSession(s.id, ids) }} onKeyDown={(e) => e.stopPropagation()}><X size={13} /></button>
                      </div>
                      <Place s={s} />
                      {s.task && <p className="sess-card-task" title={s.task}>{s.task}</p>}
                      {s.glance && (s.glance.action || s.glance.pulse.some(Boolean)) && (
                        <div className="sess-card-now">
                          {s.glance.action && (
                            <span className="sess-card-action" title={s.glance.action.target ?? undefined}>
                              <ActionIcon tool={s.glance.action.tool} />
                              <span>{actionText(t, s.glance.action)}</span>
                              {s.glance.action.at > 0 && <span className="muted">· {relTime(lang, Math.floor(s.glance.action.at / 1000), Math.floor(now / 1000))}</span>}
                            </span>
                          )}
                          <span className="sess-card-pulse"><small>{t('pulseLabel')}</small><Pulse values={s.glance.pulse} label={t('pulseLabel')} /></span>
                        </div>
                      )}
                      <div className="sess-card-foot">
                      <div className="sess-card-meta">
                        <span><ViaIcon via={s.via} host={s.host} />{s.host}</span>
                        <span>{t('ccStarted', { when: relTime(lang, Math.floor(s.start / 1000), Math.floor(now / 1000)) })}</span>
                        <Links s={s} />
                      </div>
                      {((b && (b.ahead > 0 || b.uncommitted > 0 || b.added + b.deleted > 0 || b.main)) || !!s.glance?.files) && (
                        <div className="cc-facts">
                          {!!s.glance?.files && <span className="chip">{t(s.glance.files === 1 ? 'filesEditedOne' : 'filesEdited', { n: s.glance.files })}</span>}
                          {b && b.ahead > 0 && <span className="chip">{b.ahead === 1 ? t('ccAheadOne') : t('ccAhead', { n: b.ahead })}</span>}
                          {b && b.uncommitted > 0 && <span className="chip chip-warn">{t('ccUncommitted', { n: b.uncommitted })}</span>}
                          {b && b.added + b.deleted > 0 && <span className="chip cc-size"><ins>+{b.added}</ins> <del>−{b.deleted}</del></span>}
                          {b?.main && s.state !== 'idle' && <span className="chip chip-warn">{t('ccOnMain')}</span>}
                        </div>
                      )}
                      {kids.length > 0 && (
                        <ul className="sess-card-kids">
                          {kids.map((ch) => (
                            <li key={`${ch.kind}:${ch.id}`} className={known(ch.repo) ? 'is-open' : ''} title={ch.description ?? ch.cwd ?? undefined}
                              {...opener(ch.repo, ch.branch)} onClick={(e) => { e.stopPropagation(); openAt(ch.repo, ch.branch) }}>
                              <ChildIcon kind={ch.kind} />
                              <b>{ch.label}</b>
                              <span className="tag">{t(ch.kind === 'subagent' ? 'childSubagent' : ch.kind === 'teammate' ? 'childTeammate' : ch.kind === 'worktree' ? 'childWorktree' : ch.spawned ? 'childCodexSub' : 'childCodex')}</span>
                              {ch.working && <span className="state-chip is-working">{t(ch.kind === 'codex' ? 'childRecent' : 'stateWorking')}</span>}
                              {ch.branch && ch.branch !== ch.label && <span className="mono muted">⎇ {ch.branch}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      </div>
                    </article>
                  )
                })}
              </FillGrid>
            )}
            {unpublished.length > 0 && (
                <article key="~unpublished" className="repo-card unpub-card">
                  <header><Upload size={15} /><b>{t('notOnGithub')}</b></header>
                  <ul>
                    {shownUnpub.map((r) => (
                      <li key={r}>
                        <FolderGit2 size={14} /><b>{base(r)}</b><span className="muted mono small" title={r}>{tilde(r)}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPublishing(r)}><Upload size={13} />{t('publish')}</button>
                      </li>
                    ))}
                  </ul>
                  {unpublished.length > UNPUB && (
                    <button type="button" className="link unpub-more" onClick={() => setAllUnpub(!allUnpub)}>
                      {allUnpub ? t('showLess') : t('showMore', { n: unpublished.length - UNPUB })}
                    </button>
                  )}
                </article>
            )}
          </section>

          {/* The days and, beside their figures, the repositories: one block whose chart takes the height, no gaps. */}
          <ActivityStrip sessions={sessions} days={range === 'all' ? 30 : 7} now={now}>
            <RepoWeek sessions={sessions} now={now} onOpen={(r) => openAt(r, null)} />
          </ActivityStrip>

          <section className="sessions-section">
            <h2 className="pane-kicker">{t('sessionsHistory')}</h2>
            {/* Finished sessions only (the open ones are the cards above), smaller cards, as many across as fit. */}
            {done.length === 0 ? <p className="muted small">{t(sessions.length ? 'historyNoneDone' : 'sessionsNone')}</p> : days.map((d) => (
              <div key={d.day} className="sess-day">
                <h3 className="sess-day-head"><b>{dayTitle(d.day)}</b><span className="muted">{d.list.length} · {duration(d.ms)}</span></h3>
                <FillGrid n={d.list.length} min={250} max={4} className="is-compact">
                  {d.list.map((s) => (
                    <article key={s.id} className={`sess-card${known(s.repo) ? ' is-open' : ''}`} title={s.cwd ?? undefined} {...opener(s.repo, s.branch)}>
                      <div className="sess-card-top">
                        <AgentBadge agent={s.agent} size={18} />
                        <b>{agentName(s.agent)}</b>
                        {s.inferred && <span className="tag" title={t('inferredHint')}>{t('inferred')}</span>}
                        <span className="sess-card-time mono">{duration((s.end ?? now) - s.start)}</span>
                      </div>
                      <Place s={s} />
                      {s.task && <p className="sess-card-task is-one" title={s.task}>{s.task}</p>}
                      <div className="sess-card-meta sess-card-foot">
                        <span className="mono">{clockFmt.format(s.start)}</span>
                        <span><ViaIcon via={s.via} host={s.host} />{s.host}</span>
                        <Links s={s} />
                      </div>
                    </article>
                  ))}
                </FillGrid>
              </div>
            ))}
            {done.length > 400 && <p className="muted small">{t('historyCapped', { n: 400, total: done.length })}</p>}
          </section>
        </>
      )}
      {publishing && <PublishDialog repo={publishing} onClose={() => setPublishing(null)} />}
      {moving && (
        <Dialog title={t('ownBranch', { agent: moving.agent })} confirmLabel={t('ownBranch', { agent: moving.agent })}
          onCancel={() => setMoving(null)}
          onConfirm={async () => {
            const m = moving
            setMoving(null)
            try { const { message } = await bridge.moveToBranch(m.repo, m.agent); toast('ok', message); await refreshSessions() } catch (e) { toast('error', (e as Error).message) }
          }}>
          <p>{t('confirm_move', { agent: moving.agent, branch: '', base: '' })}</p>
        </Dialog>
      )}
      {clearing && (
        <Dialog title={t('clearHistory')} confirmLabel={t('clearHistory')} danger onCancel={() => setClearing(false)}
          onConfirm={async () => {
            setClearing(false)
            try { await bridge.clearSessions(); await refreshSessions() } catch (e) { toast('error', (e as Error).message) }
          }}>
          <p>{t('clearHistoryText')}</p>
        </Dialog>
      )}
    </main>
  )
}

/** The last step of a session in words: "Editing Sessions.tsx", "Running npm test". */
function actionText(t: ReturnType<typeof useStore.getState>['t'], a: { tool: string; target: string | null }): string {
  const target = a.target ?? ''
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(a.tool)) return t('actEdit', { target })
  if (a.tool === 'Read') return t('actRead', { target })
  if (a.tool === 'Bash') return t('actRun', { target })
  if (a.tool === 'Grep' || a.tool === 'Glob') return t('actSearch', { target })
  if (a.tool === 'Task' || a.tool === 'Agent') return t('actAgent')
  if (a.tool === 'WebFetch' || a.tool === 'WebSearch') return t('actWeb')
  if (a.tool === 'TodoWrite') return t('actTodo')
  return t('actOther', { tool: a.tool.replace(/^mcp__[^_]+__/, '') })
}

function ActionIcon({ tool }: { tool: string }) {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return <Pencil size={13} />
  if (tool === 'Bash') return <SquareTerminal size={13} />
  if (tool === 'Read') return <FileText size={13} />
  if (tool === 'Grep' || tool === 'Glob' || tool === 'WebSearch' || tool === 'WebFetch') return <Search size={13} />
  if (tool === 'Task' || tool === 'Agent') return <Bot size={13} />
  return <Wrench size={13} />
}

/** The last hour in five-minute slots: how much the agent replied in each, the newest on the right. */
function Pulse({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values)
  return (
    <span className="pulse-bars" role="img" aria-label={label} title={label}>
      {values.map((v, i) => <i key={i} className={v ? '' : 'is-zero'} style={{ height: v ? `${Math.max(18, (v / max) * 100)}%` : undefined }} />)}
    </span>
  )
}

/** Where a session works: the repository and its branch, or the folder outside one, or the AI app. */
function Place({ s }: { s: AgentSession }) {
  const t = useStore((st) => st.t)
  return (
    <div className="sess-card-place">
      {s.via === 'app' ? <AppWindow size={14} /> : <FolderGit2 size={14} />}
      {s.repo ? <b>{base(s.repo)}</b> : s.via === 'app' ? <span className="muted">{t('aiApps')}</span> : s.cwd && tilde(s.cwd) !== '~' ? <><b>{base(s.cwd)}</b><span className="muted">{t('outsideRepo')}</span></> : <span className="muted">{t('outsideRepo')}</span>}
      {s.repo && s.branch && <span className="mono muted">⎇ {s.branch}</span>}
    </div>
  )
}

/** GitHub and the pull request, when there are; links that do not open the card. */
function Links({ s }: { s: AgentSession }) {
  return (
    <>
      {s.github && <a className="icon-link" href={`https://github.com/${s.github}`} target="_blank" rel="noreferrer" title={s.github} onClick={(e) => e.stopPropagation()}><GithubIcon size={13} /></a>}
      {s.pr && <a className="tag" href={s.pr.url} target="_blank" rel="noreferrer" title={s.pr.title} onClick={(e) => e.stopPropagation()}><GitPullRequest size={11} />#{s.pr.number}</a>}
    </>
  )
}

/** Export and clear, out of the way: they are rare actions. */
function MoreMenu({ onExport, onClear }: { onExport: (f: 'csv' | 'json') => void; onClear: () => void }) {
  const t = useStore((s) => s.t)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('moreActions')} title={t('moreActions')} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="popover menu-pop" role="menu">
          <button type="button" role="menuitem" onClick={pick(() => onExport('csv'))}><Download size={14} />{t('exportCsv')}</button>
          <button type="button" role="menuitem" onClick={pick(() => onExport('json'))}><Download size={14} />{t('exportJson')}</button>
          <hr />
          <button type="button" role="menuitem" className="is-danger" onClick={pick(onClear)}><Trash2 size={14} />{t('clearHistory')}…</button>
        </div>
      )}
    </div>
  )
}

function PublishDialog({ repo, onClose }: { repo: string; onClose: () => void }) {
  const t = useStore((s) => s.t)
  const toast = useStore((s) => s.toast)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const refreshRepos = useStore((s) => s.refreshRepos)
  const [name, setName] = useState(base(repo).replace(/[^\w.-]/g, '-'))
  const [isPrivate, setPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { message } = await bridge.publishRepo(repo, name, isPrivate)
      toast('ok', message)
      await Promise.all([refreshSessions(), refreshRepos()])
      onClose()
    } catch (e) {
      const msg = (e as Error).message
      toast('error', msg === 'gh-missing' ? t('githubMissing') : msg)
      setBusy(false)
    }
  }
  return (
    <Dialog title={t('publishTitle', { name: base(repo) })} confirmLabel={busy ? t('publishing') : t('publish')} onCancel={onClose} onConfirm={submit}>
      <p className="muted small">{t('publishText')}</p>
      <p className="mono small">{repo}</p>
      <div className="form">
        <label>
          <span>{t('publishName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </label>
        <div className="seg" role="radiogroup">
          <button type="button" role="radio" aria-checked={isPrivate} className={isPrivate ? 'is-on' : ''} onClick={() => setPrivate(true)}>{t('publishPrivate')}</button>
          <button type="button" role="radio" aria-checked={!isPrivate} className={!isPrivate ? 'is-on' : ''} onClick={() => setPrivate(false)}>{t('publishPublic')}</button>
        </div>
      </div>
    </Dialog>
  )
}
