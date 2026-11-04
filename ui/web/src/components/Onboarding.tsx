import { AppWindow, ArrowRight, Check, Code2, GitBranch, GitCompareArrows, Loader2, Radar, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import type { InstalledTools } from '../types'
import { AgentBadge } from './AgentBadge'
import { BrandIcon, hasBrand } from './BrandIcon'
import { Logo, Wordmark } from './Logo'

/**
 * First run: three short steps. Nothing to fill in: it shows what is already on this machine
 * (tap a tile to stop tracking it), offers the projects it found and explains what happens next.
 */
export function Onboarding() {
  const t = useStore((s) => s.t)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const refreshRepos = useStore((s) => s.refreshRepos)
  const setModal = useStore((s) => s.setModal)
  const ref = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState(0)
  const [tools, setTools] = useState<InstalledTools | null>(null)
  const [live, setLive] = useState(0)
  const [ignored, setIgnored] = useState<Set<string>>(new Set(settings?.ignored ?? []))
  const [repos, setRepos] = useState<{ path: string; name: string }[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    void bridge.tools().then(setTools).catch(() => setTools({ agents: [], editors: [], terminals: [], apps: [] }))
    void bridge.sessions().then((s) => setLive(s.filter((x) => x.end === null).length)).catch(() => {})
    void bridge.suggestRepos().then((r) => { setRepos(r); setPicked(new Set(r.slice(0, 8).map((x) => x.path))) }).catch(() => setRepos([]))
    return () => d?.close()
  }, [])

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }

  const finish = async () => {
    if (!settings || saving) return
    setSaving(true)
    try {
      if (picked.size) await bridge.addRepos([...picked])
      await saveSettings({ ...settings, onboarded: true, ignored: [...ignored] })
      await refreshRepos()
    } finally {
      setModal(null)
    }
  }

  const groups: [string, string[], boolean][] = tools ? [
    [t('obAgents'), tools.agents, true], [t('obEditors'), tools.editors, false],
    [t('obTerminals'), tools.terminals, false], [t('obApps'), tools.apps, false],
  ] : []

  return (
    <dialog ref={ref} className="dialog onboarding" onCancel={(e) => { e.preventDefault(); void finish() }}>
      <div className="ob-steps" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />)}</div>

      {step === 0 && (
        <section className="ob-step" key="s0">
          <div className="ob-hero"><Logo size={56} /><Wordmark className="ob-name" /></div>
          <h2>{t('obFoundTitle')}</h2>
          <p className="muted">{t('obFoundText')}</p>
          {!tools && <p className="muted small"><Loader2 size={14} className="spin" /> {t('obScanning')}</p>}
          {groups.filter(([, list]) => list.length).map(([label, list, agent]) => (
            <div key={label} className="ob-group">
              <span className="ob-label">{label}</span>
              <div className="ob-tiles">
                {list.map((name, i) => {
                  const off = ignored.has(name)
                  return (
                    <button key={name} type="button" className={`ob-tile${off ? ' is-off' : ''}`} style={{ animationDelay: `${i * 40}ms` }}
                      aria-pressed={!off} title={off ? t('obTrackOff') : t('obTrackOn')} onClick={() => setIgnored(toggle(ignored, name))}>
                      {agent ? <AgentBadge agent={name} size={30} /> : <span className="ob-logo">{hasBrand(name) ? <BrandIcon name={name} size={22} /> : label === t('obTerminals') ? <SquareTerminal size={18} /> : label === t('obEditors') ? <Code2 size={18} /> : <AppWindow size={18} />}</span>}
                      <span>{name}</span>
                      <span className="ob-check">{off ? null : <Check size={11} strokeWidth={3} />}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {tools && live > 0 && <p className="ob-live"><span className="pulse" />{t('obLiveNow', { n: live })}</p>}
        </section>
      )}

      {step === 1 && (
        <section className="ob-step" key="s1">
          <h2>{t('obReposTitle')}</h2>
          <p className="muted">{t('obReposText', { dir: settings?.projectsDir ?? '' })}</p>
          {repos === null && <p className="muted small"><Loader2 size={14} className="spin" /> {t('obScanning')}</p>}
          {repos?.length === 0 && <p className="muted small">{t('obReposNone')}</p>}
          <ul className="ob-repos">
            {repos?.map((r) => (
              <li key={r.path}>
                <label className={picked.has(r.path) ? 'is-on' : ''}>
                  <input type="checkbox" checked={picked.has(r.path)} onChange={() => setPicked(toggle(picked, r.path))} />
                  <b>{r.name}</b><span className="muted mono small">{r.path}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 2 && (
        <section className="ob-step" key="s2">
          <h2>{t('obHowTitle')}</h2>
          <div className="ob-how">
            <div><span className="ob-how-icon"><Radar size={20} /></span><b>{t('obHow1')}</b><p>{t('obHow1Text')}</p></div>
            <div><span className="ob-how-icon"><GitBranch size={20} /></span><b>{t('obHow2')}</b><p>{t('obHow2Text')}</p></div>
            <div><span className="ob-how-icon"><GitCompareArrows size={20} /></span><b>{t('obHow3')}</b><p>{t('obHow3Text')}</p></div>
          </div>
        </section>
      )}

      <div className="dialog-actions">
        {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>{t('obBack')}</button>}
        <span className="sb-spacer" />
        {step < 2
          ? <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)} autoFocus>{t('obNext')}<ArrowRight size={14} /></button>
          : <button type="button" className="btn btn-primary" onClick={finish} disabled={saving} autoFocus>{saving ? <Loader2 size={14} className="spin" /> : null}{t('obStart')}</button>}
      </div>
    </dialog>
  )
}
