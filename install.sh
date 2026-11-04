#!/bin/bash
# Symlink agent-wt into ~/.local/bin (or $PREFIX).
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
bin="${PREFIX:-$HOME/.local/bin}"
mkdir -p "$bin"
ln -sf "$dir/agent-wt" "$bin/agent-wt"
echo "agent-wt -> $bin/agent-wt"
case ":$PATH:" in *":$bin:"*) ;; *) echo "add $bin to your PATH" ;; esac
echo "optional: agent-wt install claude-hooks   # Claude Code uses agent-wt for its worktrees"
echo "optional: agent-wt install instructions   # teach every installed agent the worktree rules"
