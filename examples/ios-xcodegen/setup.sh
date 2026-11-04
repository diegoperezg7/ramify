#!/bin/bash
# .worktree/setup.sh for an XcodeGen iOS project.
# Runs inside the new worktree with .worktree.env exported.
set -euo pipefail

xcodegen generate --quiet

# A simulator per worktree, so parallel agents never fight over one.
udid=$(xcrun simctl create "wt-$WT_NAME" "${SIM_DEVICE:-iPhone 17 Pro}" 2>/dev/null)
echo "SIM_UDID=$udid" >> .worktree.env
echo "simulator wt-$WT_NAME ($udid)" >&2
