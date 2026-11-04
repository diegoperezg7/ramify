// Renders the background of the macOS installer window (the DMG) into apps/desktop/resources/dmg-background.tiff:
// a dark violet field with git branches forking from the app towards Applications, in the logo's colours.
// One TIFF holds the 1x and @2x images, so the window is sharp on Retina screens.
// The icon positions here must match build.dmg.contents in apps/desktop/package.json. Finder shows the image under a
// title bar, so about the bottom 32 px stay hidden: nothing important goes there. Run: node scripts/dmg-background.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const W = 660
const H = 400
const APP = { x: 180, y: 190 } // icon centres, as in build.dmg.contents
const APPS = { x: 480, y: 190 }
const OUT = 'apps/desktop/resources/dmg-background.tiff'

// The trunk runs from the app to Applications; branches fork off it and end in the logo's three colours.
const trunkY = APP.y
const x0 = APP.x + 62
const x1 = APPS.x - 62
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="75%">
      <stop offset="0" stop-color="#1a0f3a"/><stop offset="0.55" stop-color="#0d0720"/><stop offset="1" stop-color="#05030d"/>
    </radialGradient>
    <linearGradient id="orange" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#fb923c"/></linearGradient>
    <linearGradient id="violet" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#a855f7"/></linearGradient>
    <linearGradient id="blue" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
    <!-- userSpaceOnUse: a gradient tied to the shape's box does not paint a perfectly straight line (zero height) -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- a faint commit graph in the corners, like git log --graph -->
  <g stroke="#8b7fd1" stroke-opacity="0.16" stroke-width="2" fill="none" stroke-linecap="round">
    <path d="M40 0 V400"/><path d="M40 70 C40 95 64 95 64 120 V250 C64 275 40 275 40 300"/>
    <path d="M620 0 V400"/><path d="M620 110 C620 135 596 135 596 160 V330"/>
  </g>
  <g fill="#8b7fd1" fill-opacity="0.22">
    <circle cx="40" cy="40" r="4"/><circle cx="64" cy="160" r="4"/><circle cx="64" cy="215" r="4"/><circle cx="40" cy="340" r="4"/>
    <circle cx="620" cy="70" r="4"/><circle cx="596" cy="200" r="4"/><circle cx="596" cy="290" r="4"/><circle cx="620" cy="370" r="4"/>
  </g>

  <!-- branches: soft glow underneath, then the lines -->
  <g fill="none" stroke-width="10" stroke-linecap="round" opacity="0.35" filter="url(#glow)">
    <path d="M${x0} ${trunkY} C${x0 + 60} ${trunkY} ${x0 + 50} ${trunkY - 70} ${x0 + 110} ${trunkY - 70} H${x1 - 30}" stroke="#fb923c"/>
    <path d="M${x0} ${trunkY} C${x0 + 60} ${trunkY} ${x0 + 50} ${trunkY + 70} ${x0 + 110} ${trunkY + 70} H${x1 - 30}" stroke="#38bdf8"/>
  </g>
  <g fill="none" stroke-width="3.5" stroke-linecap="round">
    <path d="M${x0} ${trunkY} C${x0 + 60} ${trunkY} ${x0 + 50} ${trunkY - 70} ${x0 + 110} ${trunkY - 70} H${x1 - 30}" stroke="url(#orange)"/>
    <path d="M${x0} ${trunkY} C${x0 + 60} ${trunkY} ${x0 + 50} ${trunkY + 70} ${x0 + 110} ${trunkY + 70} H${x1 - 30}" stroke="url(#blue)"/>
    <path d="M${x0} ${trunkY} H${x1}" stroke="url(#violet)"/>
  </g>
  <!-- the arrow into Applications, and the branch tips -->
  <path d="M${x1 - 12} ${trunkY - 9} L${x1} ${trunkY} L${x1 - 12} ${trunkY + 9}" fill="none" stroke="#a855f7" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${x0}" cy="${trunkY}" r="7" fill="#f3f0ff"/>
  <circle cx="${x1 - 30}" cy="${trunkY - 70}" r="6.5" fill="#fb923c" stroke="#0d0720" stroke-width="2"/>
  <circle cx="${x1 - 30}" cy="${trunkY + 70}" r="6.5" fill="#38bdf8" stroke="#0d0720" stroke-width="2"/>

  <!-- Finder writes icon names in black on a custom background (in dark mode too): a light tag under each name keeps it readable -->
  <rect x="${APP.x - 50}" y="${APP.y + 52}" width="100" height="24" rx="12" fill="#ece8f8" fill-opacity="0.92"/>
  <rect x="${APPS.x - 60}" y="${APPS.y + 52}" width="120" height="24" rx="12" fill="#ece8f8" fill-opacity="0.92"/>

  <text x="${W / 2}" y="${H - 64}" text-anchor="middle" fill="#9a92b8" font-family="-apple-system, 'SF Pro Text', Helvetica, sans-serif" font-size="13" letter-spacing="0.3">ramify</text>
</svg>`

const dir = mkdtempSync(join(tmpdir(), 'ramify-dmg-'))
const browser = await chromium.launch()
for (const [scale, name] of [[1, 'bg.png'], [2, 'bg@2x.png']]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
  await page.setContent(`<body style="margin:0;background:#05030d">${svg}</body>`)
  await page.locator('svg').screenshot({ path: join(dir, name) })
  await page.close()
}
await browser.close()
// tiffutil keeps both sizes in one file; Finder picks the one for the screen.
execFileSync('tiffutil', ['-cathidpicheck', join(dir, 'bg.png'), join(dir, 'bg@2x.png'), '-out', OUT])
rmSync(dir, { recursive: true, force: true })
console.log(`${OUT} (${W}x${H}, 1x + 2x)`)
