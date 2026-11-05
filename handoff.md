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
  push tag, history scope (all vs current branch), Cmd+K command palette.
- pr-helper-like: PR board (open/merged/closed), per-user review state,
  create PR (incl. draft), draft → ready, PR detail with commits/files/checks,
  requested reviewers (view and request), merge PR (merge/squash/rebase),
  close/reopen. PAT is stored only in the browser and proxied through the
  local server.
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

## Delivery notes

- Initial delivery: 16 atomic conventional commits on `main`; no git remote is
  configured and no push of this project was performed.
- Enhancement phase adds the features above; commits remain atomic conventional
  English commits authored by the configured user, with no co-author trailers.
- 42 Vitest tests pass (graph layout, formatting, security, git parsers, file
  tree, diff lines, review summaries, clone/folder validation, command palette
  fuzzy filter); `tsc --noEmit` and `vite build` are green.
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
