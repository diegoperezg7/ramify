import { AppWindow, Code2, Download, ExternalLink, FolderGit2, GitBranch, GitPullRequest, Loader2, SquareTerminal, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import type { AgentSession } from '../types'
import { agentVar } from '../agents'
import { AgentBadge } from './AgentBadge'
import { Dialog } from './Dialog'
import { BrandIcon, hasBrand } from './BrandIcon'
import { GithubIcon } from './GithubIcon'

type Range = 'today' | 'week' | 'all'

const base = (p: string | null) => (p ? p.split('/').filter(Boolean).pop() ?? p : '')
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
  const now = Date.now()

  const live = useMemo(() => (sessions ?? []).filter((s) => s.end === null), [sessions])
  // Identical sessions (same agent, same place, same folder) read as one card with a count.
  const groups = useMemo(() => {
    const m = new Map<string, { s: AgentSession; n: number }>()
    for (const s of [...live].sort((a, b) => a.start - b.start)) {
      const k = [s.agent, s.host, s.via, s.cwd, s.branch].join('\u0000')
      const g = m.get(k)
      if (g) g.n++
      else m.set(k, { s, n: 1 })
    }
    // Real conversations first, then inferred ones; busiest first.
    return [...m.values()].sort((a, b) => Number(a.s.inferred) - Number(b.s.inferred) || Number(!!b.s.repo) - Number(!!a.s.repo) || a.s.start - b.s.start)
  }, [live])
  const history = useMemo(() => {
    const from = range === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : range === 'week' ? now - 7 * 86400_000 : 0
    return (sessions ?? []).filter((s) => (s.end ?? now) >= from)
  }, [sessions, range, now])

  const stats = useMemo(() => {
    // Wall-clock time with at least one AI session open (parallel sessions count once). Open apps are not work.
    const spans = history.filter((s) => s.via !== 'app').map((s) => [s.start, s.end ?? now] as const).sort((a, b) => a[0] - b[0])
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
  }, [history, now])

  // Agents that will step on each other: two on one branch of one folder, or one straight on the main branch.
  const warnings = useMemo(() => {
    const out: { key: string; kind: 'shared' | 'main'; repo: string; branch: string; agents: string[] }[] = []
    const byPlace = new Map<string, AgentSession[]>()
    for (const s of live) {
      if (s.inferred || !s.repo || !s.branch) continue
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

  return (
    <main className="sessions">
      <header className="sessions-head">
        <div>
          <h1>{t('sessions')}</h1>
          <p className="muted small">{t('sessionsHint')}</p>
        </div>
        <div className="sessions-actions">
          <button type="button" className="btn btn-ghost" onClick={() => exportAs('csv')}><Download size={14} />{t('exportCsv')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => exportAs('json')}><Download size={14} />{t('exportJson')}</button>
        </div>
      </header>

      <div className="seg" role="tablist" aria-label={t('sessionsHistory')}>
        {(['today', 'week', 'all'] as Range[]).map((r) => (
          <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-on' : ''} onClick={() => setRange(r)}>
            {t(r === 'today' ? 'sessionsToday' : r === 'week' ? 'sessionsWeek' : 'sessionsAll')}
          </button>
        ))}
      </div>

      <div className="tiles">
        <div className="tile"><span>{t('sessionsLive')}</span><b className={live.length ? 'is-live' : ''}>{live.length}</b></div>
        <div className="tile"><span>{t('sessionsCount')}</span><b>{history.length}</b></div>
        <div className="tile"><span>{t('sessionsTime')}</span><b>{duration(stats.time)}</b></div>
        <div className="tile"><span>{t('sessionsRepos')}</span><b>{stats.projects}</b></div>
        <div className="tile"><span>{t('sessionsTopAgent')}</span><b>{stats.top}</b></div>
      </div>

      {sessions === null ? (
        <p className="muted small"><Loader2 size={14} className="spin" /> …</p>
      ) : (
        <>
          {warnings.map((w) => (
            <div key={w.key} className={`warn-card is-${w.kind}`} role="alert">
              <GitBranch size={18} />
              <div>
                <b>{w.kind === 'shared' ? t('shared', { n: w.agents.length }) : t('onMain', { branch: w.branch })}</b>
                <p>{w.kind === 'shared'
                  ? t('sharedText', { agents: w.agents.join(', '), repo: base(w.repo), branch: w.branch })
                  : t('onMainText', { agent: w.agents[0], repo: base(w.repo) })}</p>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => giveBranch(w.repo, w.agents[w.agents.length - 1])}>
                <GitBranch size={14} />{t('ownBranch', { agent: w.agents[w.agents.length - 1] })}
              </button>
            </div>
          ))}

          <section className="sessions-section">
            <h2 className="pane-kicker"><span className="pulse" />{t('sessionsLive')}</h2>
            {live.length === 0 && <p className="muted small">{sessions.length ? t('sessionsNoneLive') : t('sessionsNone')}</p>}
            <div className="live-grid">
              {groups.map(({ s, n }) => (
                <article key={s.id} className={`live-card${s.inferred ? ' is-inferred' : ''}`} style={{ ['--c' as string]: agentVar(s.agent) }}>
                  <div className="live-top">
                    <AgentBadge agent={s.agent} size={26} live={!s.inferred} />
                    <span className="live-agent">{s.agent}</span>
                    {n > 1 && <span className="live-count" title={t('sessionsCount')}>×{n}</span>}
                    <span className="live-time" title={t('colDuration')}>{duration(now - s.start)}</span>
                  </div>
                  <p className="live-where"><ViaIcon via={s.via} host={s.host} />{s.host}
                    {s.inferred && <span className="tag" title={t('inferredHint')}>{t('inferred')}</span>}
                  </p>
                  <p className="live-project" title={s.cwd ?? undefined}>
                    {s.repo ? <><FolderGit2 size={13} /><b>{base(s.repo)}</b>{s.branch && <span className="mono">⎇ {s.branch}</span>}</>
                      : s.cwd ? <span className="muted">{tilde(s.cwd)} · {t('noRepoFolder')}</span> : null}
                  </p>
                  <Links s={s} known={known(s.repo)} onOpen={() => s.repo && setRepo(s.repo)} onPublish={() => setPublishing(s.repo)} t={t} />
                </article>
              ))}
            </div>
          </section>

          {unpublished.length > 0 && (
            <section className="sessions-section">
              <h2 className="pane-kicker">{t('notOnGithub')}</h2>
              <ul className="unpub">
                {unpublished.map((r) => (
                  <li key={r}>
                    <FolderGit2 size={14} /><b>{base(r)}</b><span className="muted mono small" title={r}>{tilde(r)}</span>
                    <button type="button" className="btn btn-ghost" onClick={() => setPublishing(r)}><Upload size={14} />{t('publish')}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
              {history.length === 0 && <p className="muted small hist-empty">{t('sessionsNone')}</p>}
            </div>
          </section>
        </>
      )}
      {publishing && <PublishDialog repo={publishing} onClose={() => setPublishing(null)} />}
    </main>
  )
}

function Links({ s, known, onOpen, onPublish, t }: { s: AgentSession; known: boolean; onOpen: () => void; onPublish: () => void; t: ReturnType<typeof useStore.getState>['t'] }) {
  if (!s.repo) return null
  return (
    <div className="live-links">
      {known && <button type="button" className="btn btn-ghost" onClick={onOpen}><FolderGit2 size={14} />{t('openRepo')}</button>}
      {s.github
        ? <a className="btn btn-ghost" href={`https://github.com/${s.github}${s.branch ? `/tree/${s.branch}` : ''}`} target="_blank" rel="noreferrer"><GithubIcon size={14} />{s.github}<ExternalLink size={12} /></a>
        : <button type="button" className="btn btn-ghost" onClick={onPublish}><Upload size={14} />{t('publish')}</button>}
      {s.pr && <a className="btn btn-ghost" href={s.pr.url} target="_blank" rel="noreferrer"><GitPullRequest size={14} />{t('pr')} #{s.pr.number} · {s.pr.state.toLowerCase()}</a>}
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
