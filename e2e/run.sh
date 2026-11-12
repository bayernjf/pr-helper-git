#!/usr/bin/env bash
# E2E integration tests for pr-helper-git2: start the loopback server with an
# isolated config home, drive the real HTTP API with curl, and assert responses.
#
# NOTE on quoting: every JSON payload is built with printf at RUNTIME and
# passed as a single "$PAYLOAD" word. NEVER inline `{\"a\":\"b\"}` payloads
# inside $( ) — bash's nested-quote handling shreds them into separate words
# (curl then splits on the commas) and the server sees invalid JSON.
#
# The server runs with GIT2_DEV=1, which pins the instance token to "dev-token";
# PR_HELPER_HOME points at a throwaway directory so the suite never touches
# ~/.pr-helper-git2 (repo registry, users, audit log).
set -euo pipefail

cd "$(dirname "$0")/.."

PORT=18774
BASE="http://127.0.0.1:$PORT"
DEMO="/tmp/prh2-e2e-demo"
HOME_DIR="$DEMO/home"
REPO_A="$DEMO/e2e-repo-a"
REPO_B="$DEMO/e2e-repo-b"
TOKEN=dev-token
PASS=0; FAIL=0; TOTAL=0

check() {
  local name="$1" expected="$2" actual="$3"
  TOTAL=$((TOTAL+1))
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS+1)); echo "  ✓ $name"
  else
    FAIL=$((FAIL+1)); echo "  ✗ $name (expected $expected, got $actual)"
  fi
}

contains() {
  local name="$1" needle="$2" haystack="$3"
  TOTAL=$((TOTAL+1))
  # here-string, not a pipe: grep -q exits on the first match and the SIGPIPE
  # on the writer would make `set -o pipefail` report a false failure.
  if grep -q "$needle" <<< "$haystack"; then
    PASS=$((PASS+1)); echo "  ✓ $name"
  else
    FAIL=$((FAIL+1)); echo "  ✗ $name (expected to contain '$needle')"
  fi
}

# POST /api/<route> with a printf-built JSON payload; echoes the status code.
post() {
  local route="$1"; shift
  local payload="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$BASE/api/$route?token=$TOKEN"
}

# GET /api/<route> with url-encoded query params; echoes the body.
getq() {
  local route="$1"; shift
  curl -s -G "$BASE/api/$route?token=$TOKEN" "$@"
}

# GET status code for /api/<route>.
getcode() {
  local route="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' -G "$BASE/api/$route?token=$TOKEN" "$@"
}

json() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
rm -rf "$DEMO"; mkdir -p "$DEMO/home"
mkdir -p "$REPO_A"
cd "$REPO_A"
git init -q -b main
git config user.email "e2e@test.com"; git config user.name "E2E"
for i in 1 2 3; do
  echo "content $i" > "file$i.txt"
  echo "version $i" > shared.txt
  git add . && git commit -qm "commit $i"
done
git init -q --bare -b main "$DEMO/e2e-remote.git"
git remote add origin "$DEMO/e2e-remote.git"
git push -q -u origin main
cd - >/dev/null

mkdir -p "$REPO_B"
cd "$REPO_B"
git init -q -b main
git config user.email "e2e@test.com"; git config user.name "E2E"
echo "needle alpha" > note.txt
git add . && git commit -qm "repo b initial"
cd - >/dev/null

for R in C D E F; do mkdir -p "$DEMO/e2e-repo-$(echo $R | tr 'CDEF' 'cdef')"; done
REPO_C="$DEMO/e2e-repo-c"
REPO_D="$DEMO/e2e-repo-d"
REPO_E="$DEMO/e2e-repo-e"
REPO_F="$DEMO/e2e-repo-f"

# C: three commits on separate files plus a 12-line file for hunk/line staging.
cd "$REPO_C"
git init -q -b main
git config user.email "e2e@test.com"; git config user.name "E2E"
echo "one" > c1.txt; git add . && git commit -qm "c1"
echo "two" > c2.txt; git add . && git commit -qm "c2"
echo "three" > c3.txt; git add . && git commit -qm "c3"
seq 1 12 | sed 's/^/line /' > hunks.txt
git add . && git commit -qm "c4 hunks"
cd - >/dev/null

# D: merge conflict fixture — two branches editing the same line.
cd "$REPO_D"
git init -q -b main
git config user.email "e2e@test.com"; git config user.name "E2E"
echo "base" > shared.txt; git add . && git commit -qm "d base"
git checkout -q -b m-a; echo "A" > shared.txt; git commit -qam "d A"
git checkout -q -b m-b main; echo "B" > shared.txt; git commit -qam "d B"
git checkout -q m-a
git checkout -q -b m-c main; echo "C" > shared.txt; git commit -qam "d C"
git checkout -q -b m-d main; echo "D" > shared.txt; git commit -qam "d D"
git checkout -q m-c
cd - >/dev/null

# E: rebase conflict — branch edits the same line that main changed.
cd "$REPO_E"
git init -q -b main
git config user.email "e2e@test.com"; git config user.name "E2E"
echo "base" > shared.txt; git add . && git commit -qm "e base"
git checkout -q -b rbx; echo "rbx" > shared.txt; git commit -qam "e rbx"
git checkout -q main; echo "main" > shared.txt; git commit -qam "e main"
git checkout -q rbx
cd - >/dev/null

# F: clean interactive rebase fixture — three commits on separate files.
cd "$REPO_F"
git init -q -b main
git config user.email "e2e@test.com"; git config user.name "E2E"
echo "f1" > f1.txt; git add . && git commit -qm "f1 first"
echo "f2" > f2.txt; git add . && git commit -qm "f2 second"
echo "f3" > f3.txt; git add . && git commit -qm "f3 third"
cd - >/dev/null

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
rm -f /tmp/prh2-e2e-server.log
PR_HELPER_HOME="$HOME_DIR" GIT2_DEV=1 node server/main.mjs --port=$PORT \
  > /tmp/prh2-e2e-server.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  kill -9 "$SERVER_PID" 2>/dev/null || true
  rm -rf "$DEMO"
}
trap cleanup EXIT

READY=no
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$BASE/api/health?token=$TOKEN"; then READY=yes; break; fi
  sleep 0.25
done
if [ "$READY" != yes ]; then
  echo "server did not start:"; sed -n '1,40p' /tmp/prh2-e2e-server.log; exit 1
fi

echo ""
echo "=== E2E: Security ==="
check "health without token is 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")"
check "health with wrong token is 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health?token=nope")"
check "health with token is 200" "200" "$(getcode health)"
check "register non-git dir is 400" "400" "$(post repos/add "$(printf '{"repo":"%s"}' "$DEMO/home")")"

echo ""
echo "=== E2E: Mobile shell ==="
MOBILE_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/m?token=$TOKEN")
check "mobile shell responds" "200" "$MOBILE_CODE"
MOBILE_BODY=$(curl -s "$BASE/m?token=$TOKEN")
contains "mobile shell is the app entry" '<div id="root">' "$MOBILE_BODY"

echo "=== E2E: Repos + Core reads ==="
check "register repo A" "200" "$(post repos/add "$(printf '{"repo":"%s"}' "$REPO_A")")"
check "register repo B" "200" "$(post repos/add "$(printf '{"repo":"%s"}' "$REPO_B")")"
REPOS=$(getq repos)
check "repo list has 2 entries" "2" "$(echo "$REPOS" | json 'len(d["repos"])')"
contains "repo list names repo A" "e2e-repo-a" "$REPOS"
check "file traversal rejected" "400" "$(curl -s -o /dev/null -w '%{http_code}' -G "$BASE/api/file?token=$TOKEN" --data-urlencode "repo=$REPO_A" --data-urlencode "file=../etc/passwd")"
check "unknown endpoint is 404" "404" "$(getcode nope --data-urlencode "repo=$REPO_A")"

STATUS=$(getq status --data-urlencode "repo=$REPO_A")
check "status branch is main" "main" "$(echo "$STATUS" | json 'd["status"]["branch"]')"
check "status is clean" "0" "$(echo "$STATUS" | json 'len(d["status"]["files"])')"

LOG=$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "limit=5")
contains "log has newest commit" "commit 3" "$LOG"
check "log has 3 commits" "3" "$(echo "$LOG" | json 'len(d["commits"])')"

REFS=$(getq refs --data-urlencode "repo=$REPO_A")
contains "refs list main" "main" "$REFS"
contains "refs list origin/main" "origin/main" "$REFS"

SUBS=$(getq submodules --data-urlencode "repo=$REPO_A")
check "no submodules in repo A" "0" "$(echo "$SUBS" | json 'len(d["entries"])')"

FILE=$(getq file --data-urlencode "repo=$REPO_A" --data-urlencode "file=file1.txt")
contains "file content" "content 1" "$FILE"

echo ""
echo "=== E2E: Stage → Commit → Undo ==="
echo "staged line" >> "$REPO_A/file1.txt"
check "stage file" "200" "$(post stage "$(printf '{"repo":"%s","file":"file1.txt","action":"stage"}' "$REPO_A")")"
STAGED=$(getq status --data-urlencode "repo=$REPO_A")
contains "status shows staged change" "file1.txt" "$STAGED"
check "commit staged" "200" "$(post commit "$(printf '{"repo":"%s","message":"e2e: staged change"}' "$REPO_A")")"
contains "log shows new commit" "e2e: staged change" "$(getq log --data-urlencode "repo=$REPO_A")"
check "commit with empty message is 400" "400" "$(post commit "$(printf '{"repo":"%s","message":"   "}' "$REPO_A")")"
check "commit with nothing staged is 409" "409" "$(post commit "$(printf '{"repo":"%s","message":"e2e: empty"}' "$REPO_A")")"
check "undo HEAD keeps staged" "200" "$(post undo-commit "$(printf '{"repo":"%s"}' "$REPO_A")")"
UNDO_STATUS=$(getq status --data-urlencode "repo=$REPO_A")
contains "undo left staged file" "file1.txt" "$UNDO_STATUS"
contains "undo removed commit from history" "commit 3" "$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "limit=1")"
check "stage-all" "200" "$(post stage-all "$(printf '{"repo":"%s","action":"stage"}' "$REPO_A")")"
check "re-commit" "200" "$(post commit "$(printf '{"repo":"%s","message":"e2e: staged change"}' "$REPO_A")")"

echo ""
echo "=== E2E: Branch / Tag / Stash ==="
check "create branch" "200" "$(post branch/create "$(printf '{"repo":"%s","name":"e2e-branch","noCheckout":true}' "$REPO_A")")"
contains "refs show branch" "e2e-branch" "$(getq refs --data-urlencode "repo=$REPO_A")"
check "create tag" "200" "$(post tag/create "$(printf '{"repo":"%s","name":"v-e2e","message":"e2e tag"}' "$REPO_A")")"
contains "tag listed" "v-e2e" "$(getq refs --data-urlencode "repo=$REPO_A")"
check "delete tag" "200" "$(post tag/delete "$(printf '{"repo":"%s","name":"v-e2e"}' "$REPO_A")")"

echo "dirty for stash" >> "$REPO_A/shared.txt"
check "stash create" "200" "$(post stash/create "$(printf '{"repo":"%s","message":"e2e stash"}' "$REPO_A")")"
STASHES=$(getq stash-list --data-urlencode "repo=$REPO_A")
contains "stash listed" "e2e stash" "$STASHES"
check "stash apply" "200" "$(post stash/apply "$(printf '{"repo":"%s","index":0}' "$REPO_A")")"
check "stash drop" "200" "$(post stash/drop "$(printf '{"repo":"%s","index":0}' "$REPO_A")")"
check "stash list empty" "0" "$(getq stash-list --data-urlencode "repo=$REPO_A" | json 'len(d["entries"])')"
git -C "$REPO_A" checkout -q -- . 2>/dev/null || true

echo ""
echo "=== E2E: Grep / Compare / Rebase plan ==="
GREP=$(getq grep --data-urlencode "repo=$REPO_B" --data-urlencode "pattern=needle")
contains "grep finds text" "note.txt" "$GREP"
check "grep without pattern is 400" "400" "$(getcode grep --data-urlencode "repo=$REPO_B")"

git -C "$REPO_A" checkout -q -b e2e-cmp main
echo "cmp only" > "$REPO_A/cmp.txt"
git -C "$REPO_A" add -A && git -C "$REPO_A" commit -qm "e2e: cmp commit"
git -C "$REPO_A" checkout -q main
CMP=$(getq compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=main" --data-urlencode "head=e2e-cmp")
check "compare ahead 1" "1" "$(echo "$CMP" | json 'len(d["ahead"])')"
contains "compare lists file" "cmp.txt" "$CMP"
check "compare unknown ref is 400" "400" "$(getcode compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=main" --data-urlencode "head=nope-nope")"
check "compare same ref is 400" "400" "$(getcode compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=main" --data-urlencode "head=main")"

# A bare commit SHA is a valid side, not just a branch name.
CMP_TIP=$(git -C "$REPO_A" rev-parse main)
SHA_CMP=$(getq compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=$CMP_TIP" --data-urlencode "head=e2e-cmp")
check "compare accepts a commit SHA" "1" "$(printf '%s' "$SHA_CMP" | json 'len(d["ahead"])')"

# Working tree as a side: a staged addition is what distinguishes the two diff
# directions (A forwards, D reversed); a plain edit stays M either way.
echo "wt edit" >> "$REPO_A/file1.txt"
echo "wt new" > "$REPO_A/wt-staged.txt"
git -C "$REPO_A" add wt-staged.txt
echo "wt junk" > "$REPO_A/wt-untracked.txt"
WT=$(getq compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=main" --data-urlencode "head=:worktree")
check "worktree compare has no commits" "0" "$(printf '%s' "$WT" | json 'len(d["ahead"]) + len(d["behind"])')"
contains "worktree compare lists tracked edit" "file1.txt" "$WT"
check "worktree compare adds staged file" "A" "$(printf '%s' "$WT" | json '[f["status"] for f in d["files"] if f["path"]=="wt-staged.txt"][0]')"
check "worktree compare reports untracked" "1" "$(printf '%s' "$WT" | json 'len(d["untracked"])')"
WT_REV=$(getq compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=:worktree" --data-urlencode "head=main")
check "worktree as base flips direction" "D" "$(printf '%s' "$WT_REV" | json '[f["status"] for f in d["files"] if f["path"]=="wt-staged.txt"][0]')"
check "worktree on both sides is 400" "400" "$(getcode compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=:worktree" --data-urlencode "head=:worktree")"
check "worktree lookalike ref is 400" "400" "$(getcode compare --data-urlencode "repo=$REPO_A" --data-urlencode "base=:worktree-ish" --data-urlencode "head=main")"
git -C "$REPO_A" reset -q -- wt-staged.txt
rm -f "$REPO_A/wt-staged.txt" "$REPO_A/wt-untracked.txt"
git -C "$REPO_A" checkout -q -- file1.txt

REBASE_BASE=$(git -C "$REPO_A" rev-parse HEAD~2)
PLAN=$(getq rebase/plan --data-urlencode "repo=$REPO_A" --data-urlencode "base=$REBASE_BASE")
check "rebase plan has 2 commits" "2" "$(echo "$PLAN" | json 'len(d["commits"])')"
contains "rebase plan first subject" "e2e: staged change" "$PLAN"

echo ""
echo "=== E2E: Cherry-pick / Merge ==="
CMP_SHA=$(git -C "$REPO_A" rev-parse e2e-cmp)
check "cherry-pick" "200" "$(post cherry-pick "$(printf '{"repo":"%s","sha":"%s"}' "$REPO_A" "$CMP_SHA")")"
check "cherry-pick brought file" "200" "$(getcode file --data-urlencode "repo=$REPO_A" --data-urlencode "file=cmp.txt")"
check "invalid sha is 400" "400" "$(post cherry-pick "$(printf '{"repo":"%s","sha":"zzz"}' "$REPO_A")")"
check "undo cherry-pick" "200" "$(post undo-commit "$(printf '{"repo":"%s"}' "$REPO_A")")"

git -C "$REPO_A" checkout -q -b e2e-merge main
echo "merge src" > "$REPO_A/merged.txt"
git -C "$REPO_A" add -A && git -C "$REPO_A" commit -qm "e2e: merge src"
git -C "$REPO_A" checkout -q main
echo "main diverges" > "$REPO_A/main-diverge.txt"
git -C "$REPO_A" add -A && git -C "$REPO_A" commit -qm "e2e: main diverges"
check "merge branch" "200" "$(post merge "$(printf '{"repo":"%s","ref":"e2e-merge"}' "$REPO_A")")"
MERGE_LOG=$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "limit=1" --data-urlencode "scope=current")
check "merge commit present" "1" "$(printf '%s' "$MERGE_LOG" | grep -c "Merge branch")"

echo ""
echo "=== E2E: Repos C-F registration ==="
for R in "$REPO_C" "$REPO_D" "$REPO_E" "$REPO_F"; do
  check "register $(basename "$R")" "200" "$(post repos/add "$(printf '{"repo":"%s"}' "$R")")"
done

echo ""
echo "=== E2E: Hunk and line staging ==="
# Two edited regions in a 12-line file → two hunks.
perl -pi -e 's/^line 2$/LINE TWO/' "$REPO_C/hunks.txt"
perl -pi -e 's/^line 10$/LINE TEN/' "$REPO_C/hunks.txt"
check "stage-hunk 0" "200" "$(post stage-hunk "$(printf '{"repo":"%s","file":"hunks.txt","hunk":0,"action":"stage"}' "$REPO_C")")"
contains "stage-hunk marks file staged" "hunks.txt" "$(getq status --data-urlencode "repo=$REPO_C")"
check "stage-hunk out of range is 400" "400" "$(post stage-hunk "$(printf '{"repo":"%s","file":"hunks.txt","hunk":99,"action":"stage"}' "$REPO_C")")"
check "unstage-hunk 0" "200" "$(post stage-hunk "$(printf '{"repo":"%s","file":"hunks.txt","hunk":0,"action":"unstage"}' "$REPO_C")")"
check "stage-lines 1,2" "200" "$(post stage-lines "$(printf '{"repo":"%s","file":"hunks.txt","hunk":0,"lines":[1,2],"action":"stage"}' "$REPO_C")")"
check "stage-lines is audited as lines" "200" "$(curl -s -o /dev/null -w '%{http_code}' -G "$BASE/api/audit?token=$TOKEN" --data-urlencode "limit=20")"
check "stage-lines without lines is 400" "400" "$(post stage-lines "$(printf '{"repo":"%s","file":"hunks.txt","hunk":0,"lines":[],"action":"stage"}' "$REPO_C")")"
check "stage-lines bad hunk is 400" "400" "$(post stage-lines "$(printf '{"repo":"%s","file":"hunks.txt","hunk":99,"lines":[1],"action":"stage"}' "$REPO_C")")"
git -C "$REPO_C" restore --staged --worktree hunks.txt

echo ""
echo "=== E2E: Revert ==="
C2_SHA=$(git -C "$REPO_C" rev-parse HEAD~2)
C3_SHA=$(git -C "$REPO_C" rev-parse HEAD~1)
C4_SHA=$(git -C "$REPO_C" rev-parse HEAD)
check "revert-batch two commits" "200" "$(post revert-batch "$(printf '{"repo":"%s","shas":["%s","%s"]}' "$REPO_C" "$C4_SHA" "$C3_SHA")")"
check "revert single commit" "200" "$(post revert "$(printf '{"repo":"%s","sha":"%s"}' "$REPO_C" "$C2_SHA")")"
check "revert-batch with one sha is 400" "400" "$(post revert-batch "$(printf '{"repo":"%s","shas":["%s"]}' "$REPO_C" "$C2_SHA")")"
check "revert with invalid sha is 400" "400" "$(post revert "$(printf '{"repo":"%s","sha":"zzz"}' "$REPO_C")")"

echo ""
echo "=== E2E: Merge conflict → resolve → commit ==="
check "conflicting merge is 409" "409" "$(post merge "$(printf '{"repo":"%s","ref":"m-b"}' "$REPO_D")")"
MERGE_STATE=$(getq status --data-urlencode "repo=$REPO_D")
check "status reports merge in progress" "True" "$(echo "$MERGE_STATE" | json 'd["state"]["mergeInProgress"]')"
check "resolve conflicted file with ours" "200" "$(post conflict/resolve "$(printf '{"repo":"%s","path":"shared.txt","strategy":"ours"}' "$REPO_D")")"
RESOLVED=$(getq status --data-urlencode "repo=$REPO_D")
check "merge still pending until commit" "True" "$(echo "$RESOLVED" | json 'd["state"]["mergeInProgress"]')"
check "finalize merge with a commit" "200" "$(post commit "$(printf '{"repo":"%s","message":"merge m-b"}' "$REPO_D")")"
check "merge commit recorded" "2" "$(getq log --data-urlencode "repo=$REPO_D" --data-urlencode "limit=2" --data-urlencode "scope=current" | json 'len(d["commits"])')"
contains "merge commit has two parents" "merge m-b" "$(getq log --data-urlencode "repo=$REPO_D" --data-urlencode "limit=1")"

check "second conflicting merge is 409" "409" "$(post merge "$(printf '{"repo":"%s","ref":"m-d"}' "$REPO_D")")"
check "merge abort restores clean state" "200" "$(post merge/abort "$(printf '{"repo":"%s"}' "$REPO_D")")"
ABORTED=$(getq status --data-urlencode "repo=$REPO_D")
check "abort cleared merge state" "False" "$(echo "$ABORTED" | json 'd["state"]["mergeInProgress"]')"
check "resolve without conflict is 400" "400" "$(post conflict/resolve "$(printf '{"repo":"%s","path":"shared.txt","strategy":"ours"}' "$REPO_D")")"

echo ""
echo "=== E2E: Interactive rebase ==="
F_BASE=$(git -C "$REPO_F" rev-parse HEAD~2)
F_TOP=$(git -C "$REPO_F" rev-parse HEAD)
F_MID=$(git -C "$REPO_F" rev-parse HEAD~1)
check "interactive rebase drops the newest commit" "200" "$(post rebase/interactive "$(printf '{"repo":"%s","base":"%s","commands":[{"hash":"%s","action":"pick"},{"hash":"%s","action":"drop"}]}' "$REPO_F" "$F_BASE" "$F_MID" "$F_TOP")")"
check "history shrank to two commits" "2" "$(getq log --data-urlencode "repo=$REPO_F" | json 'len(d["commits"])')"
contains "dropped commit is gone" "f1 first" "$(getq log --data-urlencode "repo=$REPO_F")"
check "plan with an unknown commit is 400" "400" "$(post rebase/interactive "$(printf '{"repo":"%s","base":"%s","commands":[{"hash":"%s","action":"pick"}]}' "$REPO_F" "$F_BASE" "$F_TOP")")"

# Conflicting rebase: current branch replayed onto a base that changed the same line.
E_MAIN=$(git -C "$REPO_E" rev-parse main)
E_RBX=$(git -C "$REPO_E" rev-parse rbx)
REBASE_BODY=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "$(printf '{"repo":"%s","base":"%s","commands":[{"hash":"%s","action":"pick"}]}' "$REPO_E" "$E_MAIN" "$E_RBX")" \
  "$BASE/api/rebase/interactive?token=$TOKEN")
contains "conflicting rebase reports conflict" '"conflicted":true' "$REBASE_BODY"
REBASE_STATE=$(getq status --data-urlencode "repo=$REPO_E")
check "status reports rebase in progress" "True" "$(echo "$REBASE_STATE" | json 'd["state"]["rebaseInProgress"]')"
check "rebase abort restores branch" "200" "$(post rebase/abort "$(printf '{"repo":"%s"}' "$REPO_E")")"
REBASE_ABORTED=$(getq status --data-urlencode "repo=$REPO_E")
check "abort cleared rebase state" "False" "$(echo "$REBASE_ABORTED" | json 'd["state"]["rebaseInProgress"]')"

echo ""
echo "=== E2E: Push / Pull against a bare remote ==="
check "push" "200" "$(post push "$(printf '{"repo":"%s"}' "$REPO_A")")"
check "bare remote matches local HEAD" "yes" "$( [ "$(git --git-dir="$DEMO/e2e-remote.git" rev-parse main)" = "$(git -C "$REPO_A" rev-parse main)" ] && echo yes || echo no )"
check "force push without confirmation is 400" "400" "$(post push "$(printf '{"repo":"%s","force":"force"}' "$REPO_A")")"

git clone -q "$DEMO/e2e-remote.git" "$DEMO/e2e-clone"
cd "$DEMO/e2e-clone"
git config user.email "e2e@test.com"; git config user.name "E2E"
echo "from clone" > clone.txt
git add . && git commit -qm "e2e: from clone" && git push -q origin main
PULLED_SHA=$(git rev-parse HEAD)
cd - >/dev/null
check "pull brings the clone commit" "200" "$(post pull "$(printf '{"repo":"%s"}' "$REPO_A")")"
contains "log shows pulled commit" "$PULLED_SHA" "$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "message=e2e: from clone" --data-urlencode "limit=1")"

echo ""
echo "=== E2E: Bisect ==="
B_GOOD=$(git -C "$REPO_A" rev-list --max-parents=0 HEAD)
B_BAD=$(git -C "$REPO_A" rev-parse HEAD)
check "bisect start" "200" "$(post bisect/start "$(printf '{"repo":"%s","good":"%s","bad":"%s"}' "$REPO_A" "$B_GOOD" "$B_BAD")")"
BIS=$(getq bisect --data-urlencode "repo=$REPO_A")
check "bisect is active" "True" "$(echo "$BIS" | json 'd["active"]')"
check "bisect reset" "200" "$(post bisect/reset "$(printf '{"repo":"%s"}' "$REPO_A")")"
BIS2=$(getq bisect --data-urlencode "repo=$REPO_A")
check "bisect is cleared" "False" "$(echo "$BIS2" | json 'd["active"]')"
check "bisect restored the branch" "main" "$(git -C "$REPO_A" rev-parse --abbrev-ref HEAD)"

echo "=== E2E: Destructive-scenario coverage (from pr-helper-git's 121) ==="
ENCODED_REPO=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$REPO_A'))")
# commit.template: resolved server-side, comment lines stripped.
printf 'e2e template subject\n\nbody from template\n# a comment that must be stripped\n' > "$REPO_A/e2e-TEMPLATE.txt"
git -C "$REPO_A" config commit.template e2e-TEMPLATE.txt
TPL=$(curl -s "$BASE/api/commit-template?token=$TOKEN&repo=$REPO_A")
contains "commit template is returned" 'e2e template subject' "$TPL"
check "commit template strips comments" "0" "$(echo "$TPL" | grep -c 'a comment that must be stripped' || true)"

# allow-empty: commits with nothing staged when the flag is set.
check "allow-empty commit" "200" "$(post commit "$(printf '{"repo":"%s","message":"e2e: empty commit","allowEmpty":true}' "$REPO_A")")"
EMPTY_LOG=$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "limit=1")
contains "empty commit is recorded" "e2e: empty commit" "$EMPTY_LOG"

# clean: two-phase (dry-run preview → confirm) and ignored files survive.
printf 'keep me\n' > "$REPO_A/ignored.tmp"
printf 'ignored.tmp\n' > "$REPO_A/.gitignore"
printf 'delete me\n' > "$REPO_A/clean-me.txt"
CLEAN_DRY=$(curl -s -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s","dryRun":true}' "$REPO_A")" "$BASE/api/clean?token=$TOKEN")
contains "clean dry-run lists the untracked file" "clean-me.txt" "$CLEAN_DRY"
check "clean requires confirmation" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s"}' "$REPO_A")" "$BASE/api/clean?token=$TOKEN")"
check "clean deletes untracked" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s","confirm":true}' "$REPO_A")" "$BASE/api/clean?token=$TOKEN")"
check "ignored file survives clean" "yes" "$([ -f "$REPO_A/ignored.tmp" ] && echo yes || echo no)"
rm -f "$REPO_A/ignored.tmp"

# hard reset: refuses without confirm, then rewrites and clears the tree.
echo "will vanish" > "$REPO_A/hard-reset.txt"
git -C "$REPO_A" add hard-reset.txt && git -C "$REPO_A" commit -qm "e2e: before hard reset"
GOOD_SHA=$(git -C "$REPO_A" rev-parse HEAD~1)
check "hard reset requires confirm" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s","mode":"hard","sha":"%s"}' "$REPO_A" "$GOOD_SHA")" "$BASE/api/reset?token=$TOKEN")"
check "hard reset" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s","mode":"hard","sha":"%s","confirm":true}' "$REPO_A" "$GOOD_SHA")" "$BASE/api/reset?token=$TOKEN")"
check "hard reset restored the tree" "yes" "$([ ! -f "$REPO_A/hard-reset.txt" ] && echo yes || echo no)"

# force-with-lease: successful protected force push to the bare remote.
echo "lease me" > "$REPO_A/lease.txt"
git -C "$REPO_A" add . && git -C "$REPO_A" commit -qm "e2e: lease commit"
check "force-with-lease push" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s","force":"force-with-lease","confirm":true}' "$REPO_A")" "$BASE/api/push?token=$TOKEN")"

# rebase conflict → continue (forked sides editing the same file).
git -C "$REPO_A" checkout -qb rb2 "main~1"
echo rb2 > "$REPO_A/conflict2.txt"
git -C "$REPO_A" add conflict2.txt && git -C "$REPO_A" commit -qm "e2e: rb2 commit"
git -C "$REPO_A" checkout -q main
echo mainv > "$REPO_A/conflict2.txt"
git -C "$REPO_A" add conflict2.txt && git -C "$REPO_A" commit -qm "e2e: main advance"
MAIN_HEAD=$(git -C "$REPO_A" rev-parse main)
RB2_SHA=$(git -C "$REPO_A" rev-parse rb2)
git -C "$REPO_A" checkout -q rb2
REBASE_BODY=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "$(printf '{"repo":"%s","base":"%s","commands":[{"hash":"%s","action":"pick"}]}' "$REPO_A" "$MAIN_HEAD" "$RB2_SHA")" \
  "$BASE/api/rebase/interactive?token=$TOKEN")
contains "conflicting rebase reports conflict" '"conflicted":true' "$REBASE_BODY"
# Simulate the user resolving the marker file, then finish the plan.
git -C "$REPO_A" checkout --theirs conflict2.txt && git -C "$REPO_A" add conflict2.txt
check "rebase conflict continue" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(printf '{"repo":"%s"}' "$REPO_A")" "$BASE/api/rebase/continue?token=$TOKEN")"
REBASED_LOG=$(getq log --data-urlencode "repo=$REPO_A")
contains "rebase continue replayed the commit" "e2e: rb2 commit" "$REBASED_LOG"
git -C "$REPO_A" checkout -q main 2>/dev/null || true
git -C "$REPO_A" branch -D rb2 >/dev/null 2>&1 || true

echo "=== E2E: Server-side PAT ==="
check "pat status empty" "false" "$(curl -s "$BASE/api/pat/status?token=$TOKEN" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["hasServerPat"]).lower())')"
check "pat store" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"pat":"github_pat_E2EPLACEHOLDER"}' "$BASE/api/pat?token=$TOKEN")"
check "pat status stored" "true" "$(curl -s "$BASE/api/pat/status?token=$TOKEN" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["hasServerPat"]).lower())')"
check "pat remove" "200" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/pat?token=$TOKEN")"
check "pat status cleared" "false" "$(curl -s "$BASE/api/pat/status?token=$TOKEN" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["hasServerPat"]).lower())')"
check "pat store rejects empty" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"pat":""}' "$BASE/api/pat?token=$TOKEN")"

echo "=== E2E: GitHub proxy guards ==="
check "github proxy without PAT is 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d '{}' "$BASE/api/github?token=$TOKEN")"
check "github proxy blocks non-allowlisted path" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -H 'x-github-pat: dummy' \
  -d '{"method":"GET","path":"/repos/o/r/hooks"}' "$BASE/api/github?token=$TOKEN")"
check "github proxy blocks PATCH on pulls list" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -H 'x-github-pat: dummy' \
  -d '{"method":"PATCH","path":"/repos/o/r/pulls"}' "$BASE/api/github?token=$TOKEN")"

echo ""
echo "=== E2E: Audit ==="
AUDIT=$(getq audit --data-urlencode "limit=50")
contains "audit records commit" '"action":"commit"' "$AUDIT"
contains "audit records repo add" '"action":"repo-add"' "$AUDIT"
check "audit rejects bad limit" "400" "$(getcode audit --data-urlencode "limit=abc")"

echo ""
echo "=== E2E: Data maintenance ==="
BEFORE_REPOS=$(getq repos | json 'len(d["repos"])')
check "storage lists the data directory" "200" "$(getcode storage)"
contains "storage reports config.json" 'config.json' "$(getq storage)"
check "audit log compacts" "200" "$(post maintenance/audit-rotate '{}')"
contains "audit records the rotate" '"action":"audit-rotate"' "$(getq audit --data-urlencode "limit=50")"
check "stale repositories prune" "200" "$(post maintenance/prune-repos '{}')"
check "repo list unchanged after prune" "$BEFORE_REPOS" "$(getq repos | json 'len(d["repos"])')"

echo ""
echo "=== E2E: Deregister ==="
check "remove repo B" "200" "$(post repos/remove "$(printf '{"repo":"%s"}' "$REPO_B")")"
check "repo list has five entries after removing B" "5" "$(getq repos | json 'len(d["repos"])')"
check "removed repo is gone" "False" "$(getq repos | json 'any("e2e-repo-b" in r for r in d["repos"])')"

echo ""
echo "=== E2E Results: $PASS passed, $FAIL failed, $TOTAL total ==="
exit $((FAIL > 0 ? 1 : 0))
