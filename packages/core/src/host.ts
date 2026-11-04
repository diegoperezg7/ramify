import { Engine, EngineError, IDES } from './engine.ts'
import type { Capabilities, CreateRequest } from './types.ts'

// The request handlers every host (desktop app, editor extension) exposes to the UI.
// Hosts differ only in how they find the repository and how they run an agent.

export interface HostOptions {
  engine: Engine
  capabilities: Capabilities
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
  const repo = async (r: string) => o.repo(r)
  const ensureWorktree = async (r: string, path: string) => {
    if (!(await engine.worktrees(r)).some((w) => w.path === path)) throw new EngineError('unknown worktree')
  }

  return {
    capabilities: () => o.capabilities,
    state: async (r: string) => engine.state(await repo(r)),
    worktree: async (r: string, path: string) => engine.worktree(await repo(r), path),
    diff: async (r: string, path: string, file: string) => ({ diff: await engine.diff(await repo(r), path, file) }),
    open: async (r: string, path: string, ide: string) => {
      const main = await repo(r)
      if (!IDES.includes(ide)) throw new EngineError('unknown IDE')
      if (o.openFolder?.ides.includes(ide)) {
        await ensureWorktree(main, path)
        await o.openFolder.open(path)
        return { message: path }
      }
      return { message: await engine.openIde(main, path, ide) }
    },
    merge: async (r: string, path: string) => ({ message: await engine.merge(await repo(r), path) }),
    remove: async (r: string, path: string, force: boolean) => ({ message: await engine.remove(await repo(r), path, !!force) }),
    create: async (r: string, req: CreateRequest) => {
      const created = await engine.create(await repo(r), req)
      if (created.command) await o.runInTerminal(req.branch, created.path, created.command)
      return { path: created.path, message: created.command ? `${req.branch} · ${req.agent}` : req.branch }
    },
    launch: async (r: string, path: string, agent: string, prompt?: string) => {
      await ensureWorktree(await repo(r), path)
      await o.runInTerminal(agent, path, engine.launchCommand(path, agent, prompt))
      return { message: agent }
    },
  }
}

/** Dispatch one UI request to a handler. */
export async function dispatch(handlers: Handlers, method: string, args: unknown[]): Promise<unknown> {
  const fn = handlers[method]
  if (!fn) throw new Error(`not available here: ${method}`)
  return (fn as (...a: unknown[]) => unknown)(...(Array.isArray(args) ? args : []))
}
