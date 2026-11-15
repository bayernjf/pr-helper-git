import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  githubRequest,
  parseProxyUrl,
  parseScutilProxy,
  resolveProxy,
} from './github-http.mjs';

const SCUTIL = ` <dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
  }
  HTTPEnable : 1
  HTTPPort : 7900
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7900
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
}
`;

/** Serve one CONNECT tunnel and answer the tunnelled request with `response`. */
function startFakeProxy(response) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = '';
      let tunnelled = false;
      let answered = false;
      socket.on('data', (chunk) => {
        buffer += chunk.toString('latin1');
        if (!tunnelled) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end === -1) return;
          const head = buffer.slice(0, end);
          buffer = buffer.slice(end + 4);
          if (!head.startsWith('CONNECT ')) {
            socket.destroy();
            return;
          }
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          tunnelled = true;
        }
        if (tunnelled && !answered) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end === -1) return;
          const head = buffer.slice(0, end);
          buffer = buffer.slice(end + 4);
          answered = true;
          response(head, socket);
        }
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Refuse every CONNECT with the given status. */
function startRefusingProxy(status) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write(`HTTP/1.1 ${status} Bad Gateway\r\ncontent-length: 0\r\n\r\n`);
        socket.end();
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe('parseProxyUrl', () => {
  it('accepts http URLs with and without a scheme', () => {
    expect(parseProxyUrl('http://127.0.0.1:7900')).toEqual({ host: '127.0.0.1', port: 7900 });
    expect(parseProxyUrl('127.0.0.1:7900')).toEqual({ host: '127.0.0.1', port: 7900 });
  });

  it('rejects socks and malformed values', () => {
    expect(parseProxyUrl('socks5://127.0.0.1:7890')).toBeNull();
    expect(parseProxyUrl('')).toBeNull();
    expect(parseProxyUrl('http://host:not-a-port')).toBeNull();
  });
});

describe('parseScutilProxy', () => {
  it('reads an enabled HTTPS proxy', () => {
    expect(parseScutilProxy(SCUTIL)).toEqual({ host: '127.0.0.1', port: 7900 });
  });

  it('ignores a disabled HTTPS proxy', () => {
    expect(parseScutilProxy(SCUTIL.replace('HTTPSEnable : 1', 'HTTPSEnable : 0'))).toBeNull();
  });

  it('returns null for unrelated output', () => {
    expect(parseScutilProxy('')).toBeNull();
  });
});

describe('resolveProxy', () => {
  it('prefers HTTPS_PROXY over the system lookup', async () => {
    const runScutil = vi.fn(async () => SCUTIL);
    await expect(resolveProxy({ env: { HTTPS_PROXY: 'http://10.0.0.2:8888' }, runScutil })).resolves.toEqual({
      host: '10.0.0.2',
      port: 8888,
    });
    expect(runScutil).not.toHaveBeenCalled();
  });

  it('falls back to scutil and caches the lookup', async () => {
    const runScutil = vi.fn(async () => SCUTIL);
    const first = Date.now() + 10 * 60_000;
    await expect(resolveProxy({ env: {}, runScutil, now: first })).resolves.toEqual({ host: '127.0.0.1', port: 7900 });
    await expect(resolveProxy({ env: {}, runScutil, now: first + 1_000 })).resolves.toEqual({ host: '127.0.0.1', port: 7900 });
    expect(runScutil).toHaveBeenCalledTimes(1);
  });
});

describe('githubRequest through a CONNECT proxy', () => {
  it('sends the request through the tunnel and returns the response', async () => {
    let seen = '';
    const { server, port } = await startFakeProxy((head, socket) => {
      seen = head;
      const body = '{"ok":1}';
      socket.write(`HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`);
    });
    try {
      const result = await githubRequest('https://github.com/login/device/code', {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: 'client_id=test',
        proxy: { host: '127.0.0.1', port },
        transport: (socket) => socket,
        timeoutMs: 5_000,
      });
      expect(result.status).toBe(200);
      expect(result.text).toBe('{"ok":1}');
      expect(seen).toContain('POST /login/device/code HTTP/1.1');
      expect(seen.toLowerCase()).toContain('content-length: 14');
    } finally {
      await close(server);
    }
  });

  it('rejects when the proxy refuses the tunnel and fallback is disabled', async () => {
    const { server, port } = await startRefusingProxy(502);
    try {
      await expect(githubRequest('https://github.com/login/device/code', {
        proxy: { host: '127.0.0.1', port },
        transport: (socket) => socket,
        fallbackToDirect: false,
        timeoutMs: 5_000,
      })).rejects.toThrow(/CONNECT failed/);
    } finally {
      await close(server);
    }
  });

  it('rejects when the proxy is unreachable and fallback is disabled', async () => {
    const { server, port } = await startFakeProxy(() => {});
    await close(server);
    await expect(githubRequest('https://github.com/login/device/code', {
      proxy: { host: '127.0.0.1', port },
      fallbackToDirect: false,
      timeoutMs: 2_000,
    })).rejects.toThrow();
  });
});
