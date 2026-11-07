'use strict';

const {
  KING, DEFENDER, ATTACKER, SIDE_DEFENDER, SIDE_ATTACKER,
} = require('../rules/pieces');
const { formatSquare, formatSan, LETTERS } = require('../rules/notation');
const V = require('../rules/variants');
const { LEVELS, LEVEL_IDS } = require('../ai/player');
const { Display } = require('../ui/display');
const { Ansi } = require('../ui/ansi');

const PIECE_NAMES = { [KING]: 'king', [DEFENDER]: 'defender', [ATTACKER]: 'attacker' };

/** A colour-less renderer, so the web API can reuse the rules text the CLI prints. */
const plain = new Display({ ansi: new Ansi({ color: false }), animate: false });

function squareOf(board, index) { return formatSquare(board.size, index); }

/** Every square matching `test`, as notation (`['a1','i1']`). */
function squareList(board, test) {
  const list = [];
  for (let r = 0; r < board.size; r += 1) {
    for (let c = 0; c < board.size; c += 1) {
      if (test(board, r, c)) list.push(squareOf(board, board.idx(r, c)));
    }
  }
  return list;
}

/** The rules of a variant, as data, so a client can render a game it has never seen. */
function variantView(variant) {
  const army = V.armyOf(variant, variant.size);
  return {
    id: variant.id,
    name: variant.name,
    subtitle: variant.subtitle,
    source: variant.source,
    blurb: variant.blurb,
    size: variant.size,
    escape: variant.escape,
    first: variant.first,
    castles: variant.castles,
    edge_shield: Boolean(variant.edgeShield),
    win_by_siege: Boolean(variant.winBySiege),
    king_capture: variant.kingCapture,
    no_move: variant.noMove,
    repetition: variant.repetition,
    max_plies: variant.maxPlies ?? null,
    defenders: army.defenders,
    attackers: army.attackers,
  };
}

/**
 * The board as plain data: `rows` are `.`/`K`/`D`/`A` per square, and the special
 * squares are spelled out because they are invisible on an empty cell.
 */
function boardView(board) {
  const serialized = board.serialize();
  return {
    size: board.size,
    rows: serialized.rows,
    files: LETTERS.slice(0, board.size).split(''),
    ranks: Array.from({ length: board.size }, (_, i) => i + 1),
    castles: squareList(board, (b, r, c) => b.isCastle(r, c)),
    throne: squareList(board, (b, r, c) => b.isThrone(r, c)),
    escapes: squareList(board, (b, r, c) => b.isEscapeSquare(r, c)),
    king: board.kingAlive() ? squareOf(board, board.kingPos) : null,
    king_has_escaped: Boolean(board.kingHasEscaped),
    counts: {
      king: board.kingAlive() ? 1 : 0,
      defenders: board.countOf(SIDE_DEFENDER) - (board.kingAlive() ? 1 : 0),
      attackers: board.countOf(SIDE_ATTACKER),
    },
  };
}

function capturesView(board, captured) {
  return captured.map((cap) => ({ square: squareOf(board, cap.i), piece: PIECE_NAMES[cap.value] }));
}

/**
 * Legal moves of one side, in the notation a client sends back. `piece` names
 * the man that moves, so a client can talk about "the king" without reading
 * the board.
 */
function movesView(board, side) {
  return board.legalMoves(side).map((move) => ({
    from: squareOf(board, move.from),
    to: squareOf(board, move.to),
    piece: PIECE_NAMES[board.at(move.from)],
    san: formatSan(board.size, move, 0),
  }));
}

function plyView(game, entry, index) {
  const board = game.board;
  return {
    ply: index + 1,
    side: entry.side,
    san: formatSan(board.size, entry.move, entry.captured.length),
    notation: entry.notation,
    captured: capturesView(board, entry.captured),
  };
}

/** The strength presets, in the shape the web picker and an agent both want. */
function levelsView() {
  return LEVEL_IDS.map((id) => ({
    id,
    label: LEVELS[id].label,
    depth: LEVELS[id].maxDepth,
    time_ms: LEVELS[id].timeMs,
    play: LEVELS[id].topK > 1 ? `picks among the top ${LEVELS[id].topK} moves` : 'plays the best move it finds',
  }));
}

/**
 * The public state of one game: enough for a board, a move list and a result,
 * and nothing that would need the rules table to interpret.
 */
function gameView(session, options = {}) {
  const { game, id } = session;
  const board = game.board;
  const withMoves = options.moves ?? 'turn';
  const last = game.history.length ? game.history[game.history.length - 1] : null;

  const view = {
    id,
    variant: variantView(game.variant),
    board: boardView(board),
    turn: game.turn,
    ply: game.ply,
    status: game.status,
    winner: game.winner,
    reason: game.reason,
    is_over: game.isGameOver(),
    seats: { attacker: session.seats[SIDE_ATTACKER], defender: session.seats[SIDE_DEFENDER] },
    levels: { attacker: session.levels[SIDE_ATTACKER], defender: session.levels[SIDE_DEFENDER] },
    time_ms: { attacker: session.timeMs[SIDE_ATTACKER], defender: session.timeMs[SIDE_DEFENDER] },
    seed: session.seed,
    moves_played: game.history.length,
    last_move: last ? plyView(game, last, game.history.length - 1) : null,
    history: game.history.map((entry, i) => plyView(game, entry, i)),
    legal_moves: [],
    legal_move_count: 0,
    url: `/api/games/${id}`,
    updated_at: session.updatedAt,
  };
  if (session.aiInfo) view.last_ai = session.aiInfo;

  if (withMoves === 'all') {
    view.legal_moves = {
      attacker: movesView(board, SIDE_ATTACKER),
      defender: movesView(board, SIDE_DEFENDER),
    };
    view.legal_move_count = view.legal_moves.attacker.length + view.legal_moves.defender.length;
  } else if (withMoves === 'turn' && !game.isGameOver()) {
    view.legal_moves = movesView(board, game.turn);
    view.legal_move_count = view.legal_moves.length;
  }
  return view;
}

/** A short row for the game list. */
function summaryView(session) {
  const { game } = session;
  return {
    id: session.id,
    variant: game.variant.id,
    name: game.variant.name,
    size: game.board.size,
    turn: game.turn,
    ply: game.ply,
    status: game.status,
    winner: game.winner,
    seats: { attacker: session.seats[SIDE_ATTACKER], defender: session.seats[SIDE_DEFENDER] },
    levels: { attacker: session.levels[SIDE_ATTACKER], defender: session.levels[SIDE_DEFENDER] },
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    url: `/api/games/${session.id}`,
  };
}

function rulesText(variant) {
  return plain.rulesText(variant);
}

module.exports = {
  PIECE_NAMES,
  variantView,
  boardView,
  movesView,
  capturesView,
  plyView,
  levelsView,
  gameView,
  summaryView,
  rulesText,
};
