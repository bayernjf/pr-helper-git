# Handoff — pr-helper-git2

A local Git GUI (GitKraken-like core) plus a lightweight GitHub PR control
tower (pr-helper-like core). Runs entirely on loopback; no GitHub push is
performed by this project's setup.

## Scope

- GitKraken-like: repo registry, commit graph, refs (branches/tags/stash),
  stage/unstage, commit, checkout, branch create/delete, merge, fetch/pull/push,
  stash, diff viewer.
- pr-helper-like: PR board (open/merged/closed), create PR, PR detail with
  checks, merge PR (merge/squash/rebase), close/reopen. PAT is stored only in
  the browser and proxied through the local server.
- Explicitly out of scope: interactive rebase, cherry-pick, submodules,
  worktrees, GPG signing, GitHub App, webhooks, Supabase, web push, deploy
  gates, AI generation, in-app conflict resolution.

## TODO

- [x] Project scaffold, configs, git init
- [x] Server: security, git runner, config store
- [x] Server: git read/write routes
- [x] Server: GitHub proxy
- [x] Client: app shell and API client
- [ ] Client: commit graph and lane layout
- [x] Client: ref sidebar and branch actions
- [ ] Client: work panel, diff, commit
- [x] Client: PR board, create, merge
- [x] Tests, build verification, README, atomic commits
