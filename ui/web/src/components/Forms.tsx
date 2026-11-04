import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { agentVar, KNOWN_AGENTS } from '../agents'
import { useStore } from '../store'
import type { Settings } from '../types'

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

export function CreateDialog() {
  const t = useStore((s) => s.t)
  const caps = useStore((s) => s.caps)
  const settings = useStore((s) => s.settings)
  const state = useStore((s) => s.state)
  const busy = useStore((s) => s.busy)
  const setModal = useStore((s) => s.setModal)
  const createWorktree = useStore((s) => s.createWorktree)
  const [branch, setBranch] = useState('')
  const [agent, setAgent] = useState(settings?.defaultAgent ?? 'claude')
  const [base, setBase] = useState('')
  const [prompt, setPrompt] = useState('')

  const where = caps?.host === 'vscode' ? t('integratedTerminal') : settings?.terminal ?? 'Terminal'
  const valid = /^[\w./-]+$/.test(branch) && !branch.startsWith('-')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    if (await createWorktree({ branch, agent, base: base || undefined, prompt: prompt || undefined })) setModal(null)
  }

  return (
    <Modal title={t('newWorktree')} onClose={() => !busy && setModal(null)}>
      <form className="form" onSubmit={submit}>
        <label>
          <span>{t('branch')}</span>
          <input autoFocus value={branch} onChange={(e) => setBranch(e.target.value.replace(/\s/g, '-'))}
            placeholder="feat/login" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        </label>
        <fieldset>
          <legend>{t('agent')}</legend>
          <div className="agent-picker">
            {KNOWN_AGENTS.map((a) => (
              <button key={a} type="button" className={`agent-option${agent === a ? ' is-on' : ''}`}
                style={{ ['--c' as string]: agentVar(a) }} onClick={() => setAgent(a)} aria-pressed={agent === a}>
                <span className="dot" />{a}
              </button>
            ))}
            <button type="button" className={`agent-option${agent === '' ? ' is-on' : ''}`} onClick={() => setAgent('')} aria-pressed={agent === ''}>
              {t('noneAgent')}
            </button>
          </div>
        </fieldset>
        <label>
          <span>{t('baseRef')}</span>
          <input value={base} onChange={(e) => setBase(e.target.value.trim())} placeholder={state?.base ?? t('basePlaceholder')} spellCheck={false} />
        </label>
        {agent && (
          <label>
            <span>{t('prompt')}</span>
            <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholder')} />
          </label>
        )}
        <p className="muted small">{t('createHint', { where })}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setModal(null)}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            {busy ? <><Loader2 size={14} className="spin" />{t('creating')}</> : t('create')}
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
  const setModal = useStore((s) => s.setModal)
  const [draft, setDraft] = useState<Settings>(settings ?? { terminal: 'Terminal', defaultAgent: 'claude', projectsDir: '', autoDetect: true })

  return (
    <Modal title={t('settings')} onClose={() => setModal(null)}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await saveSettings(draft); setModal(null) }}>
        <label>
          <span>{t('terminal')}</span>
          <select value={draft.terminal} onChange={(e) => setDraft({ ...draft, terminal: e.target.value as Settings['terminal'] })}>
            <option>Terminal</option>
            <option>iTerm</option>
            <option>Ghostty</option>
          </select>
        </label>
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
        <fieldset className="toggles">
          <label className="check">
            <input type="checkbox" checked={draft.autoDetect} onChange={(e) => setDraft({ ...draft, autoDetect: e.target.checked })} />
            {t('autoDetect')}
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.notifications ?? true} onChange={(e) => setDraft({ ...draft, notifications: e.target.checked })} />
            {t('notifyFinished')}
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
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary">{t('save')}</button>
        </div>
      </form>
    </Modal>
  )
}
