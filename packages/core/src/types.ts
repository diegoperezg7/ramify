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
  /** Claude Code conversation whose subagent made this worktree (WT_SESSION, from the WorktreeCreate hook). */
  session?: string
  /** Its agent ran `ramify ready`: still valid (ready), or the branch or the base moved since (stale). Null: not marked, or merged. */
  ready?: 'ready' | 'stale' | null
  /** Commits of the base the branch does not have yet (0 for the main checkout). */
  behind?: number
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

/** One commit of the graph: what it says and the files it changed (a merge: against its first parent). */
export interface CommitDetail {
  hash: string
  parents: string[]
  author: string
  time: number
  subject: string
  body: string
  files: FileChange[]
}

export interface Detail {
  path: string
  branch: string
  mergeBase: string
  commits: { hash: string; subject: string; time: number }[]
  files: FileChange[]
}

export interface TimelineCommit { hash: string; time: number; subject: string }

/** One branch on the timeline: from where it forked off the base to its last commit or its merge. */
export interface TimelineBranch {
  name: string
  /** Agent of its worktree, when it has one. */
  agent: string | null
  /** active: has commits not in the base and moved in the last week; stale: older; merged: in the base. */
  status: 'active' | 'stale' | 'merged'
  /** Still a local branch (false: merged and deleted, rebuilt from its merge commit). */
  exists: boolean
  /** Agent working in its worktree right now. */
  live: boolean
  worktree: string | null
  fork: { hash: string; time: number }
  merge: { hash: string; time: number } | null
  commits: TimelineCommit[]
}

export interface Timeline {
  base: string
  /** Unix seconds: start of the range and now. */
  from: number
  now: number
  baseCommits: TimelineCommit[]
  branches: TimelineBranch[]
}

/** A branch being built, with what a reviewer would want to know before it goes in. */
export interface BranchHealth {
  path: string
  branch: string
  /** The main checkout: listed only while an agent works there. */
  main: boolean
  agent: string
  running: string[]
  /** Commits on the branch and not in the base. */
  ahead: number
  /** Commits in the base the branch does not have yet. */
  behind: number
  uncommitted: number
  /** Lines added and deleted against where it forked, uncommitted work included. */
  added: number
  deleted: number
  files: number
  /** Commits not pushed to its upstream; null when it has no upstream. */
  unpushed: number | null
  lastCommit: number | null
  /** Everything it had is in the base already, by history or through its merged (squashed) pull request. */
  merged: boolean
  /** Other branches that change some of the same files. */
  overlaps: string[]
  /** Its place in the merge queue, from `ramify ready` (see Worktree.ready). */
  ready?: 'ready' | 'stale' | null
}

/** The base against its remote branch (main against origin/main), after the last fetch. */
export interface BaseSync {
  /** The remote branch it tracks, e.g. origin/main. */
  upstream: string
  /** Commits on the remote the local base does not have. */
  behind: number
  /** Local commits on the base that are not on the remote. */
  ahead: number
}

export interface Health { base: string; branches: BranchHealth[]; /** Null when the base tracks no remote branch. */ sync?: BaseSync | null }

/** head: the commit the pull request points at (its branch's tip on GitHub), when known. */
export interface PullRequest { number: number; url: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; draft: boolean; title: string; branch: string; head?: string }

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
  /** Desktop: what needs the user here, one reason per session or ready branch (see attention.ts). */
  attention?: ('waiting' | 'shared' | 'main' | 'ready')[]
  /** Desktop: the latest commit on any branch or AI session here (ms), null when there is none. */
  lastActive?: number | null
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
  /** Desktop: warn about branches far behind the base, branches changing the same files, merged worktrees left open. */
  watchBranches?: boolean
  /** Desktop: when an agent finishes and its branch is pushed, open a draft pull request for it. */
  autoDraftPr?: boolean
  /** Desktop: remove worktrees that are clean and already merged. */
  autoClean?: boolean
  /** Desktop: look for a newer release on GitHub now and then, and offer it. */
  autoUpdate?: boolean
  /** Desktop: start at login (hidden, in the menu bar). */
  openAtLogin?: boolean
  /** Desktop: show the agent count in the menu bar. */
  menuBar?: boolean
  /** Desktop: notify when a branch is ready to merge. Unset until the user is asked; asked once. */
  notifyReady?: boolean
  /** The first-run introduction has been seen. */
  onboarded?: boolean
  /** Agents or apps (by name) the user does not want tracked. */
  ignored?: string[]
  /** Editor that "Open in" offers first (an id such as cursor, or an editor name). */
  defaultIde?: string
  /** Days of AI-session history to keep (0 = keep everything). */
  historyDays?: number
}

export interface GithubAccount {
  /** The GitHub App is configured in this build. */
  configured: boolean
  status: 'signed-out' | 'waiting' | 'signed-in' | 'error'
  user?: { login: string; name: string | null; avatarUrl: string }
  error?: string
  /** Tokens are kept encrypted by the OS keychain (false: this session only). */
  keychain: boolean
  /** Page where the user picks which repositories Ramify can see. */
  installUrl: string | null
}

export interface SyncedRepo {
  nameWithOwner: string
  owner: string
  ownerType: 'User' | 'Organization'
  url: string
  description: string
  isPrivate: boolean
  isFork: boolean
  pushedAt: string
  language: string | null
  /** Local clone on this machine. */
  local: string | null
  added: boolean
  /** Agents working in it right now. */
  live: string[]
}

export interface GithubSync { installations: number; repos: SyncedRepo[] }

export interface InstalledTools {
  agents: string[]
  editors: string[]
  terminals: string[]
  apps: string[]
}

export type SessionVia = 'terminal' | 'ide' | 'app'
export type SessionState = 'working' | 'idle' | 'waiting'
/** A look into a running conversation (Claude Code transcripts). */
export interface SessionGlance {
  /** The last tool it used, on what (a file's name, a command), and when. */
  action: { tool: string; target: string | null; at: number } | null
  /** Files its edit tools wrote. */
  files: number
  /** Its replies per five minutes over the last hour, oldest first: when it worked and when it waited. */
  pulse: number[]
}

/** One AI session seen on this machine: an agent CLI, an IDE's AI chat or a desktop AI app. */
/** Work an open session runs alongside it, never kept in the history. */
export type AgentChildKind = 'subagent' | 'teammate' | 'worktree' | 'codex'
export interface AgentChild {
  kind: AgentChildKind
  id: string
  /** Subagent or teammate type, teammate name, Codex nickname or role. */
  label: string
  /** What it was asked to do (subagents), when known. */
  description: string
  cwd: string | null
  repo: string | null
  branch: string | null
  /** Counts as working on its branch (a subagent in the middle of a turn). */
  working: boolean
  /** Codex: a thread another thread spawned (a Codex subagent). */
  spawned?: boolean
}

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
  /** What it is doing right now, when the agent reports it. */
  state?: SessionState
  /** Claude Code: the task, from the first thing the user asked. Kept in the history. */
  task?: string | null
  /** Claude Code, while it runs: its last step, the files it edited and the last hour's activity. Never kept. */
  glance?: SessionGlance
  /** While open: why it needs the user, most urgent first (see attention.ts). Never kept. */
  attention?: ('waiting' | 'shared' | 'main' | 'ready')[]
  start: number
  /** null while it is running. */
  end: number | null
  lastSeen: number
}

/** What the current host can do. The browser build (ramify ui) is single-repo. */
/** One part of the one-click setup of this computer (see core/setup.ts). */
export type SetupItemId = 'claude' | 'agents' | 'shell' | 'cli'
export interface SetupState {
  id: SetupItemId
  /** unavailable: the tool it configures is not installed here (Claude Code, other agents, Git Bash). */
  status: 'done' | 'todo' | 'unavailable'
  /** Why the last attempt failed. */
  error?: string
}

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
  /** Branch timeline view. */
  timeline?: boolean
  /** Control center (branch health, pull requests, contribution grid). */
  control?: boolean
  /** One-click setup of this computer (agents, terminal, ramify command). */
  setup?: boolean
  /** The app updates itself from GitHub releases. */
  update?: boolean
  ides: string[]
}

/** The app's own update: a newer release found, downloading, ready to install on restart, or failed. */
export interface UpdateState {
  status: 'none' | 'available' | 'downloading' | 'ready' | 'error'
  /** Version on offer. */
  version?: string
  /** Download progress, 0 to 100. */
  percent?: number
  error?: string
}

/** Every call the UI can make. Each host implements it: HTTP, Electron IPC or VS Code messages. */
export interface Bridge {
  capabilities(): Promise<Capabilities>
  state(repo: string): Promise<State>
  worktree(repo: string, path: string): Promise<Detail>
  diff(repo: string, path: string, file: string): Promise<{ diff: string }>
  commit(repo: string, hash: string): Promise<CommitDetail>
  commitDiff(repo: string, hash: string, file: string): Promise<{ diff: string }>
  open(repo: string, path: string, ide: string): Promise<{ message: string }>
  merge(repo: string, path: string): Promise<{ message: string }>
  remove(repo: string, path: string, force: boolean): Promise<{ message: string }>
  create(repo: string, req: CreateRequest): Promise<{ message: string; path: string }>
  launch(repo: string, path: string, agent: string, prompt?: string): Promise<{ message: string }>
  /** Every branch being built in a repository, with its health. */
  health(repo: string): Promise<Health>
  /** Pull requests of the repository, newest first (GitHub, through the user's account or gh). */
  pullRequests(repo: string): Promise<PullRequest[]>
  /** Bring the base's new commits into a worktree's branch (merge; aborted on conflict). */
  updateFromBase(repo: string, path: string): Promise<{ message: string }>
  /** Bring the base up to its remote branch (main ← origin/main), fast-forward only. */
  updateBase(repo: string): Promise<{ message: string }>
  /** Push a worktree's branch and open a draft pull request for it. */
  openPr(repo: string, path: string): Promise<{ message: string }>
  /** Commits per day (unix day start → count) across all branches, for the last `days` days. */
  commitDays(repo: string, days: number): Promise<Record<number, number>>
  /** Commits of one local day (its midnight, unix seconds), newest first. */
  dayCommits(repo: string, day: number): Promise<TimelineCommit[]>
  /** Every local branch and every branch merged into the base in the last `days` days (0: all history). */
  timeline(repo: string, days: number): Promise<Timeline>
  repos(): Promise<RepoInfo[]>
  addRepo(): Promise<RepoInfo | null>
  removeRepo(path: string): Promise<void>
  github(refresh?: boolean): Promise<GithubRepo[]>
  cloneRepo(nameWithOwner: string): Promise<RepoInfo>
  addRepoPath(path: string): Promise<RepoInfo>
  settings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  sessions(): Promise<AgentSession[]>
  /** GitHub sign-in (desktop): state of the account. Never carries the token. */
  githubAccount(): Promise<GithubAccount>
  /** Start the device flow: the code to type at github.com/login/device (the page opens by itself). */
  githubSignIn(): Promise<{ userCode: string; verificationUri: string; expiresAt: number }>
  githubCancel(): Promise<void>
  githubSignOut(): Promise<void>
  /** Repositories the signed-in account shares with Ramify, matched with this machine. */
  githubSync(): Promise<GithubSync>
  /** Agent CLIs, editors, terminals and AI apps installed on this machine. */
  tools(): Promise<InstalledTools>
  /** Repositories found in the projects folder that are not in the app yet, most recently used first. */
  suggestRepos(): Promise<{ path: string; name: string }[]>
  addRepos(paths: string[]): Promise<void>
  /** Is the terminal integration on (an agent opened in a main checkout gets its own branch)? */
  shellIntegration(): Promise<{ installed: boolean; rc: string }>
  setupStatus(): Promise<SetupState[]>
  /** Set up these items (every one that applies when none is given). */
  setupApply(items?: SetupItemId[]): Promise<SetupState[]>
  setupUndo(item: SetupItemId): Promise<SetupState[]>
  setShellIntegration(on: boolean): Promise<{ installed: boolean; rc: string }>
  /** Move the main checkout's uncommitted work to a new branch for `agent` and open the agent there. */
  moveToBranch(repo: string, agent: string): Promise<{ message: string; path: string }>
  /** Forget the finished sessions. */
  clearSessions(): Promise<void>
  /** Close a session that is still open (it stops counting as running and is not reopened). */
  closeSession(id: string): Promise<void>
  /** Subagents, teammates, worktrees and Codex threads of the open sessions, by session key. */
  agentChildren(): Promise<Record<string, AgentChild[]>>
  /** Save the whole history to a file the user picks. */
  exportSessions(format: 'csv' | 'json'): Promise<{ message: string }>
  /** Create a GitHub repository for a local repository without a remote, and push it. */
  publishRepo(path: string, name: string, isPrivate: boolean): Promise<{ message: string; github: string }>
  /** Desktop only (capabilities.update): the app's own update. */
  updateState?(): Promise<UpdateState>
  updateDownload?(): Promise<void>
  /** Quit, install the downloaded version and open it again. */
  updateInstall?(): Promise<void>
  /** Host-initiated events: open a repository/worktree, show the "new worktree" form. */
  /** Editor only: open the dashboard panel, on a commit (`open`) or on the new worktree form (`new`). */
  dashboard?(action: 'open' | 'new', hash?: string): Promise<void>
  onEvent(cb: (e: { repo?: string; path?: string; event?: string; hash?: string }) => void): void
}
