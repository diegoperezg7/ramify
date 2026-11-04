## Worktrees (agent-wt)
If `.worktree.env` exists at the project root, you are in an isolated git worktree, one per task:
- Work only on branch `WT_BRANCH`. Never check out another branch or main: it is in use in another worktree.
- Read `.worktree.env`. Dev servers must use ports `PORT` to `PORT+9`, never the main project's ports.
- For xcodebuild always pass `-derivedDataPath "$DERIVED_DATA"`.
- Never commit `.worktree.env`. Do not merge or push to main: the user decides that.
- If `SIM_UDID` is set, run iOS builds and tests on that simulator: `-destination "id=$SIM_UDID"`.
