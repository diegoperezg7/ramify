import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, screen, session, shell, Tray } from 'electron'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  cloneGithub, createHandlers, defaultProjectsDir, dispatch, Engine, EngineError, githubRepos, IDES, openInTerminal, originSlug,
  accessibleRepos, AuthError, currentUser, hardenedGitEnv, isSafeExternal, sanitizeSettings, strings, installedTools, pollForTokens, publishGithub, pullRequestFor, pullRequestWithToken,
  refreshTokens, requestDeviceCode, scanRepos, scanSessions, SessionLog, sessionsCsv, type Resolved, type Tokens,
} from '../../../packages/core/src/index.ts'
import { GITHUB_APP } from './github-app.ts'
import type { AgentSession, GithubAccount, GithubRepo, GithubSync, RepoInfo, Settings } from '../../../packages/core/src/types.ts'

// Apps started from Finder get a minimal PATH: borrow the login shell's so agents,
// xcodegen, npm and friends are found exactly as in the terminal.
function loginPath(): string | undefined {
  if (process.platform === 'win32') return undefined
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 5000 }).toString()
    return /__P__(.*)__P__/.exec(out)?.[1]
  } catch {
    return undefined
  }
}

const bin = app.isPackaged ? join(process.resourcesPath, 'bin', 'ramify') : resolve(__dirname, '../../../ramify')
try { chmodSync(bin, 0o755) } catch { /* read-only bundle: already executable */ }
const env = hardenedGitEnv({ ...process.env, PATH: loginPath() ?? process.env.PATH })
const engine = new Engine({ bin, env })
const es = () => app.getLocale().toLowerCase().startsWith('es')

// --- persisted config ---------------------------------------------------------

if (process.env.RAMIFY_USER_DATA) app.setPath('userData', process.env.RAMIFY_USER_DATA)

interface Bounds { x: number; y: number; width: number; height: number }
interface Config { repos: string[]; settings: Settings; bounds?: Bounds }
const configFile = join(app.getPath('userData'), 'config.json')
// Renamed from agent-wt: bring the old repositories and settings over once.
const legacyConfig = join(app.getPath('appData'), 'agent-wt', 'config.json')
if (!existsSync(configFile) && existsSync(legacyConfig)) {
  try { mkdirSync(app.getPath('userData'), { recursive: true }); copyFileSync(legacyConfig, configFile) } catch { /* start fresh */ }
}
const defaultSettings: Settings = {
  terminal: 'Terminal', defaultAgent: 'claude', projectsDir: defaultProjectsDir(), autoDetect: true,
  notifications: true, openAtLogin: false, menuBar: true, historyDays: 90,
}

function readConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<Config>
    return { repos: c.repos ?? [], settings: { ...defaultSettings, ...c.settings }, bounds: c.bounds }
  } catch {
    return { repos: [], settings: { ...defaultSettings } }
  }
}
function writeConfig() { writeFileSync(configFile, JSON.stringify(config, null, 2)) }

const config = readConfig()
for (const r of engine.discover()) if (!config.repos.includes(r)) config.repos.push(r)
config.repos = config.repos.filter((r) => existsSync(r))
writeConfig()

function knownRepo(repo: string): string {
  if (!config.repos.includes(repo)) throw new EngineError('unknown repository')
  return repo
}

function addRepoToConfig(path: string) {
  if (!config.repos.includes(path)) { config.repos.push(path); writeConfig() }
}

// --- agent monitor --------------------------------------------------------------
// One `ps` + `lsof` for the whole machine every few seconds: which agents run in which
// worktree. Feeds the sidebar, the Dock badge, the menu bar and the "agent finished" notification.

interface Live { repo: string; path: string; branch: string; agents: string[] }
let live: Live[] = []
const worktreeCache = new Map<string, { at: number; list: { path: string; branch: string }[] }>()
const mainOf = new Map<string, { main: string | null; at: number }>()

async function cachedMain(dir: string): Promise<string | null> {
  const hit = mainOf.get(dir)
  if (hit && Date.now() - hit.at < 30_000) return hit.main
  const main = await engine.mainCheckout(dir)
  mainOf.set(dir, { main, at: Date.now() })
  return main
}

function worktreesOf(repo: string) {
  const hit = worktreeCache.get(repo)
  if (hit && Date.now() - hit.at < 15_000) return hit.list
  const out = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { env }).toString()
  const list: { path: string; branch: string }[] = []
  let path = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9)
    else if (line.startsWith('branch ')) list.push({ path, branch: line.slice(7).replace('refs/heads/', '') })
  }
  worktreeCache.set(repo, { at: Date.now(), list })
  return list
}

// --- AI sessions ------------------------------------------------------------------
// Every AI session on the machine (agent CLIs, IDE chat, desktop AI apps), kept as a history.

const sessionsFile = join(app.getPath('userData'), 'sessions.json')
function readSessions(): AgentSession[] {
  try { return JSON.parse(readFileSync(sessionsFile, 'utf8')) as AgentSession[] } catch { return [] }
}
const sessionLog = new SessionLog(readSessions())
let sessionsWritten = 0
function saveSessions(force: boolean) {
  // Changes are written at once; "still running" heartbeats at most once a minute.
  if (!force && Date.now() - sessionsWritten < 60_000) return
  sessionLog.prune(5000, config.settings.historyDays ?? 90)
  try { writeFileSync(sessionsFile, JSON.stringify(sessionLog.sessions)); sessionsWritten = Date.now() } catch { /* next scan retries */ }
}

async function resolveCwd(cwd: string | null): Promise<Resolved & { worktree: string | null }> {
  const none = { repo: null, branch: null, github: null, worktree: null }
  if (!cwd) return none
  const main = await cachedMain(cwd)
  if (!main) return none
  let wt: { path: string; branch: string } | undefined
  try {
    wt = worktreesOf(main).filter((w) => cwd === w.path || cwd.startsWith(`${w.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]
  } catch { /* not readable */ }
  return { repo: main, branch: wt?.branch ?? null, github: await cachedSlug(main), worktree: wt?.path ?? null }
}

async function scan(): Promise<Live[]> {
  const ignored = new Set(config.settings.ignored ?? [])
  const seen = (await scanSessions(env)).filter((s) => !ignored.has(s.agent) && !ignored.has(s.host.split(' · ')[0]))
  const sessions = await Promise.all(seen.map(async (s) => ({ ...s, ...(await resolveCwd(s.cwd)) })))
  warnSharedBranches(sessions)
  const { started, ended } = sessionLog.update(sessions)
  saveSessions(started.length > 0 || ended.length > 0)
  // Worktree view, Dock badge and notifications: agent CLIs at work in a repository.
  const found = new Map<string, Live>()
  for (const s of sessions) {
    if (s.inferred || !s.repo || !s.worktree) continue
    if (config.settings.autoDetect) addRepoToConfig(s.repo)
    if (!config.repos.includes(s.repo)) continue
    const entry = found.get(s.worktree) ?? { repo: s.repo, path: s.worktree, branch: s.branch ?? '', agents: [] }
    if (!entry.agents.includes(s.agent)) entry.agents.push(s.agent)
    found.set(s.worktree, entry)
  }
  return [...found.values()]
}

// Two agents on the same branch of the same folder overwrite each other: say so once, as it happens.
const warned = new Set<string>()
function warnSharedBranches(sessions: (Resolved & { inferred: boolean; agent: string; worktree: string | null })[]) {
  const byPlace = new Map<string, { repo: string; branch: string; agents: string[] }>()
  for (const s of sessions) {
    if (s.inferred || !s.repo || !s.worktree) continue
    const key = `${s.worktree}#${s.branch}`
    const e = byPlace.get(key) ?? { repo: s.repo, branch: s.branch ?? '', agents: [] }
    e.agents.push(s.agent)
    byPlace.set(key, e)
  }
  const now = new Set<string>()
  for (const [key, e] of byPlace) {
    if (e.agents.length < 2) continue
    now.add(key)
    if (warned.has(key) || !config.settings.notifications || !Notification.isSupported()) continue
    const n = new Notification({
      title: es() ? `${e.agents.length} agentes en la misma rama` : `${e.agents.length} agents on the same branch`,
      subtitle: `${e.repo.split('/').pop()} · ${e.branch}`,
      body: es() ? `${e.agents.join(', ')} se pisarán los cambios. Pulsa para darle a uno su propia rama.` : `${e.agents.join(', ')} will overwrite each other. Click to give one its own branch.`,
    })
    n.on('click', () => focus({ event: 'sessions' }))
    n.show()
  }
  for (const k of [...warned]) if (!now.has(k)) warned.delete(k)
  for (const k of now) warned.add(k)
}

// Pull requests of the branches agents worked on, looked up in the background.
const prCache = new Map<string, { at: number; pr: AgentSession['pr'] }>()
const prQueue: string[] = []
let prBusy = false
async function drainPrs() {
  if (prBusy) return
  prBusy = true
  try {
    while (prQueue.length) {
      const key = prQueue.shift()!
      const [slug, branch] = key.split('#')
      const token = await githubToken()
      const pr = token ? await pullRequestWithToken(token, slug, branch).catch(() => null) : await pullRequestFor(slug, branch, env)
      prCache.set(key, { at: Date.now(), pr })
    }
  } finally { prBusy = false }
}
function withPrs(list: AgentSession[]): AgentSession[] {
  const week = Date.now() - 7 * 86400_000
  return list.map((s) => {
    if (!s.github || !s.branch) return s
    const key = `${s.github}#${s.branch}`
    const hit = prCache.get(key)
    if ((!hit || Date.now() - hit.at > 5 * 60_000) && (s.end ?? Date.now()) > week && !prQueue.includes(key)) prQueue.push(key)
    return hit ? { ...s, pr: hit.pr } : s
  })
}

let firstScan = true
let scanning = false
async function monitor() {
  if (scanning) return
  scanning = true
  let next: Live[]
  try { next = await scan() } catch { return } finally { scanning = false }
  const finished = firstScan ? [] : live.filter((l) => !next.some((n) => n.path === l.path))
  firstScan = false
  live = next
  const n = live.reduce((sum, l) => sum + l.agents.length, 0)
  if (process.platform === 'darwin') app.dock?.setBadge(n ? String(n) : '')
  updateTray(n)
  if (config.settings.notifications && Notification.isSupported()) for (const f of finished) notifyFinished(f)
}

function notifyFinished(f: Live) {
  let changes = 0
  try { changes = execFileSync('git', ['-C', f.path, 'status', '--porcelain'], { env }).toString().split('\n').filter(Boolean).length } catch { /* removed */ }
  const who = f.agents.join(', ')
  const n = new Notification({
    title: es() ? `${who} ha terminado` : `${who} finished`,
    subtitle: `${f.repo.split('/').pop()} · ${f.branch}`,
    body: es()
      ? (changes ? `${changes} cambio(s) sin commitear. Pulsa para revisarlos.` : 'Pulsa para revisar sus commits.')
      : (changes ? `${changes} uncommitted change(s). Click to review.` : 'Click to review its commits.'),
  })
  n.on('click', () => focus({ repo: f.repo, path: f.path }))
  n.show()
}

// --- menu bar -------------------------------------------------------------------

let tray: Tray | null = null
function trayIcon() {
  const dir = app.isPackaged ? process.resourcesPath : resolve(__dirname, '../resources')
  // macOS: a monochrome template the menu bar tints. Windows / Linux: the coloured logo.
  if (process.platform !== 'darwin') return nativeImage.createFromPath(join(dir, 'tray.png'))
  const img = nativeImage.createFromPath(join(dir, 'trayTemplate.png'))
  img.setTemplateImage(true)
  return img
}

function updateTray(count: number) {
  if (!config.settings.menuBar) { tray?.destroy(); tray = null; return }
  if (!tray) {
    tray = new Tray(trayIcon())
    tray.setToolTip('Ramify')
  }
  tray.setTitle(count ? ` ${count}` : '', { fontType: 'monospacedDigit' })
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: count ? (es() ? `${count} agente(s) trabajando` : `${count} agent(s) working`) : (es() ? 'Ningún agente trabajando' : 'No agents working'), enabled: false },
    ...live.map((l) => ({
      label: `${l.agents.join(', ')}  ·  ${l.repo.split('/').pop()} / ${l.branch}`,
      click: () => focus({ repo: l.repo, path: l.path }),
    })),
    { type: 'separator' },
    { label: es() ? 'Abrir Ramify' : 'Open Ramify', click: () => focus() },
    { label: es() ? 'Nuevo worktree…' : 'New worktree…', click: () => focus({ event: 'new' }) },
    { type: 'separator' },
    { role: 'quit', label: es() ? 'Salir' : 'Quit' },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

// --- GitHub ---------------------------------------------------------------------

let githubCache: { at: number; repos: GithubRepo[] } | null = null
// --- GitHub account (device flow) ---------------------------------------------------
// The token is encrypted with the OS keychain (safeStorage) in a 0600 file, refreshed before it expires,
// never logged and never sent to the renderer: the UI only sees the login and the avatar.

const tokenFile = join(app.getPath('userData'), 'github-auth.bin')
let tokens: Tokens | null = null
let account: GithubAccount['user'] | undefined
let authState: { status: GithubAccount['status']; error?: string } = { status: 'signed-out' }
let authAbort: AbortController | null = null

function loadTokens(): Tokens | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try { return JSON.parse(safeStorage.decryptString(readFileSync(tokenFile))) as Tokens } catch { return null }
}
function saveTokens(t: Tokens | null) {
  tokens = t
  if (!t) { rmSync(tokenFile, { force: true }); return }
  // Without a keychain the token lives in memory for this session only: never written in plain text.
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(tokenFile, safeStorage.encryptString(JSON.stringify(t)), { mode: 0o600 })
    chmodSync(tokenFile, 0o600) // mode only applies when the file is created
  }
}

/**
 * A valid access token, refreshed when needed; null when signed out. Callers that arrive while a refresh
 * is in flight share it: GitHub rotates the refresh token, so a second refresh would be refused and sign the user out.
 */
let tokenInFlight: Promise<string | null> | null = null
function githubToken(): Promise<string | null> {
  tokenInFlight ??= freshToken().finally(() => { tokenInFlight = null })
  return tokenInFlight
}
async function freshToken(): Promise<string | null> {
  if (!GITHUB_APP.clientId) return null
  tokens ??= loadTokens()
  if (!tokens) return null
  try {
    const fresh = await refreshTokens(GITHUB_APP.clientId, tokens)
    if (fresh !== tokens) saveTokens(fresh)
    return fresh.accessToken
  } catch (e) {
    // Revoked or expired for good: forget it; a network error keeps it for the next try.
    if (e instanceof AuthError && e.code !== 'network') { saveTokens(null); account = undefined; authState = { status: 'signed-out' } }
    return null
  }
}

async function githubAccount(): Promise<GithubAccount> {
  const base = {
    configured: !!GITHUB_APP.clientId, keychain: safeStorage.isEncryptionAvailable(),
    installUrl: GITHUB_APP.slug ? `https://github.com/apps/${GITHUB_APP.slug}/installations/new` : null,
  }
  if (authState.status === 'waiting' || authState.status === 'error') return { ...base, ...authState }
  const token = await githubToken()
  if (!token) return { ...base, status: 'signed-out' }
  if (!account) { try { account = await currentUser(token) } catch { /* offline: still signed in */ } }
  return { ...base, status: 'signed-in', user: account }
}

async function githubSignIn() {
  if (!GITHUB_APP.clientId) throw new EngineError(es() ? 'Esta versión no tiene configurada la app de GitHub' : 'This build has no GitHub App configured')
  authAbort?.abort()
  const abort = new AbortController()
  authAbort = abort
  const code = await requestDeviceCode(GITHUB_APP.clientId)
  authState = { status: 'waiting' }
  // Only ever open GitHub's own page.
  if (/^https:\/\/github\.com\//.test(code.verificationUri)) void shell.openExternal(code.verificationUri)
  void pollForTokens(GITHUB_APP.clientId, code, abort.signal).then(async (t) => {
    saveTokens(t)
    account = await currentUser(t.accessToken).catch(() => undefined)
    authState = { status: 'signed-in' }
    githubCache = null
  }).catch((e: unknown) => {
    if (abort.signal.aborted) return
    authState = { status: 'error', error: e instanceof AuthError ? e.code : 'network' }
  })
  return { userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: code.expiresAt }
}

async function localSlugs(): Promise<Map<string, string>> {
  const local = new Map<string, string>()
  const candidates = [...new Set([...config.repos, ...scanRepos(config.settings.projectsDir)])]
  await Promise.all(candidates.map(async (p) => {
    const slug = await cachedSlug(p)
    if (slug && !local.has(slug.toLowerCase())) local.set(slug.toLowerCase(), p)
  }))
  return local
}

async function githubSync(): Promise<GithubSync> {
  const token = await githubToken()
  if (!token) throw new EngineError('signed-out')
  const [{ installations, repos }, local] = await Promise.all([accessibleRepos(token), localSlugs()])
  const liveByRepo = new Map<string, string[]>()
  for (const s of sessionLog.sessions) if (s.end === null && s.repo) liveByRepo.set(s.repo, [...new Set([...(liveByRepo.get(s.repo) ?? []), s.agent])])
  return {
    installations,
    repos: repos.filter((r) => !r.isArchived).map((r) => {
      const path = local.get(r.nameWithOwner.toLowerCase()) ?? null
      return { ...r, local: path, added: !!path && config.repos.includes(path), live: path ? liveByRepo.get(path) ?? [] : [] }
    }),
  }
}

async function listGithub(refresh: boolean): Promise<GithubRepo[]> {
  if (!refresh && githubCache && Date.now() - githubCache.at < 60_000) return githubCache.repos
  // Signed in: the repositories shared with Ramify. Otherwise the gh CLI's own session.
  const token = await githubToken()
  const remote = token
    ? (await accessibleRepos(token)).repos.filter((r) => !r.isArchived).map(({ owner: _o, ownerType: _t, isArchived: _a, ...r }) => r)
    : await githubRepos(env)
  const local = await localSlugs()
  const repos = remote.map((r) => {
    const path = local.get(r.nameWithOwner.toLowerCase()) ?? null
    return { ...r, local: path, added: !!path && config.repos.includes(path) }
  })
  githubCache = { at: Date.now(), repos }
  return repos
}

// --- IPC ----------------------------------------------------------------------

// The sidebar asks for every repository on each refresh: keep the git calls behind short caches.
const infoCache = new Map<string, { at: number; info: RepoInfo }>()
async function cachedInfo(repo: string): Promise<RepoInfo> {
  const hit = infoCache.get(repo)
  if (hit && Date.now() - hit.at < 5000) return hit.info
  const info = await engine.repoInfo(repo)
  infoCache.set(repo, { at: Date.now(), info })
  return info
}
const slugCache = new Map<string, { at: number; slug: string | null }>()
async function cachedSlug(repo: string): Promise<string | null> {
  const hit = slugCache.get(repo)
  if (hit && Date.now() - hit.at < 60_000) return hit.slug
  const slug = await originSlug(repo, env)
  slugCache.set(repo, { at: Date.now(), slug })
  return slug
}

function applyLoginItem() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!config.settings.openAtLogin })
}

async function addPath(path: string): Promise<RepoInfo> {
  const main = await engine.mainCheckout(path)
  if (!main) throw new EngineError(es() ? 'esa carpeta no está dentro de un repositorio git' : 'that folder is not inside a git repository')
  addRepoToConfig(main)
  githubCache = null
  return engine.repoInfo(main)
}

const handlers = {
  ...createHandlers({
    engine,
    capabilities: { host: 'desktop', platform: process.platform, multiRepo: true, create: true, settings: true, github: true, sessions: true, ides: IDES },
    repo: knownRepo,
    runInTerminal: (_name, cwd, command) => openInTerminal(config.settings.terminal, command, cwd),
  }),
  repos: async (): Promise<RepoInfo[]> => {
    config.repos = config.repos.filter((r) => existsSync(r))
    return Promise.all(config.repos.map(async (r) => ({
      ...(await cachedInfo(r)),
      active: [...new Set(live.filter((l) => l.repo === r).flatMap((l) => l.agents))],
      github: await cachedSlug(r),
    })))
  },
  addRepo: async (): Promise<RepoInfo | null> => {
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    return addPath(res.filePaths[0])
  },
  addRepoPath: (path: string) => { strings(path); return addPath(path) },
  removeRepo: (path: string) => { strings(path); config.repos = config.repos.filter((r) => r !== path); writeConfig() },
  github: (refresh?: boolean) => listGithub(!!refresh),
  cloneRepo: async (nameWithOwner: string): Promise<RepoInfo> => {
    strings(nameWithOwner)
    const path = await cloneGithub(nameWithOwner, config.settings.projectsDir, env)
    addRepoToConfig(path)
    githubCache = null
    return engine.repoInfo(path)
  },
  sessions: async () => {
    const list = withPrs(sessionLog.list(1500))
    void drainPrs()
    // A repository may have been published since the session: show its GitHub link as it is now.
    const repos = [...new Set(list.map((s) => s.repo).filter((r): r is string => !!r && existsSync(r)))]
    const slugs = new Map(await Promise.all(repos.map(async (r) => [r, await cachedSlug(r)] as const)))
    return list.map((s) => (s.repo && slugs.has(s.repo) ? { ...s, github: slugs.get(s.repo) ?? null } : s))
  },
  clearSessions: () => { sessionLog.clear(); saveSessions(true) },
  exportSessions: async (format: 'csv' | 'json') => {
    if (format !== 'csv' && format !== 'json') throw new EngineError('bad arguments')
    const ext = format === 'json' ? 'json' : 'csv'
    const opts = { defaultPath: join(app.getPath('downloads'), `ramify-sessions-${new Date().toISOString().slice(0, 10)}.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { message: '' }
    const all = withPrs(sessionLog.list(Number.MAX_SAFE_INTEGER))
    writeFileSync(res.filePath, ext === 'json' ? JSON.stringify(all, null, 2) : sessionsCsv(all))
    return { message: res.filePath }
  },
  publishRepo: async (path: string, name: string, isPrivate: boolean) => {
    strings(path, name)
    // Only repositories the app knows: listed ones or ones an AI session worked in.
    if (!config.repos.includes(path) && !sessionLog.sessions.some((s) => s.repo === path)) throw new EngineError('unknown repository')
    const github = await publishGithub(path, name, !!isPrivate, env)
    slugCache.delete(path)
    infoCache.delete(path)
    githubCache = null
    for (const s of sessionLog.sessions) if (s.repo === path) s.github = github
    saveSessions(true)
    addRepoToConfig(path)
    return { message: `github.com/${github}`, github }
  },
  tools: () => installedTools(env),
  githubAccount: () => githubAccount(),
  githubSignIn: () => githubSignIn(),
  githubCancel: () => { authAbort?.abort(); authAbort = null; authState = { status: 'signed-out' } },
  githubSignOut: () => { authAbort?.abort(); saveTokens(null); account = undefined; authState = { status: 'signed-out' }; githubCache = null },
  githubSync: () => githubSync(),
  suggestRepos: () => {
    const used = (p: string) => { try { return statSync(join(p, '.git')).mtimeMs } catch { return 0 } }
    return scanRepos(config.settings.projectsDir)
      .filter((p) => !config.repos.includes(p))
      .sort((a, b) => used(b) - used(a))
      .slice(0, 30)
      .map((path) => ({ path, name: path.split('/').pop() ?? path }))
  },
  addRepos: async (paths: string[]) => {
    for (const p of Array.isArray(paths) ? paths : []) {
      const main = typeof p === 'string' ? await engine.mainCheckout(p) : null
      if (main) addRepoToConfig(main)
    }
    githubCache = null
  },
  settings: () => config.settings,
  saveSettings: (s: Settings) => {
    config.settings = sanitizeSettings(s, config.settings)
    writeConfig()
    githubCache = null
    applyLoginItem()
    updateTray(live.reduce((sum, l) => sum + l.agents.length, 0))
  },
}

const rendererUrl = () => pathToFileURL(join(__dirname, '../renderer/index.html')).href
ipcMain.handle('ramify', (e, method: string, args: unknown[]) => {
  // Only the app's own page may drive the host.
  if (!e.senderFrame || e.senderFrame.url.split('#')[0] !== rendererUrl()) throw new Error('forbidden')
  return dispatch(handlers, method, args)
})

// --- window, deep links ---------------------------------------------------------

type Payload = { repo?: string; path?: string; event?: string }
let win: BrowserWindow | null = null
let pending: Payload | null = null

function send(payload: Payload) {
  if (win && !win.webContents.isLoading()) win.webContents.send('ramify:event', payload)
  else pending = payload
}

function focus(payload?: Payload) {
  if (!win) createWindow()
  if (win!.isMinimized()) win!.restore()
  win!.show()
  win!.focus()
  if (payload) send(payload)
}

/** ramify://open?path=/some/repo, or a folder passed as an argument: add the repository and show it. */
async function openTarget(target: string) {
  let path = target
  if (target.startsWith('ramify://')) {
    try { path = new URL(target).searchParams.get('path') ?? '' } catch { path = '' }
  }
  if (!path || !existsSync(path)) { focus(); return }
  // Links can come from any web page. A folder outside the repositories the app knows is not touched at all,
  // not even by git, until the user says so: a planted .git/config could otherwise run code.
  const real = (() => { try { return realpathSync(path) } catch { return path } })()
  const worktreeRoot = env.RAMIFY_ROOT || join(app.getPath('home'), '.worktrees')
  const known = config.repos.some((r) => real === r || real.startsWith(`${r}/`)) || real.startsWith(`${worktreeRoot}/`)
  if (!known) {
    focus()
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question', buttons: [es() ? 'Abrir' : 'Open', es() ? 'Cancelar' : 'Cancel'], defaultId: 1, cancelId: 1,
      message: es() ? 'Un enlace quiere abrir esta carpeta en Ramify' : 'A link wants to open this folder in Ramify',
      detail: `${real}\n\n${es() ? 'Ábrela solo si es tuya y confías en ella.' : 'Open it only if it is yours and you trust it.'}`,
    })
    if (response !== 0) return
  }
  try {
    const info = await addPath(path)
    const wt = (await engine.worktrees(info.path)).find((w) => !w.main && (path === w.path || path.startsWith(`${w.path}/`)))
    focus({ repo: info.path, path: wt?.path })
  } catch (e) {
    focus()
    dialog.showErrorBox('Ramify', (e as Error).message)
  }
}

function visibleBounds(b?: Bounds): Bounds | undefined {
  if (!b) return undefined
  const ok = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
  return ok ? b : undefined
}

function createWindow() {
  const bounds = visibleBounds(config.bounds)
  win = new BrowserWindow({
    width: bounds?.width ?? 1480,
    height: bounds?.height ?? 920,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Ramify',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : { autoHideMenuBar: true, icon: join(app.isPackaged ? process.resourcesPath : resolve(__dirname, '../resources'), 'tray.png') }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', () => { if (pending) { const p = pending; pending = null; setTimeout(() => send(p), 300) } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const saveBounds = () => { if (win && !win.isMinimized() && !win.isFullScreen()) { config.bounds = win.getBounds(); writeConfig() } }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)
  win.on('closed', () => { win = null })
  void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function targetFrom(argv: string[]): string | undefined {
  return argv.slice(1).reverse().find((a) =>
    a.startsWith('ramify://') || (a.startsWith('/') && !a.includes('.app/') && a !== process.execPath && a !== app.getAppPath() && existsSync(a)))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (app.isPackaged) app.setAsDefaultProtocolClient('ramify')
  app.on('open-url', (e, url) => { e.preventDefault(); void app.whenReady().then(() => openTarget(url)) })
  app.on('second-instance', (_e, argv) => {
    const target = targetFrom(argv)
    if (target) void openTarget(target)
    else focus()
  })
  // Windows needs the app id for notifications to show under the app's name.
  if (process.platform === 'win32') app.setAppUserModelId('io.github.diegoperezg7.ramify')
  app.whenReady().then(() => {
    // The page needs no browser permission (camera, microphone, location, notifications…) except writing
    // to the clipboard for the Copy buttons. Notifications come from the main process.
    const allowed = new Set(['clipboard-sanitized-write'])
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)))
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null)
    applyLoginItem()
    createWindow()
    const target = app.isPackaged ? targetFrom(process.argv) : process.env.RAMIFY_OPEN
    if (target) void openTarget(target)
    void monitor()
    setInterval(() => void monitor(), 4000)
    app.on('activate', () => focus())
  })
  // On macOS the app keeps running in the menu bar after the window closes, like other background tools.
  app.on('before-quit', () => saveSessions(true))
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
