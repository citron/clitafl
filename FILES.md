# Files

## `src/rules/` — the engine (no I/O, no colours)

- **pieces.js** — piece codes (`KING`, `DEFENDER`, `ATTACKER`, `EMPTY`) and side codes; the
  vocabulary every other module uses. ASCII codes only, never emoji.
- **variants.js** — the five rule sets as data: escape target, castle layout, king-capture
  counts, first mover, edge shield, siege win, no-move and repetition rules, ply limit, plus
  `buildSetup`/`armyOf`, the symmetric position generator that makes `--size` work.
- **board.js** — the grid, geometry (`rowOf`, `idx`), rook movement, castle and throne
  rules, custodian capture (soldiers, king counts, edge), the siege flood fill,
  `applyMove`/`undoMove` as exact inverses, serialisation.
- **game.js** — the state machine: turns, `play`, victory and draw detection in a fixed
  order (king capture → escape → siege → no legal move → repetition → ply limit), `undo`,
  `serialize`/`deserialize`.
- **notation.js** — `d5-d6` in and out, tolerant of the ways players type it.

## `src/ai/`

- **evaluate.js** — static evaluation from the defender's point of view: material, king
  mobility, escape distance, open lines to the escape, freedom of each army, pressure on
  the king.
- **search.js** — negamax with alpha-beta, iterative deepening, move ordering, a wall-clock
  budget, `winsImmediately` for king captures and escapes. The board is mutated and
  restored in place.
- **player.js** — `AIPlayer` and the four strength presets (`easy`, `medium`, `hard`,
  `grandmaster`), each with a depth ceiling, a time budget and how far from the best move
  its play is allowed to wander.

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
- **board.test.js** — 18 tests: the historical armies, castle and escape geometry,
  movement, capture counts, edge rules, apply/undo, serialisation, the siege sealing.
- **game.test.js** — 14 tests: first mover, escapes, king capture, illegal moves, the
  siege, no-legal-move rules, repetition, ply limit, undo, save round-trips.
- **notation.test.js** — 6 tests: squares, every spelling of a move, large boards, errors.
- **ai.test.js** — 10 tests: level presets, mate in one, taking the escape, legality in
  every variant, time budget, depth monotonicity, seeded reproducibility.
- **display.test.js** — 12 tests: the board frame, file letters aligned on their column at
  every size, glyphs, `--ascii`, colour on/off, legend counts, status, outcome, banner,
  animation safety, the command list.
- **headless.test.js** — 8 tests: seeded RNG, full games per variant, record shape,
  determinism, mixed strengths, custom sizes, progress.
- **cli.test.js** — 16 tests: flag parsing, seats, per-side levels, help text, and the real
  commands run in a child process (`variants`, `rules`, `--version`, bad command, `match`,
  `--record`, scripted games, `--load`, `serve` flag checks and its banner).
- **net.test.js** — 20 tests: the API as a function — the endpoint index, the catalogues,
  opening a game, the move view (`from,to,piece,san`, the king named as such),
  `moves=turn|none|all`, an exchange with the AI answering, every way to
  send a move, every bad input, refusals (`409`), the AI seat playing n plies or all,
  hints, undo, resign, seats, the record, the rules text, the save round-trip, the game
  list, `max_games`, the TTL, unknown routes and verbs.
- **server.test.js** — 10 tests: over a real socket — the page, CSS and JS, HEAD, traversal
  probes, JSON over HTTP, CORS preflight, broken JSON, missing files, `405`, the body cap,
  the game cap, `serve` on a free port, and the `serve` command of the CLI as a child
  process, played over HTTP and stopped with SIGTERM.

## Docs

`README.md` (the game, the variants, the flags, the web board, the API, the AI),
`QUICKSTART.md`, `FILES.md` (this file), `PROJECT_SUMMARY.md`, `LICENSE`.
