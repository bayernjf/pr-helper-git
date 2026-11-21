import { useEffect, useMemo, useState } from 'react';
import { fetchCiHealth } from '../api/ci-health';
import { usePreferences } from '../app-state/preferences-provider';
import { useAppToast } from '../app-state/toast';
import { errorMessage } from '../lib/errors';
import { relativeAge } from '../lib/repo-sort';
import { STORAGE_KEYS } from '../lib/storage-keys';
import type {
  CiFailureCategory,
  CiHealthPr,
  CiHealthReport,
  CiHealthRepo,
  CiHealthTotals,
} from '../types';
import { t } from '../i18n';
import { IconAlert, IconRefresh } from './icons';

const WINDOW_KEY = STORAGE_KEYS.ciHealthWindow;
const REPOS_KEY = STORAGE_KEYS.ciHealthRepos;

const CATEGORY_LABELS: Record<string, string> = {
  infra: 'Infrastructure / runner',
  timeout: 'Timeout / cancelled',
  auth: 'Permissions / auth',
  deploy: 'Deployment',
  deps: 'Dependencies',
  lint: 'Type / lint',
  tests: 'Tests',
  build: 'Build',
  unknown: 'Other / unclassified',
};

function readDays(): number {
  const raw = Number(localStorage.getItem(WINDOW_KEY));
  return raw === 7 || raw === 30 || raw === 90 ? raw : 30;
}

function readSelected(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPOS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function categoryLabel(id: string) {
  return t(CATEGORY_LABELS[id] || CATEGORY_LABELS.unknown);
}

function passRateText(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function postMergeText(state: CiHealthRepo['postMerge']['state']) {
  if (state === 'success') return t('Green');
  if (state === 'failure') return t('Failed');
  if (state === 'pending') return t('Pending');
  return t('No CI');
}

function prStateText(pr: CiHealthPr) {
  if (pr.state === 'OPEN') return pr.draft ? t('Draft') : t('Open');
  if (pr.merged) return t('Merged');
  return t('Closed');
}

function computeSummary(repos: CiHealthRepo[], failedPrs: CiHealthPr[]): {
  totals: CiHealthTotals;
  categories: CiFailureCategory[];
} {
  const passed = repos.reduce((sum, repo) => sum + repo.passed, 0);
  const failed = repos.reduce((sum, repo) => sum + repo.failed, 0);
  const prCount = repos.reduce((sum, repo) => sum + repo.prCount, 0);
  const pending = repos.reduce((sum, repo) => sum + repo.pending, 0);
  const blocked = repos.reduce((sum, repo) => sum + repo.blocked, 0);
  const decided = passed + failed;
  const counts = new Map<string, number>();
  for (const pr of failedPrs) {
    for (const check of pr.failedChecks) {
      counts.set(check.category, (counts.get(check.category) || 0) + 1);
    }
  }
  const totalChecks = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const categories = [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: categoryLabel(id),
      count,
      share: totalChecks ? Math.round((count / totalChecks) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return {
    totals: {
      prCount,
      passed,
      failed,
      pending,
      blocked,
      postMergeFailures: repos.filter((repo) => repo.postMerge.state === 'failure').length,
      reposWithPrs: repos.length,
      scannedRepos: 0,
      passRate: decided ? Math.round((passed / decided) * 1000) / 10 : null,
      failureRate: decided ? Math.round((failed / decided) * 1000) / 10 : null,
    },
    categories,
  };
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`ci-stat${tone ? ` is-${tone}` : ''}`}>
      <div className="ci-stat-label">{label}</div>
      <div className="ci-stat-value">{value}</div>
      {hint && <div className="ci-stat-hint">{hint}</div>}
    </div>
  );
}

export default function CiHealthPage() {
  const { pat, hasServerPat } = usePreferences();
  const toast = useAppToast();
  const [days, setDays] = useState<number>(readDays);
  const [selected, setSelected] = useState<string[]>(readSelected);
  const [data, setData] = useState<CiHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRepos, setShowRepos] = useState(false);

  useEffect(() => {
    if (!pat && !hasServerPat) return;
    let alive = true;
    setLoading(true);
    setError('');
    fetchCiHealth(pat, days, false)
      .then((report) => {
        if (alive) setData(report);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err) || 'CI health fetch failed');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days, pat, hasServerPat]);

  useEffect(() => {
    localStorage.setItem(WINDOW_KEY, String(days));
  }, [days]);

  useEffect(() => {
    localStorage.setItem(REPOS_KEY, JSON.stringify(selected));
  }, [selected]);

  function refresh() {
    if (!pat && !hasServerPat) return;
    setLoading(true);
    setError('');
    fetchCiHealth(pat, days, true)
      .then((report) => {
        setData(report);
        toast(t('CI health refreshed'), 'success');
      })
      .catch((err) => setError(errorMessage(err) || 'CI health fetch failed'))
      .finally(() => setLoading(false));
  }

  function toggleRepo(name: string) {
    setSelected((prev) => (
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    ));
  }

  function clearRepos() {
    setSelected([]);
  }

  const visibleRepos = useMemo(() => {
    if (!data) return [];
    if (!selected.length) return data.repos;
    return data.repos.filter((repo) => selected.includes(repo.repository));
  }, [data, selected]);

  const visibleFailed = useMemo(() => {
    if (!data) return [];
    if (!selected.length) return data.failedPrs;
    return data.failedPrs.filter((pr) => selected.includes(pr.repository));
  }, [data, selected]);

  const summary = useMemo(() => {
    if (!data) return null;
    return computeSummary(visibleRepos, visibleFailed);
  }, [data, visibleRepos, visibleFailed]);

  const authMissing = !pat && !hasServerPat;
  const totals = summary?.totals;
  const categories = summary?.categories || [];

  return (
    <div className="ci-page">
      <header className="ci-header">
        <div className="ci-header-copy">
          <h1>{t('CI Health')}</h1>
          <p>
            {t('PR-level CI pass rate across GitHub repositories owned by this account. Read-only; post-merge CI is reported separately.')}
          </p>
        </div>
        <div className="ci-header-actions">
          <select
            className="ci-select"
            aria-label={t('Time window')}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>{t('Last 7 days')}</option>
            <option value={30}>{t('Last 30 days')}</option>
            <option value={90}>{t('Last 90 days')}</option>
          </select>
          <button type="button" className="btn" onClick={refresh} disabled={loading || authMissing} aria-label={t("Refresh")}>
            <IconRefresh width={14} height={14} />
            {loading ? t('Scanning…') : t('Refresh')}
          </button>
        </div>
      </header>

      {data && (
        <div className="ci-meta">
          <button type="button" className="ci-scope-toggle" onClick={() => setShowRepos((value) => !value)}>
            {selected.length ? t('{count} repositories selected').replace('{count}', String(selected.length)) : t('All repositories')}
          </button>
          <span className="ci-meta-dot">·</span>
          <span>{t('{count} repositories scanned').replace('{count}', String(data.totals.scannedRepos))}</span>
          <span className="ci-meta-dot">·</span>
          <span>{t('Generated {time}').replace('{time}', relativeAge(data.generatedAt))}</span>
          {data.cached && <span className="ci-cached">{t('Cached')}</span>}
          {data.warnings.length > 0 && (
            <span className="ci-warning">
              <IconAlert width={13} height={13} />
              {t('{count} repositories skipped').replace('{count}', String(data.warnings.length))}
            </span>
          )}
        </div>
      )}

      {showRepos && data && (
        <section className="ci-repo-scope">
          <div className="ci-scope-head">
            <strong>{t('Repository scope')}</strong>
            <button type="button" className="link-btn" onClick={clearRepos}>
              {t('All repositories')}
            </button>
          </div>
          <div className="ci-repo-grid">
            {data.repos.map((repo) => (
              <label key={repo.repository} className="ci-repo-check">
                <input
                  type="checkbox"
                  checked={selected.includes(repo.repository)}
                  onChange={() => toggleRepo(repo.repository)}
                />
                <span>{repo.repository}</span>
                {repo.failed > 0 && <span className="ci-mini-bad">{repo.failed}</span>}
              </label>
            ))}
          </div>
        </section>
      )}

      {authMissing && (
        <div className="ci-empty">
          <h2>{t('GitHub token required')}</h2>
          <p>{t('Store a PAT in Settings, or keep one in the browser, to read private and public CI results.')}</p>
        </div>
      )}

      {!authMissing && loading && !data && (
        <div className="ci-empty">
          <span className="spinner" />
          <h2>{t('Scanning PR checks…')}</h2>
          <p>{t('The first scan can take up to a minute; later loads use a 10-minute cache.')}</p>
        </div>
      )}

      {!authMissing && error && !data && (
        <div className="ci-empty is-error">
          <h2>{t('Could not load CI health')}</h2>
          <p>{error}</p>
        </div>
      )}

      {!authMissing && data && !error && totals && totals.prCount > 0 && (
        <>
          <section className="ci-stats" aria-label={t('CI summary')}>
            <StatCard label={t('PRs with CI')} value={String(totals.prCount)} hint={t('Open and recently closed')} />
            <StatCard label={t('Final pass rate')} value={passRateText(totals.passRate)} hint={t('Turns green before merge')} tone="good" />
            <StatCard label={t('Passed')} value={String(totals.passed)} tone="good" />
            <StatCard label={t('Failed')} value={String(totals.failed)} tone="bad" />
            <StatCard label={t('Pending')} value={String(totals.pending)} tone="warn" />
            <StatCard label={t('CI-blocked open PRs')} value={String(totals.blocked)} tone={totals.blocked ? 'bad' : undefined} />
            <StatCard label={t('Post-merge CI failures')} value={String(totals.postMergeFailures)} hint={t('Default branch HEAD')} tone={totals.postMergeFailures ? 'bad' : undefined} />
          </section>

          {error && <div className="ci-inline-error">{error}</div>}

          <div className="ci-columns">
            <section className="ci-panel ci-repos-panel">
              <div className="ci-panel-head">
                <h2>{t('Repositories')}</h2>
                <span>{t('{count} with PRs').replace('{count}', String(visibleRepos.length))}</span>
              </div>
              <div className="ci-table-wrap">
                <table className="ci-table">
                  <thead>
                    <tr>
                      <th>{t('Repository')}</th>
                      <th>{t('PRs')}</th>
                      <th>{t('Passed')}</th>
                      <th>{t('Failed')}</th>
                      <th>{t('Open blocked')}</th>
                      <th>{t('Post-merge')}</th>
                      <th>{t('Pass rate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRepos.map((repo) => (
                      <tr key={repo.repository} className={repo.failed ? 'has-failure' : ''}>
                        <td>
                          <a href={`https://github.com/${repo.repository}`} target="_blank" rel="noreferrer">
                            {repo.repository}
                          </a>
                        </td>
                        <td>{repo.prCount}</td>
                        <td className="ci-good">{repo.passed}</td>
                        <td className={repo.failed ? 'ci-bad' : ''}>{repo.failed}</td>
                        <td className={repo.blocked ? 'ci-bad' : ''}>{repo.blocked || '—'}</td>
                        <td className={`ci-post ci-post-${repo.postMerge.state}`}>{postMergeText(repo.postMerge.state)}</td>
                        <td className="ci-rate">{passRateText(repo.passRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visibleRepos.length && <div className="ci-panel-empty">{t('No repository has CI results in this window.')}</div>}
            </section>

            <section className="ci-panel ci-reasons-panel">
              <div className="ci-panel-head">
                <h2>{t('Failure reasons')}</h2>
                <span>{t('Failed checks')}</span>
              </div>
              {!categories.length && <div className="ci-panel-empty">{t('No failed checks in this window.')}</div>}
              {categories.map((category) => (
                <div className="ci-reason" key={category.id}>
                  <div className="ci-reason-head">
                    <span>{categoryLabel(category.id)}</span>
                    <span>{category.count} · {category.share.toFixed(1)}%</span>
                  </div>
                  <div className="ci-bar">
                    <span style={{ width: `${Math.max(category.share, 2)}%` }} />
                  </div>
                </div>
              ))}
            </section>
          </div>

          <section className="ci-panel ci-failed-panel">
            <div className="ci-panel-head">
              <h2>{t('Failed PRs')}</h2>
              <span>{t('Click through to GitHub for the original run')}</span>
            </div>
            {!visibleFailed.length && <div className="ci-panel-empty">{t('Every PR with CI is green in this window.')}</div>}
            <div className="ci-failed-list">
              {visibleFailed.map((pr) => (
                <article className={`ci-failed-pr${pr.state === 'OPEN' ? ' is-open' : ''}`} key={`${pr.repository}#${pr.number}`}>
                  <div className="ci-failed-main">
                    <a href={pr.url} target="_blank" rel="noreferrer" className="ci-pr-link">
                      {pr.repository} #{pr.number}
                    </a>
                    <span className={`ci-pr-state is-${pr.state.toLowerCase()}`}>{prStateText(pr)}</span>
                    {pr.state === 'OPEN' && <span className="ci-blocked">{t('Blocked')}</span>}
                    <span className="ci-pr-title">{pr.title}</span>
                  </div>
                  <div className="ci-failed-checks">
                    {pr.failedChecks.map((check) => (
                      <span className="ci-check-chip" key={`${check.name}-${check.state}`}>
                        {check.name}
                        <em>{categoryLabel(check.category)}</em>
                      </span>
                    ))}
                  </div>
                  <div className="ci-pr-meta">
                    {t('Updated {time}').replace('{time}', relativeAge(pr.updatedAt))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="ci-note">
            {t('Definition: a PR counts once per head SHA and is green only when every completed check is successful. Pending checks are reported separately; post-merge push CI is not included in the PR denominator.')}
          </div>
        </>
      )}

      {!authMissing && data && !loading && totals && !totals.prCount && (
        <div className="ci-empty">
          <h2>{t('No PR CI in this window')}</h2>
          <p>{t('Try a longer window, or confirm the repositories have Actions/check runs enabled.')}</p>
        </div>
      )}
    </div>
  );
}
