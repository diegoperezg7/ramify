import { useEffect, useState, type ReactNode } from 'react'
import { agentVar, KNOWN_AGENTS } from '../agents'
import { bridge } from '../bridge'
import { useStore } from '../store'
import { AgentBadge } from './AgentBadge'

/**
 * Agents as chips with their logo instead of a long list of names: the ones installed here first,
 * the rest one click away. `none`: a "no agent" choice (only a worktree).
 */
export function AgentPicker({ value, onChange, none = false }: { value: string; onChange: (agent: string) => void; none?: boolean }) {
  const t = useStore((s) => s.t)
  const caps = useStore((s) => s.caps)
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (caps?.sessions) void bridge.tools().then((x) => setInstalled(x.agents)).catch(() => setInstalled(null))
  }, [caps])
  const list = installed && installed.length && !showAll ? installed : KNOWN_AGENTS
  const choices = [...new Set([...list, ...(value ? [value] : [])])]
  return (
    <div className="agent-picker">
      {choices.map((a) => (
        <button key={a} type="button" className={`agent-option${value === a ? ' is-on' : ''}`}
          style={{ ['--c' as string]: agentVar(a) }} onClick={() => onChange(a)} aria-pressed={value === a}>
          <AgentBadge agent={a} size={18} />{a}
        </button>
      ))}
      {none && (
        <button type="button" className={`agent-option${value === '' ? ' is-on' : ''}`} onClick={() => onChange('')} aria-pressed={value === ''}>
          {t('noneAgent')}
        </button>
      )}
      {installed && installed.length > 0 && !showAll && (
        <button type="button" className="agent-option is-more" onClick={() => setShowAll(true)}>{t('moreAgents')}</button>
      )}
    </div>
  )
}

/** A short set of choices as chips (with the tool's logo when there is one), all in sight instead of a dropdown. */
export function OptionPicker<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="agent-picker">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`agent-option${value === o.value ? ' is-on' : ''}`}
          onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}
