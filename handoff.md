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
  switching (no-checkout).
- pr-helper-like: PR board (open/merged/closed), per-user review state,
  create PR (incl. draft), draft → ready, PR detail with commits/files/checks,
  requested reviewers (view and request), issue comments (view and compose,
  Cmd/Ctrl+Enter to post), merge PR (merge/squash/rebase), close/reopen.
  PAT is stored only in the browser and proxied through the local server.
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

## Delivery notes

- Initial delivery: 16 atomic conventional commits on `main`; no git remote is
  configured and no push of this project was performed.
- Enhancement phase adds the features above; commits remain atomic conventional
  English commits authored by the configured user, with no co-author trailers.
- 47 Vitest tests pass (graph layout, formatting, security, git parsers, file
  tree, diff lines, review summaries, clone/folder validation, command palette
  fuzzy filter, blame porcelain parsing, reflog and tag-object parsing);
  `tsc --noEmit` and `vite build` (64 modules) are green.
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
