import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, screen, session, shell, Tray } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  cloneGithub, createHandlers, defaultProjectsDir, dispatch, Engine, EngineError, githubRepos, idesFor, openInTerminal, originSlug,
  accessibleRepos, AuthError, currentUser, hardenedGitEnv, isSafeExternal, normPath, pullRequestsWithToken, riskyGitConfig, sanitizeSettings, strings, installedTools, pollForTokens, publishGithub, pullRequestFor, pullRequestWithToken,
  refreshTokens, requestDeviceCode, codexThreads, IDE_IDLE_MS, inTempDir, isActive, scanRepos, scanSessions, SessionLog, sessionsCsv, type Resolved, type Tokens,
  gitBash, setupApply, setupStatus, setupUndo, type SetupContext,
} from '../../../packages/core/src/index.ts'
import { GITHUB_APP } from './github-app.ts'
import type { AgentChild, AgentSession, GithubAccount, GithubRepo, GithubSync, PullRequest, RepoInfo, Settings, SetupItemId } from '../../../packages/core/src/types.ts'

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
// The monitor below knows which agent runs in which worktree (by command line, not process name): share it.
const engine = new Engine({
  bin, env,
  running: () => new Map([...busyAt].map(([path, e]) => [path, e.agents])),
  paused: () => new Map(live.map((l) => [l.path, l.agents.filter((a) => !(busyAt.get(l.path)?.agents ?? []).includes(a))])),
})
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
  notifications: true, openAtLogin: false, menuBar: true, historyDays: 90, watchBranches: true, autoDraftPr: true, autoClean: true,
}

function readConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<Config>
    return { repos: c.repos ?? [], settings: { ...defaultSettings, ...c.settings }, bounds: c.bounds }
  } catch {
    return { repos: [], settings: { ...defaultSettings } }
  }
}
/** Written to a temporary file and renamed: a crash mid-write never leaves a broken config behind. */
function writeConfig() {
  const tmp = `${configFile}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2))
  renameSync(tmp, configFile)
}

const config = readConfig()
for (const r of engine.discover()) if (!config.repos.includes(r)) config.repos.push(r)
writeConfig()

/** Repositories on disks that are not mounted right now stay in the config; they are only hidden. */
const presentRepos = () => config.repos.filter((r) => existsSync(r))

function knownRepo(repo: string): string {
  if (!config.repos.includes(repo)) throw new EngineError('unknown repository')
  return repo
}

const tempRoots = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map((p) => { try { return realpathSync(p) } catch { return p } })
function isTemporary(path: string): boolean {
  return tempRoots.some((root) => path === root || path.startsWith(`${root}/`))
}

function addRepoToConfig(path: string) {
  if (!config.repos.includes(path)) { config.repos.push(path); writeConfig() }
}

// --- agent monitor --------------------------------------------------------------
// One `ps` + `lsof` for the whole machine every few seconds: which agents run in which
// worktree. Feeds the sidebar, the Dock badge, the menu bar and the "agent finished" notification.

/** `busy`: the agents doing something there (not idle at their prompt); `agents` are all the open ones. */
interface Live { repo: string; path: string; branch: string; agents: string[]; busy: string[] }
let live: Live[] = []
/** Agents at work by worktree: the sessions' (Live.busy) plus subagents in the middle of a turn there. */
let busyAt = new Map<string, { repo: string; branch: string; agents: string[] }>()
/** What runs alongside each open session (subagents, teammates, worktrees, Codex threads), by session key. */
let children: Record<string, AgentChild[]> = {}
const worktreeCache = new Map<string, { at: number; list: { path: string; branch: string }[] }>()
const mainOf = new Map<string, { main: string | null; at: number }>()

async function cachedMain(dir: string): Promise<string | null> {
  const hit = mainOf.get(dir)
  if (hit && Date.now() - hit.at < 30_000) return hit.main
  const main = await engine.mainCheckout(dir)
  mainOf.set(dir, { main, at: Date.now() })
  return main
}

const gitOut = (args: string[]) => new Promise<string>((ok, fail) => {
  execFile('git', args, { env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? fail(err) : ok(String(stdout))))
})

async function worktreesOf(repo: string) {
  const hit = worktreeCache.get(repo)
  if (hit && Date.now() - hit.at < 15_000) return hit.list
  const out = await gitOut(['-C', repo, 'worktree', 'list', '--porcelain'])
  const list: { path: string; branch: string }[] = []
  // Records are separated by a blank line; a detached HEAD (mid-rebase) is still a worktree, with no branch.
  for (const rec of out.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(rec)?.[1]
    if (!path || /^bare$/m.test(rec)) continue
    list.push({ path: normPath(path), branch: /^branch (.+)$/m.exec(rec)?.[1]?.replace('refs/heads/', '') ?? '' })
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
  // Same spelling on both sides (Windows: C:\\ vs C:/, case): a session's cwd and git's worktree paths.
  const here = normPath(cwd).toLowerCase()
  try {
    wt = (await worktreesOf(main)).filter((w) => { const p = w.path.toLowerCase(); return here === p || here.startsWith(`${p}/`) })
      .sort((a, b) => b.path.length - a.path.length)[0]
  } catch { /* not readable */ }
  return { repo: main, branch: wt?.branch ?? null, github: await cachedSlug(main), worktree: wt?.path ?? null }
}

async function scan(): Promise<Live[]> {
  const ignored = new Set(config.settings.ignored ?? [])
  // Agents in throwaway folders under the system's temp directory (test runs, scripts) are not kept or shown.
  const scanned = (await scanSessions(env)).filter((s) => !ignored.has(s.agent) && !ignored.has(s.host.split(' · ')[0]) && !inTempDir(s.cwd))
  // Teammates in panes of their own belong to their lead's session: shown under it, never kept in the history.
  const seen = scanned.filter((s) => !s.parentSessionId)
  const sessions = await Promise.all(seen.map(async (s) => ({ ...s, ...(await resolveCwd(s.cwd)) })))
  const mates = await Promise.all(scanned.filter((s) => s.parentSessionId).map(async (s) => ({ ...s, ...(await resolveCwd(s.cwd)) })))
  warnSharedBranches(sessions)
  const { started, ended } = sessionLog.update(sessions)
  saveSessions(started.length > 0 || ended.length > 0)
  // Sessions the user closed are still in the scan: only the ones open in the log count.
  const open = new Map(sessionLog.sessions.filter((s) => s.end === null && s.key).map((s) => [s.key!, s]))
  // Worktree view, Dock badge and notifications: agent CLIs at work in a repository.
  const found = new Map<string, Live>()
  for (const s of sessions) {
    if (s.inferred || !s.repo || !s.worktree || !open.has(s.key)) continue
    // Throwaway repositories in the system's temporary folders (tests, demos) are not followed by themselves.
    if (config.settings.autoDetect && !isTemporary(s.repo)) addRepoToConfig(s.repo)
    if (!config.repos.includes(s.repo)) continue
    const entry = found.get(s.worktree) ?? { repo: s.repo, path: s.worktree, branch: s.branch ?? '', agents: [], busy: [] }
    if (!entry.agents.includes(s.agent)) entry.agents.push(s.agent)
    if (isActive(open.get(s.key)!) && !entry.busy.includes(s.agent)) entry.busy.push(s.agent)
    found.set(s.worktree, entry)
  }

  // Work running alongside the open sessions. A subagent in the middle of a turn works on its branch even while
  // its session waits at the prompt; it counts there, but its end is not an agent finishing (no notification).
  const kids: Record<string, AgentChild[]> = {}
  const add = (key: string, c: AgentChild) => { (kids[key] ??= []).push(c) }
  const busy = new Map<string, { repo: string; branch: string; agents: string[] }>()
  for (const l of found.values()) busy.set(l.path, { repo: l.repo, branch: l.branch, agents: [...l.busy] })
  for (const s of sessions) {
    if (!open.has(s.key)) continue
    for (const sub of s.subagents ?? []) {
      const at = await resolveCwd(sub.cwd)
      add(s.key, { kind: 'subagent', id: sub.id, label: sub.agentType, description: sub.description, cwd: sub.cwd, repo: at.repo, branch: at.branch, working: true })
      if (!at.repo || !at.worktree || !config.repos.includes(at.repo)) continue
      const e = busy.get(at.worktree) ?? { repo: at.repo, branch: at.branch ?? '', agents: [] }
      if (!e.agents.includes(s.agent)) e.agents.push(s.agent)
      busy.set(at.worktree, e)
    }
    if (s.sessionId && s.repo) {
      for (const w of await sessionWorktrees(s.repo, s.sessionId)) {
        add(s.key, { kind: 'worktree', id: w.path, label: w.branch, description: '', cwd: w.path, repo: s.repo, branch: w.branch, working: false })
      }
    }
  }
  for (const m of mates) {
    const lead = sessions.find((s) => s.sessionId === m.parentSessionId && open.has(s.key))
    if (lead) add(lead.key, { kind: 'teammate', id: m.agentName ?? m.key, label: m.agentName ?? 'teammate', description: m.agentType ?? '', cwd: m.cwd, repo: m.repo, branch: m.branch, working: false })
  }
  // Codex in the ChatGPT app: its threads changed in the last minutes, under the app's session.
  const chatgpt = sessions.find((s) => s.agent === 'chatgpt' && open.has(s.key))
  if (chatgpt) {
    for (const th of codexThreads(Date.now() - IDE_IDLE_MS)) {
      const at = await resolveCwd(th.cwd)
      add(chatgpt.key, { kind: 'codex', id: th.id, label: th.name ?? 'codex', description: '', cwd: th.cwd, repo: at.repo, branch: th.branch ?? at.branch, working: true, spawned: !!th.parentId })
    }
  }
  busyAt = busy
  children = kids
  return [...found.values()]
}

/** Worktrees of a repository that a subagent of this conversation made (WT_SESSION in its .worktree.env). */
async function sessionWorktrees(repo: string, sessionId: string): Promise<{ path: string; branch: string }[]> {
  let list: { path: string; branch: string }[] = []
  try { list = await worktreesOf(repo) } catch { return [] }
  return list.filter((w) => {
    try { return /^WT_SESSION=(.*)$/m.exec(readFileSync(join(w.path, '.worktree.env'), 'utf8'))?.[1]?.trim() === sessionId } catch { return false }
  })
}

const countAgents = (list: string[]) => [...new Set(list)].map((a) => { const n = list.filter((x) => x === a).length; return n > 1 ? `${a} ×${n}` : a }).join(', ')

// Two agents on the same branch of the same folder overwrite each other: say so once, as it happens.
const warned = new Set<string>()
function warnSharedBranches(sessions: (Resolved & { inferred: boolean; agent: string; worktree: string | null; state?: string })[]) {
  const byPlace = new Map<string, { repo: string; branch: string; agents: string[] }>()
  for (const s of sessions) {
    if (s.inferred || !s.repo || !s.worktree || s.state === 'idle') continue // paused sessions are not editing
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
      body: es() ? `${countAgents(e.agents)} se pisarán los cambios. Pulsa para darle a uno su propia rama.` : `${countAgents(e.agents)} will overwrite each other. Click to give one its own branch.`,
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

const workingCount = () => [...busyAt.values()].reduce((sum, e) => sum + e.agents.length, 0)

let firstScan = true
let scanning = false
/** Worktrees whose sessions the user closed, or whose repository they removed: gone, but no agent finished there. */
const dismissed = new Set<string>()
async function monitor() {
  if (scanning) return
  scanning = true
  let next: Live[]
  try { next = await scan() } catch { return } finally { scanning = false }
  const finished = firstScan ? [] : live.filter((l) => !next.some((n) => n.path === l.path) && !dismissed.has(l.path))
  dismissed.clear()
  firstScan = false
  live = next
  const n = workingCount()
  if (process.platform === 'darwin') app.dock?.setBadge(n ? String(n) : '')
  updateTray(n)
  if (config.settings.notifications && Notification.isSupported()) for (const f of finished) void notifyFinished(f)
  if (config.settings.autoDraftPr) for (const f of finished) void draftPrFor(f)
}

// --- branch care (every 2 minutes) ----------------------------------------------
// Warns about what will hurt at merge time and tidies up what is done. Each part has its own switch in Settings.

const told = new Set<string>()
function tell(key: string, title: string, body: string, payload: Payload) {
  if (told.has(key) || !config.settings.notifications || !Notification.isSupported()) return
  told.add(key)
  const n = new Notification({ title, body })
  n.on('click', () => focus(payload))
  n.show()
}

async function careForBranches() {
  if (!config.settings.watchBranches && !config.settings.autoClean) return
  for (const repo of presentRepos()) {
    let health
    try { health = await engine.health(repo) } catch { continue }
    const name = repo.split('/').pop()
    for (const b of health.branches) {
      if (b.main) continue
      // `running` leaves out agents idle at their prompt: an open session there (or a subagent) still lives in it.
      const occupied = b.running.length > 0 || live.some((l) => l.path === b.path) || busyAt.has(b.path)
      if (b.merged && !occupied) {
        if (config.settings.autoClean) {
          try {
            await engine.remove(repo, b.path, false)
            tell(`clean:${b.path}`, es() ? 'Worktree recogido' : 'Worktree tidied up', es() ? `${name} · ${b.branch} ya estaba en ${health.base}` : `${name} · ${b.branch} was already in ${health.base}`, { repo })
          } catch { /* something left in it: keep */ }
        } else if (config.settings.watchBranches) {
          tell(`merged:${b.path}`, es() ? 'Rama ya mergeada' : 'Branch already merged', es() ? `${name} · ${b.branch} está en ${health.base}: puedes quitar su worktree.` : `${name} · ${b.branch} is in ${health.base}: its worktree can go.`, { repo, path: b.path })
        }
        continue
      }
      if (!config.settings.watchBranches) continue
      if (b.behind >= 20) tell(`behind:${b.path}:${Math.floor(b.behind / 20)}`, es() ? `${b.branch} se queda atrás` : `${b.branch} is falling behind`,
        es() ? `${name}: ${b.behind} commits nuevos en ${health.base}. Tráelos antes de que crezca el conflicto.` : `${name}: ${b.behind} new commits in ${health.base}. Bring them in before the conflict grows.`, { repo, path: b.path })
      for (const other of b.overlaps) {
        const pair = [b.branch, other].sort().join(' ↔ ')
        tell(`overlap:${repo}:${pair}`, es() ? 'Dos ramas tocan lo mismo' : 'Two branches touch the same files',
          es() ? `${name}: ${pair}. Se encontrarán al mergear.` : `${name}: ${pair}. They will meet at merge time.`, { event: 'control' })
      }
    }
  }
}

async function repoPullRequests(repo: string): Promise<PullRequest[]> {
  const slug = await cachedSlug(repo)
  const token = slug ? await githubToken() : null
  if (token && slug) { try { return await pullRequestsWithToken(token, slug) } catch { /* fall back to gh */ } }
  return engine.pullRequests(repo)
}

/** An agent finished on a pushed branch with no pull request yet: open it as a draft. */
async function draftPrFor(f: Live) {
  try {
    const url = await engine.draftPrIfPushed(f.repo, f.path, await repoPullRequests(f.repo))
    if (url) tell(`pr:${f.path}`, es() ? 'Pull request en borrador' : 'Draft pull request', `${f.repo.split('/').pop()} · ${f.branch}`, { repo: f.repo, path: f.path })
  } catch { /* not a GitHub branch, or gh missing */ }
}

async function notifyFinished(f: Live) {
  let changes = 0
  try { changes = (await gitOut(['-C', f.path, 'status', '--porcelain'])).split('\n').filter(Boolean).length } catch { /* removed */ }
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
const trayDir = () => (app.isPackaged ? process.resourcesPath : resolve(__dirname, '../resources'))
function trayIcon() {
  // macOS: a monochrome template the menu bar tints. Windows / Linux: the coloured logo.
  if (process.platform !== 'darwin') return nativeImage.createFromPath(join(trayDir(), 'tray.png'))
  const img = nativeImage.createFromPath(join(trayDir(), 'trayTemplate.png'))
  img.setTemplateImage(true)
  return img
}

/** A pill with the glyph and the count (scripts/tray-assets.mjs): violet while agents work, amber when one waits for you. */
function trayBadge(count: number, waiting: boolean) {
  // Self-contained colours: readable on a light or dark menu bar alike.
  const img = nativeImage.createFromPath(join(trayDir(), 'tray', `badge-${waiting ? 'waiting' : 'working'}-${Math.min(count, 10)}.png`))
  return img.isEmpty() ? trayIcon() : img
}

const agentIcons = new Map<string, Electron.NativeImage | null>()
/** 16 pt logo of an agent for the menu, or null when it has none. */
function agentIcon(id: string) {
  if (!agentIcons.has(id)) {
    const img = nativeImage.createFromPath(join(trayDir(), 'tray', `agent-${id}.png`))
    agentIcons.set(id, img.isEmpty() ? null : img)
  }
  return agentIcons.get(id) ?? undefined
}

let traySignature = ''
function updateTray(count: number) {
  if (!config.settings.menuBar) { tray?.destroy(); tray = null; traySignature = ''; return }
  // Agents in followed repositories that are waiting for an answer (Claude Code reports it).
  const waitingAt = new Set(sessionLog.sessions
    .filter((s) => s.end === null && !s.inferred && s.state === 'waiting' && s.repo && config.repos.includes(s.repo))
    .map((s) => `${s.repo}#${s.branch ?? ''}`))
  // Rebuilding the menu every scan costs work on the main thread: only when what it shows changed.
  const signature = `${count}|${es()}|${[...waitingAt].join(',')}|${[...busyAt].map(([path, e]) => `${path}:${e.agents.join(',')}`).join(';')}`
  if (tray && signature === traySignature) return
  traySignature = signature
  if (!tray) tray = new Tray(trayIcon())
  tray.setImage(count ? trayBadge(count, waitingAt.size > 0) : trayIcon())
  tray.setTitle('')
  const waits = es() ? `${waitingAt.size} te espera(n)` : `${waitingAt.size} waiting for you`
  tray.setToolTip(count ? `Ramify · ${es() ? `${count} agente(s) trabajando` : `${count} agent(s) working`}${waitingAt.size ? ` · ${waits}` : ''}` : 'Ramify')
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: count ? `${es() ? `${count} agente(s) trabajando` : `${count} agent(s) working`}${waitingAt.size ? `  ·  ${waits}` : ''}` : (es() ? 'Ningún agente trabajando' : 'No agents working'), enabled: false },
    // One line per agent: its logo, where it works, and whether it waits for you. The name stays as a tooltip.
    ...[...busyAt].flatMap(([path, l]) => l.agents.map((a) => {
      const icon = agentIcon(a)
      const where = `${l.repo.split('/').pop()} / ${l.branch}`
      const wait = waitingAt.has(`${l.repo}#${l.branch}`) ? (es() ? '  ·  te espera' : '  ·  waiting for you') : ''
      return { label: `${icon ? '' : `${a}  ·  `}${where}${wait}`, icon, toolTip: a, click: () => focus({ repo: l.repo, path }) }
    })),
    { type: 'separator' },
    { label: es() ? 'Abrir Ramify' : 'Open Ramify', click: () => focus() },
    { label: es() ? 'Nuevo agente…' : 'New agent…', click: () => focus({ event: 'new' }) },
    { type: 'separator' },
    { role: 'quit', label: es() ? 'Salir' : 'Quit' },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
}


// --- editors ---------------------------------------------------------------------

let idesCache: { at: number; ides: string[] } | null = null
function installedIdes(): string[] {
  if (!idesCache || Date.now() - idesCache.at > 60_000) idesCache = { at: Date.now(), ides: idesFor(installedTools(env).editors) }
  const preferred = config.settings.defaultIde
  return preferred && idesCache.ides.includes(preferred) ? [preferred, ...idesCache.ides.filter((i) => i !== preferred)] : idesCache.ides
}

// --- terminal integration --------------------------------------------------------

// --- one-click setup of this computer (core/setup.ts) ------------------------------

/** On Windows, `claude` may be claude.exe or an npm claude.cmd: a .cmd only runs through cmd.exe, with its arguments quoted. */
function winCommand(cmd: string, args: string[]): [string, string[]] {
  if (process.platform !== 'win32' || /[\\/]/.test(cmd) || cmd === 'powershell' || cmd === 'pwsh') return [cmd, args]
  try {
    const found = execFileSync('where', [cmd], { env, timeout: 5000 }).toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const exe = found.find((f) => /\.exe$/i.test(f))
    if (exe) return [exe, args]
    const script = found.find((f) => /\.(cmd|bat)$/i.test(f))
    if (script) return ['cmd.exe', ['/d', '/s', '/c', `"${[script, ...args].map((a) => `"${a.replace(/"/g, '""')}"`).join(' ')}"`]]
  } catch { /* not installed: execFile reports it */ }
  return [cmd, args]
}

const setupCtx = (): SetupContext => ({
  platform: process.platform,
  // The same home the commands below see (HOME / USERPROFILE), not Electron's own lookup.
  home: homedir(),
  bin,
  // Packaged: the plugin ships in the app, so Claude Code reads it from there and it updates with the app.
  marketplace: app.isPackaged ? join(process.resourcesPath, 'claude-marketplace') : resolve(__dirname, '../../..'),
  path: env.PATH ?? '',
  shell: process.env.SHELL ?? '',
  gitBash: gitBash(env),
  localAppData: process.env.LOCALAPPDATA,
  run: (cmd, args, extra) => new Promise((ok) => {
    const [file, argv] = winCommand(cmd, args)
    const child = execFile(file, argv, { env: { ...env, ...extra }, timeout: 120_000, windowsVerbatimArguments: file === 'cmd.exe' }, (e, stdout, stderr) =>
      ok({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr || (e && !stdout ? e.message : '')) }))
    // Nothing to type in: without a terminal, `claude` would otherwise wait for input until the timeout.
    child.stdin?.end()
  }),
})

async function shellStatus(): Promise<{ installed: boolean; rc: string }> {
  const shell = (await setupStatus(setupCtx())).find((s) => s.id === 'shell')
  return { installed: shell?.status === 'done', rc: '' }
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
/** Bumped on sign-out and cancel: a refresh or a sign-in that finishes afterwards is thrown away. */
let authGeneration = 0

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
  const generation = authGeneration
  try {
    const fresh = await refreshTokens(GITHUB_APP.clientId, tokens)
    if (generation !== authGeneration) return null // signed out meanwhile
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
  if (/^https:\/\/github\.com\//.test(code.verificationUri)) shell.openExternal(code.verificationUri).catch(() => { /* no browser */ })
  const generation = ++authGeneration
  void pollForTokens(GITHUB_APP.clientId, code, abort.signal).then(async (t) => {
    if (abort.signal.aborted || generation !== authGeneration) return // cancelled while the last poll was in flight
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
    // Only the editors installed on this machine, the chosen default first.
    capabilities: () => ({ host: 'desktop', platform: process.platform, multiRepo: true, create: true, settings: true, github: true, sessions: true, timeline: true, control: true, setup: true, ides: installedIdes() }),
    repo: knownRepo,
    runInTerminal: (_name, cwd, command) => openInTerminal(config.settings.terminal, command, cwd),
  }),
  repos: async (): Promise<RepoInfo[]> => {
    return Promise.all(presentRepos().map(async (r) => ({
      ...(await cachedInfo(r)),
      active: [...new Set([...busyAt.values()].filter((e) => e.repo === r).flatMap((e) => e.agents))],
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
  removeRepo: (path: string) => {
    strings(path)
    for (const l of live) if (l.repo === path) dismissed.add(l.path)
    config.repos = config.repos.filter((r) => r !== path); writeConfig()
  },
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
  agentChildren: async () => children,
  closeSession: async (id: string) => {
    strings(id)
    const closed = sessionLog.close(id)
    if (!closed) throw new EngineError('unknown session')
    const at = await resolveCwd(closed.cwd)
    if (at.worktree) dismissed.add(at.worktree)
    saveSessions(true)
    await monitor()
  },
  pullRequests: (r: string) => { strings(r); return repoPullRequests(knownRepo(r)) },
  shellIntegration: () => shellStatus(),
  // Through core/setup.ts: on Windows the script runs in Git Bash and PowerShell gets the same integration.
  setShellIntegration: async (on: boolean) => {
    const after = on ? await setupApply(setupCtx(), ['shell']) : await setupUndo(setupCtx(), 'shell')
    const shell = after.find((s) => s.id === 'shell')
    if (shell?.error) throw new EngineError(shell.error)
    return { installed: shell?.status === 'done', rc: '' }
  },
  setupStatus: () => setupStatus(setupCtx()),
  setupApply: (items?: SetupItemId[]) => setupApply(setupCtx(), items),
  setupUndo: (item: SetupItemId) => { strings(item); return setupUndo(setupCtx(), item) },
  moveToBranch: async (r: string, agent: string) => {
    strings(r, agent)
    if (!/^[\w.-]+$/.test(agent)) throw new EngineError('invalid agent name')
    const repo = knownRepo(r)
    const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '').replace(/^(\d{4})/, '$1-')
    const branch = `${agent}/${stamp}`
    const path = await new Promise<string>((ok, fail) => execFile(bin, ['move', branch, '-a', agent], { cwd: repo, env }, (e, out, err) => (e ? fail(new EngineError(String(err).trim().replace(/^ramify: /, '') || e.message)) : ok(String(out).trim().split('\n').pop() ?? ''))))
    await openInTerminal(config.settings.terminal, engine.launchCommand(path, agent), path)
    return { message: branch, path }
  },
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
  githubCancel: () => { authGeneration++; authAbort?.abort(); authAbort = null; authState = { status: 'signed-out' } },
  githubSignOut: () => { authGeneration++; authAbort?.abort(); saveTokens(null); account = undefined; authState = { status: 'signed-out' }; githubCache = null },
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
    updateTray(workingCount())
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
    // Settings that make git run programs: say which before anything reads the repository.
    const risky = riskyGitConfig(real)
    if (risky.length) {
      const { response: go } = await dialog.showMessageBox(win!, {
        type: 'warning', buttons: [es() ? 'Abrir de todos modos' : 'Open anyway', es() ? 'Cancelar' : 'Cancel'], defaultId: 1, cancelId: 1,
        message: es() ? 'Este repositorio configura git para ejecutar programas' : 'This repository configures git to run programs',
        detail: `${risky.join(', ')}\n\n${es() ? 'Si no lo has configurado tú, no lo abras.' : 'If you did not set this up yourself, do not open it.'}`,
      })
      if (go !== 0) return
    }
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
  // Smoke test of a packaged build (npm run smoke): did the interface really render? Exit 0 or 1.
  if (process.env.RAMIFY_SMOKE_TEST) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const ok = await win?.webContents.executeJavaScript("!!document.querySelector('.shell .app') && getComputedStyle(document.body).fontFamily.length > 0").catch(() => false)
      console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL: the interface did not render')
      app.exit(ok ? 0 : 1)
    }, 3000))
  }
  win.webContents.on('did-finish-load', () => { if (pending) { const p = pending; pending = null; setTimeout(() => send(p), 300) } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url).catch(() => { /* no handler */ })
    return { action: 'deny' }
  })
  let boundsTimer: ReturnType<typeof setTimeout> | undefined
  const saveBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => { if (win && !win.isMinimized() && !win.isFullScreen()) { config.bounds = win.getBounds(); writeConfig() } }, 500)
  }
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
    setTimeout(() => void careForBranches(), 20_000)
    setInterval(() => void careForBranches(), 120_000)
    app.on('activate', () => focus())
  })
  // On macOS the app keeps running in the menu bar after the window closes, like other background tools.
  app.on('before-quit', () => saveSessions(true))
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
