// Commit-history search across every reachable ref. Mirrors the first-generation
// product: a bare query greps the message (case-insensitive), `author:x` greps
// the author, `path:x` restricts history to commits touching a path.
//
// The argv builder is pure so the prefix rules can be unit-tested without a
// repository; the route only adds parsing and error mapping.

export const COMMIT_SEARCH_LIMIT = 30;
export const COMMIT_SEARCH_MAX_QUERY = 200;

const PRETTY = '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e';

/**
 * @param {string} raw the query typed by the user
 * @param {{limit?: number}} [options]
 * @returns {null | {error: string} | {args: string[], mode: 'message'|'author'|'path', term: string}}
 */
export function buildCommitSearch(raw, { limit = COMMIT_SEARCH_LIMIT } = {}) {
  const q = String(raw ?? '').trim();
  if (!q) return { error: 'missing query' };
  if (q.length > COMMIT_SEARCH_MAX_QUERY) return { error: 'query is too long' };
  // Newlines would end up inside the argv value; a NUL cannot travel at all.
  if (/[\0\r\n]/.test(q)) return { error: 'invalid query' };

  const prefix = q.match(/^(author|path)\s*:\s*(.*)$/is);
  const mode = prefix ? (prefix[1].toLowerCase() === 'author' ? 'author' : 'path') : 'message';
  const term = (prefix ? prefix[2] : q).trim();
  if (!term) return { error: `missing term after "${mode}:"` };
  if (term.length > COMMIT_SEARCH_MAX_QUERY) return { error: 'query is too long' };

  const max = Math.min(Math.max(Number(limit) || COMMIT_SEARCH_LIMIT, 1), 100);
  const args = [
    'log',
    '--all',
    '--date-order',
    `--max-count=${max}`,
    '-i',
    PRETTY,
  ];
  if (mode === 'author') args.push(`--author=${term}`);
  if (mode === 'message') args.push(`--grep=${term}`);
  if (mode === 'path') args.push('--', term);
  return { args, mode, term };
}
