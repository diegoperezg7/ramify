import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { EDITORS, launchBin } from './catalog.ts'
import { windowsAppPath } from './tools.ts'
import type { Commit, Created, CreateRequest, Detail, FileChange, RepoInfo, State, Timeline, TimelineBranch, TimelineCommit, Worktree } from './types.ts'

const MAX_COMMITS = 300
const MAX_DIFF = 400_000
export const IDES = ['xcode', 'cursor', 'code', 'zed', 'idea', 'Finder']

/** Short ids the ramify script knows, by editor name in the catalog. Other editors are opened by app name. */
export const IDE_IDS: Record<string, string> = { Xcode: 'xcode', Cursor: 'cursor', 'VS Code': 'code', Zed: 'zed', 'IntelliJ IDEA': 'idea' }

/** An editor Ramify can open: a short id, Finder, or any editor of the catalog by name. */
export function knownIde(ide: string): boolean {
  return IDES.includes(ide) || EDITORS.some((e) => e.name === ide)
}

/** Editors installed here as the ids "Open in" uses, the preferred one first, then Finder / Explorer. */
export function idesFor(installed: string[], preferred?: string): string[] {
  const order = ['Cursor', 'VS Code', 'Windsurf', 'Zed', 'Antigravity', 'Kiro', 'Trae', ...EDITORS.map((e) => e.name)]
  const ids = [...new Set(order)].filter((n) => installed.includes(n)).map((n) => IDE_IDS[n] ?? n)
  const first = preferred && ids.includes(preferred) ? [preferred] : []
  return [...new Set([...first, ...ids]), 'Finder']
}

export class EngineError extends Error {}

const WIN = process.platform === 'win32'

/**
 * Git settings that let a repository's own config run programs: off for every git Ramify runs on its own.
 * A folder can come from an agent's working directory or a ramify:// link, so its .git/config is not trusted.
 * core.fsmonitor runs a command on status/diff and hooks run on merge/checkout. External diff drivers and
 * textconv are turned off per call (--no-ext-diff --no-textconv). Passed through the environment (GIT_CONFIG_COUNT, git 2.31+), so the ramify script and its children get it too.
 */
export function hardenedGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  let n = Number(out.GIT_CONFIG_COUNT) || 0
  for (const [k, v] of [['core.fsmonitor', 'false'], ['core.hooksPath', WIN ? 'NUL' : '/dev/null']] as const) {
    out[`GIT_CONFIG_KEY_${n}`] = k
    out[`GIT_CONFIG_VALUE_${n}`] = v
    n++
  }
  out.GIT_CONFIG_COUNT = String(n)
  return out
}

/**
 * One spelling per folder. Windows: long names (not RUNNER~1), forward slashes as git prints them.
 * Elsewhere paths are already canonical.
 */
export function normPath(p: string): string {
  if (!WIN) return p
  let long = p
  try { long = realpathSync.native(p) } catch { /* missing: keep as given */ }
  return long.replace(/\\/g, '/')
}

export function samePath(a: string, b: string): boolean {
  return WIN ? normPath(a).toLowerCase() === normPath(b).toLowerCase() : a === b
}

/**
 * Windows: the ramify script runs in the bash that ships with Git for Windows
 * (not WSL's C:\Windows\System32\bash.exe, which sees a different filesystem).
 */
export function gitBash(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RAMIFY_BASH && existsSync(env.RAMIFY_BASH)) return env.RAMIFY_BASH
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[]
  for (const root of roots) {
    const p = join(root, 'Git', 'bin', 'bash.exe')
    if (existsSync(p)) return p
  }
  // git.exe lives in <Git>\cmd: its bash is in <Git>\bin.
  for (const dir of (env.PATH ?? env.Path ?? '').split(';')) {
    if (existsSync(join(dir, 'git.exe'))) {
      const p = resolve(dir, '..', 'bin', 'bash.exe')
      if (existsSync(p)) return p
    }
  }
  return 'bash.exe'
}

export interface EngineOptions {
  /** Path to the ramify script. */
  bin: string
  /** Environment for every child process (PATH, RAMIFY_ROOT...). */
  env?: NodeJS.ProcessEnv
}

interface RunResult { code: number; stdout: string; stderr: string }

export class Engine {
  private bin: string
  private env: NodeJS.ProcessEnv

  constructor(opts: EngineOptions) {
    this.bin = opts.bin
    this.env = hardenedGitEnv({ ...process.env, ...opts.env, NO_COLOR: '1' })
  }

  // --- process helpers -------------------------------------------------------

  private run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
    return new Promise((resolve) => {
      execFile(cmd, args, { cwd, env: this.env, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      })
    })
  }

  /** Run the ramify script (through Git Bash on Windows). */
  private runBin(args: string[], cwd?: string): Promise<RunResult> {
    return WIN ? this.run(gitBash(this.env), [this.bin.replace(/\\/g, '/'), ...args], cwd) : this.run(this.bin, args, cwd)
  }

  private async mustBin(args: string[], cwd?: string): Promise<string> {
    const r = await this.runBin(args, cwd)
    if (r.code !== 0) throw new EngineError((r.stderr || r.stdout).trim().replace(/^ramify: /, '') || 'ramify failed')
    return r.stdout
  }

  private async must(cmd: string, args: string[], cwd?: string): Promise<string> {
    const r = await this.run(cmd, args, cwd)
    if (r.code !== 0) throw new EngineError((r.stderr || r.stdout).trim().replace(/^ramify: /, '') || `${cmd} failed`)
    return r.stdout
  }

  private async git(repo: string, ...args: string[]): Promise<string> {
    return (await this.run('git', ['-C', repo, ...args])).stdout
  }

  // --- repositories ----------------------------------------------------------

  /** Main checkout of the repository that contains `dir`, or null. */
  async mainCheckout(dir: string): Promise<string | null> {
    // No --path-format=absolute: it needs git 2.31+.
    const r = await this.run('git', ['-C', dir, 'rev-parse', '--git-common-dir'])
    if (r.code !== 0) return null
    let common: string
    try { common = normPath(realpathSync(resolve(dir, r.stdout.trim()))) } catch { return null }
    const bare = (await this.run('git', ['-C', common, 'rev-parse', '--is-bare-repository'])).stdout.trim() === 'true'
    if (!bare) return basename(common) === '.git' ? normPath(resolve(common, '..')) : null
    // Bare repository with worktrees: the first non-bare worktree acts as the main checkout.
    const first = (await this.list(common)).find((w) => !w.bare)
    return first ? first.path : null
  }

  /** Light worktree list straight from git (no process scan), for validation and lookups. */
  async list(repo: string): Promise<{ path: string; branch: string; bare: boolean }[]> {
    const out = await this.git(repo, 'worktree', 'list', '--porcelain')
    const res: { path: string; branch: string; bare: boolean }[] = []
    let cur: { path: string; branch: string; bare: boolean } | null = null
    for (const line of `${out}\n`.split('\n')) {
      if (line.startsWith('worktree ')) cur = { path: line.slice(9), branch: '', bare: false }
      else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '')
      else if (cur && line === 'bare') cur.bare = true
      else if (!line && cur) { res.push(cur); cur = null }
    }
    return res
  }

  /** Repositories that already have ramify worktrees, found through their .worktree.env files. */
  discover(): string[] {
    const root = this.env.RAMIFY_ROOT || join(homedir(), '.worktrees')
    const found = new Set<string>()
    if (!existsSync(root)) return []
    for (const repo of safeReaddir(root)) {
      for (const wt of safeReaddir(join(root, repo))) {
        const env = join(root, repo, wt, '.worktree.env')
        if (!existsSync(env)) continue
        const main = /^WT_MAIN=(.*)$/m.exec(readFileSync(env, 'utf8'))?.[1]
        if (main && existsSync(main)) found.add(main)
      }
    }
    return [...found]
  }

  async repoInfo(path: string): Promise<RepoInfo> {
    const list = await this.list(path)
    return { path, name: basename(path), worktrees: list.filter((w) => !w.bare && w.path !== path).length }
  }

  // --- reads -----------------------------------------------------------------

  async worktrees(repo: string): Promise<Worktree[]> {
    return JSON.parse(await this.mustBin(['ls', '--json'], repo)) as Worktree[]
  }

  private async base(repo: string): Promise<string> {
    return (await this.git(repo, 'branch', '--show-current')).trim() || 'HEAD'
  }

  async state(repo: string): Promise<State> {
    const [wts, base] = await Promise.all([this.worktrees(repo), this.base(repo)])
    const branches = wts.map((w) => w.branch).filter(Boolean)
    const owner = new Map<string, string>()
    await Promise.all(wts.filter((w) => !w.main && w.branch).map(async (w) => {
      const hashes = (await this.git(repo, 'rev-list', `${base}..${w.branch}`)).split('\n').filter(Boolean)
      for (const h of hashes) if (!owner.has(h)) owner.set(h, w.branch)
    }))
    const commits: Commit[] = []
    if (branches.length) {
      const log = await this.git(repo, 'log', '--date-order', `-n${MAX_COMMITS}`,
        '--format=%H%x1f%P%x1f%s%x1f%an%x1f%ct%x1f%D%x1e', ...branches, '--')
      for (const rec of log.split('\x1e')) {
        const line = rec.replace(/^\n+|\n+$/g, '')
        if (!line) continue
        const [hash, parents, subject, author, ct, refs] = line.split('\x1f')
        commits.push({
          hash, subject, author, time: Number(ct), owner: owner.get(hash) ?? null,
          parents: parents.split(' ').filter(Boolean),
          refs: refs.split(',').map((r) => r.trim()).filter(Boolean),
        })
      }
    }
    return { repo: basename(repo), main: repo, base, worktrees: wts, commits, now: Math.floor(Date.now() / 1000) }
  }

  /** Validate that `path` is a worktree of `repo` (one `git worktree list`, no process scan). */
  private async find(repo: string, path: string): Promise<{ path: string; branch: string; main: boolean }> {
    const wt = (await this.list(repo)).find((w) => samePath(w.path, path) && !w.bare)
    if (!wt) throw new EngineError('unknown worktree')
    return { path: wt.path, branch: wt.branch, main: samePath(wt.path, repo) }
  }

  private async mergeBase(repo: string, path: string, wt: { main: boolean }): Promise<string> {
    if (wt.main) return 'HEAD'
    return (await this.git(path, 'merge-base', await this.base(repo), 'HEAD')).trim() || 'HEAD'
  }

  async worktree(repo: string, path: string): Promise<Detail> {
    const wt = await this.find(repo, path)
    const base = await this.base(repo)
    const mb = await this.mergeBase(repo, path, wt)
    const commits: Detail['commits'] = []
    if (!wt.main) {
      for (const line of (await this.git(path, 'log', `${base}..HEAD`, '--format=%H%x1f%s%x1f%ct')).split('\n')) {
        if (!line) continue
        const [hash, subject, t] = line.split('\x1f')
        commits.push({ hash, subject, time: Number(t) })
      }
    }
    // -z everywhere: paths with spaces, accents or renames come through verbatim.
    const files = new Map<string, FileChange>()
    const numstat = (await this.git(path, 'diff', '--no-ext-diff', '--no-textconv', '-z', '--numstat', mb)).split('\0')
    for (let i = 0; i < numstat.length; i++) {
      const rec = numstat[i]
      if (!rec) continue
      const [add, del, name] = rec.split('\t')
      let file = name
      if (name === '') { i += 2; file = numstat[i] } // rename: "add\tdel\t" then old\0new\0
      if (file) files.set(file, { file, status: 'M', add, del, uncommitted: false })
    }
    const nameStatus = (await this.git(path, 'diff', '--no-ext-diff', '--no-textconv', '-z', '--name-status', mb)).split('\0')
    for (let i = 0; i < nameStatus.length; i++) {
      const st = nameStatus[i]
      if (!st) continue
      let file = nameStatus[++i]
      if (st[0] === 'R' || st[0] === 'C') file = nameStatus[++i]
      if (!file) continue
      const f = files.get(file) ?? { file, status: 'M', add: '0', del: '0', uncommitted: false }
      f.status = st[0]
      files.set(file, f)
    }
    const status = (await this.git(path, 'status', '-z', '--porcelain')).split('\0')
    const pending = new Set<string>()
    for (let i = 0; i < status.length; i++) {
      const rec = status[i]
      if (!rec) continue
      const code = rec.slice(0, 2)
      const file = rec.slice(3)
      pending.add(file)
      if (code[0] === 'R' || code[0] === 'C') i++ // the original path follows
      if (code === '??') files.set(file, { file, status: '?', add: '', del: '', uncommitted: true })
    }
    for (const f of files.values()) f.uncommitted = pending.has(f.file)
    return { path, branch: wt.branch, mergeBase: mb, commits, files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)) }
  }

  async diff(repo: string, path: string, file: string): Promise<string> {
    const wt = await this.find(repo, path)
    const mb = await this.mergeBase(repo, path, wt)
    const untracked = (await this.git(path, 'ls-files', '--others', '--exclude-standard', '--', file)).trim()
    const out = untracked
      ? (await this.run('git', ['-C', path, 'diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', file])).stdout
      : await this.git(path, 'diff', '--no-ext-diff', '--no-textconv', mb, '--', file)
    return out.slice(0, MAX_DIFF)
  }

  // --- actions ---------------------------------------------------------------

  async openIde(repo: string, path: string, ide: string): Promise<string> {
    await this.find(repo, path)
    if (!knownIde(ide)) throw new EngineError('unknown IDE')
    if (ide === 'Finder') {
      // explorer.exe exits with 1 even when it opened the folder.
      if (WIN) await this.run('explorer.exe', [path.replace(/\//g, '\\')])
      else await this.must(process.platform === 'darwin' ? 'open' : 'xdg-open', [path])
    } else if (WIN && !IDES.includes(ide)) {
      // Editors without a command of their own: start their executable with the folder.
      const spec = EDITORS.find((e) => e.name === ide)
      const exe = spec && windowsAppPath(spec, this.env)
      if (!exe) throw new EngineError(`${ide} is not installed`)
      spawn(exe, [path.replace(/\//g, '\\')], { detached: true, stdio: 'ignore' }).unref()
    } else await this.mustBin(['open', path, '-i', ide], repo)
    return 'ok'
  }

  async remove(repo: string, path: string, force: boolean): Promise<string> {
    if ((await this.find(repo, path)).main) throw new EngineError('that is the main checkout')
    const r = await this.runBin(['rm', path, ...(force ? ['--force'] : [])], repo)
    const msg = (r.stderr || r.stdout).trim()
    if (r.code !== 0) throw new EngineError(msg.replace(/^ramify: /, ''))
    return msg
  }

  async merge(repo: string, path: string): Promise<string> {
    const wt = await this.find(repo, path)
    if (wt.main || !wt.branch) throw new EngineError('nothing to merge')
    if ((await this.git(repo, 'status', '--porcelain', '--untracked-files=no')).trim()) {
      throw new EngineError('the main checkout has uncommitted changes')
    }
    if ((await this.git(path, 'status', '--porcelain')).trim()) throw new EngineError('the worktree has uncommitted changes')
    const r = await this.run('git', ['-C', repo, 'merge', '--no-ff', '--no-edit', wt.branch])
    if (r.code !== 0) {
      await this.run('git', ['-C', repo, 'merge', '--abort'])
      throw new EngineError(`merge conflict, nothing was changed:\n${(r.stdout + r.stderr).trim()}`)
    }
    return r.stdout.trim()
  }

  /** Create a worktree (with setup) without starting the agent. */
  async create(repo: string, req: CreateRequest): Promise<Created> {
    const branch = req.branch.trim()
    if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-')) throw new EngineError('invalid branch name')
    const args = ['new', branch, '--no-launch']
    if (req.agent && !/^[\w.-]+$/.test(req.agent)) throw new EngineError('invalid agent name')
    if (req.agent) args.push('-a', launchBin(req.agent))
    if (req.base) args.push('-f', req.base)
    const out = await this.mustBin(args, repo)
    const path = out.trim().split('\n').pop() ?? ''
    return { path, command: req.agent ? this.launchCommand(path, req.agent, req.prompt) : null }
  }

  // --- timeline ----------------------------------------------------------------

  private async commitsOf(repo: string, ...range: string[]): Promise<TimelineCommit[]> {
    const out = await this.git(repo, 'log', '--no-ext-diff', '-n', '400', '--format=%H%x1f%ct%x1f%s%x1e', ...range, '--')
    return out.split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [hash, ct, subject] = l.split('\x1f')
      return { hash, time: Number(ct), subject }
    }).sort((a, b) => a.time - b.time)
  }

  private async commitTime(repo: string, ref: string): Promise<number> {
    return Number((await this.git(repo, 'log', '-1', '--format=%ct', ref)).trim()) || 0
  }

  /**
   * Every local branch, and every branch merged into the base within the range even if it was deleted
   * (rebuilt from its merge commit): where it forked, its commits, where it was merged.
   */
  async timeline(repo: string, days: number): Promise<Timeline> {
    const now = Math.floor(Date.now() / 1000)
    const base = await this.base(repo)
    const since = days > 0 ? now - days * 86400 : 0
    const sinceArgs = since ? [`--since=${since}`] : []
    const [wts, refs, baseCommits] = await Promise.all([
      this.worktrees(repo).catch(() => [] as Worktree[]),
      this.git(repo, 'for-each-ref', 'refs/heads', '--format=%(refname:short)%1f%(objectname)'),
      this.commitsOf(repo, '--first-parent', ...sinceArgs, base),
    ])
    const branches: TimelineBranch[] = []
    const seenTips = new Set<string>()
    const week = now - 7 * 86400

    for (const line of refs.split('\n').filter(Boolean)) {
      const [name, tip] = line.split('\x1f')
      if (name === base) continue
      seenTips.add(tip)
      const inBase = (await this.run('git', ['-C', repo, 'merge-base', '--is-ancestor', name, base])).code === 0
      // A branch already merged forks where the base stood before its merge commit, not at its own tip.
      let merge: TimelineBranch['merge'] = null
      let forkHash = (await this.git(repo, 'merge-base', base, name)).trim()
      if (inBase) {
        const m = (await this.git(repo, 'rev-list', '--ancestry-path', '--merges', '--reverse', `${name}..${base}`)).split('\n')[0]?.trim()
        if (m) {
          merge = { hash: m, time: await this.commitTime(repo, m) }
          forkHash = (await this.git(repo, 'merge-base', `${m}^1`, name)).trim()
        }
      }
      if (!forkHash) continue
      const commits = await this.commitsOf(repo, `${forkHash}..${name}`)
      // In the base with no merge commit and nothing of its own: a fresh branch, not a merged one.
      const merged = inBase && !!merge && commits.length > 0
      const wt = wts.find((w) => w.branch === name)
      const last = commits.at(-1)?.time ?? 0
      branches.push({
        name, agent: wt?.agent || null, exists: true, live: !!wt?.running.length, worktree: wt?.path ?? null,
        status: merged && commits.length ? 'merged' : last >= week || wt?.running.length || !commits.length ? 'active' : 'stale',
        fork: { hash: forkHash, time: await this.commitTime(repo, forkHash) }, merge, commits,
      })
    }

    // Branches merged and deleted: each merge commit on the base names one in its subject.
    const merges = await this.git(repo, 'log', '--first-parent', '--merges', ...sinceArgs, '--format=%H%x1f%P%x1f%ct%x1f%s%x1e', base, '--')
    for (const rec of merges.split('\x1e').map((l) => l.trim()).filter(Boolean)) {
      const [hash, parents, ct, subject] = rec.split('\x1f')
      const [p1, p2] = parents.split(' ')
      if (!p2 || seenTips.has(p2) || branches.some((b) => b.commits.some((c) => c.hash === p2))) continue
      const name = mergedBranchName(subject) ?? p2.slice(0, 7)
      const forkHash = (await this.git(repo, 'merge-base', p1, p2)).trim()
      branches.push({
        name, agent: null, exists: false, live: false, worktree: null, status: 'merged',
        fork: { hash: forkHash, time: await this.commitTime(repo, forkHash) },
        merge: { hash, time: Number(ct) }, commits: await this.commitsOf(repo, `${forkHash}..${p2}`),
      })
    }

    const end = (b: TimelineBranch) => Math.max(b.merge?.time ?? 0, b.commits.at(-1)?.time ?? b.fork.time)
    const inRange = branches.filter((b) => !since || b.status !== 'merged' || end(b) >= since)
    // Newest activity first, live ones on top.
    inRange.sort((a, b) => Number(b.live) - Number(a.live) || end(b) - end(a))
    const from = since || Math.min(now, ...baseCommits.map((c) => c.time), ...inRange.map((b) => b.fork.time))
    return { base, from, now, baseCommits, branches: inRange }
  }

  /** Shell command that starts `agent` inside the worktree at `path`. */
  launchCommand(path: string, agent: string, prompt?: string): string {
    if (!/^[\w.-]+$/.test(agent)) throw new EngineError('invalid agent name')
    const parts = [WIN ? this.bin.replace(/\\/g, '/') : this.bin, 'open', path, '-a', launchBin(agent)]
    if (prompt) parts.push('-p', prompt)
    return `cd ${shellQuote(path)} && ${parts.map(shellQuote).join(' ')}`
  }
}

/** Branch name from a merge commit subject (git, GitHub and GitLab wording), or null. */
export function mergedBranchName(subject: string): string | null {
  const m = /^Merge (?:remote-tracking )?branch '(?:origin\/)?([^']+)'/.exec(subject)
    ?? /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)
    ?? /^Merge branch '([^']+)' into/.exec(subject)
  return m ? m[1] : null
}

export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir).filter((n) => !n.startsWith('.')) } catch { return [] }
}
