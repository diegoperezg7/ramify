#!/bin/bash
# End-to-end tests for ramify. No dependencies beyond git, tar and jq.
# shellcheck disable=SC2034  # variables are used inside check() via eval
set -uo pipefail

AW="$(cd "$(dirname "$0")/.." && pwd)/ramify"
T=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export RAMIFY_ROOT="$T/wts" NO_COLOR=1 HOME="$T/home"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
mkdir -p "$HOME" "$T/bin"

pass=0; fail=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Fake agents: record argv, cwd and PORT.
for a in claude codex gemini copilot cursor-agent opencode aider amp; do
  printf '#!/bin/bash\necho "%s|$PWD|$PORT|$*" > "%s/last-agent"\n' "$a" "$T" > "$T/bin/$a"
  chmod +x "$T/bin/$a"
done
printf '#!/bin/bash\ncat > "%s/clipboard"\n' "$T" > "$T/bin/pbcopy"; chmod +x "$T/bin/pbcopy"
export PATH="$T/bin:$PATH"

git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/demo" 2>/dev/null
cd "$T/demo" || exit 1
git checkout -q -b main
printf '.env\nnode_modules/\n' > .gitignore
echo 'SECRET=1' > .env
echo '.env' > .worktreeinclude
echo hi > a.txt
git add .gitignore a.txt && git commit -qm init && git push -q origin main 2>/dev/null
W="$RAMIFY_ROOT/demo"

echo "create"
"$AW" new feat/login 2>/dev/null >/dev/null
check "worktree created under the root" '[ -d "$W/feat-login" ]'
check "branch created" 'git show-ref --quiet refs/heads/feat/login'
check ".worktreeinclude files copied" 'grep -q SECRET=1 "$W/feat-login/.env"'
check ".worktree.env not visible to git" '[ -z "$(git -C "$W/feat-login" status --porcelain)" ]'
"$AW" new pagos 2>/dev/null >/dev/null
p1=$(sed -n 's/^PORT=//p' "$W/feat-login/.worktree.env"); p2=$(sed -n 's/^PORT=//p' "$W/pagos/.worktree.env")
check "each worktree gets its own port block" '[ "$p1" != "$p2" ] && [ $((p2 - p1)) -ge 10 ]'

git init -q "$T/empty"
check "new fails cleanly in a repo without commits" '! (cd "$T/empty" && "$AW" new x 2>/dev/null) && [ ! -e "$RAMIFY_ROOT/empty/x" ]'
check "new refuses an existing worktree" '! "$AW" new pagos 2>/dev/null'

p=$("$AW" new nolaunch -a codex --no-launch 2>/dev/null)
check "--no-launch prints the path and records the agent" '[ "$p" = "$W/nolaunch" ] && grep -qx "WT_AGENT=codex" "$W/nolaunch/.worktree.env" && [ ! -f "$T/last-agent" ]'
"$AW" rm nolaunch 2>/dev/null

echo "agents"
"$AW" open pagos -a claude -p "fix the bug" 2>/dev/null
check "claude: prompt as argument, cwd and PORT set" 'grep -qx "claude|$W/pagos|$p2|fix the bug" "$T/last-agent"'
"$AW" open pagos -a codex -p "task" 2>/dev/null
check "codex: prompt as argument" 'grep -q "^codex|.*|task$" "$T/last-agent"'
"$AW" open pagos -a gemini -p "task" 2>/dev/null
check "gemini: prompt with -i" 'grep -q "^gemini|.*|-i task$" "$T/last-agent"'
"$AW" open pagos -a copilot -p "task" 2>/dev/null
check "copilot: prompt with -i" 'grep -q "^copilot|.*|-i task$" "$T/last-agent"'
"$AW" open pagos -a cursor -p "task" 2>/dev/null
check "cursor: runs cursor-agent" 'grep -q "^cursor-agent|.*|task$" "$T/last-agent"'
"$AW" open pagos -a opencode -p "clip me" 2>/dev/null
check "opencode: no prompt flag, prompt goes to clipboard" 'grep -q "^opencode|.*|$" "$T/last-agent" && grep -qx "clip me" "$T/clipboard"'
"$AW" open pagos -a aider -- --model x 2>/dev/null
check "args after -- are passed through" 'grep -q "^aider|.*|--model x$" "$T/last-agent"'
check "last agent recorded in .worktree.env" 'grep -qx "WT_AGENT=aider" "$W/pagos/.worktree.env"'
# An agent process is recognised by its executable name: a tiny binary named "codex".
mkdir -p "$T/real"
if printf '#include <unistd.h>\nint main(void){sleep(5);return 0;}\n' | cc -x c -o "$T/real/codex" - 2>/dev/null; then
  (cd "$W/pagos" && exec "$T/real/codex") & sleep 1
  check "ls shows agents running inside a worktree" '"$AW" ls 2>/dev/null | grep -q "^pagos .*codex"'
fi
(cd "$W/pagos" && exec perl -e 'sleep 5') & sleep 1
check "ls ignores processes that are not agents" '! "$AW" ls 2>/dev/null | grep -q "^pagos .*perl"'
{ kill %2 && wait %2; } 2>/dev/null
kill %1 2>/dev/null; wait 2>/dev/null
# Claude Code's installer runs ~/.local/share/claude/versions/<version> through a claude symlink: the process is named
# after the version. exec -a starts it as "claude" the way macOS shows that symlink (Linux would name it claude).
running_in() { "$AW" ls 2>/dev/null | awk -v w="$1" '$1 == w { print $4 }'; }
mkdir -p "$T/real/claude/versions"
if printf '#include <unistd.h>\nint main(void){sleep(10);return 0;}\n' | cc -x c -o "$T/real/claude/versions/2.1.319" - 2>/dev/null; then
  echo x > "$W/pagos/cc.txt"
  (cd "$W/pagos" && exec -a claude "$T/real/claude/versions/2.1.319") & c1=$!
  (cd "$T/demo" && exec "$T/real/claude/versions/2.1.319" --agent-name x) & c2=$!
  (cd "$W/feat-login" && exec perl -e 'sleep 10' "$T/real/claude/versions/2.1.319") & c3=$!
  sleep 1
  check "ls shows Claude Code started as claude, its process named after the version" '[ "$(running_in pagos)" = claude ]'
  check "ls shows Claude Code started by its versioned path (teammates)" '[ "$(running_in "(main)")" = claude ]'
  check "ls does not take a path to that version given as an argument for Claude Code" '[ "$(running_in feat-login)" = - ]'
  check "who says working for that Claude Code" '[ "$(cd "$W/feat-login" && "$AW" who cc.txt | cut -f1,3)" = "$(printf "pagos\tworking")" ]'
  { kill "$c1" "$c2" "$c3" && wait "$c1" "$c2" "$c3"; } 2>/dev/null
  rm -f "$W/pagos/cc.txt"
fi
check "ls --json is valid and has the worktree" '"$AW" ls --json | jq -e ".[] | select(.branch == \"pagos\") | .agent == \"aider\" and .main == false" >/dev/null'
check "ls shows the agent" '"$AW" ls 2>/dev/null | grep -q "^pagos .*aider"'
check "graph lists the branches" 'g=$("$AW" graph 2>&1); printf "%s" "$g" | grep -q "pagos"'
check "path resolves by branch name" '[ "$("$AW" path feat/login)" = "$W/feat-login" ]'

echo "dashboard api"
if command -v python3 >/dev/null && command -v curl >/dev/null && [ -f "$(dirname "$AW")/ui/dist/index.html" ]; then
  (cd "$(dirname "$AW")/ui" && exec python3 -I server.py --main "$T/demo" --bin "$AW" --port 4977 --token tok) >/dev/null 2>&1 &
  srv=$!
  for _ in $(seq 50); do curl -s -o /dev/null http://127.0.0.1:4977/ && break; sleep 0.2; done
  api() { curl -s -H "X-Token: tok" "$@"; }
  check "state lists worktrees and commits" 'api http://127.0.0.1:4977/api/state | jq -e "(.worktrees | length) >= 2 and (.commits | length) >= 1" >/dev/null'
  check "api rejects a missing token" '[ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:4977/api/state)" = 401 ]'
  check "api rejects a foreign Host header" '[ "$(curl -s -o /dev/null -w %{http_code} -H "Host: evil.test" -H "X-Token: tok" http://127.0.0.1:4977/api/state)" = 403 ]'
  check "api refuses paths that are not worktrees" 'api -X POST -d "{\"path\":\"/etc\"}" http://127.0.0.1:4977/api/remove | jq -e ".error" >/dev/null'
  echo dirty >> "$W/pagos/a.txt"
  api -X POST -d "{\"path\":\"$(cd "$W/pagos" && pwd -P)\"}" http://127.0.0.1:4977/api/merge > "$T/merge.json"
  check "merge refuses a worktree with uncommitted changes" 'jq -e ".error | test(\"uncommitted\")" "$T/merge.json" >/dev/null || { cat "$T/merge.json"; false; }'
  check "the web app is served" 'curl -s http://127.0.0.1:4977/ | grep -q "<div id=\"root\">"'
  git -C "$W/pagos" checkout -q -- a.txt
  kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null
else
  echo "  skip (python3, curl or ui/dist missing)"
fi

echo "remove"
mkdir -p "$W/.derived-data/keep"
check "rm of an unknown name fails and touches nothing" '! "$AW" rm nope 2>/dev/null && [ -d "$W/.derived-data/keep" ]'
echo change >> "$W/pagos/a.txt"
check "rm refuses uncommitted changes" '! "$AW" rm pagos 2>/dev/null'
git -C "$W/pagos" commit -qam work
check "rm refuses unmerged, unpushed commits" '! "$AW" rm pagos 2>/dev/null'
"$AW" rm pagos --force 2>/dev/null
check "rm --force removes the worktree" '[ ! -d "$W/pagos" ]'
check "rm --force keeps the branch and its commits" 'git log -1 --format=%s pagos | grep -qx work'
# A squash merge on GitHub: the branch is in no history of main and its remote branch is gone.
"$AW" new feat/squash --no-launch >/dev/null 2>&1
git -C "$W/feat-squash" commit -q --allow-empty -m squash-work
sq=$(git rev-parse feat/squash)
check "rm still refuses a squash-merged branch it was not told about" '! "$AW" rm feat-squash 2>/dev/null && [ -d "$W/feat-squash" ]'
check "rm --squashed refuses a short or invented commit" '! "$AW" rm feat-squash --squashed abc 2>/dev/null && [ -d "$W/feat-squash" ]'
git -C "$W/feat-squash" commit -q --allow-empty -m after-merge
check "rm --squashed refuses a branch that moved after its pull request" '! "$AW" rm feat-squash --squashed "$sq" 2>/dev/null && [ -d "$W/feat-squash" ]'
git -C "$W/feat-squash" reset -q --hard "$sq"
"$AW" rm feat-squash --squashed "$sq" 2>/dev/null
check "rm --squashed removes the worktree, then deletes the branch (no 'used by worktree')" '[ ! -d "$W/feat-squash" ] && ! git show-ref --quiet refs/heads/feat/squash'
"$AW" prune 2>/dev/null
check "prune keeps a fresh worktree that has no work yet" '[ -d "$W/feat-login" ]'
git -C "$W/feat-login" commit -q --allow-empty -m login && git merge -q --no-edit feat/login
"$AW" prune 2>/dev/null
check "prune removes clean, merged worktrees" '[ ! -d "$W/feat-login" ] && ! git show-ref --quiet refs/heads/feat/login'

echo "safety"
"$AW" new detached 2>/dev/null >/dev/null
git -C "$W/detached" checkout -q --detach && git -C "$W/detached" commit -q --allow-empty -m orphan
check "rm refuses a detached HEAD with commits on no branch" '! "$AW" rm detached 2>/dev/null && [ -d "$W/detached" ]'
"$AW" rm detached --force 2>/dev/null
check "branch names cannot inject commands through .worktree.env" '"$AW" new "x\$(touch\${IFS}$T/PWNED)" --no-launch >/dev/null 2>&1; [ ! -e "$T/PWNED" ]'
check "invalid agent names are rejected" '! "$AW" new evil -a "x;touch $T/PWNED2" --no-launch 2>/dev/null && [ ! -e "$T/PWNED2" ]'
mkdir -p "$T/my repo" && git -C "$T/my repo" init -q -b main && git -C "$T/my repo" commit -q --allow-empty -m i
mkdir -p "$T/my repo/.worktree" && printf '#!/bin/bash\ntouch "$WT_PATH/setup-ran"\n' > "$T/my repo/.worktree/setup.sh" && chmod +x "$T/my repo/.worktree/setup.sh"
(cd "$T/my repo" && "$AW" new spaced >/dev/null 2>&1)
check "paths with spaces: setup scripts still run" '[ -f "$RAMIFY_ROOT/my repo/spaced/setup-ran" ]'

echo "claude code hook"
path=$(printf '{"name":"bold-oak","cwd":"%s"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
check "hook create prints the worktree path" '[ "$path" = "$W/worktree-bold-oak" ] && [ -f "$path/.env" ]'
check "hook create records claude as agent" 'grep -qx "WT_AGENT=claude" "$path/.worktree.env"'
printf '{"worktree_path":"%s"}' "$path" | "$AW" hook remove 2>/dev/null
check "hook remove deletes it" '[ ! -d "$path" ]'

echo "install"
mkdir -p "$HOME/.claude" "$HOME/.codex"
echo '{"model":"opus","hooks":{"Stop":[]}}' > "$HOME/.claude/settings.json"
"$AW" install claude-hooks 2>/dev/null
check "claude hooks added, other settings kept" \
  'jq -e ".model == \"opus\" and (.hooks.Stop | type) == \"array\" and (.hooks.WorktreeCreate[0].hooks[0].command | endswith(\"hook create\"))" "$HOME/.claude/settings.json" >/dev/null'
"$AW" install all 2>/dev/null
check "install all installs the Claude Code plugin" 'grep -q "|plugin install ramify@ramify" "$T/last-agent"'
check "the plugin replaces the older hooks, other settings kept" \
  'jq -e ".model == \"opus\" and (.hooks.Stop | type) == \"array\" and .hooks.WorktreeCreate == null" "$HOME/.claude/settings.json" >/dev/null'
"$AW" install instructions 2>/dev/null
check "instructions installed once per agent" '[ "$(grep -c "(ramify)" "$HOME/.codex/AGENTS.md")" = 1 ] && [ "$(grep -c "(ramify)" "$HOME/.claude/CLAUDE.md")" = 1 ]'
check "agents without a config dir are skipped" '[ ! -e "$HOME/.gemini" ]'
printf '# Mine\nkeep me\n\n## Worktrees (ramify)\nold rule\n\n## After\nstays\n' > "$HOME/.codex/AGENTS.md"
"$AW" install instructions 2>/dev/null
check "an older ramify section is replaced, the rest kept" '! grep -q "old rule" "$HOME/.codex/AGENTS.md" && grep -q "ramify who" "$HOME/.codex/AGENTS.md" && grep -qx "keep me" "$HOME/.codex/AGENTS.md" && grep -qx "stays" "$HOME/.codex/AGENTS.md" && [ "$(grep -c "(ramify)" "$HOME/.codex/AGENTS.md")" = 1 ]'
cp "$HOME/.codex/AGENTS.md" "$T/agents-before"
"$AW" install instructions 2>/dev/null
check "an up-to-date section is left as it is" 'cmp -s "$T/agents-before" "$HOME/.codex/AGENTS.md"'

echo "one branch per agent from the terminal"
cd "$T/demo" || exit 1
rm -f "$T/last-agent"
RAMIFY_INTERACTIVE=1 "$AW" run codex "add search" 2>/dev/null
nb=$(git branch --format='%(refname:short)' --list 'codex/*' | head -1)
check "run from the main checkout gives the agent its own branch" '[ -n "$nb" ] && grep -q "^codex|$W/$(echo "$nb" | tr / -)|[0-9]*|add search$" "$T/last-agent"'
check "the main checkout stays on main" '[ "$(git branch --show-current)" = main ]'
check "its worktree records the agent" 'grep -qx "WT_AGENT=codex" "$W/$(echo "$nb" | tr / -)/.worktree.env"'
before=$(git branch --list 'codex/*' | wc -l)
RAMIFY_INTERACTIVE=1 "$AW" run codex --version 2>/dev/null
check "non-conversation arguments run untouched, in place" '[ "$(git branch --list "codex/*" | wc -l)" = "$before" ] && grep -q "^codex|$T/demo|" "$T/last-agent"'
RAMIFY_INTERACTIVE=1 RAMIFY_NO_BRANCH=1 "$AW" run codex 2>/dev/null
check "RAMIFY_NO_BRANCH runs in place" '[ "$(git branch --list "codex/*" | wc -l)" = "$before" ]'
"$AW" run codex 2>/dev/null </dev/null
check "without a terminal (scripts) it runs in place" '[ "$(git branch --list "codex/*" | wc -l)" = "$before" ]'
own="$W/$(echo "$nb" | tr / -)"
cbefore=$(git branch --list 'claude/*' | wc -l)
(cd "$own" && RAMIFY_INTERACTIVE=1 "$AW" run claude "go" 2>/dev/null)
check "inside a worktree it runs there" 'grep -q "^claude|$own|" "$T/last-agent" && [ "$(git branch --list "claude/*" | wc -l)" = "$cbefore" ]'
git checkout -q -b own-topic-run
RAMIFY_INTERACTIVE=1 "$AW" run claude "go" 2>/dev/null
check "on a branch of its own it runs in place" '[ "$(git branch --list "claude/*" | wc -l)" = "$cbefore" ]'
git checkout -q main
(cd "$T" && RAMIFY_INTERACTIVE=1 "$AW" run claude "go" 2>/dev/null)
check "outside a repository it runs in place" 'grep -q "^claude|$T|" "$T/last-agent"'

echo "claude code: a worktree of its own before changing files"
cd "$T/demo" || exit 1
git checkout -q main
ss=$(printf '{"cwd":"%s"}' "$T/demo" | "$AW" hook session-start 2>/dev/null)
check "session start on the shared branch points to EnterWorktree" 'printf "%s" "$ss" | jq -e ".hookSpecificOutput.additionalContext | contains(\"EnterWorktree\")" >/dev/null'
check "session start on the shared branch shows the user a warning" 'printf "%s" "$ss" | jq -e ".systemMessage | contains(\"shared branch\")" >/dev/null'
g=$(printf '{"cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s/new.txt"}}' "$T/demo" "$T/demo" | "$AW" hook guard 2>/dev/null)
check "an edit on the shared branch is denied with the way out" 'printf "%s" "$g" | jq -e ".hookSpecificOutput.permissionDecision == \"deny\" and (.hookSpecificOutput.permissionDecisionReason | contains(\"EnterWorktree\"))" >/dev/null'
p1=$(printf '{"name":"feat-login","cwd":"%s"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
p2=$(printf '{"name":"fix-cart-total","cwd":"%s"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
check "conventional names become conventional branches" 'git show-ref --quiet refs/heads/feat/login && git show-ref --quiet refs/heads/fix/cart-total'
check "two sessions get two folders and two branches" '[ -n "$p1" ] && [ -n "$p2" ] && [ "$p1" != "$p2" ] && [ "$(git -C "$p1" branch --show-current)" = feat/login ] && [ "$(git -C "$p2" branch --show-current)" = fix/cart-total ]'
p1b=$(printf '{"name":"feat-login","cwd":"%s"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
check "the same name again reuses its worktree" '[ "$p1b" = "$p1" ]'
s1=$(printf '{"name":"feat-pay","cwd":"%s","session_id":"s-one"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
s1b=$(printf '{"name":"feat-pay","cwd":"%s","session_id":"s-one"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
s2=$(printf '{"name":"feat-pay","cwd":"%s","session_id":"s-two"}' "$T/demo" | "$AW" hook create 2>/dev/null | tail -1)
check "the same conversation resumes its own worktree" '[ -n "$s1" ] && [ "$s1b" = "$s1" ]'
check "another conversation with the same name gets a worktree of its own" '[ -n "$s2" ] && [ "$s2" != "$s1" ] && [ "$(git -C "$s2" branch --show-current)" = feat/pay-2 ]'
check "ls --json tells which conversation made a worktree" '(cd "$T/demo" && "$AW" ls --json) | jq -e "(.[] | select(.branch == \"feat/pay-2\") | .session == \"s-two\") and (.[] | select(.branch == \"feat/login\") | has(\"session\") | not)" >/dev/null'
g=$(printf '{"cwd":"%s","tool_name":"Edit","tool_input":{"file_path":"%s/a.txt"}}' "$p1" "$p1" | "$AW" hook guard 2>/dev/null)
check "edits inside its worktree are allowed" '[ -z "$g" ]'
g=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m wip"}}' "$T/demo" | "$AW" hook guard 2>/dev/null)
check "a terminal commit on the shared branch is denied" 'printf "%s" "$g" | jq -e ".hookSpecificOutput.permissionDecision == \"deny\"" >/dev/null'
g=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git -C %s commit -m wip"}}' "$T/demo" "$p1" | "$AW" hook guard 2>/dev/null)
check "a terminal commit in its worktree (git -C) is allowed" '[ -z "$g" ]'
g=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"cd %s && git commit -m wip"}}' "$T/demo" "$p1" | "$AW" hook guard 2>/dev/null)
check "a terminal commit after cd into its worktree is allowed" '[ -z "$g" ]'
g=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git status && git log -1"}}' "$T/demo" | "$AW" hook guard 2>/dev/null)
check "other terminal commands on the shared branch are allowed" '[ -z "$g" ]'
ss=$(printf '{"cwd":"%s"}' "$p1" | "$AW" hook session-start 2>/dev/null)
check "a session inside a worktree gets no warning" '[ -z "$ss" ]'
g=$(printf '{"cwd":"/","tool_name":"Write","tool_input":{"file_path":"%s/notes.txt"}}' "$T" | "$AW" hook guard 2>/dev/null)
check "files outside any repository are allowed" '[ -z "$g" ]'
git config ramify.allowMain true
g=$(printf '{"cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s/x.txt"}}' "$T/demo" "$T/demo" | "$AW" hook guard 2>/dev/null)
check "git config ramify.allowMain lets this repository edit on main" '[ -z "$g" ]'
g=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git commit -m wip"}}' "$T/demo" | "$AW" hook guard 2>/dev/null)
check "git config ramify.allowMain lets this repository commit on main" '[ -z "$g" ]'
git config --unset ramify.allowMain
g=$(printf '{"cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s/x.txt"}}' "$T/demo" "$T/demo" | RAMIFY_ALLOW_MAIN=1 "$AW" hook guard 2>/dev/null)
check "RAMIFY_ALLOW_MAIN lets one session edit on main" '[ -z "$g" ]'

echo "who changes these files"
echo "login" > "$p1/a.txt"; mkdir -p "$p1/src"; echo x > "$p1/src/new.ts"
check "who names the worktree changing a file" '[ "$(cd "$p2" && "$AW" who a.txt | cut -f1,4)" = "$(printf "feat/login\ta.txt")" ]'
check "who exits 1 on an overlap" '! (cd "$p2" && "$AW" who a.txt >/dev/null)'
w=$(cd "$p2" && "$AW" who src/)
check "who matches files inside a folder, untracked ones included" 'printf "%s" "$w" | grep -q "src/new.ts"'
w=$(cd "$p2" && "$AW" who "$p2/a.txt")
check "who takes absolute paths" 'printf "%s" "$w" | grep -q "^feat/login"'
check "who is quiet and exits 0 when nobody else changes them" '[ -z "$(cd "$p2" && "$AW" who other.txt)" ]'
check "who does not report the worktree asking" '(cd "$p1" && "$AW" who a.txt >/dev/null)'
echo "cart" > "$p2/a.txt"
w=$(cd "$p2" && "$AW" who)
check "who without paths checks the files this worktree changes" 'printf "%s" "$w" | grep -q "a.txt"'
git -C "$p1" checkout -q -- a.txt; rm -rf "$p1/src"; git -C "$p2" checkout -q -- a.txt

echo "ready to merge"
cd "$T/demo" || exit 1
mark() { sed -n "s/^$2=//p" "$1/.worktree.env"; }
printf 'one\ntwo\nthree\nfour\nfive\n' > q.txt && git add q.txt && git commit -qm q
ra=$("$AW" new feat/ready-a --no-launch --no-setup 2>/dev/null)
rb=$("$AW" new feat/ready-b --no-launch --no-setup 2>/dev/null)
check "ready refuses the main checkout" '! "$AW" ready 2>/dev/null'
check "ready refuses a branch without commits" '! (cd "$ra" && "$AW" ready 2>/dev/null) && [ -z "$(mark "$ra" WT_READY)" ]'
printf 'one-a\ntwo\nthree\nfour\nfive\n' > "$ra/q.txt"
check "ready refuses uncommitted changes and marks nothing" '! (cd "$ra" && "$AW" ready 2>/dev/null) && [ -z "$(mark "$ra" WT_READY)" ]'
git -C "$ra" commit -qam "a: q"
echo later > later.txt && git add later.txt && git commit -qm later
(cd "$ra" && "$AW" ready >/dev/null 2>&1); c=$?
check "ready brings the base in and marks the tip and the base (exit $c)" '[ "$c" = 0 ] && git -C "$ra" merge-base --is-ancestor main HEAD && [ "$(mark "$ra" WT_READY)" = "$(git -C "$ra" rev-parse HEAD)" ] && [ "$(mark "$ra" WT_READY_BASE)" = "$(git rev-parse main)" ]'
check "ls shows it ready and behind nothing" '"$AW" ls 2>/dev/null | grep "^feat-ready-a .* ready " >/dev/null && "$AW" ls --json | jq -e ".[] | select(.branch == \"feat/ready-a\") | .ready == \"ready\" and .behind == 0" >/dev/null'
check "ls --json: the main checkout has no mark and is behind nothing" '"$AW" ls --json | jq -e ".[] | select(.main) | .ready == null and .behind == 0" >/dev/null'
printf 'one\ntwo\nthree\nfour\nfive-b\n' > "$rb/q.txt" && git -C "$rb" commit -qam "b: q"
out=$(cd "$rb" && "$AW" ready 2>/dev/null); c=$?
check "an overlap with a branch already ready exits 1 and marks nothing" '[ "$c" = 1 ] && printf "%s" "$out" | grep -q "^feat/ready-a.*q.txt$" && [ -z "$(mark "$rb" WT_READY)" ]'
# A branch that is not marked ready changes the same file: plain who sees it, ready does not wait for it.
echo mine > "$p1/q.txt"
check "who still sees a branch not marked ready" '! (cd "$rb" && "$AW" who q.txt >/dev/null 2>&1)'
git merge -q --no-ff --no-edit feat/ready-a
check "a merged branch leaves the queue" '"$AW" ls --json | jq -e ".[] | select(.branch == \"feat/ready-a\") | .ready == null" >/dev/null'
(cd "$rb" && "$AW" ready >/dev/null 2>&1); c=$?
check "once the other is merged ready passes, branches not marked ready do not count (exit $c)" '[ "$c" = 0 ] && [ "$(mark "$rb" WT_READY)" = "$(git -C "$rb" rev-parse HEAD)" ]'
rm -f "$p1/q.txt"
rc=$("$AW" new feat/ready-c --no-launch --no-setup 2>/dev/null)
echo c > "$rc/c.txt" && git -C "$rc" add c.txt && git -C "$rc" commit -qm c
git merge -q --no-ff --no-edit feat/ready-c
check "after another branch is merged the mark goes stale and behind counts what it lacks" '"$AW" ls --json | jq -e ".[] | select(.branch == \"feat/ready-b\") | .ready == \"stale\" and .behind == 2" >/dev/null && "$AW" ls 2>/dev/null | grep "^feat-ready-b .* stale " >/dev/null'
n=$(printf '{"cwd":"%s","session_id":"s"}' "$rb" | "$AW" hook nudge 2>/dev/null)
check "nudge tells the agent of a stale branch to run ramify ready again" 'printf "%s" "$n" | jq -e ".hookSpecificOutput.hookEventName == \"UserPromptSubmit\" and (.hookSpecificOutput.additionalContext | contains(\"main has moved\") and contains(\"ready\"))" >/dev/null'
(cd "$rb" && "$AW" ready >/dev/null 2>&1)
n=$(printf '{"cwd":"%s"}' "$rb" | "$AW" hook nudge 2>/dev/null)
check "nudge is quiet up to date, without a mark and on main" '[ -z "$n" ] && [ -z "$(printf "{\"cwd\":\"%s\"}" "$p1" | "$AW" hook nudge 2>/dev/null)" ] && [ -z "$(printf "{\"cwd\":\"%s\"}" "$T/demo" | "$AW" hook nudge 2>/dev/null)" ]'
rd=$("$AW" new feat/ready-d --no-launch --no-setup 2>/dev/null)
printf 'one-a\ntwo-d\nthree\nfour\nfive\n' > "$rd/q.txt" && git -C "$rd" commit -qam "d: q"
printf 'one-a\ntwo-main\nthree\nfour\nfive\n' > q.txt && git commit -qam "main: q"
hd=$(git -C "$rd" rev-parse HEAD)
out=$(cd "$rd" && "$AW" ready 2>/dev/null); c=$?
check "a conflict with the base exits 2 and names the files" '[ "$c" = 2 ] && [ "$out" = q.txt ]'
check "after a conflict: same HEAD, clean tree, no MERGE_HEAD, no mark" '[ "$(git -C "$rd" rev-parse HEAD)" = "$hd" ] && [ -z "$(git -C "$rd" status --porcelain)" ] && ! git -C "$rd" rev-parse -q --verify MERGE_HEAD >/dev/null && [ -z "$(mark "$rd" WT_READY)" ]'
# .worktree.env can come with the repository: a mark that is not a commit id is no mark.
printf 'WT_READY=%s\nWT_READY_BASE=main\n' "$hd" >> "$rd/.worktree.env"
check "ls ignores a mark that is not a commit id" '"$AW" ls --json | jq -e ".[] | select(.branch == \"feat/ready-d\") | .ready == null" >/dev/null'
git init -q -b main "$T/solo" && git -C "$T/solo" commit -q --allow-empty -m init
so=$(cd "$T/solo" && "$AW" new feat/solo --no-launch --no-setup 2>/dev/null)
echo s > "$so/s.txt" && git -C "$so" add s.txt && git -C "$so" commit -qm s
check "ready works without a remote" '(cd "$so" && "$AW" ready >/dev/null 2>&1) && [ "$(mark "$so" WT_READY)" = "$(git -C "$so" rev-parse HEAD)" ]'
cd "$T/demo" || exit 1

echo "move work off main"
cd "$T/demo" || exit 1
echo "half done" > wip.txt; echo changed >> a.txt
mp=$("$AW" move feat/moved -a claude 2>/dev/null)
check "move takes uncommitted work to a new branch" '[ "$mp" = "$W/feat-moved" ] && [ -f "$mp/wip.txt" ] && grep -q changed "$mp/a.txt"'
check "the main checkout is left clean" '[ -z "$(git status --porcelain)" ]'
check "a stash keeps a copy" 'git stash list | grep -q "ramify: moved to feat/moved"'
check "the new worktree records the agent" 'grep -qx "WT_AGENT=claude" "$mp/.worktree.env"'
check "move refuses inside a worktree" '! (cd "$mp" && "$AW" move other 2>/dev/null)'

echo "shell integration"
init=$("$AW" shell-init)
check "shell-init wraps installed agents only" 'printf "%s" "$init" | grep -q "^claude() {" && ! printf "%s" "$init" | grep -q "^kimi() {"'
SHELL=/bin/zsh "$AW" install shell 2>/dev/null; SHELL=/bin/zsh "$AW" install shell 2>/dev/null
check "install shell adds the block once" '[ "$(grep -c ">>> ramify" "$HOME/.zshrc")" = 1 ]'
echo 'export KEEP=1' >> "$HOME/.zshrc"
SHELL=/bin/zsh "$AW" uninstall shell 2>/dev/null
check "uninstall shell removes the block and keeps the rest" '! grep -q "ramify" "$HOME/.zshrc" && grep -qx "export KEEP=1" "$HOME/.zshrc"'

echo "tmux"
if command -v tmux >/dev/null; then
  # A tmux server of its own (socket under $T, config from the test HOME) that ends sessions left without a client.
  export TMUX_TMPDIR="$T/tmux"; mkdir -p "$TMUX_TMPDIR"; unset TMUX
  echo 'set -g destroy-unattached on' > "$HOME/.tmux.conf"
  mkdir -p "$T/bin-slow"; printf '#!/bin/sh\nsleep 30\n' > "$T/bin-slow/claude"; chmod +x "$T/bin-slow/claude"
  PATH="$T/bin-slow:$PATH" "$AW" new tmuxkeep -a claude --tmux --no-setup >/dev/null 2>&1
  sleep 1
  check "--tmux: the detached agent session survives destroy-unattached" 'tmux has-session -t "=demo_tmuxkeep" 2>/dev/null'
  check "--tmux: only that session opts out" '[ "$(tmux show -t demo_tmuxkeep -v destroy-unattached)" = off ] && [ "$(tmux show -gv destroy-unattached)" = on ]'
  tmux kill-server 2>/dev/null
  unset TMUX_TMPDIR
else
  echo "  skip: tmux is not installed"
fi

echo "secret scan before commit and push"
if command -v gitleaks >/dev/null; then
  git init -q --bare "$T/sec-origin.git"
  git clone -q "$T/sec-origin.git" "$T/sec" 2>/dev/null
  cd "$T/sec" || exit 1
  git checkout -q -b main
  echo hi > a.txt; git add a.txt; git commit -qm init; git push -q origin main 2>/dev/null
  "$AW" install secrets 2>/dev/null
  check "install secrets adds pre-commit and pre-push" '[ -x .git/hooks/pre-commit ] && [ -x .git/hooks/pre-push ]'
  # A token made up now: no secret, real or fake, is ever written into this repository.
  fake="ghp_$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"
  printf 'TOKEN=%s\n' "$fake" > config.js; git add config.js
  git commit -qm leak 2>"$T/sec-commit.err"; c=$?
  check "a commit with a token fails (exit $c) and is not made" '[ "$c" != 0 ] && [ "$(git rev-list --count HEAD)" = 1 ]'
  check "the commit message names rule, file and line" 'grep -q "github-pat  config.js:1" "$T/sec-commit.err"'
  check "the token is never printed at commit" '! grep -qF "$fake" "$T/sec-commit.err"'
  git reset -q config.js; rm config.js
  echo clean > b.txt; git add b.txt
  git commit -qm clean 2>"$T/sec-clean.err"; c=$?
  check "a clean commit passes without a word (exit $c)" '[ "$c" = 0 ] && [ ! -s "$T/sec-clean.err" ]'
  git push -q origin main 2>"$T/sec-push-clean.err"; c=$?
  check "a clean push passes (exit $c)" '[ "$c" = 0 ] && [ "$(git --git-dir="$T/sec-origin.git" rev-parse main)" = "$(git rev-parse HEAD)" ]'
  # A token committed past the hook (--no-verify) is stopped at push.
  printf 'TOKEN=%s\n' "$fake" > config.js; git add config.js; git commit -qm leak --no-verify
  git push -q origin main 2>"$T/sec-push.err"; c=$?
  check "a push with the token is blocked (exit $c) and nothing reaches origin" '[ "$c" != 0 ] && [ -z "$(git --git-dir="$T/sec-origin.git" log --oneline --grep=leak main)" ]'
  check "the push message names rule, file, line and commit" 'grep -q "github-pat  config.js:1  (commit " "$T/sec-push.err"'
  check "the token is never printed at push" '! grep -qF "$fake" "$T/sec-push.err"'
  git checkout -q -b feat/sec; git push -q origin feat/sec 2>/dev/null; c=$?
  check "a new branch carrying the token is blocked too (exit $c)" '[ "$c" != 0 ] && ! git --git-dir="$T/sec-origin.git" show-ref -q refs/heads/feat/sec'
  printf '#!/bin/sh\nexit 0\n' > .git/hooks/pre-commit
  "$AW" install secrets 2>/dev/null
  check "a pre-commit hook that is not ramify's is left as it is" '! grep -q "ramify: secret scan" .git/hooks/pre-commit'
else
  echo "  skip: gitleaks is not installed"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
