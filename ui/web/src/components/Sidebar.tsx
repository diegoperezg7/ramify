import { FolderGit2, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings, X } from 'lucide-react'
import { GithubIcon } from './GithubIcon'
import { agentVar } from '../agents'
import { Logo, Wordmark } from './Logo'
import { useStore } from '../store'
import type { RepoInfo } from '../types'

export function Sidebar() {
  const repos = useStore((s) => s.repos)
  const addRepo = useStore((s) => s.addRepo)
  const setModal = useStore((s) => s.setModal)
  const caps = useStore((s) => s.caps)
  const rail = useStore((s) => s.rail)
  const setRail = useStore((s) => s.setRail)
  const menuOpen = useStore((s) => s.menuOpen)
  const setMenuOpen = useStore((s) => s.setMenuOpen)
  const t = useStore((s) => s.t)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const liveCount = repos.reduce((n, r) => n + (r.active?.length ?? 0), 0)

  const active = repos.filter((r) => r.active?.length).sort((a, b) => a.name.localeCompare(b.name))
  const rest = repos.filter((r) => !r.active?.length).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <div className={`sidebar-scrim${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar${rail ? ' is-rail' : ''}${menuOpen ? ' is-open' : ''}`}>
        <div className="sidebar-drag">
          <button type="button" className="icon-btn ghost rail-toggle" onClick={() => setRail(!rail)}
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
          <ul className="repo-list">{rest.map((r) => <RepoItem key={r.path} r={r} />)}</ul>
          <button type="button" className="side-btn" onClick={() => addRepo()} title={t('addRepo')}><Plus size={16} /><span>{t('addRepo')}</span></button>
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

  return (
    <li>
      <button type="button" className={`repo-item${r.path === repo && view !== 'sessions' ? ' is-active' : ''}`} onClick={() => setRepo(r.path)}
        title={`${r.name}\n${r.path}${working ? `\n${r.active!.join(', ')}` : ''}`}>
        <span className="repo-avatar">
          <FolderGit2 size={15} className="repo-icon" />
          <span className="repo-initial">{r.name.slice(0, 2)}</span>
          {working && <span className="repo-live" />}
        </span>
        <span className="repo-text">
          <span className="repo-name">{r.name}</span>
          {working && (
            <span className="repo-agents">
              {r.active!.map((a) => <span key={a} style={{ ['--c' as string]: agentVar(a) }}><span className="dot" />{a}</span>)}
            </span>
          )}
        </span>
        {r.worktrees > 0 && <span className="repo-count">{r.worktrees}</span>}
      </button>
      <button type="button" className="repo-remove" onClick={() => removeRepo(r.path)} aria-label={`${t('removeRepo')}: ${r.name}`} title={t('removeRepo')}>
        <X size={13} />
      </button>
    </li>
  )
}
