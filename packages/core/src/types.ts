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
}

/** What the current host can do. The browser build (agent-wt ui) is single-repo. */
export interface Capabilities {
  host: 'browser' | 'desktop' | 'vscode'
  multiRepo: boolean
  create: boolean
  settings: boolean
  github: boolean
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
  /** Host-initiated events: open a repository/worktree, show the "new worktree" form. */
  onEvent(cb: (e: { repo?: string; path?: string; event?: string }) => void): void
}
