import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { createHandlers, dispatch, Engine, IDES } from '../../../packages/core/src/index.ts'
import { webviewHtml } from './html.ts'

let panel: vscode.WebviewPanel | undefined
let ready = false
const queued: unknown[] = []

export function activate(ctx: vscode.ExtensionContext) {
  const bin = join(ctx.extensionPath, 'bin', 'ramify')
  const engine = new Engine({ bin })

  const repoOf = async (): Promise<string | null> => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return folder ? engine.mainCheckout(folder) : null
  }

  // Status bar: how many agents are working in this repository right now.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  status.command = 'ramify.open'
  ctx.subscriptions.push(status)
  const refreshStatus = async () => {
    const repo = await repoOf()
    if (!repo) { status.hide(); return }
    try {
      const wts = await engine.worktrees(repo)
      const live = wts.filter((w) => !w.main && w.running.length).length
      const total = wts.length - 1
      status.text = `$(git-branch) Ramify ${total}${live ? ` · $(pulse) ${live}` : ''}`
      status.tooltip = `${total} worktrees, ${live} agents working`
      status.show()
    } catch { status.hide() }
  }
  void refreshStatus()
  const timer = setInterval(refreshStatus, 5000)
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) })

  const terminal = (name: string, cwd: string, command: string) => {
    const term = vscode.window.createTerminal({ name: `Ramify · ${name}`, cwd })
    term.show()
    term.sendText(command)
  }

  const handlers = {
    ...createHandlers({
      engine,
      capabilities: { host: 'vscode', multiRepo: false, create: true, settings: false, github: false, timeline: true, ides: IDES },
      repo: () => need(repoOf),
      runInTerminal: terminal,
      // "VS Code" / "Cursor" mean this editor: open the worktree in a new window of it.
      openFolder: { ides: ['code', 'cursor'], open: async (path) => { await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), { forceNewWindow: true }) } },
    }),
    repos: () => [],
  }

  const open = async () => {
    if (panel) { panel.reveal(); return }
    const ui = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'ui')
    panel = vscode.window.createWebviewPanel('ramify', 'Ramify', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [ui],
    })
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png')
    panel.webview.html = webviewHtml(readFileSync(join(ui.fsPath, 'index.html'), 'utf8'), panel.webview.asWebviewUri(ui).toString(), panel.webview.cspSource)
    panel.webview.onDidReceiveMessage(async (msg: { id: number; method: string; args: unknown[] }) => {
      // The first request means the UI is listening: deliver anything queued before that.
      if (!ready) { ready = true; for (const m of queued.splice(0)) void panel?.webview.postMessage(m) }
      try {
        const result = await dispatch(handlers, msg.method, msg.args)
        void panel?.webview.postMessage({ id: msg.id, result })
      } catch (e) {
        void panel?.webview.postMessage({ id: msg.id, error: (e as Error).message })
      }
    })
    panel.onDidDispose(() => { panel = undefined; ready = false })
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand('ramify.open', open),
    vscode.commands.registerCommand('ramify.new', async () => {
      await open()
      if (ready) void panel?.webview.postMessage({ command: 'new' })
      else queued.push({ command: 'new' })
    }),
  )
}

async function need(repoOf: () => Promise<string | null>): Promise<string> {
  const repo = await repoOf()
  if (!repo) throw new Error('Open a folder that is inside a git repository')
  return repo
}

export function deactivate() {}
