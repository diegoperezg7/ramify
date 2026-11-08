#!/bin/bash
# Fails unless every file that carries the version says the same one. With an argument (a release tag, with or
# without its v), that one too. Run by CI on every push and by the release before it builds anything.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/version-files.sh
. scripts/version-files.sh
expected=${1:-}
expected=${expected#v}

found=$(
  for f in $VERSION_SCRIPTS; do printf '%s\t%s\n' "$f" "$(sed -n 's/^VERSION=//p' "$f" | head -n 1)"; done
  node -e '
    const fs = require("fs")
    const [jsonList, lockList] = process.argv.slice(1).map((s) => s.split(" ").filter(Boolean))
    for (const f of jsonList) console.log(`${f}\t${JSON.parse(fs.readFileSync(f, "utf8")).version ?? ""}`)
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"))
    for (const w of lockList) console.log(`package-lock.json (${w})\t${lock.packages?.[w]?.version ?? ""}`)
  ' "$VERSION_JSON" "$VERSION_LOCK_WORKSPACES"
  for f in $VERSION_READMES; do printf '%s\t%s\n' "$f" "$(sed -n 's/^\*\*Versi[oó]n \([0-9][0-9.]*[0-9]\)\.\*\*.*/\1/p' "$f" | head -n 1)"; done
)

reference=${expected:-$(printf '%s\n' "$found" | head -n 1 | cut -f 2)}
bad=$(printf '%s\n' "$found" | awk -F '\t' -v want="$reference" '$2 != want')
if [ -n "$bad" ]; then
  echo "check-version: expected $reference${expected:+ (from the tag)} everywhere; these differ:" >&2
  printf '%s\n' "$bad" | awk -F '\t' '{ printf "  %s: %s\n", $1, ($2 == "" ? "(none)" : $2) }' >&2
  exit 1
fi
echo "check-version: $reference in $(printf '%s\n' "$found" | wc -l | tr -d ' ') places"
