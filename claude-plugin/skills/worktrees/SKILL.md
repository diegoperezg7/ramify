---
name: worktrees
description: Rules for working inside an ramify git worktree. Use whenever the project root has a .worktree.env file, or before starting a dev server, running xcodebuild, switching branches, merging or pushing.
---

# Working in an ramify worktree

If `.worktree.env` exists at the project root, this is an isolated git worktree, one per task, and other agents are working on other branches of the same repository at the same time.

- Work only on the branch in `WT_BRANCH`. Never check out another branch or main: it is checked out in another worktree and git will refuse.
- Read `.worktree.env` first. Dev servers must use ports `PORT` to `PORT+9`, never the main project's ports.
- For xcodebuild always pass `-derivedDataPath "$DERIVED_DATA"`. If `SIM_UDID` is set, use `-destination "id=$SIM_UDID"`.
- Never commit `.worktree.env`. Do not merge into main or push to main: the user decides that from `ramify ui` or the terminal.
- `"${CLAUDE_PLUGIN_ROOT}"/bin/ramify ls` shows every worktree of the repository, its agent and whether it is running.
