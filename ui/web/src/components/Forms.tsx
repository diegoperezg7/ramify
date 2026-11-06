import { Bell, Bot, Loader2, Monitor, SlidersHorizontal, Sparkles, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AgentPicker, OptionPicker } from './Pickers'
import { BrandIcon } from './BrandIcon'
import { taskSlug } from '../logic'
import { IDE_LABELS } from './Detail'
import { useStore, type SettingsTab } from '../store'
import type { Settings } from '../types'
import { SetupList } from './Setup'
import { GithubAccountPanel } from './GithubAccount'
import { GithubIcon } from './GithubIcon'

function Modal({ title, children, onClose, className }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog ref={ref} className={`dialog${className ? ` ${className}` : ''}`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <h3>{title}</h3>
      {children}
    </dialog>
  )
}

const stamp = () => new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '').replace(/^(\d{4})/, '$1-')

export function CreateDialog() {
  const t = useStore((s) => s.t)
  const caps = useStore((s) => s.caps)
  const settings = useStore((s) => s.settings)
  const state = useStore((s) => s.state)
  const repos = useStore((s) => s.repos)
  const currentRepo = useStore((s) => s.repo)
  const busy = useStore((s) => s.busy)
  const setModal = useStore((s) => s.setModal)
  const createWorktree = useStore((s) => s.createWorktree)
  const prefill = useStore((s) => s.createPrefill)
  const [repo, setRepo] = useState(currentRepo)
  const [agent, setAgent] = useState(prefill?.agent ?? settings?.defaultAgent ?? 'claude')
  const [prompt, setPrompt] = useState('')
  // The branch names itself from the agent and the task until it is edited by hand.
  const [branch, setBranch] = useState(prefill?.branch ?? '')
  const [touched, setTouched] = useState(!!prefill?.branch)
  const [fallbackStamp] = useState(stamp)
  useEffect(() => {
    if (touched) return
    const slug = taskSlug(prompt)
    setBranch(`${agent || 'task'}/${slug || fallbackStamp}`)
  }, [agent, prompt, touched, fallbackStamp])
  const [base, setBase] = useState('')

  const where = caps?.host === 'vscode' ? t('integratedTerminal') : settings?.terminal ?? 'Terminal'
  // A name git accepts (git check-ref-format): no leading "-", "." or "/", no "..", "//", "/." or trailing "/" "." ".lock".
  const nameOk = /^[\w./-]+$/.test(branch) && !/^[-./]|[./]$|\.\.|\/\/|\/\.|\.lock$/.test(branch)
  const valid = nameOk && (!!repo || !caps?.multiRepo)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    if (await createWorktree({ branch, agent, base: base || undefined, prompt: prompt || undefined }, repo)) setModal(null)
  }

  return (
    <Modal title={t('newAgent')} onClose={() => !busy && setModal(null)}>
      <form className="form" onSubmit={submit}>
        <p className="muted small form-lead">{t('newAgentLead')}</p>
        {caps?.multiRepo && repos.length > 1 && (
          <label>
            <span>{t('repository')}</span>
            <select value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.map((r) => <option key={r.path} value={r.path}>{r.name}</option>)}
            </select>
          </label>
        )}
        <fieldset>
          <legend>{t('agent')}</legend>
          <AgentPicker value={agent} onChange={setAgent} none />
        </fieldset>
        <label>
          <span>{t('task')}</span>
          <textarea autoFocus rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('taskPlaceholder')} />
        </label>
        <label>
          <span>{t('branch')} <em className="muted">{t('branchAuto')}</em></span>
          <input value={branch} onChange={(e) => { setTouched(true); setBranch(e.target.value.replace(/\s/g, '-')) }}
            spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        </label>
        <details className="more-options">
          <summary>{t('moreOptions')}</summary>
          <label>
            <span>{t('baseRef')}</span>
            <input value={base} onChange={(e) => setBase(e.target.value.trim())} placeholder={state?.base ?? t('basePlaceholder')} spellCheck={false} />
          </label>
        </details>
        <p className="muted small">{t('createHint', { where })}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setModal(null)}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            {busy ? <><Loader2 size={14} className="spin" />{t('creating')}</> : t('startAgent')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function SettingsDialog() {
  const t = useStore((s) => s.t)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const caps = useStore((s) => s.caps)
  const setModal = useStore((s) => s.setModal)
  const toast = useStore((s) => s.toast)
  const startTab = useStore((s) => s.settingsTab)
  const [draft, setDraft] = useState<Settings>(settings ?? { terminal: 'Terminal', defaultAgent: 'claude', projectsDir: '', autoDetect: true })
  const [saving, setSaving] = useState(false)
  // One section at a time, each short enough to fit: the dialog never scrolls as a whole.
  const tabs: { id: SettingsTab; label: string; icon: ReactNode }[] = [
    { id: 'general', label: t('setTabGeneral'), icon: <SlidersHorizontal size={15} /> },
    { id: 'agents', label: t('setTabAgents'), icon: <Bot size={15} /> },
    ...(caps?.control ? [{ id: 'automation' as const, label: t('setTabAutomation'), icon: <Sparkles size={15} /> }] : []),
    { id: 'notifications', label: t('setTabNotifications'), icon: <Bell size={15} /> },
    ...(caps?.host === 'desktop' ? [{ id: 'github' as const, label: t('setTabGithub'), icon: <GithubIcon size={15} /> }] : []),
    { id: 'system', label: t('setTabSystem'), icon: <Monitor size={15} /> },
  ]
  const [tab, setTab] = useState<SettingsTab>(tabs.some((x) => x.id === startTab) ? startTab! : 'general')
  // One save at a time; a failed save says why and keeps the dialog open with the draft.
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try { await saveSettings(draft); setModal(null) } catch (err) { toast('error', (err as Error).message) } finally { setSaving(false) }
  }
  const check = (key: keyof Settings, label: string, fallback: boolean, extra?: { disabled?: boolean; checked?: boolean }) => (
    <label className="check">
      <input type="checkbox" checked={extra?.checked ?? ((draft[key] as boolean | undefined) ?? fallback)} disabled={extra?.disabled}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
      {label}
    </label>
  )

  return (
    <Modal title={t('settings')} onClose={() => setModal(null)} className="dialog-settings">
      <form className="form settings" onSubmit={save}>
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t('settings')}>
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" id={`set-tab-${x.id}`} aria-selected={tab === x.id} aria-controls="set-pane"
              className={`settings-tab${tab === x.id ? ' is-on' : ''}`} onClick={() => setTab(x.id)}>
              {x.icon}{x.label}
            </button>
          ))}
        </nav>

        <div key={tab} className="settings-pane no-scrollbar" id="set-pane" role="tabpanel" aria-labelledby={`set-tab-${tab}`}>
          {tab === 'general' && (
            <>
              {caps?.platform !== 'win32' && (
                <fieldset>
                  <legend>{t('terminal')}</legend>
                  <OptionPicker value={draft.terminal} onChange={(v) => setDraft({ ...draft, terminal: v })}
                    options={(['Terminal', 'iTerm', 'Ghostty'] as const).map((v) => ({
                      value: v, label: v, icon: v === 'Terminal' ? <SquareTerminal size={16} /> : <BrandIcon name={v} size={16} />,
                    }))} />
                </fieldset>
              )}
              {caps?.host === 'desktop' && (caps.ides.length > 1) && (
                <fieldset>
                  <legend>{t('defaultIde')}</legend>
                  <OptionPicker value={draft.defaultIde ?? caps.ides[0]} onChange={(v) => setDraft({ ...draft, defaultIde: v })}
                    options={caps.ides.filter((id) => id !== 'Finder').map((id) => ({
                      value: id, label: IDE_LABELS[id] ?? id, icon: <BrandIcon name={IDE_LABELS[id] ?? id} size={16} />,
                    }))} />
                </fieldset>
              )}
              <label>
                <span>{t('projectsDir')}</span>
                <input value={draft.projectsDir} onChange={(e) => setDraft({ ...draft, projectsDir: e.target.value })} spellCheck={false} />
                <small className="muted">{t('projectsDirHint')}</small>
              </label>
              {caps?.sessions && (
                <fieldset>
                  <legend>{t('historyKeep')}</legend>
                  <OptionPicker value={draft.historyDays ?? 90} onChange={(v) => setDraft({ ...draft, historyDays: v })}
                    options={[30, 90, 365, 0].map((n) => ({ value: n, label: n ? t('days', { n }) : t('forever') }))} />
                </fieldset>
              )}
            </>
          )}

          {tab === 'agents' && (
            <>
              <fieldset>
                <legend>{t('defaultAgent')}</legend>
                <AgentPicker value={draft.defaultAgent} onChange={(a) => setDraft({ ...draft, defaultAgent: a })} />
              </fieldset>
              <fieldset className="toggles">{check('autoDetect', t('autoDetect'), true)}</fieldset>
            </>
          )}

          {tab === 'automation' && (
            <fieldset className="toggles">
              <legend>{t('careTitle')}</legend>
              {check('watchBranches', t('careWatch'), true)}
              {check('autoDraftPr', t('careDraftPr'), true)}
              {check('autoClean', t('careClean'), true)}
            </fieldset>
          )}

          {tab === 'notifications' && (
            <fieldset className="toggles">
              {check('notifications', t('notifyFinished'), true)}
              {/* Unset until asked: off here, and turning it on is the user's own yes. */}
              {check('notifyReady', t('notifyReady'), false, { disabled: draft.notifications === false, checked: (draft.notifications ?? true) && (draft.notifyReady ?? false) })}
              {check('menuBar', t('menuBar'), true)}
            </fieldset>
          )}

          {tab === 'github' && <GithubAccountPanel />}

          {tab === 'system' && (
            <>
              <fieldset className="toggles">
                {check('openAtLogin', t('openAtLogin'), false)}
                {caps?.update && check('autoUpdate', t('autoUpdate'), true)}
              </fieldset>
              {caps?.setup && (
                <fieldset>
                  <legend>{t('setupSection')}</legend>
                  <SetupList mode="settings" />
                </fieldset>
              )}
              {caps?.sessions && (
                <div><button type="button" className="btn btn-ghost" onClick={() => setModal('onboarding')}>{t('obReplay')}</button></div>
              )}
            </>
          )}
        </div>

        <div className="dialog-actions settings-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving && <Loader2 size={14} className="spin" />}{t('save')}</button>
        </div>
      </form>
    </Modal>
  )
}
