import { execFile } from 'node:child_process'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AI_APP_LIST, EDITORS, TERMINALS } from './catalog.ts'
import { agentOf } from './projects.ts'
import type { AgentSession, SessionState, SessionVia } from './types.ts'

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
  start: number
  pid?: number
  /** What the agent is doing, when it says so (Claude Code does). */
  state?: SessionState
}

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

export function parsePs(stdout: string): Map<number, Proc> {
  const procs = new Map<number, Proc>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), elapsed: parseEtime(m[3]), exe: m[4].split(/\s+/)[0], args: m[4] })
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
  for (const proc of procs.values()) {
    if (proc.pid === process.pid || isHelper(proc.args) || /\/AnthropicClaude\//i.test(proc.exe)) continue
    const agent = agentOf(proc.exe, proc.args)
    if (agent) agents.push({ proc, agent })
  }
  // A direct child of the same agent is part of that session (wrappers, re-execs).
  const agentByPid = new Map(agents.map((a) => [a.proc.pid, a.agent]))
  const top = agents.filter(({ proc, agent }) => agentByPid.get(proc.ppid) !== agent)

  const needTmux = !WIN && top.some(({ proc }) => {
    for (let p = proc.ppid, i = 0; p > 1 && i < 40; i++) { const x = procs.get(p); if (!x) break; if (isTmux(x.args)) return true; p = x.ppid }
    return false
  })
  const tmux = needTmux ? await tmuxMap(env) : undefined

  const cwds = new Map<number, string>()
  // Windows has no lsof: the folder of a process is not readable from outside it.
  if (top.length && !WIN) {
    const lsof = await run('lsof', ['-a', '-d', 'cwd', '-p', top.map((a) => a.proc.pid).join(','), '-Fpn'], env)
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
    if (agent === 'claude') {
      const ctx = claudeContext(proc.pid)
      if (ctx?.cwd) cwd = ctx.cwd
      state = ctx?.state
    } else if (rollouts.has(proc.pid)) {
      cwd = lastCwd(rollouts.get(proc.pid)!) ?? cwd
    }
    sessions.push({ key: `pid:${proc.pid}`, agent, host, via, inferred: false, cwd: cwd === '/' ? null : cwd, start, pid: proc.pid, state })
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

/** Last "cwd" recorded in a JSONL transcript (reads only its tail). */
export function lastCwd(file: string, bytes = 256 * 1024): string | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    // The first line may be cut by the window: skip it unless the file is read whole.
    for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
      if (!lines[i].includes('"cwd"')) continue
      try {
        const entry = JSON.parse(lines[i]) as { cwd?: unknown; payload?: { cwd?: unknown } }
        // Top-level field (Claude Code) or the payload of a turn (Codex), never text quoted inside a message.
        const cwd = typeof entry.cwd === 'string' ? entry.cwd : typeof entry.payload?.cwd === 'string' ? entry.payload.cwd : null
        if (cwd) return cwd
      } catch { /* not JSON */ }
    }
  } catch { /* unreadable */ } finally { if (fd !== null) closeSync(fd) }
  return null
}

const transcriptCache = new Map<string, string>()
/** Claude Code: ~/.claude/sessions/<pid>.json → session id and status → its transcript's latest cwd. */
export function claudeContext(pid: number, home = homedir()): { cwd: string | null; state?: SessionState } | null {
  let info: { sessionId?: string; status?: string; cwd?: string }
  try { info = JSON.parse(readFileSync(join(home, '.claude', 'sessions', `${pid}.json`), 'utf8')) } catch { return null }
  const state: SessionState | undefined = info.status === 'busy' ? 'working' : info.status === 'idle' ? 'idle' : info.status === 'waiting' ? 'waiting' : undefined
  let cwd: string | null = null
  if (info.sessionId) {
    let file = transcriptCache.get(info.sessionId)
    if (!file || !existsSync(file)) {
      const root = join(home, '.claude', 'projects')
      try {
        for (const d of readdirSync(root)) {
          const f = join(root, d, `${info.sessionId}.jsonl`)
          if (existsSync(f)) { file = f; transcriptCache.set(info.sessionId, f); break }
        }
      } catch { /* no projects */ }
    }
    if (file) cwd = lastCwd(file)
  }
  return { cwd: cwd ?? info.cwd ?? null, state }
}

// --- history ------------------------------------------------------------------------

export interface Resolved { repo: string | null; branch: string | null; github: string | null }

/** Keeps the history: opens a session when it appears, closes it when it is gone. */
export class SessionLog {
  sessions: AgentSession[]
  private open = new Map<string, AgentSession>()
  /** Sessions open when the app last stopped: resumed if the first scan still sees them. */
  private resumable: Map<string, AgentSession> | null = new Map()

  constructor(saved: AgentSession[] = [], now = Date.now()) {
    // Until proven otherwise, they ended when they were last seen.
    this.sessions = saved.map((s) => {
      if (s.end !== null) return s
      const closed = { ...s, end: Math.min(s.lastSeen, now) }
      if (s.key) this.resumable!.set(s.key, closed)
      return closed
    })
  }

  /** Apply one scan. Returns what changed, so the caller can persist and notify. */
  update(live: (LiveSession & Resolved)[], now = Date.now()): { started: AgentSession[]; ended: AgentSession[] } {
    const started: AgentSession[] = []
    const ended: AgentSession[] = []
    const seen = new Set<string>()
    for (const l of live) {
      seen.add(l.key)
      const lastSeen = l.via === 'ide' ? Math.max(l.start, this.open.get(l.key)?.lastSeen ?? 0) : now
      // ps reports elapsed seconds, so the start of one process wobbles by a second between scans;
      // a different start means the pid was reused by a new process.
      const same = (s: AgentSession) => l.via === 'ide' || Math.abs(s.start - l.start) <= 5000
      const back = this.resumable?.get(l.key)
      if (back && same(back)) { back.end = null; this.open.set(l.key, back) }
      let cur = this.open.get(l.key)
      if (cur && !same(cur)) { cur.end = now; ended.push(cur); this.open.delete(l.key); cur = undefined }
      if (cur) {
        cur.lastSeen = lastSeen
        // A conversation can move to another project: keep where it is now, and what it is doing.
        if (l.cwd && (l.cwd !== cur.cwd || l.repo !== cur.repo)) Object.assign(cur, { cwd: l.cwd, repo: l.repo, branch: l.branch, github: l.github })
        else if (l.repo && l.branch !== cur.branch) cur.branch = l.branch
        cur.state = l.state
        continue
      }
      const s: AgentSession = {
        id: `${l.key}:${l.start}`, key: l.key, agent: l.agent, host: l.host, via: l.via, inferred: l.inferred,
        cwd: l.cwd, repo: l.repo, branch: l.branch, github: l.github, start: l.start, end: null, lastSeen, state: l.state,
      }
      this.open.set(l.key, s)
      this.sessions.push(s)
      started.push(s)
    }
    this.resumable = null
    for (const [key, s] of this.open) {
      if (seen.has(key)) continue
      s.end = s.via === 'ide' ? s.lastSeen : now
      delete s.state
      this.open.delete(key)
      ended.push(s)
    }
    return { started, ended }
  }

  /** Newest first, capped. */
  list(limit = 5000): AgentSession[] {
    return [...this.sessions].sort((a, b) => b.start - a.start).slice(0, limit)
  }

  prune(keep = 5000) {
    if (this.sessions.length <= keep) return
    const drop = new Set(this.list(this.sessions.length).slice(keep).filter((s) => s.end !== null))
    this.sessions = this.sessions.filter((s) => !drop.has(s))
  }
}

// --- export ---------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
