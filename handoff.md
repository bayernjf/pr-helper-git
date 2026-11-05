# Handoff — pr-helper-git2

A local Git GUI (GitKraken-like core) plus a lightweight GitHub PR control
tower (pr-helper-like core). Runs entirely on loopback; this project's own
repository is never pushed.

## Scope

- GitKraken-like: repo registry, commit graph, refs (branches/tags/stash),
  stage/unstage, commit, amend, checkout, branch create/rename/delete, merge,
  fetch/pull/push, tag create/delete (lightweight + annotated), remote branch
  push/delete, stash, unified + split diff viewer, folder-tree working panel,
  right-click context menu, SSE live refresh.
- pr-helper-like: PR board (open/merged/closed), per-user review state,
  create PR (incl. draft), draft → ready, PR detail with commits/files/checks,
  merge PR (merge/squash/rebase), close/reopen. PAT is stored only in the
  browser and proxied through the local server.
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

## Delivery notes

- Initial delivery: 16 atomic conventional commits on `main`; no git remote is
  configured and no push of this project was performed.
- Enhancement phase adds the features above; commits remain atomic conventional
  English commits authored by the configured user, with no co-author trailers.
- 34 Vitest tests pass (graph layout, formatting, security, git parsers, file
  tree, diff lines, review summaries); `tsc --noEmit` and `vite build` are green.
- E2E was run against a real private repository through the browser: graph
  forks/merge nodes, SSE auto refresh, stage/commit/push, draft creation,
  in-app ready conversion and all three merge methods.
- Environment finding: in this environment the REST `pulls/:n/merge` and
  PATCH `draft:false` calls fail (404 / silently ignored); the server therefore
  performs both via GitHub GraphQL (`mergePullRequest`,
  `markPullRequestReadyForReview`).
- Test repository registry lives in `test-repos.md`; nothing there is deleted
  without an explicit request.
