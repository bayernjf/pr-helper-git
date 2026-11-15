// Proxy-aware HTTPS client for the GitHub OAuth endpoints that live on
// github.com. api.github.com is reachable directly on this network, but
// github.com is often only reachable through the macOS system proxy, and
// Node's global fetch does not honour proxy settings. Only this module is
// allowed to talk to github.com; keep the surface tiny and never log headers
// or bodies (they can contain device codes and tokens).

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { execFile } from 'node:child_process';

const PROXY_CACHE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {{ host: string, port: number }} ProxyConfig
 * @typedef {{
 *   status: number,
 *   headers: Record<string, string | string[] | undefined>,
 *   text: string,
 * }} GithubHttpResponse
 * @typedef {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string | Buffer,
 *   timeoutMs?: number,
 *   proxy?: ProxyConfig | null,
 *   fallbackToDirect?: boolean,
 *   transport?: (socket: import('node:net').Socket, servername: string) => import('node:net').Socket,
 * }} GithubRequestOptions
 */

/** @type {{ at: number, value: ProxyConfig | null }} */
let cachedProxy = { at: 0, value: null };

/**
 * Parse a proxy env value such as `http://127.0.0.1:7900` or
 * `127.0.0.1:7900`. SOCKS proxies are deliberately unsupported: the OAuth
 * calls only need a plain HTTP CONNECT tunnel.
 * @param {string | undefined} raw
 * @returns {ProxyConfig | null}
 */
export function parseProxyUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  const port = url.port ? Number(url.port) : 80;
  if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: url.hostname, port };
}

/**
 * Read `scutil --proxy` output. Only an enabled HTTPS proxy is usable here.
 * @param {string} text
 * @returns {ProxyConfig | null}
 */
export function parseScutilProxy(text) {
  const lines = String(text ?? '').split('\n');
  /** @param {string} key */
  const value = (key) => {
    const line = lines.find((entry) => entry.trim().startsWith(`${key} :`));
    if (!line) return '';
    return line.slice(line.indexOf(':') + 1).trim();
  };
  if (value('HTTPSEnable') !== '1') return null;
  const host = value('HTTPSProxy');
  const port = Number(value('HTTPSPort'));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

/** @returns {Promise<string>} */
function readScutilProxy() {
  return new Promise((resolve) => {
    execFile('scutil', ['--proxy'], { timeout: 2000 }, (error, stdout) => {
      resolve(error ? '' : String(stdout ?? ''));
    });
  });
}

/**
 * Resolve the proxy: env first, then (macOS only) the system settings.
 * The system lookup is cached for a minute and never throws.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   runScutil?: () => Promise<string>,
 *   now?: number,
 * }} [options]
 * @returns {Promise<ProxyConfig | null>}
 */
export async function resolveProxy(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = parseProxyUrl(env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy);
  if (fromEnv) return fromEnv;

  const now = options.now ?? Date.now();
  if (now - cachedProxy.at < PROXY_CACHE_MS) return cachedProxy.value;
  if (process.platform !== 'darwin' && !options.runScutil) return null;

  const text = await (options.runScutil ?? readScutilProxy)();
  const value = parseScutilProxy(text);
  cachedProxy = { at: now, value };
  return value;
}

/**
 * Collect a response body into a decoded string.
 * @param {http.IncomingMessage} response
 * @returns {Promise<GithubHttpResponse>}
 */
function collect(response) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode ?? 0,
      headers: response.headers,
      text: Buffer.concat(chunks).toString('utf8'),
    }));
    response.on('error', reject);
  });
}

/**
 * @param {URL} url
 * @param {GithubRequestOptions} options
 * @returns {Promise<GithubHttpResponse>}
 */
function directRequest(url, options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers: options.headers,
      timeout: timeoutMs,
    }, (response) => {
      collect(response).then(resolve, reject);
    });
    request.on('timeout', () => request.destroy(new Error('github request timed out')));
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * Open a CONNECT tunnel through the proxy and wrap it in TLS.
 * @param {ProxyConfig} proxy
 * @param {string} hostname
 * @param {number} timeoutMs
 * @param {(socket: import('node:net').Socket, servername: string) => import('node:net').Socket} transport
 * @returns {Promise<import('node:net').Socket>}
 */
function connectTunnel(proxy, hostname, timeoutMs, transport) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${hostname}:443`,
      headers: { host: `${hostname}:443` },
      timeout: timeoutMs,
    });
    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed with status ${response.statusCode}`));
        return;
      }
      try {
        const secure = transport(socket, hostname);
        secure.once('error', reject);
        if (secure.connecting) secure.once('connect', () => resolve(secure));
        else resolve(secure);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    request.on('timeout', () => request.destroy(new Error('proxy CONNECT timed out')));
    request.on('error', reject);
    request.end();
  });
}

/**
 * @param {URL} url
 * @param {GithubRequestOptions} options
 * @param {ProxyConfig} proxy
 * @returns {Promise<GithubHttpResponse>}
 */
async function proxiedRequest(url, options, proxy) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport = options.transport ?? ((socket, servername) => tls.connect({ socket, servername }));
  const socket = await connectTunnel(proxy, url.hostname, timeoutMs, transport);
  const headers = { host: url.host, ...options.headers };
  // An Agent is the supported way to drive http.request over an existing
  // socket; passing createConnection with agent:false silently opens a new
  // direct connection instead of reusing the tunnel.
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => socket;
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers,
      agent,
    }, (response) => {
      collect(response).then(resolve, reject);
    });
    request.on('timeout', () => request.destroy(new Error('github request timed out')));
    request.on('error', (error) => {
      socket.destroy();
      reject(error);
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * Perform a request against github.com. Prefers the resolved proxy, retries
 * directly when the tunnel fails, and never throws on a non-2xx status.
 * @param {string | URL} target
 * @param {GithubRequestOptions} [options]
 * @returns {Promise<GithubHttpResponse>}
 */
export async function githubRequest(target, options = {}) {
  const url = typeof target === 'string' ? new URL(target) : target;
  if (url.protocol !== 'https:') throw new Error('githubRequest requires an https URL');

  const headers = { ...options.headers };
  if (options.body !== undefined && headers['content-length'] === undefined && headers['Content-Length'] === undefined) {
    headers['content-length'] = String(Buffer.byteLength(options.body));
  }
  const requestOptions = { ...options, headers };

  const proxy = options.proxy === undefined ? await resolveProxy() : options.proxy;
  if (proxy) {
    try {
      return await proxiedRequest(url, requestOptions, proxy);
    } catch (error) {
      if (options.fallbackToDirect === false) throw error;
    }
  }
  return directRequest(url, requestOptions);
}
