// src/games/match3.js
// Match-3+ — Classic engine (no recolors, no specials), tough move-budget shaper,
// balanced color bags, CVD-safe palette, shape assist ON by default,
// fullscreen "New Game" wizard, scores/history, daily quests, confetti.
//
// Focused fixes from feedback:
// • Colors much more distinct (CVD-safe) + high-contrast outlines
// • Shape Assist default ON; Color Assist removed
// • Timer shake blinks red; stops immediately at 0
// • Basic is a bit easier (5 colors, looser target window)
// • Move overlay shows illegal attempts (“Moves: N · Illegal: X”)
// • Initial board always enforced into target move window
// • No recolors ever after init (enforcer = permutations only)
// • Column/row spawn mini-bags to avoid color bias
//
// ---------------------------------------------------------------------

import { fitCanvas, makeHUD, load, save, persistKey, makeConfetti } from '../kit/gamekit.js';

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

    // Difficulty presets (tight move targets; Basic slightly easier)
    const DIFFS = {
      basic:    { n: 8,  colors: 5,  mode: 'endless', time: null,  moves: null, strikes: false, idleHints: true,  deadFreeze: false, gravityRot: false, target:{min:8, max:14} },
      easy:     { n: 9,  colors: 7,  mode: 'timed',   time: 120e3, moves: null, strikes: false, idleHints: true,  deadFreeze: false, gravityRot: false, target:{min:5, max:9}  },
      medium:   { n: 9,  colors: 8,  mode: 'timed',   time: 100e3, moves: null, strikes: false, idleHints: false, deadFreeze: false, gravityRot: false, target:{min:4, max:7}  },
      hard:     { n: 10, colors: 9,  mode: 'moves',   time: null,  moves: 40,   strikes: true,  idleHints: false, deadFreeze: false, gravityRot: false, target:{min:3, max:5}  },
      extreme:  { n: 10, colors: 10, mode: 'timed',   time: 90e3,  moves: null, strikes: true,  idleHints: false, deadFreeze: true,  gravityRot: false, target:{min:2, max:3}  },
      nightmare:{ n: 11, colors: 10, mode: 'moves',   time: null,  moves: 35,   strikes: true,  idleHints: false, deadFreeze: true,  gravityRot: true,  target:{min:1, max:2}  },
    };

    // ---------------- Config ----------------
    const defaults = {
      difficulty: 'nightmare',
      mode: 'endless',            // label; actual comes from preset
      reducedMotion: false,
      highContrast: true,         // outline
      shapeAssist: true,          // ON by default across all modes
      hintsOnHard: false,         // ignored if preset idleHints=false
      showMoveCounter: true,
    };
    let cfg = { ...defaults, ...load('match3','cfg',{}) };

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

    // ---------------- Storage helpers ----------------
    const KEY_SCORES = persistKey('match3','scores');   // { bucket: number[] } (cap 50)
    const KEY_BEST   = persistKey('match3','hiscores'); // { bucket: best }
    const KEY_WIZ    = persistKey('match3','lastWizard'); // {mode, difficulty}
    const KEY_DAILY  = persistKey('match3','daily');    // { id, quests:[...], progress:{...}, streak }

    function loadJSON(key, d){ try{ return JSON.parse(localStorage.getItem(key)) ?? d; }catch{ return d; } }
    function saveJSON(key, v){ try{ localStorage.setItem(key, JSON.stringify(v)); }catch{} }

    let scoresMap = loadJSON(KEY_SCORES, {});
    let hiscores  = loadJSON(KEY_BEST, {});
    let lastWizard= loadJSON(KEY_WIZ, null);
    let daily     = loadJSON(KEY_DAILY, null);

    const bucketOf = () => `${params.gameMode}:${cfg.difficulty}`;

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
        padding:'6px 10px', borderRadius:'10px',
        border:'1px solid rgba(255,255,255,.14)',
        background:'linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))',
        color:'#e9ecf1', cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,.25)', fontSize:'12px', lineHeight:'1'
      });
      return b;
    };
    const settingsBtn = mkBtn('⚙');
    const newGameBtn  = mkBtn('New Game');

    const rowR = document.createElement('div');
    Object.assign(rowR.style, { display:'flex', gap:'6px', alignItems:'center' });
    rowR.appendChild(scoreChip.box);
    rowR.appendChild(timeMovesChip.box);
    rowR.appendChild(settingsBtn);
    rowR.appendChild(newGameBtn);

    bar.appendChild(document.createElement('div')); // (left side kept empty for now)
    bar.appendChild(rowR);
    wrapper.appendChild(bar);

    // Subtitle row (mode/difficulty + hiscore)
    const subtitle = document.createElement('div');
    subtitle.style.opacity = '.85';
    subtitle.style.fontSize = '12px';
    subtitle.style.marginTop = '-2px';
    subtitle.style.textAlign = 'center';
    subtitle.style.width = '100%';
    wrapper.appendChild(subtitle);

    // Game canvas — centered
    const canvasWrap = document.createElement('div');
    Object.assign(canvasWrap.style, { position:'relative', width:'100%' });
    const canvas = document.createElement('canvas');
    const g = fitCanvas(canvas, 8 * TILE, 8 * TILE);
    Object.assign(canvas.style, {
      display:'block', margin:'0 auto', touchAction:'none',
      borderRadius:'14px', border:'1px solid rgba(255,255,255,.06)'
    });
    canvasWrap.appendChild(canvas);
    wrapper.appendChild(canvasWrap);

    // Confetti overlay
    const confettiCanvas = document.createElement('canvas');
    Object.assign(confettiCanvas.style, {
      position:'absolute', inset:'0', pointerEvents:'none'
    });
    canvasWrap.appendChild(confettiCanvas);
    const confetti = makeConfetti(confettiCanvas);

    // Move counter overlay (optional)
    const moveOverlay = document.createElement('div');
    Object.assign(moveOverlay.style, {
      position:'relative', width:'100%', display:'grid', justifyItems:'center'
    });
    const moveText = document.createElement('div');
    Object.assign(moveText.style, {
      marginTop:'4px', fontSize:'11px', opacity:'.9'
    });
    moveOverlay.appendChild(moveText);
    wrapper.appendChild(moveOverlay);

    // Daily quests panel (collapsible)
    const dailyPanel = document.createElement('div');
    Object.assign(dailyPanel.style, {
      width:'100%', display:'grid', justifyItems:'center', marginTop:'2px'
    });
    const dailyCard = document.createElement('div');
    Object.assign(dailyCard.style, {
      display:'grid', gap:'6px', padding:'8px 10px',
      border:'1px solid rgba(255,255,255,.12)', borderRadius:'12px',
      background:'linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02))',
      maxWidth:'min(92vw, 680px)'
    });
    const dailyHeader = document.createElement('div');
    dailyHeader.style.display='flex'; dailyHeader.style.justifyContent='space-between'; dailyHeader.style.alignItems='center';
    const dailyTitle = document.createElement('strong'); dailyTitle.textContent='Daily Quests';
    const dailyToggle = mkBtn('▼'); dailyToggle.style.padding='2px 6px';
    dailyHeader.appendChild(dailyTitle); dailyHeader.appendChild(dailyToggle);
    const dailyList = document.createElement('div'); dailyList.style.display='grid'; dailyList.style.gap='4px';
    dailyCard.appendChild(dailyHeader); dailyCard.appendChild(dailyList);
    dailyPanel.appendChild(dailyCard);
    wrapper.appendChild(dailyPanel);

    // ---------------- Settings Drawer (compact, fullscreen-safe) ----------------
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
    Object.assign(drBody.style, { padding:'8px 10px', display:'grid', gap:'6px', overflow:'auto' });

    const mkToggle = (label, key) => {
      const line = document.createElement('label');
      Object.assign(line.style, { display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:'8px', padding:'3px 0' });
      const span = document.createElement('span'); span.textContent = label; span.style.opacity = '.88';
      const input = document.createElement('input'); input.type='checkbox'; input.checked = !!cfg[key];
      input.addEventListener('change', ()=>{
        cfg[key] = !!input.checked; save('match3','cfg',cfg);
        if (key === 'showMoveCounter') updateMoveCounter();
        if (key === 'reducedMotion') {/* respected in timings */}
      });
      line.appendChild(span); line.appendChild(input);
      return line;
    };

    drBody.appendChild(mkToggle('Reduced motion', 'reducedMotion'));
    drBody.appendChild(mkToggle('High contrast tiles', 'highContrast'));
    drBody.appendChild(mkToggle('Shape assist (All modes)', 'shapeAssist'));
    drBody.appendChild(mkToggle('Hints on hard modes', 'hintsOnHard'));
    drBody.appendChild(mkToggle('Show move counter', 'showMoveCounter'));

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

    // ---------------- HUD ----------------
    const hud = makeHUD(api, { score: true, lives: false, time: false });

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
    let enforcing = false;        // explicit enforcement state
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

    // Illegal move tracking
    let illegalStreak = 0;
    let illegalTotal  = 0;

    // Resolve counters
    let resolveCycles = 0;

    // Session stats (for daily quests)
    let tilesClearedThisRun = 0;
    let cascadesThisChain = 0;
    let sawRun4ThisRun = false;

    // ---------------- High-contrast, CVD-safe palette ----------------
    // Curated by perceptual spacing (approx. OKLCH distance). Wide lightness spread.
    const palette = [
      '#2043D0', // deep blue
      '#FF6B00', // vivid orange
      '#12B886', // teal green
      '#D81B60', // magenta rose
      '#8BC34A', // lime
      '#E53935', // red
      '#1E88E5', // bright blue
      '#FFC107', // amber
      '#7E57C2', // purple
      '#00BCD4', // cyan
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

    // ---------------- Init: Balanced bag fill, no 3s ----------------
    function initFillBalanced(){
      const n = params.n, k = params.colors;

      const total = n*n;
      const base = Math.floor(total / k);
      let rem = total - base*k;
      const counts = Array.from({length:k}, (_,i)=> base + (i<rem?1:0));

      let bag = [];
      for (let c=0;c<k;c++) for (let t=0;t<counts[c];t++) bag.push(c);
      shuffleInPlace(bag);

      board = Array.from({ length: n }, () => Array(n).fill(null));

      const placed = []; // {r,c}
      for (let r=0;r<n;r++){
        for (let c=0;c<n;c++){
          let chosen = null;
          const rejected = [];

          // prefer colors that don't create immediate triples (left/up)
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
            // try swapping with a previous placement so both become valid
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
      let sawRun4 = false;

      // horizontal
      for (let r=0; r<n; r++){
        let run = 1;
        for (let c=1; c<=n; c++){
          const same = c<n && board[r][c] && board[r][c-1] && board[r][c].color===board[r][c-1].color;
          if (same) run++;
          else {
            if (run>=3){
              for (let k=1; k<=run; k++) kill[r][c-k] = true;
              if (run>=4) sawRun4 = true;
            }
            run=1;
          }
        }
      }
      // vertical
      for (let c=0; c<n; c++){
        let run = 1;
        for (let r=1; r<=n; r++){
          const same = r<n && board[r][c] && board[r-1][c] && board[r][c].color===board[r-1][c].color;
          if (same) run++;
          else {
            if (run>=3){
              for (let k=1; k<=run; k++) kill[r-k][c] = true;
              if (run>=4) sawRun4 = true;
            }
            run=1;
          }
        }
      }

      const any = kill.some(row => row.some(Boolean));
      return { kill, any, sawRun4 };
    }

    // Local match check
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

    // Moves
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
        tilesClearedThisRun += cleared;
        maybeUpdateDaily('tiles');
      }

      return cleared;
    }

    // ---------------- Safe rotation helpers ----------------
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

    // ---------------- Permutation-only Move Enforcer ----------------
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
          const c1 = board[A.r][A.c]?.color, c2 = board[B.r][B.r?A.c:B.c]?.color; // correction below
          // fix: typo; use correct B.c
          const c2fixed = board[B.r]?.[B.c]?.color;
          if (c1==null || c2fixed==null || c1===c2fixed) continue;

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
          const len = Math.max(3, Math.min(5, n));
          const startMax = n - len;
          const start = startMax > 0 ? ((rnd()*(startMax+1))|0) : 0;
          const dir = rnd()<0.5 ? 1 : -1;
          const row = (rnd()*n)|0;

          if (!rotateRowSegmentSafe(row, start, len, dir)) return false;

          const safe = safeNoMatches();
          const m = safe ? countValidMoves() : curMoves+9999;
          if (!safe || (wantDown ? (m>curMoves) : (m<curMoves))){
            rotateRowSegmentSafe(row, start, len, -dir);
            return false;
          }
          return true;
        } else {
          const len = Math.max(3, Math.min(5, n));
          const startMax = n - len;
          const start = startMax > 0 ? ((rnd()*(startMax+1))|0) : 0;
          const dir = rnd()<0.5 ? 1 : -1;
          const col = (rnd()*n)|0;

          if (!rotateColSegmentSafe(col, start, len, dir)) return false;

          const safe = safeNoMatches();
          const m = safe ? countValidMoves() : curMoves+9999;
          if (!safe || (wantDown ? (m>curMoves) : (m<curMoves))){
            rotateColSegmentSafe(col, start, len, -dir);
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
      const { kill, any, sawRun4 } = findMatchesClassic();
      if (any) {
        // mark for visual pop
        for (let r=0; r<params.n; r++)
          for (let c=0; c<params.n; c++)
            if (kill[r][c] && board[r][c]) board[r][c].clearing = true;

        if (sawRun4) { sawRun4ThisRun = true; maybeUpdateDaily('run4'); }

        cascadesThisChain++;

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
        if (cascadesThisChain>0){ maybeUpdateDaily('cascades', cascadesThisChain); cascadesThisChain=0; }

        animating = false;
        resolving = false;

        // Nightmare: rotate gravity every 5 cycles
        if (params.gravityRot && resolveCycles % 5 === 0) {
          params.gravity = nextGravity(params.gravity);
          toast(`Gravity: ${params.gravity.toUpperCase()}`);
        }

        // Enforce move budget (Hard+), also after initial start
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
            schedule(900, ()=>{ inputLocked = false; softShuffle(true); lastMoveCount = countValidMoves(); updateMoveCounter(); });
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
        illegalStreak++; illegalTotal++; maybeUpdateDaily('illegal');
        addGhostTrail(r1,c1,r2-r1,c2-c1);
        schedule(cfg.reducedMotion?0:INVALID_MS, ()=>{
          const A=board[r2][c2], B=board[r1][c1];
          board[r2][c2]=B; board[r1][c1]=A;
          animateSwap(r2,c2,r1,c1, /*overshoot*/true);
        });

        // Strike penalty on Hard+
        if (params.strikeEnabled && illegalStreak >= 3) {
          illegalStreak = 0;
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

        updateMoveCounter();
        return false;
      }

      illegalStreak = 0;
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
      if (!hasAnyValidMove()){ initFillBalanced(); resetSpawnBags(); }
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
        g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,.9)';
        roundRect(g, x, y, w, h, 10); g.stroke();
      }
      if (cfg.shapeAssist){
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
            // cease shake + blink immediately
            canvas.style.transform=''; shakingActive=false; timeWarning=false;
            showRecap();
          }
        }
        timeMovesChip.lab.textContent = 'Time';
        timeMovesChip.val.textContent = Math.max(0, Math.ceil(timeLeftMs/1000)).toString();

        const prev = timeWarning;
        timeWarning = timeLeftMs > 0 && timeLeftMs <= 5000;
        if (timeWarning) {
          const blinkAlpha = 0.22 + 0.22 * Math.sin(now() / 80);
          g.fillStyle = `rgba(255,0,0,${blinkAlpha})`;
          g.fillRect(0,0,canvas.width,canvas.height);
          const s = 4 + 2.5 * Math.sin(now()/30);
          const ox = (rnd()*2-1)*s;
          const oy = (rnd()*2-1)*s;
          canvas.style.transform = `translate(${ox}px, ${oy}px)`;
          shakingActive = true;
        } else if ((prev && !timeWarning) || timeLeftMs===0) {
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
                       : 'Endless mode';
      const tgt = preset.target ? ` • Target moves: ${preset.target.min}–${preset.target.max}` : '';
      const key = `${preset.mode}:${cfg.difficulty}`;
      const best = hiscores[key] ?? 0;
      subtitle.textContent = `${modeLabel}${tgt} • Best: ${best.toLocaleString()}`;
    }

    function updateMoveCounter(){
      moveOverlay.style.display = cfg.showMoveCounter ? 'grid' : 'none';
      if (!cfg.showMoveCounter) return;
      moveText.textContent = `Moves: ${lastMoveCount} · Illegal: ${illegalTotal}`;
    }

    // ------ Recap ------
    const recap = document.createElement('div');
    Object.assign(recap.style, { position:'fixed', inset:'0', display:'none', placeItems:'center', zIndex:'100000' });
    const recapCard = document.createElement('div');
    Object.assign(recapCard.style, {
      background:'rgba(18,20,26,.98)', border:'1px solid rgba(255,255,255,.1)',
      borderRadius:'16px', padding:'14px 16px', minWidth:'320px',
      boxShadow:'0 18px 48px rgba(0,0,0,.5)', textAlign:'center',
      transform:'scale(.9)', opacity:'0', transition:'transform .18s ease, opacity .18s ease'
    });
    const recapTitle = document.createElement('div'); recapTitle.textContent = 'Game Over';
    recapTitle.style.fontSize = '18px'; recapTitle.style.marginBottom = '6px'; recapTitle.style.letterSpacing='.5px';
    const recapScore = document.createElement('div'); recapScore.style.fontSize = '20px'; recapScore.style.marginBottom = '6px';
    const recapStats = document.createElement('div'); recapStats.style.opacity='.85'; recapStats.style.fontSize='12px'; recapStats.style.marginBottom='10px';
    const recentBox  = document.createElement('div'); recentBox.style.fontSize='11px'; recentBox.style.opacity='.85'; recentBox.style.marginBottom='10px';
    const againBtn   = mkBtn('Play again'); const settingsShort = mkBtn('Settings');
    const btnRow = document.createElement('div'); Object.assign(btnRow.style, { display:'flex', gap:'6px', justifyContent:'center' });
    btnRow.appendChild(againBtn); btnRow.appendChild(settingsShort);
    recapCard.appendChild(recapTitle); recapCard.appendChild(recapScore); recapCard.appendChild(recapStats); recapCard.appendChild(recentBox); recapCard.appendChild(btnRow);
    recap.appendChild(recapCard);

    function recapHost(){ return document.fullscreenElement || document.body; }
    function mountRecap(){ const host = recapHost(); if (recap.parentNode !== host) host.appendChild(recap); }
    mountRecap();
    document.addEventListener('fullscreenchange', mountRecap);

    function pushScore(bucket, val){
      const arr = scoresMap[bucket] ?? [];
      arr.push(val); if (arr.length>50) arr.splice(0, arr.length-50);
      scoresMap[bucket] = arr; saveJSON(KEY_SCORES, scoresMap);
      const best = Math.max(val, hiscores[bucket] ?? 0);
      const isBest = best !== (hiscores[bucket] ?? 0);
      hiscores[bucket] = best; saveJSON(KEY_BEST, hiscores);
      return { best, isBest };
    }

    function showRecap(){
      const key = bucketOf();
      const mult = (cfg.difficulty==='basic'?1.0: cfg.difficulty==='easy'?1.12: cfg.difficulty==='medium'?1.25: cfg.difficulty==='hard'?1.5: cfg.difficulty==='extreme'?1.75:2.0);
      let final = Math.round(score * mult);
      if (params.gameMode==='timed') {
        const bonus = Math.min(15, Math.floor(timeLeftMs/1000));
        final = Math.round(final * (1 + bonus/100));
      }

      // Daily quest: finish timed
      if (params.gameMode==='timed') maybeUpdateDaily('finishTimed');

      const { best, isBest } = pushScore(key, final);

      // Confetti on best
      if (isBest) confetti.burst({ count: 240 });

      // UI
      recapScore.textContent = `Final: ${final.toLocaleString()}${isBest?'  🎉 New Best!':''}`;
      recapStats.innerHTML = `Board: ${params.n}×${params.n} • Colors: ${params.colors} • Legal moves: ${lastMoveCount} • Illegal: ${illegalTotal}`;
      const recent = scoresMap[key] ?? [];
      const lastFew = recent.slice(-5).map(v=>v.toLocaleString()).join(' · ');
      recentBox.textContent = `Recent: ${lastFew || '—'} • Best: ${best.toLocaleString()}`;

      recap.style.display = 'grid';
      requestAnimationFrame(()=>{ recapCard.style.transform='scale(1)'; recapCard.style.opacity='1'; });

      // Update subtitle with new best
      updateSubtitle();
    }
    againBtn.addEventListener('click', ()=>{ recap.style.display='none'; start(true); });
    settingsShort.addEventListener('click', ()=>{ recap.style.display='none'; openDrawer(true); });

    // ---------------- New Game Wizard (fullscreen) ----------------
    const wizard = document.createElement('div');
    Object.assign(wizard.style, {
      position:'fixed', inset:'0', display:'none', placeItems:'center', zIndex:'100001',
      background:'rgba(0,0,0,.5)'
    });
    const wCard = document.createElement('div');
    Object.assign(wCard.style, {
      background:'rgba(18,20,26,.98)', border:'1px solid rgba(255,255,255,.12)',
      borderRadius:'16px', padding:'16px', width:'min(92vw, 560px)', boxShadow:'0 18px 48px rgba(0,0,0,.5)',
      transform:'translateY(12px)', opacity:'0', transition:'transform .18s ease, opacity .18s ease'
    });
    const wTitle = document.createElement('div'); wTitle.textContent='New Game'; wTitle.style.fontSize='18px'; wTitle.style.marginBottom='8px'; wTitle.style.textAlign='center';
    const wBody  = document.createElement('div'); Object.assign(wBody.style, { display:'grid', gap:'10px' });
    const wRow   = (label, nodes=[])=>{
      const line = document.createElement('div');
      Object.assign(line.style, { display:'grid', gap:'8px' });
      const lab = document.createElement('div'); lab.textContent = label; lab.style.opacity='.85'; lab.style.fontSize='12px';
      const box = document.createElement('div'); Object.assign(box.style, { display:'flex', flexWrap:'wrap', gap:'6px' });
      nodes.forEach(n=>box.appendChild(n));
      line.appendChild(lab); line.appendChild(box);
      return line;
    };
    function chip(txt){ const b=mkBtn(txt); b.style.padding='6px 10px'; return b; }

    // Step 1: mode
    const modeBtns = ['endless','timed','moves'].map(m=> chip(m[0].toUpperCase()+m.slice(1)));
    let pickMode = lastWizard?.mode || 'timed';
    modeBtns.forEach((b,i)=> b.addEventListener('click', ()=>{ pickMode = ['endless','timed','moves'][i]; setWizardActive(); }));

    // Step 2: difficulty
    const diffList = ['basic','easy','medium','hard','extreme','nightmare'];
    const diffBtns = diffList.map(k=> chip(k[0].toUpperCase()+k.slice(1)));
    let pickDiff = lastWizard?.difficulty || 'medium';
    diffBtns.forEach((b,i)=> b.addEventListener('click', ()=>{ pickDiff = diffList[i]; setWizardActive(); }));

    const startBtn = mkBtn('Start'); startBtn.style.width='100%'; startBtn.style.marginTop='4px';
    startBtn.addEventListener('click', ()=>{
      const d = DIFFS[pickDiff] || DIFFS.medium;
      cfg.difficulty = pickDiff;
      save('match3','cfg',cfg);
      lastWizard = { mode: pickMode, difficulty: pickDiff };
      saveJSON(KEY_WIZ, lastWizard);

      // force mode to selected; presets define default, but we respect explicit mode choice
      const d2 = { ...d, mode: pickMode };
      applyPreset(d2);
      wizard.style.display='none';
      start(true);
    });

    function setWizardActive(){
      // highlight
      modeBtns.forEach((b,i)=>{ const key=['endless','timed','moves'][i]; const on=(key===pickMode); b.style.outline= on?'2px solid rgba(255,255,255,.35)':''; });
      diffBtns.forEach((b,i)=>{ const key=diffList[i]; const on=(key===pickDiff); b.style.outline= on?'2px solid rgba(255,255,255,.35)':''; });
    }

    wBody.appendChild(wRow('Mode', modeBtns));
    wBody.appendChild(wRow('Difficulty', diffBtns));
    wCard.appendChild(wTitle); wCard.appendChild(wBody); wCard.appendChild(startBtn);
    wizard.appendChild(wCard);

    function mountWizard(){
      const host = overlayHost();
      if (wizard.parentNode !== host) host.appendChild(wizard);
    }
    mountWizard();
    document.addEventListener('fullscreenchange', mountWizard);

    newGameBtn.addEventListener('click', ()=>{
      mountWizard();
      wizard.style.display='grid';
      requestAnimationFrame(()=>{ wCard.style.transform='translateY(0)'; wCard.style.opacity='1'; setWizardActive(); });
    });

    // ---------------- Daily quests ----------------
    // Simple pool; track progress keys in daily.progress
    const QUEST_POOL = [
      { key:'tiles',        label:'Clear 120 tiles',        target:120, kind:'counter' },
      { key:'run4',         label:'Make a 4+ match',        target:1,   kind:'flag'    },
      { key:'cascades',     label:'Trigger 5 cascades',     target:5,   kind:'counter' },
      { key:'illegalMax',   label:'Finish ≤ 3 illegal',     target:3,   kind:'maxAtEnd'},
      { key:'finishTimed',  label:'Finish a Timed run',     target:1,   kind:'flag'    },
      { key:'score6k',      label:'Score 6000+',            target:6000,kind:'score'   },
    ];
    function todayId(){
      // local midnight key
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function rollDaily(){
      const id = todayId();
      if (daily && daily.id === id) return;
      // pick 3 unique random quests
      const pool = QUEST_POOL.slice();
      shuffleInPlace(pool);
      const quests = pool.slice(0,3);
      const progress = { tiles:0, cascades:0, run4:false, illegalMax:true, finishTimed:false, score6k:false };
      const streak = (daily && daily.completed) ? (daily.streak||0)+1 : (daily && daily.id===id ? (daily.streak||0) : (daily?.streak||0));
      daily = { id, quests, progress, streak, completed:false };
      saveJSON(KEY_DAILY, daily);
    }
    function renderDaily(){
      dailyList.innerHTML = '';
      if (!daily) rollDaily();
      daily.quests.forEach(q=>{
        const row = document.createElement('div');
        Object.assign(row.style, { display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center' });
        const left = document.createElement('div'); left.textContent = q.label;
        const right = document.createElement('div');
        const done = isQuestDone(q);
        right.textContent = done ? '✓' : questProgText(q);
        right.style.opacity = done ? '1' : '.8';
        row.style.opacity = done ? '1' : '.9';
        row.style.textDecoration = done ? 'none' : 'none';
        dailyList.appendChild(row);
      });
      dailyTitle.textContent = `Daily Quests · Streak: ${daily?.streak||0}`;
    }
    function questProgText(q){
      const p = daily.progress;
      if (q.kind==='counter') return `${Math.min(q.target, p[q.key]||0)}/${q.target}`;
      if (q.kind==='flag') return (p[q.key] ? '✓' : '—');
      if (q.kind==='maxAtEnd') return `≤ ${q.target}`;
      if (q.kind==='score') return (p[q.key] ? '✓' : '—');
      return '—';
    }
    function isQuestDone(q){
      const p = daily.progress;
      if (q.kind==='counter') return (p[q.key]||0) >= q.target;
      if (q.kind==='flag')    return !!p[q.key];
      if (q.kind==='maxAtEnd')return p[q.key]===true; // set at end if illegalTotal <= target
      if (q.kind==='score')   return !!p[q.key];
      return false;
    }
    function completeQuest(q){
      if (!daily || isQuestDone(q)) return false;
      // mark if flag; counters are handled by progress increments
      if (q.kind==='flag') daily.progress[q.key] = true;
      saveJSON(KEY_DAILY, daily);
      confetti.burst({ count: 180 });
      renderDaily();
      // check all complete
      if (daily.quests.every(isQuestDone)){
        if (!daily.completed){
          daily.completed = true; daily.streak = (daily.streak||0)+1; saveJSON(KEY_DAILY, daily);
          confetti.burst({ count: 360 });
          toast('Daily complete!');
        }
      }
      return true;
    }
    function maybeUpdateDaily(what, val=0){
      if (!daily) return;
      if (what==='tiles'){ daily.progress.tiles = (daily.progress.tiles||0) + val; }
      if (what==='cascades'){ daily.progress.cascades = Math.max(daily.progress.cascades||0, val); }
      if (what==='run4'){ daily.progress.run4 = true; }
      if (what==='illegal'){ /* handled at end for ≤ target */ }
      if (what==='finishTimed'){ daily.progress.finishTimed = true; }
      if (what==='score'){ daily.progress.score6k = (val>=6000); }
      saveJSON(KEY_DAILY, daily);
      // auto-complete counters/flags if reached
      daily.quests.forEach(q=>{
        if (q.kind==='counter' || q.kind==='flag' || q.kind==='score'){
          if (isQuestDone(q)) completeQuest(q);
        }
      });
      renderDaily();
    }
    dailyToggle.addEventListener('click', ()=>{
      if (dailyList.style.display==='none'){ dailyList.style.display='grid'; dailyToggle.textContent='▼'; }
      else { dailyList.style.display='none'; dailyToggle.textContent='▲'; }
    });

    // ---------------- Start / Restart ----------------
    function applyPreset(d) {
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

    function applyDifficulty() {
      const d = DIFFS[cfg.difficulty] || DIFFS.medium;
      applyPreset(d);
    }

    function layout() {
      const maxW = Math.min(window.innerWidth * 0.92, 1080);
      const maxH = Math.min(window.innerHeight * 0.76, 900);
      const boardPx = Math.floor(Math.min(maxW, maxH) * 0.96);
      TILE = Math.max(38, Math.floor(boardPx / params.n));
      fitCanvas(canvas, params.n * TILE, params.n * TILE);
      // resize confetti overlay
      confetti.resize();
    }
    window.addEventListener('resize', layout);

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

    function start(fromUI=false){
      applyDifficulty();

      // daily roll/update UI
      rollDaily(); renderDaily();

      // seeded rng per start
      lastSeed = (Math.random()*0xffffffff)>>>0;
      rnd = LCRNG(lastSeed);

      tasks.length = 0;
      gameGen++;

      nextId=1; score=0; setScore(0);
      timeWarning=false; canvas.style.transform=''; shakingActive=false;
      selectPhase = 0; ghosts.length=0; idleMs=0; hintMove=null;
      illegalStreak=0; illegalTotal=0;
      tilesClearedThisRun=0; cascadesThisChain=0; sawRun4ThisRun=false;

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

      // focus scores for daily "score 6000+" tracking
      maybeUpdateDaily('score', score);
    }

    function endAndFinalizeDaily(){
      if (!daily) return;
      // illegalMax at end
      const q = daily.quests.find(q=>q.key==='illegalMax');
      if (q){
        daily.progress.illegalMax = (illegalTotal <= q.target);
      }
      // score6k if needed
      const q2 = daily.quests.find(q=>q.key==='score6k');
      if (q2){
        daily.progress.score6k = (score >= q2.target);
      }
      saveJSON(KEY_DAILY, daily);
      daily.quests.forEach(completeQuest); // will ignore already-done
      renderDaily();
    }

    // New Game button also opens wizard
    // already wired above (newGameBtn)

    // ---------------- Kick off ----------------
    const hudPoly = makeHUD(api, { score: true, lives: false, time: false }); void hudPoly;
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
        document.removeEventListener('fullscreenchange', mountWizard);
        canvas.style.transform='';
        const host = overlayHost();
        if (drawer.parentNode === host) host.removeChild(drawer);
        if (backdrop.parentNode === host) host.removeChild(backdrop);
        const rhost = recapHost();
        if (recap.parentNode === rhost) rhost.removeChild(recap);
        if (wizard.parentNode === rhost) rhost.removeChild(wizard);
      }
    };

    // ------------- local helpers at end -------------
    function updateTimeLabel(){ /* kept if needed later */ }

  } // launch
};
