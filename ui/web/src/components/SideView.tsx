import { LayoutDashboard, Plus } from 'lucide-react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import { Graph } from './Graph'
import { ListSkeleton } from './Skeletons'

/**
 * The editor's side bar: the branch tree of this repository in a narrow column, with the dashboard a click away.
 * A commit opens in the dashboard, where there is room for its files and diffs.
 */
export function SideView() {
  const state = useStore((s) => s.state)
  const t = useStore((s) => s.t)
  const toast = useStore((s) => s.toast)
  const go = (action: 'open' | 'new', hash?: string) => { bridge.dashboard?.(action, hash).catch((e: Error) => toast('error', e.message)) }
  const live = state ? state.worktrees.filter((w) => !w.main && w.running.length).length : 0
  const total = state ? state.worktrees.length - 1 : 0

  return (
    <div className="side">
      <header className="side-head">
        <div className="side-repo">
          <b>{state?.repo ?? ''}</b>
          {state && <span className="chip">{state.base}</span>}
          {state && <span className="muted small">{t('worktrees')} {total}{live > 0 && <span className="side-live"> · {live} {t('running')}</span>}</span>}
        </div>
        <div className="side-actions">
          <button type="button" className="btn btn-primary" onClick={() => go('open')}><LayoutDashboard size={14} />{t('openDashboard')}</button>
          <button type="button" className="btn" onClick={() => go('new')} title={t('newAgent')} aria-label={t('newAgent')}><Plus size={15} /></button>
        </div>
        <p className="muted small side-hint">{t('sideHint')}</p>
      </header>
      {state ? <Graph onPick={(hash) => go('open', hash)} /> : <ListSkeleton rows={8} />}
    </div>
  )
}
