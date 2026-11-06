'use strict';

/**
 * Piece codes. Stored in a Uint8Array, so they must stay small integers.
 * Deliberately ASCII: never use emoji (they carry invisible variation
 * selectors) as identity, only as display.
 */
const EMPTY = 0;
const KING = 1;
const DEFENDER = 2;
const ATTACKER = 3;

const SIDE_DEFENDER = 'defender';
const SIDE_ATTACKER = 'attacker';

function isPiece(value) {
  return value === KING || value === DEFENDER || value === ATTACKER;
}

function sideOf(value) {
  if (value === KING || value === DEFENDER) return SIDE_DEFENDER;
  if (value === ATTACKER) return SIDE_ATTACKER;
  return null;
}

function isOpponent(a, b) {
  const sa = sideOf(a);
  const sb = sideOf(b);
  return sa !== null && sb !== null && sa !== sb;
}

/** Textual code used in notation, saves and ASCII rendering. */
const CODES = { [EMPTY]: '.', [KING]: 'K', [DEFENDER]: 'D', [ATTACKER]: 'A' };
const FROM_CODE = { '.': EMPTY, K: KING, D: DEFENDER, A: ATTACKER };

module.exports = {
  EMPTY,
  KING,
  DEFENDER,
  ATTACKER,
  SIDE_DEFENDER,
  SIDE_ATTACKER,
  isPiece,
  sideOf,
  isOpponent,
  CODES,
  FROM_CODE,
};
