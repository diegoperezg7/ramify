<h1 align="center">agent-wt</h1>

<p align="center">
  <b>One git worktree per task. Any coding agent. Any IDE.</b><br>
  Run Claude Code, Codex, Gemini, Copilot, Cursor, OpenCode or Aider side by side on the same repository,<br>
  each on its own branch, with its own ports, dependencies and simulator.
</p>

<p align="center">
  <a href="https://github.com/diegoperezg7/agent-wt/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/diegoperezg7/agent-wt/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="bash" src="https://img.shields.io/badge/bash-3.2%2B-4e4e4e">
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%7C%20Linux-4e4e4e">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-7c3aed"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/lang-español-4e4e4e"></a>
</p>

<p align="center"><img src="docs/ls.svg" alt="agent-wt ls: five agents working on five branches of the same repository"></p>

## Why

Two agents in one checkout overwrite each other's files. `git worktree` fixes that, but a bare
worktree is not ready to work in: no `.env`, no `node_modules`, no generated Xcode project, the same
dev-server port as every other copy, and one shared simulator. agent-wt does that setup in one
command, the same way for every agent, so you can open five terminals and let five agents work.

## How it works

<p align="center"><img src="docs/architecture.svg" alt="agent-wt creates a worktree, copies ignored files, reserves ports, runs setup and launches the agent"></p>

1. **Worktree**: `~/.worktrees/<repo>/<name>`, outside the repo, so IDEs, test runners and file
   watchers in the main checkout never index it. It branches from your current `HEAD` by default.
2. **Ignored files**: files listed in `.worktreeinclude` (gitignore syntax, the same file Claude
   Code reads) are copied over, such as `.env` or `Local.xcconfig`.
3. **Ports**: each worktree gets its own block of 10 ports (`PORT` to `PORT+9`) starting at 4100.
4. **Setup**: `.worktree/setup.sh` if the project has one, otherwise auto-detected:
   `xcodegen generate`, `pnpm`/`yarn`/`bun`/`npm ci`, `uv sync`.
5. **Launch**: the agent in the worktree with `.worktree.env` exported, and/or your IDE.

## Install

```bash
git clone https://github.com/diegoperezg7/agent-wt.git
cd agent-wt && ./install.sh          # symlinks agent-wt into ~/.local/bin
```

Requires `git` 2.31+ and `bash` 3.2+ (macOS default works). `jq` for the Claude Code hooks, `tmux` for `--tmux`.

## Usage

```bash
agent-wt new feat/login -a claude -p "add login with magic links"
agent-wt new fix/cart -a codex -i cursor          # agent in the terminal, worktree open in Cursor
agent-wt new ios/widget -i xcode                  # opens the generated .xcodeproj
agent-wt new docs/api -a opencode --tmux          # detached tmux session
agent-wt open fix/cart -a gemini                  # reopen an existing worktree with another agent

agent-wt ls                                       # every worktree at a glance
agent-wt graph                                    # branch graph with the agent on each branch
agent-wt rm fix/cart                              # refuses if anything would be lost
agent-wt prune                                    # remove clean worktrees that are already merged
```

`-f <ref>` picks the base, `--no-setup` skips setup, and anything after `--` is passed to the agent.

### Agents

| `-a`       | Runs           | `-p` prompt is passed as |
|------------|----------------|--------------------------|
| `claude`   | `claude`       | first argument           |
| `codex`    | `codex`        | first argument           |
| `gemini`   | `gemini`       | `-i <prompt>`            |
| `copilot`  | `copilot`      | `-i <prompt>`            |
| `cursor`   | `cursor-agent` | first argument           |
| `opencode` | `opencode`     | clipboard (no flag)      |
| `aider`    | `aider`        | clipboard (no flag)      |
| `amp`      | `amp`          | clipboard (no flag)      |
| anything else | that command | clipboard             |

`ls` also shows which agent process is **running** inside each worktree right now.

### IDEs

`-i xcode` opens the project's `.xcworkspace` or `.xcodeproj`. `cursor`, `code`, `zed` and `idea`
are mapped to their apps, and any other value is opened as a macOS app name (`-i "Android Studio"`)
or as a command on Linux.

## See every branch

<p align="center"><img src="docs/graph.svg" alt="agent-wt graph: commit graph of every worktree branch, labelled with its agent"></p>

`agent-wt graph` lists which agent works on which branch and draws the commit graph of all of them,
so you can see what each agent did, what is pushed and what is ready to merge.

## Inside a worktree

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
agent-wt install instructions
```

It adds [`snippets/agent-instructions.md`](snippets/agent-instructions.md) once to every agent
that is installed: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`,
`~/.config/opencode/AGENTS.md`, `~/.copilot/copilot-instructions.md` and `~/.config/amp/AGENTS.md`.
Nothing is written into your repositories.

## Project setup

```
your-repo/
├── .worktreeinclude          # ignored files to copy: .env, Local.xcconfig ...
└── .worktree/
    ├── setup.sh              # runs in each new worktree, with .worktree.env exported
    └── teardown.sh           # runs before the worktree is removed
```

Both scripts are optional and can stay untracked: agent-wt also looks for them in the main checkout.
See [`examples/`](examples):

- [`ios-xcodegen`](examples/ios-xcodegen): `xcodegen generate` plus a dedicated simulator per
  worktree (`SIM_UDID`), deleted on removal.
- [`web`](examples/web): `npm ci` and a `.env.local` that pins Vite and the API to the worktree's ports.

## Claude Code integration

```bash
agent-wt install claude-hooks
```

This registers agent-wt as Claude Code's `WorktreeCreate` and `WorktreeRemove` hooks (with a backup
of `~/.claude/settings.json`). From then on `claude --worktree`, background sessions, `/batch`,
workflows and subagents with `isolation: worktree` all create their worktrees through agent-wt,
with the same layout, ports and setup as every other agent. Claude Code keeps subagent worktrees
after they finish, so run `agent-wt prune` now and then.

## Safety

- `rm` refuses when there are uncommitted changes, or commits that are neither merged nor pushed.
- `rm --force` discards uncommitted changes but **never deletes a branch with unmerged commits**:
  the worktree goes, the branch stays.
- `prune` only removes worktrees that are clean and already merged.
- The main checkout is never touched, except for one line in `.git/info/exclude` (`/.worktree.env`).

## Configuration

| Variable            | Default        |
|---------------------|----------------|
| `AGENT_WT_ROOT`     | `~/.worktrees` |
| `AGENT_WT_PORT_MIN` | `4100`         |
| `AGENT_WT_PORT_MAX` | `4990`         |
| `NO_COLOR`          | unset          |

## Tests

```bash
bash tests/run.sh
```

End-to-end tests against throwaway repositories with stub agents, run on macOS and Linux in CI.

## License

[MIT](LICENSE)
