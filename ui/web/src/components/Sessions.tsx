import { AppWindow, Code2, Download, FolderGit2, GitBranch, GitPullRequest, MoreHorizontal, SquareTerminal, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bridge } from '../bridge'
import { isActive } from '../logic'
import { useStore } from '../store'
import type { AgentSession } from '../types'
import { AgentBadge } from './AgentBadge'
import { Dialog } from './Dialog'
import { BrandIcon, hasBrand } from './BrandIcon'
import { GithubIcon } from './GithubIcon'
import { Bar, SessionsSkeleton } from './Skeletons'

type Range = 'today' | 'week' | 'all'

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
  const [closing, setClosing] = useState<string | null>(null)
  const closeSession = async (key: string, ids: string[]) => {
    setClosing(key)
    try { for (const id of ids) await bridge.closeSession(id); await refreshSessions() } catch (e) { toast('error', (e as Error).message) } finally { setClosing(null) }
  }
  const now = Date.now()

  const live = useMemo(() => (sessions ?? []).filter((s) => s.end === null), [sessions])
  // Running now: open and not idle at its prompt.
  const active = useMemo(() => live.filter(isActive).length, [live])
  // Identical sessions (same agent, same place, same folder) read as one card with a count.
  const groups = useMemo(() => {
    const m = new Map<string, { s: AgentSession; n: number; ids: string[] }>()
    for (const s of [...live].sort((a, b) => a.start - b.start)) {
      const k = [s.agent, s.host, s.via, s.cwd, s.branch, s.state].join('\u0000')
      const g = m.get(k)
      if (g) { g.n++; g.ids.push(s.id) }
      else m.set(k, { s, n: 1, ids: [s.id] })
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

  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const exportAs = async (format: 'csv' | 'json') => {
    try {
      const { message } = await bridge.exportSessions(format)
      if (message) toast('ok', t('exported', { path: message }))
    } catch (e) { toast('error', (e as Error).message) }
  }
  const known = (repo: string | null) => !!repo && repos.some((r) => r.path === repo)

  // Live sessions by repository: one card per place, one row per agent (identical sessions folded with ×n).
  const liveByRepo = useMemo(() => {
    const cards = new Map<string, { key: string; repo: string | null; github: string | null; title: string; rows: { s: AgentSession; n: number; ids: string[] }[] }>()
    for (const { s, n, ids } of groups) {
      const key = s.via === 'app' ? '~apps' : s.repo ?? '~outside'
      const card = cards.get(key) ?? { key, repo: s.repo, github: s.github, title: s.via === 'app' ? t('aiApps') : s.repo ? base(s.repo) : t('outsideRepo'), rows: [] }
      card.rows.push({ s, n, ids })
      cards.set(key, card)
    }
    const busy = (c: { rows: { s: AgentSession }[] }) => c.rows.some((r) => r.s.state === 'working' || r.s.state === 'waiting')
    return [...cards.values()].sort((a, b) => Number(a.key.startsWith('~')) - Number(b.key.startsWith('~')) || Number(busy(b)) - Number(busy(a)) || a.title.localeCompare(b.title))
  }, [groups, t])

  // Cards fill columns of equal height (the shortest column takes the next card), so no column ends
  // in a hole. The repositories not on GitHub yet are one more card.
  const [cols, setCols] = useState(2)
  const observer = useRef<ResizeObserver | null>(null)
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width + 12) / 372))))
    observer.current.observe(el)
  }, [])
  // Not on GitHub: the first few, the rest behind "show more" so the card does not outgrow the others.
  const UNPUB = 3
  const [allUnpub, setAllUnpub] = useState(false)
  const shownUnpub = allUnpub ? unpublished : unpublished.slice(0, UNPUB)
  type Card = (typeof liveByRepo)[number] | 'unpublished'
  const columns = useMemo(() => {
    const cards: Card[] = [...liveByRepo, ...(unpublished.length ? ['unpublished' as const] : [])]
    const out = Array.from({ length: Math.max(1, Math.min(cols, cards.length)) }, () => ({ h: 0, cards: [] as Card[] }))
    for (const c of cards) {
      const col = out.reduce((a, b) => (b.h < a.h ? b : a))
      col.cards.push(c)
      col.h += 1.2 + (c === 'unpublished' ? shownUnpub.length * 0.9 + (unpublished.length > UNPUB ? 0.5 : 0) : c.rows.length)
    }
    return out.map((c) => c.cards)
  }, [liveByRepo, unpublished, shownUnpub, cols])

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
        {stats.top !== '—' && <span>{t('sumTop')} <AgentBadge agent={stats.top} size={16} /> <b>{stats.top}</b></span>}
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
            <div className="repo-cards" ref={gridRef}>
              {columns.map((col, i) => (
              <div key={i} className="repo-col">
              {col.map((c) => c === 'unpublished' ? (
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
              ) : (
                <article key={c.key} className="repo-card">
                  <header>
                    {c.key === '~apps' ? <AppWindow size={15} /> : <FolderGit2 size={15} />}
                    <b title={c.repo ?? undefined}>{c.title}</b>
                    <span className="repo-card-actions">
                      {c.github && <a className="icon-link" href={`https://github.com/${c.github}`} target="_blank" rel="noreferrer" title={c.github}><GithubIcon size={14} /></a>}
                      {known(c.repo) && <button type="button" className="link" onClick={() => c.repo && setRepo(c.repo)}>{t('openRepo')}</button>}
                    </span>
                  </header>
                  <ul>
                    {c.rows.map(({ s, n, ids }) => (
                      <li key={s.id} className={s.inferred ? 'is-inferred' : ''} title={s.cwd ?? undefined}>
                        <AgentBadge agent={s.agent} size={22} live={s.state === 'working'} />
                        <span className="row-main">
                          <span className="row-top">
                            <b>{s.agent}</b>
                            {n > 1 && <span className="live-count">×{n}</span>}
                            {s.state && <span className={`state-chip is-${s.state}`}>{t(s.state === 'working' ? 'stateWorking' : s.state === 'waiting' ? 'stateWaiting' : 'stateIdle')}</span>}
                            {s.inferred && <span className="tag" title={t('inferredHint')}>{t('inferred')}</span>}
                          </span>
                          <span className="row-sub muted">
                            <ViaIcon via={s.via} host={s.host} />{s.host}
                            {s.branch && <span className="mono">⎇ {s.branch}</span>}
                            {!s.repo && s.cwd && <span className="mono">{tilde(s.cwd)}</span>}
                            {s.pr && <a className="tag" href={s.pr.url} target="_blank" rel="noreferrer" title={s.pr.title}><GitPullRequest size={11} />#{s.pr.number}</a>}
                          </span>
                        </span>
                        <span className="row-time mono">{duration(now - s.start)}</span>
                        <button type="button" className="icon-btn row-close" title={t('closeSession')} aria-label={t('closeSession')}
                          disabled={closing === s.id} onClick={() => void closeSession(s.id, ids)}><X size={13} /></button>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
              </div>
              ))}
            </div>
          </section>

          <section className="sessions-section">
            <h2 className="pane-kicker">{t('sessionsHistory')}</h2>
            <div className="hist" role="table">
              <div className="hist-row hist-head" role="row">
                <span role="columnheader">{t('colAgent')}</span><span role="columnheader">{t('colWhere')}</span>
                <span role="columnheader">{t('colProject')}</span><span role="columnheader">{t('colStart')}</span>
                <span role="columnheader">{t('colDuration')}</span><span role="columnheader">GitHub</span>
              </div>
              {history.slice(0, 400).map((s) => (
                <div key={s.id} className={`hist-row${s.end === null ? ' is-live' : ''}`} role="row">
                  <span className="hist-agent"><AgentBadge agent={s.agent} size={18} live={s.end === null} />{s.agent}</span>
                  <span className="hist-where"><ViaIcon via={s.via} host={s.host} />{s.host}{s.inferred && <span className="tag" title={t('inferredHint')}>{t('inferred')}</span>}</span>
                  <span className="hist-project" title={s.cwd ?? undefined}>
                    {s.repo ? <>{known(s.repo) ? <button type="button" className="link" onClick={() => setRepo(s.repo!)}>{base(s.repo)}</button> : base(s.repo)}
                      {s.branch && <span className="mono muted"> ⎇ {s.branch}</span>}</> : <span className="muted">{s.cwd ? (tilde(s.cwd) === '~' ? '~' : base(s.cwd)) : '—'}</span>}
                  </span>
                  <span className="mono muted">{fmt.format(s.start)}</span>
                  <span className="mono">{duration((s.end ?? now) - s.start)}</span>
                  <span className="hist-gh">
                    {s.github ? <a href={`https://github.com/${s.github}`} target="_blank" rel="noreferrer" title={s.github}><GithubIcon size={13} /></a> : <span className="muted">—</span>}
                    {s.pr && <a className="tag" href={s.pr.url} target="_blank" rel="noreferrer" title={s.pr.title}><GitPullRequest size={11} />#{s.pr.number}</a>}
                  </span>
                </div>
              ))}
              {history.length > 400 && <p className="muted small hist-empty">{t('historyCapped', { n: 400, total: history.length })}</p>}
              {history.length === 0 && <p className="muted small hist-empty">{t('sessionsNone')}</p>}
            </div>
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
