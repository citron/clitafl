'use strict';

const { KING, DEFENDER, ATTACKER, SIDE_ATTACKER, SIDE_DEFENDER } = require('./pieces');

/**
 * Declarative rule sets. Geometry (throne, castles, escape squares) is derived
 * from these fields, so no layout is ever hardcoded to an 11x11 board.
 *
 * size           board dimension (odd)
 * first          side that opens the game
 * escape         'edge' | 'corner' | 'cornerblock' (the marked 2x2 alea corners)
 * castles        'none' | 'throne' | 'corners' | 'throne-corners' | 'throne-cornerblocks'
 * castleShield   who may be captured against an empty castle: 'none'|'both'|'defender'|'attacker'
 * edgeShield     the board edge counts as a captor. Copenhagen rule 5 is explicit
 *                that the edge is NOT hostile, so the fetlar games set it false
 * kingCapture    enemies needed on the throne (onCastle), next to the throne
 *                (besideCastle) and elsewhere. The sources raise the count for
 *                the throne only, the other castle squares are plain captors
 * kingSafeOnEdge king cannot be captured on the edge
 * winBySiege     attackers win by sealing the king's host in (copenhagen rule 12)
 * winByFort      the defenders lose once the king has left the fort and an enemy
 *                stands beside him (copenhagen rule 11). Not implemented: the
 *                modern exit fort has no rule text, see README
 * shieldWall     the Copenhagen edge-row capture (Board.shieldWallCaptures)
 * kingBackOnThrone the king may land on his throne again after leaving it
 *                (copenhagen rule 1 and rule 8: "if the king returns to the
 *                fort, the game continues")
 * noMove         result when the side to move has no move
 * repetition     result when a position repeats three times. Copenhagen rule 10
 *                ("the same position must not be repeated forever") and the
 *                tablut raichi warning are not implemented: repetition is a draw
 * maxPlies       hard limit in plies (0 = unlimited), see overrun
 * overrun        'draw' (default) or 'attackers-win' (copenhagen rule 13)
 * moveLimitFor   size -> limit in MOVES, for the variants that state a limit per
 *                size: copenhagen 10 x (size + 3) moves, so 100 / 140 / 160
 */
const VARIANTS = {
  tablut: {
    id: 'tablut',
    name: 'Tablut',
    subtitle: 'Sámi / Lapland, recorded by Linnaeus (1732)',
    size: 9,
    first: SIDE_ATTACKER,
    escape: 'edge',
    castles: 'throne',
    castleShield: 'both',
    edgeShield: false,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'draw',
    repetition: 'draw',
    maxPlies: 200,
    source: 'Linnaeus, Lachesis Lapponica; 13 rules, tafl.cyningstan.com / hnefatafl.org',
    blurb: 'Best documented tafl. The empty throne is the attackers\u0027 castle, the king is barred from every castle, and he escapes on the edge.',
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
    edgeShield: false,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 4 },
    kingSafeOnEdge: true,
    winBySiege: true,
    winByFort: false,
    shieldWall: true,
    kingBackOnThrone: true,
    noMove: 'loss',
    repetition: 'draw',
    maxPlies: 280,
    overrun: 'attackers-win',
    moveLimitFor: (size) => 10 * (size + 3),
    source: 'Copenhagen rules, 13 articles, aagenielsen.dk / tafl.cyningstan.com; hnefatafl.org',
    blurb: 'King escapes to a corner and may re-enter his fort. Throne and corners are castles, the edge is not: a line of men at the edge falls to the shield wall, and the king needs 4 attackers.',
  },
  brandub: {
    id: 'brandub',
    name: 'Brandub',
    subtitle: 'Ireland, 7x7 (the "chieftain" game)',
    size: 7,
    first: SIDE_ATTACKER,
    escape: 'corner',
    castles: 'throne-corners',
    castleShield: 'both',
    edgeShield: true,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'loss',
    repetition: 'draw',
    maxPlies: 120,
    source: '12 rules from the poems "Ard Rí" / "Branán", tafl.cyningstan.com / hnefatafl.org; army balanced',
    blurb: 'Fast 7x7 game: 1 king + 4 defenders against 8 attackers, escape to a marked corner. Throne and corners are castles for both sides.',
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
  /**
   * Alea evangelii, the gospel game of Anglo-Saxon England (Cambridge, CCC MS
   * 122, c. 1140). The twelve rules surviving next to the diagram, as edited by
   * D. Walker (tafl.cyningstan.com/page/173/alea-evangelii), give:
   *  1. 19x19, 73 pieces: a king, 24 dukes, 48 counts (the counts' numbers are
   *     Murray's 1955 division of the diagram, the manuscript draws all pieces
   *     black except four).
   *  2. The counts open.
   *  3.-4. Straight lines, no jumping, no landing on a piece.
   *  5. Nobody may land on the central castle, not even the king once he has
   *     left it; every piece may pass over it while it is empty.
   *  6. Only the king may move onto the 16 marked squares of the four corners.
   *  7. Dukes and counts are taken between two enemies on opposite sides.
   *  8. The king is taken by four counts on the central castle, by three when he
   *     stands next to it, and like a duke anywhere else.
   *  9. The marked squares, empty, capture for either side, as if a piece of
   *     their own stood there (so castleShield is 'both').
   * 10. A piece may stand voluntarily between two enemies.
   * 11. A king that moves onto a marked corner square has left the board and
   *     wins: the plain board edge is not an exit, and the escape is settled
   *     before any capture (Board.applyMove).
   * 12. A captured king loses.
   * The manuscript is silent on the starting colours, so the setup is the
   * Helmfrid reconstruction (see buildSetup).
   */
  alea: {
    id: 'alea',
    name: 'Alea evangelii',
    subtitle: 'Anglo-Saxon England, 19x19 (the gospel game, Cambridge MS CCC 122)',
    size: 19,
    setup: 'alea',
    first: SIDE_ATTACKER,
    escape: 'cornerblock',
    castles: 'throne-cornerblocks',
    castleShield: 'both',
    edgeShield: true,
    kingCapture: { onCastle: 4, besideCastle: 3, elsewhere: 2 },
    kingSafeOnEdge: false,
    winBySiege: false,
    noMove: 'draw',
    repetition: 'draw',
    maxPlies: 600,
    source: 'Cambridge, CCC MS 122 (c. 1140); army after H. J. R. Murray (1955), rules after D. Walker, tafl.cyningstan.com',
    blurb: 'The biggest tafl: 19x19, king + 24 dukes against 48 counts. Only the 16 marked corner squares are exits.',
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

const MIN_SIZE = 7;
const MAX_SIZE = 19;

/** Resolve a variant by id, optionally resizing it (odd sizes 7..19). */
function getVariant(id, size = null) {
  const base = VARIANTS[id];
  if (!base) {
    throw new Error(`Unknown variant '${id}'. Known: ${VARIANT_IDS.join(', ')}`);
  }
  if (size === null) return base;
  if (size % 2 === 0) throw new Error(`Board size must be odd, got ${size}`);
  if (size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`Board size must be between ${MIN_SIZE} and ${MAX_SIZE}, got ${size}`);
  }
  const res = { ...base, size, custom: true };
  // A resized variant keeps its own limit rule: copenhagen plays 100 / 140 / 160
  // moves on the 7 / 11 / 13 boards, so the limit has to follow the size.
  if (typeof base.moveLimitFor === 'function') {
    res.maxPlies = 2 * base.moveLimitFor(size);
  }
  return res;
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
  return (variant.castles === 'throne'
    || variant.castles === 'throne-corners'
    || variant.castles === 'throne-cornerblocks') && r === c0 && c === c0;
}

function isCornerCastle(variant, size, r, c) {
  if (variant.castles === 'throne-cornerblocks') return isCornerBlock(size, r, c);
  if (variant.castles !== 'corners' && variant.castles !== 'throne-corners') return false;
  return (r === 0 || r === size - 1) && (c === 0 || c === size - 1);
}

function isCastle(variant, size, r, c) {
  return isThrone(variant, size, r, c) || isCornerCastle(variant, size, r, c);
}

/**
 * The four marked 2x2 blocks of the alea evangelii board: 16 squares, one block
 * in each corner. They are the king's only exits and act as castles.
 */
function isCornerBlock(size, r, c) {
  const last = size - 1;
  return (r <= 1 || r >= last - 1) && (c <= 1 || c >= last - 1);
}

/** Squares the king reaches to win. */
function isEscapeSquare(variant, size, r, c) {
  if (variant.escape === 'cornerblock') return isCornerBlock(size, r, c);
  if (variant.escape === 'corner') return isCorner(r, c, size);
  return r === 0 || r === size - 1 || c === 0 || c === size - 1;
}

function isCorner(r, c, size) {
  return (r === 0 || r === size - 1) && (c === 0 || c === size - 1);
}

/**
 * Castle squares a piece may land on. A castle that is also an escape square is
 * reserved for the king (the alea corner blocks, the brandub and copenhagen
 * corners); every other castle square is off limits to everyone, which is the
 * tablut reading of "the king is barred from entering the castle, including the
 * throne square" and the hnefatafl rule "the king may not enter the castle".
 * A variant with kingBackOnThrone lets the king land on his throne again:
 * copenhagen rule 1 ("the king may move onto these squares") and rule 8 ("if
 * the king returns to the fort, the game continues").
 */
function castleEnterableBy(variant, size, r, c) {
  if (!isCastle(variant, size, r, c)) return { king: true, defender: true, attacker: true };
  const escapeTarget = isEscapeSquare(variant, size, r, c);
  const kingOnThrone = Boolean(variant.kingBackOnThrone) && isThrone(variant, size, r, c);
  return { king: escapeTarget || kingOnThrone, defender: false, attacker: false };
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

/** The north army of alea evangelii: 12 counts in a wedge facing the throne. */
const ALEA_ARMY = [
  [-8, -1], [-8, 1],
  [-7, -3], [-7, -1], [-7, 1], [-7, 3],
  [-6, -5], [-6, -3], [-6, -1], [-6, 1], [-6, 3], [-6, 5],
];

function buildSetup(variant, size) {
  const c = centerOf(size);
  const last = size - 1;
  const cells = [[c, c, KING]];

  if (variant.setup === 'alea') {
    // Manuscript counts (Murray 1955): a king, 24 dukes, 48 counts. The diagram
    // in Cambridge MS CCC 122 is not radially symmetric and does not say which
    // pieces are white, so the placement below is a documented reconstruction:
    // the king sits boxed in his eight household dukes (as in tablut, so the
    // counts cannot rush the throne down an open lane), a ring of 12 dukes keeps
    // the garrison closed, the four "variegated men" of the manuscript stand as
    // outlying dukes in the diagonal lanes between the armies (Sten Helmfrid's
    // reading, the one that play-tests best), and four 12-man armies of counts
    // face the centre from the outer rings.
    for (const [dr, dc] of [...ORTH1, ...DIAG1]) cells.push([c + dr, c + dc, DEFENDER]);
    for (const [dr, dc] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-1, -3], [-1, 3], [1, -3], [1, 3], [-3, -1], [-3, 1], [3, -1], [3, 1]]) {
      cells.push([c + dr, c + dc, DEFENDER]);
    }
    for (const [dr, dc] of [[-5, -5], [-5, 5], [5, -5], [5, 5]]) cells.push([c + dr, c + dc, DEFENDER]);
    for (const [dr, dc] of ALEA_ARMY) {
      cells.push([c + dr, c + dc, ATTACKER], [c - dr, c + dc, ATTACKER], [c + dc, c + dr, ATTACKER], [c + dc, c - dr, ATTACKER]);
    }
    return cells;
  }

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
  MIN_SIZE,
  MAX_SIZE,
  getVariant,
  describeVariants,
  centerOf,
  isThrone,
  isCastle,
  isCornerCastle,
  isCornerBlock,
  isEscapeSquare,
  isCorner,
  castleEnterableBy,
  armyOf,
  buildSetup,
};
