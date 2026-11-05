# Test repositories registry

Temporary repositories created for end-to-end testing of pr-helper-git2.
These are **not** part of the product and can be deleted on request.

| # | Local path | GitHub URL | Created | Visibility | Purpose |
|---|------------|------------|---------|------------|---------|
| 1 | `/Users/jiangfeng/000mycodes/git2-e2e-test` | https://github.com/bayernjf/git2-e2e-test | 2026-11-06 | Private | Full E2E: commit graph with forks/merge nodes, branches, tags, SSE auto-refresh, stage/commit/push, create/convert/merge pull requests |

## Deletion

Do not delete anything from this list unless the user explicitly asks. When a
repository is removed, delete both:

1. the local directory, and
2. the GitHub repository (`gh repo delete <owner>/<name> --yes`),

then remove its row from this table.
