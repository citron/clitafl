'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Game, STATUS_PLAYING, STATUS_DEFENDERS_WIN, STATUS_ATTACKERS_WIN, STATUS_DRAW,
} = require('../src/rules/game');
const { Board } = require('../src/rules/board');
const { getVariant, VARIANTS } = require('../src/rules/variants');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');
const { makeBoard, move } = require('./helpers');

const gameFrom = (variantId, rows, options) => {
  const board = makeBoard(variantId, rows, options);
  return new Game(board.variant, board);
};

test('every shipped variant opens with the attackers', () => {
  for (const id of Object.keys(VARIANTS)) {
    const game = Game.create(id);
    assert.equal(game.turn, SIDE_ATTACKER, `${id} first move`);
    assert.equal(game.status, STATUS_PLAYING);
    assert.equal(game.ply, 0);
    assert.ok(game.legalMoves().length > 0, `${id} opens with a legal move`);
  }
});

test('the king reaching an escape square wins for the defenders', () => {
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
  const result = game.play(move(7, [0, 1], [0, 0]));
  assert.equal(result.status, STATUS_DEFENDERS_WIN);
  assert.equal(game.winner, SIDE_DEFENDER);
  assert.match(game.reason, /escape square/);
});

test('capturing the king wins for the attackers', () => {
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
  const result = game.play(move(9, [8, 4], [3, 4]));
  assert.equal(result.captured.length, 1);
  assert.equal(result.status, STATUS_ATTACKERS_WIN);
  assert.equal(game.winner, SIDE_ATTACKER);
  assert.equal(game.board.kingAlive(), false);
});

test('an illegal move is refused and leaves the game untouched', () => {
  const game = Game.create('tablut');
  const before = Array.from(game.board.grid);
  assert.throws(() => game.play(move(9, 0, 1)), /Illegal move/);
  assert.throws(() => game.play('a1-a5'), /Illegal move/);
  assert.equal(game.ply, 0);
  assert.deepEqual(Array.from(game.board.grid), before);
});

test('a finished game refuses to be played', () => {
  const game = gameFrom('brandub', [
    '.K.....',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ]);
  game.turn = SIDE_DEFENDER;
  game.play(move(7, [0, 1], [0, 0]));
  assert.ok(game.isGameOver());
  assert.throws(() => game.play(move(7, [5, 5], [5, 4])), /Game is over/);
});

test('a move given as text notation is accepted', () => {
  const game = Game.create('tablut');
  const result = game.play('e1-e2');
  assert.equal(result.notation, 'e1-e2');
  assert.equal(game.ply, 1);
  assert.equal(game.turn, SIDE_DEFENDER);
});

test('the siege rule: sealing the king and his host wins for the attackers', () => {
  const game = gameFrom('copenhagen', [
    '...........',
    '...........',
    '...........',
    '...AAAAA...',
    '...A.D.A...',
    '...ADKDA...',
    'A....D.A...',
    '...AAAAA...',
    '...........',
    '...........',
    '...........',
  ]);
  assert.equal(game.board.kingSideSealedIn(), false, 'the corridor to the corner is still open');
  const result = game.play(move(11, [6, 0], [6, 3]));
  assert.equal(result.status, STATUS_ATTACKERS_WIN);
  assert.match(game.reason, /sealed in/);
});

test('a side with no legal move: draw in tablut, loss in brandub', () => {
  const tablut = gameFrom('tablut', [
    '....A....',
    '.........',
    '.........',
    '....A....',
    '...AKA...',
    '....A....',
    '.........',
    '.........',
    '.........',
  ]);
  assert.equal(tablut.board.hasLegalMoves(SIDE_DEFENDER), false, 'the king is boxed in');
  const tablutResult = tablut.play(move(9, [0, 4], [1, 4]));
  assert.equal(tablutResult.status, STATUS_DRAW);
  assert.match(tablutResult.reason, /no legal move/);

  const brandub = gameFrom('brandub', [
    '.......',
    '.......',
    '...A...',
    '..AKA..',
    '...A...',
    '.......',
    '......A',
  ]);
  assert.equal(brandub.board.hasLegalMoves(SIDE_DEFENDER), false, 'the king is boxed in');
  const brandubResult = brandub.play(move(7, [6, 6], [6, 5]));
  assert.equal(brandubResult.status, STATUS_ATTACKERS_WIN);
  assert.match(brandubResult.reason, /no legal move/);
});

test('a position that repeats three times is a draw', () => {
  const game = gameFrom('tablut', [
    '....A....',
    '.........',
    '.........',
    '.........',
    '....K....',
    '.........',
    '......D..',
    '.........',
    '.........',
  ]);
  const attackers = [move(9, [0, 4], [1, 4]), move(9, [1, 4], [0, 4])];
  const defenders = [move(9, [6, 6], [6, 7]), move(9, [6, 7], [6, 6])];
  for (let round = 0; round < 5 && !game.isGameOver(); round += 1) {
    game.play(attackers[round % 2]);
    if (game.isGameOver()) break;
    game.play(defenders[round % 2]);
  }
  assert.equal(game.status, STATUS_DRAW, `expected a repetition draw, got ${game.status}: ${game.reason}`);
  assert.match(game.reason, /repeated/);
});

test('the copenhagen move limit is a win for the attackers', () => {
  // Copenhagen rule 13: after 100 / 140 / 160 moves the attackers win.
  const variant = { ...getVariant('copenhagen'), maxPlies: 4 };
  const game = new Game(variant, Board.fromVariant(variant));
  while (game.status === STATUS_PLAYING && game.ply < 4) game.play(game.legalMoves()[0]);
  assert.equal(game.status, STATUS_ATTACKERS_WIN);
  assert.equal(game.winner, SIDE_ATTACKER);
  assert.match(game.reason, /2 moves/);
});

test('the move limit follows the size where the rules state one per size', () => {
  // 10 x (size + 3) moves: 100 on 7x7, 140 on 11x11, 160 on 13x13.
  assert.equal(getVariant('copenhagen', 7).maxPlies, 200);
  assert.equal(getVariant('copenhagen', 11).maxPlies, 280);
  assert.equal(getVariant('copenhagen', 13).maxPlies, 320);
  assert.equal(getVariant('tablut', 11).maxPlies, getVariant('tablut').maxPlies, 'the other variants keep their own limit');
});

test('the ply limit is declared a draw', () => {
  const variant = { ...getVariant('tablut'), maxPlies: 2 };
  const game = new Game(variant, Board.fromVariant(variant));
  game.play(game.legalMoves()[0]);
  assert.equal(game.status, STATUS_PLAYING);
  game.play(game.legalMoves()[0]);
  assert.equal(game.status, STATUS_DRAW);
  assert.match(game.reason, /2 plies/);
});

test('undo rewinds the board, the turn and the status', () => {
  const variant = getVariant('tablut');
  const game = new Game(variant, Board.fromVariant(variant));
  const start = Array.from(game.board.grid);
  game.play(game.legalMoves()[0]);
  game.play(game.legalMoves()[0]);
  assert.equal(game.ply, 2);
  assert.equal(game.undo(2), 2);
  assert.equal(game.ply, 0);
  assert.equal(game.turn, variant.first);
  assert.equal(game.status, STATUS_PLAYING);
  assert.deepEqual(Array.from(game.board.grid), start);
});

test('undo also puts the captured pieces back', () => {
  const game = gameFrom('tablut', [
    '.........',
    '.........',
    '.........',
    '.........',
    '....K....',
    '.....DA..',
    '.........',
    '.........',
    '....A....',
  ]);
  const before = Array.from(game.board.grid);
  game.play(move(9, [8, 4], [5, 4]));
  const entry = game.history[game.history.length - 1];
  assert.equal(entry.captured.length, 1, 'the attacker lands on the far side of the defender');
  game.undo(1);
  assert.deepEqual(Array.from(game.board.grid), before);
  assert.equal(game.ply, 0);
});

test('a game round-trips through a JSON save file', () => {
  const game = Game.create('copenhagen');
  game.play(game.legalMoves()[0]);
  game.play(game.legalMoves()[0]);
  const restored = Game.deserialize(JSON.parse(JSON.stringify(game.serialize())));
  assert.equal(restored.variant.id, 'copenhagen');
  assert.equal(restored.ply, game.ply);
  assert.equal(restored.turn, game.turn);
  assert.deepEqual(Array.from(restored.board.grid), Array.from(game.board.grid));
});

test('a save file that is not ours is rejected', () => {
  assert.throws(() => Game.deserialize({ format: 'other' }), /clitafl save file/);
  const data = Game.create('tablut').serialize();
  data.board.rows[0] = 'short';
  assert.throws(() => Game.deserialize(data), /row length/i);
});
