import { execFile } from 'node:child_process'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { AI_APP_LIST, EDITORS, TERMINALS } from './catalog.ts'
import { agentOf, exeOf } from './projects.ts'
import type { AgentSession, SessionGlance, SessionState, SessionVia } from './types.ts'

// Every AI session on this machine, wherever it runs:
//  - agent CLIs (claude, codex, gemini…) in any terminal, in tmux, or started by an IDE extension;
//  - the AI chat built into an IDE (Cursor, VS Code + Copilot, Windsurf), inferred from its workspace storage;
//  - desktop AI apps (ChatGPT, Claude), while they are open.

/** One process. `exe` is the executable path and `args` the whole command line, both with forward slashes. */
export interface Proc { pid: number; ppid: number; elapsed: number; exe: string; args: string }

const WIN = process.platform === 'win32'

export interface LiveSession {
  /** Stable while the session lasts: pid + start for processes, app + folder for IDEs. */
  key: string
  agent: string
  host: string
  via: SessionVia
  /** Seen open, not a confirmed conversation (IDE chat, desktop apps). */
  inferred: boolean
  cwd: string | null
  /** Claude Code: the folder of the last file it edited. It says where the work is better than a `cd` to look around. */
  wrote?: string | null
  /** Claude Code: the folders it was in before `cwd`, newest first: where a `cd` came from. */
  before?: string[]
  start: number
  pid?: number
  /** What the agent is doing, when it says so (Claude Code does). */
  state?: SessionState
  /** Claude Code: the conversation's id, and its subagents in the middle of a turn. */
  sessionId?: string
  subagents?: Subagent[]
  /** Claude Code teammate in a pane of its own: the lead's conversation, its name and type. Never kept in the history. */
  parentSessionId?: string
  agentName?: string
  agentType?: string | null
  /** Claude Code: the task (first request) and a look at what it is doing (see transcriptGlance). */
  task?: string | null
  glance?: SessionGlance
}

/** A subagent working inside a Claude Code session (it has no process of its own). */
export interface Subagent { id: string; agentType: string; description: string; cwd: string | null }

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout) })
    })
  })
}

/** ps etime ([[dd-]hh:]mm:ss) in seconds. */
export function parseEtime(s: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim())
  if (!m) return 0
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4])
}

export function parsePs(stdout: string, exists?: (p: string) => boolean): Map<number, Proc> {
  const procs = new Map<number, Proc>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), elapsed: parseEtime(m[3]), exe: exeOf(m[4], exists), args: m[4] })
  }
  return procs
}

/** Windows: Get-CimInstance Win32_Process rendered as pid, ppid, age in seconds, exe and command line, tab-separated. */
export const WIN_PS = "Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { $age = [int]((Get-Date) - $_.CreationDate).TotalSeconds } else { $age = 0 }; " +
  '"$($_.ProcessId)`t$($_.ParentProcessId)`t$age`t$($_.ExecutablePath)`t$($_.CommandLine)" }'

export function parseWinPs(stdout: string): Map<number, Proc> {
  const procs = new Map<number, Proc>()
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, ppid, age, exePath = '', ...rest] = line.split('\t')
    if (!/^\d+$/.test(pid ?? '')) continue
    const exe = exePath.replace(/\\/g, '/')
    let cmd = rest.join(' ').trim()
    // Drop the executable from the command line (quoted or not) and keep its arguments.
    cmd = cmd.startsWith('"') ? cmd.slice(cmd.indexOf('"', 1) + 1) : cmd.slice(cmd.split(/\s/)[0].length)
    procs.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), elapsed: Number(age) || 0, exe, args: `${exe} ${cmd.trim().replace(/\\/g, '/')}`.trim() })
  }
  return procs
}

// App names from the catalog: macOS bundle → name, Windows executable → name.
const ALL_APPS = [...EDITORS, ...TERMINALS, ...AI_APP_LIST]
const MAC_APPS = new Map<string, string>([
  ...ALL_APPS.flatMap((a) => a.mac.map((b) => [b.split('/').pop()!, a.name] as const)),
  ['iTerm2', 'iTerm'],
])
const WIN_APPS = new Map<string, string>([
  ...ALL_APPS.flatMap((a) => a.win.map((w) => [(w.split('/').pop() ?? '').replace(/\.exe$/i, '').toLowerCase(), a.name] as const)),
  ['windowsterminal', 'Windows Terminal'], ['openconsole', 'Windows Terminal'], ['mintty', 'Git Bash'],
  ['code', 'VS Code'], ['code - insiders', 'VS Code Insiders'],
])
/** Agents launched from these are "in an IDE"; from AI apps they are that app's own session. */
export const IDE_HOSTS = new Set(EDITORS.map((e) => e.name))
export const AI_APPS: Record<string, string> = Object.fromEntries(AI_APP_LIST.map((a) => [a.name, a.id]))

/** The Windows app an executable belongs to, or null. */
export function winAppOf(exe: string): string | null {
  if (/\/AnthropicClaude\//i.test(exe)) return 'Claude'
  const name = (exe.split('/').pop() ?? '').replace(/\.exe$/i, '').toLowerCase()
  return WIN_APPS.get(name) ?? null
}

const procApp = (p: Proc) => (WIN ? winAppOf(p.exe) : appOf(p.args))

/** The macOS app a command line belongs to (the outermost X.app in its path), or null. */
export function appOf(args: string): string | null {
  const m = /\/([^/]+?)\.app\/Contents\//.exec(args)
  return m ? (MAC_APPS.get(m[1]) ?? m[1]) : null
}

/** The main process of an app (not one of its helpers). */
function isMainProcess(p: Proc, win: boolean): boolean {
  return win ? !/--type=/.test(p.args) : /\.app\/Contents\/MacOS\/[^/]+$/.test(p.args.split(' --')[0]) && !/--type=/.test(p.args)
}

const isTmux = (args: string) => /^-?(?:\S*\/)?tmux(?:\s|$)/.test(args)

/**
 * Where a process was started from: the first app among its ancestors (Terminal, Ghostty, Cursor…).
 * tmux servers are detached from the terminal, so a pane is traced to the client attached to its session.
 */
export function hostOf(pid: number, procs: Map<number, Proc>, tmux?: { paneSession: Map<number, string>; clients: Map<string, number> }, app_ = procApp): { host: string; via: SessionVia } {
  let child = pid
  let p = procs.get(pid)?.ppid
  for (let i = 0; p && p > 1 && i < 40; i++) {
    const proc = procs.get(p)
    if (!proc) break
    const app = app_(proc)
    if (app) return { host: app, via: AI_APPS[app] ? 'app' : IDE_HOSTS.has(app) ? 'ide' : 'terminal' }
    if (isTmux(proc.args)) {
      const session = tmux?.paneSession.get(child)
      const client = session !== undefined ? tmux?.clients.get(session) : undefined
      if (client) {
        const outer = hostOf(client, procs, undefined, app_)
        return { host: outer.host === 'unknown' ? 'tmux' : `${outer.host} · tmux`, via: 'terminal' }
      }
      return { host: 'tmux', via: 'terminal' }
    }
    child = p
    p = proc.ppid
  }
  return { host: 'unknown', via: 'terminal' }
}

async function tmuxMap(env?: NodeJS.ProcessEnv) {
  const [panes, clients] = await Promise.all([
    run('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}'], env),
    run('tmux', ['list-clients', '-F', '#{client_pid} #{session_name}'], env),
  ])
  const paneSession = new Map<number, string>()
  const clientOf = new Map<string, number>()
  for (const l of panes.stdout.split('\n')) { const m = /^(\d+) (.*)$/.exec(l); if (m) paneSession.set(Number(m[1]), m[2]) }
  for (const l of clients.stdout.split('\n')) { const m = /^(\d+) (.*)$/.exec(l); if (m && !clientOf.has(m[2])) clientOf.set(m[2], Number(m[1])) }
  return { paneSession, clients: clientOf }
}

// --- IDE chat ---------------------------------------------------------------------

export const IDE_IDLE_MS = 5 * 60_000

/**
 * A folder inside the system's temporary directory (or /tmp): throwaway repositories of test runs and scripts, whose
 * stub agents are not conversations worth keeping. macOS spells $TMPDIR both /var/folders/… and /private/var/folders/….
 */
export function inTempDir(cwd: string | null, tmp = tmpdir()): boolean {
  if (!cwd) return false
  const norm = (p: string) => { const s = p.replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? s.toLowerCase() : s }
  const roots = new Set([tmp, '/tmp', '/private/tmp'].flatMap((r) => {
    let real = r
    try { real = realpathSync(r) } catch { /* missing */ }
    return [r, real, real.replace(/^\/private(?=\/)/, '')]
  }).map(norm).filter(Boolean))
  const here = norm(cwd)
  return [...roots].some((r) => here === r || here.startsWith(`${r}/`))
}

function mtime(p: string): number {
  try { return statSync(p).mtimeMs } catch { return 0 }
}

function newest(dir: string): number {
  let t = mtime(dir)
  try { for (const f of readdirSync(dir)) t = Math.max(t, mtime(join(dir, f))) } catch { /* missing */ }
  return t
}

/** file:///Users/x/My%20App → /Users/x/My App (local folders only). */
export function folderOf(workspaceJson: string): string | null {
  try {
    const uri = (JSON.parse(workspaceJson) as { folder?: string }).folder
    if (!uri?.startsWith('file://')) return null
    const path = decodeURIComponent(uri.slice(7))
    // file:///c%3A/Users/x → c:/Users/x
    return /^\/[a-zA-Z]:/.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

export const appSupportDir = () => WIN ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')) : join(homedir(), 'Library', 'Application Support')

export function ideSessions(procs: Map<number, Proc>, now: number, support = appSupportDir(), win = WIN): LiveSession[] {
  const out: LiveSession[] = []
  const running = new Set([...procs.values()].filter((p) => isMainProcess(p, win)).map((p) => (win ? winAppOf(p.exe) : appOf(p.args))))
  for (const ide of EDITORS) {
    if (!ide.storage || !ide.ai || !running.has(ide.name)) continue
    const root = join(support, ide.storage, 'User', 'workspaceStorage')
    let dirs: string[] = []
    try { dirs = readdirSync(root) } catch { continue }
    for (const d of dirs) {
      const ws = join(root, d)
      const last = ide.chatOnly
        ? Math.max(newest(join(ws, 'chatSessions')), newest(join(ws, 'chatEditingSessions')))
        : Math.max(mtime(join(ws, 'state.vscdb')), mtime(join(ws, 'state.vscdb-wal')))
      if (!last || now - last > IDE_IDLE_MS) continue
      let folder: string | null = null
      try { folder = folderOf(readFileSync(join(ws, 'workspace.json'), 'utf8')) } catch { /* empty window */ }
      if (!folder || !existsSync(folder)) continue
      out.push({ key: `ide:${ide.name}:${folder}`, agent: ide.ai, host: ide.name, via: 'ide', inferred: true, cwd: folder, start: last })
    }
  }
  return out
}

// --- everything ---------------------------------------------------------------------

/** First arguments that mean "a helper of the agent", not a conversation. */
const HELPERS = new Set(['--chrome-native-host', 'mcp', 'mcp-server', 'daemon'])
const isHelper = (args: string) => args.split(/\s+/).slice(1, 3).some((a) => HELPERS.has(a))

export async function scanSessions(env?: NodeJS.ProcessEnv, now = Date.now()): Promise<LiveSession[]> {
  const ps = WIN
    ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PS], env)
    : await run('ps', ['-axww', '-o', 'pid=,ppid=,etime=,args='], env)
  // A failed scan must not look like "every agent stopped" (that would end every session).
  if (ps.code !== 0) throw new Error('process list failed')
  const procs = WIN ? parseWinPs(ps.stdout) : parsePs(ps.stdout)
  const sessions: LiveSession[] = []

  const agents: { proc: Proc; agent: string }[] = []
  const teammates: { proc: Proc; mate: NonNullable<ReturnType<typeof teammateOf>> }[] = []
  for (const proc of procs.values()) {
    if (proc.pid === process.pid || isHelper(proc.args) || /\/AnthropicClaude\//i.test(proc.exe)) continue
    const agent = agentOf(proc.exe, proc.args)
    if (agent) { agents.push({ proc, agent }); continue }
    const mate = teammateOf(proc.exe, proc.args)
    if (mate) teammates.push({ proc, mate })
  }
  // A direct child of the same agent is part of that session (wrappers, re-execs).
  const agentByPid = new Map(agents.map((a) => [a.proc.pid, a.agent]))
  const top = agents.filter(({ proc, agent }) => agentByPid.get(proc.ppid) !== agent)

  const needTmux = !WIN && [...top, ...teammates].some(({ proc }) => {
    for (let p = proc.ppid, i = 0; p > 1 && i < 40; i++) { const x = procs.get(p); if (!x) break; if (isTmux(x.args)) return true; p = x.ppid }
    return false
  })
  const tmux = needTmux ? await tmuxMap(env) : undefined

  const cwds = new Map<number, string>()
  // Windows has no lsof: the folder of a process is not readable from outside it.
  const cwdPids = [...top, ...teammates].map((a) => a.proc.pid)
  if (cwdPids.length && !WIN) {
    const lsof = await run('lsof', ['-a', '-d', 'cwd', '-p', cwdPids.join(','), '-Fpn'], env)
    let pid = 0
    for (const line of lsof.stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1))
      else if (line.startsWith('n')) cwds.set(pid, line.slice(1))
    }
  }

  // Codex keeps its session file open: the rollout records the folder it works in.
  const rollouts = new Map<number, string>()
  const codexPids = top.filter((a) => a.agent === 'codex').map((a) => a.proc.pid)
  if (codexPids.length && !WIN) {
    const open = await run('lsof', ['-p', codexPids.join(','), '-Fn'], env)
    let pid = 0
    for (const line of open.stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1))
      else if (line.startsWith('n') && /\/\.codex\/sessions\/.*\.jsonl$/.test(line)) rollouts.set(pid, line.slice(1))
    }
  }

  for (const { proc, agent } of top) {
    const { host, via } = hostOf(proc.pid, procs, tmux)
    // An agent inside a desktop AI app (Codex in ChatGPT) is that app's session, listed below.
    if (via === 'app') continue
    const start = Math.round((now - proc.elapsed * 1000) / 1000) * 1000
    let cwd = cwds.get(proc.pid) ?? null
    let state: SessionState | undefined
    let claude: Pick<LiveSession, 'sessionId' | 'subagents' | 'wrote' | 'before' | 'task' | 'glance'> = {}
    if (agent === 'claude') {
      const ctx = claudeContext(proc.pid)
      if (ctx?.cwd) cwd = ctx.cwd
      if (ctx?.wrote) claude.wrote = ctx.wrote
      if (ctx?.before.length) claude.before = ctx.before
      state = ctx?.state
      if (ctx?.sessionId) claude = { ...claude, sessionId: ctx.sessionId, subagents: ctx.transcript ? claudeSubagents(ctx.transcript, start) : [] }
      if (ctx?.transcript) claude = { ...claude, ...transcriptGlance(ctx.transcript, now) }
    } else if (rollouts.has(proc.pid)) {
      cwd = lastCwd(rollouts.get(proc.pid)!) ?? cwd
    }
    sessions.push({ key: `pid:${proc.pid}`, agent, host, via, inferred: false, cwd: cwd === '/' ? null : cwd, start, pid: proc.pid, state, ...claude })
  }

  for (const { proc, mate } of teammates) {
    const { host, via } = hostOf(proc.pid, procs, tmux)
    const cwd = cwds.get(proc.pid) ?? null
    sessions.push({
      key: `pid:${proc.pid}`, agent: 'claude', host, via, inferred: false, cwd: cwd === '/' ? null : cwd,
      start: Math.round((now - proc.elapsed * 1000) / 1000) * 1000, pid: proc.pid,
      parentSessionId: mate.parentSessionId, agentName: mate.name, agentType: mate.agentType,
    })
  }

  for (const proc of procs.values()) {
    const name = aiAppMain(proc, procs)
    if (!name) continue
    const start = Math.round((now - proc.elapsed * 1000) / 1000) * 1000
    sessions.push({ key: `app:${name}:${proc.pid}`, agent: AI_APPS[name], host: name, via: 'app', inferred: true, cwd: null, start, pid: proc.pid })
  }

  sessions.push(...ideSessions(procs, now))
  return sessions
}

/** Name of the desktop AI app whose main process this is, or null (helpers and crash handlers are not). */
export function aiAppMain(proc: Proc, procs: Map<number, Proc>, win = WIN): string | null {
  if (!win) {
    const m = /^(?:\/Applications|\/Users\/[^/]+\/Applications)\/([^/]+)\.app\/Contents\/MacOS\/([^/]+)$/.exec(proc.args)
    if (!m || m[1].toLowerCase() !== m[2].toLowerCase()) return null
    const app = MAC_APPS.get(m[1])
    return app && AI_APPS[app] ? app : null
  }
  const app = winAppOf(proc.exe)
  if (!app || !AI_APPS[app] || /--type=/.test(proc.args)) return null
  const parent = procs.get(proc.ppid)
  return parent && winAppOf(parent.exe) === app ? null : app
}

// --- where an agent really works -------------------------------------------------------
// An agent started in ~ that then works in ~/code/shop has its process cwd in ~. The agents' own
// session files say where each conversation is: read them (locally, read-only) to find the project.

/**
 * Where a session works, from where its shell is (`cwd`), where it last edited files (`wrote`) and the folders it was
 * in before (`before`, newest first), each already resolved to a repository and worktree.
 * A `cd` from a worktree back to its repository's main checkout, to read or run something there, does not move the
 * session: it stays on the worktree's branch, unless it also edits the main checkout. A session whose shell is outside
 * any repository but edits in one belongs to it. Anything else follows the shell, so moving on to work elsewhere
 * still moves it.
 */
export function workPlace<T extends { repo: string | null; worktree: string | null }>(cwd: T, wrote: T | null, before: T[] = []): T {
  if (!cwd.repo) return wrote?.repo && wrote.worktree ? wrote : cwd
  const same = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
  const inRepo = (p: T | null | undefined): p is T => !!p?.repo && !!p.worktree && same(p.repo, cwd.repo!)
  const inMain = (p: T) => same(p.worktree!, p.repo!)
  if (!cwd.worktree || !inMain(cwd)) return cwd
  if (inRepo(wrote)) return inMain(wrote) ? cwd : wrote
  const back = before.find((p) => !!p.repo && same(p.repo, cwd.repo!))
  return inRepo(back) && !inMain(back) ? back : cwd
}

/**
 * Caches that live as long as the app: one entry per transcript, session or subagent ever seen. A Map keeps the
 * order things went in, so past the cap the oldest go first.
 */
export function remember<K, V>(map: Map<K, V>, key: K, value: V, max = 500): void {
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) { if (map.size <= max) break; map.delete(old) }
}

/**
 * Where a transcript leaves its session: the last "cwd", the folders it was in before that (newest first, each once,
 * at most BEFORE) and the folder of the last file its edit tools wrote (Claude Code).
 */
export type Place = { cwd: string | null; before: string[]; wrote: string | null }
/** Per transcript: how far it was read (just past its last complete line) and where that left the session. */
const placeCache = new Map<string, { end: number; place: Place }>()
const CHUNK = 1024 * 1024
const MAX_BACK = 32 * 1024 * 1024
/** Enough of the trail to look past a `cd` or two; reading back stops looking for more after TRAIL_BACK. */
const BEFORE = 4
const TRAIL_BACK = 4 * 1024 * 1024

/** Last "cwd" recorded in a JSONL transcript. */
export function lastCwd(file: string): string | null {
  return lastPlace(file).cwd
}

/**
 * Where a transcript leaves its session (see Place). The first look reads back from the end, a chunk at a time, until
 * it has what it needs (at most MAX_BACK): in a long conversation the last edit can be megabytes back. After that only
 * what was appended is read, so a transcript is never read twice and a scan every few seconds costs its new lines.
 */
export function lastPlace(file: string): Place {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const hit = placeCache.get(file)
    if (hit?.end === size) return hit.place
    // Grown: read the new lines. Shorter than before: rewritten, start over.
    const next = hit && size > hit.end ? readForward(fd, hit.end, size, hit.place) : readBack(fd, size)
    remember(placeCache, file, next)
    return next.place
  } catch { return { cwd: null, before: [], wrote: null } } finally { if (fd !== null) closeSync(fd) }
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
/** The folder of the last file an edit tool wrote in a Claude Code transcript line, or null. */
function wroteIn(entry: { type?: unknown; message?: { content?: unknown } }): string | null {
  if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) return null
  for (let i = entry.message.content.length - 1; i >= 0; i--) {
    const c = entry.message.content[i] as { type?: unknown; name?: unknown; input?: { file_path?: unknown; notebook_path?: unknown } }
    if (c?.type !== 'tool_use' || typeof c.name !== 'string' || !EDIT_TOOLS.has(c.name)) continue
    const path = typeof c.input?.file_path === 'string' ? c.input.file_path : typeof c.input?.notebook_path === 'string' ? c.input.notebook_path : null
    if (path && isAbsolute(path)) return dirname(path)
  }
  return null
}

/** What one transcript line says: its "cwd" and the folder an edit tool in it wrote. Text quoted in a message never counts. */
function parseLine(line: string, wantCwd: boolean, wantEdit: boolean): { cwd: string | null; wrote: string | null } | null {
  wantCwd &&= line.includes('"cwd"')
  wantEdit &&= line.includes('"tool_use"')
  if (!wantCwd && !wantEdit) return null
  try {
    const entry = JSON.parse(line) as { cwd?: unknown; type?: unknown; payload?: { cwd?: unknown }; message?: { content?: unknown } }
    // Top-level field (Claude Code) or the payload of a turn (Codex).
    const cwd = !wantCwd ? null : typeof entry.cwd === 'string' ? entry.cwd : typeof entry.payload?.cwd === 'string' ? entry.payload.cwd : null
    return { cwd, wrote: wantEdit ? wroteIn(entry) : null }
  } catch { return null /* not JSON, or a line still being written */ }
}

function readAt(fd: number, from: number, to: number): Buffer {
  const buf = Buffer.alloc(to - from)
  readSync(fd, buf, 0, buf.length, from)
  return buf
}

/** The lines appended since `from`, oldest first. A last line without its newline yet is left for the next read. */
function readForward(fd: number, from: number, to: number, prev: Place): { end: number; place: Place } {
  const buf = readAt(fd, from, to)
  const nl = buf.lastIndexOf(10)
  if (nl < 0) return { end: from, place: prev }
  const place: Place = { cwd: prev.cwd, before: [...prev.before], wrote: prev.wrote }
  for (const line of buf.subarray(0, nl).toString('utf8').split('\n')) {
    const got = parseLine(line, true, true)
    if (!got) continue
    if (got.cwd && got.cwd !== place.cwd) {
      if (place.cwd) place.before = [place.cwd, ...place.before.filter((p) => p !== place.cwd && p !== got.cwd)].slice(0, BEFORE)
      place.cwd = got.cwd
    }
    if (got.wrote) place.wrote = got.wrote
  }
  return { end: from + nl + 1, place }
}

/** From the end backwards, a chunk at a time, until it has what it needs, the file starts or MAX_BACK is read. */
function readBack(fd: number, size: number): { end: number; place: Place } {
  const place: Place = { cwd: null, before: [], wrote: null }
  const enough = (read: number) => !!place.cwd && !!place.wrote && (place.before.length >= BEFORE || read >= TRAIL_BACK)
  let end = 0
  let pos = size
  let carry = Buffer.alloc(0)
  let last = true
  while (pos > 0 && size - pos < MAX_BACK && !enough(size - pos)) {
    const start = Math.max(0, pos - CHUNK)
    let data = Buffer.concat([readAt(fd, start, pos), carry])
    if (last) {
      // Lines are only read whole: a last one still being written waits for the next read.
      const nl = data.lastIndexOf(10)
      end = nl < 0 ? start : start + nl + 1
      data = data.subarray(0, Math.max(0, nl))
      last = false
    }
    // The first line of a chunk may start in the chunk before: it is kept and read with that one.
    const cut = start === 0 ? -1 : data.indexOf(10)
    carry = start === 0 ? Buffer.alloc(0) : data.subarray(0, cut < 0 ? data.length : cut)
    const lines = start > 0 && cut < 0 ? [] : data.subarray(cut + 1).toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const trail = size - pos < TRAIL_BACK && place.before.length < BEFORE
      const got = parseLine(lines[i], !place.cwd || trail, !place.wrote)
      if (!got) continue
      if (got.cwd && !place.cwd) place.cwd = got.cwd
      else if (got.cwd && got.cwd !== place.cwd && !place.before.includes(got.cwd) && place.before.length < BEFORE) place.before.push(got.cwd)
      if (got.wrote && !place.wrote) place.wrote = got.wrote
    }
    pos = start
  }
  return { end, place }
}

/**
 * What a Claude Code transcript says about its session, for its card: the task (the first thing the user asked, read
 * from the head of the file) and, from its lines, the last tool used, the files edited and the replies per five
 * minutes of the last hour. The first look reads up to GLANCE_BACK from the end; after that only the new lines.
 */
type GlanceState = { end: number; task: string | null; action: SessionGlance['action']; files: Set<string>; times: number[] }
const glanceCache = new Map<string, GlanceState>()
const GLANCE_BACK = 16 * 1024 * 1024
const TASK_HEAD = 512 * 1024
const HOUR = 3_600_000
const PULSE = 12

/** The text of a user's request, or null for tool results, commands, reminders and other lines the app writes. */
function requestIn(entry: { type?: unknown; isMeta?: unknown; message?: { content?: unknown } }): string | null {
  if (entry.type !== 'user' || entry.isMeta) return null
  const c = entry.message?.content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { type?: unknown; text?: unknown }) => (x?.type === 'text' && typeof x.text === 'string' ? x.text : '')).join(' ') : ''
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean || clean.startsWith('<') || clean.startsWith('Caveat:') || clean.startsWith('[Request interrupted')) return null
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean
}

/** What a tool call works on, short: a file's name, the first line of a command, a pattern, a query. */
function targetOf(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null
  const str = (k: string) => (typeof input[k] === 'string' && (input[k] as string).trim() ? (input[k] as string).trim() : null)
  const file = str('file_path') ?? str('notebook_path') ?? str('path')
  if (file) return basename(file)
  const text = str('command') ?? str('pattern') ?? str('query') ?? str('url') ?? str('description') ?? str('subagent_type')
  if (!text) return null
  const line = text.split('\n')[0]
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

function readGlanceLines(g: GlanceState, text: string) {
  for (const line of text.split('\n')) {
    if (!line.includes('"assistant"')) continue
    let entry: { type?: unknown; timestamp?: unknown; message?: { content?: unknown } }
    try { entry = JSON.parse(line) } catch { continue }
    if (entry.type !== 'assistant') continue
    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    if (!Number.isNaN(at)) g.times.push(at)
    if (!Array.isArray(entry.message?.content)) continue
    for (const c of entry.message.content as { type?: unknown; name?: unknown; input?: Record<string, unknown> }[]) {
      if (c?.type !== 'tool_use' || typeof c.name !== 'string') continue
      g.action = { tool: c.name, target: targetOf(c.input), at: Number.isNaN(at) ? 0 : at }
      const path = typeof c.input?.file_path === 'string' ? c.input.file_path : typeof c.input?.notebook_path === 'string' ? c.input.notebook_path : null
      if (EDIT_TOOLS.has(c.name) && path) g.files.add(path)
    }
  }
}

export function transcriptGlance(file: string, now = Date.now()): { task: string | null; glance: SessionGlance } {
  let fd: number | null = null
  let g = glanceCache.get(file)
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    if (!g || size < g.end) {
      g = { end: 0, task: null, action: null, files: new Set(), times: [] }
      // The task: the first request in the head of the file.
      for (const line of readAt(fd, 0, Math.min(size, TASK_HEAD)).toString('utf8').split('\n')) {
        if (!line.includes('"user"')) continue
        try { g.task = requestIn(JSON.parse(line)) } catch { continue }
        if (g.task) break
      }
      g.end = Math.max(0, size - GLANCE_BACK)
      // Started mid-file: the first line is cut, skip it.
      if (g.end > 0) { const nl = readAt(fd, g.end, Math.min(size, g.end + CHUNK)).indexOf(10); g.end = nl < 0 ? size : g.end + nl + 1 }
    }
    if (size > g.end) {
      const buf = readAt(fd, g.end, size)
      const nl = buf.lastIndexOf(10)
      if (nl >= 0) { readGlanceLines(g, buf.subarray(0, nl).toString('utf8')); g.end += nl + 1 }
    }
    g.times = g.times.filter((t) => t > now - HOUR)
    remember(glanceCache, file, g)
  } catch { /* unreadable: what was known */ } finally { if (fd !== null) closeSync(fd) }
  const pulse = new Array<number>(PULSE).fill(0)
  for (const t of g?.times ?? []) pulse[Math.min(PULSE - 1, Math.max(0, Math.floor((t - (now - HOUR)) / (HOUR / PULSE))))]++
  return { task: g?.task ?? null, glance: { action: g?.action ?? null, files: g?.files.size ?? 0, pulse } }
}

const transcriptCache = new Map<string, string>()
const missingSince = new Map<string, number>()
/** Claude Code: ~/.claude/sessions/<pid>.json → session id and status → its transcript and that transcript's latest cwd. */
export function claudeContext(pid: number, home = homedir()): { cwd: string | null; before: string[]; wrote: string | null; state?: SessionState; sessionId?: string; transcript?: string } | null {
  let info: { sessionId?: string; status?: string; cwd?: string }
  try { info = JSON.parse(readFileSync(join(home, '.claude', 'sessions', `${pid}.json`), 'utf8')) } catch { return null }
  // A session id names a file in ~/.claude/projects: anything with path parts would read from elsewhere.
  if (typeof info.sessionId !== 'string' || !/^[\w-]+$/.test(info.sessionId)) info.sessionId = undefined
  const state: SessionState | undefined = info.status === 'busy' ? 'working' : info.status === 'idle' ? 'idle' : info.status === 'waiting' ? 'waiting' : undefined
  let place: Place = { cwd: null, before: [], wrote: null }
  let file: string | undefined
  if (info.sessionId) {
    file = transcriptCache.get(info.sessionId)
    const missing = missingSince.get(info.sessionId)
    // A brand-new session has no transcript yet: look again at most every 30 s, not on every scan.
    if ((!file || !existsSync(file)) && !(missing && Date.now() - missing < 30_000)) {
      const root = join(home, '.claude', 'projects')
      try {
        for (const d of readdirSync(root)) {
          const f = join(root, d, `${info.sessionId}.jsonl`)
          if (existsSync(f)) { file = f; remember(transcriptCache, info.sessionId, f); break }
        }
      } catch { /* no projects */ }
      if (file && existsSync(file)) missingSince.delete(info.sessionId)
      else remember(missingSince, info.sessionId, Date.now())
    }
    if (file) place = lastPlace(file)
  }
  return { cwd: place.cwd ?? info.cwd ?? null, before: place.before, wrote: place.wrote, state, sessionId: info.sessionId, transcript: file }
}

/**
 * A Claude Code teammate in a pane of its own (agent teams, split panes): the versioned binary, started with the
 * lead's conversation id. Its process name is the version, not "claude", so agentOf does not see it.
 */
export function teammateOf(exe: string, args: string): { name: string; parentSessionId: string; agentType: string | null } | null {
  if (!/\/claude\/versions\/[^/]+$/.test(exe)) return null
  const arg = (flag: string) => new RegExp(`(?:^|\\s)${flag}\\s+(\\S+)`).exec(args)?.[1] ?? null
  const parentSessionId = arg('--parent-session-id')
  const name = arg('--agent-name')
  return parentSessionId && name ? { name, parentSessionId, agentType: arg('--agent-type') } : null
}

const metaCache = new Map<string, { mtime: number; meta: { finished?: unknown; agentType?: unknown; description?: unknown } | null }>()
/**
 * Subagents of a Claude Code session in the middle of a turn. Each one keeps <transcript>/subagents/agent-<id>.meta.json,
 * whose `finished` is true between its turns and absent while it works. Files older than `since` (the session's start)
 * belong to an earlier run of a resumed conversation, which may have stopped mid-turn.
 */
export function claudeSubagents(transcript: string, since = 0): Subagent[] {
  const dir = join(transcript.replace(/\.jsonl$/, ''), 'subagents')
  let names: string[]
  try { names = readdirSync(dir).filter((f) => /^agent-[\w-]+\.meta\.json$/.test(f)) } catch { return [] }
  const out: Subagent[] = []
  for (const name of names) {
    const file = join(dir, name)
    const mtime = (() => { try { return statSync(file).mtimeMs } catch { return 0 } })()
    if (!mtime || mtime < since) continue
    let hit = metaCache.get(file)
    if (hit?.mtime !== mtime) {
      try { hit = { mtime, meta: JSON.parse(readFileSync(file, 'utf8')) } } catch { hit = { mtime, meta: null } }
      remember(metaCache, file, hit)
    }
    const meta = hit.meta
    if (!meta || meta.finished === true) continue
    const id = name.slice('agent-'.length, -'.meta.json'.length)
    out.push({
      id, agentType: typeof meta.agentType === 'string' ? meta.agentType : 'agent',
      description: typeof meta.description === 'string' ? meta.description : '', cwd: lastCwd(join(dir, `agent-${id}.jsonl`)),
    })
  }
  return out
}

// --- Codex threads --------------------------------------------------------------------
// The ChatGPT app runs Codex in-process: its threads (and the subagents they spawn) are only in Codex's state
// database. Read it read-only, with the SQLite built into Node (loaded at run time: hosts without it read nothing).

export interface CodexThread { id: string; cwd: string; branch: string | null; name: string | null; parentId: string | null; updatedAt: number }

interface SqliteDb { prepare(sql: string): { all(...params: unknown[]): unknown[] }; close(): void }
const sqlite = () => (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:sqlite') as
  { DatabaseSync: new (path: string, opts: { readOnly: boolean }) => SqliteDb } | undefined

/** Codex threads changed since `since` (ms), newest first: folder, branch, nickname or role, and the thread that spawned it. */
export function codexThreads(since: number, home = homedir(), file = join(home, '.codex', 'state_5.sqlite')): CodexThread[] {
  const mod = sqlite()
  if (!mod || !existsSync(file)) return []
  let db: SqliteDb | null = null
  try {
    db = new mod.DatabaseSync(file, { readOnly: true })
    const rows = db.prepare(`
      select t.id as id, t.cwd as cwd, t.git_branch as branch, coalesce(t.agent_nickname, t.agent_role) as name,
             e.parent_thread_id as parentId, coalesce(t.updated_at_ms, t.updated_at * 1000) as updatedAt
      from threads t left join thread_spawn_edges e on e.child_thread_id = t.id
      where t.archived = 0 and coalesce(t.updated_at_ms, t.updated_at * 1000) >= ?
      order by updatedAt desc limit 20`).all(since) as CodexThread[]
    return rows.map((r) => ({ id: String(r.id), cwd: String(r.cwd), branch: r.branch ?? null, name: r.name ?? null, parentId: r.parentId ?? null, updatedAt: Number(r.updatedAt) }))
  } catch {
    // Locked, or a schema of another Codex version: nothing rather than an error on every scan.
    return []
  } finally { db?.close() }
}

// --- history ------------------------------------------------------------------------

export interface Resolved { repo: string | null; branch: string | null; github: string | null }

/**
 * A finished session that the scan still sees was closed by the user: a session that ends on its own
 * is gone from the scan (its process exited, or its IDE chat went quiet until newer activity).
 */
function closedByUser(prev: AgentSession | undefined, l: LiveSession): boolean {
  if (!prev || prev.end === null) return false
  return l.via === 'ide' ? l.start <= prev.end : Math.abs(prev.start - l.start) <= 5000
}

/** Active means doing something: a session idle at its prompt is open, not running. */
export const isActive = (s: AgentSession) => s.end === null && s.state !== 'idle'

/** Keeps the history: opens a session when it appears, closes it when it is gone. */
export class SessionLog {
  sessions: AgentSession[]
  private open = new Map<string, AgentSession>()
  /** Sessions open when the app last stopped: resumed if the first scan still sees them. */
  private resumable: Map<string, AgentSession> | null = new Map()
  /** Keys in the last scan: a closed session whose process still runs is what keeps it from opening again. */
  private live = new Set<string>()

  constructor(saved: AgentSession[] = [], now = Date.now()) {
    // Until proven otherwise, they ended when they were last seen.
    this.sessions = saved.map((s) => {
      if (s.end !== null) return s
      const closed = { ...s, end: Math.min(s.lastSeen, now) }
      delete closed.glance
      delete closed.attention
      if (s.key) this.resumable!.set(s.key, closed)
      return closed
    })
  }

  /** Apply one scan. Returns what changed, so the caller can persist and notify. */
  update(live: (LiveSession & Resolved)[], now = Date.now()): { started: AgentSession[]; ended: AgentSession[] } {
    const started: AgentSession[] = []
    const ended: AgentSession[] = []
    const seen = new Set<string>()
    // Latest finished session per key: one the user closed stays closed while it is the same process.
    const closed = new Map<string, AgentSession>()
    for (const s of this.sessions) if (s.end !== null && s.key && (closed.get(s.key)?.start ?? -1) < s.start) closed.set(s.key, s)
    for (const l of live) {
      seen.add(l.key)
      const lastSeen = l.via === 'ide' ? Math.max(l.start, this.open.get(l.key)?.lastSeen ?? 0) : now
      // ps reports elapsed seconds, so the start of one process wobbles by a second between scans;
      // a different start means the pid was reused by a new process.
      const same = (s: AgentSession) => l.via === 'ide' || Math.abs(s.start - l.start) <= 5000
      const back = this.resumable?.get(l.key)
      if (back && same(back)) { back.end = null; this.open.set(l.key, back) }
      let cur = this.open.get(l.key)
      if (!cur && !(back && same(back)) && closedByUser(closed.get(l.key), l)) continue
      if (cur && !same(cur)) { cur.end = now; ended.push(cur); this.open.delete(l.key); cur = undefined }
      if (cur) {
        cur.lastSeen = lastSeen
        // A conversation can move to another project: keep where it is now, and what it is doing.
        if (l.cwd && (l.cwd !== cur.cwd || l.repo !== cur.repo)) Object.assign(cur, { cwd: l.cwd, repo: l.repo, branch: l.branch, github: l.github })
        else if (l.repo && l.branch !== cur.branch) cur.branch = l.branch
        cur.state = l.state
        if (l.task) cur.task = l.task
        if (l.glance) cur.glance = l.glance
        continue
      }
      const s: AgentSession = {
        id: `${l.key}:${l.start}`, key: l.key, agent: l.agent, host: l.host, via: l.via, inferred: l.inferred,
        cwd: l.cwd, repo: l.repo, branch: l.branch, github: l.github, start: l.start, end: null, lastSeen, state: l.state,
        ...(l.task ? { task: l.task } : {}), ...(l.glance ? { glance: l.glance } : {}),
      }
      this.open.set(l.key, s)
      this.sessions.push(s)
      started.push(s)
    }
    this.resumable = null
    this.live = seen
    for (const [key, s] of this.open) {
      if (seen.has(key)) continue
      s.end = s.via === 'ide' ? s.lastSeen : now
      delete s.state
      delete s.glance
      delete s.attention
      this.open.delete(key)
      ended.push(s)
    }
    return { started, ended }
  }

  /**
   * The user closes a session that is still open (a conversation left in a terminal tab): it ends now and
   * the scans do not bring it back while the same process (or, in an IDE, no newer chat activity) is there.
   */
  close(id: string, now = Date.now()): AgentSession | null {
    const s = this.sessions.find((x) => x.id === id && x.end === null)
    if (!s) return null
    s.end = now
    delete s.state
    delete s.glance
    delete s.attention
    if (s.key) this.open.delete(s.key)
    return s
  }

  /** Forget every finished session (the ones still running stay, and the last one the user closed of a process still running). */
  clear() {
    // The last closed session of a process still running stays too: without it the next scan opens it again.
    const keep = new Map<string, AgentSession>()
    for (const s of this.sessions) {
      if (s.end !== null && s.key && this.live.has(s.key) && (keep.get(s.key)?.start ?? -1) < s.start) keep.set(s.key, s)
    }
    this.sessions = this.sessions.filter((s) => s.end === null || (s.key && keep.get(s.key) === s))
  }

  /** Newest first, capped. */
  list(limit = 5000): AgentSession[] {
    return [...this.sessions].sort((a, b) => b.start - a.start).slice(0, limit)
  }

  /** Forget finished sessions older than `days` (0 keeps them) and beyond the newest `keep`. */
  prune(keep = 5000, days = 0, now = Date.now()) {
    if (days > 0) {
      const cutoff = now - days * 86400_000
      this.sessions = this.sessions.filter((s) => s.end === null || s.end >= cutoff)
    }
    if (this.sessions.length <= keep) return
    const drop = new Set(this.list(this.sessions.length).slice(keep).filter((s) => s.end !== null))
    this.sessions = this.sessions.filter((s) => !drop.has(s))
  }
}

// --- export ---------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  // Text that starts like a formula (a branch named =HYPERLINK(…)) would run in a spreadsheet: keep it text.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function sessionsCsv(sessions: AgentSession[], now = Date.now()): string {
  const head = ['agent', 'host', 'via', 'inferred', 'repo', 'branch', 'github', 'pull_request', 'folder', 'start', 'end', 'minutes']
  const rows = sessions.map((s) => [
    s.agent, s.host, s.via, s.inferred, s.repo, s.branch, s.github, s.pr?.url ?? '', s.cwd,
    new Date(s.start).toISOString(), s.end ? new Date(s.end).toISOString() : '',
    Math.round(((s.end ?? now) - s.start) / 60_000),
  ])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}
