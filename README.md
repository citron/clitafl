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
npm test        # 179 tests, node's built-in runner, no download needed
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
castle captures, how many attackers are needed around the king on the throne / next to it
/ in the open field, whether the edge shields the king and whether the edge itself
captures, the shield wall of the Copenhagen rules, the siege win, the no-legal-move rule,
the repetition rule and the move limit — with what the limit means, since the Copenhagen
rules give the attackers the game when it is reached. The attackers always open. `--size`
(odd, 7–19) rebuilds a symmetric position for any variant, so you are not limited to the
historical boards; a variant that states its limit per size (Copenhagen: 100 / 140 / 160
moves on 7 / 11 / 13) carries that rule over to the size you ask for.

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
`--level-a` / `--level-d` per side, `--time <ms>` thinking budget, `--nodes <n>` ceiling in
search nodes, `--depth <n>` ceiling on the search depth, `--moves <file>` for a
scripted game, `--load <file>` to resume, `--record <file>` to write the record,
`--seed <n>` for reproducible matches, `--max-plies <n>`, `--fps <ms>`,
`--ascii`, `--no-color` (also honours `NO_COLOR`), `--no-animation`.

`--time` is a wall clock, so what a move costs depends on the machine. `--nodes` is the
budget that does not: the search stops on a count of nodes and never reads the clock, so the
same ceiling buys the same work on any server, at any hour, and a match played under it
replays move for move. `--depth` is the cheap knob that keeps a move inside a node ceiling.

For `serve`: `--port <n>` (0 asks the operating system for a free one), `--host <addr>`
(default `127.0.0.1`), `--max-games <n>` (default 50), `--max-watchers <n>` — connections
that may watch one game as it is played (default 8), `--ttl <minutes>` — how long a game
nobody touches is kept (default 180), `--state-dir <dir>` — keep the open games there and
find them again after a restart, `--time <ms>`, `--nodes <n>`, `--depth <n>` — the default
budget of an AI move. Ctrl-c closes the server and exits 0.

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
  lobby      http://127.0.0.1:8080/api/lobby   the games with a seat going: join takes the seat and its token

  open games 50 at a time, forgotten after 180 minutes without a request
  watchers   8 connections may watch one game as it is played
  ceiling    200000 search nodes per AI move (the budget that costs the same on any machine)
```

With no `--nodes`, the banner leaves the ceiling line out and the clock decides each move.

The board in `web/` is one page, and one window: nothing on it scrolls. The board is the
screen — it takes the whole window, its squares sized by `web/squares.js` from the room left
over (a window too small for a readable cell scales the board rather than cut it) — and
everything else is a sheet over it: setup, this game, the record, the rules, the agents and
the list of games, opened by the tabs or the keys `1`…`6` and closed by `Esc`. The setup
sheet carries the variant, size, seat, level and search-ceiling pickers; the board carries
the castle / throne / escape marks, and the strip under it carries hint, AI moves, undo,
resign, save and refresh. The meta panel answers what the next AI move is allowed to cost,
so the pause after a move has a number attached to it. A seat set to *agent / client* is
left to the outside world: the agent sheet shows the exact `curl` commands that drive it,
which is how a script or an AI agent takes a seat over. The page also *watches* the game it
shows, so a move played from a terminal appears in the browser without a click. Resize,
enter full screen (`f`) or turn a phone, and the board is measured again: `resize`,
`ResizeObserver` and `fullscreenchange` all repaint it, and one line under it says what the
window cannot show.

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

# find a game with a seat going, and take that seat
curl -s localhost:8080/api/lobby
curl -s localhost:8080/api/lobby/<id>/join -X POST -H 'content-type: application/json' \
  -d '{"seat":"defender","name":"bot-7"}'

# play the seat you took: the join reply is the only place its token appears
curl -s localhost:8080/api/games/<id>/moves -X POST -H 'content-type: application/json' \
  -H 'x-clitafl-token: <token>' -d '{"from":"d5","to":"d4"}'

# watch that game: one event per move, pushed as it happens
curl -sN localhost:8080/api/games/<id>/events
```

| endpoint | what it does |
| --- | --- |
| `GET /api/health` | version, open games, variants, levels, engine |
| `GET /api/variants` · `GET /api/variants/:id?size=11` | the armies, every rule flag, and the rules as text |
| `GET /api/levels` | the strength presets with their depth and budget |
| `GET /api/games` · `POST /api/games` | list / open (`?include=closed` lists finished ones) |
| `GET /api/lobby` · `GET /api/lobby/:id` | the games with a seat going, and one card of it |
| `POST /api/lobby/:id/join` | take an open seat `{seat, name}`: the reply carries its token |
| `GET /api/games/:id?moves=turn\|none\|all` | full state: board, turn, legal moves, record |
| `POST /api/games/:id/moves` | play `{from,to}` (or `{move:"d5-d6"}`), `?ai=false` silences the AI seats |
| `POST /api/games/:id/ai` | let the AI seats play `{moves:n}` plies, `{moves:"all"}`, with a per-call `{time_ms, max_nodes, max_depth}` |
| `POST /api/games/:id/hint` | search a move without playing it, at any budget: `{side, level, time_ms, max_nodes, max_depth}` |
| `POST /api/games/:id/undo` · `/resign` · `/seats` | take plies back, resign, hand a seat to the AI, the lobby or an agent |
| `GET /api/games/:id/moves?since=n` · `/rules` · `/export` | the record, the rules, the save file |
| `GET /api/games/:id/events` | the game as a Server-Sent Events stream (`text/event-stream`) |
| `DELETE /api/games/:id` | close a game and free its slot |

Notes for a client:

- A seat is `human`, `ai`, `agent` / `client` — three spellings of "the caller plays this" —
  or `open`, the same seat with nobody in it yet, which is what the lobby sells. `POST /moves`
  plays for a caller seat and then every AI seat in turn; asking the server to move an AI
  seat by hand is a `409`, and playing an open seat is a `409` until someone joins it.
- A seat the lobby sold is played by its token alone: send it as `x-clitafl-token: <token>`,
  the token from `POST /api/lobby/:id/join`. Without it, `401`. A token is shown once, in the
  join reply, and never appears in a state view; a seat handed to the AI, or back to an
  anonymous caller, gives its token up. `undo` and `seats` ask for the token of any seat in
  the game, because they act on the game a player owns; a `hint` is advice, not a move, so it
  stays open — the board is public information.
- The rules travel with the game: `GET /api/variants` answers each rule set as data — the
  escape target, the castle layout and who may land on it, the king-capture counts, the edge
  and siege rules, the no-move, repetition and move-limit rules with what reaching the limit
  means — and as `rules_text` prose, and every game state carries the same under `variant`
  (`rules`, `max_plies`), so a client reads the rules it is playing under: a limit that ends
  the game for the attackers (copenhagen rule 13) is in the state, not a secret of the server.
- A reply carries `played` — the plies of the whole exchange: yours, then each AI seat.
- A legal move is `{from, to, piece, san}`: `piece` is `king`, `defender` or `attacker`, and
  `san` is the string you post back as `{"move": "d5-d6"}`.
- Opening a game plays at most one opening ply, so an all-AI game is not played out by the
  request that opens it; `{"auto":false}` keeps even that for the caller.
- `legal_moves` is the list for the side to move, an array. `?moves=all` makes it an object
  keyed by side, `?moves=none` makes it empty.
- `time_ms` (and `time_ms_a` / `time_ms_d`) is capped at 30 s, because the search runs
  inside the request. `max_nodes` is the ceiling that does not depend on the machine: the
  search stops on a count of nodes and never reads the clock, so the same ceiling costs the
  same work on any server and a replayed match plays the same moves. A game answers the
  budget of each side as `budget: {attacker, defender}`, a reply plays every AI seat in
  turn so its worst case is the sum of theirs, and `last_ai` names the node ceiling the
  move obeyed, with the time, the source — `book` or `search` — it cost, and whether the clock
  or the ceiling cut it short (`aborted`, in the hint payload as well).
- Bad input is a `400` with one readable sentence, a seat you do not hold is a `401`, a game
  that is over is a `409`, a route that does not exist is a `404` with a hint, and CORS is
  open (`OPTIONS` → 204).
- The save file from `/export` comes back as `POST /api/games {"load": …}`, so a game can
  leave the server and come back to it — that is also how the CLI's `--record` and `--load`
  files look.
- With `--state-dir <dir>`, that file is written for you: one per open game, atomically, as
  the game is played, and pruned when the game closes. A server that starts on a directory
  it used before picks the games up where they stopped, seats, clocks and seed included.
- `GET /api/games/:id/events` is that game pushed to you: an `event: state` to start, then
  one `event: ply` per move — yours or another client's — with a `event: state` after it, and
  `event: closed` when the game goes. `curl -sN` reads it, a browser uses `EventSource`, and
  one game takes at most `--max-watchers` of them. Polling the state works as well: the
  stream is a convenience, not a second protocol.

Games live in memory: `--max-games` slots, least recently used ones forgotten after the
`--ttl`. With `--state-dir <dir>` they also live on disk, one save file per game, so a
restart finds them again; `GET /api/health` reports the directory (`state_dir`) and the
number of open games. The server binds `127.0.0.1` by default — `--host 0.0.0.0` is how
you put it on a network, and there is no authentication, so do that only where you mean it.
The seat token is the only credential the server has: it keeps a lobby seat to one client,
it does not keep a game private — a game with an open seat is on `GET /api/lobby` for
whoever can reach the port.

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

In a terminal the screen is one frame, and it does not scroll: the status line, the board
whole, the legend, the last move, and as much of the journal as the window pays for, padded
to the window's height so the prompt never moves. A window too short for a whole board keeps
the board and counts what is missing under it — `15 rows needed (this: 10) - enlarge the
terminal`, which in a narrow window comes down to the two numbers it has room for,
`15 → 10 rows`. A board wider than the window drops to a one-column pitch, and says so.
Resize the terminal and the frame is painted again for the window you have now.

A text longer than the window — `rules`, `help`, `moves`, `history` — is turned on its own
page, with the keyboard given to the page: `space`, `n`, `→`, `↓` and `enter` turn it, `b`,
`←`, `↑` and `pageup` turn it back, `pagedown` jumps a screen, `g` and `home` go to the first
page, `G` to the last, and `q`, `Esc`, `End` and ctrl-c give the board back. A page of rules
repaginates for the window, and its footer is told in the words the window has room for: the
whole list of keys in a wide terminal, `→ next   q board` in a narrow one.

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
90 000 nodes a second depending on the board. The same opening under a node ceiling —
200 000 nodes, book off — is depth 5 on `brandub` (0.5 s), 4 on `tablut` (0.8 s), 3 on
`copenhagen` (2.4 s), 3 on `alea` (1.7 s): the ceiling buys the depth, the seconds are what
this machine spends on it, and the depth is the same on any machine. The quiescence search
follows the moves that take a piece, so a snapshot evaluation never counts in the middle of
an exchange.

The evaluation is tafl-specific: material, king mobility, the distance of the king to its
escape squares (including the marked 2×2 blocks), open lines to the escape, freedom of both
armies, space (per man, so the 19×19 board is not worth more than the 7×7 one) and the
pressure the attackers build around the king.

`src/ai/book.js` is a small opening book, `src/ai/book.json`: 428 prepared positions, 10
plies deep, made by seeded self-play (`node tools/make-book.js`, deterministic). A book
move is only a suggestion — it is checked against the legal moves before it is played — and
`book: false` (or `bookData`) turns it off.

A node budget (`maxNodes`) makes a search bit-reproducible: it stops on a count and never
reads the clock — the count is checked every 1 024 nodes, and the answer is the last deepening
pass that finished, so a move never depends on where the count cut a pass. That is what a seeded
`match` and the test suite run on; with a clock
budget, the depth reached depends on the machine. Both ceilings are the caller's, on every
door: `--nodes` / `--depth` on the CLI, `max_nodes` / `max_depth` — with an `…_a` / `…_d`
spelling per seat — on a game, and on a `/ai` or `/hint` call that wants a deeper look than
the game's own ceiling. The state answers the budget of each side, so the worst case of a
reply is a number the client chose; see the API notes. The answer says whether the clock or
the ceiling cut it short (`aborted`), which is the difference between an evaluation of the
position and the best move a search had when it ran out of room.

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
src/ai/book.json        428 prepared positions, 10 plies deep
src/ai/player.js        strength presets, noise, book hook
src/ui/ansi.js          ANSI/terminal control, NO_COLOR, alt screen, the window's size,
                        the width of a styled line, cutting and wrapping to it, key names
src/ui/display.js       board, legend, banner, rules text, move animation, the frame fitted
                        to a window
src/cli/controller.js   one session: seats, turn loop, in-game commands, the frame, the
                        pager for long texts, cleanup
src/net/errors.js       ApiError and the status helpers: 400, 401, 404, 405, 409, 413
src/net/state.js        the public JSON view of a game: board, moves, record, rules text
src/net/store.js        sessions, seats, seat tokens, levels, clocks, TTL, max games, watchers
src/net/disk.js         the state directory: one save file per game, written atomically
src/net/api.js          the route table, the handlers and the lobby, self-documenting
src/net/server.js       node:http: static files, CORS, body cap, /api dispatch
src/headless.js         AI vs AI without a terminal
src/index.js            command line, including serve
tools/make-book.js      the book generator, seeded and deterministic
web/index.html          the board page: the board, the strip, the six sheets
web/style.css           its theme, and a window that never scrolls
web/squares.js          the coordinates — rank 1 is the top row, the way the engine names a
                        square — and the square size that fits a window
web/app.js              fetch calls, click-to-move, the sheets, the agent command panel
tests/                  node:test suites: rules, board, notation, AI, display, headless,
                        CLI, TUI, net, server
```

## Tests

```bash
npm test
```

179 tests on `node:test` — no framework to install. They cover the historical armies and
castle rules of each variant (the 19×19 alea evangelii included: exits, citadel, the 4/3/2
king capture, the marked squares capturing for both sides), the rule details the sources
spell out — the Copenhagen edge that does not capture (rule 5), the shield wall (rule 7),
the king who goes back onto his throne (rules 1 and 8), the garrison that is raised for the
throne alone, the Copenhagen move limit that gives the game to the attackers (rule 13), the
limit that follows the size —, movement, capture counts (open field, next to and on the
throne, edge), siege sealing, apply/undo symmetry, save round-trips, repetition and
move-limit draws, the search (mate in one, escapes, time budget, depth monotonicity, the
depth and node ceilings answering the number they were given, capture prediction against the
board for every legal move, quiescence following only captures, the Zobrist key over a
40-ply game, a node budget replaying itself, book moves being legal), the renderer (glyphs,
colour off, legend counts, rules text, animation never touching the real board), the CLI
itself (flags, exit codes, records, scripted games, a `--nodes` match replaying itself), the
API (every endpoint, every error path, the catalogue answering the sourced rule flags — the
shield wall, the king back on his throne, the edge that does not capture, the move limit and
what it means —, seats, clocks, per-seat budgets obeyed past the opening book, TTL, save
round-trips, the watchers of a game hearing every change, games written to and read back
from a state directory), and the HTTP layer over a real socket (static files, traversal
attempts, CORS, body cap, the event stream frame by frame, a state directory behind a live
server, the page naming every square the way `formatSquare` does — the cell you click is the
piece the API moves —, its two scripts compiling in one scope without a name declared twice,
that no square the page draws is wider than the window it is measured in, and that the page
has no scroll: the board is the window, and a sheet is bounded by it), the terminal screen
(the window's size, the width of a styled line, cutting and wrapping to it, the key names a
terminal sends, the board block being as wide as `boardWidth` promises, a frame of exactly
the window with the journal newest-first, the board whole in a window too short with its
counts under it, the blank between the state and the board given up first, the pager turning
one page per key with a footer the window can read, and the screen escapes only being sent in
a terminal), and the `serve` command of the CLI started as a child process).

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

### What each variant implements

Every flag in `src/rules/variants.js` is a rule the sources state, and `npm test` pins the
ones that are easy to get wrong. The rule numbers below are the articles of the collected
texts at tafl.cyningstan.com (the 13 tablut and 13 Copenhagen articles, the 12 brandub and
12 alea rules), aagenielsen.dk and hnefatafl.org.

- **`tablut`** (Linnaeus, *Lachesis Lapponica*, 1732). One castle: the throne in the middle
  of the 9×9 board. Nobody may land on it, and the king is barred from every castle, the
  throne included (rule 5), so a king who leaves it never returns. The empty throne is a
  captor: the text calls it the castle of the attackers, and the engine lets it serve both
  sides, as the modern rule sets do. The king escapes to any edge square, the corners
  included, and is taken by two attackers in the open field — the sources are read two ways
  here, and the variant file names the reading it implements.
- **`copenhagen`** (the 13 Copenhagen articles, aagenielsen.dk, tafl.cyningstan.com).
  Throne and the four corners are the marked squares (rule 3); the corners alone are the
  exits (rule 9). The edge is not hostile (rule 5), so a man pressed against it by one
  enemy survives, and the shield wall of rule 7 is the capture at the edge instead: a line
  of two or more enemy men along an edge line, walled in at one end, falls when the man
  that just moved brackets the other end and presses every man of the line from the inside.
  The king may move onto the marked squares (rule 1) and go back onto his throne (rule 8),
  and no other man may. He needs four attackers (rule 4), and three next to the throne, the
  empty throne standing for the fourth man. The attackers also win by sealing the king and
  his host in (rule 12), and by the move limit: 100 / 140 / 160 moves on the 7 / 11 / 13
  boards, after which the attackers win (rule 13). A defender with no legal move loses.
- **`brandub`** (the 12 rules drawn from the Irish poems *Ard Rí* and *Branán*). The centre
  and the four corners are marked squares (rule 3) that capture for both sides (rule 9), the
  king starts on the centre, the corners are his exits. Two attackers take the king. The
  army — king + 4 against 8 — is the balanced reconstruction, not the poem's number.
- **`ard-ri`**: the same poems, the 7×7 board, king + 8 against 16, escape to the edge, no
  marked squares. The setup is a reconstruction.
- **`alea evangelii`** (Cambridge, CCC MS 122, c. 1140; the twelve rules beside the diagram,
  as edited by D. Walker). The citadel in the middle, the four marked 2×2 blocks in the
  corners — 16 squares — are the exits, the marked squares capture for both sides, the edge
  is a captor, and the king needs four attackers, three next to the citadel, two in the open
  field. The starting colours are a documented reconstruction.
- **`tawlbwrdd`** (the 11×11 Welsh game). The throne is the castle, the edge is a captor,
  the king escapes to the edge. The setup is a reconstruction.

Three rules of the texts are deliberately **not** implemented, because no source gives a
rule that can be played:

- Copenhagen rule 11, the exit fort: the modern rule sets name a square where the king is
  safe and the defenders win, and give no rule text for it at all, so the win is not
  reachable. The siege win of rule 12 is implemented, and it is the attacker's version of
  the same idea.
- Copenhagen rule 10, "the same position must not be repeated forever": the text names the
  ban and never says what happens, so a repeated position stays a draw, as everywhere else.
- The tablut *raichi* warning — the attackers announce that the king can no longer be
  taken, and the king's side then gives up — is a spoken notice between players in
  Linnaeus' account, not a rule the engine can enforce, so it is not one.

The alea evangelii is played as the sources describe it, and it is imbalanced: self-play at
120 ms a move sees the attackers take the king in every game of the four seeds tested, in 17
to 65 plies. The manuscript's own marginal note complains about the same thing, and modern
reconstructions are known to favour the attackers — the defenders start boxed in around a
citadel they may not use.

## Roadmap

- Copenhagen rule 11 names an exit fort where the king is safe and the defenders win, and
  the modern rule sets never give rule text for it: the win stays unimplemented until a
  source describes the square.
- Copenhagen rule 10 bans repeating the same position for ever and never says what follows,
  and the tablut *raichi* warning ("the king can no longer be taken") is a spoken notice:
  neither is a rule the engine enforces.
- `ard-ri` has 7×7 armies, and 7×7 boards only carry 8 attackers in the symmetric
  generator: the setup for that variant is a documented reconstruction, not a source.

## License

ISC — see `LICENSE`.
