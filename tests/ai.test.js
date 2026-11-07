'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Game } = require('../src/rules/game');
const { Board } = require('../src/rules/board');
const { getVariant, VARIANTS } = require('../src/rules/variants');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');
const { AIPlayer, LEVELS, LEVEL_IDS, levelOf } = require('../src/ai/player');
const { searchBestMove, captureMoves, createsCapture, TranspositionTable } = require('../src/ai/search');
const { hashBoard, applyKey } = require('../src/ai/zobrist');
const { bookMoves, loadBook } = require('../src/ai/book');
const { evaluate, scoreFor, MATE } = require('../src/ai/evaluate');
const { seededRng } = require('../src/headless');
const { makeBoard, idx, move } = require('./helpers');

const quickAi = (level = 'easy') => new AIPlayer(level, { timeMs: 60, rng: seededRng(11) });
const gameFrom = (variantId, rows) => {
  const board = makeBoard(variantId, rows);
  return new Game(board.variant, board);
};

/** How many pieces the board really takes when the move is played. */
function realCaptures(board, picked, side) {
  const applied = board.applyMove(picked);
  const count = applied.captured.length;
  board.undoMove(picked, applied);
  return count;
}

test('the known strength levels are ordered by thinking budget', () => {
  assert.deepEqual(LEVEL_IDS, ['easy', 'medium', 'hard', 'grandmaster']);
  assert.ok(levelOf('easy').maxDepth < levelOf('hard').maxDepth);
  assert.throws(() => levelOf('genius'), /Unknown AI level/);
});

test('the AI plays the move that captures the king', () => {
  const game = gameFrom('tablut', [
    '.........',
    '.........',
    '...A.....',
    '...K.....',
    '...A.....',
    '.........',
    '.........',
    '.........',
    '....A....',
  ]);
  const { move: picked, info } = quickAi().chooseMove(game, SIDE_ATTACKER);
  assert.ok(info.score >= MATE - 1000, `a winning move scores as a mate, got ${info.score}`);
  const probe = Game.deserialize(game.serialize());
  assert.equal(probe.play(picked).status, 'attackers-win', 'it closes the net on the king');
});

test('the AI takes the free escape for the king', () => {
  const game = gameFrom('brandub', [
    '.K.....',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '......A',
  ]);
  game.turn = SIDE_DEFENDER;
  const { move: picked, info } = quickAi().chooseMove(game, SIDE_DEFENDER);
  assert.equal(picked.from, idx(7, 0, 1), 'it is the king that runs');
  const r = game.board.rowOf(picked.to);
  const c = game.board.colOf(picked.to);
  assert.ok(game.board.isEscapeSquare(r, c), `it lands on an escape square, got ${r},${c}`);
  assert.ok(info.score >= MATE - 1000, 'and it is seen as a win');
  assert.equal(game.play(picked).status, 'defenders-win');
});

test('with the escape on, the AI plays the king and not a soldier', () => {
  const board = makeBoard('brandub', [
    '.K.....',
    '.......',
    '..D....',
    '.......',
    '.......',
    '.......',
    '......A',
  ]);
  const game = new Game(board.variant, board);
  game.turn = SIDE_DEFENDER;
  const { move: picked, info } = quickAi('hard').chooseMove(game, SIDE_DEFENDER);
  assert.equal(picked.from, idx(7, 0, 1));
  assert.equal(picked.to, idx(7, 0, 0), 'a win now beats any manoeuvre');
  assert.ok(info.score >= MATE - 1000, 'and it is recognised as a win');
  assert.equal(game.play(picked).status, 'defenders-win');
});

test('the evaluation rewards a king close to its escape square', () => {
  const rows = [
    '.......',
    '.......',
    '.......',
    '...K...',
    '.......',
    '.......',
    '.......',
  ];
  const centre = makeBoard('brandub', rows);
  const running = [...rows];
  running[3] = '......K';
  const corner = makeBoard('brandub', running);
  assert.ok(evaluate(corner) > evaluate(centre), 'a king one step from the edge is nearly won');
});

test('the AI never produces an illegal move, in any variant', () => {
  for (const id of Object.keys(VARIANTS)) {
    const game = Game.create(id);
    const ai = quickAi('easy');
    let plies = 0;
    while (!game.isGameOver() && plies < 40) {
      const side = game.turn;
      const { move: picked } = ai.chooseMove(game, side);
      if (!picked) break;
      assert.equal(
        game.board.isLegalMove(picked.from, picked.to, side),
        true,
        `${id} ply ${game.ply}: ${picked.from}->${picked.to} is legal`,
      );
      game.play(picked);
      plies += 1;
    }
    assert.ok(plies > 0, `${id} plays`);
  }
});

test('the search honours its time budget', () => {
  const variant = getVariant('copenhagen');
  const board = Board.fromVariant(variant);
  const started = Date.now();
  const result = searchBestMove(board, SIDE_ATTACKER, { maxDepth: 40, timeMs: 250 });
  const elapsed = Date.now() - started;
  assert.ok(result.move, 'it returns a move');
  assert.ok(result.depth >= 1, 'it completes at least one full depth');
  assert.ok(result.nodes > 100, `it visits nodes, saw ${result.nodes}`);
  assert.ok(elapsed < 1500, `it stops near its budget, took ${elapsed}ms`);
});

test('deeper search is not weaker: the same position improves with depth', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    '...A.....',
    '...K.....',
    '...A.....',
    '.........',
    '.........',
    '.........',
    '....A....',
  ]);
  const shallow = searchBestMove(board, SIDE_ATTACKER, { maxDepth: 1, timeMs: 200 });
  const deep = searchBestMove(board, SIDE_ATTACKER, { maxDepth: 6, timeMs: 200 });
  assert.ok(deep.score >= shallow.score, 'the mate is found at every depth that reaches it');
  assert.ok(deep.depth >= shallow.depth);
});

test('evaluation is from the defenders point of view', () => {
  const alive = makeBoard('tablut', [
    '.........',
    '.........',
    '.........',
    '...K.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '....A....',
  ]);
  const dead = makeBoard('tablut', [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '....A....',
  ]);
  assert.ok(evaluate(alive) > evaluate(dead), 'a live king is worth more than a dead one');
  assert.equal(evaluate(dead), -MATE);
  assert.ok(scoreFor(dead, SIDE_ATTACKER) > 0, 'the sign flips for the attacker to move');
});

test('a seeded AI is reproducible, an unseeded one is not fixed', () => {
  const game = Game.create('tawlbwrdd');
  const first = new AIPlayer('easy', { timeMs: 80, rng: seededRng(42) }).chooseMove(game).move;
  const second = new AIPlayer('easy', { timeMs: 80, rng: seededRng(42) }).chooseMove(game).move;
  assert.deepEqual(first, second);
  assert.ok(LEVELS.easy.noise > 0, 'the easy level is allowed to vary its play');
});

test('the move ordering capture count matches the board for every legal move', () => {
  const positions = [
    [Board.fromVariant(getVariant('tablut')), SIDE_ATTACKER],
    [Board.fromVariant(getVariant('copenhagen')), SIDE_DEFENDER],
    [Board.fromVariant(getVariant('tawlbwrdd')), SIDE_ATTACKER],
    [Board.fromVariant(getVariant('alea')), SIDE_ATTACKER],
  ];
  for (const [board, side] of positions) {
    const moves = board.legalMoves(side);
    assert.ok(moves.length > 20, `${board.variant.id} has moves to probe`);
    for (const picked of moves) {
      const real = realCaptures(board, picked, side);
      assert.equal(
        createsCapture(board, board.rowOf(picked.to), board.colOf(picked.to), side),
        real > 0,
        `${board.variant.id} ${picked.from}->${picked.to}: the board takes ${real}`,
      );
    }
  }
});

test('the quiescence search follows only the moves that take a piece', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '..A.DA...',
    '.........',
    '.........',
    '.........',
  ]);
  const all = board.legalMoves(SIDE_ATTACKER);
  const taking = all.filter((picked) => realCaptures(board, picked, SIDE_ATTACKER) > 0);
  assert.deepEqual(
    taking.map((picked) => `${picked.from}-${picked.to}`),
    [`${idx(9, 5, 2)}-${idx(9, 5, 3)}`],
    'only the count that closes the net on the duke takes',
  );
  const quiet = new Set(all.filter((picked) => realCaptures(board, picked, SIDE_ATTACKER) === 0)
    .map((picked) => `${picked.from}-${picked.to}`));
  const offered = captureMoves(board, SIDE_ATTACKER).filter((picked) => picked.order >= 1e5);
  assert.deepEqual(
    offered.map((picked) => `${picked.from}-${picked.to}`).sort(),
    taking.map((picked) => `${picked.from}-${picked.to}`).sort(),
    'exactly the capturing moves are offered',
  );
  assert.ok(!offered.some((picked) => quiet.has(`${picked.from}-${picked.to}`)), 'a quiet move is never followed');
});

test('the zobrist key follows the board as moves and captures are played', () => {
  const game = Game.create('tablut');
  const rng = seededRng(5);
  let plies = 0;
  while (plies < 40 && !game.isGameOver()) {
    const side = game.turn;
    const moves = game.board.legalMoves(side);
    const picked = moves[Math.floor(rng() * moves.length)];
    const key = hashBoard(game.board, side);
    const piece = game.board.grid[picked.from];
    const applied = game.board.applyMove(picked);
    applyKey(key, piece, picked, applied.captured);
    const next = side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER;
    assert.deepEqual(key, hashBoard(game.board, next), `ply ${plies}: the key tracks the board`);
    game.board.undoMove(picked, applied);
    game.play(picked);
    plies += 1;
  }
  assert.equal(plies, 40, 'the key survives a long game');
});

test('a node budget makes the search reproducible and the table is reused', () => {
  const board = Board.fromVariant(getVariant('copenhagen'));
  const budget = { maxDepth: 8, timeMs: 60000, maxNodes: 40000 };
  const one = searchBestMove(board, SIDE_ATTACKER, budget);
  const two = searchBestMove(board, SIDE_ATTACKER, budget);
  assert.ok(one.move, 'the search answers');
  assert.ok(one.nodes >= 40000, `the node budget is spent, saw ${one.nodes}`);
  assert.deepEqual(one.move, two.move, 'the same node budget gives the same move');
  assert.equal(one.score, two.score, 'and the same score');

  const table = new TranspositionTable();
  searchBestMove(board, SIDE_ATTACKER, { ...budget, table });
  const warm = searchBestMove(board, SIDE_ATTACKER, { ...budget, table });
  assert.ok(warm.ttSize > 0, 'the transposition table keeps what the first search learned');
  assert.ok(warm.move, 'the warm search still answers');
});

test('the opening book gives the strong levels a legal prepared opening', (t) => {
  const book = loadBook();
  if (!book) {
    t.skip('no book.json yet: run node tools/make-book.js');
    return;
  }
  assert.ok(book.positions > 100, `${book.positions} prepared positions`);
  for (const id of ['brandub', 'copenhagen', 'tablut', 'alea']) {
    const game = Game.create(id);
    const list = bookMoves(game, game.turn);
    assert.ok(list.length > 0, `${id} opens from the book`);
    for (const picked of list) {
      assert.equal(game.board.isLegalMove(picked.from, picked.to, game.turn), true, `${id} book move is legal`);
    }
  }
  const hard = new AIPlayer('hard', {}).chooseMove(Game.create('tablut'));
  assert.equal(hard.info.source, 'book', 'the hard level opens from the book');
  const easy = new AIPlayer('easy', { timeMs: 30, rng: seededRng(3) }).chooseMove(Game.create('tablut'));
  assert.notEqual(easy.info.source, 'book', 'the easy level still searches');

  const late = Game.create('tablut');
  const rng = seededRng(9);
  while (late.ply <= book.maxPly && !late.isGameOver()) {
    const moves = late.board.legalMoves(late.turn);
    late.play(moves[Math.floor(rng() * moves.length)]);
  }
  assert.deepEqual(bookMoves(late, late.turn), [], 'the book is an opening book, not a tablebase');
});
