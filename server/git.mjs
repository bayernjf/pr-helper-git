// Git runner. Every call uses execFile with a fixed argv array — user input
// is never interpolated into a shell string.
import { execFile } from 'node:child_process';

export const GIT_TIMEOUT_MS = 20_000;
export const MAX_BUFFER = 32 * 1024 * 1024;

export function git(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, timeout: options.timeout || GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr || '').trim().slice(0, 600);
          reject(err);
        } else {
          resolve(stdout);
        }
      },
    );
    if (options.input !== undefined) child.stdin.end(options.input);
  });
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
      // rename/copy: last two tokens are "origPath\tnewPath"
      const paths = parts[parts.length - 1].split('\t');
      const path = paths[1] || paths[0];
      const area = xy[0] !== '.' ? 'staged' : 'unstaged';
      result.files.push({ path, status: xy, area, renamedFrom: paths[0] || null });
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
    const [hash, refType, name, upstream, shortName] = line.split('\t');
    refs.push({
      hash,
      type: refType,
      name,
      shortName: shortName || name,
      upstream: upstream || null,
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
