// minesweeper.js — Minesweeper+ (Runs, aura, timer challenge, smarter hints, replay)
// - Runs: Difficulty presets + Custom, hints modes, optional time limit, aura potential.
// - New Run overlay: choose Board / Help / Time for the run (non-destructive until confirmed).
// - Settings: pure preferences (visual + interaction), never resets the board.
// - Timer challenge: optional countdown with dramatic last-10s shake and giant digits.
// - Aura: 0–100 score; more tiles + fewer hints + timer on → higher potential.
// - Hints: Off / Limited / Unlimited per run, with penalties to aura and timer.

import { makeConfetti, load, save } from '../kit/gamekit.js';

export default {
  id: 'mines',
  title: 'Minesweeper+',
  category: 'puzzle',
  icon: '💣',
  tags: ['logic','grid','flags'],
  launch(api){

// ---------------- Config (preferences, not run) ----------------
let cfg = {
  // Legacy fields still used for board + generation; w/h/mines are driven by runCfg
  preset: 'Average',        // legacy (for older payloads)
  w: 16, h: 16, mines: 40,  // NOTE: h is forced to equal w at runtime

  // Layout/sizing
  tileSize: 30,             // baseline "comfortable" size when we switch to minimap mode
  maxPanel: 980,
  panelPadding: 12,

  // Gameplay preferences (apply to all runs)
  safeZero: true,
  chord: true,
  questionMarks: true,

  // Visual + feel
  highContrast: true,
  colorBlind: false,
  cellGapMin: 1,
  cellGapMax: 18,
  longPressMS: 420,

  // Internal / legacy
  allowUndo: true,
  allowHints: true,         // run-specific hints control lives in hintsMode/hintsAllowed
  hintPenaltyBaseMs: 3000,
  daily: false
};
cfg = { ...cfg, ...(load('mines','settings',{}) || {}) };

// ---------------- Run configuration (per-run) ------------------
const DIFFICULTIES = {
  Basic:   { size:8,  mines:8,  hintsMode:'limited', hintsMax:10, timerLimitMin:5 },
  Easy:    { size:9,  mines:10, hintsMode:'limited', hintsMax:7,  timerLimitMin:10 },
  Average: { size:16, mines:40, hintsMode:'limited', hintsMax:5,  timerLimitMin:20 },
  Hard:    { size:24, mines:99, hintsMode:'limited', hintsMax:3,  timerLimitMin:30 },
  Pro:     { size:24, mines:120,hintsMode:'off',     hintsMax:0,  timerLimitMin:30 }
};

const RUN_DEFAULT = {
  difficulty: 'Average',          // Basic|Easy|Average|Hard|Pro|Custom
  size: 16,
  mines: 40,
  hintsMode: 'limited',           // off|limited|unlimited
  hintsMax: 5,
  timerMode: 'off',               // off|limit
  timeLimitMin: 20
};

let runCfg = { ...RUN_DEFAULT };
normalizeRunCfg(runCfg);

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
rightBar.style.position = 'relative'; // for share menu positioning
bar.append(leftBar, centerBar, rightBar);

// Left — New/Hint/Undo
const newBtn   = pill('↻ New', ()=> { if (isReplaying) endReplaySession(); openRunOverlay('new'); });
const hintBtn  = pill('Hint', ()=> hint());
const undoBtn  = pill('Undo', ()=> undo(), 'ghost');
leftBar.append(newBtn, hintBtn, undoBtn);

// Center — Timer
const timerBadge = badge('⏱ 0.00s');
centerBar.append(timerBadge);

// Right — badges + actions
const minesBadge = badge('Mines: 0');
const hintsBadge = badge('Hints: —');
const auraBadge  = badge('Aura: —');

// Replay button (minimal)
const replayBtn  = pill('Replay', ()=> onReplayButton());
replayBtn.disabled = true; replayBtn.style.opacity = .6;

// Single Share (opens small menu)
const shareBtn   = pill('Share', ()=> toggleShareMenu());
const uploadBtn  = pill('Upload', ()=> openUpload(), 'ghost');
const gearBtn    = pill('Settings', ()=> openSettings(), 'ghost');
rightBar.append(minesBadge, hintsBadge, auraBadge, replayBtn, shareBtn, uploadBtn, gearBtn);

// Share menu (dropdown)
const shareMenu = document.createElement('div');
Object.assign(shareMenu.style,{
  position:'absolute',
  right:'0',
  top:'calc(100% + 6px)',
  display:'none',
  background:'var(--card)',
  border:'1px solid var(--ring)',
  borderRadius:'10px',
  boxShadow:'0 8px 24px rgba(0,0,0,.25)',
  padding:'8px',
  zIndex:'999'
});
const shareCopy = pill('Copy link', ()=> doCopyShare(), '');
const shareDL   = pill('Download file', ()=> downloadReplay(), '');
const shareSys  = pill('System share', ()=> doSystemShare(), '');
[shareCopy, shareDL, shareSys].forEach(b=> { b.style.display='block'; b.style.width='100%'; b.style.margin='4px 0'; });
shareMenu.append(shareCopy, shareDL, shareSys);
rightBar.appendChild(shareMenu);
document.addEventListener('click', (e)=>{
  if (shareMenu.style.display!=='none' && !shareMenu.contains(e.target) && e.target!==shareBtn){
    shareMenu.style.display='none';
  }
});

// Replay Controls (minimal, tidy)
const rcBar = document.createElement('div');
Object.assign(rcBar.style,{
  width:'100%',
  display:'none',
  gap:'8px',
  alignItems:'center',
  justifyContent:'center',
  flexWrap:'wrap'
});
rcBar.className = 'replay-ctrl';
const rcStart  = pill('⏮', ()=> replayJump('start'), 'ghost');
const rcPrev   = pill('◀', ()=> replayStep(-1), 'ghost');
const rcPlay   = pill('Play', ()=> toggleReplayPlay());
const rcNext   = pill('▶', ()=> replayStep(1), 'ghost');
const rcEnd    = pill('⏭', ()=> replayJump('end'), 'ghost');
const rcLive   = pill('Live: Off', ()=> toggleLive(), 'ghost'); // Live timing toggle
const rcSpeedWrap = document.createElement('div');
Object.assign(rcSpeedWrap.style,{ display:'flex', alignItems:'center', gap:'6px' });
const rcSpeedLbl = document.createElement('span'); rcSpeedLbl.textContent = '×1.50';
const rcSpeed = document.createElement('input');
Object.assign(rcSpeed, { type:'range', min:'0.25', max:'6', step:'0.25', value:'1.5' });
rcSpeed.style.width = '160px';
let replaySpeed = 1.5;
rcSpeed.addEventListener('input', ()=> {
  replaySpeed = parseFloat(rcSpeed.value)||1.5;
  rcSpeedLbl.textContent = `×${replaySpeed.toFixed(2)}`;
  if (replayPlaying && !replayLive){
    scheduleNextTick();
  }
});
rcSpeedWrap.append(rcSpeedLbl, rcSpeed);
rcBar.append(rcStart, rcPrev, rcPlay, rcNext, rcEnd, rcLive, rcSpeedWrap);

// Stage: pitch + external minimap
const stage = document.createElement('div');
Object.assign(stage.style,{
  width:'100%',
  display:'grid',
  gridTemplateColumns:'1fr auto',
  alignItems:'center',
  gap:'12px'
});

// Square pitch
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

const killContext = e => { if (wrap.contains(e.target)) e.preventDefault(); };
document.addEventListener('contextmenu', killContext);

// Inner (square viewport)
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
wrap.appendChild(inner);

// Board
const board = document.createElement('div');
Object.assign(board.style,{
  userSelect:'none',
  touchAction:'manipulation',
  boxSizing:'border-box'
});
inner.appendChild(board);

// Delegated board input (attach once)
board.addEventListener('pointerdown', onPointerDown, true);
board.addEventListener('pointerup', onPointerUp, true);
board.addEventListener('pointercancel', resetPress, true);
board.addEventListener('pointerleave', resetPress, true);
board.addEventListener('contextmenu', e=>{
  const cell = e.target.closest('.ms-cell');
  if (!cell || !alive || paused || won) return;
  e.preventDefault();
  const x = +cell.dataset.x, y = +cell.dataset.y;
  pushHistory(); cycleMark(x,y,true); resetPress();
}, true);
board.addEventListener('dblclick', e=>{
  const cell = e.target.closest('.ms-cell');
  if (!cell || !alive || paused || won || !cfg.chord) return;
  const x = +cell.dataset.x, y = +cell.dataset.y;
  if (state[y][x] === 1) chordAt(x,y,true);
}, true);

// Pause veil
const veil = document.createElement('div');
Object.assign(veil.style,{
  position:'absolute',
  inset:'0',
  display:'none',
  placeItems:'center',
  background:'rgba(0,0,0,.35)',
  backdropFilter:'blur(3px)',
  color:'white',
  fontWeight:'800',
  borderRadius:'12px',
  zIndex:'50'
});
veil.textContent = 'Paused';
wrap.appendChild(veil);

// Timer countdown / time-up overlay
const timeOverlay = document.createElement('div');
Object.assign(timeOverlay.style,{
  position:'absolute',
  inset:'0',
  display:'none',
  placeItems:'center',
  background:'rgba(0,0,0,.0)',
  color:'#ffdddd',
  textAlign:'center',
  fontWeight:'900',
  zIndex:'60',
  pointerEvents:'none',
  padding:'16px',
  whiteSpace:'pre-line'
});
const timeOverlayText = document.createElement('div');
Object.assign(timeOverlayText.style,{
  fontSize:'min(15vw, 120px)',
  textShadow:'0 0 18px rgba(0,0,0,.9)'
});
timeOverlay.appendChild(timeOverlayText);
wrap.appendChild(timeOverlay);

// Confetti
const confettiCv = document.createElement('canvas');
Object.assign(confettiCv.style,{
  position:'absolute',
  inset:'0',
  pointerEvents:'none',
  zIndex:'30'
});
wrap.appendChild(confettiCv);
let confetti;

// Minimap (outside pitch)
const mmWrap = document.createElement('div');
Object.assign(mmWrap.style,{
  width:'140px',
  height:'98px',
  background:'rgba(12,18,34,.68)',
  border:'1px solid var(--ring)',
  borderRadius:'10px',
  boxShadow:'0 4px 14px rgba(0,0,0,.35)',
  overflow:'hidden',
  display:'grid',
  placeItems:'center',
  position:'relative'
});
const mmCanvas = document.createElement('canvas');
mmCanvas.width = 140; mmCanvas.height = 98;
mmCanvas.style.width='100%'; mmCanvas.style.height='100%'; mmCanvas.style.display='block';
mmWrap.appendChild(mmCanvas);
const mmViewport = document.createElement('div');
Object.assign(mmViewport.style,{
  position:'absolute',
  border:'2px solid rgba(255,255,255,.92)',
  borderRadius:'4px',
  boxShadow:'0 0 0 1px rgba(0,0,0,.25)',
  cursor:'grab'
});
mmWrap.appendChild(mmViewport);

// Settings (preferences; non-destructive)
const settingsOverlay = document.createElement('div');
Object.assign(settingsOverlay.style,{
  position:'absolute', inset:'0',
  background:'rgba(0,0,0,.45)',
  display:'none',
  placeItems:'center',
  zIndex:'1000'
});
const settingsCard = document.createElement('div');
Object.assign(settingsCard.style,{
  width:'min(640px, 92vw)',
  background:'var(--card)', color:'var(--ink)',
  border:'1px solid var(--ring)', borderRadius:'12px',
  boxShadow:'var(--shadow)',
  padding:'16px', maxHeight:'85vh', overflow:'auto'
});
settingsOverlay.appendChild(settingsCard);

// Upload (paste or file)
const uploadOverlay = document.createElement('div');
Object.assign(uploadOverlay.style,{
  position:'absolute', inset:'0',
  background:'rgba(0,0,0,.45)',
  display:'none',
  placeItems:'center',
  zIndex:'1000'
});
const uploadCard = document.createElement('div');
Object.assign(uploadCard.style,{
  width:'min(560px, 92vw)',
  background:'var(--card)', color:'var(--ink)',
  border:'1px solid var(--ring)', borderRadius:'12px',
  boxShadow:'var(--shadow)',
  padding:'16px', maxHeight:'75vh', overflow:'auto', display:'grid', gap:'10px'
});
const upTitle = document.createElement('div'); upTitle.textContent='Import Replay'; upTitle.style.fontWeight='800';
const pasteArea = document.createElement('textarea');
Object.assign(pasteArea.style,{ width:'100%', height:'120px', border:'1px solid var(--ring)', borderRadius:'8px', padding:'8px', background:'var(--card)'});
pasteArea.placeholder = 'Paste replay link, base64, or JSON…';
const fileInput = document.createElement('input'); fileInput.type='file'; fileInput.accept='.minesreplay,.txt,application/json,text/plain';
const upBtns = document.createElement('div'); Object.assign(upBtns.style,{ display:'flex', justifyContent:'flex-end', gap:'8px' });
const upCancel = pill('Cancel', ()=> closeUpload(), 'ghost');
const upImport = pill('Import', ()=> { const s=pasteArea.value.trim(); if(s) importReplaySmart(s); });
fileInput.addEventListener('change', async ()=>{ const f=fileInput.files?.[0]; if(!f) return; const txt=await f.text(); importReplaySmart(txt); });
upBtns.append(upCancel, upImport);
uploadCard.append(upTitle, pasteArea, fileInput, upBtns);
uploadOverlay.append(uploadCard);

// Run Setup overlay (New run)
const runOverlay = document.createElement('div');
Object.assign(runOverlay.style,{
  position:'absolute', inset:'0',
  background:'rgba(0,0,0,.45)',
  display:'none',
  placeItems:'center',
  zIndex:'1000'
});
const runCard = document.createElement('div');
Object.assign(runCard.style,{
  width:'min(680px, 94vw)',
  background:'var(--card)', color:'var(--ink)',
  border:'1px solid var(--ring)', borderRadius:'12px',
  boxShadow:'var(--shadow)',
  padding:'18px', maxHeight:'85vh', overflow:'auto',
  display:'grid', gap:'12px'
});
runOverlay.appendChild(runCard);

// Mount
api.mount.appendChild(root);
root.append(bar, rcBar, stage);
stage.append(wrap, mmWrap);

// ---------------- Runtime vars ----------------
let grid=[], state=[];
let firstClick=true, alive=true, won=false, paused=false;
let flags=0;
let startedAt=0, timerId=0, penaltyMs=0, hintsUsed=0;
let history=[], replay=[];
let rng=Math.random, isReplaying=false;
let gameSeed=null, lastGameSeed=null, pendingSeed=null;

// Replay session
let replaySeq=[], replayIdx=0, replayPlaying=false;
let replayLive=false;
let replayVirtualMs=0;
let replaySnaps=[];
let replayRaf=0;
let nextDueAt=0;

// Layout
let cellPx=28, iconPx=18, textPx=16;
let colGap=2, rowGap=2; // always equal in solve()
let dims={ boardW:0, boardH:0, viewW:0, viewH:0, scrollX:0, scrollY:0 };

// Run-specific state
let hintsMode = 'limited';
let hintsAllowed = Infinity;
let timerMode = 'off';
let timeLimitMs = 0;
let auraPotential = 0;  // 0–100
let auraScore = 0;      // 0–100
let auraLocked = false;
let lastCountdownSec = null;
let timeExpiredShown = false;

// Colors & numerals
const ICON = {
  flagSVG(size){
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v20"/><path d="M6 2h10l-2 4 2 4H6"/></svg>`;
  },
  mineSVG(size){
    return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
      <defs>
        <radialGradient id="g-bomb" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stop-color="#f5f7ff"/>
          <stop offset="35%" stop-color="#c5d0f8"/>
          <stop offset="100%" stop-color="#121528"/>
        </radialGradient>
      </defs>
      <circle cx="11" cy="14" r="6.5" fill="url(#g-bomb)" stroke="#0b0f1c" stroke-width="1.6"/>
      <circle cx="9.5" cy="12.5" r="1.3" fill="#fdfdfd" fill-opacity="0.9"/>
      <path d="M14 7.5l2-2.5" stroke="#f5f7ff" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="14" y="5" width="3.4" height="2.2" rx="0.7" fill="#15192c" stroke="#e0e6ff" stroke-width="0.8"/>
      <path d="M18.5 3.5l1-1" stroke="#ffd45c" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M19.7 5.7l.9.3" stroke="#ff925c" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M17.2 2.7l-.3-.9" stroke="#ffeb7a" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`;
  }
};
const NUMC = { 1:'#2196f3', 2:'#43a047', 3:'#e53935', 4:'#3949ab', 5:'#6d4c41', 6:'#00897b', 7:'#000000', 8:'#616161' };
const GLYPH = {1:'▲',2:'●',3:'■',4:'◆',5:'★',6:'●●',7:'▲▲',8:'■■' };

// ---------------- Helpers & styles ----------------
function hstack(j='start'){ const x=document.createElement('div'); x.style.display='flex'; x.style.flexWrap='wrap'; x.style.gap='8px'; x.style.justifyContent=j; x.style.alignItems='center'; return x; }
function pill(label, onClick, kind=''){ const b=document.createElement('button'); b.textContent=label; b.className=kind?'pill '+kind:'pill'; b.style.whiteSpace='nowrap'; b.addEventListener('click', onClick); return b; }
function badge(text){ const s=document.createElement('span'); s.textContent=text; s.className='badge'; Object.assign(s.style,{padding:'6px 10px', border:'1px solid var(--ring)', borderRadius:'999px', fontWeight:'700', whiteSpace:'nowrap'}); return s; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function fmtTime(ms){ return (ms/1000).toFixed(2)+'s'; }
function boost(hex, f){ try{ const c=parseInt(hex.slice(1),16); let r=(c>>16)&255,g=(c>>8)&255,b=c&255; r=clamp(Math.floor(r*f),0,255); g=clamp(Math.floor(g*f),0,255); b=clamp(Math.floor(b*f),0,255); return `#${((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}`; }catch{ return hex; } }
function bestKey(){
  const diff = runCfg?.difficulty || 'Custom';
  return `mines:best:${diff}:${cfg.w}x${cfg.h}x${cfg.mines}`;
}
function leaderboardKey(){ return `mines:lb:${bestKey()}`; }

const styleTag = document.createElement('style');
styleTag.textContent = `
[data-ms-inner]::-webkit-scrollbar{ width:8px; height:8px }
[data-ms-inner]::-webkit-scrollbar-thumb{ background:var(--ring); border-radius:99px }
[data-ms-inner]::-webkit-scrollbar-track{ background:transparent }
[data-ms-inner]{ scrollbar-width:thin; scrollbar-color:var(--ring) transparent }
.pill{ padding:.5rem .75rem; border-radius:999px; border:1px solid var(--ring); background:var(--card); color:var(--ink); font-weight:700 }
.pill.ghost{ background:transparent }
.badge{ background:var(--card-2, transparent) }
.replay-ctrl .pill{ padding:.35rem .6rem }
.pill:disabled{ opacity:.5; cursor:not-allowed }
.pill.active{ background:var(--ring); color:var(--card); }
`;
document.head.appendChild(styleTag);
inner.setAttribute('data-ms-inner','');



// RNG (deterministic)
function mulberry32(a){ return function(){ a|=0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1 | a); t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }
function setSeed(s){ rng = mulberry32(s>>>0); }

// ---------------- Layout (always square, uniform gap) ----------------
const MIN_FIT_CELL = 18; // legacy baseline, now combined with dynamic threshold

function enforceSquareDims(){ if (cfg.h !== cfg.w){ cfg.h = cfg.w; } }

// Dynamic minimum visible cell size depending on board size + screen width
function computeMinCellVisual(usable, n){
  // Screen factor: narrower screens tolerate slightly smaller cells
  const screenFactor = clamp(usable / 600, 0.7, 1.3); // ~600px => 1
  // Density factor: many cells → allow smaller, few cells → want bigger
  const densityFactor = clamp(8 / n, 0.6, 1.4);       // 8x8 baseline => 1
  const base = 28; // sweet spot for mid-sized boards
  const raw = base * screenFactor * densityFactor;
  return clamp(Math.round(raw), 18, 36);
}

/**
 * Choose cell size + gap so that:
 * – The board uses essentially the full inner width (no tiny board in a big box).
 * – Gaps shrink automatically when there are many tiles.
 * – If fitting everything would make cells too small, we clamp to a pleasant size
 *   and let scrollbars + minimap handle the overflow.
 */
function solveCellAndGaps(){
  const usable = inner.clientWidth || wrap.clientWidth || 320;
  const n = cfg.w || 1;
  if (!n) return { S: cfg.tileSize, gap: 2 };

  // Gap: base on screen width, then shrink for many tiles
  const baseGap = clamp(Math.round(usable * 0.015), 2, 10);
  const densityFactor = clamp(10 / n, 0.4, 1.4); // many tiles → smaller gap
  let g = Math.round(baseGap * densityFactor);
  g = clamp(g, cfg.cellGapMin, cfg.cellGapMax);

  // First try: fit everything exactly
  let S = Math.floor((usable - (n-1)*g) / n);

  // If S goes into silly territory, fallback to our "scroll with minimap" mode
  const minVisual = computeMinCellVisual(usable, n);
  if (S < minVisual){
    // Use preferred tile size, at least minVisual
    const target = clamp(cfg.tileSize || 30, minVisual, 96);
    S = target;
    g = n>1 ? clamp(Math.floor(S * 0.12), cfg.cellGapMin, cfg.cellGapMax) : 0;
    // In this mode, board is allowed to overflow inner → scroll + minimap own the UX.
  }

  // Safety: never go below hard minimum
  if (S < MIN_FIT_CELL) S = MIN_FIT_CELL;

  return { S, gap: g };
}

function layoutSquare(){
  enforceSquareDims();
  const container = api.mount || root.parentElement || document.body;
  const containerRect = container.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const containerWidth = Math.max(320, Math.floor(containerRect.width));

  // Responsive layout for stage (board + minimap) and toolbar
  if (containerWidth < 720) {
    stage.style.gridTemplateColumns = '1fr';
    stage.style.rowGap = '8px';
    stage.style.alignItems = 'stretch';
    stage.style.justifyItems = 'center';

    bar.style.gridTemplateColumns = '1fr';
    bar.style.rowGap = '6px';
    bar.style.textAlign = 'center';
  } else {
    stage.style.gridTemplateColumns = '1fr auto';
    stage.style.rowGap = '12px';
    stage.style.alignItems = 'center';
    stage.style.justifyItems = 'stretch';

    bar.style.gridTemplateColumns = '1fr auto 1fr';
    bar.style.rowGap = '0';
    bar.style.textAlign = 'initial';
  }

  const barH = Math.ceil(bar.getBoundingClientRect().height || 0) + Math.ceil(rcBar.getBoundingClientRect().height || 0);
  const viewportH = window.innerHeight || document.documentElement.clientHeight || rootRect.height;
  const verticalRoom = Math.max(320, Math.floor(viewportH - rootRect.top - barH - 48));
  const side = clamp(Math.min(containerWidth*0.98, verticalRoom, cfg.maxPanel), 320, cfg.maxPanel);

  wrap.style.width = side+'px';
  wrap.style.height = side+'px';

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  confettiCv.width  = Math.floor(side * dpr);
  confettiCv.height = Math.floor(side * dpr);
  confettiCv.style.width  = side + 'px';
  confettiCv.style.height = side + 'px';
  confetti?.resize();

  inner.style.width  = `calc(100% - ${cfg.panelPadding*2}px)`;
  inner.style.height = `calc(100% - ${cfg.panelPadding*2}px)`;

  layoutGrid();
  computeDims();
  refreshMinimap();
}

function layoutGrid(){
  if (!board.children.length) return;
  const { S, gap } = solveCellAndGaps();
  cellPx = S; colGap = gap; rowGap = gap;
  iconPx = Math.max(12, Math.floor(cellPx * 0.74));
  textPx = Math.max(12, Math.floor(cellPx * 0.72));

  board.style.display='grid';
  board.style.gridTemplateColumns = `repeat(${cfg.w}, ${cellPx}px)`;
  board.style.gridAutoRows = `${cellPx}px`;
  board.style.columnGap = `${colGap}px`;
  board.style.rowGap = `${rowGap}px`;

  const boardW = cfg.w*cellPx + (cfg.w-1)*colGap;
  const boardH = cfg.h*cellPx + (cfg.h-1)*rowGap;
  board.style.width  = `${boardW}px`;
  board.style.height = `${boardH}px`;

  const rPx = Math.min(10, Math.floor(cellPx*0.22), Math.floor(cellPx/3));
  Array.from(board.children).forEach(el=>{
    el.style.height = `${cellPx}px`;
    el.style.fontSize = `${textPx}px`;
    el.style.lineHeight = '1';
    el.style.borderRadius = `${rPx}px`;
  });
}
function computeDims(){
  const boardW = cfg.w*cellPx + (cfg.w-1)*colGap;
  const boardH = cfg.h*cellPx + (cfg.h-1)*rowGap;
  dims.boardW = boardW;
  dims.boardH = boardH;
  dims.viewW  = inner.clientWidth;
  dims.viewH  = inner.clientHeight;
  dims.scrollX = inner.scrollLeft;
  dims.scrollY = inner.scrollTop;
}

// ---------------- Colors ----------------
function hiddenBg(){ return cfg.highContrast ? '#0a1020' : '#121726'; }
function hiddenBorder(){ return cfg.highContrast ? '#1e2a4a' : '#2a334f'; }
function revealedBg(){ return cfg.highContrast ? '#1b2a4a' : '#18223b'; }
function flaggedBg(){ return cfg.highContrast ? '#14243f' : '#1a2438'; }

// ---------------- Build ----------------
function buildBoard(){
  board.innerHTML='';
  if (!confetti){
    confetti = makeConfetti(confettiCv, { duration:6, linger:0.4, count:300, devicePixelRatioAware:true });
  }
  for (let y=0;y<cfg.h;y++){
    for (let x=0;x<cfg.w;x++){
      const d=document.createElement('div');
      d.className='ms-cell';
      Object.assign(d.style,{
        border:`1px solid ${hiddenBorder()}`,
        background:hiddenBg(),
        display:'grid',
        placeItems:'center',
        fontWeight:'900',
        cursor:'pointer',
        userSelect:'none',
        transition:'transform .06s ease, background .12s ease, box-shadow .12s ease, border-color .12s ease',
        padding:'0',
        boxShadow:'0 1px 0 rgba(255,255,255,.03) inset',
        boxSizing:'border-box',
        fontSize:`${textPx}px`,
        lineHeight:'1'
      });
      d.dataset.x=x; d.dataset.y=y;
      d.addEventListener('mouseenter', ()=>{
        hoverCell = { x, y };
        d.style.boxShadow='0 0 0 3px rgba(255,255,255,.16) inset';
      });
      d.addEventListener('mouseleave', ()=>{
        if (hoverCell && hoverCell.x===x && hoverCell.y===y) hoverCell = null;
        d.style.boxShadow='0 1px 0 rgba(255,255,255,.03) inset';
      });
      board.appendChild(d);
    }
  }

  layoutSquare();
  drawAll();
  updateBadges();
}

// ---------------- Input ----------------
let pressCell=null, longPressT=null, longPressFor=null;
let hoverCell = null; // last hovered cell for Space = right-click

function onPointerDown(e){
  const cell = e.target.closest('.ms-cell');
  if (!cell || !alive || paused || won) return;
  const x=+cell.dataset.x, y=+cell.dataset.y;

  if (e.button===0 && state[y][x]!==1){
    pressCell={x,y}; drawCell(x,y);
  }
  if (e.pointerType==='touch'){
    clearTimeout(longPressT);
    longPressFor={x,y};
    longPressT=setTimeout(()=>{ longPressT=null; longPressFor=null; pushHistory(); cycleMark(x,y,true); }, cfg.longPressMS);
  }
}
function onPointerUp(e){
  const cell = e.target.closest('.ms-cell');
  if (!cell || !alive || paused || won) { resetPress(); return; }
  const x=+cell.dataset.x, y=+cell.dataset.y;

  if (e.button===0 && e.ctrlKey){
    const evt=new Event('contextmenu',{bubbles:true,cancelable:true}); cell.dispatchEvent(evt); resetPress(); return;
  }
  if (e.pointerType==='touch' && longPressFor && longPressT==null){ resetPress(); return; }
  if (e.pointerType==='touch' && longPressT){ clearTimeout(longPressT); longPressT=null; longPressFor=null; }

  if (e.button===0){
    pushHistory();
    if (state[y][x]===2 || state[y][x]===3) setMark(x,y,0,true);
    else reveal(x,y,true);
  }
  resetPress();
}
function resetPress(){
  if (pressCell){ const {x,y}=pressCell; pressCell=null; drawCell(x,y); }
  if (longPressT){ clearTimeout(longPressT); longPressT=null; }
  longPressFor=null;
}

// Spacebar = right-click on hovered cell
function onKeyDown(e){
  if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar'){
    if (!hoverCell || !alive || paused || won) return;
    e.preventDefault();
    const { x, y } = hoverCell;
    pushHistory();
    cycleMark(x,y,true);
    resetPress();
  }
}
window.addEventListener('keydown', onKeyDown);

function drawCell(x,y,animate=false){
  const el = board.children[y*cfg.w + x];
  const st = state[y][x];
  el.innerHTML=''; el.textContent='';
  el.style.transform = (pressCell && pressCell.x===x && pressCell.y===y) ? 'translateY(1px) scale(0.985)' : '';
  el.style.fontSize = `${textPx}px`;

  if (!alive && grid[y][x]===-1){
    el.style.background = revealedBg();
    el.style.borderColor = '#d14545';
    el.style.color = '#f5f7ff';
    el.innerHTML = ICON.mineSVG(iconPx);
    return;
  }
  if (st===0){
    el.style.background = hiddenBg(); el.style.borderColor=hiddenBorder(); el.style.color='#dfe6f3';
  } else if (st===2){
    el.style.background = flaggedBg(); el.style.borderColor='#e6b24f'; el.style.color='#ffd476'; el.innerHTML=ICON.flagSVG(iconPx);
  } else if (st===3){
    el.style.background = cfg.highContrast ? '#122036' : '#1a2133';
    el.style.borderColor = '#6b7899'; el.style.color='#9daccc'; el.textContent = cfg.colorBlind ? '？' : '?';
  } else {
    el.style.background = revealedBg(); el.style.borderColor='#334166';
    const v=grid[y][x];
    if (v>0){
      const color=cfg.highContrast?boost(NUMC[v],1.18):NUMC[v];
      el.style.color=color; el.style.fontWeight='900'; el.textContent = cfg.colorBlind?`${v} ${GLYPH[v]||''}`:String(v);
    }
    if (animate){
      el.animate(
        [{ transform:'rotateX(60deg) scale(0.96)', opacity:0.2 },
         { transform:'rotateX(0deg)  scale(1)',   opacity:1 }],
        { duration:120, easing:'ease-out' }
      );
    }
  }
  if (won && st===1 && grid[y][x]!==-1){
    el.style.background='linear-gradient(180deg, '+revealedBg()+', #20335e)';
  }
}
function drawAll(){ for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++) drawCell(x,y); }

// ---------------- Core logic (seeded) ----------------
function initArrays(){
  enforceSquareDims();
  grid  = Array.from({length:cfg.h},()=>Array(cfg.w).fill(0));
  state = Array.from({length:cfg.h},()=>Array(cfg.w).fill(0));
  flags=0; firstClick=true; alive=true; won=false; pressCell=null;
  penaltyMs=0; hintsUsed=0;
  history=[]; if (!isReplaying) replay=[];
  rng=Math.random; gameSeed=null;
  stopTimer(); setTimer(0);
}
function placeMines(sx,sy){
  const forbid=new Set([sy*cfg.w+sx]);
  if (cfg.safeZero){ for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const nx=sx+dx, ny=sy+dy; if (inb(nx,ny)) forbid.add(ny*cfg.w+nx); } }
  const cells=[]; for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){ const id=y*cfg.w+x; if(!forbid.has(id)) cells.push([x,y]); }
  for(let i=cells.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const t=cells[i]; cells[i]=cells[j]; cells[j]=t; }
  for (let i=0;i<cfg.mines;i++){ const [x,y]=cells[i]; grid[y][x]=-1; }
  for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){
    if (grid[y][x]===-1) continue;
    let c=0; eachN(x,y,(nx,ny)=>{ if(grid[ny][nx]===-1) c++; }); grid[y][x]=c;
  }
  if (cfg.safeZero && grid[sy][sx]!==0){
    const far=[]; for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){ if (Math.abs(x-sx)>2 || Math.abs(y-sy)>2) far.push([x,y]); }
    const neigh=[]; eachN(sx,sy,(nx,ny)=>{ if(grid[ny][nx]===-1) neigh.push([nx,ny]); });
    let k=0;
    while (neigh.length && k<50){
      k++; const [mx,my]=neigh.pop(); let ok=false;
      for (let tries=0; tries<far.length; tries++){
        const [fx,fy]=far[(rng()*far.length)|0];
        if (grid[fy][fx]!==-1){ grid[my][mx]=0; grid[fy][fx]=-1; ok=true; break; }
      }
      if (!ok) break;
    }
    for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){
      if (grid[y][x]===-1) continue;
      let c=0; eachN(x,y,(nx,ny)=>{ if(grid[ny][nx]===-1) c++; }); grid[y][x]=c;
    }
  }
}
function eachN(x,y,fn){ for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ if(!dx && !dy) continue; const nx=x+dx, ny=y+dy; if (nx>=0 && ny>=0 && nx<cfg.w && ny<cfg.h) fn(nx,ny); } }
function inb(x,y){ return x>=0 && y>=0 && x<cfg.w && y<cfg.h; }

function reveal(x,y,animate=false){
  if (!alive || paused || won) return;
  if (state[y][x]===2 || state[y][x]===3) return;
  if (firstClick){
    if (pendingSeed != null) {
      setSeed(pendingSeed);
      gameSeed = pendingSeed;
    } else {
      gameSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
      setSeed(gameSeed);
    }
    placeMines(x,y);

    // One-shot replay/import seed: after using it once, go back to fresh randomness
    pendingSeed = null;

    firstClick=false; startedAt=performance.now(); startTimer();
  }
  if (state[y][x]===1) return;

  if (!isReplaying) replay.push({t:nowMs(), type:'r', x, y});

  if (grid[y][x]===-1){
    alive=false; stopTimer();
    auraLocked = true; auraScore = 0; updateAuraBadge();
    for (let yy=0;yy<cfg.h;yy++){
      for (let xx=0;xx<cfg.w;xx++){
        if (grid[yy][xx]===-1 && state[yy][xx]!==2){
          state[yy][xx] = 0;
        }
      }
    }
    drawAll();
    explodeAt(x,y);
    lastGameSeed=gameSeed;
    api.setNote('Boom. New run?');
    updateBadges();
    enableReplayIfAny();
    return;
  }

  const q=[[x,y]], seen=new Set();
  while(q.length){
    const [cx,cy]=q.pop(); const key=cy*cfg.w+cx; if(seen.has(key)) continue; seen.add(key);
    if (state[cy][cx]===1) continue; state[cy][cx]=1; drawCell(cx,cy,animate);
    if (grid[cy][cx]===0){ eachN(cx,cy,(nx,ny)=>{ if (state[ny][nx]!==1) q.push([nx,ny]); }); }
  }

  if (checkWin()) onWin(); else { updateBadges(); recomputeAura('reveal'); }
}
function setMark(x,y,newMark,animate=false){
  const prev=state[y][x]; if (prev===1) return;
  if (prev===newMark){ drawCell(x,y,animate); return; }
  if (prev===2) flags--; if (newMark===2) flags++; state[y][x]=newMark; drawCell(x,y,animate); updateBadges();
  if (!isReplaying) replay.push({t:nowMs(), type:'m', x, y});
}
function cycleMark(x,y,animate=false){
  const st=state[y][x]; if (st===1) return;
  if (!cfg.questionMarks){ setMark(x,y, st===2 ? 0 : 2, animate); }
  else { if (st===0) setMark(x,y,2,animate); else if (st===2) setMark(x,y,3,animate); else setMark(x,y,0,animate); }
}
function chordAt(x,y,animate=false){
  if (!cfg.chord || state[y][x]!==1) return;
  const need=grid[y][x]; if (need<=0) return;
  let f=0; eachN(x,y,(nx,ny)=>{ if(state[ny][nx]===2) f++; }); if (f!==need) return;

  if (!isReplaying) replay.push({t:nowMs(), type:'c', x, y});

  let died=false; const reveals=[];
  eachN(x,y,(nx,ny)=>{
    if (state[ny][nx]===0){
      if (grid[ny][nx]===-1){
        died=true;
      } else {
        reveals.push([nx,ny]);
      }
    }
  });
  if (died){
    alive=false; stopTimer();
    auraLocked = true; auraScore = 0; updateAuraBadge();
    for (let yy=0;yy<cfg.h;yy++){
      for (let xx=0;xx<cfg.w;xx++){
        if (grid[yy][xx]===-1 && state[yy][xx]!==2){
          state[yy][xx] = 0;
        }
      }
    }
    drawAll();
    lastGameSeed=gameSeed;
    api.setNote('Boom. New run?');
    updateBadges();
    enableReplayIfAny();
    return;
  }
  for (const [rx,ry] of reveals) reveal(rx,ry,animate);
}
function checkWin(){ for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){ if (grid[y][x]!==-1 && state[y][x]!==1) return false; } return true; }
function onWin(){
  won=true; alive=false; stopTimer();
  recomputeAura('win');
  for (let yy=0;yy<cfg.h;yy++) for (let xx=0;xx<cfg.w;xx++){ if (grid[yy][xx]===-1 && state[yy][xx]!==2){ state[yy][xx]=2; flags++; } }
  drawAll(); confetti?.play({ count:380, duration:6.0, linger:0.45 });

  const elapsed=getElapsedMs();
  const auraVal = auraLocked ? 0 : clamp(Math.round(auraScore),0,100);
  let tail='';
  if (timerMode==='limit'){
    if (!auraLocked && elapsed <= timeLimitMs && timeLimitMs>0){
      tail = ` • Aura ${auraVal}/100 (${auraTitle(auraVal)} — in time)`;
    } else {
      tail = ` • Aura 0/100 (overtime)`;
    }
  } else if (auraPotential>0){
    tail = ` • Aura ${auraVal}/100 (${auraTitle(auraVal)})`;
  }
  api.setNote(`Clear! ${fmtTime(elapsed)}${tail}`);
  saveBest(elapsed);
  saveLeaderboard(elapsed);
  lastGameSeed=gameSeed; updateBadges(); enableReplayIfAny();
}

// ---------------- Timer ----------------
function startTimer(){
  stopTimer();
  timerId=setInterval(()=>{
    if (!alive || paused || won) return;
    if (isReplaying){
      setTimer(replayVirtualMs);
    } else {
      const elapsed = getElapsedMs();
      if (timerMode==='limit' && timeLimitMs>0){
        updateTimerAndCountdown(elapsed);
      } else {
        setTimer(elapsed);
      }
    }
  },200);
}
function stopTimer(){ if (timerId){ clearInterval(timerId); timerId=0; } }
function getElapsedMs(){ return (performance.now()-startedAt)+penaltyMs; }
function setTimer(ms){ timerBadge.textContent=`⏱ ${fmtTime(ms)}`; }

function updateTimerAndCountdown(elapsed){
  const baseText = fmtTime(elapsed);
  const remaining = timeLimitMs - elapsed;
  if (remaining > 0){
    const sec = Math.max(0, Math.floor(remaining/1000));
    const m = Math.floor(sec/60), s = sec%60;
    timerBadge.textContent = `⏱ ${baseText} • ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} left`;
    timerBadge.style.color = (sec<=10 ? '#ff8a80' : '');
    if (sec<=10 && sec>0 && sec!==lastCountdownSec){
      lastCountdownSec = sec;
      showCountdownNumber(sec);
      shakeWrap();
    }
    if (!auraLocked) recomputeAura('tick');
  } else {
    timerBadge.textContent = `⏱ ${baseText} • Overtime`;
    timerBadge.style.color = '#ff8a80';
    if (!timeExpiredShown){
      onTimeExpired();
    }
  }
}

// ---------------- Badges / buttons ----------------
function updateBadges(){
  minesBadge.textContent=`Mines: ${Math.max(0, cfg.mines - flags)}`;
  updateHintsBadge();
  updateAuraBadge();
}
function updateHintsBadge(){
  if (!cfg.allowHints || hintsMode==='off'){
    hintsBadge.textContent = 'Hints: —';
  } else if (!isFinite(hintsAllowed)){
    hintsBadge.textContent = `Hints: ${hintsUsed}`;
  } else {
    const rem = Math.max(0, hintsAllowed - hintsUsed);
    hintsBadge.textContent = `Hints: ${rem} / ${hintsAllowed}`;
  }
}
function updateAuraBadge(){
  if (auraPotential<=0){
    auraBadge.textContent='Aura: —';
    return;
  }
  const val = auraLocked ? 0 : clamp(Math.round(auraScore),0,100);
  auraBadge.textContent = `Aura: ${val}/100`;
}
function auraTitle(score){
  if (score>=90) return 'Legendary run';
  if (score>=70) return 'Strong run';
  if (score>=40) return 'Solid run';
  return 'Shaky run';
}

function enableReplayIfAny(){
  const ok = replay.length > 0;
  replayBtn.disabled = !ok;
  replayBtn.style.opacity = ok ? 1 : .6;
}

function saveBest(elapsed){
  try {
    const key = bestKey();
    const best = load('mines', key, null);
    if (best == null || elapsed < best){
      save('mines', key, elapsed);
    }
  } catch (e) {
    console.error('saveBest failed', e);
  }
}

function saveLeaderboard(elapsed){
  try {
    const key = leaderboardKey();
    const entry = {
      t: elapsed,
      ts: Date.now(),
      diff: runCfg?.difficulty || 'Custom',
      size: cfg.w,
      mines: cfg.mines
    };
    const lb = load('mines', key, []) || [];
    lb.push(entry);
    lb.sort((a,b)=>a.t-b.t);
    const trimmed = lb.slice(0, 20);
    save('mines', key, trimmed);
  } catch (e) {
    console.error('saveLeaderboard failed', e);
  }
}


// ---------------- Settings (preferences-only) ----------------
function openSettings(){
  const host=document.fullscreenElement || wrap;
  if (settingsOverlay.parentElement!==host){ settingsOverlay.remove(); host.appendChild(settingsOverlay); }
  Object.assign(settingsOverlay.style,{ position:'absolute', inset:'0' });

  settingsCard.innerHTML='';
  const h1=document.createElement('div'); h1.textContent='Settings'; h1.style.fontSize='20px'; h1.style.fontWeight='800'; h1.style.marginBottom='8px';

  const form=document.createElement('div'); form.style.display='grid'; form.style.gridTemplateColumns='1fr'; form.style.gap='12px';

  // Visual
  const visualTitle = document.createElement('div');
  visualTitle.textContent = 'Visual';
  visualTitle.style.fontWeight='800';
  const hcRow = checkboxRow('High contrast board', cfg.highContrast);
  const cbRow = checkboxRow('Colorblind-friendly numerals', cfg.colorBlind);

  // Gameplay feel (does not reset run; some affect only future runs)
  const gameplayTitle = document.createElement('div');
  gameplayTitle.textContent = 'Gameplay';
  gameplayTitle.style.fontWeight='800';
  const safeRow = checkboxRow('Safe first area (zero-ish start)', cfg.safeZero);
  const chordRow = checkboxRow('Chord (double-click numbers)', cfg.chord);
  const qmRow   = checkboxRow('Question marks (third click)', cfg.questionMarks);

  const tileRow = rangeRow('Preferred tile size', cfg.tileSize, 12, 96, 1, v=>`${v} px`);

  // Long-press for touch
  const lpRow = document.createElement('div');
  Object.assign(lpRow.style,{display:'grid',gridTemplateColumns:'1fr auto',alignItems:'center',gap:'8px'});
  const lpLab=document.createElement('div'); lpLab.textContent='Long-press to flag (touch)'; lpLab.style.fontWeight='600';
  const lpInput=document.createElement('input'); lpInput.type='number'; lpInput.min='200'; lpInput.max='2000'; lpInput.step='50';
  lpInput.value = String(cfg.longPressMS);
  lpInput.style.width='80px';
  const lpSuffix=document.createElement('span'); lpSuffix.textContent='ms';
  const lpWrap=document.createElement('div'); Object.assign(lpWrap.style,{display:'flex',gap:'6px',alignItems:'center'}); lpWrap.append(lpInput, lpSuffix);
  lpRow.append(lpLab, lpWrap);

  form.append(
    visualTitle,
    hcRow.row,
    cbRow.row,
    gameplayTitle,
    safeRow.row,
    chordRow.row,
    qmRow.row,
    tileRow.row,
    lpRow
  );

  const btns=document.createElement('div'); Object.assign(btns.style,{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'8px' });
  const cancelB=pill('Cancel', ()=> closeSettings(), 'ghost');
  const saveB  =pill('Save', ()=> {
    cfg.highContrast = !!hcRow.input.checked;
    cfg.colorBlind   = !!cbRow.input.checked;
    cfg.safeZero     = !!safeRow.input.checked;
    cfg.chord        = !!chordRow.input.checked;
    cfg.questionMarks= !!qmRow.input.checked;
    cfg.tileSize     = Number(tileRow.input.value) || cfg.tileSize;
    cfg.longPressMS  = clamp(parseInt(lpInput.value)||cfg.longPressMS, 200, 2000);
    save('mines','settings',cfg);
    closeSettings();
    layoutSquare();
    layoutGrid();
    drawAll();
    refreshMinimap();
  });
  btns.append(cancelB,saveB);

  settingsCard.append(h1, form, btns);
  settingsOverlay.style.display='grid';

  const onClick=(e)=>{ if (e.target===settingsOverlay) closeSettings(); };
  const onKey=(e)=>{ if (e.key==='Escape') closeSettings(); };
  settingsOverlay.addEventListener('click', onClick, { once:true });
  document.addEventListener('keydown', onKey, { once:true });
}
function closeSettings(){ settingsOverlay.style.display='none'; }
function labelWrap(label,node){ const row=document.createElement('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'1fr',gap:'6px'}); const lab=document.createElement('div'); lab.textContent=label; lab.style.fontWeight='700'; row.append(lab,node); return row; }
function rangeRow(label,value,min,max,step,fmt){
  const row=document.createElement('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'1fr auto',alignItems:'center',gap:'8px'});
  const lab=document.createElement('div'); lab.textContent=label; lab.style.fontWeight='600';
  const inputWrap=document.createElement('div'); Object.assign(inputWrap.style,{display:'flex',gap:'10px',alignItems:'center'});
  const r=document.createElement('input'); Object.assign(r,{type:'range',min,max,step,value:String(value)}); r.style.width='200px';
  const out=document.createElement('span'); out.textContent=fmt(value); out.style.minWidth='62px';
  r.addEventListener('input',()=> out.textContent=fmt(Number(r.value)));
  inputWrap.append(r,out); row.append(lab,inputWrap);
  return {row, input:r};
}
function checkboxRow(label,checked){
  const row=document.createElement('div'); Object.assign(row.style,{display:'grid',gridTemplateColumns:'1fr auto',alignItems:'center',gap:'8px'});
  const lab=document.createElement('div'); lab.textContent=label; lab.style.fontWeight='600';
  const c=document.createElement('input'); c.type='checkbox'; c.checked=!!checked;
  row.append(lab,c); return {row, input:c};
}

// ---------------- Pause / Restart / Run setup ----------------
function togglePause(){
  if (!alive || won || firstClick) return;
  paused = !paused;
  veil.style.display = paused ? 'grid' : 'none';
}

function restart(){
  // Start a fresh run with current runCfg (no overlay)
  applyRunCfgToGame();
  initArrays();
  buildBoard();
  const best = load('mines', bestKey(), null);
  const auraLine = auraPotential>0 ? `Aura potential: ${Math.round(auraPotential)}/100` : '';
  const auraInfo = auraLine ? ` • ${auraLine}` : '';
  api.setNote(best? `Best: ${fmtTime(best)}${auraInfo}` : (cfg.daily? `Daily challenge ready${auraInfo}` : `Good luck!${auraInfo}`));
  if (!settingsOverlay.parentElement) wrap.appendChild(settingsOverlay);
  if (!uploadOverlay.parentElement) wrap.appendChild(uploadOverlay);
  if (!runOverlay.parentElement) wrap.appendChild(runOverlay);

  if (isReplaying) rcBar.style.display='flex'; else rcBar.style.display='none';
  enableReplayIfAny();
}

// ---------------- Undo / Hint ----------------
function pushHistory(){
  if (!cfg.allowUndo || isReplaying) return;
  const stateCopy = state.map(r=>r.slice());
  history.push({ state:stateCopy, flags, firstClick, alive, won, startedAt, penaltyMs, gameSeed, hintsUsed, auraScore, auraLocked });
  if (history.length>64) history.shift();
}
function undo(){
  if (!cfg.allowUndo || !history.length) return;
  const h=history.pop();
  state=h.state.map(r=>r.slice());
  flags=h.flags; firstClick=h.firstClick; alive=h.alive; won=h.won; startedAt=h.startedAt; penaltyMs=h.penaltyMs; gameSeed=h.gameSeed;
  hintsUsed = h.hintsUsed ?? hintsUsed;
  auraScore = h.auraScore ?? auraScore;
  auraLocked= !!h.auraLocked;
  drawAll(); if (!alive || won) stopTimer(); else startTimer(); api.setNote('Undid last action'); updateBadges();
}

// Smarter hint logic: try deductions first, then frontier safe cells
function findLogicalHints(){
  const moves = [];
  const safeSeen = new Set();
  const mineSeen = new Set();

  for (let y=0;y<cfg.h;y++){
    for (let x=0;x<cfg.w;x++){
      if (state[y][x] !== 1) continue;
      const clue = grid[y][x];
      if (clue <= 0) continue;

      const hidden = [];
      let flagged = 0;
      eachN(x,y,(nx,ny)=>{
        const st = state[ny][nx];
        if (st === 0 || st === 3) hidden.push([nx,ny]);
        else if (st === 2) flagged++;
      });

      if (!hidden.length) continue;
      const remaining = clue - flagged;

      // All remaining neighbors are mines
      if (remaining === hidden.length){
        for (const [hx,hy] of hidden){
          if (state[hy][hx] !== 0) continue;
          const key = `${hx},${hy}`;
          if (!mineSeen.has(key)){
            mineSeen.add(key);
            moves.push({ type:'flag', x:hx, y:hy });
          }
        }
      }
      // All hidden neighbors are safe
      else if (remaining === 0){
        for (const [hx,hy] of hidden){
          const key = `${hx},${hy}`;
          if (!safeSeen.has(key)){
            safeSeen.add(key);
            moves.push({ type:'reveal', x:hx, y:hy });
          }
        }
      }
    }
  }
  return moves;
}

function hint(){
  if (!cfg.allowHints || hintsMode==='off'){
    api.setNote('Hints are disabled for this run');
    return;
  }
  if (hintsMode==='limited' && isFinite(hintsAllowed) && hintsUsed>=hintsAllowed){
    api.setNote('No hints remaining');
    return;
  }
  if (!alive || paused || won) return;

  let move = null;

  // 1) Try pure logic based on current numbers
  const logical = findLogicalHints();
  if (logical.length){
    move = logical[(Math.random()*logical.length)|0];
  } else {
    // 2) Fall back to a safe cell, preferring the frontier near revealed numbers
    const frontierSafe = [];
    const otherSafe = [];

    for (let y=0;y<cfg.h;y++){
      for (let x=0;x<cfg.w;x++){
        if (state[y][x]!==0 || grid[y][x]===-1) continue;
        let nearRevealed = false;
        eachN(x,y,(nx,ny)=>{ if (state[ny][nx]===1) nearRevealed = true; });
        (nearRevealed ? frontierSafe : otherSafe).push([x,y]);
      }
    }

    const pool = frontierSafe.length ? frontierSafe : otherSafe;
    if (pool.length){
      const [hx,hy] = pool[(Math.random()*pool.length)|0];
      move = { type:'reveal', x:hx, y:hy };
    }
  }

  if (!move){
    api.setNote('No hints available right now');
    return;
  }

  pushHistory();
  const add = cfg.hintPenaltyBaseMs * Math.pow(2, Math.max(0, hintsUsed));
  penaltyMs += add;
  hintsUsed++;

  if (move.type === 'reveal'){
    reveal(move.x, move.y, true);
  } else if (move.type === 'flag'){
    setMark(move.x, move.y, 2, true);
  }

  updateHintsBadge();
  recomputeAura('hint');
  api.setNote(`Hint used (+${(add/1000).toFixed(1)}s)`);
}

function nowMs(){ return performance.now() - startedAt; }

// ---------------- Replay (clean, minimal) ----------------
function onReplayButton(){
  if (!replay.length){ api.setNote('No replay yet. Finish a game or import one.'); return; }
  if (!isReplaying) beginReplaySession(false); // do not auto-play
  rcBar.style.display='flex';
}

function beginReplaySession(autoplay){
  replaySeq = replay.slice();
  replayIdx = 0;
  replayVirtualMs = 0;
  replaySnaps = [];
  isReplaying = true;
  pendingSeed = (lastGameSeed!=null ? lastGameSeed : gameSeed);

  // Build board for this seed (use current runCfg dimensions/mines)
  restart();
  stopTimer(); setTimer(0);

  // initial snapshot (before any event)
  snapshotPush();

  // Controls state
  rcBar.style.display='flex';
  rcPlay.textContent = autoplay ? 'Pause' : 'Play';
  replayPlaying = !!autoplay;
  nextDueAt = 0; cancelReplayRAF();

  const dim = replayLive ? 0.5 : 1;
  rcSpeed.disabled = replayLive;
  rcSpeed.style.opacity = dim;
  rcSpeedLbl.style.opacity = dim;

  if (replayPlaying) scheduleNextTick();
  window.addEventListener('keydown', onReplayKey, { passive:true });
}
function endReplaySession(){
  isReplaying=false;
  replayPlaying=false;
  cancelReplayRAF();
  pendingSeed = null; // ensure future runs are fresh-random again
  window.removeEventListener('keydown', onReplayKey);
}
function onReplayKey(e){
  if (rcBar.style.display!=='flex') return;
  if (e.key==='ArrowRight') replayStep(1);
  else if (e.key==='ArrowLeft') replayStep(-1);
}

function toggleReplayPlay(){
  if (!isReplaying){
    if (!replay.length){ api.setNote('No replay to play'); return; }
    beginReplaySession(true);
    return;
  }
  if (replayIdx >= replaySeq.length){
    beginReplaySession(true);
    return;
  }
  replayPlaying = !replayPlaying;
  rcPlay.textContent = replayPlaying ? 'Pause' : 'Play';
  if (replayPlaying) scheduleNextTick(); else cancelReplayRAF();
}

function toggleLive(){
  replayLive = !replayLive;
  rcLive.textContent = replayLive ? 'Live: On' : 'Live: Off';

  const dim = replayLive ? 0.5 : 1;
  rcSpeed.disabled = replayLive;
  rcSpeed.style.opacity = dim;
  rcSpeedLbl.style.opacity = dim;

  if (replayPlaying){
    scheduleNextTick();
  }
}

function scheduleNextTick(){
  if (replayIdx >= replaySeq.length){ replayPlaying=false; rcPlay.textContent='Play'; cancelReplayRAF(); return; }
  const prevT = (replayIdx>0 ? replaySeq[replayIdx-1].t : (replaySeq[0]?.t ?? 0));
  const dtRecorded = Math.max(0, replaySeq[replayIdx].t - prevT);
  const delay = replayLive ? dtRecorded : Math.max(16, Math.round(dtRecorded / replaySpeed));
  nextDueAt = performance.now() + delay;
  cancelReplayRAF();
  replayRaf = requestAnimationFrame(replayTick);
}
function replayTick(now){
  if (!replayPlaying || !isReplaying){ cancelReplayRAF(); return; }
  if (now < nextDueAt){ replayRaf = requestAnimationFrame(replayTick); return; }
  if (replayIdx < replaySeq.length){
    const ev = replaySeq[replayIdx];
    const prevT = (replayIdx>0 ? replaySeq[replayIdx-1].t : (replaySeq[0]?.t ?? 0));
    const dtRecorded = Math.max(0, ev.t - prevT);
    const appliedDelay = replayLive ? dtRecorded : Math.max(16, Math.round(dtRecorded / replaySpeed));
    replayVirtualMs += appliedDelay;
    setTimer(replayVirtualMs);
    applyEvent(ev); snapshotPush();
    replayIdx++;
  }
  if (!alive){
    replayPlaying=false; rcPlay.textContent='Play'; cancelReplayRAF(); return;
  }
  if (replayIdx >= replaySeq.length){
    replayPlaying=false; rcPlay.textContent='Play'; cancelReplayRAF(); return;
  }
  scheduleNextTick();
}

function cancelReplayRAF(){ if (replayRaf){ cancelAnimationFrame(replayRaf); replayRaf=0; } }

function replayStep(dir){
  if (!isReplaying){
    if (!replay.length){ api.setNote('No replay loaded'); return; }
    beginReplaySession(false);
  }
  replayPlaying=false; rcPlay.textContent='Play'; cancelReplayRAF();
  if (dir>0){
    if (replayIdx>=replaySeq.length) return;
    const ev = replaySeq[replayIdx];
    const prevT = (replayIdx>0 ? replaySeq[replayIdx-1].t : (replaySeq[0]?.t ?? 0));
    const dtRecorded = Math.max(0, ev.t - prevT);
    const appliedDelay = replayLive ? dtRecorded : Math.max(16, Math.round(dtRecorded / replaySpeed));
    replayVirtualMs += appliedDelay;
    setTimer(replayVirtualMs);
    applyEvent(ev); snapshotPush(); replayIdx++;
  } else if (dir<0){
    if (replayIdx<=0 || replaySnaps.length<=1) return;
    replaySnaps.pop();
    const snap = replaySnaps[replaySnaps.length-1];
    state=snap.state.map(r=>r.slice());
    flags=snap.flags; firstClick=snap.firstClick; alive=snap.alive; won=snap.won; startedAt=snap.startedAt; penaltyMs=snap.penaltyMs; gameSeed=snap.gameSeed;
    replayIdx = Math.max(0, replayIdx-1);
    const tAt = (replayIdx>0 ? replaySeq[replayIdx-1].t : 0);
    replayVirtualMs = tAt; setTimer(replayVirtualMs);
    drawAll(); updateBadges();
  }
}

function replayJump(where){
  if (!replay.length){
    api.setNote('No replay loaded');
    return;
  }

  beginReplaySession(false);
  replayPlaying = false;
  rcPlay.textContent = 'Play';
  cancelReplayRAF();

  if (where === 'start'){
    replayIdx = 0;
    replayVirtualMs = 0;
    setTimer(0);
    drawAll();
    updateBadges();
    return;
  }

  if (where === 'end'){
    replaySnaps = [];
    snapshotPush(); // initial
    for (let i=0;i<replaySeq.length;i++){
      applyEvent(replaySeq[i]);
      snapshotPush();
    }
    replayIdx = replaySeq.length;
    replayVirtualMs = replaySeq.length ? replaySeq[replaySeq.length-1].t : 0;
    setTimer(replayVirtualMs);
    drawAll();
    updateBadges();
  }
}

function applyEvent(ev){
  if (ev.type==='r') reveal(ev.x,ev.y,true);
  else if (ev.type==='c') chordAt(ev.x,ev.y,true);
  else if (ev.type==='m') cycleMark(ev.x,ev.y,true);
}

function snapshotPush(){
  const snapState=state.map(r=>r.slice());
  replaySnaps.push({ state:snapState, flags, firstClick, alive, won, startedAt, penaltyMs, gameSeed });
  if (replaySnaps.length>512) replaySnaps.shift();
}

// ---------------- Share / Download / Upload ----------------
function toggleShareMenu(){
  shareMenu.style.display = (shareMenu.style.display==='none' || !shareMenu.style.display) ? 'block' : 'none';
}
function doCopyShare(){
  if (!replay.length){ api.setNote('No replay to share'); return; }
  const text = `mines://replay/${encodeReplayPayload(makePayload())}`;
  if (navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(()=> api.setNote('Replay link copied')).catch(()=> promptFallback(text));
  } else promptFallback(text);
  function promptFallback(str){ try{ window.prompt('Copy replay link:', str); }catch{} }
}
function doSystemShare(){
  if (!replay.length){ api.setNote('No replay to share'); return; }
  const text = `mines://replay/${encodeReplayPayload(makePayload())}`;
  if (navigator.share){ navigator.share({ text }).catch(()=>{}); }
  else api.setNote('System share not available');
}
function downloadReplay(){
  if (!replay.length){ api.setNote('No replay to download'); return; }
  const blob=new Blob([JSON.stringify(makePayload())],{type:'application/json'});
  const a=document.createElement('a');
  const ts=new Date(); const pad=n=>String(n).padStart(2,'0');
  const name=`mines_replay_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.minesreplay`;
  a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0);
  api.setNote('Replay downloaded');
}

function makePayload(){
  return {
    v:1,
    s:(lastGameSeed!=null?lastGameSeed:gameSeed)>>>0,
    cfg: runCfg && runCfg.difficulty !== 'Custom'
      ? {preset:runCfg.difficulty}
      : {preset:'Custom', w:cfg.w, h:cfg.h, mines:cfg.mines},
    events: replay.map(e=>({t:Math.round(e.t), k:e.type, x:e.x, y:e.y}))
  };
}
function encodeReplayPayload(obj){ return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }

function openUpload(){
  const host=document.fullscreenElement || wrap;
  if (uploadOverlay.parentElement!==host){ uploadOverlay.remove(); host.appendChild(uploadOverlay); }
  uploadOverlay.style.display='grid';
}
function closeUpload(){ uploadOverlay.style.display='none'; pasteArea.value=''; fileInput.value=''; }
function importReplaySmart(text){
  try{
    let b64=null; const t=text.trim();
    if (t.startsWith('mines://replay/')) b64=t.split('mines://replay/')[1].trim();
    else { try{ const js=JSON.parse(t); if(js && js.events) b64=encodeReplayPayload(js); }catch{} if (!b64) b64=t; }
    importReplay(b64); closeUpload();
  }catch{ api.setNote('Import failed'); }
}
function importReplay(b64){
  try{
    const json=JSON.parse(decodeURIComponent(escape(atob(b64))));
    if(!json||!json.events) throw new Error('Bad replay');
    if (json.cfg?.preset){
      const preset=json.cfg.preset;
      if (preset && DIFFICULTIES[preset]){
        const def=DIFFICULTIES[preset];
        runCfg.difficulty=preset;
        runCfg.size=def.size;
        runCfg.mines=def.mines;
        runCfg.hintsMode=def.hintsMode;
        runCfg.hintsMax=def.hintsMax;
        runCfg.timeLimitMin=def.timerLimitMin;
      } else {
        runCfg.difficulty='Custom';
        runCfg.size=clamp(json.cfg.w||cfg.w,6,40);
        runCfg.mines=clamp(json.cfg.mines||cfg.mines,1,runCfg.size*runCfg.size-1);
      }
      normalizeRunCfg(runCfg);
    }
    cfg.w = runCfg.size; cfg.h=runCfg.size; cfg.mines=runCfg.mines; enforceSquareDims();
    replay=json.events.map(e=>({t:+e.t||0, type:String(e.k), x:+e.x, y:+e.y}));
    pendingSeed=(json.s>>>0)||null; lastGameSeed=pendingSeed;
    api.setNote('Replay loaded — open Replay to view');
    enableReplayIfAny();
  }catch(err){ console.error(err); api.setNote('Invalid replay'); }
}

// ---------------- Visual polish ----------------
function explodeAt(x,y){
  const el=board.children[y*cfg.w + x];
  el.animate(
    [
      { transform:'scale(1)', filter:'brightness(1)' },
      { transform:'scale(1.12)', filter:'brightness(1.9)' },
      { transform:'scale(1)', filter:'brightness(1)' }
    ],
    { duration:280, easing:'cubic-bezier(.2,.7,.2,1)' }
  );
}
function shakeWrap(){
  wrap.animate(
    [
      { transform:'translate3d(0,0,0)' },
      { transform:'translate3d(-4px,2px,0)' },
      { transform:'translate3d(4px,-2px,0)' },
      { transform:'translate3d(0,0,0)' }
    ],
    { duration:220, easing:'ease-in-out' }
  );
}
function showCountdownNumber(sec){
  timeOverlay.style.display='grid';
  timeOverlayText.style.fontSize='min(15vw, 120px)';
  timeOverlayText.style.color='#ff8a80';
  timeOverlayText.textContent=String(sec);
}
function onTimeExpired(){
  timeExpiredShown = true;
  auraLocked = true;
  auraScore = 0;
  updateAuraBadge();
  timeOverlay.style.display='grid';
  timeOverlayText.style.fontSize='min(7vw, 54px)';
  timeOverlayText.style.color='#ff8a80';
  timeOverlayText.textContent = `Time's up —\nyou can keep going,\nbut aura won’t increase anymore.`;
  setTimeout(()=>{
    if (timeExpiredShown){
      timeOverlay.style.display='none';
    }
  }, 2200);
}

// ---------------- Minimap ----------------
let mmDragging=false, mmRect={x:0,y:0,w:0,h:0};
function refreshMinimap(){ drawMinimapBase(); drawMinimapViewport(); mmViewport.style.cursor = ((dims.boardW>dims.viewW)||(dims.boardH>dims.viewH))?'grab':'default'; }
function drawMinimapBase(){
  const ctx=mmCanvas.getContext('2d'); const W=mmCanvas.width,H=mmCanvas.height; ctx.clearRect(0,0,W,H);
  const pad=6; ctx.save(); ctx.strokeStyle='rgba(255,255,255,.18)'; ctx.lineWidth=1; ctx.strokeRect(pad,pad,W-2*pad,H-2*pad); ctx.restore();
  ctx.save(); ctx.fillStyle='rgba(255,255,255,.06)'; ctx.fillRect(pad,pad,W-2*pad,H-2*pad); ctx.restore();
}
function drawMinimapViewport(){
  const W=mmCanvas.width,H=mmCanvas.height,pad=6;
  const sx=(W-pad*2)/Math.max(1,dims.boardW), sy=(H-pad*2)/Math.max(1,dims.boardH);
  const vx=pad + dims.scrollX*sx, vy=pad + dims.scrollY*sy, vw=Math.max(8,dims.viewW*sx), vh=Math.max(8,dims.viewH*sy);
  mmRect={x:vx,y:vy,w:vw,h:vh}; Object.assign(mmViewport.style,{ left:`${vx}px`, top:`${vy}px`, width:`${vw}px`, height:`${vh}px` });
}
mmViewport.addEventListener('pointerdown',(e)=>{ mmDragging=true; mmViewport.setPointerCapture(e.pointerId); mmViewport.style.cursor='grabbing'; moveMiniFromEvent(e); });
mmViewport.addEventListener('pointermove',(e)=>{ if(mmDragging) moveMiniFromEvent(e); });
mmViewport.addEventListener('pointerup',(e)=>{ mmDragging=false; mmViewport.releasePointerCapture(e.pointerId); mmViewport.style.cursor='grab'; });
mmViewport.addEventListener('pointercancel',()=>{ mmDragging=false; mmViewport.style.cursor='grab'; });
function moveMiniFromEvent(e){
  const rect=mmCanvas.getBoundingClientRect(); const x=e.clientX-rect.left, y=e.clientY-rect.top;
  const pad=6, W=mmCanvas.width,H=mmCanvas.height; const mx=clamp(x,pad,W-pad), my=clamp(y,pad,H-pad);
  const sx=(W-pad*2)/Math.max(1,dims.boardW), sy=(H-pad*2)/Math.max(1,dims.boardH);
  const targetX=(mx - pad - mmRect.w/2)/Math.max(sx,0.0001), targetY=(my - pad - mmRect.h/2)/Math.max(sy,0.0001);
  inner.scrollLeft = clamp(targetX,0,Math.max(0,dims.boardW-dims.viewW));
  inner.scrollTop  = clamp(targetY,0,Math.max(0,dims.boardH-dims.viewH));
}
inner.addEventListener('scroll',()=>{ computeDims(); drawMinimapViewport(); },{ passive:true });

// ---------------- Run configuration helpers ----------------
function normalizeRunCfg(rc){
  if (!rc || typeof rc!=='object') rc = RUN_DEFAULT;
  if (!rc.difficulty) rc.difficulty = 'Average';
  if (rc.difficulty!=='Custom' && DIFFICULTIES[rc.difficulty]){
    const def = DIFFICULTIES[rc.difficulty];
    rc.size = def.size;
    rc.mines= def.mines;
    rc.hintsMode = def.hintsMode;
    rc.hintsMax  = def.hintsMax;
    if (!rc.timeLimitMin) rc.timeLimitMin = def.timerLimitMin;
  } else {
    rc.difficulty = 'Custom';
    rc.size = clamp(rc.size||16,6,40);
    rc.mines= clamp(rc.mines||40,1,rc.size*rc.size-1);
    rc.hintsMode = rc.hintsMode||'limited';
    rc.hintsMax  = clamp(rc.hintsMax||5,0,50);
    rc.timeLimitMin = clamp(rc.timeLimitMin||15,1,60);
  }
}
function computeAuraPotentialFromRunCfg(rc){
  const size = rc.size||16;
  const mines= rc.mines||40;
  const cells = size*size;
  const density = mines / cells;
  let base = 40 + Math.min(50, Math.round(cells/25)); // more tiles → more aura
  base += Math.round((density-0.15)*160); // ~15% baseline
  if (rc.hintsMode==='off') base += 12;
  else if (rc.hintsMode==='unlimited') base -= 10;
  if (rc.timerMode==='limit') base += 10;
  return clamp(base,10,100);
}
function applyRunCfgToGame(){
  normalizeRunCfg(runCfg);

  cfg.w = runCfg.size;
  cfg.h = runCfg.size;
  cfg.mines = runCfg.mines;
  enforceSquareDims();

  hintsMode = runCfg.hintsMode;
  if (hintsMode==='off'){
    cfg.allowHints=false;
    hintsAllowed=0;
  } else if (hintsMode==='limited'){
    cfg.allowHints=true;
    hintsAllowed=runCfg.hintsMax;
  } else {
    cfg.allowHints=true;
    hintsAllowed=Infinity;
  }

  timerMode = runCfg.timerMode || 'off';
  timeLimitMs = timerMode==='limit' ? (runCfg.timeLimitMin||15)*60000 : 0;
  lastCountdownSec = null;
  timeExpiredShown = false;
  timeOverlay.style.display='none';
  timerBadge.style.color = '';

  auraPotential = computeAuraPotentialFromRunCfg(runCfg);
  auraScore = auraPotential;
  auraLocked = false;

  hintsUsed = 0;
  penaltyMs = 0;

  updateBadges();
}

// Aura recomputation
function recomputeAura(reason){
  if (auraLocked || auraPotential<=0) return;
  const elapsed = getElapsedMs();
  let hintsFactor = 1;
  if (hintsMode==='limited' && isFinite(hintsAllowed) && hintsAllowed>0){
    const usedRatio = clamp(hintsUsed / hintsAllowed, 0, 1.5);
    hintsFactor = 1 - 0.6*usedRatio;
  } else if (hintsMode==='unlimited'){
    const cells = cfg.w*cfg.h;
    const usedRatio = clamp(hintsUsed / (cells*0.15), 0, 1.5);
    hintsFactor = 1 - 0.6*usedRatio;
  }
  if (hintsMode==='off') hintsFactor = 1;

  let timeFactor = 1;
  if (timerMode==='limit' && timeLimitMs>0){
    const ratio = clamp(elapsed / timeLimitMs, 0, 1.5);
    timeFactor = 1 - 0.5*ratio;
  }

  const score = auraPotential * Math.max(0.1, hintsFactor) * Math.max(0.2, timeFactor);
  auraScore = clamp(score,0,100);
  updateAuraBadge();
}

// ---------------- Run overlay (New run) ----------------
function openRunOverlay(mode){
  const host=document.fullscreenElement || wrap;
  if (runOverlay.parentElement!==host){ runOverlay.remove(); host.appendChild(runOverlay); }
  runOverlay.style.display='grid';
  runOverlay.dataset.mode = mode || 'new';

  runCard.innerHTML='';

  const title = document.createElement('div');
  title.textContent = 'New run';
  title.style.fontSize='20px';
  title.style.fontWeight='800';

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Pick how spicy you want it.';
  subtitle.style.opacity='0.8';
  subtitle.style.marginBottom='6px';

  // draft local copy
  const draft = { ...runCfg };
  normalizeRunCfg(draft);

  // Difficulty row
  const diffLabel=document.createElement('div'); diffLabel.textContent='Difficulty'; diffLabel.style.fontWeight='700';
  const diffRow=document.createElement('div');
  Object.assign(diffRow.style,{display:'grid',gridTemplateColumns:'repeat(6,minmax(0,1fr))',gap:'6px'});
  const diffs=['Basic','Easy','Average','Hard','Pro','Custom'];
  const diffBtns = diffs.map(name=>{
    const b=document.createElement('button');
    b.className='pill';
    b.textContent=name;
    b.dataset.val=name;
    b.style.width='100%';
    b.addEventListener('click',()=>{
      diffBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      draft.difficulty = name;
      applyDifficultyToDraft(draft, name, sizeInput, minesInput, hintsModeRadios, hintsMaxInput, hintsNote);
      refreshAuraPreview();
      refreshHelpLock();
    });
    diffRow.appendChild(b);
    return b;
  });

  // Board section
  const boardSection=document.createElement('div');
  Object.assign(boardSection.style,{display:'grid',gap:'6px',marginTop:'6px'});
  const boardTitle=document.createElement('div'); boardTitle.textContent='Board'; boardTitle.style.fontWeight='700';

  const sizeInputRow = rangeRow('Size (N × N)', draft.size, 6, 40, 1, v=>`${v} × ${v}`);
  const sizeInput = sizeInputRow.input;
  const minesInputRow = rangeRow('Mines', draft.mines, 1, draft.size*draft.size-1, 1, v=>`${v}`);
  const minesInput = minesInputRow.input;

  // tie mines slider max to size
  sizeInput.addEventListener('input',()=>{
    const n = clamp(Number(sizeInput.value)||draft.size,6,40);
    minesInput.max = String(n*n-1);
    if (Number(minesInput.value)>n*n-1) minesInput.value = String(n*n-1);
    draft.size = n;
    draft.mines = clamp(Number(minesInput.value)||draft.mines,1,n*n-1);
    refreshAuraPreview();
  });
  minesInput.addEventListener('input',()=>{
    const n = clamp(Number(sizeInput.value)||draft.size,6,40);
    const m = clamp(Number(minesInput.value)||draft.mines,1,n*n-1);
    minesInput.value = String(m);
    draft.mines = m;
    refreshAuraPreview();
  });

  boardSection.append(boardTitle, sizeInputRow.row, minesInputRow.row);

  // Help section (Hints)
  const helpSection=document.createElement('div');
  Object.assign(helpSection.style,{display:'grid',gap:'6px',marginTop:'4px'});
  const helpTitle=document.createElement('div'); helpTitle.textContent='Help'; helpTitle.style.fontWeight='700';

  const hintsModeRow=document.createElement('div');
  Object.assign(hintsModeRow.style,{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'6px'});
  const hintsModes=['off','limited','unlimited'];
  const hintsModeLabels={off:'Off',limited:'Limited',unlimited:'Unlimited'};
  const hintsModeRadios = hintsModes.map(modeVal=>{
    const btn=document.createElement('button');
    btn.className='pill';
    btn.textContent=hintsModeLabels[modeVal];
    btn.dataset.mode=modeVal;
    btn.addEventListener('click',()=>{
      if (hintsLockedByDifficulty(draft.difficulty)) return;
      hintsModeRadios.forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      draft.hintsMode = modeVal;
      refreshAuraPreview();
      refreshHelpLock();
    });
    hintsModeRow.appendChild(btn);
    return btn;
  });

  const hintsMaxRow = rangeRow('Max hints (when limited)', draft.hintsMax, 0, 20, 1, v=>`${v}`);
  const hintsMaxInput = hintsMaxRow.input;
  hintsMaxInput.addEventListener('input',()=>{
    draft.hintsMax = clamp(Number(hintsMaxInput.value)||draft.hintsMax,0,50);
    refreshAuraPreview();
  });

  const hintsNote=document.createElement('div');
  hintsNote.style.fontSize='12px';
  hintsNote.style.opacity='0.8';

  helpSection.append(helpTitle, hintsModeRow, hintsMaxRow.row, hintsNote);

  // Time section
  const timeSection=document.createElement('div');
  Object.assign(timeSection.style,{display:'grid',gap:'6px',marginTop:'4px'});
  const timeTitle=document.createElement('div'); timeTitle.textContent='Time'; timeTitle.style.fontWeight='700';

  const timerModeRow=document.createElement('div');
  Object.assign(timerModeRow.style,{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:'6px'});
  const timerModes=['off','limit'];
  const timerModeLabels={off:'Off',limit:'On (challenge)'};
  const timerModeBtns = timerModes.map(modeVal=>{
    const btn=document.createElement('button');
    btn.className='pill';
    btn.textContent=timerModeLabels[modeVal];
    btn.dataset.mode=modeVal;
    btn.addEventListener('click',()=>{
      timerModeBtns.forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      draft.timerMode = modeVal;
      refreshAuraPreview();
      refreshTimeLock();
    });
    timerModeRow.appendChild(btn);
    return btn;
  });

  const timeLimitRow = rangeRow('Time limit (minutes)', draft.timeLimitMin, 1, 60, 1, v=>`${v} min`);
  const timeLimitInput = timeLimitRow.input;
  timeLimitInput.addEventListener('input',()=>{
    draft.timeLimitMin = clamp(Number(timeLimitInput.value)||draft.timeLimitMin,1,60);
    refreshAuraPreview();
  });

  timeSection.append(timeTitle, timerModeRow, timeLimitRow.row);

  // Aura preview
  const auraPreview=document.createElement('div');
  auraPreview.style.marginTop='4px';
  auraPreview.style.fontSize='13px';
  auraPreview.style.opacity='0.9';

  function refreshAuraPreview(){
    const potential = computeAuraPotentialFromRunCfg(draft);
    auraPreview.textContent = `Aura potential: ${Math.round(potential)}/100 · More tiles + fewer hints + timer on = more aura`;
  }

  // Apply difficulty preset to controls
  function applyDifficultyToDraft(d, name, sizeInp, minesInp, hintsButtons, hintsMaxInp, noteEl){
    normalizeRunCfg(d);
    if (name!=='Custom' && DIFFICULTIES[name]){
      const def=DIFFICULTIES[name];
      d.size = def.size;
      d.mines= def.mines;
      d.hintsMode = def.hintsMode;
      d.hintsMax  = def.hintsMax;
      if (!d.timeLimitMin) d.timeLimitMin = def.timerLimitMin;
    }
    sizeInp.value = String(d.size);
    minesInp.max  = String(d.size*d.size-1);
    minesInp.value= String(d.mines);

    hintsButtons.forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.mode===d.hintsMode);
    });
    hintsMaxInp.value = String(d.hintsMax);

    timeLimitInput.value = String(d.timeLimitMin);

    refreshHelpLock();
    refreshTimeLock();
  }

  function hintsLockedByDifficulty(diff){
    return diff!=='Custom';
  }
  function refreshHelpLock(){
    if (draft.difficulty==='Pro'){
      // forced off
      hintsModeRadios.forEach(btn=>{
        btn.disabled = true;
        btn.classList.toggle('active', btn.dataset.mode==='off');
        btn.style.opacity='0.5';
      });
      hintsMaxInput.disabled = true;
      hintsMaxInput.style.opacity='0.5';
      hintsNote.textContent = 'Hints are disabled on Pro.';
    } else if (draft.difficulty!=='Custom'){
      // limited, fixed limit
      const def=DIFFICULTIES[draft.difficulty];
      hintsModeRadios.forEach(btn=>{
        btn.disabled = true;
        btn.classList.toggle('active', btn.dataset.mode==='limited');
        btn.style.opacity='0.5';
      });
      hintsMaxInput.disabled = true;
      hintsMaxInput.style.opacity='0.5';
      hintsNote.textContent = `Hints limited to ${def.hintsMax} for this difficulty.`;
    } else {
      // fully editable
      hintsModeRadios.forEach(btn=>{
        btn.disabled = false;
        btn.style.opacity='1';
        btn.classList.toggle('active', btn.dataset.mode===draft.hintsMode);
      });
      hintsMaxInput.disabled = (draft.hintsMode!=='limited');
      hintsMaxInput.style.opacity = (draft.hintsMode==='limited')?'1':'0.6';
      hintsNote.textContent = '';
    }
  }
  function refreshTimeLock(){
    const limitOn = draft.timerMode==='limit';
    timeLimitInput.disabled = !limitOn;
    timeLimitInput.style.opacity = limitOn ? '1' : '0.6';
  }

  // Initial activation
  diffBtns.forEach(b=>{
    if (b.dataset.val===draft.difficulty) b.classList.add('active');
  });
  applyDifficultyToDraft(draft, draft.difficulty, sizeInput, minesInput, hintsModeRadios, hintsMaxInput, hintsNote);
  timerModeBtns.forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.mode===draft.timerMode);
  });
  refreshAuraPreview();

  // Buttons bottom
  const btnRow=document.createElement('div');
  Object.assign(btnRow.style,{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'10px',flexWrap:'wrap'});
  const modeLabel=document.createElement('div');
  modeLabel.style.flex='1';
  modeLabel.style.minWidth='160px';
  modeLabel.style.fontSize='12px';
  modeLabel.style.opacity='0.7';
  if (mode==='new'){
    modeLabel.textContent='Starting a new run will abandon your current board.';
  } else {
    modeLabel.textContent='Configure your first run. You can always adjust later.';
  }

  const cancelBtn = pill('Cancel', ()=> closeRunOverlay(), 'ghost');
  const startBtn  = pill('Start run', ()=>{
    // commit draft → runCfg
    runCfg = {
      difficulty: draft.difficulty,
      size: clamp(Number(sizeInput.value)||draft.size,6,40),
      mines: clamp(Number(minesInput.value)||draft.mines,1,Math.pow(clamp(Number(sizeInput.value)||draft.size,6,40),2)-1),
      hintsMode: draft.difficulty==='Pro' ? 'off' :
                 (draft.difficulty!=='Custom' ? 'limited' : draft.hintsMode),
      hintsMax: draft.difficulty==='Pro'
        ? 0
        : (draft.difficulty!=='Custom'
            ? (DIFFICULTIES[draft.difficulty]?.hintsMax ?? draft.hintsMax)
            : clamp(draft.hintsMax||5,0,50)),
      timerMode: draft.timerMode,
      timeLimitMin: clamp(draft.timeLimitMin||15,1,60)
    };
    normalizeRunCfg(runCfg);
    closeRunOverlay();
    restart();
  });

  btnRow.append(mode==='new'?modeLabel:modeLabel, mode==='new'?cancelBtn:null, startBtn);
  runCard.append(title, subtitle, diffLabel, diffRow, boardSection, helpSection, timeSection, auraPreview, btnRow);
}
function closeRunOverlay(){
  runOverlay.style.display='none';
}

// ---------------- Window & init ----------------
window.addEventListener('resize',()=>{ layoutSquare(); layoutGrid(); computeDims(); refreshMinimap(); });

wrap.appendChild(settingsOverlay);
wrap.appendChild(uploadOverlay);
wrap.appendChild(runOverlay);

// Initial run + overlay
restart();

return {
  pause(){ if (!paused) togglePause(); },
  resume(){ if (paused) togglePause(); },
  dispose(){
    document.removeEventListener('contextmenu', killContext);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keydown', onReplayKey);
    stopTimer();
  }
};

// ===== end launch =====
}};

// ===== Utility stub =====
function setTimerText(){}
// END FILE
