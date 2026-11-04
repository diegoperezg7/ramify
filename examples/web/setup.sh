#!/bin/bash
# .worktree/setup.sh for a Vite + API project.
# Runs inside the new worktree with .worktree.env exported.
set -euo pipefail

npm ci
# Vite ignores $PORT, so pin the dev servers to this worktree's port block.
cat > .env.local <<ENV
VITE_PORT=$PORT
API_PORT=$((PORT + 1))
VITE_API_URL=http://localhost:$((PORT + 1))
ENV
