import type { Commit } from './types'

// Lane layout for a commit graph, newest first (git log --date-order).
// Row r holds one commit at column `col`; edges join row r to row r + 1.
// Edge ids are stable across refreshes (child commit + the commit the lane waits for),
// so the UI can animate lines moving instead of redrawing them.
export interface Edge { id: string; from: number; to: number; row: number; owner: string | null; last: boolean }
export interface GraphRow { commit: Commit; col: number }
export interface Layout { rows: GraphRow[]; edges: Edge[]; lanes: number }

export function layout(commits: Commit[]): Layout {
  const lanes: (string | null)[] = []
  const owners: (string | null)[] = []
  const rows: GraphRow[] = []
  const edges: Edge[] = []
  let width = 1

  const claim = (hash: string, owner: string | null): number => {
    let i = lanes.indexOf(null)
    if (i === -1) i = lanes.length
    lanes[i] = hash
    owners[i] = owner
    return i
  }

  commits.forEach((c, r) => {
    let col = lanes.indexOf(c.hash)
    if (col === -1) col = claim(c.hash, c.owner)
    lanes.forEach((h, i) => { if (h === c.hash && i !== col) lanes[i] = null })

    const fromNode = new Set<number>()
    const joins: number[] = []
    const [first, ...rest] = c.parents
    lanes[col] = first ?? null
    owners[col] = c.owner
    if (first) fromNode.add(col)
    for (const p of rest) {
      const existing = lanes.indexOf(p)
      if (existing === -1) fromNode.add(claim(p, c.owner))
      else joins.push(existing)
    }

    const next = commits[r + 1]
    const target = (i: number) => (next && lanes[i] === next.hash ? lanes.indexOf(next.hash) : i)
    const last = !next
    lanes.forEach((h, i) => {
      if (h === null) return
      if (fromNode.has(i)) edges.push({ id: `${c.hash}>${h}`, from: col, to: target(i), row: r, owner: c.owner, last })
      else edges.push({ id: `${c.hash}|${h}`, from: i, to: target(i), row: r, owner: owners[i], last })
    })
    for (const i of joins) edges.push({ id: `${c.hash}>${lanes[i]}`, from: col, to: target(i), row: r, owner: c.owner, last })

    rows.push({ commit: c, col })
    while (lanes.length && lanes[lanes.length - 1] === null) { lanes.pop(); owners.pop() }
    width = Math.max(width, lanes.length, col + 1)
  })

  return { rows, edges, lanes: width }
}
