// src/games/match3.js
// Match-3+ — Old-engine core (init prevents immediate 3s; collapse spawns random) with:
// • Balanced color distribution (init multiset bag + spawn bags per column/row)
// • Post-stabilize permutation-only Move Enforcer (no recolors), so Nightmare = 1–2 moves
// • CVD-safe palette + High-Contrast option
// • Fullscreen-safe, compact settings
//
// No specials. 4 gravities supported (Nightmare can rotate gravity).
// All “shaping” happens only after cascades finish; input is locked outside idle.
//
// ---------------------------------------------------------------------

import { fitCanvas, makeHUD } from '../kit/gamekit.js';

export default {
  id: 'match3',
  title: 'Match-3+',
  category: 'puzzle',
  icon: '🍬',
  tags: ['swap', 'cascades', 'timed', 'hardcore'],
  launch(api) {
    // ---------------- Tunables ----------------
    let TILE = 56;               // recalculated by layout()
    const PAD = 8;
    const CLEAR_MS = 120;
    const FALL_MS = 170;
    const SWAP_MS = 110;
    const INVALID_MS = 140;
    const DEFAULT_TIMED_MS = 100 * 1000;
    const IDLE_HINT_MS = 6000;

    const PER_TILE = 8;

    // >>> Harder presets with TARGET MOVE RANGES (after each settle) <<<
    const DIFFS = {
      basic:    { n: 8,  colors: 7,  mode: 'endless', time: null,    moves: null, strikes: false, idleHints: true,  deadFreeze: false, gravityRot: false, target:{min:6, max:10} },
      easy:     { n: 9,  colors: 8,  mode: 'timed',   time: 120e3,   moves: null, strikes: false, idleHints: true,  deadFreeze: false, gravityRot: false, target:{min:4, max:7}  },
      medium:   { n: 9,  colors: 9,  mode: 'timed',   time: 100e3,   moves: null, strikes: false, idleHints: false, deadFreeze: false, gravityRot: false, target:{min:3, max:5}  },
      hard:     { n: 10, colors: 9,  mode: 'moves',   time: null,    moves: 40,   strikes: true,  idleHints: false, deadFreeze: false, gravityRot: false, target:{min:3, max:5}  },
      extreme:  { n: 10, colors: 10, mode: 'timed',   time: 90e3,    moves: null, strikes: true,  idleHints: false, deadFreeze: true,  gravityRot: false, target:{min:2, max:3}  },
      nightmare:{ n: 11, colors: 10, mode: 'moves',   time: null,    moves: 35,   strikes: true,  idleHints: false, deadFreeze: true,  gravityRot: true,  target:{min:1, max:2}  },
    };

    // ---------------- Config ----------------
    const defaults = {
      difficulty: 'nightmare',
      mode: 'endless',            // label; preset overrides runtime
      reducedMotion: false,
      colorAssist: false,
      highContrast: true,         // NEW: crisp borders + glyphs
      shapeAssist: false,         // big glyph overlay (Extreme+)
      hintsOnHard: false,         // ignored if preset idleHints=false
      showMoveCounter: true,
      devOverlay: false,
    };
    let cfg = { ...defaults };

    // Runtime params (derived)
    const params = {
      n: 10,
      colors: 10,
      gameMode: 'endless',        // 'endless' | 'timed' | 'moves'
      movesLeft: null,
      allowIdleHints: true,
      strikeEnabled: false,
      deadFreeze: false,
      gravityRot: false,
      gravity: 'down',            // 'down' | 'left' | 'up' | 'right'
      tgtMin: 3,
      tgtMax: 5,
    };

    // ---------------- Persistence ----------------
    const SKEY = (k) => `match3:v13:${k}`;
    const save = (k, v) => { try { localStorage.setItem(SKEY(k), JSON.stringify(v)); } catch {} };
    const load = (k, d) => { try { const v = localStorage.getItem(SKEY(k)); return v ? JSON.parse(v) : d; } catch { return d; } };
    const bests = load('bests', {});
    const savedCfg = load('cfg', null);
    if (savedCfg) cfg = { ...cfg, ...savedCfg };

    // ---------------- Wrapper / Top Bar ----------------
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      maxWidth: 'min(92vw, 1080px)',
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: '1fr',
      justifyItems: 'center',
      gap: '6px'
    });
    api.mount.appendChild(wrapper);

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display:'grid', gridTemplateColumns:'1fr auto', gap:'6px', alignItems:'center', width:'100%'
    });

    const chip = (txt) => {
      const b = document.createElement('button');
      b.textContent = txt;
      Object.assign(b.style, {
        padding:'3px 8px', borderRadius:'999px',
        border:'1px solid rgba(255,255,255,.16)',
        background:'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))',
        color:'#e9ecf1', cursor:'pointer', fontSize:'12px', lineHeight:'1'
      });
      return b;
    };

    const diffKeys = ['basic','easy','medium','hard','extreme','nightmare'];
    const modeKeys = ['endless','timed']; // cosmetic only
    const modeLabels = { endless:'Endless', timed:'Timed (100s)' };
    const diffChips = diffKeys.map(k => chip(k[0].toUpperCase()+k.slice(1)));
    const modeChips = modeKeys.map(k => chip(modeLabels[k]));

    const rowL = document.createElement('div');
    Object.assign(rowL.style, { display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center' });
    diffChips.forEach(b=>rowL.appendChild(b));
    const sep = () => { const s=document.createElement('span'); s.style.width='4px'; return s; };
    rowL.appendChild(sep());
    modeChips.forEach(b=>rowL.appendChild(b));

    // Right group: Score / Time / Settings
    const mkChipBox = (label) => {
      const box = document.createElement('div');
      Object.assign(box.style, {
        display:'grid', gridTemplateColumns:'auto auto', gap:'6px',
        alignItems:'center', padding:'3px 8px', borderRadius:'10px',
        border:'1px solid rgba(255,255,255,.14)',
        background:'linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02))',
        color:'#e9ecf1', minWidth:'118px', justifyContent:'space-between'
      });
      const lab = document.createElement('span');
      lab.textContent = label; lab.style.opacity = '.75'; lab.style.fontSize='11px';
      const val = document.createElement('strong'); val.textContent='0'; val.style.fontSize='18px';
      box.appendChild(lab); box.appendChild(val);
      return { box, lab, val };
    };
    const scoreChip = mkChipBox('Score');
    const timeMovesChip  = mkChipBox('Time');

    const mkBtn = (txt) => {
      const b = document.createElement('button');
      b.textContent = txt;
      Object.assign(b.style, {
        padding:'4px 8px', borderRadius:'9px',
        border:'1px solid rgba(255,255,255,.14)',
        background:'linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02))',
        color:'#e9ecf1', cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,.25)', fontSize:'12px', lineHeight:'1'
      });
      return b;
    };
    const settingsBtn= mkBtn('⚙');

    const rowR = document.createElement('div');
    Object.assign(rowR.style, { display:'flex', gap:'6px', alignItems:'center' });
    rowR.appendChild(scoreChip.box);
    rowR.appendChild(timeMovesChip.box);
    rowR.appendChild(settingsBtn);

    bar.appendChild(rowL);
    bar.appendChild(rowR);
    wrapper.appendChild(bar);

    const subtitle = document.createElement('div');
    subtitle.style.opacity = '.75';
    subtitle.style.fontSize = '12px';
    subtitle.style.marginTop = '-2px';
    subtitle.style.textAlign = 'center';
    subtitle.style.width = '100%';
    wrapper.appendChild(subtitle);

    // Difficulty badge
    const diffBadge = document.createElement('span');
    diffBadge.style.marginLeft = '6px';
    diffBadge.style.padding = '2px 6px';
    diffBadge.style.border = '1px solid rgba(255,255,255,.16)';
    diffBadge.style.borderRadius = '999px';
    diffBadge.style.fontSize = '10px';
    diffBadge.style.opacity = '.9';
    subtitle.appendChild(diffBadge);

    // Game canvas
    const canvas = document.createElement('canvas');
    const g = fitCanvas(canvas, 8 * TILE, 8 * TILE);
    Object.assign(canvas.style, {
      display:'block', margin:'0 auto', touchAction:'none',
      borderRadius:'14px', border:'1px solid rgba(255,255,255,.06)'
    });
    wrapper.appendChild(canvas);

    // Move counter overlay
    const moveOverlay = document.createElement('div');
    Object.assign(moveOverlay.style, {
      position:'relative', width:'100%', display:'grid', justifyItems:'center'
    });
    const moveText = document.createElement('div');
    Object.assign(moveText.style, {
      marginTop:'4px', fontSize:'11px', opacity:'.8'
    });
    moveOverlay.appendChild(moveText);
    wrapper.appendChild(moveOverlay);

    // ---------------- Right Settings Drawer (compact + fullscreen-safe) ----------------
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,0.14)',
      opacity:'0', pointerEvents:'none', transition:'opacity .14s ease-out', zIndex:'99998'
    });
    const drawer = document.createElement('div');
    Object.assign(drawer.style, {
      position:'fixed', top:'0', right:'0', height:'100dvh', width:'260px',
      background:'rgba(18,20,26,.98)', borderLeft:'1px solid rgba(255,255,255,.08)',
      boxShadow:'0 10px 30px rgba(0,0,0,.45)',
      transform:'translateX(100%)', transition:'transform .18s ease-out',
      zIndex:'99999', display:'grid', gridTemplateRows:'auto 1fr', fontSize:'12px'
    });
    const drHead = document.createElement('div');
    drHead.textContent = 'Settings';
    Object.assign(drHead.style, { padding:'8px 10px', fontWeight:'600', borderBottom:'1px solid rgba(255,255,255,.08)' });
    const drBody = document.createElement('div');
    Object.assign(drBody.style, { padding:'8px 10px', display:'grid', gap:'4px', overflow:'auto' });

    const mkToggle = (label, key) => {
      const line = document.createElement('label');
      Object.assign(line.style, { display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:'8px', padding:'4px 0' });
      const span = document.createElement('span'); span.textContent = label; span.style.opacity = '.88';
      const input = document.createElement('input'); input.type='checkbox'; input.checked = !!cfg[key];
      input.addEventListener('change', ()=>{
        cfg[key] = !!input.checked;
        save('cfg', cfg);
        if (key === 'showMoveCounter') updateMoveCounter();
      });
      line.appendChild(span); line.appendChild(input);
      return line;
    };

    const reducedRow  = mkToggle('Reduced motion', 'reducedMotion');
    const colorRow    = mkToggle('Color assist',   'colorAssist');
    const contrastRow = mkToggle('High contrast tiles', 'highContrast');
    const shapeRow    = mkToggle('Shape assist (Extreme+)', 'shapeAssist');
    const hintRow     = mkToggle('Hints on hard modes', 'hintsOnHard');
    const counterRow  = mkToggle('Show move counter', 'showMoveCounter');

    drBody.appendChild(reducedRow);
    drBody.appendChild(colorRow);
    drBody.appendChild(contrastRow);
    drBody.appendChild(shapeRow);
    drBody.appendChild(hintRow);
    drBody.appendChild(counterRow);

    drawer.appendChild(drHead); drawer.appendChild(drBody);

    // Attach overlays (fullscreen-safe)
    function overlayHost(){ return document.fullscreenElement || document.body; }
    function mountOverlays(){
      const host = overlayHost();
      if (drawer.parentNode !== host) host.appendChild(drawer);
      if (backdrop.parentNode !== host) host.appendChild(backdrop);
    }
    mountOverlays();
    document.addEventListener('fullscreenchange', mountOverlays);

    let drawerOpen = false;
    const openDrawer = (show) => {
      mountOverlays();
      drawerOpen = show ?? !drawerOpen;
      drawer.style.transform = drawerOpen ? 'translateX(0)' : 'translateX(100%)';
      backdrop.style.opacity = drawerOpen ? '1' : '0';
      backdrop.style.pointerEvents = drawerOpen ? 'auto' : 'none';
    };
    settingsBtn.addEventListener('click', ()=> openDrawer(true));
    backdrop.addEventListener('click', () => openDrawer(false));
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape' && drawerOpen) openDrawer(false); });

    // ---------------- HUD (polyfill) ----------------
    const hud = makeHUD(api, { score: true, lives: false, meta: true });
    if (typeof hud.setMeta !== 'function') hud.setMeta = () => {};

    // ---------------- RNG / State ----------------
    let rnd = () => Math.random();
    function LCRNG(seed0) { let s = (seed0 >>> 0) || 1; return () => ((s = (1664525 * s + 1013904223) >>> 0), (s & 0xffffffff) / 0x100000000); }
    function shuffleInPlace(a){
      for (let i=a.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; const t=a[i]; a[i]=a[j]; a[j]=t; }
      return a;
    }

    let score = 0;
    let board = [];
    let sel = null;
    let hover = null;
    let dragging = null;

    // State guards
    let animating = false, resolving = false;
    let enforcing = false;        // NEW: explicit enforcement state
    let inputLocked = false;      // deadboard freeze
    let lastTick = performance.now();
    const tasks = [];
    let gameGen = 0;

    let timeLeftMs = DEFAULT_TIMED_MS;
    let timeWarning = false;
    let shakingActive = false;

    let selectPhase = 0;
    const ghosts = [];
    let idleMs = 0;
    let hintMove = null;
    let lastMoveCount = 0;
    let lastSeed = (Math.random()*0xffffffff)>>>0;

    // Strike/resolve counters
    let invalidStreak = 0;
    let resolveCycles = 0;

    // ---------------- Color palette (CVD-safe) ----------------
    const palette = [
      '#3B5DC9', // Indigo
      '#F68E26', // Orange
      '#1FB7A6', // Teal
      '#D43DA0', // Magenta
      '#8BC34A', // Lime
      '#E53935', // Red
      '#1E88E5', // Blue
      '#FFB300', // Amber
      '#7E57C2', // Purple
      '#26C6DA', // Cyan
    ];
    const glyphs = ['●','▲','■','◆','★','●','▲','■','◆','★'];
    function colorFill(idx){
      const L = palette.length || 1;
      let i = Number.isFinite(idx) ? Math.floor(idx) : 0;
      i = ((i % L) + L) % L;
      return palette[i] || palette[0];
    }

    // ---------------- Helpers ----------------
    let nextId = 1;
    const now = () => performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2);

    function schedule(ms, fn){
      const myGen = gameGen;
      tasks.push({ t: now()+ms, fn, gen: myGen });
    }

    function randColor(){ return (rnd()*params.colors)|0; }
    function makeCell(color) {
      let c = Number.isFinite(color) ? Math.floor(color) : 0;
      if (c < 0) c = 0;
      return { id: nextId++, color: c, x:0, y:0, sx:0, sy:0, tx:0, ty:0, t0:0, t1:0, clearing:false };
    }
    function inBounds(r,c){ return r>=0 && r<params.n && c>=0 && c<params.n; }

    // ---------------- Init: Balanced, no 3s, deterministic (FIXED) ----------------
    function initFillBalanced(){
      const n = params.n, k = params.colors;

      // Build a global bag with nearly equal counts
      const total = n*n;
      const base = Math.floor(total / k);
      let rem = total - base*k;
      const counts = Array.from({length:k}, (_,i)=> base + (i<rem?1:0));

      let bag = [];
      for (let c=0;c<k;c++) for (let t=0;t<counts[c];t++) bag.push(c);
      shuffleInPlace(bag);

      board = Array.from({ length: n }, () => Array(n).fill(null));

      const placed = []; // {r,c} previously filled cells (row-major)
      for (let r=0;r<n;r++){
        for (let c=0;c<n;c++){
          let chosen = null;
          const rejected = [];

          // Prefer colors that don't create immediate triples (left/up)
          for (let guard=0; guard<Math.max(1, bag.length); guard++){
            if (bag.length===0) break;
            const idx = (rnd()*bag.length)|0;
            const cand = bag[idx];
            if (!makesImmediateAtInit(r,c,cand)) {
              chosen = cand;
              bag.splice(idx,1);
              break;
            } else {
              rejected.push(cand);
              bag.splice(idx,1);
            }
          }

          if (chosen==null){
            // Try safe permutation with earlier cell
            let swapped = false;
            for (let pi = placed.length-1; pi>=0 && !swapped; pi--){
              const {r:pr, c:pc} = placed[pi];
              const prevColor = board[pr][pc]?.color;
              if (prevColor==null) continue;
              if (makesImmediateAtInit(r,c,prevColor)) continue;

              // pick a reject color safe at (pr,pc)
              let ridx = -1;
              for (let j=0;j<rejected.length;j++){
                if (!makesImmediateAtInitForPlaced(pr,pc,rejected[j])) { ridx = j; break; }
              }
              if (ridx !== -1){
                chosen = prevColor;
                board[pr][pc].color = rejected[ridx];
                rejected.splice(ridx,1);
                swapped = true;
              }
            }

            if (!swapped){
              if (rejected.length) { bag.push(...rejected); shuffleInPlace(bag); rejected.length=0; }
              chosen = bag.length ? bag.pop() : randColor();
            }
          }

          board[r][c] = makeCell(chosen);
          placed.push({r,c});

          if (rejected.length){ bag.push(...rejected); shuffleInPlace(bag); }
        }
      }
    }

    function makesImmediateAtInit(r, c, color){
      const L1 = board[r]?.[c-1], L2 = board[r]?.[c-2];
      if (L1 && L2 && L1.color===color && L2.color===color) return true;
      const U1 = board[r-1]?.[c], U2 = board[r-2]?.[c];
      if (U1 && U2 && U1.color===color && U2.color===color) return true;
      return false;
    }
    // For already-placed earlier cell (pr,pc), check only left/up triples
    function makesImmediateAtInitForPlaced(pr,pc,color){
      const L1 = board[pr]?.[pc-1], L2 = board[pr]?.[pc-2];
      if (L1 && L2 && L1.color===color && L2.color===color) return true;
      const U1 = board[pr-1]?.[pc], U2 = board[pr-2]?.[pc];
      if (U1 && U2 && U1.color===color && U2.color===color) return true;
      return false;
    }

    // ---------------- Match scan ----------------
    function findMatchesClassic() {
      const n = params.n;
      const kill = Array.from({length:n}, ()=>Array(n).fill(false));

      // horizontal
      for (let r=0; r<n; r++){
        let run = 1;
        for (let c=1; c<=n; c++){
          const same = c<n && board[r][c] && board[r][c-1] && board[r][c].color===board[r][c-1].color;
          if (same) run++;
          else { if (run>=3) for (let k=1; k<=run; k++) kill[r][c-k] = true; run=1; }
        }
      }
      // vertical
      for (let c=0; c<n; c++){
        let run = 1;
        for (let r=1; r<=n; r++){
          const same = r<n && board[r][c] && board[r-1][c] && board[r][c].color===board[r-1][c].color;
          if (same) run++;
          else { if (run>=3) for (let k=1; k<=run; k++) kill[r-k][c] = true; run=1; }
        }
      }

      const any = kill.some(row => row.some(Boolean));
      return { kill, any };
    }

    // Local match check for swap accept
    function isMatchAtLocal(r,c){
      const n = params.n;
      const cell = board[r]?.[c]; if (!cell) return false;

      let h = 1;
      for (let k=c-1; k>=0 && board[r][k] && board[r][k].color===cell.color; k--) h++;
      for (let k=c+1; k<n && board[r][k] && board[r][k].color===cell.color; k++) h++;
      if (h>=3) return true;

      let v = 1;
      for (let k=r-1; k>=0 && board[k][c] && board[k][c].color===cell.color; k--) v++;
      for (let k=r+1; k<n && board[k][c] && board[k][c].color===cell.color; k++) v++;
      return v>=3;
    }

    // Count/list moves
    function countValidMoves(){
      const n = params.n; let count = 0;
      for (let r=0;r<n;r++){
        for (let c=0;c<n;c++){
          if (c+1<n){
            swapCells(r,c,r,c+1);
            if (isMatchAtLocal(r,c) || isMatchAtLocal(r,c+1)) count++;
            swapCells(r,c,r,c+1);
          }
          if (r+1<n){
            swapCells(r,c,r+1,c);
            if (isMatchAtLocal(r,c) || isMatchAtLocal(r+1,c)) count++;
            swapCells(r,c,r+1,c);
          }
        }
      }
      return count;
    }
    function listMoves(){
      const n = params.n; const moves = [];
      for (let r=0;r<n;r++){
        for (let c=0;c<n;c++){
          if (c+1<n){
            swapCells(r,c,r,c+1);
            const ok = isMatchAtLocal(r,c) || isMatchAtLocal(r,c+1);
            swapCells(r,c,r,c+1);
            if (ok) moves.push({a:{r,c}, b:{r, c:c+1}});
          }
          if (r+1<n){
            swapCells(r,c,r+1,c);
            const ok = isMatchAtLocal(r,c) || isMatchAtLocal(r+1,c);
            swapCells(r,c,r+1,c);
            if (ok) moves.push({a:{r,c}, b:{r:r+1, c}});
          }
        }
      }
      return moves;
    }
    function swapCells(r1,c1,r2,c2){
      if (!inBounds(r1,c1) || !inBounds(r2,c2)) return false;
      const a = board[r1][c1], b = board[r2][c2];
      if (!a || !b) return false;
      board[r1][c1] = b; board[r2][c2] = a;
      return true;
    }

    // ---------------- Spawn bags (balanced randomness) ----------------
    let colBags = [];
    let rowBags = [];
    function newBag(){ const a = Array.from({length:params.colors},(_,i)=>i); return shuffleInPlace(a); }
    function resetSpawnBags(){
      colBags = Array.from({length:params.n}, ()=> newBag().slice());
      rowBags = Array.from({length:params.n}, ()=> newBag().slice());
    }
    function drawSpawnColorFor(cOrR, isColumn){
      const bags = isColumn ? colBags : rowBags;
      const idx = cOrR;
      if (!bags[idx] || bags[idx].length===0) bags[idx] = newBag().slice();
      return bags[idx].pop();
    }

    // ---------------- Collapse (4 gravities) + spawn via bags ----------------
    function collapseClassic(kill){
      const n = params.n;
      let cleared = 0;

      if (params.gravity === 'down') {
        for (let c=0; c<n; c++){
          let write = n - 1;
          for (let r=n-1; r>=0; r--){
            if (!kill[r][c]) { board[write--][c] = board[r][c]; }
            else { cleared++; }
          }
          for (let r=write; r>=0; r--){
            const color = drawSpawnColorFor(c, /*isColumn*/true);
            const cell = makeCell(color);
            cell.y = -1; cell.t0 = now(); cell.t1 = cell.t0 + (cfg.reducedMotion?0:FALL_MS);
            board[r][c] = cell;
          }
        }
      } else if (params.gravity === 'up') {
        for (let c=0; c<n; c++){
          let write = 0;
          for (let r=0; r<n; r++){
            if (!kill[r][c]) { board[write++][c] = board[r][c]; }
            else { cleared++; }
          }
          for (let r=write; r<n; r++){
            const color = drawSpawnColorFor(c, /*isColumn*/true);
            const cell = makeCell(color);
            cell.y = +1; cell.t0 = now(); cell.t1 = cell.t0 + (cfg.reducedMotion?0:FALL_MS);
            board[r][c] = cell;
          }
        }
      } else if (params.gravity === 'left') {
        for (let r=0; r<n; r++){
          let write = 0;
          for (let c=0; c<n; c++){
            if (!kill[r][c]) { board[r][write++] = board[r][c]; }
            else { cleared++; }
          }
          for (let c=write; c<n; c++){
            const color = drawSpawnColorFor(r, /*isColumn*/false);
            const cell = makeCell(color);
            cell.x = +1; cell.t0 = now(); cell.t1 = cell.t0 + (cfg.reducedMotion?0:FALL_MS);
            board[r][c] = cell;
          }
        }
      } else { // 'right'
        for (let r=0; r<n; r++){
          let write = n - 1;
          for (let c=n-1; c>=0; c--){
            if (!kill[r][c]) { board[r][write--] = board[r][c]; }
            else { cleared++; }
          }
          for (let c=write; c>=0; c--){
            const color = drawSpawnColorFor(r, /*isColumn*/false);
            const cell = makeCell(color);
            cell.x = -1; cell.t0 = now(); cell.t1 = cell.t0 + (cfg.reducedMotion?0:FALL_MS);
            board[r][c] = cell;
          }
        }
      }

      if (cleared > 0) {
        score += PER_TILE * cleared;
        setScore(score);
      }

      return cleared;
    }

    // ---------------- Safe rotation helpers (fix for '-1' crash) ----------------
    function rotateRowSegmentSafe(r, start, len, dir){
      const n = params.n;
      if (!(r>=0 && r<n)) return false;
      if (!(len>=2 && len<=n)) return false;
      if (!(start>=0 && start+len<=n)) return false;
      const row = board[r]; if (!row) return false;

      const seg = new Array(len);
      for (let i=0;i<len;i++){
        const cell = row[start+i];
        if (!cell) return false;
        seg[i] = cell;
      }
      if (dir>0){
        const last = seg[len-1];
        for (let i=len-1;i>0;i--) seg[i]=seg[i-1];
        seg[0]=last;
      } else {
        const first = seg[0];
        for (let i=0;i<len-1;i++) seg[i]=seg[i+1];
        seg[len-1]=first;
      }
      for (let i=0;i<len;i++) row[start+i]=seg[i];
      return true;
    }
    function rotateColSegmentSafe(c, start, len, dir){
      const n = params.n;
      if (!(c>=0 && c<n)) return false;
      if (!(len>=2 && len<=n)) return false;
      if (!(start>=0 && start+len<=n)) return false;

      const seg = new Array(len);
      for (let i=0;i<len;i++){
        const row = board[start+i];
        if (!row) return false;
        const cell = row[c];
        if (!cell) return false;
        seg[i] = cell;
      }
      if (dir>0){
        const last = seg[len-1];
        for (let i=len-1;i>0;i--) seg[i]=seg[i-1];
        seg[0]=last;
      } else {
        const first = seg[0];
        for (let i=0;i<len-1;i++) seg[i]=seg[i+1];
        seg[len-1]=first;
      }
      for (let i=0;i<len;i++) board[start+i][c]=seg[i];
      return true;
    }

    // ---------------- Permutation-only Move Enforcer (post-stabilize) ----------------
    function enforcePermute(min, max){
      const capEdits = 90;
      const capRebuilds = 2;
      let rebuilds = 0;

      function safeNoMatches(){ return !findMatchesClassic().any; }

      function rankHotTiles(){
        const moves = listMoves();
        const freq = new Map();
        for (const mv of moves){
          const k1 = `${mv.a.r},${mv.a.c}`, k2 = `${mv.b.r},${mv.b.c}`;
          freq.set(k1, (freq.get(k1)||0)+1);
          freq.set(k2, (freq.get(k2)||0)+1);
        }
        const n = params.n, centerR=(n-1)/2, centerC=(n-1)/2;
        const cells = [];
        for (let r=0;r<n;r++) for (let c=0;c<n;c++){
          const k = `${r},${c}`;
          const f = freq.get(k)||0;
          const cent = 1 / (1 + Math.hypot(r-centerR, c-centerC));
          cells.push({r,c, w: f*2 + cent});
        }
        cells.sort((a,b)=> b.w - a.w);
        return cells;
      }

      function tryFarSwap(curMoves, wantDown){
        const n = params.n;
        const hot = rankHotTiles();
        const all = [];
        for (let r=0;r<n;r++) for (let c=0;c<n;c++) all.push({r,c});
        for (let attempts=0; attempts<120; attempts++){
          const A = hot[(rnd()*Math.min(30, hot.length))|0]; if (!A) continue;
          const B = all[(rnd()*all.length)|0]; if (!B) continue;
          if (A.r===B.r && A.c===B.c) continue;
          if (Math.abs(A.r-B.r)+Math.abs(A.c-B.c)<=1) continue;
          const c1 = board[A.r][A.c]?.color, c2 = board[B.r][B.c]?.color;
          if (c1==null || c2==null || c1===c2) continue;

          swapCells(A.r,A.c,B.r,B.c);
          const safe = safeNoMatches();
          const m = safe ? countValidMoves() : curMoves+9999;
          if (!safe || (wantDown ? (m>curMoves) : (m<curMoves))){
            swapCells(A.r,A.c,B.r,B.c);
            continue;
          }
          return true;
        }
        return false;
      }

      function tryMicroRotate(curMoves, wantDown){
        const n = params.n;
        if (n < 3) return false;

        const isRow = rnd()<0.5;
        if (isRow){
          // len in [3..min(5,n)], clamped; start in [0..n-len]
          const len = Math.max(3, Math.min(5, n));
          const startMax = n - len;
          const start = startMax > 0 ? ((rnd()*(startMax+1))|0) : 0;
          const dir = rnd()<0.5 ? 1 : -1;

          if (!rotateRowSegmentSafe((rnd()*n)|0, start, len, dir)) return false;

          const safe = safeNoMatches();
          const m = safe ? countValidMoves() : curMoves+9999;
          if (!safe || (wantDown ? (m>curMoves) : (m<curMoves))){
            // revert by rotating the same row back opposite
            rotateRowSegmentSafe((rnd()*n)|0, start, len, -dir); // best-effort revert (row choice randomized)
            return false;
          }
          return true;
        } else {
          const len = Math.max(3, Math.min(5, n));
          const startMax = n - len;
          const start = startMax > 0 ? ((rnd()*(startMax+1))|0) : 0;
          const dir = rnd()<0.5 ? 1 : -1;

          if (!rotateColSegmentSafe((rnd()*n)|0, start, len, dir)) return false;

          const safe = safeNoMatches();
          const m = safe ? countValidMoves() : curMoves+9999;
          if (!safe || (wantDown ? (m>curMoves) : (m<curMoves))){
            rotateColSegmentSafe((rnd()*n)|0, start, len, -dir);
            return false;
          }
          return true;
        }
      }

      function softRebuild(){
        initFillBalanced();
        resetSpawnBags();
      }

      function ensureAtLeastOneMove(){
        softShuffle(true);
      }

      // --- main loop ---
      enforcing = true;
      for (;;){
        let m = countValidMoves();
        if (m===0) { ensureAtLeastOneMove(); m = countValidMoves(); if (m===0 && rebuilds<capRebuilds){ softRebuild(); rebuilds++; continue; } }

        if (m>=min && m<=max) break;

        const wantDown = (m>max);
        let improved = false;

        for (let edits=0; edits<capEdits && !(m>=min && m<=max); edits++){
          if (tryFarSwap(m, wantDown)) {
            const m2 = countValidMoves();
            improved = improved || (wantDown ? (m2<m) : (m2>m));
            m = m2;
            if (m===0) { ensureAtLeastOneMove(); m = countValidMoves(); }
            if (m>=min && m<=max) break;
            continue;
          }
          if (tryMicroRotate(m, wantDown)){
            const m2 = countValidMoves();
            improved = improved || (wantDown ? (m2<m) : (m2>m));
            m = m2;
            if (m===0) { ensureAtLeastOneMove(); m = countValidMoves(); }
            if (m>=min && m<=max) break;
            continue;
          }
          break;
        }

        if (!improved){
          if (rebuilds++ >= capRebuilds){
            if (m===0) ensureAtLeastOneMove();
            break;
          }
          softRebuild();
        }
      }
      enforcing = false;
    }

    // ---------------- Resolver ----------------
    function resolveClassic(){
      const { kill, any } = findMatchesClassic();
      if (any) {
        // mark for visual pop
        for (let r=0; r<params.n; r++)
          for (let c=0; c<params.n; c++)
            if (kill[r][c] && board[r][c]) board[r][c].clearing = true;

        schedule(cfg.reducedMotion?1:CLEAR_MS, ()=>{
          // remove marked and collapse+refill
          for (let r=0; r<params.n; r++)
            for (let c=0; c<params.n; c++)
              if (kill[r][c]) board[r][c] = null;

          collapseClassic(kill);

          // continue resolving until no more matches
          schedule(cfg.reducedMotion?1:FALL_MS, resolveClassic);
        });
      } else {
        // settle complete
        resolveCycles++;
        animating = false;
        resolving = false;

        // Nightmare: rotate gravity every 5 cycles
        if (params.gravityRot && resolveCycles % 5 === 0) {
          params.gravity = nextGravity(params.gravity);
          toast(`Gravity: ${params.gravity.toUpperCase()}`);
        }

        // Enforce move budget (Hard+)
        const hardish = (cfg.difficulty==='hard' || cfg.difficulty==='extreme' || cfg.difficulty==='nightmare');
        if (hardish){
          enforcePermute(params.tgtMin, params.tgtMax);
        }

        lastMoveCount = countValidMoves();
        updateMoveCounter();

        // Deadboard contingency
        if (lastMoveCount === 0) {
          if (params.deadFreeze) {
            inputLocked = true;
            toast('No moves — Shuffling');
            schedule(1000, ()=>{ inputLocked = false; softShuffle(true); lastMoveCount = countValidMoves(); updateMoveCounter(); });
          } else {
            softShuffle(false);
          }
        }
      }
    }

    function nextGravity(g){
      if (g === 'down') return 'left';
      if (g === 'left') return 'up';
      if (g === 'up') return 'right';
      return 'down';
    }

    // ---------------- Swap / Input ----------------
    function trySwap(r1,c1,r2,c2){
      if (!inBounds(r1,c1)||!inBounds(r2,c2)) return false;
      if (animating||resolving||enforcing||inputLocked) return false;
      const a=board[r1][c1], b=board[r2][c2]; if (!a||!b) return false;
      const dist = Math.abs(r1-r2)+Math.abs(c1-c2); if (dist!==1) return false;

      animateSwap(r1,c1,r2,c2);
      board[r1][c1]=b; board[r2][c2]=a;

      // Accept swap only if it creates a match
      const will = isMatchAtLocal(r1,c1) || isMatchAtLocal(r2,c2);
      if (!will){
        invalidStreak++;
        addGhostTrail(r1,c1,r2-r1,c2-c1);
        schedule(cfg.reducedMotion?0:INVALID_MS, ()=>{
          const A=board[r2][c2], B=board[r1][c1];
          board[r2][c2]=B; board[r1][c1]=A;
          animateSwap(r2,c2,r1,c1, /*overshoot*/true);
        });

        // Strike penalty on Hard+
        if (params.strikeEnabled && invalidStreak >= 3) {
          invalidStreak = 0;
          if (params.gameMode === 'moves' && params.movesLeft != null) {
            params.movesLeft = Math.max(0, params.movesLeft - 1);
            updateTimeMovesChip();
            if (params.movesLeft === 0) { showRecap(); }
          } else if (params.gameMode === 'timed' && timeLeftMs != null) {
            timeLeftMs = Math.max(0, timeLeftMs - 5000);
            updateTimeMovesChip();
            if (timeLeftMs === 0) { showRecap(); }
          }
        }
        return false;
      }

      invalidStreak = 0;
      animating = true; resolving = true;

      // Moves mode: consume 1 move on accepted swap
      if (params.gameMode === 'moves' && params.movesLeft != null) {
        params.movesLeft = Math.max(0, params.movesLeft - 1);
        updateTimeMovesChip();
        if (params.movesLeft === 0) { resolveClassic(); return true; }
      }

      resolveClassic();
      return true;
    }
    function animateSwap(r1,c1,r2,c2, overshoot=false){
      const a=board[r1]?.[c1], b=board[r2]?.[c2]; if (!a||!b) return;
      const t=now(), t1=t+(cfg.reducedMotion?0:SWAP_MS);
      const extra = overshoot && !cfg.reducedMotion ? 0.07 : 0;
      a.t0=b.t0=t; a.t1=b.t1=t1; a.sx=a.sy=b.sx=b.sy=0;
      a.tx=(c2-c1)*(1+extra); a.ty=(r2-r1)*(1+extra);
      b.tx=(c1-c2)*(1+extra); b.ty=(r1-r2)*(1+extra);
    }
    function addGhostTrail(r, c, dr, dc) {
      const steps = 4;
      for (let i=1;i<=steps;i++){
        ghosts.push({
          x: (c + (dr*i)/steps) * TILE + PAD + (TILE-2*PAD)/2,
          y: (r + (dc*i)/steps) * TILE + PAD + (TILE-2*PAD)/2,
          alpha: 0.10 + 0.10*(1 - i/steps),
          life: cfg.reducedMotion ? 70 : 140
        });
      }
      if (ghosts.length > 90) ghosts.splice(0, ghosts.length - 90);
    }

    function hasAnyValidMove(){ return countValidMoves() > 0; }

    function softShuffle(silent){
      const n = params.n;
      for (let i=0; i<220; i++){
        const r1 = (rnd()*n)|0, c1 = (rnd()*n)|0;
        const r2 = (rnd()*n)|0, c2 = (rnd()*n)|0;
        if (Math.abs(r1-r2)+Math.abs(c1-c2)<=1) continue; // non-adjacent only
        const a = board[r1]?.[c1], b = board[r2]?.[c2];
        if (!a || !b) continue;
        swapCells(r1,c1,r2,c2);
        if (findMatchesClassic().any) swapCells(r1,c1,r2,c2);
      }
      if (!hasAnyValidMove()){ initFillBalanced(); }
      if (!silent) toast('No moves — Shuffling');
      lastMoveCount = countValidMoves();
      updateMoveCounter();
    }

    // ---------------- Input wiring ----------------
    function canvasToCell(clientX, clientY){
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left, py = clientY - rect.top;
      const x = px * (canvas.width/rect.width), y = py * (canvas.height/rect.height);
      return { r: Math.floor(y/TILE), c: Math.floor(x/TILE) };
    }
    function onDown(e){
      if (inputLocked||enforcing) return;
      const pt = 'touches' in e ? e.touches[0] : e;
      const {r,c}=canvasToCell(pt.clientX, pt.clientY); if (!inBounds(r,c)) return;
      sel = {r,c, t: now()}; dragging = { startR:r, startC:c, lastR:r, lastC:c, active:true };
      idleMs = 0; hintMove = null;
    }
    function onMove(e){
      if (inputLocked||enforcing) return;
      const pt = 'touches' in e ? e.touches[0] : e;
      const {r,c}=canvasToCell(pt.clientX, pt.clientY);
      if (inBounds(r,c)) hover = {r,c}; else hover = null;

      if (!dragging?.active) return;
      if (!inBounds(r,c)) return;
      if (r===dragging.lastR && c===dragging.lastC) return;
      dragging.lastR=r; dragging.lastC=c; idleMs = 0; hintMove = null;
      if (Math.abs(r-dragging.startR)+Math.abs(c-dragging.startC)===1){
        trySwap(dragging.startR, dragging.startC, r, c);
        sel=null; dragging.active=false;
      }
    }
    function onUp(){
      if (dragging?.active && sel){ sel=null; }
      dragging=null;
    }
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, {passive:true});
    window.addEventListener('touchmove', onMove, {passive:true});
    window.addEventListener('touchend', onUp);

    // ---------------- Drawing ----------------
    function roundRect(ctx,x,y,w,h,r){
      ctx.beginPath(); ctx.moveTo(x+r,y);
      ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
      ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
    }

    function drawTile(r,c,cell){
      if (!cell) return;
      const px = c*TILE, py = r*TILE;
      let ox=0, oy=0;

      if (cell.t1 && now()<cell.t1){
        const k = cfg.reducedMotion?1:easeOut((now()-cell.t0)/(cell.t1-cell.t0));
        ox += (cell.tx - cell.sx)*TILE*k; oy += (cell.ty - cell.sy)*TILE*k;
      }
      ox += cell.x*TILE; oy += cell.y*TILE;
      cell.x *= 0.6; if (Math.abs(cell.x)<0.001) cell.x=0;
      cell.y *= 0.6; if (Math.abs(cell.y)<0.001) cell.y=0;

      let scale=1;
      if (cell.clearing){
        const t = Math.min(1, (now() - (cell._clearStart ??= now())) / (cfg.reducedMotion?1:CLEAR_MS));
        scale = 1 + 0.10*(1-t);
        if (t>=1) cell.clearing=false;
      }

      let hoverScale = 1;
      if (hover && hover.r===r && hover.c===c) hoverScale = 1.04;

      const x = px + PAD + ox + (TILE-2*PAD)*(1-scale*hoverScale)*.5;
      const y = py + PAD + oy + (TILE-2*PAD)*(1-scale*hoverScale)*.5;
      const w = (TILE-2*PAD)*scale*hoverScale;
      const h = (TILE-2*PAD)*scale*hoverScale;

      g.fillStyle = colorFill(cell.color);
      roundRect(g, x, y, w, h, 10); g.fill();

      if (cfg.highContrast){
        g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.8)';
        roundRect(g, x, y, w, h, 10); g.stroke();
      }
      if (cfg.colorAssist){
        g.fillStyle = 'rgba(255,255,255,.8)';
        g.fillRect(x+6, y+6, 6, 6);
      }
      if (cfg.shapeAssist && (cfg.difficulty==='extreme' || cfg.difficulty==='nightmare')){
        g.fillStyle = 'rgba(255,255,255,.95)';
        g.font = `${Math.floor(Math.min(w,h)*0.5)}px system-ui, sans-serif`;
        g.textAlign='center'; g.textBaseline='middle';
        g.fillText(glyphs[cell.color % glyphs.length], x + w/2, y + h/2 + 1);
      }
    }

    function drawSelection(){
      if (!sel) return;
      const baseX = sel.c*TILE, baseY = sel.r*TILE;
      selectPhase = (selectPhase + 0.02) % 1;
      const cx = baseX + TILE/2, cy = baseY + TILE/2;
      const r = (TILE/2) - 6;
      const start = selectPhase * Math.PI * 2, end = start + Math.PI * 1.2;

      g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.arc(cx, cy, r, start, end); g.stroke();

      const pulse = 0.5 + 0.5*easeInOut((now()%1000)/1000);
      const pr = r * (0.75 + 0.05*pulse);
      g.lineWidth = 1.25; g.strokeStyle = `rgba(255,255,255,${0.32 + 0.22*pulse})`;
      g.beginPath(); g.arc(cx, cy, pr, 0, Math.PI*2); g.stroke();
    }

    function drawGhosts(dt) {
      for (let i=ghosts.length-1;i>=0;i--){
        const gho = ghosts[i];
        g.fillStyle = `rgba(255,255,255,${gho.alpha})`;
        g.beginPath(); g.arc(gho.x, gho.y, 5, 0, Math.PI*2); g.fill();
        gho.alpha *= 0.92; gho.life -= dt;
        if (gho.life <= 0 || gho.alpha < 0.02) ghosts.splice(i,1);
      }
    }

    function findFirstHint(){
      const n = params.n;
      for (let r=0;r<n;r++) for (let c=0;c<n;c++){
        if (c+1<n){ swapCells(r,c,r,c+1); const ok=isMatchAtLocal(r,c)||isMatchAtLocal(r,c+1); swapCells(r,c,r,c+1); if (ok) return {a:{r,c}, b:{r, c:c+1}}; }
        if (r+1<n){ swapCells(r,c,r+1,c); const ok=isMatchAtLocal(r,c)||isMatchAtLocal(r+1,c); swapCells(r,c,r+1,c); if (ok) return {a:{r,c}, b:{r:r+1, c}}; }
      }
      return null;
    }

    function drawHint() {
      const allow = params.allowIdleHints && (cfg.hintsOnHard || (cfg.difficulty!=='hard' && cfg.difficulty!=='extreme' && cfg.difficulty!=='nightmare'));
      if (!allow) return;
      if (!hintMove) return;
      const {a,b} = hintMove;
      const t = (now()%1000)/1000;
      const k = 0.35 + 0.35*Math.sin(t*2*Math.PI);
      g.lineWidth = 2; g.strokeStyle = `rgba(255,255,255,${0.35*k})`;
      g.strokeRect(a.c*TILE+4, a.r*TILE+4, TILE-8, TILE-8);
      g.strokeRect(b.c*TILE+4, b.r*TILE+4, TILE-8, TILE-8);
    }

    function drawTimerOrMoves(dt) {
      if (params.gameMode === 'timed') {
        if (timeLeftMs > 0) {
          timeLeftMs -= dt;
          if (timeLeftMs <= 0) {
            timeLeftMs = 0;
            canvas.style.transform=''; shakingActive=false; timeWarning=false;
            showRecap();
          }
        }
        timeMovesChip.lab.textContent = 'Time';
        timeMovesChip.val.textContent = Math.max(0, Math.ceil(timeLeftMs/1000)).toString();

        const prev = timeWarning;
        timeWarning = timeLeftMs <= 5000;
        if (timeWarning) {
          const blinkAlpha = 0.22 + 0.22 * Math.sin(now() / 80);
          g.fillStyle = `rgba(255,0,0,${blinkAlpha})`;
          g.fillRect(0,0,canvas.width,canvas.height);
          const s = 4 + 2.5 * Math.sin(now()/30);
          const ox = (rnd()*2-1)*s;
          const oy = (rnd()*2-1)*s;
          canvas.style.transform = `translate(${ox}px, ${oy}px)`;
          shakingActive = true;
        } else if (prev && !timeWarning) {
          canvas.style.transform = ''; shakingActive=false;
        }
      } else if (params.gameMode === 'moves') {
        timeMovesChip.lab.textContent = 'Moves';
        timeMovesChip.val.textContent = String(params.movesLeft ?? '—');
      } else {
        timeMovesChip.lab.textContent = 'Time';
        timeMovesChip.val.textContent = '—';
      }
    }

    // ---------------- Render loop ----------------
    function draw() {
      const t = now(), dt = Math.min(32, t - lastTick); lastTick = t;

      drawTimerOrMoves(dt);

      g.fillStyle = '#0b0c0f'; g.fillRect(0,0,canvas.width,canvas.height);

      for (let r=0;r<params.n;r++) for (let c=0;c<params.n;c++) drawTile(r,c,board[r][c]);

      drawSelection();
      drawGhosts(dt);

      // tasks
      for (let i=tasks.length-1; i>=0; i--){
        const task = tasks[i];
        if (t >= task.t){
          tasks.splice(i,1);
          if (task.gen === gameGen) task.fn();
        }
      }

      // idle hint
      idleMs += dt;
      const hintDelay = params.allowIdleHints ? IDLE_HINT_MS : Infinity;
      if (idleMs > hintDelay && !hintMove) hintMove = findFirstHint();
      drawHint();

      requestAnimationFrame(draw);
    }

    // ---------------- UI helpers ----------------
    const setScore = (v)=>{ hud.setScore?.(v); scoreChip.val.textContent = String(v); };

    let toastTimer=0;
    function toast(msg){ api.setNote(msg); toastTimer=1000; schedule(1050, ()=>{ if (toastTimer<=0) api.setNote(''); }); }

    function updateSubtitle(){
      const preset = DIFFS[cfg.difficulty] || DIFFS.medium;
      const modeLabel = preset.mode==='timed' ? `Timed: ${Math.round((preset.time ?? DEFAULT_TIMED_MS)/1000)}s`
                       : preset.mode==='moves' ? `Move limit: ${preset.moves} moves`
                       : 'Endless: thinky cascades, no timer.';
      const tgt = preset.target ? ` • Target moves: ${preset.target.min}–${preset.target.max}` : '';
      subtitle.textContent = modeLabel + tgt;
      const name = cfg.difficulty[0].toUpperCase()+cfg.difficulty.slice(1);
      diffBadge.textContent = name;
    }

    function updateMoveCounter(){
      moveOverlay.style.display = cfg.showMoveCounter ? 'grid' : 'none';
      if (!cfg.showMoveCounter) return;
      moveText.textContent = `Legal moves: ${lastMoveCount}`;
    }

    // ------ Recap ------
    const recap = document.createElement('div');
    Object.assign(recap.style, { position:'fixed', inset:'0', display:'none', placeItems:'center', zIndex:'100000' });
    const recapCard = document.createElement('div');
    Object.assign(recapCard.style, {
      background:'rgba(18,20,26,.98)', border:'1px solid rgba(255,255,255,.1)',
      borderRadius:'16px', padding:'14px 16px', minWidth:'300px',
      boxShadow:'0 18px 48px rgba(0,0,0,.5)', textAlign:'center',
      transform:'scale(.9)', opacity:'0', transition:'transform .18s ease, opacity .18s ease'
    });
    const recapTitle = document.createElement('div'); recapTitle.textContent = 'DONE';
    recapTitle.style.fontSize = '18px'; recapTitle.style.marginBottom = '6px'; recapTitle.style.letterSpacing='.5px';
    const recapScore = document.createElement('div'); recapScore.style.fontSize = '20px'; recapScore.style.marginBottom = '6px';
    const recapStats = document.createElement('div'); recapStats.style.opacity='.85'; recapStats.style.fontSize='12px'; recapStats.style.marginBottom='10px';
    const againBtn   = mkBtn('Play again'); const settingsShort = mkBtn('Change settings');
    const btnRow = document.createElement('div'); Object.assign(btnRow.style, { display:'flex', gap:'6px', justifyContent:'center' });
    btnRow.appendChild(againBtn); btnRow.appendChild(settingsShort);
    recapCard.appendChild(recapTitle); recapCard.appendChild(recapScore); recapCard.appendChild(recapStats); recapCard.appendChild(btnRow);
    recap.appendChild(recapCard);

    function recapHost(){ return document.fullscreenElement || document.body; }
    function mountRecap(){ const host = recapHost(); if (recap.parentNode !== host) host.appendChild(recap); }
    mountRecap();
    document.addEventListener('fullscreenchange', mountRecap);

    function showRecap(){
      const key = `${params.gameMode}:${cfg.difficulty}`;
      const mult = (cfg.difficulty==='basic'?1.0: cfg.difficulty==='easy'?1.1: cfg.difficulty==='medium'?1.25: cfg.difficulty==='hard'?1.5: cfg.difficulty==='extreme'?1.75:2.0);
      let final = Math.round(score * mult);
      if (params.gameMode==='timed') {
        const bonus = Math.min(15, Math.floor(timeLeftMs/1000));
        final = Math.round(final * (1 + bonus/100));
      }
      const prevBest = bests[key] || 0;
      const isBest = final > prevBest;
      if (isBest) { bests[key] = final; save('bests', bests); }

      recapScore.textContent = `Final: ${final.toLocaleString()}${isBest?'  🎉 New Best!':''}`;
      recapStats.innerHTML = `Board: ${params.n}×${params.n} &nbsp;•&nbsp; Colors: ${params.colors} &nbsp;•&nbsp; Legal moves: ${lastMoveCount}`;
      recap.style.display = 'grid';
      requestAnimationFrame(()=>{ recapCard.style.transform='scale(1)'; recapCard.style.opacity='1'; });
    }
    againBtn.addEventListener('click', ()=>{ recap.style.display='none'; start(true); });
    settingsShort.addEventListener('click', ()=>{ recap.style.display='none'; openDrawer(true); });

    // ---------------- Start / Restart ----------------
    function applyDifficulty() {
      const d = DIFFS[cfg.difficulty] || DIFFS.medium;

      params.n = d.n;
      params.colors = Math.min(palette.length, d.colors);
      params.gameMode = d.mode;
      params.movesLeft = d.mode==='moves' ? d.moves : null;
      params.allowIdleHints = !!d.idleHints;
      params.strikeEnabled = !!d.strikes;
      params.deadFreeze = !!d.deadFreeze;
      params.gravityRot = !!d.gravityRot;
      params.gravity = 'down';
      params.tgtMin = d.target?.min ?? 3;
      params.tgtMax = d.target?.max ?? 5;

      resolveCycles = 0;
      cfg.mode = d.mode;

      if (d.mode === 'timed') {
        timeLeftMs = typeof d.time === 'number' ? d.time : DEFAULT_TIMED_MS;
      } else {
        timeLeftMs = 0;
      }

      updateTimeMovesChip();
      updateSubtitle();
    }

    function setActiveChips() {
      diffChips.forEach((b,i)=>{ const key=diffKeys[i];
        const active = (key===cfg.difficulty);
        b.style.outline = active ? '2px solid rgba(255,255,255,.35)' : '';
        b.style.background = active ? 'linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.05))' : 'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))';
      });
      modeChips.forEach((b,i)=>{ const key=modeKeys[i];
        const active = (key===cfg.mode);
        b.style.outline = active ? '2px solid rgba(255,255,255,.35)' : '';
        b.style.background = active ? 'linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.05))' : 'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))';
      });
      updateSubtitle();
    }

    function layout() {
      const maxW = Math.min(window.innerWidth * 0.92, 1080);
      const maxH = Math.min(window.innerHeight * 0.76, 900);
      const boardPx = Math.floor(Math.min(maxW, maxH) * 0.96);
      TILE = Math.max(38, Math.floor(boardPx / params.n));
      fitCanvas(canvas, params.n * TILE, params.n * TILE);
    }
    window.addEventListener('resize', layout);

    function start(fromUI=false){
      applyDifficulty();

      // seeded rng per start
      lastSeed = (Math.random()*0xffffffff)>>>0;
      rnd = LCRNG(lastSeed);

      tasks.length = 0;
      gameGen++;

      nextId=1; score=0; setScore(0);
      timeWarning=false; canvas.style.transform=''; shakingActive=false;
      selectPhase = 0; ghosts.length=0; idleMs=0; hintMove=null; invalidStreak=0;
      inputLocked = false; enforcing=false;

      setActiveChips();
      layout();

      // INIT: balanced, no 3s; spawn bags ready
      initFillBalanced();
      resetSpawnBags();

      // Enforce BEFORE first frame so initial board is already in-range
      enforcePermute(params.tgtMin, params.tgtMax);

      sel=null; hover=null; animating=false; resolving=false;

      lastMoveCount = countValidMoves();
      updateMoveCounter();

      if (!fromUI){ lastTick=now(); requestAnimationFrame(draw); }
    }

    // ---------------- Wire controls ----------------
    diffChips.forEach((btn, i)=>{
      btn.addEventListener('click', ()=>{
        cfg.difficulty = diffKeys[i]; save('cfg', cfg);
        toast(`Difficulty: ${btn.textContent}`); start(true);
      });
    });
    modeChips.forEach((btn, i)=>{
      // cosmetic
      btn.addEventListener('click', ()=>{
        cfg.mode = modeKeys[i]; save('cfg', cfg);
        updateSubtitle(); updateTimeMovesChip();
      });
    });

    function updateTimeMovesChip(){
      if (params.gameMode === 'timed') {
        timeMovesChip.lab.textContent = 'Time';
        timeMovesChip.val.textContent = Math.max(0, Math.ceil(timeLeftMs/1000)).toString();
      } else if (params.gameMode === 'moves') {
        timeMovesChip.lab.textContent = 'Moves';
        timeMovesChip.val.textContent = String(params.movesLeft ?? '—');
      } else {
        timeMovesChip.lab.textContent = 'Time';
        timeMovesChip.val.textContent = '—';
      }
    }

    // ---------------- Kick off ----------------
    const hudPoly = makeHUD(api, { score: true, lives: false, meta: true }); void hudPoly;
    start();

    // ---------------- Public API ----------------
    return {
      dispose(){
        window.removeEventListener('resize', layout);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        document.removeEventListener('fullscreenchange', mountOverlays);
        document.removeEventListener('fullscreenchange', mountRecap);
        canvas.style.transform='';
        const host = overlayHost();
        if (drawer.parentNode === host) host.removeChild(drawer);
        if (backdrop.parentNode === host) host.removeChild(backdrop);
        const rhost = recapHost();
        if (recap.parentNode === rhost) rhost.removeChild(recap);
      }
    };
  }
};
