// Renders the menu bar images of the desktop app into apps/desktop/resources/tray/ (1x and @2x):
//   badge-<tone>-<n>.png  a pill with the Ramify glyph and a count: violet while agents work, amber when one waits for you
//   agent-<id>.png                16 pt agent logos for the menu
// The menu bar takes bitmaps only, so they are drawn once here. Run: node scripts/tray-assets.mjs
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'
import { AGENTS } from '../packages/core/src/catalog.ts'
import { BRANDS } from '../ui/web/src/brands.generated.ts'

const OUT = 'apps/desktop/resources/tray'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const glyph = readFileSync('apps/desktop/resources/tray.svg', 'utf8')
// A self-contained pill (glyph + count) reads on any menu bar: macOS tints the bar from the wallpaper, so a
// light/dark guess from the system appearance is wrong half the time, and template images cannot carry colour.
const TONES = { working: ['linear-gradient(135deg,#8b5cf6,#6d28d9)', '#ffffff'], waiting: ['linear-gradient(135deg,#fbbf24,#d97706)', '#1c1917'] }
const COUNTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']

function badge(tone, n) {
  const [bg, fg] = TONES[tone]
  const g = glyph.replace(/#000/g, fg).replace('width="32" height="32"', 'width="13" height="13"')
  return `<div id="x" style="display:inline-flex;align-items:center;gap:3px;height:16px;padding:0 6px 0 5px;border-radius:8px;background:${bg};color:${fg};font:700 11px/1 -apple-system,'SF Pro Text',Helvetica,sans-serif;font-variant-numeric:tabular-nums;box-sizing:border-box">${g}<span>${n}</span></div>`
}

function logo(id) {
  const b = BRANDS[id]
  // Mono marks in a neutral grey that reads on light and dark menus.
  const svg = b.svg.replace(/currentColor/g, '#8b949e').replace('<svg', '<svg width="16" height="16"')
  return `<div id="x" style="display:inline-grid;place-items:center;width:16px;height:16px">${svg}</div>`
}

const browser = await chromium.launch()
async function render(html, file) {
  for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
    const page = await browser.newPage({ deviceScaleFactor: scale })
    await page.setContent(`<body style="margin:0;background:transparent">${html}</body>`)
    await page.locator('#x').screenshot({ path: `${OUT}/${file}${suffix}.png`, omitBackground: true })
    await page.close()
  }
}

let n = 0
for (const tone of Object.keys(TONES)) for (const c of COUNTS) {
  await render(badge(tone, c), `badge-${tone}-${c === '9+' ? '10' : c}`)
  n++
}
for (const a of AGENTS) if (BRANDS[a.id]) { await render(logo(a.id), `agent-${a.id}`); n++ }
await browser.close()
console.log(`${n} images in ${OUT}`)
