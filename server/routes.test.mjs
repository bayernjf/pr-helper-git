// Route-level HTTP tests. A real server is spawned against an isolated
// PR_HELPER_HOME and a temporary Git repository, so the tests exercise the
// full stack: HTTP parsing, validation, git invocation and JSON responses.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_KEEP_ENTRIES, AUDIT_ROTATE_BYTES } from './store.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverPath = path.join(projectRoot, 'server', 'main.mjs');

let tmpRoot;
let homeDir;
let repoDir;
let rebaseDir;
let conflictDir;
let revertDir;
let revertSha;
let serverProc;
let port;

function git(args, cwd, allowFailure = false) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  } catch (err) {
    if (allowFailure) return err.stdout || '';
    throw err;
  }
}

function writeFile(rel, content) {
  return fsp.writeFile(path.join(repoDir, rel), content, 'utf8');
}

beforeAll(async () => {
  tmpRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'git2-routes-')));
  homeDir = path.join(tmpRoot, 'home');
  repoDir = path.join(tmpRoot, 'repo');
  rebaseDir = path.join(tmpRoot, 'rebase-repo');
  await fsp.mkdir(homeDir);
  await fsp.mkdir(repoDir);

  // Isolate global Git config so a machine-wide `commit.template` (or other
  // user settings) cannot leak into these assertions. Both the direct git
  // calls below and the spawned server inherit this environment.
  const globalConfig = path.join(tmpRoot, 'global.gitconfig');
  await fsp.writeFile(globalConfig, '', 'utf8');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;

  git(['init', '-b', 'main'], repoDir);
  git(['config', 'user.email', 'tester@example.com'], repoDir);
  git(['config', 'user.name', 'Tester'], repoDir);

  await writeFile('a.txt', 'alpha line\n');
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'initial commit'], repoDir);

  await writeFile('b.txt', 'bravo\n');
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'add b file'], repoDir);

  await fsp.mkdir(path.join(repoDir, 'src'));
  await writeFile('src/index.js', "console.log('start')\n");
  git(['add', '.'], repoDir);
  git(['commit', '-m', 'add index'], repoDir);

  git(['checkout', '-b', 'feature'], repoDir);
  await writeFile('feature.txt', 'feature work content\n');  git(['add', '.'], repoDir);
  git(['commit', '-m', 'feature work'], repoDir);

  git(['checkout', 'main'], repoDir);
  git(['merge', '--no-ff', '--no-edit', 'feature'], repoDir);
  git(['tag', 'v1'], repoDir);

  // A second repository used to verify rebase state detection. Both branches
  // edit the same line so the rebase stops with a conflict.
  await fsp.mkdir(rebaseDir);
  git(['init', '-b', 'main'], rebaseDir);
  git(['config', 'user.email', 'tester@example.com'], rebaseDir);
  git(['config', 'user.name', 'Tester'], rebaseDir);
  await fsp.writeFile(path.join(rebaseDir, 'conflict.txt'), 'base\n', 'utf8');
  git(['add', '.'], rebaseDir);
  git(['commit', '-m', 'base commit'], rebaseDir);
  git(['checkout', '-b', 'side'], rebaseDir);
  await fsp.writeFile(path.join(rebaseDir, 'conflict.txt'), 'side change\n', 'utf8');
  git(['add', '.'], rebaseDir);
  git(['commit', '-m', 'side change'], rebaseDir);
  git(['checkout', 'main'], rebaseDir);
  await fsp.writeFile(path.join(rebaseDir, 'conflict.txt'), 'main change\n', 'utf8');
  git(['add', '.'], rebaseDir);
  git(['commit', '-m', 'main change'], rebaseDir);
  git(['rebase', 'side'], rebaseDir, true);

  // A third repository where reverting an older commit conflicts with a newer
  // edit of the same line. Used to verify the revert stays in progress.
  revertDir = path.join(tmpRoot, 'revert-repo');
  await fsp.mkdir(revertDir);
  git(['init', '-b', 'main'], revertDir);
  git(['config', 'user.email', 'tester@example.com'], revertDir);
  git(['config', 'user.name', 'Tester'], revertDir);
  await fsp.writeFile(path.join(revertDir, 'conflict.txt'), 'base\n', 'utf8');
  git(['add', '.'], revertDir);
  git(['commit', '-m', 'base commit'], revertDir);
  await fsp.writeFile(path.join(revertDir, 'conflict.txt'), 'second edit\n', 'utf8');
  git(['add', '.'], revertDir);
  git(['commit', '-m', 'second edit'], revertDir);
  revertSha = git(['rev-parse', 'HEAD'], revertDir).trim();
  await fsp.writeFile(path.join(revertDir, 'conflict.txt'), 'third edit\n', 'utf8');
  git(['add', '.'], revertDir);
  git(['commit', '-m', 'third edit'], revertDir);

  // A fourth repository stopped in a merge conflict on two files, used by the
  // conflict-resolution endpoint ("ours" on one, "theirs" on the other).
  conflictDir = path.join(tmpRoot, 'conflict-repo');
  await fsp.mkdir(conflictDir);
  git(['init', '-b', 'main'], conflictDir);
  git(['config', 'user.email', 'tester@example.com'], conflictDir);
  git(['config', 'user.name', 'Tester'], conflictDir);
  await fsp.writeFile(path.join(conflictDir, 'one.txt'), 'base one\n', 'utf8');
  await fsp.writeFile(path.join(conflictDir, 'two.txt'), 'base two\n', 'utf8');
  git(['add', '.'], conflictDir);
  git(['commit', '-m', 'base'], conflictDir);
  git(['checkout', '-b', 'side'], conflictDir);
  await fsp.writeFile(path.join(conflictDir, 'one.txt'), 'side one\n', 'utf8');
  await fsp.writeFile(path.join(conflictDir, 'two.txt'), 'side two\n', 'utf8');
  git(['add', '.'], conflictDir);
  git(['commit', '-m', 'side'], conflictDir);
  git(['checkout', 'main'], conflictDir);
  await fsp.writeFile(path.join(conflictDir, 'one.txt'), 'main one\n', 'utf8');
  await fsp.writeFile(path.join(conflictDir, 'two.txt'), 'main two\n', 'utf8');
  git(['add', '.'], conflictDir);
  git(['commit', '-m', 'main'], conflictDir);
  git(['merge', 'side'], conflictDir, true);

  await new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [serverPath, '--port=0'], {
      env: { ...process.env, GIT2_DEV: '1', PR_HELPER_HOME: homeDir },
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 15_000);
    serverProc.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const m = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        port = Number(m[1]);
        resolve();
      }
    });
    serverProc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  });
}, 60_000);

afterAll(async () => {
  if (serverProc) serverProc.kill('SIGTERM');
  // Retry cleanup: on a heavily loaded machine a child can still release a
  // file when the recursive removal reaches its directory (ENOTEMPTY).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
      return;
    } catch (err) {
      if (err.code !== 'ENOTEMPTY' || attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

async function api(reqPath, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${reqPath}`, {
    ...options,
    headers: {
      'x-git2-token': 'dev-token',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let json = null;
  try {
    json = await res.json();
  } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const get = (p) => api(p);
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });
const q = (p) => encodeURIComponent(p);

describe('health and registry', () => {
  it('reports health', async () => {
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it('starts with an empty registry', async () => {
    const r = await get('/api/repos');
    expect(r.status).toBe(200);
    expect(r.json.repos).toEqual([]);
  });

  it('rejects an unregistered repository', async () => {
    const r = await get(`/api/status?repo=${q(repoDir)}`);
    expect(r.status).toBe(403);
  });

  it('registers a repository', async () => {
    const r = await post('/api/repos/add', { repo: repoDir });
    expect(r.status).toBe(200);
    expect(r.json.repos).toContain(repoDir);
  });

  it('rejects a folder without .git', async () => {
    const r = await post('/api/repos/add', { repo: homeDir });
    expect(r.status).toBe(400);
  });

  it('rejects a malformed static URI with 400', async () => {
    const r = await get('/%E0%A4%A');
    expect(r.status).toBe(400);
  });

  it('rejects repository removal without a target', async () => {
    const r = await post('/api/repos/remove', {});
    expect(r.status).toBe(400);
  });
});

describe('read routes', () => {
  it('returns clean status with idle operation state', async () => {
    const r = await get(`/api/status?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    expect(r.json.status.branch).toBe('main');
    expect(r.json.status.files).toEqual([]);
    expect(r.json.state.mergeInProgress).toBe(false);
    expect(r.json.state.rebaseInProgress).toBe(false);
  });

  it('reports non-ASCII paths verbatim', async () => {
    const name = '中文 名.txt';
    await writeFile(name, 'x\n');
    const status = await get(`/api/status?repo=${q(repoDir)}`);
    const entry = status.json.status.files.find((f) => f.path === name);
    expect(entry).toMatchObject({ status: 'untracked', area: 'untracked' });
    const file = await get(`/api/file?repo=${q(repoDir)}&file=${q(name)}`);
    expect(file.status).toBe(200);
    expect(file.json.content).toBe('x\n');
    await fsp.rm(path.join(repoDir, name));
  });

  it('lists the full commit history', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    expect(r.json.commits.length).toBeGreaterThanOrEqual(5);
    expect(r.json.commits[0].subject).toBe('Merge branch \'feature\'');
  });

  it('filters history by message', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}&message=${q('feature work')}`);
    expect(r.status).toBe(200);
    expect(r.json.commits).toHaveLength(1);
    expect(r.json.commits[0].subject).toBe('feature work');
  });

  it('filters history by author', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}&author=${q('Tester')}`);
    expect(r.status).toBe(200);
    expect(r.json.commits.length).toBeGreaterThanOrEqual(5);
  });

  it('filters history by date range', async () => {
    const future = await get(`/api/log?repo=${q(repoDir)}&since=${q('2030-01-01')}`);
    expect(future.json.commits).toHaveLength(0);
    const all = await get(`/api/log?repo=${q(repoDir)}&until=${q('2030-01-01')}`);
    expect(all.json.commits.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects malformed date filters', async () => {
    const r = await get(`/api/log?repo=${q(repoDir)}&since=${q('last week')}`);
    expect(r.status).toBe(400);
  });

  it('lists refs including branches and tags', async () => {
    const r = await get(`/api/refs?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    const names = r.json.refs.map((x) => x.name);
    expect(names).toContain('refs/heads/main');
    expect(names).toContain('refs/tags/v1');
  });

  it('diffs a modified tracked file', async () => {
    await fsp.writeFile(path.join(repoDir, 'a.txt'), 'alpha line\nsecond line\n', 'utf8');
    const r = await get(`/api/diff?repo=${q(repoDir)}&file=${q('a.txt')}`);
    expect(r.status).toBe(200);
    expect(r.json.untracked).toBe(false);
    expect(r.json.diff).toContain('+second line');
  });

  it('diffs an untracked file against /dev/null', async () => {
    await fsp.writeFile(path.join(repoDir, 'new.txt'), 'brand new file\n', 'utf8');
    const r = await get(`/api/diff?repo=${q(repoDir)}&file=${q('new.txt')}`);
    expect(r.status).toBe(200);
    expect(r.json.untracked).toBe(true);
    expect(r.json.diff).toContain('+brand new file');
  });

  it('searches content with grep, including empty results', async () => {
    const hit = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('bravo')}`);
    expect(hit.status).toBe(200);
    expect(hit.json.total).toBe(1);
    expect(hit.json.matches[0].path).toBe('b.txt');
    const miss = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('no-such-term-xyz')}`);
    expect(miss.status).toBe(200);
    expect(miss.json.total).toBe(0);
  });

  it('accepts a grep pattern starting with a dash', async () => {
    await writeFile('dash.txt', '--dash-flag value\nplain line\n');
    git(['add', 'dash.txt'], repoDir);
    git(['commit', '-m', 'add dash test file'], repoDir);

    // Without -e the leading "--dash-flag" would be parsed as a git option.
    const r = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('--dash-flag')}`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
    expect(r.json.matches[0].path).toBe('dash.txt');

    const all = await get(`/api/grep-all?pattern=${q('--dash-flag')}`);
    expect(all.status).toBe(200);
    const repoResult = all.json.results.find((x) => x.repo === repoDir);
    expect(repoResult).toBeTruthy();
    expect(repoResult.matches[0].path).toBe('dash.txt');
  });

  it('keeps file names containing a colon intact in grep results', async () => {
    const name = 'colon:name.txt';
    await writeFile(name, 'colon needle\n');
    git(['add', name], repoDir);
    git(['commit', '-m', 'add colon name file'], repoDir);
    const r = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('colon needle')}`);
    expect(r.status).toBe(200);
    expect(r.json.matches[0]).toMatchObject({ path: name, line: 1, text: 'colon needle' });
  });

  it('searches across every registered repository with grep-all', async () => {
    const hit = await get(`/api/grep-all?pattern=${q('bravo')}`);
    expect(hit.status).toBe(200);
    expect(hit.json.results).toHaveLength(1);
    expect(hit.json.results[0].repo).toBe(repoDir);
    expect(hit.json.results[0].matches[0].path).toBe('b.txt');
    expect(hit.json.total).toBe(1);
    expect(hit.json.truncated).toBe(false);
    const miss = await get(`/api/grep-all?pattern=${q('no-such-term-xyz')}`);
    expect(miss.status).toBe(200);
    expect(miss.json.total).toBe(0);
    const bad = await get('/api/grep-all');
    expect(bad.status).toBe(400);
  });

  it('supports case-insensitive and glob-filtered grep', async () => {
    const strict = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('BRAVO')}`);
    expect(strict.status).toBe(200);
    expect(strict.json.total).toBe(0);
    const loose = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('BRAVO')}&ignoreCase=1`);
    expect(loose.status).toBe(200);
    expect(loose.json.matches[0]).toMatchObject({ path: 'b.txt' });
    const globMiss = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('bravo')}&glob=${q('*.md')}`);
    expect(globMiss.json.total).toBe(0);
    const globHit = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('bravo')}&glob=${q('*.txt')}`);
    expect(globHit.json.matches[0]).toMatchObject({ path: 'b.txt' });
    const badGlob = await get(`/api/grep?repo=${q(repoDir)}&pattern=${q('bravo')}&glob=${q('--help')}`);
    expect(badGlob.status).toBe(400);
    const allGlob = await get(`/api/grep-all?pattern=${q('bravo')}&glob=${q('*.md')}`);
    expect(allGlob.status).toBe(200);
    expect(allGlob.json.total).toBe(0);
  });

  it('reads the configured commit template and reports when missing', async () => {
    const none = await get(`/api/commit-template?repo=${q(repoDir)}`);
    expect(none.status).toBe(200);
    expect(none.json.configured).toBe(false);

    await fsp.writeFile(path.join(repoDir, 'template.txt'), 'Summary\n\nDetails go here.\n', 'utf8');
    git(['config', 'commit.template', 'template.txt'], repoDir);
    const r = await get(`/api/commit-template?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    expect(r.json.configured).toBe(true);
    expect(r.json.path).toBe('template.txt');
    expect(r.json.text).toContain('Details go here.');
    // Leave the config in place; later commit tests do not depend on it.
  });

  it('searches the whole commit history and honours the author/path prefixes', async () => {
    const byMessage = await get(`/api/search-commits?repo=${q(repoDir)}&q=feature`);
    expect(byMessage.status).toBe(200);
    expect(byMessage.json.mode).toBe('message');
    expect(byMessage.json.commits.map((c) => c.subject)).toContain('feature work');

    const byAuthor = await get(`/api/search-commits?repo=${q(repoDir)}&q=${q('author:tester')}`);
    expect(byAuthor.status).toBe(200);
    expect(byAuthor.json.mode).toBe('author');
    expect(byAuthor.json.commits.length).toBeGreaterThan(0);

    const byPath = await get(`/api/search-commits?repo=${q(repoDir)}&q=${q('path:feature.txt')}`);
    expect(byPath.status).toBe(200);
    expect(byPath.json.mode).toBe('path');
    expect(byPath.json.commits.map((c) => c.subject)).toEqual(['feature work']);

    const empty = await get(`/api/search-commits?repo=${q(repoDir)}&q=`);
    expect(empty.status).toBe(400);
    expect(empty.json.error).toBe('missing query');

    const tooLong = await get(`/api/search-commits?repo=${q(repoDir)}&q=${'x'.repeat(201)}`);
    expect(tooLong.status).toBe(400);
  });
});

describe('write routes', () => {
  it('unstages everything in a repository with no commits yet', async () => {
    const fresh = path.join(tmpRoot, 'fresh-repo');
    await fsp.mkdir(fresh);
    git(['init', '-b', 'main'], fresh);
    git(['config', 'user.email', 'fresh@example.com'], fresh);
    git(['config', 'user.name', 'Fresh'], fresh);
    await fsp.writeFile(path.join(fresh, 'first.txt'), 'one\n', 'utf8');
    git(['add', '.'], fresh);
    expect((await post('/api/repos/add', { repo: fresh })).status).toBe(200);

    const unstage = await post('/api/stage-all', { repo: fresh, action: 'unstage' });
    expect(unstage.status).toBe(200);
    const status = await get(`/api/status?repo=${q(fresh)}`);
    expect(status.json.status.files).toEqual([
      { path: 'first.txt', status: 'untracked', area: 'untracked' },
    ]);
  });

  it('stages and unstages a single file', async () => {    const staged = await post('/api/stage', { repo: repoDir, file: 'a.txt', action: 'stage' });
    expect(staged.status).toBe(200);
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'a.txt' && f.area === 'staged')).toBe(true);
    const unstaged = await post('/api/stage', { repo: repoDir, file: 'a.txt', action: 'unstage' });
    expect(unstaged.status).toBe(200);
    status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'a.txt' && f.area === 'staged')).toBe(false);
  });

  it('stages and unstages a single hunk', async () => {
    await writeFile(
      'hunk-test.txt',
      `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')}\n`,
    );
    git(['add', 'hunk-test.txt'], repoDir);
    git(['commit', '-m', 'add hunk test file'], repoDir);

    const lines = (await fsp.readFile(path.join(repoDir, 'hunk-test.txt'), 'utf8')).split('\n');
    lines[1] = 'CHANGED2';
    lines[14] = 'CHANGED15';
    await writeFile('hunk-test.txt', `${lines.join('\n')}`);

    const badAction = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 0, action: 'bogus',
    });
    expect(badAction.status).toBe(400);
    const outOfRange = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 5, action: 'stage',
    });
    expect(outOfRange.status).toBe(400);

    // Stage the second hunk only: CHANGED15 goes to the index, CHANGED2 stays.
    const r = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 1, action: 'stage',
    });
    expect(r.status).toBe(200);
    expect(r.json.hunkCount).toBe(2);
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    // Porcelain v2 reports a partially staged file as one entry with xy "MM".
    const entry = status.json.status.files.find((f) => f.path === 'hunk-test.txt');
    expect(entry.status).toBe('MM');
    expect(entry.area).toBe('staged');
    const cached = git(['show', ':hunk-test.txt'], repoDir);
    expect(cached).toContain('CHANGED15');
    expect(cached).not.toContain('CHANGED2');

    // Unstage the same hunk. The cached diff now contains one hunk, so its
    // index is 0 in the staged view; the index must return to the committed blob.
    const u = await post('/api/stage-hunk', {
      repo: repoDir, file: 'hunk-test.txt', hunk: 0, action: 'unstage',
    });
    expect(u.status).toBe(200);
    status = await get(`/api/status?repo=${q(repoDir)}`);
    const after = status.json.status.files.find((f) => f.path === 'hunk-test.txt');
    expect(after.area).toBe('unstaged');

    // Restore the committed file so later tests see a clean state.
    git(['restore', '--staged', '--', 'hunk-test.txt'], repoDir, true);
    git(['restore', '--', 'hunk-test.txt'], repoDir);
  });

  it('discards a single working-tree hunk without touching the index', async () => {
    await writeFile(
      'discard-hunk.txt',
      `${Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')}\n`,
    );
    git(['add', 'discard-hunk.txt'], repoDir);
    git(['commit', '-m', 'add discard hunk test file'], repoDir);

    const lines = (await fsp.readFile(path.join(repoDir, 'discard-hunk.txt'), 'utf8')).split('\n');
    lines[1] = 'CHANGED2';
    lines[14] = 'CHANGED15';
    await writeFile('discard-hunk.txt', `${lines.join('\n')}`);

    const noConfirm = await post('/api/discard-hunk', {
      repo: repoDir, file: 'discard-hunk.txt', hunk: 0,
    });
    expect(noConfirm.status).toBe(400);
    const outOfRange = await post('/api/discard-hunk', {
      repo: repoDir, file: 'discard-hunk.txt', hunk: 9, confirm: true,
    });
    expect(outOfRange.status).toBe(400);

    // Discard the first hunk: CHANGED2 is restored to the committed line,
    // while CHANGED15 remains in the working tree and the index is untouched.
    const r = await post('/api/discard-hunk', {
      repo: repoDir, file: 'discard-hunk.txt', hunk: 0, confirm: true,
    });
    expect(r.status).toBe(200);
    const onDisk = await fsp.readFile(path.join(repoDir, 'discard-hunk.txt'), 'utf8');
    expect(onDisk).not.toContain('CHANGED2');
    expect(onDisk).toContain('CHANGED15');
    // No staged changes: the index still holds the committed blob.
    const status = await get(`/api/status?repo=${q(repoDir)}`);
    const entry = status.json.status.files.find((f) => f.path === 'discard-hunk.txt');
    expect(entry.area).toBe('unstaged');

    git(['restore', '--', 'discard-hunk.txt'], repoDir);
  });

  it('commits staged changes and rejects empty messages', async () => {
    const bad = await post('/api/commit', { repo: repoDir, message: '   ' });
    expect(bad.status).toBe(400);
    await post('/api/stage', { repo: repoDir, file: 'a.txt', action: 'stage' });
    const before = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const r = await post('/api/commit', { repo: repoDir, message: 'extend a file' });
    expect(r.status).toBe(200);
    const after = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    expect(after).not.toBe(before);
  });

  it('strips comment lines from a commit message before committing', async () => {
    await fsp.writeFile(path.join(repoDir, 'note.txt'), 'note\n', 'utf8');
    await post('/api/stage', { repo: repoDir, file: 'note.txt', action: 'stage' });
    const message = 'Real subject\n\n# template comment\nReal body\n';
    const r = await post('/api/commit', { repo: repoDir, message });
    expect(r.status).toBe(200);
    const log = await get(`/api/log?repo=${q(repoDir)}`);
    const head = log.json.commits[0];
    expect(head.subject).toBe('Real subject');
    expect(head.body).toBe('Real body');
  });

  it('creates and deletes a branch without switching', async () => {
    const created = await post('/api/branch/create', { repo: repoDir, name: 'tmp-branch', noCheckout: true });
    expect(created.status).toBe(200);
    expect(created.json.switched).toBe(false);
    const deleted = await post('/api/branch/delete', { repo: repoDir, name: 'tmp-branch' });
    expect(deleted.status).toBe(200);
  });

  it('creates a branch from an explicit start ref', async () => {
    // The default path also switches to the new branch, which is the case that
    // broke when the argv contained a "--" separator before the start ref.
    const created = await post('/api/branch/create', {
      repo: repoDir,
      name: 'tmp-from-tag',
      from: 'v1',
    });
    expect(created.status).toBe(200);
    expect(created.json.switched).toBe(true);
    const refs = (await get(`/api/refs?repo=${q(repoDir)}`)).json.refs;
    const branch = refs.find((r) => r.name === 'refs/heads/tmp-from-tag');
    const tag = refs.find((r) => r.name === 'refs/tags/v1');
    expect(branch.hash).toBe(tag.hash);
    expect((await post('/api/checkout', { repo: repoDir, ref: 'main' })).status).toBe(200);
    const deleted = await post('/api/branch/delete', { repo: repoDir, name: 'tmp-from-tag' });
    expect(deleted.status).toBe(200);
  });

  it('creates and deletes a tag', async () => {
    const created = await post('/api/tag/create', { repo: repoDir, name: 'tmp-tag' });
    expect(created.status).toBe(200);
    const deleted = await post('/api/tag/delete', { repo: repoDir, name: 'tmp-tag' });
    expect(deleted.status).toBe(200);
  });

  it('renames a file and moves it back', async () => {
    const moved = await post('/api/mv', { repo: repoDir, from: 'b.txt', to: 'b-renamed.txt' });
    expect(moved.status).toBe(200);
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'b-renamed.txt')).toBe(true);
    const back = await post('/api/mv', { repo: repoDir, from: 'b-renamed.txt', to: 'b.txt' });
    expect(back.status).toBe(200);
  });

  it('removes a tracked file and restores it', async () => {
    const removed = await post('/api/rm', { repo: repoDir, file: 'new.txt' });
    expect(removed.status).toBe(200);
    expect(removed.json.method).toBe('unlink');
    let status = await get(`/api/status?repo=${q(repoDir)}`);
    expect(status.json.status.files.some((f) => f.path === 'new.txt')).toBe(false);
    await fsp.writeFile(path.join(repoDir, 'new.txt'), 'brand new file\n', 'utf8');
  });

  it('reverts an ordinary commit with a new revert commit', async () => {
    await fsp.writeFile(path.join(repoDir, 'revert-target.txt'), 'to be reverted\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add revert target'], repoDir);
    const head = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const r = await post('/api/revert', { repo: repoDir, sha: head });
    expect(r.status).toBe(200);
    const exists = await fsp.access(path.join(repoDir, 'revert-target.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('reverts several commits in one batch', async () => {
    await fsp.writeFile(path.join(repoDir, 'batch1.txt'), 'one\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add batch1'], repoDir);
    await fsp.writeFile(path.join(repoDir, 'batch2.txt'), 'two\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add batch2'], repoDir);
    const log = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits;
    const shas = [log[0].hash, log[1].hash]; // newest first
    const r = await post('/api/revert-batch', { repo: repoDir, shas });
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(2);
    for (const f of ['batch1.txt', 'batch2.txt']) {
      const exists = await fsp.access(path.join(repoDir, f)).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    }
  });

  it('rejects invalid batch revert payloads', async () => {
    const empty = await post('/api/revert-batch', { repo: repoDir, shas: [] });
    expect(empty.status).toBe(400);
    const bad = await post('/api/revert-batch', { repo: repoDir, shas: ['xyz', 'abc'] });
    expect(bad.status).toBe(400);
  });

  it('rejects hard reset without confirmation', async () => {
    const head = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const r = await post('/api/reset', { repo: repoDir, mode: 'hard', sha: head });
    expect(r.status).toBe(400);
  });

  it('rejects a merge revert without a mainline', async () => {
    const merge = (await get(`/api/log?repo=${q(repoDir)}&message=${q('Merge branch')}`)).json.commits[0];
    const r = await post('/api/revert', { repo: repoDir, sha: merge.hash });
    expect(r.status).toBe(400);
  });

  it('runs a soft reset to a previous commit', async () => {
    const head = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[0].hash;
    const parent = (await get(`/api/log?repo=${q(repoDir)}`)).json.commits[1].hash;
    const r = await post('/api/reset', { repo: repoDir, mode: 'soft', sha: parent });
    expect(r.status).toBe(200);
    // Restore the original branch position so later assertions stay valid.
    git(['reset', '--soft', head], repoDir);
  });
});

describe('rebase operation state', () => {
  it('registers the conflicted rebase repository', async () => {
    const r = await post('/api/repos/add', { repo: rebaseDir });
    expect(r.status).toBe(200);
  });

  it('detects the rebase in progress', async () => {
    const r = await get(`/api/status?repo=${q(rebaseDir)}`);
    expect(r.json.state.rebaseInProgress).toBe(true);
    expect(r.json.state.rebaseType).toMatch(/merge|apply/);
  });

  it('aborts the rebase and restores a clean state', async () => {
    const r = await post('/api/rebase/abort', { repo: rebaseDir });
    expect(r.status).toBe(200);
    const status = await get(`/api/status?repo=${q(rebaseDir)}`);
    expect(status.json.state.rebaseInProgress).toBe(false);
    expect(status.json.status.files).toEqual([]);
  });
});

describe('revert conflict handling', () => {
  it('registers the revert repository', async () => {
    const r = await post('/api/repos/add', { repo: revertDir });
    expect(r.status).toBe(200);
  });

  it('keeps the conflicted working tree instead of aborting', async () => {
    const r = await post('/api/revert', { repo: revertDir, sha: revertSha });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('revert stopped on conflicts');
    expect(r.json.conflicts).toContain('conflict.txt');
    expect(r.json.state.revertInProgress).toBe(true);

    const content = await fsp.readFile(path.join(revertDir, 'conflict.txt'), 'utf8');
    expect(content).toContain('<<<<<<<');
    const status = await get(`/api/status?repo=${q(revertDir)}`);
    expect(status.json.state.revertInProgress).toBe(true);
    expect(status.json.status.files.some((f) => f.area === 'unmerged')).toBe(true);
  });

  it('aborts and restores the pre-revert state', async () => {
    const r = await post('/api/revert/abort', { repo: revertDir });
    expect(r.status).toBe(200);
    const status = await get(`/api/status?repo=${q(revertDir)}`);
    expect(status.json.state.revertInProgress).toBe(false);
    expect(status.json.status.files).toEqual([]);
    const content = await fsp.readFile(path.join(revertDir, 'conflict.txt'), 'utf8');
    expect(content).toBe('third edit\n');
  });

  it('refuses to continue while conflicts remain', async () => {
    const r = await post('/api/revert', { repo: revertDir, sha: revertSha });
    expect(r.status).toBe(409);
    const cont = await post('/api/revert/continue', { repo: revertDir });
    expect(cont.status).toBe(409);
    expect(cont.json.error).toBe('unresolved conflicts remain');
  });

  it('continues once the conflicts are resolved', async () => {
    await fsp.writeFile(path.join(revertDir, 'conflict.txt'), 'resolved\n', 'utf8');
    git(['add', 'conflict.txt'], revertDir);
    const r = await post('/api/revert/continue', { repo: revertDir });
    expect(r.status).toBe(200);
    const status = await get(`/api/status?repo=${q(revertDir)}`);
    expect(status.json.state.revertInProgress).toBe(false);
    expect(status.json.status.files).toEqual([]);
    const log = await get(`/api/log?repo=${q(revertDir)}&limit=5`);
    expect(log.json.commits[0].subject).toMatch(/^Revert "second edit"$/);
  });
});

describe('conflict resolution', () => {
  it('registers the conflicted merge repository', async () => {
    const r = await post('/api/repos/add', { repo: conflictDir });
    expect(r.status).toBe(200);
    const status = await get(`/api/status?repo=${q(conflictDir)}`);
    expect(status.json.state.mergeInProgress).toBe(true);
    expect(status.json.status.files.filter((f) => f.area === 'unmerged').map((f) => f.path))
      .toEqual(expect.arrayContaining(['one.txt', 'two.txt']));
  });

  it('rejects a path that is not conflicted', async () => {
    const r = await post('/api/conflict/resolve', { repo: conflictDir, path: 'missing.txt', strategy: 'ours' });
    expect(r.status).toBe(400);
    const badStrategy = await post('/api/conflict/resolve', { repo: conflictDir, path: 'one.txt', strategy: 'nope' });
    expect(badStrategy.status).toBe(400);
  });

  it('takes the current side of one file and reports what is left', async () => {
    const r = await post('/api/conflict/resolve', { repo: conflictDir, path: 'one.txt', strategy: 'ours' });
    expect(r.status).toBe(200);
    expect(r.json.remaining).toEqual(['two.txt']);
    const content = await fsp.readFile(path.join(conflictDir, 'one.txt'), 'utf8');
    expect(content).toBe('main one\n');
  });

  it('takes the incoming side of the other file', async () => {
    const r = await post('/api/conflict/resolve', { repo: conflictDir, path: 'two.txt', strategy: 'theirs' });
    expect(r.status).toBe(200);
    expect(r.json.remaining).toEqual([]);
    const content = await fsp.readFile(path.join(conflictDir, 'two.txt'), 'utf8');
    expect(content).toBe('side two\n');
    const status = await get(`/api/status?repo=${q(conflictDir)}`);
    expect(status.json.status.files.some((f) => f.area === 'unmerged')).toBe(false);
    // Clean up so later tests do not inherit a half-merged repository.
    git(['merge', '--abort'], conflictDir);
  });
});

describe('batch repository pull', () => {
  it('rejects an empty or unregistered selection', async () => {
    const empty = await post('/api/repos/pull', { repos: [] });
    expect(empty.status).toBe(400);
    const unknown = await post('/api/repos/pull', { repos: [homeDir] });
    expect(unknown.status).toBe(400);
  });

  it('fast-forwards a registered clone from its origin', async () => {
    const origin = path.join(tmpRoot, 'pull-origin.git');
    const clone = path.join(tmpRoot, 'pull-clone');
    git(['init', '--bare', origin], tmpRoot);
    git(['init', '-b', 'main', clone], tmpRoot);
    git(['config', 'user.email', 'tester@example.com'], clone);
    git(['config', 'user.name', 'Tester'], clone);
    await fsp.writeFile(path.join(clone, 'a.txt'), 'one\n', 'utf8');
    git(['add', '.'], clone);
    git(['commit', '-m', 'first'], clone);
    git(['remote', 'add', 'origin', origin], clone);
    git(['push', '-u', 'origin', 'main'], clone);
    expect((await post('/api/repos/add', { repo: clone })).status).toBe(200);

    const r = await post('/api/repos/pull', { repos: [clone] });
    expect(r.status).toBe(200);
    expect(r.json.okCount).toBe(1);
    expect(r.json.failCount).toBe(0);
  });
});

describe('team identity', () => {
  const memberToken = [];

  it('reports the instance owner', async () => {
    const me = await get('/api/me');
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ name: 'owner', role: 'admin', instance: true });
  });

  it('creates a member and resolves the personal token', async () => {
    const created = await post('/api/users', { name: 'alice', role: 'member' });
    expect(created.status).toBe(200);
    expect(created.json.user).toMatchObject({ name: 'alice', role: 'member' });
    expect(typeof created.json.token).toBe('string');
    memberToken.push(created.json.token);

    const me = await api('/api/me', { headers: { 'x-git2-token': created.json.token } });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ name: 'alice', role: 'member', instance: false });

    const forbidden = await api('/api/users', { headers: { 'x-git2-token': created.json.token } });
    expect(forbidden.status).toBe(403);

    const dup = await post('/api/users', { name: 'alice', role: 'member' });
    expect(dup.status).toBe(400);
    const badName = await post('/api/users', { name: 'bad name!', role: 'member' });
    expect(badName.status).toBe(400);
    const badRole = await post('/api/users', { name: 'bob', role: 'root' });
    expect(badRole.status).toBe(400);
  });

  it('attributes audit entries to the acting member', async () => {
    const token = memberToken[0];
    const stage = await api('/api/stage', {
      method: 'POST',
      headers: { 'x-git2-token': token },
      body: JSON.stringify({ repo: repoDir, file: 'a.txt', action: 'stage' }),
    });
    expect(stage.status).toBe(200);
    await api('/api/stage', {
      method: 'POST',
      headers: { 'x-git2-token': token },
      body: JSON.stringify({ repo: repoDir, file: 'a.txt', action: 'unstage' }),
    });
    const raw = await fsp.readFile(path.join(homeDir, 'audit.log'), 'utf8');
    const entries = raw.trim().split('\n').map((line) => JSON.parse(line));
    const entry = entries.find((e) => e.action === 'stage' && e.user === 'alice');
    expect(entry).toBeTruthy();
    expect(entry.role).toBe('member');
  });

  it('exports and merges the team configuration', async () => {
    const exported = await get('/api/team/config');
    expect(exported.status).toBe(200);
    expect(exported.json.version).toBe(1);
    expect(exported.json.repos).toContain(repoDir);
    expect(exported.json.members.map((m) => m.name)).toContain('alice');
    expect(JSON.stringify(exported.json)).not.toContain('tokenHash');

    const imported = await post('/api/team/config', {
      repos: [repoDir, '/definitely/not/a/repo'],
      mode: 'merge',
    });
    expect(imported.status).toBe(200);
    expect(imported.json.imported).toBe(1);
    expect(imported.json.repos).toContain(repoDir);

    const rejected = await post('/api/team/config', { repos: ['/definitely/not/a/repo'] });
    expect(rejected.status).toBe(400);
  });

  it('revokes a member token', async () => {
    const removed = await api('/api/users', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice' }),
    });
    expect(removed.status).toBe(200);
    const me = await api('/api/me', { headers: { 'x-git2-token': memberToken[0] } });
    expect(me.status).toBe(401);
  });
});

describe('pull request checkout', () => {
  it('creates a local branch from the pull request head without switching', async () => {
    const origin = path.join(tmpRoot, 'pr-origin.git');
    const clone = path.join(tmpRoot, 'pr-clone');
    git(['init', '--bare', origin], tmpRoot);
    git(['init', '-b', 'main', clone], tmpRoot);
    git(['config', 'user.email', 'tester@example.com'], clone);
    git(['config', 'user.name', 'Tester'], clone);
    await fsp.writeFile(path.join(clone, 'a.txt'), 'one\n', 'utf8');
    git(['add', '.'], clone);
    git(['commit', '-m', 'first'], clone);
    git(['remote', 'add', 'origin', origin], clone);
    git(['push', '-u', 'origin', 'main'], clone);
    git(['push', 'origin', 'main:refs/pull/9/head'], clone);
    expect((await post('/api/repos/add', { repo: clone })).status).toBe(200);

    const r = await post('/api/pr/checkout', { repo: clone, number: 9 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, branch: 'pr-9' });
    expect(r.json.sha).toMatch(/\w{7,}/);
    const list = git(['branch', '--list', 'pr-9'], clone).trim();
    expect(list).toContain('pr-9');

    const again = await post('/api/pr/checkout', { repo: clone, number: 9 });
    expect(again.status).toBe(409);
    const bad = await post('/api/pr/checkout', { repo: clone, number: 0 });
    expect(bad.status).toBe(400);
  });
});

describe('input validation boundaries', () => {
  it('rejects option-like and traversal ref names', async () => {
    const dash = await get(`/api/compare?repo=${q(repoDir)}&base=--help&head=main`);
    expect(dash.status).toBe(400);
    const traversal = await get(`/api/compare?repo=${q(repoDir)}&base=main..main&head=main`);
    expect(traversal.status).toBe(400);
    const same = await get(`/api/compare?repo=${q(repoDir)}&base=main&head=main`);
    expect(same.status).toBe(400);
    const branch = await post('/api/branch/create', { repo: repoDir, name: '-danger' });
    expect(branch.status).toBe(400);
    const tag = await post('/api/tag/create', { repo: repoDir, name: 'bad name' });
    expect(tag.status).toBe(400);
  });

  it('rejects oversized commit and tag messages', async () => {
    const commit = await post('/api/commit', { repo: repoDir, message: 'x'.repeat(501) });
    expect(commit.status).toBe(400);
    const tag = await post('/api/tag/create', { repo: repoDir, name: 'long-tag', message: 'y'.repeat(301) });
    expect(tag.status).toBe(400);
  });

  it('rejects non-network remote urls and invalid stash indexes', async () => {
    const fileUrl = await post('/api/remote/add', { repo: repoDir, name: 'evil', url: 'file:///etc/passwd' });
    expect(fileUrl.status).toBe(400);
    const localPath = await post('/api/remote/add', { repo: repoDir, name: 'evil', url: '/tmp/repo' });
    expect(localPath.status).toBe(400);
    const stash = await post('/api/stash/apply', { repo: repoDir, index: -1 });
    expect(stash.status).toBe(400);
    const huge = await post('/api/stash/apply', { repo: repoDir, index: 100 });
    expect(huge.status).toBe(400);
  });
});

describe('server-sent events', () => {
  it('sends a hello frame on connect', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { 'x-git2-token': 'dev-token' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"type":"hello"');
    reader.cancel();
  });
});

describe('audit log endpoint and retention', () => {
  it('returns entries newest first with a total', async () => {
    const r = await get('/api/audit?limit=50');
    expect(r.status).toBe(200);
    expect(r.json.entries.length).toBeLessThanOrEqual(50);
    expect(r.json.total).toBeGreaterThan(0);
    expect(r.json.entries.length).toBeGreaterThan(1);
    // newest first: timestamps must be non-increasing
    const times = r.json.entries.slice(0, 3).map((e) => e.at);
    expect(times[0] >= times[1]).toBe(true);
    expect(times[1] >= times[2]).toBe(true);
  });

  it('rejects a non-numeric or over-long limit', async () => {
    expect((await get('/api/audit?limit=abc')).status).toBe(400);
    expect((await get('/api/audit?limit=99999')).status).toBe(400);
  });

  it('honours a small limit and the 1000 cap', async () => {
    const one = await get('/api/audit?limit=1');
    expect(one.status).toBe(200);
    expect(one.json.entries).toHaveLength(1);
    const capped = await get('/api/audit?limit=1000');
    expect(capped.status).toBe(200);
    expect(capped.json.entries.length).toBeLessThanOrEqual(1000);
  });

  it('filters entries by text and outcome across the whole file', async () => {
    const auditFile = path.join(homeDir, 'audit.log');
    const at = (i) => new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString();
    const seed = [
      { at: at(0), ok: true, action: 'stage', repo: repoDir },
      { at: at(1), ok: false, action: 'stage', repo: repoDir },
      { at: at(2), ok: true, action: 'save', repo: repoDir, file: 'a.txt' },
      { at: at(3), ok: true, action: 'branch-create', repo: repoDir },
      { at: at(4), ok: true, action: 'save', repo: repoDir, file: 'b.txt' },
    ];
    await fsp.writeFile(auditFile, `${seed.map((e) => JSON.stringify(e)).join('\n')}\n`);

    const text = await get('/api/audit?limit=1000&q=stage');
    expect(text.status).toBe(200);
    expect(text.json.total).toBe(2);
    expect(text.json.entries.every((e) => e.action === 'stage')).toBe(true);
    // case-insensitive, and matches the summary fields (repo basename)
    const upper = await get('/api/audit?limit=1000&q=STAGE');
    expect(upper.json.total).toBe(2);

    const fails = await get('/api/audit?limit=1000&outcome=fail');
    expect(fails.json.total).toBe(1);
    expect(fails.json.entries[0].ok).toBe(false);
    expect(fails.json.entries[0].action).toBe('stage');

    const success = await get('/api/audit?limit=1000&outcome=ok');
    expect(success.json.total).toBe(4);
    expect(success.json.entries.every((e) => e.ok !== false)).toBe(true);

    const combined = await get('/api/audit?limit=1000&q=stage&outcome=fail');
    expect(combined.json.total).toBe(1);
    expect(combined.json.entries[0].action).toBe('stage');

    const noMatch = await get('/api/audit?limit=1000&q=nonexistent-action');
    expect(noMatch.status).toBe(200);
    expect(noMatch.json.total).toBe(0);
    expect(noMatch.json.entries).toEqual([]);

    // invalid parameters rejected at the route
    expect((await get('/api/audit?outcome=bogus')).status).toBe(400);
    expect((await get(`/api/audit?q=${'x'.repeat(101)}`)).status).toBe(400);
  });

  it('rotates the file once the size threshold is crossed', async () => {
    // The isolated audit path is built from the server's home dir; never use
    // the test process's configPaths(), which would resolve the real home when
    // PR_HELPER_HOME is not set in the vitest process.
    const auditFile = path.join(homeDir, 'audit.log');
    // Seed a valid JSONL file larger than the rotation threshold.
    const line = JSON.stringify({ at: new Date().toISOString(), action: 'seed' });
    const perLine = line.length + 1;
    const count = Math.ceil(AUDIT_ROTATE_BYTES / perLine) + 10;
    await fsp.writeFile(auditFile, `${(`${line}\n`).repeat(count)}`);
    expect((await fsp.stat(auditFile)).size).toBeGreaterThan(AUDIT_ROTATE_BYTES);

    // An audited write appends one line and triggers the rotation.
    await fsp.writeFile(path.join(repoDir, 'rot-trigger.txt'), 'rotate\n', 'utf8');
    const staged = await post('/api/stage', {
      repo: repoDir,
      action: 'stage',
      file: 'rot-trigger.txt',
    });
    expect(staged.status).toBe(200);

    expect((await fsp.stat(auditFile)).size).toBeLessThanOrEqual(AUDIT_ROTATE_BYTES);
    const r = await get('/api/audit?limit=1000');
    expect(r.status).toBe(200);
    expect(r.json.total).toBeLessThanOrEqual(AUDIT_KEEP_ENTRIES);
    expect(r.json.entries[0].action).toBe('stage');
  });
});

describe('file save endpoint', () => {
  const scratch = 'save-scratch.txt';

  beforeAll(async () => {
    await fsp.writeFile(path.join(repoDir, scratch), 'initial content\n', 'utf8');
  });

  it('exposes the working-tree mtime', async () => {
    const r = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    expect(r.status).toBe(200);
    expect(typeof r.json.mtimeMs).toBe('number');
    expect(r.json.content).toBe('initial content\n');
    expect(r.json.ref).toBeNull();
  });

  it('saves content atomically and returns the new mtime', async () => {
    const before = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    const r = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: 'updated content\n',
      expectedMtime: before.json.mtimeMs,
    });
    expect(r.status).toBe(200);
    expect(r.json.bytes).toBe(Buffer.byteLength('updated content\n'));
    expect(typeof r.json.mtimeMs).toBe('number');
    expect(r.json.mtimeMs).not.toBe(before.json.mtimeMs);
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe('updated content\n');
  });

  it('rejects invalid and sensitive payloads', async () => {
    const base = { repo: repoDir, file: scratch };
    expect((await post('/api/save', { ...base, content: 123 })).status).toBe(400);
    expect((await post('/api/save', { ...base, content: 'bad\0byte' })).status).toBe(400);
    // The save route accepts up to 1 MB of text, so a 1 MB + 1 byte body must
    // reach the handler and be rejected there (400), not by the generic body
    // cap (413).
    expect((await post('/api/save', {
      ...base,
      content: 'x'.repeat(1024 * 1024 + 1),
    })).status).toBe(400);
    expect((await post('/api/save', {
      repo: repoDir,
      file: '.env',
      content: 'X=1\n',
    })).status).toBe(403);
    expect((await post('/api/save', {
      repo: repoDir,
      file: 'src',
      content: 'x',
    })).status).toBe(400);
  });

  it('saves a file larger than a typical API body limit', async () => {
    const big = `${'0123456789abcdef'.repeat(20_000)}\n`; // ~320 KB
    const r = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: big,
      expectedMtime: (await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`)).json.mtimeMs,
    });
    expect(r.status).toBe(200);
    expect(r.json.bytes).toBe(Buffer.byteLength(big, 'utf8'));
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe(big);
  });

  it('rejects a stale save with 409 and accepts the fresh mtime', async () => {
    const loaded = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    // Change the file outside the app.
    await fsp.writeFile(path.join(repoDir, scratch), 'external change\n', 'utf8');
    const stale = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: 'app change\n',
      expectedMtime: loaded.json.mtimeMs,
    });
    expect(stale.status).toBe(409);
    // The external content must survive the rejected save.
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe('external change\n');

    const fresh = await get(`/api/file?repo=${q(repoDir)}&file=${q(scratch)}`);
    const ok = await post('/api/save', {
      repo: repoDir,
      file: scratch,
      content: 'app change\n',
      expectedMtime: fresh.json.mtimeMs,
    });
    expect(ok.status).toBe(200);
    expect(await fsp.readFile(path.join(repoDir, scratch), 'utf8')).toBe('app change\n');
  });
});

describe('git config routes', () => {
  it('lists whitelisted entries with local and effective values', async () => {
    const r = await get(`/api/config?repo=${q(repoDir)}`);
    expect(r.status).toBe(200);
    const keys = r.json.entries.map((e) => e.key);
    expect(keys).toContain('user.name');
    expect(keys).toContain('core.autocrlf');
    // Non-whitelisted keys are never exposed.
    expect(keys).not.toContain('core.sshCommand');
    // user.name is a repository-local value set in beforeAll.
    const name = r.json.entries.find((e) => e.key === 'user.name');
    expect(name.local).toBe('Tester');
    expect(name.effective).toBe('Tester');
    expect(name.inherited).toBe(false);
    // Enum entries expose their allowed options.
    const autocrlf = r.json.entries.find((e) => e.key === 'core.autocrlf');
    expect(autocrlf.options).toContain('input');
    // An unset key is null locally and inherited.
    const rebase = r.json.entries.find((e) => e.key === 'pull.rebase');
    expect(rebase.local).toBeNull();
    expect(rebase.inherited).toBe(true);
  });

  it('writes a whitelisted enum and a text value to local config', async () => {
    const en = await post('/api/config', { repo: repoDir, key: 'pull.rebase', value: 'true' });
    expect(en.status).toBe(200);
    expect(en.json.local).toBe('true');
    expect(git(['config', '--local', '--get', 'pull.rebase'], repoDir).trim()).toBe('true');

    const tx = await post('/api/config', { repo: repoDir, key: 'init.defaultBranch', value: 'trunk' });
    expect(tx.status).toBe(200);
    expect(git(['config', '--local', '--get', 'init.defaultBranch'], repoDir).trim()).toBe('trunk');

    // Reloading reflects the new local overrides (no longer inherited).
    const list = await get(`/api/config?repo=${q(repoDir)}`);
    const rebase = list.json.entries.find((e) => e.key === 'pull.rebase');
    expect(rebase.inherited).toBe(false);
    expect(rebase.effective).toBe('true');
  });

  it('rejects non-whitelisted keys, bad enum values and invalid emails', async () => {
    const badKey = await post('/api/config', { repo: repoDir, key: 'core.sshCommand', value: 'x' });
    expect(badKey.status).toBe(400);
    const badEnum = await post('/api/config', { repo: repoDir, key: 'core.autocrlf', value: 'weird' });
    expect(badEnum.status).toBe(400);
    const badEmail = await post('/api/config', { repo: repoDir, key: 'user.email', value: 'nope' });
    expect(badEmail.status).toBe(400);
    // The rejected email must not overwrite the configured local value.
    expect(git(['config', '--local', '--get', 'user.email'], repoDir).trim()).toBe('tester@example.com');
  });

  it('unsets local overrides and is idempotent for a missing key', async () => {
    const rmRebase = await post('/api/config', { repo: repoDir, key: 'pull.rebase', value: '  ' });
    expect(rmRebase.status).toBe(200);
    expect(rmRebase.json.local).toBeNull();
    const rmBranch = await post('/api/config', { repo: repoDir, key: 'init.defaultBranch', value: '' });
    expect(rmBranch.status).toBe(200);
    // Unsetting an already-missing key is a successful no-op (git exit 5).
    const again = await post('/api/config', { repo: repoDir, key: 'merge.conflictstyle', value: '' });
    expect(again.status).toBe(200);

    // The overrides are gone and inheritance is restored.
    const list = await get(`/api/config?repo=${q(repoDir)}`);
    const rebase = list.json.entries.find((e) => e.key === 'pull.rebase');
    expect(rebase.local).toBeNull();
    expect(rebase.inherited).toBe(true);
    const branch = list.json.entries.find((e) => e.key === 'init.defaultBranch');
    expect(branch.local).toBeNull();
  });
});
