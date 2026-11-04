import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { normPath } from './engine.ts'
import { AGENT_BINS, agentForBin, agentForScript } from './catalog.ts'
import type { GithubRepo } from './types.ts'

// Finding the projects a person works on: running agents, local clones and GitHub.

/** Every agent executable Ramify recognises (see catalog.ts). */
export const AGENT_PROCESSES = AGENT_BINS
const INTERPRETERS = /^(node|bun|deno|uv|[Pp]ython[\d.]*)$/

function out(cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, cwd, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** Id of the agent a process is (see catalog.ts), from its executable or, for interpreters, its script. */
export function agentOf(comm: string, args: string): string | null {
  const path = comm.replace(/\\/g, '/')
  const exe = basename(path).replace(/\.(exe|cmd)$/i, '')
  const direct = agentForBin(exe, path)
  if (direct) return direct
  if (!INTERPRETERS.test(exe)) return null
  for (const word of args.replace(/\\/g, '/').split(/\s+/).slice(1, 4)) {
    const byName = agentForBin(basename(word).replace(/\.(js|mjs|cjs|py)$/, ''), word)
    if (byName) return byName
    const byPackage = agentForScript(word)
    if (byPackage) return byPackage
  }
  return null
}

/** Working directory of every running agent process. */
export async function runningAgents(env?: NodeJS.ProcessEnv): Promise<{ agent: string; cwd: string }[]> {
  // `comm` is cut to 16 characters on macOS (/opt/homebrew/bi...), so read the executable from the full command line.
  const ps = await out('ps', ['-axww', '-o', 'pid=,args='], env)
  // A failed scan must not look like "every agent stopped" (that would fire false notifications).
  if (ps.code !== 0) throw new Error(`ps failed: ${ps.stderr.trim()}`)
  const agents = new Map<string, string>()
  for (const line of ps.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)(.*)$/.exec(line)
    if (!m || Number(m[1]) === process.pid) continue
    const agent = agentOf(m[2], `${m[2]}${m[3]}`)
    if (agent) agents.set(m[1], agent)
  }
  if (!agents.size) return []
  const lsof = await out('lsof', ['-a', '-d', 'cwd', '-p', [...agents.keys()].join(','), '-Fpn'], env)
  if (lsof.code !== 0 && !lsof.stdout) throw new Error(`lsof failed: ${lsof.stderr.trim()}`)
  const result: { agent: string; cwd: string }[] = []
  let pid = ''
  for (const line of lsof.stdout.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1)
    else if (line.startsWith('n') && agents.has(pid)) result.push({ agent: agents.get(pid)!, cwd: line.slice(1) })
  }
  return result
}

/** owner/name from a GitHub remote URL, or null. */
export function githubSlug(url: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export async function originSlug(repo: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const r = await out('git', ['-C', repo, 'config', '--get', 'remote.origin.url'], env)
  return r.code === 0 ? githubSlug(r.stdout) : null
}

const SKIP = new Set(['node_modules', 'Library', 'Pods', 'DerivedData', 'build', 'dist', '.build', 'vendor', '.venv', 'venv'])

/** Git repositories under `dir`, up to `depth` levels down. Does not descend into repositories. */
export function scanRepos(dir: string, depth = 3): string[] {
  const found: string[] = []
  const walk = (d: string, level: number) => {
    if (existsSync(join(d, '.git'))) { found.push(normPath(d)); return }
    if (level >= depth) return
    let names: string[] = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      if (n.startsWith('.') || SKIP.has(n)) continue
      const p = join(d, n)
      try { if (statSync(p).isDirectory()) walk(p, level + 1) } catch { /* unreadable */ }
    }
  }
  if (existsSync(dir)) walk(dir, 0)
  return found
}

export function defaultProjectsDir(): string {
  const home = homedir()
  return ['Proyectos', 'Projects', 'Developer', 'code', 'dev', 'src'].map((d) => join(home, d)).find(existsSync) ?? join(home, 'Projects')
}

export class GithubError extends Error {}

/** Repositories of the signed-in GitHub user, most recently pushed first (needs the gh CLI). */
export async function githubRepos(env?: NodeJS.ProcessEnv): Promise<Omit<GithubRepo, 'local' | 'added'>[]> {
  const r = await out('gh', ['repo', 'list', '--limit', '200', '--json',
    'nameWithOwner,url,description,isPrivate,isFork,isArchived,pushedAt,primaryLanguage'], env)
  if (r.code !== 0) {
    if (/not found|ENOENT/i.test(r.stderr) || r.code === 127) throw new GithubError('gh-missing')
    if (/auth|login/i.test(r.stderr)) throw new GithubError('gh-auth')
    throw new GithubError(r.stderr.trim() || 'gh failed')
  }
  type Raw = { nameWithOwner: string; url: string; description: string | null; isPrivate: boolean; isFork: boolean; isArchived: boolean; pushedAt: string; primaryLanguage: { name: string } | null }
  return (JSON.parse(r.stdout) as Raw[])
    .filter((x) => !x.isArchived)
    .map((x) => ({
      nameWithOwner: x.nameWithOwner, url: x.url, description: x.description ?? '', isPrivate: x.isPrivate,
      isFork: x.isFork, pushedAt: x.pushedAt, language: x.primaryLanguage?.name ?? null,
    }))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
}

export async function cloneGithub(nameWithOwner: string, intoDir: string, env?: NodeJS.ProcessEnv): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(nameWithOwner)) throw new GithubError('invalid repository name')
  const target = join(intoDir, nameWithOwner.split('/')[1])
  if (existsSync(target)) throw new GithubError(`${target} already exists`)
  const r = await out('gh', ['repo', 'clone', nameWithOwner, target], env)
  if (r.code !== 0) throw new GithubError(r.stderr.trim() || 'clone failed')
  return target
}

/** The pull request for `branch` on GitHub (open, merged or closed), or null. */
export async function pullRequestFor(slug: string, branch: string, env?: NodeJS.ProcessEnv): Promise<{ number: number; url: string; state: string; title: string } | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug) || !branch || branch.startsWith('-')) return null
  const r = await out('gh', ['pr', 'list', '--repo', slug, '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,url,state,title'], env)
  if (r.code !== 0) return null
  try { return (JSON.parse(r.stdout) as { number: number; url: string; state: string; title: string }[])[0] ?? null } catch { return null }
}

/**
 * Create a GitHub repository for a local repository that has no remote yet, and push it.
 * Refuses when there is already an origin or no commit to push.
 */
export async function publishGithub(repo: string, name: string, isPrivate: boolean, env?: NodeJS.ProcessEnv): Promise<string> {
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new GithubError('invalid repository name')
  if ((await out('git', ['-C', repo, 'remote'], env)).stdout.trim().split('\n').includes('origin')) throw new GithubError('this repository already has an origin remote')
  if ((await out('git', ['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD'], env)).code !== 0) throw new GithubError('nothing to push: the repository has no commits')
  const r = await out('gh', ['repo', 'create', name, isPrivate ? '--private' : '--public', '--source', repo, '--remote', 'origin', '--push'], env)
  if (r.code !== 0) {
    if (/not found|ENOENT/i.test(r.stderr) || r.code === 127) throw new GithubError('gh-missing')
    throw new GithubError(r.stderr.trim() || 'gh repo create failed')
  }
  return (await originSlug(repo, env)) ?? name
}
