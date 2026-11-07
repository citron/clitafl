'use strict';

/* The web client for the clitafl API. No build step, no framework: the page is
 * the state the server sends, and every control is one HTTP call. */

const api = {
  async call(path, options = {}) {
    const init = { method: options.method || 'GET', headers: {} };
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error((data && data.error) || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  },
  get: (path) => api.call(path),
  post: (path, body = {}) => api.call(path, { method: 'POST', body }),
  del: (path) => api.call(path, { method: 'DELETE' }),
};

const $ = (id) => document.getElementById(id);

const state = {
  variants: [],
  levels: [],
  sizes: { min: 7, max: 19, odd: true },
  game: null,
  selected: null,
  movesOfSelected: [],
  hint: null,
  busy: false,
};

const elements = {};

function cacheElements() {
  [
    'variant', 'size', 'seat-a', 'seat-d', 'level-a', 'level-d', 'time',
    'board', 'turn', 'counts', 'status', 'variant-name', 'message', 'history',
    'btn-new', 'btn-swap', 'btn-hint', 'btn-ai', 'btn-undo', 'btn-resign', 'btn-export',
    'btn-refresh', 'btn-games', 'btn-copy', 'games', 'rules-text', 'rules-title',
    'meta-id', 'meta-ply', 'meta-moves', 'meta-ai', 'levels-note', 'version',
    'cmd-create', 'cmd-state', 'cmd-move', 'cmd-index',
  ].forEach((id) => { elements[id] = $(id); });
}

function setMessage(text, kind = '') {
  elements.message.textContent = text || '';
  elements.message.className = `message${kind ? ` ${kind}` : ''}`;
}

function origin() { return location.origin; }

function settings() {
  return {
    variant: elements.variant.value,
    size: Number(elements.size.value),
    seats: { attacker: elements['seat-a'].value, defender: elements['seat-d'].value },
    levels: { attacker: elements['level-a'].value, defender: elements['level-d'].value },
    time_ms: Number(elements.time.value),
  };
}

/* ---------- setup: variants, sizes, levels ---------- */

async function loadSetup() {
  const [variantData, levelData, health] = await Promise.all([
    api.get('/api/variants'),
    api.get('/api/levels'),
    api.get('/api/health'),
  ]);
  state.variants = variantData.variants;
  state.levels = levelData.levels;
  if (variantData.sizes) state.sizes = variantData.sizes;

  elements.variant.innerHTML = state.variants
    .map((v) => `<option value="${v.id}">${v.name} · ${v.size}×${v.size}</option>`)
    .join('');
  elements['level-a'].innerHTML = levelOptions();
  elements['level-d'].innerHTML = levelOptions();
  elements['level-d'].value = 'medium';
  elements['levels-note'].textContent = state.levels
    .map((l) => `${l.id}: depth ${l.depth}, ${l.play}`)
    .join(' · ');
  elements.version.textContent = `v${health.version}, engine: ${health.engine}`;

  elements.variant.value = 'tablut';
  onVariantChange();
}

function levelOptions() {
  return state.levels
    .map((l) => `<option value="${l.id}">${l.id} — ${l.label}</option>`)
    .join('');
}

function sizesFor(variant) {
  const sizes = [];
  for (let size = state.sizes.min; size <= state.sizes.max; size += 2) sizes.push(size);
  return sizes.map((size) => `<option value="${size}"${size === variant.size ? ' selected' : ''}>`
    + `${size}×${size}${size === variant.size ? ' — historical' : ''}</option>`)
    .join('');
}

function onVariantChange() {
  const variant = state.variants.find((v) => v.id === elements.variant.value);
  if (!variant) return;
  elements.size.innerHTML = sizesFor(variant);
  loadRules(variant.id);
}

async function loadRules(id) {
  try {
    const data = await api.get(`/api/variants/${id}`);
    elements['rules-title'].textContent = `${data.variant.name} — rules`;
    elements['rules-text'].textContent = data.rules_text;
  } catch (error) {
    elements['rules-text'].textContent = error.message;
  }
}

/* ---------- board rendering ---------- */

function boardElement() { return elements.board; }

function squareOfIndex(size, r, c) {
  return `${'abcdefghijklmnopqrstuvwxyz'[c]}${size - r}`;
}

function indexOfSquare(size, square, files) {
  const file = square[0].toLowerCase();
  const rank = Number(square.slice(1));
  const c = files.indexOf(file);
  if (c < 0 || !Number.isInteger(rank) || rank < 1 || rank > size) return null;
  return { r: size - rank, c };
}

/** `d5xe5` -> ['d5','e5'], so the last move can be highlighted. */
function splitSan(san) {
  const parts = san.split(/[x-]/);
  return parts.length === 2 ? parts : [null, null];
}

function rowsOf(game) { return game.board.rows; }

function renderBoard() {
  const game = state.game;
  if (!game) return;
  const size = game.board.size;
  const castles = new Set(game.board.castles);
  const throne = new Set(game.board.throne);
  const escapes = new Set(game.board.escapes);
  const last = game.last_move;
  const legalTargets = new Map(state.movesOfSelected.map((m) => [m.to, m]));
  const playable = !game.is_over && state.selected;

  const board = boardElement();
  board.style.setProperty('--n', size);
  board.style.setProperty('--sq', `${Math.max(26, Math.min(64, Math.round(560 / size)))}px`);
  board.textContent = '';

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const square = squareOfIndex(size, r, c);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'sq';
      cell.dataset.square = square;
      if ((r + c) % 2 === 1) cell.classList.add('dark');
      if (castles.has(square)) cell.classList.add('castle');
      if (throne.has(square)) cell.classList.add('throne');
      if (escapes.has(square)) cell.classList.add('escape');

      const mark = throne.has(square) ? '★' : escapes.has(square) ? '○' : castles.has(square) ? '✦' : '';
      if (mark) {
        const span = document.createElement('span');
        span.className = 'mark';
        span.textContent = mark;
        cell.appendChild(span);
      }

      const glyph = rowsOf(game)[r][c];
      const piece = pieceElement(glyph);
      if (piece) cell.appendChild(piece);
      if (last && last.san) {
        const [from, to] = splitSan(last.san);
        if (from === square) cell.classList.add('last-from');
        if (to === square) cell.classList.add('last-to');
      }

      if (legalTargets.has(square)) {
        cell.dataset.legal = legalTargets.get(square).san;
        if (isCaptureSquare(game, square)) cell.classList.add('capture');
      }
      if (state.selected === square) cell.classList.add('selected');
      if (playable && !legalTargets.has(square) && glyph !== '.') cell.classList.add('selectable');
      if (state.hint && (state.hint.from === square || state.hint.to === square)) cell.classList.add('hint');

      cell.setAttribute('aria-label', describeSquare(game, square, glyph));
      board.appendChild(cell);
    }
  }
}

function isCaptureSquare(game, square) {
  const size = game.board.size;
  const at = indexOfSquare(size, square, game.board.files);
  return at && rowsOf(game)[at.r][at.c] !== '.';
}

function pieceElement(glyph) {
  const kinds = { A: 'attacker', D: 'defender', K: 'king' };
  const kind = kinds[glyph];
  if (!kind) return null;
  const piece = document.createElement('span');
  piece.className = `piece ${kind}`;
  piece.textContent = kind === 'king' ? '♛' : kind === 'attacker' ? '⚔' : '◎';
  return piece;
}

function describeSquare(game, square, glyph) {
  const names = { A: 'attacker', D: 'defender', K: 'king' };
  const special = [
    game.board.castles.includes(square) ? 'castle' : '',
    game.board.throne.includes(square) ? 'throne' : '',
    game.board.escapes.includes(square) ? 'escape square' : '',
  ].filter(Boolean).join(', ');
  return `${square}: ${names[glyph] || 'empty square'}${special ? ` on the ${special}` : ''}`;
}

function renderStatus() {
  const game = state.game;
  if (!game) return;
  const size = game.board.size;
  elements['variant-name'].textContent = `${game.variant.name} ${size}×${size}`;
  elements.turn.textContent = game.is_over ? '' : `${game.turn} to move`;
  const counts = game.board.counts;
  elements.counts.textContent = `attackers ${counts.attackers} · defenders ${counts.defenders}${counts.king ? ' + king' : ' · king down'}`;
  const status = elements.status;
  status.className = `status${game.is_over ? ' over' : ''}`;
  status.textContent = game.is_over
    ? `${game.winner ? `${game.winner} win` : 'draw'} — ${game.reason}`
    : `ply ${game.ply} / ${game.variant.max_plies || '∞'}`;

  elements['meta-id'].textContent = game.id;
  elements['meta-ply'].textContent = `${game.ply} (${game.moves_played} in the record)`;
  elements['meta-moves'].textContent = `${game.legal_move_count}`;
  const ai = game.last_ai;
  elements['meta-ai'].textContent = ai
    ? `${ai.san || '—'} · ${ai.level} depth ${ai.depth}, ${ai.nodes} nodes`
    : '—';

  elements['btn-ai'].disabled = game.is_over || !(game.seats.attacker === 'ai' || game.seats.defender === 'ai');
  elements['btn-resign'].disabled = game.is_over;
  elements['btn-hint'].disabled = game.is_over;
  elements['btn-undo'].disabled = game.ply === 0;
}

function renderHistory() {
  const game = state.game;
  if (!game) return;
  elements.history.innerHTML = game.history
    .map((entry) => `<li class="${entry.side}${entry.captured.length ? ' takes' : ''}">`
      + `<strong>${String(entry.ply).padStart(2, '0')} ${entry.side[0].toUpperCase()}</strong> ${entry.san}`
      + (entry.captured.length ? ` ×${entry.captured.length}` : '')
      + '</li>')
    .join('');
  elements.history.scrollTop = elements.history.scrollHeight;
}

function renderCommands() {
  const base = origin();
  const spec = settings();
  const id = state.game ? state.game.id : '<id>';
  const legal = state.game && state.game.legal_moves.length ? state.game.legal_moves[0] : { from: 'd5', to: 'd4' };
  const body = JSON.stringify({
    variant: spec.variant,
    size: spec.size,
    seats: spec.seats,
    levels: spec.levels,
    time_ms: spec.time_ms,
  });
  elements['cmd-create'].value = `curl -s ${base}/api/games -X POST -H 'content-type: application/json' \\\n  -d '${body}'`;
  elements['cmd-state'].value = `curl -s ${base}/api/games/${id}`;
  elements['cmd-move'].value = `curl -s ${base}/api/games/${id}/moves -X POST -H 'content-type: application/json' \\\n  -d '{"from":"${legal.from}","to":"${legal.to}"}'`;
  elements['cmd-index'].value = `curl -s ${base}/api`;
}

function render() {
  renderBoard();
  renderStatus();
  renderHistory();
  renderCommands();
}

/* ---------- playing ---------- */

function setGame(game) {
  state.game = game;
  state.selected = null;
  state.movesOfSelected = [];
  state.hint = null;
  render();
}

function seatOfTurn() {
  const game = state.game;
  return game ? game.seats[game.turn] : null;
}

async function newGame() {
  const current = state.game;
  const spec = settings();
  if (current && !current.is_over) {
    await api.del(`/api/games/${current.id}`).catch(() => {});
  }
  const data = await api.post('/api/games', spec);
  setGame(data.game);
  describePlayed(data.played, `a game opens: ${spec.variant} ${spec.size}×${spec.size}`);
  refreshGames();
}

async function playMove(from, to) {
  const data = await api.post(`/api/games/${state.game.id}/moves`, { from, to });
  setGame(data.game);
  describePlayed(data.played);
}

function describePlayed(played, intro = '') {
  const parts = (played || []).map((ply) => `${ply.side} ${ply.san}${ply.captured.length ? ` takes ${ply.captured.length}` : ''}`);
  const lines = [intro, parts.join(' · ')].filter(Boolean);
  const game = state.game;
  const tail = game && game.is_over ? ` — ${game.winner ? `${game.winner} win` : 'draw'}: ${game.reason}` : '';
  setMessage(`${lines.join(' · ')}${tail}`, game && game.is_over ? 'ok' : '');
}

async function onSquareClick(square) {
  const game = state.game;
  if (!game) return;
  if (game.is_over) {
    setMessage(`the game is over: ${game.winner ? `${game.winner} win` : 'draw'} — ${game.reason}`, 'ok');
    return;
  }
  const seat = seatOfTurn();
  if (seat === 'ai') {
    setMessage(`the ${game.turn} seat is played by the AI (${game.levels[game.turn]}): press “AI moves”, or take the seat over under “new game”`);
    return;
  }
  const size = game.board.size;
  const at = indexOfSquare(size, square, game.board.files);
  const glyph = rowsOf(game)[at.r][at.c];

  const target = state.movesOfSelected.find((m) => m.to === square);
  if (target) {
    await playMove(state.selected, square);
    return;
  }
  if (glyph === '.') {
    state.selected = null;
    state.movesOfSelected = [];
    renderBoard();
    setMessage('');
    return;
  }
  const mine = { K: 'defender', D: 'defender', A: 'attacker' }[glyph];
  if (mine !== game.turn) {
    setMessage(`that is a ${mine} piece and it is the ${game.turn} to move`);
    return;
  }
  state.selected = square;
  state.movesOfSelected = game.legal_moves.filter((m) => m.from === square);
  state.hint = null;
  renderBoard();
  setMessage(state.movesOfSelected.length
    ? `${square}: ${state.movesOfSelected.map((m) => m.to).join(' ')} — click a square to move`
    : `${square} has no legal move`);
}

/* ---------- actions ---------- */

async function act(label, fn) {
  if (state.busy) return;
  state.busy = true;
  const buttons = document.querySelectorAll('.actions button');
  buttons.forEach((button) => { button.disabled = true; });
  setMessage(label);
  try {
    await fn();
  } catch (error) {
    setMessage(error.message, 'bad');
  } finally {
    state.busy = false;
    buttons.forEach((button) => { button.disabled = false; });
    renderStatus();
  }
}

async function refreshState() {
  const data = await api.get(`/api/games/${state.game.id}`);
  setGame(data.game);
  setMessage('state reloaded from the server');
}

async function hint() {
  const data = await api.post(`/api/games/${state.game.id}/hint`, { time_ms: Math.max(200, Number(elements.time.value)) });
  if (!data.hint) {
    setMessage(data.reason, 'bad');
    return;
  }
  state.hint = data.hint;
  renderBoard();
  setMessage(`hint ${data.hint.san} — ${data.hint.level}, depth ${data.hint.depth}, ${data.hint.nodes} nodes, score ${data.hint.score}`);
}

async function aiMoves() {
  const data = await api.post(`/api/games/${state.game.id}/ai`, { moves: 'all' });
  setGame(data.game);
  describePlayed(data.played, 'the AI plays');
}

async function undo() {
  const data = await api.post(`/api/games/${state.game.id}/undo`, { plies: 1 });
  setGame(data.game);
  setMessage(`ply ${data.undone} taken back`, 'ok');
}

async function resign() {
  const data = await api.post(`/api/games/${state.game.id}/resign`, {});
  setGame(data.game);
  describePlayed([], `${data.game.turn} resigns`);
}

async function exportGame() {
  const save = await api.get(`/api/games/${state.game.id}/export`);
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `clitafl-${state.game.id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  setMessage(`save file ${link.download} downloaded: resume it with POST /api/games {"load": …}`, 'ok');
}

async function refreshGames() {
  const data = await api.get('/api/games?include=closed');
  const list = data.games.map((row) => {
    const label = `${row.variant} ${row.size}×${row.size} · ply ${row.ply} · ${row.status}`;
    const current = state.game && state.game.id === row.id;
    return `<li>${current ? '<strong>' : ''}<button type="button" data-id="${row.id}">${row.id}</button> `
      + `<span class="${row.winner ? 'over' : ''}">${label}</span>${current ? '</strong>' : ''}</li>`;
  }).join('');
  elements.games.innerHTML = list || '<li class="games-empty">no game open on this server</li>';
}

async function openGame(id) {
  const data = await api.get(`/api/games/${id}`);
  setGame(data.game);
  describePlayed([], `game ${id} loaded: ${data.game.variant.name}`);
}

function swapSeats() {
  const a = elements['seat-a'].value;
  const la = elements['level-a'].value;
  elements['seat-a'].value = elements['seat-d'].value;
  elements['level-a'].value = elements['level-d'].value;
  elements['seat-d'].value = a;
  elements['level-d'].value = la;
  setMessage('seats swapped: press “new game” to start with them');
}

/* ---------- wiring ---------- */

function wire() {
  elements.board.addEventListener('click', (event) => {
    const cell = event.target.closest('.sq');
    if (!cell) return;
    act('…', () => onSquareClick(cell.dataset.square));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected) {
      state.selected = null;
      state.movesOfSelected = [];
      renderBoard();
      setMessage('');
    }
  });

  elements.variant.addEventListener('change', onVariantChange);
  elements['btn-new'].addEventListener('click', () => act('opening a game…', newGame));
  elements['btn-swap'].addEventListener('click', swapSeats);
  elements['btn-hint'].addEventListener('click', () => act('the AI is thinking…', hint));
  elements['btn-ai'].addEventListener('click', () => act('the AI is thinking…', aiMoves));
  elements['btn-undo'].addEventListener('click', () => act('taking a ply back…', undo));
  elements['btn-resign'].addEventListener('click', () => act('resigning…', resign));
  elements['btn-export'].addEventListener('click', () => act('writing the save file…', exportGame));
  elements['btn-refresh'].addEventListener('click', () => act('reloading…', refreshState));
  elements['btn-games'].addEventListener('click', () => act('reloading the game list…', refreshGames));
  elements.games.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (button) act('loading that game…', () => openGame(button.dataset.id));
  });
  elements['btn-copy'].addEventListener('click', async () => {
    const areas = [elements['cmd-create'], elements['cmd-state'], elements['cmd-move']];
    const text = areas.map((area) => area.value).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setMessage('the three commands are on your clipboard', 'ok');
    } catch {
      setMessage('select a box and copy by hand (the browser blocked the clipboard)', 'bad');
    }
  });
}

async function boot() {
  cacheElements();
  wire();
  try {
    await loadSetup();
    await newGame();
  } catch (error) {
    setMessage(`cannot reach the clitafl API: ${error.message}`, 'bad');
  }
}

boot();
