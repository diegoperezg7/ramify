import { create } from 'zustand'
import { bridge, BridgeError } from './bridge'
import { dict, format, type Key, type Lang } from './i18n'
import type { AgentSession, Capabilities, CreateRequest, Detail, RepoInfo, Settings, State } from './types'

export type Theme = 'system' | 'light' | 'dark'
export type Density = 'comfortable' | 'compact'
type Conn = 'ok' | 'offline' | 'unauthorized'
type Modal = 'create' | 'settings' | 'github' | 'palette' | 'onboarding' | null
export type View = 'repo' | 'sessions' | 'timeline'

interface Toast { id: number; kind: 'ok' | 'error'; text: string }

interface Store {
  caps: Capabilities | null
  repos: RepoInfo[]
  repo: string
  state: State | null
  conn: Conn
  lastSync: number
  selected: string | null
  detail: Detail | null
  file: string | null
  diff: string
  settings: Settings | null
  modal: Modal
  lang: Lang
  theme: Theme
  density: Density
  rail: boolean
  menuOpen: boolean
  toasts: Toast[]
  busy: boolean
  view: View
  sessions: AgentSession[] | null
  /** Values the "new worktree" form opens with (from a shared-branch warning). */
  createPrefill: { branch: string; agent: string } | null

  t: (key: Key, vars?: Record<string, string | number>) => string
  init: () => Promise<void>
  poll: () => Promise<void>
  setRepo: (path: string) => void
  addRepo: () => Promise<void>
  removeRepo: (path: string) => Promise<void>
  select: (path: string | null) => void
  refreshDetail: () => Promise<void>
  openFile: (file: string | null) => Promise<void>
  createWorktree: (req: CreateRequest) => Promise<boolean>
  saveSettings: (s: Settings) => Promise<void>
  setModal: (m: Modal) => void
  setLang: (lang: Lang) => void
  setTheme: (theme: Theme) => void
  setDensity: (d: Density) => void
  setRail: (rail: boolean) => void
  setMenuOpen: (open: boolean) => void
  refreshRepos: () => Promise<void>
  addRepoPath: (path: string) => Promise<void>
  cloneRepo: (nameWithOwner: string) => Promise<boolean>
  toast: (kind: Toast['kind'], text: string) => void
  setView: (view: View) => void
  /** Open the "new worktree" form on `repo`, filled in. */
  newWorktreeFor: (repo: string, prefill: { branch: string; agent: string }) => Promise<void>
  refreshSessions: () => Promise<void>
  run: (action: () => Promise<{ message: string }>) => Promise<boolean>
}

function load<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback } catch { return fallback }
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

let pollSeq = 0
const defaultLang: Lang = navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
let toastId = 0

export const useStore = create<Store>((set, get) => ({
  caps: null,
  repos: [],
  repo: '',
  state: null,
  conn: 'ok',
  lastSync: 0,
  selected: null,
  detail: null,
  file: null,
  diff: '',
  settings: null,
  modal: null,
  lang: load<Lang>('ramify-lang', defaultLang),
  theme: load<Theme>('ramify-theme', 'system'),
  density: load<Density>('ramify-density', 'comfortable'),
  rail: load<string>('ramify-rail', '') === '1',
  menuOpen: false,
  toasts: [],
  busy: false,
  view: 'repo',
  sessions: null,
  createPrefill: null,

  t: (key, vars) => format(dict[get().lang][key], vars),

  init: async () => {
    const caps = await bridge.capabilities().catch(() => null)
    set({ caps })
    if (caps?.settings) set({ settings: await bridge.settings().catch(() => null) })
    if (caps?.sessions && load<View>('ramify-view', 'repo') === 'sessions') get().setView('sessions')
    // First run of the desktop app: a short introduction built from what is installed here.
    if (caps?.sessions && get().settings && !get().settings!.onboarded) set({ modal: 'onboarding' })
    if (caps?.multiRepo) {
      const repos = await bridge.repos()
      const saved = load('ramify-repo', '')
      set({ repos, repo: repos.find((r) => r.path === saved)?.path ?? repos[0]?.path ?? '' })
    }
    await get().poll()
  },

  poll: async () => {
    const { caps, repo } = get()
    if (get().view === 'sessions') void get().refreshSessions()
    if (caps?.multiRepo && !repo) { await get().refreshRepos(); return }
    const seq = ++pollSeq
    try {
      const state = await bridge.state(repo)
      // Drop answers that arrive after a newer poll (e.g. a slow interval poll after a remove).
      if (get().repo !== repo || seq !== pollSeq) return
      const { selected } = get()
      const stillThere = selected && state.worktrees.some((w) => w.path === selected)
      set({ state, conn: 'ok', lastSync: Date.now(), ...(selected && !stillThere ? { selected: null, detail: null, file: null } : {}) })
      if (stillThere) void get().refreshDetail()
      if (caps?.multiRepo) void get().refreshRepos()
    } catch (e) {
      set({ conn: e instanceof BridgeError && e.status === 401 ? 'unauthorized' : 'offline' })
    }
  },

  refreshRepos: async () => {
    try {
      const repos = await bridge.repos()
      set({ repos })
      if (!get().repo && repos[0]) get().setRepo(repos[0].path)
    } catch { /* keep the last list */ }
  },

  addRepoPath: async (path) => {
    try {
      const info = await bridge.addRepoPath(path)
      await get().refreshRepos()
      get().setRepo(info.path)
      set({ modal: null })
    } catch (e) {
      get().toast('error', (e as Error).message)
    }
  },

  cloneRepo: async (nameWithOwner) => {
    set({ busy: true })
    try {
      const info = await bridge.cloneRepo(nameWithOwner)
      get().toast('ok', `${nameWithOwner} → ${info.path}`)
      await get().refreshRepos()
      get().setRepo(info.path)
      return true
    } catch (e) {
      get().toast('error', (e as Error).message)
      return false
    } finally {
      set({ busy: false })
    }
  },

  setRepo: (path) => {
    save('ramify-repo', path)
    set({ repo: path, state: null, selected: null, detail: null, file: null, diff: '', menuOpen: false, view: get().view === 'timeline' ? 'timeline' : 'repo' })
    void get().poll()
  },

  addRepo: async () => {
    try {
      const info = await bridge.addRepo()
      if (!info) return
      set({ repos: [...get().repos.filter((r) => r.path !== info.path), info] })
      get().setRepo(info.path)
    } catch (e) {
      get().toast('error', (e as Error).message)
    }
  },

  removeRepo: async (path) => {
    await bridge.removeRepo(path)
    const repos = get().repos.filter((r) => r.path !== path)
    set({ repos })
    if (get().repo === path) get().setRepo(repos[0]?.path ?? '')
  },

  select: (path) => {
    set({ selected: path, detail: null, file: null, diff: '' })
    if (path) void get().refreshDetail()
  },

  refreshDetail: async () => {
    const { selected: path, repo } = get()
    if (!path) return
    try {
      const detail = await bridge.worktree(repo, path)
      if (get().selected !== path) return
      set({ detail })
      const { file } = get()
      if (file && detail.files.some((f) => f.file === file)) {
        const { diff } = await bridge.diff(repo, path, file)
        if (get().selected === path && get().file === file) set({ diff })
      }
    } catch { /* next poll retries */ }
  },

  openFile: async (file) => {
    const { selected: path, repo } = get()
    set({ file, diff: '' })
    if (!path || !file) return
    try {
      const { diff } = await bridge.diff(repo, path, file)
      if (get().file === file && get().selected === path) set({ diff })
    } catch (e) {
      get().toast('error', (e as Error).message)
    }
  },

  createWorktree: async (req) => {
    set({ busy: true })
    try {
      const { message, path } = await bridge.create(get().repo, req)
      get().toast('ok', message)
      await get().poll()
      get().select(path)
      return true
    } catch (e) {
      get().toast('error', (e as Error).message)
      return false
    } finally {
      set({ busy: false })
    }
  },

  saveSettings: async (s) => {
    await bridge.saveSettings(s)
    // The default editor changes the order of "Open in": read what the host offers again.
    set({ settings: s, caps: await bridge.capabilities().catch(() => get().caps) })
  },

  setModal: (modal) => set(modal === null ? { modal, createPrefill: null } : { modal }),
  setLang: (lang) => { save('ramify-lang', lang); set({ lang }) },
  setTheme: (theme) => { save('ramify-theme', theme); set({ theme }) },
  setDensity: (density) => { save('ramify-density', density); set({ density }) },
  setRail: (rail) => { save('ramify-rail', rail ? '1' : ''); set({ rail }) },
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setView: (view) => {
    save('ramify-view', view)
    set({ view, menuOpen: false })
    if (view === 'sessions') void get().refreshSessions()
  },
  newWorktreeFor: async (repo, prefill) => {
    if (!get().repos.some((r) => r.path === repo)) await bridge.addRepoPath(repo).catch(() => {})
    await get().refreshRepos()
    get().setRepo(repo)
    set({ createPrefill: prefill, modal: 'create' })
  },
  refreshSessions: async () => {
    try { set({ sessions: await bridge.sessions() }) } catch { /* keep the last list */ }
  },

  toast: (kind, text) => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), kind === 'error' ? 8000 : 4000)
  },

  run: async (action) => {
    set({ busy: true })
    try {
      const { message } = await action()
      get().toast('ok', message || get().t('done'))
      await get().poll()
      return true
    } catch (e) {
      get().toast('error', (e as Error).message)
      return false
    } finally {
      set({ busy: false })
    }
  },
}))
