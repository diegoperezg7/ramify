#!/bin/bash
# Copy the CLI and the prebuilt dashboard into the Claude Code plugin (installed plugins can't see the rest of the repo).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf claude-plugin/bin claude-plugin/ui
mkdir -p claude-plugin/bin claude-plugin/ui
cp agent-wt claude-plugin/bin/agent-wt
cp ui/server.py claude-plugin/ui/server.py
cp -R ui/dist claude-plugin/ui/dist
echo "claude-plugin synced"
