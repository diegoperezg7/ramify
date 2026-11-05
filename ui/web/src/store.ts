import { create } from 'zustand'
import { bridge, BridgeError } from './bridge'
import { dict, format, type Key, type Lang } from './i18n'
import type { AgentChild, AgentSession, Capabilities, CreateRequest, Detail, RepoInfo, Settings, State } from './types'
import { MergeError, type MergeProblem } from './logic'

export type Theme = 'system' | 'light' | 'dark'
export type Density = 'comfortable' | 'compact'
type Conn = 'ok' | 'offline' | 'unauthorized'
type Modal = 'create' | 'settings' | 'github' | 'palette' | 'onboarding' | 'guide' | null
export type View = 'repo' | 'sessions' | 'timeline' | 'control'

interface Toast { id: number; kind: 'ok' | 'error'; text: string }

interface Store {
  caps: Capabilities | null
  repos: RepoInfo[]
  /** The repository list has been read at least once: an empty list means none, not "not loaded yet". */
  reposLoaded: boolean
  repo: string
  state: State | null
  conn: Conn
  lastSync: number
  selected: string | null
  /** A commit opened from the graph (its hash): shown where a worktree's detail goes. */
  commit: string | null
  detail: Detail | null
  file: string | null
  /** The open file's diff: null while it loads, '' when git has no text to show. */
  diff: string | null
  settings: Settings | null
  modal: Modal
  lang: Lang
  theme: Theme
  density: Density
  rail: boolean
  menuOpen: boolean
  toasts: Toast[]
  busy: boolean
  /** A merge that did not happen, shown as a dialog that says why and what to do. */
  mergeProblem: MergeProblem | null
  setMergeProblem: (p: MergeProblem | null) => void
  /** A merge that went through: a short dialog says so, besides the toast. */
  mergeDone: { branch: string; base: string; rebuilt: boolean } | null
  setMergeDone: (d: { branch: string; base: string; rebuilt: boolean } | null) => void
  view: View
  sessions: AgentSession[] | null
  /** Subagents, teammates, worktrees and Codex threads of the open sessions, by session key. */
  children: Record<string, AgentChild[]>
  /** Values the "new worktree" form opens with (from a shared-branch warning). */
  createPrefill: { branch: string; agent: string } | null

  t: (key: Key, vars?: Record<string, string | number>) => string
  init: () => Promise<void>
  /** Refresh the current view. `now`: a refresh the user asked for, never skipped by an interval poll in flight. */
  poll: (now?: boolean) => Promise<void>
  pollState: () => Promise<void>
  setRepo: (path: string) => void
  addRepo: () => Promise<void>
  removeRepo: (path: string) => Promise<void>
  select: (path: string | null) => void
  selectCommit: (hash: string | null) => void
  refreshDetail: () => Promise<void>
  openFile: (file: string | null) => Promise<void>
  createWorktree: (req: CreateRequest, repo?: string) => Promise<boolean>
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

/** A stored preference, or the fallback when it is missing, unreadable or not one of `allowed`. */
function load<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && (!allowed || allowed.includes(v)) ? v : fallback
  } catch { return fallback }
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

let pollSeq = 0
let polling = false
const defaultLang: Lang = navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
let toastId = 0

export const useStore = create<Store>((set, get) => ({
  caps: null,
  repos: [],
  reposLoaded: false,
  repo: '',
  state: null,
  conn: 'ok',
  lastSync: 0,
  selected: null,
  commit: null,
  detail: null,
  file: null,
  diff: null,
  settings: null,
  modal: null,
  lang: load<Lang>('ramify-lang', defaultLang, ['es', 'en']),
  theme: load<Theme>('ramify-theme', 'system', ['system', 'light', 'dark']),
  density: load<Density>('ramify-density', 'comfortable', ['comfortable', 'compact']),
  rail: load<string>('ramify-rail', '') === '1',
  menuOpen: false,
  toasts: [],
  busy: false,
  mergeProblem: null,
  setMergeProblem: (mergeProblem) => set({ mergeProblem }),
  mergeDone: null,
  setMergeDone: (mergeDone) => set({ mergeDone }),
  view: 'repo',
  sessions: null,
  children: {},
  createPrefill: null,

  t: (key, vars) => format(dict[get().lang][key], vars),

  init: async () => {
    const caps = await bridge.capabilities().catch(() => null)
    set({ caps })
    if (caps?.settings) set({ settings: await bridge.settings().catch(() => null) })
    const savedView = load<View>('ramify-view', 'repo', ['repo', 'sessions', 'timeline', 'control'])
    if ((caps?.sessions && savedView === 'sessions') || (caps?.control && savedView === 'control')) get().setView(savedView)
    // First run of the desktop app: a short introduction built from what is installed here.
    if (caps?.sessions && get().settings && !get().settings!.onboarded) set({ modal: 'onboarding' })
    if (caps?.multiRepo) {
      // A failed first read must not stop the start-up: the next poll reads the list again.
      const repos = await bridge.repos().catch(() => null)
      const saved = load('ramify-repo', '')
      if (repos) set({ repos, reposLoaded: true, repo: repos.find((r) => r.path === saved)?.path ?? repos[0]?.path ?? '' })
    }
    await get().poll()
  },

  poll: async (now) => {
    const { caps } = get()
    if (get().view === 'sessions' || get().view === 'control') { void get().refreshSessions(); if (caps?.multiRepo) void get().refreshRepos(); return }
    // An interval poll waits for the one in flight: a slow repository must not pile up processes every 2.5 s.
    // A refresh the user asked for (new repo, new worktree, an action) goes now: pollSeq drops the older answer.
    if (now) { await get().pollState(); return }
    if (polling) return
    polling = true
    try { await get().pollState() } finally { polling = false }
  },

  pollState: async () => {
    const { caps, repo } = get()
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
      if (get().repo !== repo || seq !== pollSeq) return
      set({ conn: e instanceof BridgeError && e.status === 401 ? 'unauthorized' : 'offline' })
    }
  },

  refreshRepos: async () => {
    try {
      const repos = await bridge.repos()
      set({ repos, reposLoaded: true })
      if (!get().repo && repos[0]) get().setRepo(repos[0].path)
    } catch { set({ reposLoaded: true }) /* keep the last list */ }
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
    set({ repo: path, state: null, selected: null, commit: null, detail: null, file: null, diff: null, menuOpen: false, view: get().view === 'timeline' ? 'timeline' : 'repo' })
    void get().poll(true)
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
    try { await bridge.removeRepo(path) } catch (e) { get().toast('error', (e as Error).message); return }
    const repos = get().repos.filter((r) => r.path !== path)
    set({ repos })
    if (get().repo === path) get().setRepo(repos[0]?.path ?? '')
  },

  select: (path) => {
    set({ selected: path, commit: null, detail: null, file: null, diff: null })
    if (path) void get().refreshDetail()
  },

  selectCommit: (hash) => set({ commit: hash, selected: null, detail: null, file: null, diff: null }),

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
    set({ file, diff: null })
    if (!path || !file) return
    try {
      const { diff } = await bridge.diff(repo, path, file)
      if (get().file === file && get().selected === path) set({ diff })
    } catch (e) {
      // Stop the loading state: the toast says what went wrong.
      if (get().file === file && get().selected === path) set({ diff: '' })
      get().toast('error', (e as Error).message)
    }
  },

  createWorktree: async (req, repo) => {
    set({ busy: true })
    try {
      const target = repo || get().repo
      const { message, path } = await bridge.create(target, req)
      get().toast('ok', message)
      // From the repository view, show the new worktree; from the control center, stay there.
      if (get().view === 'repo' || get().view === 'timeline') {
        if (target !== get().repo) get().setRepo(target)
        await get().poll(true)
        get().select(path)
      } else void get().refreshRepos()
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
    if (view === 'sessions' || view === 'control') void get().refreshSessions()
  },
  newWorktreeFor: async (repo, prefill) => {
    if (!get().repos.some((r) => r.path === repo)) {
      try { await bridge.addRepoPath(repo) } catch (e) { get().toast('error', (e as Error).message); return }
    }
    await get().refreshRepos()
    get().setRepo(repo)
    set({ createPrefill: prefill, modal: 'create' })
  },
  refreshSessions: async () => {
    try {
      // An older host without agentChildren still shows its sessions.
      const [sessions, children] = await Promise.all([bridge.sessions(), bridge.agentChildren().catch(() => ({}))])
      set({ sessions, children, conn: 'ok', lastSync: Date.now() })
    } catch { set({ conn: 'offline' }) /* keep the last list */ }
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
      await get().poll(true)
      return true
    } catch (e) {
      if (e instanceof MergeError) set({ mergeProblem: e.problem })
      else get().toast('error', (e as Error).message)
      return false
    } finally {
      set({ busy: false })
    }
  },
}))
