import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { AGENTS, AI_APP_LIST, BIN_PATH_GUARD, EDITORS, TERMINALS, type AppSpec } from './catalog.ts'
import type { InstalledTools } from './types.ts'

// What is on this machine, from the catalog: agent CLIs, editors, terminals and AI apps.
// Nothing to pick by hand: the onboarding shows what is here, and the scanner already watches all of it.

const WIN = process.platform === 'win32'

/** Folders where agent CLIs land besides the PATH: npm, pnpm, bun, volta, nvm, pipx/uv, cargo, Homebrew. */
export function binDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const extra = WIN
    ? [env.APPDATA && join(env.APPDATA, 'npm'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'pnpm'), join(home, '.bun', 'bin'),
      join(home, '.local', 'bin'), join(home, '.cargo', 'bin'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Python')]
    : ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin'), join(home, '.cargo', 'bin'), join(home, '.deno', 'bin'), join(home, 'Library', 'pnpm'),
      join(home, '.local', 'share', 'pnpm'), join(home, 'go', 'bin'), join(home, '.claude', 'local'), join(home, '.opencode', 'bin')]
  // Every node version managed by nvm / fnm keeps its own global bin.
  for (const root of [join(home, '.nvm', 'versions', 'node'), join(home, '.local', 'share', 'fnm', 'node-versions')]) {
    try { for (const v of readdirSync(root)) extra.push(join(root, v, 'bin'), join(root, v, 'installation', 'bin')) } catch { /* not installed */ }
  }
  return [...new Set([...dirs, ...(extra.filter(Boolean) as string[])])]
}

function hasBin(bin: string, dirs: string[]): boolean {
  if (BIN_PATH_GUARD[bin]) return false // generic names (agent, pi, cn…) prove nothing on their own
  const names = WIN ? [`${bin}.exe`, `${bin}.cmd`, `${bin}.ps1`, bin] : [bin]
  return dirs.some((d) => names.some((n) => existsSync(join(d, n))))
}

function installedApp(spec: AppSpec, env: NodeJS.ProcessEnv, home: string): boolean {
  if (WIN) {
    const roots = [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean) as string[]
    return spec.win.some((rel) => roots.some((r) => existsSync(join(r, rel))))
  }
  const roots = ['/Applications', '/System/Applications', join(home, 'Applications'), join(home, 'Applications', 'JetBrains Toolbox')]
  return spec.mac.some((name) => roots.some((r) => existsSync(join(r, `${name}.app`))))
}

export function installedTools(env: NodeJS.ProcessEnv = process.env, home = homedir()): InstalledTools {
  const dirs = binDirs(env, home)
  return {
    // Installed (an executable we can find) or used (the folder it creates on first run).
    agents: AGENTS.filter((a) => a.bins.some((b) => hasBin(b, dirs)) || (a.config ?? []).some((c) => existsSync(join(home, c)))).map((a) => a.id),
    editors: EDITORS.filter((e) => installedApp(e, env, home)).map((e) => e.name),
    terminals: TERMINALS.filter((t) => installedApp(t, env, home)).map((t) => t.name),
    apps: AI_APP_LIST.filter((a) => installedApp(a, env, home)).map((a) => a.name),
  }
}
