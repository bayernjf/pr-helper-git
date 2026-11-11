import { errorMessage } from '../lib/errors';
// Read-only phone layout, served at /m (or /?mobile=1). No staging, commit or
// push controls: the point is checking a repository from a phone, so everything
// here is big, single-column and read-only.
import { useEffect, useRef, useState } from 'react';
import {
  getCommitDiff,
  getDiff,
  getCommitFiles,
  getCommitSignature,
  getLog,
  getRepos,
  getStatus,
  type CommitFile,
  type CommitSignature,
} from '../api';
import { getPref, setPref } from '../lib/prefs';
import { formatFullDate, formatRelative, shortHash } from '../lib/format';
import { setLocale, t, useLocale } from '../i18n';
import type { Commit, ParsedStatus, RepoBrief, StatusFile } from '../types';
import { IconBranch, IconChevronRight, IconRefresh, IconX } from './icons';
import { Dropdown } from './Dropdown';

type Detail = {
  commit: Commit;
  files: CommitFile[] | null;
  signature: CommitSignature | null;
};

export default function MobileApp() {
  const locale = useLocale();
  const [repos, setRepos] = useState<RepoBrief[]>([]);
  const initial = new URLSearchParams(location.search);
  const pendingRepo = useRef(initial.get('repo'));
  const pendingCommit = useRef(initial.get('commit'));
  // Seed the state from ?repo= so StrictMode's double effect still loads the
  // linked repository; clearing a ref here would make the second pass fall back
  // to the previously remembered repo.
  const [repo, setRepo] = useState<string>(pendingRepo.current || getPref<string>('mobile.repo', ''));
  const [commits, setCommits] = useState<Commit[]>([]);
  const [status, setStatus] = useState<ParsedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [diff, setDiff] = useState<{ file: string; text: string; masked: boolean } | null>(null);
  const [work, setWork] = useState<{ file: StatusFile; text: string | null; masked: boolean } | null>(null);

  async function loadRepos() {
    try {
      const res = await getRepos();
      setRepos(res.repos);
      const chosen = repo && res.repos.some((r) => r.path === repo)
        ? repo
        : res.repos[0]?.path || '';
      if (chosen && chosen !== repo) setRepo(chosen);
      if (!chosen) setError(t('No repositories yet.'));
      return chosen;
    } catch (err) {
      setError(errorMessage(err) || String(err));
      return '';
    }
  }

  async function loadRepo(target: string) {
    if (!target) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [logRes, statusRes] = await Promise.all([
        getLog(target, 80, 'all'),
        getStatus(target).catch(() => null),
      ]);
      setCommits(logRes.commits);
      setStatus(statusRes?.status || null);
      const wantedCommit = pendingCommit.current;
      if (wantedCommit) {
        pendingCommit.current = null;
        const match = logRes.commits.find((c) => c.hash === wantedCommit || c.hash.startsWith(wantedCommit));
        if (match) await openCommit(match, target);
      }
    } catch (err) {
      setCommits([]);
      setStatus(null);
      setError(errorMessage(err) || String(err));
    } finally {
      setLoading(false);
    }
  }

  // First paint: pick the remembered repository (or the first one) and load it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chosen = await loadRepos();
      if (cancelled) return;
      if (chosen) {
        setPref('mobile.repo', chosen);
        await loadRepo(chosen);
      } else {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectRepo(next: string) {
    setRepo(next);
    setPref('mobile.repo', next);
    setDetail(null);
    setDiff(null);
    syncUrl(null, null);
    loadRepo(next);
  }

  async function openCommit(commit: Commit, targetRepo = repo) {
    setDetail({ commit, files: null, signature: null });
    setDiff(null);
    syncUrl(targetRepo, commit.hash);
    try {
      const [filesRes, sigRes] = await Promise.all([
        getCommitFiles(targetRepo, commit.hash).catch(() => ({ files: [] as CommitFile[] })),
        getCommitSignature(targetRepo, commit.hash).catch(() => null),
      ]);
      setDetail((current) => (current && current.commit.hash === commit.hash
        ? { commit, files: filesRes.files, signature: sigRes }
        : current));
    } catch {
      setDetail((current) => (current ? { ...current, files: [] } : current));
    }
  }

  function syncUrl(repoPath: string | null, hash: string | null): void {
    try {
      const url = new URL(location.href);
      if (repoPath && hash) {
        url.searchParams.set('repo', repoPath);
        url.searchParams.set('commit', hash);
      } else {
        url.searchParams.delete('repo');
        url.searchParams.delete('commit');
      }
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch { /* ignore */ }
  }

  async function openFile(file: CommitFile) {
    if (!detail) return;
    try {
      const res = await getCommitDiff(repo, detail.commit.hash, file.path);
      setDiff({ file: file.path, text: res.diff, masked: res.masked });
    } catch (err) {
      setDiff({ file: file.path, text: errorMessage(err) || String(err), masked: false });
    }
  }

  async function openWork(file: StatusFile) {
    setWork({ file, text: null, masked: false });
    try {
      const res = await getDiff(repo, file.path, file.area === 'staged');
      setWork({ file, text: res.diff, masked: res.masked });
    } catch (err) {
      setWork({ file, text: errorMessage(err) || String(err), masked: false });
    }
  }

  const dirty = status ? status.files.length : 0;
  const areaLabel = (area: StatusFile['area']) => (area === 'unmerged' ? t('unmerged') : t(area));

  return (
    <div className="m-app">
      <header className="m-header">
        <Dropdown
          className="m-repo-select"
          aria-label={t('Repository')}
          value={repo}
          onChange={selectRepo}
          options={
            repos.length === 0
              ? [{ value: '', label: t('No repositories yet.') }]
              : repos.map((r) => ({ value: r.path, label: r.name }))
          }
        />
        <button
          type="button"
          className="m-icon-btn"
          aria-label={t('Refresh')}
          title={t('Refresh')}
          onClick={() => loadRepo(repo)}
        >
          <IconRefresh width={18} height={18} />
        </button>
        <button
          type="button"
          className="m-icon-btn m-locale"
          title={t('Settings')}
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
        >
          {locale === 'zh' ? '中' : 'En'}
        </button>
      </header>

      <section className="m-status">
        <div className="m-branch">
          <IconBranch width={15} height={15} />
          <span>{status?.branch || t('detached HEAD')}</span>
          {status && status.ahead > 0 && <span className="m-ahead">↑{status.ahead}</span>}
          {status && status.behind > 0 && <span className="m-ahead">↓{status.behind}</span>}
        </div>
        <div className="m-chips">
          <span className="m-chip">{`${t('staged')} ${status?.files.filter((f) => f.area === 'staged').length ?? 0}`}</span>
          <span className="m-chip">{`${t('unstaged')} ${status?.files.filter((f) => f.area === 'unstaged').length ?? 0}`}</span>
          <span className="m-chip">{`${t('untracked')} ${status?.files.filter((f) => f.area === 'untracked').length ?? 0}`}</span>
          {status && dirty === 0 && <span className="m-chip m-clean">{t('Working tree clean')}</span>}
        </div>
        {status && dirty > 0 && (
          <div className="m-work">
            <div className="m-section-title">{t('Uncommitted changes')}</div>
            {status.files.map((file) => (
              <button
                key={`${file.area}:${file.path}`}
                type="button"
                className="m-file"
                onClick={() => openWork(file)}
              >
                <span className="m-file-status">{file.status}</span>
                <span className="m-file-path">{file.path}</span>
                <span className="m-file-area">{areaLabel(file.area)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="m-error">{error}</div>}
      {loading && <div className="m-empty">{t('Loading…')}</div>}

      {!loading && !error && (
        <main className="m-commits">
          <div className="m-section-title">{t('Recent commits')}</div>
          {commits.length === 0 && <div className="m-empty">{t('No commits yet.')}</div>}
          {commits.map((commit) => (
            <button
              key={commit.hash}
              type="button"
              className="m-commit"
              onClick={() => openCommit(commit)}
            >
              <span className="m-commit-subject">{commit.subject}</span>
              <span className="m-commit-meta">
                <span className="m-commit-hash">{shortHash(commit.hash)}</span>
                <span>{commit.authorName}</span>
                <span>{formatRelative(commit.date)}</span>
              </span>
              <IconChevronRight width={16} height={16} />
            </button>
          ))}
        </main>
      )}

      {detail && (
        <div className="m-sheet" role="dialog" aria-modal="true">
          <header className="m-sheet-header">
            <button type="button" className="m-icon-btn" aria-label={t('Close')} onClick={() => { setDetail(null); setDiff(null); syncUrl(null, null); }}>
              <IconX width={18} height={18} />
            </button>
            <span className="m-sheet-title">{shortHash(detail.commit.hash)}</span>
          </header>
          <div className="m-sheet-body">
            <div className="m-detail-subject">{detail.commit.subject}</div>
            <div className="m-detail-meta">
              <div><span>{t('Author')}</span><span>{`${detail.commit.authorName} <${detail.commit.authorEmail}>`}</span></div>
              <div><span>{t('Date')}</span><span>{formatFullDate(detail.commit.date)}</span></div>
              <div>
                <span>{t('Signature')}</span>
                <span>{detail.signature
                  ? (detail.signature.verified ? t('Verified') : `${detail.signature.status}${detail.signature.signer ? ` · ${detail.signature.signer}` : ''}`)
                  : '—'}</span>
              </div>
            </div>
            {detail.commit.body.trim() && <pre className="m-detail-body">{detail.commit.body}</pre>}

            <div className="m-section-title">{t('Files')}</div>
            {detail.files === null && <div className="m-empty">{t('Loading…')}</div>}
            {detail.files !== null && detail.files.length === 0 && <div className="m-empty">{t('No file changes.')}</div>}
            {detail.files?.map((file) => (
              <button
                key={file.path}
                type="button"
                className={`m-file${diff?.file === file.path ? ' m-file-active' : ''}`}
                onClick={() => openFile(file)}
              >
                <span className="m-file-status">{file.status}</span>
                <span className="m-file-path">{file.path}</span>
                <span className="m-file-stat"><span className="m-add">+{file.additions}</span><span className="m-del">-{file.deletions}</span></span>
              </button>
            ))}

            {diff && (
              <>
                <div className="m-section-title">{diff.file}</div>
                {diff.masked && <div className="m-error">{t('Sensitive file masked.')}</div>}
                <pre className="m-diff">{diff.text}</pre>
              </>
            )}
          </div>
        </div>
      )}

      {work && (
        <div className="m-sheet" role="dialog" aria-modal="true">
          <header className="m-sheet-header">
            <button type="button" className="m-icon-btn" aria-label={t('Close')} onClick={() => setWork(null)}>
              <IconX width={18} height={18} />
            </button>
            <span className="m-sheet-title">{work.file.path}</span>
          </header>
          <div className="m-sheet-body">
            <div className="m-detail-meta">
              <div><span>{t('Files')}</span><span>{`${work.file.status} · ${areaLabel(work.file.area)}`}</span></div>
            </div>
            {work.text === null && <div className="m-empty">{t('Loading…')}</div>}
            {work.text !== null && work.masked && <div className="m-error">{t('Sensitive file masked.')}</div>}
            {work.text !== null && <pre className="m-diff">{work.text}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}
