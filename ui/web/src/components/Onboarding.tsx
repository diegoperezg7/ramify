import { ArrowRight, Check, Cloud, Copy, ExternalLink, GitBranch, GitCompareArrows, KeyRound, Laptop, Loader2, Lock, Radar, RefreshCw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentName } from '../agents'
import { bridge } from '../bridge'
import { relTime } from '../i18n'
import { useStore } from '../store'
import type { GithubAccount, GithubSync, InstalledTools, SyncedRepo } from '../types'
import { AgentBadge } from './AgentBadge'
import { BrandIcon, hasBrand } from './BrandIcon'
import { GithubIcon } from './GithubIcon'
import { Logo, Wordmark } from './Logo'
import { SetupList } from './Setup'
import { Bar } from './Skeletons'

type Step = 'welcome' | 'tools' | 'setup' | 'github' | 'sync' | 'done'

/**
 * First run, short steps: welcome, what is installed (detected, nothing to pick), one-click setup of this
 * computer (desktop app), GitHub sign-in (device flow), repository sync (grouped, not a flat list) and a summary.
 */
export function Onboarding() {
  const t = useStore((s) => s.t)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const refreshRepos = useStore((s) => s.refreshRepos)
  const toast = useStore((s) => s.toast)
  const setModal = useStore((s) => s.setModal)
  const ref = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<Step>(() => useStore.getState().onboardingStep ?? 'welcome')
  const [tools, setTools] = useState<InstalledTools | null>(null)
  const [live, setLive] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // The sync step preselects repositories once; coming back to it keeps what the user ticked.
  const seeded = useRef(false)
  const [saving, setSaving] = useState(false)
  const caps = useStore((s) => s.caps)
  const STEPS: Step[] = ['welcome', 'tools', ...(caps?.setup ? ['setup' as const] : []), 'github', 'sync', 'done']
  const index = STEPS.indexOf(step)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    void bridge.tools().then(setTools).catch(() => setTools({ agents: [], editors: [], terminals: [], apps: [] }))
    void bridge.sessions().then((s) => setLive(s.filter((x) => x.end === null && !x.inferred).length)).catch(() => {})
    return () => d?.close()
  }, [])

  const finish = async () => {
    if (!settings || saving) return
    setSaving(true)
    try {
      if (picked.size) await bridge.addRepos([...picked])
      await saveSettings({ ...settings, onboarded: true })
      await refreshRepos()
      setModal(null)
    } catch (e) {
      toast('error', (e as Error).message)
      setSaving(false)
    }
  }

  return (
    <dialog ref={ref} className="dialog onboarding" onCancel={(e) => { e.preventDefault(); void finish() }}>
      <div className="ob-steps" aria-hidden="true">{STEPS.map((s, i) => <i key={s} className={i === index ? 'is-on' : i < index ? 'is-done' : ''} />)}</div>

      {step === 'welcome' && (
        <section className="ob-step ob-welcome" key="welcome">
          <div className="ob-hero-logo"><Logo size={96} /></div>
          <Wordmark className="ob-name" />
          <h2>{t('obWelcome')}</h2>
          <p className="muted">{t('obWelcomeText')}</p>
        </section>
      )}

      {step === 'tools' && <ToolsStep tools={tools} live={live} />}
      {step === 'setup' && (
        <section className="ob-step" key="setup">
          <h2>{t('setupTitle')}</h2>
          <p className="muted">{t('setupText')}</p>
          <SetupList mode="onboarding" />
        </section>
      )}
      {step === 'github' && <GithubStep onDone={() => setStep('sync')} />}
      {step === 'sync' && <SyncStep picked={picked} setPicked={setPicked} seeded={seeded} />}

      {step === 'done' && (
        <section className="ob-step" key="done">
          <h2>{t('obDoneTitle')}</h2>
          <p className="muted">{t('obDoneText', { repos: picked.size, agents: tools?.agents.length ?? 0 })}</p>
          <div className="ob-how">
            <div><span className="ob-how-icon"><Radar size={20} /></span><b>{t('obHow1')}</b><p>{t('obHow1Text')}</p></div>
            <div><span className="ob-how-icon"><GitBranch size={20} /></span><b>{t('obHow2')}</b><p>{t('obHow2Text')}</p></div>
            <div><span className="ob-how-icon"><GitCompareArrows size={20} /></span><b>{t('obHow3')}</b><p>{t('obHow3Text')}</p></div>
          </div>
        </section>
      )}

      <div className="dialog-actions">
        {index > 0 && step !== 'done' && <button type="button" className="btn btn-ghost" onClick={() => setStep(STEPS[index - 1])}>{t('obBack')}</button>}
        <span className="sb-spacer" />
        {step === 'github' && <button type="button" className="btn btn-ghost" onClick={() => setStep('sync')}>{t('obLater')}</button>}
        {step === 'done'
          ? <button type="button" className="btn btn-primary" onClick={finish} disabled={saving} autoFocus>{saving && <Loader2 size={14} className="spin" />}{t('obStart')}</button>
          : step !== 'github' && <button type="button" className="btn btn-primary" onClick={() => setStep(STEPS[index + 1])} autoFocus>{t('obNext')}<ArrowRight size={14} /></button>}
      </div>
    </dialog>
  )
}

function ToolsStep({ tools, live }: { tools: InstalledTools | null; live: number }) {
  const t = useStore((s) => s.t)
  const all = tools ? [
    ...tools.agents.map((id) => ({ key: `a:${id}`, label: agentName(id), agent: id })),
    ...[...tools.editors, ...tools.terminals, ...tools.apps].map((n) => ({ key: n, label: n, agent: null as string | null })),
  ] : []
  return (
    <section className="ob-step" key="tools">
      <h2>{t('obFoundTitle')}</h2>
      <p className="muted">{t('obFoundShort')}</p>
      <div className="ob-cloud" aria-busy={!tools} aria-label={tools ? undefined : t('obScanning')}>
        {!tools && Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="ob-cloud-item" aria-hidden="true"><Bar w={46} h={46} r={12} /><Bar w={56 + ((i * 13) % 24)} h={10} /></div>
        ))}
        {all.map((x, i) => (
          <div key={x.key} className="ob-cloud-item" style={{ animationDelay: `${i * 35}ms` }} title={x.label}>
            {x.agent ? <AgentBadge agent={x.agent} size={46} /> : <span className="ob-cloud-logo">{hasBrand(x.label) ? <BrandIcon name={x.label} size={26} /> : <Laptop size={22} />}</span>}
            <span>{x.label}</span>
          </div>
        ))}
      </div>
      {tools && (
        <p className="ob-counts">
          <b>{tools.agents.length}</b> {t('obAgents').toLowerCase()} · <b>{tools.editors.length}</b> {t('obEditors').toLowerCase()} · <b>{tools.terminals.length}</b> {t('obTerminals').toLowerCase()} · <b>{tools.apps.length}</b> {t('obApps').toLowerCase()}
          {live > 0 && <span className="ob-live"><span className="pulse" />{t('obLiveNow', { n: live })}</span>}
        </p>
      )}
    </section>
  )
}

function GithubStep({ onDone }: { onDone: () => void }) {
  const t = useStore((s) => s.t)
  const [acct, setAcct] = useState<GithubAccount | null>(null)
  const [code, setCode] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refresh = useCallback(async () => {
    const a = await bridge.githubAccount().catch(() => null)
    setAcct(a)
    return a
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  // Leaving the step (Later, Back, Esc) stops a sign-in still waiting for approval on github.com.
  useEffect(() => () => {
    clearTimeout(doneTimer.current)
    if (pending.current) void bridge.githubCancel().catch(() => {})
  }, [])
  useEffect(() => { pending.current = code !== null }, [code])

  // While waiting for the user to approve on github.com, ask the app (not GitHub) every 2 s.
  useEffect(() => {
    if (!code) return
    const id = setInterval(async () => {
      const a = await refresh()
      if (a?.status === 'signed-in') { setCode(null); doneTimer.current = setTimeout(onDone, 900) }
      if (a?.status === 'error') { setCode(null); setError(a.error ?? 'error') }
    }, 2000)
    return () => clearInterval(id)
  }, [code, refresh, onDone])

  const start = async () => {
    setError(null)
    try { setCode(await bridge.githubSignIn()) } catch (e) { setError((e as Error).message) }
  }
  const cancel = async () => {
    try { await bridge.githubCancel() } catch { /* the host stops it on its own when the code expires */ } finally { setCode(null); void refresh() }
  }

  return (
    <section className="ob-step ob-github" key="github">
      <span className="ob-gh-mark"><GithubIcon size={34} /></span>
      <h2>{t('obGhTitle')}</h2>
      <p className="muted">{t('obGhText')}</p>

      {acct && !acct.configured && <p className="ob-note">{t('obGhNotConfigured')}</p>}

      {acct?.configured && acct.status === 'signed-in' && acct.user && (
        <div className="ob-gh-user">
          <img src={acct.user.avatarUrl} alt="" width={40} height={40} />
          <div><b>{acct.user.name ?? acct.user.login}</b><span className="muted small">@{acct.user.login}</span></div>
          <Check size={20} className="ok" />
          <button type="button" className="btn btn-primary" onClick={onDone}>{t('obNext')}<ArrowRight size={14} /></button>
        </div>
      )}

      {acct?.configured && acct.status !== 'signed-in' && !code && (
        <button type="button" className="btn btn-primary btn-lg" onClick={start}><GithubIcon size={16} />{t('obGhSignIn')}</button>
      )}

      {code && (
        <div className="ob-code">
          <p className="small muted">{t('obGhEnterCode')}</p>
          <div className="ob-code-digits" aria-label={code.userCode}>
            {code.userCode.split('').map((c, i) => <span key={i} className={c === '-' ? 'dash' : ''}>{c}</span>)}
          </div>
          <div className="ob-code-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { void navigator.clipboard.writeText(code.userCode); setCopied(true) }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t('copied') : t('obGhCopy')}
            </button>
            <a className="btn btn-ghost" href={code.verificationUri} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t('obGhOpen')}</a>
            <button type="button" className="btn btn-ghost" onClick={cancel}>{t('cancel')}</button>
          </div>
          <p className="ob-waiting"><Loader2 size={14} className="spin" />{t('obGhWaiting')}</p>
        </div>
      )}

      {error && <p className="ob-note is-error">{t(error === 'denied' ? 'obGhDenied' : error === 'expired' ? 'obGhExpired' : 'obGhFailed')}</p>}

      <ul className="ob-security">
        <li><ShieldCheck size={14} />{t('obSec1')}</li>
        <li><KeyRound size={14} />{acct?.keychain === false ? t('obSec2Session') : t('obSec2')}</li>
        <li><Lock size={14} />{t('obSec3')}</li>
      </ul>
    </section>
  )
}

function SyncStep({ picked, setPicked, seeded }: { picked: Set<string>; setPicked: (s: Set<string>) => void; seeded: { current: boolean } }) {
  const t = useStore((s) => s.t)
  const lang = useStore((s) => s.lang)
  const [sync, setSync] = useState<GithubSync | null>(null)
  const [local, setLocal] = useState<{ path: string; name: string }[] | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const acct = await bridge.githubAccount().catch(() => null)
    setInstallUrl(acct?.installUrl ?? null)
    const ok = acct?.status === 'signed-in'
    setSignedIn(ok)
    const [s, l] = await Promise.all([ok ? bridge.githubSync().catch(() => null) : Promise.resolve(null), bridge.suggestRepos().catch(() => [])])
    if (!mounted.current) return
    setSync(s)
    setLocal(l)
    // Preselect what matters: repositories with agents now and those already on this Mac.
    const pre = new Set<string>()
    for (const r of s?.repos ?? []) if (r.local && (r.live.length || !r.added)) pre.add(r.local)
    for (const r of l.slice(0, 6)) pre.add(r.path)
    if (!seeded.current) { setPicked(pre); seeded.current = true }
    setLoading(false)
  }, [setPicked, seeded])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    const repos = sync?.repos ?? []
    const liveNow = repos.filter((r) => r.live.length)
    const onMac = repos.filter((r) => r.local && !r.live.length)
    const remote = repos.filter((r) => !r.local)
    const byOwner = new Map<string, SyncedRepo[]>()
    for (const r of remote) byOwner.set(r.owner, [...(byOwner.get(r.owner) ?? []), r])
    const known = new Set(repos.map((r) => r.local).filter(Boolean))
    // Local repositories by the folder they live in (Personal, Work…), not one long list.
    const byFolder = new Map<string, { path: string; name: string }[]>()
    for (const l of (local ?? []).filter((x) => !known.has(x.path))) {
      const folder = l.path.split('/').slice(-2, -1)[0] ?? ''
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), l])
    }
    return { liveNow, onMac, byOwner: [...byOwner.entries()], byFolder: [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length) }
  }, [sync, local])

  const toggle = (path: string) => { const n = new Set(picked); if (n.has(path)) n.delete(path); else n.add(path); setPicked(n) }
  const now = Math.floor(Date.now() / 1000)

  if (loading) {
    return (
      <section className="ob-step ob-syncing" key="syncing">
        <div className="ob-sync-anim"><Logo size={64} /><span className="ob-orbit" /></div>
        <h2>{t('obSyncing')}</h2>
        <p className="muted">{t('obSyncingText')}</p>
      </section>
    )
  }

  const Tile = ({ r }: { r: SyncedRepo }) => (
    <button type="button" className={`ob-repo${r.local && picked.has(r.local) ? ' is-on' : ''}${r.local ? '' : ' is-remote'}`}
      disabled={!r.local} onClick={() => r.local && toggle(r.local)} title={r.local ?? r.url}>
      <span className="ob-repo-top">
        {r.language && hasBrand(r.language) ? <BrandIcon name={r.language} size={16} /> : <GitBranch size={14} />}
        <b>{r.nameWithOwner.split('/')[1]}</b>
        {r.isPrivate && <Lock size={11} className="muted" />}
        {r.local ? <span className="ob-repo-check">{picked.has(r.local) && <Check size={11} strokeWidth={3} />}</span> : <Cloud size={13} className="muted" />}
      </span>
      {r.live.length > 0 && <span className="ob-repo-live">{r.live.map((a) => <AgentBadge key={a} agent={a} size={16} live />)}</span>}
      <span className="muted small">{r.local ? t('obOnMac') : t('obOnGithub')} · {relTime(lang, Math.floor(Date.parse(r.pushedAt) / 1000), now)}</span>
    </button>
  )

  return (
    <section className="ob-step" key="sync">
      <h2>{signedIn ? t('obSyncedTitle', { n: sync?.repos.length ?? 0 }) : t('obReposTitle')}</h2>
      <p className="muted">{signedIn ? t('obSyncedText') : t('obLocalText')}</p>
      {signedIn && sync?.installations === 0 && (
        <div className="ob-note">
          {t('obInstallApp')}
          {installUrl && <a className="btn btn-primary" href={installUrl} target="_blank" rel="noreferrer"><GithubIcon size={14} />{t('obChooseRepos')}</a>}
          <button type="button" className="btn btn-ghost" onClick={load}><RefreshCw size={14} />{t('obResync')}</button>
        </div>
      )}
      <div className="ob-groups">
        {groups.liveNow.length > 0 && <Group title={t('obGroupLive')} live>{groups.liveNow.map((r) => <Tile key={r.nameWithOwner} r={r} />)}</Group>}
        {groups.onMac.length > 0 && <Group title={t('obGroupMac')}>{groups.onMac.map((r) => <Tile key={r.nameWithOwner} r={r} />)}</Group>}
        {groups.byFolder.map(([folder, list]) => (
          <Group key={folder} title={signedIn ? `${t('obGroupLocalOnly')} · ${folder}` : folder} icon={<Laptop size={13} />}>
            {list.map((l) => (
              <button key={l.path} type="button" className={`ob-repo${picked.has(l.path) ? ' is-on' : ''}`} onClick={() => toggle(l.path)} title={l.path}>
                <span className="ob-repo-top"><Laptop size={14} /><b>{l.name}</b><span className="ob-repo-check">{picked.has(l.path) && <Check size={11} strokeWidth={3} />}</span></span>
                <span className="muted small">{t('obOnMac')}</span>
              </button>
            ))}
          </Group>
        ))}
        {groups.byOwner.map(([owner, list]) => (
          <Group key={owner} title={owner} icon={<GithubIcon size={13} />}>{list.slice(0, 12).map((r) => <Tile key={r.nameWithOwner} r={r} />)}</Group>
        ))}
      </div>
    </section>
  )
}

function Group({ title, icon, live, children }: { title: string; icon?: React.ReactNode; live?: boolean; children: React.ReactNode }) {
  return (
    <div className="ob-group">
      <span className="ob-label">{live && <span className="pulse" />}{icon}{title}</span>
      <div className="ob-repo-grid">{children}</div>
    </div>
  )
}
