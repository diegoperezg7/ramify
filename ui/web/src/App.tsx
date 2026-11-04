import { AlertTriangle, CheckCircle2, Loader2, Plus, XCircle } from 'lucide-react'
import { Logo, Wordmark } from './components/Logo'
import { useEffect, useRef, useState } from 'react'
import { Detail } from './components/Detail'
import { CreateDialog, SettingsDialog } from './components/Forms'
import { GithubDialog } from './components/GithubDialog'
import { Graph } from './components/Graph'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/Stats'
import { CommandPalette } from './components/CommandPalette'
import { TopBar } from './components/TopBar'
import { Sessions } from './components/Sessions'
import { Onboarding } from './components/Onboarding'
import { Timeline } from './components/Timeline'
import { ControlCenter } from './components/ControlCenter'
import { Guide } from './components/Guide'
import { GanttChart, Network } from 'lucide-react'
import { sortWorktrees, WorktreeList } from './components/WorktreeList'
import { bridge } from './bridge'
import { useStore } from './store'

const POLL_MS = 2500

export function App() {
  const caps = useStore((s) => s.caps)
  const state = useStore((s) => s.state)
  const repos = useStore((s) => s.repos)
  const conn = useStore((s) => s.conn)
  const modal = useStore((s) => s.modal)
  const theme = useStore((s) => s.theme)
  const lang = useStore((s) => s.lang)
  const toasts = useStore((s) => s.toasts)
  const init = useStore((s) => s.init)
  const poll = useStore((s) => s.poll)
  const addRepo = useStore((s) => s.addRepo)
  const t = useStore((s) => s.t)
  const density = useStore((s) => s.density)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)

  useEffect(() => { document.documentElement.dataset.density = density }, [density])

  // Keyboard: ⌘K palette, ⌘N new worktree, ⌘, settings, ↑/↓ move between worktrees, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, dialog')
      // ⌘K toggles the palette, but never replaces another open dialog (its form would be lost).
      if (mod && e.key.toLowerCase() === 'k') {
        if (s.modal && s.modal !== 'palette') return
        e.preventDefault(); s.setModal(s.modal === 'palette' ? null : 'palette'); return
      }
      if (typing || s.modal) return
      if (mod && e.key.toLowerCase() === 'n' && s.caps?.create && s.state) { e.preventDefault(); s.setModal('create') }
      else if (mod && e.key === ',' && s.caps?.settings) { e.preventDefault(); s.setModal('settings') }
      // The worktree list only exists in the repository view: elsewhere arrows scroll and Esc does nothing.
      else if (s.view !== 'repo') return
      else if (e.key === 'Escape' && s.selected) s.select(null)
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && s.state && !mod) {
        e.preventDefault()
        const list = sortWorktrees(s.state.worktrees)
        const i = list.findIndex((w) => w.path === s.selected)
        const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
        if (next) s.select(next.path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Layout follows the width actually available to the app (window minus sidebar):
  // lg = three columns, md = detail becomes a drawer, sm = compact header and stats.
  const appRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<'lg' | 'md' | 'sm'>('lg')
  useEffect(() => {
    const el = appRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      setSize(w >= 1240 ? 'lg' : w >= 860 ? 'md' : 'sm')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Host events: a notification or the menu bar opens a worktree, the editor asks for the "new" form.
  useEffect(() => {
    bridge.onEvent(async (e) => {
      const s = useStore.getState()
      if (e.repo && e.repo !== s.repo) {
        await s.refreshRepos()
        s.setRepo(e.repo)
        await s.poll()
      }
      // A worktree opened from a notification or the menu bar is shown in the repository view.
      if (e.path) { const st = useStore.getState(); if (st.view !== 'repo') st.setView('repo'); st.select(e.path) }
      if (e.event === 'new') useStore.getState().setModal('create')
      if (e.event === 'sessions') useStore.getState().setView('sessions')
    })
  }, [])

  useEffect(() => {
    void init()
    const id = setInterval(() => { if (!document.hidden) void poll() }, POLL_MS)
    return () => clearInterval(id)
  }, [init, poll])

  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') { root.dataset.theme = theme; return }
    if (caps?.host !== 'vscode') { delete root.dataset.theme; return }
    // Inside VS Code / Cursor, "system" follows the editor theme (body.vscode-light / vscode-dark).
    const sync = () => { root.dataset.theme = document.body.classList.contains('vscode-light') ? 'light' : 'dark' }
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [theme, caps])

  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => { if (caps) document.documentElement.dataset.host = caps.host }, [caps])

  const noRepos = caps?.multiRepo && repos.length === 0

  return (
    <div className={`shell${caps?.multiRepo ? ' has-sidebar' : ''}`}>
      {caps?.multiRepo && <Sidebar />}
      <div className={`app is-${size}`} ref={appRef}>
        <TopBar />
        {conn !== 'ok' && !noRepos && (
          <div className="banner" role="alert"><AlertTriangle size={16} />{conn === 'unauthorized' ? t('badToken') : t('offline')}</div>
        )}
        {noRepos && view === 'repo' && (
          <div className="welcome">
            <Logo size={88} />
            <Wordmark className="welcome-name" />
            <p>{t('noRepos')}</p>
            <button type="button" className="btn btn-primary" onClick={() => addRepo()}><Plus size={15} />{t('addRepo')}</button>
          </div>
        )}
        {view === 'sessions' && caps?.sessions && <Sessions />}
        {view === 'control' && caps?.control && <ControlCenter />}
        {(view === 'repo' || view === 'timeline') && caps?.timeline && state && !noRepos && (
          <div className="view-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'repo'} className={view === 'repo' ? 'is-on' : ''} onClick={() => setView('repo')}><Network size={14} />{t('viewTree')}</button>
            <button type="button" role="tab" aria-selected={view === 'timeline'} className={view === 'timeline' ? 'is-on' : ''} onClick={() => setView('timeline')}><GanttChart size={14} />{t('viewTimeline')}</button>
          </div>
        )}
        {view === 'timeline' && caps?.timeline && !noRepos && <Timeline />}
        {view === 'repo' && !state && !noRepos && conn === 'ok' && (
          <div className="loading-repo" role="status"><Loader2 size={18} className="spin" />{t('loadingRepo')}</div>
        )}
        {view === 'repo' && state && !noRepos && (
          <>
            <main className={`layout${selected ? ' has-selection' : ''}`}>
              <WorktreeList />
              <Graph />
              <div className="drawer-scrim" onClick={() => select(null)} />
              {/* Keyed by worktree: a merge or remove dialog (and its "force") never carries over to another one. */}
              <Detail key={selected ?? ''} />
            </main>
          </>
        )}
        <StatusBar />
      </div>
      {modal === 'create' && <CreateDialog />}
      {modal === 'settings' && <SettingsDialog />}
      {modal === 'github' && <GithubDialog />}
      {modal === 'palette' && <CommandPalette />}
      {modal === 'onboarding' && <Onboarding />}
      {modal === 'guide' && <Guide />}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`}>
            {x.kind === 'ok' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
