import { CornerDownLeft, FolderGit2, GitBranch, Moon, Plus, Search, Settings, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { GithubIcon } from './GithubIcon'
import { useDarkMode } from './TopBar'
import { AgentBadge } from './AgentBadge'

interface Item { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void }

export function CommandPalette() {
  const t = useStore((s) => s.t)
  const caps = useStore((s) => s.caps)
  const repos = useStore((s) => s.repos)
  const state = useStore((s) => s.state)
  const setModal = useStore((s) => s.setModal)
  const setRepo = useStore((s) => s.setRepo)
  const select = useStore((s) => s.select)
  const setTheme = useStore((s) => s.setTheme)
  const dark = useDarkMode()
  const ref = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])

  const items = useMemo<Item[]>(() => {
    const close = (fn: () => void) => () => { setModal(null); fn() }
    const list: Item[] = []
    if (caps?.create && state) list.push({ id: 'new', group: t('groupActions'), label: t('newWorktree'), hint: '⌘N', icon: <Plus size={15} />, run: () => setModal('create') })
    if (caps?.github) list.push({ id: 'gh', group: t('groupActions'), label: t('githubTitle'), icon: <GithubIcon size={15} />, run: () => setModal('github') })
    list.push({ id: 'theme', group: t('groupActions'), label: dark ? t('toLight') : t('toDark'), icon: dark ? <Sun size={15} /> : <Moon size={15} />, run: close(() => setTheme(dark ? 'light' : 'dark')) })
    if (caps?.settings) list.push({ id: 'settings', group: t('groupActions'), label: t('settings'), hint: '⌘,', icon: <Settings size={15} />, run: () => setModal('settings') })
    for (const w of state?.worktrees ?? []) {
      if (w.main) continue
      list.push({
        id: `wt:${w.path}`, group: t('groupWorktrees'), label: w.branch, hint: w.agent || undefined,
        icon: <AgentBadge agent={w.agent} size={18} live={w.running.length > 0} />, run: close(() => select(w.path)),
      })
    }
    for (const r of repos) {
      list.push({ id: `repo:${r.path}`, group: t('groupRepos'), label: r.name, hint: r.active?.length ? `● ${r.active.join(', ')}` : undefined, icon: <FolderGit2 size={15} />, run: close(() => setRepo(r.path)) })
    }
    return list
  }, [caps, state, repos, dark, t, setModal, setRepo, select, setTheme])

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter((i) => words.every((w) => `${i.label} ${i.hint ?? ''} ${i.group}`.toLowerCase().includes(w)))
  }, [items, q])

  useEffect(() => { setIndex(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[index]?.run() }
  }

  let lastGroup = ''
  return (
    <dialog ref={ref} className="palette" onCancel={(e) => { e.preventDefault(); setModal(null) }}
      onClick={(e) => { if (e.target === ref.current) setModal(null) }}>
      <div className="palette-input">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('palette')} spellCheck={false} />
        <kbd>esc</kbd>
      </div>
      <div className="palette-list" ref={listRef} role="listbox">
        {filtered.length === 0 && <p className="muted small palette-empty">{t('paletteEmpty')}</p>}
        {filtered.map((item, i) => {
          const header = item.group !== lastGroup ? item.group : null
          lastGroup = item.group
          return (
            <div key={item.id}>
              {header && <div className="palette-group">{header}</div>}
              <button type="button" role="option" aria-selected={i === index} data-i={i}
                className={`palette-item${i === index ? ' is-on' : ''}`} onMouseMove={() => setIndex(i)} onClick={item.run}>
                <span className="palette-icon">{item.icon}</span>
                <span className="palette-label">{item.label}</span>
                {item.hint && <span className="palette-hint">{item.hint}</span>}
                {i === index && <CornerDownLeft size={13} className="palette-enter" />}
              </button>
            </div>
          )
        })}
      </div>
      <div className="palette-foot"><GitBranch size={12} /><span className="wordmark">ramify</span></div>
    </dialog>
  )
}
