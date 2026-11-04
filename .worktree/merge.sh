#!/bin/bash
# ramify runs this when a merge's only conflicts are generated files (see .gitattributes):
# rebuild the dashboard and its copy in the Claude Code plugin from the merged sources.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:web >&2
./scripts/sync-plugin.sh >&2
