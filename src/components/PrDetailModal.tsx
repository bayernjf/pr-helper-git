import { errorMessage, errorDetail, errorStatus } from '../lib/errors';
import { useEffect, useState } from 'react';
import { checkoutPrHead, githubProxy, markReadyForReview, mergePull } from '../api';
import { useApp } from '../app-state';
import { useEscape } from '../hooks/use-escape';
import { formatFullDate, shortHash } from '../lib/format';
import type { CheckRun, PullRequest } from '../types';
import {
  IconExternal,
  IconX,
} from './icons';
import type { PrFile, ReviewComment } from './PrFileReview';
import {
  ChecksSection,
  CommentsSection,
  CommitsSection,
  DescriptionSection,
  FilesSection,
  LabelsSection,
  MergeSection,
  ReviewersSection,
  ReviewsSection,
  type MergeMethod,
  type PrComment,
  type PrCommit,
  type ProtectionInfo,
  type PrReview,
  type PullReviewEvent,
  type Reviewer,
} from './PrDetailSections';
import { useConfirm } from './ui';
import { t, tp } from '../i18n';

// Classic commit statuses (Jenkins, older CI) are separate from check runs.
interface CommitStatus {
  context: string;
  state: string;
  target_url?: string;
}

// Conclusions that mean "this gate did not pass".
const FAILED_STATES = new Set(['failure', 'error', 'timed_out', 'startup_failure', 'cancelled']);

export default function PrDetailModal({
  pr,
  onClose,
  onChanged,
}: {
  pr: PullRequest;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { pat, remote, activeRepo, toast, refresh } = useApp();
  const confirm = useConfirm();
  useEscape(onClose);
  const [checks, setChecks] = useState<CheckRun[]>([]);
  const [protection, setProtection] = useState<ProtectionInfo | null>(null);
  const [prCommits, setPrCommits] = useState<PrCommit[]>([]);
  const [prFiles, setPrFiles] = useState<PrFile[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewerInput, setReviewerInput] = useState('');
  const [comments, setComments] = useState<PrComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [reviews, setReviews] = useState<PrReview[]>([]);
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [working, setWorking] = useState(false);
  const [prBranchBusy, setPrBranchBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editWorking, setEditWorking] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  // Local copy of the description so edits do not mutate the `pr` prop; the
  // parent refreshes it in place via onChanged().
  const [description, setDescription] = useState(pr.body);
  const [labels, setLabels] = useState(pr.labels || []);
  const [repoLabels, setRepoLabels] = useState<Array<{ name: string; color?: string }>>([]);
  const [labelBusy, setLabelBusy] = useState(false);

  const base = `/repos/${remote!.owner}/${remote!.repo}`;

  // GitHub caps list endpoints at 30 items by default; large pull requests
  // would silently lose files, commits and comments. Walk pages until a short
  // page arrives (bounded so a misbehaving server cannot loop forever).
  async function fetchPages<T>(path: string): Promise<{ data: T[] }> {
    const all: T[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const res = await githubProxy<T[]>(pat, `${path}?per_page=100&page=${page}`);
      const items = Array.isArray(res.data) ? res.data : [];
      all.push(...items);
      if (items.length < 100) break;
    }
    return { data: all };
  }

  // Repo label list drives the picker. A repo with no labels (or a token
  // without label scope) simply gets an empty picker; it must not break the
  // rest of the modal.
  useEffect(() => {
    let cancelled = false;
    githubProxy<Array<{ name: string; color?: string }>>(pat, `${base}/labels?per_page=100`)
      .then((res) => {
        if (!cancelled) setRepoLabels(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pat, base]);

  async function addLabel(name: string) {
    if (!name || labelBusy) return;
    setLabelBusy(true);
    try {
      await githubProxy(pat, `${base}/issues/${pr.number}/labels`, 'POST', { labels: [name] });
      setLabels((prev) => (prev.some((l) => l.name === name) ? prev : [...prev, repoLabels.find((l) => l.name === name) || { name }]));
    } catch {
      toast(t('Could not add the label.'));
    } finally {
      setLabelBusy(false);
    }
  }

  async function removeLabel(name: string) {
    if (labelBusy) return;
    setLabelBusy(true);
    try {
      await githubProxy(pat, `${base}/issues/${pr.number}/labels/${encodeURIComponent(name)}`, 'DELETE');
      setLabels((prev) => prev.filter((l) => l.name !== name));
    } catch {
      toast(t('Could not remove the label.'));
    } finally {
      setLabelBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // allSettled: a single endpoint failing must not blank the whole modal.
    // In particular requested-reviewers returns 404 when nobody is requested.
    Promise.allSettled([
      githubProxy<{ check_runs: CheckRun[] }>(pat, `${base}/commits/${pr.head.sha}/check-runs`),
      fetchPages<PrCommit>(`${base}/pulls/${pr.number}/commits`),
      fetchPages<PrFile>(`${base}/pulls/${pr.number}/files`),
      githubProxy<{ users: Reviewer[] }>(pat, `${base}/pulls/${pr.number}/requested-reviewers`),
      fetchPages<PrComment>(`${base}/issues/${pr.number}/comments`),
      fetchPages<PrReview>(`${base}/pulls/${pr.number}/reviews`),
      fetchPages<ReviewComment>(`${base}/pulls/${pr.number}/comments`),
      // 404 means "no protection configured" — that is a fact worth showing,
      // not a load failure, so it resolves instead of rejecting.
      githubProxy<{ required_status_checks?: { contexts?: string[] } }>(
        pat,
        `${base}/branches/${encodeURIComponent(pr.base.ref)}/protection`,
      )
        .then((r) => ({ protected: true, requiredChecks: r.data.required_status_checks?.contexts?.length || 0 }))
        .catch((err: { status?: number }) => ({ protected: errorStatus(err) === 404 ? false : null, requiredChecks: 0 })),
      githubProxy<{ statuses: CommitStatus[] }>(pat, `${base}/commits/${pr.head.sha}/status`),
    ])
      .then((settled) => {
        if (cancelled) return;
        const dataOf = <T,>(s: PromiseSettledResult<{ data: T }>, fallback: T): T =>
          s.status === 'fulfilled' ? s.value.data : fallback;
        const checkRuns = dataOf(settled[0], { check_runs: [] as CheckRun[] }).check_runs || [];
        const statuses = dataOf(settled[8], { statuses: [] as CommitStatus[] }).statuses || [];
        setChecks([
          ...checkRuns,
          ...statuses.map((s, i) => ({
            id: -1 - i,
            name: s.context,
            status: s.state,
            // pending has no conclusion; anything but success is a failure gate.
            conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : 'failure',
            html_url: s.target_url || '',
          })),
        ]);
        setProtection(settled[7].status === 'fulfilled' ? settled[7].value : null);
        setPrCommits(dataOf(settled[1], [] as PrCommit[]));
        setPrFiles(dataOf(settled[2], [] as PrFile[]));
        setReviewers(dataOf(settled[3], { users: [] as Reviewer[] }).users || []);
        setComments(dataOf(settled[4], [] as PrComment[]));
        setReviews(dataOf(settled[5], [] as PrReview[]));
        setReviewComments(dataOf(settled[6], [] as ReviewComment[]));
      })
      .catch(() => {
        if (!cancelled) toast(t("Failed to load PR details"), 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [pat, base, pr.number, pr.head.sha, toast]);

  async function merge() {
    const failed = checks.filter((c) => c.conclusion && FAILED_STATES.has(c.conclusion)).length;
    if (failed > 0) {
      const override = await confirm(
        `Merge with ${failed} failing check${failed === 1 ? '' : 's'}?`,
        'The head commit did not pass every CI gate. GitHub may still block the merge if the base branch requires these checks.',
      );
      if (!override) return;
    }
    const ok = await confirm(
      `Merge PR #${pr.number} using ${method}?`,
      'Branch protection and required reviews are enforced by GitHub.',
    );
    if (!ok) return;
    setWorking(true);
    try {
      await mergePull(activeRepo!, pr.number, method, pat);
      toast(t("Pull request merged"), 'success');
      onChanged();
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      // Reset even on success: the modal stays open and the footer buttons
      // would otherwise remain disabled after the action completed.
      setWorking(false);
    }
  }

  const failedChecks = checks.filter((c) => c.conclusion && FAILED_STATES.has(c.conclusion)).length;

  // Create a local branch that points at the PR head, leaving the working tree
  // and current branch untouched.
  async function fetchPrBranch() {
    if (!activeRepo) return;
    setPrBranchBusy(true);
    try {
      const res = await checkoutPrHead(activeRepo, pr.number);
      toast(`Created branch ${res.branch} at ${shortHash(res.sha)}`, 'success');
      await refresh();
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setPrBranchBusy(false);
    }
  }

  async function markReady() {
    setWorking(true);
    try {
      await markReadyForReview(activeRepo!, pr.number, pat);
      toast(t("Pull request is now ready for review"), 'success');
      onChanged();
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function addReviewer() {
    const username = reviewerInput.trim().replace(/^@/, '');
    if (!username || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(username)) {
      toast(t("Enter a valid GitHub username"), 'error');
      return;
    }
    if (reviewers.some((r) => r.login.toLowerCase() === username.toLowerCase())) {
      setReviewerInput('');
      return;
    }
    try {
      await githubProxy(
        pat,
        `${base}/pulls/${pr.number}/requested-reviewers`,
        'POST',
        { reviewers: [username] },
      );
      setReviewers((prev) => [...prev, { login: username, avatar_url: '' }]);
      setReviewerInput('');
      toast(t("Reviewer requested"), 'success');
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    }
  }

  async function postComment() {
    const body = commentBody.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const res = await githubProxy<PrComment>(
        pat,
        `${base}/issues/${pr.number}/comments`,
        'POST',
        { body },
      );
      setComments((prev) => [...prev, res.data]);
      setCommentBody('');
      toast(t("Comment added"), 'success');
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setPosting(false);
    }
  }

  function startEditComment(c: PrComment) {
    setEditingId(c.id);
    setEditBody(c.body);
  }

  function cancelEditComment() {
    setEditingId(null);
    setEditBody('');
  }

  async function submitEditComment(c: PrComment) {
    const body = editBody.trim();
    if (!body) {
      toast(t("Comment body cannot be empty"), 'error');
      return;
    }
    setEditWorking(true);
    try {
      const res = await githubProxy<PrComment>(
        pat,
        `${base}/issues/comments/${c.id}`,
        'PATCH',
        { body },
      );
      setComments((prev) => prev.map((item) => (item.id === c.id ? res.data : item)));
      setEditingId(null);
      setEditBody('');
      toast(t("Comment updated"), 'success');
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setEditWorking(false);
    }
  }

  async function deleteComment(c: PrComment) {
    const ok = await confirm(
      'Delete this comment?',
      'This permanently removes the comment on GitHub and cannot be undone.',
    );
    if (!ok) return;
    setEditWorking(true);
    try {
      await githubProxy(
        pat,
        `${base}/issues/comments/${c.id}`,
        'DELETE',
      );
      setComments((prev) => prev.filter((item) => item.id !== c.id));
      toast(t("Comment deleted"), 'success');
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setEditWorking(false);
    }
  }

  function startEditDescription() {
    setDescriptionDraft(description || '');
    setEditingDescription(true);
  }

  async function submitEditDescription() {
    const body = descriptionDraft;
    setEditWorking(true);
    try {
      const res = await githubProxy<PullRequest>(
        pat,
        `${base}/pulls/${pr.number}`,
        'PATCH',
        { body },
      );
      setDescription(res.data.body);
      setEditingDescription(false);
      toast(t("Description updated"), 'success');
      onChanged();
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setEditWorking(false);
    }
  }

  async function submitReview(event: PullReviewEvent) {
    if (submittingReview) return;
    const body = reviewBody.trim();
    // GitHub requires a summary when requesting changes.
    if (event === 'REQUEST_CHANGES' && !body) {
      toast(t("A review comment is required to request changes"), 'error');
      return;
    }
    setSubmittingReview(true);
    try {
      const res = await githubProxy<PrReview>(
        pat,
        `${base}/pulls/${pr.number}/reviews`,
        'POST',
        { body, event },
      );
      setReviews((prev) => [...prev, res.data]);
      setReviewBody('');
      toast(t("Review submitted"), 'success');
      onChanged();
    } catch (err) {
      toast(errorDetail(err) ? `${errorMessage(err)}: ${errorDetail(err)}` : errorMessage(err), 'error');
    } finally {
      setSubmittingReview(false);
    }
  }

  async function changeState(state: 'open' | 'closed') {
    const ok = await confirm({
      title: state === 'closed' ? `Close PR #${pr.number}?` : `Reopen PR #${pr.number}?`,
      confirmLabel: state === 'closed' ? t('Close PR') : t('Reopen PR'),
      danger: state === 'closed',
    });
    if (!ok) return;
    setWorking(true);
    try {
      await githubProxy(pat, `${base}/pulls/${pr.number}`, 'PATCH', { state });
      toast(state === 'closed' ? 'Pull request closed' : 'Pull request reopened', 'success');
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setWorking(false);
    }
  }

  const totalAdd = prFiles.reduce((s, f) => s + f.additions, 0);
  const totalDel = prFiles.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 720, maxHeight: '86vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>#{pr.number} {pr.title}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} title={t("Close")} onClick={onClose}><IconX /></button>
        </div>

        <div className="modal-body">
          <div className="detail-value muted" style={{ marginBottom: 16 }}>
            {pr.head.label} → {pr.base.label} · {tp("opened by {user} on {date}", { user: pr.user.login, date: formatFullDate(pr.created_at) })}
          </div>

          <LabelsSection
            state={pr.state}
            labels={labels}
            repoLabels={repoLabels}
            busy={labelBusy}
            onAdd={(name) => void addLabel(name)}
            onRemove={(name) => void removeLabel(name)}
          />

          <DescriptionSection
            state={pr.state}
            body={description}
            editing={editingDescription}
            draft={descriptionDraft}
            working={editWorking}
            onStart={startEditDescription}
            onDraft={setDescriptionDraft}
            onCancel={() => setEditingDescription(false)}
            onSave={() => void submitEditDescription()}
          />

          <CommitsSection commits={prCommits} />

          <FilesSection
            files={prFiles}
            totalAdd={totalAdd}
            totalDel={totalDel}
            expandedFile={expandedFile}
            onToggleFile={(filename) => setExpandedFile((cur) => (cur === filename ? null : filename))}
            reviewComments={reviewComments}
            headSha={pr.head.sha}
            base={`${base}/pulls/${pr.number}`}
            canComment={pr.state === 'open'}
            onPosted={(c) => setReviewComments((prev) => [...prev, c])}
            onChanged={(c) => setReviewComments((prev) =>
              prev.map((item) => (item.id === c.id ? c : item)))}
            onDeleted={(id) => setReviewComments((prev) =>
              prev.filter((item) => item.id !== id))}
          />

          <ReviewersSection
            canRequest={pr.state === 'open'}
            reviewers={reviewers}
            input={reviewerInput}
            onInput={setReviewerInput}
            onRequest={() => void addReviewer()}
          />

          <ReviewsSection
            reviews={reviews}
            state={pr.state}
            reviewBody={reviewBody}
            submittingReview={submittingReview}
            onBody={setReviewBody}
            onSubmit={(event) => void submitReview(event)}
          />

          <ChecksSection checks={checks} failedChecks={failedChecks} />

          <CommentsSection
            comments={comments}
            editingId={editingId}
            editBody={editBody}
            editWorking={editWorking}
            commentBody={commentBody}
            posting={posting}
            onStartEdit={startEditComment}
            onEditBody={setEditBody}
            onCancelEdit={cancelEditComment}
            onSaveEdit={(comment) => void submitEditComment(comment)}
            onDelete={(comment) => void deleteComment(comment)}
            onCommentBody={setCommentBody}
            onPost={() => void postComment()}
          />

          <MergeSection
            pr={pr}
            failedChecks={failedChecks}
            protection={protection}
            method={method}
            onMethod={setMethod}
          />
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            disabled={!activeRepo || prBranchBusy}
            onClick={fetchPrBranch}
            title={activeRepo
              ? `Create local branch pr-${pr.number} from the pull request head without switching`
              : 'Open a repository to fetch the pull request head'}
          >
            {prBranchBusy ? 'Fetching…' : 'Fetch PR branch'}
          </button>
          <a className="btn" href={pr.html_url} target="_blank" rel="noreferrer">
            <IconExternal width={14} height={14} />
            Open on GitHub
          </a>
          {pr.state === 'open' ? (
            <>
              <button type="button" className="btn" disabled={working} onClick={() => changeState('closed')}>
                Close
              </button>
              {pr.draft ? (
                <button type="button" className="btn btn-primary" disabled={working} onClick={markReady}>
                  Ready for review
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={working} onClick={merge}>
                  {t("Merge")}</button>
              )}
            </>
          ) : (
            !pr.merged && !pr.merged_at && (
              <button type="button" className="btn btn-primary" disabled={working} onClick={() => changeState('open')}>
                Reopen
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
