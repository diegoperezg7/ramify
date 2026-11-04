import logo from '../assets/logo.png'

// The Ramify mark: one point branching into parallel work.
export function Logo({ size = 28 }: { size?: number }) {
  return <img className="logo-mark" src={logo} width={size} height={size} alt="" aria-hidden="true" />
}

/** The name, set in lowercase like a command: the same word you type in the terminal. */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()}>ramify</span>
}
