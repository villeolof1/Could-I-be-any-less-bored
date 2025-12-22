// lightsout.js — Lights Out+ (optimal hints, tunable limits, autosolve actually plays)
// - Hints are solver-backed and wrap-aware (from a minimum-press solution when feasible).
// - Autosolve truly presses tiles (not just highlight), at adjustable speed and with a per-day limit.
// - Tunables up top (LIMITS + SOLVER): edit just these to change limits/effort.
// - Clear hint visuals (bold ring + glow) with auto-scroll/focus; friendly toasts even in fullscreen.
// - Responsive square board with 1:1 scroll fallback on tiny screens.
// - Minimal toolbar: New, Restart, Hint, Wrap | Moves/Timer | Auto, Fullscreen, Settings

import { makeConfetti, load, save } from '../kit/gamekit.js';

export default {
  id: 'lightsout',
  title: 'Lights Out+',
  category: 'puzzle',
  icon: '💡',
  tags: ['toggle','grid'],
  launch(api){

// ---------------- Tunables (edit these first) ----------------
const LIMITS = {
  HINTS_PER_MINUTE: 3,      // change hint throttle
  AUTOSOLVE_PER_DAY: 2      // how many autosolves per day
};
const SOLVER = {
  MAX_NULLSPACE_ENUM: 18,   // enumerate all combos if nullspace dim ≤ this (exact minimal)
  GREEDY_PASSES: 3          // fallback passes if nullspace is larger
};

// ---------------- Config ----------------
let cfg = {
  preset: 'Classic',     // Small | Classic | Large | Custom
  n: 5,
  randomMoves: 12,
  wrap: false,

  // layout
  tileSize: 44,
  maxPanel: 980,
  panelPadding: 12,
  cellGapMin: 4,
  cellGapMax: 16,

  // visuals
  highContrast: true,
  animationOn: true,

  // autosolve UI
  autosolveDefaultSpeed: 2.0
};
cfg = { ...cfg, ...(load('lightsout','settings',{}) || {}) };

// ---------------- State & DOM ----------------
const root = document.createElement('div');
Object.assign(root.style,{
  width:'100%',
  maxWidth:'min(98vw, 1200px)',
  margin:'16px auto',
  display:'grid',
  gap:'12px',
  justifyItems:'center',
  boxSizing:'border-box'
});

// Toolbar
const bar = document.createElement('div');
Object.assign(bar.style,{
  display:'grid',
  gridTemplateColumns:'1fr auto 1fr',
  alignItems:'center',
  gap:'8px',
  width:'100%',
  minWidth:0
});
const leftBar   = hstack('start');
const centerBar = hstack('center');
const rightBar  = hstack('end');
rightBar.style.position = 'relative'; // for Auto popover positioning
bar.append(leftBar, centerBar, rightBar);

// Left — New/Restart/Hint/Wrap
const newBtn      = pill('↻ New', ()=> onNew());
const restartBtn  = pill('⟲ Restart', ()=> onRestart(), 'ghost');
const hintBtn     = pill('Hint', ()=> onHint());
const wrapBtn     = pill(cfg.wrap ? 'Wrap: On' : 'Wrap: Off', ()=> {
  cfg.wrap = !cfg.wrap; wrapBtn.textContent = cfg.wrap ? 'Wrap: On' : 'Wrap: Off'; save('lightsout','settings',cfg);
});
leftBar.append(newBtn, restartBtn, hintBtn, wrapBtn);

// Center — badges
const movesBadge  = badge('Moves: 0');
const timerBadge  = badge('⏱ 0.00s');
centerBar.append(movesBadge, timerBadge);

// Right — Auto / Fullscreen / Settings
const autoBtn     = pill('Auto', ()=> toggleAutoMenu());
const fsBtn       = pill('Fullscreen', ()=> toggleFullscreen(), 'ghost');
const settingsBtn = pill('Settings', ()=> openSettings(), 'ghost');
rightBar.append(autoBtn, fsBtn, settingsBtn);

// Auto popover
const autoMenu = document.createElement('div');
Object.assign(autoMenu.style,{
  position:'absolute',
  right:'0',
  top:'calc(100% + 6px)',
  display:'none',
  background:'var(--card)',
  border:'1px solid var(--ring)',
  borderRadius:'10px',
  boxShadow:'0 8px 24px rgba(0,0,0,.25)',
  padding:'8px',
  zIndex:'999',
  minWidth:'220px'
});
const autoRow = document.createElement('div'); Object.assign(autoRow.style,{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:'8px', marginBottom:'8px' });
const autoLbl = document.createElement('span'); autoLbl.textContent = '×' + (cfg.autosolveDefaultSpeed).toFixed(2);
const autoRange = document.createElement('input'); Object.assign(autoRange, { type:'range', min:'0.25', max:'6', step:'0.25', value:String(cfg.autosolveDefaultSpeed) });
autoRange.style.width='140px';
autoRange.addEventListener('input', ()=> { autospeed = parseFloat(autoRange.value)||cfg.autosolveDefaultSpeed; autoLbl.textContent = '×'+autospeed.toFixed(2); });
autoRow.append(autoLbl, autoRange);
const autoBtns = hstack('end');
const autoPlay = pill('Play', ()=> startAutosolve());
const autoStop = pill('Stop', ()=> stopAutosolve(), 'ghost'); autoStop.disabled = true;
autoBtns.append(autoStop, autoPlay);
autoMenu.append(autoRow, autoBtns);
rightBar.appendChild(autoMenu);
document.addEventListener('click', (e)=>{
  if (autoMenu.style.display!=='none' && !autoMenu.contains(e.target) && e.target!==autoBtn){
    autoMenu.style.display='none';
  }
});

// Stage (square pitch)
const stage = document.createElement('div');
Object.assign(stage.style,{
  width:'100%',
  display:'grid',
  gridTemplateColumns:'1fr',
  alignItems:'center',
  gap:'12px'
});

// Square pitch container
const wrap = document.createElement('div');
Object.assign(wrap.style,{
  position:'relative',
  width:'min(96vw, 1000px)',
  aspectRatio:'1 / 1',
  background:'var(--card)',
  border:'1px solid var(--ring)',
  borderRadius:'12px',
  boxShadow:'var(--shadow)',
  overflow:'hidden',
  display:'grid',
  placeItems:'center'
});

// Inner viewport (scroll fallback)
const inner = document.createElement('div');
Object.assign(inner.style,{
  position:'relative',
  width:`calc(100% - ${cfg.panelPadding*2}px)`,
  height:`calc(100% - ${cfg.panelPadding*2}px)`,
  display:'grid',
  placeItems:'center',
  boxSizing:'border-box',
  overflow:'auto',
  overscrollBehavior:'contain'
});
inner.setAttribute('data-lo-inner','');
wrap.appendChild(inner);

// Board
const board = document.createElement('div');
Object.assign(board.style,{ userSelect:'none', touchAction:'manipulation', boxSizing:'border-box' });
inner.appendChild(board);

// Confetti
const confettiCv = document.createElement('canvas');
Object.assign(confettiCv.style,{ position:'absolute', inset:'0', pointerEvents:'none', zIndex:'30' });
wrap.appendChild(confettiCv);
let confetti;

// On-canvas toast (visible even in fullscreen)
const toast = document.createElement('div');
Object.assign(toast.style,{
  position:'absolute',
  top:'10px',
  left:'50%',
  transform:'translateX(-50%)',
  background:'rgba(12,18,34,.92)',
  color:'#fff',
  padding:'8px 12px',
  border:'1px solid var(--ring)',
  borderRadius:'999px',
  fontWeight:'800',
  boxShadow:'0 8px 24px rgba(0,0,0,.35)',
  zIndex:'1200',
  display:'none',
  pointerEvents:'none',
  maxWidth:'92%',
  textAlign:'center',
  whiteSpace:'pre-wrap'
});
wrap.appendChild(toast);

// Mount
api.mount.appendChild(root);
root.append(bar, stage);
stage.append(wrap);

// ---------------- Runtime vars ----------------
let N = clamp(~~cfg.n, 3, 40);
let grid = [];         // 0=off, 1=on
let initialGrid = [];  // snapshot for Restart
let moves = 0;
let startedAt = 0, timerId = 0;
let hintTimes = [];    // timestamps for throttle (ms)
let autosolveRunning = false;
let autospeed = cfg.autosolveDefaultSpeed;
let autosolveRaf = 0;
let autosolveQueue = [];
let pressing = false;

// Layout
let cellPx=36, textPx=16;
let colGap=4, rowGap=4;

// ---------------- Styles & helpers ----------------
const styleTag = document.createElement('style');
styleTag.textContent = `
[data-lo-inner]::-webkit-scrollbar{ width:8px; height:8px }
[data-lo-inner]::-webkit-scrollbar-thumb{ background:var(--ring); border-radius:99px }
[data-lo-inner]::-webkit-scrollbar-track{ background:transparent }
[data-lo-inner]{ scrollbar-width:thin; scrollbar-color:var(--ring) transparent }

.pill{ padding:.5rem .75rem; border-radius:999px; border:1px solid var(--ring); background:var(--card); color:var(--ink); font-weight:700 }
.pill.ghost{ background:transparent }
.badge{ padding:.35rem .65rem; border:1px solid var(--ring); border-radius:999px; font-weight:700; white-space:nowrap; }
.pill:disabled{ opacity:.5; cursor:not-allowed }

.lo-cell{ display:grid; place-items:center; font-weight:900; cursor:pointer; user-select:none;
  transition: transform .06s ease, background .14s ease, box-shadow .14s ease, border-color .14s ease;
  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset; border:1px solid var(--ring);
}
.lo-cell.on{ background:#ffd476; color:#0b0f1c; }
.lo-cell.off{ background:#121726; color:#dfe6f3; }
.lo-cell:focus-visible{ outline:2px solid #7aa2ff; outline-offset:2px; }

/* Clearer hint visuals */
@keyframes loHintRing {
  0%   { box-shadow: 0 0 0 0 rgba(122,162,255,0.0), 0 0 0 0 rgba(255,255,255,0); filter:brightness(1); }
  30%  { box-shadow: 0 0 0 6px rgba(122,162,255,0.28), 0 0 0 0 rgba(255,255,255,0.6); filter:brightness(1.35); }
  60%  { box-shadow: 0 0 0 10px rgba(122,162,255,0.18), 0 0 0 6px rgba(255,255,255,0); filter:brightness(1.15); }
  100% { box-shadow: 0 0 0 0 rgba(122,162,255,0.0), 0 0 0 0 rgba(255,255,255,0); filter:brightness(1); }
}
@keyframes loHintGlow {
  0%   { box-shadow: 0 0 0 0 rgba(122,162,255,0.0); filter:brightness(1); }
  50%  { box-shadow: 0 0 0 8px rgba(122,162,255,0.14); filter:brightness(1.15); }
  100% { box-shadow: 0 0 0 0 rgba(122,162,255,0.0); filter:brightness(1); }
}
.lo-hint-target{
  animation: loHintRing 520ms ease-out 0s 2;
  border-color:#7aa2ff !important;
}
.lo-hint-neigh{
  animation: loHintGlow 380ms ease-out 0s 1;
}
`;
document.head.appendChild(styleTag);

function hstack(j='start'){ const x=document.createElement('div'); x.style.display='flex'; x.style.flexWrap='wrap'; x.style.gap='8px'; x.style.justifyContent=j; x.style.alignItems='center'; return x; }
function pill(label, onClick, kind=''){ const b=document.createElement('button'); b.textContent=label; b.className=kind?'pill '+kind:'pill'; b.style.whiteSpace='nowrap'; b.addEventListener('click', onClick); return b; }
function badge(text){ const s=document.createElement('span'); s.textContent=text; s.className='badge'; return s; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function fmtTime(ms){ return (ms/1000).toFixed(2)+'s'; }
const RMO = ()=> window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Unified notifier: visible both in normal & fullscreen
let toastTimer = 0;
function notify(msg){
  try{ api.setNote(msg); }catch{}
  const host = document.fullscreenElement || wrap;
  if (toast.parentElement !== host){ toast.remove(); host.appendChild(toast); }
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ toast.style.display='none'; }, 2200);
}

// ---------------- Layout (always square) ----------------
const MIN_FIT_CELL = 26;
function layoutSquare(){
  const container = api.mount || root.parentElement || document.body;
  const containerRect = container.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const containerWidth = Math.max(320, Math.floor(containerRect.width));
  const barH = Math.ceil(bar.getBoundingClientRect().height || 0);
  const viewportH = window.innerHeight || document.documentElement.clientHeight || rootRect.height;
  const verticalRoom = Math.max(320, Math.floor(viewportH - rootRect.top - barH - 48));
  const side = clamp(Math.min(containerWidth*0.98, verticalRoom, cfg.maxPanel), 320, cfg.maxPanel);

  confettiCv.width  = Math.floor(side * Math.max(1, Math.min(3, window.devicePixelRatio || 1)));
  confettiCv.height = confettiCv.width;
  confettiCv.style.width  = side + 'px';
  confettiCv.style.height = side + 'px';
  confetti?.resize();

  wrap.style.width = side+'px';
  wrap.style.height = side+'px';

  inner.style.width  = `calc(100% - ${cfg.panelPadding*2}px)`;
  inner.style.height = `calc(100% - ${cfg.panelPadding*2}px)`;

  layoutGrid();
}
function solveCellAndGaps(){
  const usable = inner.clientWidth;
  const n = N;
  const gDesired = clamp(Math.round(usable * 0.012), cfg.cellGapMin, cfg.cellGapMax);
  let g = n>1 ? gDesired : 0;
  let S = Math.floor((usable - (n-1)*g) / n);
  if (S < MIN_FIT_CELL){
    S = clamp(cfg.tileSize || 36, 18, 96);
    g = n>1 ? clamp(Math.floor(S*0.12), cfg.cellGapMin, cfg.cellGapMax) : 0;
  }
  return { S, gap: g };
}
function layoutGrid(){
  if (!board.children.length) return;
  const { S, gap } = solveCellAndGaps();
  cellPx = S; colGap = gap; rowGap = gap;
  textPx = Math.max(12, Math.floor(cellPx * 0.72));

  board.style.display='grid';
  board.style.gridTemplateColumns = `repeat(${N}, ${cellPx}px)`;
  board.style.gridAutoRows = `${cellPx}px`;
  board.style.columnGap = `${colGap}px`;
  board.style.rowGap = `${rowGap}px`;

  const boardW = N*cellPx + (N-1)*colGap;
  const boardH = N*cellPx + (N-1)*rowGap;
  board.style.width  = `${boardW}px`;
  board.style.height = `${boardH}px`;

  const rPx = Math.min(12, Math.floor(cellPx*0.22), Math.floor(cellPx/3));
  Array.from(board.children).forEach(el=>{
    el.style.height = `${cellPx}px`;
    el.style.fontSize = `${textPx}px`;
    el.style.lineHeight = '1';
    el.style.borderRadius = `${rPx}px`;
  });
}

// ---------------- Build / Start ----------------
function buildBoard(){
  board.innerHTML='';
  if (!confetti){
    confetti = makeConfetti(confettiCv, { duration:5.5, linger:0.35, count:280, devicePixelRatioAware:true });
  }
  for (let r=0;r<N;r++){
    for (let c=0;c<N;c++){
      const d=document.createElement('button');
      d.className='lo-cell off';
      d.dataset.r=String(r); d.dataset.c=String(c);
      d.addEventListener('click', ()=> onPress(r,c,true));
      d.addEventListener('keydown', (e)=>{
        if (e.key==='Enter' || e.key===' ') { e.preventDefault(); onPress(r,c,true); }
        if (e.key==='ArrowLeft'){ const x=clamp(c-1,0,N-1); focusCell(r,x); }
        if (e.key==='ArrowRight'){ const x=clamp(c+1,0,N-1); focusCell(r,x); }
        if (e.key==='ArrowUp'){ const y=clamp(r-1,0,N-1); focusCell(y,c); }
        if (e.key==='ArrowDown'){ const y=clamp(r+1,0,N-1); focusCell(y,c); }
      });
      board.appendChild(d);
    }
  }
  layoutSquare();
  drawAll();
}
function focusCell(r,c){ const idx=r*N+c; board.children[idx]?.focus(); }

function startNew(scramble=true){
  N = clamp(~~cfg.n, 3, 40);
  grid = Array.from({length:N},()=>Array(N).fill(0));
  if (scramble){
    for (let i=0;i<cfg.randomMoves;i++){
      const r=(Math.random()*N)|0, c=(Math.random()*N)|0;
      flip(r,c,false);
    }
  }
  initialGrid = grid.map(row=>row.slice());
  moves = 0; startedAt = performance.now(); setTimer(0); stopTimer(); startTimer();
  movesBadge.textContent = 'Moves: 0';
  notify('Turn all lights OFF.');
  buildBoard();
}
function onNew(){ stopAutosolveIfAny(); startNew(true); }
function onRestart(){
  stopAutosolveIfAny();
  grid = initialGrid.map(row=>row.slice());
  moves = 0; startedAt = performance.now(); setTimer(0); stopTimer(); startTimer();
  movesBadge.textContent = 'Moves: 0';
  drawAll();
  notify('Restarted.');
}

// ---------------- Game Logic ----------------
function neighbors(r,c){
  const list = [[r,c],[r+1,c],[r-1,c],[r,c+1],[r,c-1]];
  const out=[];
  for (const [rr,cc] of list){
    let R=rr, C=cc;
    if (cfg.wrap){ R=(R+N)%N; C=(C+N)%N; out.push([R,C]); }
    else { if (R>=0&&C>=0&&R<N&&C<N) out.push([R,C]); }
  }
  return out;
}
function flip(r,c,animate=true){
  for (const [rr,cc] of neighbors(r,c)){ grid[rr][cc] ^= 1; }
  if (animate && cfg.animationOn && !RMO()){
    pulseAt(r,c,true);
    for (const [rr,cc] of neighbors(r,c)){ if (rr===r && cc===c) continue; pulseAt(rr,cc,false); }
  }
}
// Core press used by user & autosolve
function applyPress(r,c, animate=true, countMove=true){
  if (pressing) return;
  pressing = true;
  flip(r,c,animate);
  if (countMove){ moves++; movesBadge.textContent = `Moves: ${moves}`; }
  drawCells(neighbors(r,c)); // includes (r,c)
  pressing = false;

  if (win()){
    stopTimer(); confetti?.play({ count:320, duration:5.5, linger:0.35 });
    notify(`Clear! ${countMove ? moves : moves} moves • ${timerBadge.textContent.replace('⏱ ','')}`);
  }
}
function onPress(r,c,fromUser=false){
  if (pressing) return;
  if (autosolveRunning && fromUser){ notify('Autosolve is running — Stop to play manually.'); return; }
  applyPress(r,c,true, /*countMove=*/fromUser);
}
function win(){ return grid.every(row=>row.every(v=>v===0)); }
function drawAll(){ for (let r=0;r<N;r++) for (let c=0;c<N;c++) drawCell(r,c,false); }
function drawCells(list){ for (const [r,c] of list) drawCell(r,c,true); }
function drawCell(r,c,animate=false){
  const el = board.children[r*N + c];
  const on = grid[r][c]===1;
  el.classList.toggle('on', on);
  el.classList.toggle('off', !on);
  if (animate && cfg.animationOn && !RMO()){
    el.animate(
      [{ transform:'translateY(0px) scale(1)' }, { transform:'translateY(1px) scale(0.985)' }, { transform:'translateY(0px) scale(1)' }],
      { duration:110, easing:'ease-out' }
    );
  }
}

// Strong visual pulse + hint classes
function pulseAt(r,c,strong=false){
  const el = board.children[r*N + c];
  if (!el) return;
  if (strong){
    el.classList.add('lo-hint-target');
    setTimeout(()=> el.classList.remove('lo-hint-target'), 980);
  } else {
    el.classList.add('lo-hint-neigh');
    setTimeout(()=> el.classList.remove('lo-hint-neigh'), 520);
  }
}

// ---------------- Timer ----------------
function startTimer(){ stopTimer(); timerId=setInterval(()=>{ setTimer(performance.now()-startedAt); },200); }
function stopTimer(){ if (timerId){ clearInterval(timerId); timerId=0; } }
function setTimer(ms){ timerBadge.textContent=`⏱ ${fmtTime(ms)}`; }

// ---------------- Hints (optimal & wrap-aware + clear limits) ----------------
function onHint(){
  const now = performance.now();
  hintTimes = hintTimes.filter(t=> now - t < 60000);
  if (hintTimes.length >= LIMITS.HINTS_PER_MINUTE){
    const waitMs = Math.max(0, 60000 - (now - hintTimes[0]));
    const secs = Math.ceil(waitMs/1000);
    notify(`Hint limit reached — try again in ~${secs}s.`);
    return;
  }

  const seq = solveOptimalCurrent();
  if (!seq){ notify('No solution exists under current rules. Try toggling Wrap or restarting.'); return; }
  if (!seq.length){ notify('Already solved!'); return; }

  hintTimes.push(now);

  // Pick a hint move — prefer the move that reduces lit count the most (all are from an optimal sequence).
  let bestMove = seq[0], bestDelta = -Infinity;
  for (const [r,c] of seq){
    const d = estimateLitGain(r,c);
    if (d > bestDelta){ bestDelta = d; bestMove = [r,c]; }
  }

  const [r,c] = bestMove;
  scrollCellIntoView(r,c);
  pulseAt(r,c,true);
  for (const [rr,cc] of neighbors(r,c)){ if (rr===r && cc===c) continue; pulseAt(rr,cc,false); }
  focusCell(r,c);
  notify('Try this tile — it’s on the optimal path.');
}

// lit gain heuristic (how many lights turn off minus on if pressed)
function estimateLitGain(r,c){
  let gain = 0;
  for (const [rr,cc] of neighbors(r,c)){
    gain += (grid[rr][cc] ? 1 : -1);
  }
  return gain;
}

// Ensure a cell is visible within the inner scroll container
function scrollCellIntoView(r,c){
  const el = board.children[r*N + c]; if (!el) return;
  const opts = { behavior:'smooth', block:'center', inline:'center' };
  try{ el.scrollIntoView(opts); }
  catch{
    const rect = el.getBoundingClientRect(); const irect = inner.getBoundingClientRect();
    if (rect.left < irect.left || rect.right > irect.right){ inner.scrollLeft += (rect.left + rect.right)/2 - (irect.left + irect.right)/2; }
    if (rect.top < irect.top || rect.bottom > irect.bottom){ inner.scrollTop  += (rect.top + rect.bottom)/2 - (irect.top + irect.bottom)/2; }
  }
}

// ---------------- Autosolve (per-day limit + speed) ----------------
function toggleAutoMenu(){
  autoMenu.style.display = (autoMenu.style.display==='none' || !autoMenu.style.display) ? 'block' : 'none';
}
function startAutosolve(){
  if (autosolveRunning) return;
  const remaining = autosolveRemainingToday();
  if (remaining <= 0){
    const ms = millisUntilTomorrow();
    const secs = Math.ceil(ms/1000);
    notify(`Autosolve limit reached — available in ~${secs}s.`);
    return;
  }
  const seq = solveOptimalCurrent();
  if (!seq){ notify('No solution exists under current rules. Try toggling Wrap or restarting.'); return; }
  if (!seq.length){ notify('Already solved!'); return; }
  autosolveQueue = seq.slice();
  autosolveRunning = true;
  autoPlay.disabled = true; autoStop.disabled = false;
  autoMenu.style.display='none';
  consumeAutosolveCredit();
  notify('Autosolve: playing optimal sequence…');
  stepAutosolve();
}
function stopAutosolve(){
  stopAutosolveIfAny();
  notify('Auto stopped.');
}
function stopAutosolveIfAny(){
  autosolveRunning = false;
  cancelAnimationFrame(autosolveRaf); autosolveRaf=0;
  autoPlay.disabled = false; autoStop.disabled = true;
}
function stepAutosolve(){
  if (!autosolveRunning) return;
  if (!autosolveQueue.length){ autosolveRunning=false; autoPlay.disabled=false; autoStop.disabled=true; return; }
  const [r,c] = autosolveQueue.shift();
  scrollCellIntoView(r,c);
  // Strong pulse for context, then actually press (does not increment user moves)
  pulseAt(r,c,true);
  applyPress(r,c,true, /*countMove=*/false);

  const base = 240;
  const delay = Math.max(32, Math.round(base / Math.max(0.25, autospeed)));
  const due = performance.now() + delay;
  const tick = (t)=>{ if (!autosolveRunning) return; if (t < due){ autosolveRaf=requestAnimationFrame(tick); return; } stepAutosolve(); };
  autosolveRaf = requestAnimationFrame(tick);
}

// Per-day autosolve credits (localStorage)
function autosolveKey(){ const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `lightsout:auto:${y}${m}${day}`; }
function autosolveRemainingToday(){
  try{
    const k=autosolveKey();
    const used = Number(localStorage.getItem(k)||'0');
    return Math.max(0, LIMITS.AUTOSOLVE_PER_DAY - used);
  }catch{return 0;}
}
function consumeAutosolveCredit(){
  try{
    const k=autosolveKey();
    const used = Number(localStorage.getItem(k)||'0');
    localStorage.setItem(k, String(Math.min(LIMITS.AUTOSOLVE_PER_DAY, used+1)));
  }catch{}
}
function millisUntilTomorrow(){
  const d=new Date(); const t=new Date(d); t.setHours(24,0,0,0); return t-d;
}

// ---------------- Solver (GF(2), optimal when feasible) ----------------
function solveOptimalCurrent(){
  const NN = N*N;
  // Build A (NN x NN) and b (NN), where x_j indicates press at cell j.
  // For each cell i (row), sum of neighbors' presses ≡ current light state b[i] (mod 2).
  const A = Array.from({length:NN},()=> new Uint32Array(Math.ceil(NN/32))); // bit matrix
  const b = new Uint8Array(NN);
  const idx = (r,c)=> r*N + c;

  function setBit(row, col){ const w = col>>5, bit = col&31; A[row][w] |= (1<<bit)>>>0; }
  function getBitRow(row, col){ const w = col>>5, bit = col&31; return (A[row][w]>>>bit)&1; }

  for (let r=0;r<N;r++){
    for (let c=0;c<N;c++){
      const i = idx(r,c);
      b[i] = grid[r][c] & 1;
      for (const [rr,cc] of neighbors(r,c)){
        const j = idx(rr,cc);
        setBit(i,j); // pressing j toggles i
      }
    }
  }

  // Gaussian elimination over GF(2) to RREF-like form
  const W = A[0].length;
  const where = new Int32Array(NN).fill(-1);
  let row=0;
  for (let col=0; col<NN && row<NN; col++){
    let sel = -1;
    for (let i=row;i<NN;i++){ if (getBitRow(i,col)){ sel=i; break; } }
    if (sel===-1) continue;
    if (sel!==row){
      const tmp=A[sel]; A[sel]=A[row]; A[row]=tmp;
      const tb=b[sel]; b[sel]=b[row]; b[row]=tb;
    }
    where[col]=row;
    for (let i=0;i<NN;i++){
      if (i!==row && getBitRow(i,col)){
        for (let w=0; w<W; w++) A[i][w]^=A[row][w];
        b[i]^=b[row];
      }
    }
    row++;
  }

  // Inconsistency?
  for (let i=0;i<NN;i++){
    let any=0; for (let w=0; w<W; w++){ any |= A[i][w]; }
    if (!any && (b[i]&1)) return null;
  }

  // Particular solution xp (free vars = 0)
  const xp = new Uint8Array(NN);
  for (let j=0;j<NN;j++){ if (where[j] !== -1) xp[j] = b[ where[j] ] & 1; }

  // Nullspace basis
  const freeCols = []; for (let j=0;j<NN;j++){ if (where[j] === -1) freeCols.push(j); }
  const basis = [];
  for (const free of freeCols){
    const v = new Uint8Array(NN); v[free]=1;
    for (let p=0;p<NN;p++){
      if (where[p]!==-1){
        const rrow = where[p];
        if (getBitRow(rrow, free)) v[p]^=1;
      }
    }
    basis.push(v);
  }

  // Search for minimal Hamming solution xp + span(basis)
  let best = xp.slice();
  let bestW = hamming(best);
  const K = basis.length;

  if (K <= SOLVER.MAX_NULLSPACE_ENUM){
    const total = 1<<K;
    for (let mask=1; mask<total; mask++){
      const x = xp.slice();
      for (let i=0;i<K;i++){
        if (mask & (1<<i)){
          const v = basis[i];
          for (let j=0;j<NN;j++) x[j]^=v[j];
        }
      }
      const w = hamming(x);
      if (w < bestW){ best=x; bestW=w; if (bestW===0) break; }
    }
  } else {
    for (let pass=0; pass<SOLVER.GREEDY_PASSES; pass++){
      let improved = false;
      for (const v of basis){
        const x = best.slice();
        for (let j=0;j<NN;j++) x[j]^=v[j];
        const nw = hamming(x);
        if (nw < bestW){ best=x; bestW=nw; improved=true; }
      }
      if (!improved) break;
    }
  }

  // Convert vector to press sequence
  const seq=[];
  for (let i=0;i<NN;i++){ if (best[i]&1){ const r=(i/N)|0, c=i%N; seq.push([r,c]); } }
  return seq;
}

function hamming(u8){ let w=0; for (let i=0;i<u8.length;i++) w += (u8[i]&1); return w; }

// ---------------- Settings ----------------
const settingsOverlay = document.createElement('div');
Object.assign(settingsOverlay.style,{ position:'absolute', inset:'0', background:'rgba(0,0,0,.45)', display:'none', placeItems:'center', zIndex:'1000' });
const settingsCard = document.createElement('div');
Object.assign(settingsCard.style,{ width:'min(560px, 92vw)', background:'var(--card)', color:'var(--ink)', border:'1px solid var(--ring)', borderRadius:'12px', boxShadow:'var(--shadow)', padding:'16px', maxHeight:'80vh', overflow:'auto' });
settingsOverlay.appendChild(settingsCard);
wrap.appendChild(settingsOverlay);

function openSettings(){
  const host=document.fullscreenElement || wrap;
  if (settingsOverlay.parentElement!==host){ settingsOverlay.remove(); host.appendChild(settingsOverlay); }
  Object.assign(settingsOverlay.style,{ position:'absolute', inset:'0' });

  settingsCard.innerHTML='';
  const h1=document.createElement('div'); h1.textContent='Settings'; h1.style.fontSize='20px'; h1.style.fontWeight='800'; h1.style.marginBottom='8px';

  const form=document.createElement('div'); form.style.display='grid'; form.style.gridTemplateColumns='1fr'; form.style.gap='12px';

  // Presets
  const seg=document.createElement('div'); Object.assign(seg.style,{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px' });
  const presets=['Small','Classic','Large','Custom'];
  const segBtns=presets.map(p=>{ const b=document.createElement('button'); b.className='pill'; b.textContent=p; b.dataset.val=p;
    b.addEventListener('click',()=>{ segBtns.forEach(x=>x.classList.remove('active')); b.classList.add('active'); showCustom(p==='Custom'); }); return b; });
  segBtns.forEach(b=>seg.appendChild(b));
  form.appendChild(labelWrap('Preset', seg));

  const presetSize = (p)=> p==='Small'?5 : p==='Classic'?5 : p==='Large'?7 : cfg.n;

  const sizeInput = rangeRow('Size (N×N)', cfg.n, 3, 40, 1, v=>String(v));
  const scrInput  = rangeRow('Scramble Moves', cfg.randomMoves, 5, 60, 1, v=>String(v));
  const wrapRow   = checkboxRow('Wrap edges', cfg.wrap);
  form.append(sizeInput.row, scrInput.row, wrapRow.row);

  const btns=document.createElement('div'); Object.assign(btns.style,{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'8px' });
  const cancelB=pill('Cancel', ()=> closeSettings(), 'ghost');
  const saveB  =pill('Save', ()=> {
    const p = activePreset(); cfg.preset = p;
    cfg.n = (p==='Custom') ? Number(sizeInput.input.value) : presetSize(p);
    cfg.randomMoves = Number(scrInput.input.value);
    cfg.wrap = !!wrapRow.input.checked;
    save('lightsout','settings',cfg);
    closeSettings();
    onNew();
  });
  btns.append(cancelB,saveB);

  segBtns.forEach(b=>{ if (b.dataset.val===cfg.preset) b.classList.add('active'); });
  showCustom(cfg.preset==='Custom');

  settingsCard.append(h1, form, btns);
  settingsOverlay.style.display='grid';

  const onClick=(e)=>{ if (e.target===settingsOverlay) closeSettings(); };
  const onKey=(e)=>{ if (e.key==='Escape') closeSettings(); };
  settingsOverlay.addEventListener('click', onClick, { once:true });
  document.addEventListener('keydown', onKey, { once:true });

  function activePreset(){ const act=segBtns.find(b=>b.classList.contains('active')); return act?act.dataset.val:'Classic'; }
  function showCustom(show){ sizeInput.row.style.display=show?'grid':'none'; }
}
function closeSettings(){ settingsOverlay.style.display='none'; }
function labelWrap(label,node){ const row=document.createElement('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'1fr',gap:'6px'}); const lab=document.createElement('div'); lab.textContent=label; lab.style.fontWeight;'700'; row.append(lab,node); return row; }
function rangeRow(label,value,min,max,step,fmt){
  const row=document.createElement('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'1fr auto',alignItems:'center',gap:'8px'});
  const lab=document.createElement('div'); lab.textContent=label; lab.style.fontWeight;'600';
  const inputWrap=document.createElement('div'); Object.assign(inputWrap.style,{display:'flex',gap:'10px',alignItems:'center'});
  const r=document.createElement('input'); Object.assign(r,{type:'range',min,max,step,value:String(value)}); r.style.width='200px';
  const out=document.createElement('span'); out.textContent=fmt(value); out.style.minWidth='62px';
  r.addEventListener('input',()=> out.textContent=fmt(Number(r.value)));
  inputWrap.append(r,out); row.append(lab,inputWrap);
  return {row, input:r};
}
function checkboxRow(label,checked){
  const row=document.createElement('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'1fr auto',alignItems:'center',gap:'8px'});
  const lab=document.createElement('div'); lab.textContent=label; lab.style.fontWeight;'600';
  const c=document.createElement('input'); c.type='checkbox'; c.checked=!!checked;
  row.append(lab,c); return {row, input:c};
}

// ---------------- Fullscreen ----------------
async function toggleFullscreen(){
  try{ if (!document.fullscreenElement) await wrap.requestFullscreen(); else await document.exitFullscreen(); }catch{}
  if (settingsOverlay.style.display==='grid'){ const host=document.fullscreenElement||wrap; if (settingsOverlay.parentElement!==host){ settingsOverlay.remove(); host.appendChild(settingsOverlay); } }
  if (toast.parentElement!==(document.fullscreenElement||wrap)){ toast.remove(); (document.fullscreenElement||wrap).appendChild(toast); }
}

// ---------------- Window & init ----------------
window.addEventListener('resize',()=>{ layoutSquare(); layoutGrid(); });

startNew(true);

// Expose control surface
return {
  dispose(){ stopTimer(); stopAutosolveIfAny(); }
};

// ===== end launch =====
}};

// ===== Small helpers (scoped) =====
function hstack(j='start'){ const x=document.createElement('div'); x.style.display='flex'; x.style.flexWrap='wrap'; x.style.gap='8px'; x.style.justifyContent=j; x.style.alignItems='center'; return x; }
function pill(label, onClick, kind=''){ const b=document.createElement('button'); b.textContent=label; b.className=kind?'pill '+kind:'pill'; b.style.whiteSpace='nowrap'; b.addEventListener('click', onClick); return b; }
function badge(text){ const s=document.createElement('span'); s.textContent=text; s.className='badge'; return s; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function fmtTime(ms){ return (ms/1000).toFixed(2)+'s'; }
// END FILE
