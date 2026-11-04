import { agentVar } from '../agents'
import { BrandIcon, hasBrand } from './BrandIcon'

const MONO: Record<string, string> = {
  claude: 'Cl', codex: 'Cx', gemini: 'Ge', copilot: 'Co', cursor: 'Cu', 'cursor-agent': 'Cu',
  opencode: 'Oc', aider: 'Ai', amp: 'Am', goose: 'Go', droid: 'Dr', qwen: 'Qw', crush: 'Cr',
}

/**
 * The agent's official mark on a tile edged in the agent's colour, or a monogram when it has none.
 * Always paired with the agent's name or a title: never colour alone.
 */
export function AgentBadge({ agent, size = 18, live = false }: { agent: string; size?: number; live?: boolean }) {
  const style = { ['--c' as string]: agentVar(agent), width: size, height: size, fontSize: Math.round(size * 0.5) }
  if (hasBrand(agent)) {
    return (
      <span className={`agent-badge has-logo${live ? ' is-live' : ''}`} title={agent} style={style}>
        <BrandIcon name={agent} size={Math.round(size * 0.68)} />
      </span>
    )
  }
  const mono = MONO[agent] ?? (agent ? agent.slice(0, 2) : '··')
  return <span className={`agent-badge${live ? ' is-live' : ''}`} title={agent || undefined} style={style}>{mono}</span>
}
