// Builds ui/web/src/brands.generated.ts from the official brand marks shipped by
//   - LobeHub Icons (MIT)  AI models and agents
//   - Simple Icons  (CC0)  terminals, editors, GitHub
//   - Devicon       (MIT)  VS Code, PowerShell, Windows and programming languages
// Only the icons listed here end up in the app. Run: node scripts/brand-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(join(process.cwd(), 'ui/web/package.json'))
const si = require('simple-icons')
const lobeDir = join(dirname(require.resolve('@lobehub/icons-static-svg/package.json')), 'icons')
const devDir = join(dirname(require.resolve('devicon/package.json')), 'icons')

const clean = (svg) => svg
  .replace(/<\?xml[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<title>[^<]*<\/title>/g, '')
  .replace(/\s(width|height|style)="[^"]*"/g, '').replace(/\s+/g, ' ').trim()

const lobe = (name) => {
  const svg = clean(readFileSync(join(lobeDir, `${name}.svg`), 'utf8'))
  // Mono marks draw with currentColor and follow the theme; colour marks keep their palette.
  return { svg, mono: svg.includes('currentColor') && !name.endsWith('-color') }
}
const dev = (name, variant = 'original') => {
  for (const v of [variant, 'original', 'plain', 'original-wordmark']) {
    try { return { svg: clean(readFileSync(join(devDir, name, `${name}-${v}.svg`), 'utf8')), mono: false } } catch { /* next variant */ }
  }
  throw new Error(`devicon: ${name}`)
}
const simple = (slug) => {
  const icon = si[`si${slug[0].toUpperCase()}${slug.slice(1)}`]
  if (!icon) throw new Error(`simple-icons: ${slug}`)
  // Near-black brand colours vanish on a dark background: draw those with the text colour.
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(icon.hex.slice(i, i + 2), 16))
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 70
  return { svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="${dark ? 'currentColor' : `#${icon.hex}`}" d="${icon.path}"/></svg>`, mono: dark }
}

const ICONS = {
  // agent CLIs, by catalog id (packages/core/src/catalog.ts)
  claude: lobe('claude-color'), codex: lobe('codex-color'), gemini: lobe('gemini-color'), copilot: lobe('githubcopilot'),
  cursor: lobe('cursor'), 'cursor-agent': lobe('cursor'), opencode: lobe('opencode'), qwen: lobe('qwen-color'),
  deepcode: lobe('deepseek-color'), deepseek: lobe('deepseek-color'), kimi: lobe('kimi-color'), vibe: lobe('mistral-color'),
  grok: lobe('grok'), amp: lobe('amp-color'), kiro: lobe('kiro-color'), 'kiro-cli': lobe('kiro-color'), junie: lobe('junie-color'),
  qoder: lobe('qoder-color'), codebuddy: lobe('codebuddy-color'), mimo: lobe('xiaomimimo'), trae: lobe('trae-color'),
  hermes: lobe('hermesagent'), cline: lobe('cline'), kilocode: lobe('kilocode'), roo: lobe('roocode'), goose: lobe('goose'),
  openhands: lobe('openhands-color'), neovate: lobe('antgroup-color'), windsurf: lobe('windsurf'), antigravity: lobe('antigravity-color'),
  // desktop AI apps, by id and by name
  chatgpt: lobe('openai'), openai: lobe('openai'), 'claude-app': lobe('claude-color'), 'codex-app': lobe('codex-color'),
  'gemini-app': lobe('gemini-color'), 'copilot-app': lobe('copilot-color'), perplexity: lobe('perplexity-color'), 'grok-app': lobe('grok'),
  lechat: lobe('mistral-color'), 'deepseek-app': lobe('deepseek-color'), lmstudio: lobe('lmstudio'), ollama: lobe('ollama'), poe: lobe('poe-color'),
  ChatGPT: lobe('openai'), Claude: lobe('claude-color'), Codex: lobe('codex-color'), Gemini: lobe('gemini-color'), Copilot: lobe('copilot-color'),
  Perplexity: lobe('perplexity-color'), Grok: lobe('grok'), 'Le Chat': lobe('mistral-color'), DeepSeek: lobe('deepseek-color'),
  'LM Studio': lobe('lmstudio'), Ollama: lobe('ollama'), Poe: lobe('poe-color'),
  // model makers
  anthropic: lobe('claude-color'), google: lobe('gemini-color'), mistral: lobe('mistral-color'), meta: lobe('meta-color'), xai: lobe('xai'),
  huggingface: lobe('huggingface-color'), openrouter: lobe('openrouter-color'), zai: lobe('zai'), minimax: lobe('minimax-color'),
  // editors
  'VS Code': dev('vscode'), 'VS Code Insiders': dev('vscode'), VSCodium: simple('vscodium'), Cursor: lobe('cursor'), Windsurf: lobe('windsurf'),
  Antigravity: lobe('antigravity-color'), Kiro: lobe('kiro-color'), Trae: lobe('trae-color'), Qoder: lobe('qoder-color'), Zed: simple('zedindustries'),
  Xcode: simple('xcode'), 'Android Studio': dev('androidstudio'), Android: dev('android'), 'IntelliJ IDEA': dev('intellij'), PyCharm: dev('pycharm'),
  WebStorm: dev('webstorm'), GoLand: dev('goland'), PhpStorm: dev('phpstorm'), RubyMine: dev('rubymine'), CLion: dev('clion'), Rider: dev('rider'),
  RustRover: simple('jetbrains'), DataGrip: dev('datagrip'), Fleet: simple('jetbrains'), JetBrains: dev('jetbrains'), 'Visual Studio': dev('visualstudio'),
  'Sublime Text': simple('sublimetext'), Eclipse: dev('eclipse'), Emacs: dev('emacs'), 'Notepad++': simple('notepadplusplus'),
  Neovim: dev('neovim'), Vim: dev('vim'),
  // terminals
  iTerm: simple('iterm2'), Ghostty: simple('ghostty'), Warp: simple('warp'), WezTerm: simple('wezterm'), Alacritty: simple('alacritty'),
  Hyper: simple('hyper'), Termius: simple('termius'), tmux: dev('tmux'), 'Git Bash': dev('bash'), 'Windows Terminal': dev('windows11'),
  PowerShell: dev('powershell'), Windows: dev('windows11'), macOS: simple('apple'), Linux: simple('linux'),
  github: simple('github'), git: simple('git'),
  // languages, by GitHub's name for them
  TypeScript: dev('typescript'), JavaScript: dev('javascript'), Python: dev('python'), Swift: dev('swift'),
  Kotlin: dev('kotlin'), Rust: simple('rust'), Go: dev('go'), Java: dev('java'), Ruby: dev('ruby'),
  PHP: dev('php'), C: dev('c'), 'C++': dev('cplusplus'), 'C#': dev('csharp'), Dart: dev('dart'), HTML: dev('html5'),
  CSS: dev('css3'), SCSS: dev('sass'), Shell: dev('bash'), Vue: dev('vuejs'), Svelte: dev('svelte'),
  Dockerfile: dev('docker'), 'Jupyter Notebook': dev('jupyter'), 'Objective-C': dev('objectivec'), Lua: dev('lua'),
  Elixir: dev('elixir'), Scala: dev('scala'), Haskell: dev('haskell'), Astro: dev('astro'), MDX: simple('mdx'),
}

const body = Object.entries(ICONS)
  .map(([k, v]) => `  ${JSON.stringify(k)}: { mono: ${v.mono}, svg: ${JSON.stringify(v.svg)} },`).join('\n')
writeFileSync('ui/web/src/brands.generated.ts', `// Generated by scripts/brand-icons.mjs. Do not edit.
// Brand marks are trademarks of their owners, shown to identify the tools Ramify works with.
// Sources: LobeHub Icons (MIT), Simple Icons (CC0), Devicon (MIT).
export const BRANDS: Record<string, { mono: boolean; svg: string }> = {
${body}
}
`)
console.log(`${Object.keys(ICONS).length} icons`)
