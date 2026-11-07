'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { serve, staticFile, MAX_BODY_BYTES } = require('../src/net/server');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'index.js');
const WEB = path.join(ROOT, 'web');

/** A response as the client sees it: status, headers, parsed body. */
async function call(app, method, urlPath, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(`${app.url}${urlPath}`, init);
  const type = response.headers.get('content-type') || '';
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    type,
    text,
    body: type.includes('json') ? JSON.parse(text) : null,
  };
}

/** Start a server on a free port, run `fn`, close it again. */
async function withApp(options, fn) {
  const app = await serve({
    host: '127.0.0.1',
    port: 0,
    timeMs: 30,
    version: 'test',
    ...options,
  });
  try {
    return await fn(app);
  } finally {
    if (typeof app.server.closeAllConnections === 'function') app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function untilTrue(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await sleep(20);
  return predicate();
}

/** The frames of an event-stream body, in order. Comment lines carry no event. */
function parseSse(text) {
  const frames = [];
  for (const block of text.split('\n\n')) {
    const event = /^event: (.+)$/m.exec(block);
    const data = /^data: (.+)$/m.exec(block);
    if (event && data) frames.push({ event: event[1], payload: JSON.parse(data[1]) });
  }
  return frames;
}

/**
 * A live stream as a client reads it. The reader runs in the background, so
 * `raw()` and `until(n)` see the frames as they arrive.
 */
function sseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const seen = { raw: '', done: false };
  const pump = async () => {
    for (;;) {
      const next = await reader.read();
      if (next.value) seen.raw += decoder.decode(next.value, { stream: true });
      if (next.done) {
        seen.done = true;
        break;
      }
    }
  };
  pump().catch(() => { seen.done = true; });

  async function gather(keep, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && keep()) await sleep(10);
    return parseSse(seen.raw);
  }

  return {
    /** The frames so far, waiting up to `timeoutMs` for at least `count` of them. */
    until: (count, timeoutMs = 5000) => gather(() => parseSse(seen.raw).length < count, timeoutMs),
    /** Everything the server sends before it closes the response. */
    drain: (timeoutMs = 1000) => gather(() => !seen.done, timeoutMs),
    raw: () => seen.raw,
    ended: () => seen.done,
    hangUp: () => reader.cancel().catch(() => {}),
  };
}

test('the web client is served, and a HEAD request carries the length without the body', async () => {
  await withApp({}, async (app) => {
    const page = await call(app, 'GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.text, /<title>clitafl/);
    assert.match(page.text, /<div id="board"/);

    const script = await call(app, 'GET', '/app.js');
    assert.equal(script.status, 200);
    assert.match(script.type, /text\/javascript/);

    const css = await call(app, 'GET', '/style.css');
    assert.equal(css.status, 200);
    assert.match(css.type, /text\/css/);

    const head = await call(app, 'HEAD', '/index.html');
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
    assert.ok(Number(head.headers.get('content-length')) > 100);
    assert.equal(head.headers.get('cache-control'), 'no-cache');
  });
});

test('nothing above the web directory is reachable', async () => {
  await withApp({}, async (app) => {
    for (const probe of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/./../../src/index.js', '/style.css/../../package.json']) {
      const out = await call(app, 'GET', probe);
      assert.equal(out.status, 404, `${probe} is not served`);
      assert.match(out.text, /no file at/, `${probe} explains itself`);
    }
  });
});

test('staticFile resolves inside the root and refuses outside of it', () => {
  assert.equal(path.basename(staticFile(WEB, '/index.html')), 'index.html');
  assert.equal(path.basename(staticFile(WEB, '/')), 'index.html');
  assert.equal(staticFile(WEB, '/../package.json'), null);
  assert.equal(staticFile(WEB, '/style.css/../secret'), null);
  assert.equal(staticFile(WEB, '/missing.css'), null);
  assert.equal(staticFile(WEB, '/web'), null, 'a directory without an index.html is not served');
});

test('the API answers over HTTP, in JSON, with the state a client needs', async () => {
  await withApp({}, async (app) => {
    const health = await call(app, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.version, 'test');
    assert.equal(health.body.games_open, 0);

    const index = await call(app, 'GET', '/api');
    assert.equal(index.status, 200);
    assert.ok(index.body.endpoints.some((row) => row.path === '/api/levels'));

    const created = await call(app, 'POST', '/api/games', {
      variant: 'tablut',
      seats: { attacker: 'ai', defender: 'agent' },
      levels: 'easy',
      time_ms: 30,
    });
    assert.equal(created.status, 201);
    assert.match(created.type, /application\/json/);
    assert.equal(created.body.played.length, 1, 'the AI opened');
    const id = created.body.game.id;

    const move = created.body.game.legal_moves[0];
    const played = await call(app, 'POST', `/api/games/${id}/moves`, { from: move.from, to: move.to });
    assert.equal(played.status, 200);
    assert.ok(played.body.played.length >= 2, 'the AI seat answered');
    assert.equal(played.body.game.board.rows.length, 9);

    const list = await call(app, 'GET', '/api/games');
    assert.equal(list.body.games.length, 1);
    assert.equal(list.body.games[0].id, id);

    const closed = await call(app, 'DELETE', `/api/games/${id}`);
    assert.equal(closed.body.closed, id);
    assert.equal((await call(app, 'GET', `/api/games/${id}`)).status, 404);
  });
});

test('a browser from another origin is allowed to call the API', async () => {
  await withApp({}, async (app) => {
    const preflight = await call(app, 'OPTIONS', '/api/games', {});
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-clitafl-token/, 'a browser client may send a seat token');

    const get = await call(app, 'GET', '/api/levels');
    assert.equal(get.headers.get('access-control-allow-origin'), '*');
  });
});

test('the lobby, and a seat token arriving as a header, over a socket', async () => {
  await withApp({}, async (app) => {
    const opened = await call(app, 'POST', '/api/games', {
      variant: 'tablut',
      seats: { attacker: 'ai', defender: 'open' },
      levels: 'easy',
      time_ms: 30,
    });
    assert.equal(opened.status, 201, opened.text);
    const id = opened.body.game.id;
    assert.deepEqual(opened.body.open_seats, ['defender']);

    const board = await call(app, 'GET', '/api/lobby');
    assert.equal(board.body.games[0].id, id, 'the game is on the board');
    assert.equal(board.body.token_header, 'x-clitafl-token');

    const join = await call(app, 'POST', `/api/lobby/${id}/join`, { seat: 'defender', name: 'bot-7' });
    assert.equal(join.status, 200, join.text);
    const token = join.body.token;
    const move = join.body.game.legal_moves[0];

    const asJson = async (value) => {
      const response = await fetch(`${app.url}/api/games/${id}/moves`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-clitafl-token': value },
        body: JSON.stringify({ from: move.from, to: move.to }),
      });
      return { status: response.status, body: await response.json() };
    };

    const wrong = await asJson('not-the-token');
    assert.equal(wrong.status, 401, 'a header that is not this seat is no token');

    const mine = await asJson(token);
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.ok(mine.body.played.length >= 2, 'the AI seat answers in the same reply, tokened seat as any other');
  });
});

test('a request that cannot be answered is a status and a message, never a stack trace', async () => {
  await withApp({}, async (app) => {
    const brokenJson = await call(app, 'POST', '/api/games', '{"variant": ');
    assert.equal(brokenJson.status, 400);
    assert.match(brokenJson.body.error, /not valid JSON/);

    const unknownFile = await call(app, 'GET', '/nope.css');
    assert.equal(unknownFile.status, 404);
    assert.match(unknownFile.body.hint, /the API is \/api/);

    const unknownApi = await call(app, 'GET', '/api/nope');
    assert.equal(unknownApi.status, 404);
    assert.match(unknownApi.body.hint, /GET \/api/);

    const verb = await call(app, 'POST', '/style.css', {});
    assert.equal(verb.status, 405);
    assert.match(verb.headers.get('allow'), /GET/);

    const badGame = await call(app, 'POST', '/api/games', { variant: 'dominoes' });
    assert.equal(badGame.status, 400);
    assert.ok(!/node_modules|\.js:\d+|\n    at /.test(badGame.text), 'the message carries no stack trace');
  });
});

test('a body larger than the cap is refused', async () => {
  assert.equal(MAX_BODY_BYTES, 1024 * 1024);
  await withApp({ maxBodyBytes: 256 }, async (app) => {
    const huge = await call(app, 'POST', '/api/games', JSON.stringify({ variant: 'tablut', seed: 'x'.repeat(4000) }));
    assert.equal(huge.status, 413);
    assert.match(huge.body.error, /larger than 256 bytes/);

    const small = await call(app, 'POST', '/api/games', { variant: 'tablut', seats: { attacker: 'human', defender: 'human' } });
    assert.equal(small.status, 201);
  });
});

test('the server keeps the number of games it was configured for', async () => {
  await withApp({ maxGames: 1, root: WEB }, async (app) => {
    const first = await call(app, 'POST', '/api/games', { seats: { attacker: 'human', defender: 'human' } });
    assert.equal(first.status, 201);
    const second = await call(app, 'POST', '/api/games', { seats: { attacker: 'human', defender: 'human' } });
    assert.equal(second.status, 409);
    assert.match(second.body.error, /1 games open/);
    assert.equal((await call(app, 'GET', '/api/health')).body.max_games, 1);

    const freed = await call(app, 'DELETE', `/api/games/${first.body.game.id}`);
    assert.equal(freed.status, 200);
    assert.equal((await call(app, 'POST', '/api/games', { seats: { attacker: 'human', defender: 'human' } })).status, 201);
  });
});

test('a server with a state directory keeps what the socket plays, and says where', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clitafl-state-'));
  try {
    await withApp({ stateDir: dir }, async (app) => {
      assert.equal(app.store.stateDir, dir);
      assert.equal((await call(app, 'GET', '/api/health')).body.state_dir, dir, 'health points at the directory');

      const created = await call(app, 'POST', '/api/games', { variant: 'brandub', seats: { attacker: 'agent', defender: 'agent' }, auto: false });
      const id = created.body.game.id;
      const file = path.join(dir, `${id}.json`);
      assert.ok(fs.existsSync(file), 'a game opened over HTTP is on disk at once');
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(onDisk.format, 'clitafl-save-v1', 'as a save file');
      assert.equal(onDisk.variant, 'brandub');
      assert.equal(onDisk.session.seats.defender, 'human', 'the agent seat is written as the caller seat');

      const move = created.body.game.legal_moves[0];
      const played = await call(app, 'POST', `/api/games/${id}/moves`, { from: move.from, to: move.to });
      assert.equal(played.status, 200);
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ply, played.body.game.ply, 'the move is on disk as soon as it is played');

      const resumed = await call(app, 'POST', '/api/games', { load: onDisk });
      assert.equal(resumed.status, 201, 'a file from the directory is a save file the API takes back');

      await call(app, 'DELETE', `/api/games/${id}`);
      assert.ok(!fs.existsSync(file), 'and the file goes with the game');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('serve listens where it is told and reports a usable url', async () => {
  const app = await serve({ host: '127.0.0.1', port: 0, version: 'test' });
  try {
    assert.ok(app.port > 0, 'port 0 asks the operating system for a free one');
    assert.equal(app.url, `http://127.0.0.1:${app.port}`);
    assert.equal(app.root, WEB, 'the default client is the web directory of the package');
    const health = await call(app, 'GET', '/api/health');
    assert.equal(health.body.ok, true);
  } finally {
    if (typeof app.server.closeAllConnections === 'function') app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('the events route streams a game over a socket: the state, every ply, and the close', async () => {
  await withApp({ keepAliveMs: 100 }, async (app) => {
    const created = await call(app, 'POST', '/api/games', { seats: { attacker: 'human', defender: 'human' } });
    assert.equal(created.status, 201);
    const id = created.body.game.id;

    const response = await fetch(`${app.url}/api/games/${id}/events`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
    assert.equal(response.headers.get('access-control-allow-origin'), '*', 'a page on another origin may watch');

    const stream = sseReader(response);
    const opening = await stream.until(1);
    assert.equal(opening[0].event, 'state', 'the stream starts with the state');
    assert.equal(opening[0].payload.id, id);
    assert.equal(opening[0].payload.ply, 0);
    assert.ok(opening[0].payload.legal_moves.length > 0, 'the state carries the legal moves');
    assert.match(stream.raw(), /:clitafl events/, 'the stream says what it is');
    assert.equal(app.store.get(id).watchers.size, 1, 'the connection owns one watcher');

    const move = opening[0].payload.legal_moves[0];
    await call(app, 'POST', `/api/games/${id}/moves`, { from: move.from, to: move.to });
    const afterMove = await stream.until(3);
    assert.deepEqual(afterMove.map((frame) => frame.event), ['state', 'ply', 'state'], 'the move lands as a ply, then the state');
    assert.equal(afterMove[1].payload.san, move.san, 'the ply carries the move that was played');
    assert.equal(afterMove[1].payload.seat, 'human');
    assert.equal(afterMove[2].payload.ply, 1, 'the state carries the new ply');

    await call(app, 'POST', `/api/games/${id}/resign`, {});
    const over = await stream.until(4);
    assert.equal(over[3].event, 'state');
    assert.equal(over[3].payload.is_over, true);
    assert.equal(over[3].payload.winner, 'attacker', 'the defenders resigned');

    const closed = await call(app, 'DELETE', `/api/games/${id}`);
    assert.equal(closed.status, 200);
    const last = await stream.drain();
    assert.equal(last[4].event, 'closed', 'the close is announced');
    assert.equal(last[4].payload.id, id);
    assert.ok(stream.ended(), 'the server ends the response after the close');
  });
});

test('the stream refuses what it is not, keeps a quiet connection, and forgets a client that hangs up', async () => {
  await withApp({ keepAliveMs: 100, maxWatchers: 1 }, async (app) => {
    const created = await call(app, 'POST', '/api/games', { seats: { attacker: 'human', defender: 'human' } });
    const id = created.body.game.id;

    const index = await call(app, 'GET', '/api');
    assert.ok(index.body.endpoints.some((row) => row.path === '/api/games/:id/events'), 'the stream is in the index over HTTP');

    const post = await call(app, 'POST', `/api/games/${id}/events`, {});
    assert.equal(post.status, 405);
    assert.match(post.headers.get('allow'), /GET/);

    const missing = await call(app, 'GET', '/api/games/nope/events');
    assert.equal(missing.status, 404);
    assert.match(missing.type, /application\/json/, 'a game that is not there is a normal JSON answer');
    assert.match(missing.body.error, /nope/);

    const response = await fetch(`${app.url}/api/games/${id}/events`);
    const stream = sseReader(response);
    await stream.until(1);
    assert.equal(app.store.get(id).watchers.size, 1);

    const crowded = await call(app, 'GET', `/api/games/${id}/events`);
    assert.equal(crowded.status, 409, 'the watcher cap is answered as JSON');
    assert.match(crowded.body.error, /watchers/);

    assert.ok(await untilTrue(() => /:ping/.test(stream.raw()), 600),
      'a quiet stream keeps the connection with a comment line');

    await stream.hangUp();
    assert.ok(await untilTrue(() => app.store.get(id).watchers.size === 0),
      'a client that goes away stops being a watcher');

    const second = await fetch(`${app.url}/api/games/${id}/events`);
    const again = sseReader(second);
    const state = await again.until(1);
    assert.equal(state[0].payload.ply, 0, 'a new watcher gets the state from the start');
    await again.hangUp();
    assert.ok(await untilTrue(() => app.store.get(id).watchers.size === 0),
      'and it is forgotten when it goes');
  });
});

/** Read the child's stdout until it announces the port it bound. */
function readPort(child, stream = 'stdout') {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`no url announced, output was: ${text}`)), 8000);
    child[stream].on('data', (chunk) => {
      text += chunk;
      const found = /http:\/\/127\.0\.0\.1:(\d+)\/api/.exec(text);
      if (found) {
        clearTimeout(timer);
        resolve({ port: Number(found[1]), text });
      }
    });
    child.on('error', reject);
  });
}

test('the serve command of the CLI opens the board and the API on one port', async () => {
  const child = spawn(process.execPath, [ENTRY, 'serve', '--port', '0', '--time', '30'], {
    cwd: ROOT,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const exitCode = new Promise((resolve) => child.on('exit', resolve));
  let port = null;
  try {
    const announced = await readPort(child);
    port = announced.port;
    assert.match(announced.text, /the web client, click to move/);

    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);

    const created = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'copenhagen', seats: { attacker: 'ai', defender: 'agent' }, levels: 'easy', time_ms: 30 }),
    });
    assert.equal(created.status, 201);
    const { game } = await created.json();
    assert.equal(game.variant.id, 'copenhagen');
    assert.equal(game.turn, 'defender', 'the AI opened the game');

    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.games_open, 1);

    child.kill('SIGTERM');
    assert.equal(await exitCode, 0, 'ctrl-c stops the server cleanly');
  } finally {
    child.kill('SIGKILL');
  }
});
