import type { Detail, State } from './types'

function readToken(): string {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token')
  if (fromHash) {
    try { sessionStorage.setItem('agent-wt-token', fromHash) } catch { /* private mode */ }
    history.replaceState(null, '', location.pathname)
    return fromHash
  }
  try { return sessionStorage.getItem('agent-wt-token') ?? '' } catch { return '' }
}

const token = readToken()

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { 'X-Token': token, 'Content-Type': 'application/json' } })
  } catch {
    throw new ApiError('offline', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status)
  return body as T
}

const post = <T>(path: string, body: object) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })
const q = encodeURIComponent

export const api = {
  state: () => call<State>('/api/state'),
  worktree: (path: string) => call<Detail>(`/api/worktree?path=${q(path)}`),
  diff: (path: string, file: string) => call<{ diff: string }>(`/api/diff?path=${q(path)}&file=${q(file)}`),
  open: (path: string, ide: string) => post<{ message: string }>('/api/open', { path, ide }),
  merge: (path: string) => post<{ message: string }>('/api/merge', { path }),
  remove: (path: string, force: boolean) => post<{ message: string }>('/api/remove', { path, force }),
}
