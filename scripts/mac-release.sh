#!/bin/bash
# Release only, on the macOS runner after `npm run dist`: check what is about to be published. The app must be
# signed, notarized with its ticket stapled (electron-builder does both) and arm64; the .dmg must be signed.
# The .dmg itself carries no stapled ticket: electron-builder notarizes the app, and the updater uses the zip.
# Any failure stops the release.
set -euo pipefail
cd "$(dirname "$0")/../apps/desktop/release"
app=mac-arm64/Ramify.app
[ -d "$app" ] || { echo "mac-release: missing $app" >&2; exit 1; }
shopt -s nullglob
dmgs=(*.dmg)
[ "${#dmgs[@]}" -eq 1 ] || { echo "mac-release: expected one .dmg, found ${#dmgs[@]}" >&2; exit 1; }
dmg=${dmgs[0]}

codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -t exec -vv "$app"
xcrun stapler validate "$app"
codesign --verify --strict --verbose=2 "$dmg"
archs=$(lipo -archs "$app/Contents/MacOS/Ramify")
[ "$archs" = arm64 ] || { echo "mac-release: expected an arm64 binary, got: $archs" >&2; exit 1; }
echo "mac-release: Ramify.app signed, notarized and stapled ($archs); $dmg signed"
