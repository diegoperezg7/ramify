import { GitBranch, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore, type Theme } from '../store'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const ICON = { system: Monitor, light: Sun, dark: Moon }

export function TopBar() {
  const state = useStore((s) => s.state)
  const conn = useStore((s) => s.conn)
  const lastSync = useStore((s) => s.lastSync)
  const lang = useStore((s) => s.lang)
  const theme = useStore((s) => s.theme)
  const setLang = useStore((s) => s.setLang)
  const setTheme = useStore((s) => s.setTheme)
  const t = useStore((s) => s.t)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const ago = lastSync ? Math.max(0, Math.round((Date.now() - lastSync) / 1000)) : null
  const ThemeIcon = ICON[theme]

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo"><GitBranch size={18} strokeWidth={2.4} /></span>
        <span className="name">agent-wt</span>
        {state && (
          <>
            <span className="sep">/</span>
            <span className="repo" title={state.main}>{state.repo}</span>
            <span className="base">{state.base}</span>
          </>
        )}
      </div>
      <div className="top-actions">
        <span className={`live ${conn === 'ok' ? 'is-on' : 'is-off'}`}>
          <span className="pulse" />{t('live')}{ago !== null && conn === 'ok' && <span className="muted"> · {t('updated')} {ago}s</span>}
        </span>
        <div className="segmented" role="group" aria-label={t('language')}>
          {(['es', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={() => setTheme(NEXT[theme])} aria-label={`${t('theme')}: ${theme}`} title={`${t('theme')}: ${theme}`}>
          <ThemeIcon size={18} />
        </button>
      </div>
    </header>
  )
}
