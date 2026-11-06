import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { GithubIcon } from './GithubIcon'

/** Inline metrics in the header: compact, monospaced, always visible. */
export function Metrics() {
  const state = useStore((s) => s.state)
  const t = useStore((s) => s.t)
  if (!state) return null
  const wts = state.worktrees.filter((w) => !w.main)
  // The main checkout counts too: an agent working there is working.
  const live = state.worktrees.filter((w) => w.running.length).length
  const dirty = state.worktrees.reduce((n, w) => n + w.changes, 0)
  const ahead = wts.reduce((n, w) => n + w.commits, 0)
  return (
    <div className="metrics" aria-label="summary">
      <span><b>{wts.length}</b> {wts.length === 1 ? t('worktreeOne') : t('worktrees').toLowerCase()}</span>
      <span className={live ? 'is-live' : ''}>{live > 0 && <i className="pulse" />}<b>{live}</b> {t('live2')}</span>
      <span className={dirty ? 'is-warn' : ''}><b>{dirty}</b> {t('uncommittedShort')}</span>
      <span><b>{ahead}</b> {t('toMergeShort')}</span>
    </div>
  )
}

/** Bottom status bar, like an editor's. */
export function StatusBar() {
  const state = useStore((s) => (s.view !== 'sessions' && s.view !== 'control' ? s.state : null))
  const conn = useStore((s) => s.conn)
  const lastSync = useStore((s) => s.lastSync)
  const caps = useStore((s) => s.caps)
  const t = useStore((s) => s.t)
  const github = useStore((s) => s.github)
  const openSettings = useStore((s) => s.openSettings)
  // "synced Ns ago" has to move on its own between polls.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const ago = lastSync ? Math.max(0, Math.round((Date.now() - lastSync) / 1000)) : 0
  return (
    <footer className="statusbar">
      <span className={`sb-conn ${conn === 'ok' ? 'is-on' : 'is-off'}`}><i className="pulse" />{conn === 'ok' ? t('synced', { s: ago }) : t('offline')}</span>
      {state && <span className="sb-path" title={state.main}>{state.main}</span>}
      {state && <span className="sb-branch">⎇ {state.base}</span>}
      <span className="sb-spacer" />
      {state && !state.worktrees.some((w) => w.running.length) && <span className="sb-quiet">{t('allQuiet')}</span>}
      {caps?.host !== 'browser' && <span className="sb-keys">{t('shortcuts')}</span>}
      {/* The GitHub account, always reachable: a click opens it in Settings (sign in, sign out, repositories). */}
      {github?.configured && (
        <button type="button" className={`sb-github${github.status === 'signed-in' ? ' is-on' : ''}`} onClick={() => openSettings('github')}
          title={t('setTabGithub')}>
          <GithubIcon size={12} />{github.status === 'signed-in' && github.user ? `@${github.user.login}` : t('ghSignedOut')}
        </button>
      )}
      <span className="sb-ver wordmark">ramify</span>
    </footer>
  )
}
