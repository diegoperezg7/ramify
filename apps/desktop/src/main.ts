import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  cloneGithub, defaultProjectsDir, Engine, EngineError, githubRepos, IDES, openInTerminal, originSlug, runningAgents, scanRepos,
} from '../../../packages/core/src/index.ts'
import type { Capabilities, CreateRequest, GithubRepo, RepoInfo, Settings } from '../../../packages/core/src/types.ts'

// Apps started from Finder get a minimal PATH: borrow the login shell's so agents,
// xcodegen, npm and friends are found exactly as in the terminal.
function loginPath(): string | undefined {
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 5000 }).toString()
    return /__P__(.*)__P__/.exec(out)?.[1]
  } catch {
    return undefined
  }
}

const bin = app.isPackaged ? join(process.resourcesPath, 'bin', 'agent-wt') : resolve(__dirname, '../../../agent-wt')
try { chmodSync(bin, 0o755) } catch { /* read-only bundle: already executable */ }
const env = { ...process.env, PATH: loginPath() ?? process.env.PATH }
const engine = new Engine({ bin, env })

// --- persisted config ---------------------------------------------------------

if (process.env.AGENT_WT_USER_DATA) app.setPath('userData', process.env.AGENT_WT_USER_DATA)

interface Config { repos: string[]; settings: Settings }
const configFile = join(app.getPath('userData'), 'config.json')
const defaults: Config = {
  repos: [],
  settings: { terminal: 'Terminal', defaultAgent: 'claude', projectsDir: defaultProjectsDir(), autoDetect: true },
}

function readConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<Config>
    return { repos: c.repos ?? [], settings: { ...defaults.settings, ...c.settings } }
  } catch {
    return { repos: [], settings: { ...defaults.settings } }
  }
}
function writeConfig(c: Config) { writeFileSync(configFile, JSON.stringify(c, null, 2)) }

let config = readConfig()
// Repositories that already use agent-wt show up on first launch.
for (const r of engine.discover()) if (!config.repos.includes(r)) config.repos.push(r)
config.repos = config.repos.filter((r) => existsSync(r))
writeConfig(config)

function knownRepo(repo: string): string {
  if (!config.repos.includes(repo)) throw new EngineError('unknown repository')
  return repo
}

function addRepoToConfig(path: string) {
  if (!config.repos.includes(path)) { config.repos.push(path); writeConfig(config) }
}

// --- project detection --------------------------------------------------------

const mainOf = new Map<string, { main: string | null; at: number }>()
async function cachedMain(dir: string): Promise<string | null> {
  const hit = mainOf.get(dir)
  if (hit && Date.now() - hit.at < 30_000) return hit.main
  const main = await engine.mainCheckout(dir)
  mainOf.set(dir, { main, at: Date.now() })
  return main
}

/** Repositories with agents running in them right now (in the main checkout or any worktree). */
async function activeRepos(): Promise<Map<string, Set<string>>> {
  const active = new Map<string, Set<string>>()
  for (const { agent, cwd } of await runningAgents(env)) {
    const main = await cachedMain(cwd)
    if (!main) continue
    if (!active.has(main)) active.set(main, new Set())
    active.get(main)!.add(agent)
  }
  if (config.settings.autoDetect) for (const r of active.keys()) addRepoToConfig(r)
  return active
}

let githubCache: { at: number; repos: GithubRepo[] } | null = null
async function listGithub(refresh: boolean): Promise<GithubRepo[]> {
  if (!refresh && githubCache && Date.now() - githubCache.at < 60_000) return githubCache.repos
  const remote = await githubRepos(env)
  const local = new Map<string, string>()
  const candidates = [...new Set([...config.repos, ...scanRepos(config.settings.projectsDir)])]
  await Promise.all(candidates.map(async (p) => {
    const slug = await originSlug(p, env)
    if (slug && !local.has(slug.toLowerCase())) local.set(slug.toLowerCase(), p)
  }))
  const repos = remote.map((r) => {
    const path = local.get(r.nameWithOwner.toLowerCase()) ?? null
    return { ...r, local: path, added: !!path && config.repos.includes(path) }
  })
  githubCache = { at: Date.now(), repos }
  return repos
}

async function knownWorktree(repo: string, path: string): Promise<void> {
  if (!(await engine.worktrees(knownRepo(repo))).some((w) => w.path === path)) throw new EngineError('unknown worktree')
}

// --- IPC ----------------------------------------------------------------------

const handlers: Record<string, (...args: never[]) => unknown> = {
  capabilities: (): Capabilities => ({ host: 'desktop', multiRepo: true, create: true, settings: true, github: true, ides: IDES }),
  state: (repo: string) => engine.state(knownRepo(repo)),
  worktree: (repo: string, path: string) => engine.worktree(knownRepo(repo), path),
  diff: async (repo: string, path: string, file: string) => ({ diff: await engine.diff(knownRepo(repo), path, file) }),
  open: async (repo: string, path: string, ide: string) => ({ message: await engine.openIde(knownRepo(repo), path, ide) }),
  merge: async (repo: string, path: string) => ({ message: await engine.merge(knownRepo(repo), path) }),
  remove: async (repo: string, path: string, force: boolean) => ({ message: await engine.remove(knownRepo(repo), path, force) }),
  create: async (repo: string, req: CreateRequest) => {
    const created = await engine.create(knownRepo(repo), req)
    if (created.command) await openInTerminal(config.settings.terminal, created.command, created.path)
    return { path: created.path, message: created.command ? `${req.branch} → ${config.settings.terminal}` : req.branch }
  },
  launch: async (repo: string, path: string, agent: string, prompt?: string) => {
    await knownWorktree(repo, path)
    await openInTerminal(config.settings.terminal, engine.launchCommand(path, agent, prompt), path)
    return { message: `${agent} → ${config.settings.terminal}` }
  },
  repos: async (): Promise<RepoInfo[]> => {
    const active = await activeRepos()
    config.repos = config.repos.filter((r) => existsSync(r))
    return Promise.all(config.repos.map(async (r) => ({
      ...(await engine.repoInfo(r)), active: [...(active.get(r) ?? [])], github: await originSlug(r, env),
    })))
  },
  addRepo: async (): Promise<RepoInfo | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const main = await engine.mainCheckout(res.filePaths[0])
    if (!main) throw new EngineError('that folder is not inside a git repository')
    addRepoToConfig(main)
    return engine.repoInfo(main)
  },
  addRepoPath: async (path: string): Promise<RepoInfo> => {
    const main = await engine.mainCheckout(path)
    if (!main) throw new EngineError('that folder is not inside a git repository')
    addRepoToConfig(main)
    githubCache = null
    return engine.repoInfo(main)
  },
  github: (refresh?: boolean) => listGithub(!!refresh),
  cloneRepo: async (nameWithOwner: string): Promise<RepoInfo> => {
    const path = await cloneGithub(nameWithOwner, config.settings.projectsDir, env)
    addRepoToConfig(path)
    githubCache = null
    return engine.repoInfo(path)
  },
  removeRepo: (path: string) => { config.repos = config.repos.filter((r) => r !== path); writeConfig(config) },
  settings: () => config.settings,
  saveSettings: (s: Settings) => { config.settings = { ...config.settings, ...s }; writeConfig(config); githubCache = null },
}

ipcMain.handle('agent-wt', async (_e, method: string, args: unknown[]) => {
  const fn = handlers[method]
  if (!fn) throw new Error(`unknown method ${method}`)
  return (fn as (...a: unknown[]) => unknown)(...args)
})

// --- window -------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'agent-wt',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) { if (w.isMinimized()) w.restore(); w.focus() }
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]))
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
