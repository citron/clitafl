'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Board } = require('../src/rules/board');
const { Game } = require('../src/rules/game');
const { getVariant, VARIANTS } = require('../src/rules/variants');
const { KING, DEFENDER, ATTACKER, EMPTY, SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');
const { makeBoard, idx, move } = require('./helpers');

/** An empty board of the variant with a few pieces placed, for geometry probes. */
function aleaPlaced(cells) {
  const board = new Board(getVariant('alea'));
  for (const [r, c, code] of cells) board.set(r, c, code);
  board.kingPos = board.indexOf(KING);
  return board;
}

test('tablut setup matches the historical army', () => {
  const board = Board.fromVariant(getVariant('tablut'));
  assert.equal(board.size, 9);
  assert.equal(board.countOf(SIDE_DEFENDER), 9, 'king + 8 defenders');
  assert.equal(board.countOf(SIDE_ATTACKER), 16);
  assert.equal(board.get(4, 4), KING);
  assert.equal(board.get(0, 4), ATTACKER, 'attacker on the edge midpoint');
  assert.equal(board.get(3, 4), DEFENDER, 'defender beside the castle');
  assert.equal(board.get(0, 0), EMPTY, 'the corner is plain board, and empty');
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
  assert.equal(tablut.isCastle(0, 0), false, 'the board has no corner forts');
  assert.equal(tablut.isEscapeSquare(0, 0), true, 'a corner is an edge square, so an exit');
  assert.equal(tablut.isEscapeSquare(0, 4), true, 'edge square');
  assert.equal(tablut.isEscapeSquare(4, 4), false, 'throne is not an escape square');

  const cph = Board.fromVariant(getVariant('copenhagen'));
  assert.equal(cph.isEscapeSquare(0, 0), true, 'corners are the escapes');
  assert.equal(cph.isEscapeSquare(0, 5), false, 'edge midpoint is not an escape');
  assert.equal(cph.isCastle(5, 5), true, 'the throne is a fort');
  assert.equal(cph.isCastle(0, 0), true, 'the corners are forts');

  // Brandub rule 3: the centre and the four corners are marked squares.
  const brandub = Board.fromVariant(getVariant('brandub'));
  assert.equal(brandub.isCastle(3, 3), true, 'the centre is a marked square');
  assert.equal(brandub.isCastle(0, 6), true, 'the corners are marked squares');
  assert.equal(brandub.isCastle(2, 2), false, 'a plain square is not');
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
  assert.equal(board.isLegalMove(idx(9, 4, 0), idx(9, 0, 0), SIDE_DEFENDER), true, 'tablut has no corner forts');
  const lane = board.movesFrom(4, 0).map((m) => [board.rowOf(m.to), board.colOf(m.to)]);
  assert.deepEqual(
    lane.filter(([r, c]) => r === 4 && c > 4).map(([, c]) => c),
    [5, 6, 7, 8],
    'the throne is not a wall: a man walks past it, he only may not stop on it',
  );
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
    assert.ok(['edge', 'corner', 'cornerblock'].includes(v.escape), `${id} escape`);
    const castles = ['none', 'throne', 'corners', 'throne-corners', 'throne-cornerblocks'];
    assert.ok(castles.includes(v.castles), `${id} castles`);
    assert.ok([SIDE_ATTACKER, SIDE_DEFENDER].includes(v.first), `${id} first move`);
    assert.ok(v.kingCapture.elsewhere >= 2, `${id} king capture`);
    assert.ok(v.maxPlies > 0, `${id} move limit`);
    assert.equal(v.size % 2, 1, `${id} odd size`);
  }
});

test('alea evangelii: the manuscript army on a 19x19 board', () => {
  const board = Board.fromVariant(getVariant('alea'));
  assert.equal(board.size, 19);
  assert.equal(board.countOf(SIDE_DEFENDER), 25, 'king + 24 dukes');
  assert.equal(board.countOf(SIDE_ATTACKER), 48, '48 counts');
  assert.equal(board.get(9, 9), KING, 'the king opens on the central castle');
  for (const [r, c] of [[0, 0], [1, 1], [18, 18], [17, 18], [0, 17], [1, 16]]) {
    assert.equal(board.get(r, c), EMPTY, `the marked square ${r},${c} starts empty`);
  }
  let same = true;
  for (let r = 0; r < 19; r += 1) {
    for (let c = 0; c < 19; c += 1) {
      if (board.get(r, c) !== board.get(c, 18 - r)) same = false;
    }
  }
  assert.ok(same, 'the reconstruction is symmetric under a quarter turn');
});

test('alea: the 16 marked squares are the exits, and only the king may enter them', () => {
  const board = Board.fromVariant(getVariant('alea'));
  const exits = [];
  for (let r = 0; r < 19; r += 1) {
    for (let c = 0; c < 19; c += 1) {
      if (board.isEscapeSquare(r, c)) exits.push([r, c]);
    }
  }
  assert.equal(exits.length, 16, 'four marked 2x2 blocks');
  assert.equal(board.isEscapeSquare(0, 9), false, 'the plain edge is not an exit');
  assert.equal(board.isEscapeSquare(2, 0), false, 'only the marked block counts');
  assert.equal(board.isCastle(0, 1), true, 'a marked square is a castle');
  assert.equal(board.isCastle(9, 9), true, 'the citadel is a castle');
  assert.equal(board.isCastle(5, 5), false, 'an ordinary square is not');

  board.set(0, 4, DEFENDER);
  board.set(0, 5, ATTACKER);
  assert.equal(board.isLegalMove(idx(19, 0, 4), idx(19, 0, 1), SIDE_DEFENDER), false, 'a duke may not enter a marked square');
  assert.equal(board.isLegalMove(idx(19, 0, 5), idx(19, 0, 1), SIDE_ATTACKER), false, 'nor may a count');

  const open = aleaPlaced([[9, 3, ATTACKER]]);
  assert.equal(open.isLegalMove(idx(19, 9, 3), idx(19, 9, 9), SIDE_ATTACKER), false, 'the citadel is off limits to all');
  assert.equal(open.isLegalMove(idx(19, 9, 3), idx(19, 9, 15), SIDE_ATTACKER), true, 'passing over the empty citadel is legal');
});

test('alea: the king is taken by four counts on the citadel, three beside it, two in the open', () => {
  const board = aleaPlaced([
    [9, 8, KING],
    [8, 8, ATTACKER],
    [10, 13, ATTACKER],
  ]);
  assert.equal(board.kingCaptureNeed(9, 9), 4, 'on the citadel');
  assert.equal(board.kingCaptureNeed(9, 8), 3, 'beside the citadel');
  assert.equal(board.kingCaptureNeed(5, 5), 2, 'in the open field');

  const taken = board.applyMove({ from: idx(19, 10, 13), to: idx(19, 10, 8) });
  assert.deepEqual(taken.captured.map((cap) => cap.value), [KING], 'the empty citadel and two counts close the net');
  assert.equal(board.kingAlive(), false);
});

test('alea: the king on the citadel needs all four counts, marked squares and edges take soldiers', () => {
  const onThrone = aleaPlaced([
    [9, 9, KING],
    [8, 9, ATTACKER],
    [10, 9, ATTACKER],
    [9, 8, ATTACKER],
    [9, 13, ATTACKER],
  ]);
  const three = onThrone.applyMove({ from: idx(19, 9, 13), to: idx(19, 9, 12) });
  assert.deepEqual(three.captured, [], 'three counts around the citadel are not enough');
  onThrone.undoMove({ from: idx(19, 9, 13), to: idx(19, 9, 12) }, three);
  const four = onThrone.applyMove({ from: idx(19, 9, 13), to: idx(19, 9, 10) });
  assert.deepEqual(four.captured.map((cap) => cap.value), [KING], 'the fourth count takes the king');

  const marked = aleaPlaced([
    [18, 2, DEFENDER],
    [18, 5, ATTACKER],
  ]);
  const againstBlock = marked.applyMove({ from: idx(19, 18, 5), to: idx(19, 18, 3) });
  assert.deepEqual(againstBlock.captured.map((cap) => cap.value), [DEFENDER], 'the empty marked square captures as a count');

  const edge = aleaPlaced([
    [0, 5, DEFENDER],
    [0, 4, ATTACKER],
    [0, 9, ATTACKER],
  ]);
  const againstEdge = edge.applyMove({ from: idx(19, 0, 9), to: idx(19, 0, 6) });
  assert.deepEqual(againstEdge.captured.map((cap) => cap.value), [DEFENDER], 'a duke on the edge falls between two counts');
});

test('alea: a king that reaches a marked square has escaped, and the edge does not free him', () => {
  const toEdge = new Game(getVariant('alea'), aleaPlaced([[10, 4, KING], [10, 15, ATTACKER]]));
  toEdge.turn = SIDE_DEFENDER;
  const edge = toEdge.play({ from: idx(19, 10, 4), to: idx(19, 0, 4) });
  assert.equal(edge.status, 'playing', 'the plain edge is not an exit');

  const board = aleaPlaced([[0, 4, KING], [10, 15, ATTACKER]]);
  const game = new Game(board.variant, board);
  game.turn = SIDE_DEFENDER;
  const out = game.play({ from: idx(19, 0, 4), to: idx(19, 0, 1) });
  assert.equal(out.status, 'defenders-win', 'the marked corner square is the exit');
  assert.ok(board.kingHasEscaped);
  assert.equal(board.get(0, 1), KING, 'the escape is settled before any capture');
});

test('board sizes run from 7 to 19 and stay odd', () => {
  assert.equal(getVariant('tablut', 19).size, 19, 'a 19x19 tablut is allowed');
  assert.equal(getVariant('tablut', 7).size, 7);
  assert.throws(() => getVariant('tablut', 21), /between 7 and 19/);
  assert.throws(() => getVariant('tablut', 5), /between 7 and 19/);
  assert.throws(() => getVariant('tablut', 8), /must be odd/);
});

// ---------------------------------------------------------------------------
// Rule details pinned down from the sources: tafl.cyningstan.com (the 13 tablut
// and 13 copenhagen articles, the 12 brandub and 12 alea rules), aagenielsen.dk
// and hnefatafl.org.
// ---------------------------------------------------------------------------

test('the copenhagen edge is not a captor', () => {
  // Copenhagen rule 5: the edge of the board is not hostile, so a man pressed
  // against it by a single enemy survives. Tawlbwrdd keeps the ordinary wall.
  const cph = makeBoard('copenhagen', [
    '..D........',
    '..A........',
    '...........',
    '...........',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
  ]);
  assert.equal(cph.isSurrounded(0, 2, DEFENDER, SIDE_ATTACKER), false, 'the edge does not take him');

  const tawlbwrdd = makeBoard('tawlbwrdd', [
    '..D........',
    '..A........',
    '...........',
    '...........',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
  ]);
  assert.equal(tawlbwrdd.isSurrounded(0, 2, DEFENDER, SIDE_ATTACKER), true, 'there the edge is a captor');
});

test('the king returns to his copenhagen throne, and never to the tablut one', () => {
  // Copenhagen rule 1 ("the king may move onto these squares") and rule 8 ("if
  // the king returns to the fort, the game continues"); tablut rule 5 ("the king
  // is barred from entering the castle, including the throne square").
  const cph = makeBoard('copenhagen', [
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '....K......',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
  ]);
  assert.equal(cph.isLegalMove(idx(11, 5, 4), idx(11, 5, 5), SIDE_DEFENDER), true, 'the king lands on his fort');
  assert.equal(cph.isLegalMove(idx(11, 5, 4), idx(11, 5, 9), SIDE_DEFENDER), true, 'and on plain squares as usual');

  const soldier = makeBoard('copenhagen', [
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '....D......',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '...........',
  ]);
  assert.equal(soldier.isLegalMove(idx(11, 5, 4), idx(11, 5, 5), SIDE_DEFENDER), false, 'a defender never enters the fort');

  const tab = makeBoard('tablut', [
    '.........',
    '.........',
    '.........',
    '....K....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  assert.equal(tab.isLegalMove(idx(9, 3, 4), idx(9, 4, 4), SIDE_DEFENDER), false, 'tablut: the king stays out of the castle');
});

test('the shield wall takes a line of men at the edge', () => {
  // Copenhagen rule 7: the attacker plays the man that closes the row, and the
  // four defenders shut in against the top edge fall.
  const board = makeBoard('copenhagen', [
    '...DDDDA...',
    '...AAAA....',
    '...........',
    '...........',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '..A........',
    '...........',
    '...........',
  ]);
  const from = idx(11, 8, 2);
  const to = idx(11, 0, 2);
  assert.equal(board.isLegalMove(from, to, SIDE_ATTACKER), true, 'the lane up the file is open');
  const taken = board.applyMove({ from, to }).captured
    .map((cap) => [board.rowOf(cap.i), board.colOf(cap.i)]).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(taken, [[0, 3], [0, 4], [0, 5], [0, 6]], 'the whole wall of defenders falls');
});

test('the shield wall needs a line, a bracket, and every man pressed from the inside', () => {
  const single = makeBoard('copenhagen', [
    '..........D',
    '..........A',
    '...........',
    '...........',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '.........A.',
    '...........',
    '...........',
  ]);
  assert.deepEqual(
    single.applyMove({ from: idx(11, 8, 9), to: idx(11, 0, 9) }).captured,
    [],
    'one man alone in the corner is not a line',
  );

  const openEnd = makeBoard('copenhagen', [
    '...DDD.....',
    '...AAA.....',
    '...........',
    '...........',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '..A........',
    '...........',
    '...........',
  ]);
  assert.deepEqual(
    openEnd.applyMove({ from: idx(11, 8, 2), to: idx(11, 0, 2) }).captured,
    [],
    'the far end of the line is open, so nothing falls',
  );

  const kingInLine = makeBoard('copenhagen', [
    '...DKDDA...',
    '...AAAA....',
    '...........',
    '...........',
    '...........',
    '.....K.....',
    '...........',
    '...........',
    '..A........',
    '...........',
    '...........',
  ]);
  const res = kingInLine.applyMove({ from: idx(11, 8, 2), to: idx(11, 0, 2) });
  assert.deepEqual(res.captured, [], 'the wall stops at the king, who falls to the plain rule only');
});

test('the throne alone raises the garrison around the king', () => {
  // The sources raise the count for the throne ("four on the castle, three next
  // to it"), never for the other marked squares: a king tucked beside a corner
  // fort is taken the ordinary way in brandub, and in copenhagen the corner fort
  // does not bring the four attackers down to three.
  const brandub = makeBoard('brandub', [
    '.KA....',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ]);
  assert.equal(brandub.isSurrounded(0, 1, KING, SIDE_ATTACKER), true, 'the empty corner fort and one attacker take the king');

  const cph = makeBoard('copenhagen', [
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '..........A',
    '.........AK',
    '...........',
  ]);
  assert.equal(cph.isSurrounded(9, 10, KING, SIDE_ATTACKER), false, 'the corner fort and two attackers are not four');
});
