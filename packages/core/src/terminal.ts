import { execFile } from 'node:child_process'
import type { Settings } from './types.ts'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, _out, stderr) => (err ? reject(new Error(String(stderr).trim() || err.message)) : resolve()))
  })
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Run `command` in a new window of the user's terminal app (macOS). */
export async function openInTerminal(terminal: Settings['terminal'], command: string, cwd: string): Promise<void> {
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
