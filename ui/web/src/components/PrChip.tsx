import { GitPullRequest } from 'lucide-react'
import { useStore } from '../store'
import type { PullRequest } from '../types'

/** A pull request in one chip: number and state. A link, except inside another control (a graph row is a button). */
export function PrChip({ pr, link = true }: { pr: PullRequest; link?: boolean }) {
  const t = useStore((s) => s.t)
  const className = `chip cc-pr is-${pr.draft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase()}`
  const body = <><GitPullRequest size={11} />#{pr.number} · {t(pr.state === 'MERGED' ? 'prMerged' : pr.state === 'CLOSED' ? 'prClosed' : pr.draft ? 'prDraft' : 'prOpen')}</>
  return link
    ? <a className={className} href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>{body}</a>
    : <span className={className} title={pr.title}>{body}</span>
}
