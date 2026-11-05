// One-click setup of this computer, so agents get a branch of their own without manual steps:
//  - claude: the Claude Code plugin, registered from the folder that ships inside the app (no network)
//  - agents: the "one branch per task" rules in the instructions of the other agents that are installed
//  - shell:  agents typed in a terminal (zsh, bash; Git Bash and PowerShell on Windows) get their own branch
//  - cli:    the `ramify` command in new terminals
// Every step can be undone. Everything that touches the system goes through `ctx`, so tests use a
// temporary home and a fake runner, on macOS and on Windows.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { SetupItemId, SetupState } from './types.ts'

export type SetupRun = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>

export interface SetupContext {
  platform: NodeJS.Platform
  home: string
  /** The ramify script this app ships. */
  bin: string
  /** Folder with .claude-plugin/marketplace.json and the plugin it lists. */
  marketplace: string
  /** PATH of the user's login shell (the app's own PATH is minimal when started from Finder). */
  path: string
  /** The user's login shell ($SHELL): zsh or bash picks the startup file. */
  shell: string
  /** Git Bash (Windows only). */
  gitBash: string
  /** %LOCALAPPDATA% (Windows only). */
  localAppData?: string
  run: SetupRun
}

export const SETUP_ITEMS: SetupItemId[] = ['claude', 'agents', 'shell', 'cli']

const BLOCK_BEGIN = '# >>> ramify: one branch per agent >>>'
const BLOCK_END = '# <<< ramify: one branch per agent <<<'
const PATH_BEGIN = '# >>> ramify: command >>>'
const PATH_END = '# <<< ramify: command <<<'
const RULES_MARK = /\((ramify|agent-wt)\)/

const win = (ctx: SetupContext) => ctx.platform === 'win32'
/** Git Bash takes C:/x/ramify; backslashes would be escapes. */
const posix = (p: string) => p.replace(/\\/g, '/')
const read = (f: string) => { try { return readFileSync(f, 'utf8') } catch { return '' } }

/** Run the shipped ramify script (through Git Bash on Windows). */
function ramify(ctx: SetupContext, args: string[], env?: NodeJS.ProcessEnv) {
  return win(ctx) ? ctx.run(ctx.gitBash, [posix(ctx.bin), ...args], env) : ctx.run(ctx.bin, args, env)
}

async function must(p: ReturnType<SetupRun>, what: string) {
  const r = await p
  if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().split('\n').pop() || `exit ${r.code}`}`)
  return r.stdout
}

/** Remove a marked block (begin..end lines) from a text. */
export function withoutBlock(text: string, begin: string, end: string): string {
  const lines = text.split('\n')
  const same = (line: string, mark: string) => line.replace(/\r$/, '') === mark // CRLF files too
  const from = lines.findIndex((l) => same(l, begin))
  const to = from < 0 ? -1 : lines.findIndex((l, i) => i > from && same(l, end))
  // No block, or one whose end line is gone: leave the file as it is rather than cut the user's lines after it.
  if (to < 0) return text
  const out = [...lines.slice(0, from), ...lines.slice(to + 1)]
  // The blank line that set the block apart goes with it; the user's own blank lines elsewhere stay.
  if (from > 0 && out[from - 1]?.trim() === '' && out[from]?.trim() === '') out.splice(from, 1)
  return out.join('\n')
}

function appendBlock(file: string, begin: string, body: string, end: string) {
  const text = read(file)
  if (text.includes(begin)) return
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) copyFileSync(file, `${file}.bak-ramify`)
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}\n${begin}\n${body}\n${end}\n`)
}

function dropBlock(file: string, begin: string, end: string) {
  const text = read(file)
  if (!text.includes(begin)) return
  copyFileSync(file, `${file}.bak-ramify`)
  writeFileSync(file, withoutBlock(text, begin, end))
}

// --- claude ----------------------------------------------------------------------

/** `claude plugin list` lists ramify@ramify as enabled. */
export function pluginEnabled(list: string): boolean {
  const at = list.indexOf('ramify@ramify')
  if (at < 0) return false
  const block = list.slice(at).split(/\n\s*❯/)[0]
  return /enabled/i.test(block) && !/disabled/i.test(block)
}

/** Drop the ramify hooks an older setup wrote into ~/.claude/settings.json: the plugin has them now. */
export function withoutLegacyHooks(settings: Record<string, unknown>): { settings: Record<string, unknown>; changed: boolean } {
  const hooks = settings.hooks as Record<string, { hooks?: { command?: string }[] }[]> | undefined
  if (!hooks || typeof hooks !== 'object') return { settings, changed: false }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = Array.isArray(groups) ? groups.filter((g) => !(g.hooks ?? []).some((h) => /ramify["']?\s+hook\s/.test(h.command ?? ''))) : groups
    if (Array.isArray(groups) && kept.length !== groups.length) changed = true
    if (!Array.isArray(kept) || kept.length) next[event] = kept
  }
  const { hooks: _drop, ...rest } = settings
  return { settings: Object.keys(next).length ? { ...rest, hooks: next } : rest, changed }
}

async function claudeState(ctx: SetupContext): Promise<SetupState> {
  const r = await ctx.run('claude', ['plugin', 'list']).catch(() => null)
  if (!r || r.code !== 0) return { id: 'claude', status: 'unavailable' }
  return { id: 'claude', status: pluginEnabled(r.stdout) ? 'done' : 'todo' }
}

async function claudeApply(ctx: SetupContext) {
  await must(ctx.run('claude', ['plugin', 'marketplace', 'add', ctx.marketplace]), 'claude plugin marketplace add')
  await must(ctx.run('claude', ['plugin', 'install', 'ramify@ramify']), 'claude plugin install')
  const file = join(ctx.home, '.claude', 'settings.json')
  const text = read(file)
  if (!text) return
  const { settings, changed } = withoutLegacyHooks(JSON.parse(text))
  if (!changed) return
  copyFileSync(file, `${file}.bak-ramify`)
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
}

// --- agents (instructions) ---------------------------------------------------------

/** Instruction files of the agents that read them, as in `ramify install instructions`. */
export function instructionFiles(home: string): string[] {
  return [
    join(home, '.claude', 'CLAUDE.md'), join(home, '.codex', 'AGENTS.md'), join(home, '.gemini', 'GEMINI.md'),
    join(home, '.config', 'opencode', 'AGENTS.md'), join(home, '.copilot', 'copilot-instructions.md'), join(home, '.config', 'amp', 'AGENTS.md'),
  ].filter((f) => existsSync(dirname(f)))
}

function agentsState(ctx: SetupContext): SetupState {
  const files = instructionFiles(ctx.home)
  if (!files.length) return { id: 'agents', status: 'unavailable' }
  return { id: 'agents', status: files.every((f) => RULES_MARK.test(read(f))) ? 'done' : 'todo' }
}

// --- shell -------------------------------------------------------------------------

/** zsh or bash, as the ramify script picks it. */
export function shellRc(home: string, shell = ''): string {
  return join(home, shell.endsWith('bash') ? '.bashrc' : '.zshrc')
}

/** The agents `ramify shell-init` wraps, read from the shipped script so the list lives in one place. */
export function shellAgents(script: string): string[] {
  return (/^SHELL_AGENTS="([^"]*)"/m.exec(script)?.[1] ?? '').split(/\s+/).filter(Boolean)
}

/** PowerShell: each installed agent becomes a function that goes through `ramify run`, like shell-init. */
export function powershellBlock(gitBash: string, bin: string, agents: string[]): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  return [
    `$ramifyBash = ${q(gitBash)}; $ramifyBin = ${q(posix(bin))}`,
    `foreach ($a in @(${agents.map(q).join(', ')})) {`,
    '  if (Get-Command $a -CommandType Application -ErrorAction SilentlyContinue) {',
    '    Set-Item -Path "function:global:$a" -Value ([scriptblock]::Create("if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) { `$env:RAMIFY_INTERACTIVE = \'1\' }; & `$ramifyBash `$ramifyBin run $a @args; Remove-Item Env:RAMIFY_INTERACTIVE -ErrorAction SilentlyContinue"))',
    '  }',
    '}',
  ].join('\n')
}

/** Both PowerShell profiles (Windows PowerShell and PowerShell 7), asked to PowerShell itself: Documents may live in OneDrive. */
async function powershellProfiles(ctx: SetupContext): Promise<string[]> {
  const out: string[] = []
  for (const exe of ['powershell', 'pwsh']) {
    const r = await ctx.run(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserCurrentHost']).catch(() => null)
    const p = r?.code === 0 ? r.stdout.trim() : ''
    if (p) out.push(p)
  }
  return [...new Set(out)]
}

async function shellState(ctx: SetupContext): Promise<SetupState> {
  if (!win(ctx)) return { id: 'shell', status: read(shellRc(ctx.home, ctx.shell)).includes(BLOCK_BEGIN) ? 'done' : 'todo' }
  if (!existsSync(ctx.gitBash)) return { id: 'shell', status: 'unavailable' }
  const files = [join(ctx.home, '.bashrc'), ...await powershellProfiles(ctx)]
  return { id: 'shell', status: files.every((f) => read(f).includes(BLOCK_BEGIN)) ? 'done' : 'todo' }
}

async function shellApply(ctx: SetupContext) {
  if (!win(ctx)) { await must(ramify(ctx, ['install', 'shell'], { SHELL: ctx.shell }), 'ramify install shell'); return }
  await must(ramify(ctx, ['install', 'shell'], { SHELL: '/usr/bin/bash' }), 'ramify install shell')
  const body = powershellBlock(ctx.gitBash, ctx.bin, shellAgents(read(ctx.bin)))
  for (const f of await powershellProfiles(ctx)) appendBlock(f, BLOCK_BEGIN, body, BLOCK_END)
}

async function shellUndo(ctx: SetupContext) {
  if (!win(ctx)) { await must(ramify(ctx, ['uninstall', 'shell'], { SHELL: ctx.shell }), 'ramify uninstall shell'); return }
  await must(ramify(ctx, ['uninstall', 'shell'], { SHELL: '/usr/bin/bash' }), 'ramify uninstall shell')
  for (const f of await powershellProfiles(ctx)) dropBlock(f, BLOCK_BEGIN, BLOCK_END)
}

// --- cli -----------------------------------------------------------------------------

const cliDir = (ctx: SetupContext) => (win(ctx) ? join(ctx.localAppData ?? join(ctx.home, 'AppData', 'Local'), 'ramify', 'bin') : join(ctx.home, '.local', 'bin'))

/** Windows: `ramify` for PowerShell/cmd and for Git Bash, both handing over to the shipped script. */
export function windowsShims(gitBash: string, bin: string): { cmd: string; sh: string } {
  return { cmd: `@"${gitBash}" "${posix(bin)}" %*\r\n`, sh: `#!/bin/sh\nexec "${posix(bin)}" "$@"\n` }
}

/** PowerShell that adds (or removes) a folder in the user's PATH, the way installers do. */
export function userPathScript(dir: string, add: boolean): string {
  const d = dir.replace(/'/g, "''")
  // Read and written as stored in the registry: [Environment]::GetEnvironmentVariable expands %USERPROFILE% and the
  // like, and SetEnvironmentVariable writes plain REG_SZ, so every other entry would lose its variables for good.
  const open = "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true); " +
    "$p = [string]$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); " +
    "$kind = if ($k.GetValueNames() -contains 'Path') { $k.GetValueKind('Path') } else { 'ExpandString' }; "
  const write = add
    ? `if (-not (($p -split ';') -contains '${d}')) { $k.SetValue('Path', (((@($p -split ';') + '${d}') | Where-Object { $_ }) -join ';'), $kind) }; `
    : `$k.SetValue('Path', ((@($p -split ';') | Where-Object { $_ -and $_ -ne '${d}' }) -join ';'), $kind); `
  // Writing the registry tells no one: setting and clearing a variable through .NET announces the change to Windows.
  const announce = "$k.Close(); [Environment]::SetEnvironmentVariable('RAMIFY_PATH_CHANGED', '1', 'User'); [Environment]::SetEnvironmentVariable('RAMIFY_PATH_CHANGED', $null, 'User')"
  return open + write + announce
}

function linkTarget(f: string): string | null {
  try { return lstatSync(f).isSymbolicLink() ? readlinkSync(f) : null } catch { return null }
}

function cliState(ctx: SetupContext): SetupState {
  const dir = cliDir(ctx)
  if (win(ctx)) return { id: 'cli', status: existsSync(join(dir, 'ramify.cmd')) ? 'done' : 'todo' }
  // Already reachable (ours, or a developer's own link): nothing to do.
  const onPath = ctx.path.split(delimiter).some((d) => d && existsSync(join(d, 'ramify')))
  return { id: 'cli', status: onPath || linkTarget(join(dir, 'ramify')) === ctx.bin ? 'done' : 'todo' }
}

async function cliApply(ctx: SetupContext) {
  const dir = cliDir(ctx)
  mkdirSync(dir, { recursive: true })
  if (win(ctx)) {
    const s = windowsShims(ctx.gitBash, ctx.bin)
    writeFileSync(join(dir, 'ramify.cmd'), s.cmd)
    writeFileSync(join(dir, 'ramify'), s.sh)
    await must(ctx.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', userPathScript(dir, true)]), 'PATH')
    return
  }
  const link = join(dir, 'ramify')
  // Never replace a real file or a link someone else made: only ours, or nothing.
  if (existsSync(link) || linkTarget(link)) {
    if (linkTarget(link) !== ctx.bin) throw new Error(`${link} already exists and is not ramify's: left as it is`)
    rmSync(link)
  }
  symlinkSync(ctx.bin, link)
  if (!ctx.path.split(delimiter).includes(dir)) {
    appendBlock(shellRc(ctx.home, ctx.shell), PATH_BEGIN, 'export PATH="$HOME/.local/bin:$PATH"', PATH_END)
  }
}

async function cliUndo(ctx: SetupContext) {
  const dir = cliDir(ctx)
  if (win(ctx)) {
    rmSync(join(dir, 'ramify.cmd'), { force: true }); rmSync(join(dir, 'ramify'), { force: true })
    await must(ctx.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', userPathScript(dir, false)]), 'PATH')
    return
  }
  if (linkTarget(join(dir, 'ramify')) === ctx.bin) rmSync(join(dir, 'ramify'))
  dropBlock(shellRc(ctx.home, ctx.shell), PATH_BEGIN, PATH_END)
}

// --- public ------------------------------------------------------------------------

export async function setupStatus(ctx: SetupContext): Promise<SetupState[]> {
  return Promise.all([claudeState(ctx), Promise.resolve(agentsState(ctx)), shellState(ctx), Promise.resolve(cliState(ctx))])
}

/** Set up the given items (all that apply by default); one failing does not stop the others. */
export async function setupApply(ctx: SetupContext, items: SetupItemId[] = SETUP_ITEMS): Promise<SetupState[]> {
  const before = await setupStatus(ctx)
  const errors = new Map<SetupItemId, string>()
  for (const s of before) {
    if (!items.includes(s.id) || s.status !== 'todo') continue
    try {
      if (s.id === 'claude') await claudeApply(ctx)
      if (s.id === 'agents') await must(ramify(ctx, ['install', 'instructions']), 'ramify install instructions')
      if (s.id === 'shell') await shellApply(ctx)
      if (s.id === 'cli') await cliApply(ctx)
    } catch (e) { errors.set(s.id, (e as Error).message) }
  }
  return (await setupStatus(ctx)).map((s) => (errors.has(s.id) ? { ...s, error: errors.get(s.id) } : s))
}

export async function setupUndo(ctx: SetupContext, item: SetupItemId): Promise<SetupState[]> {
  if (item === 'claude') await must(ctx.run('claude', ['plugin', 'uninstall', 'ramify@ramify']), 'claude plugin uninstall')
  if (item === 'agents') await must(ramify(ctx, ['uninstall', 'instructions']), 'ramify uninstall instructions')
  if (item === 'shell') await shellUndo(ctx)
  if (item === 'cli') await cliUndo(ctx)
  return setupStatus(ctx)
}
