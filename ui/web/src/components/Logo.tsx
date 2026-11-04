// The agent-wt mark: two worktrees branching from one point, in the colours of two agents.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lm-bg" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stopColor="#9061f9" /><stop offset="0.55" stopColor="#5b21b6" /><stop offset="1" stopColor="#1c0a45" /></linearGradient>
        <linearGradient id="lm-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffb37a" /><stop offset="1" stopColor="#f26a2e" /></linearGradient>
        <linearGradient id="lm-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8ec5ff" /><stop offset="1" stopColor="#3b82f6" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#lm-bg)" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.5" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="1.5" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5.5">
        <path d="M14 18 L22 47 L32 30" stroke="url(#lm-l)" />
        <path d="M32 30 L42 47 L50 18" stroke="url(#lm-r)" />
      </g>
      <circle cx="14" cy="18" r="4.2" fill="#fff" /><circle cx="50" cy="18" r="4.2" fill="#fff" />
      <circle cx="32" cy="30" r="5.4" fill="#fff" /><circle cx="32" cy="30" r="2.1" fill="#5b21b6" />
    </svg>
  )
}
