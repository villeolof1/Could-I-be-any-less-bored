// coach-script.js — Tutorial Orchestrator (Coach v9, non-destructive)
// This file *never* touches puzzle generation directly.
// It only guides the player and uses the real UI (New/Hint/Undo/Redo/Music/etc).
//
// Public: CoachTutorial.launch({ mount?: HTMLElement })
//
(function(){
  const wait = (ms)=> new Promise(r=> setTimeout(r, ms));
  const randInt = (a,b)=> (a + Math.floor(Math.random()*(b-a+1)));

  // ----------------------------- CORE SHIMS -------------------------------------
  function ensureSelectionLockShims(stage){
    if (stage.lockSelectionToCell && stage.unlockSelectionLock) return;
    let lock = null;
    function blockNav(e){
      if(!lock) return;
      const k = e.key;
      if (k.startsWith('Arrow') || k==='Home' || k==='End' || k==='PageUp' || k==='PageDown'){
        e.stopPropagation(); e.preventDefault();
      }
    }
    function blockCellClick(e){
      if(!lock) return;
      const cell = e.target.closest?.('.sd-cell'); if(!cell) return;
      const r=+cell.dataset.r, c=+cell.dataset.c;
      if (r===lock.r && c===lock.c) return;
      e.stopPropagation(); e.preventDefault();
    }
    stage.lockSelectionToCell = (r,c)=>{
      lock = {r,c};
      try{ stage.select({r,c}); }catch{}
      stage.board?.addEventListener('mousedown', blockCellClick, true);
      document.addEventListener('keydown', blockNav, true);
    };
    stage.unlockSelectionLock = ()=>{
      lock = null;
      try{ stage.board?.removeEventListener('mousedown', blockCellClick, true); }catch{}
      document.removeEventListener('keydown', blockNav, true);
    };
  }

  function ensureFxAndUtils(stage){
    if(!stage.wrap.querySelector('style[data-coach-css]')){
      const s = document.createElement('style');
      s.setAttribute('data-coach-css','1');
      s.textContent = `
        .coach-countdown{ position:absolute; right:8px; top:50%; transform:translateY(-50%);
          font-weight:900; font-size: clamp(40px, 13vw, 160px); color:#fff;
          text-shadow:0 2px 10px rgba(0,0,0,.55); pointer-events:none; user-select:none; }
        .coach-countdown.warn{ color:#ffb3b3; }
        .coach-countdown.hot { color:#ff6b6b; }
        .cs-wiggle{ animation:csW 0.9s ease-in-out; }
        @keyframes csW {0%{transform:rotate(0)}20%{transform:rotate(2deg)}40%{transform:rotate(-2deg)}
                        60%{transform:rotate(1.5deg)}80%{transform:rotate(-1.5deg)}100%{transform:rotate(0)}}
        .cs-guide::after{ content:""; position:absolute; inset:0; border-radius:inherit;
          box-shadow:0 0 0 3px var(--yellow,#ffd447) inset, 0 0 14px rgba(255,212,71,.55); pointer-events:none; }
        .cs-ripple{ position:absolute; left:50%; top:50%; width:10px; height:10px; border-radius:50%;
          transform:translate(-50%,-50%) scale(.3); opacity:.9; pointer-events:none;
          box-shadow:0 0 0 2px rgba(255,255,255,.75), inset 0 0 10px rgba(255,255,255,.45);
          animation: csRp .45s ease-out forwards; }
        @keyframes csRp { to{ transform:translate(-50%,-50%) scale(2.1); opacity:0; } }

        /* slime overlay */
        .cs-slime-layer{ position:absolute; left:0; top:0; pointer-events:none; }
        .cs-goo{ filter:url(#cs-goo); }
        .cs-blob{
          position:absolute; width:10px; height:10px; border-radius:18px;
          background:linear-gradient(135deg, rgba(170,215,255,.92), rgba(150,240,210,.92));
          box-shadow:0 3px 14px rgba(0,0,0,.35), inset 0 0 10px rgba(255,255,255,.38);
          will-change: transform, border-radius, opacity;
          transition: transform 650ms cubic-bezier(.2,.8,.2,1), border-radius 520ms ease, opacity 400ms ease;
        }
        .cs-blob.gel{ border-radius:999px; }
      `;
      stage.wrap.appendChild(s);

      // SVG goo once
      if(!document.getElementById('cs-goo-defs')){
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.id = 'cs-goo-defs'; svg.width = 0; svg.height = 0; svg.style.position = 'absolute';
        svg.innerHTML = `
          <defs>
            <filter id="cs-goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
              <feColorMatrix in="blur" mode="matrix"
                values="1 0 0 0 0
                        0 1 0 0 0
                        0 0 1 0 0
                        0 0 0 22 -10" result="goo"/>
              <feBlend in="SourceGraphic" in2="goo"/>
            </filter>
          </defs>`;
        stage.wrap.appendChild(svg);
      }
    }

    if(!stage.wiggle){ stage.wiggle = (ms=900)=>{ stage.wrap.classList.add('cs-wiggle'); setTimeout(()=> stage.wrap.classList.remove('cs-wiggle'), ms); }; }
    if(!stage.setMood){ stage.setMood = ()=>{}; }
    if(!stage.showGuideTarget || !stage.hideGuideTarget){
      let last=null;
      stage.showGuideTarget = (r,c)=>{ stage.hideGuideTarget?.(); const el=stage.board?.querySelector?.(`.sd-cell[data-r="${r}"][data-c="${c}"]`); if(el){ last=el; el.classList.add('cs-guide'); } };
      stage.hideGuideTarget = ()=>{ if(last){ last.classList.remove('cs-guide'); last=null; } };
    }
    if(!stage.rippleAtCell){
      stage.rippleAtCell = (r,c)=>{ const cell=stage.board?.querySelector?.(`.sd-cell[data-r="${r}"][data-c="${c}"]`); if(!cell) return; const d=document.createElement('div'); d.className='cs-ripple'; cell.appendChild(d); setTimeout(()=>d.remove(),500); };
    }
    if(!stage.lockHotelToDigit){ stage.lockHotelToDigit = (d)=>{ stage.hotel?.querySelectorAll?.('.sd-hbtn')?.[d-1]?.click?.(); }; }
    if(!stage.unlockHotelLock){ stage.unlockHotelLock = ()=>{}; }
    if(!stage.setInputInterceptor){ stage.setInputInterceptor = ()=>{}; }
    if(!stage.ensureCoachVisible){ stage.ensureCoachVisible = ()=>{}; }
  }

  function ensureControlsMap(stage){
    if (stage.controlsMap) return;
    const byLabel = (needle)=>{
      const btns = stage.wrap.querySelectorAll('.sd-btn');
      for(const b of btns){
        const t = (b.textContent||'').trim();
        if(t.includes(needle)) return b;
      }
      return null;
    };
    const oneSelect = ()=>{
      const sels = stage.wrap.querySelectorAll('.sd-select');
      for(const s of sels){
        const vals = Array.from(s.querySelectorAll('option')).map(o=>o.value);
        if(vals.includes('classic9') || vals.includes('mini4') || vals.includes('giant16')) return s;
      }
      return null;
    };
    stage.controlsMap = {
      hint: byLabel('Hint'),
      music: byLabel('Music'),
      new: byLabel('New'),
      undo: byLabel('Undo'),
      redo: byLabel('Redo'),
      settings: byLabel('Help'),
      variantSelect: oneSelect()
    };

    if(!stage.setVariant && stage.controlsMap.variantSelect){
      stage.setVariant = (key)=>{
        const sel = stage.controlsMap.variantSelect;
        if(!sel) return;
        if(Array.from(sel.options).some(o=>o.value===key)){
          sel.value = key;
          sel.dispatchEvent(new Event('change',{bubbles:true}));
        }
      };
    }
  }

  // ----------------------------- OBSERVERS --------------------------------------
  const countFilled = (stage)=>{
    const { N, grid } = stage.state || {};
    if(!grid || !Array.isArray(grid)) return 0;
    let n=0; for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]) n++;
    return n;
  };
  const waitForFilledDelta = async (stage, minDelta=1, timeout=2000)=>{
    const start = performance.now();
    const before = countFilled(stage);
    while(performance.now()-start < timeout){
      if(countFilled(stage) >= before + minDelta) return true;
      await wait(40);
    }
    return false;
  };
  const waitForMinFilled = async (stage, minCount, timeout=2500)=>{
    const start = performance.now();
    while(performance.now()-start < timeout){
      if(countFilled(stage) >= minCount) return true;
      await wait(50);
    }
    return false;
  };

  // ------------------------------- UI WAITERS -----------------------------------
  async function waitForButtonClick(stage, key){
    const btn = stage.controlsMap?.[key];
    if(!btn) return;
    await new Promise(res=> btn.addEventListener('click', res, { once:true }));
  }
  async function waitForFHold(minHoldMs=220){
    let downAt=null;
    await new Promise(res=>{
      const onDown = (e)=>{ if(e.key==='f'||e.key==='F'){ if(!downAt) downAt=performance.now(); } };
      const onUp   = (e)=>{ if(e.key==='f'||e.key==='F'){ if(downAt){ const held = performance.now()-downAt; if(held>=minHoldMs){ cleanup(); res(); } downAt=null; } } };
      const cleanup=()=>{ document.removeEventListener('keydown', onDown, true); document.removeEventListener('keyup', onUp, true); };
      document.addEventListener('keydown', onDown, true);
      document.addEventListener('keyup', onUp, true);
    });
  }

  function glideBallToElement(stage, el, durMS=520){
    if(!el) return;
    const ball = stage.wrap.querySelector('.guide-ball'); if(!ball) return;
    const w = stage.wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const tx = (r.left - w.left) + r.width/2;
    const ty = (r.top  - w.top ) + r.height/2;
    const prev = { x: parseFloat(ball.style.left)||tx, y: parseFloat(ball.style.top)||ty };
    const dist = Math.hypot(tx-prev.x, ty-prev.y);
    const dur = Math.min(900, Math.max(220, (durMS) * (dist/220)));
    ball.style.setProperty('--t', dur+'ms');
    ball.style.left = tx+'px';
    ball.style.top  = ty+'px';
  }
  async function guideTo(stage, el, msg){
    if(!el) return;
    glideBallToElement(stage, el, 600);
    await wait(650);
    if(msg) stage.say(msg);
  }

  // ------------------------------ SLIME MOSAIC ----------------------------------
  async function slimeMosaic(stage, targetKey){
    // Anchor to board using offsets (no viewport math → no teleport)
    const board = stage.board, wrap = stage.wrap;
    if(!board || !wrap) return;
    const stageBox = wrap.getBoundingClientRect();
    const bBox     = board.getBoundingClientRect();

    const layer = document.createElement('div');
    layer.className = 'cs-slime-layer';
    layer.style.width  = bBox.width + 'px';
    layer.style.height = bBox.height+ 'px';
    layer.style.left   = (bBox.left - stageBox.left) + 'px';
    layer.style.top    = (bBox.top  - stageBox.top ) + 'px';
    wrap.appendChild(layer);

    const goo = document.createElement('div');
    goo.className = 'cs-goo';
    goo.style.position='absolute';
    goo.style.inset='0';
    layer.appendChild(goo);

    const cells = Array.from(board.querySelectorAll('.sd-cell'));
    if(cells.length===0){ layer.remove(); stage.setVariant?.(targetKey); return; }

    // Build blobs at the same spots; animate via transform only
    const blobs = [];
    const cellRects = cells.map(c=> c.getBoundingClientRect());
    const baseLeft = bBox.left, baseTop = bBox.top;

    cellRects.forEach(r=>{
      const x = (r.left - baseLeft);
      const y = (r.top  - baseTop );
      const w = r.width, h = r.height;

      const b = document.createElement('div');
      b.className='cs-blob';
      b.style.width  = w+'px';
      b.style.height = h+'px';
      b.style.transform = `translate(${x}px, ${y}px) scale(1)`;
      goo.appendChild(b);
      blobs.push(b);
    });

    // Gel-ify
    await nextFrame(); blobs.forEach(b=> b.classList.add('gel'));

    // Micro “merge & split” to sell slime
    const pairs = [];
    for(let i=0;i<Math.min(10, blobs.length>>1); i++){
      const a=blobs[randInt(0, blobs.length-1)], b=blobs[randInt(0, blobs.length-1)];
      if(a!==b) pairs.push([a,b]);
    }
    // move toward midpoint (by transforms only)
    setTimeout(()=>{
      pairs.forEach(([a,b])=>{
        const ax = getTx(a), ay = getTy(a);
        const bx = getTx(b), by = getTy(b);
        const mx = (ax+bx)/2, my=(ay+by)/2;
        a.style.transform = `translate(${mx}px, ${my}px) scale(1.02)`;
        b.style.transform = `translate(${mx}px, ${my}px) scale(1.02)`;
      });
    }, 80);
    // then split slightly
    setTimeout(()=>{
      pairs.forEach(([a,b])=>{
        const ax = getTx(a), ay = getTy(a);
        a.style.transform = `translate(${ax+randInt(-8,8)}px, ${ay+randInt(-8,8)}px) scale(1.00)`;
        const bx = getTx(b), by = getTy(b);
        b.style.transform = `translate(${bx+randInt(-8,8)}px, ${by+randInt(-8,8)}px) scale(1.00)`;
      });
    }, 320);

    // Compute target grid positions (keep cell size; re-center within board)
    const curN = stage.state?.N || Math.sqrt(cells.length)|0 || 9;
    const targetN = (targetKey==='mini4'?4: (targetKey==='giant16'?16:9));
    const need = targetN*targetN;

    // add/fade blobs to match count
    while(blobs.length < need){
      const seed = blobs[randInt(0, blobs.length-1)];
      const clone = seed.cloneNode(true);
      clone.style.opacity='0';
      goo.appendChild(clone); blobs.push(clone);
      setTimeout(()=> clone.style.opacity='1', 20);
    }
    const surplus = blobs.length - need;
    if(surplus>0){
      const off = blobs.splice(need, surplus);
      off.forEach(b=> setTimeout(()=> b.style.opacity='0', 80));
    }

    // Based on *current* cell size, reflow to target grid centered in board
    const w = cells[0].getBoundingClientRect().width;
    const h = cells[0].getBoundingClientRect().height;
    const totalW = targetN * w;
    const totalH = targetN * h;
    const padX = (bBox.width  - totalW)/2;
    const padY = (bBox.height - totalH)/2;

    setTimeout(()=>{
      let i=0;
      for(let r=0;r<targetN;r++){
        for(let c=0;c<targetN;c++){
          const x = Math.round(padX + c*w);
          const y = Math.round(padY + r*h);
          const b = blobs[i++]; if(!b) break;
          b.style.transform = `translate(${x}px, ${y}px) scale(1.00)`;
        }
      }
    }, 520);

    // Finish: switch variant, then remove overlay
    await wait(1250);
    try{ stage.setVariant?.(targetKey); }catch{}
    await wait(350);
    layer.remove();

    function getTx(el){
      const m = el.style.transform.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
      return m ? parseFloat(m[1]) : 0;
    }
    function getTy(el){
      const m = el.style.transform.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
      return m ? parseFloat(m[2]) : 0;
    }
    function nextFrame(){ return new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r))); }
  }

  // ------------------------------ MINI CHALLENGES -------------------------------
  async function arrowChallenge(stage, target, seconds){
    const N = stage.state.N;
    const start = { r:(target.r+Math.max(1,N>>1))%N, c:(target.c+Math.max(2,N>>1))%N };
    stage.select(start);
    stage.showGuideTarget(target.r, target.c);

    stage.say(`Mini challenge! Use your <b>arrow keys</b> to reach the glowing cell before time runs out.`);
    await wait(300);

    const cd = startCountdown(stage, seconds);
    const t0 = performance.now();
    let ok=false;
    while(performance.now()-t0 < seconds*1000){
      const sel = stage.state.sel;
      if(sel && sel.r===target.r && sel.c===target.c){ ok=true; break; }
      await wait(40);
    }
    cd.stop(); stage.hideGuideTarget();
    return ok;
  }
  function startCountdown(stage, seconds){
    const el = document.createElement('div'); el.className='coach-countdown'; el.textContent=String(seconds);
    stage.wrap.appendChild(el);
    let t=seconds;
    const id=setInterval(()=>{
      t--; if(t<=3) el.classList.add('warn'); if(t<=2) el.classList.add('hot');
      el.textContent=String(Math.max(0,t));
      if(t<=0){ clearInterval(id); el.remove(); }
    }, 1000);
    return { stop: ()=>{ clearInterval(id); el.remove(); } };
  }

  // ------------------------------- FLOW HELPERS ---------------------------------
  function farTarget(stage, r, c){
    const N = stage.state.N;
    const opts=[]; const minDist = Math.max(2, N>>1);
    for(let rr=0; rr<N; rr++) for(let cc=0; cc<N; cc++){
      const d = Math.abs(rr-r)+Math.abs(cc-c); if(d>=minDist) opts.push({r:rr,c:cc,d});
    }
    if(!opts.length) return { r:(N-1-r+N)%N, c:(N-1-c+N)%N };
    opts.sort((a,b)=> b.d-a.d);
    return opts[randInt(0, Math.max(0, Math.min(3, opts.length-1)))];
  }

  async function waitForAnyCellClick(stage){
    return new Promise(res=>{
      const on = (e)=>{
        const cell = e.target.closest('.sd-cell'); if(!cell) return;
        const r=+cell.dataset.r, c=+cell.dataset.c;
        stage.select({r,c});
        stage.board.removeEventListener('click', on, true);
        res({r,c});
      };
      stage.board.addEventListener('click', on, true);
    });
  }

  async function requireRightClick(stage, rc, times=1){
    stage.lockSelectionToCell(rc.r, rc.c);
    stage.select(rc);
    stage.showGuideTarget(rc.r, rc.c);
    stage.say(`Try a <b>right-click</b> on the glowing cell.`);
    let got=0;
    while(got<times){
      await new Promise(res=>{
        const once = (e)=>{
          const cell=e.target.closest('.sd-cell'); if(!cell) return;
          const r=+cell.dataset.r, c=+cell.dataset.c;
          if(r===rc.r && c===rc.c){ e.preventDefault(); stage.rippleAtCell(r,c); got++; res(); }
        };
        stage.board.addEventListener('contextmenu', once, { once:true });
      });
    }
    stage.hideGuideTarget(); stage.unlockSelectionLock();
  }

  async function clickNewWithGuard(stage){
    // ask user to click New; then ensure a sensible number of givens
    const minClues = Math.max(8, Math.floor((stage.state.N*stage.state.N) * 0.28)); // ≈28% filled baseline
    await guideTo(stage, stage.controlsMap?.new, `Tap <b>New</b> to generate a fresh puzzle.`);
    await waitForButtonClick(stage, 'new');
    const ok = await waitForMinFilled(stage, minClues, 2400);
    if(!ok){
      // retry once silently if the generator was still initializing
      stage.controlsMap?.new?.click?.();
      await waitForMinFilled(stage, minClues, 2400);
    }
  }

  async function clickHintAndConfirm(stage){
    // ensure hints are enabled; then wait for +1 filled
    stage.setPrefs?.({ help:{ enabled:true, hints:true } });
    const before = countFilled(stage);
    await guideTo(stage, stage.controlsMap?.hint, `Hit <b>Hint</b> — I’ll show a logical fill.`);
    await waitForButtonClick(stage, 'hint');

    // wait for a real change; if not, try one programmatic click
    let ok = await waitForFilledDelta(stage, 1, 1800);
    if(!ok && stage.controlsMap?.hint){
      stage.controlsMap.hint.click();
      ok = await waitForFilledDelta(stage, 1, 1600);
    }
    if(!ok && countFilled(stage)===before){
      stage.say(`(If nothing happened, hints might be blocked in settings — I toggled them on for you.)`);
      stage.setPrefs?.({ help:{ enabled:true, hints:true } });
    }
  }

  async function placeOneThenUndoRedo(stage){
    // Lock a specific empty cell, ask to type any digit, then Undo, then Redo
    const N = stage.state.N;
    let target = null;
    for(let r=0;r<N;r++){ for(let c=0;c<N;c++){ if(stage.state.grid[r][c]===0 && !stage.state.given?.[r]?.[c]){ target={r,c}; break; } } if(target) break; }
    if(!target) return;

    stage.lockSelectionToCell(target.r, target.c);
    stage.select(target);
    stage.showGuideTarget(target.r, target.c);
    stage.say(`Type <b>any digit</b> to place it here.`);

    const before = countFilled(stage);
    await wait(200);
    // wait until the target cell is filled
    await new Promise(res=>{
      const id = setInterval(()=>{
        if(stage.state.grid[target.r][target.c]){ clearInterval(id); res(); }
      }, 60);
    });

    stage.hideGuideTarget();
    stage.unlockSelectionLock();

    // Undo
    await guideTo(stage, stage.controlsMap?.undo, `Now tap <b>Undo</b>.`);
    await waitForButtonClick(stage, 'undo');
    await waitForFilledDelta(stage, -999, 1200); // give it a moment to reduce
    // Redo
    await guideTo(stage, stage.controlsMap?.redo, `And tap <b>Redo</b> to bring it back.`);
    await waitForButtonClick(stage, 'redo');
    // small wait
    await wait(400);
  }

  // ------------------------------- MAIN TUTORIAL --------------------------------
  async function runTutorial(stage){
    ensureSelectionLockShims(stage);
    ensureFxAndUtils(stage);
    ensureControlsMap(stage);

    stage.setPrefs?.({ help:{ enabled:true, hints:true } });
    stage.setVariant?.('mini4');
    stage.ensureCoachVisible?.();

    // Intro
    stage.say(`Welcome! I’m your puzzle coach. Let’s do this hands-on: start by clicking <b>any cell</b>.`);
    const first = await waitForAnyCellClick(stage);

    // First input gated to a single cell
    stage.lockSelectionToCell(first.r, first.c);
    stage.say(`Great! Now type a <b>digit</b> or tap one below.`);
    await new Promise(res=>{
      const id=setInterval(()=>{ if(stage.state.grid[first.r][first.c]){ clearInterval(id); res(); } }, 50);
    });
    stage.unlockSelectionLock();
    stage.rippleAtCell(first.r, first.c);
    await wait(350);

    // Arrow challenge
    const tgt = farTarget(stage, first.r, first.c);
    stage.say(`See the glowing cell? Use the <b>arrow keys</b> to move there.`);
    const ok = await arrowChallenge(stage, tgt, 6);
    stage.say(ok ? `Nice!` : `No worries — you’ll get the feel for it.`);
    await wait(500);

    // Right click demo (pins candidate overlay in your game)
    await requireRightClick(stage, tgt, 1);
    stage.say(`Right-click toggles <b>live candidates</b> for a cell.`);
    await wait(500);

    // Morph boards with *non-destructive* slime
    stage.say(`Watch the board morph — slime time!`);
    await slimeMosaic(stage, 'classic9');
    await wait(180);
    await slimeMosaic(stage, 'giant16');
    await wait(200);
    await slimeMosaic(stage, 'classic9');

    // Generate a proper puzzle using the real "New" flow
    await clickNewWithGuard(stage);
    stage.say(`Fresh puzzle — perfect for practice!`);

    // Peek (press & release F)
    stage.say(`Hold <b>F</b> to peek at the solution, then release.`);
    await waitForFHold(220);
    stage.say(`Heh — use it wisely 😉`);
    await wait(300);

    // Music (real click)
    await guideTo(stage, stage.controlsMap?.music, `Tap <b>Music</b> to add a groove.`);
    await waitForButtonClick(stage, 'music');
    stage.wiggle(700);

    // Hint (guaranteed)
    await clickHintAndConfirm(stage);

    // Undo / Redo
    await placeOneThenUndoRedo(stage);

    // New again — let player observe the rain of digits (game’s own behavior)
    await guideTo(stage, stage.controlsMap?.new, `Hit <b>New</b> any time to reshuffle.`);
    await waitForButtonClick(stage, 'new');
    await wait(1200);

    // Settings
    await guideTo(stage, stage.controlsMap?.settings, `Help & settings live here — and you can replay me anytime.`);

    // Wrap
    stage.say(`That’s the tour! Have fun — I’ll cheer and guide as you play.`);
  }

  // ------------------------------ PUBLIC SURFACE --------------------------------
  const CoachTutorial = {
    async launch({ mount } = {}){
      const stage = window.makeCoachStage({ mount });
      try{
        await runTutorial(stage);
      }catch(err){
        console.error('Tutorial crashed:', err);
        try{ stage.say(`Oops — I tripped over my own animation 🤦. Reload and I’ll behave!`); }catch{}
      }
    }
  };
  window.CoachTutorial = CoachTutorial;
})();
