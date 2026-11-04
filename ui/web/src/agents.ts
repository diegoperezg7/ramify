import { AGENTS, agentName } from '../../../packages/core/src/catalog.ts'
// Fixed color per agent (color follows the entity, never its position).
// Validated categorical palette: CVD-safe on #ffffff and #000000.
// Every use is paired with the agent's name, so identity is never color alone.
const SLOTS: Record<string, number> = {
  codex: 1,
  claude: 2,
  gemini: 3,
  cursor: 4,
  'cursor-agent': 4,
  copilot: 5,
  opencode: 6,
}

export function agentVar(agent: string | undefined | null): string {
  const slot = agent ? SLOTS[agent] : undefined
  return slot ? `var(--agent-${slot})` : 'var(--agent-other)'
}

/** Every agent in the catalog, by id. The "new worktree" form lists the installed ones first. */
export const KNOWN_AGENTS = AGENTS.map((a) => a.id)
export { agentName }
