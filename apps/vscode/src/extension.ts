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
  // One refresh at a time: with a slow repository, calls every 5 s would pile up and answer out of order.
  let refreshing = false
  const refreshStatus = async () => {
    if (refreshing) return
    refreshing = true
    try { await showStatus() } finally { refreshing = false }
  }
  const showStatus = async () => {
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

  // A message for the dashboard panel: sent now when its page listens, or as soon as it does.
  const toPanel = (msg: object) => {
    if (ready) void panel?.webview.postMessage(msg)
    else queued.push(msg)
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
    // From the side bar: open the dashboard, on a commit or on the new worktree form.
    dashboard: async (action: string, hash?: string) => {
      await open()
      if (action === 'new') toPanel({ command: 'new' })
      else if (typeof hash === 'string' && /^[0-9a-f]{4,64}$/i.test(hash)) toPanel({ command: 'commit', hash })
    },
  }

  const ui = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'ui')
  const page = (webview: vscode.Webview, mode?: 'sidebar') =>
    webviewHtml(readFileSync(join(ui.fsPath, 'index.html'), 'utf8'), webview.asWebviewUri(ui).toString(), webview.cspSource, mode)
  // Both pages ask the same handlers; `first` runs on a page's first request (it is listening from then on).
  const answer = (webview: vscode.Webview, first?: () => void) => webview.onDidReceiveMessage(async (msg: { id: number; method: string; args: unknown[] }) => {
    first?.()
    try {
      void webview.postMessage({ id: msg.id, result: await dispatch(handlers, msg.method, msg.args) })
    } catch (e) {
      void webview.postMessage({ id: msg.id, error: (e as Error).message })
    }
  })

  const open = async () => {
    if (panel) { panel.reveal(); return }
    panel = vscode.window.createWebviewPanel('ramify', 'Ramify', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [ui],
    })
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png')
    panel.webview.html = page(panel.webview)
    const webview = panel.webview
    answer(webview, () => { if (!ready) { ready = true; for (const m of queued.splice(0)) void webview.postMessage(m) } })
    // What was waiting for this page goes with it: a closed panel must not replay it in the next one.
    panel.onDidDispose(() => { panel = undefined; ready = false; queued.length = 0 })
  }

  // Activity bar: the branch tree of this repository in the side bar, the dashboard a click away.
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('ramify.home', {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true, localResourceRoots: [ui] }
      view.webview.html = page(view.webview, 'sidebar')
      ctx.subscriptions.push(answer(view.webview))
    },
  }))

  ctx.subscriptions.push(
    vscode.commands.registerCommand('ramify.open', open),
    vscode.commands.registerCommand('ramify.new', () => handlers.dashboard('new')),
  )
}

async function need(repoOf: () => Promise<string | null>): Promise<string> {
  const repo = await repoOf()
  if (!repo) throw new Error('Open a folder that is inside a git repository')
  return repo
}

export function deactivate() {}
