# Test repositories registry

Temporary repositories created for end-to-end testing of pr-helper-git.
These are **not** part of the product and can be deleted on request.

| # | Local path | GitHub URL | Created | Visibility | Purpose |
|---|------------|------------|---------|------------|---------|
| 1 | `/Users/jiangfeng/000mycodes/git-e2e-test` | https://github.com/bayernjf/git-e2e-test | 2026-11-06 | Private | Full E2E: commit graph with forks/merge nodes, branches, tags, SSE auto-refresh, stage/commit/push, create/convert/merge pull requests |
| 2 | `/Users/jiangfeng/000mycodes/git-init-check` | — | 2026-11-06 | Local only | Verify `git init` route: folder created, .git present, auto-registered and selected (empty history) |
| 3 | `/Users/jiangfeng/000mycodes/Hello-World` | source: https://github.com/octocat/Hello-World (public) | 2026-11-06 | Public source | Verify `git clone` route: network clone with inferred folder name, auto-registered and selected |

Renamed on 2026-11-12 to drop the `2`: `git2-e2e-test` → `git-e2e-test` (the
GitHub repo was renamed too, so the old URL still redirects) and
`git2-init-check` → `git-init-check`.

## Deletion

Do not delete anything from this list unless the user explicitly asks. When a
repository is removed, delete both:

1. the local directory, and
2. the GitHub repository (`gh repo delete <owner>/<name> --yes`),

then remove its row from this table.
