# Files

## `src/rules/` — the engine (no I/O, no colours)

- **pieces.js** — piece codes (`KING`, `DEFENDER`, `ATTACKER`, `EMPTY`) and side codes; the
  vocabulary every other module uses. ASCII codes only, never emoji.
- **variants.js** — the six rule sets as data: escape target (`edge`, `corner`, the marked
  `cornerblock` of alea evangelii), castle layout, king-capture counts (open field / beside
  a castle / on a castle), who may land on a castle, first mover, edge shield, edge
  capture, siege win, no-move and repetition rules, ply limit, plus `buildSetup`/`armyOf`,
  the symmetric position generator that makes `--size` work.
- **board.js** — the grid, geometry (`rowOf`, `idx`), rook movement, castle and throne
  rules, king-only escape squares, custodian capture (soldiers, king counts, castle and
  edge shields), the siege flood fill, `applyMove`/`undoMove` as exact inverses — the
  king's escape settles before a capture can — serialisation.
- **game.js** — the state machine: turns, `play`, victory and draw detection in a fixed
  order (king capture → escape → siege → no legal move → repetition → ply limit), `undo`,
  `serialize`/`deserialize`.
- **notation.js** — `d5-d6` in and out, tolerant of the ways players type it.

## `src/ai/`

- **evaluate.js** — static evaluation from the defender's point of view: material, king
  mobility, escape distance (edges, corners, the marked 2×2 blocks), open lines to the
  escape, freedom of each army, space per man, pressure on the king.
- **zobrist.js** — the deterministic piece-square hash table (a seeded generator, so every
  run builds the same table), `hashBoard`, `applyKey` to update a key in place across a
  move with its captures, and `geometryId` for the opening book keys.
- **search.js** — negamax with alpha-beta, iterative deepening, a transposition table
  (ply-relative mate scores, replace-if-deeper), killer moves, a capture-only quiescence
  search, and a budget in milliseconds *or in nodes*: with `maxNodes` the clock is never
  read, so a search is reproducible. Only a complete deepening pass re-orders the root and
  becomes the answer. `winsImmediately` for king captures and escapes. The board is mutated
  and restored in place.
- **book.js** — the opening book (`clitafl-book-v1`, `book.json`): prepared positions keyed
  by rules, side to move and board, max three moves each, checked against the legal moves
  before one is played. A missing book is not an error — the level just searches.
- **player.js** — `AIPlayer` and the four strength presets (`easy`, `medium`, `hard`,
  `grandmaster`), each with a depth ceiling, a time budget, how far from the best move its
  play is allowed to wander, its own transposition table, `maxNodes`, and the book hook
  (`book: false` / `bookData` to say otherwise).

## `src/ui/`

- **ansi.js** — terminal control built from escape sequences: colour (off for `NO_COLOR`,
  `--no-color`, `TERM=dumb`, non-TTY), cursor, alt screen, clear, `sleep`.
- **display.js** — board rendering with a coordinate frame, unicode or `--ascii` glyphs,
  legend, status lines, banner, rules text, help text, the per-square move animation
  (drawn on a copy of the board).

## `src/cli/`

- **controller.js** — one session: seats (human or AI per side), the turn loop, in-game
  commands (`help`, `board`, `moves`, `history`, `hint`, `undo`, `rules`, `save`,
  `resign`, `quit`), scripted games from `--moves`, records from `--record`, signal
  handlers that always restore the terminal.

## `src/net/` — the web server and the API (no framework)

- **errors.js** — `ApiError` plus the status helpers (`400`, `404`, `405` with an `allow`
  list, `409`, `413`): a failure is one readable sentence, never a stack trace.
- **state.js** — the public JSON view of a session: `gameView` (turn, seats, levels,
  clocks, counts, last move, record), `boardView` (rows, castles, throne, escapes),
  `variantView`, `plyView`, `levelsView`, and `rulesText` — the CLI renderer with the
  colours off.
- **store.js** — the open games: ids, seats (`human | ai | agent`), levels and per-seat
  clocks, `playAiPly`/`playAiSeats`, touch/TTL sweep, `maxGames` cap, seed and ply-limit
  overrides, resume from a save file.
- **api.js** — the route table and the handlers. `GET /api` describes every endpoint as
  data, so a client can discover the game without reading a manual.
- **server.js** — `node:http`: `/api/*` to the API, everything else as files from `web/`
  (resolve-then-check traversal guard), CORS, `OPTIONS`, a 1 MiB body cap, HEAD, JSON
  errors, `serve` that reports the address it bound.

## Top level

- **headless.js** — `playMatch` (AI vs AI, no terminal, seeded RNG), `formatMatch`, used by
  `demo`, `match` and the tests.
- **index.js** — the command line: `play`, `demo`, `match`, `serve`, `variants`, `rules`,
  `help`, the flag table, exit codes 0/1/2.

## `tools/`

- **make-book.js** — `node tools/make-book.js [--games n] [--plies n] [--nodes n] [--out f]`
  regenerates `src/ai/book.json` from seeded self-play of the strong levels: fixed seeds and
  a node budget, so the same run records the same positions.

## `web/` — the browser client (no build step)

- **index.html** — board panel, setup card (variant, size, seat, level, thinking time),
  this-game card, the agent card with the `curl` commands of the current game, the rules,
  the list of open games.
- **style.css** — the theme: a wooden board, round pieces, castle/throne/escape marks,
  hint and last-move highlights, a responsive two-column layout.
- **app.js** — one `fetch` per action: it renders exactly what the API sends, clicks
  squares into moves from `legal_moves`, and never invents a rule of its own.

## `tests/` — `node:test`, run with `npm test`

- **helpers.js** — builds a board from ASCII rows (`makeBoard`), plus `idx` and `move`.
- **board.test.js** — 24 tests: the historical armies, castle and escape geometry,
  movement, capture counts, edge rules, apply/undo, serialisation, the siege sealing, and
  the alea evangelii geometry: its army and symmetry, the 16 exits with king-only entry, the
  citadel off limits to everyone and passable when empty, the 4/3/2 king capture, marked
  squares and the edge capturing soldiers, and the escape settling before a capture.
- **game.test.js** — 14 tests: first mover, escapes, king capture, illegal moves, the
  siege, no-legal-move rules, repetition, ply limit, undo, save round-trips.
- **notation.test.js** — 6 tests: squares, every spelling of a move, large boards, errors.
- **ai.test.js** — 15 tests: level presets, mate in one, taking the escape, legality in
  every variant, time budget, depth monotonicity, seeded reproducibility, the capture
  prediction matching the board for every legal move, quiescence following only the moves
  that take a piece, the Zobrist key tracking a 40-ply game, a node budget giving the same
  move and score with the table keeping what it learned, and the opening book offering
  legal prepared openings.
- **display.test.js** — 13 tests: the board frame, file letters aligned on their column at
  every size, glyphs, `--ascii`, colour on/off, legend counts, status, outcome, banner,
  animation safety, the command list, and the rules text of tablut and of alea evangelii.
- **headless.test.js** — 8 tests: seeded RNG, full games per variant, record shape,
  determinism on a node budget, mixed strengths, custom sizes, progress.
- **cli.test.js** — 17 tests: flag parsing, seats, per-side levels, help text, and the real
  commands run in a child process (`variants`, `rules` for copenhagen, brandub and alea,
  `--version`, bad command, `match`, `--record`, scripted games, `--load`, `serve` flag
  checks and its banner).
- **net.test.js** — 21 tests: the API as a function — the endpoint index, the catalogues
  (including a 19×19 alea evangelii game with its 16 exits and citadel), opening a game,
  the move view (`from,to,piece,san`, the king named as such), `moves=turn|none|all`, an
  exchange with the AI answering, every way to send a move, every bad input, refusals
  (`409`), the AI seat playing n plies or all, hints, undo, resign, seats, the record, the
  rules text, the save round-trip, the game list, `max_games`, the TTL, unknown routes and
  verbs.
- **server.test.js** — 10 tests: over a real socket — the page, CSS and JS, HEAD, traversal
  probes, JSON over HTTP, CORS preflight, broken JSON, missing files, `405`, the body cap,
  the game cap, `serve` on a free port, and the `serve` command of the CLI as a child
  process, played over HTTP and stopped with SIGTERM.

## Docs

`README.md` (the game, the variants, the flags, the web board, the API, the AI),
`QUICKSTART.md`, `FILES.md` (this file), `PROJECT_SUMMARY.md`, `LICENSE`.
