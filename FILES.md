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

## Top level

- **headless.js** — `playMatch` (AI vs AI, no terminal, seeded RNG), `formatMatch`, used by
  `demo`, `match` and the tests.
- **index.js** — the command line: `play`, `demo`, `match`, `variants`, `rules`, `help`,
  the flag table, exit codes 0/1/2.

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
- **cli.test.js** — 15 tests: flag parsing, seats, per-side levels, help text, and the real
  commands run in a child process (`variants`, `rules`, `--version`, bad command, `match`,
  `--record`, scripted games, `--load`).

## Docs

`README.md` (the game, the variants, the flags, the AI), `QUICKSTART.md`, `FILES.md` (this
file), `PROJECT_SUMMARY.md`, `LICENSE`.
