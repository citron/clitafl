'use strict';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Coordinate notation: files a.. (left to right), ranks 1.. (top to bottom).
 * Accepted move forms: "d5-d6", "d5 d6", "d5d6", "D5D6".
 */
function fileLetter(size, col) {
  if (col < 0 || col >= size) throw new Error(`File out of range: ${col}`);
  return LETTERS[col];
}

function formatSquare(size, index) {
  const row = Math.floor(index / size);
  const col = index % size;
  return `${fileLetter(size, col)}${row + 1}`;
}

function parseSquare(size, text) {
  const match = /^([a-z])([0-9]{1,2})$/i.exec(String(text).trim());
  if (!match) throw new Error(`Cannot read square: '${text}'`);
  const col = LETTERS.indexOf(match[1].toLowerCase());
  const row = Number(match[2]) - 1;
  if (col < 0 || col >= size) throw new Error(`File '${match[1]}' is off the board`);
  if (row < 0 || row >= size) throw new Error(`Rank ${match[2]} is off the board`);
  return row * size + col;
}

function parseMove(size, text) {
  const cleaned = String(text).trim().toLowerCase().replace(/[\s\-–>]+/g, '-');
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 1 && parts[0].length >= 4) {
    const joined = parts[0];
    const half = Math.ceil(joined.length / 2);
    parts.splice(0, parts.length, joined.slice(0, half), joined.slice(half));
  }
  if (parts.length !== 2) throw new Error(`Cannot read move: '${text}' (use e.g. d5-d6)`);
  return { from: parseSquare(size, parts[0]), to: parseSquare(size, parts[1]) };
}

function formatMove(size, move) {
  return `${formatSquare(size, move.from)}-${formatSquare(size, move.to)}`;
}

function formatCaptures(size, captured) {
  if (!captured.length) return '';
  const names = { 1: 'king', 2: 'defender', 3: 'attacker' };
  return captured.map((cap) => `${names[cap.value]}@${formatSquare(size, cap.i)}`).join(', ');
}

module.exports = { formatSquare, parseSquare, formatMove, parseMove, formatCaptures, LETTERS };
