# Test repositories registry

Test repositories used by pr-helper-git (and its pr-helper predecessor) for
end-to-end and feature validation. These are **not** part of the product and
can be deleted on request.

## GitHub test repositories

Registered 2026-11-14 (user-directed inventory sweep; `hello-world` and
`checkpoint` were reviewed and are **not** test repositories — hello-world is
an archived private repo, checkpoint is unrelated).

| # | Repository | Visibility | Created | Purpose |
|---|------------|------------|---------|---------|
| 1 | [bayernjf/git-e2e-test](https://github.com/bayernjf/git-e2e-test) | Private | 2026-11-05 | **Primary E2E repo** (active): commit graph with forks/merge nodes, branches, tags, SSE auto-refresh, stage/commit/push, create/convert/merge pull requests. Also the candidate for the migration P2-1 live acceptance run. |
| 2 | [bayernjf/pr-helper-git-sync-test](https://github.com/bayernjf/pr-helper-git-sync-test) | Private | 2026-11-05 | "Temporary test repo for pr-helper-git client sync testing". No local clone. |
| 3 | [bayernjf/pr-helper-e2e-sandbox](https://github.com/bayernjf/pr-helper-e2e-sandbox) | Public | 2026-08-02 | "Public sandbox for PR Helper end-to-end workflow validation" (pr-helper era). |
| 4 | [bayernjf/pr-helper-e2e-sandbox-private](https://github.com/bayernjf/pr-helper-e2e-sandbox-private) | Private | 2026-08-11 | Private counterpart of #3 (pr-helper era). |
| 5 | [bayernjf/e2e-test-real](https://github.com/bayernjf/e2e-test-real) | Private | 2026-08-07 | pr-helper-era E2E repo. |
| 6 | [bayernjf/e2e-test](https://github.com/bayernjf/e2e-test) | Private | 2026-08-07 | pr-helper-era E2E repo. |
| 7 | [bayernjf/receipt-test](https://github.com/bayernjf/receipt-test) | Private | 2026-08-23 | Purpose unconfirmed — registered as a test repo pending the owner's review. |
| 8 | [bayernjf/aw-pr-dogfood](https://github.com/bayernjf/aw-pr-dogfood) | Private | 2026-09-01 | "Temporary dogfood target for agent-world tpl-release-pr (delete me)" — near-empty (1KB), registered 2026-11-14 on the owner's direction. |

Excluded from this registry (reviewed 2026-11-14): `hello-world` (archived
private repo, not a test fixture) and `checkpoint` (unrelated).

## Local test repositories

All live under `/Users/jiangfeng/000mycodes` and are also registered in the
product's repository list (`~/.pr-helper-git/config.json`).

| # | Local path | GitHub URL | Created | Visibility | Purpose |
|---|------------|------------|---------|------------|---------|
| 1 | `/Users/jiangfeng/000mycodes/git-e2e-test` | https://github.com/bayernjf/git-e2e-test | 2026-11-06 | Private | Full E2E: commit graph with forks/merge nodes, branches, tags, SSE auto-refresh, stage/commit/push, create/convert/merge pull requests |
| 2 | `/Users/jiangfeng/000mycodes/git-init-check` | — | 2026-11-06 | Local only | Verify `git init` route: folder created, .git present, auto-registered and selected (empty history) |
| 3 | `/Users/jiangfeng/000mycodes/Hello-World` | source: https://github.com/octocat/Hello-World (public) | 2026-11-06 | Public source | Verify `git clone` route: network clone with inferred folder name, auto-registered and selected |

Renamed on 2026-11-12 to drop the `2`: `git2-e2e-test` → `git-e2e-test` (the
GitHub repo was renamed too, so the old URL still redirects) and
`git2-init-check` → `git-init-check`.

## Deletion

`aw-pr-dogfood` carries the owner's own "(delete me)" note in its
description — deleting it is pre-approved whenever convenient.

Do not delete anything else from this list unless the user explicitly asks. When a
repository is removed, delete both:

1. the local directory (when one exists), and
2. the GitHub repository (`gh repo delete <owner>/<name> --yes`),

then remove its row from this table.
