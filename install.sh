#!/bin/bash
# Symlink ramify into ~/.local/bin (or $PREFIX).
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
bin="${PREFIX:-$HOME/.local/bin}"
mkdir -p "$bin"
ln -sf "$dir/ramify" "$bin/ramify"
echo "ramify -> $bin/ramify"
case ":$PATH:" in *":$bin:"*) ;; *) echo "add $bin to your PATH" ;; esac
echo "next: ramify install all     # Claude Code plugin + the worktree rules for every installed agent"
echo "      ramify install shell   # optional: agents typed in a main checkout get their own branch"
