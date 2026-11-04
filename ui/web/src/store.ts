import { create } from 'zustand'
import { api, ApiError } from './api'
import { dict, format, type Key, type Lang } from './i18n'
import type { Detail, State } from './types'

export type Theme = 'system' | 'light' | 'dark'
type Conn = 'ok' | 'offline' | 'unauthorized'

interface Toast { id: number; kind: 'ok' | 'error'; text: string }

interface Store {
  state: State | null
  conn: Conn
  lastSync: number
  selected: string | null
  detail: Detail | null
  file: string | null
  diff: string
  lang: Lang
  theme: Theme
  toasts: Toast[]
  busy: boolean

  t: (key: Key, vars?: Record<string, string | number>) => string
  poll: () => Promise<void>
  select: (path: string | null) => void
  refreshDetail: () => Promise<void>
  openFile: (file: string | null) => Promise<void>
  setLang: (lang: Lang) => void
  setTheme: (theme: Theme) => void
  toast: (kind: Toast['kind'], text: string) => void
  run: (action: () => Promise<{ message: string }>) => Promise<boolean>
}

function load<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback } catch { return fallback }
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

const defaultLang: Lang = navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
let toastId = 0

export const useStore = create<Store>((set, get) => ({
  state: null,
  conn: 'ok',
  lastSync: 0,
  selected: null,
  detail: null,
  file: null,
  diff: '',
  lang: load<Lang>('agent-wt-lang', defaultLang),
  theme: load<Theme>('agent-wt-theme', 'system'),
  toasts: [],
  busy: false,

  t: (key, vars) => format(dict[get().lang][key], vars),

  poll: async () => {
    try {
      const state = await api.state()
      const { selected } = get()
      const stillThere = selected && state.worktrees.some((w) => w.path === selected)
      set({ state, conn: 'ok', lastSync: Date.now(), ...(selected && !stillThere ? { selected: null, detail: null, file: null } : {}) })
      if (stillThere) void get().refreshDetail()
    } catch (e) {
      set({ conn: e instanceof ApiError && e.status === 401 ? 'unauthorized' : 'offline' })
    }
  },

  select: (path) => {
    set({ selected: path, detail: null, file: null, diff: '' })
    if (path) void get().refreshDetail()
  },

  refreshDetail: async () => {
    const path = get().selected
    if (!path) return
    try {
      const detail = await api.worktree(path)
      if (get().selected !== path) return
      set({ detail })
      const { file } = get()
      if (file && detail.files.some((f) => f.file === file)) {
        const { diff } = await api.diff(path, file)
        if (get().selected === path && get().file === file) set({ diff })
      }
    } catch { /* next poll retries */ }
  },

  openFile: async (file) => {
    const path = get().selected
    set({ file, diff: '' })
    if (!path || !file) return
    try {
      const { diff } = await api.diff(path, file)
      if (get().file === file) set({ diff })
    } catch (e) {
      get().toast('error', (e as Error).message)
    }
  },

  setLang: (lang) => { save('agent-wt-lang', lang); set({ lang }) },
  setTheme: (theme) => { save('agent-wt-theme', theme); set({ theme }) },

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
