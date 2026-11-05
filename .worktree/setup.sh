#!/bin/bash
# ramify runs this when it creates a worktree, in place of its own `npm ci`.
# electron 45 has no install script: it fetches its binary the first time something requires it, but
# electron-builder reads node_modules/electron/dist directly, so `npm run dist` failed in a new worktree.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci >&2
node node_modules/electron/install.js >&2
