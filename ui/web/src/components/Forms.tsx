import { Loader2 } from 'lucide-react'
import { AgentBadge } from './AgentBadge'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { agentVar, KNOWN_AGENTS } from '../agents'
import { bridge } from '../bridge'
import { taskSlug } from '../logic'
import { IDE_LABELS } from './Detail'
import { useStore } from '../store'
import type { Settings } from '../types'
import { SetupList } from './Setup'

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose() }}>
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
  // Only the agents installed here, so the choice is short; the rest stay one click away.
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (caps?.sessions) void bridge.tools().then((x) => setInstalled(x.agents)).catch(() => setInstalled(null))
  }, [caps])
  const choices = (() => {
    const list = installed && installed.length && !showAll ? installed : KNOWN_AGENTS
    return [...new Set([...list, ...(agent ? [agent] : [])])]
  })()
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
          <div className="agent-picker">
            {choices.map((a) => (
              <button key={a} type="button" className={`agent-option${agent === a ? ' is-on' : ''}`}
                style={{ ['--c' as string]: agentVar(a) }} onClick={() => setAgent(a)} aria-pressed={agent === a}>
                <AgentBadge agent={a} size={18} />{a}
              </button>
            ))}
            <button type="button" className={`agent-option${agent === '' ? ' is-on' : ''}`} onClick={() => setAgent('')} aria-pressed={agent === ''}>
              {t('noneAgent')}
            </button>
            {installed && installed.length > 0 && !showAll && (
              <button type="button" className="agent-option is-more" onClick={() => setShowAll(true)}>{t('moreAgents')}</button>
            )}
          </div>
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
  const [draft, setDraft] = useState<Settings>(settings ?? { terminal: 'Terminal', defaultAgent: 'claude', projectsDir: '', autoDetect: true })
  const [saving, setSaving] = useState(false)
  // One save at a time; a failed save says why and keeps the dialog open with the draft.
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try { await saveSettings(draft); setModal(null) } catch (err) { toast('error', (err as Error).message) } finally { setSaving(false) }
  }

  return (
    <Modal title={t('settings')} onClose={() => setModal(null)}>
      <form className="form" onSubmit={save}>
        {caps?.platform !== 'win32' && (
          <label>
            <span>{t('terminal')}</span>
            <select value={draft.terminal} onChange={(e) => setDraft({ ...draft, terminal: e.target.value as Settings['terminal'] })}>
              <option>Terminal</option>
              <option>iTerm</option>
              <option>Ghostty</option>
            </select>
          </label>
        )}
        <label>
          <span>{t('defaultAgent')}</span>
          <select value={draft.defaultAgent} onChange={(e) => setDraft({ ...draft, defaultAgent: e.target.value })}>
            {KNOWN_AGENTS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label>
          <span>{t('projectsDir')}</span>
          <input value={draft.projectsDir} onChange={(e) => setDraft({ ...draft, projectsDir: e.target.value })} spellCheck={false} />
          <small className="muted">{t('projectsDirHint')}</small>
        </label>
        {caps?.host === 'desktop' && (caps.ides.length > 1) && (
          <label>
            <span>{t('defaultIde')}</span>
            <select value={draft.defaultIde ?? caps.ides[0]} onChange={(e) => setDraft({ ...draft, defaultIde: e.target.value })}>
              {caps.ides.filter((id) => id !== 'Finder').map((id) => <option key={id} value={id}>{IDE_LABELS[id] ?? id}</option>)}
            </select>
          </label>
        )}
        {caps?.sessions && (
          <label>
            <span>{t('historyKeep')}</span>
            <select value={draft.historyDays ?? 90} onChange={(e) => setDraft({ ...draft, historyDays: Number(e.target.value) })}>
              <option value={30}>{t('days', { n: 30 })}</option>
              <option value={90}>{t('days', { n: 90 })}</option>
              <option value={365}>{t('days', { n: 365 })}</option>
              <option value={0}>{t('forever')}</option>
            </select>
          </label>
        )}
        {caps?.control && (
          <fieldset className="toggles">
            <legend>{t('careTitle')}</legend>
            <label className="check">
              <input type="checkbox" checked={draft.watchBranches ?? true} onChange={(e) => setDraft({ ...draft, watchBranches: e.target.checked })} />
              {t('careWatch')}
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.autoDraftPr ?? true} onChange={(e) => setDraft({ ...draft, autoDraftPr: e.target.checked })} />
              {t('careDraftPr')}
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.autoClean ?? true} onChange={(e) => setDraft({ ...draft, autoClean: e.target.checked })} />
              {t('careClean')}
            </label>
          </fieldset>
        )}
        {caps?.update && (
          <fieldset className="toggles">
            <label className="check">
              <input type="checkbox" checked={draft.autoUpdate ?? true} onChange={(e) => setDraft({ ...draft, autoUpdate: e.target.checked })} />
              {t('autoUpdate')}
            </label>
          </fieldset>
        )}
        <fieldset className="toggles">
          <label className="check">
            <input type="checkbox" checked={draft.autoDetect} onChange={(e) => setDraft({ ...draft, autoDetect: e.target.checked })} />
            {t('autoDetect')}
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.notifications ?? true} onChange={(e) => setDraft({ ...draft, notifications: e.target.checked })} />
            {t('notifyFinished')}
          </label>
          {/* Unset until asked: off here, and turning it on is the user's own yes. */}
          <label className="check">
            <input type="checkbox" checked={(draft.notifications ?? true) && (draft.notifyReady ?? false)} disabled={draft.notifications === false}
              onChange={(e) => setDraft({ ...draft, notifyReady: e.target.checked })} />
            {t('notifyReady')}
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.menuBar ?? true} onChange={(e) => setDraft({ ...draft, menuBar: e.target.checked })} />
            {t('menuBar')}
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.openAtLogin ?? false} onChange={(e) => setDraft({ ...draft, openAtLogin: e.target.checked })} />
            {t('openAtLogin')}
          </label>
        </fieldset>
        {caps?.setup && (
          <fieldset>
            <legend>{t('setupSection')}</legend>
            <SetupList mode="settings" />
          </fieldset>
        )}
        <div className="dialog-actions">
          {caps?.sessions && <button type="button" className="btn btn-ghost" onClick={() => setModal('onboarding')}>{t('obReplay')}</button>}
          <span className="sb-spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving && <Loader2 size={14} className="spin" />}{t('save')}</button>
        </div>
      </form>
    </Modal>
  )
}
