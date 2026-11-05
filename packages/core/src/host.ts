import { Engine, EngineError, knownIde } from './engine.ts'
import type { Capabilities, CreateRequest, Settings } from './types.ts'

// The request handlers every host (desktop app, editor extension) exposes to the UI.
// Hosts differ only in how they find the repository and how they run an agent.

export interface HostOptions {
  engine: Engine
  /** What this host can do; a function when it depends on the machine (installed editors). */
  capabilities: Capabilities | (() => Capabilities)
  /** Validate the repository the UI asks for and return its path (throw if not allowed). */
  repo: (requested: string) => Promise<string> | string
  /** Run `command` in a terminal named `name`, starting in `cwd`. */
  runInTerminal: (name: string, cwd: string, command: string) => Promise<void> | void
  /** Optional: open a folder in this host instead of an external app (ide ids it handles). */
  openFolder?: { ides: string[]; open: (path: string) => Promise<void> | void }
}

export type Handlers = Record<string, (...args: never[]) => unknown>

export function createHandlers(o: HostOptions): Handlers {
  const { engine } = o
  const repo = async (r: string) => { strings(r); return o.repo(r) }
  const ensureWorktree = async (r: string, path: string) => {
    if (!(await engine.worktrees(r)).some((w) => w.path === path)) throw new EngineError('unknown worktree')
  }

  return {
    capabilities: () => (typeof o.capabilities === 'function' ? o.capabilities() : o.capabilities),
    state: async (r: string) => engine.state(await repo(r)),
    worktree: async (r: string, path: string) => { strings(path); return engine.worktree(await repo(r), path) },
    diff: async (r: string, path: string, file: string) => { strings(path, file); return { diff: await engine.diff(await repo(r), path, file) } },
    commit: async (r: string, hash: string) => { strings(hash); return engine.commit(await repo(r), hash) },
    commitDiff: async (r: string, hash: string, file: string) => { strings(hash, file); return { diff: await engine.commitDiff(await repo(r), hash, file) } },
    open: async (r: string, path: string, ide: string) => {
      strings(path, ide)
      const main = await repo(r)
      if (!knownIde(ide)) throw new EngineError('unknown IDE')
      if (o.openFolder?.ides.includes(ide)) {
        await ensureWorktree(main, path)
        await o.openFolder.open(path)
        return { message: path }
      }
      return { message: await engine.openIde(main, path, ide) }
    },
    merge: async (r: string, path: string) => { strings(path); return { message: await engine.merge(await repo(r), path) } },
    remove: async (r: string, path: string, force: boolean) => { strings(path); return { message: await engine.remove(await repo(r), path, !!force) } },
    create: async (r: string, req: CreateRequest) => {
      if (!req || typeof req !== 'object') throw new Error('bad arguments')
      strings(req.branch, req.agent ?? '', req.base ?? '', req.prompt ?? '')
      if (req.base?.startsWith('-')) throw new EngineError('invalid base')
      const created = await engine.create(await repo(r), req)
      if (created.command) await o.runInTerminal(req.branch, created.path, created.command)
      return { path: created.path, message: created.command ? `${req.branch} · ${req.agent}` : req.branch }
    },
    health: async (r: string) => engine.health(await repo(r)),
    pullRequests: async (r: string) => engine.pullRequests(await repo(r)),
    updateFromBase: async (r: string, path: string) => { strings(path); return { message: await engine.updateFromBase(await repo(r), path) } },
    updateBase: async (r: string) => ({ message: await engine.updateBase(await repo(r)) }),
    openPr: async (r: string, path: string) => { strings(path); return { message: await engine.openPr(await repo(r), path) } },
    commitDays: async (r: string, days: number) => {
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 400) throw new Error('bad arguments')
      return engine.commitDays(await repo(r), days)
    },
    dayCommits: async (r: string, day: number) => {
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 0) throw new Error('bad arguments')
      return engine.dayCommits(await repo(r), day)
    },
    timeline: async (r: string, days: number) => {
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 3650) throw new Error('bad arguments')
      return engine.timeline(await repo(r), days)
    },
    launch: async (r: string, path: string, agent: string, prompt?: string) => {
      strings(path, agent, prompt ?? '')
      await ensureWorktree(await repo(r), path)
      await o.runInTerminal(agent, path, engine.launchCommand(path, agent, prompt))
      return { message: agent }
    },
  }
}

/**
 * Dispatch one UI request to a handler. Only the handler object's own functions answer:
 * inherited names (toString, constructor, __proto__…) are not methods of the bridge.
 */
export async function dispatch(handlers: Handlers, method: string, args: unknown[]): Promise<unknown> {
  if (typeof method !== 'string' || !Object.hasOwn(handlers, method) || typeof handlers[method] !== 'function') {
    throw new Error(`not available here: ${String(method)}`)
  }
  if (!Array.isArray(args) || args.length > 8) throw new Error('bad arguments')
  return (handlers[method] as (...a: unknown[]) => unknown)(...args)
}

/** Throws unless every value is a string (IPC arguments that name paths, repositories, agents…). */
export function strings(...values: unknown[]): void {
  for (const v of values) if (typeof v !== 'string' || v.length > 4096 || v.includes('\0')) throw new Error('bad arguments')
}

/** Links the app may hand to the browser: https anywhere, http only to this machine (worktree dev servers). */
export function isSafeExternal(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.username || u.password) return false
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
  } catch {
    return false
  }
}

/** Settings from the UI, kept to known keys and types; anything else keeps its current value. */
export function sanitizeSettings(input: unknown, current: Settings): Settings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (k: keyof Settings, ok: (v: string) => boolean) => (typeof s[k] === 'string' && ok(s[k] as string) ? s[k] : current[k])
  const bool = (k: keyof Settings) => (typeof s[k] === 'boolean' ? s[k] : current[k])
  const next: Settings = {
    ...current,
    terminal: str('terminal', (v) => ['Terminal', 'iTerm', 'Ghostty'].includes(v)) as Settings['terminal'],
    defaultAgent: str('defaultAgent', (v) => /^[\w.-]{1,64}$/.test(v)) as string,
    defaultIde: str('defaultIde', (v) => knownIde(v)) as string | undefined,
    projectsDir: str('projectsDir', (v) => v.length < 1024 && !v.includes('\0')) as string,
    autoDetect: bool('autoDetect') as boolean,
    notifications: bool('notifications') as boolean | undefined,
    openAtLogin: bool('openAtLogin') as boolean | undefined,
    menuBar: bool('menuBar') as boolean | undefined,
    onboarded: bool('onboarded') as boolean | undefined,
    ignored: Array.isArray(s.ignored) ? (s.ignored as unknown[]).filter((x): x is string => typeof x === 'string' && x.length < 128).slice(0, 200) : current.ignored,
    historyDays: typeof s.historyDays === 'number' && [0, 30, 90, 365].includes(s.historyDays) ? s.historyDays : current.historyDays,
    watchBranches: bool('watchBranches') as boolean | undefined,
    autoDraftPr: bool('autoDraftPr') as boolean | undefined,
    autoClean: bool('autoClean') as boolean | undefined,
    autoUpdate: bool('autoUpdate') as boolean | undefined,
    notifyReady: bool('notifyReady') as boolean | undefined,
  }
  for (const k of Object.keys(next) as (keyof Settings)[]) if (next[k] === undefined) delete next[k]
  return next
}
