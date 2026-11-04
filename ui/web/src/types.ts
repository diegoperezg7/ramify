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
