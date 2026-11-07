'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { handleApi } = require('./api');
const { GameStore } = require('./store');
const S = require('./state');

const MAX_BODY_BYTES = 1024 * 1024;
const KEEP_ALIVE_MS = 15000;

/** `GET /api/games/<id>/events` — the one route the HTTP layer serves itself. */
const EVENTS_PATH = /^\/api\/games\/([^/]+)\/events$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** The request as the API wants it: method, path under `/api`, query, parsed JSON body. */
function readJson(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error(`body larger than ${maxBytes} bytes`);
        error.status = 413;
        chunks.length = 0;
        req.pause();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        const bad = new Error(`body is not valid JSON: ${error.message}`);
        bad.status = 400;
        reject(bad);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/**
 * Resolve a url path to a file inside `root`. Nothing outside the directory is
 * reachable: the path is normalised and then checked against the root.
 */
function staticFile(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const rel = decoded.replace(/^\/+/, '');
  const target = path.resolve(root, rel || 'index.html');
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    const inside = path.join(target, 'index.html');
    try {
      if (fs.statSync(inside).isFile()) return inside;
    } catch {
      return null;
    }
    return null;
  }
  return stat.isFile() ? target : null;
}

function sendFile(req, res, file, cors) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-cache',
    ...cors,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
};

/** One Server-Sent Events frame. */
function sseFrame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Open the push stream of one game: the current state at once, then every change the
 * store announces, and a comment line on a timer so a proxy keeps the connection.
 * The response owns its watcher: it is unsubscribed when the client goes away.
 */
function openEventStream(res, store, session, keepAliveMs = KEEP_ALIVE_MS) {
  // Take the watcher slot first: a crowded game answers as a normal 409, not as a
  // stream that opens and then dies.
  const stop = store.subscribe(session, (event, payload) => {
    res.write(sseFrame(event, payload));
    if (event === 'closed') res.end();
  });
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...CORS,
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(':clitafl events\n\n');
  res.write(sseFrame('state', S.gameView(session, { moves: 'turn' })));

  const ping = setInterval(() => res.write(':ping\n\n'), keepAliveMs);
  if (ping.unref) ping.unref();
  res.on('close', () => {
    clearInterval(ping);
    stop();
  });
}

/**
 * The HTTP app: `/api/*` goes to the JSON API, everything else is served from
 * `root` (the web client). Returns `{ handler, store }`; `createApp` wraps it in a server.
 */
function createHandler(options = {}) {
  const store = options.store || new GameStore(options);
  const version = options.version || '0';
  const root = path.resolve(options.root || path.join(__dirname, '..', '..', 'web'));

  async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    // The stream is not a JSON answer: the response object stays open, so the HTTP
    // layer serves this route itself and hands the API only the lookup.
    const watching = pathname.match(EVENTS_PATH);
    if (watching) {
      if (req.method !== 'GET') {
        sendJson(res, 405,
          { error: `${req.method} is not allowed on ${pathname}`, status: 405, allow: ['GET'] },
          { ...CORS, allow: 'GET' });
        return;
      }
      try {
        openEventStream(res, store, store.get(decodeURIComponent(watching[1])), options.keepAliveMs ?? KEEP_ALIVE_MS);
      } catch (error) {
        sendJson(res, error.status || 404, { error: error.message, status: error.status || 404 }, CORS);
      }
      return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const query = Object.fromEntries(url.searchParams.entries());
      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        try {
          body = await readJson(req, options.maxBodyBytes ?? MAX_BODY_BYTES);
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.message, status: error.status || 400 }, CORS);
          return;
        }
      }
      const out = handleApi(store, {
        method: req.method,
        path: pathname,
        query,
        body,
        version,
      });
      const headers = { ...CORS };
      if (out.status === 405 && Array.isArray(out.body.allow)) headers.allow = out.body.allow.join(', ');
      sendJson(res, out.status, out.body, headers);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405,
        { error: `${req.method} is not allowed on ${pathname}`, status: 405, allow: ['GET', 'HEAD'] },
        { ...CORS, allow: 'GET, HEAD' });
      return;
    }

    const file = staticFile(root, pathname);
    if (!file) {
      sendJson(res, 404, {
        error: `no file at ${pathname}`,
        status: 404,
        hint: 'the web client is index.html, the API is /api',
      }, CORS);
      return;
    }
    sendFile(req, res, file, CORS);
  }

  return { handler, store, root };
}

/** An `http.Server` for the app, not listening yet. */
function createApp(options = {}) {
  const { handler, store, root } = createHandler(options);
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { error: `server error: ${error.message}`, status: 500 }, CORS);
    });
  });
  return { server, store, root };
}

/** Listen and report the address, so the CLI can print a usable URL. */
function serve(options = {}) {
  const { server, store, root } = createApp(options);
  const host = options.host || '127.0.0.1';
  const port = options.port === undefined ? 8080 : Number(options.port);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port }, () => {
      const address = server.address();
      resolve({
        server,
        store,
        root,
        host: address.address,
        port: address.port,
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
      });
    });
  });
}

module.exports = {
  createApp,
  createHandler,
  serve,
  staticFile,
  readJson,
  sseFrame,
  openEventStream,
  CORS,
  MAX_BODY_BYTES,
  KEEP_ALIVE_MS,
};
