// minesweeper.js — Minesweeper+ (minimal, stable replay + compact share menu)
// - Replay: simple, reliable controls (Play/Pause, ◀, ▶, Live toggle, Speed).
// - No random exits: restart is replay-aware; scheduler uses RAF and clear state.
// - Toolbar: Replay (appears when available), Share (opens Copy/Download/System Share), Upload, Fullscreen, Settings.
// - Minimap outside the pitch; board always square; uniform gaps; auto-fit with safe 1:1 fallback.

import { makeConfetti, load, save } from '../kit/gamekit.js';

export default {
  id: 'mines',
  title: 'Minesweeper+',
  category: 'puzzle',
  icon: '💣',
  tags: ['logic','grid','flags'],
  launch(api){

// ---------------- Config (minimal surface) ----------------
let cfg = {
  preset: 'Beginner',      // Beginner | Intermediate | Expert | Custom
  w: 9, h: 9, mines: 10,   // NOTE: h is forced to equal w at runtime

  // Layout/sizing
  tileSize: 30,            // used for 1:1 fallback
  maxPanel: 980,
  panelPadding: 12,

  // Gameplay core
  safeZero: true,
  chord: true,
  questionMarks: true,

  // Internal defaults
  highContrast: true,
  colorBlind: false,
  cellGapMin: 2,
  cellGapMax: 18,
  longPressMS: 420,
  allowUndo: true,
  allowHints: true,
  hintPenaltyBaseMs: 3000,
  daily: false
};
cfg = { ...cfg, ...(load('mines','settings',{}) || {}) };

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
const newBtn   = pill('↻ New', ()=> { if (isReplaying) endReplaySession(); restart(); });
const hintBtn  = pill('Hint', ()=> hint());
const undoBtn  = pill('Undo', ()=> undo(), 'ghost');
leftBar.append(newBtn, hintBtn, undoBtn);

// Center — Timer
const timerBadge = badge('⏱ 0.00s');
centerBar.append(timerBadge);

// Right — badges + actions
const minesBadge = badge('Mines: 0');
const hintsBadge = badge('Hints: 0');
const fsText     = pill('Fullscreen', ()=> toggleFullscreen());
// Replay button (minimal)
const replayBtn  = pill('Replay', ()=> onReplayButton());
replayBtn.disabled = true; replayBtn.style.opacity = .6;

// Single Share (opens small menu)
const shareBtn   = pill('Share', ()=> toggleShareMenu());
const uploadBtn  = pill('Upload', ()=> openUpload(), 'ghost');
const gearBtn    = pill('Settings', ()=> openSettings(), 'ghost');
rightBar.append(minesBadge, hintsBadge, fsText, replayBtn, shareBtn, uploadBtn, gearBtn);


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
const rcPrev   = pill('◀', ()=> replayStep(-1), 'ghost');
const rcPlay   = pill('Play', ()=> toggleReplayPlay());
const rcNext   = pill('▶', ()=> replayStep(1));
const rcLive   = pill('Live: Off', ()=> toggleLive(), 'ghost'); // Live timing toggle
const rcSpeedWrap = document.createElement('div');
Object.assign(rcSpeedWrap.style,{ display:'flex', alignItems:'center', gap:'6px' });
const rcSpeedLbl = document.createElement('span'); rcSpeedLbl.textContent = '×1.50';
const rcSpeed = document.createElement('input');
Object.assign(rcSpeed, { type:'range', min:'0.25', max:'6', step:'0.25', value:'1.5' });
rcSpeed.style.width = '160px';
rcSpeed.addEventListener('input', ()=> {
  replaySpeed = parseFloat(rcSpeed.value)||1.5;
  rcSpeedLbl.textContent = `×${replaySpeed.toFixed(2)}`;
});
rcSpeedWrap.append(rcSpeedLbl, rcSpeed);
rcBar.append(rcPrev, rcPlay, rcNext, rcLive, rcSpeedWrap);

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

// Settings (fullscreen-safe host)
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

// Replay session (clean, minimal)
let replaySeq=[], replayIdx=0, replayPlaying=false;
let replayLive=false;        // Live timing = recorded delays; Off = scaled by speed
let replaySpeed=1.5;
let replayVirtualMs=0;
let replaySnaps=[];          // states after each event (index-aligned)
let replayRaf=0;             // RAF handle
let nextDueAt=0;             // performance.now() timestamp for next event

// Layout
let cellPx=28, iconPx=18, textPx=16;
let colGap=2, rowGap=2; // always equal in solve()
let dims={ boardW:0, boardH:0, viewW:0, viewH:0, scrollX:0, scrollY:0 };

// Colors & numerals
const ICON = {
  flagSVG(size){ return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v20"/><path d="M6 2h10l-2 4 2 4H6"/></svg>`; },
  mineSVG(size){ return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/><g stroke="currentColor" stroke-width="2" fill="none"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.9 4.9l2.8 2.8"/><path d="M16.3 16.3l2.8 2.8"/><path d="M19.1 4.9l-2.8 2.8"/><path d="M7.7 16.3l-2.8 2.8"/></g></svg>`; }
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
function bestKey(){ return cfg.preset!=='Custom' ? `mines:best:${cfg.preset}` : `mines:best:Custom:${cfg.w}x${cfg.h}x${cfg.mines}`; }
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
`;
document.head.appendChild(styleTag);
inner.setAttribute('data-ms-inner','');

// RNG (deterministic)
function mulberry32(a){ return function(){ a|=0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1 | a); t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }
function setSeed(s){ rng = mulberry32(s>>>0); }

// ---------------- Layout (always square, uniform gap) ----------------
const MIN_FIT_CELL = 18; // if fit would drop below this, use 1:1 scrolling
function enforceSquareDims(){ if (cfg.h !== cfg.w){ cfg.h = cfg.w; } }
function layoutSquare(){
  enforceSquareDims();
  const container = api.mount || root.parentElement || document.body;
  const containerRect = container.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const containerWidth = Math.max(320, Math.floor(containerRect.width));
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
function solveCellAndGaps(){
  const usable = inner.clientWidth;
  const n = cfg.w; // square grid
  const gDesired = clamp(Math.round(usable * 0.012), cfg.cellGapMin, cfg.cellGapMax);
  let g = n>1 ? gDesired : 0;
  let S = Math.floor((usable - (n-1)*g) / n);
  if (S < MIN_FIT_CELL){
    S = clamp(cfg.tileSize || 24, 12, 96);
    g = n>1 ? clamp(Math.floor(S*0.12), cfg.cellGapMin, cfg.cellGapMax) : 0;
  }
  return { S, gap: g };
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
      d.addEventListener('mouseenter', ()=> d.style.boxShadow='0 0 0 3px rgba(255,255,255,.16) inset');
      d.addEventListener('mouseleave', ()=> d.style.boxShadow='0 1px 0 rgba(255,255,255,.03) inset');
      board.appendChild(d);
    }
  }

  layoutSquare();
  drawAll();
  updateBadges();
}

// ---------------- Input ----------------
let pressCell=null, longPressT=null, longPressFor=null;

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

function drawCell(x,y,animate=false){
  const el = board.children[y*cfg.w + x];
  const st = state[y][x];
  el.innerHTML=''; el.textContent='';
  el.style.transform = (pressCell && pressCell.x===x && pressCell.y===y) ? 'translateY(1px) scale(0.985)' : '';
  el.style.fontSize = `${textPx}px`;

  if (!alive && grid[y][x]===-1){
    el.style.background = revealedBg(); el.style.borderColor='#d14545'; el.style.color='#f5f7ff'; el.innerHTML=ICON.mineSVG(iconPx); return;
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
    if (v>0){ const color=cfg.highContrast?boost(NUMC[v],1.18):NUMC[v]; el.style.color=color; el.style.fontWeight='900'; el.textContent = cfg.colorBlind?`${v} ${GLYPH[v]||''}`:String(v); }
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
function applyPreset(){
  if (cfg.preset==='Beginner'){ cfg.w=9; cfg.h=9; cfg.mines=10; }
  else if (cfg.preset==='Intermediate'){ cfg.w=16; cfg.h=16; cfg.mines=40; }
  else if (cfg.preset==='Expert'){ cfg.w=24; cfg.h=24; cfg.mines=99; }
}
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
    if (pendingSeed!=null){ setSeed(pendingSeed); gameSeed=pendingSeed; }
    else { gameSeed=(Math.random()*0xFFFFFFFF)>>>0; setSeed(gameSeed); }
    placeMines(x,y);
    firstClick=false; startedAt=performance.now(); startTimer();
  }
  if (state[y][x]===1) return;

  if (!isReplaying) replay.push({t:nowMs(), type:'r', x, y});

  if (grid[y][x]===-1){
    alive=false; stopTimer();
    for (let yy=0;yy<cfg.h;yy++) for (let xx=0;xx<cfg.w;xx++){ if (grid[yy][xx]===-1 && state[yy][xx]!==2){ state[yy][xx]=0; } }
    drawAll(); explodeAt(x,y); lastGameSeed=gameSeed;
    api.setNote('Boom. New game or Replay.'); updateBadges(); enableReplayIfAny(); return;
  }

  const q=[[x,y]], seen=new Set();
  while(q.length){
    const [cx,cy]=q.pop(); const key=cy*cfg.w+cx; if(seen.has(key)) continue; seen.add(key);
    if (state[cy][cx]===1) continue; state[cy][cx]=1; drawCell(cx,cy,animate);
    if (grid[cy][cx]===0){ eachN(cx,cy,(nx,ny)=>{ if (state[ny][nx]!==1) q.push([nx,ny]); }); }
  }

  if (checkWin()) onWin(); else updateBadges();
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
  eachN(x,y,(nx,ny)=>{ if (state[ny][nx]===0){ if (grid[ny][nx]===-1) died=true; else reveals.push([nx,ny]); } });
  if (died){
    alive=false; stopTimer();
    for (let yy=0;yy<cfg.h;yy++) for (let xx=0;xx<cfg.w;xx++){ if (grid[yy][xx]===-1 && state[yy][xx]!==2) state[yy][xx]=0; }
    drawAll(); lastGameSeed=gameSeed; api.setNote('Boom. New game or Replay.'); updateBadges(); enableReplayIfAny(); return;
  }
  for (const [rx,ry] of reveals) reveal(rx,ry,animate);
}
function checkWin(){ for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){ if (grid[y][x]!==-1 && state[y][x]!==1) return false; } return true; }
function onWin(){
  won=true; alive=false; stopTimer();
  for (let yy=0;yy<cfg.h;yy++) for (let xx=0;xx<cfg.w;xx++){ if (grid[yy][xx]===-1 && state[yy][xx]!==2){ state[yy][xx]=2; flags++; } }
  drawAll(); confetti?.play({ count:380, duration:6.0, linger:0.45 });
  const elapsed=getElapsedMs(); api.setNote(`Clear! ${fmtTime(elapsed)}`); saveBest(elapsed); saveLeaderboard(elapsed);
  lastGameSeed=gameSeed; updateBadges(); enableReplayIfAny();
}

// ---------------- Timer ----------------
function startTimer(){
  stopTimer();
  timerId=setInterval(()=>{
    if (!alive || paused || won) return;
    if (isReplaying) setTimer(replayVirtualMs);
    else setTimer(getElapsedMs());
  },200);
}
function stopTimer(){ if (timerId){ clearInterval(timerId); timerId=0; } }
function getElapsedMs(){ return (performance.now()-startedAt)+penaltyMs; }
function setTimer(ms){ timerBadge.textContent=`⏱ ${fmtTime(ms)}`; }

// ---------------- Badges / buttons ----------------
function updateBadges(){ minesBadge.textContent=`Mines: ${Math.max(0, cfg.mines - flags)}`; hintsBadge.textContent=`Hints: ${hintsUsed}`; }
function enableReplayIfAny(){ const ok = replay.length>0; replayBtn.disabled = !ok; replayBtn.style.opacity = ok?1:.6; }

// ---------------- Settings (square-only) ----------------
function openSettings(){
  const host=document.fullscreenElement || wrap;
  if (settingsOverlay.parentElement!==host){ settingsOverlay.remove(); host.appendChild(settingsOverlay); }
  Object.assign(settingsOverlay.style,{ position:'absolute', inset:'0' });

  settingsCard.innerHTML='';
  const h1=document.createElement('div'); h1.textContent='Settings'; h1.style.fontSize='20px'; h1.style.fontWeight='800'; h1.style.marginBottom='8px';

  const form=document.createElement('div'); form.style.display='grid'; form.style.gridTemplateColumns='1fr'; form.style.gap='12px';

  // Presets
  const seg=document.createElement('div'); Object.assign(seg.style,{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px' });
  const presets=['Beginner','Intermediate','Expert','Custom'];
  const segBtns=presets.map(p=>{ const b=document.createElement('button'); b.className='pill'; b.textContent=p; b.dataset.val=p;
    b.addEventListener('click',()=>{ segBtns.forEach(x=>x.classList.remove('active')); b.classList.add('active'); showCustom(p==='Custom'); }); return b; });
  segBtns.forEach(b=>seg.appendChild(b));
  form.appendChild(labelWrap('Preset', seg));

  // Custom size (square) + Mines
  const sizeInput = rangeRow('Size (N×N)', cfg.w, 6, 40, 1, v=>String(v));
  const mInput    = rangeRow('Mines', cfg.mines, 1, 500, 1, v=>String(v));
  const tileInput = rangeRow('Preferred tile size', cfg.tileSize, 12, 96, 1, v=>`${v} px`);
  const safeT=checkboxRow('Safe first area', cfg.safeZero);
  const chT  =checkboxRow('Chord (double-click number)', cfg.chord);
  form.append(sizeInput.row, mInput.row, tileInput.row, safeT.row, chT.row);

  const btns=document.createElement('div'); Object.assign(btns.style,{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'8px' });
  const cancelB=pill('Cancel', ()=> closeSettings(false), 'ghost');
  const saveB  =pill('Save', ()=> {
    const isCustom = activePreset()==='Custom';
    const next = {
      preset: activePreset(),
      w: isCustom ? Number(sizeInput.input.value) : cfg.w,
      h: isCustom ? Number(sizeInput.input.value) : cfg.h,
      mines: isCustom ? Number(mInput.input.value) : cfg.mines,
      tileSize: Number(tileInput.input.value),
      safeZero: !!safeT.input.checked,
      chord: !!chT.input.checked
    };
    cfg={...cfg,...next};
    if (cfg.preset!=='Custom') applyPreset();
    enforceSquareDims();
    cfg.w=clamp(cfg.w,6,40); cfg.h=cfg.w; cfg.mines=clamp(cfg.mines,1,cfg.w*cfg.h-1);
    save('mines','settings',cfg);
    closeSettings(true);
    restart();
    layoutSquare();
  });
  btns.append(cancelB,saveB);

  segBtns.forEach(b=>{ if (b.dataset.val===cfg.preset) b.classList.add('active'); });
  showCustom(cfg.preset==='Custom');

  settingsCard.append(h1, form, btns);
  settingsOverlay.style.display='grid';

  const onClick=(e)=>{ if (e.target===settingsOverlay) closeSettings(false); };
  const onKey=(e)=>{ if (e.key==='Escape') closeSettings(false); };
  settingsOverlay.addEventListener('click', onClick, { once:true });
  document.addEventListener('keydown', onKey, { once:true });

  function activePreset(){ const act=segBtns.find(b=>b.classList.contains('active')); return act?act.dataset.val:'Beginner'; }
  function showCustom(show){ sizeInput.row.style.display=show?'grid':'none'; mInput.row.style.display=show?'grid':'none'; }
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

// ---------------- Pause / Restart ----------------
function togglePause(){
  if (!alive || won || firstClick) return;
  paused = !paused;
  veil.style.display = paused ? 'grid' : 'none';
  // removed: pauseBtn.textContent = ...
}

function restart(){
  applyPreset();
  initArrays();
  buildBoard();
  minesBadge.textContent=`Mines: ${cfg.mines}`; hintsBadge.textContent=`Hints: ${hintsUsed}`;
  const best = load('mines', bestKey(), null);
  api.setNote(best? `Best: ${fmtTime(best)}` : (cfg.daily? 'Daily challenge ready' : 'Good luck!'));
  if (!settingsOverlay.parentElement) wrap.appendChild(settingsOverlay);
  if (!uploadOverlay.parentElement) wrap.appendChild(uploadOverlay);

  // Replay-aware: keep controls visible if we are in a replay session
  if (isReplaying) rcBar.style.display='flex'; else rcBar.style.display='none';
  enableReplayIfAny();
}

// ---------------- Undo / Hint ----------------
function pushHistory(){
  if (!cfg.allowUndo || isReplaying) return;
  const stateCopy = state.map(r=>r.slice());
  history.push({ state:stateCopy, flags, firstClick, alive, won, startedAt, penaltyMs, gameSeed });
  if (history.length>64) history.shift();
}
function undo(){
  if (!cfg.allowUndo || !history.length) return;
  const h=history.pop();
  state=h.state.map(r=>r.slice());
  flags=h.flags; firstClick=h.firstClick; alive=h.alive; won=h.won; startedAt=h.startedAt; penaltyMs=h.penaltyMs; gameSeed=h.gameSeed;
  drawAll(); if (!alive || won) stopTimer(); else startTimer(); api.setNote('Undid last action'); updateBadges();
}
function hint(){
  if (!cfg.allowHints || !alive || paused || won) return;
  const safe=[]; for (let y=0;y<cfg.h;y++) for (let x=0;x<cfg.w;x++){ if (state[y][x]===0 && grid[y][x]!==-1) safe.push([x,y]); }
  if (!safe.length){ api.setNote('No safe hints available'); return; }
  pushHistory(); const [x,y]=safe[(Math.random()*safe.length)|0];
  const add=cfg.hintPenaltyBaseMs * Math.pow(2, Math.max(0, hintsUsed)); penaltyMs+=add; hintsUsed++;
  reveal(x,y,true); hintsBadge.textContent=`Hints: ${hintsUsed}`; api.setNote(`Hint used (+${(add/1000).toFixed(1)}s)`);
}
function nowMs(){ return performance.now() - startedAt; }

// ---------------- Replay (clean, minimal) ----------------
function onReplayButton(){
  // If already in a session, just show controls; else prepare a fresh session (paused at start)
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

  // Build board for this seed
  restart();
  stopTimer(); setTimer(0);

  // initial snapshot (before any event)
  snapshotPush();

  // Controls state
  rcBar.style.display='flex';
  rcPlay.textContent = autoplay ? 'Pause' : 'Play';
  replayPlaying = !!autoplay;
  nextDueAt = 0; cancelReplayRAF();
  if (replayPlaying) scheduleNextTick();
  window.addEventListener('keydown', onReplayKey, { passive:true });
}
function endReplaySession(){
  isReplaying=false; replayPlaying=false; cancelReplayRAF();
  window.removeEventListener('keydown', onReplayKey);
}
function onReplayKey(e){ if (rcBar.style.display!=='flex') return; if (e.key==='ArrowRight') replayStep(1); else if (e.key==='ArrowLeft') replayStep(-1); }

function toggleReplayPlay(){
  if (!isReplaying){
    if (!replay.length){ api.setNote('No replay to play'); return; }
    beginReplaySession(true);
    return;
  }
  // if finished, restart from beginning
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
}

function scheduleNextTick(){
  // compute delay to next event based on current index
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
  // Apply current event
  if (replayIdx < replaySeq.length){
    const ev = replaySeq[replayIdx];
    // advance "virtual" timer by planned delay
    const prevT = (replayIdx>0 ? replaySeq[replayIdx-1].t : (replaySeq[0]?.t ?? 0));
    const dtRecorded = Math.max(0, ev.t - prevT);
    const appliedDelay = replayLive ? dtRecorded : Math.max(16, Math.round(dtRecorded / replaySpeed));
    replayVirtualMs += appliedDelay;
    setTimer(replayVirtualMs);
    applyEvent(ev); snapshotPush();
    replayIdx++;
  }
  if (!alive){
    // game over event applied; stop politely but keep controls visible
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
  // always pause when stepping
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
    // Pop current snapshot, revert to previous
    replaySnaps.pop();
    const snap = replaySnaps[replaySnaps.length-1];
    state=snap.state.map(r=>r.slice());
    flags=snap.flags; firstClick=snap.firstClick; alive=snap.alive; won=snap.won; startedAt=snap.startedAt; penaltyMs=snap.penaltyMs; gameSeed=snap.gameSeed;
    replayIdx = Math.max(0, replayIdx-1);
    // virtual time = recorded time at new index
    const tAt = (replayIdx>0 ? replaySeq[replayIdx-1].t : 0);
    replayVirtualMs = tAt; setTimer(replayVirtualMs);
    drawAll(); updateBadges();
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
    cfg: cfg.preset!=='Custom'?{preset:cfg.preset}:{preset:'Custom', w:cfg.w, h:cfg.h, mines:cfg.mines},
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
    if (json.cfg?.preset){ cfg.preset=json.cfg.preset; if (cfg.preset!=='Custom') applyPreset(); if (cfg.preset==='Custom'){ cfg.w=clamp(json.cfg.w||cfg.w,6,40); cfg.h=cfg.w; cfg.mines=clamp(json.cfg.mines||cfg.mines,1,cfg.w*cfg.h-1); } }
    save('mines','settings',cfg);
    replay=json.events.map(e=>({t:+e.t||0, type:String(e.k), x:+e.x, y:+e.y}));
    pendingSeed=(json.s>>>0)||null; lastGameSeed=pendingSeed;
    api.setNote('Replay loaded — open Replay to view');
    enableReplayIfAny();
  }catch(err){ console.error(err); api.setNote('Invalid replay'); }
}

// ---------------- Visual polish ----------------
function explodeAt(x,y){
  const el=board.children[y*cfg.w + x];
  el.animate([{ transform:'scale(1)', filter:'brightness(1)' },
              { transform:'scale(1.12)', filter:'brightness(1.9)' },
              { transform:'scale(1)', filter:'brightness(1)' }],
             { duration:280, easing:'cubic-bezier(.2,.7,.2,1)' });
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

// ---------------- Fullscreen ----------------
async function toggleFullscreen(){
  try{ if (!document.fullscreenElement) await wrap.requestFullscreen(); else await document.exitFullscreen(); }catch{}
  if (settingsOverlay.style.display==='grid'){ const host=document.fullscreenElement||wrap; if (settingsOverlay.parentElement!==host){ settingsOverlay.remove(); host.appendChild(settingsOverlay); } }
}

// ---------------- Window & init ----------------
window.addEventListener('resize',()=>{ layoutSquare(); layoutGrid(); computeDims(); refreshMinimap(); });

wrap.appendChild(settingsOverlay);
wrap.appendChild(uploadOverlay);
root.append(bar, rcBar, stage);
stage.append(wrap, mmWrap);
restart();

return {
  pause(){ if (!paused) togglePause(); },
  resume(){ if (paused) togglePause(); },
  dispose(){ document.removeEventListener('contextmenu', killContext); stopTimer(); }
};

// ===== end launch =====
}};

// ===== Utility stub =====
function setTimerText(){}
// END FILE
