import { Bot, Check, Loader2, SquareTerminal, Terminal, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { bridge } from '../bridge'
import { useStore } from '../store'
import type { SetupItemId, SetupState } from '../types'
import { AgentBadge } from './AgentBadge'

const ICON: Record<SetupItemId, ReactNode> = {
  claude: <AgentBadge agent="claude" size={18} />,
  agents: <Bot size={18} />,
  shell: <SquareTerminal size={18} />,
  cli: <Terminal size={18} />,
}

/**
 * The one-click setup of this computer: Claude Code plugin, other agents' instructions, terminal and the
 * ramify command. Onboarding shows it with one "Set it all up" button; Settings, with one button per item.
 */
export function SetupList({ mode }: { mode: 'onboarding' | 'settings' }) {
  const t = useStore((s) => s.t)
  const toast = useStore((s) => s.toast)
  const [items, setItems] = useState<SetupState[] | null>(null)
  const [busy, setBusy] = useState<SetupItemId | 'all' | null>(null)
  const [changed, setChanged] = useState(false)

  useEffect(() => { void bridge.setupStatus().then(setItems).catch(() => setItems([])) }, [])

  const act = async (key: SetupItemId | 'all', fn: () => Promise<SetupState[]>) => {
    setBusy(key)
    try {
      const next = await fn()
      setItems(next)
      setChanged(true)
      const failed = next.find((s) => s.error)
      if (failed) toast('error', `${t(`setup_${failed.id}` as 'setup_claude')}: ${failed.error}`)
    } catch (e) { toast('error', (e as Error).message) } finally { setBusy(null) }
  }

  const todo = (items ?? []).filter((s) => s.status === 'todo')
  return (
    <div className="setup">
      <ul className="setup-list" aria-busy={!items}>
        {(items ?? []).map((s) => (
          <li key={s.id} className={`setup-item is-${s.status}${s.error ? ' has-error' : ''}`}>
            <span className="setup-icon">{ICON[s.id]}</span>
            <span className="setup-text">
              <b>{t(`setup_${s.id}` as 'setup_claude')}</b>
              <span className="muted small">{s.error ?? t(`setup_${s.id}Text` as 'setup_claudeText')}</span>
            </span>
            {mode === 'settings' && s.status !== 'unavailable' ? (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null}
                onClick={() => void act(s.id, () => (s.status === 'done' ? bridge.setupUndo(s.id) : bridge.setupApply([s.id])))}>
                {busy === s.id && <Loader2 size={13} className="spin" />}{t(s.status === 'done' ? 'setupOff' : 'setupOn')}
              </button>
            ) : (
              <span className={`setup-status is-${s.status}`}>
                {busy === 'all' && s.status === 'todo' ? <Loader2 size={13} className="spin" /> : s.error ? <TriangleAlert size={13} /> : s.status === 'done' ? <Check size={13} /> : null}
                {t(s.status === 'done' ? 'setupDone' : s.status === 'todo' ? 'setupTodo' : 'setupMissing')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {mode === 'onboarding' && items && (
        <button type="button" className="btn btn-primary setup-all" disabled={busy !== null || todo.length === 0}
          onClick={() => void act('all', () => bridge.setupApply())}>
          {busy === 'all' ? <Loader2 size={14} className="spin" /> : todo.length === 0 ? <Check size={14} /> : null}
          {todo.length === 0 ? t('setupAllDone') : t('setupAll')}
        </button>
      )}
      {changed && <p className="muted small setup-restart">{t('setupRestart')}</p>}
    </div>
  )
}
