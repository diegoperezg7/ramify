import { Bot, FileDiff, FolderGit2, GitMerge } from 'lucide-react'
import { useStore } from '../store'

export function Stats() {
  const state = useStore((s) => s.state)!
  const t = useStore((s) => s.t)
  const wts = state.worktrees.filter((w) => !w.main)
  const tiles = [
    { icon: FolderGit2, label: t('worktrees'), value: wts.length },
    { icon: Bot, label: t('activeAgents'), value: wts.filter((w) => w.running.length).length, live: true },
    { icon: FileDiff, label: t('uncommitted'), value: state.worktrees.reduce((n, w) => n + w.changes, 0) },
    { icon: GitMerge, label: t('toMerge'), value: wts.reduce((n, w) => n + w.commits, 0) },
  ]
  return (
    <section className="stats" aria-label="summary">
      {tiles.map(({ icon: Icon, label, value, live }) => (
        <div key={label} className="card stat">
          <span className="stat-icon"><Icon size={16} /></span>
          <span className="stat-value">{value}{live && value > 0 && <span className="pulse" />}</span>
          <span className="stat-label">{label}</span>
        </div>
      ))}
    </section>
  )
}
