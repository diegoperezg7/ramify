import { execFile, spawn, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gitBash } from './engine.ts'
import type { Settings } from './types.ts'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, _out, stderr) => (err ? reject(new Error(String(stderr).trim() || err.message)) : resolve()))
  })
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Windows: Windows Terminal when installed, otherwise a console of its own for Git Bash. The command runs in Git Bash.
 * Nothing goes through cmd.exe, whose own rules (& | ^ and unbalanced quotes) would split or run parts of the command.
 */
export function windowsLaunch(command: string, cwd: string, bash: string, wt: string | null): { cmd: string; args: string[]; options: SpawnOptions } {
  const script = `${command}; exec bash --login -i`
  // wt.exe splits its own command line on ';' (new tab), even inside an argument: escape them.
  if (wt) return { cmd: wt, args: ['-d', cwd, bash, '--login', '-i', '-c', script.replace(/;/g, '\\;')], options: { detached: true, stdio: 'ignore' } }
  // detached on Windows: the child gets a console window of its own.
  return { cmd: bash, args: ['--login', '-i', '-c', script], options: { cwd, detached: true, stdio: 'ignore', windowsHide: false } }
}

async function openOnWindows(command: string, cwd: string): Promise<void> {
  const wt = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : ''
  const l = windowsLaunch(command, cwd, gitBash(), wt && existsSync(wt) ? wt : null)
  const child = spawn(l.cmd, l.args, l.options)
  await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', () => resolve()) })
  child.unref()
}

/** Run `command` in a new window of the user's terminal app. */
export async function openInTerminal(terminal: Settings['terminal'], command: string, cwd: string): Promise<void> {
  if (process.platform === 'win32') return openOnWindows(command, cwd)
  if (terminal === 'iTerm') {
    await run('osascript', [
      '-e', 'tell application "iTerm"',
      '-e', 'activate',
      '-e', 'set w to (create window with default profile)',
      '-e', `tell current session of w to write text ${appleScriptString(command)}`,
      '-e', 'end tell',
    ])
  } else if (terminal === 'Ghostty') {
    await run('open', ['-na', 'Ghostty', '--args', `--working-directory=${cwd}`, '-e', '/bin/zsh', '-lc', `${command}; exec /bin/zsh -l`])
  } else {
    await run('osascript', [
      '-e', 'tell application "Terminal"',
      '-e', 'activate',
      '-e', `do script ${appleScriptString(command)}`,
      '-e', 'end tell',
    ])
  }
}
