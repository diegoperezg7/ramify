## Worktrees (ramify)
Every change happens on a branch and folder of its own, never on a repository's shared branch:
- Before you change files in a repository's main checkout on its default branch (`main`, `master`...), take a worktree first. In Claude Code call the EnterWorktree tool with a short conventional name (`feat-login`, `fix-cart-total`); in any other agent, or when the session did not start inside that repository, run `ramify new <feat/...|fix/...> --no-launch` there and continue in the folder it prints (in Claude Code: EnterWorktree with that `path`). Reading code and answering questions do not need one.
- Before you edit files other agents may be changing, run `ramify who <files or folders>`: it lists other worktrees that change them (branch, agent, working or idle) and exits 1 when there are any. On an overlap, ask the user, or that agent if you can message it, before editing those files.
If `.worktree.env` exists at the project root, you are in an isolated git worktree, one per task:
- Work only on branch `WT_BRANCH`. Never check out another branch or main: it is in use in another worktree.
- Read `.worktree.env`. Dev servers must use ports `PORT` to `PORT+9`, never the main project's ports.
- For xcodebuild always pass `-derivedDataPath "$DERIVED_DATA"`.
- Never commit `.worktree.env`. Do not merge or push to main: the user decides that.
- If `SIM_UDID` is set, run iOS builds and tests on that simulator: `-destination "id=$SIM_UDID"`.
