'use strict';

const { KING, DEFENDER, ATTACKER, SIDE_ATTACKER, SIDE_DEFENDER } = require('./pieces');

/**
 * Declarative rule sets. Geometry (throne, castles, escape squares) is derived
 * from these fields, so no layout is ever hardcoded to an 11x11 board.
 *
 * size           board dimension (odd)
 * first          side that opens the game
 * escape         'edge' | 'corner'
 * castles        'none' | 'throne' | 'corners' | 'throne-corners'
 * castleShield   who may be captured against an empty castle: 'none'|'both'|'defender'|'attacker'
 * edgeShield     the board edge counts as a captor
 * kingCapture    enemies needed: onCastle / besideCastle / elsewhere
 * kingSafeOnEdge king cannot be captured on the edge
 * winBySiege     attackers win by sealing the king's host in
 * noMove         result when the side to move has no move
 * repetition     result when a position repeats three times
 * maxPlies       hard limit declared a draw (0 = unlimited)
 */
const VARIANTS = {
  tablut: {
    id: 'tablut',
    name: 'Tablut',
    subtitle: 'Sámi / Lapland, recorded by Linnaeus (1732)',
    size: 9,
    first: SIDE_ATTACKER,
    escape: 'edge',
    castles: 'throne-corners',
    castleShield: 'both',
    edgeShield: false,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'draw',
    repetition: 'draw',
    maxPlies: 200,
    source: 'Linnaeus, Lachesis Lapponica; modern retranslation (tafl.cyningstan.com)',
    blurb: 'Best documented tafl. The central castle is off limits to every piece, king included.',
  },
  copenhagen: {
    id: 'copenhagen',
    name: 'Hnefatafl (Copenhagen)',
    subtitle: 'Scandinavia, 11x11 fetlar family',
    size: 11,
    first: SIDE_ATTACKER,
    escape: 'corner',
    castles: 'throne-corners',
    castleShield: 'both',
    edgeShield: true,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 4 },
    kingSafeOnEdge: true,
    winBySiege: true,
    noMove: 'loss',
    repetition: 'draw',
    maxPlies: 300,
    source: 'Fetlar / Copenhagen rules, aagenielsen.dk; tafl.cyningstan.com',
    blurb: 'King escapes to a corner. Throne and corners are hostile castles; the king needs 4 attackers.',
  },
  brandub: {
    id: 'brandub',
    name: 'Brandub',
    subtitle: 'Ireland, 7x7 (the "chieftain" game)',
    size: 7,
    first: SIDE_ATTACKER,
    escape: 'corner',
    castles: 'none',
    castleShield: 'none',
    edgeShield: true,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'loss',
    repetition: 'draw',
    maxPlies: 120,
    source: 'Irish poems "Ard Rí" / "Branán"; WTF balanced reconstruction',
    blurb: 'Fast 7x7 game: 1 king + 4 defenders against 8 attackers, escape to a corner.',
  },
  'ard-ri': {
    id: 'ard-ri',
    name: 'Ard Rí',
    subtitle: 'Scotland, 7x7 (the "High King" game)',
    size: 7,
    setup: 'ardri',
    first: SIDE_ATTACKER,
    escape: 'edge',
    castles: 'none',
    castleShield: 'none',
    edgeShield: true,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'loss',
    repetition: 'draw',
    maxPlies: 120,
    source: 'Scottish tradition, Wikipedia (Tafl games); setup reconstructed symmetrically',
    blurb: '7x7 with a big defender host (king + 8) against 16 attackers, escape to any edge square.',
  },
  tawlbwrdd: {
    id: 'tawlbwrdd',
    name: 'Tawlbwrdd',
    subtitle: 'Wales, 11x11 ("Thimble board")',
    size: 11,
    first: SIDE_ATTACKER,
    escape: 'edge',
    castles: 'throne',
    castleShield: 'both',
    edgeShield: true,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'loss',
    repetition: 'draw',
    maxPlies: 300,
    source: 'Welsh poem to Meilyr (11th c.); rules reconstructed, square count confirmed',
    blurb: 'King + 12 defenders against 24 attackers. The king wins by reaching any edge square.',
  },
};

const VARIANT_IDS = Object.keys(VARIANTS);

/** Resolve a variant by id, optionally resizing it (odd sizes 7..15). */
function getVariant(id, size = null) {
  const base = VARIANTS[id];
  if (!base) {
    throw new Error(`Unknown variant '${id}'. Known: ${VARIANT_IDS.join(', ')}`);
  }
  if (size === null) return base;
  if (size % 2 === 0) throw new Error(`Board size must be odd, got ${size}`);
  if (size < 7 || size > 15) throw new Error(`Board size must be between 7 and 15, got ${size}`);
  return { ...base, size, custom: true };
}

function describeVariants() {
  return VARIANT_IDS.map((id) => {
    const v = VARIANTS[id];
    const army = armyOf(v, v.size);
    return {
      id,
      name: v.name,
      subtitle: v.subtitle,
      size: v.size,
      escape: v.escape,
      defenders: army.defenders,
      attackers: army.attackers,
      blurb: v.blurb,
    };
  });
}

/** Centre coordinate for a size. */
function centerOf(size) {
  return (size - 1) / 2;
}

function isThrone(variant, size, r, c) {
  const c0 = centerOf(size);
  return (variant.castles === 'throne' || variant.castles === 'throne-corners') && r === c0 && c === c0;
}

function isCornerCastle(variant, size, r, c) {
  if (variant.castles !== 'corners' && variant.castles !== 'throne-corners') return false;
  return (r === 0 || r === size - 1) && (c === 0 || c === size - 1);
}

function isCastle(variant, size, r, c) {
  return isThrone(variant, size, r, c) || isCornerCastle(variant, size, r, c);
}

/** Squares the king reaches to win. */
function isEscapeSquare(variant, size, r, c) {
  if (variant.escape === 'corner') return isCorner(r, c, size);
  return r === 0 || r === size - 1 || c === 0 || c === size - 1;
}

function isCorner(r, c, size) {
  return (r === 0 || r === size - 1) && (c === 0 || c === size - 1);
}

/**
 * Castle squares a piece may land on: a castle that is also an escape square is
 * reserved for the king, every other castle square is off limits to everyone.
 */
function castleEnterableBy(variant, size, r, c) {
  if (!isCastle(variant, size, r, c)) return { king: true, defender: true, attacker: true };
  const escapeTarget = isEscapeSquare(variant, size, r, c);
  return { king: escapeTarget, defender: false, attacker: false };
}

/**
 * Symmetric starting army for any odd size: the king on the throne, defenders
 * packed around it, twice as many attackers on the outer rings. On 9x9 this is
 * the tablut cross with serifs; on 11x11 the fetlar counts (12 defenders, 24
 * attackers). Ard Rí uses its own crowded 7x7 ring.
 */
function armyOf(variant, size) {
  const cells = buildSetup(variant, size);
  let defenders = 0;
  let attackers = 0;
  for (const [, , code] of cells) {
    if (code === DEFENDER) defenders += 1;
    if (code === ATTACKER) attackers += 1;
  }
  return { defenders, attackers };
}

const ORTH1 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG1 = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function buildSetup(variant, size) {
  const c = centerOf(size);
  const last = size - 1;
  const cells = [[c, c, KING]];

  if (variant.setup === 'ardri') {
    for (const [dr, dc] of [...ORTH1, ...DIAG1]) cells.push([c + dr, c + dc, DEFENDER]);
    // Attackers hold the perimeter, leaving the four mid-edge lanes and the
    // corners open: the king's side must fight its way through a lane to win.
    for (let k = 1; k < size - 1; k += 1) {
      for (const [r, col] of [[0, k], [last, k], [k, 0], [k, last]]) {
        if (k === c) continue;
        cells.push([r, col, ATTACKER]);
      }
    }
    return cells;
  }

  for (const [dr, dc] of ORTH1) cells.push([c + dr, c + dc, DEFENDER]);
  if (size >= 9) for (const [dr, dc] of DIAG1) cells.push([c + dr, c + dc, DEFENDER]);
  if (size >= 11) for (const [dr, dc] of ORTH1) cells.push([c + dr * 2, c + dc * 2, DEFENDER]);
  if (size >= 13) for (const [dr, dc] of DIAG1) cells.push([c + dr * 2, c + dc * 2, DEFENDER]);

  cells.push([0, c, ATTACKER], [last, c, ATTACKER], [c, 0, ATTACKER], [c, last, ATTACKER]);
  if (size >= 9) {
    cells.push([1, c - 1, ATTACKER], [1, c + 1, ATTACKER], [last - 1, c - 1, ATTACKER], [last - 1, c + 1, ATTACKER]);
    cells.push([c - 1, 1, ATTACKER], [c + 1, 1, ATTACKER], [c - 1, last - 1, ATTACKER], [c + 1, last - 1, ATTACKER]);
  }
  if (size >= 11) {
    cells.push([0, c - 2, ATTACKER], [0, c + 2, ATTACKER], [last, c - 2, ATTACKER], [last, c + 2, ATTACKER]);
    cells.push([c - 2, 0, ATTACKER], [c + 2, 0, ATTACKER], [c - 2, last, ATTACKER], [c + 2, last, ATTACKER]);
  }
  for (const [dr, dc] of DIAG1) cells.push([c + dr * 2, c + dc * 2, ATTACKER]);
  if (size >= 13) {
    cells.push([2, c - 2, ATTACKER], [2, c + 2, ATTACKER], [last - 2, c - 2, ATTACKER], [last - 2, c + 2, ATTACKER]);
    cells.push([c - 2, 2, ATTACKER], [c + 2, 2, ATTACKER], [c - 2, last - 2, ATTACKER], [c + 2, last - 2, ATTACKER]);
  }
  return cells;
}

module.exports = {
  VARIANTS,
  VARIANT_IDS,
  getVariant,
  describeVariants,
  centerOf,
  isThrone,
  isCastle,
  isCornerCastle,
  isEscapeSquare,
  isCorner,
  castleEnterableBy,
  armyOf,
  buildSetup,
};
