import type { AgentSession, Bridge, Capabilities, GithubAccount, GithubSync, Health, InstalledTools, PullRequest, Timeline, Detail, GithubRepo, RepoInfo, Settings, State } from './types'

// One UI, three hosts:
//  - desktop app: Electron preload exposes window.ramify.invoke
//  - VS Code / Cursor: webview messages through acquireVsCodeApi
//  - browser (ramify ui): HTTP to ui/server.py, single repository

export class BridgeError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

type Invoke = (method: string, args: unknown[]) => Promise<unknown>

declare global {
  interface Window {
    ramify?: { invoke: Invoke; on?: (cb: (payload: unknown) => void) => void }
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void }
  }
}

type HostEvent = { repo?: string; path?: string; event?: string }

function rpc(invoke: Invoke, subscribe: (cb: (e: HostEvent) => void) => void): Bridge {
  const call = <T>(method: string, ...args: unknown[]) => invoke(method, args) as Promise<T>
  return {
    capabilities: () => call<Capabilities>('capabilities'),
    state: (repo) => call<State>('state', repo),
    worktree: (repo, path) => call<Detail>('worktree', repo, path),
    diff: (repo, path, file) => call<{ diff: string }>('diff', repo, path, file),
    open: (repo, path, ide) => call('open', repo, path, ide),
    merge: (repo, path) => call('merge', repo, path),
    remove: (repo, path, force) => call('remove', repo, path, force),
    create: (repo, req) => call('create', repo, req),
    launch: (repo, path, agent, prompt) => call('launch', repo, path, agent, prompt),
    timeline: (repo, days) => call<Timeline>('timeline', repo, days),
    health: (repo) => call<Health>('health', repo),
    pullRequests: (repo) => call<PullRequest[]>('pullRequests', repo),
    updateFromBase: (repo, path) => call<{ message: string }>('updateFromBase', repo, path),
    openPr: (repo, path) => call<{ message: string }>('openPr', repo, path),
    commitDays: (repo, days) => call<Record<number, number>>('commitDays', repo, days),
    shellIntegration: () => call<{ installed: boolean; rc: string }>('shellIntegration'),
    setShellIntegration: (on) => call<{ installed: boolean; rc: string }>('setShellIntegration', on),
    moveToBranch: (repo, agent) => call<{ message: string; path: string }>('moveToBranch', repo, agent),
    repos: () => call<RepoInfo[]>('repos'),
    addRepo: () => call<RepoInfo | null>('addRepo'),
    removeRepo: (path) => call<void>('removeRepo', path),
    github: (refresh) => call<GithubRepo[]>('github', refresh),
    cloneRepo: (nwo) => call<RepoInfo>('cloneRepo', nwo),
    addRepoPath: (path) => call<RepoInfo>('addRepoPath', path),
    settings: () => call<Settings>('settings'),
    saveSettings: (s) => call<void>('saveSettings', s),
    sessions: () => call<AgentSession[]>('sessions'),
    tools: () => call<InstalledTools>('tools'),
    githubAccount: () => call<GithubAccount>('githubAccount'),
    githubSignIn: () => call<{ userCode: string; verificationUri: string; expiresAt: number }>('githubSignIn'),
    githubCancel: () => call<void>('githubCancel'),
    githubSignOut: () => call<void>('githubSignOut'),
    githubSync: () => call<GithubSync>('githubSync'),
    suggestRepos: () => call<{ path: string; name: string }[]>('suggestRepos'),
    addRepos: (paths) => call<void>('addRepos', paths),
    exportSessions: (format) => call<{ message: string }>('exportSessions', format),
    clearSessions: () => call<void>('clearSessions'),
    publishRepo: (path, name, isPrivate) => call<{ message: string; github: string }>('publishRepo', path, name, isPrivate),
    onEvent: subscribe,
  }
}

function vscodeInvoke(): Invoke {
  const vscode = window.acquireVsCodeApi!()
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let id = 0
  window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { id?: number; result?: unknown; error?: string }
    if (typeof msg?.id !== 'number' || !pending.has(msg.id)) return
    const p = pending.get(msg.id)!
    pending.delete(msg.id)
    if (msg.error !== undefined) p.reject(new BridgeError(msg.error))
    else p.resolve(msg.result)
  })
  return (method, args) => new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    vscode.postMessage({ id: n, method, args })
  })
}

function electronInvoke(): Invoke {
  return async (method, args) => {
    try {
      return await window.ramify!.invoke(method, args)
    } catch (e) {
      // Electron prefixes errors with "Error invoking remote method '...': Error: ".
      throw new BridgeError(String((e as Error).message).replace(/^.*?Error: /, ''))
    }
  }
}

function httpBridge(): Bridge {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token')
  if (fromHash) {
    try { sessionStorage.setItem('ramify-token', fromHash) } catch { /* private mode */ }
    history.replaceState(null, '', location.pathname)
  }
  let token = fromHash ?? ''
  if (!token) { try { token = sessionStorage.getItem('ramify-token') ?? '' } catch { /* ignore */ } }

  const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
    let res: Response
    try {
      res = await fetch(path, { ...init, headers: { 'X-Token': token, 'Content-Type': 'application/json' } })
    } catch {
      throw new BridgeError('offline', 0)
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new BridgeError(body.error ?? res.statusText, res.status)
    return body as T
  }
  const post = <T>(path: string, body: object) => req<T>(path, { method: 'POST', body: JSON.stringify(body) })
  const q = encodeURIComponent
  const unsupported = () => Promise.reject(new BridgeError('not available in the browser'))

  return {
    capabilities: async () => ({ host: 'browser', multiRepo: false, create: false, settings: false, github: false, ides: ['xcode', 'cursor', 'code', 'zed', 'Finder'] }),
    state: () => req<State>('/api/state'),
    worktree: (_r, path) => req<Detail>(`/api/worktree?path=${q(path)}`),
    diff: (_r, path, file) => req(`/api/diff?path=${q(path)}&file=${q(file)}`),
    open: (_r, path, ide) => post('/api/open', { path, ide }),
    merge: (_r, path) => post('/api/merge', { path }),
    remove: (_r, path, force) => post('/api/remove', { path, force }),
    create: unsupported,
    launch: unsupported,
    timeline: unsupported,
    health: unsupported,
    pullRequests: async () => [],
    updateFromBase: unsupported,
    openPr: unsupported,
    commitDays: unsupported,
    shellIntegration: unsupported,
    setShellIntegration: unsupported,
    moveToBranch: unsupported,
    repos: async () => [],
    addRepo: async () => null,
    removeRepo: async () => {},
    github: unsupported,
    cloneRepo: unsupported,
    addRepoPath: unsupported,
    settings: unsupported,
    saveSettings: unsupported,
    sessions: async () => [],
    tools: unsupported,
    githubAccount: unsupported,
    githubSignIn: unsupported,
    githubCancel: unsupported,
    githubSignOut: unsupported,
    githubSync: unsupported,
    suggestRepos: async () => [],
    addRepos: unsupported,
    exportSessions: unsupported,
    clearSessions: unsupported,
    publishRepo: unsupported,
    onEvent: () => {},
  }
}

const electronEvents = (cb: (e: HostEvent) => void) => window.ramify?.on?.((p) => cb(p as HostEvent))
const vscodeEvents = (cb: (e: HostEvent) => void) => window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { command?: string; id?: number }
  if (d && typeof d.id !== 'number' && d.command) cb({ event: d.command })
})

export const bridge: Bridge = window.ramify
  ? rpc(electronInvoke(), electronEvents)
  : window.acquireVsCodeApi
    ? rpc(vscodeInvoke(), vscodeEvents)
    : httpBridge()
