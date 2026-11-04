import { Menu, Monitor, Moon, Plus, Search, SlidersHorizontal, Sun } from 'lucide-react'
import { Metrics } from './Stats'
import { useEffect, useRef, useState } from 'react'
import { Logo } from './Logo'
import { useStore, type Density, type Theme } from '../store'

/** The theme actually on screen: the explicit choice, or the system's / editor's. */
export function useDarkMode(): boolean {
  const theme = useStore((s) => s.theme)
  const read = () => {
    const forced = document.documentElement.dataset.theme
    if (forced) return forced === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  const [dark, setDark] = useState(read)
  useEffect(() => {
    setDark(read())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setDark(read())
    mq.addEventListener('change', sync)
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mq.removeEventListener('change', sync); obs.disconnect() }
  }, [theme])
  return dark
}

export function TopBar() {
  const state = useStore((s) => s.state)
  const caps = useStore((s) => s.caps)
  const conn = useStore((s) => s.conn)
  const lastSync = useStore((s) => s.lastSync)
  const setTheme = useStore((s) => s.setTheme)
  const setModal = useStore((s) => s.setModal)
  const setMenuOpen = useStore((s) => s.setMenuOpen)
  const t = useStore((s) => s.t)
  const dark = useDarkMode()
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const ago = lastSync ? Math.max(0, Math.round((Date.now() - lastSync) / 1000)) : null

  return (
    <header className="topbar">
      <div className="brand">
        {caps?.multiRepo && (
          <button type="button" className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label={t('menu')}><Menu size={18} /></button>
        )}
        {!caps?.multiRepo && <Logo size={30} />}
        {!caps?.multiRepo && <span className="name">agent-wt</span>}
        {state && (
          <>
            {!caps?.multiRepo && <span className="sep">/</span>}
            <span className="repo" title={state.main}>{state.repo}</span>
            <span className="base">{state.base}</span>
            <Metrics />
          </>
        )}
      </div>
      <div className="top-actions">
        {(caps?.multiRepo || caps?.create) && (
          <button type="button" className="palette-trigger" onClick={() => setModal('palette')}>
            <Search size={14} /><span>{t('palette')}</span><kbd>⌘K</kbd>
          </button>
        )}
        {!caps?.multiRepo && !caps?.create && (
          <span className={`live ${conn === 'ok' ? 'is-on' : 'is-off'}`} title={ago !== null ? `${t('updated')} ${ago}s` : undefined}>
            <span className="pulse" /><span className="live-label">{t('live')}</span>
          </span>
        )}
        <button type="button" className="icon-btn theme-toggle" onClick={() => setTheme(dark ? 'light' : 'dark')}
          aria-label={dark ? t('toLight') : t('toDark')} title={dark ? t('toLight') : t('toDark')}>
          {dark ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <Appearance />
        {caps?.create && state && (
          <button type="button" className="btn btn-primary new-btn" onClick={() => setModal('create')} title={t('newWorktree')}>
            <Plus size={15} /><span>{t('newWorktree')}</span><kbd>⌘N</kbd>
          </button>
        )}
      </div>
    </header>
  )
}

function Appearance() {
  const theme = useStore((s) => s.theme)
  const lang = useStore((s) => s.lang)
  const density = useStore((s) => s.density)
  const setTheme = useStore((s) => s.setTheme)
  const setLang = useStore((s) => s.setLang)
  const setDensity = useStore((s) => s.setDensity)
  const t = useStore((s) => s.t)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const themes: { id: Theme; icon: typeof Sun; label: string }[] = [
    { id: 'light', icon: Sun, label: t('themeLight') },
    { id: 'dark', icon: Moon, label: t('themeDark') },
    { id: 'system', icon: Monitor, label: t('themeSystem') },
  ]
  const densities: { id: Density; label: string }[] = [
    { id: 'comfortable', label: t('comfortable') },
    { id: 'compact', label: t('compact') },
  ]

  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('appearance')} title={t('appearance')}>
        <SlidersHorizontal size={17} />
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={t('appearance')}>
          <span className="popover-label">{t('theme')}</span>
          <div className="choice">
            {themes.map(({ id, icon: Icon, label }) => (
              <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}><Icon size={15} />{label}</button>
            ))}
          </div>
          <span className="popover-label">{t('language')}</span>
          <div className="choice">
            <button type="button" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>Español</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          </div>
          <span className="popover-label">{t('density')}</span>
          <div className="choice">
            {densities.map(({ id, label }) => (
              <button key={id} type="button" aria-pressed={density === id} onClick={() => setDensity(id)}>{label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
