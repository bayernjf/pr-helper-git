# Handoff — pr-helper-git2

A local Git GUI (GitKraken-like core) plus a lightweight GitHub PR control
tower (pr-helper-like core). Runs entirely on loopback; this project's own
repository is never pushed.

## Scope

- GitKraken-like: repo registry, commit graph, refs (branches/tags/stash),
  stage/unstage, commit, amend, checkout, branch create/rename/delete, merge,
  reset (soft/mixed/hard), fetch/pull/push, clone and init (three-mode add
  dialog), tag create/delete (lightweight + annotated), remote branch
  push/delete, stash, unified + split diff viewer, folder-tree working panel,
  commit graph search, paginated history (load more), right-click context
  menu, keyboard shortcuts, resizable work panel, responsive layout,
  error boundary, loading states, SSE live refresh, safe revert (new commit,
  merge commits rejected, auto-abort on conflict), add-to-.gitignore,
  push tag, history scope (all vs current branch), Cmd+K command palette,
  blob file viewer (working tree or any ref, binary detection, size cap),
  git blame (per-line author/commit, porcelain parser), git clean (dry-run
  preview then force-remove untracked, ignored files untouched), remote
  add/remove with name and URL validation, per-file history (follow a path
  across commits and jump to any revision), branch ahead/behind badges,
  stash patch viewer, copy commit hash, Escape to close every dialog,
  reference log (reflog) viewer, fetch with prune, stash with message and
  include-untracked, remote set-url editing, annotated tag details,
  two-reference comparison (ahead/behind commits and renamed-aware file
  diff with stats), branch set-upstream, remote rename, sidebar ref filter,
  ignore-whitespace diff toggle, merge strategies (default/no-ff/ff-only/
  squash) with a dedicated picker, smart remote-branch checkout that creates a
  tracking local branch (no detached HEAD), configurable diff context lines
  (--unified), empty commits (--allow-empty), and branch creation without
  switching (no-checkout), untracked-file diffs via `--no-index`, rebase
  state detection with continue/abort, and server-side author/message/date
  history filters, in-app audit log viewer (JSONL reader with success/failure
  markers, raw details, server-side text/outcome filters over the whole
  retained file and no-match empty state),
  in-app text-file editing with validated atomic saves
  (sensitive/NUL/1 MB guards), mtime-based stale-save rejection (409 with
  the draft preserved), audit log rotation (1.5 MB trigger, 1 MB / 10,000
  entry retention budget, atomic rewrite), and a 413 response for oversized
  request bodies with explicit keep-alive timeouts, per-hunk staging
  (server-side diff splice + `git apply --cached`, `MM` partial status,
  unstage via reverse apply), per-hunk discard (reverse apply to the
  working tree, index untouched), and editor keyboard shortcuts (Cmd/Ctrl+S
  save, Tab/Shift+Tab indent).
- pr-helper-like: PR board (open/merged/closed), per-user review state,
  create PR (incl. draft), draft → ready, PR detail with commits/files/checks,
  requested reviewers (view and request), issue comments (view, compose,
  inline edit and delete with confirmation, Cmd/Ctrl+Enter to post), review
  submission (comment/approve/request changes), merge PR
  (merge/squash/rebase), close/reopen, line-level review comments
  (inline composer on diff lines, RIGHT/LEFT side, outdated-comment group,
  threaded replies and edit/delete), and an editable PR description.
  PAT is stored only in the browser and proxied through the local server.
- Hardening: nosniff on every response, strict CSP and no-referrer on the
  HTML entry, no-store for HTML, immutable long caching for hashed assets.
- Explicitly out of scope: interactive rebase, cherry-pick, submodules,
  worktrees, GPG signing, GitHub App, webhooks, a database, web push, deploy
  gates, AI generation, in-app conflict resolution.

## TODO

- [x] Project scaffold, configs, git init
- [x] Server: security, git runner, config store
- [x] Server: git read/write routes
- [x] Server: GitHub proxy
- [x] Server: branch rename, tag create/delete, amend, remote branch routes
- [x] Server: file watcher + SSE live refresh
- [x] Client: app shell, design system and typed API client
- [x] Client: inline SVG icon set and portal context menu
- [x] Client: commit graph, lane layout and live refresh
- [x] Client: ref sidebar with collapsible groups and full actions
- [x] Client: work panel with folder tree, split diff and amend
- [x] Client: PR board with review state, draft and detail view
- [x] Client: GraphQL draft-ready and merge endpoints
- [x] Test repository created, pushed, E2E verified and registered
- [x] Unit tests, build verification, README, atomic commits
- [x] Robustness: error boundary and loading states
- [x] Server: clone, init and reset routes with input validation
- [x] Client: three-mode Open/Clone/Init add dialog
- [x] Client: commit graph search, load more and reset menu
- [x] UX: shortcuts, resizable work panel, PR labels, responsive layout
- [x] Server: revert route (merge guard, auto-abort), ignore, push tag, log scope
- [x] Client: revert menu and history scope toggle
- [x] Client: gitignore action and push tag menu
- [x] Client: PR requested reviewers view and request
- [x] UX: Cmd+K command palette with fuzzy filter and keyboard nav
- [x] Third iteration: tests, build, E2E, docs, atomic commits
- [x] Server: file content route (ref-aware, binary detection, size cap)
- [x] Server: blame porcelain parser with unit tests
- [x] Server: clean route (dry-run + force, ignored files protected)
- [x] Server: remote add/remove routes with name/URL validation
- [x] Client: FileViewer with content/blame toggle, wired to work panel and commit detail
- [x] Client: clean button and remote management modal
- [x] Client: PR issue comments list and composer
- [x] Fourth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: file-history and stash-show routes
- [x] Server: branch ahead/behind via upstream:track
- [x] Client: FileViewer history tab with revision jump
- [x] Client: ahead/behind badges, stash patch viewer, copy hash, Escape hook
- [x] Fifth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: reflog route and parser, tag-show route and parser
- [x] Server: fetch prune, stash include-untracked, remote set-url routes
- [x] Client: reflog modal and entry, stash options modal, remote URL editing
- [x] Client: annotated tag details, fetch prune/reflog commands
- [x] Sixth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: compare route (two refs, ahead/behind commits + numstat files)
- [x] Server: branch set-upstream, remote rename, diff ignore-whitespace
- [x] Client: CompareModal with commits/files tabs and toolbar entry
- [x] Client: set-upstream picker, remote rename, sidebar filter, whitespace toggle
- [x] Seventh iteration: tests, build, E2E, docs, atomic commits
- [x] Server: merge strategies (no-ff/ff-only/squash), checkout remote tracking
- [x] Server: diff context lines (--unified), empty commit, branch no-checkout
- [x] Client: MergeModal with strategy picker, API helpers for new params
- [x] Client: diff context selector, empty-commit toggle, no-checkout checkbox
- [x] Eighth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: force push (force/force-with-lease), pull rebase, merge abort
- [x] Server: remote tag deletion, forced tag creation
- [x] Client: force-push confirm, pull rebase, merge abort entry, tag actions and API helpers
- [x] Ninth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: revert merge with mainline (-m), grep, mv, rm, log pathspec
- [x] Client: grep modal, file rename/delete, path filter, revert merge, API helpers
- [x] Tenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: untracked diff (no-index), rebase state, rebase continue/abort, log filters
- [x] Server: GitHub reviews allowlist; client: review composer, LogFilterModal, rebase banner
- [x] Route-level HTTP tests (real server, temp repo, isolated PR_HELPER_HOME)
- [x] Eleventh iteration: tests, build, E2E, docs, atomic commits
- [x] Server: readAudit store helper, GET /api/audit; client AuditModal + entry points
- [x] Server: POST /api/save with validation and atomic rename; client edit mode
- [x] Server: PATCH/DELETE comment allowlist; client inline comment edit/delete
- [x] Server: nosniff/CSP/referrer-policy and differentiated cache policy
- [x] Component render tests (renderToString, mock app context)
- [x] Twelfth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: audit rotation constants and rotateAudit with byte/entry budget
- [x] Server: mtime on /api/file, expectedMtime 409 guard on /api/save
- [x] Server: 413 body-cap response with Connection: close, keep-alive tuning
- [x] Client: FileViewer 409 handling, AuditModal text/outcome filters
- [x] Route tests for audit rotation and save/mtime/413 behavior
- [x] Thirteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: q/outcome query params on /api/audit, filtering over full file
- [x] Client: AuditModal drives server filters with debounced text input
- [x] Route tests for server-side audit filtering
- [x] Follow-up: tests, build, E2E, docs, atomic commits
- [x] Server: splitFilePatch/buildHunkPatch helpers, POST /api/stage-hunk
- [x] Client: DiffView hunk stage/unstage actions wired through runAction
- [x] Server: GET/POST pulls/:n/comments GitHub allowlist entries
- [x] Client: PrFileReview with line anchors, inline composer, outdated group
- [x] Client: FileViewer Cmd/Ctrl+S and Tab/Shift+Tab keyboard handling
- [x] Fourteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: POST /api/discard-hunk, PATCH/DELETE pulls/comments/:cid allowlist
- [x] Client: DiffView discard hunk, PrFileReview reply/edit/delete
- [x] Client: PR description section with inline edit
- [x] Fifteenth iteration: tests, build, E2E, docs, atomic commits
- [x] Server: watcher filters lock/temp-object noise, exports isNoise
- [x] Client: CommitDetail effect keyed on hash, modal survives background refresh
- [x] Sixteenth iteration: watcher tests, full acceptance, docs, atomic commits
- [x] UI fixes: graph-row overflow, ref-badge horizontal scroll, no-wrap group heads and toolbar, repo-select text color
- [x] Client: commit graph keyboard navigation and listbox/option a11y with roving tabIndex
- [x] Client: global modal focus trap hook with focus return on close
- [x] Client: persistent per-repo UI preferences via localStorage (view, groups, panel height)
- [x] Server: /api/grep-all across every registered repository; client GlobalGrepModal
- [x] Server: /api/revert-batch (merge guard, oldest-first, abort on conflict); client multi-select batch bar
- [x] Client: pin local branches and sort by name or recent tip commit
- [x] Server: /api/commit-template (local/global, absolute home path); client message prefill
- [x] CI: GitHub Actions workflow running lint, test and build; resilient test timeouts
- [x] Client: aria-labels on icon-only controls, keyboard-shortcut help modal (? key)
- [x] Tooling: .nvmrc + engines pin, CI npm audit advisory, react-vendor chunk split
- [x] Server: cleanCommitMessage strips # comments on commit and amend (git strip mode)
- [x] Eighteenth iteration: full 115-test acceptance, build, docs, atomic commits

## Delivery notes

- Initial delivery: 16 atomic conventional commits on `main`; no git remote is
  configured and no push of this project was performed.
- Enhancement phase adds the features above; commits remain atomic conventional
  English commits authored by the configured user, with no co-author trailers.
- The initial suite held 47 Vitest tests (graph layout, formatting, security,
  git parsers, file tree, diff lines, review summaries, clone/folder
  validation, command palette fuzzy filter, blame porcelain parsing, reflog
  and tag-object parsing); later iterations added route-level HTTP tests,
  bringing the current total to 115 across 11 files, with CI running lint,
  test and build on every push and pull request.
- Fourth iteration E2E in the browser: FileViewer shows working-tree and
  committed files with line numbers, binary detection and a 1 MB cap; the
  blame tab renders per-line author/short-sha/content (200 lines); clean
  previews two untracked items in a confirm dialog then removes the file and
  directory, restoring a clean tree; the remote modal lists origin and an
  add/remove cycle ends with only origin configured; the PR comments block
  shows the empty state, composer and Cmd/Ctrl+Enter hint, enabling the
  post button only with text (no comment was actually posted). Security
  checks confirm sensitive-file masking, path-traversal rejection, invalid
  ref rejection and non-network remote URL rejection.
- Fourth iteration findings: a real `git blame --porcelain` header carries an
  optional fourth field (number of groups), so the parser regex must allow it;
  the read-only `/api/remotes` route was originally placed after the
  `if (method !== 'POST') return null` boundary and could never serve GET
  requests, so it was moved into the read section.
- Fifth iteration E2E in the browser: the sidebar shows a green ↑200 badge on
  main; the FileViewer history tab lists 200 commits for bulk.txt and clicking
  an entry reloads the blob at that revision (header and contents update);
  Escape closes the file viewer and the stash dialog; a temporary stash renders
  its patch with colored hunk/add lines and is dropped afterwards; the copy
  hash button shows the "Commit hash copied" toast. Input validation rejects
  path traversal and bad/overflow stash indices. No external side effects.
- Fifth iteration finding: a lazy-load effect that listed its own loading flag
  in the dependency array could cancel itself (setLoading re-runs the effect,
  which then returns early), leaving an eternal "Loading" state. The effect
  now keys only on the mode and inputs and manages cancellation locally.
- Sixth iteration E2E in the browser: the reference log modal renders 232
  entries in a four-column grid (index, short hash, action, description) and
  closes on Escape; the stash options modal accepts a message and an
  include-untracked toggle, and a real stash with the toggle captured both a
  modified tracked file and a new untracked file, leaving a clean tree (the
  probe stash was dropped afterwards); the annotated tag detail modal shows
  tagger, email, date, target object and the "First tagged release" message;
  the remote modal edits origin's URL inline, the change was verified with
  `git remote get-url` and then restored to the original SSH URL; the
  command palette "Fetch and prune" command ran with `prune: true` in the
  audit log. No external side effects.
- Sixth iteration finding: the reflog parser regex must match the literal
  `@{` separator (`(.+?)@\{(\d+)\}`); an earlier non-greedy pattern that
  omitted the `@` captured the `@` into the ref name.
- Seventh iteration E2E in the browser: the Compare modal auto-runs with
  base=main/head=feature/login and reports 2 head-only commits, 206
  base-only commits and 6 changed files, matching `git rev-list --count`
  and `git diff --numstat` exactly; the Commits and Files tabs both render
  with colored status letters and add/delete counts. The sidebar "Set
  upstream" picker sets feature/quick's tracking branch (verified via
  `git rev-parse --abbrev-ref ...@{upstream}`) and was unset afterwards;
  the remote modal renames origin inline (URL preserved) and was restored;
  the ref filter narrows local/remote/tag/stash groups in real time; the
  ignore-whitespace toggle collapses an inline-only whitespace diff to
  "No diff available". No external side effects, tree left clean.
- Seventh iteration finding: when `-w` makes a diff empty, DiffView returns
  the empty hint and unmounted its own toolbar, leaving no way to switch the
  toggle back. The whitespace toggle was lifted to a persistent WorkPanel
  control above DiffView so it stays actionable regardless of diff content.
- Git behavior note: `-w` ignores inline whitespace changes but not the
  addition/removal of whole blank lines (that needs `--ignore-blank-lines`);
  E2E uses an inline-space change to verify the toggle.
- Eighth iteration E2E in the browser: the Merge modal opens from a local
  branch's "Merge into current" menu and shows four strategy cards with
  titles and hints; choosing `--no-ff` on a branch with one independent
  commit produced a real two-parent merge commit on main (audit recorded
  strategy=no-ff), then the tree was reset and the branch removed. Clicking
  the remote `origin/feature/login` checked out the existing local
  `feature/login` branch rather than a detached HEAD (verified with
  `git branch --show-current` and a detached count of 0). The diff context
  selector changed the hunk header from `@@ -47,7` (default 3) to
  `@@ -50 +50` (0) and `@@ -40,21` (10); the Allow-empty toggle enabled a
  "Commit (empty)" button that created a commit with no file changes (reset
  afterwards); the New branch modal's "without switching" checkbox created
  a branch while staying on main (branch deleted afterwards). All probes
  were cleaned and the tree returned to main/343f1a9/clean.
- Eighth iteration finding: parsing the optional diff context query with
  `Number(query.get('context'))` misfired when the parameter was absent,
  because `Number(null) === 0`, so every default diff silently became
  `--unified=0`. The route now parses context only when the parameter is
  actually present (`query.get('context') !== null`) and falls back to the
  default for missing or invalid values.
- Third iteration E2E in the browser: command palette opens on Cmd+K, fuzzy
  filter narrows results, arrow/enter/escape work and a command switches views;
  history scope returns 213 (all) vs 209 (current) commits; revert rejects a
  merge with 400, reverts HEAD cleanly into a new commit, and auto-aborts a
  conflicting revert leaving a clean tree; gitignore adds once (duplicate is a
  no-op) and ignores the file; push tag rejects bad names and a missing remote
  without any external push. All temporary changes were reset/removed.
- Tooling finding: `scripts/dev.mjs` spawns the API server without `--watch`,
  so server-side edits require a dev restart; the client is hot-reloaded by
  Vite. The RefSidebar menu opens from the row's "more" button, not context
  menu; the commit graph menu does open on right-click.
- Second iteration E2E in the browser: error boundary panel, loading bar,
  init and clone (auto-registered), soft/hard reset semantics, search filter
  with result count, load-more paging (200 → 213, matching `git log --all`),
  view-switch and search shortcuts, Cmd+Enter commit, panel drag resize and
  minimum clamp. All destructive checks were reset back to the baseline
  afterwards.
- E2E was run against a real private repository through the browser: graph
  forks/merge nodes, SSE auto refresh, stage/commit/push, draft creation,
  in-app ready conversion and all three merge methods.
- Environment finding: in this environment the REST `pulls/:n/merge` and
  PATCH `draft:false` calls fail (404 / silently ignored); the server therefore
  performs both via GitHub GraphQL (`mergePullRequest`,
  `markPullRequestReadyForReview`).
- Test repository registry lives in `test-repos.md`; nothing there is deleted
  without an explicit request.
- Ninth iteration scope: force push (`--force` / `--force-with-lease`), pull
  rebase, merge abort, remote tag deletion and forced tag creation. Two
  pseudo-gaps were ruled out by reading the code: stash pop already exists
  (`/api/stash/apply` with `drop:true`, plus a menu item) and local branch
  push/set-upstream actions are already complete.
- Ninth iteration backend: `/api/push` accepts a whitelisted `force` mode
  (force / force-with-lease), both requiring `confirm:true` (else 400);
  unknown values are ignored and fall back to a normal push. `/api/pull`
  takes a `rebase` boolean (`pull --rebase` vs default `pull --no-edit`).
  New `/api/merge/abort` runs `git merge --abort`. `/api/tag/create`
  inserts `-f` for both annotated and lightweight tags. New
  `/api/tag/delete-remote` runs `push <remote> --delete <name>` with
  confirmation and remote-name validation. All audit entries record the
  new force/rebase fields.
- Ninth iteration E2E in the browser: Pull/Push render as split button
  groups with a caret; the Pull menu lists merge/rebase and the Push menu
  lists normal/lease/force. The two force items open distinct confirm
  dialogs (lease notes the safety check; force warns it can discard
  commits and recommends lease) and were cancelled, so no remote was
  rewritten. A conflicting merge auto-surfaced a red "Merge in progress"
  banner via SSE; clicking "Abort merge" restored the clean tree and the
  banner disappeared. The tag menu shows "Delete remote tag" with a
  confirm dialog (cancelled); the Create-tag modal has a "Force overwrite
  (-f)" checkbox. No console errors. The real success paths of force
  push and remote tag deletion were not triggered; their command forms
  were verified earlier with `--dry-run` and stale-lease rejection.
- Tag recovery note: verifying force-create temporarily repointed local
  `v0.1.0` from its original annotated object (c0e7dc2, peeled f2910c1)
  to the main HEAD; it was fully restored with
  `git fetch origin refs/tags/v0.1.0:refs/tags/v0.1.0 --force` and now
  matches the remote. All temporary branches (tmp-conflict, tmp-abort,
  tmp-pull-rebase, etc.) were deleted; the test repo returned to
  main/343f1a9/clean, ahead 200 / behind 2.
- Tenth iteration scope: revert a merge commit (`-m` mainline), repository
  content search (`git grep`), file rename/move (`git mv`), file delete
  (`git rm`/unlink) and commit-graph path filtering (`git log -- path`).
  All five were confirmed as real gaps by reading the code: the revert
  route hard-rejected merge commits, no grep route existed, file rows had
  only stage/unstage/view/ignore/discard actions, and the log route had no
  pathspec. None is on the excluded high-level feature list.
- Tenth iteration backend: `/api/revert` reads the parent count via
  `rev-list --parents -n 1`; for a merge it requires an integer
  `mainline` in 1..parentCount (missing/out-of-range -> 400) and inserts
  `-m <mainline>`, while ordinary commits keep the old behaviour. `/api/log`
  accepts an optional validated `path` and appends `-- <path>`. New GET
  `/api/grep` runs `grep -I -n --untracked <pattern> [-- path]`, parsing
  each line on the first two colons only (exit 1 = empty result). New
  POST `/api/mv` runs `git mv <from> <to>`. New POST `/api/rm` first
  checks `git ls-files`: tracked files use `git rm [-f]`, fully untracked
  files are unlinked after `resolveInside` (responses carry a `method`
  field). All write paths are audited.
- Tenth iteration defects found and fixed during E2E: (1) the porcelain
  v2 rename parser swapped the names — the real row is
  `R100 <new-path>\t<old-path>`, so the current path is the first token
  and `renamedFrom` the second; a unit test now covers it. (2) The SSE
  effect's dependency array omitted `logPath`, so a file-change refresh
  used the stale empty path and overwrote filtered results; `logPath` is
  now a dependency. (3) `git rm` cannot remove a fully untracked file
  even with `-f` ("pathspec did not match"), hence the git/unlink split
  above.
- Tenth iteration E2E in the browser: GrepModal returned grouped matches
  with line numbers and a clean empty state; the path filter narrowed the
  graph to one commit for `src/index.js` and 200 for `bulk.txt`, and
  cleared back to 200; the Rename modal performed a staged `git mv`
  (shown as `RM old -> new`); the Delete confirm removed both an untracked
  file (unlink) and a tracked file (staged `D`); right-clicking the merge
  opened RevertMergeModal with Parent 1/2 and produced
  `Revert "merge ui feature"`. No console errors. All temporary commits,
  branches and probes were removed; the test repo returned to
  main/343f1a9/clean.
- Eleventh iteration scope: untracked-file diff preview, rebase recovery
  (continue/abort plus state detection), server-side history filters,
  pull-request review submission and route-level HTTP tests. All five were
  confirmed as real gaps by reading the code: plain `git diff` returns
  nothing for untracked files, no rebase routes existed (the pull --rebase
  path could leave an unrecoverable rebase), the graph search only covered
  the loaded page, the GitHub allowlist had no POST reviews entry, and the
  48 existing tests covered no HTTP routes.
- Eleventh iteration backend: the git runner now supports per-call env and
  preserves stdout on non-zero exits. `/api/diff` detects untracked files
  via porcelain and runs `git diff --no-index -- /dev/null <file>` (exit 1
  is a valid diff), returning an `untracked` flag. `/api/status` adds a
  `state` object from `detectRepoState` (MERGE_HEAD, rebase-merge,
  rebase-apply). New `/api/rebase/continue` (GIT_EDITOR=true) and
  `/api/rebase/abort`. `/api/log` accepts validated `author`, `message`,
  `since`, `until` (ISO calendar dates only; bad values -> 400).
  `routes-github.mjs` allowlists POST `pulls/:n/reviews`. `store.mjs`
  honors a `PR_HELPER_HOME` override for test isolation.
- Eleventh iteration defects found and fixed during E2E: (1) the provider
  stored only the inner porcelain object and discarded the sibling
  `state` field, so no component could read rebase/merge state;
  loadRepoData now attaches `state` onto the stored status. (2) GitHub
  returns 404 on `requested-reviewers` when nobody is requested, and the
  Promise.all detail load rejected on the first failure, blanking every
  section; the modal now uses Promise.allSettled with per-endpoint
  fallbacks.
- Eleventh iteration E2E in the browser: an untracked file rendered its
  full no-index diff; the LogFilterModal with message "bulk commit 200"
  narrowed the graph to 1 of 1 and cleared back to 200; a real conflicted
  rebase showed the amber banner with Continue/Abort and Abort restored
  a clean main; a temporary PR (#4) was created, a COMMENT review was
  submitted (verified via API and rendered in the Reviews section), then
  the PR was closed, the remote branch deleted and the test repo reset to
  343f1a9. No console errors.
- Eleventh iteration verification: 77 Vitest tests passed across 9 files
  (including 29 route tests); `tsc --noEmit` was clean; `vite build`
  transformed 68 modules (JS 341.49 KB, CSS 39.06 KB).
- Twelfth iteration scope: audit log reading, in-app file editing/saving,
  PR comment edit/delete, security response headers and component render
  tests. All five were confirmed as real gaps by reading the code: the
  audit trail was write-only, FileViewer was read-only, comments could be
  posted but not changed, static responses carried no security or cache
  headers, and no component-level render test existed.
- Twelfth iteration backend: `store.mjs` adds `readAudit(limit)` which
  parses the JSONL (bad lines skipped, ENOENT -> empty) newest-first.
  New read-only `GET /api/audit` (limit 1..1000). New `POST /api/save`
  rejects sensitive paths, non-string content, NUL bytes and sizes over
  1 MB, then writes a sibling temp file and renames atomically; every
  save is audited. `routes-github.mjs` adds DELETE to the method set and
  allowlists PATCH/DELETE on `issues/comments/:cid`.
- Twelfth iteration defect found and fixed during E2E: GitHub locates a
  single issue comment at `/repos/:o/:r/issues/comments/:cid` (no issue
  number); the nested `issues/:n/comments/:cid` form returns 404 upstream.
  The allowlist and client paths were corrected to the flat form, and the
  audit trail records both the initial 404 probes and the final 200/204.
- Twelfth iteration E2E in the browser: the audit modal listed 200 of
  6855 entries with markers and raw details; an untracked scratch file
  was edited and saved (verified on disk and in the audit); a temporary
  PR (#5) was created, its first comment was edited inline and its
  second deleted through the confirm dialog, then the PR was closed, the
  remote branch deleted and the test repo reset to 343f1a9. Header
  checks over a production instance confirmed nosniff on every response,
  CSP/no-store on HTML and immutable caching on hashed assets.
- Current verification: 85 Vitest tests pass across 10 files (including 8
  new component render tests); `tsc --noEmit` is clean; `vite build`
  transforms 69 modules (JS 347.71 KB / gzip 101.15 KB, CSS 41.45 KB /
  gzip 7.59 KB). Dev server stopped; ports 5173, 4789 and 4791 are free;
  localStorage holds only `git2-active-repo`; the product work tree is
  otherwise clean.
- Post-iteration repository maintenance (user-confirmed): the
  git2-e2e-test divergence (ahead 200 bulk commits / behind 2 real
  commits from merged PR #3) was resolved with a non-destructive
  `--no-ff` merge of origin/main (no conflicts: bulk work only touched
  bulk.txt, the remote feature added src/settings.js) and pushed, so
  local main and origin/main now converge with no ahead/behind. Stale
  branches were cleaned up: feature/settings (merge commit), feature/quick
  (local-only, fully contained), and feature/login + feature/ui (squash
  merged via PRs #1/#2; final file contents proven identical to main)
  were deleted both locally and on the remote. The repo now has only
  main. Hello-World remains a clean octocat clone; git2-init-check
  remains an empty repo with no remote; this product repo deliberately
  stays without a remote.
- Thirteenth iteration scope: audit log retention/rotation, stale-save
  prevention via mtime, route-level tests for /api/audit and /api/save,
  and AuditModal filtering. All four were confirmed as real gaps by
  reading the code: the JSONL audit trail grew unbounded, concurrent
  saves could silently overwrite each other, neither route had dedicated
  tests, and the audit modal could not be narrowed.
- Thirteenth backend: `store.mjs` exports AUDIT_ROTATE_BYTES (1.5 MB),
  AUDIT_TARGET_BYTES (1 MB) and AUDIT_KEEP_ENTRIES (10,000); appendAudit
  stats after each write and calls rotateAudit when the trigger is crossed.
  rotateAudit parses valid lines, walks newest-first under both the byte
  budget and the entry cap, and atomically replaces the file via a temp
  rename; the result is always under the trigger so ordinary appends never
  re-rotate. `/api/file` returns `mtimeMs` for working-tree blobs (null
  for ref/masked views); `/api/save` accepts an optional finite
  `expectedMtime` and returns 409 when the current stat differs or the
  file vanished, with a successful save returning the new `mtimeMs`.
- Thirteenth defects found and fixed during testing: (1) oversized request
  bodies were destroyed inside readJsonBody, so clients saw a bare
  ECONNRESET; the parser now signals tooLarge and the server flushes a
  413 JSON response with `Connection: close` before destroying the socket,
  which also prevents the pooled keep-alive socket from being reused.
  (2) Default server keep-alive timing could race pooled clients; the
  server now sets keepAliveTimeout 60s and headersTimeout 65s.
- Thirteenth testing incident: an early version of the rotation test
  derived the audit path from the test process's configPaths(), but the
  vitest process had no PR_HELPER_HOME set, so it resolved to the real
  `~/.pr-helper-git2/audit.log`; the test's truncating writeFile replaced
  the existing 8,299-line audit history with synthetic seed lines, and no
  backup or local snapshot existed, so the prior audit history could not be
  recovered. The test now builds the audit path explicitly from the
  isolated server home directory, and the real audit log starts empty.
  No source code, credentials or repository data were affected; the loss
  is limited to the diagnostic audit trail.
- Thirteenth E2E in the browser: against a 30-entry seeded audit trail,
  the text filter narrowed the list to 6 stage entries, the failures
  selector to 4 entries all marked "!", the success selector to 26
  entries all marked "✓", and a combined no-match query rendered the
  empty state; the seed data was removed afterwards.
- Current verification: 93 Vitest tests pass across 10 files (37 route
  tests, including 8 new); `tsc --noEmit` is clean; `vite build`
  transforms 69 modules (JS 348.67 KB / gzip 101.47 KB, CSS 41.91 KB /
  gzip 7.63 KB). Dev server stopped; ports 5173 and 4789 are free; the
  real audit log is empty and accrues anew under the retention policy.
- Follow-up scope (server-side audit filtering): the client-side filter
  only covered the loaded 200-entry window, so older retained entries
  could never be matched. `/api/audit` now accepts `q` (trimmed,
  case-insensitive substring over the same action/summary fields the
  modal displays, capped at 100 chars) and `outcome` (`all`/`ok`/`fail`,
  invalid value -> 400); `readAudit` applies the filters over every
  retained entry before taking the limit window, so `total` reports the
  full match count across the file. The modal now requests up to 1,000
  rows, debounces text typing by 300 ms, and distinguishes "no records"
  from "no matches" based on whether filters are active.
- Follow-up E2E in the browser: against a 250-entry seeded file, the
  unfiltered modal rendered all 250 rows; `q=save` returned 25 matches
  with the request carrying `q=save`; `outcome=fail` returned 23 failures
  spread across the whole file (including entries beyond the old 200-row
  window), proving whole-file coverage; a combined no-match query showed
  the empty state. Seed data removed afterwards.
- Updated verification: 94 Vitest tests pass across 10 files (38 route
  tests); `tsc --noEmit` is clean; `vite build` transforms 69 modules
  (JS 348.65 KB / gzip 101.56 KB, CSS 41.91 KB / gzip 7.63 KB). Dev
  server stopped and ports free; the real audit log remains empty.
- Fourteenth scope: a fresh capability-gap audit (66 endpoints extracted
  from source, 20 keyword probes) confirmed three real gaps — missing
  editor keyboard shortcuts, no line-level review comments, and
  whole-file-only staging — while bisect/fsck/LFS/milestones/reactions
  and similar niche items were explicitly rejected.
- Fourteenth implementation: `splitFilePatch`/`buildHunkPatch` pure
  helpers in git.mjs split a single-file unified diff into its header
  and hunks; the new POST /api/stage-hunk regenerates the authoritative
  diff server side, splices the requested hunk and applies it to the
  index via `git apply --cached` (unstage uses `-R`), with index-range
  validation and audit entries. DiffView renders Stage/Unstage hunk
  buttons in the unified view and runs them through runAction so the
  data refresh keeps the diff pane in sync.
- Fourteenth review comments: the GitHub allowlist gains GET/POST
  pulls/:n/comments; the new PrFileReview component expands a PR file
  into its unified diff, anchors an inline composer to any line and
  posts the modern commit_id/path/line/side payload (RIGHT for
  adds/context, LEFT for deletions), grouping comments per line and
  collecting orphaned comments as outdated.
- Fourteenth E2E: browser verified two-hunk stage (index held only the
  second change, `MM` porcelain status), unstage back to a clean
  split, Tab/Shift+Tab indentation and Cmd+S save (editor closes,
  toast confirms). The inline-comment proxy was verified against the
  real API through a temporary PR: 201 for both RIGHT and LEFT
  comments, GET returned them; the PR, comments and branches were
  then deleted and scratch repos removed.
- Fourteenth verification: 99 Vitest tests pass across 10 files (39
  route tests, 5 new); `tsc --noEmit` is clean; `vite build`
  transforms 70 modules (JS 354.07 KB / gzip 103.11 KB, CSS 44.27 KB
  / gzip 8.00 KB). Dev server stopped and ports free; no scratch
  repositories remain registered.
- Fifteenth scope: a fresh audit of 67 endpoints found four real flow
  gaps — the PR body was never rendered, review comments could not be
  replied to or edited/deleted, and only whole-file discard existed;
  niche items (stash branch, check-run logs, suggested changes, syntax
  highlighting) were explicitly rejected.
- Fifteenth implementation: POST /api/discard-hunk reuses the diff
  splice and reverse-applies the chosen hunk to the working tree
  without touching the index; the GitHub allowlist adds PATCH/DELETE
  on the flat pulls/comments/:cid path. The review cards gain Reply
  (in_reply_to only), Edit (PATCH) and Delete (confirm dialog), and
  the modal gains a Description section with inline editing via
  PATCH pulls/:n.
- Fifteenth E2E: browser verified Discard hunk on a two-hunk change
  (first hunk restored, second remains, index stays clean). Through
  the local proxy against a temporary PR: top-level comment 201,
  threaded reply 201 with in_reply_to set, comment PATCH 200,
  description PATCH 200, comment DELETE 204 and a GET confirming
  zero comments remained. The PR, branches and scratch repos were
  removed afterwards.
- Fifteenth verification: 100 Vitest tests pass across 10 files (40
  route tests, one new); `tsc --noEmit` is clean; `vite build`
  transforms 70 modules (JS 353.98 KB / gzip 103.09 KB, CSS 44.27 KB
  / gzip 8.00 KB). Dev server stopped and ports free; no scratch
  repositories remain registered.
- Sixteenth scope: while preparing the product demo, the commit patch modal
  was observed opening and closing within ~200ms. Root cause: the recursive
  file watcher watches .git too, so transient index.lock create/delete pairs
  (from background git activity) broadcast repo-changed frames; the SSE
  handler reloaded the repo, recreating commit objects, and CommitDetail's
  effect, keyed on the commit object identity, reset the patch state.
- Sixteenth fix: watcher.mjs now exports isNoise and ignores .lock files,
  in-flight tmp_obj_* objects and node_modules/dist events while keeping
  meaningful HEAD/refs/index changes. CommitDetail keys its load effect on
  the selected hash and active repo instead of the commit object, so a
  background refresh that keeps the same commit no longer closes the modal.
- Sixteenth E2E: browser verified the patch modal now stays open and the
  SSE stream emits only the hello frame with no spurious repo-changed.
- Sixteenth verification: 106 Vitest tests pass across 11 files (new
  watcher.test.mjs with 6 isNoise cases); tsc clean; vite build transforms
  70 modules (JS 358.58 KB / gzip 103.96 KB, CSS 44.60 KB / gzip 8.06 KB).
  Note: overlapping vitest runs produced index.lock contention and flaky
  403 failures; ensure prior test runs have exited before rerunning.
- Seventeenth scope: a wide-viewport screenshot of the Hello-World graph
  showed several layout defects — commit rows pushed the trailing date off
  the right edge (hard-clipped), dense ref badges on the merge row crowded
  out the subject, and at narrow widths the sidebar group headers wrapped
  ("LOCAL/BRANCHES") while the top toolbar wrapped its "Pull Requests" label
  and overlapped the Git button.
- Seventeenth fix (styles.css only): .graph-row clips overflow and .graph-body
  gets width:100%/min-width:0 so the subject shrinks and ellipsizes while
  author/hash/date stay fixed and fully visible; .ref-badges becomes a
  self-scrolling strip (flex 0 1, hidden scrollbar) so badges never cover the
  subject; the top toolbar scrolls horizontally with nowrap labels instead of
  wrapping; the graph filter toolbar wraps cleanly; .ref-group-head is
  nowrap so section headers stay on one line.
- Seventeenth verification: browser measured zero row overflow at 1860, 1000
  and 786px (all dates visible), and at 600px the badge strip scrolls and the
  subject keeps a minimum width rather than being clipped mid-label. 106 Vitest
  tests pass across 11 files; tsc clean; vite build transforms 70 modules
  (JS 358.58 KB / gzip 103.96 KB, CSS 45.18 KB / gzip 8.16 KB).
