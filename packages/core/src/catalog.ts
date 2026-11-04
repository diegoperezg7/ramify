// Every tool Ramify knows about: agent CLIs, editors, terminals and AI apps.
// One list feeds process detection, the "what is installed" scan, the onboarding and the logos.
// Pure data (no Node imports): the web UI imports it too.

export interface AgentSpec {
  /** Stable id stored in sessions and settings. */
  id: string
  name: string
  vendor: string
  /** Executable names. */
  bins: string[]
  /** npm / pip packages whose scripts run it under node, bun or python. */
  packages?: string[]
  /** Files or folders under $HOME that it creates once used. */
  config?: string[]
}

export const AGENTS: AgentSpec[] = [
  { id: 'claude', name: 'Claude Code', vendor: 'Anthropic', bins: ['claude'], packages: ['@anthropic-ai/claude-code'], config: ['.claude'] },
  { id: 'codex', name: 'Codex CLI', vendor: 'OpenAI', bins: ['codex'], packages: ['@openai/codex'], config: ['.codex'] },
  { id: 'gemini', name: 'Gemini CLI', vendor: 'Google', bins: ['gemini'], packages: ['@google/gemini-cli'], config: ['.gemini'] },
  { id: 'copilot', name: 'Copilot CLI', vendor: 'GitHub', bins: ['copilot'], packages: ['@github/copilot'], config: ['.copilot'] },
  { id: 'cursor', name: 'Cursor CLI', vendor: 'Cursor', bins: ['cursor-agent', 'agent'], config: ['.cursor/cli-config.json'] },
  { id: 'opencode', name: 'OpenCode', vendor: 'SST', bins: ['opencode'], packages: ['opencode-ai'], config: ['.config/opencode', '.local/share/opencode'] },
  { id: 'qwen', name: 'Qwen Code', vendor: 'Alibaba', bins: ['qwen'], packages: ['@qwen-code/qwen-code'], config: ['.qwen'] },
  { id: 'deepcode', name: 'Deep Code', vendor: 'DeepSeek', bins: ['deepcode'], packages: ['@vegamo/deepcode-cli'], config: ['.deepcode'] },
  { id: 'deepseek', name: 'DeepSeek TUI', vendor: 'DeepSeek', bins: ['deepseek-tui', 'deepseek', 'deepy'], packages: ['deepseek-tui', 'deepy-cli'] },
  { id: 'kimi', name: 'Kimi CLI', vendor: 'Moonshot AI', bins: ['kimi', 'kimi-code'], packages: ['kimi-cli', '@moonshot-ai/kimi-code'], config: ['.kimi'] },
  { id: 'vibe', name: 'Mistral Vibe', vendor: 'Mistral', bins: ['vibe'], packages: ['mistral-vibe'], config: ['.vibe'] },
  { id: 'grok', name: 'Grok CLI', vendor: 'xAI', bins: ['grok'], packages: ['@vibe-kit/grok-cli'], config: ['.grok'] },
  { id: 'amp', name: 'Amp', vendor: 'Sourcegraph', bins: ['amp'], packages: ['@sourcegraph/amp'], config: ['.config/amp'] },
  { id: 'droid', name: 'Droid', vendor: 'Factory', bins: ['droid'], config: ['.factory'] },
  { id: 'kiro', name: 'Kiro CLI', vendor: 'AWS', bins: ['kiro-cli', 'qchat'], config: ['.kiro', '.aws/amazonq'] },
  { id: 'junie', name: 'Junie CLI', vendor: 'JetBrains', bins: ['junie'], config: ['.junie'] },
  { id: 'auggie', name: 'Auggie', vendor: 'Augment Code', bins: ['auggie'], packages: ['@augmentcode/auggie'], config: ['.augment'] },
  { id: 'qoder', name: 'Qoder CLI', vendor: 'Alibaba', bins: ['qodercli'], config: ['.qoder'] },
  { id: 'codebuddy', name: 'CodeBuddy Code', vendor: 'Tencent', bins: ['codebuddy'], packages: ['@tencent-ai/codebuddy-code'], config: ['.codebuddy'] },
  { id: 'iflow', name: 'iFlow CLI', vendor: 'iFlow', bins: ['iflow'], packages: ['@iflow-ai/iflow-cli'], config: ['.iflow'] },
  { id: 'mimo', name: 'MiMo Code', vendor: 'Xiaomi', bins: ['mimo'], packages: ['@xiaomi-mimo/cli'] },
  { id: 'trae', name: 'Trae Agent', vendor: 'ByteDance', bins: ['trae-cli'] },
  { id: 'hermes', name: 'Hermes Agent', vendor: 'Nous Research', bins: ['hermes'], config: ['.hermes'] },
  { id: 'cline', name: 'Cline CLI', vendor: 'Cline', bins: ['cline'], packages: ['cline'], config: ['.cline'] },
  { id: 'kilocode', name: 'Kilo Code CLI', vendor: 'Kilo Code', bins: ['kilocode', 'kilo'], packages: ['@kilocode/cli'], config: ['.kilocode'] },
  { id: 'roo', name: 'Roo Code CLI', vendor: 'Roo Code', bins: ['roo'], packages: ['@roo-code/cli'] },
  { id: 'goose', name: 'Goose', vendor: 'Block', bins: ['goose'], config: ['.config/goose'] },
  { id: 'crush', name: 'Crush', vendor: 'Charm', bins: ['crush'], packages: ['@charmland/crush'], config: ['.config/crush', '.local/share/crush'] },
  { id: 'openhands', name: 'OpenHands', vendor: 'All Hands AI', bins: ['openhands'], config: ['.openhands'] },
  { id: 'aider', name: 'Aider', vendor: 'Aider', bins: ['aider'], packages: ['aider-chat'], config: ['.aider.conf.yml'] },
  { id: 'continue', name: 'Continue CLI', vendor: 'Continue', bins: ['cn'], packages: ['@continuedev/cli'], config: ['.continue'] },
  { id: 'qodo', name: 'Qodo Command', vendor: 'Qodo', bins: ['qodo'], packages: ['@qodo/command'], config: ['.qodo'] },
  { id: 'letta', name: 'Letta Code', vendor: 'Letta', bins: ['letta'], packages: ['@letta-ai/letta-code'], config: ['.letta'] },
  { id: 'codebuff', name: 'Codebuff', vendor: 'Codebuff', bins: ['codebuff'], packages: ['codebuff'] },
  { id: 'plandex', name: 'Plandex', vendor: 'Plandex', bins: ['plandex', 'pdx'] },
  { id: 'gptme', name: 'gptme', vendor: 'gptme', bins: ['gptme'], config: ['.config/gptme'] },
  { id: 'interpreter', name: 'Open Interpreter', vendor: 'Open Interpreter', bins: ['interpreter'], packages: ['open-interpreter'] },
  { id: 'pi', name: 'Pi', vendor: 'Pi', bins: ['pi'], packages: ['@mariozechner/pi-coding-agent'], config: ['.pi/agent'] },
  { id: 'neovate', name: 'Neovate Code', vendor: 'Ant Group', bins: ['neovate'], packages: ['@neovate/code'] },
  { id: 'tabnine', name: 'Tabnine CLI', vendor: 'Tabnine', bins: ['tabnine'] },
]

/** Executables too generic to trust by name alone: only when their path says who they are. */
export const BIN_PATH_GUARD: Record<string, RegExp> = { agent: /cursor/i, pi: /pi-coding-agent|\.pi\b/i, cn: /continue/i, roo: /roo/i }

export interface AppSpec {
  name: string
  /** macOS bundle names (without .app). */
  mac: string[]
  /** Windows executables, relative to %LOCALAPPDATA%, %ProgramFiles% or %ProgramFiles(x86)%. */
  win: string[]
}

export interface EditorSpec extends AppSpec {
  /** VS Code family: folder under Application Support / %APPDATA% with User/workspaceStorage. */
  storage?: string
  /** The built-in AI whose chat is inferred from workspace activity. */
  ai?: string
  /** Only chat files count (the editor's AI is an extension, not the editor itself). */
  chatOnly?: boolean
}

export const EDITORS: EditorSpec[] = [
  { name: 'VS Code', mac: ['Visual Studio Code'], win: ['Programs/Microsoft VS Code/Code.exe', 'Microsoft VS Code/Code.exe'], storage: 'Code', ai: 'copilot', chatOnly: true },
  { name: 'VS Code Insiders', mac: ['Visual Studio Code - Insiders'], win: ['Programs/Microsoft VS Code Insiders/Code - Insiders.exe'], storage: 'Code - Insiders', ai: 'copilot', chatOnly: true },
  { name: 'Cursor', mac: ['Cursor'], win: ['Programs/cursor/Cursor.exe'], storage: 'Cursor', ai: 'cursor' },
  { name: 'Windsurf', mac: ['Windsurf'], win: ['Programs/Windsurf/Windsurf.exe'], storage: 'Windsurf', ai: 'windsurf' },
  { name: 'Antigravity', mac: ['Antigravity'], win: ['Programs/Antigravity/Antigravity.exe'], storage: 'Antigravity', ai: 'antigravity' },
  { name: 'Kiro', mac: ['Kiro'], win: ['Programs/Kiro/Kiro.exe'], storage: 'Kiro', ai: 'kiro' },
  { name: 'Trae', mac: ['Trae'], win: ['Programs/Trae/Trae.exe'], storage: 'Trae', ai: 'trae' },
  { name: 'Qoder', mac: ['Qoder'], win: ['Programs/Qoder/Qoder.exe'], storage: 'Qoder', ai: 'qoder' },
  { name: 'Void', mac: ['Void'], win: ['Programs/Void/Void.exe'], storage: 'Void', ai: 'void' },
  { name: 'VSCodium', mac: ['VSCodium'], win: ['Programs/VSCodium/VSCodium.exe'], storage: 'VSCodium' },
  { name: 'Positron', mac: ['Positron'], win: ['Programs/Positron/Positron.exe'], storage: 'Positron' },
  { name: 'Zed', mac: ['Zed'], win: ['Programs/Zed/zed.exe'] },
  { name: 'Xcode', mac: ['Xcode'], win: [] },
  { name: 'Android Studio', mac: ['Android Studio'], win: ['Android/Android Studio/bin/studio64.exe'] },
  { name: 'IntelliJ IDEA', mac: ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA CE'], win: ['JetBrains/IntelliJ IDEA/bin/idea64.exe'] },
  { name: 'PyCharm', mac: ['PyCharm', 'PyCharm Professional Edition', 'PyCharm CE', 'PyCharm Community Edition'], win: ['JetBrains/PyCharm/bin/pycharm64.exe'] },
  { name: 'WebStorm', mac: ['WebStorm'], win: ['JetBrains/WebStorm/bin/webstorm64.exe'] },
  { name: 'GoLand', mac: ['GoLand'], win: ['JetBrains/GoLand/bin/goland64.exe'] },
  { name: 'PhpStorm', mac: ['PhpStorm'], win: ['JetBrains/PhpStorm/bin/phpstorm64.exe'] },
  { name: 'RubyMine', mac: ['RubyMine'], win: ['JetBrains/RubyMine/bin/rubymine64.exe'] },
  { name: 'CLion', mac: ['CLion'], win: ['JetBrains/CLion/bin/clion64.exe'] },
  { name: 'Rider', mac: ['Rider'], win: ['JetBrains/JetBrains Rider/bin/rider64.exe'] },
  { name: 'RustRover', mac: ['RustRover'], win: ['JetBrains/RustRover/bin/rustrover64.exe'] },
  { name: 'DataGrip', mac: ['DataGrip'], win: ['JetBrains/DataGrip/bin/datagrip64.exe'] },
  { name: 'Fleet', mac: ['Fleet'], win: ['Programs/Fleet/Fleet.exe'] },
  { name: 'Visual Studio', mac: [], win: ['Microsoft Visual Studio/2022/Community/Common7/IDE/devenv.exe', 'Microsoft Visual Studio/2022/Professional/Common7/IDE/devenv.exe', 'Microsoft Visual Studio/2022/Enterprise/Common7/IDE/devenv.exe'] },
  { name: 'Sublime Text', mac: ['Sublime Text'], win: ['Sublime Text/sublime_text.exe', 'Sublime Text 3/sublime_text.exe'] },
  { name: 'Nova', mac: ['Nova'], win: [] },
  { name: 'BBEdit', mac: ['BBEdit'], win: [] },
  { name: 'Eclipse', mac: ['Eclipse'], win: [] },
  { name: 'Emacs', mac: ['Emacs'], win: [] },
  { name: 'Notepad++', mac: [], win: ['Notepad++/notepad++.exe'] },
]

export const TERMINALS: AppSpec[] = [
  { name: 'Terminal', mac: ['Utilities/Terminal'], win: [] },
  { name: 'iTerm', mac: ['iTerm'], win: [] },
  { name: 'Ghostty', mac: ['Ghostty'], win: [] },
  { name: 'Warp', mac: ['Warp'], win: ['Programs/Warp/warp.exe'] },
  { name: 'WezTerm', mac: ['WezTerm'], win: ['WezTerm/wezterm-gui.exe'] },
  { name: 'Alacritty', mac: ['Alacritty'], win: ['Alacritty/alacritty.exe'] },
  { name: 'kitty', mac: ['kitty'], win: [] },
  { name: 'Hyper', mac: ['Hyper'], win: ['Programs/Hyper/Hyper.exe'] },
  { name: 'Tabby', mac: ['Tabby'], win: ['Programs/Tabby/Tabby.exe'] },
  { name: 'Rio', mac: ['Rio'], win: [] },
  { name: 'Wave', mac: ['Wave'], win: ['Programs/waveterm/Wave.exe'] },
  { name: 'Termius', mac: ['Termius'], win: ['Programs/Termius/Termius.exe'] },
  { name: 'Windows Terminal', mac: [], win: ['Microsoft/WindowsApps/wt.exe'] },
  { name: 'PowerShell', mac: [], win: ['PowerShell/7/pwsh.exe'] },
  { name: 'Git Bash', mac: [], win: ['Git/git-bash.exe'] },
  { name: 'ConEmu', mac: [], win: ['ConEmu/ConEmu64.exe'] },
]

export interface AiAppSpec extends AppSpec { id: string }

export const AI_APP_LIST: AiAppSpec[] = [
  { id: 'chatgpt', name: 'ChatGPT', mac: ['ChatGPT'], win: ['Programs/ChatGPT/ChatGPT.exe'] },
  { id: 'claude-app', name: 'Claude', mac: ['Claude'], win: ['AnthropicClaude/claude.exe'] },
  { id: 'codex-app', name: 'Codex', mac: ['Codex'], win: ['Programs/Codex/Codex.exe'] },
  { id: 'gemini-app', name: 'Gemini', mac: ['Gemini'], win: [] },
  { id: 'copilot-app', name: 'Copilot', mac: ['Copilot'], win: [] },
  { id: 'perplexity', name: 'Perplexity', mac: ['Perplexity'], win: ['Programs/Perplexity/Perplexity.exe'] },
  { id: 'grok-app', name: 'Grok', mac: ['Grok'], win: [] },
  { id: 'lechat', name: 'Le Chat', mac: ['Le Chat'], win: [] },
  { id: 'deepseek-app', name: 'DeepSeek', mac: ['DeepSeek'], win: [] },
  { id: 'lmstudio', name: 'LM Studio', mac: ['LM Studio'], win: ['Programs/LM Studio/LM Studio.exe'] },
  { id: 'ollama', name: 'Ollama', mac: ['Ollama'], win: ['Programs/Ollama/ollama app.exe'] },
  { id: 'jan', name: 'Jan', mac: ['Jan'], win: ['Programs/Jan/Jan.exe'] },
  { id: 'msty', name: 'Msty', mac: ['Msty'], win: ['Programs/Msty/Msty.exe'] },
  { id: 'poe', name: 'Poe', mac: ['Poe'], win: ['Programs/Poe/Poe.exe'] },
]

/** All agent executables. */
export const AGENT_BINS = AGENTS.flatMap((a) => a.bins)

const byBin = new Map(AGENTS.flatMap((a) => a.bins.map((b) => [b, a.id] as const)))
const byPkg = AGENTS.flatMap((a) => (a.packages ?? []).map((p) => [p, a.id] as const))

/** Agent id for an executable name (with its full path for the guarded generic names), or null. */
export function agentForBin(bin: string, path = ''): string | null {
  const id = byBin.get(bin)
  if (!id) return null
  const guard = BIN_PATH_GUARD[bin]
  return guard && !guard.test(path) ? null : id
}

/** Agent id for a script run by an interpreter, from the package in its path, or null. */
export function agentForScript(path: string): string | null {
  for (const [pkg, id] of byPkg) if (path.includes(`/${pkg}/`) || path.includes(`/node_modules/${pkg}`)) return id
  return null
}

export const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id

/** What `ramify -a` runs for an agent id: its executable (ramify maps `cursor` itself). */
export function launchBin(id: string): string {
  if (id === 'cursor') return 'cursor'
  return AGENTS.find((a) => a.id === id)?.bins[0] ?? id
}
