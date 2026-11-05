// GitHub sign-in for the desktop app: OAuth device flow (RFC 8628) with a GitHub App.
//  - No client secret ships with the app: device-flow tokens are issued and refreshed with the client id alone.
//  - The GitHub App asks for the minimum: read-only repository metadata and pull requests, on the repos the user picks.
//  - User tokens expire after 8 hours and are refreshed with the refresh token.
//  - Only github.com and api.github.com are contacted. Tokens never leave this module except to the caller,
//    which stores them encrypted by the OS keychain and never hands them to the UI.

const GITHUB = 'https://github.com'
const API = 'https://api.github.com'
const UA = 'Ramify'

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export interface Tokens {
  accessToken: string
  /** ms epoch; 0 when the token does not expire. */
  expiresAt: number
  refreshToken: string | null
  refreshExpiresAt: number
}

export type AuthErrorCode = 'denied' | 'expired' | 'network' | 'config' | 'revoked'

export class AuthError extends Error {
  code: AuthErrorCode
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

async function post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${GITHUB}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams(params),
    })
  } catch {
    throw new AuthError('network')
  }
  if (res.status >= 500) throw new AuthError('network')
  return (await res.json()) as Record<string, unknown>
}

const toTokens = (j: Record<string, unknown>, now = Date.now()): Tokens => ({
  accessToken: String(j.access_token),
  expiresAt: j.expires_in ? now + Number(j.expires_in) * 1000 : 0,
  refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null,
  refreshExpiresAt: j.refresh_token_expires_in ? now + Number(j.refresh_token_expires_in) * 1000 : 0,
})

/** Step 1: a code for the user to enter at github.com/login/device. */
export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  if (!/^Iv[\w.]+$/.test(clientId)) throw new AuthError('config', 'missing GitHub App client id')
  const j = await post('/login/device/code', { client_id: clientId })
  if (typeof j.device_code !== 'string') throw new AuthError('config', String(j.error_description ?? j.error ?? 'device flow unavailable'))
  return {
    deviceCode: j.device_code, userCode: String(j.user_code), verificationUri: String(j.verification_uri),
    expiresAt: Date.now() + Number(j.expires_in ?? 900) * 1000, interval: Number(j.interval ?? 5),
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new AuthError('denied', 'cancelled')) }, { once: true })
})

/** Step 2: wait until the user approves (or denies, or the code expires). */
export async function pollForTokens(clientId: string, code: DeviceCode, signal?: AbortSignal): Promise<Tokens> {
  let interval = code.interval
  while (Date.now() < code.expiresAt) {
    await sleep(interval * 1000, signal)
    const j = await post('/login/oauth/access_token', {
      client_id: clientId, device_code: code.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    if (typeof j.access_token === 'string') return toTokens(j)
    if (j.error === 'authorization_pending') continue
    if (j.error === 'slow_down') { interval = Number(j.interval ?? interval + 5); continue }
    if (j.error === 'access_denied') throw new AuthError('denied')
    if (j.error === 'expired_token') throw new AuthError('expired')
    throw new AuthError('config', String(j.error_description ?? j.error))
  }
  throw new AuthError('expired')
}

/** A fresh access token when the current one is about to expire (device-flow tokens refresh without a secret). */
export async function refreshTokens(clientId: string, tokens: Tokens, now = Date.now()): Promise<Tokens> {
  if (!tokens.expiresAt || tokens.expiresAt - now > 5 * 60_000) return tokens
  if (!tokens.refreshToken || (tokens.refreshExpiresAt && tokens.refreshExpiresAt < now)) throw new AuthError('expired')
  const j = await post('/login/oauth/access_token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
  if (typeof j.access_token !== 'string') throw new AuthError(j.error === 'bad_refresh_token' ? 'revoked' : 'expired')
  return toTokens(j, now)
}

// --- API -------------------------------------------------------------------------------

async function api<T>(token: string, path: string): Promise<{ data: T; next: string | null }> {
  let res: Response
  try {
    res = await fetch(path.startsWith('https://') ? path : `${API}${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' },
    })
  } catch {
    throw new AuthError('network')
  }
  if (res.status === 401) throw new AuthError('revoked')
  if (!res.ok) throw new AuthError('network', `GitHub ${res.status}`)
  const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null
  // Pagination links must stay on api.github.com.
  return { data: (await res.json()) as T, next: next?.startsWith(`${API}/`) ? next : null }
}

async function all<T>(token: string, path: string, pick: (page: unknown) => T[], max = 20): Promise<T[]> {
  const out: T[] = []
  let url: string | null = path
  for (let i = 0; url && i < max; i++) {
    const page: { data: unknown; next: string | null } = await api<unknown>(token, url)
    const { data, next } = page
    out.push(...pick(data))
    url = next
  }
  return out
}

export interface GithubUser { login: string; name: string | null; avatarUrl: string }

export async function currentUser(token: string): Promise<GithubUser> {
  const { data } = await api<{ login: string; name: string | null; avatar_url: string }>(token, '/user')
  return { login: data.login, name: data.name, avatarUrl: data.avatar_url }
}

export interface RemoteRepo {
  nameWithOwner: string
  owner: string
  ownerType: 'User' | 'Organization'
  url: string
  description: string
  isPrivate: boolean
  isFork: boolean
  isArchived: boolean
  pushedAt: string
  language: string | null
}

type RawRepo = {
  full_name: string; html_url: string; description: string | null; private: boolean; fork: boolean; archived: boolean
  pushed_at: string; language: string | null; owner: { login: string; type: string }
}

const toRepo = (r: RawRepo): RemoteRepo => ({
  nameWithOwner: r.full_name, owner: r.owner.login, ownerType: r.owner.type === 'Organization' ? 'Organization' : 'User',
  url: r.html_url, description: r.description ?? '', isPrivate: r.private, isFork: r.fork, isArchived: r.archived,
  pushedAt: r.pushed_at, language: r.language,
})

/** Where the app is installed for this user, and the repositories it can see there. */
export async function accessibleRepos(token: string): Promise<{ installations: number; repos: RemoteRepo[] }> {
  const installs = await all<{ id: number }>(token, '/user/installations?per_page=100', (p) => (p as { installations: { id: number }[] }).installations)
  const repos = new Map<string, RemoteRepo>()
  for (const inst of installs) {
    for (const r of await all<RawRepo>(token, `/user/installations/${inst.id}/repositories?per_page=100`, (p) => (p as { repositories: RawRepo[] }).repositories)) {
      repos.set(r.full_name, toRepo(r))
    }
  }
  return { installations: installs.length, repos: [...repos.values()].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)) }
}

/** Every pull request of a repository (newest first), read with the user's token. */
export async function pullRequestsWithToken(token: string, slug: string): Promise<{ number: number; url: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; draft: boolean; title: string; branch: string; head: string }[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) return []
  const { data } = await api<{ number: number; html_url: string; state: string; merged_at: string | null; draft: boolean; title: string; head: { ref: string; sha: string } }[]>(
    token, `/repos/${slug}/pulls?state=all&per_page=100&sort=updated&direction=desc`)
  return data.map((p) => ({ number: p.number, url: p.html_url, state: p.merged_at ? 'MERGED' : p.state === 'open' ? 'OPEN' : 'CLOSED', draft: p.draft, title: p.title, branch: p.head.ref, head: p.head.sha }))
}

/** The pull request for `branch`, read with the user's token. */
export async function pullRequestWithToken(token: string, slug: string, branch: string): Promise<{ number: number; url: string; state: string; title: string } | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) return null
  const owner = slug.split('/')[0]
  const { data } = await api<{ number: number; html_url: string; state: string; merged_at: string | null; title: string }[]>(
    token, `/repos/${slug}/pulls?state=all&per_page=1&head=${encodeURIComponent(`${owner}:${branch}`)}`)
  const pr = data[0]
  return pr ? { number: pr.number, url: pr.html_url, state: pr.merged_at ? 'MERGED' : pr.state.toUpperCase(), title: pr.title } : null
}
