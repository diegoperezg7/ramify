import { agentVar } from '../agents'
import { AgentBadge } from './AgentBadge'
import { useStore } from '../store'
import type { Worktree } from '../types'

export function WorktreeList() {
  const state = useStore((s) => s.state)!
  const t = useStore((s) => s.t)
  const worktrees = sortWorktrees(state.worktrees)
  const onlyMain = worktrees.length === 1

  return (
    <section className="pane list-pane">
      <header className="pane-head">
        <h2>{t('worktrees')}</h2>
        <span className="count">{worktrees.length - 1}</span>
      </header>
      <div className="wt-list">
        {worktrees.map((w) => <WorktreeRow key={w.path} w={w} />)}
        {onlyMain && <GettingStarted />}
      </div>
    </section>
  )
}

export function sortWorktrees(list: Worktree[]): Worktree[] {
  return [...list].sort((a, b) => Number(b.main) - Number(a.main) || Number(b.running.length > 0) - Number(a.running.length > 0) || a.name.localeCompare(b.name))
}

export function upstreamLabel(w: Worktree, t: ReturnType<typeof useStore.getState>['t']) {
  if (w.upstream === 'pushed') return t('pushed')
  if (w.upstream === 'local') return t('local')
  return `${w.upstream.replace('+', '')} ${t('unpushed')}`
}

function GettingStarted() {
  const t = useStore((s) => s.t)
  const caps = useStore((s) => s.caps)
  const setModal = useStore((s) => s.setModal)
  return (
    <div className="getting-started">
      <p className="gs-title">{t('gsTitle')}</p>
      <ol>
        <li><b>{t('gsStep1')}</b><span>{t('gsStep1Text')}</span></li>
        <li><b>{t('gsStep2')}</b><span>{t('gsStep2Text')}</span></li>
        <li><b>{t('gsStep3')}</b><span>{t('gsStep3Text')}</span></li>
      </ol>
      {caps?.create
        ? <button type="button" className="btn btn-primary" onClick={() => setModal('create')}>{t('newWorktree')}</button>
        : <code>ramify new feat/login -a claude</code>}
    </div>
  )
}

function WorktreeRow({ w }: { w: Worktree }) {
  const t = useStore((s) => s.t)
  const selected = useStore((s) => s.selected === w.path)
  const select = useStore((s) => s.select)
  const working = w.running.length > 0
  const color = w.main ? 'var(--lane-base)' : agentVar(w.agent)

  return (
    <button type="button" className={`wt-row${selected ? ' is-selected' : ''}${working ? ' is-working' : ''}`}
      style={{ ['--c' as string]: color }} onClick={() => select(selected ? null : w.path)} aria-pressed={selected}>
      <span className="wt-bar" />
      <span className="wt-line1">
        <span className="wt-branch">{w.branch || '(detached)'}</span>
        {w.changes > 0 && <span className="chip chip-warn">{w.changes} {t(w.changes === 1 ? 'change' : 'changes')}</span>}
        {!w.main && w.commits > 0 && <span className="chip">{w.commits} {t(w.commits === 1 ? 'commit' : 'commits')}</span>}
      </span>
      <span className="wt-line2">
        {!w.main && <AgentBadge agent={w.agent} size={16} live={working} />}
        <span className="wt-agent">{w.main ? t('mainCheckout') : w.agent || t('noAgent')}</span>
        {working ? <span className="wt-live"><i className="pulse" />{t('running')}</span> : !w.main && <span className="wt-idle">{t('idle')}</span>}
        <span className="wt-sep" />
        <span className="wt-up">{upstreamLabel(w, t)}</span>
      </span>
    </button>
  )
}
