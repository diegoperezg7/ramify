#!/bin/bash
# Symlink ramify into ~/.local/bin (or $PREFIX).
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
bin="${PREFIX:-$HOME/.local/bin}"
mkdir -p "$bin"
ln -sf "$dir/ramify" "$bin/ramify"
echo "ramify -> $bin/ramify"
case ":$PATH:" in *":$bin:"*) ;; *) echo "add $bin to your PATH" ;; esac
echo "optional: ramify install claude-hooks   # Claude Code uses ramify for its worktrees"
echo "optional: ramify install instructions   # teach every installed agent the worktree rules"
