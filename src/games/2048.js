// 2048.js — v11
// -----------------------------------------------------------------------------
// • Confetti: uses makeConfetti on a board overlay canvas and FORCE-resizes
//   before every burst — now always visible.
// • Added "Test Fill" button (easy to delete) that fills half the board with 1024s.
// • Rush mode: big side countdown; at ≤5s the board flashes red & shakes hard.
// • Removed the Hint button from UI (logic kept but unused).
// • Swap = visual FLIP first, then commit (no overlaps).
// • Delete-By-Number: permanent remove; max 2/game; no respawn.
// • Distinct per-value colors via golden-angle OKLCH.
// • Classic | Rush (60s, merges add time) | Hardcore (30% 4s, no powers).
//
// Depends on ../kit/gamekit.js (makeHUD, makeHiScore, makeConfetti)

import { makeHUD, makeHiScore, makeConfetti } from '../kit/gamekit.js';

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

// tiny RNG
function makeRNG(seedStr='free'){
  let h=2166136261>>>0; for(let i=0;i<seedStr.length;i++){ h^=seedStr.charCodeAt(i); h=Math.imul(h,16777619); }
  let x=(h||1)>>>0;
  return {
    next(){ x^=x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296; },
    pick(arr){ return arr[(this.next()*arr.length)|0]; }
  };
}

export default {
  id:'2048',
  title:'2048',
  category:'puzzle',
  icon:'🧩',
  tags:['merge','swipe','touch','keyboard','undo','powers','rush','hardcore','test'],
  launch(api){
    const TUNE = {
      GAP: 10,
      RADIUS: 16,
      BASE_MS: 150,
      SPAWN_SCALE: 0.86,
      MERGE_SCALE: 1.12,
      SWIPE_MIN: 24,
      RUSH_SECONDS: 60,
      BONUS_PER_256: 4,
      HAPTICS: true
    };

    let cfg = {
      board: 4,                          // 3..6
      mode: 'classic',                   // 'classic' | 'rush' | 'hardcore'
      reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    };

    // --- State
    let grid = [];                 // cell -> id
    const tiles = new Map();       // id -> {id,val,r,c,el}
    let nextId = 1;
    let score = 0;
    let hiscore = makeHiScore(hiKey());
    let rng = makeRNG();
    let isAnimating = false;
    let bufferedDir = null;

    // powers
    let undoLeft = 2;
    let replaceTwoLeft = 2;
    let deleteCredits = 2;
    let undoStack = [];
    let swapInProgress = false;

    // rush
    let timeLeft = TUNE.RUSH_SECONDS;  // seconds
    let timerId = null;

    // confetti milestones
    let maxCelebrated = 0;

    // UI modes
    let uiMode = 'play'; // 'play' | 'replace-picking' | 'delete-choose' | 'hint-show'

    // HUD
    const hud = makeHUD(api, { score:true, lives:false, time:true, level:false });

    // --- Root & layout
    const root = document.createElement('div');
    root.style.cssText = `
      width:min(94vw,720px); margin:16px auto; position:relative;
      background:var(--card); border:1px solid var(--ring); border-radius:18px;
      box-shadow:var(--shadow); padding:14px; user-select:none; -webkit-user-select:none; touch-action:pan-y;
    `;
    root.style.setProperty('--gap', `${TUNE.GAP}px`);
    root.style.setProperty('--rad', `${TUNE.RADIUS}px`);

    // Panic/Shake CSS
    if(!document.getElementById('g2048-effects')){
      const s=document.createElement('style'); s.id='g2048-effects';
      s.textContent=`
        @keyframes g2048-blink {
          0%,100%{ background:transparent; }
          50%{ background:rgba(255,0,0,.12); }
        }
        @keyframes g2048-shake {
          0%{ transform:translate(0,0) }
          20%{ transform:translate(-4px,2px) }
          40%{ transform:translate(3px,-3px) }
          60%{ transform:translate(-5px,1px) }
          80%{ transform:translate(3px,3px) }
          100%{ transform:translate(0,0) }
        }
        .g2048-panic { animation: g2048-blink 0.6s linear infinite; }
        .g2048-shake { animation: g2048-shake 0.25s linear infinite; }
      `;
      document.head.appendChild(s);
    }

    const header = document.createElement('div');
    header.style.cssText = `display:flex; align-items:center; justify-content:center; margin-bottom:6px;`;
    const note = document.createElement('div');
    note.style.cssText = `opacity:.95; font-size:.95rem; font-weight:700;`;
    header.appendChild(note);
    root.appendChild(header);

    // Settings row (compact)
    const settingsBar = document.createElement('div');
    settingsBar.style.cssText = `margin:8px auto 10px; display:flex; gap:10px; align-items:center; justify-content:center; flex-wrap:wrap;`;
    const label = (t)=>{ const s=document.createElement('span'); s.textContent=t; s.style.opacity='.9'; s.style.fontWeight='800'; return s; };
    const sel = (opts, val)=>{
      const s=document.createElement('select');
      s.style.cssText=`padding:6px 10px; border-radius:999px; border:2px solid var(--ring); background:var(--surface,#fff); font-weight:800;`;
      for(const [v,txt] of opts){ const o=document.createElement('option'); o.value=v; o.textContent=txt; s.appendChild(o); }
      s.value=val; return s;
    };
    const sizeSel = sel([['3','3×3'],['4','4×4'],['5','5×5'],['6','6×6']], String(cfg.board));
    const modeSel = sel([['classic','Classic'],['rush','Rush'],['hardcore','Hardcore']], cfg.mode);
    settingsBar.append(label('Size'), sizeSel, label('Mode'), modeSel);
    root.appendChild(settingsBar);

    // Board + Rush panel container
    const stage = document.createElement('div');
    stage.style.cssText = `
      display:grid; grid-template-columns: 1fr auto; align-items:stretch; gap:14px;
    `;

    // Board
    const boardWrap = document.createElement('div');
    boardWrap.style.cssText = `position:relative;`;

    const board = document.createElement('div');
    board.style.cssText = `
      position:relative; width:min(100%,560px); aspect-ratio:1/1; border-radius:var(--rad);
      background:linear-gradient(180deg, color-mix(in oklab, var(--card), #000 3%), color-mix(in oklab, var(--card), #000 6%));
      border:1px solid var(--ring); overflow:hidden;
    `;
    const gridBg = document.createElement('div');
    gridBg.style.cssText = `position:absolute; inset:0; display:grid; gap:var(--gap); z-index:1;`;
    const tileLayer = document.createElement('div');
    tileLayer.style.cssText = `position:absolute; inset:0; z-index:2;`;
    const hintLayer = document.createElement('div');
    hintLayer.style.cssText = `position:absolute; inset:0; pointer-events:none; z-index:6;`;
    const confettiCanvas = document.createElement('canvas');
    confettiCanvas.style.cssText = `position:absolute; inset:0; width:100%; height:100%; z-index:8; pointer-events:none;`;
    board.append(gridBg, tileLayer, hintLayer, confettiCanvas);
    boardWrap.appendChild(board);
    stage.appendChild(boardWrap);

    // Rush big counter (right side)
    const rushPanel = document.createElement('div');
    rushPanel.style.cssText = `
      display:flex; align-items:center; justify-content:center; min-width:90px; padding:6px 10px;
    `;
    const rushBig = document.createElement('div');
    rushBig.style.cssText = `
      font-weight:900; font-size:48px; line-height:1; letter-spacing:1px; opacity:.85;
      display:none; /* shown only in rush */
    `;
    rushPanel.appendChild(rushBig);
    stage.appendChild(rushPanel);

    root.appendChild(stage);

    // Under-board controls
    const controls = document.createElement('div');
    controls.style.cssText = `display:flex; gap:10px; align-items:flex-start; justify-content:center; margin-top:10px; flex-wrap:wrap;`;

    const mkMicro = (labelTxt, titleTxt) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = `display:flex; flex-direction:column; align-items:center; gap:4px;`;
      const btn = document.createElement('button');
      btn.type='button'; btn.title=titleTxt||labelTxt; btn.textContent=labelTxt;
      btn.style.cssText = `
        height:30px; padding:0 12px; border-radius:999px; font-weight:800; font-size:12px; line-height:30px;
        cursor:pointer; border:2px solid var(--ring);
        color: var(--color-text,#111);
        background: color-mix(in oklab, var(--surface,#fff), #000 6%);
        transition: transform 80ms ease, filter 120ms ease, opacity 160ms ease;
      `;
      btn.onpointerdown=e=>e.preventDefault();
      btn.addEventListener('mouseenter',()=> btn.style.filter='brightness(0.97)');
      btn.addEventListener('mouseleave',()=> btn.style.filter='');
      btn.addEventListener('click',()=>{ btn.style.transform='scale(0.98)'; setTimeout(()=>btn.style.transform='',90); });
      const ticks = document.createElement('div');
      ticks.style.cssText = `height:8px; display:flex; gap:4px; align-items:center; justify-content:center;`;
      for(let i=0;i<2;i++){ const t=document.createElement('div'); t.style.cssText=`width:14px; height:2px; border-radius:2px; background:var(--ring); opacity:.4;`; ticks.appendChild(t); }
      wrap.append(btn,ticks);
      return {wrap,btn,ticks};
    };

    const undoUI = mkMicro('Undo','Undo last move (U)');
    const replUI = mkMicro('Replace','Swap two tiles');
    const delUI  = mkMicro('Delete #','Remove all tiles of a number (max 2)');
    // (Hint removed by request)

    controls.append(undoUI.wrap, replUI.wrap, delUI.wrap);
    root.appendChild(controls);

    // New + Test buttons row
    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display:flex; gap:8px; justify-content:center; margin-top:8px; flex-wrap:wrap;`;

    const newBtn = document.createElement('button');
    newBtn.type='button'; newBtn.textContent='New';
    newBtn.title='Start new game';
    newBtn.style.cssText=`
      height:34px; padding:0 16px; border-radius:999px; font-weight:900; font-size:13px; line-height:34px;
      cursor:pointer; border:2px solid color-mix(in oklab, var(--color-primary,#2a9d8f), #000 25%);
      color:#fff; background: color-mix(in oklab, var(--color-primary,#2a9d8f), #000 12%);
      transition: transform 80ms ease, filter 120ms ease;
    `;
    newBtn.onpointerdown=e=>e.preventDefault();

    // Super easy to remove test button
    const testBtn = document.createElement('button');
    testBtn.type='button'; testBtn.textContent='Test Fill';
    testBtn.title='Fill half the board with 1024s';
    testBtn.style.cssText=`
      height:34px; padding:0 16px; border-radius:999px; font-weight:900; font-size:13px; line-height:34px;
      cursor:pointer; border:2px solid color-mix(in oklab, #555, #000 25%);
      color:#fff; background: color-mix(in oklab, #777, #000 12%);
      transition: transform 80ms ease, filter 120ms ease;
    `;

    btnRow.append(newBtn);
    root.appendChild(btnRow);

    // Toast & live
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:absolute; left:50%; bottom:12px; transform:translateX(-50%);
      padding:6px 10px; border-radius:999px; background:rgba(0,0,0,.75); color:#fff;
      font-weight:800; font-size:.9rem; opacity:0; pointer-events:none; transition:opacity 180ms;
    `;
    const live = document.createElement('div');
    live.setAttribute('aria-live','polite');
    live.style.cssText=`position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(1px,1px,1px,1px);`;
    root.append(toast, live);

    api.mount.appendChild(root);

    // Confetti system (always resize before use)
    const confSys = makeConfetti(confettiCanvas, { duration: 6 });

    // Helpers
    function hiKey(){ return `2048-${cfg.board}-${cfg.mode}`; }
    function ms(){ return cfg.reduced ? 0 : Math.max(60, TUNE.BASE_MS); }
    function setNote(t){ note.textContent=t; }
    function say(s){ live.textContent=s; }
    let toastT=null; function showToast(msg){ toast.textContent=msg; toast.style.opacity='1'; clearTimeout(toastT); toastT=setTimeout(()=>toast.style.opacity='0',1100); }

    // Colors
    const colorCache=new Map();
    function palette(v){
      if(!v) return {bg:'transparent', fg:'#111'};
      const d=Math.log2(v)|0;
      if(colorCache.has(d)) return colorCache.get(d);
      const n=Math.max(1,d-1);
      const h=(n*137.50776405)%360;
      const l=Math.max(26, 80-4.4*n);
      const c=Math.min(0.42, 0.22+0.02*n);
      const fg=(l<=52||d>=5)?'#fff':'#111';
      const col={bg:`oklch(${l}% ${c} ${h})`, fg};
      colorCache.set(d,col); return col;
    }
    function fmtVal(v,sizePx){
      const s=String(v);
      if(s.length<=4) return {text:s,fs:Math.max(16,sizePx*0.34)};
      const units=['','K','M','G']; let n=v,u=0; while(n>=1000&&u<units.length-1){ n=Math.round(n/1000); u++; }
      return {text:`${n}${units[u]}`, fs:Math.max(14,sizePx*0.30)};
    }

    // Layout
    function cellSize(){
      const r=board.getBoundingClientRect(); const S=grid.length;
      return Math.max(10,(r.width - TUNE.GAP*(S-1) - 2)/S);
    }
    function xy(r,c){ const s=cellSize(); return {x:c*(s+TUNE.GAP)+1,y:r*(s+TUNE.GAP)+1,size:s}; }
    function buildGridBg(){
      const S=grid.length;
      gridBg.style.gridTemplateColumns=`repeat(${S},1fr)`;
      gridBg.style.gridTemplateRows=`repeat(${S},1fr)`;
      gridBg.innerHTML='';
      for(let i=0;i<S*S;i++){ const d=document.createElement('div'); d.style.cssText=`background:color-mix(in oklab, var(--card), #000 5%); border-radius:var(--rad);`; gridBg.appendChild(d); }
    }
    function makeTileEl(t){
      const {x,y,size}=xy(t.r,t.c); const {bg,fg}=palette(t.val); const {text,fs}=fmtVal(t.val,size);
      const el=document.createElement('div'); el.className='tile';
      el.style.cssText=`
        position:absolute; left:0; top:0; z-index:1;
        transform:translate3d(${x}px,${y}px,0) scale(1);
        width:${size}px; height:${size}px; border-radius:var(--rad);
        display:grid; place-items:center; font-weight:800; color:${fg};
        background:${bg}; box-shadow:0 4px 14px rgba(0,0,0,.12);
        transition:${cfg.reduced?'none':`transform ${ms()}ms cubic-bezier(.2,.8,.2,1), background ${ms()}ms`};
        will-change:transform, background;
      `;
      el.textContent=text; el.style.fontSize=`${fs}px`;
      t.el=el; tileLayer.appendChild(el); return el;
    }
    function updateTileEl(t){
      const {x,y,size}=xy(t.r,t.c); const {bg,fg}=palette(t.val); const {text,fs}=fmtVal(t.val,size);
      const el=t.el;
      el.style.transform=`translate3d(${x}px,${y}px,0) scale(1)`;
      el.style.width=`${size}px`; el.style.height=`${size}px`;
      el.style.background=bg; el.style.color=fg; el.textContent=text; el.style.fontSize=`${fs}px`;
    }
    function layoutAll(){ tiles.forEach(updateTileEl); confSys.resize(); }

    // RNG & spawns
    function randomSpawnVal(){
      if(cfg.mode==='hardcore') return (rng.next()*100 < 30) ? 4 : 2;
      return (rng.next()*100 < 10) ? 4 : 2;
    }
    function spawnRandom(){
      const S=grid.length, empty=[];
      for(let r=0;r<S;r++) for(let c=0;c<S;c++) if(grid[r][c]===0) empty.push([r,c]);
      if(!empty.length) return null;
      const [r,c]=empty[(rng.next()*empty.length)|0];
      return spawnAt(r,c,randomSpawnVal());
    }
    function spawnAt(r,c,val){
      const t={id:nextId++, val, r, c, el:null};
      tiles.set(t.id,t); grid[r][c]=t.id; const el=makeTileEl(t);
      if(!cfg.reduced){ el.style.transform+=` scale(${TUNE.SPAWN_SCALE})`; requestAnimationFrame(()=>{ el.style.transform=el.style.transform.replace(` scale(${TUNE.SPAWN_SCALE})`,' scale(1)'); }); }
      say(`New ${val} at ${colRow(c,r)}`); return t;
    }

    // Simulate (0←,1↑,2→,3↓)
    function lineCoord(dir, idx, step, S){
      switch(dir){
        case 0: return {r:idx,     c:step};
        case 2: return {r:idx,     c:S-1-step};
        case 1: return {r:step,    c:idx};
        case 3: return {r:S-1-step,c:idx};
      }
    }
    function simulateMove(dir, gridIn, tilesIn){
      const S=gridIn.length;
      const gridAfter=Array.from({length:S},()=>Array(S).fill(0));
      const actions=[]; const merges=[]; let changed=false;

      for(let idx=0; idx<S; idx++){
        const seq=[];
        for(let step=0; step<S; step++){
          const {r,c}=lineCoord(dir,idx,step,S);
          const id=gridIn[r][c]; if(!id) continue;
          const val=tilesIn.get(id)?.val ?? 0;
          seq.push({id,val,from:{r,c},fromStep:step});
        }
        let tStep=0;
        for(let i=0;i<seq.length;){
          if(i+1<seq.length && seq[i].val===seq[i+1].val){
            const a=seq[i], b=seq[i+1]; const to=lineCoord(dir,idx,tStep,S);
            if(a.fromStep!==tStep) actions.push({id:a.id, from:a.from, to});
            if(b.fromStep!==(tStep+1)) actions.push({id:b.id, from:b.from, to});
            merges.push({to, fromIds:[a.id,b.id], newVal:a.val*2});
            gridAfter[to.r][to.c]=-1; changed=true; i+=2; tStep++;
          } else {
            const a=seq[i]; const to=lineCoord(dir,idx,tStep,S);
            if(a.fromStep!==tStep){ actions.push({id:a.id, from:a.from, to}); changed=true; }
            gridAfter[to.r][to.c]=a.id; i++; tStep++;
          }
        }
      }
      return { moved:changed, actions, merges, gridAfter };
    }
    function hasAnyMove(){
      for(const d of [0,1,2,3]) if(simulateMove(d,grid,tiles).moved) return true;
      return false;
    }

    // Commit pipeline
    function commitSlides(actions){
      for(const a of actions){ const t=tiles.get(a.id); if(!t) continue; t.r=a.to.r; t.c=a.to.c; t.el && (t.el.style.zIndex='2'); updateTileEl(t); }
    }
    function waitElementsTransition(els){
      if(cfg.reduced || !els.length) return Promise.resolve();
      return new Promise(res=>{
        let done=0; const need=els.length; const guard=setTimeout(()=>res(), ms()+140);
        const onEnd=(e)=>{ if(e.propertyName!=='transform') return; e.currentTarget.removeEventListener('transitionend', onEnd); if(++done>=need){ clearTimeout(guard); res(); } };
        els.forEach(el=> el.addEventListener('transitionend', onEnd));
      });
    }
    function waitMovers(actions){
      const movers=new Set(actions.map(a=>tiles.get(a.id)?.el).filter(Boolean));
      return waitElementsTransition([...movers]);
    }
    function performMerges(merges){
      let maxMerged=0;
      for(const m of merges){
        const [ia,ib]=m.fromIds; const ta=tiles.get(ia), tb=tiles.get(ib);
        ta?.el?.remove(); tb?.el?.remove(); tiles.delete(ia); tiles.delete(ib); grid[m.to.r][m.to.c]=0;
      }
      for(const m of merges){
        const t={id:nextId++, val:m.newVal, r:m.to.r, c:m.to.c, el:null};
        tiles.set(t.id,t); grid[t.r][t.c]=t.id;
        const el=makeTileEl(t); el.style.zIndex='3';
        if(!cfg.reduced){ el.style.transform+=` scale(${TUNE.MERGE_SCALE})`; void el.offsetWidth; el.style.transform=el.style.transform.replace(` scale(${TUNE.MERGE_SCALE})`,' scale(1)'); }
        score+=t.val; maxMerged=Math.max(maxMerged,t.val);
        if(TUNE.HAPTICS && 'vibrate' in navigator) navigator.vibrate?.(cfg.reduced?8:18);
        say(`Merged ${t.val}`);
      }
      hud.setScore(score); hiscore.set(score);

      const highestNow = boardMaxTile();
      if(highestNow >= 2048 && highestNow > maxCelebrated){
        maxCelebrated = highestNow;
        fireConfettiCentered();
        setNote(`🎉 ${highestNow}! • Best: ${hiscore.get()}`);
      }

      // Rush bonus time
      if(cfg.mode==='rush' && maxMerged>=256){
        const bonus=Math.floor(maxMerged/256)*TUNE.BONUS_PER_256;
        if(bonus>0){ timeLeft=Math.min(timeLeft+bonus, TUNE.RUSH_SECONDS*2); hud.setTime(timeLeft*1000); showToast(`+${bonus}s`); }
      }
    }
    function boardMaxTile(){ let m=0; tiles.forEach(t=>{ if(t.val>m) m=t.val; }); return m; }
    function fireConfettiCentered(){
      // Make sure canvas is sized, then burst
      confSys.resize();
      confSys.burst({ count: 260 });
    }

    // Moves
    async function doMove(dir){
      if(isAnimating || swapInProgress){ bufferedDir ??= dir; return; }
      if(uiMode!=='play') cancelTransientModes();
      if(cfg.mode==='rush' && timeLeft===0){ setNote(`⏱ Time! Best: ${hiscore.get()}`); return; }

      const sim=simulateMove(dir,grid,tiles);
      if(!sim.moved){ setNote(`No move • Best: ${hiscore.get()}`); return; }

      pushUndo();

      const S=grid.length;
      grid=Array.from({length:S},()=>Array(S).fill(0));
      for(let r=0;r<S;r++) for(let c=0;c<S;c++){ const v=sim.gridAfter[r][c]; grid[r][c] = v>0 ? v : 0; }

      isAnimating=true;
      await (commitSlides(sim.actions), waitMovers(sim.actions));
      performMerges(sim.merges);

      spawnRandom(); layoutAll();

      isAnimating=false;

      if(cfg.mode!=='hardcore' && !hasAnyMove() && cfg.mode!=='rush') setNote(`No moves • Best: ${hiscore.get()}`);
      else setNote(modeNote());

      if(bufferedDir!==null){ const d=bufferedDir; bufferedDir=null; doMove(d); }
    }

    // Undo
    function pushUndo(){
      const S=grid.length;
      const gCopy=Array.from({length:S},()=>Array(S).fill(0));
      for(let r=0;r<S;r++) for(let c=0;c<S;c++) gCopy[r][c]=grid[r][c];
      const tCopy=[...tiles.entries()].map(([id,t])=>[id,{id, val:t.val, r:t.r, c:t.c}]);
      undoStack.unshift({grid:gCopy, tiles:tCopy, score, nextId, timeLeft, undoLeft, replaceTwoLeft, deleteCredits, maxCelebrated});
      if(undoStack.length>2) undoStack.pop();
    }
    function doUndo(){
      if(isAnimating || swapInProgress || !undoStack.length || undoLeft<=0) return;
      cancelTransientModes();
      const s=undoStack.shift();
      grid=Array.from({length:s.grid.length},()=>Array(s.grid.length).fill(0));
      tiles.clear(); tileLayer.innerHTML='';
      for(let r=0;r<grid.length;r++) for(let c=0;c<grid.length;c++) grid[r][c]=s.grid[r][c];
      for(const [id,t] of s.tiles){ tiles.set(id,{...t, el:null}); makeTileEl(tiles.get(id)); }
      nextId=s.nextId; score=s.score; timeLeft=s.timeLeft; maxCelebrated=s.maxCelebrated||0;
      undoLeft = Math.max(0, s.undoLeft - 1);
      replaceTwoLeft = s.replaceTwoLeft; deleteCredits = s.deleteCredits;
      hud.setScore(score);
      hud.setTime(cfg.mode==='rush'? timeLeft*1000 : 0);
      hiscore.set(score);
      layoutAll(); refreshPowerUI(); setNote(`Undone • Best: ${hiscore.get()}`);
    }

    // Replace-Two (visual FLIP then commit)
    let pickBuffer=[];
    function startReplaceTwo(){
      if(isAnimating || swapInProgress || replaceTwoLeft<=0) return;
      cancelTransientModes();
      uiMode='replace-picking'; pickBuffer.length=0;
      setNote(`Pick 2 tiles to swap • Best: ${hiscore.get()}`);
      tileLayer.style.cursor='crosshair'; tileLayer.style.outline='2px dashed var(--ring)';
    }
    function onTileClick(e){
      if(uiMode!=='replace-picking') return;
      const el=e.target.closest('.tile'); if(!el) return;
      const tile=[...tiles.values()].find(t=>t.el===el); if(!tile) return;
      if(pickBuffer.includes(tile)) return;
      selectGlow(tile, pickBuffer.length);
      pickBuffer.push(tile);
      if(pickBuffer.length>=2){
        const [a,b]=pickBuffer.splice(0,2);
        pushUndo();
        uiMode='play'; tileLayer.style.cursor=''; tileLayer.style.outline='';
        swapInProgress=true; isAnimating=true;
        visualSwapThenCommit(a,b).then(()=>{
          replaceTwoLeft=Math.max(0,replaceTwoLeft-1);
          refreshPowerUI(); setNote(`Swapped tiles • Best: ${hiscore.get()}`);
          swapInProgress=false; isAnimating=false;
          if(bufferedDir!==null){ const d=bufferedDir; bufferedDir=null; doMove(d); }
        });
      }
    }
    function selectGlow(t, idx){
      if(!t.el) return;
      t.el.style.boxShadow='0 0 0 3px color-mix(in oklab, var(--ring), #000 10%)';
      t.el.style.filter='brightness(1.02)';
      if(!cfg.reduced){
        t.el.animate([{transform:t.el.style.transform+' scale(1)'},{transform:t.el.style.transform+' scale(1.05)'},{transform:t.el.style.transform+' scale(1)'}],
          {duration:ms()+100, easing:'ease'});
      }
      const badge=document.createElement('div');
      badge.textContent=idx===0?'1':'2';
      badge.style.cssText=`
        position:absolute; top:6px; right:6px; width:18px; height:18px; border-radius:999px;
        background:rgba(0,0,0,.6); color:#fff; font-weight:900; font-size:12px; display:grid; place-items:center; pointer-events:none;
      `;
      t.el.appendChild(badge);
      setTimeout(()=>{ badge.remove(); t.el && (t.el.style.boxShadow='', t.el.style.filter=''); }, ms()+400);
    }
    function visualSwapThenCommit(t1,t2){
      return new Promise(resolve=>{
        const p1=xy(t1.r,t1.c), p2=xy(t2.r,t2.c);
        if(t1.el) t1.el.style.zIndex='5';
        if(t2.el) t2.el.style.zIndex='5';
        const moveEl = (t, target)=> {
          if(!t.el) return;
          t.el.style.width=`${target.size}px`; t.el.style.height=`${target.size}px`;
          t.el.style.transform=`translate3d(${target.x}px,${target.y}px,0) scale(1)`;
        };
        moveEl(t1, p2);
        moveEl(t2, p1);
        const els=[t1.el,t2.el].filter(Boolean);
        waitElementsTransition(els).then(()=>{
          // Commit swap logically
          const r1=t1.r,c1=t1.c,r2=t2.r,c2=t2.c;
          const id1=grid[r1][c1], id2=grid[r2][c2];
          grid[r1][c1]=id2; grid[r2][c2]=id1;
          t1.r=r2; t1.c=c2; t2.r=r1; t2.c=c1;
          updateTileEl(t1); updateTileEl(t2);
          if(t1.el) t1.el.style.zIndex='1';
          if(t2.el) t2.el.style.zIndex='1';
          resolve();
        });
      });
    }

    // Delete-By-Number
    function startDeleteByNumber(){
      if(isAnimating || swapInProgress || deleteCredits<=0) return;
      cancelTransientModes();
      uiMode='delete-choose'; hintLayer.innerHTML=''; hintLayer.style.pointerEvents='auto';
      const veil=document.createElement('div'); veil.style.cssText=`position:absolute; inset:0; background:rgba(0,0,0,.06);`; hintLayer.appendChild(veil);
      const vals=[...new Set([...tiles.values()].map(t=>t.val))].sort((a,b)=>a-b);
      const box=document.createElement('div');
      box.style.cssText=`
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        background:var(--surface,#fff); border:1px solid var(--ring); border-radius:12px;
        padding:10px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center; box-shadow:var(--shadow);
      `;
      for(const v of vals){
        const b=document.createElement('button'); b.type='button'; b.textContent=String(v);
        b.style.cssText=`padding:6px 10px; border-radius:999px; border:2px solid var(--ring); font-weight:800; cursor:pointer;`;
        b.onclick=()=> doDeleteValue(v);
        box.appendChild(b);
      }
      const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel';
      cancel.style.cssText=`padding:6px 10px; border-radius:999px; border:2px solid var(--ring); font-weight:800; cursor:pointer;`;
      cancel.onclick=()=> cancelTransientModes();
      box.appendChild(cancel);
      hintLayer.appendChild(box);
    }
    function doDeleteValue(val){
      const toRemove=[...tiles.values()].filter(t=>t.val===val);
      if(!toRemove.length){ showToast('None to delete'); return; }
      if(cfg.reduced){
        for(const t of toRemove){ t.el?.remove(); tiles.delete(t.id); if(grid[t.r][t.c]===t.id) grid[t.r][t.c]=0; }
      } else {
        for(const t of toRemove){ t.el.style.transition=`transform ${ms()}ms, opacity ${ms()}ms`; t.el.style.transform+=' scale(0.9)'; t.el.style.opacity='0'; }
        setTimeout(()=>{ for(const t of toRemove){ t.el?.remove(); tiles.delete(t.id); if(grid[t.r][t.c]===t.id) grid[t.r][t.c]=0; } }, ms());
      }
      deleteCredits=Math.max(0,deleteCredits-1);
      refreshPowerUI();
      setNote(`Removed all ${val}s • Best: ${hiscore.get()}`);
      hintLayer.innerHTML=''; hintLayer.style.pointerEvents='none'; uiMode='play';
    }

    // (Hint logic exists but UI removed)

    // Power UI helpers
    function setTicks(el,count){ const lines=[...el.children]; lines.forEach((ln,i)=>{ ln.style.opacity=i<count?'1':'.35'; ln.style.background=i<count?'currentColor':'var(--ring)'; }); }
    function refreshPowerUI(){
      setTicks(undoUI.ticks, Math.min(2, undoLeft));
      setTicks(replUI.ticks, Math.min(2, replaceTwoLeft));
      setTicks(delUI.ticks,  Math.min(2, deleteCredits));
      undoUI.btn.style.opacity = undoLeft>0 ? '1' : '.55';
      replUI.btn.style.opacity = replaceTwoLeft>0 ? '1' : '.55';
      delUI.btn.style.opacity  = deleteCredits>0 ? '1' : '.55';
      const hard = cfg.mode==='hardcore';
      [undoUI.btn,replUI.btn,delUI.btn].forEach(b=>{ b.disabled=hard; b.style.cursor=hard?'not-allowed':'pointer'; b.style.opacity=hard?'.35':b.style.opacity; });
      // Rush big display toggle
      rushBig.style.display = (cfg.mode==='rush') ? 'block' : 'none';
    }

    // Game flow
    function newGame(){
      clearInterval(timerId); timerId=null;
      isAnimating=false; swapInProgress=false; bufferedDir=null; undoStack=[]; nextId=1; uiMode='play';
      score=0; hiscore=makeHiScore(hiKey()); hiscore.set(score);
      maxCelebrated = 0;

      if(cfg.mode==='hardcore'){ undoLeft=0; replaceTwoLeft=0; deleteCredits=0; }
      else { undoLeft=2; replaceTwoLeft=2; deleteCredits=2; }
      hud.setScore(score);

      grid=Array.from({length:cfg.board},()=>Array(cfg.board).fill(0));
      tiles.clear(); tileLayer.innerHTML=''; hintLayer.innerHTML=''; hintLayer.style.pointerEvents='none';
      buildGridBg(); spawnRandom(); spawnRandom(); layoutAll();

      // Rush timer UI
      root.classList.remove('g2048-panic','g2048-shake');
      if(cfg.mode==='rush'){
        timeLeft=TUNE.RUSH_SECONDS; hud.setTime(timeLeft*1000);
        updateRushBig();
        timerId=setInterval(()=>{
          timeLeft=Math.max(0,timeLeft-1);
          hud.setTime(timeLeft*1000);
          updateRushBig();
          if(timeLeft===0){
            clearInterval(timerId); timerId=null;
            root.classList.remove('g2048-panic','g2048-shake');
            setNote(`⏱ Rush over! Best: ${hiscore.get()}`);
          }
        },1000);
      } else {
        hud.setTime(0);
      }

      setNote(modeNote()); refreshPowerUI();
      // ensure confetti canvas sized
      confSys.resize();
    }
    function updateRushBig(){
      rushBig.textContent = String(timeLeft);
      if(timeLeft<=5 && timeLeft>0){
        root.classList.add('g2048-panic','g2048-shake');
        rushBig.style.color = 'red';
      } else {
        root.classList.remove('g2048-panic','g2048-shake');
        rushBig.style.color = '';
      }
    }
    function modeNote(){
      if(cfg.mode==='classic') return `Use arrows / swipe • Best: ${hiscore.get()}`;
      if(cfg.mode==='rush')    return `RUSH: 60s • Merge big tiles to gain time • Best: ${hiscore.get()}`;
      if(cfg.mode==='hardcore')return `HARDCORE: 30% 4-spawns, no powers • Best: ${hiscore.get()}`;
      return `Use arrows / swipe • Best: ${hiscore.get()}`;
    }

    // Inputs
    function onKey(e){
      if(uiMode==='delete-choose' && e.key==='Escape'){ e.preventDefault(); cancelTransientModes(); return; }
      if(uiMode==='replace-picking' && e.key==='Escape'){ e.preventDefault(); cancelTransientModes(); return; }

      const k=e.key;
      if(k==='ArrowLeft'||k==='a'||k==='A'||k==='h'||k==='H'){ e.preventDefault(); doMove(0); }
      else if(k==='ArrowUp'||k==='w'||k==='W'||k==='k'||k==='K'){ e.preventDefault(); doMove(1); }
      else if(k==='ArrowRight'||k==='d'||k==='D'||k==='l'||k==='L'){ e.preventDefault(); doMove(2); }
      else if(k==='ArrowDown'||k==='s'||k==='S'||k==='j'||k==='J'){ e.preventDefault(); doMove(3); }
      else if(k==='u'||k==='U'){ e.preventDefault(); if(cfg.mode!=='hardcore') doUndo(); }
      else if(k==='r'||k==='R'||k==='n'||k==='N'){ e.preventDefault(); newGame(); }
    }
    let sx=0,sy=0,tid=null;
    function onTouchStart(e){ const t=e.changedTouches?.[0]; if(!t) return; sx=t.clientX; sy=t.clientY; tid=t.identifier; }
    function onTouchEnd(e){
      const t=[...e.changedTouches].find(tt=>tt.identifier===tid) || e.changedTouches?.[0]; if(!t) return;
      const dx=t.clientX-sx, dy=t.clientY-sy; if(Math.max(Math.abs(dx),Math.abs(dy))<TUNE.SWIPE_MIN) return;
      if(Math.abs(dx)>Math.abs(dy)) doMove(dx<0?0:2); else doMove(dy<0?1:3); tid=null;
    }

    // Event hooks
    newBtn.onclick = ()=> newGame();
    testBtn.onclick = ()=> testFill();
    undoUI.btn.onclick = ()=> { if(cfg.mode!=='hardcore') doUndo(); };
    replUI.btn.onclick = ()=> { if(cfg.mode!=='hardcore') startReplaceTwo(); };
    delUI.btn.onclick  = ()=> { if(cfg.mode!=='hardcore') startDeleteByNumber(); };
    sizeSel.onchange = ()=>{ cfg.board=clamp(parseInt(sizeSel.value,10)||4,3,6); newGame(); };
    modeSel.onchange = ()=>{ cfg.mode = modeSel.value; newGame(); };
    tileLayer.addEventListener('click', onTileClick);

    // Resize
    const onResize = ()=> { layoutAll(); };
    // A11y
    function colRow(c,r){ const cols='ABCDEFGH'; return `${cols[c]||c+1}-${r+1}`; }

    // Start
    newGame();
    window.addEventListener('keydown', onKey);
    root.addEventListener('touchstart', onTouchStart, {passive:true});
    root.addEventListener('touchend', onTouchEnd, {passive:true});
    window.addEventListener('resize', onResize);

    // --- Test Fill (half board with 1024s, rest empty)
    function testFill(){
      pushUndo();
      const S=cfg.board, total=S*S, half=total>>1;
      // clear
      tiles.forEach(t=>t.el?.remove()); tiles.clear();
      for(let r=0;r<S;r++) for(let c=0;c<S;c++) grid[r][c]=0;

      // choose half cells at random
      const cells=[]; for(let r=0;r<S;r++) for(let c=0;c<S;c++) cells.push([r,c]);
      for(let i=cells.length-1;i>0;i--){ const j=(rng.next()* (i+1))|0; const tmp=cells[i]; cells[i]=cells[j]; cells[j]=tmp; }

      for(let i=0;i<half;i++){
        const [r,c]=cells[i];
        const t={id:nextId++, val:1024, r, c, el:null};
        tiles.set(t.id,t); grid[r][c]=t.id; makeTileEl(t);
      }
      layoutAll();
      maxCelebrated=Math.max(maxCelebrated,1024);
      fireConfettiCentered(); // visible confirmation
      setNote('Filled half with 1024s for testing');
    }

    function cancelTransientModes(){
      uiMode='play'; hintLayer.innerHTML=''; hintLayer.style.pointerEvents='none';
      tileLayer.style.cursor=''; tileLayer.style.outline=''; pickBuffer.length=0;
    }

    return {
      dispose(){
        window.removeEventListener('keydown', onKey);
        root.removeEventListener('touchstart', onTouchStart);
        root.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('resize', onResize);
        if(timerId) clearInterval(timerId);
        root.remove();
      }
    };
  }
};
