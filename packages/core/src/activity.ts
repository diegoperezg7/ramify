import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentOf } from './projects.ts'
import type { AgentSession, SessionVia } from './types.ts'

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

const WIN_APPS: Record<string, string> = {
  windowsterminal: 'Windows Terminal', code: 'VS Code', cursor: 'Cursor', windsurf: 'Windsurf', chatgpt: 'ChatGPT',
  idea64: 'IntelliJ IDEA', pycharm64: 'PyCharm', webstorm64: 'WebStorm', studio64: 'Android Studio', zed: 'Zed',
  'wezterm-gui': 'WezTerm', alacritty: 'Alacritty', tabby: 'Tabby', hyper: 'Hyper', mintty: 'Git Bash', conemu64: 'ConEmu', warp: 'Warp',
}

/** The Windows app an executable belongs to, or null. */
export function winAppOf(exe: string): string | null {
  if (/\/AnthropicClaude\//i.test(exe)) return 'Claude'
  const name = (exe.split('/').pop() ?? '').replace(/\.exe$/i, '').toLowerCase()
  return WIN_APPS[name] ?? null
}

const procApp = (p: Proc) => (WIN ? winAppOf(p.exe) : appOf(p.args))

const APP_NAMES: Record<string, string> = {
  'Visual Studio Code': 'VS Code', 'Visual Studio Code - Insiders': 'VS Code', iTerm2: 'iTerm', iTerm: 'iTerm',
}
export const IDE_HOSTS = new Set(['VS Code', 'Cursor', 'Windsurf', 'Zed', 'Xcode', 'IntelliJ IDEA', 'PyCharm', 'WebStorm', 'Android Studio', 'Fleet'])
export const AI_APPS: Record<string, string> = { ChatGPT: 'chatgpt', Claude: 'claude-app', Perplexity: 'perplexity' }

/** The macOS app a command line belongs to (the outermost X.app in its path), or null. */
export function appOf(args: string): string | null {
  const m = /\/([^/]+?)\.app\/Contents\//.exec(args)
  return m ? (APP_NAMES[m[1]] ?? m[1]) : null
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

interface IdeSpec { host: string; agent: string; storage: string; exe: RegExp; winExe: RegExp; chatOnly: boolean }
const IDES: IdeSpec[] = [
  // Cursor's AI is built in: any recent activity in a workspace counts.
  { host: 'Cursor', agent: 'cursor', storage: 'Cursor', exe: /\/Cursor\.app\/Contents\/MacOS\/Cursor$/, winExe: /\/Cursor\.exe$/i, chatOnly: false },
  { host: 'Windsurf', agent: 'windsurf', storage: 'Windsurf', exe: /\/Windsurf\.app\/Contents\/MacOS\/(Electron|Windsurf)$/, winExe: /\/Windsurf\.exe$/i, chatOnly: false },
  // VS Code: only when its chat (Copilot and friends) has been written to.
  { host: 'VS Code', agent: 'copilot', storage: 'Code', exe: /\/Visual Studio Code\.app\/Contents\/MacOS\/(Electron|Code)$/, winExe: /\/Code\.exe$/i, chatOnly: true },
]
/** A workspace counts as in use while its storage changed within this window. */
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
  for (const ide of IDES) {
    if (![...procs.values()].some((p) => (win ? ide.winExe.test(p.exe) : ide.exe.test(p.args)))) continue
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
      out.push({ key: `ide:${ide.host}:${folder}`, agent: ide.agent, host: ide.host, via: 'ide', inferred: true, cwd: folder, start: last })
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

  for (const { proc, agent } of top) {
    const { host, via } = hostOf(proc.pid, procs, tmux)
    // An agent inside a desktop AI app (Codex in ChatGPT) is that app's session, listed below.
    if (via === 'app') continue
    const start = Math.round((now - proc.elapsed * 1000) / 1000) * 1000
    const cwd = cwds.get(proc.pid) ?? null
    sessions.push({ key: `pid:${proc.pid}`, agent, host, via, inferred: false, cwd: cwd === '/' ? null : cwd, start, pid: proc.pid })
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
    const m = /^\/Applications\/([^/]+)\.app\/Contents\/MacOS\/([^/\s]+)$/.exec(proc.args)
    return m && m[1] === m[2] && AI_APPS[m[1]] ? m[1] : null
  }
  const app = winAppOf(proc.exe)
  if (!app || !AI_APPS[app] || /--type=/.test(proc.args)) return null
  const parent = procs.get(proc.ppid)
  return parent && winAppOf(parent.exe) === app ? null : app
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
        if (!cur.repo && l.repo) Object.assign(cur, { repo: l.repo, branch: l.branch, github: l.github })
        continue
      }
      const s: AgentSession = {
        id: `${l.key}:${l.start}`, key: l.key, agent: l.agent, host: l.host, via: l.via, inferred: l.inferred,
        cwd: l.cwd, repo: l.repo, branch: l.branch, github: l.github, start: l.start, end: null, lastSeen,
      }
      this.open.set(l.key, s)
      this.sessions.push(s)
      started.push(s)
    }
    this.resumable = null
    for (const [key, s] of this.open) {
      if (seen.has(key)) continue
      s.end = s.via === 'ide' ? s.lastSeen : now
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
