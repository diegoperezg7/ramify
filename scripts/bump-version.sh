#!/bin/bash
# Set Ramify's version everywhere it appears: scripts/bump-version.sh 1.2.3
# The ramify script, the workspaces' package.json, the Claude Code plugin manifest, package-lock.json, the
# README lines that name it, then the plugin's copy of the script (sync-plugin.sh). Ends with check-version.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/version-files.sh
. scripts/version-files.sh
v=${1:-}
v=${v#v}
printf '%s' "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "usage: scripts/bump-version.sh X.Y.Z" >&2; exit 1; }

# sed -i differs between macOS and GNU: write to a temporary file and move it over.
edit() { local f=$1 expr=$2; sed "$expr" "$f" > "$f.tmp" && cat "$f.tmp" > "$f" && rm -f "$f.tmp"; }
edit ramify "s/^VERSION=.*/VERSION=$v/"
for f in $VERSION_READMES; do edit "$f" "s/^\*\*Version [0-9][0-9.]*[0-9]\.\*\*/**Version $v.**/; s/^\*\*Versión [0-9][0-9.]*[0-9]\.\*\*/**Versión $v.**/"; done
node -e '
  const fs = require("fs")
  const [v, ...files] = process.argv.slice(1)
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    // Only the top-level "version": the rest of the file keeps its formatting.
    const out = text.replace(/^(  "version": )"[^"]*"/m, `$1"${v}"`)
    if (out === text && !text.includes(`"version": "${v}"`)) { console.error(`bump-version: no version in ${f}`); process.exit(1) }
    fs.writeFileSync(f, out)
  }
' "$v" $VERSION_JSON
npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
./scripts/sync-plugin.sh >/dev/null
./scripts/check-version.sh "$v"
