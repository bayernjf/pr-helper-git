// Git runner. Every call uses execFile with a fixed argv array — user input
// is never interpolated into a shell string.
import { execFile } from 'node:child_process';

export const GIT_TIMEOUT_MS = 20_000;
export const MAX_BUFFER = 32 * 1024 * 1024;

export function git(args, cwd, options = {}) {
  // Keep UTF-8 paths literal instead of C-quoted octal escapes: the UI and the
  // follow-up API calls address files by path, so `git` must report the real
  // name.
  const argv = ['-c', 'core.quotePath=false', ...args];
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      argv,
      {
        cwd,
        timeout: options.timeout || GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        ...(options.env ? { env: options.env } : {}),
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr || '').trim().slice(0, 600);
          // Commands such as `git diff --no-index` and `git grep` exit non-zero
          // while still emitting usable output on stdout.
          err.stdout = String(stdout || '');
          err.code = typeof err.code === 'number' ? err.code : null;
          reject(err);
        } else {
          resolve(stdout);
        }
      },
    );
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

// `git diff --numstat -M` prints the destination path for renames, using the
// compact "old => new" form (or "dir/{old => new}/file" when the names share
// a prefix). Recover the destination so stats can be matched to the new path
// reported by `--name-status`.
export function numstatTarget(raw) {
  const arrow = raw.indexOf(' => ');
  if (arrow === -1) return raw;
  if (raw.includes('{')) {
    const open = raw.lastIndexOf('{', arrow);
    const close = raw.indexOf('}', arrow);
    if (open !== -1 && close !== -1) {
      return raw.slice(0, open) + raw.slice(arrow + 4, close) + raw.slice(close + 1);
    }
  }
  return raw.slice(arrow + 4);
}

// ---------- pure parsers ----------

// Parse `git status --porcelain=v2 --branch`.
export function parsePorcelainV2(output) {
  const result = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
  };
  for (const line of output.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      result.branch = line.slice(14).trim() || null;
    } else if (line.startsWith('# branch.upstream ')) {
      result.upstream = line.slice(18).trim() || null;
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.slice(12).match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        result.ahead = Number(m[1]);
        result.behind = Number(m[2]);
      }
    } else if (line.startsWith('? ')) {
      result.files.push({ path: line.slice(2).trim(), status: 'untracked', area: 'untracked' });
    } else if (line[0] === '1') {
      const parts = line.split(' ');
      const xy = parts[1] || '';
      const path = parts.slice(8).join(' ');
      const area = xy[0] !== '.' ? 'staged' : 'unstaged';
      result.files.push({ path, status: xy, area });
    } else if (line[0] === '2') {
      const parts = line.split(' ');
      const xy = parts[1] || '';
      // rename/copy: the score is followed by "<path>\t<orig-path>", where
      // <path> is the current name and <orig-path> the pre-rename name.
      // Both paths may contain spaces, so re-join the remaining space-split
      // fields before splitting on the path separator. Field 8 is the
      // rename/copy score.
      const paths = parts.slice(9).join(' ').split('\t');
      const path = paths[0];
      const area = xy[0] !== '.' ? 'staged' : 'unstaged';
      result.files.push({ path, status: xy, area, renamedFrom: paths[1] || null });
    } else if (line[0] === 'u') {
      const parts = line.split(' ');
      result.files.push({ path: parts.slice(10).join(' '), status: parts[1] || 'UU', area: 'unmerged' });
    }
  }
  return result;
}

// Parse `git log` records separated by RS (0x1e) and fields by US (0x1f).
export function parseLog(output) {
  const commits = [];
  for (const record of output.split('\x1e')) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const [hash, parents, authorName, authorEmail, date, subject, body] = trimmed.split('\x1f');
    if (!hash) continue;
    commits.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName: authorName || '',
      authorEmail: authorEmail || '',
      date: date || '',
      subject: subject || '',
      body: (body || '').trim(),
    });
  }
  return commits;
}

// Parse `git for-each-ref --format=...` lines (tab-separated fields; ref
// names can never contain tabs).
export function parseRefs(output) {
  const refs = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [hash, refType, name, upstream, shortName, track] = line.split('\t');
    let ahead = 0;
    let behind = 0;
    if (track) {
      const a = track.match(/ahead (\d+)/);
      const b = track.match(/behind (\d+)/);
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
    }
    refs.push({
      hash,
      type: refType,
      name,
      shortName: shortName || name,
      upstream: upstream || null,
      ahead,
      behind,
    });
  }
  return refs;
}

// Parse `git blame --porcelain <file>`. A commit's metadata is only printed
// once; later blocks for the same commit repeat just the header and the
// source line. Returns one record per final line of the file.
export function parseBlame(output) {
  const commits = new Map();
  const result = [];
  let current = null;
  let currentSha = null;

  for (const line of output.split('\n')) {
    // The header may carry a fourth field (number of groups) on boundary commits.
    const header = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/);
    if (header) {
      currentSha = header[1];
      if (!commits.has(currentSha)) commits.set(currentSha, {});
      current = { sha: currentSha, finalLine: Number(header[3]) };
      continue;
    }
    if (!current) continue;
    const info = commits.get(currentSha);
    if (line.startsWith('author-mail ')) {
      info.email = line.slice(12).replace(/[<>]/g, '');
    } else if (line.startsWith('author-time ')) {
      info.time = Number(line.slice(12));
    } else if (line.startsWith('summary ')) {
      info.summary = line.slice(8);
    } else if (line.startsWith('author ')) {
      info.author = line.slice(7);
    } else if (line.startsWith('\t')) {
      result.push({
        line: current.finalLine,
        sha: current.sha,
        author: info.author || '',
        email: info.email || '',
        time: info.time || 0,
        summary: info.summary || '',
        text: line.slice(1),
      });
      current = null;
    }
  }
  return result;
}

// Parse `git reflog` lines: "<sha> <ref>@{<n>}: <action>: <description>".
export function parseReflog(output) {
  const entries = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^([0-9a-f]{4,40}) (.+?)@\{(\d+)\}: (.*)$/);
    if (!m) continue;
    const [, hash, refPart, index, rest] = m;
    let action = rest;
    let description = '';
    const colon = rest.indexOf(': ');
    if (colon >= 0) {
      action = rest.slice(0, colon);
      description = rest.slice(colon + 2);
    }
    entries.push({
      hash,
      ref: refPart.trim(),
      index: Number(index),
      action,
      description,
    });
  }
  return entries;
}

// Parse an annotated tag object from `git cat-file -p refs/tags/<name>`:
// header lines, a blank line, then the subject/body message.
export function parseTagObject(output) {
  const result = {
    object: '', type: '', tag: '', tagger: '', taggerEmail: '',
    time: 0, subject: '', body: '',
  };
  const blank = output.indexOf('\n\n');
  const header = blank >= 0 ? output.slice(0, blank) : output;
  const message = blank >= 0 ? output.slice(blank + 2) : '';
  for (const line of header.split('\n')) {
    if (line.startsWith('object ')) {
      result.object = line.slice(7);
    } else if (line.startsWith('type ')) {
      result.type = line.slice(5);
    } else if (line.startsWith('tag ')) {
      result.tag = line.slice(4);
    } else if (line.startsWith('tagger ')) {
      const rest = line.slice(7);
      const lt = rest.lastIndexOf('<');
      const gt = rest.indexOf('>', lt);
      result.tagger = rest.slice(0, lt).trim();
      result.taggerEmail = rest.slice(lt + 1, gt);
      const ts = rest.slice(gt + 1).trim().match(/^(\d+)/);
      if (ts) result.time = Number(ts[1]);
    }
  }
  const lines = message.split('\n');
  result.subject = lines[0] || '';
  result.body = lines.slice(1).join('\n').trim();
  return result;
}

// Split a single-file unified diff into its file header (everything before
// the first hunk) and the individual hunks. Each hunk starts at a `@@` line
// and runs until the next hunk. The arrays preserve exact line content so a
// patch can be rebuilt byte-for-byte without introducing blank lines.
export function splitFilePatch(diffText) {
  const header = [];
  const hunks = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('@@')) {
      current = [line];
      hunks.push(current);
    } else if (current === null) {
      header.push(line);
    } else {
      current.push(line);
    }
  }
  // diffText ends with a newline, so the final split element is an empty
  // trailing line belonging to the last hunk; drop it when rebuilding.
  if (hunks.length) {
    const last = hunks[hunks.length - 1];
    if (last.length && last[last.length - 1] === '') last.pop();
  }
  return { header, hunks };
}

// Rebuild a valid patch string containing the file header and one hunk.
export function buildHunkPatch(header, hunk) {
  return `${[...header, ...hunk].join('\n')}\n`;
}

// Mirror git's default `strip` message cleanup so a commit template's comment
// lines are never committed: drop lines whose first non-space character is
// `#`, trim trailing whitespace, strip leading/trailing blank lines and
// collapse runs of blank lines into a single one. Returns the cleaned text.
export function cleanCommitMessage(raw) {
  const kept = [];
  for (const line of String(raw).replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    kept.push(line.replace(/[ \t]+$/, ''));
  }
  const out = [];
  let blankRun = 0;
  for (const line of kept) {
    if (line === '') {
      blankRun += 1;
      if (blankRun <= 1 && out.length) out.push('');
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
