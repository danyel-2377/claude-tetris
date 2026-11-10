'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

let COLORS = [ // reassigned by applySkin(); this literal is the retro palette
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = gameStartLevel + Math.floor(lines / 10);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  hsTrackCombo(cleared);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// ---- Skins ----
// Each skin provides its palette (indexed like COLORS), the canvas background,
// the grid line color and a block renderer working in pixel coordinates.

function drawRetroBlock(context, px, py, size, color, alpha) {
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(px + 1, py + 1, size - 2, 4);
}

function drawNeonBlock(context, px, py, size, color, alpha) {
  const inset = 3;
  context.shadowColor = color;
  context.shadowBlur = size * 0.5;
  // translucent core
  context.globalAlpha = alpha * 0.3;
  context.fillStyle = color;
  context.fillRect(px + inset, py + inset, size - inset * 2, size - inset * 2);
  // glowing outline
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(px + inset, py + inset, size - inset * 2, size - inset * 2);
}

function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, r);
    return;
  }
  // Fallback for browsers without CanvasRenderingContext2D.roundRect
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawPastelBlock(context, px, py, size, color, alpha) {
  const inset = 2;
  const s = size - inset * 2;
  context.globalAlpha = alpha;
  context.fillStyle = color;
  roundRectPath(context, px + inset, py + inset, s, s, size * 0.25);
  context.fill();
  // soft top highlight
  context.fillStyle = 'rgba(255,255,255,0.3)';
  roundRectPath(context, px + inset + 3, py + inset + 2, s - 6, s * 0.3, size * 0.12);
  context.fill();
}

function drawPixelBlock(context, px, py, size, color, alpha) {
  // 5x5 sub-pixel grid; integer coordinates keep the texture crisp.
  const u = Math.floor(size / 5);
  const x = Math.round(px), y = Math.round(py);
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(x, y, size, size);
  // light bevel: top row and left column
  context.fillStyle = 'rgba(255,255,255,0.45)';
  context.fillRect(x, y, size - u, u);
  context.fillRect(x, y + u, u, size - 2 * u);
  // dark bevel: bottom row and right column
  context.fillStyle = 'rgba(0,0,0,0.4)';
  context.fillRect(x + u, y + size - u, size - u, u);
  context.fillRect(x + size - u, y, u, size - u);
  // sparkle pixel
  context.fillStyle = 'rgba(255,255,255,0.7)';
  context.fillRect(x + u, y + u, u, u);
  // dithered shade pixels near the bottom-right
  context.fillStyle = 'rgba(0,0,0,0.2)';
  context.fillRect(x + 3 * u, y + 2 * u, u, u);
  context.fillRect(x + 2 * u, y + 3 * u, u, u);
}

const SKINS = {
  retro: {
    colors: COLORS.slice(),
    bg: '#1a1a25',
    grid: '#22222e',
    drawBlock: drawRetroBlock,
  },
  neon: {
    colors: [null, '#00f0ff', '#fff200', '#ff00e6', '#39ff14', '#ff073a', '#3d5afe', '#ff9100'],
    bg: '#000000',
    grid: '#0f0f1f',
    drawBlock: drawNeonBlock,
  },
  pastel: {
    colors: [null, '#a0e7e5', '#fdf2a6', '#d7b9f0', '#b4f8c8', '#ffaebc', '#b5c7f7', '#ffd3a5'],
    bg: '#2c2a3c',
    grid: '#37354a',
    drawBlock: drawPastelBlock,
  },
  pixel: {
    colors: [null, '#3cbcfc', '#f8b800', '#b853f8', '#58d854', '#f83800', '#0058f8', '#fc7460'],
    bg: '#0c0c14',
    grid: '#181826',
    drawBlock: drawPixelBlock,
  },
};
const DEFAULT_SKIN = 'retro';
const SKIN_STORAGE_KEY = 'tetris.skin';
const skinSelect = document.getElementById('skin-select');
let skin = SKINS[DEFAULT_SKIN];

function isSkinName(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SKINS, name);
}

function loadSkinName() {
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    return isSkinName(stored) ? stored : DEFAULT_SKIN;
  } catch (err) {
    return DEFAULT_SKIN;
  }
}

function saveSkinName(name) {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, name);
  } catch (err) {
    // storage unavailable (private mode, file:// restrictions): keep it in memory only
  }
}

function applySkin(name) {
  if (!isSkinName(name)) name = DEFAULT_SKIN;
  skin = SKINS[name];
  COLORS = skin.colors;
  document.body.dataset.skin = name;
  if (skinSelect) skinSelect.value = name;
  // Redraw immediately: the rAF loop is not running while paused or after game over.
  if (board && current) draw();
  if (next) drawNext();
}

function paintBackground(context) {
  context.fillStyle = skin.bg;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
}

function resetBlockState(context) {
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => {
    applySkin(skinSelect.value);
    saveSkinName(skinSelect.value);
    skinSelect.blur(); // give keyboard control back to the game
  });
}

applySkin(loadSkinName());
// ---- End skins ----

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  skin.drawBlock(context, x * size, y * size, size, COLORS[colorIndex], alpha ?? 1);
  resetBlockState(context);
}

function drawGrid() {
  ctx.strokeStyle = skin.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  paintBackground(ctx);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  paintBackground(nextCtx);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  hsOnGameOver();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    hidePauseMenu(true);
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    showPauseMenu();
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = gameStartLevel = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  combo = 0;
  maxCombo = 0;
  hsHideGameOver();
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  hidePauseMenu();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

// ---- Pause menu ----
const STORAGE_KEY_START_LEVEL = 'tetris.startLevel';
const RESUME_GRACE_MS = 150;
const MAX_START_LEVEL = 10;

const pauseMenu = document.getElementById('pause-menu');
const pauseResumeBtn = document.getElementById('pause-resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const pauseControlsBtn = document.getElementById('pause-controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level');

let startLevel = loadStartLevel();  // level chosen for the next game
let gameStartLevel = startLevel;    // level the running game started at
let resumeGraceUntil = 0;           // game keys ignored until this timestamp

function clampLevel(n) {
  return Number.isInteger(n) && n >= 1 && n <= MAX_START_LEVEL ? n : 1;
}

function loadStartLevel() {
  try {
    return clampLevel(parseInt(localStorage.getItem(STORAGE_KEY_START_LEVEL), 10));
  } catch (_) {
    return 1;
  }
}

function saveStartLevel(n) {
  try {
    localStorage.setItem(STORAGE_KEY_START_LEVEL, String(n));
  } catch (_) { /* storage unavailable: keep in memory only */ }
}

function showPauseMenu() {
  startLevelSelect.value = String(startLevel);
  pauseMenu.classList.remove('hidden');
}

function hidePauseMenu(isResume) {
  if (pauseMenu.contains(document.activeElement)) document.activeElement.blur();
  pauseMenu.classList.add('hidden');
  setControlsVisible(false);
  // After resuming, swallow keys briefly so a Space/Enter meant for a menu
  // button doesn't hit the game. Not armed on restart.
  if (isResume) resumeGraceUntil = performance.now() + RESUME_GRACE_MS;
}

function setControlsVisible(visible) {
  pauseControls.hidden = !visible;
  pauseControlsBtn.setAttribute('aria-expanded', String(visible));
}

for (let n = 1; n <= MAX_START_LEVEL; n++) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = String(n);
  startLevelSelect.appendChild(opt);
}

startLevelSelect.addEventListener('change', () => {
  // Only affects the next game; the running one keeps gameStartLevel.
  startLevel = clampLevel(parseInt(startLevelSelect.value, 10));
  saveStartLevel(startLevel);
});

pauseResumeBtn.addEventListener('click', () => { if (paused) togglePause(); });
pauseRestartBtn.addEventListener('click', init);
pauseControlsBtn.addEventListener('click', () => setControlsVisible(pauseControls.hidden));

function isFormField(el) {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

document.addEventListener('keydown', e => {
  const isPauseKey = e.code === 'KeyP' || e.code === 'Escape';
  if (!current) return; // start screen: no game yet
  if (isFormField(e.target) && !(isPauseKey && paused)) return;
  if (isPauseKey) {
    e.preventDefault();
    if (!e.repeat) togglePause(); // holding P/Esc must not flicker the menu
    return;
  }
  if (paused || gameOver) return;
  if (performance.now() < resumeGraceUntil) {
    if (e.code === 'Space') e.preventDefault();
    return;
  }
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

// ---- High scores ----

const HS_KEY = 'tetris.highscores';
const BESTS_KEY = 'tetris.bests';
const HS_MAX = 5;
const HS_NAME_MAX = 12;

const startScreen = document.getElementById('start-screen');
const hsPlayBtn = document.getElementById('hs-play-btn');
const hsStartTable = document.getElementById('hs-start-table');
const hsStartBests = document.getElementById('hs-start-bests');
const hsGameOver = document.getElementById('hs-gameover');
const hsGameOverMsg = document.getElementById('hs-gameover-msg');
const hsNameForm = document.getElementById('hs-name-form');
const hsNameInput = document.getElementById('hs-name-input');
const hsGameOverTable = document.getElementById('hs-gameover-table');
const hsGameOverBests = document.getElementById('hs-gameover-bests');

// Consecutive line-clearing locks in the current game, and the max reached.
let combo = 0;
let maxCombo = 0;
// Entry waiting for a name at game over (null when nothing is pending).
let hsPendingEntry = null;
// Messages about all-time bests beaten this game, shown next to the table.
let hsBestMsgs = [];
// True from game over until the first keyup in the name input (see hsOnGameOver).
let hsSwallowRepeat = false;

function hsTrackCombo(cleared) {
  combo = cleared > 0 ? combo + 1 : 0;
  if (combo > maxCombo) maxCombo = combo;
}

function hsReadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function hsWriteJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Storage full or unavailable: records just won't persist.
  }
}

function hsCount(v) {
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function loadHighScores() {
  const data = hsReadJSON(HS_KEY);
  if (!Array.isArray(data)) return [];
  return data
    .filter(e => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.score))
    .map(e => ({
      name: e.name.slice(0, HS_NAME_MAX) || 'Anónimo',
      score: hsCount(e.score),
      lines: hsCount(e.lines),
      level: hsCount(e.level) || 1,
      date: typeof e.date === 'string' ? e.date : '',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, HS_MAX);
}

function loadBests() {
  const data = hsReadJSON(BESTS_KEY);
  if (!data || typeof data !== 'object') return { bestCombo: 0, maxLines: 0 };
  return { bestCombo: hsCount(data.bestCombo), maxLines: hsCount(data.maxLines) };
}

function hsQualifies(list, value) {
  return value > 0 && (list.length < HS_MAX || value > list[list.length - 1].score);
}

// Inserts entry after any equal scores; returns its index, or -1 if it fell off.
function hsInsert(list, entry) {
  let idx = list.findIndex(e => entry.score > e.score);
  if (idx === -1) idx = list.length;
  list.splice(idx, 0, entry);
  if (list.length > HS_MAX) list.length = HS_MAX;
  return idx < HS_MAX ? idx : -1;
}

function hsFormatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function hsEl(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function renderHighScoreTable(container, list, highlightIdx) {
  container.replaceChildren();
  if (!list.length) {
    container.appendChild(hsEl('p', 'Sin records todavía', 'hs-empty'));
    return;
  }
  const table = document.createElement('table');
  table.className = 'hs-table';
  const head = document.createElement('tr');
  ['#', 'Nombre', 'Puntos', 'Líneas', 'Nivel', 'Fecha'].forEach(h => head.appendChild(hsEl('th', h)));
  table.appendChild(head);
  list.forEach((e, i) => {
    const tr = document.createElement('tr');
    if (i === highlightIdx) tr.className = 'hs-highlight';
    tr.appendChild(hsEl('td', String(i + 1)));
    tr.appendChild(hsEl('td', e.name, 'hs-name'));
    tr.appendChild(hsEl('td', e.score.toLocaleString(), 'hs-num'));
    tr.appendChild(hsEl('td', String(e.lines), 'hs-num'));
    tr.appendChild(hsEl('td', String(e.level), 'hs-num'));
    tr.appendChild(hsEl('td', hsFormatDate(e.date), 'hs-date'));
    table.appendChild(tr);
  });
  container.appendChild(table);
}

function hsBestsText(bests) {
  return `Mejor combo: ${bests.bestCombo} · Líneas máximas: ${bests.maxLines}`;
}

function renderStartScreen() {
  renderHighScoreTable(hsStartTable, loadHighScores(), -1);
  hsStartBests.textContent = hsBestsText(loadBests());
}

function renderGameOverRecords(highlightIdx) {
  renderHighScoreTable(hsGameOverTable, loadHighScores(), highlightIdx);
  hsGameOverBests.textContent = hsBestsText(loadBests());
}

function hsSetMessage(msgs) {
  hsGameOverMsg.replaceChildren(...msgs.map(text => hsEl('span', text)));
  hsGameOverMsg.classList.toggle('hidden', msgs.length === 0);
}

function hsOnGameOver() {
  // A key-triggered game over stops the loop before it redraws, so paint the final board.
  draw();

  // Update all-time bests first so the summary below the table is current.
  const bests = loadBests();
  hsBestMsgs = [];
  if (maxCombo > bests.bestCombo) {
    bests.bestCombo = maxCombo;
    hsBestMsgs.push(`¡Nuevo mejor combo: ${maxCombo}!`);
  }
  if (lines > bests.maxLines) {
    bests.maxLines = lines;
    hsBestMsgs.push(`¡Nuevo récord de líneas: ${lines}!`);
  }
  if (hsBestMsgs.length) hsWriteJSON(BESTS_KEY, bests);

  overlayScore.textContent += ` · Combo máx: ${maxCombo}`;
  hsGameOver.classList.remove('hidden');
  const list = loadHighScores();
  renderHighScoreTable(hsGameOverTable, list, -1);
  hsGameOverBests.textContent = hsBestsText(bests);

  if (hsQualifies(list, score)) {
    hsPendingEntry = { score, lines, level, date: new Date().toISOString() };
    hsSetMessage(['¡Nuevo récord!', ...hsBestMsgs]);
    hsNameInput.value = '';
    hsNameForm.classList.remove('hidden');
    // The game-ending key may still be held: swallow its auto-repeat until it is released.
    hsSwallowRepeat = true;
    hsNameInput.focus();
  } else {
    hsPendingEntry = null;
    hsSetMessage(hsBestMsgs);
    hsNameForm.classList.add('hidden');
  }
}

function hsSaveName() {
  if (!hsPendingEntry) return;
  const name = hsNameInput.value.trim().slice(0, HS_NAME_MAX) || 'Anónimo';
  const list = loadHighScores();
  const idx = hsInsert(list, { name, ...hsPendingEntry });
  hsPendingEntry = null;
  hsWriteJSON(HS_KEY, list);
  hsNameForm.classList.add('hidden');
  const place = idx >= 0 ? [`¡Nuevo récord! Puesto #${idx + 1}`] : [];
  hsSetMessage([...place, ...hsBestMsgs]);
  renderGameOverRecords(idx);
  // Blur rather than focusing Reiniciar, so a held Enter can't auto-repeat into a restart.
  hsNameInput.blur();
}

function hsHideGameOver() {
  // Restarting without pressing Guardar still keeps a qualifying score.
  if (hsPendingEntry) hsSaveName();
  hsPendingEntry = null;
  hsBestMsgs = [];
  hsGameOver.classList.add('hidden');
  hsNameForm.classList.add('hidden');
  hsSetMessage([]);
}

function hsResetRecords() {
  if (!confirm('¿Borrar todos los records? Esta acción no se puede deshacer.')) return;
  try {
    localStorage.removeItem(HS_KEY);
    localStorage.removeItem(BESTS_KEY);
  } catch (err) {
    // Storage unavailable: nothing to clear.
  }
  renderStartScreen();
  if (!hsGameOver.classList.contains('hidden')) {
    // The bests just announced were cleared too; keep only the pending-entry notice.
    hsBestMsgs = [];
    hsSetMessage(hsPendingEntry ? ['¡Nuevo récord!'] : []);
    renderGameOverRecords(-1);
  }
}

function hsDrawEmptyBoard() {
  paintBackground(ctx);
  drawGrid();
}

hsNameInput.maxLength = HS_NAME_MAX;

hsNameForm.addEventListener('submit', e => {
  e.preventDefault();
  hsSaveName();
});

hsNameInput.addEventListener('keydown', e => {
  // Leading spaces are useless and usually leftover hard-drop presses that would fill maxlength.
  const leadingSpace = e.key === ' ' && hsNameInput.value.trim() === '';
  if (leadingSpace || (e.repeat && hsSwallowRepeat)) e.preventDefault();
});

hsNameInput.addEventListener('keyup', () => {
  hsSwallowRepeat = false;
});

hsPlayBtn.addEventListener('click', () => {
  startScreen.classList.add('hidden');
  hsPlayBtn.blur();
  init();
});

document.querySelectorAll('.hs-reset-btn').forEach(btn => btn.addEventListener('click', hsResetRecords));

// Bootstrap: show the start screen over an empty board; the game starts on "Jugar".
hsDrawEmptyBoard();
renderStartScreen();
