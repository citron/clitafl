'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GameStore } = require('../src/net/store');
const { handleApi } = require('../src/net/api');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');

function makeStore(options = {}) {
  return new GameStore({ maxGames: 30, timeMs: 30, ...options });
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `clitafl-${name}-`));
}

function req(store, method, path, extra = {}) {
  return handleApi(store, {
    method,
    path,
    body: extra.body || {},
    query: extra.query || {},
    headers: extra.headers || {},
    version: 'test',
  });
}

function openGame(store, spec = {}) {
  const out = req(store, 'POST', '/api/games', { body: { levels: 'easy', time_ms: 30, ...spec } });
  assert.equal(out.status, 201, JSON.stringify(out.body));
  return out.body;
}

/**
 * A position the book has nothing to say about: the opening played out on a cheap
 * clock. A node ceiling is a ceiling on a search, and a book move is no search.
 */
function midGame(store, spec = {}) {
  const variants = ['tablut', 'copenhagen', 'brandub'];
  for (const variant of variants) {
    const opened = openGame(store, {
      variant,
      seats: { attacker: 'ai', defender: 'ai' },
      level: 'easy',
      time_ms: 2,
      ...spec,
    });
    const id = opened.game.id;
    for (let i = 0; i < 20; i += 1) {
      const game = req(store, 'GET', `/api/games/${id}`).body.game;
      if (game.ply >= 12 || game.is_over) break;
      req(store, 'POST', `/api/games/${id}/ai`, { body: { moves: 1 } });
    }
    if (req(store, 'GET', `/api/games/${id}`).body.game.ply >= 12) return id;
  }
  assert.fail('no variant reaches ply 12 on a cheap clock');
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
  assert.ok(index.endpoints.length >= 18);
  const paths = index.endpoints.map((row) => `${row.method} ${row.path}`);
  for (const wanted of ['POST /api/games', 'GET /api/games/:id', 'POST /api/games/:id/moves', 'POST /api/games/:id/hint', 'GET /api/games/:id/export']) {
    assert.ok(paths.some((path) => path.startsWith(wanted)), `${wanted} is documented`);
  }
  for (const wanted of ['GET /api/lobby', 'GET /api/lobby/:id', 'POST /api/lobby/:id/join']) {
    assert.ok(paths.includes(wanted), `${wanted} is documented`);
  }
  assert.deepEqual(index.seats.kinds, ['human', 'ai', 'agent', 'client', 'open']);
  assert.match(index.seats.tokens, /x-clitafl-token/, 'the index says how a seat token is sent');
  assert.deepEqual(index.budget.keys, ['time_ms', 'max_nodes', 'max_depth'], 'the index says what one AI move may cost');
  assert.match(index.budget.about, /5 ?000 ?000/, 'and the caps it enforces, in numbers');
  assert.match(index.budget.about, /capped at 40/, 'the depth cap too');
  assert.match(index.budget.predictable, /nodes/, 'and which of those ceilings costs the same on any machine');
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

  const cp = one.variant;
  assert.equal(cp.castles, 'throne-corners', 'rule 3: the throne and the four corners are the marked squares');
  assert.equal(cp.castle_shield, 'both', 'an empty marked square is a captor for both sides');
  assert.equal(cp.edge_shield, false, 'rule 5: the edge of the board is not hostile');
  assert.equal(cp.king_safe_on_edge, true, 'the king is safe on the edge');
  assert.equal(cp.king_back_on_throne, true, 'rules 1 and 8: the king goes back onto his throne');
  assert.equal(cp.shield_wall, true, 'rule 7: a line of men at the edge falls to the shield wall');
  assert.equal(cp.win_by_siege, true, 'rule 12: sealing the king and his host wins');
  assert.equal(cp.no_move, 'loss', 'a defender with no legal move loses');
  assert.equal(cp.max_plies, 280, 'rule 13: 140 moves on the 11x11 board');
  assert.equal(cp.overrun, 'attackers-win', 'rule 13: reach the limit and the attackers win');

  const tablut = req(store, 'GET', '/api/variants/tablut').body.variant;
  assert.equal(tablut.castles, 'throne', 'Linnaeus names one castle: the throne');
  assert.equal(tablut.shield_wall, false);
  assert.equal(tablut.king_back_on_throne, false, 'the tablut king is barred from every castle, rule 5');
  assert.equal(tablut.overrun, 'draw', 'only copenhagen gives the game away at the limit');

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
    ['nodes', { max_nodes: 'many' }, 400, /max_nodes/],
    ['nodes', { max_nodes: -1 }, 400, /max_nodes/],
    ['depth', { max_depth: 1.5 }, 400, /max_depth/],
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

test('the ceilings of one AI move are the caller\'s numbers, per seat', () => {
  const store = makeStore();
  const nobody = { seats: { attacker: 'human', defender: 'human' } };

  const { game } = openGame(store, { ...nobody, max_nodes: 5000, max_nodes_d: 20000, max_depth: 6 });
  assert.deepEqual(game.budget.attacker, { time_ms: 30, max_nodes: 5000, max_depth: 6 }, 'the state answers what the next AI move may cost');
  assert.equal(game.budget.defender.max_nodes, 20000, 'and the per-seat spelling wins for that seat');
  assert.equal(game.budget.defender.max_depth, 6, 'a shared ceiling covers both seats');

  const silent = openGame(store, nobody).game;
  assert.deepEqual(silent.budget.attacker, { time_ms: 30, max_nodes: 0, max_depth: 0 }, 'a game that says nothing leaves it to the clock, and to the strength preset');

  // The ceiling is a number, so the worst case of a reply is a number too: a caller
  // can put a bound on a request without knowing how fast the server's CPU is.
  const capped = openGame(store, { ...nobody, max_nodes: 10 ** 12, max_depth: 999 }).game;
  assert.equal(capped.budget.attacker.max_nodes, 5000000, 'a node ceiling is capped, as the clock is');
  assert.equal(capped.budget.attacker.max_depth, 40);

  const seats = req(store, 'POST', `/api/games/${game.id}/seats`, { body: { seats: { attacker: 'ai' }, max_nodes_a: 4000 } });
  assert.equal(seats.status, 200);
  assert.equal(seats.body.game.budget.attacker.max_nodes, 4000, 'a seat change can set the ceiling it hands the AI');
  assert.equal(seats.body.game.budget.defender.max_nodes, 0, 'a budget said once replaces the set: the other seat starts from the server default');
  assert.equal(seats.body.game.budget.attacker.time_ms, 30, 'and so does its clock');
  assert.equal(seats.body.game.budget.attacker.max_depth, 0, 'and its depth');

  const nonsense = req(store, 'POST', `/api/games/${game.id}/seats`, { body: { max_depth: 'deep' } });
  assert.equal(nonsense.status, 400, 'a depth that is not a number is refused');

  const nodes = store.get(game.id).maxNodes[SIDE_ATTACKER];
  assert.equal(nodes, 4000, 'the session carries the ceiling the state reports');
});

test('a node ceiling is obeyed: the search costs the work the caller named', () => {
  const store = makeStore();
  const id = midGame(store, { level: 'grandmaster' });
  const budget = { max_nodes: 4000, max_depth: 40, time_ms: 60000 };
  const out = req(store, 'POST', `/api/games/${id}/ai`, { body: { moves: 1, ...budget } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const ai = out.body.game.last_ai;
  assert.equal(ai.source, 'search', 'the position is past the book, so the search played it');
  assert.equal(ai.max_nodes, 4000, 'the reply names the ceiling the move obeyed');
  // A ceiling is a ceiling, not a floor: a position the search solves under
  // it stops on its own, and `aborted` is what tells the two apart.
  if (ai.aborted) assert.ok(ai.nodes >= 4000 && ai.nodes < 8000, `a search cut short spent its ceiling: ${ai.nodes}`);
  else assert.ok(ai.nodes < 4000, `a search that solved the tree stopped under the ceiling: ${ai.nodes}`);
  assert.ok(Number.isFinite(ai.time_ms) && ai.time_ms >= 0, 'the reply says what the move cost in time as well');

  // One call can spend more than the game's ceiling: a client that wants a deeper
  // look asks for it in the request that asks for it.
  const deeper = req(store, 'POST', `/api/games/${id}/ai`, { body: { moves: 1, ...budget, max_nodes: 30000 } });
  const deep = deeper.body.game.last_ai;
  assert.ok(deep.nodes > ai.nodes, `a per-call ceiling buys a deeper search: ${deep.nodes} over ${ai.nodes}`);
  // The count is checked every 1 024 nodes and the walk out of the tree counts too, so
  // a search that runs out of room spends its ceiling rounded up on that tick.
  assert.ok(deep.nodes >= ai.nodes, `a deeper call never costs less: ${deep.nodes} under ${ai.nodes}`);
  if (deep.aborted) assert.ok(deep.nodes >= 30000 && deep.nodes < 60000, `and stops near the ceiling it was given: ${deep.nodes}`);
  else assert.ok(deep.nodes < 30000, `a call that searched the whole tree stopped under its ceiling: ${deep.nodes}`);
  assert.equal(deep.max_nodes, 30000);
  assert.equal(out.body.game.budget.attacker.max_nodes, 0, 'the game itself keeps the ceiling it was opened with');

  const garbage = req(store, 'POST', `/api/games/${id}/ai`, { body: { moves: 1, max_nodes: -3 } });
  assert.equal(garbage.status, 400);
  assert.match(garbage.body.error, /max_nodes/);
});

test('a hint, too, obeys the ceiling of the call that asks for it', () => {
  const store = makeStore();
  const id = midGame(store, { level: 'grandmaster' });
  const cheap = req(store, 'POST', `/api/games/${id}/hint`, { body: { max_nodes: 3000, max_depth: 40, time_ms: 60000 } });
  assert.equal(cheap.status, 200, JSON.stringify(cheap.body));
  assert.equal(cheap.body.hint.source, 'search', 'the hint is a search, not the book');
  assert.ok(cheap.body.hint.nodes < 6000, `a hint stays under the ceiling of the call that asks for it: ${cheap.body.hint.nodes}`);
  assert.equal(cheap.body.hint.max_nodes, 3000, 'the hint says the ceiling it searched under');
  assert.equal(cheap.body.game.budget.attacker.max_nodes, 0, 'a hint spends no ceiling the game carries');

  // A ceiling is a ceiling, not a floor: a shallow budget can be spent by a
  // search that finishes early. Ask for real work and the hint spends it.
  const deep = req(store, 'POST', `/api/games/${id}/hint`, { body: { max_nodes: 40000, max_depth: 40, time_ms: 60000 } });
  assert.equal(deep.status, 200, JSON.stringify(deep.body));
  const cheapHint = cheap.body.hint;
  const deepHint = deep.body.hint;
  assert.ok(deepHint.nodes >= cheapHint.nodes, `a deeper hint never costs less: ${deepHint.nodes} under ${cheapHint.nodes}`);
  if (deepHint.aborted) {
    // The count is checked every 1 024 nodes, plus the walk out of the tree.
    assert.ok(deepHint.nodes >= 40000 && deepHint.nodes < 80000, `a hint cut short spent the ceiling it asked for: ${deepHint.nodes}`);
  } else {
    // A position the search solves - a mate it can see all the way to - is
    // searched at any ceiling for the same few nodes: the depth is the ceiling
    // that bites, and the depth it reached is what the extra room bought.
    assert.ok(deepHint.nodes < 40000, `a hint that solved the tree stopped under its ceiling: ${deepHint.nodes}`);
    if (deepHint.depth > cheapHint.depth) {
      assert.ok(deepHint.nodes > cheapHint.nodes,
        `the deeper hint searched the deeper tree: ${deepHint.nodes} over ${cheapHint.nodes}`);
    }
  }
  assert.equal(typeof deepHint.aborted, 'boolean', 'the hint says whether the search ran out of room');

  const before = cheap.body.game.ply;
  const shallow = req(store, 'POST', `/api/games/${id}/hint`, { body: { max_depth: 1, max_nodes: 0, time_ms: 60000 } });
  assert.equal(shallow.status, 200, JSON.stringify(shallow.body));
  assert.equal(shallow.body.hint.depth, 1, 'a depth ceiling is the last word on how deep the search goes');
  assert.equal(shallow.body.game.ply, before, 'and a hint touches no board');
  assert.equal(shallow.body.hint.max_nodes, 0, 'a hint names the ceiling of its own call, the deep one does not leak');
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

test('a state directory keeps every game as a save file, and a new server plays it on', () => {
  const dir = tempDir('state');
  try {
    const store = makeStore({ stateDir: dir });
    assert.equal(store.stateDir, dir);
    assert.equal(req(store, 'GET', '/api/health').body.state_dir, dir, 'health says where the games live');

    const opened = openGame(store, {
      variant: 'tablut',
      seats: { attacker: 'ai', defender: 'human' },
      levels: { attacker: 'easy', defender: 'medium' },
      time_ms_a: 40,
      max_nodes_a: 5000,
      max_depth: 8,
      seed: 7,
    });
    const id = opened.game.id;
    const file = path.join(dir, `${id}.json`);
    assert.ok(fs.existsSync(file), 'an open game has its file at once');

    const opening = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(opening.format, 'clitafl-save-v1', 'the file is a save file');
    assert.equal(opening.variant, 'tablut');
    assert.equal(opening.session.id, id, 'the save carries the seats around it');
    assert.equal(opening.session.seats.attacker, 'ai');
    assert.equal(opening.session.levels.defender, 'medium');
    assert.equal(opening.session.time_ms.attacker, 40);
    assert.equal(opening.session.max_nodes.attacker, 5000, "and the ceiling each seat's AI obeys");
    assert.equal(opening.session.max_depth.defender, 8);
    assert.equal(opening.session.seed, 7);

    const move = firstMoveOf(opened);
    const played = req(store, 'POST', `/api/games/${id}/moves`, { body: { from: move.from, to: move.to } });
    assert.equal(played.status, 200);
    const afterMove = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(afterMove.ply, played.body.game.ply, 'the file is as far on as the state');
    assert.ok(afterMove.ply >= 2, 'the exchange is on disk: the move and the AI answer');
    assert.equal(afterMove.history.length, afterMove.ply);

    const resumed = openGame(store, { load: opening });
    assert.equal(resumed.game.ply, 1, 'the same file goes back through the API as a save');

    const second = makeStore({ stateDir: dir });
    const back = second.get(id);
    assert.equal(back.seats.attacker, 'ai', 'the seats come back');
    assert.equal(back.levels.defender, 'medium');
    assert.equal(back.timeMs.attacker, 40);
    assert.equal(back.maxNodes.attacker, 5000, 'a restarted server obeys the same ceiling');
    assert.equal(back.maxNodes.defender, 0, 'the seat that was given none keeps none');
    assert.equal(back.maxDepth.defender, 8, 'and the shared depth ceiling');
    assert.equal(back.seed, 7, 'and so does the seed the AI seats are built from');
    const restored = req(second, 'GET', `/api/games/${id}`).body.game;
    assert.equal(restored.ply, afterMove.ply, 'the board is where it was left');
    assert.deepEqual(restored.board.rows, played.body.game.board.rows, 'square for square');

    const next = firstMoveOf({ game: restored });
    const on = req(second, 'POST', `/api/games/${id}/moves`, { body: { from: next.from, to: next.to } });
    assert.equal(on.status, 200, 'a game that came back is played on');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ply, on.body.game.ply, 'and written back out');

    req(second, 'DELETE', `/api/games/${id}`);
    assert.ok(!fs.existsSync(file), 'a closed game leaves no file behind');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a game that leaves the store leaves its directory too', () => {
  const dir = tempDir('state');
  try {
    const store = makeStore({ stateDir: dir, ttlMs: 10, seats: { attacker: 'human', defender: 'human' } });
    const opened = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
    const file = path.join(dir, `${opened.game.id}.json`);

    assert.equal(req(store, 'DELETE', `/api/games/${opened.game.id}`).status, 200);
    assert.ok(!fs.existsSync(file), 'DELETE frees the file with the slot');

    const kept = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
    const keptFile = path.join(dir, `${kept.game.id}.json`);
    assert.ok(fs.existsSync(keptFile));
    store.sweep(Date.now() + 1000);
    assert.equal(store.size, 0);
    assert.ok(!fs.existsSync(keptFile), 'the TTL sweep prunes the file as well');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory is read back: the newest games first, a broken file left alone, an old game gone', () => {
  const dir = tempDir('state');
  try {
    const store = makeStore({ stateDir: dir });
    const first = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
    const second = openGame(store, { seats: { attacker: 'human', defender: 'human' } });
    const firstFile = path.join(dir, `${first.game.id}.json`);
    const future = new Date(Date.now() + 60000).toISOString();

    fs.writeFileSync(path.join(dir, 'broken.json'), '{ this is not json');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'a game is not a note');
    const stale = JSON.parse(fs.readFileSync(path.join(dir, `${second.game.id}.json`), 'utf8'));
    stale.session.updated_at = '2020-01-01T00:00:00.000Z';
    fs.writeFileSync(path.join(dir, 'stalegame1.json'), `${JSON.stringify(stale, null, 2)}\n`);
    const ahead = JSON.parse(fs.readFileSync(firstFile, 'utf8'));
    ahead.session.updated_at = future;
    fs.writeFileSync(firstFile, `${JSON.stringify(ahead, null, 2)}\n`);

    const reborn = new GameStore({ stateDir: dir, maxGames: 1, timeMs: 30, ttlMs: 60000 });
    assert.equal(reborn.size, 1, 'the store loads as many games as it has slots');
    assert.equal(reborn.list()[0].id, first.game.id, 'starting with the most recently touched');
    assert.ok(fs.existsSync(path.join(dir, 'broken.json')), 'a file that is not a game is not touched');
    assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
    assert.ok(!fs.existsSync(path.join(dir, 'stalegame1.json')), 'a game older than the TTL is dropped, file and all');
    assert.equal(reborn.get(first.game.id).game.ply, ahead.ply);

    const room = new GameStore({ stateDir: dir, maxGames: 5, timeMs: 30, ttlMs: 60000 });
    assert.deepEqual(room.list().map((session) => session.id).sort(), [first.game.id, second.game.id].sort(),
      'with room enough, both live games come back and the stale one does not');
    assert.equal(req(room, 'GET', `/api/games/${first.game.id}`).body.game.status, 'playing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the lobby: a seat that is open is offered, joined, and then played by its token alone', () => {
  const store = makeStore();
  const opened = openGame(store, {
    variant: 'tablut',
    seats: { attacker: 'ai', defender: 'open' },
    levels: 'easy',
    time_ms: 30,
  });
  const id = opened.game.id;
  assert.deepEqual(opened.open_seats, ['defender'], 'the reply that opened the game says which seat is going');
  assert.equal(opened.game.players.defender.seat, 'human');
  assert.equal(opened.game.players.defender.open, true);
  assert.equal(opened.game.players.defender.guarded, false, 'a seat nobody has taken has no token yet');

  const move = firstMoveOf(opened);
  const anonymous = req(store, 'POST', `/api/games/${id}/moves`, { body: { from: move.from, to: move.to } });
  assert.equal(anonymous.status, 409);
  assert.match(anonymous.body.error, /the defender seat is open/, 'an open seat is played by nobody at all');

  const list = req(store, 'GET', '/api/lobby').body;
  assert.equal(list.games.length, 1, 'the game is on the board');
  assert.equal(list.games[0].id, id);
  assert.deepEqual(list.games[0].open_seats, ['defender']);
  assert.match(list.games[0].join, /POST \/api\/lobby\/\w+\/join/, 'the card says how to take the seat');
  assert.equal(list.token_header, 'x-clitafl-token');

  const taken = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender', name: 'bot-7' } });
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  const token = taken.body.token;
  assert.ok(typeof token === 'string' && token.length >= 16, `a token to play the seat: '${token}'`);
  assert.equal(taken.body.seat, 'defender');
  assert.equal(taken.body.name, 'bot-7');
  assert.equal(taken.body.game.players.defender.guarded, true);
  assert.equal(taken.body.game.players.defender.open, false);
  assert.ok(!JSON.stringify(taken.body.game).includes(token), 'the state never repeats the token');

  const twice = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender' } });
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /not open/, 'one seat, one owner');
  assert.match(twice.body.error, /bot-7/, 'and the game says who has it');

  const noToken = req(store, 'POST', `/api/games/${id}/moves`, { body: { from: move.from, to: move.to } });
  assert.equal(noToken.status, 401);
  assert.match(noToken.body.error, /x-clitafl-token/, 'the answer says how to prove the seat');

  const wrong = req(store, 'POST', `/api/games/${id}/moves`, {
    body: { from: move.from, to: move.to },
    headers: { 'x-clitafl-token': 'not-the-token' },
  });
  assert.equal(wrong.status, 401, 'a token that is not this game is no token');

  const advice = req(store, 'POST', `/api/games/${id}/hint`, { body: { side: 'defender' } });
  assert.equal(advice.status, 200, JSON.stringify(advice.body));
  assert.ok(advice.body.hint, 'a hint is the engine speaking: the game is public, asking is not playing');

  const played = req(store, 'POST', `/api/games/${id}/moves`, {
    body: { from: move.from, to: move.to },
    headers: { 'x-clitafl-token': token },
  });
  assert.equal(played.status, 200, JSON.stringify(played.body));
  assert.ok(played.body.played.length >= 2, 'the AI seat answers in the same reply, tokened seat as any other');

  const undoBack = req(store, 'POST', `/api/games/${id}/undo`, { body: { plies: 2 } });
  assert.equal(undoBack.status, 401, 'undo is a player doing something to the game: it needs a seat token');
  const undone = req(store, 'POST', `/api/games/${id}/undo`, {
    body: { plies: 2 },
    headers: { 'x-clitafl-token': token },
  });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));

  const card = req(store, 'GET', `/api/lobby/${id}`).body;
  assert.deepEqual(card.game.open_seats, [], 'the game has nothing left to offer');
  assert.equal(card.game.players.defender.name, 'bot-7');
  assert.equal(req(store, 'GET', '/api/lobby').body.games.length, 0, 'and it is off the lobby list');
});

test('two agents meet on one server: each seat plays its own side with its own token', () => {
  const store = makeStore();
  const opened = openGame(store, {
    variant: 'brandub',
    seats: { attacker: 'open', defender: 'open' },
    auto: false,
    levels: 'easy',
    time_ms: 30,
  });
  const id = opened.game.id;
  assert.deepEqual(opened.open_seats, ['attacker', 'defender']);

  const alice = req(store, 'POST', `/api/lobby/${id}/join`, { body: { name: 'alice' } });
  assert.equal(alice.status, 200, JSON.stringify(alice.body));
  assert.equal(alice.body.seat, 'attacker', 'no seat asked for: the first open one is offered');
  const bob = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender', name: 'bob' } });
  assert.equal(bob.status, 200, JSON.stringify(bob.body));
  assert.notEqual(bob.body.token, alice.body.token, 'one token per seat');

  const first = firstMoveOf(alice.body);
  const steal = req(store, 'POST', `/api/games/${id}/moves`, {
    body: { from: first.from, to: first.to },
    headers: { 'x-clitafl-token': bob.body.token },
  });
  assert.equal(steal.status, 401, "bob's token does not play alice's seat");

  const asAlice = req(store, 'POST', `/api/games/${id}/moves`, {
    body: { from: first.from, to: first.to },
    headers: { 'x-clitafl-token': alice.body.token },
  });
  assert.equal(asAlice.status, 200, JSON.stringify(asAlice.body));
  assert.equal(asAlice.body.game.turn, 'defender');
  assert.equal(asAlice.body.played.length, 1, 'neither seat is the AI: nothing answers on its own');

  const openAgain = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'attacker' } });
  assert.equal(openAgain.status, 409, 'alice is in that seat already');

  const resign = req(store, 'POST', `/api/games/${id}/resign`, {
    body: { side: 'defender' },
    headers: { 'x-clitafl-token': bob.body.token },
  });
  assert.equal(resign.status, 200, JSON.stringify(resign.body));
  assert.equal(resign.body.game.winner, 'attacker');

  const after = req(store, 'GET', '/api/lobby').body;
  assert.equal(after.games.length, 0, 'a finished game is off the board');
  const join = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender' } });
  assert.equal(join.status, 409, 'and it is not for joining');
});

test('a seat handed to the AI, or back to the caller, gives its token up; a seat opened again needs a new one', () => {
  const store = makeStore();
  const opened = openGame(store, {
    variant: 'tablut',
    seats: { attacker: 'ai', defender: 'open' },
    levels: 'easy',
    time_ms: 30,
  });
  const id = opened.game.id;
  const taken = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender', name: 'bot-7' } });
  const token = taken.body.token;
  const move = firstMoveOf(taken.body);

  const toCaller = req(store, 'POST', `/api/games/${id}/seats`, {
    body: { seats: { attacker: 'ai', defender: 'human' } },
    headers: { 'x-clitafl-token': token },
  });
  assert.equal(toCaller.status, 200, JSON.stringify(toCaller.body));
  assert.equal(toCaller.body.game.players.defender.guarded, false, 'the seat is an ordinary caller seat again');

  const plain = req(store, 'POST', `/api/games/${id}/moves`, { body: { from: move.from, to: move.to } });
  assert.equal(plain.status, 200, 'played without a token, as it was before anyone joined');

  const opened2 = req(store, 'POST', `/api/games/${id}/seats`, { body: { seats: { attacker: 'ai', defender: 'open' } } });
  assert.equal(opened2.status, 200, JSON.stringify(opened2.body));
  assert.deepEqual(opened2.body.game.open_seats, ['defender']);
  const stale = req(store, 'POST', `/api/games/${id}/moves`, {
    body: { from: move.from, to: move.to },
    headers: { 'x-clitafl-token': token },
  });
  assert.equal(stale.status, 409, 'the old token does not own an open seat');

  const fresh = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender', name: 'bot-8' } });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.notEqual(fresh.body.token, token, 'a new owner, a new token');
  const oldToken = req(store, 'POST', `/api/games/${id}/moves`, {
    body: { from: firstMoveOf(fresh.body).from, to: firstMoveOf(fresh.body).to },
    headers: { 'x-clitafl-token': token },
  });
  assert.equal(oldToken.status, 401, 'and the old one is no token at all');
});

test('a seat token survives the state directory, and the seat and its name with it', () => {
  const dir = tempDir('lobby');
  try {
    const store = makeStore({ stateDir: dir });
    const opened = openGame(store, {
      variant: 'tablut',
      seats: { attacker: 'ai', defender: 'open' },
      levels: 'easy',
      time_ms: 30,
    });
    const id = opened.game.id;
    const taken = req(store, 'POST', `/api/lobby/${id}/join`, { body: { seat: 'defender', name: 'bot-7' } });
    const token = taken.body.token;

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    assert.equal(onDisk.session.tokens.defender, token, 'the file keeps the seat, its name and its token');
    assert.equal(onDisk.session.names.defender, 'bot-7');
    assert.equal(onDisk.session.open.defender, false);

    const second = makeStore({ stateDir: dir });
    assert.equal(req(second, 'GET', '/api/lobby').body.games.length, 0, 'a taken seat is not offered again');
    const back = req(second, 'GET', `/api/games/${id}`).body.game;
    assert.equal(back.players.defender.name, 'bot-7');
    assert.equal(back.players.defender.guarded, true);

    const move = firstMoveOf({ game: back });
    assert.equal(req(second, 'POST', `/api/games/${id}/moves`, { body: { from: move.from, to: move.to } }).status, 401);
    const played = req(second, 'POST', `/api/games/${id}/moves`, {
      body: { from: move.from, to: move.to },
      headers: { 'x-clitafl-token': token },
    });
    assert.equal(played.status, 200, JSON.stringify(played.body));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
