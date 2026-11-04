import { agentVar } from '../agents'

const MONO: Record<string, string> = {
  claude: 'Cl', codex: 'Cx', gemini: 'Ge', copilot: 'Co', cursor: 'Cu', 'cursor-agent': 'Cu',
  opencode: 'Oc', aider: 'Ai', amp: 'Am', goose: 'Go', droid: 'Dr', qwen: 'Qw', crush: 'Cr',
}

/** A small monogram tile in the agent's colour. Always paired with text or a title: never colour alone. */
export function AgentBadge({ agent, size = 18, live = false }: { agent: string; size?: number; live?: boolean }) {
  const mono = MONO[agent] ?? (agent ? agent.slice(0, 2) : '··')
  return (
    <span className={`agent-badge${live ? ' is-live' : ''}`} title={agent || undefined}
      style={{ ['--c' as string]: agentVar(agent), width: size, height: size, fontSize: Math.round(size * 0.5) }}>
      {mono}
    </span>
  )
}
