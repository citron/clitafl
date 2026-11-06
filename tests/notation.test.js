'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatSquare, parseSquare, formatMove, parseMove, formatCaptures,
} = require('../src/rules/notation');
const { KING, DEFENDER, ATTACKER } = require('../src/rules/pieces');

test('squares are file letter plus rank number, counted from the top left', () => {
  assert.equal(formatSquare(9, 0), 'a1');
  assert.equal(formatSquare(9, 4 * 9 + 3), 'd5');
  assert.equal(formatSquare(11, 10 * 11 + 10), 'k11');
  assert.equal(parseSquare(9, 'd5'), 4 * 9 + 3);
  assert.equal(parseSquare(11, 'k11'), 10 * 11 + 10);
});

test('a move reads in every spelling players type', () => {
  for (const text of ['d5-d6', 'd5 d6', 'd5d6', 'D5D6', 'd5>d6', '  d5 - d6  ']) {
    assert.deepEqual(parseMove(9, text), { from: 4 * 9 + 3, to: 5 * 9 + 3 }, text);
  }
});

test('formatMove and parseMove round-trip', () => {
  const move = { from: 2 * 9 + 8, to: 2 * 9 + 4 };
  const text = formatMove(9, move);
  assert.equal(text, 'i3-e3');
  assert.deepEqual(parseMove(9, text), move);
});

test('notation scales past the 26th file and past rank 9', () => {
  const size = 15;
  const index = 12 * size + 13;
  const square = formatSquare(size, index);
  assert.equal(square, 'n13');
  assert.equal(parseSquare(size, square), index);
});

test('bad input is rejected with a readable message', () => {
  assert.throws(() => parseSquare(9, 'j1'), /off the board/);
  assert.throws(() => parseSquare(9, 'a0'), /off the board/);
  assert.throws(() => parseSquare(9, '55'), /Cannot read square/);
  assert.throws(() => parseMove(9, 'd5'), /Cannot read move/);
  assert.throws(() => parseMove(9, 'd5-e5-f5'), /Cannot read move/);
});

test('captures are described with the piece and the square', () => {
  const captured = [{ i: 4 * 9 + 4, value: KING }, { i: 0, value: ATTACKER }];
  assert.equal(formatCaptures(9, captured), 'king@e5, attacker@a1');
  assert.equal(formatCaptures(9, [{ i: 3, value: DEFENDER }]), 'defender@d1');
  assert.equal(formatCaptures(9, []), '');
});
