'use strict';

const V = require('../rules/variants');
const { LEVEL_IDS, levelOf } = require('../ai/player');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../rules/pieces');
const { parseMove, formatSquare, formatSan } = require('../rules/notation');
const S = require('./state');
const E = require('./errors');
const { seatsFrom, levelsFrom } = require('./store');

const MOVE_OPTIONS = ['turn', 'none', 'all'];
const SIDES = [SIDE_ATTACKER, SIDE_DEFENDER];
const MAX_THINK_MS = 30000;

function apiIndex(store, version) {
  return {
    name: 'clitafl',
    version,
    playing: [
      'POST /api/games {"variant":"tablut","seats":{"attacker":"ai","defender":"agent"}}',
      'GET  /api/games/<id>                                   the board, the turn, the legal moves',
      'POST /api/games/<id>/moves {"from":"d5","to":"d6"}      the AI answers in the same reply',
    ],
    endpoints: [
      { method: 'GET', path: '/api/health', about: 'server health, open games' },
      { method: 'GET', path: '/api/variants', about: 'the historical variants and their armies' },
      { method: 'GET', path: '/api/variants/:id?size=11', about: 'one variant, with its rules as text' },
      { method: 'GET', path: '/api/levels', about: 'the AI strength presets' },
      { method: 'GET', path: '/api/games', about: 'the open games; ?include=closed also lists finished ones' },
      { method: 'POST', path: '/api/games', about: 'open a game: variant, size, seats, levels, time_ms, seed, max_plies, load' },
      { method: 'GET', path: '/api/games/:id?moves=turn|none|all', about: 'full state: board, turn, legal moves, history' },
      { method: 'POST', path: '/api/games/:id/moves', about: 'play {from,to} as the seat the caller controls' },
      { method: 'POST', path: '/api/games/:id/ai', about: 'let the AI seats play: {moves:n} plies, {moves:"all"} while an AI seat is to move' },
      { method: 'POST', path: '/api/games/:id/hint', about: 'search a move without playing it: {side, level, time_ms}' },
      { method: 'POST', path: '/api/games/:id/undo', about: 'take back {plies:n} plies' },
      { method: 'POST', path: '/api/games/:id/resign', about: 'resign for {side}' },
      { method: 'POST', path: '/api/games/:id/seats', about: 'hand a seat to the AI or back: {seats, levels, time_ms}' },
      { method: 'GET', path: '/api/games/:id/moves?since=ply', about: 'the record, from ply `since` on' },
      { method: 'GET', path: '/api/games/:id/rules', about: 'the rules of the variant being played' },
      { method: 'GET', path: '/api/games/:id/export', about: 'the save file of the game; POST it back as {load: ...} to resume' },
      { method: 'GET', path: '/api/games/:id/events', about: 'a Server-Sent Events stream of the game: "ply" per move, then "state", and "closed" (text/event-stream)' },
      { method: 'DELETE', path: '/api/games/:id', about: 'close a game and free its slot' },
    ],
    seats: {
      kinds: ['human', 'ai', 'agent'],
      about: 'who controls a side: `ai` is played by the server search, `human` and `agent` by the caller',
    },
    notes: [
      'the game is public information: legal_moves lists every move of the side to move',
      'a move is {from,to,piece,san}: piece is king | defender | attacker, san is what you post back',
      'a reply carries `played`, the plies of the whole exchange: your move, then each AI seat in turn',
      'opening a game plays the opening ply when the opening seat is the AI; {"auto":false} keeps it for the caller',
      'a POST /moves reply plays every AI seat in turn, so one request covers one exchange',
      'GET /api/games/:id/events pushes that game as Server-Sent Events: "ply" per move, then "state"',
      'the search is synchronous: a long time_ms blocks that one request, and is capped at 30 s',
      'a failure is one readable sentence: {"error": "...", "status": n}, with 400, 404, 405, 409, 413',
    ],
    games_open: store.size,
  };
}

function moveOptions(query) {
  const value = (query.moves || 'turn').toLowerCase();
  if (!MOVE_OPTIONS.includes(value)) {
    throw E.badRequest(`moves expects ${MOVE_OPTIONS.join(' | ')}, got '${query.moves}'`);
  }
  return value;
}

function sideName(value, name = 'side') {
  const side = String(value).toLowerCase();
  if (!SIDES.includes(side)) throw E.badRequest(`${name} expects attacker | defender, got '${value}'`);
  return side;
}

function readMoveInput(body, size) {
  const text = body.move || (body.from && body.to ? `${body.from}-${body.to}` : null);
  if (!text) throw E.badRequest('a move needs { "from": "d5", "to": "d6" } or { "move": "d5-d6" }');
  try {
    return parseMove(size, text);
  } catch (error) {
    throw E.badRequest(error.message);
  }
}

function readTimeMs(value, name) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 1) throw E.badRequest(`${name} expects a positive number of milliseconds, got '${value}'`);
  return Math.min(ms, MAX_THINK_MS);
}

/** The server refuses to move for the AI: that seat is the search's. */
function claimSeat(session, side) {
  if (session.seats[side] === 'ai') {
    throw E.conflict(`the ${side} seat is played by the AI: let it answer with POST /api/games/${session.id}/ai, or take the seat over with POST /api/games/${session.id}/seats`);
  }
}

function requirePlaying(session) {
  if (session.game.isGameOver()) {
    throw E.conflict(`the game is over (${session.game.status}${session.game.reason ? `: ${session.game.reason}` : ''})`);
  }
}

function state(store, session, query = {}) {
  store.touch(session);
  return S.gameView(session, { moves: moveOptions(query) });
}

/**
 * The watchers of a game hear every change: one `ply` event per move played, then
 * the state, in the same shape `GET /api/games/:id` gives. The framing (SSE) lives
 * in `src/net/server.js`; this is the one place a change is announced.
 */
function announce(store, session, played = []) {
  for (const ply of played) store.publish(session, 'ply', ply);
  store.publish(session, 'state', S.gameView(session, { moves: 'turn' }));
}

function createGame(store, body, query) {
  const spec = { ...body };
  if (typeof spec.load === 'string') {
    try {
      spec.load = JSON.parse(spec.load);
    } catch {
      throw E.badRequest('load must be the save object written by GET /api/games/:id/export');
    }
  }
  const session = store.create(spec);
  // One opening ply at most: an all-AI game must not be played out by the request that opens it.
  const played = spec.auto === false ? [] : store.playAiSeats(session, 1);
  announce(store, session, played);
  return { status: 201, body: { ok: true, played, game: state(store, session, query) } };
}

function playForClient(store, session, body, query) {
  requirePlaying(session);
  const side = body.side ? sideName(body.side) : session.game.turn;
  if (side !== session.game.turn) throw E.conflict(`it is the ${session.game.turn} to move, not the ${side}`);
  claimSeat(session, side);
  const move = readMoveInput(body, session.game.board.size);

  let result;
  try {
    result = session.game.play(move);
  } catch (error) {
    throw E.badRequest(error.message);
  }
  const played = [store.plyRecord(session, result)];
  const auto = body.ai !== false && String(query.ai ?? 'true') !== 'false';
  if (auto) played.push(...store.playAiSeats(session));
  announce(store, session, played);
  return { body: { ok: true, played, game: state(store, session, query) } };
}

function playForAi(store, session, body) {
  requirePlaying(session);
  const wanted = body.moves ?? 'all';
  const played = [];
  if (wanted === 'all' || wanted === true) {
    played.push(...store.playAiSeats(session));
  } else {
    const count = Number(wanted);
    if (!Number.isInteger(count) || count < 1) throw E.badRequest(`moves expects a whole number of plies or "all", got '${body.moves}'`);
    for (let i = 0; i < count; i += 1) {
      const ply = store.playAiPly(session);
      if (!ply) break;
      played.push(ply);
    }
  }
  if (played.length === 0) {
    if (session.game.isGameOver()) requirePlaying(session);
    throw E.conflict(`the ${session.game.turn} seat is played by the caller, not the AI: read a move from GET /api/games/${session.id} and send it to /moves`);
  }
  announce(store, session, played);
  return { body: { ok: true, played, game: state(store, session) } };
}

function giveHint(store, session, body) {
  requirePlaying(session);
  const side = body.side ? sideName(body.side) : session.game.turn;
  const overrides = {};
  if (body.level) {
    try {
      levelOf(body.level);
    } catch (error) {
      throw E.badRequest(error.message);
    }
    overrides.level = String(body.level).toLowerCase();
  }
  if (body.time_ms !== undefined) overrides.timeMs = readTimeMs(body.time_ms, 'time_ms');

  const { move, info } = store.suggest(session, side, overrides);
  const size = session.game.board.size;
  if (!move) {
    return { body: { ok: true, hint: null, reason: `the ${side} has no legal move`, game: state(store, session) } };
  }
  return {
    body: {
      ok: true,
      hint: {
        side,
        from: formatSquare(size, move.from),
        to: formatSquare(size, move.to),
        san: formatSan(size, move, 0),
        level: overrides.level || session.levels[side],
        depth: info.depth,
        nodes: info.nodes,
        score: info.score,
      },
      game: state(store, session),
    },
  };
}

function changeSeats(store, session, body) {
  if (body.seats !== undefined) session.seats = seatsFrom(body.seats);
  if (body.levels !== undefined || body.level !== undefined) session.levels = levelsFrom(body.levels, body.level);
  const hasTime = body.time_ms !== undefined || body.time_ms_a !== undefined || body.time_ms_d !== undefined;
  if (hasTime) {
    for (const side of SIDES) {
      const perSide = side === SIDE_ATTACKER ? body.time_ms_a : body.time_ms_d;
      session.timeMs[side] = readTimeMs(perSide ?? body.time_ms, side === SIDE_ATTACKER ? 'time_ms_a' : 'time_ms_d');
    }
  }
  announce(store, session);
  return { body: { ok: true, game: state(store, session) } };
}

function gameMoves(store, session, query) {
  const since = query.since === undefined ? 0 : Number(query.since);
  if (!Number.isInteger(since) || since < 0) throw E.badRequest(`since expects a ply number, got '${query.since}'`);
  const history = session.game.history
    .map((entry, i) => S.plyView(session.game, entry, i))
    .slice(since);
  return { body: { id: session.id, ply: session.game.ply, moves: history } };
}

/** One line per endpoint: verb + path under `/api`, handler(store, ctx). */
const ROUTES = [
  ['GET', '', (store, ctx) => ({ body: apiIndex(store, ctx.version) })],
  ['GET', 'health', (store, ctx) => ({
    body: {
      ok: true,
      version: ctx.version,
      games_open: store.size,
      max_games: store.maxGames,
      max_watchers: store.maxWatchers,
      variants: V.VARIANT_IDS,
      levels: LEVEL_IDS,
      engine: 'negamax + alpha-beta, transposition table, killer moves, quiescence, opening book, time or node budget',
    },
  })],
  ['GET', 'variants', () => ({ body: { variants: V.describeVariants(), sizes: { min: V.MIN_SIZE, max: V.MAX_SIZE, odd: true } } })],
  ['GET', 'variants/:id', (store, ctx) => {
    const variant = getVariantOrThrow(ctx.params.id, ctx.query.size);
    return { body: { variant: S.variantView(variant), rules_text: S.rulesText(variant) } };
  }],
  ['GET', 'levels', () => ({ body: { levels: S.levelsView(), default: 'medium' } })],
  ['GET', 'games', (store, ctx) => ({
    body: {
      games: store.list()
        .filter((session) => ctx.query.include === 'closed' || !session.game.isGameOver())
        .map(S.summaryView),
    },
  })],
  ['POST', 'games', (store, ctx) => createGame(store, ctx.body, ctx.query)],
  ['GET', 'games/:id', (store, ctx) => ({ body: { game: state(store, store.get(ctx.params.id), ctx.query) } })],
  ['DELETE', 'games/:id', (store, ctx) => {
    const session = store.remove(ctx.params.id);
    return { body: { ok: true, closed: session.id } };
  }],
  ['POST', 'games/:id/moves', (store, ctx) => playForClient(store, store.get(ctx.params.id), ctx.body, ctx.query)],
  ['POST', 'games/:id/ai', (store, ctx) => playForAi(store, store.get(ctx.params.id), ctx.body)],
  ['POST', 'games/:id/hint', (store, ctx) => giveHint(store, store.get(ctx.params.id), ctx.body)],
  ['POST', 'games/:id/undo', (store, ctx) => {
    const session = store.get(ctx.params.id);
    const plies = ctx.body.plies === undefined ? 1 : Number(ctx.body.plies);
    if (!Number.isInteger(plies) || plies < 1) throw E.badRequest(`plies expects a whole number >= 1, got '${ctx.body.plies}'`);
    const undone = session.game.undo(plies);
    announce(store, session);
    return { body: { ok: true, undone, game: state(store, session) } };
  }],
  ['POST', 'games/:id/resign', (store, ctx) => {
    const session = store.get(ctx.params.id);
    requirePlaying(session);
    const side = ctx.body.side ? sideName(ctx.body.side) : session.game.turn;
    session.game.resign(side);
    announce(store, session);
    return { body: { ok: true, game: state(store, session) } };
  }],
  ['POST', 'games/:id/seats', (store, ctx) => changeSeats(store, store.get(ctx.params.id), ctx.body)],
  ['GET', 'games/:id/moves', (store, ctx) => gameMoves(store, store.get(ctx.params.id), ctx.query)],
  ['GET', 'games/:id/rules', (store, ctx) => {
    const session = store.get(ctx.params.id);
    return { body: { variant: S.variantView(session.game.variant), rules_text: S.rulesText(session.game.variant) } };
  }],
  ['GET', 'games/:id/export', (store, ctx) => ({ body: store.get(ctx.params.id).game.serialize() })],
  // The stream is served by the HTTP layer (it owns the response object). The route is
  // declared here so the router knows it, `GET /api/games/:id/events` over a socket
  // answers as text/event-stream, and a caller who reaches this handler is told why not.
  ['GET', 'games/:id/events', (store, ctx) => {
    store.get(ctx.params.id);
    throw E.badRequest('the events route is a stream: GET it over HTTP and read the text/event-stream body');
  }],
];

function getVariantOrThrow(id, size) {
  try {
    return V.getVariant(id, size ? Number(size) : null);
  } catch (error) {
    throw E.badRequest(error.message);
  }
}

/** `games/:id/moves` -> a regex plus the parameter names it captures. */
function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(part.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), names };
}

const COMPILED = ROUTES.map(([method, pattern, handler]) => ({ method, handler, ...compile(pattern) }));

/**
 * Route one API request. `request`: { method, path, query, body, version }.
 * Returns `{ status, body }`: no exception escapes, every failure is a status code.
 */
function handleApi(store, request = {}) {
  const version = request.version || '0';
  const method = String(request.method || 'GET').toUpperCase();
  const full = String(request.path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const path = full.startsWith('api/') ? full.slice(4) : (full === 'api' ? '' : full);

  const matched = COMPILED.filter((route) => route.regex.test(path));
  const route = matched.find((entry) => entry.method === method);
  if (!route) {
    if (matched.length) {
      return {
        status: 405,
        body: { error: `${method} is not allowed on /api/${path}`, status: 405, allow: [...new Set(matched.map((entry) => entry.method))] },
      };
    }
    return { status: 404, body: { error: `no API route ${method} /api/${path}`, status: 404, hint: 'GET /api lists the endpoints' } };
  }

  const found = route.regex.exec(path);
  const params = {};
  route.names.forEach((name, i) => { params[name] = decodeURIComponent(found[i + 1]); });
  const ctx = { params, query: request.query || {}, body: request.body || {}, version };

  try {
    const out = route.handler(store, ctx);
    return { status: out.status || 200, body: out.body };
  } catch (error) {
    if (error && error.name === 'ApiError') {
      const body = { error: error.message, status: error.status };
      if (error.details) body.details = error.details;
      return { status: error.status, body };
    }
    return { status: 500, body: { error: `server error: ${error.message}`, status: 500 } };
  }
}

module.exports = { handleApi, ROUTES, MOVE_OPTIONS, SIDES, MAX_THINK_MS };
