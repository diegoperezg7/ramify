import { relTime } from '../i18n'
import { useStore } from '../store'
import { AgentBadge } from './AgentBadge'

/** What the agents have been doing: who is working now and the latest commits on their branches. */
export function Activity() {
  const state = useStore((s) => s.state)!
  const select = useStore((s) => s.select)
  const lang = useStore((s) => s.lang)
  const t = useStore((s) => s.t)
  const byBranch = new Map(state.worktrees.map((w) => [w.branch, w]))
  const working = state.worktrees.filter((w) => !w.main && w.running.length)
  const recent = state.commits.filter((c) => c.owner).sort((a, b) => b.time - a.time).slice(0, 14)

  if (!working.length && !recent.length) {
    return (
      <>
        <p className="muted">{t('select')}</p>
        <ul className="hints">
          <li>{t('hintSelect')}</li>
          <li>{t('hintGraph')}</li>
          <li>{t('hintPalette')}</li>
        </ul>
      </>
    )
  }

  return (
    <div className="activity">
      {working.length > 0 && (
        <section>
          <h3 className="activity-title"><i className="pulse" />{t('activeNow')}</h3>
          {working.map((w) => (
            <button key={w.path} type="button" className="activity-item is-live" onClick={() => select(w.path)}>
              <AgentBadge agent={w.agent} size={22} live />
              <span className="activity-text"><b>{w.agent || w.running[0]}</b> {t('workingOn')} <code>{w.branch}</code></span>
              {w.changes > 0 && <span className="chip chip-warn">{w.changes} {t(w.changes === 1 ? 'change' : 'changes')}</span>}
            </button>
          ))}
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h3 className="activity-title">{t('recentActivity')}</h3>
          {recent.map((c) => {
            const w = byBranch.get(c.owner!)
            return (
              <button key={c.hash} type="button" className="activity-item" onClick={() => w && select(w.path)}>
                <AgentBadge agent={w?.agent ?? ''} size={22} />
                <span className="activity-text">
                  <span className="activity-subject">{c.subject}</span>
                  <span className="activity-meta"><code>{c.owner}</code> · {relTime(lang, c.time, state.now)}</span>
                </span>
              </button>
            )
          })}
        </section>
      )}
      <p className="muted small activity-hint">{t('select')}</p>
    </div>
  )
}
