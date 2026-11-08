#!/bin/bash
# Release only, on the macOS runner after `npm run dist`: notarize and staple the .dmg (electron-builder notarizes
# the app inside it, not the disk image), then check what is about to be published: signatures, Gatekeeper, the
# stapled tickets and the architecture. Any failure stops the release.
set -euo pipefail
cd "$(dirname "$0")/../apps/desktop/release"
for k in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [ -n "${!k:-}" ] || { echo "mac-release: missing $k" >&2; exit 1; }
done
app=mac-arm64/Ramify.app
[ -d "$app" ] || { echo "mac-release: missing $app" >&2; exit 1; }
shopt -s nullglob
dmgs=(*.dmg)
[ "${#dmgs[@]}" -eq 1 ] || { echo "mac-release: expected one .dmg, found ${#dmgs[@]}" >&2; exit 1; }
dmg=${dmgs[0]}

if ! xcrun stapler validate -q "$dmg" 2>/dev/null; then
  xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$dmg"
  # Stapling rewrote the .dmg: its checksum and size in latest-mac.yml are brought up to date, and its blockmap
  # (made from the old bytes, unused by the macOS updater, which downloads the zip) is dropped.
  node -e '
    const fs = require("fs"), crypto = require("crypto")
    const [yml, dmg] = process.argv.slice(1)
    const buf = fs.readFileSync(dmg)
    const sha = crypto.createHash("sha512").update(buf).digest("base64")
    const lines = fs.readFileSync(yml, "utf8").split("\n")
    let found = false
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== `- url: ${dmg}`) continue
      found = true
      for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]) && !lines[j].trim().startsWith("- "); j++) {
        lines[j] = lines[j].replace(/(sha512: ).*/, `$1${sha}`).replace(/(size: ).*/, `$1${buf.length}`)
      }
    }
    if (!found) { console.error(`mac-release: ${dmg} is not in ${yml}`); process.exit(1) }
    fs.writeFileSync(yml, lines.join("\n"))
  ' latest-mac.yml "$dmg"
  rm -f "$dmg.blockmap"
fi

codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -t exec -vv "$app"
xcrun stapler validate "$app"
codesign --verify --strict --verbose=2 "$dmg"
xcrun stapler validate "$dmg"
archs=$(lipo -archs "$app/Contents/MacOS/Ramify")
[ "$archs" = arm64 ] || { echo "mac-release: expected an arm64 binary, got: $archs" >&2; exit 1; }
echo "mac-release: $dmg signed, notarized and stapled; Ramify.app is $archs"
