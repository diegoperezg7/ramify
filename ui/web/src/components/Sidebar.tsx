import { ChevronDown, CircleAlert, FolderGit2, LayoutDashboard, Loader2, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GithubIcon } from './GithubIcon'
import { agentName, agentVar } from '../agents'
import { Logo, Wordmark } from './Logo'
import { useStore } from '../store'
import type { RepoInfo } from '../types'

// Narrow windows: the sidebar collapses to icons. Same class as the manual rail, so both look the same.
const AUTO_RAIL = '(max-width: 1100px) and (min-width: 761px)'

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export function Sidebar() {
  const repos = useStore((s) => s.repos)
  const addRepo = useStore((s) => s.addRepo)
  const busy = useStore((s) => s.busy)
  const setModal = useStore((s) => s.setModal)
  const caps = useStore((s) => s.caps)
  const userRail = useStore((s) => s.rail)
  const autoRail = useMediaQuery(AUTO_RAIL)
  const rail = userRail || autoRail
  const setRail = useStore((s) => s.setRail)
  const menuOpen = useStore((s) => s.menuOpen)
  const setMenuOpen = useStore((s) => s.setMenuOpen)
  const t = useStore((s) => s.t)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const liveCount = repos.reduce((n, r) => n + (r.active?.length ?? 0), 0)

  const current = useStore((s) => s.repo)
  const [query, setQuery] = useState('')
  const [showDormant, setShowDormant] = useState(() => { try { return localStorage.getItem('ramify-side-dormant') === '1' } catch { return false } })
  const toggleDormant = () => { const v = !showDormant; setShowDormant(v); try { localStorage.setItem('ramify-side-dormant', v ? '1' : '0') } catch { /* storage unavailable */ } }

  // Most recent activity first (a commit on any branch or an AI session); never active ones last, by name.
  const byActivity = (a: RepoInfo, b: RepoInfo) => (b.lastActive ?? 0) - (a.lastActive ?? 0) || a.name.localeCompare(b.name)
  const q = query.trim().toLowerCase()
  const shown = repos.filter((r) => !q || r.name.toLowerCase().includes(q))
  const active = shown.filter((r) => r.active?.length).sort(byActivity)
  const rest = shown.filter((r) => !r.active?.length).sort(byActivity)
  // Quiet for 30 days: folded at the end, unless searched for, open, or something there needs you.
  const monthAgo = Date.now() - 30 * 86_400_000
  const dormant = (r: RepoInfo) => !q && r.lastActive !== undefined && (r.lastActive ?? 0) < monthAgo && r.path !== current && !r.attention?.length
  const awake = rest.filter((r) => !dormant(r))
  const asleep = rest.filter(dormant)

  return (
    <>
      <div className={`sidebar-scrim${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar${rail ? ' is-rail' : ''}${autoRail ? ' is-auto-rail' : ''}${menuOpen ? ' is-open' : ''}`}>
        <div className="sidebar-drag">
          <button type="button" className="icon-btn ghost rail-toggle" onClick={() => setRail(!userRail)}
            aria-label={rail ? t('expand') : t('collapse')} title={rail ? t('expand') : t('collapse')}>
            {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button type="button" className="icon-btn ghost menu-close" onClick={() => setMenuOpen(false)} aria-label={t('close')}>
            <X size={16} />
          </button>
        </div>
        <div className="side-brand">
          <Logo size={44} />
          <Wordmark className="side-brand-name" />
        </div>
        <div className="sidebar-section">
          {caps?.control && (
            <button type="button" className={`side-btn side-view${view === 'control' ? ' is-active' : ''}`} onClick={() => setView('control')} title={t('controlTitle')}>
              <LayoutDashboard size={16} /><span>{t('controlTitle')}</span>
            </button>
          )}
          {caps?.sessions && (
            <button type="button" className={`side-btn side-view${view === 'sessions' ? ' is-active' : ''}`} onClick={() => setView('sessions')} title={t('sessions')}>
              <MessagesSquare size={16} /><span>{t('sessions')}</span>
              {liveCount > 0 && <span className="repo-count is-live">{liveCount}</span>}
            </button>
          )}
          {active.length > 0 && (
            <>
              <span className="sidebar-label"><span className="pulse" />{t('activeNow')}</span>
              <ul className="repo-list">{active.map((r) => <RepoItem key={r.path} r={r} />)}</ul>
            </>
          )}
          <span className="sidebar-label">{t('repositories')}</span>
          {repos.length > 8 && (
            <label className="side-filter">
              <Search size={13} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('filterRepos')} aria-label={t('filterRepos')} spellCheck={false} />
              {query && <button type="button" className="side-filter-clear" onClick={() => setQuery('')} aria-label={t('close')}><X size={12} /></button>}
            </label>
          )}
          <ul className="repo-list">{awake.map((r) => <RepoItem key={r.path} r={r} />)}</ul>
          {q && shown.length === 0 && <p className="side-empty">{t('noRepoMatch')}</p>}
          {asleep.length > 0 && (
            <>
              <button type="button" className={`side-dormant${showDormant ? ' is-open' : ''}`} onClick={toggleDormant} aria-expanded={showDormant}>
                <ChevronDown size={13} /><span>{showDormant ? t('dormantHide') : t('dormantShow', { n: asleep.length })}</span>
              </button>
              {showDormant && <ul className="repo-list is-dormant">{asleep.map((r) => <RepoItem key={r.path} r={r} />)}</ul>}
            </>
          )}
          <button type="button" className="side-btn" onClick={() => addRepo()} title={t('addRepo')} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}<span>{t('addRepo')}</span>
          </button>
          {caps?.github && (
            <button type="button" className="side-btn" onClick={() => setModal('github')} title={t('github')}><GithubIcon size={16} /><span>{t('github')}</span></button>
          )}
        </div>
        {caps?.settings && (
          <button type="button" className="side-btn sidebar-foot" onClick={() => setModal('settings')} title={t('settings')}>
            <Settings size={16} /><span>{t('settings')}</span>
          </button>
        )}
      </aside>
    </>
  )
}

function RepoItem({ r }: { r: RepoInfo }) {
  const repo = useStore((s) => s.repo)
  const setRepo = useStore((s) => s.setRepo)
  const removeRepo = useStore((s) => s.removeRepo)
  const view = useStore((s) => s.view)
  const t = useStore((s) => s.t)
  const working = (r.active ?? []).length > 0
  const need = r.attention ?? []
  const why = [...new Set(need)].map((x) => t(x === 'waiting' ? 'attnWaiting' : x === 'shared' ? 'attnShared' : x === 'main' ? 'attnMain' : 'attnReady'))
  const branches = r.worktrees === 1 ? t('repoBranchesOne') : t('repoBranches', { n: r.worktrees })

  return (
    <li>
      <button type="button" className={`repo-item${r.path === repo && view !== 'sessions' && view !== 'control' ? ' is-active' : ''}`} onClick={() => setRepo(r.path)}
        title={[r.name, r.path, working ? r.active!.map(agentName).join(', ') : '', r.worktrees > 0 ? branches : '', ...why].filter(Boolean).join('\n')}>
        <span className="repo-avatar">
          <FolderGit2 size={15} className="repo-icon" />
          <span className="repo-initial">{r.name.slice(0, 2)}</span>
          {working && <span className="repo-live" />}
        </span>
        <span className="repo-text">
          <span className="repo-name">{r.name}</span>
          {working && (
            <span className="repo-agents">
              {r.active!.map((a) => <span key={a} style={{ ['--c' as string]: agentVar(a) }}><span className="dot" />{agentName(a)}</span>)}
            </span>
          )}
        </span>
        {need.length > 0 && <span className="repo-attn" role="img" aria-label={why.join(', ')}><CircleAlert size={14} />{need.length > 1 && <b>{need.length}</b>}</span>}
        {r.worktrees > 0 && <span className="repo-count" aria-label={branches}>{r.worktrees}</span>}
      </button>
      <button type="button" className="repo-remove" onClick={() => removeRepo(r.path)} aria-label={`${t('removeRepo')}: ${r.name}`} title={t('removeRepo')}>
        <X size={13} />
      </button>
    </li>
  )
}
