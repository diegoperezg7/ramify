// End-to-end: the real web UI against a real repository, in two hosts.
//  - browser: ui/server.py (what `ramify ui` starts)
//  - editor:  the VS Code webview protocol, answered by the same handlers the extension uses
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer as netServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, type Browser } from 'playwright'
import { createHandlers, dispatch } from '../src/host.ts'
import { Engine, IDES } from '../src/engine.ts'
import type { AgentChild, AgentSession } from '../src/types.ts'

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
let PY = 0
let WEB = 0

/** A port nobody is listening on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = netServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

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

  // Ports come from the system, so the suite can run in several worktrees at once.
  PY = await freePort()
  py = spawn('python3', ['-I', 'server.py', '--main', REPO, '--bin', BIN, '--port', String(PY), '--token', 'tok'], { cwd: join(ROOT_DIR, 'ui'), env, stdio: 'ignore' })
  web = createServer((req, res) => {
    const rel = (req.url ?? '/').split('?')[0].replace(/^\/+/, '') || 'index.html'
    const file = join(DIST, rel)
    if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404).end(); return }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  }).listen(0, '127.0.0.1')
  await new Promise((r) => web.once('listening', r))
  WEB = (web.address() as { port: number }).port
  browser = await chromium.launch()
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PY}/`); break } catch { await new Promise((r) => setTimeout(r, 200)) }
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
    await page.goto(`http://127.0.0.1:${PY}/#token=tok`)
    await page.waitForSelector('.graph-row:has-text("Stripe payment intent")')
    assert.match(await page.textContent('.metrics') ?? '', /1\s*worktree(?!s)/) // singular for one
    await page.click('.wt-row:has-text("feat/checkout")')
    await page.waitForSelector('.file:has-text("draft.ts")')
    await page.click('.file:has-text("pay.ts")')
    // GitHub-style rows: the added line sits in a green row with its new line number.
    assert.match(await (await page.waitForSelector('.diff .dl-add')).textContent() ?? '', /export const pay = 1/)
    // The same commit view through ui/server.py.
    await page.click('.graph-row:has-text("Stripe payment intent")')
    await page.click('.commit-pane .file:has-text("pay.ts")')
    assert.match(await (await page.waitForSelector('.commit-pane .diff .dl-add')).textContent() ?? '', /export const pay = 1/)
    assert.deepEqual(errors, [])
    await page.close()
  })

  it('browser host: language and theme switch', async () => {
    const page = await browser.newPage({ locale: 'en-US', colorScheme: 'light' })
    await page.goto(`http://127.0.0.1:${PY}/#token=tok`)
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
      await page.goto(`http://127.0.0.1:${PY}/#token=tok`)
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
    await page.goto(`http://127.0.0.1:${WEB}/index.html`)
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

  it('editor host: the graph shows several branches at once, with each worktree\'s uncommitted work', async () => {
    git(REPO, 'checkout', '-qb', 'spike/search')
    writeFileSync(join(REPO, 'search.ts'), 'export const q = 1\n')
    git(REPO, 'add', '.')
    git(REPO, 'commit', '-qm', 'Search spike')
    git(REPO, 'checkout', '-q', 'main')
    const handlers = createHandlers({
      engine: new Engine({ bin: BIN, env }),
      capabilities: { host: 'vscode', multiRepo: false, create: true, settings: false, github: false, timeline: true, ides: IDES },
      repo: () => REPO,
      runInTerminal: () => {},
    })
    for (const scheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ locale: 'en-US', colorScheme: scheme, viewport: { width: 1280, height: 760 } })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.exposeFunction('__host', (method: string, args: unknown[]) =>
        dispatch(handlers, method, args).then((result) => ({ result }), (e: Error) => ({ error: e.message })))
      await page.addInitScript((theme: string) => {
        const w = window as unknown as { acquireVsCodeApi: () => unknown; __host: (m: string, a: unknown[]) => Promise<{ result?: unknown; error?: string }> }
        w.acquireVsCodeApi = () => ({
          postMessage: (msg: { id: number; method: string; args: unknown[] }) => {
            void w.__host(msg.method, msg.args).then((r) => window.postMessage({ id: msg.id, ...r }, '*'))
          },
        })
        // The editor marks its theme on the body, as VS Code and Cursor do.
        document.addEventListener('DOMContentLoaded', () => document.body.classList.add(`vscode-${theme}`))
      }, scheme)
      await page.goto(`http://127.0.0.1:${WEB}/index.html`)
      // A branch with a worktree and a plain local branch, side by side.
      await page.waitForSelector('.graph-row:has-text("Search spike") .ref-branch:has-text("spike/search")')
      assert.equal(await page.getAttribute('html', 'data-theme'), scheme)
      await page.waitForSelector('.graph-row:has-text("Stripe payment intent") .ref-branch:has-text("feat/checkout")')
      // feat/checkout has draft.ts uncommitted: shown on its tip.
      assert.match(await page.textContent('.graph-row:has-text("Stripe payment intent") .ref-pending') ?? '', /\+1 uncommitted/)
      assert.ok(await page.$('.node-pending'))
      if (process.env.RAMIFY_E2E_SHOTS) await page.screenshot({ path: join(process.env.RAMIFY_E2E_SHOTS, `graph-${scheme}.png`) })
      // Any commit opens: its files, the diff of one, then back through its parent.
      await page.click('.graph-row:has-text("Stripe payment intent")')
      await page.waitForSelector('.commit-pane .commit-subject:has-text("Stripe payment intent")')
      await page.click('.commit-pane .file:has-text("pay.ts")')
      assert.match(await (await page.waitForSelector('.commit-pane .diff .dl-add')).textContent() ?? '', /export const pay = 1/)
      if (process.env.RAMIFY_E2E_SHOTS) await page.screenshot({ path: join(process.env.RAMIFY_E2E_SHOTS, `commit-${scheme}.png`) })
      await page.click('.commit-pane .commit-parent')
      await page.waitForSelector('.commit-pane .commit-subject:has-text("Initial storefront")')
      assert.ok(await page.$('.graph-row.is-selected:has-text("Initial storefront")'))
      await page.keyboard.press('Escape')
      await page.waitForSelector('.commit-pane', { state: 'detached' })
      assert.deepEqual(errors, [])
      await page.close()
    }
    git(REPO, 'branch', '-qD', 'spike/search')
  })

  it('editor side bar: the branch tree in a narrow column, a commit opens in the dashboard', async () => {
    const asked: unknown[][] = []
    const handlers = {
      ...createHandlers({
        engine: new Engine({ bin: BIN, env }),
        capabilities: { host: 'vscode', multiRepo: false, create: true, settings: false, github: false, timeline: true, ides: IDES },
        repo: () => REPO,
        runInTerminal: () => {},
      }),
      dashboard: (...args: unknown[]) => { asked.push(args) },
    }
    const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 300, height: 700 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.exposeFunction('__host', (method: string, args: unknown[]) =>
      dispatch(handlers, method, args).then((result) => ({ result }), (e: Error) => ({ error: e.message })))
    await page.addInitScript(() => {
      const w = window as unknown as { acquireVsCodeApi: () => unknown; __host: (m: string, a: unknown[]) => Promise<{ result?: unknown; error?: string }> }
      w.acquireVsCodeApi = () => ({
        postMessage: (msg: { id: number; method: string; args: unknown[] }) => {
          void w.__host(msg.method, msg.args).then((r) => window.postMessage({ id: msg.id, ...r }, '*'))
        },
      })
      document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-dark'))
    })
    // The page the extension's side bar loads: index.html marked as the side bar (apps/vscode/src/html.ts).
    await page.route('**/index.html', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, body: (await res.text()).replace('<html', '<html data-mode="sidebar"') })
    })
    await page.goto(`http://127.0.0.1:${WEB}/index.html`)
    await page.waitForSelector('.side .graph-row:has-text("Stripe payment intent")')
    assert.equal(await page.$('.topbar'), null) // no dashboard chrome in the side bar
    assert.equal(await page.$('.list-pane'), null)
    if (process.env.RAMIFY_E2E_SHOTS) await page.screenshot({ path: join(process.env.RAMIFY_E2E_SHOTS, 'sidebar.png') })
    await page.click('.side .graph-row:has-text("Stripe payment intent")')
    await page.click('.side-actions button[aria-label="Nuevo agente"]')
    const hash = git(REPO, 'log', '-1', '--format=%H', '--grep=Stripe payment intent', '--all').toString().trim()
    assert.deepEqual(asked, [['open', hash], ['new', undefined]])
    assert.deepEqual(errors, [])
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
    await page.goto(`http://127.0.0.1:${WEB}/index.html`)
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

  it('desktop host: AI sessions without holes, a row opens its branch, the X closes a session', async () => {
    const now = Date.now()
    const session = (id: string, over: Partial<AgentSession>): AgentSession => ({
      id, key: id, agent: 'claude', host: 'Ghostty · tmux', via: 'terminal', inferred: false, cwd: REPO, repo: REPO,
      branch: 'main', github: 'o/shop', start: now - 3600_000, end: null, lastSeen: now, ...over,
    })
    const sessions = [
      session('working', { branch: 'feat/checkout', state: 'working', cwd: join(T, 'wts', 'shop', 'feat-checkout') }),
      session('paused', { state: 'idle', start: now - 7200_000 }),
      // Finished sessions in repositories not on GitHub: a tall "Not on GitHub" card.
      ...['a', 'b', 'c', 'd', 'e'].map((n) => session(`old-${n}`, { repo: `/tmp/${n}`, cwd: `/tmp/${n}`, github: null, end: now - 60_000 })),
    ]
    const closed: string[] = []
    const base = createHandlers({
      engine: new Engine({ bin: BIN, env }),
      capabilities: { host: 'desktop', multiRepo: true, create: false, settings: false, github: false, sessions: true, timeline: true, ides: IDES },
      repo: () => REPO,
      runInTerminal: () => {},
    })
    const handlers = {
      ...base,
      repos: () => [{ path: REPO, name: 'shop', worktrees: 1, active: ['claude'] }],
      sessions: () => sessions,
      closeSession: (id: string) => { closed.push(id); const s = sessions.find((x) => x.id === id); if (s) s.end = Date.now() },
    } as typeof base
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.exposeFunction('__host', (method: string, args: unknown[]) =>
      dispatch(handlers, method, args).then((result) => ({ result }), (e: Error) => ({ error: e.message })))
    await page.addInitScript(() => {
      const w = window as unknown as { ramify: unknown; __host: (m: string, a: unknown[]) => Promise<{ result?: unknown; error?: string }> }
      try { localStorage.setItem('ramify-view', 'sessions') } catch { /* no storage */ }
      w.ramify = {
        invoke: async (method: string, args: unknown[]) => {
          const r = await w.__host(method, args)
          if (r.error) throw new Error(r.error)
          return r.result
        },
        on: () => {},
      }
    })
    await page.goto(`http://127.0.0.1:${WEB}/index.html`)
    await page.waitForSelector('.repo-card li:has-text("feat/checkout")')

    // Only the session at work counts; the paused one is listed as paused.
    assert.equal((await page.textContent('.sess-summary span:first-child b'))?.trim(), '1')
    assert.ok(await page.isVisible('.repo-card li:has-text("idle")'))
    // "Not on GitHub" sits below the session cards, not in a column next to them: no empty space under short cards.
    assert.equal(await page.locator('.repo-cards .unpub-card').count(), 0)
    const cards = await page.locator('.repo-cards').boundingBox()
    const unpub = await page.locator('.unpub-card').boundingBox()
    assert.ok(cards && unpub && unpub.y >= cards.y + cards.height, 'Not on GitHub must come after the session cards')

    // The X closes the paused session without a reload.
    await page.locator('.repo-card li:has-text("idle") .row-close').click()
    await page.waitForSelector('.repo-card li:has-text("idle")', { state: 'detached' })
    assert.deepEqual(closed, ['paused'])

    // A row opens its repository on the branch it works on.
    await page.click('.repo-card li:has-text("feat/checkout")')
    await page.waitForSelector('.wt-row.is-selected:has-text("feat/checkout")')
    assert.deepEqual(errors, [])
    await page.close()
  })

  it('desktop host: the agents a session started are listed under it, and one opens its branch', async () => {
    const now = Date.now()
    const lead: AgentSession = {
      id: 'lead', key: 'pid:100', agent: 'claude', host: 'Ghostty', via: 'terminal', inferred: false, cwd: REPO, repo: REPO,
      branch: 'main', github: 'o/shop', start: now - 600_000, end: null, lastSeen: now, state: 'idle',
    }
    const children: Record<string, AgentChild[]> = {
      'pid:100': [
        { kind: 'subagent', id: 'a1', label: 'Explore', description: 'Find the parser', cwd: join(T, 'wts', 'shop', 'feat-checkout'), repo: REPO, branch: 'feat/checkout', working: true },
        { kind: 'teammate', id: '200', label: 'reviewer', description: 'code-reviewer', cwd: REPO, repo: REPO, branch: 'main', working: true },
      ],
    }
    const base = createHandlers({
      engine: new Engine({ bin: BIN, env }),
      capabilities: { host: 'desktop', multiRepo: true, create: false, settings: false, github: false, sessions: true, timeline: true, ides: IDES },
      repo: () => REPO,
      runInTerminal: () => {},
    })
    const handlers = {
      ...base,
      repos: () => [{ path: REPO, name: 'shop', worktrees: 1, active: ['claude'] }],
      sessions: () => [lead],
      agentChildren: () => children,
    } as typeof base
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.exposeFunction('__host', (method: string, args: unknown[]) =>
      dispatch(handlers, method, args).then((result) => ({ result }), (e: Error) => ({ error: e.message })))
    await page.addInitScript(() => {
      const w = window as unknown as { ramify: unknown; __host: (m: string, a: unknown[]) => Promise<{ result?: unknown; error?: string }> }
      try { localStorage.setItem('ramify-view', 'sessions') } catch { /* no storage */ }
      w.ramify = {
        invoke: async (method: string, args: unknown[]) => {
          const r = await w.__host(method, args)
          if (r.error) throw new Error(r.error)
          return r.result
        },
        on: () => {},
      }
    })
    await page.goto(`http://127.0.0.1:${WEB}/index.html`)
    await page.waitForSelector('.repo-card li.child-row:has-text("Find the parser")')

    // Both children sit right under their session, each with its kind and branch.
    const rows = await page.locator('.repo-card li').allTextContents()
    const at = rows.findIndex((r) => r.includes('idle'))
    assert.ok(at >= 0 && rows[at + 1].includes('subagent') && rows[at + 1].includes('feat/checkout'), rows.join(' | '))
    assert.ok(rows[at + 2].includes('reviewer') && rows[at + 2].includes('teammate'), rows.join(' | '))

    // A subagent row opens the branch it works on.
    await page.click('.repo-card li.child-row:has-text("Find the parser")')
    await page.waitForSelector('.wt-row.is-selected:has-text("feat/checkout")')
    assert.deepEqual(errors, [])
    await page.close()
  })
})
