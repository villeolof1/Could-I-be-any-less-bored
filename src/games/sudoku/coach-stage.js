// coach-stage.js — UI stage for the Sudoku coach overlay (v12)
// Attaches: window.makeCoachStage(options)
//
// v12 highlights
// - Only one morph everywhere: cells → one mega-cell (same look as cells) → “knife split” → settle.
// - All legacy slime/goo/mosaic code removed + force-cleanup of any leftover artifacts.
// - New puzzle animation fixed (CSS + timing) and smoother.
// - Tutorial in fullscreen works; strong locks during onboarding; candidates auto-size; countdown panic shakes screen.
//
// ---------------------------------------------------------------------------

(function () {
  function makeCoachStage(options = {}) {
    // ---------- ROOT ----------
    const overlay = document.createElement('div');
    overlay.className = 'coach-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.alignItems = 'center';
    root.style.width = '100%';
    root.style.margin = '10px auto 18px';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'sd-btn coach-skip-btn';
    skipBtn.textContent = 'Skip tutorial';
    overlay.appendChild(skipBtn);
    let stageApi = null;
    skipBtn.addEventListener('click', ()=>{
      try{ localStorage.setItem('sudoku:tutorial:skip','1'); }catch{}
      try{ stageApi?.destroy(); }catch{}
    });

    const css = document.createElement('style');
    css.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap');

      :root{
        --coachZ: 10100;
        --fg:#e9ecf4; --muted:#a3acc3; --bg:#0f141c;
        --panel:rgba(255,255,255,.03); --ring:#2c3850;
        --accentA:#86b4ff; --accentB:#a5e8ff;
        --peer:rgba(180,200,255,.12); --match:rgba(130,170,255,.18);
        --err:#ff3c3c; --errFill:rgba(255,60,60,.36); --errScope:rgba(255,60,60,.18);
        --celeScope:rgba(70,220,160,.22);
        --rowcol:rgba(180,200,255,.10); --done:#4ad782;
        --errFadeMs: 1600ms; --celeFadeMs: 680ms;
        --stageSize: 680px; --gap: 10px; --yellow:#ffd447;
        --hotZ: 9925;
      }

      .coach-overlay{
        position: fixed; inset: 0; z-index: var(--coachZ);
        display:flex; align-items:center; justify-content:center;
        background: rgba(2,4,8,.62);
        backdrop-filter: blur(4px) saturate(1.05);
      }

      .coach-skip-btn{
        position:absolute; top:12px; right:12px; z-index:calc(var(--coachZ) + 1);
      }

      .panic-flash{ animation: screenFlashRed .18s steps(2) infinite; }
      .shake-hard{ animation: screenShake .14s linear infinite; }
      @keyframes screenFlashRed{
        0%{ box-shadow: inset 0 0 0 0 rgba(255,60,60,0); }
        50%{ box-shadow: inset 0 0 0 9999px rgba(255,60,60,.06); }
        100%{ box-shadow: inset 0 0 0 0 rgba(255,60,60,0); }
      }
      @keyframes screenShake{
        0%{ transform: translate(0,0) }
        25%{ transform: translate(-3px, 2px) }
        50%{ transform: translate(3px,-2px) }
        75%{ transform: translate(-2px,-3px) }
        100%{ transform: translate(0,0) }
      }

      .sd-wrap{ width:100%; color:var(--fg); background:var(--bg); position:relative; padding:10px 10px 14px; border-radius:14px; max-width:100%; box-sizing:border-box; overflow:clip; }
      .sd-wrap *{ -webkit-tap-highlight-color: transparent; }
      .sd-wrap *:focus{ outline:none!important; box-shadow:none!important; }
      .sd-wrap{ --N:9; }

      .sd-topbar{ display:flex; flex-direction:column; gap:8px; align-items:center; justify-content:center; }
      .sd-controls{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:center; max-width:100%; }
      .sd-status{ text-align:center; font-size:12px; color:var(--muted); min-height:16px; }

      .sd-btn{
        display:inline-flex; align-items:center; justify-content:center; gap:6px;
        padding:6px 10px; border-radius:12px; font-size:13px;
        background:rgba(255,255,255,.05); color:var(--fg);
        border:1px solid var(--ring); user-select:none; cursor:pointer;
        transition:transform .06s ease, background .12s ease, border-color .12s ease, opacity .12s ease, filter .12s ease;
      }
      .sd-btn:hover{ background:rgba(255,255,255,.07); }
      .sd-btn:active{ transform:translateY(1px); }
      .sd-btn[disabled]{ opacity:.45; cursor:default; filter:saturate(.7); }

      .sd-progress{ height:6px; width: min(100%, 920px); background:rgba(255,255,255,.06); border:1px solid var(--ring); border-radius:999px; overflow:hidden; }
      .sd-progress-fill{ height:100%; width:0%; background:linear-gradient(90deg, var(--accentA), var(--accentB)); transition:width .2s ease; }
      .sd-progress-fill.done{ background:var(--done); }

      .sd-stage{ width: var(--stageSize); max-width: 100%; margin: 10px auto 0; display:flex; flex-direction:column; gap:var(--gap); align-items:center; justify-content:center; }
      .sd-board{ position:relative; display:grid; gap:2px; width:100%; aspect-ratio:1/1; user-select:none; }
      .sd-board:focus{ outline:none; }
      .sd-rc-line{ position:absolute; background:var(--rowcol); pointer-events:none; z-index:5; border-radius:8px; display:none; }
      .sd-rowline{ left:0; right:0; height:auto; } .sd-colline{ top:0; bottom:0; width:auto; }

      .sd-cell{ position:relative; display:grid; place-items:center; aspect-ratio:1/1;
        border:1px solid var(--ring); border-radius:10px; background:var(--panel);
        font-variant-numeric:tabular-nums;
        transition: background 120ms ease, box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease, translate 120ms ease;
        will-change: background, box-shadow, transform, translate, opacity;
        overflow:hidden;
      }
      .sd-cell:hover{ background:rgba(255,255,255,.05); }
      .sd-num{ font-size: clamp(14px, calc(var(--stageSize) / 20), 34px); line-height:1; opacity:0; transform:translateY(4px) scale(.98); }
      .sd-num.given{ color:#d0e1ff; font-weight:800; letter-spacing:.2px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
      .sd-num.user{ color:#ffffff; font-family: 'Patrick Hand', cursive, ui-sans-serif, system-ui; font-weight:500; letter-spacing:.1px; }
      .sd-num.fade-in{ animation: numIn .34s cubic-bezier(.2,.8,.2,1) forwards; }
      .sd-num.fade-out{ animation: numOut .28s ease forwards; }
      @keyframes numIn { 0%{opacity:0; transform:translateY(6px) scale(.98);} 70%{opacity:1; transform:translateY(-2px) scale(1.03);} 100%{opacity:1; transform:translateY(0) scale(1);} }
      @keyframes numOut{ 0%{opacity:1; transform:translateY(0) scale(1);} 100%{opacity:0; transform:translateY(4px) scale(.98);} }

      .sd-sol{ font-size: clamp(14px, calc(var(--stageSize) / 20), 34px); line-height:1; font-weight:900; color:#ffffff; }

      .sd-cell.selected{ box-shadow:0 0 0 3px var(--ring) inset, 0 0 0 1px rgba(255,255,255,.06); transform:scale(1.04); translate:0 -1px; }
      .sd-cell.match{ background:var(--match)!important; }
      .sd-cell.bT{ border-top-width:4px; } .sd-cell.bL{ border-left-width:4px; }
      .sd-cell.bR{ border-right-width:4px; } .sd-cell.bB{ border-bottom-width:4px; }

      /* Coach avatar */
      .coach-avatar{
        position:absolute; top:0; left:0;
        z-index:var(--hotZ); pointer-events:none;
        transform: translate(16px,16px);
        transition: transform 360ms cubic-bezier(.2,.8,.2,1);
        display:flex; align-items:center; gap:10px;
      }

      .coach-face{
        width:88px; height:88px; border-radius:50%;
        display:grid; place-items:center;
        background:linear-gradient(180deg, #2a344a, #182131);
        box-shadow:0 2px 10px rgba(0,0,0,.35), inset 0 0 0 2px var(--ring);
        pointer-events:auto; position:relative; overflow:visible; transition: filter .14s ease, transform .14s ease;
      }
      .coach-face.panic{ filter: hue-rotate(-40deg) saturate(2) brightness(1.2); animation: coachShake .14s linear infinite; }
      @keyframes coachShake{
        0%{ transform: translate(0,0) rotate(0deg); }
        25%{ transform: translate(-2px, 2px) rotate(-1deg); }
        50%{ transform: translate(2px,-2px) rotate(1deg); }
        75%{ transform: translate(-1px,-1px) rotate(0.8deg); }
        100%{ transform: translate(0,0) rotate(0deg); }
      }

      .face-svg{ width:72px; height:72px; }
      .m-worried .eye{ transform: translateY(2px); }
      .m-angry  .brow{ transform: rotate(-10deg) translateY(-3px); transform-origin: 20px 16px; }
      .m-angry  .brow.r{ transform: rotate(10deg) translateY(-3px); transform-origin: 52px 16px; }
      .m-sweat::after{
        content:''; position:absolute; right:-6px; top:4px; width:12px; height:18px; border-radius:8px 8px 10px 10px;
        background: radial-gradient(ellipse at 50% 30%, #d8f2ff 0%, #9fd9ff 55%, #73c6ff 100%);
        filter: drop-shadow(0 3px 6px rgba(0,0,0,.25));
        animation: sweat 1.1s ease-in-out infinite;
      }
      .m-dizzy{ animation: spinny 1.1s ease-in-out 2 both; }
      .sick{ filter: hue-rotate(90deg) saturate(1.4); }
      @keyframes spinny{ 0%{ transform:rotate(0deg);} 50%{ transform:rotate(370deg);} 100%{ transform:rotate(720deg);} }

      .coach-bubble{
        pointer-events:auto;
        max-width:min(560px, 76vw);
        background:rgba(18,24,35,.98);
        border:1px solid var(--ring);
        color:var(--fg);
        padding:12px 14px; border-radius:12px;
        box-shadow:0 8px 24px rgba(0,0,0,.35);
        font-size:15px; line-height:1.35;
      }

      /* Typewriter */
      .tw-ch{ display:inline-block; transform:translateY(0); opacity:0; animation: twIn .38s cubic-bezier(.2,.8,.2,1) forwards; }
      @keyframes twIn { 0%{opacity:0; transform: translateY(5px) scale(.98);} 60%{opacity:1; transform: translateY(-3px) scale(1.02);} 100%{opacity:1; transform: translateY(0) scale(1);} }

      /* Ripple */
      .ripple{
        position:absolute; inset:0; pointer-events:none; z-index:25;
        background: radial-gradient(circle at var(--x) var(--y), rgba(130,200,255,.28), rgba(130,200,255,.12) 26%, rgba(130,200,255,0) 64%);
        opacity:0; transform: scale(.9);
        animation: rippleOut .6s ease forwards;
      }
      @keyframes rippleOut{ 0%{opacity:.0; transform:scale(.9);} 25%{opacity:1;} 100%{opacity:0; transform:scale(1.05);} }

      /* Challenge target */
      .guide-target{
        position:absolute; inset:0; border-radius:12px;
        box-shadow:
          0 0 0 3px rgba(105,224,255,.95) inset,
          0 0 26px rgba(105,224,255,.85),
          0 0 48px rgba(60,160,255,.55),
          0 0 64px rgba(60,160,255,.45);
        pointer-events:none; z-index:40; opacity:0; transform:scale(.92);
        animation: guidePulse 1.2s ease-in-out infinite;
        transition: opacity .26s ease, transform .26s ease, border-radius .5s ease;
      }
      .guide-target.show{ opacity:1; transform:scale(1); }
      @keyframes guidePulse {
        0%{ box-shadow: 0 0 0 2px rgba(105,224,255,.65) inset, 0 0 16px rgba(105,224,255,.65), 0 0 26px rgba(60,160,255,.45), 0 0 34px rgba(60,160,255,.35); }
        50%{ box-shadow: 0 0 0 6px rgba(105,224,255,1) inset, 0 0 36px rgba(105,224,255,.95), 0 0 54px rgba(60,160,255,.55), 0 0 70px rgba(60,160,255,.45); }
        100%{ box-shadow: 0 0 0 2px rgba(105,224,255,.65) inset, 0 0 16px rgba(105,224,255,.65), 0 0 26px rgba(60,160,255,.45), 0 0 34px rgba(60,160,255,.35); }
      }

      /* Countdown */
      .coach-countdown{
        position:absolute; right:8px; top:50%; transform:translateY(-50%);
        font-weight:900; font-size: clamp(40px, 13vw, 160px);
        color:#fff; text-shadow: 0 2px 10px rgba(0,0,0,.55);
        opacity:.95; letter-spacing:-2px; user-select:none; pointer-events:none;
      }
      .coach-countdown.warn{ color:#ffb3b3; }
      .coach-countdown.crazy{ color:#ff6b6b; filter: saturate(1.4); }

      .blink-red{ animation: blinkRed .22s steps(1) 10; }
      .blink-red-strong{ animation: blinkRedStrong .18s steps(1) 16; }
      @keyframes blinkRed { 0%,100%{ box-shadow: 0 0 0 0 rgba(255,80,80,.0) inset; } 50%{ box-shadow: 0 0 0 6px rgba(255,80,80,.18) inset; } }
      @keyframes blinkRedStrong { 0%,100%{ box-shadow: 0 0 0 0 rgba(255,60,60,.0) inset; } 50%{ box-shadow: 0 0 0 10px rgba(255,60,60,.28) inset; } }

      /* Tears */
      .tear-drop{
        position:absolute; width:14px; height:18px;
        background: radial-gradient(ellipse at 50% 30%, #d8f2ff 0%, #bfe6ff 45%, #7acdff 85%);
        border-radius:60% 60% 40% 40%;
        filter: drop-shadow(0 6px 8px rgba(0,0,0,.25));
        pointer-events:none; z-index:41; opacity:.98;
        transform: translate(var(--x0), var(--y0)) scale(var(--s,1));
        animation: tearFall var(--dur,1200ms) cubic-bezier(.2,.9,.2,1) forwards;
      }
      @keyframes tearFall{
        0%  { transform: translate(var(--x0), var(--y0)) scale(var(--s,1)); opacity:.98;}
        85% { opacity:.98; }
        100%{ transform: translate(var(--x1), var(--y1)) scale(calc(var(--s,1)*.98)); opacity:0; }
      }
      .floor-puddle{
        position:absolute; left:8%; right:8%; bottom:4%;
        height:12%; border-radius:40% 40% 18% 18%/ 50% 50% 22% 22%;
        background: radial-gradient(ellipse at 50% 0%, rgba(160,220,255,.55), rgba(90,170,245,.35) 55%, rgba(90,170,245,0) 70%);
        opacity:0; transform: scaleX(.6) translateY(8px);
        transition: opacity .4s ease, transform .4s ease;
        pointer-events:none; z-index:20;
      }
      .floor-puddle.show{ opacity:1; transform: scaleX(1) translateY(0); }

      /* Notes tip */
      .sd-tip{ position:absolute; z-index:50; background:rgba(23,28,38,.98); color:var(--fg); border:1px solid var(--ring); border-radius:12px; padding:10px; box-shadow:0 8px 24px rgba(0,0,0,.35); display:none; }
      .sd-tip.open{ display:block; }
      .sd-tipgrid{ display:grid; grid-template-columns:repeat(3, clamp(26px, calc(var(--stageSize)/18), 34px)); grid-auto-rows:clamp(26px, calc(var(--stageSize)/18), 34px); gap:6px; justify-content:center; align-content:center; align-items:center; justify-items:center; }
      .sd-tipbtn{ width:100%; height:100%; display:grid; place-items:center; border-radius:6px; background:rgba(255,255,255,.06); border:1px solid var(--ring); cursor:pointer; font-size: clamp(12px, calc(var(--stageSize)/30), 16px); font-weight:800; font-variant-numeric:tabular-nums; user-select:none; }
      .sd-tipbtn:hover{ background:rgba(255,255,255,.10); }

      /* Sticky candidates — auto scale */
      .sd-cands{
        position:absolute; inset:2px;
        display:grid; grid-template-columns:repeat(3,1fr); grid-auto-rows:1fr;
        place-items:center; text-align:center;
        font-size: clamp(8px, calc(var(--stageSize) / (var(--N) * 2.6)), 20px);
        line-height:1; color:var(--muted);
        pointer-events:none;
      }
      .sd-cands span{ width:100%; text-align:center; }



      /* Hotel keypad */
      .sd-hotel{ display:grid; grid-template-columns: repeat(auto-fill,minmax(48px,1fr)); gap:6px; width:100%; max-width:560px; }
      .sd-hbtn{ display:grid; grid-template-rows:auto auto; place-items:center; gap:2px; padding:6px 8px; border-radius:10px; border:1px solid var(--ring); background:rgba(255,255,255,.05); color:var(--fg); cursor:pointer; }
      .sd-hbtn:hover{ background:rgba(255,255,255,.08); }
      .sd-hnum{ font-weight:800; }
      .sd-hcnt{ font-size:10px; color:var(--muted); }

      /* Overlays for error/cele */
      .sd-ovl{ position:absolute; inset:0; border-radius:10px; pointer-events:none; }
      .sd-ovl.err-scope.show{ box-shadow: inset 0 0 0 9999px var(--errScope); transition: box-shadow var(--errFadeMs); }
      .sd-ovl.err-peer.show{ box-shadow: inset 0 0 0 9999px var(--errFill); transition: box-shadow var(--errFadeMs); }
      .sd-ovl.err-cell.show{ box-shadow: inset 0 0 0 9999px var(--errFill); transition: box-shadow var(--errFadeMs); }
      .sd-ovl.cele-scope.show{ box-shadow: inset 0 0 0 9999px var(--celeScope); transition: box-shadow var(--celeFadeMs); }

      @media (max-width: 420px) {
        .sd-controls { gap:6px; }
        .sd-btn { padding:5px 8px; font-size:12px; border-radius:10px; }
      }
    `;
    overlay.appendChild(css);

    // ---------- Layout ----------
    const wrap = document.createElement('div'); wrap.className='sd-wrap'; root.appendChild(wrap);

    const topbar = document.createElement('div'); topbar.className='sd-topbar'; wrap.appendChild(topbar);
    const controls = document.createElement('div'); controls.className='sd-controls'; topbar.appendChild(controls);

    const statusEl = document.createElement('div'); statusEl.className='sd-status'; statusEl.setAttribute('aria-live','polite'); topbar.appendChild(statusEl);
    const pbar = document.createElement('div'); pbar.className='sd-progress'; const pfill = document.createElement('div'); pfill.className='sd-progress-fill'; pbar.appendChild(pfill); topbar.appendChild(pbar);

    const stage = document.createElement('div'); stage.className='sd-stage'; wrap.appendChild(stage);

    const board = document.createElement('div'); board.className='sd-board'; board.tabIndex=0; board.setAttribute('role','grid'); board.setAttribute('aria-label','Sudoku board');
    stage.appendChild(board);

    // Right-click sticky cands (disabled in tutorial)
    board.addEventListener('contextmenu', (e)=>{
      e.preventDefault();
      if(locks.board) return;
      if(tutorialStep>0) return;
      const cell = e.target.closest('.sd-cell'); if(!cell) return;
      const r=+cell.dataset.r, c=+cell.dataset.c;
      if(grid[r][c]!==0) return;
      const key = `${r},${c}`;
      if(stickyCands.has(key)) stickyCands.delete(key);
      else stickyCands.set(key, true);
      draw();
      blip(160,.12);
    });

    const rowLine = document.createElement('div'); rowLine.className='sd-rc-line sd-rowline';
    const colLine = document.createElement('div'); colLine.className='sd-rc-line sd-colline';
    board.appendChild(rowLine); board.appendChild(colLine);

    const tip = document.createElement('div'); tip.className='sd-tip';
    const tipGrid = document.createElement('div'); tipGrid.className='sd-tipgrid';
    tip.append(tipGrid); board.appendChild(tip);

    const hotel = document.createElement('div'); hotel.className='sd-hotel'; hotel.addEventListener('contextmenu', e=> e.preventDefault()); stage.appendChild(hotel);

    // ---------- Avatar ----------
    const avatar = document.createElement('div'); avatar.className='coach-avatar';
    const face = document.createElement('div'); face.className='coach-face';
    face.innerHTML = `
      <svg class="face-svg" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="36" cy="36" rx="34" ry="34" fill="url(#g0)"/>
        <defs><radialGradient id="g0" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(20 16) rotate(58) scale(64 60)"><stop stop-color="#44506B"/><stop offset="1" stop-color="#2A344A"/></radialGradient></defs>
        <g class="brow" stroke="#d0e1ff" stroke-width="3" stroke-linecap="round"><path d="M20 20 C26 17, 30 17, 34 20"/><path class="r" d="M38 20 C42 17, 46 17, 52 20"/></g>
        <g class="eye" fill="#d0e1ff"><circle cx="26" cy="30" r="3"/><circle cx="46" cy="30" r="3"/></g>
        <path class="mouth" d="M26 46 C32 52, 40 52, 46 46" stroke="#d0e1ff" stroke-width="3" stroke-linecap="round" fill="none"/>
      </svg>
    `;
    const bubble = document.createElement('div'); bubble.className='coach-bubble';
    avatar.append(face, bubble);
    wrap.appendChild(avatar);

    const puddle = document.createElement('div'); puddle.className='floor-puddle'; wrap.appendChild(puddle);

    overlay.appendChild(root);

    // ---------- Mount / fullscreen ----------
    const mountTo = options.mount || document.body;
    function attachToFullscreenContainerIfAny(){
      const parent = document.fullscreenElement || mountTo;
      if (overlay.parentNode !== parent) parent.appendChild(overlay);
    }
    function ensureMountedSync(){
      attachToFullscreenContainerIfAny();
      sizeStage();
    }
    function open(){
      ensureMountedSync();
      requestAnimationFrame(()=>{
        moveCoachNear(board, 'topLeft');
        clampCoachIntoView();
        board.focus();
        if(options.autostartTutorial !== false){
          onboardingAsk();
        }
      });
    }
    function close(){ overlay.classList.add('smoke-out'); setTimeout(()=> overlay.remove(), 700); }

    // ---------- State ----------
    const hbtns = Object.create(null);
    const controlsMap = {};
    let N = 9, BR=3, BC=3, SYMBOLS = mkSymbols(N);
    let grid = empty(N), given = grid.map(r=>r.map(v=>v!==0)), solution = null;
    let sel = null, hotelDigit = null, showSolutionHold = false;
    const stickyCands = new Map();
    let guideTarget = null;
    let tipOpen = false;

    let tutorialStep = 0;
    let currentTarget = null;
    let currentAnswer = null;


    // ---------- Helpers ----------
    function mkSymbols(n){ const arr=[]; for(let i=1;i<=Math.min(9,n);i++) arr.push(String(i)); for(let v=10; v<=n; v++) arr.push(String.fromCharCode(55+v)); return arr; }
    function valToSym(v){ return SYMBOLS[v-1] || String(v); }
    function symToVal(ch){ const u=(ch||'').toUpperCase(); if(/^[1-9]$/.test(u)) return Number(u); const code=u.charCodeAt(0); if(code>=65 && code<=90) return code-55; return NaN; }
    function DIGITS(){ return Array.from({length:N},(_,i)=>i+1); }
    function clone(g){ return g.map(r=>r.slice()); }
    function empty(n){ return Array.from({length:n},()=>Array(n).fill(0)); }
    function inBox(r,c){ return { br:(r/BR|0)*BR, bc:(c/BC|0)*BC }; }
    function validAt(g,r,c,v){
      for(let i=0;i<N;i++){ if(i!==c && g[r][i]===v) return false; if(i!==r && g[i][c]===v) return false; }
      const {br,bc}=inBox(r,c);
      for(let rr=br; rr<br+BR; rr++) for(let cc=bc; cc<bc+BC; cc++) if((rr!==r||cc!==c)&&g[rr][cc]===v) return false;
      return true;
    }
    function findEmpty(g){ for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(!g[r][c]) return {r,c}; return null; }
    function shuffle(a,rnd){ const arr=a.slice(); for(let i=arr.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
    function mulberry32(a){ return function(){ let t=(a+=0x6d2b79f5); t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
    function genSolved(){
      const rnd = mulberry32(((Date.now()>>>0) ^ ((Math.random()*1e9)|0))>>>0);
      const g = empty(N);
      (function fill(){
        const pos = findEmpty(g); if(!pos) return true;
        for(const v of shuffle(DIGITS(), rnd)){
          if(validAt(g,pos.r,pos.c,v)){ g[pos.r][pos.c]=v; if(fill()) return true; g[pos.r][pos.c]=0; }
        }
        return false;
      })();
      return g;
    }

    function layoutForVariant(){
      board.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
      wrap.style.setProperty('--N', String(N));
    }

    function sizeStage(){
      const vw = Math.max(320, window.innerWidth);
      const vh = Math.max(320, window.innerHeight);
      const wrapStyles = getComputedStyle(wrap);
      const wrapVPad = parseFloat(wrapStyles.paddingTop) + parseFloat(wrapStyles.paddingBottom);
      const topH = topbar.offsetHeight + pbar.offsetHeight + wrapVPad + 24;
      const availableH = Math.max(260, vh - topH);
      const sByHeight = Math.floor(availableH / 1.20);
      const wrapHPad = parseFloat(wrapStyles.paddingLeft) + parseFloat(wrapStyles.paddingRight);
      const availableW = Math.max(240, vw - wrapHPad - 20);
      const sByWidth = Math.floor(availableW);
      const s = Math.max(280, Math.min(sByHeight, sByWidth, 900));
      stage.style.width = s + 'px';
      wrap.style.setProperty('--stageSize', s + 'px');
      clampCoachIntoView();
    }
    const ro = new ResizeObserver(sizeStage); ro.observe(wrap);
    window.addEventListener('resize', sizeStage);
    document.addEventListener('fullscreenchange', ()=>{ attachToFullscreenContainerIfAny(); sizeStage(); });

    function setStatus(msg){ statusEl.textContent = msg||''; }

    // ---------- Controls ----------
    function mkBtn(emoji,label,title,key){
      const b=document.createElement('button'); b.className='sd-btn'; b.type='button'; if(title) b.title=title;
      const i=document.createElement('span'); i.textContent=emoji; const l=document.createElement('span'); l.textContent=label; b.append(i,l);
      if(key){ b.dataset.coachKey = key; controlsMap[key]=b; }
      return b;
    }

    const btnNew       = mkBtn('🎲','New','New random puzzle','new');
    const btnHint      = mkBtn('💡','Hint','Smart hint','hint');
    const btnTutorial  = mkBtn('🎓','Tutorial','Show tutorial','tutorial');
    const btnFullscreen= mkBtn('⛶','Fullscreen','Toggle fullscreen','fs');
    const btnMusic     = mkBtn('🎵','Music','Toggle music','music');
    const btnSettings  = mkBtn('⚙️','Help','Help & tutorial','settings');
    controls.append(btnNew, btnHint, btnTutorial, btnFullscreen, btnMusic, btnSettings);

    let musicOn=false;
    function reflectAudioButtons(){
      btnMusic.style.opacity = musicOn ? '1' : '0.65';
      btnMusic.firstChild.textContent = musicOn ? '🎵' : '🔕';
    }

    function inFullscreen(){ return !!document.fullscreenElement; }
    async function toggleFullscreen(){
      try{
        if(!inFullscreen()){
          const host = options.fullscreenHost || document.documentElement;
          await host.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      }catch{}
    }

    btnMusic.addEventListener('click', ()=>{
      if(locks.toolbar) return;
      musicOn = !musicOn; toggleMusic(musicOn); reflectAudioButtons(); blip(150,.10);
    });
    btnFullscreen.addEventListener('click', ()=>{ if(locks.toolbar) return; toggleFullscreen(); blip(150,.10); });

    btnNew.addEventListener('click', ()=>{
      if(locks.toolbar) return;
      solution = genSolved();
      grid = empty(N); given = grid.map(r=>r.map(()=>false)); sel=null; draw();
      blip(150,.10);
    });

    btnHint.addEventListener('click', ()=>{
      if(locks.toolbar || tutorialStep>0) return;
      doHint(true); blip(225,.12);
    });

    btnTutorial.addEventListener('click', async ()=>{
      if(locks.toolbar) return;
      ensureMountedSync(); // important when already in fullscreen
      await nextFrame();
      onboardingAsk(true);
      blip(200,.12);
    });

    btnSettings.addEventListener('click', ()=>{
      if(locks.toolbar) return;
      say(`<b>Quick tips</b><br/>• Click a cell, then type a number.<br/>• Hold <b>F</b> to peek solution (if allowed).<br/>• Right-click an empty cell to pin tiny notes.`);
    });

    // ---------- Build hotel ----------
    function buildHotel(){
      hotel.innerHTML='';
      for(let idx=1; idx<=N; idx++){
        const b=document.createElement('button'); b.className='sd-hbtn'; b.type='button';
        const num=document.createElement('div'); num.className='sd-hnum'; num.textContent=valToSym(idx);
        const cnt=document.createElement('div'); cnt.className='sd-hcnt'; cnt.textContent=String(N);
        b.append(num,cnt);
        hbtns[idx] = { b, n: idx, cnt };
        b.addEventListener('click', ()=>{
          if (locks.hotel) return;
          if(tutorialStep>0 && !isTargetCell(sel)) { nudgeTarget(); return; }
          if (sel && grid[sel.r][sel.c]===0){
            place(sel.r, sel.c, idx, true);
          } else {
            hotelDigit = (hotelDigit===idx ? null : idx);
            draw();
          }
          waveHotelOnce();
          blip(160,.12);
        });
        hotel.appendChild(b);
      }
      const bClear=document.createElement('button'); bClear.className='sd-hbtn'; bClear.type='button';
      const xnum=document.createElement('div'); xnum.className='sd-hnum'; xnum.textContent='×';
      const xcnt=document.createElement('div'); xcnt.className='sd-hcnt'; xcnt.textContent='clear';
      bClear.append(xnum, xcnt);
      bClear.addEventListener('click', ()=>{ if(locks.hotel) return; if (sel && grid[sel.r][sel.c]!==0) { place(sel.r, sel.c, 0, false); } });
      hbtns.clear = bClear; hotel.appendChild(bClear);
    }

    // ---------- Draw ----------
    function draw(){
      let filled=0; for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]) filled++;
      pfill.style.width = `${Math.round((filled/(N*N))*100)}%`;

      board.innerHTML=''; board.appendChild(rowLine); board.appendChild(colLine); board.appendChild(tip);
      wrap.style.setProperty('--N', String(N));

      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const v = grid[r][c], isGiven = given[r][c];
        const cell = document.createElement('div');
        cell.className = 'sd-cell'; cell.dataset.r = r; cell.dataset.c = c;

        if (r%BR===0) cell.classList.add('bT'); if (c%BC===0) cell.classList.add('bL');
        if (r===N-1) cell.classList.add('bB'); if (c===N-1) cell.classList.add('bR');
        if (sel && sel.r===r && sel.c===c) cell.classList.add('selected');
        if(currentTarget && currentTarget.r===r && currentTarget.c===c) cell.classList.add('is-target');

        if (showSolutionHold && solution) {
          const sol = document.createElement('div');
          sol.className = 'sd-sol';
          sol.textContent = valToSym(solution[r][c]);
          cell.appendChild(sol);
        } else if (v) {
          const d = document.createElement('div');
          d.className = 'sd-num ' + (isGiven ? 'given' : 'user') + ' fade-in';
          d.textContent = valToSym(v);
          cell.appendChild(d);
        }

        const ovl = document.createElement('div');
        ovl.className = 'sd-ovl';
        if(guideTarget && guideTarget.r===r && guideTarget.c===c){ ovl.classList.add('guide-target','show'); }
        cell.appendChild(ovl);

        // sticky candidates
        const key = `${r},${c}`;
        if (!showSolutionHold && v === 0 && stickyCands.has(key)) {
          const live = candidatesFor(r, c);
          const cd = document.createElement('div');
          cd.className = 'sd-cands';
          for (let d = 1; d <= N; d++) {
            const sp = document.createElement('span');
            sp.textContent = live.has(d) ? valToSym(d) : '';
            cd.appendChild(sp);
          }
          cell.appendChild(cd);
        } else if (v !== 0) { stickyCands.delete(key); }

        // clicks
        if (!locks.board) {
          cell.addEventListener('click', () => {
            if(tutorialStep>0){
              const isTarget = isTargetCell({r, c});
              if(!isTarget){ nudgeTarget(); return; }
            }
            sel = { r, c }; board.focus(); draw();
            blip(160, .12);
            if (hotelDigit && grid[r][c] === 0) { place(r, c, hotelDigit, false); }
            moveCoachNear(cell, 'left');
          });
        }

        board.appendChild(cell);
      }

      if(sel){
        const cellEl = board.querySelector(`.sd-cell[data-r="${sel.r}"][data-c="${sel.c}"]`);
        if(cellEl){
          const rect = cellEl.getBoundingClientRect();
          const brect = board.getBoundingClientRect();
          const top = rect.top - brect.top, left = rect.left - brect.left;
          rowLine.style.top = `${top}px`; rowLine.style.height = `${rect.height}px`; rowLine.style.display='block';
          colLine.style.left = `${left}px`; colLine.style.width  = `${rect.width}px`;  colLine.style.display='block';
        }
      } else { rowLine.style.display='none'; colLine.style.display='none'; }
    }

    function ovlAt(r,c){ return board.querySelector(`.sd-cell[data-r="${r}"][data-c="${c}"] .sd-ovl`); }
    function cellEl(r,c){ return board.querySelector(`.sd-cell[data-r="${r}"][data-c="${c}"]`); }

    function isTargetCell(rc){
      if(!rc || tutorialStep===0 || !currentTarget) return true;
      return (rc.r===currentTarget.r && rc.c===currentTarget.c);
    }
    function nudgeTarget(){
      if(!currentTarget) return;
      const el = cellEl(currentTarget.r, currentTarget.c) || board;
      pingBall(el);
      moveCoachNear(el, 'left');
      say(`Try the <b>glowing</b> cell first — super easy!`);
    }

    function place(r,c,n, clearHotel){
      if(n===0){ grid[r][c]=0; draw(); return; }
      if(grid[r][c]!==0) return;

      if(tutorialStep>0){
        if(!isTargetCell({r,c})){ nudgeTarget(); return; }
        if(n!==currentAnswer){
          showWrongOverlay(r,c,n, 1500);
          say(`Not quite. Unique per <b>row</b>, <b>column</b>, and <b>box</b>. Try the other candidate.`);
          blip(120,.08);
          return;
        }
      }

      grid[r][c]=n; draw();
      const key = `${r},${c}`; stickyCands.delete(key);
      const el = cellEl(r,c), ovl = ovlAt(r,c); if(el && ovl){
        ovl.classList.add('cele-scope','show'); setTimeout(()=> ovl.classList.remove('show'), 680); setTimeout(()=> ovl.classList.remove('cele-scope'), 740);
        const numEl = el.querySelector('.sd-num'); if(numEl){ numEl.classList.add('cele'); setTimeout(()=> numEl && numEl.classList.remove('cele'), 600); }
      }
      if(clearHotel) hotelDigit=null;

      if(tutorialStep>0 && currentTarget && r===currentTarget.r && c===currentTarget.c){
        nextTutorialStep();
      }
    }

    // ---------- Notes tip ----------
    function buildTipGrid(){
      tipGrid.innerHTML='';
      const Nloc = N<=9?9:16;
      for(let i=1;i<=Math.min(Nloc,16);i++){
        const b=document.createElement('button'); b.className='sd-tipbtn'; b.textContent=valToSym(i);
        tipGrid.appendChild(b);
      }
    }

    function candidatesFor(r,c){
      if(grid[r][c]) return new Set();
      const s = new Set();
      for(let d=1; d<=N; d++) if(validAt(grid, r, c, d)) s.add(d);
      return s;
    }
    function presentHint(h, apply){
      sel = { r:h.r, c:h.c }; draw();
      if(apply) place(h.r, h.c, h.d, true);
      return h;
    }

    function doHint(apply){
      if(showSolutionHold) return null;
      if(!solution) solution = genSolved();
      const cand = Array.from({length:N},()=>Array.from({length:N},()=>new Set()));
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if(!grid[r][c]) for(let d=1; d<=N; d++) if(validAt(grid,r,c,d)) cand[r][c].add(d);
      }
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if(!grid[r][c] && cand[r][c].size===1){
          const [d] = cand[r][c];
          return presentHint({r,c,d,kind:'naked'}, apply);
        }
      }
      for(let r=0;r<N;r++) for(let d=1; d<=N; d++){
        const places=[]; for(let c=0;c<N;c++) if(!grid[r][c] && cand[r][c].has(d)) places.push({r,c});
        if(places.length===1) return presentHint({...places[0], d, kind:'hidden-row'}, apply);
      }
      for(let c=0;c<N;c++) for(let d=1; d<=N; d++){
        const places=[]; for(let r=0;r<N;r++) if(!grid[r][c] && cand[r][c].has(d)) places.push({r,c});
        if(places.length===1) return presentHint({...places[0], d, kind:'hidden-col'}, apply);
      }
      for(let br0=0;br0<N;br0+=BR){
        for(let bc0=0; bc0<N; bc0+=BC){
          for(let d=1; d<=N; d++){
            const places=[];
            for(let r=br0;r<br0+BR;r++) for(let c=bc0;c<bc0+BC;c++){
              if(!grid[r][c] && cand[r][c].has(d)) places.push({r,c});
            }
            if(places.length===1) return presentHint({...places[0], d, kind:'hidden-box'}, apply);
          }
        }
      }
      return null;
    }

    async function runMorphCombineMegaSlice(toKey){
      doSetVariant(toKey);
      grid = empty(N);
      given = grid.map(r=> r.map(()=>false));
    }

    // ---------- Effects ----------
    function showWrongOverlay(r,c,n, ms=3000){
      const peers = [];
      for(let i=0;i<N;i++){ if(i!==c && grid[r][i]===n) peers.push([r,i]); if(i!==r && grid[i][c]===n) peers.push([i,c]); }
      const box=inBox(r,c);
      for(let rr=box.br; rr<br+BR; rr++) for(let cc=box.bc; cc<box.bc+BC; cc++){
        if(!(rr===r && cc===c) && grid[rr][cc]===n) peers.push([rr,cc]);
      }
      const rowHit = peers.some(([rr])=> rr===r);
      const colHit = peers.some(([,cc])=> cc===c);
      const boxHit = peers.some(([rr,cc])=> rr>=box.br && rr<box.br+BR && cc>=box.bc && cc<box.bc+BC);
      if (rowHit){ for(let i=0;i<N;i++){ ovlAt(r,i)?.classList.add('err-scope','show'); } }
      if (colHit){ for(let i=0;i<N;i++){ ovlAt(i,c)?.classList.add('err-scope','show'); } }
      if (boxHit){ for(let rr=box.br; rr<box.br+BR; rr++) for(let cc=box.bc; cc<box.bc+BC; cc++){ ovlAt(rr,cc)?.classList.add('err-scope','show'); } }
      peers.forEach(([rr,cc])=> ovlAt(rr,cc)?.classList.add('err-peer','show'));
      ovlAt(r,c)?.classList.add('err-cell','show');

      setTimeout(()=>{
        board.querySelectorAll('.sd-ovl.err-scope.show, .sd-ovl.err-peer.show, .sd-ovl.err-cell.show')
             .forEach(el=> el.classList.remove('show'));
        setTimeout(()=>{
          board.querySelectorAll('.sd-ovl.err-scope, .sd-ovl.err-peer, .sd-ovl.err-cell')
               .forEach(el=> el.classList.remove('err-scope','err-peer','err-cell'));
        }, 360);
      }, ms);
    }

    function coachCry({drops=18, spread=20, duration=1200}={}){
      const wrect = wrap.getBoundingClientRect();
      const frect = face.getBoundingClientRect();
      const startX = frect.left - wrect.left + frect.width/2;
      const startY = frect.bottom - wrect.top - 8;
      puddle.classList.add('show');
      for(let i=0;i<drops;i++){
        const d = document.createElement('div'); d.className='tear-drop';
        const dx = (Math.random()*spread - spread/2);
        const endY = wrect.height - 14;
        const dur = duration + Math.random()*400;
        d.style.setProperty('--x0', `${startX}px`);
        d.style.setProperty('--y0', `${startY}px`);
        d.style.setProperty('--x1', `${startX+dx}px`);
        d.style.setProperty('--y1', `${endY}px`);
        d.style.setProperty('--dur', `${dur}ms`);
        d.style.setProperty('--s', `${0.9 + Math.random()*0.3}`);
        wrap.appendChild(d);
        setTimeout(()=> d.remove(), dur+60);
      }
      setTimeout(()=> puddle.classList.remove('show'), Math.max(1800, duration+800));
    }

    // ---------- Audio ----------
    let audioCtx = null, musicOsc = null, musicGain = null;
    function ensureAudio(){
      if(audioCtx) return true;
      try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); return true; }catch{ return false; }
    }
    function blip(freq=200, dur=0.12){
      if(!ensureAudio()) return;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.frequency.value = freq; osc.type='triangle';
      g.gain.value = 0.0001; osc.connect(g); g.connect(audioCtx.destination);
      const now=audioCtx.currentTime;
      g.gain.linearRampToValueAtTime(0.26, now+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now+dur);
      osc.start(); osc.stop(now+dur+0.02);
    }
    function toggleMusic(on){
      if(!ensureAudio()) return;
      if(on){
        if(musicOsc) return;
        musicOsc = audioCtx.createOscillator();
        musicGain = audioCtx.createGain(); musicGain.gain.value=0.0001;
        musicOsc.type='sine'; musicOsc.frequency.value=180;
        const lfo = audioCtx.createOscillator(); const lfoGain = audioCtx.createGain();
        lfo.frequency.value=.25; lfoGain.gain.value=40; lfo.connect(lfoGain); lfoGain.connect(musicOsc.frequency);
        musicOsc.connect(musicGain); musicGain.connect(audioCtx.destination);
        const now=audioCtx.currentTime; musicGain.gain.linearRampToValueAtTime(0.14, now+.2);
        musicOsc.start(); lfo.start();
      }else{
        if(musicGain){ const now=audioCtx.currentTime; musicGain.gain.linearRampToValueAtTime(0.0001, now+.18); }
        if(musicOsc){ setTimeout(()=>{ try{ musicOsc.stop(); }catch{} musicOsc=null; }, 260); }
      }
    }

    // ---------- Countdown ----------
    let cdEl = null; let cdTimer = null;
    function startCountdown(seconds, onTick){
      stopCountdown();
      cdEl = document.createElement('div'); cdEl.className='coach-countdown'; wrap.appendChild(cdEl);
      let t = seconds; cdEl.textContent = String(t);
      const tick = ()=>{
        t--;
        if(t<=3){
          cdEl.classList.add('warn');
          overlay.classList.add('panic-flash','shake-hard');
          face.classList.add('panic');
          wrap.classList.add('blink-red');
        }
        if(t<=2){
          cdEl.classList.add('crazy');
          wrap.classList.add('blink-red-strong');
        }
        cdEl.textContent = String(Math.max(0,t));
        onTick && onTick(t);
        if(t<=0){ stopCountdown(); }
      };
      cdTimer = setInterval(tick, 1000);
    }
    function stopCountdown(){
      if(cdTimer){ clearInterval(cdTimer); cdTimer=null; }
      if(cdEl){ cdEl.remove(); cdEl=null; }
      overlay.classList.remove('panic-flash','shake-hard');
      wrap.classList.remove('blink-red','blink-red-strong');
      face.classList.remove('panic','m-worried');
    }

    // ---------- Locks ----------
    const locks = { toolbar:false, hotel:false, board:false };
    function setLocks(spec){
      locks.toolbar = !!spec?.toolbar;
      locks.hotel   = !!spec?.hotel;
      locks.board   = !!spec?.board;
      controls.querySelectorAll('.sd-btn').forEach(b=> b.disabled = locks.toolbar);
      hotel.querySelectorAll('.sd-hbtn').forEach(b=> b.disabled = locks.hotel);
      board.style.pointerEvents = locks.board ? 'none' : 'auto';
      board.style.filter = locks.board ? 'grayscale(0.25) brightness(0.9)' : '';
      // Keep Tutorial and Fullscreen usable unless explicitly locked:
      controlsMap['tutorial'].disabled = !!spec?.toolbar && !!spec?.lockTutorial;
      controlsMap['fs'].disabled = !!spec?.toolbar && !!spec?.lockFullscreen;
    }

    // ---------- Keyboard ----------
    let inputInterceptor = null;
    function onKeyDown(e){
      if(!overlay.isConnected) return;
      if(typeof inputInterceptor==='function'){
        const consumed = inputInterceptor(e);
        if(consumed) { e.preventDefault(); return; }
      }
      if(e.key==='f' || e.key==='F'){
        if(!showSolutionHold && solution){ showSolutionHold = true; draw(); }
      }else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
        if(locks.board) return;
        if(!sel) sel={r:0,c:0};
        const move=(dr,dc)=>{ const r=(sel.r+dr+N)%N, c=(sel.c+dc+N)%N;
          const rc={r,c};
          if(tutorialStep>0 && !isTargetCell(rc)){ nudgeTarget(); return; }
          sel=rc; draw(); blip(120,.06); moveCoachNear(cellEl(r,c)||board,'left'); };
        if(e.key==='ArrowUp') move(-1,0);
        if(e.key==='ArrowDown') move(1,0);
        if(e.key==='ArrowLeft') move(0,-1);
        if(e.key==='ArrowRight') move(0,1);
        e.preventDefault();
      }else if(!showSolutionHold){
        let n = NaN;
        if (/^[1-9]$/.test(e.key)) n = Number(e.key);
        else n = symToVal(e.key);
        if(Number.isInteger(n) && n>=1 && n<=N){
          if(locks.board) return;
          if(!sel){
            if(tutorialStep>0 && currentTarget){
              sel={r:currentTarget.r, c:currentTarget.c}; draw();
            } else sel={r:0,c:0};
          }
          if(tutorialStep>0 && !isTargetCell(sel)){ nudgeTarget(); e.preventDefault(); return; }
          if(grid[sel.r][sel.c]===0){ place(sel.r, sel.c, n, false); }
          e.preventDefault();
        }
      }
    }
    function onKeyUp(e){
      if(e.key==='f' || e.key==='F'){ if(showSolutionHold){ showSolutionHold=false; draw(); } }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp, { passive:true });

    // ---------- Bubble & typewriter ----------
    function say(html, ctas){
      bubble.innerHTML = html || '';
      wrapTypewriter(bubble);
      const row = document.createElement('div'); row.className='coach-cta';
      (ctas||[]).forEach(btn=> row.appendChild(btn));
      if(ctas && ctas.length) bubble.appendChild(row);
      clampCoachIntoView();
    }
    function segmentGraphemes(text){
      try{
        const seg = new Intl.Segmenter(undefined, {granularity:'grapheme'});
        return [...seg.segment(text)].map(s=> s.segment);
      }catch{ return Array.from(text); }
    }
    function wrapTypewriter(node){
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      const toWrap = [];
      while(walker.nextNode()) toWrap.push(walker.currentNode);
      let idx=0;
      toWrap.forEach(textNode=>{
        const text = textNode.nodeValue;
        const parts = segmentGraphemes(text);
        const frag = document.createDocumentFragment();
        for(const ch of parts){
          if(ch === ' '){ frag.appendChild(document.createTextNode(' ')); continue; }
          const span = document.createElement('span');
          span.className='tw-ch';
          span.style.animationDelay = `${(idx*0.014)}s`;
          span.textContent = ch;
          frag.appendChild(span);
          idx++;
        }
        textNode.replaceWith(frag);
      });
    }

    // ---------- Avatar movement ----------
    function _coachTo(x, y, opts = {}) {
      const w = wrap.getBoundingClientRect();
      let nx = opts.local ? x : (x - w.left);
      let ny = opts.local ? y : (y - w.top);
      const aw = avatar.offsetWidth  || 220;
      const ah = avatar.offsetHeight || 110;
      nx = Math.max(8, Math.min(nx, w.width  - aw - 8));
      ny = Math.max(8, Math.min(ny, w.height - ah - 8));
      avatar.style.transform = `translate(${nx}px, ${ny}px)`;
    }
    function coachTo(x, y, opts){ return _coachTo(x, y, opts); }

    function moveCoachNear(el, where='left'){
      if(!el || !el.getBoundingClientRect) return clampCoachIntoView();
      const r = el.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      let x, y;
      if(where==='left'){ x = r.left - w.left - 86; y = r.top - w.top + 8; }
      else if(where==='right'){ x = r.right - w.left + 12; y = r.top - w.top + 8; }
      else if(where==='top'){ x = r.left - w.left + 8; y = r.top - w.top - 92; }
      else if(where==='bottom'){ x = r.left - w.left + 8; y = r.bottom - w.top + 12; }
      else { x = Math.max(8, r.left - w.left + 8); y = Math.max(8, r.top - w.top + 8); }
      x = Math.max(8, Math.min(x, w.width-240));
      y = Math.max(8, Math.min(y, w.height-110));
      coachTo(x,y,{local:true});
    }
    function clampCoachIntoView(){
      const w = wrap.getBoundingClientRect();
      const cur = avatar.getBoundingClientRect();
      const left = cur.left - w.left, top = cur.top - w.top;
      let x = Math.max(8, Math.min(left, w.width-240));
      let y = Math.max(8, Math.min(top,  w.height-110));
      coachTo(x,y,{local:true});
    }
    function ensureCoachVisible(){ moveCoachNear(board, 'topLeft'); clampCoachIntoView(); }

    let roamTimer = null;
    function startRoam(){
      stopRoam();
      roamTimer = setInterval(()=>{
        const w = wrap.getBoundingClientRect();
        const cur = avatar.getBoundingClientRect();
        let nx = (cur.left - w.left) + (Math.random()*18-9);
        let ny = (cur.top  - w.top ) + (Math.random()*14-7);
        nx = Math.max(6, Math.min(nx, w.width-240));
        ny = Math.max(6, Math.min(ny, w.height-110));
        coachTo(nx, ny, {local:true});
      }, 1600);
    }
    function stopRoam(){ if(roamTimer){ clearInterval(roamTimer); roamTimer=null; } }

    function rippleAtCell(r,c){
      const el = cellEl(r,c); if(!el) return;
      const rip = document.createElement('div'); rip.className='ripple';
      rip.style.setProperty('--x', '50%'); rip.style.setProperty('--y', '50%');
      el.appendChild(rip);
      setTimeout(()=> rip.remove(), 640);
    }
    function showGuideTarget(r,c){ guideTarget = {r,c}; draw(); }
    function hideGuideTarget(){ guideTarget = null; draw(); }
    function waveHotelOnce(){
      const list = hotel.querySelectorAll('.sd-hbtn');
      list.forEach((b,i)=> setTimeout(()=> {
        b.style.transform = 'translateY(-6px) scale(1.04)';
        setTimeout(()=> b.style.transform='', 180);
      }, i*34));
      setTimeout(()=> list.forEach(b=> b.classList.remove('selected')), list.length*34 + 300);
    }

    // ---------- Onboarding ----------
    function onboardingAsk(force){
      if(tutorialStep>0 && !force) return;
      enableTutorialLocks(true);
      say(
        `Do you know how to play <b>Sudoku</b>?`,
        [
          ctaBtn('I’m good 👍', ()=>{ endTutorialLocks(); say(`Great — you can dive right in!`); }),
          ctaBtn('Teach me / refresh', ()=> startOnboardingFlow())
        ]
      );
    }

    async function startOnboardingFlow(){
      enableTutorialLocks(true);
      await runMorphCombineMegaSlice('mini4');
      setStatus('');
      makeMiniRowExercise();
      board.classList.add('dim-except-target');
      draw();
      say(`Rule #1: each <b>row</b> has numbers 1–4 without repeats. Fill the missing one in the highlighted cell.`);
      tutorialStep = 1;
      lockTarget({r:0,c:3}, 4);
    }

    function nextTutorialStep(){
      if(tutorialStep===1){
        hideGuideTarget(); board.classList.remove('dim-except-target');
        runStepB();
      } else if(tutorialStep===2){
        hideGuideTarget();
        runStepC();
      } else if(tutorialStep===3){
        finishOnboarding();
      }
    }

    async function runStepB(){
      await runMorphCombineMegaSlice('mini4');
      makeTrivialSingle4x4();
      draw();
      say(`Core rules: unique in <b>row</b>, <b>column</b>, and <b>box</b>. Try this super-easy one.`);
      tutorialStep = 2;
      lockTarget({r:2,c:3}, 4);
    }

    async function runStepC(){
      await runMorphCombineMegaSlice('classic9');
      makeTrivialSingle9x9();
      draw();
      say(`Same rules at 9×9 (1–9). Fill the glowing cell.`);
      tutorialStep = 3;
      lockTarget({r:4,c:6}, 7);
    }

    function finishOnboarding(){
      tutorialStep = 0;
      currentTarget=null; currentAnswer=null;
      endTutorialLocks();
      say(`Nice! Want a quick <b>deep dive</b> (use hints, new-puzzle, music)?`,
        [
          ctaBtn('Yes, show me', ()=>{ say(`All set! Use 💡 for a smart hint or 🎲 for a fresh puzzle.`); }),
          ctaBtn('Maybe later', ()=>{ say(`You’re good to go — have fun!`); })
        ]
      );
    }

    function ctaBtn(label, onClick){
      const b=document.createElement('button'); b.className='sd-btn'; b.type='button'; b.textContent=label;
      b.addEventListener('click', onClick);
      return b;
    }
    function lockTarget(rc, answer){
      currentTarget = rc||null; currentAnswer = answer||null;
      if(rc){
        sel = {r:rc.r, c:rc.c}; moveCoachNear(cellEl(rc.r,rc.c)||board,'left'); showGuideTarget(rc.r,rc.c);
        draw();
      }
    }

    function enableTutorialLocks(){
      setLocks({ toolbar:true, hotel:true, board:false, lockTutorial:false, lockFullscreen:false });
      controlsMap['hint'].disabled = true;
      controlsMap['new'].disabled = true;
      controlsMap['music'].disabled = true;
    }
    function endTutorialLocks(){
      setLocks({ toolbar:false, hotel:false, board:false });
      controlsMap['hint'].disabled = false;
      controlsMap['new'].disabled = false;
      controlsMap['music'].disabled = false;
    }

    // ---- Tutorial puzzle builders ----
    function makeMiniRowExercise(){
      doSetVariant('mini4');
      N=4; BR=2; BC=2; SYMBOLS = mkSymbols(N);
      grid = empty(4); given = grid.map(r=>r.map(()=>false));
      grid[0][0]=1; grid[0][1]=2; grid[0][2]=3; grid[0][3]=0;
      for(let i=0;i<3;i++) given[0][i]=true;
      currentAnswer = 4; currentTarget = {r:0,c:3};
      layoutForVariant(); buildHotel(); draw();
    }
    function makeTrivialSingle4x4(){
      doSetVariant('mini4');
      grid = [
        [1,2,3,4],
        [3,4,1,2],
        [2,1,3,0],
        [4,3,2,1],
      ];
      given = grid.map(row=> row.map(v=> v!==0));
      currentTarget = {r:2,c:3};
      currentAnswer = 4;
      layoutForVariant(); buildHotel(); draw();
    }
    function makeTrivialSingle9x9(){
      doSetVariant('classic9');
      grid = [
        [5,3,4, 6,7,8, 9,1,2],
        [6,7,2, 1,9,5, 3,4,8],
        [1,9,8, 3,4,2, 5,6,7],
        [8,5,9, 7,6,1, 4,2,3],
        [4,2,6, 8,5,3, 0,9,1],
        [7,1,3, 9,2,4, 8,5,6],
        [9,6,1, 5,3,7, 2,8,4],
        [2,8,7, 4,1,9, 6,3,5],
        [3,4,5, 2,8,6, 1,7,9],
      ];
      given = grid.map(row=> row.map(v=> v!==0));
      currentTarget = {r:4,c:6};
      currentAnswer = 7;
      layoutForVariant(); buildHotel(); draw();
    }

    // ---------- Variant switching ----------
    function doSetVariant(key){
      if(key==='mini4'){ N=4; BR=2; BC=2; }
      else if(key==='classic9'){ N=9; BR=3; BC=3; }
      else if(key==='giant16'){ N=16; BR=4; BC=4; }
      SYMBOLS = mkSymbols(N);
      layoutForVariant(); buildHotel(); sizeStage();
    }

    // ---------- Utils ----------
    function wait(ms){ return new Promise(res=> setTimeout(res, ms)); }
    function nextFrame(){ return new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r))); }

    // ---------- Public API ----------
    stageApi = {
      overlay, wrap, board, hotel, controls, controlsMap, topbar, statusEl, pbar, pfill, face, bubble,
      get state(){ return { N, BR, BC, grid: clone(grid), sel, hotelDigit, solution }; },

      // Always animate variant changes via mega morph
      async setVariant(key){
        await runMorphCombineMegaSlice(key);
        draw();
      },

      setSolution(sol){ solution = sol ? clone(sol) : null; draw(); },
      select(rc){ sel = rc ? { ...rc } : null; draw(); moveCoachNear(rc? cellEl(rc.r,rc.c)||board : board, 'left'); },
      place:(r,c,n,clearHotel)=> place(r,c,n,clearHotel),

      allowContextOnce(handler){
        const once = (e)=>{
          e.preventDefault();
          const cell = e.target.closest('.sd-cell'); if(!cell) return;
          if(tutorialStep>0) return;
          const r=+cell.dataset.r, c=+cell.dataset.c;
          handler({r,c,el:cell});
          board.removeEventListener('contextmenu', once);
        };
        board.addEventListener('contextmenu', once);
      },

      coachTo: (x, y, opts) => _coachTo(x, y, opts),
      ensureCoachVisible,
      rippleAtCell,
      showGuideTarget, hideGuideTarget,

      startCountdown, stopCountdown,
      setStatus, setLocks,
      waveHotelOnce,

      setMood(name){
        face.classList.remove('m-worried','m-angry','m-sweat','m-dizzy','sick','panic');
        if(name==='worried') face.classList.add('m-worried');
        if(name==='angry')   face.classList.add('m-angry');
        if(name==='sweat')   face.classList.add('m-sweat');
        if(name==='dizzy')   face.classList.add('m-dizzy');
        if(name==='sick')    face.classList.add('sick','m-dizzy');
      },
      say,
      pingBall(el){
        const rect = el.getBoundingClientRect(); const wrect = wrap.getBoundingClientRect();
        const ball = document.createElement('div');
        ball.style.position='absolute'; ball.style.zIndex=String(parseInt(getComputedStyle(overlay).zIndex||'10100')+50);
        ball.style.width='16px'; ball.style.height='16px'; ball.style.borderRadius='50%';
        ball.style.background='var(--yellow)'; ball.style.boxShadow='0 0 0 6px rgba(255,212,71,.25)';
        ball.style.left = (rect.left - wrect.left + rect.width/2) + 'px';
        ball.style.top  = (rect.top - wrect.top + rect.height/2) + 'px';
        ball.style.transform='translate(-50%,-50%)';
        ball.style.animation='ping 1.6s ease-in-out infinite';
        overlay.appendChild(ball);
        setTimeout(()=> ball.remove(), 1600);
      },
      coachCry,
      showWrongOverlay,
      toggleMusic,
      blip,
      moveCoachNear,
      startRoam, stopRoam,

      // Always use the new morph (aliases kept for old call sites)
      async runMosaic(toKey, { sayLine, sweat } = {}){
        if(sweat) this.setMood('sweat');
        await runMorphCombineMegaSlice(toKey);
        draw();
        if(sayLine) this.say(sayLine);
        if(sweat) setTimeout(()=> this.setMood(null), 900);
      },
      async runMosaicGoo(toKey, opts){ await this.runMosaic(toKey, opts); },     // alias
      async transitionVariantCells(toKey){ await runMorphCombineMegaSlice(toKey); }, // alias

      // New puzzle animation removed

      setInputInterceptor(fn){ inputInterceptor = fn; },

      startOnboarding: ()=> onboardingAsk(true),

      open, close,
      destroy(){
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', sizeStage);
        document.removeEventListener('fullscreenchange', sizeStage);
        ro.disconnect();
        stopRoam();
        overlay.remove();
      }
    };
    return stageApi;
  }

  window.makeCoachStage = makeCoachStage;
})();
