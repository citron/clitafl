'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Game } = require('../src/rules/game');
const { VARIANTS } = require('../src/rules/variants');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');
const { playMatch, seededRng } = require('../src/headless');

// A node budget, not a clock: the matches in this suite must replay exactly.
const FAST = { level: 'easy', timeMs: 15, maxNodes: 3000, seed: 3, maxPlies: 120 };

test('the seeded random generator is reproducible and stays in range', () => {
  const a = seededRng(7);
  const b = seededRng(7);
  const draws = Array.from({ length: 20 }, () => a());
  assert.deepEqual(draws, Array.from({ length: 20 }, () => b()));
  for (const value of draws) {
    assert.ok(value >= 0 && value < 1, `${value} is a probability`);
  }
  const other = Array.from({ length: 20 }, () => seededRng(8)());
  assert.notDeepEqual(draws, other, 'a different seed is a different game');
});

test('every variant plays a whole game to a result', () => {
  for (const id of Object.keys(VARIANTS)) {
    const match = playMatch({ game: Game.create(id), ...FAST });
    assert.ok(match.isGameOver, `${id} ends: ${match.status} - ${match.reason}`);
    assert.ok(['defenders-win', 'attackers-win', 'draw'].includes(match.status), id);
    assert.ok(match.plies > 0, `${id} plays at least one move`);
    assert.ok(match.plies <= FAST.maxPlies, `${id} respects the ply cap`);
    assert.equal(match.winner, match.status === 'draw' ? null : match.winner, id);
    assert.equal(match.history.length, match.plies, `${id} records every ply`);
  }
});

test('a match record is readable and matches the board', () => {
  const match = playMatch({ game: Game.create('tablut'), ...FAST });
  const first = match.history[0];
  assert.equal(first.ply, 1);
  assert.equal(first.side, SIDE_ATTACKER, 'the attackers open');
  assert.match(first.notation, /^[a-z]+\d+-[a-z]+\d+$/, `${first.notation} reads like a move`);
  assert.ok(Array.isArray(first.captured), 'each ply lists its captures');

  const last = match.history[match.history.length - 1];
  assert.equal(last.status, match.status, 'the record ends with the result');
  const san = /^[a-z]+\d+(x|-)[a-z]+\d+$/;
  assert.ok(match.history.every((entry) => san.test(entry.san)), 'every entry has a readable SAN');
});

test('the same seed replays the same game, a different seed does not', () => {
  const one = playMatch({ game: Game.create('copenhagen'), ...FAST });
  const two = playMatch({ game: Game.create('copenhagen'), ...FAST });
  const other = playMatch({ game: Game.create('copenhagen'), ...FAST, seed: 91 });
  const line = (m) => m.history.map((entry) => entry.san).join(' ');
  assert.equal(line(one), line(two), 'a seed is a reproducible match');
  assert.equal(one.status, two.status);
  assert.notEqual(line(one), line(other), 'and the opening is not fixed to one line');
});

test('the two sides can be set to different strengths', () => {
  const match = playMatch({
    game: Game.create('brandub'),
    attackerLevel: 'easy',
    defenderLevel: 'medium',
    timeMs: 20,
    seed: 5,
    maxPlies: 60,
  });
  assert.ok(match.isGameOver, 'a mixed match finishes');
  assert.equal(match.history[0].side, SIDE_ATTACKER);
});

test('a custom board size plays too', () => {
  const match = playMatch({ game: Game.create('tablut', 11), ...FAST, maxPlies: 80 });
  assert.equal(match.size, 11);
  assert.ok(match.isGameOver, `the 11x11 tablut game ends: ${match.reason}`);
  const board = match.board;
  assert.equal(board.size, 11);
  assert.ok(board.isCastle(5, 5), 'the throne is in the middle of the new board');
  assert.ok(board.isEscapeSquare(0, 0), 'and the edges still escape');
});

test('the progress callback follows the match', () => {
  const seen = [];
  const match = playMatch({
    game: Game.create('brandub'),
    ...FAST,
    onPly: (entry) => seen.push(entry.ply),
  });
  assert.deepEqual(seen, match.history.map((entry) => entry.ply), 'it reports every ply, in order');
  assert.ok(seen.length > 0);
});

test('a full match leaves a consistent board', () => {
  const match = playMatch({ game: Game.create('tawlbwrdd'), ...FAST, maxPlies: 100 });
  const board = match.board;
  const attackers = board.countOf(SIDE_ATTACKER);
  const defenders = board.countOf(SIDE_DEFENDER);
  assert.ok(attackers > 0, 'the attackers are never all removed from history');
  if (match.status === 'attackers-win') {
    assert.equal(board.kingAlive(), false, 'the attackers win by taking the king');
  }
  if (match.status === 'defenders-win') {
    assert.ok(defenders > 0);
  }
});
