// GitHub REST allowlist. Only repo / pull-request / CI endpoints the UI
// actually needs are reachable through the PAT proxy. Kept in its own module
// so the rules can be unit-tested without loading the HTTP route module.
const SEG = '[\\w.-]+';

export const ALLOWLIST = [
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls(/\\d+(/(commits|files|requested-reviewers|reviews))?)?$`),
  },
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/commits/${SEG}/check-runs$`),
  },
  // Classic commit statuses are a separate API from check runs; a repo using
  // only statuses (Jenkins, older CI) would otherwise look like "no CI".
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/commits/${SEG}/status$`) },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/branches(/${SEG})?$`) },
  // Branch protection (404 when unprotected) drives the "no protection rules"
  // warning and the required-check summary before merging.
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/branches/${SEG}/protection$`) },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/comments$`) },
  // Line-level review comments live under pulls (not issues); POST anchors a
  // comment to a commit/path/line inside a PR diff.
  {
    method: 'GET',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/comments$`),
  },
  {
    method: 'POST',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/comments$`),
  },
  // GitHub locates a single comment at issues/comments/:cid (no issue number);
  // the nested .../issues/:n/comments/:cid form returns 404 upstream.
  {
    method: 'PATCH',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/comments/\\d+$`),
  },
  {
    method: 'DELETE',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/comments/\\d+$`),
  },
  // Line-level review comments use the flat pulls/comments/:cid endpoint
  // (distinct from the issues/comments path used for issue-level comments).
  {
    method: 'PATCH',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/comments/\\d+$`),
  },
  {
    method: 'DELETE',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/comments/\\d+$`),
  },
  // Labels: the repo label list populates the picker, and labels are attached
  // to a pull request through the issues API (pulls share the issue number
  // space). The label name is URL-encoded and may contain spaces, so it cannot
  // use SEG here.
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/labels$`) },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/labels$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/labels$`) },
  {
    method: 'DELETE',
    regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/labels/[^/]+$`),
  },
  { method: 'GET', regex: new RegExp(`^/repos/${SEG}/${SEG}$`) },
  { method: 'GET', regex: /^\/user$/ },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/issues/\\d+/comments$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/requested-reviewers$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/reviews$`) },
  { method: 'POST', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+/merge$`) },
  { method: 'PATCH', regex: new RegExp(`^/repos/${SEG}/${SEG}/pulls/\\d+$`) },
];

export function isAllowed(method, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) return false;
  return ALLOWLIST.some((entry) => entry.method === method && entry.regex.test(path));
}
