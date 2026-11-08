import './isolate.ts'
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  pluginEnabled, powershellBlock, setupApply, setupStatus, setupUndo, shellAgents, userPathScript, windowsShims, withoutBlock, withoutLegacyHooks,
  type SetupContext, type SetupRun,
} from '../src/setup.ts'

const BIN = resolve(import.meta.dirname, '../../../ramify')
const home = () => mkdtempSync(join(tmpdir(), 'ramify-setup-'))

/** Claude Code stand-in: remembers what it was asked and lists the plugin once it is installed. */
function fakeClaude(calls: string[][]): SetupRun {
  let installed = false
  return async (cmd, args, env) => {
    if (cmd === 'claude') {
      calls.push(args)
      if (args[0] === 'plugin' && args[1] === 'install') installed = true
      if (args[0] === 'plugin' && args[1] === 'uninstall') installed = false
      const list = installed ? '  ❯ ramify@ramify\n    Version: 0.6.0\n    Status: ✔ enabled\n' : '  ❯ other@x\n    Status: ✔ enabled\n'
      return { code: 0, stdout: args[1] === 'list' ? list : '', stderr: '' }
    }
    if (cmd === 'powershell' || cmd === 'pwsh') { calls.push([cmd, ...args]); return { code: 1, stdout: '', stderr: 'not here' } }
    // The ramify script itself runs for real, inside the temporary home.
    return new Promise((ok) => execFile(cmd, args, { env: { ...process.env, ...env } }, (e, stdout, stderr) => ok({ code: e ? 1 : 0, stdout: String(stdout), stderr: String(stderr) })))
  }
}

const ctxFor = (h: string, run: SetupRun, over: Partial<SetupContext> = {}): SetupContext => ({
  platform: 'darwin', home: h, bin: BIN, marketplace: '/apps/Ramify/claude-marketplace', path: '/usr/bin:/bin', shell: '/bin/zsh', gitBash: '', run, ...over,
})

describe('setup: pieces', () => {
  it('reads whether the plugin is enabled from `claude plugin list`', () => {
    assert.equal(pluginEnabled('  ❯ ramify@ramify\n    Status: ✔ enabled\n  ❯ x@y\n    Status: ✘ disabled'), true)
    assert.equal(pluginEnabled('  ❯ ramify@ramify\n    Status: ✘ disabled'), false)
    assert.equal(pluginEnabled('  ❯ x@y\n    Status: ✔ enabled'), false)
  })

  it('drops only the old ramify hooks from Claude settings', () => {
    const s = { model: 'opus', hooks: {
      WorktreeCreate: [{ hooks: [{ command: '/Users/me/ramify hook create' }] }],
      Stop: [{ hooks: [{ command: 'say done' }] }],
    } }
    const { settings, changed } = withoutLegacyHooks(s)
    assert.equal(changed, true)
    assert.deepEqual(settings, { model: 'opus', hooks: { Stop: [{ hooks: [{ command: 'say done' }] }] } })
    const only = withoutLegacyHooks({ hooks: { WorktreeRemove: [{ hooks: [{ command: '"C:/x/ramify" hook remove' }] }] } })
    assert.deepEqual(only.settings, {})
    assert.equal(withoutLegacyHooks({ model: 'x' }).changed, false)
  })

  it('removes a marked block and nothing else', () => {
    assert.equal(withoutBlock('a\n\n# >>> b >>>\nx\n# <<< b <<<\nc\n', '# >>> b >>>', '# <<< b <<<'), 'a\n\nc\n')
  })

  it('takes the wrapped agents from the script, so the list lives in one place', () => {
    const agents = shellAgents(readFileSync(BIN, 'utf8'))
    assert.ok(agents.includes('claude') && agents.includes('codex') && agents.length > 10)
  })

  it('writes PowerShell functions that go through ramify run', () => {
    const b = powershellBlock("C:\\Program Files\\Git\\bin\\bash.exe", 'C:\\Users\\o\'neil\\ramify', ['claude', 'codex'])
    assert.match(b, /\$ramifyBin = 'C:\/Users\/o''neil\/ramify'/)
    assert.match(b, /@\('claude', 'codex'\)/)
    assert.match(b, /run \$a @args/)
    assert.match(b, /RAMIFY_INTERACTIVE/)
  })

  it('writes Windows launchers and PATH changes for the user only', () => {
    const s = windowsShims('C:\\Git\\bin\\bash.exe', 'C:\\App\\resources\\bin\\ramify')
    assert.equal(s.cmd, '@"C:\\Git\\bin\\bash.exe" "C:/App/resources/bin/ramify" %*\r\n')
    assert.match(s.sh, /exec "C:\/App\/resources\/bin\/ramify" "\$@"/)
    assert.match(userPathScript('C:\\Users\\me\\AppData\\Local\\ramify\\bin', true), /'User'/)
    assert.match(userPathScript('C:\\x', false), /-ne 'C:\\x'/)
  })
})

describe('setup: macOS and Linux', { skip: process.platform === 'win32' }, () => {
  it('sets everything up with one call and undoes each part', async () => {
    const h = home(), calls: string[][] = []
    mkdirSync(join(h, '.codex'))
    writeFileSync(join(h, '.codex', 'AGENTS.md'), '# Mine\n')
    mkdirSync(join(h, '.claude'))
    writeFileSync(join(h, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', hooks: { WorktreeCreate: [{ hooks: [{ command: `${BIN} hook create` }] }] } }))
    const ctx = ctxFor(h, fakeClaude(calls))
    const env = { HOME: h }
    const ctxHome: SetupContext = { ...ctx, run: (c, a, e) => ctx.run(c, a, { ...env, ...e }) }

    assert.deepEqual((await setupStatus(ctxHome)).map((s) => `${s.id}:${s.status}`), ['claude:todo', 'agents:todo', 'shell:todo', 'cli:todo'])
    const after = await setupApply(ctxHome)
    assert.deepEqual(after.map((s) => `${s.id}:${s.status}${s.error ? ` ${s.error}` : ''}`), ['claude:done', 'agents:done', 'shell:done', 'cli:done'])

    assert.deepEqual(calls.filter((c) => c[1] !== 'list'), [['plugin', 'marketplace', 'add', '/apps/Ramify/claude-marketplace'], ['plugin', 'install', 'ramify@ramify']])
    assert.deepEqual(JSON.parse(readFileSync(join(h, '.claude', 'settings.json'), 'utf8')), { model: 'opus' })
    assert.match(readFileSync(join(h, '.codex', 'AGENTS.md'), 'utf8'), /## Worktrees \(ramify\)/)
    const zshrc = readFileSync(join(h, '.zshrc'), 'utf8')
    assert.match(zshrc, /ramify: one branch per agent/)
    assert.match(zshrc, /export PATH="\$HOME\/.local\/bin:\$PATH"/)
    assert.equal(readlinkSync(join(h, '.local', 'bin', 'ramify')), BIN)

    // A second click changes nothing.
    await setupApply(ctxHome)
    assert.equal(readFileSync(join(h, '.zshrc'), 'utf8'), zshrc)

    for (const id of ['claude', 'agents', 'shell', 'cli'] as const) await setupUndo(ctxHome, id)
    assert.deepEqual((await setupStatus(ctxHome)).map((s) => `${s.id}:${s.status}`), ['claude:todo', 'agents:todo', 'shell:todo', 'cli:todo'])
    assert.equal(readFileSync(join(h, '.codex', 'AGENTS.md'), 'utf8').trim(), '# Mine')
    assert.doesNotMatch(readFileSync(join(h, '.zshrc'), 'utf8'), /ramify/)
    assert.equal(existsSync(join(h, '.local', 'bin', 'ramify')), false)
  })

  it('leaves alone a ramify command that is already reachable, and never replaces someone else\'s file', async () => {
    const h = home()
    mkdirSync(join(h, '.local', 'bin'), { recursive: true })
    writeFileSync(join(h, '.local', 'bin', 'ramify'), '#!/bin/sh\n')
    const onPath = ctxFor(h, fakeClaude([]), { path: join(h, '.local', 'bin') })
    assert.equal((await setupStatus(onPath)).find((s) => s.id === 'cli')?.status, 'done')
    const off = ctxFor(h, fakeClaude([]))
    const r = (await setupApply(off, ['cli'])).find((s) => s.id === 'cli')
    assert.equal(r?.status, 'todo')
    assert.match(r?.error ?? '', /already exists/)
    assert.equal(lstatSync(join(h, '.local', 'bin', 'ramify')).isSymbolicLink(), false)
  })

  it('reports what is not installed instead of failing', async () => {
    const h = home()
    const run: SetupRun = async () => ({ code: 127, stdout: '', stderr: 'command not found' })
    const s = await setupStatus(ctxFor(h, run))
    assert.equal(s.find((x) => x.id === 'claude')?.status, 'unavailable')
    assert.equal(s.find((x) => x.id === 'agents')?.status, 'unavailable')
  })
})

describe('setup: Windows', () => {
  it('installs launchers for PowerShell and Git Bash and adds them to the user PATH', async () => {
    const h = home(), calls: string[][] = []
    const lad = join(h, 'AppData', 'Local')
    const run: SetupRun = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' } }
    const ctx = ctxFor(h, run, { platform: 'win32', localAppData: lad, gitBash: 'C:\\Git\\bin\\bash.exe', bin: 'C:\\App\\resources\\bin\\ramify' })
    const r = (await setupApply(ctx, ['cli'])).find((s) => s.id === 'cli')
    assert.equal(r?.status, 'done')
    const dir = join(lad, 'ramify', 'bin')
    assert.equal(readFileSync(join(dir, 'ramify.cmd'), 'utf8'), '@"C:\\Git\\bin\\bash.exe" "C:/App/resources/bin/ramify" %*\r\n')
    assert.ok(existsSync(join(dir, 'ramify')))
    assert.ok(calls.some((c) => c[0] === 'powershell' && c.at(-1)!.includes(dir.replace(/'/g, "''"))))
    await setupUndo(ctx, 'cli')
    assert.equal(existsSync(join(dir, 'ramify.cmd')), false)
  })

  it('without Git Bash the terminal step is not available', async () => {
    const ctx = ctxFor(home(), async () => ({ code: 1, stdout: '', stderr: '' }), { platform: 'win32', gitBash: 'C:\\nowhere\\bash.exe' })
    assert.equal((await setupStatus(ctx)).find((s) => s.id === 'shell')?.status, 'unavailable')
  })
})
