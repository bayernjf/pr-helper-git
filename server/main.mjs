#!/usr/bin/env node
// Local HTTP server: loopback-only, token-guarded Git API + GitHub proxy and
// static hosting for the built client in dist/.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTokenChecker, randomToken } from './security.mjs';
import { handleGitRoute } from './routes-git.mjs';
import { handleGithubRoute } from './routes-github.mjs';
import {
  addClient,
  ensureWatching,
  removeClient,
  watchedCount,
} from './watcher.mjs';
import { listRepos } from './store.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const MAX_BODY_BYTES = 256 * 1024;

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith('--port='));
const PORT = portArg ? Number(portArg.split('=')[1]) : 4789;
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`Invalid --port value: ${portArg}`);
  process.exit(1);
}

const isDev = process.env.GIT2_DEV === '1';
const TOKEN = isDev ? 'dev-token' : randomToken();
const tokenOk = createTokenChecker(TOKEN);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

// nosniff is added to every response so a browser never MIME-sniffs a reply
// into an executable context. The CSP is only meaningful on the HTML entry.
const NOSNIFF = { 'x-content-type-options': 'nosniff' };
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...NOSNIFF,
  });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // Signal the caller to emit a 413 before the socket is torn down;
      // destroying here would make the client see a bare ECONNRESET.
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  if (!size) return { value: {} };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { error: 'invalid JSON body' };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  try {
    // Token bootstrap: /?token=... sets an HttpOnly cookie, then redirects.
    if (pathname === '/' && url.searchParams.has('token')) {
      const given = url.searchParams.get('token');
      if (!tokenOk(given)) return sendJson(res, 401, { error: 'invalid token' });
      res.writeHead(302, {
        location: '/',
        'set-cookie': `git2_token=${given}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
      });
      return res.end();
    }

    if (pathname.startsWith('/api/')) {
      const presented = url.searchParams.get('token')
        || req.headers['x-git2-token']
        || (req.headers.cookie || '').match(/(?:^|;\s*)git2_token=([^;]+)/)?.[1]
        || (req.headers.authorization || '');
      if (!tokenOk(presented)) return sendJson(res, 401, { error: 'unauthorized' });

      // Server-sent events: long-lived stream for file-change notifications.
      if (pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          ...NOSNIFF,
        });
        res.write(`data: ${JSON.stringify({ type: 'hello', watched: watchedCount() })}\n\n`);
        addClient(res);
        const keepalive = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            clearInterval(keepalive);
          }
        }, 25000);
        req.on('close', () => {
          clearInterval(keepalive);
          removeClient(res);
        });
        return;
      }

      const body = req.method === 'POST' ? await readJsonBody(req) : { value: {} };
      if (body.tooLarge) {
        // Flush the 413 response first, then close the still-writing request
        // so the client receives a meaningful status instead of a reset.
        res.writeHead(413, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'close',
          ...NOSNIFF,
        });
        res.end(JSON.stringify({ error: 'request body too large' }));
        res.on('finish', () => req.destroy());
        return;
      }
      if (body.error) return sendJson(res, 400, { error: body.error });
      const ctx = {
        method: req.method,
        pathname,
        query: url.searchParams,
        body: body.value,
        headers: req.headers,
      };

      const gitResult = await handleGitRoute(ctx);
      if (gitResult) return sendJson(res, gitResult.status, gitResult.json);
      const githubResult = await handleGithubRoute(ctx);
      if (githubResult) return sendJson(res, githubResult.status, githubResult.json);
      return sendJson(res, 404, { error: 'not found' });
    }

    // Static files from dist/.
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const safe = rel.replace(/^\/+/, '');
    if (safe.includes('..') || safe.startsWith('/')) {
      res.writeHead(400, NOSNIFF);
      return res.end('bad path');
    }
    const abs = path.join(DIST_DIR, safe);
    if (!abs.startsWith(DIST_DIR + path.sep)) {
      res.writeHead(403, NOSNIFF);
      return res.end('forbidden');
    }
    const real = await fsp.realpath(abs);
    if (!real.startsWith(DIST_DIR + path.sep)) {
      res.writeHead(403, NOSNIFF);
      return res.end('forbidden');
    }
    const data = await fsp.readFile(real);
    const isHtml = path.extname(real) === '.html';
    const headers = {
      'content-type': MIME[path.extname(real)] || 'application/octet-stream',
      ...NOSNIFF,
      'referrer-policy': 'no-referrer',
    };
    if (isHtml) {
      // The entry must always be revalidated; hashed assets below are immutable.
      headers['cache-control'] = 'no-store';
      headers['content-security-policy'] = CONTENT_SECURITY_POLICY;
    } else {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    return res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        ...NOSNIFF,
      });
      return res.end('not found');
    }
    return sendJson(res, 500, { error: 'internal error', detail: String(err.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const bound = server.address().port;
  for (const repoPath of await listRepos()) {
    ensureWatching(repoPath);
  }
  if (isDev) {
    console.log(`API server (dev) → http://127.0.0.1:${bound}`);
  } else {
    console.log(`PR Helper Git2 → http://127.0.0.1:${bound}/?token=${TOKEN}`);
  }
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
