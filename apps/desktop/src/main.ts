import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, shell, Tray } from 'electron'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  cloneGithub, createHandlers, defaultProjectsDir, dispatch, Engine, EngineError, githubRepos, IDES, openInTerminal, originSlug,
  runningAgents, scanRepos,
} from '../../../packages/core/src/index.ts'
import type { GithubRepo, RepoInfo, Settings } from '../../../packages/core/src/types.ts'

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

const bin = app.isPackaged ? join(process.resourcesPath, 'bin', 'ramify') : resolve(__dirname, '../../../ramify')
try { chmodSync(bin, 0o755) } catch { /* read-only bundle: already executable */ }
const env = { ...process.env, PATH: loginPath() ?? process.env.PATH }
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
  notifications: true, openAtLogin: false, menuBar: true,
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

async function scan(): Promise<Live[]> {
  const found = new Map<string, Live>()
  for (const { agent, cwd } of await runningAgents(env)) {
    const main = await cachedMain(cwd)
    if (!main) continue
    if (config.settings.autoDetect) addRepoToConfig(main)
    if (!config.repos.includes(main)) continue
    let wts: { path: string; branch: string }[] = []
    try { wts = worktreesOf(main) } catch { continue }
    const wt = wts.filter((w) => cwd === w.path || cwd.startsWith(`${w.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]
    if (!wt) continue
    const entry = found.get(wt.path) ?? { repo: main, path: wt.path, branch: wt.branch, agents: [] }
    if (!entry.agents.includes(agent)) entry.agents.push(agent)
    found.set(wt.path, entry)
  }
  return [...found.values()]
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
    capabilities: { host: 'desktop', multiRepo: true, create: true, settings: true, github: true, ides: IDES },
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
  addRepoPath: (path: string) => addPath(path),
  removeRepo: (path: string) => { config.repos = config.repos.filter((r) => r !== path); writeConfig() },
  github: (refresh?: boolean) => listGithub(!!refresh),
  cloneRepo: async (nameWithOwner: string): Promise<RepoInfo> => {
    const path = await cloneGithub(nameWithOwner, config.settings.projectsDir, env)
    addRepoToConfig(path)
    githubCache = null
    return engine.repoInfo(path)
  },
  settings: () => config.settings,
  saveSettings: (s: Settings) => {
    config.settings = { ...config.settings, ...s }
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
  // Links can come from any web page: ask before adding a repository the app does not know yet.
  const main = await engine.mainCheckout(path)
  if (main && !config.repos.includes(main)) {
    focus()
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question', buttons: [es() ? 'Añadir' : 'Add', es() ? 'Cancelar' : 'Cancel'], defaultId: 0, cancelId: 1,
      message: es() ? '¿Añadir este repositorio a Ramify?' : 'Add this repository to Ramify?', detail: main,
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', () => { if (pending) { const p = pending; pending = null; setTimeout(() => send(p), 300) } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
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
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]))
    applyLoginItem()
    createWindow()
    const target = app.isPackaged ? targetFrom(process.argv) : process.env.RAMIFY_OPEN
    if (target) void openTarget(target)
    void monitor()
    setInterval(() => void monitor(), 4000)
    app.on('activate', () => focus())
  })
  // On macOS the app keeps running in the menu bar after the window closes, like other background tools.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
