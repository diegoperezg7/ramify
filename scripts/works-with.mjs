// Builds docs/works-with.svg: the logos of the tools Ramify works with, for the README.
// Reads the same marks the app uses (ui/web/src/brands.generated.ts). Run: node scripts/works-with.mjs
import { writeFileSync } from 'node:fs'
import { BRANDS } from '../ui/web/src/brands.generated.ts'

const ROWS = [
  ['Agents', [['claude', 'Claude Code'], ['codex', 'Codex'], ['gemini', 'Gemini CLI'], ['copilot', 'Copilot'], ['cursor', 'Cursor CLI'],
    ['qwen', 'Qwen Code'], ['deepseek', 'DeepSeek'], ['kimi', 'Kimi'], ['vibe', 'Mistral Vibe'], ['grok', 'Grok'], ['amp', 'Amp'],
    ['opencode', 'OpenCode'], ['kiro', 'Kiro'], ['junie', 'Junie'], ['cline', 'Cline'], ['goose', 'Goose']]],
  ['Editors', [['VS Code', 'VS Code'], ['Cursor', 'Cursor'], ['Windsurf', 'Windsurf'], ['Antigravity', 'Antigravity'], ['Zed', 'Zed'],
    ['Xcode', 'Xcode'], ['IntelliJ IDEA', 'IntelliJ'], ['Android Studio', 'Android Studio'], ['PyCharm', 'PyCharm'], ['Trae', 'Trae']]],
  ['Terminals & apps', [['iTerm', 'iTerm'], ['Ghostty', 'Ghostty'], ['Warp', 'Warp'], ['WezTerm', 'WezTerm'], ['Windows Terminal', 'Windows Terminal'],
    ['tmux', 'tmux'], ['ChatGPT', 'ChatGPT'], ['Claude', 'Claude app'], ['github', 'GitHub']]],
]

const COLS = 8
const CELL_W = 112
const CELL_H = 92
const ICON = 36
const GREY = '#8b949e' // readable on GitHub's light and dark themes

let n = 0
/** Inline one mark at (x, y): ids made unique (several marks share id="a"), mono marks painted grey. */
function mark(key, x, y) {
  const b = BRANDS[key]
  if (!b) throw new Error(`no logo for ${key}`)
  const p = `m${n++}-`
  let svg = b.svg
    .replace(/\sid="([^"]+)"/g, ` id="${p}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`)
    .replace(/(xlink:)?href="#([^"]+)"/g, (_m, xl, id) => `${xl ?? ''}href="#${p}${id}"`)
    .replace(/currentColor/g, GREY)
  if (b.mono && !/fill=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace('<svg', `<svg fill="${GREY}"`)
  return svg.replace('<svg', `<svg x="${x}" y="${y}" width="${ICON}" height="${ICON}"`)
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
let y = 0
const parts = []
for (const [title, items] of ROWS) {
  parts.push(`<text x="0" y="${y + 18}" class="h">${esc(title.toUpperCase())}</text>`)
  y += 30
  items.forEach(([key, label], i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const cx = col * CELL_W + CELL_W / 2
    const top = y + row * CELL_H
    parts.push(mark(key, cx - ICON / 2, top + 6))
    parts.push(`<text x="${cx}" y="${top + ICON + 28}" class="l" text-anchor="middle">${esc(label)}</text>`)
  })
  y += Math.ceil(items.length / COLS) * CELL_H + 14
}

const width = COLS * CELL_W
const out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}" role="img" aria-label="Works with Claude Code, Codex, Gemini CLI, Copilot, Cursor and more">
<style>.h{font:600 12px -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.12em;fill:${GREY}}.l{font:500 13px -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;fill:${GREY}}</style>
${parts.join('\n')}
</svg>
`
writeFileSync('docs/works-with.svg', out)
console.log(`docs/works-with.svg ${width}x${y}, ${n} logos, ${Math.round(out.length / 1024)} KB`)
