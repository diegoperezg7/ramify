// End-to-end: the real web UI against a real repository, in two hosts.
//  - browser: ui/server.py (what `ramify ui` starts)
//  - editor:  the VS Code webview protocol, answered by the same handlers the extension uses
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, type Browser } from 'playwright'
import { createHandlers, dispatch } from '../src/host.ts'
import { Engine, IDES } from '../src/engine.ts'

const ROOT_DIR = resolve(import.meta.dirname, '../../..')
const BIN = join(ROOT_DIR, 'ramify')
const DIST = join(ROOT_DIR, 'ui', 'dist')
const T = realpathSync(mkdtempSync(join(tmpdir(), 'ramify-e2e-')))
const REPO = join(T, 'shop')
const env = {
  ...process.env, RAMIFY_ROOT: join(T, 'wts'), NO_COLOR: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
}
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { env })
const aw = (...a: string[]) => execFileSync(BIN, a, { cwd: REPO, env }).toString()

let browser: Browser
let py: ChildProcess
let web: Server

before(async () => {
  git(T, 'init', '-q', '-b', 'main', REPO)
  writeFileSync(join(REPO, 'a.txt'), 'one\n')
  git(REPO, 'add', '.')
  git(REPO, 'commit', '-qm', 'Initial storefront')
  aw('new', 'feat/checkout', '-a', 'claude', '--no-launch')
  const wt = join(T, 'wts', 'shop', 'feat-checkout')
  writeFileSync(join(wt, 'pay.ts'), 'export const pay = 1\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-qm', 'Stripe payment intent')
  writeFileSync(join(wt, 'draft.ts'), 'wip\n')

  py = spawn('python3', ['-I', 'server.py', '--main', REPO, '--bin', BIN, '--port', '4978', '--token', 'tok'], { cwd: join(ROOT_DIR, 'ui'), env, stdio: 'ignore' })
  web = createServer((req, res) => {
    const rel = (req.url ?? '/').split('?')[0].replace(/^\/+/, '') || 'index.html'
    const file = join(DIST, rel)
    if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404).end(); return }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  }).listen(4979, '127.0.0.1')
  browser = await chromium.launch()
  for (let i = 0; i < 50; i++) {
    try { await fetch('http://127.0.0.1:4978/'); break } catch { await new Promise((r) => setTimeout(r, 200)) }
  }
})

after(async () => {
  await browser?.close()
  py?.kill()
  web?.close()
  rmSync(T, { recursive: true, force: true })
})

describe('web UI', () => {
  it('browser host: shows worktrees, the branch tree and a diff', async () => {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('http://127.0.0.1:4978/#token=tok')
    await page.waitForSelector('.graph-row:has-text("Stripe payment intent")')
    assert.match(await page.textContent('.metrics') ?? '', /1\s*worktrees/)
    await page.click('.wt-row:has-text("feat/checkout")')
    await page.waitForSelector('.file:has-text("draft.ts")')
    await page.click('.file:has-text("pay.ts")')
    // GitHub-style rows: the added line sits in a green row with its new line number.
    assert.match(await (await page.waitForSelector('.diff .dl-add')).textContent() ?? '', /export const pay = 1/)
    assert.deepEqual(errors, [])
    await page.close()
  })

  it('browser host: language and theme switch', async () => {
    const page = await browser.newPage({ locale: 'en-US', colorScheme: 'light' })
    await page.goto('http://127.0.0.1:4978/#token=tok')
    await page.waitForSelector('.graph-row')
    await page.click('.popover-anchor > button')
    await page.click('.choice button:has-text("Español")')
    await page.waitForSelector('.pane-head h2:has-text("Árbol de ramas")')
    await page.click('.theme-toggle')
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark')
    assert.ok(await page.$('.theme-toggle svg.lucide-moon'))
    await page.close()
  })

  it('nothing is clipped from 390px to 1920px', async () => {
    for (const width of [390, 768, 1024, 1280, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 860 } })
      await page.goto('http://127.0.0.1:4978/#token=tok')
      await page.waitForSelector('.graph-row')
      await page.click('.wt-row:has-text("feat/checkout")')
      await page.waitForTimeout(300)
      const clipped = await page.evaluate(() => {
        const out: string[] = []
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('page')
        for (const el of document.querySelectorAll('.topbar *, .pane *, .statusbar *')) {
          const box = el.closest('.pane, .topbar, .statusbar') as HTMLElement
          if (getComputedStyle(box).display === 'none' || el.closest('.graph-scroll')) continue
          const rc = el.getBoundingClientRect()
          if (rc.width && rc.right > box.getBoundingClientRect().right + 1) out.push(String((el as HTMLElement).className))
        }
        // Column headers must fit their own column (a narrow graph column once let "Graph" run into "Description").
        for (const cell of document.querySelectorAll('.graph-cols > span')) {
          const c = cell as HTMLElement
          if (c.offsetWidth && c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).textOverflow !== 'ellipsis') out.push(`header ${c.textContent}`)
          const next = c.nextElementSibling as HTMLElement | null
          if (next?.offsetWidth && c.getBoundingClientRect().right > next.getBoundingClientRect().left + 1) out.push(`header overlap ${c.textContent}`)
        }
        return out
      })
      assert.deepEqual(clipped, [], `clipped at ${width}px`)
      await page.close()
    }
  })

  it('editor host: create a worktree from the UI and launch the agent in a terminal', async () => {
    const launched: { cwd: string; command: string }[] = []
    const handlers = createHandlers({
      engine: new Engine({ bin: BIN, env }),
      capabilities: { host: 'vscode', multiRepo: false, create: true, settings: false, github: false, timeline: true, ides: IDES },
      repo: () => REPO,
      runInTerminal: (_n, cwd, command) => { launched.push({ cwd, command }) },
    })
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 860 } })
    await page.exposeFunction('__host', (method: string, args: unknown[]) =>
      dispatch(handlers, method, args).then((result) => ({ result }), (e: Error) => ({ error: e.message })))
    await page.addInitScript(() => {
      const w = window as unknown as { acquireVsCodeApi: () => unknown; __host: (m: string, a: unknown[]) => Promise<{ result?: unknown; error?: string }> }
      w.acquireVsCodeApi = () => ({
        postMessage: (msg: { id: number; method: string; args: unknown[] }) => {
          void w.__host(msg.method, msg.args).then((r) => window.postMessage({ id: msg.id, ...r }, '*'))
        },
      })
    })
    await page.goto('http://127.0.0.1:4979/index.html')
    await page.waitForSelector('.graph-row')
    await page.click('.new-btn')
    await page.fill('.form input >> nth=0', 'feat/wishlist')
    await page.click('.agent-option:has-text("codex")')
    await page.fill('.form textarea', "add a wishlist, it's fine")
    await page.click('.form button[type=submit]')
    await page.waitForSelector('.wt-row:has-text("feat/wishlist")', { timeout: 20000 })
    assert.equal(launched.length, 1)
    assert.match(launched[0].command, /open .*feat-wishlist -a codex -p 'add a wishlist, it'\\''s fine'$/)
    assert.ok(existsSync(join(T, 'wts', 'shop', 'feat-wishlist', '.worktree.env')))
    await page.close()
  })

  it('editor host: the branch timeline shows each branch from its fork to its merge', async () => {
    // A branch merged into main and deleted, rebuilt from its merge commit.
    git(REPO, 'checkout', '-qb', 'fix/typo')
    writeFileSync(join(REPO, 'typo.txt'), 'fixed\n')
    git(REPO, 'add', '.')
    git(REPO, 'commit', '-qm', 'Fix typo')
    git(REPO, 'checkout', '-q', 'main')
    git(REPO, 'merge', '--no-ff', '-q', '-m', "Merge branch 'fix/typo'", 'fix/typo')
    git(REPO, 'branch', '-qd', 'fix/typo')
    const handlers = createHandlers({
      engine: new Engine({ bin: BIN, env }),
      capabilities: { host: 'vscode', multiRepo: false, create: true, settings: false, github: false, timeline: true, ides: IDES },
      repo: () => REPO,
      runInTerminal: () => {},
    })
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 860 } })
    await page.exposeFunction('__host', (method: string, args: unknown[]) =>
      dispatch(handlers, method, args).then((result) => ({ result }), (e: Error) => ({ error: e.message })))
    await page.addInitScript(() => {
      const w = window as unknown as { acquireVsCodeApi: () => unknown; __host: (m: string, a: unknown[]) => Promise<{ result?: unknown; error?: string }> }
      w.acquireVsCodeApi = () => ({
        postMessage: (msg: { id: number; method: string; args: unknown[] }) => {
          void w.__host(msg.method, msg.args).then((r) => window.postMessage({ id: msg.id, ...r }, '*'))
        },
      })
    })
    await page.goto('http://127.0.0.1:4979/index.html')
    await page.waitForSelector('.graph-row')
    await page.click('.view-tabs button:has-text("Timeline")')
    await page.waitForSelector('.tl-branch')
    const labels = await page.locator('.tl-label .tl-name').allTextContents()
    assert.ok(labels.includes('feat/checkout'), labels.join(','))
    assert.ok(labels.includes('fix/typo'), 'merged and deleted branch is rebuilt')
    assert.equal(await page.locator('.tl-label.is-merged .tl-name').first().textContent(), 'fix/typo')
    // The merged branch draws its merge back into main; the open one has its commits.
    assert.ok(await page.locator('.tl-branch.is-merged .tl-merge').count() >= 1)
    assert.ok(await page.locator('.tl-branch.is-active .tl-dot').count() >= 1)
    // Nothing overflows the plot horizontally.
    const overflow = await page.evaluate(() => { const p = document.querySelector('.tl-plot')!; return p.scrollWidth - p.clientWidth })
    assert.ok(overflow <= 1, `plot overflows by ${overflow}px`)
    await page.close()
  })
})
