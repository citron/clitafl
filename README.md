# Clitafl — the Tafl game of the Vikings

A dependency-free implementation of the tafl family: six historical Viking/Celtic board
games — from 7×7 brandub to the 19×19 alea evangelii — with one rules engine, a real
game-tree AI, animations, saves, records and headless matches — in the terminal, in the
browser, and over an HTTP API an agent can drive.

Plain Node.js, **zero runtime dependencies** — no `npm install` step, no build step,
nothing to break. The web client is HTML, CSS and vanilla JS talking to the same engine
through the API.

```bash
node src/index.js          # play tablut against the AI
node src/index.js serve    # the same game in a browser, plus the API
node src/index.js variants # see the six armies
```

## Requirements

Node.js 20 or newer (tested on Node 24). The CLI uses `node:util`, `node:readline/promises`
and its own ANSI writer; the server adds `node:http`, `node:fs` and `node:crypto`. No
framework, no bundler.

## Install

```bash
git clone <your fork> && cd clitafl
npm test        # 134 tests, node's built-in runner, no download needed
```

`npm install` is not required to play. `npm link` gives you `clitafl` and `tafl` commands.

## The six variants

| id | board | army | the king escapes to |
| --- | --- | --- | --- |
| `tablut` | 9×9 | king + 8 vs 16 | any edge square |
| `copenhagen` | 11×11 | king + 12 vs 24 | a corner |
| `brandub` | 7×7 | king + 4 vs 8 | a corner |
| `ard-ri` | 7×7 | king + 8 vs 16 | any edge square |
| `alea` | 19×19 | king + 24 dukes vs 48 counts | the 16 marked corner squares |
| `tawlbwrdd` | 11×11 | king + 12 vs 24 | any edge square |

Every variant carries its own rule set in `src/rules/variants.js`: castle geometry
(throne, corners, the four marked 2×2 blocks), who may land on a castle, whether an empty
castle captures, how many attackers are needed around the king in the open field / beside
a castle / on a castle, whether the edge shields the king and whether the edge itself
captures, the siege win, the no-legal-move rule and the repetition rule. The attackers
always open. `--size` (odd, 7–19) rebuilds a symmetric position for any variant, so you
are not limited to the historical boards.

## Commands

```bash
node src/index.js play --variant copenhagen --human defender --level hard
node src/index.js demo --variant brandub                 # animated AI vs AI
node src/index.js match --variant tablut --seed 3 --time 40 --record game.json
node src/index.js serve --port 8080                      # web board + API
node src/index.js variants
node src/index.js rules ard-ri
node src/index.js help
```

Useful flags: `--size 11`, `--human attacker|defender|both|none`, `--level easy|medium|hard|grandmaster`,
`--level-a` / `--level-d` per side, `--time <ms>` thinking budget, `--moves <file>` for a
scripted game, `--load <file>` to resume, `--record <file>` to write the record,
`--seed <n>` for reproducible matches, `--max-plies <n>`, `--fps <ms>`,
`--ascii`, `--no-color` (also honours `NO_COLOR`), `--no-animation`.

For `serve`: `--port <n>` (0 asks the operating system for a free one), `--host <addr>`
(default `127.0.0.1`), `--max-games <n>` (default 50), `--ttl <minutes>` — how long a game
nobody touches is kept (default 180), `--time <ms>` — the default thinking budget. Ctrl-c
closes the server and exits 0.

## Web board and API

```bash
npm run serve                    # http://127.0.0.1:8080
node src/index.js serve --port 0 # any free port, printed in the banner
```

The banner prints everything a player — or an agent — needs:

```
clitafl is serving

  board      http://127.0.0.1:8080/            the web client, click to move
  api        http://127.0.0.1:8080/api         the endpoints, described as JSON
  api index  http://127.0.0.1:8080/api/health  health, open games, what the engine is

  open games 50 at a time, forgotten after 180 minutes without a request
  watchers   8 connections may watch one game as it is played
```

The board in `web/` is one page: variant, size, seat and level pickers, a click-to-move
board with the castle / throne / escape marks, the record, and hint, AI moves, undo,
resign, save and refresh. A seat set to *agent / client* is left to the outside world: the
page shows the exact `curl` commands that drive it, which is how a script or an AI agent
takes a seat over. The page also *watches* the game it shows, so a move played from a
terminal appears in the browser without a click.

The API is the same game the CLI and the page play. `GET /api` describes it as data, so a
client can discover it without reading this file.

```bash
# open a game: the AI plays the attackers, the caller plays the defenders
curl -s localhost:8080/api/games -X POST -H 'content-type: application/json' \
  -d '{"variant":"tablut","seats":{"attacker":"ai","defender":"agent"},"levels":"hard"}'

# read it: board, turn, legal moves of the side to move
curl -s localhost:8080/api/games/<id>

# play a move: the AI answers in the same reply
curl -s localhost:8080/api/games/<id>/moves -X POST -H 'content-type: application/json' \
  -d '{"from":"d5","to":"d4"}'

# watch that game: one event per move, pushed as it happens
curl -sN localhost:8080/api/games/<id>/events
```

| endpoint | what it does |
| --- | --- |
| `GET /api/health` | version, open games, variants, levels, engine |
| `GET /api/variants` · `GET /api/variants/:id?size=11` | the armies, and the rules as text |
| `GET /api/levels` | the strength presets with their depth and budget |
| `GET /api/games` · `POST /api/games` | list / open (`?include=closed` lists finished ones) |
| `GET /api/games/:id?moves=turn\|none\|all` | full state: board, turn, legal moves, record |
| `POST /api/games/:id/moves` | play `{from,to}` (or `{move:"d5-d6"}`), `?ai=false` silences the AI seats |
| `POST /api/games/:id/ai` | let the AI seats play `{moves:n}` plies, or `{moves:"all"}` |
| `POST /api/games/:id/hint` | search a move without playing it |
| `POST /api/games/:id/undo` · `/resign` · `/seats` | take plies back, resign, hand a seat to the AI |
| `GET /api/games/:id/moves?since=n` · `/rules` · `/export` | the record, the rules, the save file |
| `GET /api/games/:id/events` | the game as a Server-Sent Events stream (`text/event-stream`) |
| `DELETE /api/games/:id` | close a game and free its slot |

Notes for a client:

- A seat is `human`, `ai` or `agent`. `agent` (like `human`) is the caller's seat, so
  `POST /moves` answers for it and plays every AI seat in turn; asking the server to move
  an AI seat by hand is a `409`.
- A reply carries `played` — the plies of the whole exchange: yours, then each AI seat.
- A legal move is `{from, to, piece, san}`: `piece` is `king`, `defender` or `attacker`, and
  `san` is the string you post back as `{"move": "d5-d6"}`.
- Opening a game plays at most one opening ply, so an all-AI game is not played out by the
  request that opens it; `{"auto":false}` keeps even that for the caller.
- `legal_moves` is the list for the side to move, an array. `?moves=all` makes it an object
  keyed by side, `?moves=none` makes it empty.
- `time_ms` (and `time_ms_a` / `time_ms_d`) is capped at 30 s, because the search runs
  inside the request.
- Bad input is a `400` with one readable sentence, a game that is over is a `409`, a route
  that does not exist is a `404` with a hint, and CORS is open (`OPTIONS` → 204).
- The save file from `/export` comes back as `POST /api/games {"load": …}`, so a game can
  leave the server and come back to it — that is also how the CLI's `--record` and `--load`
  files look.
- `GET /api/games/:id/events` is that game pushed to you: an `event: state` to start, then
  one `event: ply` per move — yours or another client's — with a `event: state` after it, and
  `event: closed` when the game goes. `curl -sN` reads it, a browser uses `EventSource`, and
  one game takes at most `--max-watchers` of them. Polling the state works as well: the
  stream is a convenience, not a second protocol.

Games live in memory: `--max-games` slots, least recently used ones forgotten after the
`--ttl`. The server binds `127.0.0.1` by default — `--host 0.0.0.0` is how you put it on a
network, and there is no authentication, so do that only where you mean it.

## Playing

Pieces move like a rook, any distance, never jumping. A soldier is captured when two
enemies sit on opposite sides of it. The king is captured under the rules of the variant
(see `rules`). The defenders win when the king reaches an escape square, the attackers
when they take the king — and in the fetlar family, when they seal the king and his whole
host in a region with no escape square.

Type moves as `d5-d6`. Also accepted: `d5 d6`, `d5d6`, `d5>d6`, upper case.
Files are letters `a…`, ranks are numbers counted from the top left.

In-game commands: `help`, `board`, `moves`, `history`, `hint`, `undo [n]`, `rules`,
`save <file>`, `resign`, `quit`.

```
Tablut  9x9  king escapes to the edge
turn defenders   ply 8   no-move rule: draw

     a b c d e f g h i
  1 ✦ · · · ○ · · · ✦
  2 · · · ○ · ○ · · ·
  3 · · · · ○ · ○ · ·
  4 · ○ · ● ● ● · ○ ·
  5 · · ○ ● ★ · ○ · ·
  6 · ○ · ● · ○ · · ·
  7 · · ○ · ● · ○ · ·
  8 · · · ○ · ○ · · ·
  9 ✦ · · · ○ · · · ✦
     a b c d e f g h i

★ king   ● defenders 6   ○ attackers 16   ✦ castle

last move: e6-e7
```

## AI

Negamax with alpha-beta pruning, iterative deepening, a transposition table, killer moves,
a capture-only quiescence search and a budget in milliseconds *or in nodes*. Captures are
applied and undone in place on the live board, and the Zobrist key is updated in place, so
a search node allocates nothing. Four strength presets set the depth ceiling, the budget
and how much play is allowed to wander:

| level | depth ceiling | budget | play |
| --- | --- | --- | --- |
| `easy` | 2 | 120 ms | picks among the top 8 moves |
| `medium` | 6 | 700 ms | top 2 moves |
| `hard` | 12 | 2.5 s | best move, opens from the book |
| `grandmaster` | 30 | 8 s | best move, opens from the book |

What that budget reaches from the opening, with the book off: `tablut` depth 4 (medium) to
5 (grandmaster), `copenhagen` 3 to 4, `brandub` 5 to 7, `alea` 2 to 3 — 30 000 to
90 000 nodes a second depending on the board. The quiescence search follows the moves that
take a piece, so a snapshot evaluation never counts in the middle of an exchange.

The evaluation is tafl-specific: material, king mobility, the distance of the king to its
escape squares (including the marked 2×2 blocks), open lines to the escape, freedom of both
armies, space (per man, so the 19×19 board is not worth more than the 7×7 one) and the
pressure the attackers build around the king.

`src/ai/book.js` is a small opening book, `src/ai/book.json`: 411 prepared positions, 10
plies deep, made by seeded self-play (`node tools/make-book.js`, deterministic). A book
move is only a suggestion — it is checked against the legal moves before it is played — and
`book: false` (or `bookData`) turns it off.

A node budget (`maxNodes`) makes a search bit-reproducible: it stops on a count and never
reads the clock. That is what a seeded `match` and the test suite run on; with a clock
budget, the depth reached depends on the machine.

## Headless

`src/headless.js` plays a whole game with no terminal, and is what `demo`, `match` and the
test suite use:

```js
const { playMatch } = require('./src/headless');
const { Game } = require('./src/rules/game');

const match = playMatch({ game: Game.create('copenhagen'), level: 'hard', seed: 7 });
console.log(match.status, match.reason, match.plies);
console.log(match.history.map((h) => h.san).join(' '));
```

Every variant plays out to a result at the low budgets used by the tests, and the same seed
gives the same game — ply for ply — because the matches run on a node budget. `maxNodes`
is a `playMatch` option too.

## Layout

```
src/rules/pieces.js     piece and side codes, the vocabulary of the engine
src/rules/variants.js   the declarative rule sets + the symmetric setup generator
src/rules/board.js      geometry, movement, castles, custodian capture, siege flood fill
src/rules/game.js       turns, victory/draw detection, undo, repetition, save/load
src/rules/notation.js   d5-d6 parsing and formatting
src/ai/evaluate.js      static evaluation
src/ai/zobrist.js       deterministic hash table, keys updated in place
src/ai/search.js        negamax + alpha-beta + transposition table + killers + quiescence
src/ai/book.js          the opening book, checked against the legal moves
src/ai/book.json        411 prepared positions, 10 plies deep
src/ai/player.js        strength presets, noise, book hook
src/ui/ansi.js          ANSI/terminal control, NO_COLOR, alt screen
src/ui/display.js       board, legend, banner, rules text, move animation
src/cli/controller.js   one session: seats, turn loop, in-game commands, cleanup
src/net/errors.js       ApiError and the status helpers: 400, 404, 405, 409, 413
src/net/state.js        the public JSON view of a game: board, moves, record, rules text
src/net/store.js        sessions, seats, levels, clocks, TTL, max games
src/net/api.js          the route table and the handlers, self-documenting
src/net/server.js       node:http: static files, CORS, body cap, /api dispatch
src/headless.js         AI vs AI without a terminal
src/index.js            command line, including serve
tools/make-book.js      the book generator, seeded and deterministic
web/index.html          the board page
web/style.css           its theme
web/app.js              fetch calls, click-to-move, the agent command panel
tests/                  node:test suites: rules, board, notation, AI, display, headless, CLI, net, server
```

## Tests

```bash
npm test
```

134 tests on `node:test` — no framework to install. They cover the historical armies and
castle rules of each variant (the 19×19 alea evangelii included: exits, citadel, the 4/3/2
king capture, the marked squares capturing for both sides), movement, capture counts (open
field, beside and on a castle, edge), siege sealing, apply/undo symmetry, save round-trips,
repetition and ply-limit draws, the search (mate in one, escapes, time budget, depth
monotonicity, capture prediction against the board for every legal move, quiescence
following only captures, the Zobrist key over a 40-ply game, a node budget replaying
itself, book moves being legal), the renderer (glyphs, colour off, legend counts, rules
text, animation never touching the real board), the CLI itself (flags, exit codes,
records, scripted games), the API (every endpoint, every error path, seats, clocks, TTL,
save round-trips, the watchers of a game hearing every change), and the HTTP layer over a
real socket (static files, traversal attempts, CORS, body cap, the event stream frame by
frame, and the `serve` command of the CLI started as a child process).

## Rules sources

The rule sets follow the documented historical games: Linnaeus' 1732 account of tablut,
the Fetlar/Copenhagen rules (aagenielsen.dk) for the 11×11 corner-escape family, and the
Irish/Welsh reconstructions collected at tafl.cyningstan.com and Wikipedia's tafl article.
The alea evangelii follows the twelve rules copied next to the diagram in Cambridge, CCC
MS 122 (c. 1140), as edited by D. Walker (tafl.cyningstan.com), with the army divided as
H. J. R. Murray (1955) read the diagram; its starting colours are a documented
reconstruction, as the manuscript draws every piece but four in one colour. Where the
sources disagree (the tablut king capture count, the brandub setup) the variant file says
which reading it implements. Brandub's and Ard Rí's starting positions are
reconstructions, not originals.

The alea evangelii is played as the sources describe it, and it is imbalanced: self-play at
120 ms a move sees the attackers take the king in most games (3 of the 4 seeds tested, the
fourth a king that reached a marked square). The manuscript's own marginal note complains
about the same thing, and modern reconstructions are known to favour the attackers — the
defenders start boxed in around a citadel they may not use.

## Roadmap

- Games kept on disk (`--state-dir`) so a server can restart without losing them.
- A lobby: games that two named clients join by id, with a per-seat token.
- Per-move limits for the search, so a `grandmaster` reply has a predictable ceiling.
- `ard-ri` has 7×7 armies, and 7×7 boards only carry 8 attackers in the symmetric
  generator: the setup for that variant is a documented reconstruction, not a source.

## License

ISC — see `LICENSE`.
