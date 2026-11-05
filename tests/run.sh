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
"$AW" install all 2>/dev/null
check "claude hooks added, other settings kept" \
  'jq -e ".model == \"opus\" and (.hooks.Stop | type) == \"array\" and (.hooks.WorktreeCreate[0].hooks[0].command | endswith(\"hook create\"))" "$HOME/.claude/settings.json" >/dev/null'
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

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
