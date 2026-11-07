'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The extra key of a save file: the seats, levels, clocks and seed of the game. */
const SESSION_KEY = 'session';

/** Ids are short and url-friendly; a file whose name is not one is not ours. */
const ID_PATTERN = /^[a-z0-9_-]{4,64}$/;

function idFromName(name) {
  const stem = String(name).replace(/\.json$/i, '');
  return ID_PATTERN.test(stem) ? stem : null;
}

/**
 * The file for one game: the `clitafl-save-v1` save, with the session around it in
 * one extra key. `Game.deserialize` ignores keys it does not know, so the same file
 * goes back through `POST /api/games {"load": …}` and `--load` untouched.
 */
function saveFile(session) {
  const save = session.game.serialize();
  save[SESSION_KEY] = {
    id: session.id,
    seats: session.seats,
    levels: session.levels,
    time_ms: session.timeMs,
    seed: session.seed,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
  return save;
}

/**
 * One directory of games: a JSON file per game, written atomically (a temp file in
 * the same directory, then a rename), so a crash leaves the old file intact rather
 * than half of a new one. It knows about files, not about games: what to write is
 * the store's business.
 */
class GameDirectory {
  constructor(dir) {
    this.dir = path.resolve(String(dir));
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (error) {
      throw new Error(`--state-dir '${dir}' cannot be used: ${error.message}`);
    }
  }

  file(id) {
    const safe = idFromName(id);
    if (!safe) throw new Error(`'${id}' is not a game id`);
    return path.join(this.dir, `${safe}.json`);
  }

  /** Write one game, replacing its file in one step. */
  save(session) {
    const file = this.file(session.id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(saveFile(session), null, 2)}\n`);
    fs.renameSync(tmp, file);
    return file;
  }

  remove(id) {
    fs.rmSync(this.file(id), { force: true });
  }

  /**
   * Every game file, most recently touched first. A file that cannot be read, or
   * that is not a clitafl save, is skipped: one broken file does not stop a server.
   */
  loadAll() {
    const entries = [];
    for (const name of fs.readdirSync(this.dir)) {
      const id = idFromName(name);
      if (!id) continue;
      try {
        const save = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
        if (save && save.format === 'clitafl-save-v1') {
          entries.push({ id, save, session: save[SESSION_KEY] || {} });
        }
      } catch {
        // not a game: leave the file where it is and carry on
      }
    }
    return entries.sort((a, b) => Date.parse(b.session.updated_at || 0) - Date.parse(a.session.updated_at || 0));
  }
}

module.exports = { GameDirectory, saveFile, idFromName, SESSION_KEY };
