'use strict';

const { EMPTY, KING, DEFENDER, ATTACKER, SIDE_ATTACKER } = require('../rules/pieces');

/**
 * Zobrist hashing: one random 32-bit pair per (piece, square) plus one for the
 * side to move. XOR-ing the pair of the piece that appeared or disappeared
 * updates the key in place, so the search can key a transposition table
 * without building a string per node.
 *
 * The random numbers come from a fixed seed, so two runs of the same position
 * always produce the same keys and the same search.
 */
const MAX_SIZE = 19;
const MAX_SQUARES = MAX_SIZE * MAX_SIZE;
const PIECES = [KING, DEFENDER, ATTACKER];

/** mulberry32: a tiny deterministic PRNG, good enough for hash keys. */
function seededRand(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function buildTable() {
  const rand = seededRand(0x50a5dd47);
  const za = new Int32Array(4 * MAX_SQUARES);
  const zb = new Int32Array(4 * MAX_SQUARES);
  for (const piece of PIECES) {
    for (let sq = 0; sq < MAX_SQUARES; sq += 1) {
      za[piece * MAX_SQUARES + sq] = rand() | 0;
      zb[piece * MAX_SQUARES + sq] = rand() | 0;
    }
  }
  return { za, zb, turnA: rand() | 0, turnB: rand() | 0 };
}

const Z = buildTable();

function za(piece, index) { return Z.za[piece * MAX_SQUARES + index]; }
function zb(piece, index) { return Z.zb[piece * MAX_SQUARES + index]; }

/** Full key of a position, used at the root of a search. */
function hashBoard(board, turn) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < board.grid.length; i += 1) {
    const v = board.grid[i];
    if (v === EMPTY) continue;
    a ^= za(v, i);
    b ^= zb(v, i);
  }
  if (turn === SIDE_ATTACKER) { a ^= Z.turnA; b ^= Z.turnB; }
  return { a: a | 0, b: b | 0 };
}

/** Mix a board geometry (variant + size) into a root key. */
function geometryId(variant) {
  const text = `${variant.castles}|${variant.escape}|${variant.size}|${variant.edgeShield ? 1 : 0}|${variant.castleShield}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** Side effects of a move on the key: the mover, the captures, the turn. */
function applyKey(h, piece, move, captured) {
  h.a ^= za(piece, move.from) ^ za(piece, move.to) ^ Z.turnA;
  h.b ^= zb(piece, move.from) ^ zb(piece, move.to) ^ Z.turnB;
  for (const cap of captured) {
    h.a ^= za(cap.value, cap.i);
    h.b ^= zb(cap.value, cap.i);
  }
}

module.exports = { za, zb, hashBoard, applyKey, geometryId, MAX_SQUARES, seededRand };
