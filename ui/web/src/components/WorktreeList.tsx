import { CloudUpload, FileDiff, GitCommitHorizontal, HardDrive, Plug } from 'lucide-react'
import { agentVar } from '../agents'
import { useStore } from '../store'
import type { Worktree } from '../types'

export function WorktreeList() {
  const state = useStore((s) => s.state)!
  const t = useStore((s) => s.t)
  const worktrees = [...state.worktrees].sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name))
  const onlyMain = worktrees.length === 1

  return (
    <section className="panel list-panel">
      <header className="panel-head"><h2>{t('worktrees')}</h2><span className="count">{worktrees.length}</span></header>
      <div className="cards">
        {worktrees.map((w) => <WorktreeCard key={w.path} w={w} />)}
        {onlyMain && (
          <div className="empty">
            <p>{t('empty')}</p>
            <code>agent-wt new feat/login -a claude</code>
          </div>
        )}
      </div>
    </section>
  )
}

export function upstreamLabel(w: Worktree, t: ReturnType<typeof useStore.getState>['t']) {
  if (w.upstream === 'pushed') return t('pushed')
  if (w.upstream === 'local') return t('local')
  return `${w.upstream.replace('+', '')} ${t('unpushed')}`
}

function WorktreeCard({ w }: { w: Worktree }) {
  const t = useStore((s) => s.t)
  const selected = useStore((s) => s.selected === w.path)
  const select = useStore((s) => s.select)
  const working = w.running.length > 0
  const color = w.main ? 'var(--lane-base)' : agentVar(w.agent)

  return (
    <button type="button" className={`card wt-card${selected ? ' is-selected' : ''}`}
      style={{ ['--c' as string]: color }} onClick={() => select(selected ? null : w.path)} aria-pressed={selected}>
      <div className="wt-top">
        <span className="agent-chip"><span className="dot" />{w.main ? t('mainCheckout') : w.agent || t('noAgent')}</span>
        {!w.main && (
          <span className={`status ${working ? 'is-on' : ''}`}>
            <span className="pulse" />{working ? `${t('running')} · ${w.running.join(', ')}` : t('idle')}
          </span>
        )}
      </div>
      <div className="wt-branch">{w.branch || '(detached)'}</div>
      <div className="wt-meta">
        <span className={w.changes ? 'warn' : ''}><FileDiff size={14} aria-hidden="true" />{w.changes} {t(w.changes === 1 ? 'change' : 'changes')}</span>
        {!w.main && <span><GitCommitHorizontal size={14} aria-hidden="true" />{w.commits} {t(w.commits === 1 ? 'commit' : 'commits')}</span>}
        <span><CloudUpload size={14} aria-hidden="true" />{upstreamLabel(w, t)}</span>
        {w.port && <span><Plug size={14} aria-hidden="true" />{w.port}–{w.port + 9}</span>}
        {w.main && <span><HardDrive size={14} aria-hidden="true" />{w.path.split('/').slice(-1)[0]}</span>}
      </div>
    </button>
  )
}
