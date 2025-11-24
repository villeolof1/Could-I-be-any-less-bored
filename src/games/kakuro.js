import { fitCanvas as fitCanvasShared, makeConfetti as makeConfettiShared } from '../kit/gamekit.js';

// src/games/kakuro.js — Dream Kakuro+ (final-ux-3, single-daily, smarter-nav)
// ------------------------------------------------------------------
// Final UX + reliability:
// - TRUE centered, responsive canvas with min/max cell sizes.
// - Keyboard-first: arrows/WASD move, 1–9 place, 0/Del/Backspace/X clear, Space notes, F peek, H hint.
// - Strict Mode: blocks wrong digits with a quick red flash in the cell.
// - Simple hint: reveal the solution digit for the current cell.
// - Daily: ONE puzzle per day, difficulty by weekday (Mon easiest → Sun hardest).
// - Endless modes by difficulty; all puzzles have a unique solution.
// - Autosave/restore includes solution; reduced motion honored.
// - Clean layering: menus/modals above board.
// - Upload custom puzzles (JSON with grid + solution).
// - Confetti on full solve.
// ------------------------------------------------------------------

/* eslint-disable no-unused-vars */
const GAME_ID = 'kakuro';
const GAME_TITLE = 'Kakuro+';
const VERSION = 'final-ux-3';
const LS_PREFIX = `${GAME_ID}:${VERSION}`;
const AUTOSAVE_MS = 240;

let kit = {};
try {
  kit.fitCanvas = (window.kit && window.kit.fitCanvas) || null;
  kit.confetti = (window.kit && window.kit.confetti) || null;
  kit.audio = (window.kit && window.kit.audio) || null;
  kit.storage = (window.kit && window.kit.storage) || null;
} catch { /* noop */ }

function fitCanvasFallback(canvas, width, height) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { dpr, ctx };
}
const fitCanvas = kit.fitCanvas || fitCanvasShared || fitCanvasFallback;
const makeConfetti = (typeof kit.confetti === 'function' ? kit.confetti : makeConfettiShared) || null;

let soundOn = true;
const _sfx = (kit.audio && kit.audio.sfx) || { select(){}, place(){}, clear(){}, errorSoft(){}, fanfare(){} };
const sfx = new Proxy(_sfx, { get: (t,k) => (...a) => { if (soundOn) t[k]?.(...a); } });

const storage = kit.storage || {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* =============================== Utils =============================== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now();
const pad2 = n => String(n).padStart(2, '0');
const fmtTime = ms => { const t = Math.floor(ms/1000), m = Math.floor(t/60), s = t%60; return `${m}:${pad2(s)}`; };
const isTextInputFocused = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};
const FNV_SEED = 2166136261;
const seedOfDate = (s) => { let h=FNV_SEED; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);} return h>>>0; };
function rng(seed){ let s=seed>>>0; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s>>>=0; s^=s<<5; s>>>=0; return (s>>>0)/0xffffffff; }; }
const on = (t,ev,h,opts)=> (t.addEventListener(ev,h,opts), ()=>t.removeEventListener(ev,h,opts));

/* ============================ Difficulty ============================= */
const DEFAULT_DIFFICULTY = 'Normal';
const DIFF_SPECS = {
  Easy:   { W: 9,  H: 9,  mask: 'sparse',   tries: 320, timeBudgetMs: 1600, singlesMin: 18, singlesMax: 99, label:'Relaxed' },
  Normal: { W: 10, H: 10, mask: 'balanced', tries: 440, timeBudgetMs: 2400, singlesMin: 6,  singlesMax: 20, label:'Classic' },
  Hard:   { W: 12, H: 12, mask: 'dense',    tries: 660, timeBudgetMs: 3000, singlesMin: 2,  singlesMax: 10, label:'Challenging' },
  Expert: { W: 14, H: 14, mask: 'dense+',   tries: 860, timeBudgetMs: 3600, singlesMin: 0,  singlesMax: 5,  label:'Diabolical' },
};

// One daily per day, difficulty by weekday.
function difficultyForToday() {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun,1=Mon,...6=Sat
  if (dow === 1) return 'Easy';    // Mon
  if (dow === 2) return 'Easy';    // Tue
  if (dow === 3) return 'Normal';  // Wed
  if (dow === 4) return 'Normal';  // Thu
  if (dow === 5) return 'Hard';    // Fri
  if (dow === 6) return 'Hard';    // Sat
  return 'Expert';                 // Sun
}

/* ============================ Combos cache =========================== */
const COMBOS = new Map();
function combos(sum, k) {
  const key = `${sum}:${k}`;
  if (COMBOS.has(key)) return COMBOS.get(key);
  const out = [];
  const dfs = (start, depth, acc, rem) => {
    if (depth === k) { if (rem===0) out.push(acc.slice()); return; }
    for (let d=start; d<=9; d++){
      if (d>rem) break;
      acc.push(d); dfs(d+1, depth+1, acc, rem-d); acc.pop();
    }
  };
  dfs(1,0,[],sum);
  COMBOS.set(key, out);
  return out;
}

/* ========================= Curated safe puzzles ====================== */
const CURATED = [
  // Easy 9×9 (fixed)
  { id:'easy-9', title:'Easy 9×9', grid: [
    [ {b:true},        {b:true, d:16}, {b:true, d:24}, {b:true},        {b:true, d:17}, {b:true, d:29}, {b:true},        {b:true, d:12}, {b:true, d:7} ],
    [ {b:true, a:17},  {b:false},      {b:false},      {b:true, a:7},   {b:false},      {b:false},      {b:true, a:11},  {b:false},      {b:false} ],
    [ {b:true, a:23},  {b:false},      {b:false},      {b:false},       {b:false},      {b:false},      {b:true},        {b:true},       {b:true} ],
    [ {b:true},        {b:true, d:7},  {b:true, d:8},  {b:true, a:16},  {b:false},      {b:false},      {b:true, a:4},   {b:false},      {b:false} ],
    [ {b:true, a:24},  {b:false},      {b:false},      {b:false},       {b:false},      {b:false},      {b:true},        {b:true},       {b:true} ],
    [ {b:true, a:7},   {b:false},      {b:false},      {b:true},        {b:true, d:13}, {b:true, d:12}, {b:true, a:6},   {b:false},      {b:false} ],
    [ {b:true, a:11},  {b:false},      {b:false},      {b:true, a:3},   {b:false},      {b:false},      {b:true},        {b:true, d:4},  {b:true, d:3} ],
    [ {b:true},        {b:true, d:11}, {b:true, d:10}, {b:true},        {b:true, d:4},  {b:true, d:3},  {b:true},        {b:true},       {b:true} ],
    [ {b:true, a:12},  {b:false},      {b:false},      {b:true, a:3},   {b:false},      {b:false},      {b:true, a:4},   {b:false},      {b:false} ],
  ] },

  { id:'normal-10', title:'Normal 10×10', grid: [
    [ {b:true}, {b:true,d:15}, {b:true,d:16}, {b:true}, {b:true,d:17}, {b:true,d:23}, {b:true}, {b:true,d:7}, {b:true,d:16}, {b:true} ],
    [ {b:true,a:16}, {b:false}, {b:false}, {b:true,a:7}, {b:false}, {b:false}, {b:true,a:10}, {b:false}, {b:false}, {b:true} ],
    [ {b:true,a:24}, {b:false}, {b:false}, {b:false}, {b:false}, {b:false}, {b:true}, {b:true}, {b:true}, {b:true} ],
    [ {b:true}, {b:true,d:7}, {b:true,d:8}, {b:true,a:17}, {b:false}, {b:false}, {b:true,a:4}, {b:false}, {b:false}, {b:true} ],
    [ {b:true,a:23}, {b:false}, {b:false}, {b:false}, {b:false}, {b:false}, {b:true}, {b:true}, {b:true}, {b:true} ],
    [ {b:true,a:7}, {b:false}, {b:false}, {b:true}, {b:true,d:11}, {b:true,d:12}, {b:true,a:6}, {b:false}, {b:false}, {b:true} ],
    [ {b:true,a:12}, {b:false}, {b:false}, {b:true,a:4}, {b:false}, {b:false}, {b:true}, {b:true,d:4}, {b:true,d:3}, {b:true} ],
    [ {b:true}, {b:true,d:11}, {b:true,d:10}, {b:true}, {b:true,d:4}, {b:true,d:3}, {b:true}, {b:true}, {b:true}, {b:true} ],
    [ {b:true,a:11}, {b:false}, {b:false}, {b:true,a:3}, {b:false}, {b:false}, {b:true,a:4}, {b:false}, {b:false}, {b:true} ],
    [ {b:true}, {b:true}, {b:true}, {b:true}, {b:true}, {b:true}, {b:true}, {b:true}, {b:true}, {b:true} ],
  ]},
  { id:'hard-12',   title:'Hard 12×12', grid: [
    [{b:true},{b:true,d:23},{b:true,d:16},{b:true},{b:true,d:24},{b:true,d:17},{b:true},{b:true,d:12},{b:true,d:29},{b:true},{b:true,d:7},{b:true}],
    [{b:true,a:16},{b:false},{b:false},{b:true,a:7},{b:false},{b:false},{b:true,a:10},{b:false},{b:false},{b:true,a:6},{b:false},{b:false}],
    [{b:true,a:23},{b:false},{b:false},{b:false},{b:false},{b:false},{b:true},{b:true},{b:true},{b:true,a:4},{b:false},{b:false}],
    [{b:true},{b:true,d:7},{b:true,d:8},{b:true,a:16},{b:false},{b:false},{b:true,a:4},{b:false},{b:false},{b:true},{b:true},{b:true}],
    [{b:true,a:24},{b:false},{b:false},{b:false},{b:false},{b:false},{b:true},{b:true},{b:true},{b:true,a:3},{b:false},{b:false}],
    [{b:true,a:7},{b:false},{b:false},{b:true},{b:true,d:13},{b:true,d:12},{b:true,a:6},{b:false},{b:false},{b:true,a:4},{b:false},{b:false}],
    [{b:true,a:12},{b:false},{b:false},{b:true,a:3},{b:false},{b:false},{b:true},{b:true,d:4},{b:true,d:3},{b:true},{b:true},{b:true}],
    [{b:true},{b:true,d:11},{b:true,d:10},{b:true},{b:true,d:4},{b:true,d:3},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true}],
    [{b:true,a:11},{b:false},{b:false},{b:true,a:3},{b:false},{b:false},{b:true,a:4},{b:false},{b:false},{b:true,a:5},{b:false},{b:false}],
    [{b:true},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true},{b:true}],
    [{b:true,a:9},{b:false},{b:false},{b:true,a:7},{b:false},{b:false},{b:true,a:8},{b:false},{b:false},{b:true,a:6},{b:false},{b:false}],
    [{b:true},{b:true,d:9},{b:true,d:6},{b:true},{b:true,d:8},{b:true,d:7},{b:true},{b:true,d:10},{b:true,d:7},{b:true},{b:true,d:4},{b:true}],
  ]},
];
const curatedForDiff = (diff) =>
  diff === 'Easy'   ? CURATED[0] :
  diff === 'Normal' ? CURATED[1] :
  /* Hard & Expert share the same curated base for the rare fallback path */
  CURATED[2];

/* =============================== Model =============================== */
function buildModel(seed) {
  const grid = seed.grid.map(row => row.map(c => ({...c})));
  const H = grid.length, W = grid[0].length;
  const runs = [];
  const runIdAt = Array.from({length:H}, ()=>Array(W).fill({a:null,d:null}));

  // across
  for (let r=0;r<H;r++) for (let c=0;c<W;c++){
    const cell = grid[r][c];
    if (cell.b && cell.a) {
      const cells = []; let cc=c+1;
      while (cc<W && grid[r][cc] && !grid[r][cc].b){ cells.push([r,cc]); cc++; }
      if (cells.length>=2){ const id=runs.length; runs.push({ id, orientation:'across', sum:cell.a, cells }); cells.forEach(([rr,cc])=> runIdAt[rr][cc] = {...runIdAt[rr][cc], a:id}); }
    }
  }
  // down
  for (let r=0;r<H;r++) for (let c=0;c<W;c++){
    const cell = grid[r][c];
    if (cell.b && cell.d) {
      const cells = []; let rr=r+1;
      while (rr<H && grid[rr][c] && !grid[rr][c].b){ cells.push([rr,c]); rr++; }
      if (cells.length>=2){ const id=runs.length; runs.push({ id, orientation:'down', sum:cell.d, cells }); cells.forEach(([rr,cc])=> runIdAt[rr][cc] = {...runIdAt[rr][cc], d:id}); }
    }
  }
  const state = [];
  for (let r=0;r<H;r++){
    const row=[];
    for (let c=0;c<W;c++){
      const cell=grid[r][c];
      if (cell.b) row.push({ b:true, a:cell.a||0, d:cell.d||0 });
      else row.push({ b:false, value:0, notes:new Set(), autoNotes:new Set(), runAcross:runIdAt[r][c].a, runDown:runIdAt[r][c].d });
    }
    state.push(row);
  }
  return { H, W, runs, state };
}
const runCells   = (m, runId) => m.runs[runId].cells.map(([r,c]) => m.state[r][c]);
const runDigits  = (m, runId) => runCells(m, runId).map(c=>c.value).filter(v=>v>0);

function cellCandidates(model, r, c) {
  const cell = model.state[r][c];
  if (cell.b || cell.value) return new Set();
  const sets = [];
  if (cell.runAcross!=null) {
    const ra = model.runs[cell.runAcross];
    const placed = runDigits(model, cell.runAcross);
    const missing = runCells(model, cell.runAcross).filter(c=>c.value===0).length;
    const sumLeft = ra.sum - placed.reduce((a,b)=>a+b,0);
    const base = combos(sumLeft, missing);
    const used = new Set(placed);
    const possible = new Set();
    base.forEach(arr => arr.forEach(d => { if (!used.has(d)) possible.add(d); }));
    sets.push(possible);
  }
  if (cell.runDown!=null) {
    const rd = model.runs[cell.runDown];
    const placed = runDigits(model, cell.runDown);
    const missing = runCells(model, cell.runDown).filter(c=>c.value===0).length;
    const sumLeft = rd.sum - placed.reduce((a,b)=>a+b,0);
    const base = combos(sumLeft, missing);
    const used = new Set(placed);
    const possible = new Set();
    base.forEach(arr => arr.forEach(d => { if (!used.has(d)) possible.add(d); }));
    sets.push(possible);
  }
  if (!sets.length) return new Set([1,2,3,4,5,6,7,8,9]);
  let inter = sets[0];
  for (let i=1;i<sets.length;i++){ const next = new Set(); sets[i].forEach(v=>{ if (inter.has(v)) next.add(v); }); inter = next; }
  return inter;
}
function cellIllegal(model, r, c) {
  const cell = model.state[r][c];
  if (cell.b || !cell.value) return false;
  const v = cell.value;
  const checkRun = (runId) => {
    if (runId==null) return false;
    const rinfo = model.runs[runId];
    const cells = runCells(model, runId);
    const vals = cells.map(c=>c.value).filter(v=>v>0);
    if (vals.filter(x=>x===v).length>1) return true;
    const sum = vals.reduce((a,b)=>a+b,0);
    const empties = cells.filter(c=>c.value===0).length;
    if (sum > rinfo.sum) return true;
    if (empties===0 && sum!==rinfo.sum) return true;
    const used = new Set(vals);
    const avail = []; for (let d=1; d<=9; d++) if (!used.has(d)) avail.push(d);
    let min=0, max=0; for (let i=0;i<empties;i++){ min+=avail[i]||0; max+=avail[avail.length-1-i]||0; }
    if (sum + min > rinfo.sum) return true;
    if (sum + max < rinfo.sum) return true;
    return false;
  };
  return checkRun(cell.runAcross) || checkRun(cell.runDown);
}
function isSolved(model) {
  for (let r = 0; r < model.H; r++) {
    for (let c = 0; c < model.W; c++) {
      const cell = model.state[r][c];
      if (!cell.b) {
        if (!cell.value) return false;
        if (cellIllegal(model, r, c)) return false;
      }
    }
  }
  return true;
}

/* ========================== Solver & Uniqueness ====================== */
function cloneModel(model) {
  const m = { H:model.H, W:model.W, runs: JSON.parse(JSON.stringify(model.runs)), state:[] };
  for (let r=0;r<m.H;r++){
    const row=[];
    for (let c=0;c<m.W;c++){
      const s=model.state[r][c];
      if (s.b) row.push({ b:true, a:s.a||0, d:s.d||0 });
      else row.push({ b:false, value:s.value, notes:new Set(), runAcross:s.runAcross, runDown:s.runDown });
    }
    m.state.push(row);
  }
  return m;
}
function solveOne(model, maxSteps=600000) {
  const m = cloneModel(model);
  let solved=false, steps=0;
  function pick() {
    let best=null, bestCount=10;
    for (let r=0;r<m.H;r++) for (let c=0;c<m.W;c++){
      const cell=m.state[r][c]; if (cell.b||cell.value) continue;
      const cand=[...cellCandidates(m,r,c)]; if (cand.length===0) return null;
      if (cand.length<bestCount){ best={r,c,cand}; bestCount=cand.length; if (bestCount===1) return best; }
    }
    return best;
  }
  function dfs() {
    if (++steps>maxSteps) return;
    if (isSolved(m)) { solved=true; return; }
    const p=pick(); if (!p) return;
    for (const v of p.cand) {
      m.state[p.r][p.c].value=v;
      if (!cellIllegal(m,p.r,p.c)) { dfs(); if (solved) return; }
      m.state[p.r][p.c].value=0;
    }
  }
  dfs();
  if (!solved) return null;
  const vals=Array.from({length:m.H},()=>Array(m.W).fill(0));
  for (let r=0;r<m.H;r++) for (let c=0;c<m.W;c++){ const s=m.state[r][c]; if (!s.b) vals[r][c]=s.value; }
  return vals;
}
// Strong wrapper
function strongSolveFromSeed(seed, maxSteps = 2_000_000) {
  const m = buildModel(seed);
  return solveOne(m, maxSteps);
}

function countSolutions(model, maxSol=2, maxSteps=600000) {
  const m = cloneModel(model);
  let solutions=0, steps=0, done=false;
  function pick(){ let best=null,bestCount=10;
    for (let r=0;r<m.H;r++) for (let c=0;c<m.W;c++){
      const s=m.state[r][c]; if (s.b||s.value) continue;
      const cand=[...cellCandidates(m,r,c)]; if (cand.length===0) return null;
      if (cand.length<bestCount){ best={r,c,cand}; bestCount=cand.length; if (bestCount===1) return best; }
    } return best;
  }
  function dfs(){
    if (++steps>maxSteps || done) return;
    if (isSolved(m)) { solutions++; if (solutions>=maxSol) done=true; return; }
    const p=pick(); if (!p) return;
    for (const v of p.cand){
      if (done) return;
      m.state[p.r][p.c].value=v;
      if (!cellIllegal(m,p.r,p.c)) dfs();
      m.state[p.r][p.c].value=0;
    }
  }
  dfs();
  return { solutions, steps };
}

/* ===================== Solved-first fresh generator helpers ===================== */

// Bit helpers for digits 1–9
const DIGIT_BIT = Array.from({ length: 10 }, (_, d) => (d ? (1 << (d - 1)) : 0));
const ALL9 = (1 << 9) - 1;
function popcount(mask) {
  let c = 0;
  for (let m = mask; m; m &= (m - 1)) c++;
  return c;
}
function maskToDigits(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) {
    if (mask & DIGIT_BIT[d]) out.push(d);
  }
  return out;
}

// Cache all masks with exactly k digits set (for 2 ≤ k ≤ 9)
const MASKS_BY_LEN = Array.from({ length: 10 }, () => null);
function masksForLen(k) {
  if (MASKS_BY_LEN[k]) return MASKS_BY_LEN[k];
  const res = [];
  for (let m = 1; m < (1 << 9); m++) {
    if (popcount(m) === k) res.push(m);
  }
  MASKS_BY_LEN[k] = res;
  return res;
}

// --- Random black/white layout (true = black, false = white) ---
function generateLayout(spec, rnd) {
  const { W, H } = spec;
  const profiles = {
    sparse:   [0.50, 0.60],
    balanced: [0.56, 0.66],
    dense:    [0.60, 0.72],
    'dense+': [0.62, 0.75],
  };
  const [densLo, densHi] = profiles[spec.mask] || profiles.balanced;
  const targetWhite = Math.floor(W * H * (densLo + (densHi - densLo) * rnd()));

  const mask = Array.from({ length: H }, () => Array(W).fill(true)); // true = black
  const randInt = n => Math.floor(rnd() * n);

  let carved = 0;
  const walkCount = Math.max(4, Math.floor((W + H) / 3));

  const carve = (r, c) => {
    if (mask[r][c]) {
      mask[r][c] = false;
      carved++;
    }
  };

  // random walkers carve out white regions
  for (let w = 0; w < walkCount && carved < targetWhite; w++) {
    let r = randInt(H), c = randInt(W);
    for (let steps = 0; steps < W * H && carved < targetWhite; steps++) {
      carve(r, c);
      const dir = randInt(4);
      if (dir === 0 && r > 0) r--;
      else if (dir === 1 && r < H - 1) r++;
      else if (dir === 2 && c > 0) c--;
      else if (dir === 3 && c < W - 1) c++;
    }
  }

  // Remove single white cells (run length 1) so all runs are ≥ 2
  function killSingletons() {
    // across
    for (let r = 0; r < H; r++) {
      let c = 0;
      while (c < W) {
        while (c < W && mask[r][c]) c++;
        const start = c;
        while (c < W && !mask[r][c]) c++;
        if (c - start === 1) mask[r][start] = true;
      }
    }
    // down
    for (let c = 0; c < W; c++) {
      let r = 0;
      while (r < H) {
        while (r < H && mask[r][c]) r++;
        const start = r;
        while (r < H && !mask[r][c]) r++;
        if (r - start === 1) mask[start][c] = true;
      }
    }
  }
  killSingletons();

  // Split long runs
  const MAX_RUN = 5;
  function splitLongRuns() {
    // across
    for (let r = 0; r < H; r++) {
      let c = 0;
      while (c < W) {
        while (c < W && mask[r][c]) c++;
        const start = c;
        while (c < W && !mask[r][c]) c++;
        let len = c - start;
        while (len > MAX_RUN) {
          const cut = start + 1 + randInt(len - 1); // avoid endpoints
          mask[r][cut] = true;
          len = cut - start;
        }
      }
    }
    // down
    for (let c = 0; c < W; c++) {
      let r = 0;
      while (r < H) {
        while (r < H && mask[r][c]) r++;
        const start = r;
        while (r < H && !mask[r][c]) r++;
        let len = r - start;
        while (len > MAX_RUN) {
          const cut = start + 1 + randInt(len - 1);
          mask[cut][c] = true;
          len = cut - start;
        }
      }
    }
    killSingletons();
  }
  splitLongRuns();

  return mask;
}

// --- Extract runs (from mask) ---
function extractRuns(mask) {
  const H = mask.length, W = mask[0].length;
  const runs = [];

  // across
  for (let r = 0; r < H; r++) {
    let c = 0;
    while (c < W) {
      while (c < W && mask[r][c]) c++;
      const start = c;
      while (c < W && !mask[r][c]) c++;
      if (c - start >= 2) {
        const id = runs.length;
        const cells = [];
        for (let cc = start; cc < c; cc++) cells.push([r, cc]);
        runs.push({ id, orientation: 'across', cells, len: c - start });
      }
    }
  }
  // down
  for (let c = 0; c < W; c++) {
    let r = 0;
    while (r < H) {
      while (r < H && mask[r][c]) r++;
      const start = r;
      while (r < H && !mask[r][c]) r++;
      if (r - start >= 2) {
        const id = runs.length;
        const cells = [];
        for (let rr = start; rr < r; rr++) cells.push([rr, c]);
        runs.push({ id, orientation: 'down', cells, len: r - start });
      }
    }
  }
  return runs;
}

// --- Build a full solution grid given runs (digits first, sums later) ---
function buildSolvedGrid(runs, rnd, H, W) {
  if (!runs.length) return null;
  const randInt = n => Math.floor(rnd() * n);

  const cellMask = Array.from({ length: H }, () => Array(W).fill(ALL9));
  const cellKey = (r, c) => r * 1000 + c;
  const fixed = new Map();   // key -> digit
  const assigned = new Map(); // runId -> bitmask of digits used in that run

  const RUN_CANDS = runs.map(r => masksForLen(r.len));

  // index positions for overlaps
  const posIndex = runs.map(r => {
    const m = new Map();
    r.cells.forEach(([rr, cc], i) => {
      m.set(cellKey(rr, cc), i);
    });
    return m;
  });

  const overlaps = new Map(); // runId -> [ [pos, otherId, otherPos], ... ]
  for (const A of runs) {
    for (const [i, [r, c]] of A.cells.entries()) {
      for (const B of runs) {
        if (A.id === B.id) continue;
        const op = posIndex[B.id].get(cellKey(r, c));
        if (op != null) {
          if (!overlaps.has(A.id)) overlaps.set(A.id, []);
          overlaps.get(A.id).push([i, B.id, op]);
        }
      }
    }
  }

  function snapshot(cells) {
    return cells.map(([r, c]) => [r, c, cellMask[r][c]]);
  }
  function restore(snap) {
    for (const [r, c, m] of snap) {
      cellMask[r][c] = m;
      const bits = popcount(m);
      if (bits === 1) fixed.set(cellKey(r, c), maskToDigits(m)[0]);
      else fixed.delete(cellKey(r, c));
    }
  }

  function consistent(runId, mask) {
    const ov = overlaps.get(runId) || [];
    for (const [pos, otherId] of ov) {
      const [r, c] = runs[runId].cells[pos];
      const domain = cellMask[r][c];
      if ((domain & mask) === 0) return false;
      const otherMask = assigned.get(otherId);
      if (otherMask && (otherMask & mask) === 0) return false;
      const fx = fixed.get(cellKey(r, c));
      if (fx && !(mask & DIGIT_BIT[fx])) return false;
    }
    return true;
  }

  function commit(runId, mask) {
    assigned.set(runId, mask);
    const digits = maskToDigits(mask);
    const used = new Set();
    const cells = runs[runId].cells;
    const per = new Array(cells.length).fill(0);

    // fixed cells first
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      const fx = fixed.get(cellKey(r, c));
      if (fx) {
        if (!digits.includes(fx) || used.has(fx)) return false;
        per[i] = fx;
        used.add(fx);
      }
    }

    // fill remaining positions
    for (let i = 0; i < cells.length; i++) {
      if (per[i]) continue;
      const [r, c] = cells[i];
      const domain = cellMask[r][c];
      const choices = digits.filter(d => (domain & DIGIT_BIT[d]) && !used.has(d));
      if (!choices.length) return false;
      const d = choices[randInt(choices.length)];
      per[i] = d;
      used.add(d);
    }

    // write back domains and mark fixed
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      const d = per[i];
      cellMask[r][c] = DIGIT_BIT[d];
      fixed.set(cellKey(r, c), d);
    }
    return true;
  }

  function uncommit(runId, snap) {
    assigned.delete(runId);
    restore(snap);
  }

  function pickRun() {
    let best = null;
    let bestCount = 1e9;
    let bestCands = null;
    for (const run of runs) {
      if (assigned.has(run.id)) continue;
      const cands = RUN_CANDS[run.id].filter(m => consistent(run.id, m));
      if (!cands.length) return { id: run.id, cands: [] };
      if (cands.length < bestCount) {
        best = { id: run.id };
        bestCount = cands.length;
        bestCands = cands;
        if (bestCount === 1) break;
      }
    }
    if (!best) return null;
    best.cands = bestCands;
    return best;
  }

  function dfs() {
    const pick = pickRun();
    if (!pick) return true;        // all runs assigned
    if (!pick.cands.length) return false;
    const tries = pick.cands.slice();
    for (let i = tries.length - 1; i > 0; i--) {
      const k = randInt(i + 1);
      [tries[i], tries[k]] = [tries[k], tries[i]];
    }
    const snap = snapshot(runs[pick.id].cells);
    for (const m of tries) {
      if (!consistent(pick.id, m)) continue;
      if (!commit(pick.id, m)) { restore(snap); continue; }
      if (dfs()) return true;
      uncommit(pick.id, snap);
    }
    return false;
  }

  if (!dfs()) return null;

  const solved = Array.from({ length: H }, () => Array(W).fill(0));
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const m = cellMask[r][c];
      if (popcount(m) === 1) solved[r][c] = maskToDigits(m)[0];
      else solved[r][c] = 0;
    }
  }
  return solved;
}

// Use solver to confirm uniqueness (≤ 1M steps, stop at 2 solutions)
function hasUniqueSolution(grid) {
  const model = buildModel({ grid });
  const res = countSolutions(model, 2, 1_000_000);
  return res.solutions === 1;
}

/* ========================= Turbo Generator (Template Variants) ========================= */

/** Cache base solutions once so we never “compute solution” at runtime repeatedly. */
const _BASE_SOL_CACHE = new Map(); // key: seed.id -> { grid, solution }

/** Compute or get cached solution for a base seed. */
function getBaseWithSolution(seed) {
  if (_BASE_SOL_CACHE.has(seed.id)) return _BASE_SOL_CACHE.get(seed.id);
  const sol = seed.solution || strongSolveFromSeed(seed);
  const entry = { grid: seed.grid, solution: sol };
  _BASE_SOL_CACHE.set(seed.id, entry);
  return entry;
}

/** Deep copy 2D primitive matrix */
function clone2D(mat) { return mat.map(row => row.slice()); }

/** Transform helpers on 2D arrays */
function rotate90(mat) {
  const H = mat.length, W = mat[0].length;
  const out = Array.from({length: W}, () => Array(H));
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) out[c][H-1-r] = mat[r][c];
  return out;
}
function rotate180(mat){ return rotate90(rotate90(mat)); }
function rotate270(mat){ return rotate90(rotate180(mat)); }
function flipH(mat) {
  const H = mat.length, W = mat[0].length;
  const out = Array.from({length:H},()=>Array(W));
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) out[r][W-1-c] = mat[r][c];
  return out;
}
function flipV(mat) {
  const H = mat.length, W = mat[0].length;
  const out = Array.from({length:H},()=>Array(W));
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) out[H-1-r][c] = mat[r][c];
  return out;
}

/** Apply a symmetry to both solution and mask simultaneously. */
function applySymmetry(sol, mask, mode) {
  const doTx = (m) => {
    if (mode === 0) return m;
    if (mode === 1) return rotate90(m);
    if (mode === 2) return rotate180(m);
    if (mode === 3) return rotate270(m);
    if (mode === 4) return flipH(m);
    if (mode === 5) return flipV(m);
    if (mode === 6) return rotate90(flipH(m));
    if (mode === 7) return rotate270(flipV(m));
    return m;
  };
  return { sol: doTx(sol), mask: doTx(mask) };
}

/** From a base grid (with {b:true} for clues), build a boolean mask of black cells. */
function gridToMask(grid) {
  const H = grid.length, W = grid[0].length;
  const mask = Array.from({length:H},()=>Array(W).fill(false));
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) mask[r][c] = !!grid[r][c].b;
  return mask;
}

/** Given a mask (black cells) and a full solution (digits at white cells), make clue grid. */
function buildCluesFromSolution(mask, solution) {
  const H = mask.length, W = mask[0].length;
  const grid = Array.from({length:H},()=>Array(W));
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) grid[r][c] = mask[r][c] ? { b:true } : { b:false };

  // Across sums
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) {
    if (!grid[r][c].b) continue;
    if (c+1<W && !grid[r][c+1].b) {
      let cc=c+1, sum=0, len=0;
      while (cc<W && !grid[r][cc].b) { sum += solution[r][cc]; len++; cc++; }
      if (len>=2) grid[r][c].a = sum;
    }
  }
  // Down sums
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) {
    if (!grid[r][c].b) continue;
    if (r+1<H && !grid[r+1][c].b) {
      let rr=r+1, sum=0, len=0;
      while (rr<H && !grid[rr][c].b) { sum += solution[rr][c]; len++; rr++; }
      if (len>=2) grid[r][c].d = sum;
    }
  }
  return grid;
}

/** Random digit permutation (bijection 1..9) applied to solution. */
function permuteDigits(solution) {
  const perm = [1,2,3,4,5,6,7,8,9];
  for (let i=perm.length-1;i>0;i--) { const k=Math.floor(Math.random()*(i+1)); [perm[i],perm[k]]=[perm[k],perm[i]]; }
  const map = new Map(perm.map((d,i)=>[i+1, d]));
  const H = solution.length, W = solution[0].length;
  const out = Array.from({length:H},()=>Array(W).fill(0));
  for (let r=0;r<H;r++) for (let c=0;c<W;c++) {
    const v=solution[r][c]; out[r][c] = v ? map.get(v) : 0;
  }
  return out;
}

/** Use a curated seed as a template and return a fast variant with guaranteed solution. */
function templateVariant(diffLabel) {
  const base = curatedForDiff(diffLabel);
  const baseSolved = getBaseWithSolution(base); // { grid, solution }
  if (!baseSolved.solution) return null;

  const mask = gridToMask(baseSolved.grid);

  // random symmetry 0..7
  const sym = Math.floor(Math.random()*8);
  const { sol: solT, mask: maskT } = applySymmetry(baseSolved.solution, mask, sym);

  // random digit relabeling
  const solP = permuteDigits(solT);

  // rebuild clues from the transformed solution
  const grid = buildCluesFromSolution(maskT, solP);

  return { grid, solution: solP, H: grid.length, W: grid[0].length, baseId: base.id, sym };
}

/**
 * generatePuzzle(spec, seedKey, seededRng = null, opts = {})
 * Primary path: solved-first fresh generator (random layout → digits → clues → uniqueness),
 * then re-solve the puzzle and use that canonical solution to avoid any partial-solution weirdness.
 * Fallback: templateVariant / curated (still solution-first).
 */
async function generatePuzzle(spec, seedKey, seededRng = null, opts = {}) {
  const localSeedFn = seededRng || rng(seedOfDate(seedKey || `${spec.W}x${spec.H}:${Date.now()}`));
  const rnd = () => localSeedFn();
  const start = performance.now();
  const maxMs = opts.timeBudgetMs || spec.timeBudgetMs || 2600;
  let attempt = 0;

  // === 1) Solved-first fresh generation with uniqueness check ===
  while (performance.now() - start < maxMs) {
    attempt++;

    const mask = generateLayout(spec, rnd);
    const H = mask.length;
    const W = mask[0].length;

    const runs = extractRuns(mask);
    if (!runs.length) continue;

    const solvedDraft = buildSolvedGrid(runs, rnd, H, W);
    if (!solvedDraft) continue;

    const grid = buildCluesFromSolution(mask, solvedDraft);

    // Unique solution?
    if (!hasUniqueSolution(grid)) continue;

    // Use canonical solution from solver to ensure all white cells are filled.
    const finalSol = strongSolveFromSeed({ grid });
    if (!finalSol) continue;

    return {
      id: `${seedKey || 'fresh'}:sf:${Date.now().toString(36)}:${attempt}`,
      title: `${spec.W}×${spec.H} (Fresh)`,
      grid,
      solution: finalSol
    };
  }

  // === 2) Fallback: template variants / curated — still solution-first ===
  const diffName =
    spec.W <= 9  ? 'Easy'   :
    spec.W <= 10 ? 'Normal' :
    spec.W <= 12 ? 'Hard'   : 'Expert';

  const rndBak = Math.random;
  if (seededRng) Math.random = seededRng;

  const tv = templateVariant(diffName);
  if (tv) {
    Math.random = rndBak;
    return {
      id: `${seedKey || 'seed'}:tv:${tv.baseId}:${tv.sym}:${Date.now().toString(36)}`,
      title: `${spec.W}×${spec.H} (Turbo)`,
      grid: tv.grid,
      solution: tv.solution
    };
  }

  const fb = curatedForDiff(diffName);
  const sol = strongSolveFromSeed(fb) || fb.solution || null;
  Math.random = rndBak;

  return {
    id: `${seedKey || 'seed'}:curated:${Date.now().toString(36)}`,
    title: `${fb.title} (Fallback)`,
    grid: fb.grid,
    solution: sol
  };
}

/* ============================ Game Controller ======================== */
function createGame(seed, seedKey, meta) {
  const model = buildModel(seed);
  const history = [];
  const redoStack = [];
  let cursor = findFirstWhite(model) || { r:0, c:0 };

  // settings: all off by default except sound
  let notesMode = false;
  let softErrors = false;
  let autoAdvance = false;
  let highContrast = false;
  let reducedMotion = false;
  let strictMode = false;
  let autoNotes = false;

  // runtime
  let startedAt = now(), elapsed=0, running=true, mistakes=0, lastBlinkAt=0, lastShakeAt=0;
  let peekActive=false;
  let strictError = null; // { r, c, value, at }

  const hintsUsed = { reveal:0 };

  const saveKey = `${LS_PREFIX}:state:${seedKey}`;
  const saved = storage.get(saveKey, null);
  if (saved && saved.grid && saved.grid.length===model.H){
    for (let r=0;r<model.H;r++) for (let c=0;c<model.W;c++){
      const s = saved.grid[r][c], cell=model.state[r][c];
      if (!cell.b && s){ cell.value=s.v||0; cell.notes=new Set(s.n||[]); cell.autoNotes=new Set(); }
    }
    elapsed=saved.elapsed||0; mistakes=saved.mistakes||0;
    notesMode=!!saved.notesMode;
    softErrors=saved.softErrors===true;   // default false
    autoAdvance=saved.autoAdvance===true; // default false
    highContrast=!!saved.highContrast;
    reducedMotion=!!saved.reducedMotion;
    strictMode=!!saved.strictMode;
    autoNotes=!!saved.autoNotes;
    soundOn=saved.soundOn!==false;
    Object.assign(hintsUsed, saved.hintsUsed||{});
    if (saved.solution && Array.isArray(saved.solution)) meta.solution = saved.solution;
  }

  if (autoNotes) refreshAutoNotesAll();

  let needsSave=false, saveTimer=null;
  function scheduleSave(){ needsSave=true; if (saveTimer) return; saveTimer=setTimeout(()=>{ if (needsSave) doSave(); needsSave=false; saveTimer=null; }, AUTOSAVE_MS); }
  function doSave(){
    const grid=[]; for (let r=0;r<model.H;r++){ const row=[]; for (let c=0;c<model.W;c++){ const cell=model.state[r][c]; row.push(cell.b?null:{ v:cell.value, n:[...cell.notes] }); } grid.push(row); }
    storage.set(saveKey, {
      grid, elapsed:getElapsed(), mistakes,
      notesMode, softErrors, autoAdvance, highContrast, reducedMotion,
      strictMode, autoNotes, soundOn, hintsUsed,
      solution: meta.solution || null
    });
  }

  function getElapsed(){ return running ? (elapsed + (now()-startedAt)) : elapsed; }
  function pauseTimer(){ if (!running) return; elapsed=getElapsed(); running=false; }
  function resumeTimer(){ if (running) return; startedAt=now(); running=true; }
  function resetTimer(keepRunning){ elapsed=0; startedAt=now(); running=!!keepRunning; }

  function pushHistory(op){ history.push(op); redoStack.length=0; }

  function clearAutoNotesAll(){
    for (let r = 0; r < model.H; r++) {
      for (let c = 0; c < model.W; c++) {
        const cell = model.state[r][c];
        if (cell.b) continue;
        cell.autoNotes?.clear?.();
      }
    }
  }

  function refreshAutoNotesAll(){
    if (!autoNotes) return;
    for (let r = 0; r < model.H; r++) {
      for (let c = 0; c < model.W; c++) {
        const cell = model.state[r][c];
        if (cell.b) continue;
        if (cell.value === 0) cell.autoNotes = new Set(cellCandidates(model, r, c));
        else cell.autoNotes.clear();
      }
    }
  }

  function applyPlace(r,c,v, record=true, announceCb=null) {
    const cell = model.state[r][c]; if (cell.b) return;
    if (v===cell.value) return;

    // Strict mode: block incorrect with red flash, no placement
    if (strictMode && v>0) {
      if (!ensureSolution()) { announceCb?.('Strict mode needs a solution (auto-compute failed).'); return; }
      const corr = meta.solution?.[r]?.[c] || 0;
      if (v !== corr) {
        mistakes++;
        lastBlinkAt=now();
        lastShakeAt=now();
        strictError = { r, c, value: v, at: now() };
        sfx.errorSoft();
        scheduleSave();
        return;
      }
    }

    const prev = { v:cell.value, n:[...cell.notes] };
    if (record) pushHistory({ type:'place', r, c, before:prev, after:{ v, n:[] } });

    if (v===0){
      cell.value=0;
      // VALUE ONLY; notes handled by clearCell when we want both gone
      sfx.clear();
    } else {
      cell.value=v;
      cell.notes.clear();
      cell.autoNotes.clear();
      sfx.place();
    }

    if (softErrors && v>0 && cellIllegal(model,r,c)){
      mistakes++; lastBlinkAt=now(); lastShakeAt=now(); sfx.errorSoft();
    }
    refreshAutoNotesAll();
    scheduleSave();
  }

  function clearCell(r,c, record=true) {
    const cell=model.state[r][c]; if (cell.b) return;
    const prev={ v:cell.value, n:[...cell.notes] };
    if (record) pushHistory({ type:'clear', r,c, before:prev, after:{ v:0, n:[] } });
    cell.value=0;
    cell.notes.clear();
    cell.autoNotes.clear();
    sfx.clear();
    refreshAutoNotesAll();
    scheduleSave();
  }

  function clearNotes(r,c, record=true){
    const cell = model.state[r][c]; if (cell.b) return;
    const prev = { n:[...cell.notes], a:[...cell.autoNotes] };
    if (!prev.n.length && !prev.a.length) return;
    if (record) pushHistory({ type:'clearNotes', r, c, before: prev, after:{ n:[], a:[] } });
    cell.notes.clear();
    cell.autoNotes.clear();
    refreshAutoNotesAll();
    scheduleSave();
  }

  function clearAllNotes(record=true){
    const cells=[];
    for (let r=0;r<model.H;r++){
      for (let c=0;c<model.W;c++){
        const cell=model.state[r][c];
        if (cell.b) continue;
        if (cell.notes.size===0 && cell.autoNotes.size===0) continue;
        cells.push({ r, c, n:[...cell.notes], a:[...cell.autoNotes] });
        cell.notes.clear();
        cell.autoNotes.clear();
      }
    }
    if (record && cells.length) pushHistory({ type:'clearAllNotes', cells });
    refreshAutoNotesAll();
    scheduleSave();
  }

  function applyToggleNote(r,c,v, record=true){
    const cell=model.state[r][c]; if (cell.b||cell.value||autoNotes) return;
    const had = cell.notes.has(v);
    if (record) pushHistory({ type:'note', r,c,digit:v,before:had });
    if (had) cell.notes.delete(v); else cell.notes.add(v);
    scheduleSave();
  }

  function undo(){
    const op=history.pop(); if (!op) return;
    const cell=(op.r!=null && op.c!=null) ? model.state[op.r][op.c] : null;
    if (op.type==='place'||op.type==='clear'){
      const cur={ v:cell.value, n:[...cell.notes] };
      cell.value=op.before.v; cell.notes=new Set(op.before.n);
      redoStack.push({ ...op, redoFrom:cur });
    } else if (op.type==='note'){
      if (op.before) cell.notes.add(op.digit); else cell.notes.delete(op.digit);
      redoStack.push(op);
    } else if (op.type==='clearNotes'){
      const cur={ n:[...cell.notes], a:[...cell.autoNotes] };
      cell.notes=new Set(op.before.n);
      cell.autoNotes=new Set(op.before.a||[]);
      redoStack.push({ ...op, redoFrom:cur });
    } else if (op.type==='clearAllNotes'){
      op.cells.forEach(({r,c,n,a})=>{
        const tgt=model.state[r][c];
        tgt.notes=new Set(n);
        tgt.autoNotes=new Set(a||[]);
      });
      redoStack.push(op);
    }
    refreshAutoNotesAll(); scheduleSave();
  }
  function redo(){
    const op=redoStack.pop(); if (!op) return;
    const cell=(op.r!=null && op.c!=null) ? model.state[op.r][op.c] : null;
    if (op.type==='place'||op.type==='clear'){
      cell.value=op.after.v; cell.notes=new Set(op.after.n); history.push(op);
    } else if (op.type==='note'){
      if (op.before) cell.notes.delete(op.digit); else cell.notes.add(op.digit); history.push(op);
    } else if (op.type==='clearNotes'){
      cell.notes=new Set(op.after?.n||[]);
      cell.autoNotes=new Set(op.after?.a||[]);
      history.push(op);
    } else if (op.type==='clearAllNotes'){
      op.cells.forEach(({r,c})=>{
        const tgt=model.state[r][c];
        tgt.notes.clear();
        tgt.autoNotes.clear();
      });
      history.push(op);
    }
    refreshAutoNotesAll(); scheduleSave();
  }

  function findFirstWhite(m){ for (let r=0;r<m.H;r++) for (let c=0;c<m.W;c++) if (!m.state[r][c].b) return { r,c }; return null; }

  // Can we stand on (r,c)?
  const canStepCell = (r,c)=> r>=0 && r<model.H && c>=0 && c<model.W && !model.state[r][c].b;

  // Smart move: skip blacks, wrap, find next editable.
  function moveCursor(dr,dc, announceCb=null){
    const H = model.H, W = model.W;
    let { r, c } = cursor;
    for (let steps = 0; steps < H*W; steps++) {
      r = (r + dr + H) % H;
      c = (c + dc + W) % W;
      if (!model.state[r][c].b) {
        cursor = { r, c };
        sfx.select();
        announceCb?.(`Row ${r+1}, Col ${c+1}`);
        return true;
      }
    }
    return false;
  }

  function nextInRun(announceCb=null){
    const s=model.state[cursor.r][cursor.c];
    const runId = s.runAcross!=null ? s.runAcross : s.runDown;
    if (runId==null) return;
    const cells = model.runs[runId].cells;
    const idx = cells.findIndex(([r,c])=> r===cursor.r && c===cursor.c);
    const [nr,nc] = cells[Math.min(idx+1, cells.length-1)];
    if (nr===cursor.r && nc===cursor.c) return;
    cursor = { r:nr, c:nc }; sfx.select(); announceCb?.(`Row ${nr+1}, Col ${nc+1}`);
  }

  function setPeek(on){ peekActive = !!on; scheduleSave(); }
  function clearStrictError(){ strictError = null; }

  // Compute & cache a solution if missing (strict/peek safety net)
  function ensureSolution() {
    if (meta.solution && meta.solution.length) return true;

    const sourceSeed = meta.clues
      ? { grid: meta.clues }
      : { grid: model.state.map(row => row.map(c => c.b ? { b:true, a:c.a||0, d:c.d||0 } : { b:false })) };

    const solved = strongSolveFromSeed(sourceSeed);
    if (solved) { meta.solution = solved; scheduleSave(); return true; }
    return false;
  }

  // Simple hint: reveal solution at current cell
  function revealHint(announceCb, snackCb){
    const { r, c } = cursor;
    const cell = model.state[r][c];
    if (cell.b) { snackCb?.('Move to a number cell first.'); return null; }
    if (!ensureSolution()) { snackCb?.('Could not compute solution for this puzzle.'); return null; }
    const v = meta.solution?.[r]?.[c] || 0;
    if (!v) { snackCb?.('Nothing to reveal here.'); return null; }
    applyPlace(r, c, v, true, announceCb);
    hintsUsed.reveal++;
    snackCb?.(`Hint: the correct digit here is ${v}.`);
    return { r, c, v };
  }

  return {
    model,
    getElapsed, pauseTimer, resumeTimer, resetTimer,
    applyPlace, applyToggleNote, clearCell, clearNotes, clearAllNotes, undo, redo,
    moveCursor, nextInRun,
    cellCandidates: (r,c)=>cellCandidates(model,r,c),
    cellIllegal: (r,c)=>cellIllegal(model,r,c),
    isSolved: ()=>isSolved(model),

    revealHint,
    ensureSolution,
    setPeek,
    get peekActive(){return peekActive;},

    refreshAutoNotesAll,
    get strictError(){ return strictError; },
    clearStrictError,

    get cursor(){return cursor;}, set cursor(v){cursor=v; scheduleSave();},

    get notesMode(){return notesMode;}, set notesMode(v){notesMode=v; scheduleSave();},
    get softErrors(){return softErrors;}, set softErrors(v){softErrors=v; scheduleSave();},
    get autoAdvance(){return autoAdvance;}, set autoAdvance(v){autoAdvance=v; scheduleSave();},
    get highContrast(){return highContrast;}, set highContrast(v){highContrast=v; scheduleSave();},
    get reducedMotion(){return reducedMotion;}, set reducedMotion(v){reducedMotion=v; scheduleSave();},
    get strictMode(){return strictMode;}, set strictMode(v){strictMode=v; scheduleSave();},
    get autoNotes(){return autoNotes;}, set autoNotes(v){autoNotes=v; if (v) refreshAutoNotesAll(); else clearAutoNotesAll(); scheduleSave();},

    get mistakes(){return mistakes;}, addMistake(){mistakes++; scheduleSave();},
    blink(){ lastBlinkAt=now(); }, shake(){ lastShakeAt=now(); },
    get lastBlinkAt(){return lastBlinkAt;}, get lastShakeAt(){return lastShakeAt;},

    meta,
    hintsUsed
  };
}

/* ============================== Renderer ============================= */
function createRenderer(api, game, seedTitle, onRelaunch) {
  const root = api.mount;
  root.innerHTML = `
    <div class="kakuro-wrap">
      <div class="hud">
        <div class="left">
          <div class="menu">
            <button class="btn small" data-act="new" aria-haspopup="menu" aria-expanded="false" title="New (N)">New ▾</button>
            <div class="menu-pop hidden" id="newMenu" role="menu">
              <button role="menuitem" data-act="new-endless">Endless…</button>
              <button role="menuitem" data-act="new-daily">Daily</button>
              <button role="menuitem" data-act="new-restart">Restart</button>
            </div>
          </div>
          <button class="btn small" data-act="daily" title="Daily (D)">Daily</button>
          <button class="btn small" data-act="restart">Restart</button>
          <button class="btn small" data-act="share">Share</button>
          <button class="btn small" data-act="upload" title="Upload custom puzzle">Upload</button>
        </div>
        <div class="center">
          <span class="title">${GAME_TITLE}</span>
          <button class="pill" data-act="difficulty" title="Change difficulty">${game.meta?.diff || 'Normal'}</button>
          <span class="seed">${seedTitle}</span>
        </div>
        <div class="right">
          <button class="btn small" data-act="hint" title="Hint (H)">💡 Hint</button>
          <button class="btn small toggle notes" data-act="notes" title="Notes (Space)">Notes</button>
          <button class="btn small" data-act="settings" title="Settings">⚙</button>
        </div>
      </div>

      <div class="board">
        <div class="board-layer">
          <canvas aria-label="Kakuro board"></canvas>
          <div class="hint-banner" id="hintBanner" aria-live="polite"></div>
        </div>

        <div class="side">
          <div class="panel keypad-panel">
            <div class="panel-title">Keypad</div>
            <div class="keypad"></div>
          </div>
          <div class="panel">
            <div class="panel-title">Guide</div>
            <div class="guide">
              <div>Cell: <span id="cellLabel">—</span></div>
              <div>Clues: <span id="clueLabel">—</span></div>
              <div>Candidates: <span id="candLabel">—</span></div>
              <div style="opacity:.8;margin-top:6px;">Tip: Use Arrow keys or WASD. Hold <b>F</b> to peek.</div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">Stats</div>
            <div class="stats">
              <div>Time: <span class="time">0:00</span></div>
              <div>Mistakes: <span class="mistakes">0❌</span></div>
              <div>Mode: <span id="modeLabel">—</span></div>
            </div>
          </div>
        </div>

        <!-- Mobile drawer with keypad -->
        <div class="drawer" id="drawer">
          <div class="drawer-bar"><button class="ghost" id="drawerToggle" aria-expanded="false">▲ Controls</button></div>
          <div class="drawer-body">
            <div class="keypad keypad-mobile"></div>
          </div>
        </div>
      </div>

      <div class="snack" id="snack" role="status" aria-live="polite"></div>
      <div class="sr-only" aria-live="polite" id="live"></div>
    </div>

    <style>
      .kakuro-wrap{position:relative;display:flex;flex-direction:column;gap:12px;width:100%;height:100%;min-height:0;}
      .hud{position:relative;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
           background:var(--card,#171a21);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.35);color:var(--ink,#e9ecf1);}
      .hud .left,.hud .right{display:flex;align-items:center;gap:8px;}
      .hud .center{display:flex;gap:10px;align-items:center;min-width:0;}
      .hud .title{font-weight:700;letter-spacing:.3px;}
      .hud .seed{opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30vw;}
      .btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:var(--ink,#e9ecf1);
           border-radius:10px;padding:6px 12px;cursor:pointer;transition:transform .06s, background .15s;}
      .btn.small{padding:6px 10px;font-size:.9em;}
      .btn:hover{background:rgba(255,255,255,.10);transform:translateY(-1px);}
      .btn.toggle.active{background:var(--brand,#6aa6ff);border-color:transparent;color:#0b0c0f;}
      .pill{border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:4px 10px;background:rgba(255,255,255,.08);cursor:pointer;}

      .menu{position:relative;z-index:6;}
      .menu-pop{position:absolute;top:100%;left:0;z-index:2000;display:flex;flex-direction:column;min-width:220px;padding:6px;background:var(--card,#171a21);
        border:1px solid rgba(255,255,255,.15);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.45);}
      .menu-pop.hidden{display:none;}
      .menu-pop button{background:transparent;border:none;color:var(--ink,#e9ecf1);text-align:left;padding:10px;border-radius:8px;cursor:pointer;}
      .menu-pop button:hover{background:rgba(255,255,255,.08);}

      .board{position:relative;z-index:1;flex:1;display:grid;grid-template-columns:1fr minmax(240px,300px);gap:12px;min-height:0;}
      .board-layer{position:relative;grid-column:1/2;display:grid;place-items:center;min-height:0;}
      .board canvas{position:relative;z-index:1;width:100%;height:100%;background:var(--panel,#12141a);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.35);outline:none;min-height:220px;}
      .hint-banner{position:absolute;z-index:3;top:10px;left:50%;transform:translateX(-50%);max-width:min(96%,720px);
        background:rgba(0,0,0,.55);color:#fff;padding:8px 12px;border-radius:12px;font-size:.95em;backdrop-filter:saturate(1.2) blur(4px);}

      .side{position:relative;z-index:2;display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;}
      .panel{background:var(--card,#171a21);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:10px;}
      .panel-title{opacity:.85;margin-bottom:6px;font-weight:600;}
      .guide{opacity:.9;display:grid;gap:4px;font-size:.95em}

      .keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;align-content:start;}
      .keypad .k{padding:12px 0;text-align:center;border-radius:12px;background:var(--panel,#12141a);
                 border:1px solid rgba(255,255,255,.10);cursor:pointer;user-select:none;transition:transform .06s, background .12s;}
      .keypad .k:hover{background:rgba(255,255,255,.08);transform:translateY(-1px);}
      .keypad .k.zero{grid-column:span 3;}
      .keypad .k.notes{grid-column:span 3;}
      .keypad .k.disabled{opacity:.35;pointer-events:none;filter:saturate(.6);}
      .keypad .k.enabled{box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);}

      .drawer{display:none;grid-column:1 / -1;}
      .drawer .drawer-bar{display:flex;justify-content:center;margin-top:6px;}
      .drawer .drawer-body{display:none;}
      .drawer[aria-expanded="true"] .drawer-body{display:block;margin-top:8px;}
      .drawer .keypad-mobile{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:6px;}

      .snack{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.55);color:#fff;opacity:0;transition:opacity .18s;pointer-events:none;z-index:3000;}
      .snack.show{opacity:1;}
      .sr-only{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;}

      @media (max-width: 980px){
        .board{grid-template-columns:1fr;grid-template-rows:1fr auto;gap:10px;}
        .drawer{display:block;}
        .keypad-panel{display:none;}
      }
    </style>
  `;

  const canvas = root.querySelector('canvas'); canvas.setAttribute('tabindex','0');
  const keypadSide = root.querySelector('.keypad');
  const keypadMobile = root.querySelector('.keypad-mobile');
  const timeEl = root.querySelector('.time');
  const mistakesEl = root.querySelector('.mistakes');
  const notesBtn = root.querySelector('.btn.toggle.notes');
  const snack = root.querySelector('#snack');
  const live = root.querySelector('#live');
  const hintBanner = root.querySelector('#hintBanner');
  const cellLabel = root.querySelector('#cellLabel');
  const clueLabel = root.querySelector('#clueLabel');
  const candLabel = root.querySelector('#candLabel');
  const modeLabel = root.querySelector('#modeLabel');
  const boardEl = root.querySelector('.board-layer');

  const confettiCanvas = document.createElement('canvas');
  Object.assign(confettiCanvas.style,{ position:'absolute', inset:'0', pointerEvents:'none', zIndex:'5', width:'100%', height:'100%' });
  boardEl.appendChild(confettiCanvas);
  const confettiFx = makeConfetti ? makeConfetti(confettiCanvas, { duration:6, linger:0.4 }) : { burst:()=>{}, resize:()=>{} };

  // Mode label
  const isDaily = !!game.meta.daily;
  const diff = game.meta.diff || DEFAULT_DIFFICULTY;
  modeLabel.textContent = isDaily ? `Daily • ${game.meta.daily} • ${diff}` : `Endless • ${diff}`;

  // menus
  let openMenuEl=null;
  const openMenu = (btn,id)=>{ const m=root.querySelector(id); if (!m) return; closeMenu(); btn.setAttribute('aria-expanded','true'); m.classList.remove('hidden'); openMenuEl={btn,menu:m}; positionMenu(btn,m); };
  const closeMenu = ()=>{ if (!openMenuEl) return; openMenuEl.btn.setAttribute('aria-expanded','false'); openMenuEl.menu.classList.add('hidden'); openMenuEl=null; };
  const showSnack = (msg, ms=1500)=>{ if (!msg) return; snack.textContent=msg; snack.classList.add('show'); setTimeout(()=>snack.classList.remove('show'), ms); };
  const announce = msg => (live.textContent = msg || '');

  // keypad
  function buildKeypadHtml(){
    const keys=[]; for (let d=1; d<=9; d++) keys.push({t:String(d),act:`digit:${d}`});
    keys.push({ t:'Clear', act:'clear', cls:'zero' });
    keys.push({ t:'Clear Notes', act:'clearNotes', cls:'zero' });
    keys.push({ t:'Notes ✏️', act:'toggleNotes', cls:'notes' });
    return keys.map(k=>`<div class="k ${k.cls||''}" data-act="${k.act}">${k.t}</div>`).join('');
  }
  keypadSide.innerHTML = buildKeypadHtml();
  keypadMobile.innerHTML = buildKeypadHtml();

  function onKeypadClick(e){
    const k = e.target.closest('.k'); if (!k) return;
    const act=k.getAttribute('data-act');
    if (act==='clear') { clearCurrentCell(); return; }
    if (act==='clearNotes') { clearNotesCurrentCell(); return; }
    if (act==='toggleNotes') { toggleNotes(); return; }
    if (act.startsWith('digit:')) onDigit(parseInt(act.split(':')[1],10));
  }
  keypadSide.addEventListener('click', onKeypadClick);
  keypadMobile.addEventListener('click', onKeypadClick);

  function updateKeypadCandidates(){
    const { r,c } = game.cursor;
    const s = game.model.state[r][c];
    const allDigits = root.querySelectorAll('.keypad .k[data-act^="digit:"], .keypad-mobile .k[data-act^="digit:"]');

    // If auto-notes is OFF: keypad neutral, no candidate hints
    if (!game.autoNotes) {
      allDigits.forEach(el=>{
        el.classList.remove('enabled','disabled');
      });
      candLabel.textContent = s.b ? '—' : (s.value ? `fixed: ${s.value}` : '—');
      return;
    }

    const cands = s.b || s.value ? new Set() : game.cellCandidates(r,c);
    const enableMap = new Set(cands);
    allDigits.forEach(el=>{
      const d = Number(el.getAttribute('data-act').split(':')[1]);
      el.classList.toggle('enabled', enableMap.has(d));
      el.classList.toggle('disabled', !enableMap.has(d));
    });
    candLabel.textContent = s.b ? '—' : (s.value ? `fixed: ${s.value}` : (cands.size? [...cands].sort((a,b)=>a-b).join(', '): 'none'));
  }

  function updateGuideLabels(){
    const { r,c } = game.cursor;
    cellLabel.textContent = `R${r+1} • C${c+1}`;
    const s=game.model.state[r][c];
    if (s.b){ clueLabel.textContent='—'; return; }
    const a = s.runAcross!=null ? game.model.runs[s.runAcross].sum : null;
    const d = s.runDown!=null ? game.model.runs[s.runDown].sum : null;
    const parts=[]; if (a!=null) parts.push(`Across ${a}`); if (d!=null) parts.push(`Down ${d}`);
    clueLabel.textContent = parts.join(' • ') || '—';
  }

  // drawer open/close (mobile)
  const drawer = root.querySelector('#drawer'), drawerToggle = root.querySelector('#drawerToggle');
  drawerToggle.addEventListener('click', ()=>{
    const open = drawer.getAttribute('aria-expanded')==='true';
    drawer.setAttribute('aria-expanded', open?'false':'true');
    drawerToggle.textContent = open ? '▲ Controls' : '▼ Controls';
  });

  // HUD actions & menus
  on(root.querySelector('.hud'), 'click', async (e)=>{
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act==='new') openMenu(btn, '#newMenu');
    if (act==='daily') startDaily();
    if (act==='restart') confirmRestart();
    if (act==='share') openShare();
    if (act==='upload') openUpload();
    if (act==='undo') { game.undo(); needsPaint=true; }
    if (act==='redo') { game.redo(); needsPaint=true; }
    if (act==='notes') toggleNotes();
    if (act==='hint') doSimpleHint();
    if (act==='settings') openSettings();
    if (act==='difficulty') openDifficultyPicker();
  });
  on(root.querySelector('.hud'), 'click', (e)=>{
    const it = e.target.closest('#newMenu button'); if (!it) return;
    const a = it.getAttribute('data-act'); closeMenu();
    if (a==='new-endless') openDifficultyPicker();
    if (a==='new-daily') startDaily();
    if (a==='new-restart') confirmRestart();
  });
  on(document, 'pointerdown', (e)=>{ if (!openMenuEl) return; if (!openMenuEl.menu.contains(e.target) && !openMenuEl.btn.contains(e.target)) closeMenu(); }, { capture:true });

  // keyboard
  on(window,'keydown',(e)=>{
    if (isTextInputFocused()) return;
    const k = e.key;

    // digits
    if (/^[1-9]$/.test(k)) { onDigit(parseInt(k,10)); e.preventDefault(); return; }

    // clear
    if (k==='0' || k==='Backspace' || k==='Delete' || k.toLowerCase()==='x'){
      clearCurrentCell();
      e.preventDefault();
      return;
    }

    // movement
    if (k==='ArrowUp' || k.toLowerCase()==='w'){ game.moveCursor(-1,0,announce); needsPaint=true; e.preventDefault(); updateKeypadCandidates(); updateGuideLabels(); return; }
    if (k==='ArrowDown' || k.toLowerCase()==='s'){ game.moveCursor(1,0,announce); needsPaint=true; e.preventDefault(); updateKeypadCandidates(); updateGuideLabels(); return; }
    if (k==='ArrowLeft' || k.toLowerCase()==='a'){ game.moveCursor(0,-1,announce); needsPaint=true; e.preventDefault(); updateKeypadCandidates(); updateGuideLabels(); return; }
    if (k==='ArrowRight'|| k.toLowerCase()==='d'){ game.moveCursor(0,1,announce); needsPaint=true; e.preventDefault(); updateKeypadCandidates(); updateGuideLabels(); return; }

    // notes
    if (k===' '){ toggleNotes(); e.preventDefault(); return; }

    // run navigation
    if (k==='Tab'){ if (!e.shiftKey) game.nextInRun(announce); needsPaint=true; e.preventDefault(); updateKeypadCandidates(); updateGuideLabels(); return; }
    if (k==='Enter'){ game.nextInRun(announce); needsPaint=true; e.preventDefault(); updateKeypadCandidates(); updateGuideLabels(); return; }

    // undo/redo
    if ((e.ctrlKey||e.metaKey)&&k.toLowerCase()==='z'){ game.undo(); needsPaint=true; e.preventDefault(); return; }
    if ((e.ctrlKey||e.metaKey)&&(k.toLowerCase()==='y' || (e.shiftKey && k.toLowerCase()==='z'))){ game.redo(); needsPaint=true; e.preventDefault(); return; }
    if (!e.ctrlKey && !e.metaKey && k.toLowerCase()==='u'){ game.undo(); needsPaint=true; e.preventDefault(); return; }
    if (!e.ctrlKey && !e.metaKey && k.toLowerCase()==='r'){ game.redo(); needsPaint=true; e.preventDefault(); return; }

    // hint
    if (k.toLowerCase()==='h'){ doSimpleHint(); e.preventDefault(); return; }

    // Hold F to peek
    if (k.toLowerCase()==='f'){
      if (game.ensureSolution()) {
        game.setPeek(true);
        hintBanner.textContent='Peeking…';
        needsPaint=true;
      } else {
        showSnack('Could not compute solution to peek');
      }
      e.preventDefault();
      return;
    }

    if (k.toLowerCase()==='n'){ openMenu(root.querySelector('[data-act="new"]'), '#newMenu'); e.preventDefault(); return; }
    if (k.toLowerCase()==='d'){ startDaily(); e.preventDefault(); return; }
    if (k==='Escape'){ closeMenu(); closeAnyModal(); return; }
  }, { capture:true });
  on(window,'keyup',(e)=>{
    if (e.key.toLowerCase()==='f'){ game.setPeek(false); hintBanner.textContent=''; needsPaint=true; }
  });

  // select via mouse
  on(canvas,'mousedown',(e)=>{
    const { r,c } = pickCell(e);
    if (r==null) return;
    if (game.model.state[r][c].b) return;
    game.cursor = { r,c }; sfx.select(); announce(`Row ${r+1}, Col ${c+1}`); needsPaint=true; updateKeypadCandidates(); updateGuideLabels();
  });

  // ====== Responsive canvas ======
  let ctx, boardRect=null, metrics=null;
  const ro = new ResizeObserver(()=>{ resize(); });
  ro.observe(boardEl);
  on(window,'resize', resize, { passive:true });

  function resize(){
    const rect = boardEl.getBoundingClientRect();
    ({ ctx } = fitCanvas(canvas, rect.width, rect.height) || {});
    ctx = canvas.getContext('2d');
    fitCanvas(confettiCanvas, rect.width, rect.height);
    confettiFx?.resize?.();
    boardRect = rect;
    metrics = null;
    needsPaint=true;
  }

  function computeMetrics(){
    if (metrics) return metrics;
    const rect = boardRect || boardEl.getBoundingClientRect();
    const pad = Math.max(12, Math.floor(Math.min(rect.width, rect.height)*0.03));
    const w = rect.width - pad*2, h = rect.height - pad*2;
    const cellSize = clamp(Math.floor(Math.min(w/game.model.W, h/game.model.H)), 34, 84);
    const bw = cellSize * game.model.W, bh = cellSize * game.model.H;
    const ox = Math.floor((rect.width - bw)/2), oy = Math.floor((rect.height - bh)/2);
    metrics = { pad, cellSize, bw, bh, ox, oy, rectW:rect.width, rectH:rect.height };
    return metrics;
  }
  const css = (v,f)=> getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;

  // ====== Render loop (dirty) ======
  let rafId, needsPaint=true, lastTimeSec=-1, hintFlash=null;
  function tick(){
    const sec = Math.floor(game.getElapsed()/1000);
    if (sec!==lastTimeSec){ lastTimeSec=sec; timeEl.textContent = fmtTime(game.getElapsed()); needsPaint=true; }
    if (needsPaint) render();
    rafId = requestAnimationFrame(tick);
    needsPaint=false;
  }
  tick();

  function render(){
    mistakesEl.textContent = `${game.mistakes}❌`;
    notesBtn.classList.toggle('active', game.notesMode);

    const { H,W } = game.model;
    const { cellSize, bw, bh, ox, oy, rectW, rectH } = computeMetrics();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,rectW,rectH);

    const card = css('--card','#171a21'), ink = css('--ink','#e9ecf1'), ring=css('--ring','rgba(255,255,255,.06)');
    const brand = css('--brand','#6aa6ff'), warn = css('--bad','#ff7a7a');
    const runTint = game.highContrast ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.07)';

    ctx.save();
    ctx.translate(ox, oy);
    ctx.lineWidth = Math.max(1, Math.floor(cellSize*0.06));

    // background cells
    for (let r=0;r<H;r++) for (let c=0;c<W;c++){
      const x=c*cellSize, y=r*cellSize, cell=game.model.state[r][c];
      if (cell.b){
        ctx.fillStyle = card;
        roundRect(ctx, x+2,y+2,cellSize-4,cellSize-4, Math.min(6, cellSize*0.15)); ctx.fill();
        ctx.strokeStyle = ring; ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+cellSize-2,y+cellSize-2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `${Math.floor(cellSize*0.28)}px ui-sans-serif,system-ui`;
        ctx.textAlign='left'; ctx.textBaseline='top'; if (cell.a) ctx.fillText(String(cell.a), x+Math.floor(cellSize*0.14), y+Math.floor(cellSize*0.14));
        ctx.textAlign='right'; ctx.textBaseline='bottom'; if (cell.d) ctx.fillText(String(cell.d), x+cellSize-Math.floor(cellSize*0.14), y+cellSize-Math.floor(cellSize*0.14));
      } else {
        ctx.fillStyle = game.highContrast ? '#0e0f13' : '#141821';
        roundRect(ctx, x+2,y+2,cellSize-4,cellSize-4, Math.min(6, cellSize*0.15)); ctx.fill();
      }
    }

    // highlight active runs
    const cur = game.cursor;
    const active = (()=>{ const s=game.model.state[cur.r][cur.c]; const set=new Set(); if (s.runAcross!=null) set.add(s.runAcross); if (s.runDown!=null) set.add(s.runDown); return set; })();
    active.forEach(id=>{
      const run=game.model.runs[id]; ctx.fillStyle=runTint;
      run.cells.forEach(([rr,cc])=>{ const x=cc*cellSize,y=rr*cellSize; roundRect(ctx, x+2,y+2,cellSize-4,cellSize-4, Math.min(6, cellSize*0.15)); ctx.fill(); });
    });

    const strictErr = game.strictError;

    // numbers / notes / peek
    for (let r=0;r<H;r++) for (let c=0;c<W;c++){
      const s=game.model.state[r][c]; if (s.b) continue;
      const x=c*cellSize, y=r*cellSize;

      const illegal = game.softErrors && game.cellIllegal(r,c);
      const tSinceBlink = now()-game.lastBlinkAt;
      const blinkAlpha = illegal ? Math.max(0, 1-(tSinceBlink/350)) : 0;

      const isStrictErr = strictErr && strictErr.r===r && strictErr.c===c && (now()-strictErr.at)<260;

      if (isStrictErr){
        ctx.fillStyle = warn;
        ctx.font = `${Math.floor(cellSize*0.55)}px ui-sans-serif,system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(strictErr.value), x+cellSize/2, y+cellSize/2);
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = warn;
        roundRect(ctx,x+2,y+2,cellSize-4,cellSize-4,Math.min(6, cellSize*0.15)); ctx.fill();
        ctx.restore();
      } else if (s.value){
        ctx.fillStyle = illegal ? warn : ink;
        ctx.font = `${Math.floor(cellSize*0.55)}px ui-sans-serif,system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(s.value), x+cellSize/2, y+cellSize/2);
        if (blinkAlpha>0 && !game.reducedMotion){
          ctx.save(); ctx.globalAlpha=blinkAlpha*0.25; ctx.fillStyle=warn;
          roundRect(ctx,x+2,y+2,cellSize-4,cellSize-4,Math.min(6, cellSize*0.15)); ctx.fill(); ctx.restore();
        }
      } else {
        const mergedNotes = new Set([...(s.notes||[]), ...(s.autoNotes||[])]);
        if (!game.peekActive && mergedNotes.size>0){
          ctx.fillStyle='rgba(255,255,255,.65)';
          ctx.font=`${Math.floor(cellSize*0.18)}px ui-sans-serif,system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle';
          [...mergedNotes].sort((a,b)=>a-b).forEach(d=>{
            const idx=d-1, nx=x+((idx%3)+0.5)*(cellSize/3), ny=y+(Math.floor(idx/3)+0.5)*(cellSize/3);
            ctx.fillText(String(d), nx, ny);
          });
        }
      }

      // peek overlay
      if (game.peekActive && game.meta?.solution && !s.value){
        const v=game.meta.solution[r]?.[c]||0;
        if (v){
          ctx.save();
          ctx.fillStyle='rgba(255,255,255,.35)';
          ctx.font=`${Math.floor(cellSize*0.45)}px ui-sans-serif,system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(String(v), x+cellSize/2, y+cellSize/2);
          ctx.restore();
        }
      }
    }

    // selection border
    { const x=cur.c*cellSize, y=cur.r*cellSize; ctx.lineWidth=Math.max(2,Math.floor(cellSize*0.06)); ctx.strokeStyle=brand; roundRectStroke(ctx,x+2,y+2,cellSize-4,cellSize-4, Math.min(6, cellSize*0.15)); }

    // hint flash overlay (above selection)
    if (hintFlash){
      const elapsed = now()-hintFlash.at;
      const dur = 1100;
      if (elapsed>dur){ hintFlash=null; }
      else {
        const t = elapsed/dur;
        const glow = 1 - Math.pow(t, 2.3);
        const pulse = Math.sin(Math.min(1, t)*Math.PI);
        const pad = 2 + pulse*6;
        const x=hintFlash.c*cellSize + 2 - pad*0.4;
        const y=hintFlash.r*cellSize + 2 - pad*0.4;
        ctx.save();
        ctx.lineWidth = Math.max(2, Math.floor(cellSize*0.07) + pulse*0.6);
        ctx.strokeStyle = `rgba(255,255,255,${0.55*glow})`;
        roundRectStroke(ctx,x,y,cellSize-4+pad*0.8,cellSize-4+pad*0.8, Math.min(10, cellSize*0.2));
        ctx.globalAlpha = 0.25*glow;
        ctx.fillStyle = `rgba(255,255,255,${0.28})`;
        roundRect(ctx,x+3,y+3,cellSize-6,cellSize-6, Math.min(10, cellSize*0.18));
        ctx.restore();
      }
    }

    const sinceShake = now()-game.lastShakeAt;
    if (sinceShake<220 && !game.reducedMotion){
      const t=sinceShake/220;
      const dx=Math.sin(t*12*Math.PI)*Math.max(0,(1-t))*3;
      ctx.translate(dx,0);
    }

    ctx.restore();

    // clear old strict error after flash
    if (strictErr && (now()-strictErr.at)>=260){
      game.clearStrictError();
    }
  }

  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function roundRectStroke(ctx,x,y,w,h,r){ roundRect(ctx,x,y,w,h,r); ctx.stroke(); }

  function pickCell(e){
    const rect = boardRect || boardEl.getBoundingClientRect();
    const { cellSize, bw, bh, ox, oy } = computeMetrics();
    const cx = (e.clientX ?? (e.touches && e.touches[0]?.clientX)) - rect.left;
    const cy = (e.clientY ?? (e.touches && e.touches[0]?.clientY)) - rect.top;
    const mx = cx - ox, my = cy - oy;
    if (mx<0||my<0||mx>=bw||my>=bh) return { r:null, c:null };
    const c = Math.floor(mx / cellSize), r = Math.floor(my / cellSize);
    return { r,c };
  }

  function toggleNotes(){
    game.notesMode=!game.notesMode;
    notesBtn.classList.toggle('active', game.notesMode);
    announce(`Notes ${game.notesMode?'on':'off'}`);
    needsPaint=true;
  }

  function clearCurrentCell(){
    const { r, c } = game.cursor;
    const s = game.model.state[r][c];
    if (s.b) return;
    game.clearCell(r,c,true);
    needsPaint = true;
    updateKeypadCandidates();
    updateGuideLabels();
  }

  function clearNotesCurrentCell(){
    const { r, c } = game.cursor;
    const s = game.model.state[r][c];
    if (s.b) return;
    game.clearNotes(r,c,true);
    needsPaint = true;
    updateKeypadCandidates();
    updateGuideLabels();
  }

  function onDigit(d){
    const { r,c } = game.cursor; const s=game.model.state[r][c]; if (s.b) return;

    if (d === 0){
      clearCurrentCell();
      return;
    }

    if (game.notesMode && d>0 && !s.value) {
      game.applyToggleNote(r,c,d);
      sfx.select();
    } else {
      game.applyPlace(r,c,d,true,announce);
    }

    if (game.autoNotes) game.refreshAutoNotesAll();

    // no auto-move after digit; stay on cell
    if (game.isSolved()){
      game.pauseTimer();
      confettiFx?.burst?.({ count: 260 });
      sfx.fanfare?.();
      showSnack('Solved! 🎉');
    }
    needsPaint=true; updateKeypadCandidates(); updateGuideLabels();
  }

  function positionMenu(anchor, menu){
    const ab = anchor.getBoundingClientRect(), hb=root.querySelector('.hud').getBoundingClientRect();
    menu.style.left=(ab.left-hb.left)+'px';
  }

  // ----- New / Daily / Difficulty -----
  async function generateAndRelaunch(diff, opts={ daily:false }){
    const spec = DIFF_SPECS[diff] || DIFF_SPECS[DEFAULT_DIFFICULTY];
    const overlay=document.createElement('div');
    overlay.className='modal-backdrop';
    overlay.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:2000;';
    overlay.innerHTML=`
      <div role="dialog" style="background:var(--card,#171a21);border:1px solid rgba(255,255,255,.12);color:var(--ink,#e9ecf1);border-radius:14px;padding:16px;width:min(420px,92vw);text-align:center">
        <div style="font-weight:600;margin-bottom:6px">${opts.daily?'Building Daily':'Generating'} ${diff}…</div>
        <div style="opacity:.8;margin-bottom:10px">Unique solution, difficulty tuned</div>
        <div style="margin:8px auto 14px;width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:var(--brand,#6aa6ff);animation:spin 1s linear infinite"></div>
        <div><button class="btn small" data-act="cancel">Cancel</button></div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg);}}</style>`;
    root.querySelector('.kakuro-wrap').appendChild(overlay);
    let aborted=false;
    const off=on(overlay,'click',(e)=>{ if (e.target.closest('[data-act="cancel"]')) { aborted=true; overlay.remove(); showSnack('Cancelled'); off(); } });

    try {
      const today = new Date().toISOString().slice(0,10);
      const seedKey = opts.daily ? `daily-${today}` : `endless-${diff}`;
      const seeded = opts.daily ? rng(seedOfDate(`${diff}:${today}`)) : null;
      const puz = await generatePuzzle(spec, seedKey, seeded, { timeBudgetMs: spec.timeBudgetMs });
      if (aborted || !puz) return;
      const niceTitle = opts.daily
        ? `Daily • ${today} • ${diff} • ${spec.W}×${spec.H}`
        : `Endless • ${diff} • ${spec.W}×${spec.H}`;
      const nextSeed = { id: puz.id, title: niceTitle, grid: puz.grid, solution: puz.solution };
      overlay.remove();
      onRelaunch(
        nextSeed,
        opts.daily ? `daily:${today}` : `endless:${diff}:${puz.id}`,
        { diff, solution:puz.solution, daily: opts.daily? today: null }
      );
    } catch {
      overlay.remove(); showSnack('Using curated board');
      const fb = curatedForDiff(diff); const sol = strongSolveFromSeed(fb) || null;
      const niceTitle = opts.daily
        ? `Daily • ${new Date().toISOString().slice(0,10)} • ${diff} • ${fb.grid[0].length}×${fb.grid.length}`
        : `Endless • ${diff} • ${fb.grid[0].length}×${fb.grid.length}`;
      onRelaunch(
        { ...fb, title: niceTitle, solution: sol },
        opts.daily ? `daily:${new Date().toISOString().slice(0,10)}` : `endless:${diff}:curated`,
        { diff, solution: sol, daily: opts.daily ? new Date().toISOString().slice(0,10): null }
      );
    } finally { off(); }
  }

  function startDaily(){
    const diffToday = difficultyForToday();
    generateAndRelaunch(diffToday, { daily:true });
  }

  function openDifficultyPicker(){
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:2000;';
    const items = Object.entries(DIFF_SPECS).map(([k,v]) => `
      <button class="diff-item" data-d="${k}">
        <div class="diff-row">
          <div class="diff-title">${k}</div>
          <div class="diff-note">${v.label}</div>
          <div class="diff-size">${v.W}×${v.H}</div>
        </div>
      </button>
    `).join('');
    modal.innerHTML = `
      <div role="dialog" aria-label="Choose difficulty"
           style="background:var(--card,#171a21);border:1px solid rgba(255,255,255,.12);color:var(--ink,#e9ecf1);
                  border-radius:14px;padding:14px;width:min(540px,92vw);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <h3 style="margin:0;font-size:1.05rem">New Endless Game</h3>
          <button class="btn small" data-act="close">Close</button>
        </div>
        <div style="display:grid;gap:8px">
          ${items}
        </div>
      </div>
      <style>
        .diff-item{display:block;width:100%;text-align:left;background:transparent;color:inherit;border:1px solid rgba(255,255,255,.12);
                   border-radius:12px;padding:10px;cursor:pointer;}
        .diff-item:hover{background:rgba(255,255,255,.08);}
        .diff-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center}
        .diff-title{font-weight:700}
        .diff-note{opacity:.85}
        .diff-size{opacity:.65}
      </style>
    `;
    root.querySelector('.kakuro-wrap').appendChild(modal);

    const off = on(modal,'click',(e)=>{
      if (e.target.closest('[data-act="close"]')) { modal.remove(); off(); return; }
      const b = e.target.closest('.diff-item'); if (!b) return;
      const diff = b.getAttribute('data-d');
      modal.remove(); off();
      onRelaunch(null, null, { diff }); // remember diff
      generateAndRelaunch(diff, { daily:false });
    });
    on(window,'keydown',(e)=>{ if (e.key==='Escape'){ modal.remove(); off(); } }, { once:true, capture:true });
  }

  // ----- Restart current board (no new puzzle) -----
  function confirmRestart(){
    const panel=document.createElement('div');
    panel.className='modal-backdrop';
    panel.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:2000;';
    panel.innerHTML=`
      <div role="dialog" style="background:var(--card,#171a21);border:1px solid rgba(255,255,255,.12);color:var(--ink,#e9ecf1);border-radius:14px;padding:14px;width:min(420px,92vw);text-align:center">
        <div style="margin-bottom:10px">Restart this puzzle? (Clears your entries)</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn small" data-act="yes">Restart</button>
          <button class="btn small" data-act="no">Cancel</button>
        </div>
      </div>`;
    root.querySelector('.kakuro-wrap').appendChild(panel);
    const off=on(panel,'click',(e)=>{
      const a=e.target.getAttribute('data-act');
      if (a==='yes'){
        for (let r=0;r<game.model.H;r++) for (let c=0;c<game.model.W;c++){
          const s=game.model.state[r][c]; if (!s.b){ s.value=0; s.notes.clear(); }
        }
        game.resetTimer(true);
        showSnack('Restarted');
        game.refreshAutoNotesAll();
        needsPaint=true; updateKeypadCandidates(); updateGuideLabels();
        panel.remove(); off();
      }
      if (a==='no'){ panel.remove(); off(); }
    });
  }

  function openShare(){
    const isDaily = !!game.meta.daily;
    const mode = isDaily ? `Daily ${game.meta.daily}` : 'Endless';
    const diff = game.meta?.diff || DEFAULT_DIFFICULTY;
    const spec = DIFF_SPECS[diff] || DIFF_SPECS[DEFAULT_DIFFICULTY];
    const timeStr = fmtTime(game.getElapsed());
    const line = `${GAME_TITLE} — ${mode}
Difficulty: ${diff} • Size: ${spec.W}×${spec.H}
Time: ${timeStr}
Mistakes: ${game.mistakes}`;

    navigator.clipboard?.writeText(line)
      .then(()=>showSnack('Copied share text to clipboard'))
      .catch(()=>{ showSnack('Copy failed — see console'); console.log(line); });
  }

  function openUpload(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.style.display='none';
    input.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.grid || !Array.isArray(data.grid) || !data.solution || !Array.isArray(data.solution)) {
            throw new Error('Missing grid/solution arrays');
          }
          const title = data.title || 'Uploaded puzzle';
          const diff = data.diff || 'Custom';
          onRelaunch(
            { id: `upload-${Date.now()}`, title, grid: data.grid, solution: data.solution },
            `upload:${Date.now().toString(36)}`,
            { diff, solution: data.solution, daily: null }
          );
        } catch (err) {
          console.error(err);
          showSnack('Invalid puzzle file (needs JSON with grid + solution).');
        }
      };
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(()=>input.remove(), 0);
  }

  function openSettings(){
    const panel=document.createElement('div');
    panel.className='modal-backdrop';
    panel.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:2000;';
    panel.innerHTML=`
      <div role="dialog" style="background:var(--card,#171a21);border:1px solid rgba(255,255,255,.12);color:var(--ink,#e9ecf1);border-radius:14px;padding:14px;width:min(520px,92vw);">
        <h3 style="margin:0 0 10px">Settings</h3>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${game.autoNotes?'checked':''} data-key="autoNotes"> Auto-notes (show candidates)
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${game.softErrors?'checked':''} data-key="soft"> Soft error highlights
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${game.strictMode?'checked':''} data-key="strict"> Strict mode (block incorrect)
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${game.autoAdvance?'checked':''} data-key="auto"> Auto-advance within run (unused by default)
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${soundOn?'checked':''} data-key="sound"> Sound
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${game.highContrast?'checked':''} data-key="hc"> High contrast
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <input type="checkbox" ${game.reducedMotion?'checked':''} data-key="rm"> Reduced motion
        </label>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn small" data-act="clear-cell-notes">Clear cell notes</button>
            <button class="btn small" data-act="clear-board-notes">Clear all notes</button>
          </div>
          <button class="btn small" data-act="close">Close</button>
        </div>
      </div>`;
    root.querySelector('.kakuro-wrap').appendChild(panel);
    const off=on(panel,'click',(e)=>{
      const chk=e.target.closest('input[type="checkbox"]');
      if (chk){
        const key=chk.getAttribute('data-key');
        if (key==='autoNotes'){ game.autoNotes=chk.checked; if (chk.checked) game.refreshAutoNotesAll(); }
        if (key==='soft') game.softErrors=chk.checked;
        if (key==='strict'){
          if (chk.checked) {
            if (game.ensureSolution()) {
              game.strictMode = true; showSnack('Strict mode ON — incorrect digits are blocked.');
            } else {
              chk.checked=false; game.strictMode=false; showSnack('Could not compute solution — strict mode requires a solution.');
            }
          } else { game.strictMode=false; showSnack('Strict mode OFF'); }
        }
        if (key==='auto') game.autoAdvance=chk.checked;
        if (key==='sound') soundOn=chk.checked;
        if (key==='hc') game.highContrast=chk.checked;
        if (key==='rm') game.reducedMotion=chk.checked;
        needsPaint=true; updateKeypadCandidates();
      }
      const clearCellBtn=e.target.closest('[data-act="clear-cell-notes"]');
      if (clearCellBtn){ clearNotesCurrentCell(); showSnack('Notes cleared for this cell'); return; }
      const clearBoardBtn=e.target.closest('[data-act="clear-board-notes"]');
      if (clearBoardBtn){ game.clearAllNotes(true); needsPaint=true; updateKeypadCandidates(); updateGuideLabels(); showSnack('All notes cleared'); return; }
      const b=e.target.closest('[data-act="close"]'); if (b){ off(); panel.remove(); }
    });
    on(window,'keydown',(e)=>{ if (e.key==='Escape'){ off(); panel.remove(); } }, { once:true, capture:true });
  }

  function doSimpleHint(){
    const res = game.revealHint(announce, showSnack);
    if (!res) return;
    hintFlash = { ...res, at: now() };
    needsPaint = true;
    updateKeypadCandidates();
    updateGuideLabels();
  }

  function closeAnyModal(){ root.querySelectorAll('.modal-backdrop').forEach(n=>n.remove()); }

  function stop(){ cancelAnimationFrame(rafId); ro.disconnect(); }

  // initial UI helpers
  updateGuideLabels();
  updateKeypadCandidates();

  return { stop };
}

/* =========================== Public module =========================== */
export default {
  id: GAME_ID,
  title: GAME_TITLE,
  icon: '🧮',
  tags: ['logic','number','daily'],
  launch(api, seedArg, seedKeyArg, metaArg){
    const el = api?.mount;
    if (!el) throw new Error('kakuro: mount element not found');

    // Prepare seed + ALWAYS ensure solution, stash original clues for future recompute
    const base = seedArg || { ...CURATED[1] };
    const baseClues = base.grid; // original clues
    const baseSol = base.solution || strongSolveFromSeed({ grid: baseClues });
    const seed = { ...base, solution: baseSol };
    const seedKey = seedKeyArg || seed.id;
    const meta = {
      diff: (metaArg?.diff || DEFAULT_DIFFICULTY),
      daily: metaArg?.daily || null,
      solution: baseSol,
      clues: baseClues
    };

    const game = createGame(seed, seedKey, meta);
    game.ensureSolution(); // strict/peek ready even for legacy saves

    const onRelaunch = (newSeed, newKey, newMeta={})=>{
      this._teardown?.();
      el.innerHTML='';
      const useSeed = newSeed || seed; // allow remembering diff without immediate new seed
      const sol = useSeed.solution || strongSolveFromSeed({ grid: useSeed.grid });
      this.launch(
        api,
        { ...useSeed, solution: sol },
        newKey || seedKey,
        { ...meta, ...newMeta, solution: sol, clues: useSeed.grid }
      );
    };

    const ui = createRenderer(api, game, seed.title, onRelaunch);
    const pause = ()=> game.pauseTimer();
    const resume = ()=> game.resumeTimer();
    this._teardown = ()=> ui.stop?.();
    return { dispose:this._teardown, pause, resume };
  },
  unmount(){ this._teardown?.(); this._teardown=null; },
  getSnapshot(){ return { title: GAME_TITLE, subtitle: 'Daily • Smart nav • Strict' }; },
  restoreSnapshot(){}
};
