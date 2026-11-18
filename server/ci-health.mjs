// Read-only PR CI health aggregation for pr-helper-git.
//
// The production pr-helper automation engine is deliberately NOT involved:
// this module scans the GitHub repositories the instance owner can access,
// derives PR-level check results from GitHub GraphQL, and returns an
// explainable snapshot for the CI Health page. It never writes to GitHub and
// never persists tokens or full CI logs.

import { loadConfig } from './store.mjs';
import { serverPatFrom } from './pat.mjs';
import { fail, ok } from './http.mjs';

const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = `${GITHUB_API}/graphql`;
const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 10 * 60_000;
const GRAPHQL_CONCURRENCY = 8;
const PR_LIMIT = 100;
const CONTEXT_LIMIT = 100;

const CHECK_CONTEXT_FIELDS = `
  contexts(first: ${CONTEXT_LIMIT}) {
    nodes {
      __typename
      ... on CheckRun {
        name
        status
        conclusion
        title
        detailsUrl
      }
      ... on StatusContext {
        context
        state
        description
        targetUrl
      }
    }
  }
`;

const REPOSITORY_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    defaultBranchRef {
      name
      target {
        ... on Commit {
          oid
          statusCheckRollup {
            state
            ${CHECK_CONTEXT_FIELDS}
          }
        }
      }
    }
    pullRequests(first: ${PR_LIMIT}, orderBy: {field: UPDATED_AT, direction: DESC}, states: [OPEN, CLOSED, MERGED]) {
      nodes {
        number
        title
        state
        merged
        mergedAt
        createdAt
        updatedAt
        url
        isDraft
        headRefOid
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                ${CHECK_CONTEXT_FIELDS}
              }
            }
          }
        }
      }
    }
  }
}`;

const FAILURE_STATES = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
]);
const PENDING_STATES = new Set([
  'PENDING',
  'EXPECTED',
  'IN_PROGRESS',
  'QUEUED',
  'WAITING',
  'REQUESTED',
]);
const PASS_STATES = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

const FAILURE_CATEGORIES = [
  { id: 'infra', label: '基础设施 / runner', patterns: [/runner|no runner|offline|infrastructure|queue|self-hosted|no online/i] },
  { id: 'timeout', label: '超时 / 取消', patterns: [/timed out|timeout|cancelled|canceled/i] },
  { id: 'auth', label: '权限 / 认证', patterns: [/permission|forbidden|unauthorized|401|403|token|credential|secret/i] },
  { id: 'deploy', label: '部署', patterns: [/deploy|vercel|cloudflare|pages|release/i] },
  { id: 'deps', label: '依赖安装', patterns: [/install|dependency|dependencies|lockfile|npm ci|pnpm|yarn/i] },
  { id: 'lint', label: '类型 / Lint', patterns: [/lint|typecheck|type check|tsc|eslint|prettier|format/i] },
  { id: 'tests', label: '测试', patterns: [/test|vitest|jest|spec|assert|quality/i] },
  { id: 'build', label: '构建', patterns: [/build|compile|bundle|vite|webpack|rollup|desktop|dmg|swift|native/i] },
];

let cache = null;

/** Test hook: drop the in-memory snapshot. */
export function resetCiHealthCache() {
  cache = null;
}

/** Clamp the dashboard window to the values the UI exposes. */
export function normalizeWindowDays(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 30;
  if (parsed <= 7) return 7;
  if (parsed <= 30) return 30;
  return 90;
}

/** Human-readable category for a failed check name/title/description. */
export function classifyFailure(text) {
  const haystack = String(text || '').trim();
  if (!haystack) return 'unknown';
  for (const category of FAILURE_CATEGORIES) {
    if (category.patterns.some((pattern) => pattern.test(haystack))) return category.id;
  }
  return 'unknown';
}

export function failureCategoryLabel(id) {
  return FAILURE_CATEGORIES.find((category) => category.id === id)?.label || '其他 / 未分类';
}

function contextName(context) {
  return String(
    context?.__typename === 'StatusContext' ? context.context : context?.name || '',
  ).trim();
}

function contextState(context) {
  if (!context) return 'PENDING';
  if (context.__typename === 'StatusContext') return String(context.state || 'PENDING').toUpperCase();
  if (context.conclusion) return String(context.conclusion).toUpperCase();
  // A check-run without a conclusion has not completed yet.
  return String(context.status || 'PENDING').toUpperCase();
}

function contextUrl(context) {
  return context?.detailsUrl || context?.targetUrl || '';
}

function contextDetail(context) {
  if (!context) return '';
  return String(
    context.__typename === 'StatusContext'
      ? context.description || ''
      : context.title || '',
  ).trim();
}

function normalizeContext(context) {
  return {
    name: contextName(context),
    state: contextState(context),
    detail: contextDetail(context),
    url: contextUrl(context),
  };
}

/**
 * Highest-severity result per check name. GitHub can return duplicate check
 * runs for the same name (for example a workflow and a reusable workflow); a
 * single failed one still means the PR is red.
 */
function dedupeContexts(nodes) {
  const byName = new Map();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const normalized = normalizeContext(node);
    if (!normalized.name) continue;
    const previous = byName.get(normalized.name);
    if (!previous) {
      byName.set(normalized.name, normalized);
      continue;
    }
    const rank = (state) => (FAILURE_STATES.has(state) ? 3 : PENDING_STATES.has(state) ? 2 : 1);
    if (rank(normalized.state) > rank(previous.state)) {
      byName.set(normalized.name, { ...normalized, detail: normalized.detail || previous.detail, url: normalized.url || previous.url });
    } else if (!previous.detail && normalized.detail) {
      previous.detail = normalized.detail;
    }
  }
  return [...byName.values()];
}

function rollupState(rollup) {
  if (!rollup) return 'none';
  const contexts = dedupeContexts(rollup.contexts?.nodes);
  const failed = contexts.filter((context) => FAILURE_STATES.has(context.state));
  const pending = contexts.filter((context) => PENDING_STATES.has(context.state) || !PASS_STATES.has(context.state));
  if (failed.length) return 'failure';
  if (pending.length) return 'pending';
  if (contexts.length) return 'success';
  const state = String(rollup.state || '').toUpperCase();
  if (state === 'SUCCESS') return 'success';
  if (FAILURE_STATES.has(state)) return 'failure';
  if (PENDING_STATES.has(state) || state === 'EXPECTED') return 'pending';
  return 'none';
}

/**
 * @param {unknown} rollup
 */
export function summarizeRollup(rollup) {
  if (!rollup || typeof rollup !== 'object') {
    return { state: 'none', failed: [], total: 0 };
  }
  const contexts = dedupeContexts(/** @type {any} */ (rollup).contexts?.nodes);
  const failed = contexts
    .filter((context) => FAILURE_STATES.has(context.state))
    .map((context) => ({
      ...context,
      category: classifyFailure(`${context.name} ${context.detail}`),
    }));
  return {
    state: rollupState(/** @type {any} */ (rollup)),
    failed,
    total: contexts.length,
  };
}

function percent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function prCreatedInWindow(pr, cutoff) {
  const created = Date.parse(String(pr?.createdAt || ''));
  return Number.isFinite(created) && created >= cutoff;
}

/**
 * Pure aggregation used by the server route and unit tests.
 *
 * @param {{
 *   repoGraphs: Array<any>,
 *   days: number,
 *   now?: number,
 *   scannedRepos?: number,
 *   warnings?: string[],
 * }} input
 */
export function buildCiHealth(input) {
  const now = Number(input.now) || Date.now();
  const days = normalizeWindowDays(input.days);
  const cutoff = now - days * 86_400_000;
  const warnings = Array.isArray(input.warnings) ? [...input.warnings] : [];
  const repos = [];
  const failedPrs = [];
  const categoryCounts = new Map();

  for (const graph of input.repoGraphs) {
    const repository = String(graph?.repository || '');
    if (!repository) continue;
    const rows = Array.isArray(graph?.pullRequests) ? graph.pullRequests : [];
    const included = [];
    for (const pr of rows) {
      if (!pr) continue;
      const state = String(pr.state || '').toUpperCase();
      // Current open PRs are always relevant; closed/merged PRs count only
      // when they were opened inside the selected window.
      if (state !== 'OPEN' && !prCreatedInWindow(pr, cutoff)) continue;
      const rollup = pr?.commits?.[0]?.statusCheckRollup || null;
      const summary = summarizeRollup(rollup);
      if (summary.total === 0) continue;
      const item = {
        repository,
        number: Number(pr.number) || 0,
        title: String(pr.title || ''),
        state,
        merged: Boolean(pr.merged),
        mergedAt: pr.mergedAt || null,
        createdAt: pr.createdAt || null,
        updatedAt: pr.updatedAt || null,
        url: String(pr.url || ''),
        draft: Boolean(pr.isDraft),
        headSha: String(pr.headRefOid || ''),
        ciState: summary.state,
        failedChecks: summary.failed,
      };
      included.push(item);
      if (item.ciState === 'failure') {
        failedPrs.push(item);
        for (const failed of item.failedChecks) {
          categoryCounts.set(failed.category, (categoryCounts.get(failed.category) || 0) + 1);
        }
      }
    }

    if (!included.length) continue;
    const passed = included.filter((pr) => pr.ciState === 'success').length;
    const failed = included.filter((pr) => pr.ciState === 'failure').length;
    const pending = included.filter((pr) => pr.ciState === 'pending').length;
    const blocked = included.filter((pr) => pr.state === 'OPEN' && pr.ciState === 'failure').length;
    const decided = passed + failed;
    const postMerge = summarizeRollup(graph?.defaultBranchRollup);
    repos.push({
      repository,
      defaultBranch: String(graph?.defaultBranch || 'main'),
      defaultBranchSha: String(graph?.defaultBranchSha || ''),
      prCount: included.length,
      passed,
      failed,
      pending,
      blocked,
      passRate: percent(passed, decided),
      failureRate: percent(failed, decided),
      postMerge: {
        state: postMerge.state,
        sha: String(graph?.defaultBranchSha || ''),
        failedChecks: postMerge.failed,
      },
      topCategories: [...new Set(included.flatMap((pr) => pr.failedChecks.map((f) => f.category)))],
    });
  }

  failedPrs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  repos.sort((a, b) => b.failed - a.failed || b.prCount - a.prCount || a.repository.localeCompare(b.repository));

  const totals = {
    prCount: repos.reduce((sum, repo) => sum + repo.prCount, 0),
    passed: repos.reduce((sum, repo) => sum + repo.passed, 0),
    failed: repos.reduce((sum, repo) => sum + repo.failed, 0),
    pending: repos.reduce((sum, repo) => sum + repo.pending, 0),
    blocked: repos.reduce((sum, repo) => sum + repo.blocked, 0),
    postMergeFailures: repos.filter((repo) => repo.postMerge.state === 'failure').length,
    reposWithPrs: repos.length,
    scannedRepos: Number(input.scannedRepos) || repos.length,
  };
  totals.passRate = percent(totals.passed, totals.passed + totals.failed);
  totals.failureRate = percent(totals.failed, totals.passed + totals.failed);

  const failureCategories = [...categoryCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: failureCategoryLabel(id),
      count,
      share: percent(count, [...categoryCounts.values()].reduce((sum, value) => sum + value, 0)) || 0,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays: days,
    scope: 'github-owner',
    prLimitPerRepo: PR_LIMIT,
    totals,
    repos,
    failedPrs: failedPrs.slice(0, 200),
    failureCategories,
    warnings,
  };
}

async function requestJson(url, pat, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'user-agent': 'pr-helper-git',
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || `GitHub ${response.status}`;
      /** @type {Error & {status?: number}} */
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('GitHub request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function graphql(pat, query, variables) {
  const payload = await requestJson(GITHUB_GRAPHQL, pat, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors.map((entry) => entry.message).join('; '));
  }
  return payload?.data;
}

async function ownerRepositories(pat) {
  const repos = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await requestJson(
      `${GITHUB_API}/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed&direction=desc`,
      pat,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos
    .filter((repo) => repo && !repo.archived && !repo.fork && !repo.disabled)
    .map((repo) => ({
      fullName: String(repo.full_name || ''),
      defaultBranch: String(repo.default_branch || 'main'),
      pushedAt: String(repo.pushed_at || ''),
      openIssues: Number(repo.open_issues_count || 0),
    }))
    .filter((repo) => repo.fullName.includes('/'));
}

function graphForRepo(pat, fullName) {
  const [owner, name] = fullName.split('/');
  return graphql(pat, REPOSITORY_QUERY, { owner, name }).then((data) => {
    const repo = data?.repository;
    if (!repo) return null;
    const prs = Array.isArray(repo.pullRequests?.nodes) ? repo.pullRequests.nodes : [];
    return {
      repository: String(repo.nameWithOwner || fullName),
      defaultBranch: String(repo.defaultBranchRef?.name || 'main'),
      defaultBranchSha: String(repo.defaultBranchRef?.target?.oid || ''),
      defaultBranchRollup: repo.defaultBranchRef?.target?.statusCheckRollup || null,
      pullRequests: prs.map((pr) => ({
        ...pr,
        commits: Array.isArray(pr?.commits?.nodes)
          ? pr.commits.nodes.map((node) => node?.commit).filter(Boolean)
          : [],
      })),
    };
  });
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

/**
 * Live collection. The caller owns the PAT and must never log it.
 */
export async function collectCiHealth(pat, days, now = Date.now()) {
  const repos = await ownerRepositories(pat);
  const cutoff = now - normalizeWindowDays(days) * 86_400_000 - 7 * 86_400_000;
  const candidates = repos.filter((repo) => {
    const pushed = Date.parse(repo.pushedAt);
    return (Number.isFinite(pushed) && pushed >= cutoff) || repo.openIssues > 0;
  });
  const warnings = [];
  const graphs = [];
  await mapLimit(candidates, GRAPHQL_CONCURRENCY, async (repo) => {
    try {
      const graph = await graphForRepo(pat, repo.fullName);
      if (graph) graphs.push(graph);
    } catch (error) {
      warnings.push(`${repo.fullName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return buildCiHealth({
    repoGraphs: graphs,
    days,
    now,
    scannedRepos: candidates.length,
    warnings,
  });
}

async function resolvePat(headers, identity) {
  const header = String(headers?.['x-github-pat'] || '').trim();
  if (header) return header;
  if (identity?.role !== 'admin') return '';
  return serverPatFrom(await loadConfig());
}

/**
 * GET /api/ci-health?days=30[&refresh=1]
 *
 * @returns {Promise<{status:number,json:any}|null>}
 */
export async function handleCiHealthRoute({ method, pathname, query, headers, identity }) {
  if (pathname !== '/api/ci-health' || method !== 'GET') return null;
  const pat = await resolvePat(headers, identity);
  if (!pat) return fail(401, 'missing GitHub token');

  const days = normalizeWindowDays(query.get('days'));
  const refresh = query.get('refresh') === '1';
  if (!refresh && cache && cache.days === days && Date.now() - cache.at < CACHE_TTL_MS) {
    return ok({ ...cache.data, cached: true });
  }

  try {
    const data = await collectCiHealth(pat, days);
    cache = { at: Date.now(), days, data };
    return ok({ ...data, cached: false });
  } catch (error) {
    const status = Number(error?.status) || 502;
    return fail(status, 'ci health fetch failed', error instanceof Error ? error.message : String(error));
  }
}
