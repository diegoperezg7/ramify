import { execFile, spawn } from 'node:child_process'
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

/** Windows: Windows Terminal when installed, otherwise a Git Bash console. The command runs in Git Bash. */
async function openOnWindows(command: string, cwd: string): Promise<void> {
  const bash = gitBash()
  const args = ['--login', '-i', '-c', `${command}; exec bash --login -i`]
  const wt = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : ''
  const child = wt && existsSync(wt)
    ? spawn(wt, ['-d', cwd, bash, ...args], { detached: true, stdio: 'ignore' })
    : spawn('cmd.exe', ['/c', 'start', '"Ramify"', bash, ...args], { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: false })
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
