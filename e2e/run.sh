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
  if echo "$haystack" | grep -q "$needle"; then
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

LOG=$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "count=5")
contains "log has newest commit" "commit 3" "$LOG"
check "log has 3 commits" "3" "$(echo "$LOG" | json 'len(d["commits"])')"

REFS=$(getq refs --data-urlencode "repo=$REPO_A")
contains "refs list main" "main" "$REFS"
contains "refs list origin/main" "origin/main" "$REFS"

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
contains "undo removed commit from history" "commit 3" "$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "count=1")"
check "stage-all" "200" "$(post stage-all "$(printf '{"repo":"%s"}' "$REPO_A")")"
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
contains "merge commit present" "Merge" "$(getq log --data-urlencode "repo=$REPO_A" --data-urlencode "count=1")"

echo ""
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
echo "=== E2E: Deregister ==="
check "remove repo B" "200" "$(post repos/remove "$(printf '{"repo":"%s"}' "$REPO_B")")"
check "repo list has 1 entry" "1" "$(getq repos | json 'len(d["repos"])')"

echo ""
echo "=== E2E Results: $PASS passed, $FAIL failed, $TOTAL total ==="
exit $((FAIL > 0 ? 1 : 0))
