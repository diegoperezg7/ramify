import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { AGENT_PROCESSES } from './projects.ts'

// What is installed on this machine: agent CLIs on the PATH, editors, terminals and AI apps.
// Nothing to pick by hand: the onboarding shows what is here, and the scanner already watches all of it.

import type { InstalledTools } from './types.ts'

const WIN = process.platform === 'win32'

/** name → macOS bundle names / Windows executables (relative to the usual install folders). */
const EDITORS: Record<string, { mac: string[]; win: string[] }> = {
  'VS Code': { mac: ['Visual Studio Code'], win: ['Programs/Microsoft VS Code/Code.exe', 'Microsoft VS Code/Code.exe'] },
  Cursor: { mac: ['Cursor'], win: ['Programs/cursor/Cursor.exe'] },
  Windsurf: { mac: ['Windsurf'], win: ['Programs/Windsurf/Windsurf.exe'] },
  Zed: { mac: ['Zed'], win: ['Programs/Zed/zed.exe'] },
  Xcode: { mac: ['Xcode'], win: [] },
  'IntelliJ IDEA': { mac: ['IntelliJ IDEA', 'IntelliJ IDEA CE'], win: [] },
  PyCharm: { mac: ['PyCharm', 'PyCharm CE'], win: [] },
  WebStorm: { mac: ['WebStorm'], win: [] },
  'Android Studio': { mac: ['Android Studio'], win: ['Android/Android Studio/bin/studio64.exe'] },
  Trae: { mac: ['Trae'], win: ['Programs/Trae/Trae.exe'] },
  Kiro: { mac: ['Kiro'], win: ['Programs/Kiro/Kiro.exe'] },
}
const TERMINALS: Record<string, { mac: string[]; win: string[] }> = {
  Terminal: { mac: ['Utilities/Terminal'], win: [] },
  iTerm: { mac: ['iTerm'], win: [] },
  Ghostty: { mac: ['Ghostty'], win: [] },
  Warp: { mac: ['Warp'], win: ['Programs/Warp/warp.exe'] },
  WezTerm: { mac: ['WezTerm'], win: ['WezTerm/wezterm-gui.exe'] },
  Alacritty: { mac: ['Alacritty'], win: ['Alacritty/alacritty.exe'] },
  'Windows Terminal': { mac: [], win: ['Microsoft/WindowsApps/wt.exe'] },
  'Git Bash': { mac: [], win: ['Git/git-bash.exe'] },
}
const APPS: Record<string, { mac: string[]; win: string[] }> = {
  ChatGPT: { mac: ['ChatGPT'], win: ['Programs/ChatGPT/ChatGPT.exe'] },
  Claude: { mac: ['Claude'], win: ['AnthropicClaude/claude.exe'] },
  Perplexity: { mac: ['Perplexity'], win: [] },
}

function onPath(cmd: string, env: NodeJS.ProcessEnv): boolean {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const names = WIN ? [`${cmd}.exe`, `${cmd}.cmd`, `${cmd}.bat`, cmd] : [cmd]
  return dirs.some((d) => names.some((n) => existsSync(join(d, n))))
}

function installed(spec: { mac: string[]; win: string[] }, env: NodeJS.ProcessEnv): boolean {
  if (WIN) {
    const roots = [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean) as string[]
    return spec.win.some((rel) => roots.some((r) => existsSync(join(r, rel))))
  }
  const roots = ['/Applications', '/System/Applications', join(homedir(), 'Applications')]
  return spec.mac.some((name) => roots.some((r) => existsSync(join(r, `${name}.app`))))
}

export function installedTools(env: NodeJS.ProcessEnv = process.env): InstalledTools {
  const pick = (table: Record<string, { mac: string[]; win: string[] }>) => Object.keys(table).filter((k) => installed(table[k], env))
  return {
    // cursor-agent is shown as "cursor": one name per tool.
    agents: [...new Set(AGENT_PROCESSES.filter((a) => onPath(a, env)).map((a) => (a === 'cursor-agent' ? 'cursor' : a)))],
    editors: pick(EDITORS),
    terminals: pick(TERMINALS),
    apps: pick(APPS),
  }
}
