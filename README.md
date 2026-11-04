<p align="center"><img src="docs/logo.png" width="160" alt="Ramify logo"></p>

<h1 align="center">Ramify</h1>

<p align="center">
  <b>Run every AI coding agent at once. Never lose track of a branch again.</b><br>
  Claude Code, Codex, Gemini, Copilot, Cursor and 35 more, working side by side on the same repository,
  each on its own branch, with its own ports and dependencies. Ramify sees them all, keeps them apart and
  shows you what each one changed.
</p>

<p align="center">
  <a href="https://github.com/diegoperezg7/ramify/releases/latest"><b>Download for macOS</b></a> ·
  <a href="https://github.com/diegoperezg7/ramify/releases/latest"><b>Download for Windows</b></a> ·
  <a href="https://github.com/diegoperezg7/ramify/releases/latest">VS Code / Cursor extension</a> ·
  <a href="#install">CLI</a>
</p>

<p align="center">
  <a href="https://github.com/diegoperezg7/ramify/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/diegoperezg7/ramify/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4e4e4e">
  <img alt="local first" src="https://img.shields.io/badge/local--first-no%20telemetry-1a7f37">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-7c3aed"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/lang-español-4e4e4e"></a>
</p>

<p align="center"><img src="docs/ramify-demo.gif" alt="Ramify in 30 seconds: six agents working at once, each on its own branch; the control center, the GitHub-style diff of each agent and the branch timeline"><br><sub><a href="docs/ramify-demo.mp4">Watch it as a video</a></sub></p>

## The problem

AI agents are fast, and you want more than one. Put two in the same folder and they overwrite each other's
files. Give each its own branch and, a week later, nobody knows which branch had the fix you needed, which
agent wrote it, or whether it was ever merged.

**Ramify fixes both.** Every task gets its own git worktree, ready to run. Every AI session on your
computer is detected by itself. And every branch is on one screen: what changed, who changed it, where it went.

## What you get

### 1. It sees every AI session, by itself

<img src="docs/app-sessions.png" alt="AI sessions: six agents working now, each with its terminal, repository and branch, and a warning for the one working on main">

Open Claude Code in a terminal, Codex in tmux, Cursor's chat or the ChatGPT app: Ramify notices, tells you
which repository and branch each one is in and whether it is working or waiting for you. No buttons to press,
no plugin to install in each tool.

- **40 agent CLIs, 32 editors, 16 terminals and 14 AI apps** recognised, with their official logos.
- It follows a conversation to the project it is really working in, even when the agent was started in your home folder.
- A history of every session (where, which repo and branch, how long, its pull request), exported to CSV or JSON.
- In the menu bar: how many agents are working, in amber when one is waiting for you, and each one's logo and branch a click away.

### 2. One branch per agent, without the mess

Open agents the way you always do: with the terminal integration on (`ramify install shell`, or one switch in the app),
typing `claude`, `codex` or `gemini` in a repository gives that agent its own branch and folder before it starts. Already
on a branch of its own, or running a script, nothing changes. Work started on `main` by mistake moves to its own branch
in one step (`ramify move`), with a stash kept as a backup.

When two agents end up on the same branch, or one starts changing `main`, Ramify warns you (in the app and
as a notification) and gives that agent its own branch in one click.

Each worktree is ready to work in: ignored files such as `.env` copied, dependencies installed, its own block
of ports and, for iOS, its own simulator. The same for every agent, from the app, the editor or the terminal.

### 3. See exactly what each agent changed

The diff you know from GitHub: line numbers, green for added, red for removed, a summary per file. Open the
branch in the editors you actually have installed, launch the agent again, merge it, or remove it. Ramify
refuses to delete anything that is not committed or not merged.

<img src="docs/app-dark.png" alt="Four agents on four branches of the same repository, with the GitHub-style diff of the one Codex is working on">

### 4. A control center for every branch being built

Each branch with its agent and what it is doing, commits, uncommitted work, how far behind `main` it is, the size of the
change (with a warning past ~400 lines), its pull request, and a warning when two branches touch the same files. One
click for what it needs next: bring in `main`, open a draft pull request, merge, or remove it once merged. A
contribution grid shows the last six months of commits. Optional automation, each with its own switch: warnings, a
draft pull request when an agent finishes on a pushed branch, and clean-up of merged worktrees.

<img src="docs/app-control.png" alt="Control center: every branch being built with its agent, commits, uncommitted work and size, and the contribution grid">

### 5. Every branch on one timeline

<img src="docs/app-timeline.png" alt="Branch timeline: active, stale and merged branches with their forks and merges">

One band per branch, from where it forked to where it was merged, coloured by the agent that worked on it.
Branches that were merged and deleted are rebuilt from their merge commits, so the story stays complete.

### 6. Set up in a minute

<img src="docs/app-onboarding.png" alt="Onboarding: the agents, editors, terminals and AI apps found on this computer">

Ramify finds what you use on its own, signs in to GitHub with a code (read-only, you pick the repositories)
and lays your projects out by what matters: where agents are working now, what is on this machine, and the rest of GitHub.

## Works with

<p align="center"><img src="docs/works-with.svg" alt="Works with Claude Code, Codex, Gemini CLI, Copilot, Cursor, Qwen Code, DeepSeek, Kimi, Mistral Vibe, Grok, Amp, OpenCode, Kiro, Junie, Cline, Goose, VS Code, Cursor, Windsurf, Antigravity, Zed, Xcode, IntelliJ, Android Studio, PyCharm, Trae, iTerm, Ghostty, Warp, WezTerm, Windows Terminal, tmux, ChatGPT, Claude and GitHub"></p>

Any other agent works too: Ramify launches whatever command you give it.

## Private by design

- **Local-first, no telemetry.** Nothing about your code, prompts or sessions leaves your computer.
- **GitHub, read-only.** Sign-in uses a GitHub App with the device flow: read access to repository metadata
  and pull requests, only on the repositories you choose. No secret ships with the app.
- **Tokens in the system keychain**, encrypted, refreshed every 8 hours, never written in plain text or logs,
  never handed to the interface.
- **Hardened.** A repository's own git settings cannot make Ramify run programs; the desktop window has a strict
  Content Security Policy, no browser permissions and locked Electron fuses; links open only over https (or to your own machine).

## Before and after

| | Without Ramify | With Ramify |
|---|---|---|
| Two agents, one repository | They overwrite each other's files | Each on its own branch and folder |
| A new branch for an agent | Copy `.env`, install dependencies, pick a free port… | One command or one click |
| Which agent is doing what | Switch between terminal tabs | One screen, live, detected by itself |
| An agent working on `main` | You find out later | A warning and a one-click branch |
| What each agent changed | `git diff` in each folder | GitHub-style diff per branch |
| Last month's branches | Gone from memory | A timeline, merged ones included |

## Status

**Version 0.6.0.** Desktop app for macOS (Apple silicon and Intel) and Windows (x64), VS Code / Cursor extension,
CLI and Claude Code plugin, all built from this repository.

- **Tested:** 56 engine tests, 5 end-to-end UI tests in a real browser and 45 CLI tests run on every push; the engine
  suite, the Windows installer and a smoke test that opens the packaged app also run on Windows.
- **Not signed yet:** macOS and Windows show a warning the first time (see below). Signing and notarization switch on
  by themselves once the release has certificates.
- **GitHub sign-in** needs the Ramify GitHub App to be registered for the build; until then GitHub features use the
  `gh` CLI you are signed in to.
- **Windows:** terminal agents are listed without their repository (Windows does not expose another process's folder),
  and the app has been verified in CI rather than by hand.

## Install

**Desktop app** (macOS 12+ on Apple silicon or Intel, Windows 10+): download it from the
[latest release](https://github.com/diegoperezg7/ramify/releases/latest). It is not signed yet: on macOS right-click it the first time and choose *Open*;
on Windows choose *More info* → *Run anyway*. Windows needs [Git for Windows](https://git-scm.com/download/win).

**VS Code / Cursor extension**: the `.vsix` in the [latest release](https://github.com/diegoperezg7/ramify/releases/latest), then
`code --install-extension ramify-*.vsix` (or `cursor --install-extension …`).

**CLI** (macOS and Linux, Windows through Git Bash):

```bash
git clone https://github.com/diegoperezg7/ramify.git
cd ramify && ./install.sh          # puts ramify in ~/.local/bin
```

Requires `git` 2.20+ and `bash` 3.2+. Optional: `python3` for `ramify ui`, `jq` for the Claude Code hooks, `tmux` for `--tmux`.

**Claude Code plugin**: every worktree Claude Code creates (`--worktree`, background sessions, `/batch`,
subagents) goes through Ramify.

```text
/plugin marketplace add diegoperezg7/ramify
/plugin install ramify@ramify
```

It adds good-practice skills: `/ramify:nueva-rama` (start a task on its own branch), `/ramify:portar-tarea` (move work
off main), `/ramify:preparar-pr` (up to date, small, conventional commits, draft PR) and `/ramify:terminar-tarea`
(check it is merged, remove worktree and branch), plus `/ramify:status` and `/ramify:ui`.

## Quick start

```bash
cd ~/code/your-repo
ramify new feat/login  -a claude -p "add login with magic links"
ramify new fix/cart    -a codex  -p "fix the cart total rounding"
ramify ls              # who is working where, what changed, what is ready to merge
```

When an agent is done, review its diff in the app, merge it, and `ramify rm` the worktree.

## FAQ

**Do I have to change how I work?** No. Keep opening agents the way you do now; Ramify notices them.
Use `ramify new` (or the app's *New worktree*) when you want a fresh branch for a task.

**Does it send my code anywhere?** No. Everything runs on your computer. The only network calls are to
github.com, and only if you sign in (or through the `gh` CLI you already use).

**Which agents does it support?** The 40 it recognises are detected and shown with their logos; any other
command can be launched in a worktree all the same.

**How does it detect the chat inside Cursor or VS Code?** From the editor's own workspace activity. Those
sessions are marked *inferred*, because an editor being active is not proof of a conversation.

**Windows?** The app, the worktrees and session detection work on Windows. One difference: Windows does not let
another program read a process's working folder, so terminal agents there are shown without their repository.

**What happens to the branches when I am done?** Nothing you did not ask for. `ramify prune` removes only clean,
merged worktrees, and `rm` refuses when there is anything uncommitted or unmerged.

## Reference

### Commands

```bash
ramify new feat/login -a claude -p "add login with magic links"
ramify new fix/cart -a codex -i cursor          # agent in the terminal, worktree open in Cursor
ramify new ios/widget -i xcode                  # opens the generated .xcodeproj
ramify new docs/api -a opencode --tmux          # detached tmux session
ramify open fix/cart -a gemini                  # reopen an existing worktree with another agent

ramify ls                                       # every worktree at a glance
ramify graph                                    # branch graph with the agent on each branch
ramify ui                                       # live web dashboard in the browser
ramify app                                      # open this repository in the desktop app
ramify rm fix/cart                              # refuses if anything would be lost
ramify prune                                    # remove clean worktrees that are already merged

ramify install shell                            # agents typed in a main checkout get their own branch
ramify move feat/tax -a claude                  # move uncommitted work off main to its own branch
```

`-f <ref>` picks the base, `--no-setup` skips setup, and anything after `--` is passed to the agent.
`-a` takes any agent (`claude`, `codex`, `gemini`, `copilot`, `cursor`, `opencode`, `qwen`, `kimi`, `aider`…)
or any other command; `-p` is passed the way each agent expects, or copied to the clipboard.
`-i` opens an editor: `xcode`, `cursor`, `code`, `zed`, `idea`, or any app by name (`-i "Android Studio"`).

<p align="center"><img src="docs/graph.svg" alt="ramify graph: commit graph of every worktree branch, labelled with its agent"></p>

### How a worktree is prepared

<p align="center"><img src="docs/architecture.svg" alt="Ramify creates a worktree, copies ignored files, reserves ports, runs setup and launches the agent"></p>

1. **Worktree** in `~/.worktrees/<repo>/<name>`, outside the repository, so editors and file watchers in the main checkout never index it.
2. **Ignored files** listed in `.worktreeinclude` (gitignore syntax, the file Claude Code reads too) are copied, such as `.env`.
3. **Ports**: a block of 10 (`PORT` to `PORT+9`) starting at 4100.
4. **Setup**: `.worktree/setup.sh` if the project has one; otherwise `xcodegen generate`, `pnpm`/`yarn`/`bun`/`npm ci` or `uv sync`.
5. **Launch**: the agent in the worktree with `.worktree.env` exported, and/or your editor.

### Inside a worktree

Every worktree has a `.worktree.env`, excluded from git, that is exported into the agent:

| Variable       | Example                                  |
|----------------|------------------------------------------|
| `WT_NAME`      | `feat-login`                             |
| `WT_BRANCH`    | `feat/login`                             |
| `WT_PATH`      | `~/.worktrees/shop/feat-login`           |
| `WT_MAIN`      | `~/code/shop`                            |
| `WT_AGENT`     | `claude`                                 |
| `PORT`         | `4100` (use `4100` to `4109`)            |
| `DERIVED_DATA` | `~/.worktrees/shop/.derived-data/feat-login` |

Agents learn the rules from a short block in their global instructions:

```bash
ramify install instructions
```

It adds [`snippets/agent-instructions.md`](snippets/agent-instructions.md) once to every agent
that is installed: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
`~/.config/opencode/AGENTS.md`, `~/.copilot/copilot-instructions.md` and `~/.config/amp/AGENTS.md`.
Nothing is written into your repositories.

### Project setup

```
your-repo/
├── .worktreeinclude          # ignored files to copy: .env, Local.xcconfig ...
└── .worktree/
    ├── setup.sh              # runs in each new worktree, with .worktree.env exported
    └── teardown.sh           # runs before the worktree is removed
```

Both scripts are optional and can stay untracked: Ramify also looks for them in the main checkout.
See [`examples/`](examples):

- [`ios-xcodegen`](examples/ios-xcodegen): `xcodegen generate` plus a dedicated simulator per
  worktree (`SIM_UDID`), deleted on removal.
- [`web`](examples/web): `npm ci` and a `.env.local` that pins Vite and the API to the worktree's ports.

### Claude Code integration

```bash
ramify install claude-hooks
```

This registers Ramify as Claude Code's `WorktreeCreate` and `WorktreeRemove` hooks (with a backup
of `~/.claude/settings.json`). From then on `claude --worktree`, background sessions, `/batch`,
workflows and subagents with `isolation: worktree` all create their worktrees through Ramify,
with the same layout, ports and setup as every other agent. Claude Code keeps subagent worktrees
after they finish, so run `ramify prune` now and then.

### Safety

- `rm` refuses when there are uncommitted changes, or commits that are neither merged nor pushed.
- `rm --force` discards uncommitted changes but **never deletes a branch with unmerged commits**:
  the worktree goes, the branch stays.
- `prune` only removes worktrees that are clean and already merged.
- The main checkout is never touched, except for one line in `.git/info/exclude` (`/.worktree.env`).

### Configuration

| Variable          | Default        |
|-------------------|----------------|
| `RAMIFY_ROOT`     | `~/.worktrees` |
| `RAMIFY_PORT_MIN` | `4100`         |
| `RAMIFY_PORT_MAX` | `4990`         |
| `NO_COLOR`        | unset          |

### Tests

```bash
bash tests/run.sh             # CLI, against throwaway repositories with stub agents (macOS and Linux)
npm run test:core             # engine, session detection, GitHub sign-in, IPC checks, timeline (also on Windows)
npm run test:e2e -w packages/core   # the real UI in Chromium: browser host, editor host, no clipping 390–1920px
```

All of them run in CI; the core suite and the Windows installer build also run on Windows.

### Contributing

Issues and pull requests are welcome. Run the three test suites above before opening a PR; if you change
`ui/web`, rebuild it with `npm run build:web` and sync the plugin with `scripts/sync-plugin.sh`, which CI checks.


## License

[MIT](LICENSE). Brand marks of the tools Ramify works with are trademarks of their owners, shown only to identify them.
Icons come from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT), [Simple Icons](https://simpleicons.org) (CC0)
and [Devicon](https://devicon.dev) (MIT); `node scripts/brand-icons.mjs` regenerates them.
