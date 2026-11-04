import { BRANDS } from '../brands.generated'

/** Official mark of a tool (agent, model, editor, terminal, language), or null when there is none. */
export function BrandIcon({ name, size = 16, className = '' }: { name: string | null | undefined; size?: number; className?: string }) {
  const b = name ? BRANDS[brandKey(name)] : undefined
  if (!b) return null
  const cls = `brand-icon ${className}`.trim()
  // Mono marks are inlined so they take the text colour; colour marks are images so their ids never clash.
  if (b.mono) return <span className={cls} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: b.svg }} />
  return <img className={cls} src={`data:image/svg+xml;utf8,${encodeURIComponent(b.svg)}`} width={size} height={size} alt="" aria-hidden="true" />
}

/** "Ghostty · tmux" → Ghostty: the outer app is the one to show. */
export function brandKey(name: string): string {
  return name.split(' · ')[0]
}

export const hasBrand = (name: string | null | undefined) => !!name && brandKey(name) in BRANDS
