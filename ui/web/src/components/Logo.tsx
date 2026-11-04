import logo from '../assets/logo.png'

// The Ramify mark: one point branching into parallel work.
export function Logo({ size = 28 }: { size?: number }) {
  return <img className="logo-mark" src={logo} width={size} height={size} alt="" aria-hidden="true" />
}
