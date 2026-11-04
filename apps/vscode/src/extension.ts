import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { Engine, IDES } from '../../../packages/core/src/index.ts'
import type { Capabilities, CreateRequest } from '../../../packages/core/src/types.ts'

let panel: vscode.WebviewPanel | undefined

export function activate(ctx: vscode.ExtensionContext) {
  const bin = join(ctx.extensionPath, 'bin', 'agent-wt')
  const engine = new Engine({ bin })

  const repoOf = async (): Promise<string | null> => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return folder ? engine.mainCheckout(folder) : null
  }

  // Status bar: how many agents are working in this repository right now.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  status.command = 'agentWt.open'
  ctx.subscriptions.push(status)
  const refreshStatus = async () => {
    const repo = await repoOf()
    if (!repo) { status.hide(); return }
    try {
      const wts = await engine.worktrees(repo)
      const live = wts.filter((w) => !w.main && w.running.length).length
      const total = wts.length - 1
      status.text = `$(git-branch) agent-wt ${total}${live ? ` · $(pulse) ${live}` : ''}`
      status.tooltip = `${total} worktrees, ${live} agents working`
      status.show()
    } catch { status.hide() }
  }
  void refreshStatus()
  const timer = setInterval(refreshStatus, 5000)
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) })

  const terminal = (name: string, cwd: string, command: string) => {
    const term = vscode.window.createTerminal({ name: `agent-wt · ${name}`, cwd })
    term.show()
    term.sendText(command)
  }

  const handlers: Record<string, (...args: never[]) => unknown> = {
    capabilities: (): Capabilities => ({ host: 'vscode', multiRepo: false, create: true, settings: false, github: false, ides: IDES }),
    state: async () => engine.state(await need(repoOf)),
    worktree: async (_r: string, path: string) => engine.worktree(await need(repoOf), path),
    diff: async (_r: string, path: string, file: string) => ({ diff: await engine.diff(await need(repoOf), path, file) }),
    open: async (_r: string, path: string, ide: string) => {
      const repo = await need(repoOf)
      if (ide === 'code' || ide === 'cursor') {
        // "This editor": open the worktree in a new window of the same app.
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), { forceNewWindow: true })
        return { message: path }
      }
      return { message: await engine.openIde(repo, path, ide) }
    },
    merge: async (_r: string, path: string) => ({ message: await engine.merge(await need(repoOf), path) }),
    remove: async (_r: string, path: string, force: boolean) => ({ message: await engine.remove(await need(repoOf), path, force) }),
    create: async (_r: string, req: CreateRequest) => {
      const created = await engine.create(await need(repoOf), req)
      if (created.command) terminal(req.branch, created.path, created.command)
      return { path: created.path, message: req.branch }
    },
    launch: async (_r: string, path: string, agent: string, prompt?: string) => {
      const repo = await need(repoOf)
      if (!(await engine.worktrees(repo)).some((w) => w.path === path)) throw new Error('unknown worktree')
      terminal(agent, path, engine.launchCommand(path, agent, prompt))
      return { message: agent }
    },
    repos: () => [],
  }

  const open = async () => {
    if (panel) { panel.reveal(); return }
    const ui = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'ui')
    panel = vscode.window.createWebviewPanel('agentWt', 'agent-wt', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [ui],
    })
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png')
    panel.webview.html = html(panel.webview, ui)
    panel.webview.onDidReceiveMessage(async (msg: { id: number; method: string; args: unknown[] }) => {
      try {
        const fn = handlers[msg.method]
        if (!fn) throw new Error(`not available in the editor: ${msg.method}`)
        const result = await (fn as (...a: unknown[]) => unknown)(...msg.args)
        void panel?.webview.postMessage({ id: msg.id, result })
      } catch (e) {
        void panel?.webview.postMessage({ id: msg.id, error: (e as Error).message })
      }
    })
    panel.onDidDispose(() => { panel = undefined })
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand('agentWt.open', open),
    vscode.commands.registerCommand('agentWt.new', async () => {
      await open()
      void panel?.webview.postMessage({ command: 'new' })
    }),
  )
}

async function need(repoOf: () => Promise<string | null>): Promise<string> {
  const repo = await repoOf()
  if (!repo) throw new Error('Open a folder that is inside a git repository')
  return repo
}

function html(webview: vscode.Webview, ui: vscode.Uri): string {
  const base = webview.asWebviewUri(ui).toString()
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `script-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${webview.cspSource} https://fonts.gstatic.com`,
  ].join('; ')
  return readFileSync(join(ui.fsPath, 'index.html'), 'utf8')
    .replace(/ crossorigin/g, '')
    .replace(/(src|href)="\.\/assets\//g, `$1="${base}/assets/`)
    .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)
}

export function deactivate() {}
