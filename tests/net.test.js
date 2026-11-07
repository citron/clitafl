'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { GameStore } = require('../src/net/store');
const { handleApi } = require('../src/net/api');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');

function makeStore(options = {}) {
  return new GameStore({ maxGames: 30, timeMs: 30, ...options });
}

function req(store, method, path, extra = {}) {
  return handleApi(store, {
    method,
    path,
    body: extra.body || {},
    query: extra.query || {},
    version: 'test',
  });
}

function openGame(store, spec = {}) {
  const out = req(store, 'POST', '/api/games', { body: { levels: 'easy', time_ms: 30, ...spec } });
  assert.equal(out.status, 201, JSON.stringify(out.body));
  return out.body;
}

function firstMoveOf(body) {
  const moves = body.game.legal_moves;
  assert.ok(Array.isArray(moves) && moves.length, 'the state lists the legal moves of the side to move');
  return moves[0];
}

test('GET /api describes the API as data', () => {
  const index = req(makeStore(), 'GET', '/api').body;
  assert.equal(index.name, 'clitafl');
  assert.equal(index.version, 'test');
  assert.ok(index.endpoints.length >= 15);
  const paths = index.endpoints.map((row) => `${row.method} ${row.path}`);
  for (const wanted of ['POST /api/games', 'GET /api/games/:id', 'POST /api/games/:id/moves', 'POST /api/games/:id/hint', 'GET /api/games/:id/export']) {
    assert.ok(paths.some((path) => path.startsWith(wanted)), `${wanted} is documented`);
  }
  assert.deepEqual(index.seats.kinds, ['human', 'ai', 'agent']);
  assert.ok(index.playing.length >= 3, 'the index shows how to start playing');
});

test('the catalogue endpoints list variants, sizes and levels', () => {
  const store = makeStore();
  const variants = req(store, 'GET', '/api/variants').body;
  assert.equal(variants.variants.length, 6);
  assert.deepEqual(variants.sizes, { min: 7, max: 19, odd: true });

  const one = req(store, 'GET', '/api/variants/copenhagen', { query: { size: '11' } }).body;
  assert.equal(one.variant.size, 11);
  assert.equal(one.variant.id, 'copenhagen');
  assert.match(one.rules_text, /castle/i);

  const levels = req(store, 'GET', '/api/levels').body;
  assert.deepEqual(levels.levels.map((l) => l.id), ['easy', 'medium', 'hard', 'grandmaster']);
  assert.ok(levels.levels.every((l) => l.label && l.depth > 0 && l.time_ms > 0));
});

test('a 19x19 alea evangelii game opens with the manuscript army', () => {
  const store = makeStore();
  const { game } = openGame(store, { variant: 'alea', auto: false });
  assert.equal(game.variant.id, 'alea');
  assert.equal(game.variant.size, 19);
  assert.ok(game.board.rows.every((row) => /^[.KDA]{19}$/.test(row)), 'a 19x19 board in the plain rows');
  assert.equal(game.board.counts.attackers, 48, '48 counts');
  assert.equal(game.board.counts.defenders, 24, '24 dukes');
  assert.equal(game.board.counts.king, 1);
  assert.equal(game.board.escapes.length, 16, 'the four marked 2x2 blocks are the exits');
  assert.ok(game.board.castles.includes('j10'), 'the citadel is a castle square');

  const one = req(store, 'GET', '/api/variants/alea').body;
  assert.equal(one.variant.size, 19);
  assert.match(one.rules_text, /16 marked squares/, 'the rules text travels with the variant');
});

test('a new game arrives with the board, the seats and the moves of the side to move', () => {
  const { game, played } = openGame(makeStore(), { seats: { attacker: 'ai', defender: 'agent' } });
  assert.equal(game.variant.id, 'tablut');
  assert.equal(game.board.size, 9);
  assert.equal(game.board.rows.length, 9);
  assert.ok(game.board.rows.every((row) => /^[.KDA]{9}$/.test(row)));
  assert.equal(game.seats.attacker, 'ai');
  assert.equal(game.seats.defender, 'human', 'agent is a seat the caller plays');
  assert.equal(game.turn, SIDE_DEFENDER, 'the AI opened, so the caller is on move');
  assert.equal(played.length, 1);
  assert.equal(game.board.counts.attackers, 16);
  assert.equal(game.board.counts.king, 1);
  assert.ok(game.legal_moves.length > 0);
  assert.equal(game.legal_moves[0].san, `${game.legal_moves[0].from}-${game.legal_moves[0].to}`);
  assert.ok(game.legal_moves.every((m) => m.piece === 'defender'), 'a move names the man that moves');
  assert.equal(game.url, `/api/games/${game.id}`);
});

test('a legal move names the man that moves, the king included', () => {
  const store = makeStore();
  const { game } = openGame(store, {
    variant: 'brandub', seats: { attacker: 'human', defender: 'human' }, auto: false,
  });
  const { id } = game;
  assert.ok(game.legal_moves.length > 0);
  assert.ok(game.legal_moves.every((m) => m.piece === 'attacker'), 'at the start, only soldiers move');

  const play = (san) => {
    const out = req(store, 'POST', `/api/games/${id}/moves`, { body: { move: san } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
  };
  play('d1-d2');
  play('c4-b4'); // the defender steps aside and frees his king
  play('b2-b1');

  const both = req(store, 'GET', `/api/games/${id}`, { query: { moves: 'all' } }).body.game;
  assert.ok(both.legal_moves.defender.some((m) => m.piece === 'king' && m.san === 'd4-c4'),
    'the king is named, not a faceless soldier');
  assert.ok(both.legal_moves.defender.every((m) => m.piece === 'defender' || m.piece === 'king'));
  assert.ok(both.legal_moves.attacker.every((m) => m.piece === 'attacker'));
});

test('moves=all lists both armies, moves=none lists none', () => {
  const store = makeStore();
  const { game } = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const all = req(store, 'GET', `/api/games/${game.id}`, { query: { moves: 'all' } }).body.game;
  assert.ok(Array.isArray(all.legal_moves.attacker) && all.legal_moves.attacker.length);
  assert.ok(Array.isArray(all.legal_moves.defender) && all.legal_moves.defender.length);
  assert.equal(all.legal_move_count, all.legal_moves.attacker.length + all.legal_moves.defender.length);

  const none = req(store, 'GET', `/api/games/${game.id}`, { query: { moves: 'none' } }).body.game;
  assert.deepEqual(none.legal_moves, []);
  assert.equal(none.legal_move_count, 0);

  const bogus = req(store, 'GET', `/api/games/${game.id}`, { query: { moves: 'some' } });
  assert.equal(bogus.status, 400);
  assert.match(bogus.body.error, /moves expects/);
});

test('the caller plays a move and the AI seats answer in the same reply', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'ai', defender: 'agent' }, variant: 'brandub', size: 7 });
  const { game } = opened;
  const move = firstMoveOf(opened);

  const out = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: move.from, to: move.to } });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.match(out.body.played[0].san, new RegExp(`^${move.from}[x-]${move.to}$`));
  assert.equal(out.body.played[0].seat, 'human');
  assert.equal(out.body.played[0].side, SIDE_DEFENDER);
  assert.ok(out.body.played.length >= 2, 'the AI seat answered');
  assert.ok(out.body.played[1].seat === 'ai');
  assert.equal(out.body.game.turn, SIDE_DEFENDER);
  assert.equal(out.body.game.ply, game.ply + out.body.played.length);
});

test('one move can be played as "from"/"to", as "move", with ?ai=false to silence the AI', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const { game } = opened;
  const move = firstMoveOf(opened);

  const pair = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: move.from, to: move.to } });
  assert.equal(pair.status, 200);
  assert.equal(pair.body.played.length, 1, 'no AI seat to answer');

  const text = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { move: firstMoveOf(pair.body).san } });
  assert.equal(text.status, 200);
  assert.equal(text.body.game.ply, 2);

  const silent = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: 'a1', to: 'a1' }, query: { ai: 'false' } });
  assert.equal(silent.status, 400, 'a nonsense move is still rejected');
});

test('bad input is answered with a status and a readable message', () => {
  const store = makeStore();
  const cases = [
    ['variant', { variant: 'chess' }, 400, /Unknown variant/],
    ['size', { variant: 'brandub', size: 8 }, 400, /size/],
    ['level', { levels: { attacker: 'legendary' } }, 400, /level/],
    ['seat', { seats: { attacker: 'robot' } }, 400, /human \| ai \| agent/],
    ['time', { time_ms: -5 }, 400, /time_ms/],
    ['seed', { seed: 'lots' }, 400, /seed/],
    ['max_plies', { max_plies: 0 }, 400, /max_plies/],
  ];
  for (const [what, body, status, pattern] of cases) {
    const out = req(store, 'POST', '/api/games', { body });
    assert.equal(out.status, status, `${what}: ${JSON.stringify(out.body)}`);
    assert.match(out.body.error, pattern, what);
    assert.equal(out.body.status, status);
  }
  assert.equal(store.size, 0, 'a rejected game is not opened');
});

test('a move that breaks the rules is refused, and the game is left alone', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const { game } = opened;

  const knight = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: 'a1', to: 'b3' } });
  assert.equal(knight.status, 400);
  assert.ok(knight.body.error.length > 5);

  const empty = req(store, 'POST', `/api/games/${game.id}/moves`, { body: {} });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /from/);

  const state = req(store, 'GET', `/api/games/${game.id}`).body.game;
  assert.equal(state.ply, 0, 'nothing was played');
});

test('the server refuses to move for the AI, for the wrong side, or after the game is over', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'ai', defender: 'ai' }, time_ms: 5 });
  const { game } = opened;

  const forAi = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { side: SIDE_DEFENDER, from: 'a1', to: 'a1' } });
  assert.equal(forAi.status, 409);
  assert.match(forAi.body.error, /played by the AI/);

  const wrongTurn = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { side: SIDE_ATTACKER, from: 'a1', to: 'a1' } });
  assert.equal(wrongTurn.status, 409);
  assert.match(wrongTurn.body.error, /is the defender to move/);

  req(store, 'POST', `/api/games/${game.id}/resign`, { body: { side: SIDE_DEFENDER } });
  const after = req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: 'a1', to: 'a1' } });
  assert.equal(after.status, 409);
  assert.match(after.body.error, /game is over/);
});

test('the AI seats can be told to play, a number of plies or until the caller is on move', () => {
  const store = makeStore();
  const opened = openGame(store, { variant: 'brandub', size: 7, seats: { attacker: 'ai', defender: 'ai' }, time_ms: 2 });
  assert.equal(opened.played.length, 1, 'creating an all-AI game plays the opening ply');

  const nonsense = req(store, 'POST', `/api/games/${opened.game.id}/ai`, { body: { moves: 'many' } });
  assert.equal(nonsense.status, 400);
  assert.match(nonsense.body.error, /moves expects/);

  const two = req(store, 'POST', `/api/games/${opened.game.id}/ai`, { body: { moves: 2 } });
  assert.equal(two.status, 200);
  assert.equal(two.body.played.length, 2);

  const all = req(store, 'POST', `/api/games/${opened.game.id}/ai`, { body: { moves: 'all' } });
  assert.equal(all.status, 200);
  assert.ok(all.body.played.length >= 1);
  assert.ok(all.body.played.every((ply) => ply.seat === 'ai'));
  assert.equal(all.body.game.ply, 3 + all.body.played.length);
  assert.ok(all.body.played.length === 100 || all.body.game.is_over, 'it stops at the cap or at the result');

  const humanSeat = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const idle = req(store, 'POST', `/api/games/${humanSeat.game.id}/ai`, { body: { moves: 1 } });
  assert.equal(idle.status, 409);
  assert.match(idle.body.error, /played by the caller/);

  const over = req(store, 'POST', `/api/games/${opened.game.id}/ai`, { body: { moves: 1 } });
  if (all.body.game.is_over) {
    assert.equal(over.status, 409);
    assert.match(over.body.error, /game is over/);
  }
});

test('a hint is searched without playing it', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const { game } = opened;

  const hint = req(store, 'POST', `/api/games/${game.id}/hint`, { body: { level: 'medium', time_ms: 250 } });
  assert.equal(hint.status, 200);
  assert.equal(hint.body.hint.side, SIDE_ATTACKER);
  assert.match(hint.body.hint.san, /^[a-z]+\d+-[a-z]+\d+$/);
  assert.ok(hint.body.hint.depth >= 1);
  assert.ok(hint.body.hint.nodes > 0);
  assert.equal(hint.body.hint.level, 'medium');
  assert.equal(hint.body.game.ply, 0, 'the board is untouched');

  const bad = req(store, 'POST', `/api/games/${game.id}/hint`, { body: { level: 'genius' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /level/);
});

test('undo takes plies back, resign ends the game, seats can change hands', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const { game } = opened;
  const moves = opened.game.legal_moves.slice(0, 1);
  req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: moves[0].from, to: moves[0].to } });
  const second = req(store, 'GET', `/api/games/${game.id}`).body.game.legal_moves[0];
  req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: second.from, to: second.to } });

  const undone = req(store, 'POST', `/api/games/${game.id}/undo`, { body: { plies: 2 } });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.undone, 2);
  assert.equal(undone.body.game.ply, 0);
  assert.equal(undone.body.game.status, 'playing');
  assert.equal(undone.body.game.history.length, 0);

  const tooMany = req(store, 'POST', `/api/games/${game.id}/undo`, { body: { plies: 9 } });
  assert.equal(tooMany.status, 200, 'undoing more plies than exist is not an error');
  assert.equal(tooMany.body.undone, 0);

  const badPlies = req(store, 'POST', `/api/games/${game.id}/undo`, { body: { plies: 0 } });
  assert.equal(badPlies.status, 400);

  const seats = req(store, 'POST', `/api/games/${game.id}/seats`, { body: { seats: { attacker: 'ai' }, level: 'hard', time_ms: 25 } });
  assert.equal(seats.status, 200);
  assert.equal(seats.body.game.seats.attacker, 'ai');
  assert.equal(seats.body.game.levels.attacker, 'hard');
  assert.equal(seats.body.game.time_ms.attacker, 25);

  const badSeats = req(store, 'POST', `/api/games/${game.id}/seats`, { body: { seats: { defender: 'alien' } } });
  assert.equal(badSeats.status, 400);

  const resigned = req(store, 'POST', `/api/games/${game.id}/resign`, { body: { side: SIDE_ATTACKER } });
  assert.equal(resigned.body.game.status, 'defenders-win');
  assert.equal(resigned.body.game.winner, SIDE_DEFENDER);
  assert.match(resigned.body.game.reason, /resigned/);

  const again = req(store, 'POST', `/api/games/${game.id}/resign`, { body: {} });
  assert.equal(again.status, 409);
});

test('the record, the rules and the save file are readable', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' }, variant: 'ard-ri' });
  const { game } = opened;
  const first = firstMoveOf(opened);
  req(store, 'POST', `/api/games/${game.id}/moves`, { body: { from: first.from, to: first.to } });

  const moves = req(store, 'GET', `/api/games/${game.id}/moves`).body;
  assert.equal(moves.moves.length, 1);
  assert.equal(moves.moves[0].san, `${first.from}-${first.to}`);
  assert.equal(moves.moves[0].side, SIDE_ATTACKER);
  const since = req(store, 'GET', `/api/games/${game.id}/moves`, { query: { since: '1' } }).body;
  assert.equal(since.moves.length, 0);
  const badSince = req(store, 'GET', `/api/games/${game.id}/moves`, { query: { since: '-1' } });
  assert.equal(badSince.status, 400);

  const rules = req(store, 'GET', `/api/games/${game.id}/rules`).body;
  assert.equal(rules.variant.id, 'ard-ri');
  assert.ok(rules.rules_text.length > 100);
  assert.ok(!rules.rules_text.includes('['), 'the web rules text carries no ANSI codes');

  const save = req(store, 'GET', `/api/games/${game.id}/export`).body;
  assert.equal(save.format, 'clitafl-save-v1');
  assert.equal(save.ply, 1);

  const resumed = req(store, 'POST', '/api/games', { body: { load: save, seats: { attacker: 'human', defender: 'human' } } });
  assert.equal(resumed.status, 201);
  assert.equal(resumed.body.game.ply, 1);
  assert.equal(resumed.body.game.variant.id, 'ard-ri');
  assert.equal(resumed.body.game.history[0].san, `${first.from}-${first.to}`);

  const stringLoad = req(store, 'POST', '/api/games', { body: { load: JSON.stringify(save) } });
  assert.equal(stringLoad.status, 201, 'a save sent as text is parsed');
  const junk = req(store, 'POST', '/api/games', { body: { load: '{not json' } });
  assert.equal(junk.status, 400);
  const broken = req(store, 'POST', '/api/games', { body: { load: { format: 'nope' } } });
  assert.equal(broken.status, 400);
  assert.match(broken.body.error, /cannot resume/);
});

test('the game list shows open games, and close lists finished ones', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const other = openGame(store, { variant: 'brandub', seats: { attacker: 'human', defender: 'human' } });

  const open = req(store, 'GET', '/api/games').body.games;
  assert.equal(open.length, 2);
  assert.deepEqual(open.map((row) => row.variant).sort(), ['brandub', 'tablut']);
  assert.ok(open[0].url.startsWith('/api/games/'));
  assert.ok(!('board' in open[0]), 'the list stays light');

  req(store, 'POST', `/api/games/${other.game.id}/resign`, { body: { side: SIDE_ATTACKER } });
  assert.equal(req(store, 'GET', '/api/games').body.games.length, 1);
  const every = req(store, 'GET', '/api/games', { query: { include: 'closed' } }).body.games;
  assert.equal(every.length, 2);
  assert.ok(every.some((row) => row.status === 'defenders-win'));

  const closed = req(store, 'DELETE', `/api/games/${opened.game.id}`).body;
  assert.equal(closed.closed, opened.game.id);
  assert.equal(req(store, 'GET', '/api/games').body.games.length, 0, 'the finished game is not listed as open');
  assert.equal(req(store, 'GET', '/api/games', { query: { include: 'closed' } }).body.games.length, 1);

  const gone = req(store, 'DELETE', `/api/games/${opened.game.id}`);
  assert.equal(gone.status, 404);
  assert.match(gone.body.error, /no game with id/);
});

test('max_games caps the store, and a closed game frees its slot', () => {
  const store = new GameStore({ maxGames: 2, timeMs: 20 });
  const a = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const full = req(store, 'POST', '/api/games', { body: { seats: { attacker: 'human', defender: 'human' } } });
  assert.equal(full.status, 409);
  assert.match(full.body.error, /DELETE \/api\/games/);
  req(store, 'DELETE', `/api/games/${a.game.id}`);
  assert.equal(req(store, 'POST', '/api/games', { body: { seats: { attacker: 'human', defender: 'human' } } }).status, 201);
});

test('a game nobody touches is forgotten', () => {
  const store = new GameStore({ maxGames: 5, ttlMs: 1, timeMs: 20 });
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  assert.equal(store.sweep(Date.parse(opened.game.updated_at) + 50), 0);
  assert.equal(req(store, 'GET', `/api/games/${opened.game.id}`).status, 404);
});

test('unknown routes and wrong verbs are answered, not thrown', () => {
  const store = makeStore();
  const missing = req(store, 'GET', '/api/nothing');
  assert.equal(missing.status, 404);
  assert.match(missing.body.hint, /GET \/api/);

  const wrongVerb = req(store, 'PUT', '/api/games');
  assert.equal(wrongVerb.status, 405);
  assert.deepEqual(wrongVerb.body.allow.sort(), ['GET', 'POST']);

  const deep = req(store, 'GET', '/api/games/abc/moves/deeper');
  assert.equal(deep.status, 404);

  const noId = req(store, 'GET', '/api/games/');
  assert.equal(noId.status, 200, 'GET /api/games is the list');

  const pathStyle = req(store, 'GET', 'games');
  assert.equal(pathStyle.status, 200, 'the path may come with or without the /api prefix');
});

test('the store validates seats, levels and clocks the way the API documents them', () => {
  const store = makeStore();
  const nobody = { seats: { attacker: 'human', defender: 'human' } };
  const { game } = openGame(store, {
    ...nobody,
    level: 'easy',
    levels: { defender: 'grandmaster' },
    time_ms: 500,
    time_ms_d: 4000,
  });
  assert.equal(game.levels.attacker, 'easy', 'the shared level applies unless a seat overrides it');
  assert.equal(game.levels.defender, 'grandmaster');
  assert.equal(game.time_ms.attacker, 500);
  assert.equal(game.time_ms.defender, 4000);

  const capped = req(store, 'POST', '/api/games', { body: { ...nobody, time_ms: 10 ** 9 } }).body.game;
  assert.equal(capped.time_ms.attacker, 30000, 'a clock is capped so one request cannot block the server for long');

  const seeded = openGame(store, { ...nobody, seed: 7 }).game;
  assert.equal(seeded.seed, 7);
  const maxed = openGame(store, { ...nobody, max_plies: 12 }).game;
  assert.equal(maxed.variant.max_plies, 12);
});

test('a full exchange between the AI seats is a list of plies with captures described', () => {
  const store = makeStore();
  const opened = openGame(store, { variant: 'brandub', size: 7, seats: { attacker: 'ai', defender: 'ai' }, level: 'easy', time_ms: 3 });
  assert.equal(opened.game.ply, 1);
  const out = req(store, 'POST', `/api/games/${opened.game.id}/ai`, { body: { moves: 6 } });
  assert.equal(out.status, 200);
  const plies = out.body.played;
  assert.ok(plies.length >= 1 && plies.length <= 6, JSON.stringify(plies.length));
  plies.forEach((ply, i) => {
    assert.equal(ply.ply, 2 + i);
    assert.match(ply.san, /^[a-z]+\d+[x-][a-z]+\d+$/);
    assert.ok(Array.isArray(ply.captured));
    for (const capture of ply.captured) {
      assert.match(capture.square, /^[a-z]+\d+$/);
      assert.ok(['king', 'defender', 'attacker'].includes(capture.piece));
    }
  });
  const state = out.body.game;
  assert.equal(state.moves_played, 1 + plies.length);
  assert.equal(state.last_move.san, plies[plies.length - 1].san);
});

test('the watchers of a game hear every change: a ply per move, the state, and the close', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const session = store.get(opened.game.id);
  const frames = [];
  const stop = store.subscribe(session, (event, payload) => frames.push([event, payload]));

  const move = opened.game.legal_moves[0];
  req(store, 'POST', `/api/games/${session.id}/moves`, { body: { from: move.from, to: move.to } });
  assert.deepEqual(frames.map(([event]) => event), ['ply', 'state'], 'one move, then the state');
  assert.equal(frames[0][1].san, move.san, 'the ply carries the move that was played');
  assert.equal(frames[0][1].seat, 'human');
  assert.equal(frames[1][1].id, session.id, 'the state is the shape GET /api/games/:id gives');
  assert.equal(frames[1][1].ply, 1);

  req(store, 'POST', `/api/games/${session.id}/undo`, { body: {} });
  assert.deepEqual(frames.map(([event]) => event), ['ply', 'state', 'state'], 'an undo pushes the state');

  req(store, 'POST', `/api/games/${session.id}/seats`, { body: { seats: { attacker: 'ai', defender: 'human' } } });
  req(store, 'POST', `/api/games/${session.id}/hint`, { body: {} });
  const after = frames.map(([event]) => event);
  assert.deepEqual(after.slice(3), ['state'], 'a seat change pushes, a hint does not');

  req(store, 'DELETE', `/api/games/${session.id}`);
  assert.equal(frames[frames.length - 1][0], 'closed', 'closing the game says so');
  assert.equal(frames[frames.length - 1][1].id, session.id);
  stop();
});

test('the events route is a stream: asked for JSON it explains itself, and a missing game is a 404', () => {
  const store = makeStore();
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const index = req(store, 'GET', '/api').body;
  assert.ok(
    index.endpoints.some((row) => row.method === 'GET' && row.path === '/api/games/:id/events'),
    'the stream is in the endpoint list',
  );

  const stream = req(store, 'GET', `/api/games/${opened.game.id}/events`);
  assert.equal(stream.status, 400);
  assert.match(stream.body.error, /stream/);
  const verb = req(store, 'POST', `/api/games/${opened.game.id}/events`, { body: {} });
  assert.equal(verb.status, 405);
  assert.deepEqual(verb.body.allow, ['GET']);
  const missing = req(store, 'GET', '/api/games/nope/events');
  assert.equal(missing.status, 404);
});

test('a game bounds its watchers, and forgets a sink that cannot be written to', () => {
  const store = makeStore({ maxWatchers: 2 });
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const session = store.get(opened.game.id);
  const heard = [];
  store.subscribe(session, (event) => heard.push(event));
  store.subscribe(session, () => { throw new Error('socket gone'); });
  assert.equal(store.publish(session, 'state', { id: session.id }), 1, 'only the live sink hears');
  assert.equal(heard.join(','), 'state');
  assert.equal(session.watchers.size, 1, 'the sink whose socket is gone is dropped');
  store.subscribe(session, () => {});
  assert.throws(() => store.subscribe(session, () => {}), /watchers/, 'the cap is enforced');
  store.publish(session, 'state', { id: session.id });
  assert.equal(heard.length, 2, 'and the dead sink does not pile up');
});

test('a game swept by the TTL tells its watchers before it goes', () => {
  const store = makeStore({ ttlMs: 10 });
  const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
  const session = store.get(opened.game.id);
  const frames = [];
  store.subscribe(session, (event, payload) => frames.push([event, payload]));
  store.sweep(Date.now() + 1000);
  assert.deepEqual(frames, [['closed', { id: session.id, status: 'playing', reason: null }]]);
  assert.equal(store.size, 0, 'and the slot is free');
});
