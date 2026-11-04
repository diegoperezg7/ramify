import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Commit, Created, CreateRequest, Detail, FileChange, RepoInfo, State, Worktree } from './types.ts'

const MAX_COMMITS = 300
const MAX_DIFF = 400_000
export const IDES = ['xcode', 'cursor', 'code', 'zed', 'idea', 'Finder']

export class EngineError extends Error {}

export interface EngineOptions {
  /** Path to the agent-wt script. */
  bin: string
  /** Environment for every child process (PATH, AGENT_WT_ROOT...). */
  env?: NodeJS.ProcessEnv
}

interface RunResult { code: number; stdout: string; stderr: string }

export class Engine {
  private bin: string
  private env: NodeJS.ProcessEnv

  constructor(opts: EngineOptions) {
    this.bin = opts.bin
    this.env = { ...process.env, ...opts.env, NO_COLOR: '1' }
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

  private async must(cmd: string, args: string[], cwd?: string): Promise<string> {
    const r = await this.run(cmd, args, cwd)
    if (r.code !== 0) throw new EngineError((r.stderr || r.stdout).trim().replace(/^agent-wt: /, '') || `${cmd} failed`)
    return r.stdout
  }

  private async git(repo: string, ...args: string[]): Promise<string> {
    return (await this.run('git', ['-C', repo, ...args])).stdout
  }

  // --- repositories ----------------------------------------------------------

  /** Main checkout of the repository that contains `dir`, or null. */
  async mainCheckout(dir: string): Promise<string | null> {
    const r = await this.run('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (r.code !== 0) return null
    const common = r.stdout.trim()
    return common.endsWith('/.git') ? common.slice(0, -5) : null
  }

  /** Repositories that already have agent-wt worktrees, found through their .worktree.env files. */
  discover(): string[] {
    const root = this.env.AGENT_WT_ROOT || join(homedir(), '.worktrees')
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
    const list = await this.git(path, 'worktree', 'list', '--porcelain')
    return { path, name: basename(path), worktrees: list.split('\n').filter((l) => l.startsWith('worktree ')).length - 1 }
  }

  // --- reads -----------------------------------------------------------------

  async worktrees(repo: string): Promise<Worktree[]> {
    return JSON.parse(await this.must(this.bin, ['ls', '--json'], repo)) as Worktree[]
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

  private async find(repo: string, path: string): Promise<Worktree> {
    const wt = (await this.worktrees(repo)).find((w) => w.path === path)
    if (!wt) throw new EngineError('unknown worktree')
    return wt
  }

  private async mergeBase(repo: string, path: string, wt: Worktree): Promise<string> {
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
    const files = new Map<string, FileChange>()
    for (const line of (await this.git(path, 'diff', '--numstat', mb)).split('\n')) {
      if (!line) continue
      const [add, del, ...name] = line.split('\t')
      const file = name.join('\t')
      files.set(file, { file, status: 'M', add, del, uncommitted: false })
    }
    for (const line of (await this.git(path, 'diff', '--name-status', mb)).split('\n')) {
      if (!line) continue
      const [st, ...names] = line.split('\t')
      const file = names[names.length - 1]
      const f = files.get(file) ?? { file, status: 'M', add: '0', del: '0', uncommitted: false }
      f.status = st[0]
      files.set(file, f)
    }
    const status = (await this.git(path, 'status', '--porcelain')).split('\n').filter(Boolean)
    const pending = new Set(status.map((l) => l.slice(3)))
    for (const l of status) {
      if (l.startsWith('??')) files.set(l.slice(3), { file: l.slice(3), status: '?', add: '', del: '', uncommitted: true })
    }
    for (const f of files.values()) f.uncommitted = pending.has(f.file)
    return { path, branch: wt.branch, mergeBase: mb, commits, files: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)) }
  }

  async diff(repo: string, path: string, file: string): Promise<string> {
    const wt = await this.find(repo, path)
    const mb = await this.mergeBase(repo, path, wt)
    const untracked = (await this.git(path, 'ls-files', '--others', '--exclude-standard', '--', file)).trim()
    const out = untracked
      ? (await this.run('git', ['-C', path, 'diff', '--no-index', '--', '/dev/null', file])).stdout
      : await this.git(path, 'diff', mb, '--', file)
    return out.slice(0, MAX_DIFF)
  }

  // --- actions ---------------------------------------------------------------

  async openIde(repo: string, path: string, ide: string): Promise<string> {
    await this.find(repo, path)
    if (!IDES.includes(ide)) throw new EngineError('unknown IDE')
    if (ide === 'Finder') await this.must('open', [path])
    else await this.must(this.bin, ['open', path, '-i', ide], repo)
    return 'ok'
  }

  async remove(repo: string, path: string, force: boolean): Promise<string> {
    if ((await this.find(repo, path)).main) throw new EngineError('that is the main checkout')
    const r = await this.run(this.bin, ['rm', path, ...(force ? ['--force'] : [])], repo)
    const msg = (r.stderr || r.stdout).trim()
    if (r.code !== 0) throw new EngineError(msg.replace(/^agent-wt: /, ''))
    return msg
  }

  async merge(repo: string, path: string): Promise<string> {
    const wt = await this.find(repo, path)
    if (wt.main || !wt.branch) throw new EngineError('nothing to merge')
    if ((await this.git(repo, 'status', '--porcelain', '--untracked-files=no')).trim()) {
      throw new EngineError('the main checkout has uncommitted changes')
    }
    if (wt.changes) throw new EngineError('the worktree has uncommitted changes')
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
    if (req.agent) args.push('-a', req.agent)
    if (req.base) args.push('-f', req.base)
    const out = await this.must(this.bin, args, repo)
    const path = out.trim().split('\n').pop() ?? ''
    return { path, command: req.agent ? this.launchCommand(path, req.agent, req.prompt) : null }
  }

  /** Shell command that starts `agent` inside the worktree at `path`. */
  launchCommand(path: string, agent: string, prompt?: string): string {
    const parts = [this.bin, 'open', path, '-a', agent]
    if (prompt) parts.push('-p', prompt)
    return `cd ${shellQuote(path)} && ${parts.map(shellQuote).join(' ')}`
  }
}

export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir).filter((n) => !n.startsWith('.')) } catch { return [] }
}
