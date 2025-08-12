import { makeHUD, load, save, fitCanvas, makeConfetti } from '../kit/gamekit.js';

export default {
  id:'slide15',
  title:'15-Puzzle++',
  category:'puzzle',
  icon:'🔲',
  tags:['sliding','image','autosolve','daily'],
  launch(api){
    // ---------------- Settings (persisted) ----------------
    let cfg = {
      size: 4,
      speed: 200,                 // ms per tile
      theme: 'numbers',           // default to numbers (never blank)
      showGrid: true,
      highContrast: false,
      highlightMoves: true,
      daily: false,
      showNumbersOnImage: true,
    };
    cfg = { ...cfg, ...(load('slide15','settings',{})||{}) };

    // ---------------- State ----------------
    const hud = makeHUD(api,{score:true,lives:false,time:true});
    let N = cfg.size;
    let board = [];
    let startTime = 0;
    let moves = 0;
    let animBusy = false;

    // run meta
    let hintCount = 0;
    let usedAuto  = false;
    let timerId   = 0;

    // autosolve
    let autoPlaying = false;
    let cancelToken = {cancel:false};

    // anti-backtrack
    let lastHash = null;
    let prevHashGlobal = null;

    // tiles & UI
    const tilesMap = new Map();
    let undoStack = [];

    // image assets
    let rawImageSrc = load('slide15','imageSrc', null);
    let spriteImageSrc = load('slide15','spriteSrc', null);

    // Planner parameters
    const IDA_NODE_BUDGET = 700000;
    const IDA_START_MARGIN = 0;
    const MAX_AUTOSTEPS_GUARD = 25000;

    const BEAM = { width: 18, depth: 16 };
    function beamParams(N, h) {
      if (N <= 4) {
        return { width: h <= 16 ? 24 : 28, depth: h <= 16 ? 18 : 20 };
      }
      if (h <= 24) return { width: 36, depth: 22 };
      if (h <= 36) return { width: 42, depth: 24 };
      return { width: 48, depth: 26 };
    }

    const PDB_SETS_4x4 = [[1,2,3],[4,5,6],[7,8,9]];
    let PDBS = null;
    const PDB_KEY = (set)=>`slide15_pdb_N${N}_${set.join('_')}`;

    let ZOBRIST = makeZobrist(N);
    function rebuildZobrist(){ ZOBRIST = makeZobrist(N); }

    const TABU_LEN = 20;
    const tabu = [];

    // ---------------- UI ----------------
    const root = document.createElement('div');
    root.style.width = 'min(92vw, 560px)';
    root.style.margin = '16px auto';
    root.style.display = 'grid';
    root.style.gap = '10px';

    // Toolbar
    const toolbar = document.createElement('div');
    Object.assign(toolbar.style,{display:'flex', gap:'8px', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap'});
    const left = document.createElement('div'); Object.assign(left.style,{display:'flex', gap:'8px', flexWrap:'wrap'});
    const right = document.createElement('div'); Object.assign(right.style,{display:'flex', gap:'8px'});
    toolbar.append(left, right);
    root.appendChild(toolbar);

    const btnRestart = pill('↻ Restart', ()=>restart());
    const btnUndo    = pill('⟲ Undo', ()=>undo(), 'ghost');
    const btnHint    = pill('💡 Hint', ()=>hintPulse(), 'ghost');
    const btnAuto    = pill('🤖 Auto', ()=>toggleAuto(), 'ghost');
    left.append(btnRestart, btnUndo, btnHint, btnAuto);

    const btnImage   = pill('🖼️ Image…', ()=>chooseImage(), 'ghost');
    const btnGear    = pill('⚙️', ()=>openSettings(), 'ghost'); btnGear.title='Settings';
    right.append(btnImage, btnGear);

    // Board wrapper
    const wrap = document.createElement('div');
    Object.assign(wrap.style,{
      position:'relative', background:'var(--card)', border:'1px solid var(--ring)',
      borderRadius:'12px', padding:'10px', boxShadow:'var(--shadow)', overflow:'hidden'
    });

    // Grid (tiles)
    const grid = document.createElement('div');
    Object.assign(grid.style,{position:'relative', userSelect:'none', touchAction:'manipulation'});
    wrap.appendChild(grid);

    // Overlays anchored to the grid
    const ghost = document.createElement('canvas'); ghost.style.position='absolute'; ghost.style.pointerEvents='none'; ghost.style.zIndex='5';
    const confettiCv = document.createElement('canvas'); confettiCv.style.position='absolute'; confettiCv.style.pointerEvents='none'; confettiCv.style.zIndex='6';
    wrap.appendChild(ghost); wrap.appendChild(confettiCv);

    // Confetti engine (shared, smooth, longer fade)
    let confetti = null;
    let ghostCtx = null;

    root.appendChild(wrap);
    api.mount.appendChild(root);

    // Settings sheet INSIDE wrap (clean, modern)
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style,{
      position:'absolute', inset:'0', background:'rgba(0,0,0,.25)', zIndex:'30',
      display:'none', backdropFilter:'blur(6px)'
    });
    const drawer = document.createElement('div');
    Object.assign(drawer.style,{
      position:'absolute', top:'0', right:'0', width:'320px', maxWidth:'92vw', height:'100%', zIndex:'31',
      background:'linear-gradient(180deg, rgba(18,23,35,.96), rgba(18,23,35,.92))',
      borderLeft:'1px solid var(--ring)',
      boxShadow:'-16px 0 30px rgba(0,0,0,.28)',
      padding:'16px 14px', transform:'translateX(110%)', transition:'transform .28s cubic-bezier(.2,.8,.2,1)', overflow:'auto'
    });
    drawer.innerHTML = `
      <div class="sheet-header">
        <div class="sheet-title">Settings</div>
        <button class="ghost" id="xClose" aria-label="Close">✕</button>
      </div>`;
    const controls = document.createElement('div'); controls.className='sheet-controls'; drawer.appendChild(controls);
    wrap.appendChild(backdrop); wrap.appendChild(drawer);
    drawer.querySelector('#xClose').addEventListener('click', closeSettings);
    backdrop.addEventListener('click', closeSettings);
    window.addEventListener('keydown', e=>{ if(e.key==='Escape') closeSettings(); });

    // Visual language
    const style = document.createElement('style');
    style.textContent = `
      .tile { will-change: transform; }
      .tile--movable { filter: drop-shadow(0 4px 18px rgba(124,226,196,.25)); }
      .tile.pulse { box-shadow: 0 0 0 2px rgba(124,226,196,.9), 0 0 0 8px rgba(124,226,196,.18); }
      .tile__label { background: linear-gradient(180deg, rgba(0,0,0,.5), rgba(0,0,0,.35));
                     border-radius: 10px; padding: 4px 9px; color: #fff; font-weight: 800;
                     text-shadow: 0 1px 2px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.75);
                     -webkit-text-stroke: 1px rgba(0,0,0,.45); }
      .pill.active-cancel { background: #cf2b2b; color: #fff; }

      /* Modern settings sheet */
      .sheet-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
      .sheet-title { font-weight:800; letter-spacing:.2px; }
      .sheet-controls { display:flex; flex-direction:column; gap:12px; }
      .set-row { display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:center; background:rgba(255,255,255,.02);
                 border:1px solid var(--ring); padding:10px 12px; border-radius:10px; }
      .set-help { opacity:.7; font-size:.85em; margin-top:2px; }

      /* Switch */
      .switch { appearance:none; width:46px; height:26px; border-radius:999px;
                background: #2a3244; position:relative; transition:.2s ease; outline:none; border:1px solid var(--ring); }
      .switch::after { content:''; position:absolute; width:20px; height:20px; top:2.5px; left:2.5px; border-radius:50%;
                       background:#fff; transition:.2s ease; box-shadow:0 2px 6px rgba(0,0,0,.25); }
      .switch:checked { background:#7ce2c4; border-color:transparent; }
      .switch:checked::after { transform: translateX(20px); }

      /* Slider */
      .slider { -webkit-appearance:none; appearance:none; height:6px; border-radius:999px; background: #2a3244; outline:none; width:180px; }
      .slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:18px; height:18px; border-radius:50%;
                                      background:#fff; border:1px solid rgba(0,0,0,.15); box-shadow:0 2px 6px rgba(0,0,0,.25); }
      .slider::-moz-range-thumb { width:18px; height:18px; border-radius:50%; background:#fff; border:1px solid rgba(0,0,0,.15); }
      .valchip { font-size:.85em; padding:2px 8px; border:1px solid var(--ring); border-radius:999px; opacity:.9; }

      /* Select */
      .select { appearance:none; background:#121723; color:#dfe6f3; border:1px solid var(--ring); border-radius:8px; padding:6px 10px; }
    `;
    document.head.appendChild(style);

    // Build settings UI (cleaner)
    buildControls();

    // ---------------- Helpers: controls ----------------
    function pill(label, onClick, cls='pill'){ const b=document.createElement('button'); b.className=cls; b.textContent=label; b.addEventListener('click', onClick); return b; }
    function row(label, help=''){
      const r=document.createElement('div'); r.className='set-row';
      const left=document.createElement('div');
      const title=document.createElement('div'); title.textContent=label; title.style.fontWeight='700';
      left.appendChild(title);
      if (help){ const h=document.createElement('div'); h.className='set-help'; h.textContent=help; left.appendChild(h); }
      r.appendChild(left);
      return {r,left};
    }
    function ctlRange(label,key,min,max,step,val,help=''){
      const {r} = row(label, help);
      const wrap=document.createElement('div'); wrap.style.display='flex'; wrap.style.gap='8px'; wrap.style.alignItems='center';
      const out=document.createElement('span'); out.className='valchip'; out.textContent=String(val);
      const inp=document.createElement('input'); inp.className='slider'; Object.assign(inp,{type:'range',min,max,step,value:val});
      inp.addEventListener('input',()=> out.textContent=inp.value);
      inp.addEventListener('change',()=> applySettings({[key]:Number(inp.value)}));
      wrap.append(inp,out); r.append(wrap); return r;
    }
    function ctlSelect(label,key,opts,val,help=''){
      const {r}=row(label, help); const sel=document.createElement('select'); sel.className='select';
      opts.forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; sel.appendChild(o); });
      sel.value = String(val);
      sel.addEventListener('change',()=> applySettings({[key]: (key==='size'? Number(sel.value): sel.value)}));
      r.append(sel); return r;
    }
    function ctlToggle(label,key,val,help=''){
      const {r}=row(label, help); const inp=document.createElement('input'); inp.type='checkbox'; inp.className='switch'; inp.checked=!!val;
      inp.addEventListener('change',()=> applySettings({[key]:inp.checked}));
      r.append(inp); return r;
    }
    function buildControls(){
      controls.innerHTML='';
      controls.append(
        ctlSelect('Board Size','size',[[3,'3×3'],[4,'4×4'],[5,'5×5'],[6,'6×6']], cfg.size, 'Bigger boards are harder.'),
        ctlRange('Anim speed (ms per tile)','speed',80,450,10,cfg.speed,'Lower is faster'),
        ctlSelect('Theme','theme',[['numbers','Numbers'],['image','Image']], cfg.theme, 'Switch between numbers or image tiles.'),
        ctlToggle('Numbers overlay (image)','showNumbersOnImage', cfg.showNumbersOnImage),
        ctlToggle('Highlight movable tiles','highlightMoves', cfg.highlightMoves),
        ctlToggle('Show grid','showGrid', cfg.showGrid),
        ctlToggle('High contrast numbers','highContrast', cfg.highContrast),
        ctlToggle('Daily challenge (seeded)','daily', cfg.daily),
      );
      btnImage.style.display = (cfg.theme==='image') ? '' : 'none';
    }
    function openSettings(){ backdrop.style.display='block'; requestAnimationFrame(()=> drawer.style.transform='translateX(0)'); }
    function closeSettings(){ drawer.style.transform='translateX(110%)'; setTimeout(()=> (backdrop.style.display='none'), 220); }

    // ---------------- Layout / overlays anchoring ----------------
    function positionOverlays(){
      const left = grid.offsetLeft, top = grid.offsetTop, w = grid.clientWidth, h = grid.clientHeight;
      [ghost, confettiCv].forEach(cv=>{
        cv.style.left = left+'px'; cv.style.top = top+'px';
        cv.style.width = w+'px'; cv.style.height = h+'px';
      });
      ghostCtx = fitCanvas(ghost, w, h);
      if (!confetti) confetti = makeConfetti(confettiCv, { duration: 6, linger: 0.4, count: 240 });
      confetti.resize();
    }
    function layout(){
      const size = Math.min(520, window.innerWidth - 48);
      grid.style.width = grid.style.height = `${size}px`;
      grid.style.margin='0 auto';
      placeTiles(); // reflow only
      positionOverlays();
      drawGhost(null);
    }
    window.addEventListener('resize', layout);

    // ---------------- Board helpers ----------------
    function solved(){ return board.every((v,i)=> i===N*N-1 ? v===0 : v===i+1); }
    function cellOfIndex(i){ return { r: (i/N|0), c: i%N }; }
    function indexOfRC(r,c){ return r*N + c; }
    function indexOfVal(state, v){ return state.indexOf(v); }

    // ---------------- Tile rendering ----------------
    function placeTiles(){
      tilesMap.clear();
      grid.innerHTML='';
      const cell = grid.clientWidth / N;
      grid.style.setProperty('--cell', `${cell}px`);
      grid.style.border = cfg.showGrid ? '1px solid var(--ring)' : 'none';
      grid.style.borderRadius='10px';

      for(let idx=0; idx<board.length; idx++){
        const val = board[idx];
        if (val===0) continue;

        const tile = document.createElement('div');
        tilesMap.set(val, tile);
        tile.className='tile';
        tile.tabIndex=0;
        Object.assign(tile.style,{
          position:'absolute', width:`${cell-6}px`, height:`${cell-6}px`,
          left:'3px', top:'3px', borderRadius:'10px', display:'grid', placeItems:'center',
          fontWeight:'800', cursor:'pointer',
          transition: `transform ${cfg.speed}ms cubic-bezier(.2,.8,.2,1)`,
          boxShadow:'0 8px 20px rgba(0,0,0,.22)', border:'1px solid var(--ring)'
        });

        // face (never blank)
        if (cfg.theme==='numbers' || !spriteImageSrc){
          tile.style.background='linear-gradient(180deg,#171d2a,#121723)';
          tile.style.color = cfg.highContrast? '#fff' : '#dfe6f3';
          tile.textContent = String(val);
        } else {
          tile.style.backgroundColor = '#0f1320';
          tile.style.backgroundSize = `${N*100}% ${N*100}%`;
          tile.style.backgroundPosition = bgPos(val-1);
          tile.style.backgroundImage = `url(${spriteImageSrc})`;
          tile.textContent = '';
          if (cfg.showNumbersOnImage) {
            const label=document.createElement('div'); label.className='tile__label'; label.textContent=String(val);
            tile.appendChild(label);
          }
        }

        tile.addEventListener('click', ()=> userClick(val));
        tile.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' ') userClick(val); });
        tile.addEventListener('mouseenter', ()=> drawGhost(val));
        tile.addEventListener('mouseleave', ()=> drawGhost(null));

        grid.appendChild(tile);
      }
      updateTransforms(0);
      positionOverlays();
    }

    function updateTransforms(staggerMs){
      const cell = grid.clientWidth / N;
      const movable = movableIndices();
      for (let i=0;i<board.length;i++){
        const val = board[i]; if (val===0) continue;
        const {r,c} = cellOfIndex(i);
        const el = tilesMap.get(val);
        const x = Math.round(c*cell), y = Math.round(r*cell);
        el.style.transform = `translate(${x}px, ${y}px)`;

        if (cfg.highlightMoves && movable.has(i)) el.classList.add('tile--movable');
        else el.classList.remove('tile--movable');

        if (staggerMs) el.style.transitionDelay = `${staggerMs}ms`;
        else el.style.removeProperty('transition-delay');
      }
    }

    function movableIndices(){
      const set = new Set();
      const z = board.indexOf(0);
      const zr=(z/N|0), zc=z%N;
      for(let c=0;c<N;c++){ const i=indexOfRC(zr,c); if (board[i]!==0) set.add(i); }
      for(let r=0;r<N;r++){ const i=indexOfRC(r,zc); if (board[i]!==0) set.add(i); }
      return set;
    }

    // ---------------- Ghost preview ----------------
    function drawGhost(val){
      const ctx = ghostCtx || ghost.getContext('2d'); const w=ghost.clientWidth, h=ghost.clientHeight;
      ctx.clearRect(0,0,w,h);
      if (val==null) return;
      const i = board.indexOf(val), z = board.indexOf(0);
      const ir=(i/N|0), ic=i%N, zr=(z/N|0), zc=z%N;
      if (ir!==zr && ic!==zc) return;
      const cell = w/N;
      ctx.save();
      const grd = ctx.createLinearGradient(0,0,w,h); grd.addColorStop(0,'rgba(124,226,196,.10)'); grd.addColorStop(1,'rgba(124,226,196,.14)');
      ctx.fillStyle=grd;
      ctx.strokeStyle='rgba(124,226,196,.25)'; ctx.lineWidth=2;
      if (ir===zr){
        const minC=Math.min(ic,zc), maxC=Math.max(ic,zc);
        const x=minC*cell, y=ir*cell, ww=(maxC-minC+1)*cell, hh=cell;
        ctx.fillRect(x, y, ww, hh);
        ctx.strokeRect(x+1, y+1, ww-2, hh-2);
      } else {
        const minR=Math.min(ir,zr), maxR=Math.max(ir,zr);
        const x=ic*cell, y=minR*cell, ww=cell, hh=(maxR-minR+1)*cell;
        ctx.fillRect(x, y, ww, hh);
        ctx.strokeRect(x+1, y+1, ww-2, hh-2);
      }
      ctx.restore();
    }

    // ---------------- Interaction separation ----------------
    function userClick(val){
      stopAutoIfNeeded(true);
      onTileClick(val);
    }

    function onTileClick(val){
      if(animBusy) return;
      const i = board.indexOf(val), z = board.indexOf(0);
      if (i<0) return;
      const ir=(i/N|0), ic=i%N, zr=(z/N|0), zc=z%N;
      if (ir!==zr && ic!==zc) return;

      // path from clicked to blank
      const path = [];
      if (ir===zr){ const dir=Math.sign(zc-ic); for(let c=ic; c!==zc; c+=dir) path.push(indexOfRC(ir,c)); }
      else { const dir=Math.sign(zr-ir); for(let r=ir; r!==zr; r+=dir) path.push(indexOfRC(r,ic)); }
      if (!path.length) return;

      undoStack.push(board.slice()); if (undoStack.length>50) undoStack.shift();
      animBusy = true; moves++; hud.setScore(moves);

      const curHash = lastHash;

      // shift toward blank
      const zi = board.indexOf(0);
      for (let k=path.length-1; k>=0; k--){
        const from = path[k];
        const to = (k===path.length-1) ? zi : path[k+1];
        board[to] = board[from];
      }
      board[path[0]] = 0;

      updateTransforms(8);
      setTimeout(()=>{
        animBusy=false;
        updateTransforms(0);
        drawGhost(null);
        persistRun();

        prevHashGlobal = curHash;
        lastHash = zob(board);

        const h = lastHash;
        tabu.push(h); if (tabu.length>TABU_LEN) tabu.shift();
        checkSolved();
      }, cfg.speed + Math.max(80, path.length*12));
    }

    // Keyboard / Touch
    window.addEventListener('keydown', (e)=>{
      if(animBusy) return;
      if(e.ctrlKey && e.key.toLowerCase()==='z'){ stopAutoIfNeeded(true); undo(); return; }
      const z=board.indexOf(0), zr=(z/N|0), zc=z%N; let target=null;
      if(e.key==='ArrowLeft' && zc<N-1) target=indexOfRC(zr, zc+1);
      if(e.key==='ArrowRight' && zc>0)  target=indexOfRC(zr, zc-1);
      if(e.key==='ArrowUp' && zr<N-1)   target=indexOfRC(zr+1, zc);
      if(e.key==='ArrowDown' && zr>0)   target=indexOfRC(zr-1, zc);
      if(target!=null){ userClick(board[target]); }
    });

    let touchStart=null;
    grid.addEventListener('touchstart', e=>{ const t=e.touches[0]; touchStart={x:t.clientX,y:t.clientY}; }, {passive:true});
    grid.addEventListener('touchend', e=>{
      if(!touchStart || animBusy) return;
      const t=e.changedTouches[0]; const dx=t.clientX-touchStart.x, dy=t.clientY-touchStart.y;
      const ax=Math.abs(dx), ay=Math.abs(dy); const z=board.indexOf(0), zr=(z/N|0), zc=z%N; let target=null;
      if(ax>ay){ target = dx<0 ? (zc<N-1? indexOfRC(zr, zc+1):null) : (zc>0? indexOfRC(zr, zc-1):null); }
      else { target = dy<0 ? (zr<N-1? indexOfRC(zr+1, zc):null) : (zr>0? indexOfRC(zr-1, zc):null); }
      if(target!=null){ userClick(board[target]); }
      touchStart=null;
    }, {passive:true});

    // ---------------- Confetti & bests ----------------
    function checkSolved(){
      if(!solved()) return;
      if (timerId){ clearInterval(timerId); timerId = 0; }
      const elapsed = performance.now()-startTime;
      hud.setTime(elapsed);

      // save bests only if no auto and <=3 hints
      const qualifies = (!usedAuto && hintCount <= 3);
      const tKey = `bestTime_${N}`;
      const mKey = `bestMoves_${N}`;
      const bestT = load('slide15', tKey, null);
      const bestM = load('slide15', mKey, null);
      if (qualifies){
        if (bestT===null || elapsed < bestT) save('slide15', tKey, elapsed);
        if (bestM===null || moves < bestM)   save('slide15', mKey, moves);
      }

      const badge = qualifies ? '✅ clean run' : `⚠️ ${usedAuto?'auto used':'manual'} • hints:${hintCount}`;
      api.setNote(`Solved! ⏱ ${(elapsed/1000).toFixed(1)}s • ${moves} moves • ${badge}`);

      // Smooth, longer, lighter confetti (from board center)
      const from = (()=> {
        const r = grid.getBoundingClientRect();
        const p = wrap.getBoundingClientRect();
        return { x: (r.width)/2, y: (r.height)*0.35 };
      })();
      confetti.play({ count: 260, from, duration: 6.5, linger: 0.42 });

      stopAutoIfNeeded(true);
      persistRun();
    }

    // ---------------- Undo / Image ----------------
    function undo(){
      stopAutoIfNeeded(true);
      if(animBusy || undoStack.length===0) return;
      const curHash = lastHash;
      board = undoStack.pop();
      moves = Math.max(0, moves-1);
      hud.setScore(moves);
      updateTransforms(0);
      drawGhost(null);
      prevHashGlobal = curHash;
      lastHash = zob(board);
      persistRun();
    }

    function chooseImage(){
      const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
      inp.addEventListener('change', async ()=>{
        const f=inp.files?.[0]; if(!f) return;
        const r=new FileReader();
        r.onload = async ()=>{
          rawImageSrc = r.result; save('slide15','imageSrc', rawImageSrc);
          spriteImageSrc = await makeSquareSprite(rawImageSrc, 1024);
          save('slide15','spriteSrc', spriteImageSrc);
          placeTiles();
        };
        r.readAsDataURL(f);
      });
      inp.click();
    }

    async function makeSquareSprite(src, size){
      return new Promise((resolve)=>{
        const img = new Image(); img.onload=()=>{
          const cv=document.createElement('canvas'); cv.width=cv.height=size; const g=cv.getContext('2d');
          const ir = img.width/img.height;
          let dw=size, dh=size, dx=0, dy=0;
          if(ir>1){ dh=size; dw=img.width*(dh/img.height); dx=(size-dw)/2; dy=0; }
          else { dw=size; dh=img.height*(dw/img.width); dx=0; dy=(size-dh)/2; }
          g.fillStyle='#111'; g.fillRect(0,0,size,size);
          g.drawImage(img, dx,dy,dw,dh);
          resolve(cv.toDataURL('image/png'));
        }; img.src=src;
      });
    }

    function bgPos(goalIndex){
      const r=(goalIndex/N|0), c=goalIndex%N;
      const x = (c/(N-1))*100;
      const y = (r/(N-1))*100;
      return `${x}% ${y}%`;
    }

    // ---------------- Shuffle / persistence ----------------
    function seedFromDate() {
      const d = new Date();
      const s = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}-${N}`;
      let h=1779033703 ^ s.length;
      for (let i=0;i<s.length;i++){ h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h<<13) | (h>>>19); }
      return ()=>{ h = Math.imul(h ^ (h>>>16), 2246822507); h = Math.imul(h ^ (h>>>13), 3266489909); return (h ^= h>>>16) >>> 0; };
    }
    function randInt(max, rng=Math.random){ return Math.floor(rng()*max); }
    function shuffleSolvable(seedMode){
      board = [...Array(N*N).keys()].map(i => (i+1)%(N*N));
      const steps = 80 + N*80;
      const rng = seedMode ? (()=>{ const r=seedFromDate(); return ()=> r()/4294967296; })() : Math.random;
      let z = board.indexOf(0);
      for(let s=0;s<steps;s++){
        const zr=(z/N|0), zc=z%N;
        const opts=[];
        if(zr>0) opts.push(z-N); if(zr<N-1) opts.push(z+N); if(zc>0) opts.push(z-1); if(zc<N-1) opts.push(z+1);
        const t = opts[randInt(opts.length, rng)];
        [board[z], board[t]] = [board[t], board[z]];
        z = t;
      }
      if (solved()) shuffleSolvable(seedMode);
    }

    function persistRun(){
      save('slide15','run', { N, board, moves, startTime, rawImageSrc, spriteImageSrc, cfg, hintCount, usedAuto });
    }

    function loadRunIfAny(){
      const data = load('slide15','run', null);
      if(!data) return false;
      N = data.N;
      rebuildZobrist();
      PDBS = null;
      board = data.board; moves = data.moves; startTime = data.startTime || performance.now();
      rawImageSrc = data.rawImageSrc ?? rawImageSrc; spriteImageSrc = data.spriteImageSrc ?? spriteImageSrc; cfg = {...cfg, ...(data.cfg||{})};
      hintCount = data.hintCount ?? 0;
      usedAuto  = data.usedAuto ?? false;
      lastHash = zob(board);
      prevHashGlobal = null;
      return true;
    }

    // ---------------- Settings application ----------------
    function applySettings(delta){
      const before = {...cfg}; cfg = {...cfg, ...delta}; save('slide15','settings', cfg); buildControls();
      const sizeChanged = before.size !== cfg.size;

      if (before.speed !== cfg.speed){
        grid.querySelectorAll('.tile').forEach(t=> t.style.transition = `transform ${cfg.speed}ms cubic-bezier(.2,.8,.2,1)`);
      }
      if (before.theme !== cfg.theme || before.showNumbersOnImage !== cfg.showNumbersOnImage || before.highContrast !== cfg.highContrast){
        placeTiles();
      } else if (before.highlightMoves !== cfg.highlightMoves || before.showGrid !== cfg.showGrid){
        updateTransforms(0);
      }

      if (sizeChanged){
        N = cfg.size;
        rebuildZobrist();
        PDBS = null;
        tabu.length = 0;

        layout();
        shuffleSolvable(cfg.daily);
        moves = 0; hud.setScore(0); startTime = performance.now();
        hintCount = 0; usedAuto = false;
        placeTiles();
        updateTransforms(0);
        lastHash = zob(board);
        prevHashGlobal = null;
      }
      persistRun();
    }

    // ---------------- Hint (robust; mirrors Auto's next move) ----------------
    let hintCooldown = false, lastHintVal = null;

    async function hintPulse(){
      if (animBusy || hintCooldown) return;
      hintCooldown = true; setTimeout(()=> hintCooldown=false, 350);

      await ensureHeuristicsReady();

      let chosenVal = null;
      try {
        const token = { cancel:false };
        const plan = await bestPlan(board, { preferExact:true, token });
        chosenVal = plan?.firstMove ?? null;
      } catch (e){
        api.setNote(`Hint error: ${String(e?.message||e)}`);
      }

      if (chosenVal == null) chosenVal = greedyBestMoveVal(board);
      if (chosenVal == null) {
        const moves = neighbors(board);
        if (moves.length) chosenVal = board[moves[0]];
      }

      if (chosenVal != null){
        const idx = indexOfVal(board, chosenVal);
        const s2  = simulateSlide(board, idx);
        if (zob(s2) === prevHashGlobal){
          const alt = secondBestMoveVal(board, chosenVal);
          if (alt != null) chosenVal = alt;
        }
      }

      if (lastHintVal != null && chosenVal === lastHintVal) {
        const alt = secondBestMoveVal(board, chosenVal);
        if (alt != null) chosenVal = alt;
      }
      lastHintVal = chosenVal;

      if (chosenVal != null){
        hintCount++; persistRun();
        api.setNote(`Hint: click tile ${chosenVal} • hints used: ${hintCount}`);
        highlightVal(chosenVal, 700);
      } else {
        api.setNote('No hint available (maybe already solved?)');
      }
    }

    // ---------------- Auto-solve ----------------
    async function toggleAuto(){
      if (autoPlaying){ stopAutoIfNeeded(true); return; }
      autoPlaying = true; cancelToken = {cancel:false};
      usedAuto = true; persistRun();
      btnAuto.textContent = '■ Cancel'; btnAuto.classList.add('active-cancel');

      try {
        await ensureHeuristicsReady();

        const globalSeen = new Set([zob(board)]);
        let lastImprovementH = heuristic(board);
        let stagnation = 0;

        tabu.length = 0; tabu.push(zob(board));

        let steps=0;
        while(autoPlaying && !cancelToken.cancel && !solved() && steps<MAX_AUTOSTEPS_GUARD){
          const winMove = winningNeighborVal(board);
          if (winMove != null){
            await playMoveVal(winMove);
            steps++;
            if (solved()) break;
            continue;
          }

          let plan = await bestPlan(board, {preferExact:true, token: cancelToken});
          if (cancelToken.cancel) break;

          const curH = heuristic(board);
          if (curH < lastImprovementH) { lastImprovementH = curH; stagnation = 0; }
          else stagnation++;
          if (stagnation >= 6 && plan) { plan._boostNext = true; stagnation = 0; }

          let pathVals = plan?.path;
          if (!pathVals || !pathVals.length){
            let val = greedyBestMoveVal(board);
            if (val==null) break;
            let nextState = simulateSlide(board, indexOfVal(board, val));
            if (zob(nextState)===prevHashGlobal) {
              const alt = secondBestMoveVal(board, val);
              if (alt!=null){ val = alt; nextState = simulateSlide(board, indexOfVal(board, val)); }
            }
            await playMoveVal(val);
            const hsh = zob(board);
            if (globalSeen.has(hsh)) stagnation = Math.max(stagnation, 6);
            else globalSeen.add(hsh);
            steps++;
            continue;
          }

          for (const val of pathVals){
            if(cancelToken.cancel) break;
            const idx = indexOfVal(board, val);
            const s2  = simulateSlide(board, idx);
            if (zob(s2) === prevHashGlobal){
              const alt = secondBestMoveVal(board, val);
              if (alt!=null){
                await playMoveVal(alt);
              } else {
                await playMoveVal(val);
              }
            } else {
              await playMoveVal(val);
            }
            const hsh = zob(board);
            if (globalSeen.has(hsh)) stagnation = Math.max(stagnation, 6);
            else globalSeen.add(hsh);
            steps++;
            if (solved()) break;
          }
        }
      } catch(e){
        api.setNote(`Auto error: ${String(e?.message || e)}`);
      }

      autoPlaying = false;
      btnAuto.textContent = '🤖 Auto'; btnAuto.classList.remove('active-cancel');
    }
    function stopAutoIfNeeded(force=true){
      if (!autoPlaying) return;
      if (!force) return;
      cancelToken.cancel=true; autoPlaying=false;
      btnAuto.textContent='🤖 Auto'; btnAuto.classList.remove('active-cancel');
    }

    function playMoveVal(val){
      return new Promise(res=>{
        const startMoves = moves;
        const go = ()=>{
          if(animBusy){ requestAnimationFrame(go); return; }
          const curHash = lastHash;
          onTileClick(val);
          const wait = ()=>{
            if (animBusy || moves===startMoves){ requestAnimationFrame(wait); }
            else {
              prevHashGlobal = curHash;
              lastHash = zob(board);
              tabu.push(lastHash); if (tabu.length>TABU_LEN) tabu.shift();
              res();
            }
          };
          wait();
        };
        go();
      });
    }

    // ---------------- Heuristic (Base + PDB + WD + edge penalty) ----------------
    function h_base(state){
      let manhattan = 0;
      for (let idx=0; idx<state.length; idx++){
        const val = state[idx]; if (!val) continue;
        const row = (idx / N) | 0, col = idx % N;
        const goal = val - 1;
        const grow = (goal / N) | 0, gcol = goal % N;
        manhattan += Math.abs(row - grow) + Math.abs(col - gcol);
      }

      let linear = 0;
      for (let row=0; row<N; row++){
        for (let c1=0; c1<N; c1++){
          const i1 = indexOfRC(row, c1); const v1 = state[i1]; if (!v1) continue;
          const gRow1 = ((v1 - 1) / N) | 0; if (gRow1 !== row) continue;
          const gCol1 = (v1 - 1) % N;
          for (let c2 = c1 + 1; c2 < N; c2++){
            const i2 = indexOfRC(row, c2); const v2 = state[i2]; if (!v2) continue;
            const gRow2 = ((v2 - 1) / N) | 0; if (gRow2 !== row) continue;
            const gCol2 = (v2 - 1) % N;
            if (gCol1 > gCol2) linear += 2;
          }
        }
      }

      for (let col=0; col<N; col++){
        for (let r1=0; r1<N; r1++){
          const i1 = indexOfRC(r1, col); const v1 = state[i1]; if (!v1) continue;
          const gCol1 = (v1 - 1) % N; if (gCol1 !== col) continue;
          const gRow1 = ((v1 - 1) / N) | 0;
          for (let r2 = r1 + 1; r2 < N; r2++){
            const i2 = indexOfRC(r2, col); const v2 = state[i2]; if (!v2) continue;
            const gCol2 = (v2 - 1) % N; if (gCol2 !== col) continue;
            const gRow2 = ((v2 - 1) / N) | 0;
            if (gRow1 > gRow2) linear += 2;
          }
        }
      }

      let corner = 0;
      const corners = [
        {val:1,                     goalR:0,    goalC:0,    edge:'right', blocker:2},
        {val:N,                     goalR:0,    goalC:N-1,  edge:'down',  blocker:N*2},
        {val:N*(N-1)+1,            goalR:N-1,  goalC:0,    edge:'up',    blocker:N*(N-2)+1},
        {val:N*N-1,                goalR:N-1,  goalC:N-1,  edge:'left',  blocker:N*N-2},
      ];
      for (const k of corners){
        const pos = state.indexOf(k.val); if (pos < 0) continue;
        const row = (pos / N) | 0, col = pos % N;
        if (k.edge === 'right' && row === k.goalR && col !== k.goalC){
          const b = state.indexOf(k.blocker);
          if (((b / N) | 0) === row && (b % N) < col) corner += 2;
        }
        if (k.edge === 'down' && col === k.goalC && row !== k.goalR){
          const b = state.indexOf(k.blocker);
          if ((b % N) === col && ((b / N) | 0) < row) corner += 2;
        }
        if (k.edge === 'left' && row === k.goalR && col !== k.goalC){
          const b = state.indexOf(k.blocker);
          if (((b / N) | 0) === row && (b % N) > col) corner += 2;
        }
        if (k.edge === 'up' && col === k.goalC && row !== k.goalR){
          const b = state.indexOf(k.blocker);
          if ((b % N) === col && ((b / N) | 0) > row) corner += 2;
        }
      }

      let stuck = 0;
      for (let row=0; row<N; row++){
        const i1 = indexOfRC(row, N-2), i2 = indexOfRC(row, N-1);
        const v1 = state[i1], v2 = state[i2];
        if (!v1 || !v2) continue;
        const g1 = v1 - 1, g2 = v2 - 1;
        if (((g1 / N) | 0) === row && ((g2 / N) | 0) === row && g1 % N === N-1 && g2 % N === N-2) stuck += 2;
      }
      for (let col=0; col<N; col++){
        const i1 = indexOfRC(N-2, col), i2 = indexOfRC(N-1, col);
        const v1 = state[i1], v2 = state[i2];
        if (!v1 || !v2) continue;
        const g1 = v1 - 1, g2 = v2 - 1;
        if (g1 % N === col && g2 % N === col && ((g1 / N) | 0) === N-1 && ((g2 / N) | 0) === N-2) stuck += 2;
      }

      let edgePenalty = 0;
      for (let idx=0; idx<state.length; idx++){
        const v = state[idx]; if (!v) continue;
        const r = (idx/N|0), c = idx%N;
        const gr = ((v-1)/N|0), gc = (v-1)%N;
        const isGoalEdge = (gr===0 || gr===N-1 || gc===0 || gc===N-1);
        const isOppEdge  = (r===0 && gr===N-1) || (r===N-1 && gr===0) || (c===0 && gc===N-1) || (c===N-1 && gc===0);
        if (isGoalEdge && isOppEdge) edgePenalty += 1;
      }

      return manhattan + linear + corner + stuck + edgePenalty;
    }

    function h_walkingDistance(state){
      const wantRow = new Array(N).fill(0), wantCol = new Array(N).fill(0);
      for(let v=1; v<=N*N-1; v++){
        const gr=(v-1)/N|0, gc=(v-1)%N; wantRow[gr]++; wantCol[gc]++;
      }
      const haveRow = new Array(N).fill(0), haveCol = new Array(N).fill(0);
      for(let i=0;i<state.length;i++){
        const v=state[i]; if(!v) continue;
        const row=(i/N|0), col=i%N;
        const gr = ((v - 1) / N | 0), gc = (v - 1) % N;
        if (row===gr) haveRow[row]++;
        if (col===gc) haveCol[col]++;
      }
      let hr=0,hc=0;
      for(let r=0;r<N;r++) hr += Math.max(0, wantRow[r]-haveRow[r]);
      for(let c=0;c<N;c++) hc += Math.max(0, wantCol[c]-haveCol[c]);
      return Math.max(hr, hc);
    }

    function h_pdbSum(state){
      if (N!==4 || !PDBS) return 0;
      let sum=0;
      for(const set of PDB_SETS_4x4){
        sum += pdbLookup(state, set, PDBS[set.join(',')]);
      }
      return sum;
    }

    function heuristic(state){
      const base = h_base(state);
      const pdb  = h_pdbSum(state);
      const wd   = h_walkingDistance(state);
      return Math.max(base, pdb, wd);
    }

    // ---------------- Neighbor gen & helpers ----------------
    function neighbors(state){
      const out=[];
      const z=state.indexOf(0), zr=(z/N|0), zc=z%N;
      for(let c=0;c<N;c++){ const i=indexOfRC(zr,c); if(state[i]!==0) out.push(i); }
      for(let r=0;r<N;r++){ const i=indexOfRC(r,zc); if(state[i]!==0) out.push(i); }
      return out;
    }
    function isGoalState(s){ for(let i=0;i<s.length-1;i++) if(s[i]!==i+1) return false; return s[s.length-1]===0; }

    function simulateSlide(state,i){
      const s=state.slice(); const z=s.indexOf(0);
      const ir=(i/N|0), ic=i%N, zr=(z/N|0), zc=z%N;
      if (ir===zr){
        if (ic<zc){ for(let c=zc; c>ic; c--) s[indexOfRC(zr,c)] = s[indexOfRC(zr,c-1)]; s[indexOfRC(zr,ic)] = 0; }
        else if (ic>zc){ for(let c=zc; c<ic; c++) s[indexOfRC(zr,c)] = s[indexOfRC(zr,c+1)]; s[indexOfRC(zr,ic)] = 0; }
      } else if (ic===zc){
        if (ir<zr){ for(let r=zr; r>ir; r--) s[indexOfRC(r,zc)] = s[indexOfRC(r-1,zc)]; s[indexOfRC(ir,zc)] = 0; }
        else if (ir>zr){ for(let r=zr; r<ir; r++) s[indexOfRC(r,zc)] = s[indexOfRC(r+1,zc)]; s[indexOfRC(ir,zc)] = 0; }
      }
      return s;
    }

    function highlightVal(val, ms=700){
      let el = tilesMap.get(val);
      if (!el){ placeTiles(); el = tilesMap.get(val); }
      if (el){
        el.classList.add('pulse');
        setTimeout(()=> el.classList.remove('pulse'), Math.min(ms, 1000));
      }
      drawGhost(val);
      setTimeout(()=> drawGhost(null), ms);
    }

    function winningNeighborVal(state){
      const list = neighbors(state);
      for (const i of list){
        const s2 = simulateSlide(state, i);
        if (isGoalState(s2)) return state[i];
      }
      return null;
    }

    function greedyBestMoveVal(state){
      const win = winningNeighborVal(state);
      if (win != null) return win;

      const list = neighbors(state);
      if(!list.length) return null;
      const base=heuristic(state);
      let bestVal=null, bestGain=-Infinity, bestScore=Infinity;
      for(const i of list){
        const s2=simulateSlide(state,i), h2=heuristic(s2), gain=base-h2;
        const v = state[i];
        if (zob(s2) === prevHashGlobal) continue;
        if(gain>bestGain || (gain===bestGain && h2<bestScore)){ bestVal=v; bestGain=gain; bestScore=h2; }
      }
      if (bestVal==null){
        for(const i of list){
          const s2=simulateSlide(state,i), h2=heuristic(s2), gain=base-h2;
          const v = state[i];
          if(gain>bestGain || (gain===bestGain && h2<bestScore)){ bestVal=v; bestGain=gain; bestScore=h2; }
        }
      }
      return bestVal;
    }

    function secondBestMoveVal(state, excludeVal){
      const list = neighbors(state).filter(i=> state[i]!==excludeVal);
      if(!list.length) return null;
      const base=heuristic(state);
      list.sort((a,b)=>{
        const sA = simulateSlide(state,a), sB = simulateSlide(state,b);
        const backA = (zob(sA)===prevHashGlobal) ? 1 : 0;
        const backB = (zob(sB)===prevHashGlobal) ? 1 : 0;
        const gA = base-heuristic(sA), gB = base-heuristic(sB);
        if (backA!==backB) return backA-backB;
        if (gA!==gB) return gB-gA;
        return (heuristic(sA) - heuristic(sB));
      });
      return state[list[0]];
    }

    // ---------------- Endgame / exact search helpers ----------------
    function lockedMask(state){
      const lock = new Array(state.length).fill(false);
      for(let r=0;r<N;r++){
        let ok=true;
        for(let c=0;c<N;c++){
          const i=indexOfRC(r,c);
          if (i===N*N-1){ ok = ok && state[i]===0; }
          else ok = ok && state[i]===i+1;
        }
        if (ok){ for(let c=0;c<N;c++) lock[indexOfRC(r,c)] = true; }
        else break;
      }
      for(let c=0;c<N;c++){
        let ok=true;
        for(let r=0;r<N;r++){
          const i=indexOfRC(r,c);
          if (i===N*N-1){ ok = ok && state[i]===0; }
          else ok = ok && state[i]===i+1;
        }
        if (ok){ for(let r=0;r<N;r++) lock[indexOfRC(r,c)] = true; }
        else break;
      }
      return lock;
    }
    function endgameRegion(lock){
      let minR=N, minC=N, maxR=-1, maxC=-1;
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        const i=indexOfRC(r,c);
        if (!lock[i]){ if(r<minR)minR=r; if(c<minC)minC=c; if(r>maxR)maxR=r; if(c>maxC)maxC=c; }
      }
      if (maxR<minR || maxC<minC) return null;
      const h=maxR-minR+1, w=maxC-minC+1;
      if ((h===2 && w===3) || (h===3 && w===2)) return {r0:minR,c0:minC,h,w};
      return null;
    }
    function regionIndices({r0,c0,h,w}){
      const ids=[]; for(let r=0;r<h;r++) for(let c=0;c<w;c++) ids.push(indexOfRC(r0+r, c0+c)); return ids;
    }

    async function exactEndgameBiBFS(state, token){
      const lock = lockedMask(state);
      const region = endgameRegion(lock);
      if (!region) return null;
      const ids = regionIndices(region);
      const W = region.w, H = region.h;

      const start = ids.map(i=> state[i]);
      const goal  = ids.map(i=> (i===N*N-1?0:(i+1)));
      if (start.join(',')===goal.join(',')) return [];

      const key = arr => arr.join(',');
      let Fmap=new Map([[key(start), null]]), Fq=[start];
      let Bmap=new Map([[key(goal), null]]),  Bq=[goal];
      const moveF=new Map(), moveB=new Map();

      let step=0;
      while(Fq.length && Bq.length){
        if (token?.cancel) return null;
        step++;
        if (Fq.length <= Bq.length){
          const nq=[];
          for(const s of Fq){
            const k=key(s);
            for(const i of smallNeighbors(s,W,H)){
              const val = s[i];
              const ns = simSlideSmall(s,i,W,H);
              const nk = key(ns);
              if (Fmap.has(nk)) continue;
              Fmap.set(nk, k); moveF.set(nk, val);
              if (Bmap.has(nk)) return reconstruct(nk);
              nq.push(ns);
            }
          }
          Fq=nq;
        } else {
          const nq=[];
          for(const s of Bq){
            const k=key(s);
            for(const i of smallNeighbors(s,W,H)){
              const val = s[i];
              const ns = simSlideSmall(s,i,W,H);
              const nk = key(ns);
              if (Bmap.has(nk)) continue;
              Bmap.set(nk, k); moveB.set(nk, val);
              if (Fmap.has(nk)) return reconstruct(nk);
              nq.push(ns);
            }
          }
          Bq=nq;
        }
        if (step%80===0) await new Promise(r=>setTimeout(r,0));
      }
      return null;

      function smallNeighbors(arr,W,H){
        const out=[]; const z=arr.indexOf(0), zr=(z/W|0), zc=z%W;
        for(let c=0;c<W;c++){ const i=zr*W+c; if(arr[i]!==0) out.push(i); }
        for(let r=0;r<H;r++){ const i=r*W+zc; if(arr[i]!==0) out.push(i); }
        return out;
      }
      function simSlideSmall(arr, idx, W, H){
        const out=arr.slice();
        const z=out.indexOf(0), zr=(z/W|0), zc=z%W, ir=(idx/W|0), ic=idx%W;
        if (ir===zr){
          if (ic<zc){ for(let c=zc; c>ic; c--) out[zr*W+c]=out[zr*W+c-1]; out[zr*W+ic]=0; }
          else { for(let c=zc; c<ic; c++) out[zr*W+c]=out[zr*W+c+1]; out[zr*W+ic]=0; }
        } else {
          if (ir<zr){ for(let r=zr; r>ir; r--) out[r*W+zc]=out[(r-1)*W+zc]; out[ir*W+zc]=0; }
          else { for(let r=zr; r<ir; r++) out[r*W+zc]=out[(r+1)*W+zc]; out[ir*W+zc]=0; }
        }
        return out;
      }
      function reconstruct(meetKey){
        const fwdVals=[]; let cur=meetKey;
        while(Fmap.get(cur)!==null){ fwdVals.push(moveF.get(cur)); cur=Fmap.get(cur); }
        fwdVals.reverse();
        cur=meetKey;
        const backVals=[];
        while(Bmap.get(cur)!==null){ backVals.push(moveB.get(cur)); cur=Bmap.get(cur); }
        backVals.reverse();
        return fwdVals.concat(backVals);
      }
    }

    // ---------------- Planner ----------------
    async function bestPlan(state, {preferExact=false, token}={}){
      const eg = await exactEndgameBiBFS(state, token);
      if (eg && eg.length) return { path: eg, firstMove: eg[0] };
      if (eg && eg.length===0) return { path: [], firstMove: null };

      const h = heuristic(state);

      if (N <= 4 && (preferExact || h<=24)){
        const exact = await idaStarFullValues(state, token);
        if (token?.cancel) return null;
        if (exact && exact.length) return { path: exact, firstMove: exact[0] };
      }

      const win = winningNeighborVal(state);
      if (win != null) return { firstMove: win, path: [win] };

      const base = beamParams(N, h);
      const boosted = token && token._boostNext;
      const d = boosted ? base.depth + 4 : base.depth;
      const w = boosted ? base.width + 12 : base.width;

      const firstVal = await planNextMoveVal(state, d, w);
      if (firstVal==null) return null;
      return { firstMove: firstVal, path: [firstVal] };
    }

    async function planNextMoveVal(state, depth=BEAM.depth, width=BEAM.width){
      if (isGoalState(state)) return null;
      const baseH = heuristic(state);
      const startHash = zob(state);
      const z=state.indexOf(0), zr=(z/N|0), zc=z%N;

      const win = winningNeighborVal(state);
      if (win != null) return win;

      let frontier = [];
      const firstMoves=[];
      for(let c=0;c<N;c++){ const i=indexOfRC(zr,c); if(state[i]!==0) firstMoves.push(i); }
      for(let r=0;r<N;r++){ const i=indexOfRC(r,zc); if(state[i]!==0) firstMoves.push(i); }

      const seen = new Set([startHash]);
      const jitter = () => (Math.random() * 0.0001);

      for (const i of firstMoves){
        const s2 = simulateSlide(state, i);
        const h2 = heuristic(s2);
        const hsh= zob(s2);
        if (hsh===prevHashGlobal) continue;
        frontier.push({ s:s2, h:h2, firstVal: state[i], hash:hsh });
      }
      if (!frontier.length){
        for (const i of firstMoves){
          const s2 = simulateSlide(state, i);
          frontier.push({ s:s2, h:heuristic(s2), firstVal: state[i], hash:zob(s2) });
        }
      }
      frontier.sort((a,b)=> (a.h - b.h) || (jitter() - jitter()));
      frontier = frontier.slice(0, Math.max(3,width));

      for (let d=2; d<=depth; d++){
        const next=[];
        for (let n=0; n<frontier.length; n++){
          const node = frontier[n];
          const z2=node.s.indexOf(0), r2=(z2/N|0), c2=z2%N;

          const moves=[];
          for(let c=0;c<N;c++){ const i=indexOfRC(r2,c); if(node.s[i]!==0) moves.push(i); }
          for(let r=0;r<N;r++){ const i=indexOfRC(r, c2); if(node.s[i]!==0) moves.push(i); }

          for (const mv of moves){
            const s3 = simulateSlide(node.s, mv);
            const h3 = heuristic(s3);
            const hsh = zob(s3);
            if (seen.has(hsh)) continue;
            seen.add(hsh);
            next.push({ s:s3, h:h3, firstVal: node.firstVal, hash:hsh });
          }
          if (n % 6 === 0) await new Promise(r=>setTimeout(r,0));
        }
        if (!next.length) break;
        next.sort((a,b)=> (a.h - b.h) || (jitter() - jitter()));
        frontier = next.slice(0, width);
        if (frontier[0].h===0) return frontier[0].firstVal;
      }

      frontier.sort((a,b)=> (a.h - b.h) || (jitter() - jitter()));
      const best = frontier.find(n=> n.h < baseH) || frontier[0] || null;
      return best ? best.firstVal : null;
    }

    async function idaStarFullValues(start, token, budget=IDA_NODE_BUDGET){
      const startH = heuristic(start);
      let bound = startH + IDA_START_MARGIN;
      let nodes=0;

      const bestG = new Map();
      const pathStates = [start];
      const pathVals  = [];

      while(!token?.cancel){
        const t = await search(0, bound, null);
        if (t === true){
          return pathVals.slice();
        }
        if (t === Infinity) return null;
        bound = t;
      }
      return null;

      async function search(g, bound, prevHash){
        const s = pathStates[pathStates.length-1];
        const h = heuristic(s);
        const f = g + h;
        if (f > bound) return f;
        if (isGoalState(s)) return true;

        const hash = zob(s);
        const best = bestG.get(hash);
        if (best!==undefined && best <= g) return Infinity;
        bestG.set(hash, g);

        const nbrs = neighbors(s).map(i=>{
          const ns = simulateSlide(s,i);
          return {i, val:s[i], ns, h:heuristic(ns), hash:zob(ns)};
        }).sort((a,b)=> a.h-b.h);

        let min = Infinity;
        for (const {i, val, ns, hash:nh} of nbrs){
          if (token?.cancel) return Infinity;
          if (prevHash && nh===prevHash) continue;

          nodes++;
          pathStates.push(ns);
          pathVals.push(val);

          const t = await search(g+1, bound, hash);
          if (t === true) return true;
          if (t < min) min = t;

          pathStates.pop();
          pathVals.pop();

          if (nodes % 1500 === 0) await new Promise(r=>setTimeout(r,0));
          if (nodes > budget) return Infinity;
        }
        return min;
      }
    }

    async function ensureHeuristicsReady(){
      if (N!==4) return;
      if (PDBS) return;
      PDBS = {};
      for(const set of PDB_SETS_4x4){
        const key = PDB_KEY(set);
        let raw = load('slide15', key, null);
        if (raw){
          const obj = JSON.parse(raw);
          const mp = new Map(obj.map(([k,v])=>[k,v]));
          PDBS[set.join(',')] = mp;
        } else {
          const mp = await buildTinyPDB(set);
          PDBS[set.join(',')] = mp;
          save('slide15', key, JSON.stringify([...mp.entries()]));
        }
        await new Promise(r=>setTimeout(r,0));
      }
    }

    function pdbLookup(state, tiles, pdbMap){
      if (!pdbMap) return 0;
      const enc = encodePattern(state, tiles);
      return pdbMap.get(enc) ?? 0;
    }

    async function buildTinyPDB(tiles){
      const goalPos = tiles.map(v => v-1);
      const dist = new Map();
      const q = [];

      for(let b=0;b<N*N;b++){
        if (goalPos.includes(b)) continue;
        const key = encTuple(goalPos[0],goalPos[1],goalPos[2],b);
        dist.set(key, 0);
        q.push([goalPos[0],goalPos[1],goalPos[2],b]);
      }

      const DIRS=[-1,1,-N,N];
      let head=0;
      while(head<q.length){
        const [p1,p2,p3,b] = q[head++];
        const d = dist.get(encTuple(p1,p2,p3,b));
        const br=(b/N|0), bc=b%N;
        for(const dv of DIRS){
          let nb = b+dv;
          if (dv===-1 && bc===0) continue;
          if (dv=== 1 && bc===N-1) continue;
          if (dv===-N && br===0) continue;
          if (dv=== N && br===N-1) continue;
          let np1=p1,np2=p2,np3=p3;
          if (nb===p1){ np1=b; }
          else if (nb===p2){ np2=b; }
          else if (nb===p3){ np3=b; }
          const key = encTuple(np1,np2,np3,nb);
          if (!dist.has(key)){
            dist.set(key, d+1);
            q.push([np1,np2,np3,nb]);
          }
        }
        if (head%4000===0) await new Promise(r=>setTimeout(r,0));
      }

      const map = new Map();
      for(const [key, dd] of dist.entries()) map.set(key, dd);
      return map;

      function encTuple(a,b,c,d){ return `${a}|${b}|${c}|${d}`; }
    }

    function encodePattern(state, tiles){
      const p1 = state.indexOf(tiles[0]);
      const p2 = state.indexOf(tiles[1]);
      const p3 = state.indexOf(tiles[2]);
      const b  = state.indexOf(0);
      return `${p1}|${p2}|${p3}|${b}`;
    }

    // ---------------- Zobrist hashing ----------------
    function makeZobrist(N){
      const rng = mulberry32(0xC0FFEE ^ (N<<8));
      const table = [];
      for(let i=0;i<N*N;i++){
        table[i] = [];
        for(let v=0; v<=N*N-1; v++){
          table[i][v] = (rng()*0xFFFFFFFF)>>>0;
        }
      }
      return {table};
      function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t = t + Math.imul(t^t>>>7,61|t) ^ t; return ((t^t>>>14)>>>0)/4294967296; } }
    }
    function zob(state){
      if (!ZOBRIST?.table || ZOBRIST.table.length !== state.length) {
        rebuildZobrist();
      }
      let h=0>>>0;
      for(let i=0;i<state.length;i++){
        const v = state[i] | 0;
        if (v < 0 || v > N*N-1) continue;
        if (!ZOBRIST.table[i] || ZOBRIST.table[i].length <= v) {
          rebuildZobrist();
        }
        h ^= ZOBRIST.table[i][v];
      }
      return h>>>0;
    }

    // ---------------- Start / Restart ----------------
    function announceBest(){
      const bestT = load('slide15', `bestTime_${N}`, null);
      const bestM = load('slide15', `bestMoves_${N}`, null);
      const tag = (bestT||bestM) ? `Best ${N}×${N}: ${bestT? (bestT/1000).toFixed(1)+'s':''}${bestT&&bestM?' • ':''}${bestM? bestM+' moves':''}` : 'Good luck!';
      api.setNote(tag + ` • hints used: ${hintCount}${usedAuto?' • auto':''}`);
    }

    function restart(){
      stopAutoIfNeeded(true);
      shuffleSolvable(cfg.daily);
      moves=0; hud.setScore(0);
      hintCount=0; usedAuto=false;
      startTime=performance.now();
      placeTiles();
      updateTransforms(0);
      drawGhost(null);
      lastHash = zob(board);
      prevHashGlobal = null;
      tabu.length=0; tabu.push(lastHash);
      if (timerId){ clearInterval(timerId); }
      timerId = setInterval(()=> hud.setTime(performance.now()-startTime), 250);
      persistRun();
      announceBest();
    }

    function start(initial){
      requestAnimationFrame(()=>{
        if (timerId){ clearInterval(timerId); timerId=0; }

        if (initial && loadRunIfAny()){
          // resumed
        } else {
          shuffleSolvable(cfg.daily);
          moves = 0;
          hintCount = 0;
          usedAuto = false;
          hud.setScore(0);
          startTime = performance.now();
        }

        layout();
        placeTiles();
        updateTransforms(0);
        drawGhost(null);
        lastHash = zob(board);
        prevHashGlobal = null;
        persistRun();

        timerId = setInterval(()=> hud.setTime(performance.now()-startTime), 250);
        announceBest();
      });
    }

    // ---------------- Go ----------------
    start(true);

    return {
      pause(){},
      resume(){},
      dispose(){
        window.removeEventListener('resize', layout);
        if (timerId){ clearInterval(timerId); }
        style.remove();
      }
    };
  }
};

// -------------- end --------------
