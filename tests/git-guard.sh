#!/bin/bash
# The shared branch guarded by git itself (`ramify install guard`): the pre-commit and pre-push hooks with
# ramify.guardMain, for agents without Claude Code hooks. It needs only bash and git (no jq, lsof, tmux or gitleaks),
# so it also runs on Windows under Git Bash. tests/run.sh sources it; run on its own, it sets up the same sandbox.
# shellcheck disable=SC2034  # variables are used inside check() via eval

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  AW="$(cd "$(dirname "$0")/.." && pwd)/ramify"
  T=$(cd "$(mktemp -d)" && pwd -P)
  trap 'rm -rf "$T"' EXIT
  export RAMIFY_ROOT="$T/wts" NO_COLOR=1 HOME="$T/home"
  export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
  export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
  mkdir -p "$HOME"
  pass=0; fail=0
  ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
  bad()  { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
  check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
  alone=1
fi

echo "the shared branch guarded by git itself (agents without Claude Code hooks)"
git init -q --bare "$T/gm-origin.git"
git clone -q "$T/gm-origin.git" "$T/gm" 2>/dev/null
cd "$T/gm" || exit 1
git checkout -q -b main
echo hi > a.txt; git add a.txt; git commit -qm init; git push -q origin main 2>/dev/null
"$AW" install guard 2>/dev/null
check "install guard turns on ramify.guardMain and adds both hooks" '[ "$(git config --bool ramify.guardMain)" = true ] && grep -q "ramify: secret scan" .git/hooks/pre-commit && grep -q "ramify: secret scan" .git/hooks/pre-push'
echo more >> a.txt; git add a.txt
git commit -qm direct 2>"$T/gm-commit.err"; c=$?
check "pre-commit refuses a commit on main with guardMain (exit $c)" '[ "$c" != 0 ] && [ "$(git rev-list --count HEAD)" = 1 ] && grep -q "shared branch" "$T/gm-commit.err"'
RAMIFY_ALLOW_MAIN=1 git commit -qm allowed 2>/dev/null; c=$?
check "pre-commit allows it with RAMIFY_ALLOW_MAIN=1 (exit $c)" '[ "$c" = 0 ] && [ "$(git rev-list --count HEAD)" = 2 ]'
git push -q origin main 2>"$T/gm-push.err"; c=$?
check "pre-push refuses a push to main (exit $c) and origin keeps its main" '[ "$c" != 0 ] && [ "$(git --git-dir="$T/gm-origin.git" rev-list --count main)" = 1 ] && grep -q "shared branch" "$T/gm-push.err"'
gw=$("$AW" new feat/gm --no-launch --no-setup 2>/dev/null)
echo wt > "$gw/b.txt"; git -C "$gw" add b.txt
git -C "$gw" commit -qm "in a worktree" 2>/dev/null; c=$?
check "pre-commit allows commits in a worktree (exit $c)" '[ "$c" = 0 ] && [ "$(git -C "$gw" log -1 --format=%s)" = "in a worktree" ]'
git -C "$gw" push -q origin feat/gm 2>/dev/null; c=$?
check "pre-push allows a branch of its own (exit $c)" '[ "$c" = 0 ] && git --git-dir="$T/gm-origin.git" show-ref -q refs/heads/feat/gm'
git -C "$gw" push -q origin HEAD:main 2>/dev/null; c=$?
check "pre-push refuses a push to main from a worktree too (exit $c)" '[ "$c" != 0 ] && [ "$(git --git-dir="$T/gm-origin.git" rev-list --count main)" = 1 ]'
git config ramify.allowMain true
git push -q origin main 2>/dev/null; c=$?
check "git config ramify.allowMain lets the push through (exit $c)" '[ "$c" = 0 ] && [ "$(git --git-dir="$T/gm-origin.git" rev-list --count main)" = 2 ]'
git config --unset ramify.allowMain
# The app runs git with core.hooksPath=/dev/null (hardenedGitEnv): its merges and pushes are not the agents'.
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git merge -q --no-ff --no-edit feat/gm \
  && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push -q origin main 2>/dev/null; c=$?
check "a merge into main and its push, run as the app runs git, go through (exit $c)" '[ "$c" = 0 ] && [ "$(git --git-dir="$T/gm-origin.git" rev-parse main)" = "$(git rev-parse main)" ]'
printf '#!/bin/sh\nexit 0\n' > .git/hooks/pre-commit
"$AW" install guard 2>"$T/gm-install.err"
check "install guard leaves a pre-commit that is not ramify's and says so" '! grep -q "ramify: secret scan" .git/hooks/pre-commit && grep -q "not ramify" "$T/gm-install.err"'

if [ -n "${alone:-}" ]; then
  echo
  echo "$pass passed, $fail failed"
  [ "$fail" = 0 ]
fi
