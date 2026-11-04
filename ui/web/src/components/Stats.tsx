import { useStore } from '../store'

/** Inline metrics in the header: compact, monospaced, always visible. */
export function Metrics() {
  const state = useStore((s) => s.state)
  const t = useStore((s) => s.t)
  if (!state) return null
  const wts = state.worktrees.filter((w) => !w.main)
  const live = wts.filter((w) => w.running.length).length
  const dirty = state.worktrees.reduce((n, w) => n + w.changes, 0)
  const ahead = wts.reduce((n, w) => n + w.commits, 0)
  return (
    <div className="metrics" aria-label="summary">
      <span><b>{wts.length}</b> {t('worktrees').toLowerCase()}</span>
      <span className={live ? 'is-live' : ''}>{live > 0 && <i className="pulse" />}<b>{live}</b> {t('live2')}</span>
      <span className={dirty ? 'is-warn' : ''}><b>{dirty}</b> {t('uncommittedShort')}</span>
      <span><b>{ahead}</b> {t('toMergeShort')}</span>
    </div>
  )
}

/** Bottom status bar, like an editor's. */
export function StatusBar() {
  const state = useStore((s) => (s.view === 'repo' ? s.state : null))
  const conn = useStore((s) => s.conn)
  const lastSync = useStore((s) => s.lastSync)
  const caps = useStore((s) => s.caps)
  const t = useStore((s) => s.t)
  const ago = lastSync ? Math.max(0, Math.round((Date.now() - lastSync) / 1000)) : 0
  return (
    <footer className="statusbar">
      <span className={`sb-conn ${conn === 'ok' ? 'is-on' : 'is-off'}`}><i className="pulse" />{conn === 'ok' ? t('synced', { s: ago }) : t('offline')}</span>
      {state && <span className="sb-path" title={state.main}>{state.main}</span>}
      {state && <span className="sb-branch">⎇ {state.base}</span>}
      <span className="sb-spacer" />
      {state && !state.worktrees.some((w) => w.running.length) && <span className="sb-quiet">{t('allQuiet')}</span>}
      {caps?.host !== 'browser' && <span className="sb-keys">{t('shortcuts')}</span>}
      <span className="sb-ver wordmark">ramify</span>
    </footer>
  )
}
