// Shared by the engine (Node) and the web UI (browser). Types only.

export interface Worktree {
  name: string
  path: string
  branch: string
  main: boolean
  agent: string
  running: string[]
  changes: number
  commits: number
  upstream: string
  port: number | null
}

export interface Commit {
  hash: string
  parents: string[]
  subject: string
  author: string
  time: number
  owner: string | null
  refs: string[]
}

export interface State {
  repo: string
  main: string
  base: string
  worktrees: Worktree[]
  commits: Commit[]
  now: number
}

export interface FileChange {
  file: string
  status: string
  add: string
  del: string
  uncommitted: boolean
}

export interface Detail {
  path: string
  branch: string
  mergeBase: string
  commits: { hash: string; subject: string; time: number }[]
  files: FileChange[]
}

export interface CreateRequest {
  branch: string
  agent: string
  base?: string
  prompt?: string
}

export interface Created {
  path: string
  /** Shell command that starts the agent in the new worktree, or null when no agent was chosen. */
  command: string | null
}

export interface RepoInfo {
  path: string
  name: string
  worktrees: number
  /** Agents running right now anywhere in this repository (main checkout or worktrees). */
  active?: string[]
  /** owner/name on GitHub, when the origin remote points there. */
  github?: string | null
}

export interface GithubRepo {
  nameWithOwner: string
  url: string
  description: string
  isPrivate: boolean
  isFork: boolean
  pushedAt: string
  language: string | null
  /** Local clone found on this machine, or null. */
  local: string | null
  /** Already listed in the app. */
  added: boolean
}

export interface Settings {
  terminal: 'Terminal' | 'iTerm' | 'Ghostty'
  defaultAgent: string
  /** Where projects live: scanned for local clones and used as the clone target. */
  projectsDir: string
  /** Add repositories automatically when an agent starts working in them. */
  autoDetect: boolean
  /** Desktop: notify when an agent finishes. */
  notifications?: boolean
  /** Desktop: start at login (hidden, in the menu bar). */
  openAtLogin?: boolean
  /** Desktop: show the agent count in the menu bar. */
  menuBar?: boolean
  /** The first-run introduction has been seen. */
  onboarded?: boolean
  /** Agents or apps (by name) the user does not want tracked. */
  ignored?: string[]
}

export interface InstalledTools {
  agents: string[]
  editors: string[]
  terminals: string[]
  apps: string[]
}

export type SessionVia = 'terminal' | 'ide' | 'app'

/** One AI session seen on this machine: an agent CLI, an IDE's AI chat or a desktop AI app. */
export interface AgentSession {
  id: string
  /** Identity of the live session (process or IDE workspace), used to resume it after a restart. */
  key?: string
  /** claude, codex, gemini…, cursor / copilot / windsurf (IDE chat), chatgpt / claude-app (desktop apps). */
  agent: string
  /** Where it runs: Terminal, iTerm, Ghostty · tmux, Cursor, VS Code, ChatGPT… */
  host: string
  via: SessionVia
  /** Seen open, not a confirmed conversation (IDE chat, desktop apps). */
  inferred: boolean
  /** Folder it works in, when known. */
  cwd: string | null
  /** Main checkout of the git repository around cwd. */
  repo: string | null
  branch: string | null
  /** owner/name on GitHub. */
  github: string | null
  pr?: { number: number; url: string; state: string; title: string } | null
  start: number
  /** null while it is running. */
  end: number | null
  lastSeen: number
}

/** What the current host can do. The browser build (ramify ui) is single-repo. */
export interface Capabilities {
  host: 'browser' | 'desktop' | 'vscode'
  /** Operating system of the host (process.platform), when it matters to the UI. */
  platform?: string
  multiRepo: boolean
  create: boolean
  settings: boolean
  github: boolean
  /** Tracks AI sessions across the machine. */
  sessions?: boolean
  ides: string[]
}

/** Every call the UI can make. Each host implements it: HTTP, Electron IPC or VS Code messages. */
export interface Bridge {
  capabilities(): Promise<Capabilities>
  state(repo: string): Promise<State>
  worktree(repo: string, path: string): Promise<Detail>
  diff(repo: string, path: string, file: string): Promise<{ diff: string }>
  open(repo: string, path: string, ide: string): Promise<{ message: string }>
  merge(repo: string, path: string): Promise<{ message: string }>
  remove(repo: string, path: string, force: boolean): Promise<{ message: string }>
  create(repo: string, req: CreateRequest): Promise<{ message: string; path: string }>
  launch(repo: string, path: string, agent: string, prompt?: string): Promise<{ message: string }>
  repos(): Promise<RepoInfo[]>
  addRepo(): Promise<RepoInfo | null>
  removeRepo(path: string): Promise<void>
  github(refresh?: boolean): Promise<GithubRepo[]>
  cloneRepo(nameWithOwner: string): Promise<RepoInfo>
  addRepoPath(path: string): Promise<RepoInfo>
  settings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  sessions(): Promise<AgentSession[]>
  /** Agent CLIs, editors, terminals and AI apps installed on this machine. */
  tools(): Promise<InstalledTools>
  /** Repositories found in the projects folder that are not in the app yet, most recently used first. */
  suggestRepos(): Promise<{ path: string; name: string }[]>
  addRepos(paths: string[]): Promise<void>
  /** Save the whole history to a file the user picks. */
  exportSessions(format: 'csv' | 'json'): Promise<{ message: string }>
  /** Create a GitHub repository for a local repository without a remote, and push it. */
  publishRepo(path: string, name: string, isPrivate: boolean): Promise<{ message: string; github: string }>
  /** Host-initiated events: open a repository/worktree, show the "new worktree" form. */
  onEvent(cb: (e: { repo?: string; path?: string; event?: string }) => void): void
}
