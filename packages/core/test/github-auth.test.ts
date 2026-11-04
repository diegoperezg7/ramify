import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { accessibleRepos, AuthError, pollForTokens, refreshTokens, requestDeviceCode, type DeviceCode } from '../src/github-auth.ts'

const realFetch = globalThis.fetch
type Call = { url: string; body: string; auth: string | null }
let calls: Call[] = []

/** Replies in order; records every request. */
function mock(...replies: (object | ((c: Call) => Response))[]) {
  calls = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const c = { url: String(input), body: String(init?.body ?? ''), auth: new Headers(init?.headers).get('authorization') }
    calls.push(c)
    const r = replies.shift()
    if (!r) throw new Error('unexpected request')
    return typeof r === 'function' ? r(c) : new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}
afterEach(() => { globalThis.fetch = realFetch })

const code: DeviceCode = { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 60_000, interval: 0 }

describe('GitHub device flow', () => {
  it('asks for a device code with the client id only (no secret)', async () => {
    mock({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
    const c = await requestDeviceCode('Iv23liTEST')
    assert.equal(c.userCode, 'ABCD-1234')
    assert.equal(calls[0].url, 'https://github.com/login/device/code')
    assert.equal(calls[0].body, 'client_id=Iv23liTEST')
  })

  it('refuses to start without a configured client id', async () => {
    await assert.rejects(requestDeviceCode(''), (e: unknown) => e instanceof AuthError && e.code === 'config')
  })

  it('waits while pending, slows down when asked, then returns expiring tokens', async () => {
    mock({ error: 'authorization_pending' }, { error: 'slow_down', interval: 0 }, { access_token: 'ghu_x', expires_in: 28800, refresh_token: 'ghr_y', refresh_token_expires_in: 15897600 })
    const t = await pollForTokens('Iv23liTEST', code)
    assert.equal(t.accessToken, 'ghu_x')
    assert.equal(t.refreshToken, 'ghr_y')
    assert.ok(t.expiresAt > Date.now())
    assert.equal(calls.length, 3)
    assert.ok(!calls.some((c) => c.body.includes('client_secret')))
  })

  it('reports a denied authorization', async () => {
    mock({ error: 'access_denied' })
    await assert.rejects(pollForTokens('Iv23liTEST', code), (e: unknown) => e instanceof AuthError && e.code === 'denied')
  })

  it('refreshes only near expiry, with the refresh token and no secret', async () => {
    const now = Date.now()
    const fresh = { accessToken: 'a', expiresAt: now + 3600_000, refreshToken: 'r', refreshExpiresAt: now + 86400_000 }
    mock()
    assert.equal(await refreshTokens('Iv23liTEST', fresh, now), fresh)
    mock({ access_token: 'b', expires_in: 28800, refresh_token: 'r2', refresh_token_expires_in: 15897600 })
    const next = await refreshTokens('Iv23liTEST', { ...fresh, expiresAt: now + 60_000 }, now)
    assert.equal(next.accessToken, 'b')
    assert.match(calls[0].body, /grant_type=refresh_token/)
    assert.ok(!calls[0].body.includes('client_secret'))
  })

  it('lists repositories per installation and never follows pagination off api.github.com', async () => {
    const repo = (n: string) => ({ full_name: `me/${n}`, html_url: `https://github.com/me/${n}`, description: null, private: true, fork: false, archived: false, pushed_at: '2026-11-01T00:00:00Z', language: 'Swift', owner: { login: 'me', type: 'User' } })
    mock(
      { total_count: 1, installations: [{ id: 7 }] },
      () => new Response(JSON.stringify({ repositories: [repo('a')] }), { headers: { link: '<https://evil.example.com/steal>; rel="next"' } }),
    )
    const { installations, repos } = await accessibleRepos('ghu_x')
    assert.equal(installations, 1)
    assert.deepEqual(repos.map((r) => r.nameWithOwner), ['me/a'])
    assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/')))
    assert.ok(calls.every((c) => c.auth === 'Bearer ghu_x'))
  })
})
