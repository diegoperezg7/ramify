#!/bin/bash
# .worktree/teardown.sh: delete the worktree's simulator.
set -euo pipefail
[ -n "${SIM_UDID:-}" ] && xcrun simctl delete "$SIM_UDID" || true
