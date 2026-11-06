'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Board } = require('../src/rules/board');
const { getVariant, VARIANTS } = require('../src/rules/variants');
const { KING, DEFENDER, ATTACKER, EMPTY, SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');
const { makeBoard, idx, move } = require('./helpers');

test('tablut setup matches the historical army', () => {
  const board = Board.fromVariant(getVariant('tablut'));
  assert.equal(board.size, 9);
  assert.equal(board.countOf(SIDE_DEFENDER), 9, 'king + 8 defenders');
  assert.equal(board.countOf(SIDE_ATTACKER), 16);
  assert.equal(board.get(4, 4), KING);
  assert.equal(board.get(0, 4), ATTACKER, 'attacker on the edge midpoint');
  assert.equal(board.get(3, 4), DEFENDER, 'defender beside the castle');
  assert.equal(board.get(0, 0), EMPTY, 'corner fort stays empty');
});

test('copenhagen setup: 12 defenders plus king, 24 attackers', () => {
  const board = Board.fromVariant(getVariant('copenhagen'));
  assert.equal(board.size, 11);
  assert.equal(board.countOf(SIDE_DEFENDER), 13);
  assert.equal(board.countOf(SIDE_ATTACKER), 24);
});

test('brandub and ard-ri piece counts follow their sources', () => {
  const brandub = Board.fromVariant(getVariant('brandub'));
  assert.equal(brandub.countOf(SIDE_DEFENDER), 5, 'king + 4');
  assert.equal(brandub.countOf(SIDE_ATTACKER), 8);

  const ardri = Board.fromVariant(getVariant('ard-ri'));
  assert.equal(ardri.countOf(SIDE_DEFENDER), 9, 'king + 8');
  assert.equal(ardri.countOf(SIDE_ATTACKER), 16);
});

test('castle squares and escape squares follow the variant, not a hardcoded layout', () => {
  const tablut = Board.fromVariant(getVariant('tablut'));
  assert.equal(tablut.isCastle(4, 4), true, 'the throne is a castle');
  assert.equal(tablut.isCastle(0, 0), true, 'corners are forts');
  assert.equal(tablut.isEscapeSquare(0, 4), true, 'edge square');
  assert.equal(tablut.isEscapeSquare(4, 4), false, 'throne is not an escape square');

  const cph = Board.fromVariant(getVariant('copenhagen'));
  assert.equal(cph.isEscapeSquare(0, 0), true, 'corners are the escapes');
  assert.equal(cph.isEscapeSquare(0, 5), false, 'edge midpoint is not an escape');
  assert.equal(cph.isCastle(5, 5), true);

  const brandub = Board.fromVariant(getVariant('brandub'));
  assert.equal(brandub.isCastle(3, 3), false, 'brandub has no special squares');
});

test('movement is rook-like and blocked by pieces', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    '....A....',
    '.........',
    '....K....',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const fileMoves = board.movesFrom(4, 4).filter((m) => board.colOf(m.to) === 4);
  assert.deepEqual(
    fileMoves.map((m) => board.rowOf(m.to)).filter((r) => r < 4),
    [3],
    'the attacker at (2,4) blocks the file',
  );
  const rankMoves = board.movesFrom(4, 4).filter((m) => board.rowOf(m.to) === 4);
  assert.deepEqual(rankMoves.map((m) => board.colOf(m.to)).sort((a, b) => a - b), [0, 1, 2, 3, 5, 6, 7, 8]);
});

test('nobody may land on the throne, the king may enter escape castles', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    '.........',
    '.........',
    'D........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  board.set(4, 4, EMPTY);
  assert.equal(board.isLegalMove(idx(9, 4, 0), idx(9, 4, 3), SIDE_DEFENDER), true);
  assert.equal(board.isLegalMove(idx(9, 4, 0), idx(9, 4, 4), SIDE_DEFENDER), false, 'the castle is off limits');
  assert.equal(board.isLegalMove(idx(9, 4, 0), idx(9, 0, 0), SIDE_DEFENDER), false, 'a fort is off limits to soldiers');
});

test('a castle square that is an escape target is reserved for the king', () => {
  const rows = [
    '..K....A...',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
  ];
  const kingBoard = makeBoard('copenhagen', rows);
  assert.equal(kingBoard.isLegalMove(idx(11, 0, 2), idx(11, 0, 0), SIDE_DEFENDER), true, 'the king escapes into the fort');

  const soldierRows = [...rows];
  soldierRows[0] = '..D....A...';
  const soldierBoard = makeBoard('copenhagen', soldierRows);
  assert.equal(soldierBoard.isLegalMove(idx(11, 0, 2), idx(11, 0, 0), SIDE_DEFENDER), false, 'soldiers may not enter a fort');
});

test('soldiers are captured between two enemies on opposite sides', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    '.........',
    '..AD.....',
    '....K....',
    '.........',
    '.........',
    '.........',
    '.......A.',
  ]);
  board.set(3, 8, ATTACKER);
  const applied = board.applyMove(move(9, [3, 8], [3, 4]));
  assert.equal(applied.captured.length, 1);
  assert.equal(applied.captured[0].value, DEFENDER);
  assert.equal(board.get(3, 3), EMPTY, 'the defender is off the board');
});

test('the edge shields only in variants that say so', () => {
  const rows = [
    'D........',
    '.........',
    '.........',
    '.........',
    '....K....',
    '.........',
    '.........',
    '.........',
    '.......A.',
  ];
  const tablut = makeBoard('tablut', rows);
  tablut.applyMove(move(9, [8, 8], [0, 1]));
  assert.equal(tablut.get(0, 0), DEFENDER, 'tablut has no edge capture: the defender survives');

  const brandub = makeBoard('brandub', [
    'D......',
    '.......',
    '.......',
    '..K....',
    '.......',
    '.......',
    '......A',
  ]);
  brandub.applyMove(move(7, [6, 6], [0, 1]));
  assert.equal(brandub.get(0, 0), EMPTY, 'brandub captures against the edge');
});

test('an empty castle square acts as a captor in tablut', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    'A........',
    '....D....',
    '....K....',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  board.set(4, 4, EMPTY);
  const applied = board.applyMove(move(9, [2, 0], [2, 4]));
  assert.equal(applied.captured.length, 1, 'the defender is taken between an attacker and the empty castle');
  assert.equal(applied.captured[0].value, DEFENDER);
});

test('the copenhagen king needs four attackers in the open field', () => {
  const rows = [
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '.....A.....',
    'A....KA....',
    '.....A.....',
    '...........',
  ];
  const four = makeBoard('copenhagen', rows);
  const applied = four.applyMove(move(11, [8, 0], [8, 4]));
  assert.equal(applied.captured.length, 1, 'four attackers close the net');
  assert.equal(applied.captured[0].value, KING);
  assert.equal(four.kingAlive(), false);

  const threeRows = [...rows];
  threeRows[9] = '...........';
  const three = makeBoard('copenhagen', threeRows);
  const second = three.applyMove(move(11, [8, 0], [8, 4]));
  assert.equal(second.captured.length, 0, 'three attackers are not enough away from the throne');
});

test('beside the throne three attackers are enough, and the empty throne is a captor', () => {
  const board = makeBoard('copenhagen', [
    '...........',
    '...........',
    '...........',
    '...........',
    '....A......',
    '....K......',
    '...........',
    '...........',
    '...........',
    '...........',
    '....A......',
  ]);
  const applied = board.applyMove(move(11, [10, 4], [6, 4]));
  assert.equal(applied.captured.length, 1, 'throne + (4,4) + (6,4) = three captors beside the castle');
  assert.equal(applied.captured[0].value, KING);
});

test('the copenhagen king cannot be captured on the board edge', () => {
  const board = makeBoard('copenhagen', [
    '....A......',
    '.....A.....',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
  ]);
  board.set(0, 5, KING);
  board.applyMove(move(11, [0, 10], [0, 6]));
  assert.equal(board.get(0, 5), KING, 'edge kings are safe in copenhagen');
});

test('apply and undo are exact inverses', () => {
  const board = makeBoard('tablut', [
    '.........',
    '....D....',
    '....A....',
    '.........',
    '.........',
    '.........',
    '.........',
    '....D....',
    '.........',
  ]);
  const before = Array.from(board.grid);
  const m = move(9, [7, 4], [3, 4]);
  const applied = board.applyMove(m);
  assert.equal(applied.captured.length, 1, 'the arriving defender completes the pincer');
  assert.equal(applied.captured[0].value, ATTACKER);
  board.undoMove(m, applied);
  assert.deepEqual(Array.from(board.grid), before);
});

test('board serialisation round-trips', () => {
  const board = Board.fromVariant(getVariant('copenhagen'));
  const data = board.serialize();
  const restored = Board.deserialize(getVariant('copenhagen'), data);
  assert.deepEqual(Array.from(restored.grid), Array.from(board.grid));
  assert.equal(restored.kingPos, board.kingPos);
});

test('geometry scales with the board size', () => {
  for (const size of [7, 9, 11, 13, 15]) {
    const variant = getVariant('tablut', size);
    const board = Board.fromVariant(variant);
    const c = (size - 1) / 2;
    assert.equal(board.get(c, c), KING, `king on the throne of a ${size}x${size} board`);
    assert.equal(board.size, size);
    assert.ok(board.legalMoves(SIDE_ATTACKER).length > 0, `attackers can open on ${size}x${size}`);
    assert.equal(board.isCastle(c, c), true);
  }
});

test('the king side is sealed in when walled off by attackers', () => {
  const walls = [
    '...........',
    '...........',
    '...........',
    '...AAAAA...',
    '...A.D.A...',
    '...ADKDA...',
    '...A.D.A...',
    '...AAAAA...',
    '...........',
    '...........',
    '...........',
  ];
  const board = makeBoard('copenhagen', walls);
  assert.equal(board.kingSideSealedIn(), true, 'encircled, with no escape square in the region');

  const open = [...walls];
  open[5] = '....DKDA...';
  const openBoard = makeBoard('copenhagen', open);
  assert.equal(openBoard.kingSideSealedIn(), false, 'a hole in the wall lets the host reach a corner');
});

test('every variant declares a complete rule set', () => {
  for (const id of Object.keys(VARIANTS)) {
    const v = VARIANTS[id];
    assert.ok(['edge', 'corner'].includes(v.escape), `${id} escape`);
    assert.ok(['none', 'throne', 'corners', 'throne-corners'].includes(v.castles), `${id} castles`);
    assert.ok([SIDE_ATTACKER, SIDE_DEFENDER].includes(v.first), `${id} first move`);
    assert.ok(v.kingCapture.elsewhere >= 2, `${id} king capture`);
    assert.ok(v.maxPlies > 0, `${id} move limit`);
    assert.equal(v.size % 2, 1, `${id} odd size`);
  }
});
