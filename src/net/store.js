'use strict';

const crypto = require('node:crypto');

const { Game } = require('../rules/game');
const { AIPlayer, levelOf } = require('../ai/player');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../rules/pieces');
const { formatSan } = require('../rules/notation');
const { seededRng } = require('../headless');
const { GameDirectory } = require('./disk');
const { capturesView } = require('./state');
const E = require('./errors');

const SEAT_KINDS = ['human', 'ai', 'agent', 'client'];
const SEAT_ALIASES = { agent: 'human', client: 'human' };
const MAX_THINK_MS = 30000;

const now = () => new Date().toISOString();
const other = (side) => (side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER);

/** Short, url-friendly game id. */
function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function wholeNumber(value, name, min = 1) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw E.badRequest(`${name} expects a whole number >= ${min}, got '${value}'`);
  return n;
}

function milliseconds(value, name) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) throw E.badRequest(`${name} expects a positive number of milliseconds, got '${value}'`);
  return Math.min(n, MAX_THINK_MS);
}

function seatKind(value, name) {
  const kind = String(value).toLowerCase();
  if (!SEAT_KINDS.includes(kind)) {
    throw E.badRequest(`${name} expects human | ai | agent, got '${value}'`);
  }
  return SEAT_ALIASES[kind] || kind;
}

/** `{ attacker: 'human', defender: 'ai' }`; the default is a client playing the defenders. */
function seatsFrom(spec) {
  const seats = { [SIDE_ATTACKER]: 'ai', [SIDE_DEFENDER]: 'human' };
  if (!spec) return seats;
  if (typeof spec !== 'object') throw E.badRequest(`seats expects { attacker, defender }, got '${spec}'`);
  for (const side of [SIDE_ATTACKER, SIDE_DEFENDER]) {
    if (spec[side] !== undefined) seats[side] = seatKind(spec[side], `seats.${side}`);
  }
  return seats;
}

/** Per-side strength, validated against the presets the AI knows. `'hard'` sets both seats. */
function levelsFrom(spec, fallback = null) {
  const given = typeof spec === 'string' ? { level: spec } : (spec || {});
  const base = String(given.level || fallback || 'medium').toLowerCase();
  const levels = { [SIDE_ATTACKER]: base, [SIDE_DEFENDER]: base };
  if (typeof given !== 'object') throw E.badRequest(`levels expects a preset name or { attacker, defender }, got '${given}'`);
  for (const side of [SIDE_ATTACKER, SIDE_DEFENDER]) {
    if (given[side] !== undefined) levels[side] = String(given[side]).toLowerCase();
  }
  for (const side of [SIDE_ATTACKER, SIDE_DEFENDER]) {
    try {
      levelOf(levels[side]);
    } catch (error) {
      throw E.badRequest(error.message);
    }
  }
  return levels;
}

/**
 * The open games of one server: a `Game`, plus who plays each seat, how strong the
 * AI is and its thinking clock. In memory, and in a directory when one is given
 * (`stateDir`): `export` is how one game leaves, `--state-dir` is how a server
 * restarts without losing any of them.
 */
class GameStore {
  constructor(options = {}) {
    this.maxGames = wholeNumber(options.maxGames ?? 50, 'maxGames');
    this.ttlMs = wholeNumber(options.ttlMs ?? 3 * 60 * 60 * 1000, 'ttlMs');
    this.maxWatchers = wholeNumber(options.maxWatchers ?? 8, 'maxWatchers');
    this.defaultTimeMs = milliseconds(options.timeMs ?? null, 'timeMs');
    this.games = new Map();
    this.disk = options.stateDir ? new GameDirectory(options.stateDir) : null;
    if (this.disk) this.loadFromDisk();
  }

  get size() { return this.games.size; }

  /** The directory games are kept in, or `null` when they live in memory only. */
  get stateDir() { return this.disk ? this.disk.dir : null; }

  /** Open a game. `spec`: variant, size, seats, levels, time_ms, seed, max_plies, load. */
  create(spec = {}) {
    this.sweep();
    if (this.games.size >= this.maxGames) {
      throw E.conflict(`this server keeps ${this.maxGames} games open and all are in use: close one with DELETE /api/games/:id`);
    }
    let game;
    if (spec.load) {
      try {
        game = Game.deserialize(spec.load);
      } catch (error) {
        throw E.badRequest(`cannot resume that game: ${error.message}`);
      }
    } else {
      try {
        game = Game.create(spec.variant || 'tablut', spec.size ?? null);
      } catch (error) {
        throw E.badRequest(error.message);
      }
    }
    const cap = spec.max_plies ?? spec.maxPlies;
    if (cap !== undefined && cap !== null) {
      game.variant = { ...game.variant, maxPlies: wholeNumber(cap, 'max_plies') };
    }

    const seed = spec.seed === undefined || spec.seed === null
      ? Math.floor(Math.random() * 1e9)
      : wholeNumber(spec.seed, 'seed', 0);
    const seats = seatsFrom(spec.seats);
    const levels = levelsFrom(spec.levels, spec.level);
    const globalTime = milliseconds(spec.time_ms ?? spec.timeMs ?? null, 'time_ms');
    const timeMs = {
      [SIDE_ATTACKER]: milliseconds(spec.time_ms_a ?? globalTime ?? this.defaultTimeMs, 'time_ms_a'),
      [SIDE_DEFENDER]: milliseconds(spec.time_ms_d ?? globalTime ?? this.defaultTimeMs, 'time_ms_d'),
    };

    const session = {
      id: newId(),
      game,
      seats,
      levels,
      timeMs,
      seed,
      rngs: {
        [SIDE_ATTACKER]: seededRng(seed),
        [SIDE_DEFENDER]: seededRng(seed + 7919),
      },
      aiInfo: null,
      createdAt: now(),
      updatedAt: now(),
      dirty: true,
    };
    this.games.set(session.id, session);
    return session;
  }

  get(id) {
    const session = this.games.get(String(id));
    if (!session) throw E.notFound(`no game with id '${id}' on this server`);
    return session;
  }

  remove(id) {
    const session = this.get(id);
    this.announceClosed(session);
    this.games.delete(session.id);
    if (this.disk) this.disk.remove(session.id);
    return session;
  }

  list() { return [...this.games.values()]; }

  touch(session) {
    session.updatedAt = now();
    if (session.dirty) {
      session.dirty = false;
      this.persist(session);
    }
    return session;
  }

  /** A change worth saving: the next `touch` writes the game out. */
  markDirty(session) {
    session.dirty = true;
    return session;
  }

  /** Write one game to its directory, when the store has one. */
  persist(session) {
    if (!this.disk) return session;
    try {
      this.disk.save(session);
    } catch (error) {
      // A directory that cannot be written to (a full disk) should not lose a game
      // that is being played: keep it in memory, and try again at the next touch.
      session.dirty = true;
      this.lastSaveError = error.message;
    }
    return session;
  }

  /**
   * A game that comes back from disk: the save file carries the board and the
   * record, the `session` key carries the seats around it. Returns `null` for a
   * file whose game this server cannot play.
   */
  adopt(entry) {
    let game;
    try {
      game = Game.deserialize(entry.save);
    } catch {
      return null;
    }
    const meta = entry.session || {};
    const seed = Number.isInteger(meta.seed) && meta.seed >= 0
      ? meta.seed
      : Math.floor(Math.random() * 1e9);
    const time = typeof meta.time_ms === 'object' && meta.time_ms ? meta.time_ms : {};
    const session = {
      id: entry.id,
      game,
      seats: seatsFrom(meta.seats),
      levels: levelsFrom(meta.levels),
      timeMs: {
        [SIDE_ATTACKER]: milliseconds(time[SIDE_ATTACKER] ?? this.defaultTimeMs, 'time_ms_a'),
        [SIDE_DEFENDER]: milliseconds(time[SIDE_DEFENDER] ?? this.defaultTimeMs, 'time_ms_d'),
      },
      seed,
      rngs: {
        [SIDE_ATTACKER]: seededRng(seed),
        [SIDE_DEFENDER]: seededRng(seed + 7919),
      },
      aiInfo: null,
      createdAt: meta.created_at || now(),
      updatedAt: meta.updated_at || now(),
      dirty: false,
    };
    this.games.set(session.id, session);
    return session;
  }

  /**
   * Read the games of the directory back in, most recent first, up to the slots.
   * A game nobody has touched for the whole TTL is dropped where it lies: the
   * server that wrote it stopped, so the sweep that would have taken it never ran.
   */
  loadFromDisk() {
    const loaded = [];
    const started = Date.now();
    for (const entry of this.disk.loadAll()) {
      const age = started - Date.parse(entry.session.updated_at || '');
      if (Number.isFinite(age) && age > this.ttlMs) {
        this.disk.remove(entry.id);
        continue;
      }
      if (this.games.size < this.maxGames) {
        const session = this.adopt(entry);
        if (session) loaded.push(session);
      }
      // a fresh game past the last slot stays on disk: it is there next time
    }
    this.sweep(started);
    return loaded;
  }

  /**
   * Watch one game: `sink(event, payload)` is called for every change. Returns the
   * unsubscribe, which must be called when the connection goes away. The store does
   * not know about HTTP: the framing is the caller's (see `src/net/server.js`).
   */
  subscribe(session, sink) {
    if (!session.watchers) session.watchers = new Set();
    if (session.watchers.size >= this.maxWatchers && !session.watchers.has(sink)) {
      throw E.conflict(`this game has ${session.watchers.size} watchers already: close one before watching it again`);
    }
    session.watchers.add(sink);
    return () => {
      if (session.watchers) session.watchers.delete(sink);
    };
  }

  /** Tell everyone watching `session` that something happened. Returns how many heard. */
  publish(session, event, payload) {
    if (!session.watchers || session.watchers.size === 0) return 0;
    let sent = 0;
    for (const sink of [...session.watchers]) {
      try {
        sink(event, payload);
        sent += 1;
      } catch {
        // a sink that throws is a dead connection: do not let it pile up
        session.watchers.delete(sink);
      }
    }
    return sent;
  }

  /** Tell the watchers of a game that is going away, before it leaves the map. */
  announceClosed(session) {
    this.publish(session, 'closed', { id: session.id, status: session.game.status, reason: session.game.reason });
    if (session.watchers) session.watchers.clear();
  }

  /** Forget games nobody has touched for `ttlMs`. */
  sweep(nowMs = Date.now()) {
    for (const [id, session] of [...this.games]) {
      const age = nowMs - Date.parse(session.updatedAt);
      if (Number.isFinite(age) && age > this.ttlMs) {
        this.announceClosed(session);
        this.games.delete(id);
        if (this.disk) this.disk.remove(id);
      }
    }
    return this.games.size;
  }

  /** The search player for one seat. */
  aiFor(session, side, overrides = {}) {
    const level = overrides.level || session.levels[side];
    const timeMs = overrides.timeMs === undefined ? session.timeMs[side] : overrides.timeMs;
    return new AIPlayer(level, {
      timeMs: timeMs ?? undefined,
      rng: overrides.unseeded ? Math.random : session.rngs[side],
      label: `${side} AI (${level})`,
    });
  }

  /** A move for `side`: searched, not played. */
  suggest(session, side, overrides = {}) {
    return this.aiFor(session, side, overrides).chooseMove(session.game, side);
  }

  /**
   * One AI ply for the side to move. Returns the record of the ply, or `null` when
   * the game is over, the seat is not an AI, or the AI has no move (rule decided).
   */
  playAiPly(session) {
    const game = session.game;
    if (game.isGameOver() || session.seats[game.turn] !== 'ai') return null;
    const side = game.turn;
    const { move, info } = this.suggest(session, side);
    session.aiInfo = { side, level: session.levels[side], depth: info.depth, nodes: info.nodes, score: info.score };
    if (!move) {
      game.declareNoMove(side);
      return null;
    }
    const result = game.play(move);
    session.aiInfo.san = formatSan(game.board.size, move, result.captured.length);
    return this.plyRecord(session, result);
  }

  /** Play while the side to move is an AI seat, so one request can cover a whole exchange. */
  playAiSeats(session, maxPlies = 100) {
    const played = [];
    while (played.length < maxPlies) {
      const ply = this.playAiPly(session);
      if (!ply) break;
      played.push(ply);
    }
    return played;
  }

  plyRecord(session, result) {
    const size = session.game.board.size;
    return {
      ply: result.ply,
      side: result.side,
      san: formatSan(size, result.move, result.captured.length),
      notation: result.notation,
      captured: capturesView(session.game.board, result.captured),
      seat: session.seats[result.side],
      status: result.status,
    };
  }
}

module.exports = {
  GameStore,
  SEAT_KINDS,
  seatsFrom,
  levelsFrom,
  other,
  newId,
  MAX_THINK_MS,
};
