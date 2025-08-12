// sudoku.js — Sudoku (v30, Tone.js + Live Coach Tutorial 6.0 + robust local MP3 loader + quota-safe storage)
// -----------------------------------------------------------------------------
// What’s new in v30 (highlights):
// • Music: robust loader prefers your local assets/audio/music/lofi.mp3 with multi-URL resolution,
//   graceful fallback to procedural lo-fi, smooth fade, first-gesture guarantee.
// • Tutorial 6.0 “Live Coach”:
//    - First-time only gating via sudoku:tutorial:seen (quota-safe).
//    - Multi-hole spotlight mask (SVG mask) that NEVER blocks required controls; target elements are raised.
//    - Reflow-proof positioning: ResizeObserver, fullscreenchange, resize — instant re-anchor.
//    - Soft pacing: Next appears at 3s; if step goal reached and idle, auto-advance after ~4s.
//    - Typewriter copy (reduced-motion aware), reactive narration (Undo/Redo logic, etc.).
//    - State continuity: selection and armed digit preserved across steps when relevant.
// • Quota-safe storage: all localStorage writes guarded; memory fallback if storage is unavailable/full.
// • Keeps v29 celebrations: sweep highlight + digit celebrate + halo burst on unit completion.
//
// Depends on: makeHUD(api,{time:true}) and makeConfetti(canvas,opts) from ../kit/gamekit.js
// Install: npm i tone
import { makeHUD, makeConfetti, mkAudio as makeTinyAudio } from '../kit/gamekit.js';
import * as Tone from 'tone';

export default {
  id: 'sudoku',
  title: 'Sudoku',
  category: 'logic',
  icon: '🔢',
  tags: ['grid','numbers'],
  launch(api) {
    // --------------------------------- Tunables ---------------------------------
    const ERR_FADE_MS = 1600;
    const ERR_STRIP_DELAY = ERR_FADE_MS + 160;
    const CELE_FADE_MS = 680;

    // Tutorial pacing (ms)
    const TUTOR_NEXT_SHOW_MS = 3000;  // show Next after 3s
    const TUTOR_AUTO_ADV_IDLE_MS = 4000; // auto-advance ~4s after success if idle
    const TUTOR_IDLE_GRACE_MS = 1500; // if user keeps interacting, pause until idle for 1.5s

    // --------------------------------- Root & CSS --------------------------------
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.alignItems = 'center';
    root.style.width = '100%';
    root.style.margin = '10px auto 18px';

    const css = document.createElement('style');
    css.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap');

      :root{
        --fg:#e9ecf4; --muted:#a3acc3; --bg:#0f141c;
        --panel:rgba(255,255,255,.03); --ring:#2c3850;
        --accentA:#86b4ff; --accentB:#a5e8ff;

        --peer:rgba(180,200,255,.12);
        --match:rgba(130,170,255,.18);
        --cand:rgba(130,220,190,.22);

        --err:#ff3c3c;
        --errFill:rgba(255,60,60,.36);
        --errScope:rgba(255,60,60,.18);

        --celeScope:rgba(70,210,150,.18);

        --rowcol:rgba(180,200,255,.10);
        --done:#4ad782;

        --errFadeMs: ${ERR_FADE_MS}ms;
        --celeFadeMs: ${CELE_FADE_MS}ms;

        --stageSize: 680px;
        --gap: 10px;
        --blurMask: blur(2px);
        --yellow:#ffd447;

        --z-fx:60;
        --z-coach:70;
        --z-coach-card:75;
        --z-coach-hot:80;
      }

      .sd-wrap{
        width: 100%;
        color:var(--fg);
        background:var(--bg);
        position:relative;
        padding: 10px 10px 14px;
        border-radius:14px;
        max-width: 100%;
        box-sizing: border-box;
        overflow: clip;
      }
      .sd-wrap, .sd-wrap *{ -webkit-tap-highlight-color: transparent; }
      .sd-wrap *:focus{ outline:none !important; box-shadow:none !important; }

      .sd-topbar{ display:flex; flex-direction:column; gap:8px; align-items:center; justify-content:center; }
      .sd-controls{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:center; max-width:100%; }
      .sd-status{ text-align:center; font-size:12px; color:var(--muted); min-height:16px; }

      .sd-btn, .sd-select{
        display:inline-flex; align-items:center; justify-content:center; gap:6px;
        padding:6px 10px; border-radius:12px; font-size:13px;
        background:rgba(255,255,255,.05); color:var(--fg);
        border:1px solid var(--ring); user-select:none; cursor:pointer;
        transition:transform .06s ease, background .12s ease, border-color .12s ease, opacity .12s ease;
      }
      .sd-btn:hover, .sd-select:hover{ background:rgba(255,255,255,.07); }
      .sd-btn:active{ transform:translateY(1px); }
      .sd-btn[disabled]{ opacity:.5; cursor:default; }

      .sd-select{ padding-right:26px; }

      .sd-progress{ height:6px; width: min(100%, 920px); background:rgba(255,255,255,.06); border:1px solid var(--ring); border-radius:999px; overflow:hidden; }
      .sd-progress-fill{ height:100%; width:0%; background:linear-gradient(90deg, var(--accentA), var(--accentB)); transition:width .2s ease; }
      .sd-progress-fill.done{ background:var(--done); }

      .sd-stage{
        width: var(--stageSize);
        max-width: 100%;
        margin: 10px auto 0;
        display: flex;
        flex-direction: column;
        gap: var(--gap);
        align-items: center;
        justify-content: center;
      }

      .sd-board{
        position:relative; display:grid; gap:2px;
        width: 100%;
        aspect-ratio: 1/1;
        user-select:none;
      }
      .sd-board:focus{ outline:none; }
      .sd-rc-line{ position:absolute; background:var(--rowcol); pointer-events:none; z-index:5; border-radius:8px; display:none; }
      .sd-rowline{ left:0; right:0; height:auto; }
      .sd-colline{ top:0; bottom:0; width:auto; }

      .sd-cell{
        position:relative; display:grid; place-items:center; aspect-ratio:1/1;
        border:1px solid var(--ring); border-radius:10px;
        background:var(--panel);
        font-variant-numeric:tabular-nums;
        transition: background 120ms ease, box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease, translate 120ms ease;
        will-change: background, box-shadow, transform, translate, opacity;
        overflow:hidden;
      }
      .sd-cell:hover{ background:rgba(255,255,255,.05); }

      .sd-num{ font-size: clamp(14px, calc(var(--stageSize) / 20), 34px); line-height:1; }
      .sd-num.given{ color:#d0e1ff; font-weight:800; letter-spacing:.2px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
      .sd-num.user{ color:#ffffff; font-family: 'Patrick Hand', cursive, ui-sans-serif, system-ui; font-weight:500; letter-spacing:.1px; }
      .sd-sol{ font-size: clamp(14px, calc(var(--stageSize) / 20), 34px); line-height:1; font-weight:900; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, "Noto Sans", sans-serif; color:#ffffff; }

      .sd-cell.selected{ box-shadow:0 0 0 3px var(--ring) inset, 0 0 0 1px rgba(255,255,255,.06); transform:scale(1.04); translate:0 -1px; }
      .sd-cell.sibling{ background:var(--peer) !important; }
      .sd-cell.match{ background:var(--match) !important; }
      .sd-cell.cand{ background:var(--cand) !important; }
      .sd-cell.boxAlt:not(.selected):not(.match):not(.sibling):not(.cand){ background:rgba(255,255,255,.05); }
      .sd-cell.bT{ border-top-width:4px; } .sd-cell.bL{ border-left-width:4px; }
      .sd-cell.bR{ border-right-width:4px; } .sd-cell.bB{ border-bottom-width:4px; }

      .sd-ovl{ position:absolute; inset:0; border-radius:10px; pointer-events:none; z-index:20; opacity:0; transition: opacity var(--errFadeMs) ease-out; }
      .sd-ovl.err-scope.show{ opacity:1; background: var(--errScope) !important; }
      .sd-ovl.err-peer.show{  opacity:1; background: var(--errFill) !important; box-shadow: 0 0 0 3px var(--err) inset !important; }
      .sd-ovl.err-cell.show{  opacity:1; background: var(--errFill) !important; box-shadow: 0 0 0 4px var(--err) inset !important; }

      .sd-ovl.cele-scope{ transition: opacity var(--celeFadeMs) ease-out; }
      .sd-ovl.cele-scope.show{ opacity:1; background: var(--celeScope); }

      @keyframes wrongDigitFade { 0% { opacity:1; transform:scale(1.02); } 100% { opacity:0; transform:scale(0.95); } }
      .sd-num.user.wrongfade{ animation: wrongDigitFade var(--errFadeMs) ease-out forwards; }

      @keyframes unitPop { 0%{ transform:scale(1); box-shadow:0 0 0 0 rgba(80,200,140,.0) inset; } 40%{ transform:scale(1.03); box-shadow:0 0 0 4px rgba(80,200,140,.28) inset; } 100%{ transform:scale(1); box-shadow:0 0 0 0 rgba(80,200,140,0) inset; } }
      .sd-complete{ animation:unitPop 520ms ease-out; }
      @keyframes digitTwirl { 0%{ transform:scale(1) rotate(0deg); } 40%{ transform:scale(1.08) rotate(6deg); } 100%{ transform:scale(1) rotate(0deg); } }
      .sd-num.twirl{ animation:digitTwirl 520ms ease-out; transform-origin:center; }

      /* --- Unit-complete juice (sweep + digit celebrate + halo burst) --- */
      @keyframes sdSweep { from { background-position: -150% 0; } to { background-position: 150% 0; } }
      .sd-ovl.sweep { opacity:0; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(130,200,255,.22), rgba(255,255,255,0)); background-size:200% 100%; transition:opacity var(--celeFadeMs) ease-out; }
      .sd-ovl.sweep.show { opacity:1; animation: sdSweep 560ms ease-out; }

      @keyframes numCelebrate { 0%{ transform: scale(0.90) rotate(-8deg);} 40%{ transform: scale(1.12) rotate(6deg);} 100%{ transform: scale(1.00) rotate(0deg);} }
      .sd-num.cele { animation: numCelebrate 580ms cubic-bezier(.2,.8,.2,1); transform-origin: 50% 52%; }

      @keyframes sdBurst { 0% { transform: translate(-50%,-50%) scale(.20); opacity:.9; } 100% { transform: translate(-50%,-50%) scale(1.45); opacity:0; } }
      .sd-burst { position:absolute; left:50%; top:50%; width:62%; height:62%; border-radius:50%; pointer-events:none; box-shadow:
        0 0 0 2px rgba(130,200,255,.35),
        0 0 18px rgba(130,200,255,.45),
        inset 0 0 12px rgba(130,200,255,.18);
        animation: sdBurst 600ms ease-out forwards; mix-blend-mode: screen; }

      .sd-hotel{ display:flex; gap: clamp(6px, calc(var(--stageSize)/90), 10px); flex-wrap:wrap; align-items:center; justify-content:center; margin-top: 2px; width: 100%; }
      .sd-hbtn{ display:inline-flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-width: clamp(34px, calc(var(--stageSize)/12), 62px); padding: clamp(6px, calc(var(--stageSize)/70), 10px) clamp(8px, calc(var(--stageSize)/60), 12px); border-radius:12px; background:rgba(255,255,255,.05); border:1px solid var(--ring); color:var(--fg); cursor:pointer; user-select:none; transition:transform .06s ease, background .12s ease, opacity .12s ease, outline .12s ease; }
      .sd-hbtn:hover{ background:rgba(255,255,255,.08); }
      .sd-hbtn:active{ transform:translateY(1px); }
      .sd-hbtn.selected{ outline:2px solid var(--ring); outline-offset:0; }
      .sd-hnum{ font-weight:900; line-height:1; font-size: clamp(14px, calc(var(--stageSize) / 28), 20px); }
      .sd-hcnt{ font-size: clamp(9px, calc(var(--stageSize) / 55), 12px); opacity:.85; line-height:1; }
      .sd-drop-hover{ outline:2px dashed rgba(255,120,120,.9); outline-offset:-2px; }

      .sd-pop-wrap{ position:relative; }
      .sd-pop{ position:absolute; z-index:30; top:100%; right:0; margin-top:6px; background:rgba(20,24,32,.96); backdrop-filter: blur(6px); border:1px solid var(--ring); border-radius:12px; padding:10px; min-width:260px; box-shadow:0 8px 24px rgba(0,0,0,.35); display:none; }
      .sd-pop.open{ display:block; }
      .sd-pop h4{ margin:6px 0 4px; font-size:12px; color:var(--muted); }
      .sd-row{ display:flex; align-items:center; gap:8px; justify-content:space-between; padding:6px 4px; border-radius:8px; }
      .sd-row:hover{ background:rgba(255,255,255,.06); }
      .sd-reset{ margin-top:8px; width:100%; }

      .sd-tip{ position:absolute; z-index:40; background:rgba(23,28,38,.98); color:var(--fg); border:1px solid var(--ring); border-radius:12px; padding:8px; box-shadow:0 8px 24px rgba(0,0,0,.35); display:none; }
      .sd-tip.open{ display:block; }
      .sd-tipgrid{ display:grid; grid-template-columns:repeat(4, clamp(26px, calc(var(--stageSize)/18), 34px)); grid-auto-rows: clamp(26px, calc(var(--stageSize)/18), 34px); gap:6px; justify-content:center; align-content:center; align-items:center; justify-items:center; }
      .sd-tipbtn{ width:100%; height:100%; display:grid; place-items:center; border-radius:6px; background:rgba(255,255,255,.06); border:1px solid var(--ring); cursor:pointer; font-size: clamp(12px, calc(var(--stageSize)/30), 16px); font-weight:800; font-variant-numeric:tabular-nums; user-select:none; }
      .sd-tipbtn:disabled{ opacity:.28; cursor:default; }
      .sd-tipbtn:hover:not(:disabled){ background:rgba(255,255,255,.10); }

      .sd-fx{ position:absolute; inset:0; z-index:var(--z-fx); pointer-events:none; display:block; }

      /* Tutorial 6.0 (Live Coach) */
      .sd-coach {
        position:absolute; inset:0; z-index:var(--z-coach); pointer-events:none;
      }
      .sd-coach svg{ position:absolute; inset:0; width:100%; height:100%; }
      .sd-coach .layer{
        filter: var(--blurMask);
      }
      .sd-coach .dim{
        fill: rgba(10,14,22,.66);
      }
      .sd-coach-card{
        position:absolute; z-index:var(--z-coach-card); pointer-events:auto;
        max-width:min(380px, 92vw);
        background:rgba(20,24,32,.98); color:var(--fg);
        border:1px solid var(--ring); border-radius:12px; padding:10px 12px;
        box-shadow:0 8px 24px rgba(0,0,0,.35); transform-origin: top left;
        animation: cardIn .18s ease;
      }
      .sd-coach-card h4{ margin:0 0 6px; font-size:14px; }
      .sd-coach-card p{ margin:0 0 8px; font-size:12px; color:var(--muted); min-height:36px; }
      .sd-coach-card .actions{ display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
      .sd-coach-card .typewriter{ min-height: 40px; white-space: pre-wrap; }

      .coach-hot{ position:relative; z-index:var(--z-coach-hot) !important; }

      @keyframes cardIn{ from{ opacity:0; transform:scale(.98);} to{ opacity:1; transform:scale(1);} }

      @media (prefers-reduced-motion: reduce){
        .sd-coach-card{ animation:none !important; }
      }

      @media (max-width: 420px) {
        .sd-controls { gap:6px; }
        .sd-btn, .sd-select { padding:5px 8px; font-size:12px; border-radius:10px; }
      }
    `;
    root.appendChild(css);

    const wrap = document.createElement('div'); wrap.className='sd-wrap'; root.appendChild(wrap);

    // FX Canvas (confetti)
    const fxCanvas = document.createElement('canvas'); fxCanvas.className='sd-fx';
    wrap.appendChild(fxCanvas);
    let confetti = null;

    // Live Coach layer (SVG mask + card)
    const coach = document.createElement('div'); coach.className='sd-coach'; coach.style.display='none';
    // SVG + mask container
    coach.innerHTML = `
      <svg aria-hidden="true">
        <defs>
          <mask id="sdCoachMask">
            <rect x="0" y="0" width="100%" height="100%" fill="white"></rect>
            <!-- black rects will be injected as "holes" -->
          </mask>
        </defs>
        <g class="layer">
          <rect class="dim" x="0" y="0" width="100%" height="100%" mask="url(#sdCoachMask)"></rect>
        </g>
      </svg>
    `;
    wrap.appendChild(coach);

    const coachCard = document.createElement('div'); coachCard.className='sd-coach-card'; coachCard.style.display='none';
    coachCard.innerHTML = `
      <h4 id="coach-title"></h4>
      <div id="coach-body" class="typewriter"></div>
      <div class="actions"></div>
    `;
    wrap.appendChild(coachCard);

    // ------------------------------ Top bar & controls ---------------------------
    const topbar = document.createElement('div'); topbar.className='sd-topbar'; wrap.appendChild(topbar);
    const controls = document.createElement('div'); controls.className='sd-controls'; topbar.appendChild(controls);

    const DIFF_OPTS = [
      { value:'supereasy', label:'Super Easy' },
      { value:'easy',      label:'Easy' },
      { value:'medium',    label:'Medium' },
      { value:'hard',      label:'Hard' },
      { value:'expert',    label:'Expert' },
    ];
    const selDiff  = mkSelect(DIFF_OPTS, 'medium', 'Difficulty');

    const VARIANTS = [
      { key:'classic9',  label:'Classic 9×9 (3×3)', N:9,  BR:3, BC:3, symbols: mkSymbols(9)  },
      { key:'mini4',     label:'Mini 4×4 (2×2)',    N:4,  BR:2, BC:2, symbols: mkSymbols(4)  },
      { key:'giant16',   label:'Giant 16×16 (4×4)', N:16, BR:4, BC:4, symbols: mkSymbols(16) },
    ];
    const selVariant = document.createElement('select'); selVariant.className='sd-select'; selVariant.title='Variant';
    VARIANTS.forEach(v=>{ const o=document.createElement('option'); o.value=v.key; o.textContent=v.label; selVariant.appendChild(o); });

    const btnNew       = mkBtn('🎲','New','New random puzzle');
    const btnDaily     = mkBtn('📅','Daily','Today’s daily');
    const btnStartOver = mkBtn('↺','Start Over','Reset to puzzle start');
    const btnHint      = mkBtn('💡','Hint','Smart hint');
    const btnUndo      = mkBtn('↩️','Undo','Undo (Ctrl/Cmd+Z)');
    const btnRedo      = mkBtn('↪️','Redo','Redo (Ctrl+Y / Shift+Ctrl+Z)');
    const btnCheck     = mkBtn('🧪','Check','Highlight wrong entries');
    const btnEraseWrong= mkBtn('🧹','Erase wrong','Erase all wrong non-given entries');
    const btnTutorial  = mkBtn('🎓','Tutorial','Show tutorial');

    // Help popover (closed by default)
    const popWrap = document.createElement('div'); popWrap.className='sd-pop-wrap';
    const btnSettings = mkBtn('⚙️','Help','Help settings');
    const pop = document.createElement('div'); pop.className='sd-pop';
    popWrap.append(btnSettings, pop);

    // Audio toggles
    const btnSfx   = mkBtn('🔊','SFX','Toggle sound effects');
    const btnMusic = mkBtn('🎵','Music','Toggle music');

    controls.append(
      selDiff, selVariant,
      btnNew, btnDaily, btnStartOver,
      btnHint, btnUndo, btnRedo, btnCheck, btnEraseWrong,
      btnTutorial, btnSfx, btnMusic, popWrap
    );

    const status = document.createElement('div'); status.className='sd-status'; status.setAttribute('aria-live','polite'); status.textContent='';
    topbar.appendChild(status);

    const pbar = document.createElement('div'); pbar.className='sd-progress';
    const pfill = document.createElement('div'); pfill.className='sd-progress-fill'; pbar.appendChild(pfill);
    topbar.appendChild(pbar);

    // ------------------------------- Stage: board+hotel --------------------------
    const stage = document.createElement('div'); stage.className='sd-stage'; wrap.appendChild(stage);

    const board = document.createElement('div');
    board.className='sd-board';
    board.tabIndex=0; board.setAttribute('role','grid'); board.setAttribute('aria-label','Sudoku board');
    stage.appendChild(board);
    board.addEventListener('contextmenu', e=> e.preventDefault());

    const rowLine = document.createElement('div'); rowLine.className='sd-rc-line sd-rowline';
    const colLine = document.createElement('div'); colLine.className='sd-rc-line sd-colline';
    board.appendChild(rowLine); board.appendChild(colLine);

    const tip = document.createElement('div'); tip.className='sd-tip';
    const tipGrid = document.createElement('div'); tipGrid.className='sd-tipgrid';
    tip.append(tipGrid); board.appendChild(tip);

    const hotel = document.createElement('div'); hotel.className='sd-hotel';
    hotel.addEventListener('contextmenu', e=> e.preventDefault());
    stage.appendChild(hotel);

    api.mount.appendChild(root);
    const hud = makeHUD(api,{time:true});

    // Confetti after DOM
    confetti = makeConfetti(fxCanvas, { duration: 6 });

    // --------------------------- Variant & Difficulty State ----------------------
    const STORAGE_NS='sudoku:minimal:v30';
    const prefsKey = `${STORAGE_NS}:prefs`;
    const tutSeenKey = `sudoku:tutorial:seen`; // durable, non-versioned

    // Quota-safe storage wrapper (falls back to memory if needed)
    const memStore = new Map();
    const safeStorage = {
      get(key){ try{ const v = localStorage.getItem(key); return v===null?null:v; }catch{ return memStore.has(key)?memStore.get(key):null; } },
      set(key, val){ try{ localStorage.setItem(key, val); }catch{ memStore.set(key, val); } },
      remove(key){ try{ localStorage.removeItem(key); }catch{ memStore.delete(key); } }
    };

    let prefs = loadPrefs() || {
      difficulty:'medium',
      variant:'classic9',
      audio: { sfx:true, music:false },
      help:{
        enabled:true,
        mistakeFeedback:true,
        showValidOnHotel:true,
        sameDigit:true,
        showRowColBars:true,
        hints:true
      }
    };

    const VAR_BY_KEY = key => VARIANTS.find(v=>v.key===key) || VARIANTS[0];
    let currentVariant = VAR_BY_KEY(prefs.variant);
    let difficulty = prefs.difficulty || 'medium';
    selVariant.value = currentVariant.key;
    selDiff.value = difficulty;

    // ----------------------------- Audio (Tone.js) -------------------------------
    const tinyFallback = makeTinyAudio(); // emergency UI blips only

    const sfx  = makeSfxEngineTone(prefs, save, tinyFallback);
    const music = makeLofiMusicToneOrMP3(prefs, save, setStatus);

    music.setEnabled(!!prefs.audio.music);
    reflectAudioButtons();

    // Variant params
    let N = currentVariant.N, BR=currentVariant.BR, BC=currentVariant.BC, SYMBOLS=currentVariant.symbols;

    // game state
    let grid,given,solution,puzzleInitial;
    let undoStack=[], redoStack=[];
    let sel=null;
    let hotelDigit=null;
    let showSolutionHold=false;

    // time / saving
    let started=performance.now(), pausedAcc=0, pauseStart=null;
    let currentSeed=null, isDaily=false;

    // errors
    const wrongFadeLocks = new Set();
    let activeErr = null;
    let errorLock = false;

    // Tutorial 6.0 state
    let tutorialActive = false;
    let tutorial = null; // state machine instance
    let roCoach = null;

    // RNG
    function xmur3(str){ let h=1779033703^str.length; for(let i=0;i<str.length;i++){ h=Math.imul(h^str.charCodeAt(i),3432918353); h=(h<<13)|(h>>>19);} return function(){ h=Math.imul(h^(h>>>16),2246822507); h=Math.imul(h^(h>>>13),3266489909); h^=h>>>16; return h>>>0; }; }
    function mulberry32(a){ return function(){ let t=(a+=0x6d2b79f5); t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
    function seedFromString(s){ const h=xmur3(s); return h(); }
    function makeRng(seedInt){ return mulberry32(seedInt>>>0); }

    // ---------------------------- Symbols & parsing ------------------------------
    function mkSymbols(n){
      const arr=[]; for(let i=1;i<=Math.min(9,n);i++) arr.push(String(i));
      for(let v=10; v<=n; v++) arr.push(String.fromCharCode(55+v));
      return arr;
    }
    function symToVal(ch){
      const u=(ch||'').toUpperCase();
      if(/^[1-9]$/.test(u)) return Number(u);
      const code=u.charCodeAt(0);
      if(code>=65 && code<=90) return code-55;
      return NaN;
    }
    function valToSym(v){ return SYMBOLS[v-1] || String(v); }

    // ---------------------- Generator / solver helpers --------------------------
    function DIGITS(){ return Array.from({length:N},(_,i)=>i+1); }
    function clone(g){ return g.map(r=>r.slice()); }
    function empty(){ return Array.from({length:N},()=>Array(N).fill(0)); }
    function findEmpty(g){ for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(!g[r][c]) return {r,c}; return null; }
    function isSafe(g,r,c,v){
      for(let i=0;i<N;i++){ if(g[r][i]===v) return false; if(g[i][c]===v) return false; }
      const br=(r/BR|0)*BR, bc=(c/BC|0)*BC;
      for(let rr=br; rr<br+BR; rr++) for(let cc=bc; cc<bc+BC; cc++) if(g[rr][cc]===v) return false;
      return true;
    }
    function shuffle(a,rnd){ const arr=a.slice(); for(let i=arr.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
    function genSolved(rnd){ const g=empty(); (function fill(){ const p=findEmpty(g); if(!p) return true; for(const v of shuffle(DIGITS(), rnd)){ if(isSafe(g,p.r,p.c,v)){ g[p.r][p.c]=v; if(fill()) return true; g[p.r][p.c]=0; } } return false; })(); return g; }
    function countSolutions(g,limit=2){ let ct=0; const gc=clone(g); (function rec(){ if(ct>=limit) return; const p=findEmpty(gc); if(!p){ ct++; return; } for(const v of DIGITS()){ if(isSafe(gc,p.r,p.c,v)){ gc[p.r][p.c]=v; rec(); if(ct>=limit) return; gc[p.r][p.c]=0; } } })(); return ct; }

    function diffToRange(diff){
      const map9 = { supereasy:[42,48], easy:[36,40], medium:[32,35], hard:[27,31], expert:[22,26] };
      const map4 = { supereasy:[10,12], easy:[9,10],  medium:[8,9],   hard:[6,7],   expert:[4,5] };
      const map16= { supereasy:[180,196],easy:[160,180], medium:[140,160], hard:[120,140], expert:[100,120] };
      if(N===4) return map4[diff]||map4.medium;
      if(N===16) return map16[diff]||map16.medium;
      return map9[diff]||map9.medium;
    }

    function genPuzzle(diff,rnd){
      const [minC,maxC]=diffToRange(diff);
      const solved=genSolved(rnd), puzzle=clone(solved);
      const idxs=shuffle([...Array(N*N)].map((_,i)=>i), rnd);
      let clues=N*N;
      const target=minC+Math.floor(rnd()*(maxC-minC+1));
      for(const idx of idxs){
        if(clues<=target) break;
        const r=(idx/N|0), c=idx%N, r2=(N-1)-r, c2=(N-1)-c;
        if(puzzle[r][c]===0) continue;
        const s1=puzzle[r][c], s2=puzzle[r2][c2];
        puzzle[r][c]=0; if(r!==r2||c!==c2) puzzle[r2][c2]=0;
        if(countSolutions(puzzle,2)!==1){ puzzle[r][c]=s1; if(r!==r2||c!==c2) puzzle[r2][c2]=s2; }
        else { clues--; if(r!==r2||c!==c2) clues--; }
      }
      return { puzzle, solution:solved };
    }

    // --------------------------------- Sizing / Confetti -------------------------
    function sizeStage(){
      const vw = Math.max(320, window.innerWidth);
      const vh = Math.max(320, window.innerHeight);

      const wrapStyles = getComputedStyle(wrap);
      const wrapVPadding = parseFloat(wrapStyles.paddingTop) + parseFloat(wrapStyles.paddingBottom);
      const topH = topbar.offsetHeight + pbar.offsetHeight + wrapVPadding + 24;

      const availableH = Math.max(240, vh - topH);
      const sByHeight = Math.floor(availableH / 1.26);
      const wrapHPadding = parseFloat(wrapStyles.paddingLeft) + parseFloat(wrapStyles.paddingRight);
      const availableW = Math.max(240, vw - wrapHPadding - 20);
      const sByWidth = Math.floor(availableW);
      const s = Math.max(260, Math.min(sByHeight, sByWidth, 900));

      stage.style.width = s + 'px';
      wrap.style.setProperty('--stageSize', s + 'px');

      syncFxCanvasToWrap();
      confetti.resize();
      refreshCoachMaskSoon();
    }
    function syncFxCanvasToWrap(){
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      fxCanvas.style.left='0'; fxCanvas.style.top='0';
      fxCanvas.style.width = rect.width+'px';
      fxCanvas.style.height = rect.height+'px';
      fxCanvas.width  = Math.floor(rect.width * dpr);
      fxCanvas.height = Math.floor(rect.height * dpr);
    }
    const ro = new ResizeObserver(()=> { syncFxCanvasToWrap(); confetti.resize(); refreshCoachMaskSoon(); });
    ro.observe(wrap);

    // --------------------------------- Setup / Reset -----------------------------
    function resetGame({ daily=false, seed=null } = {}){
      isDaily = daily;
      if(daily){
        const d=new Date(); const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        currentSeed = seedFromString(`daily:${ds}:${difficulty}:${currentVariant.key}:SudokuV30`);
      }else{
        currentSeed = seed ?? (typeof crypto!=='undefined'&&crypto.getRandomValues
          ? crypto.getRandomValues(new Uint32Array(1))[0] : (Date.now()>>>0));
      }
      const rnd=makeRng(currentSeed);
      const { puzzle, solution:sol } = genPuzzle(difficulty, rnd);
      grid=clone(puzzle); solution=sol; puzzleInitial=clone(puzzle);
      given=grid.map(r=>r.map(v=>v!==0));
      undoStack.length=0; redoStack.length=0;
      sel=null; hotelDigit=null; showSolutionHold=false;
      wrongFadeLocks.clear();
      activeErr = null; errorLock = false; hideTip();
      started=performance.now(); pausedAcc=0; pauseStart=null;

      layoutBoardForVariant();
      buildHotel();
      sizeStage();
      draw();
      setStatus(daily ? `Daily ${labelForDiff(difficulty)} — ${currentVariant.label}.` : `New ${labelForDiff(difficulty)} — ${currentVariant.label}.`);
      save();
      updateHelpUI(); updateTime();
    }

    function layoutBoardForVariant(){
      board.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    }

    function buildHotel(){
      hotel.innerHTML='';
      hbtns.clear = undefined;
      for(let idx=1; idx<=N; idx++){
        const b=document.createElement('button'); b.className='sd-hbtn'; b.type='button';
        const num=document.createElement('div'); num.className='sd-hnum'; num.textContent=valToSym(idx);
        const cnt=document.createElement('div'); cnt.className='sd-hcnt'; cnt.textContent=String(N);
        b.append(num,cnt);
        hbtns[idx] = { b, n: idx, cnt };
        b.setAttribute('draggable','true');

        b.addEventListener('dragstart', e=>{
          if(tutorialActive && !tutorial?.allow('dragstart', {n:idx})) { e.preventDefault(); return; }
          e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed='copy';
          pingSfx('drag');
        });

        b.addEventListener('click', ()=>{
          if(tutorialActive && !tutorial?.allow('hotelClick', {n:idx})) return;
          hideTip();
          // Deterministic policy: if editable empty cell selected → place; else arm
          if (sel && !given[sel.r][sel.c] && grid[sel.r][sel.c]===0){
            attemptPlace(sel.r, sel.c, idx, true);
            draw();
          } else {
            hotelDigit = (hotelDigit===idx ? null : idx);
            draw();
          }
          pingSfx('select');
          tutorial?.onAction('hotelClick', {n:idx});
        });
        hotel.appendChild(b);
      }
      const bClear=document.createElement('button'); bClear.className='sd-hbtn'; bClear.type='button';
      const xnum=document.createElement('div'); xnum.className='sd-hnum'; xnum.textContent='×';
      const xcnt=document.createElement('div'); xcnt.className='sd-hcnt'; xcnt.textContent='clear';
      bClear.append(xnum, xcnt);
      bClear.setAttribute('draggable','true');
      bClear.addEventListener('dragstart', e=>{
        if(tutorialActive && !tutorial?.allow('dragstart', {n:0})) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain','clear'); e.dataTransfer.effectAllowed='copy';
        pingSfx('drag');
      });
      bClear.addEventListener('click', ()=>{
        if(tutorialActive && !tutorial?.allow('hotelClear', {})) return;
        hideTip();
        if (sel && !given[sel.r][sel.c]){ record(sel.r, sel.c, {val:0}); draw(); }
        else { hotelDigit = (hotelDigit===0 ? null : 0); draw(); }
        pingSfx('select');
        tutorial?.onAction('hotelClear', {});
      });
      hbtns.clear = bClear;
      hotel.appendChild(bClear);
    }

    const hbtns = {};

    // --------------------------------- Logic ------------------------------------
    function inBox(r,c){ return { br:(r/BR|0)*BR, bc:(c/BC|0)*BC }; }
    function validAt(r,c,v){
      for(let i=0;i<N;i++){ if(i!==c && grid[r][i]===v) return false; if(i!==r && grid[i][c]===v) return false; }
      const {br,bc}=inBox(r,c);
      for(let rr=br; rr<br+BR; rr++) for(let cc=bc; cc<bc+BC; cc++) if((rr!==r||cc!==c)&&grid[rr][cc]===v) return false;
      return true;
    }
    function candidatesFor(r,c){
      if(grid[r][c]) return new Set();
      const s=new Set(); for(const d of DIGITS()) if(validAt(r,c,d)) s.add(d); return s;
    }
    function isSolved(){ for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]!==solution[r][c]) return false; return true; }

    function computeConflicts(r,c,n){
      let rowHit=false, colHit=false, boxHit=false;
      const peersSame = [];
      for(let i=0;i<N;i++){ if(i!==c && grid[r][i]===n){ peersSame.push([r,i]); rowHit=true; } }
      for(let i=0;i<N;i++){ if(i!==r && grid[i][c]===n){ peersSame.push([i,c]); colHit=true; } }
      const box=inBox(r,c);
      for(let rr=box.br; rr<box.br+BR; rr++) for(let cc=box.bc; cc<box.bc+BC; cc++){
        if(!(rr===r && cc===c) && grid[rr][cc]===n){ peersSame.push([rr,cc]); boxHit=true; }
      }
      const wrongVsSolution = (n !== solution[r][c]);
      return { wrongVsSolution, rowHit, colHit, boxHit, peersSame, box };
    }

    // ------------------------------ Undo/Redo + Save ----------------------------
    function snap(r,c){ return { val:grid[r][c] }; }
    function applyCell(r,c,s){ grid[r][c]=s.val; }
    function record(r,c,after){
      const before=snap(r,c);
      undoStack.push({r,c,before,after}); if(undoStack.length>800) undoStack.shift();
      redoStack.length=0;
      applyCell(r,c,after);
      celebrateUnitsAround(r,c);
      draw(); save();
    }
    function place(r,c,v){
      record(r,c,{val:v});
      pingSfx('place');
      if(isSolved()){
        setStatus('Solved! 🎉'); pfill.classList.add('done');
        pingSfx('solve');
        burstConfettiFromBoard();
      }
    }
    function clearCellNoUndo(r,c){
      grid[r][c]=0;
      draw(); save();
    }
    function clearToInitial(){
      grid = clone(puzzleInitial);
      given=grid.map(r=>r.map(v=>v!==0));
      undoStack.length=0; redoStack.length=0; sel=null; hotelDigit=null; showSolutionHold=false;
      wrongFadeLocks.clear();
      activeErr = null; errorLock=false;
      draw(); save();
    }
    function doUndo(){ const t=undoStack.pop(); if(!t) return; applyCell(t.r,t.c,t.before); redoStack.push(t); sel={r:t.r,c:t.c}; setStatus(''); draw(); save(); pingSfx('undo'); tutorial?.onAction('undo'); }
    function doRedo(){ const t=redoStack.pop(); if(!t) return; applyCell(t.r,t.c,t.after); undoStack.push(t); sel={r:t.r,c:t.c}; setStatus(''); draw(); save(); pingSfx('redo'); tutorial?.onAction('redo'); }

    function saveKey(){ return `${STORAGE_NS}:${currentVariant.key}:${difficulty}:${isDaily?'daily':'rng'}:${currentSeed}`; }
    function save(){
      try{
        const elapsed=(pauseStart?pauseStart:performance.now())-started+pausedAcc;
        const data={ grid,given,solution,puzzleInitial,elapsed,difficulty,isDaily, prefs, variant: currentVariant.key };
        safeStorage.set(saveKey(), JSON.stringify(data));
        safeStorage.set(prefsKey, JSON.stringify(prefs));
      }catch{}
    }
    function loadPrefs(){ try{ const raw=safeStorage.get(prefsKey); return raw?JSON.parse(raw):null; }catch{ return null; } }
    function tryLoad(key){
      try{
        const raw=safeStorage.get(key); if(!raw) return false;
        const d=JSON.parse(raw); if(!d||!d.grid||!d.solution) return false;
        currentVariant = VAR_BY_KEY(d.variant);
        N=currentVariant.N; BR=currentVariant.BR; BC=currentVariant.BC; SYMBOLS=currentVariant.symbols;
        selVariant.value = currentVariant.key;

        grid=d.grid; given=d.given; solution=d.solution; puzzleInitial=d.puzzleInitial;
        started=performance.now(); pausedAcc=d.elapsed||0; pauseStart=null;
        difficulty=d.difficulty||difficulty; selDiff.value=difficulty; isDaily=!!d.isDaily;
        if (d.prefs) prefs=d.prefs;

        undoStack.length=0; redoStack.length=0; sel=null; hotelDigit=null; showSolutionHold=false;
        wrongFadeLocks.clear();
        activeErr = null; errorLock=false;
        layoutBoardForVariant();
        buildHotel();
        sizeStage();
        draw(); setStatus(isDaily?'Resumed daily puzzle.':'Resumed saved puzzle.'); updateHelpUI(); reflectAudioButtons(); music.setEnabled(!!prefs.audio.music); return true;
      }catch{ return false; }
    }

    // ---------------------------------- Render ----------------------------------
    function draw(){
      // progress
      let filled=0; for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]) filled++;
      pfill.style.width = `${Math.round((filled/(N*N))*100)}%`;
      if (filled===N*N) pfill.classList.add('done'); else pfill.classList.remove('done');

      // hotel counts
      const used=Array(N+1).fill(0); for(let r=0;r<N;r++) for(let c=0;c<N;c++){ const v=grid[r][c]; if(v) used[v]++; }
      for(let idx=1; idx<=N; idx++){
        const ent = hbtns[idx]; if(!ent) continue;
        const left=N-used[idx]; ent.cnt.textContent=String(left);
        ent.b.style.opacity = left===0 ? .55 : 1;
        ent.b.classList.toggle('selected', hotelDigit===idx);
      }
      if (hbtns.clear) hbtns.clear.classList.toggle('selected', hotelDigit===0);

      const suppressHints = !!(activeErr && performance.now() <= activeErr.until);

      // grid
      board.innerHTML=''; board.appendChild(rowLine); board.appendChild(colLine); board.appendChild(tip);

      const anchor = sel && prefs.help.enabled ? sel : null;
      const selectedValue = sel ? grid[sel.r][sel.c] : 0;

      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        const v=grid[r][c], isGiven=given[r][c];
        const cell=document.createElement('div');
        cell.className='sd-cell'; cell.dataset.r=r; cell.dataset.c=c;

        if(r%BR===0) cell.classList.add('bT'); if(c%BC===0) cell.classList.add('bL');
        if(r===N-1) cell.classList.add('bB'); if(c===N-1) cell.classList.add('bR');
        const boxRow=(r/BR|0), boxCol=(c/BC|0); if(((boxRow+boxCol)&1)===0) cell.classList.add('boxAlt');

        if(sel && sel.r===r && sel.c===c) cell.classList.add('selected');

        if(anchor && !suppressHints){
          if(r===anchor.r || c===anchor.c) cell.classList.add('sibling');
          const aBox=inBox(anchor.r, anchor.c), me=inBox(r,c);
          if(aBox.br===me.br && aBox.bc===me.bc) cell.classList.add('sibling');
        }
        if(!suppressHints && prefs.help.enabled && prefs.help.sameDigit && selectedValue && v===selectedValue && !(sel && sel.r===r && sel.c===c)){
          cell.classList.add('match');
        }

        if(showSolutionHold){
          const sol = document.createElement('div'); sol.className='sd-sol'; sol.textContent = valToSym(solution[r][c]);
          cell.appendChild(sol);
        } else if(v){
          const d=document.createElement('div'); d.className='sd-num ' + (isGiven?'given':'user'); d.textContent=valToSym(v);
          cell.appendChild(d);
          cell.classList.toggle('given', isGiven);
          cell.setAttribute('aria-label', `Row ${r+1} Column ${c+1}, ${isGiven?'given ':''}${valToSym(v)}`);
        } else {
          cell.setAttribute('aria-label', `Row ${r+1} Column ${c+1}, empty`);
        }

        const ovl = document.createElement('div'); ovl.className='sd-ovl';
        cell.appendChild(ovl);

        // Green candidates ONLY when hotel is armed AND (no selection OR selection is given)
        const shouldShowCand =
          !!hotelDigit &&
          hotelDigit !== 0 &&
          !showSolutionHold &&
          prefs.help.enabled &&
          prefs.help.showValidOnHotel &&
          (!sel || given[sel.r][sel.c] === true);

        if(!showSolutionHold && !suppressHints && shouldShowCand && !v && validAt(r,c,hotelDigit)) cell.classList.add('cand');

        // interactions
        cell.addEventListener('click', ()=>{
          if(tutorialActive && !tutorial?.allow('cellClick', {r,c})) return;
          hideTip();
          sel={r,c};
          if (hotelDigit!==null){
            if (hotelDigit===0){ if(!given[r][c]) { record(r,c,{val:0}); } }
            else if (!given[r][c] && grid[r][c]===0){
              attemptPlace(r,c,hotelDigit,true);
            }
          }
          board.focus(); draw();
          pingSfx('select');
          tutorial?.onAction('cellClick',{r,c});
        });

        cell.addEventListener('contextmenu', (e)=>{
          e.preventDefault();
          if(tutorialActive && !tutorial?.allow('context', {r,c})) return;
          hideTip();
          if(showSolutionHold) return;
          if(grid[r][c]) return;
          showTipAtCell(r,c, candidatesFor(r,c));
          pingSfx('select');
          tutorial?.onAction('context',{r,c});
        });

        cell.addEventListener('dragenter', e=>{
          e.preventDefault();
          if(tutorialActive && !tutorial?.allow('dragenter', {r,c})) return;
          cell.classList.add('sd-drop-hover'); pingSfx('hover');
        });
        cell.addEventListener('dragover', e=>{
          if(tutorialActive && !tutorial?.allow('dragover', {r,c})) return;
          e.preventDefault(); e.dataTransfer.dropEffect='copy';
        });
        cell.addEventListener('dragleave', ()=>{
          if(tutorialActive && !tutorial?.allow('dragleave', {r,c})) return;
          cell.classList.remove('sd-drop-hover'); pingSfx('hover');
        });
        cell.addEventListener('drop', e=>{
          if(tutorialActive && !tutorial?.allow('drop', {r,c})) return;
          e.preventDefault(); cell.classList.remove('sd-drop-hover');
          if(showSolutionHold) return;
          const data = e.dataTransfer.getData('text/plain');
          if(data==='clear'){ if(!given[r][c]) record(r,c,{val:0}); draw(); pingSfx('place'); tutorial?.onAction('dropClear',{r,c}); return; }
          let n = Number(data);
          if(!Number.isInteger(n)) n = symToVal(data);
          if(Number.isInteger(n) && n>=1 && n<=N){ attemptPlace(r,c,n,false); draw(); tutorial?.onAction('dropDigit',{r,c,n}); }
        });

        board.appendChild(cell);
      }

      if(!suppressHints && anchor && prefs.help.enabled && prefs.help.showRowColBars && !showSolutionHold){
        const cellEl = board.querySelector(`.sd-cell[data-r="${anchor.r}"][data-c="${anchor.c}"]`);
        if(cellEl){
          const rect = cellEl.getBoundingClientRect();
          const brect = board.getBoundingClientRect();
          const top = rect.top - brect.top, left = rect.left - brect.left;
          rowLine.style.top = `${top}px`; rowLine.style.height = `${rect.height}px`; rowLine.style.display='block';
          colLine.style.left = `${left}px`; colLine.style.width  = `${rect.width}px`;  colLine.style.display='block';
        }
      } else {
        rowLine.style.display='none'; colLine.style.display='none';
      }

      btnUndo.disabled = undoStack.length===0;
      btnRedo.disabled = redoStack.length===0;
      btnHint.disabled = !(prefs.help.enabled && prefs.help.hints) || showSolutionHold;

      const showPlainTools = prefs.help.enabled && !prefs.help.mistakeFeedback && !showSolutionHold;
      btnCheck.style.display = showPlainTools ? '' : 'none';
      btnEraseWrong.style.display = showPlainTools ? '' : 'none';

      if (activeErr){
        const now = performance.now();
        if (now <= activeErr.until){
          applyActiveErrorOverlay();
        } else {
          activeErr = null;
          clearActiveErrorVisuals();
        }
      }

      updateTime();
      refreshCoachMaskSoon(); // keep coach holes aligned to DOM
    }

    function ovlAt(r,c){ return board.querySelector(`.sd-cell[data-r="${r}"][data-c="${c}"] .sd-ovl`); }
    function boardCell(r,c){ return board.querySelector(`.sd-cell[data-r="${r}"][data-c="${c}"]`); }

    // ----------------------------- Placement & Effects ---------------------------
    function celebrateUnitsAround(r,c){
      const rowFull   = grid[r].every(v=>v!==0);
      const colFull   = grid.every(row=>row[c]!==0);
      const {br,bc}=inBox(r,c);
      let boxFull = true; for(let rr=br;rr<br+BR;rr++) for(let cc=bc;cc<bc+BC;cc++) if(grid[rr][cc]===0) { boxFull=false; break; }

      const unitCompleteCorrect = (type, idx)=>{
        if(type==='row'){ for(let c=0;c<N;c++) if(grid[idx][c]!==solution[idx][c]) return false; return true; }
        if(type==='col'){ for(let r=0;r<N;r++) if(grid[r][idx]!==solution[r][idx]) return false; return true; }
        if(type==='box'){
          for(let rr=br;rr<br+BR;rr++) for(let cc=bc;cc<bc+BC;cc++) if(grid[rr][cc]!==solution[rr][cc]) return false; return true;
        }
      };

      if(rowFull && unitCompleteCorrect('row', r)) { animateUnit('row', r); pingSfx('unit'); }
      if(colFull && unitCompleteCorrect('col', c)) { animateUnit('col', c); pingSfx('unit'); }
      if(boxFull && unitCompleteCorrect('box')){
        animateUnit('box', (Math.floor(r/BR))*(N/BC) + Math.floor(c/BC));
        pingSfx('unit');
      }
    }

    // enhanced celebration with sweep + digit celebrate + halo burst
    function animateUnit(type, idx){
      const cells = [];
      if(type==='row'){ for(let c=0;c<N;c++) cells.push([idx,c]); }
      if(type==='col'){ for(let r=0;r<N;r++) cells.push([r,idx]); }
      if(type==='box'){
        const br=(Math.floor(idx/(N/BC)))*BR, bc=(idx%(N/BC))*BC;
        for(let r=br;r<br+BR;r++) for(let c=bc;c<bc+BC;c++) cells.push([r,c]);
      }

      // celebratory scope
      for(const [r,c] of cells){
        const o = ovlAt(r,c);
        if(o){
          o.classList.add('cele-scope','show');
          setTimeout(()=> o.classList.remove('show'), CELE_FADE_MS);
          setTimeout(()=> o.classList.remove('cele-scope'), CELE_FADE_MS+50);
        }
      }

      // Sweep + digit celebrate + halo burst
      for(const [r,c] of cells){
        const el = boardCell(r,c);
        if(!el) continue;

        // Sweep
        const ovl = el.querySelector('.sd-ovl');
        if(ovl){
          ovl.classList.add('sweep','show');
          setTimeout(()=> ovl.classList.remove('show'), 560);
          setTimeout(()=> ovl.classList.remove('sweep'), 700);
        }

        // Twirl + pop
        el.classList.add('sd-complete');
        const numEl = el.querySelector('.sd-num');
        if(numEl){
          numEl.classList.add('cele','twirl');
          setTimeout(()=> numEl && numEl.classList.remove('cele'), 600);
          setTimeout(()=> numEl && numEl.classList.remove('twirl'), 560);
        }
        setTimeout(()=> el.classList.remove('sd-complete'), 560);

        // Halo
        const burst = document.createElement('div');
        burst.className = 'sd-burst';
        el.appendChild(burst);
        setTimeout(()=> { burst.remove(); }, 620);
      }
    }

    function attemptPlace(r,c,n, clearHotelOnSuccess){
      if (given[r][c] || showSolutionHold) return;
      if (errorLock) return;

      const info = computeConflicts(r,c,n);

      // If mistake feedback disabled → just place
      if(!(prefs.help.enabled && prefs.help.mistakeFeedback)){
        place(r,c,n);
        if (clearHotelOnSuccess) hotelDigit=null;
        tutorial?.onAction('place',{r,c,n});
        return;
      }

      // With feedback: show overlay and fade out wrong entry
      place(r,c,n);
      if (info.rowHit || info.colHit || info.boxHit || info.wrongVsSolution){
        hotelDigit = null;
        activeErr = {
          r, c, n,
          rowHit: info.rowHit, colHit: info.colHit, boxHit: info.boxHit,
          peersSame: info.peersSame,
          box: info.box,
          until: performance.now() + ERR_FADE_MS
        };
        errorLock = true;
        requestAnimationFrame(()=> applyActiveErrorOverlay());
        attachWrongFadeExact(r,c,n);
        pingSfx('error');
        setTimeout(()=> {
          activeErr = null;
          clearActiveErrorVisuals();
          errorLock = false;
        }, ERR_FADE_MS);
      }

      if (clearHotelOnSuccess) hotelDigit=null;
      tutorial?.onAction('place',{r,c,n});
    }

    function attachWrongFadeExact(r,c,n){
      const cell = boardCell(r,c);
      if(!cell) return;
      const numEl = cell.querySelector('.sd-num.user');
      if(!numEl) return;
      if(grid[r][c] !== n) return;
      numEl.classList.add('wrongfade');
      wrongFadeLocks.add(`${r},${c}`);
      setTimeout(()=> {
        if(grid[r][c] === n){
          clearCellNoUndo(r,c);
        }
        wrongFadeLocks.delete(`${r},${c}`);
      }, ERR_FADE_MS);
    }

    function applyActiveErrorOverlay(){
      if(!activeErr) return;
      board.querySelectorAll('.sd-ovl.err-scope, .sd-ovl.err-peer, .sd-ovl.err-cell')
        .forEach(el=> el.classList.remove('err-scope','err-peer','err-cell','show'));

      const { r, c, rowHit, colHit, boxHit, peersSame, box } = activeErr;

      if (rowHit){ for(let i=0;i<N;i++){ const o = ovlAt(r,i); if(o){ o.classList.add('err-scope','show'); } } }
      if (colHit){ for(let i=0;i<N;i++){ const o = ovlAt(i,c); if(o){ o.classList.add('err-scope','show'); } } }
      if (boxHit){
        for(let rr=box.br; rr<box.br+BR; rr++) for(let cc=box.bc; cc<box.bc+BC; cc++){
          const o = ovlAt(rr,cc); if(o){ o.classList.add('err-scope','show'); }
        }
      }
      for(const [rr,cc] of peersSame){
        const o = ovlAt(rr,cc); if(o){ o.classList.add('err-peer','show'); }
      }
      const me = ovlAt(r,c); if(me){ me.classList.add('err-cell','show'); }
    }

    function clearActiveErrorVisuals(){
      board.querySelectorAll('.sd-ovl.err-scope.show, .sd-ovl.err-peer.show, .sd-ovl.err-cell.show')
           .forEach(el=> el.classList.remove('show'));
      setTimeout(()=>{
        board.querySelectorAll('.sd-ovl.err-scope, .sd-ovl.err-peer, .sd-ovl.err-cell')
             .forEach(el=> el.classList.remove('err-scope','err-peer','err-cell'));
      }, ERR_STRIP_DELAY);
    }

    // -------------------------------- Confetti ----------------------------------
    function burstConfettiFromBoard(){
      syncFxCanvasToWrap();
      confetti.resize();
      const wrapRect = wrap.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const x = (boardRect.left - wrapRect.left) + boardRect.width/2;
      const y = (boardRect.top  - wrapRect.top ) + boardRect.height*0.35;
      confetti.burst({ from:{ x, y }, count: 260 });
    }

    // -------------------------- Right-click candidate tip ------------------------
    function showTipAtCell(r,c, cand){
      if(tutorialActive && !tutorial?.allow('tip', {r,c})) return;
      tip.innerHTML = '';
      const gridEl = document.createElement('div'); gridEl.className='sd-tipgrid';
      for(const i of DIGITS()){
        const b=document.createElement('button'); b.className='sd-tipbtn'; b.textContent = cand.has(i)? valToSym(i) : '';
        b.disabled = !cand.has(i);
        b.addEventListener('click', (e)=>{ e.stopPropagation(); attemptPlace(r,c,i,false); hideTip(); draw(); tutorial?.onAction('tipPlace',{r,c,i}); });
        gridEl.appendChild(b);
      }
      tip.appendChild(gridEl);

      const cellEl = boardCell(r,c);
      if(!cellEl) return;
      const brect = board.getBoundingClientRect();
      const crect = cellEl.getBoundingClientRect();

      const cellSz = Math.max(26, Math.min(34, parseFloat(getComputedStyle(stage).getPropertyValue('--stageSize'))/18 || 28));
      const cols = 4, gap=6, pad=8;
      const tW = (cellSz*cols + gap*(cols-1)) + pad*2;
      const rows = Math.ceil(N/cols);
      const tH = (cellSz*rows + gap*(rows-1)) + pad*2;

      let x = (crect.right - brect.left) + 6;
      let y = (crect.top   - brect.top)  - tH - 6;
      if (x + tW > brect.width) x = brect.width - tW - 6;
      if (x < 6) x = 6;
      if (y < 6) y = (crect.bottom - brect.top) + 6;

      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
      tip.classList.add('open');
      clearTimeout(tip._timer); tip._timer = setTimeout(()=> hideTip(), 3000);
    }
    function hideTip(){ tip.classList.remove('open'); clearTimeout(tip._timer); }

    // -------------------------------- Keyboard ----------------------------------
    const onKeyDown = (e)=>{
      if(!root.isConnected) return;

      if(tutorialActive && !tutorial?.allow('keydown', {e})) { e.preventDefault(); return; }

      if((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z'){ e.preventDefault(); doUndo(); return; }
      if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))){ e.preventDefault(); doRedo(); return; }

      if(e.key==='f' || e.key==='F'){ if(!showSolutionHold){ showSolutionHold=true; draw(); pingSfx('toggle'); tutorial?.onAction('peekStart'); } }

      if(!sel) sel={r:0,c:0};

      const move=(dr,dc)=>{
        const {r,c}=sel; let nr=r, nc=c;
        if (dc!==0){ nc = c + dc; if (nc<0){ nc=N-1; nr=(r+N-1)%N; } else if (nc>N-1){ nc=0; nr=(r+1)%N; } }
        if (dr!==0){ nr = r + dr; if (nr<0) nr=N-1; if (nr>N-1) nr=0; }
        sel={r:nr,c:nc}; e.preventDefault(); draw();
        pingSfx('move');
        tutorial?.onAction('move');
      };

      if(e.key==='ArrowUp')    return move(-1,0);
      if(e.key==='ArrowDown')  return move(1,0);
      if(e.key==='ArrowLeft')  return move(0,-1);
      if(e.key==='ArrowRight') return move(0,1);
      if(e.key==='Home')       { sel={r:sel.r,c:0}; e.preventDefault(); pingSfx('move'); tutorial?.onAction('move'); return draw(); }
      if(e.key==='End')        { sel={r:sel.r,c:N-1}; e.preventDefault(); pingSfx('move'); tutorial?.onAction('move'); return draw(); }
      if(e.key==='PageUp')     { sel={r:0,c:sel.c}; e.preventDefault(); pingSfx('move'); tutorial?.onAction('move'); return draw(); }
      if(e.key==='PageDown')   { sel={r:N-1,c:sel.c}; e.preventDefault(); pingSfx('move'); tutorial?.onAction('move'); return draw(); }
      if(e.key==='Escape'){ hideTip(); setStatus(''); e.preventDefault(); pingSfx('toggle'); tutorial?.onAction('escape'); return draw(); }

      if(!showSolutionHold && (e.key==='Backspace'||e.key==='Delete'||e.key==='0'||e.key===' ')){
        const {r,c}=sel; if(!given[r][c]) record(r,c,{val:0}); e.preventDefault(); pingSfx('clear'); tutorial?.onAction('clear'); return draw();
      }

      if(!showSolutionHold){
        let n = NaN;
        if (/^[1-9]$/.test(e.key)) n = Number(e.key);
        else n = symToVal(e.key);
        if(Number.isInteger(n) && n>=1 && n<=N){
          const {r,c}=sel; if(given[r][c]) { e.preventDefault(); return; }
          attemptPlace(r,c,n,false); e.preventDefault(); return draw();
        }
      }
    };
    const onKeyUp = (e)=>{
      if(!root.isConnected) return;
      if(e.key==='f' || e.key==='F'){ if(showSolutionHold){ showSolutionHold=false; draw(); pingSfx('toggle'); tutorial?.onAction('peekEnd'); } }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp, { passive:true });

    // ------------------------ Global click (clear transient) ---------------------
    document.addEventListener('mousedown', (e)=>{
      if (e.button!==0) return;
      activeErr = null;
      clearActiveErrorVisuals();
      hideTip();
      // Coach should not eat clicks; it doesn’t have pointer events.
    }, true);

    // IMPORTANT FIX: preserve selection when clicking hotel buttons
    document.addEventListener('mousedown', (e)=>{
      if (!wrap.contains(e.target)) {
        sel=null; hideTip(); draw(); return;
      }
      const isCell   = !!e.target.closest('.sd-cell');
      const isHotelB = !!e.target.closest('.sd-hbtn');
      if (!isCell && !isHotelB) {
        sel=null; hideTip(); draw(); return;
      }
    });

    // ------------------------------- Controls -----------------------------------
    btnNew.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('new')) return; hideTip(); sel=null; hotelDigit=null; resetGame({ daily:false }); pingSfx('toggle'); tutorial?.onAction('new'); });
    btnDaily.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('daily')) return; hideTip(); sel=null; hotelDigit=null; resetGame({ daily:true }); pingSfx('toggle'); tutorial?.onAction('daily'); });
    btnStartOver.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('startover')) return; hideTip(); clearToInitial(); setStatus('Reset to start.'); pingSfx('toggle'); tutorial?.onAction('startover'); });
    btnUndo.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('undo')) return; hideTip(); doUndo(); });
    btnRedo.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('redo')) return; hideTip(); doRedo(); });
    btnHint.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('hint')) return; if(prefs.help.enabled && prefs.help.hints && !showSolutionHold) { doHint(true); pingSfx('hint'); tutorial?.onAction('hint'); } });
    btnCheck.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('check')) return; if(!prefs.help.mistakeFeedback) { checkWrongCellsFlash(); pingSfx('toggle'); tutorial?.onAction('check'); } });
    btnEraseWrong.addEventListener('click', ()=>{ if(tutorialActive && !tutorial?.allow('erase')) return; if(!prefs.help.mistakeFeedback) { eraseWrongCells(); pingSfx('clear'); tutorial?.onAction('erase'); } });

    selDiff.addEventListener('change', ()=>{
      if(tutorialActive && !tutorial?.allow('diff')) { selDiff.value = difficulty; return; }
      difficulty = selDiff.value;
      prefs.difficulty = difficulty;
      save();
      sel=null; hotelDigit=null; hideTip();
      resetGame({ daily:false });
    });
    selVariant.addEventListener('change', ()=>{
      if(tutorialActive && !tutorial?.allow('variant')) { selVariant.value = currentVariant.key; return; }
      const next = VARIANTS.find(v=>v.key===selVariant.value) || currentVariant;
      prefs.variant = next.key;
      currentVariant = next;
      N=currentVariant.N; BR=currentVariant.BR; BC=currentVariant.BC; SYMBOLS=currentVariant.symbols;
      save();
      sel=null; hotelDigit=null; hideTip();
      resetGame({ daily:false });
    });

    // Audio buttons
    btnSfx.addEventListener('click', ()=>{
      if(tutorialActive && !tutorial?.allow('sfx')) return;
      prefs.audio.sfx = !prefs.audio.sfx; save(); reflectAudioButtons();
      if (prefs.audio.sfx) sfx.clickSoft();
      tutorial?.onAction('sfx');
    });
    btnMusic.addEventListener('click', async ()=>{
      if(tutorialActive && !tutorial?.allow('music')) return;
      await music.resumeCtx(); // resume Tone after gesture
      prefs.audio.music = !prefs.audio.music; save(); reflectAudioButtons();
      music.setEnabled(prefs.audio.music);
      sfx.clickSoft();
      tutorial?.onAction('music');
    });
    btnTutorial.addEventListener('click', ()=> startTutorial(true));

    // Help popover + settings
    function rebuildSettings(){
      pop.innerHTML='';
      const h = (t)=>{ const el=document.createElement('h4'); el.textContent=t; return el; };
      const row = (label, nodeRight)=>{ const d=document.createElement('div'); d.className='sd-row'; const l=document.createElement('div'); l.textContent=label; d.append(l, nodeRight); return d; };
      const toggle = (checked, on)=>{ const i=document.createElement('input'); i.type='checkbox'; i.checked=!!checked; i.addEventListener('change', ()=>on(i.checked)); return i; };

      pop.appendChild(h('Help'));
      pop.appendChild(row('Enable help', toggle(prefs.help.enabled, v=>{ prefs.help.enabled=v; save(); updateHelpUI(); draw(); })));
      pop.appendChild(row('Mistake feedback', toggle(prefs.help.mistakeFeedback, v=>{ prefs.help.mistakeFeedback=v; save(); updateHelpUI(); draw(); })));
      pop.appendChild(row('Valid spots (when number picked)', toggle(prefs.help.showValidOnHotel, v=>{ prefs.help.showValidOnHotel=v; save(); draw(); })));
      pop.appendChild(row('Same-digit highlight', toggle(prefs.help.sameDigit, v=>{ prefs.help.sameDigit=v; save(); draw(); })));
      pop.appendChild(row('Row/Col bars (selection)', toggle(prefs.help.showRowColBars, v=>{ prefs.help.showRowColBars=v; save(); draw(); })));

      const reset = mkBtn('↺','Reset','Reset help to defaults'); reset.classList.add('sd-reset');
      reset.addEventListener('click', ()=>{
        prefs.help = { enabled:true, mistakeFeedback:true, showValidOnHotel:true, sameDigit:true, showRowColBars:true, hints:true };
        save(); updateHelpUI(); draw(); rebuildSettings();
        sfx.clickSoft();
      });
      const restartT = mkBtn('🎓','Restart tutorial','Restart guided tutorial');
      restartT.addEventListener('click', ()=> startTutorial(true));
      pop.appendChild(reset);
      pop.appendChild(restartT);
    }
    rebuildSettings();

    btnSettings.addEventListener('click', (e)=>{ if(tutorialActive && !tutorial?.allow('settings')) return; e.stopPropagation(); pop.classList.toggle('open'); if(pop.classList.contains('open')) rebuildSettings(); sfx.clickSoft(); });
    document.addEventListener('click', (e)=>{ if(!popWrap.contains(e.target)) pop.classList.remove('open'); });

    const handleResize = ()=> { sizeStage(); };
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', refreshCoachMaskSoon);

    // ------------------------------- Hints ---------------------------------------
    function doHint(apply){
      if(!prefs.help.enabled || !prefs.help.hints || showSolutionHold) return null;
      if(isSolved()) return null;
      const rnd = makeRng(((currentSeed||0) ^ (Date.now()>>>0))>>>0);

      const indices=[...Array(N*N)].map((_,i)=>i);
      const randOrder = shuffle(indices, rnd);
      const cand = Array.from({length:N},()=>Array.from({length:N},()=>new Set()));
      for(const idx of randOrder){
        const r=(idx/N|0), c=idx%N;
        if(!grid[r][c]){ for(const d of DIGITS()) if(validAt(r,c,d)) cand[r][c].add(d); }
      }

      for(const idx of randOrder){
        const r=(idx/N|0), c=idx%N;
        if(!grid[r][c] && cand[r][c].size===1){ const [d]=cand[r][c]; return presentHint({r,c,d,kind:'naked'}, apply); }
      }

      const rows=shuffle([...Array(N)].map((_,i)=>i), rnd);
      const cols=shuffle([...Array(N)].map((_,i)=>i), rnd);
      const boxes=shuffle([...Array(N)].map((_,i)=>i), rnd);
      const boxesPerRow = N/BC;

      for(const r of rows) for(const d of shuffle(DIGITS(), rnd)){
        const places=[]; for(let c=0;c<N;c++) if(!grid[r][c] && cand[r][c].has(d)) places.push({r,c});
        if(places.length===1) return presentHint({...places[0], d, kind:'hidden-row'}, apply);
      }
      for(const c of cols) for(const d of shuffle(DIGITS(), rnd)){
        const places=[]; for(let r=0;r<N;r++) if(!grid[r][c] && cand[r][c].has(d)) places.push({r,c});
        if(places.length===1) return presentHint({...places[0], d, kind:'hidden-col'}, apply);
      }
      for(const bi of boxes){
        const br0=(Math.floor(bi/boxesPerRow))*BR, bc0=(bi%boxesPerRow)*BC;
        for(const d of shuffle(DIGITS(), rnd)){
          const places=[]; for(let r=br0;r<br0+BR;r++) for(let c=bc0;c<bc+BC;c++) if(!grid[r][c] && cand[r][c].has(d)) places.push({r,c});
          if(places.length===1) return presentHint({...places[0], d, kind:'hidden-box'}, apply);
        }
      }

      setStatus('');
      return null;
    }
    function presentHint(h, apply){
      sel={r:h.r, c:h.c};
      if(apply){ place(h.r,h.c,h.d); draw(); } else { draw(); }
      return h;
    }

    // --------------------------- Time / Visibility / Boot ------------------------
    function updateHelpUI(){ btnHint.style.display = prefs.help.hints ? '' : 'none'; }
    function updateTime(){
      const now=performance.now();
      const elapsed=(pauseStart?pauseStart:now)-started+pausedAcc;
      hud.setTime(elapsed);
    }
    function onVisibility(){
      if(document.hidden){ if(!pauseStart) pauseStart=performance.now(); }
      else{ if(pauseStart){ pausedAcc += performance.now()-pauseStart; pauseStart=null; } }
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Boot
    sizeStage();
    if(!tryLoad(saveKey())) resetGame({ daily:false });
    setTimeout(()=>board.focus(),0);

    // First-time tutorial only (quota-safe)
    if(!safeStorage.get(tutSeenKey)) startTutorial(false);

    return {
      dispose(){
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('fullscreenchange', refreshCoachMaskSoon);
        ro.disconnect();
        if(roCoach) roCoach.disconnect();
        music.setEnabled(false);
      }
    };

    // -------------------------------- Utilities ---------------------------------
    function labelForDiff(d){
      const map={ supereasy:'Super Easy', easy:'Easy', medium:'Medium', hard:'Hard', expert:'Expert' };
      return map[d]||'Medium';
    }
    function mkBtn(emoji,label,title){ const b=document.createElement('button'); b.className='sd-btn'; b.type='button'; b.title=title||label; const i=document.createElement('span'); i.textContent=emoji; const l=document.createElement('span'); l.textContent=label; b.append(i,l); return b; }
    function mkSelect(options,currentValue,title){
      const s=document.createElement('select'); s.className='sd-select'; s.title=title||'';
      options.forEach(opt=>{
        const o=document.createElement('option');
        if (typeof opt==='string'){ o.value=opt; o.textContent=opt; }
        else { o.value=opt.value; o.textContent=opt.label; }
        if ((typeof opt==='string'?opt:opt.value)===currentValue) o.selected=true;
        s.appendChild(o);
      });
      return s;
    }
    function setStatus(msg){ status.textContent = msg || ''; }

    // Plain-mode helpers
    function checkWrongCellsFlash(){
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if(grid[r][c]!==0 && !given[r][c] && grid[r][c]!==solution[r][c]){
          const o = ovlAt(r,c); if(o){
            o.classList.add('err-peer','show');
            setTimeout(()=>{
              o.classList.remove('show');
              setTimeout(()=> o.classList.remove('err-peer'), ERR_STRIP_DELAY);
            }, ERR_FADE_MS);
          }
        }
      }
    }
    function eraseWrongCells(){
      let changed=false;
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if(grid[r][c]!==0 && !given[r][c] && grid[r][c]!==solution[r][c]){
          grid[r][c]=0; changed=true;
        }
      }
      if(changed) { draw(); save(); }
    }

    function reflectAudioButtons(){
      btnSfx.style.opacity   = prefs.audio.sfx ? '1' : '0.65';
      btnMusic.style.opacity = prefs.audio.music ? '1' : '0.65';
      btnSfx.firstChild.textContent   = prefs.audio.sfx ? '🔊' : '🔇';
      btnMusic.firstChild.textContent = prefs.audio.music ? '🎵' : '🔕';
    }

    // ----------------------------- Audio via Tone.js -----------------------------
    function makeSfxEngineTone(prefs, saveFn, tiny){
      const sfxGain = new Tone.Gain(0.6).toDestination();
      const lp = new Tone.Filter(1800, "lowpass").connect(sfxGain);

      const synth = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.08, sustain: 0.0, release: 0.22 }
      }).connect(lp);

      const sine = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.008, decay: 0.08, sustain: 0.0, release: 0.20 }
      }).connect(lp);

      const square = new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.005, decay: 0.12, sustain: 0.0, release: 0.20 }
      }).connect(lp);

      function ok(){ return prefs.audio.sfx; }
      function now(){ return Tone.now(); }

      function t(f, dur=0.14, osc='triangle'){
        if(!ok()) return;
        const s = osc==='triangle'?synth : osc==='sine'?sine : square;
        try{ s.triggerAttackRelease(f, dur, now()); }catch{}
      }

      function clickSoft(){ if(!ok()) return; t(160,0.12,'sine'); }
      function select(){ if(!ok()) return; t(140,0.14,'sine'); }
      function move(){ if(!ok()) return; t(110,0.12,'triangle'); }
      function place(){ if(!ok()) return; t(200,0.16,'triangle'); }
      function clear(){ if(!ok()) return; t(100,0.18,'sine'); }
      function hint(){ if(!ok()) return; t(225,0.18,'triangle'); }
      function error(){
        if(!ok()) return;
        const t0 = now();
        try{
          square.triggerAttackRelease(140, 0.26, t0);
          setTimeout(()=> { if(ok()) sine.triggerAttackRelease(90, 0.14, now()); }, 60);
        }catch{}
      }
      function unit(){
        if(!ok()) return;
        const t0 = now();
        try{
          synth.triggerAttackRelease(240,0.14,t0);
          synth.triggerAttackRelease(300,0.14,t0+0.09);
        }catch{}
      }
      function solve(){
        if(!ok()) return;
        const seq=[260,300,360,450]; const t0=now();
        seq.forEach((f,i)=> { try{ synth.triggerAttackRelease(f,0.18,t0+i*0.095); }catch{} });
      }
      function toggle(){ if(!ok()) return; t(150,0.12,'sine'); }
      function drag(){ if(!ok()) return; t(130,0.08,'sine'); }
      function hover(){ if(!ok()) return; t(95,0.06,'sine'); }

      return { clickSoft, select, move, place, clear, hint, error, unit, solve, toggle, drag, hover };
    }

    // Music engine: robust local MP3 loader with fallback to procedural lo-fi
    function makeLofiMusicToneOrMP3(prefs, saveFn, statusFn){
      let enabled=false, ready=false, fallbackProc=null, player=null;

      const musicGain = new Tone.Gain(0.0).toDestination();
      const lp = new Tone.Filter(1300, "lowpass").connect(musicGain);

      function candidateUrls(){
        const list = [];
        try{ list.push(new URL('../../assets/audio/music/lofi.mp3', import.meta.url).href); }catch{}
        list.push('/assets/audio/music/lofi.mp3');
        list.push('../../assets/audio/music/lofi.mp3');
        list.push('./assets/audio/music/lofi.mp3');
        return list;
      }

      async function makePlayerWithCandidates(){
        const urls = candidateUrls();
        for(let i=0;i<urls.length;i++){
          try{
            const p = new Tone.Player({ url: urls[i], autostart:false, loop:true });
            p.connect(lp);
            await new Promise((res,rej)=>{
              p.onload = ()=> res(true);
              p.onerror = (e)=> rej(e);
            });
            return p;
          }catch(e){
            console.warn('[Sudoku] Music load failed for', urls[i], e);
          }
        }
        return null;
      }

      function makeProcedural(){
        // Pads
        const padA = new Tone.Oscillator(174.61, "triangle").start();
        const padB = new Tone.Oscillator(174.61*1.5, "sine").start();
        const chordGain = new Tone.Gain(0.18);
        padA.connect(chordGain); padB.connect(chordGain); chordGain.connect(lp);

        // Hats
        const noise = new Tone.Noise("white").start();
        const hatHP = new Tone.Filter(7000, "highpass");
        const hatEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.20, sustain: 0.0, release: 0.10 });
        noise.connect(hatHP); hatHP.connect(hatEnv); hatEnv.connect(lp);

        // Kick
        const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 2, oscillator:{type:'sine'}, envelope:{attack:0.001, decay:0.16, sustain:0.0, release:0.06} }).connect(lp);

        // LFO for LPF
        const lfo = new Tone.LFO(0.25, 900, 1800).start(); lfo.connect(lp.frequency);

        const chords = [174.61, 138.59, 155.56, 130.81];
        let ci = 0;

        Tone.Transport.bpm.value = 90;

        const hatLoop = new Tone.Loop((time)=>{ hatEnv.triggerAttackRelease(0.12, time); }, "8n");
        const kickLoop = new Tone.Loop((time)=>{
          const pos = Tone.Transport.position.split(':').map(Number);
          const beat = (pos[1]||0)%8;
          if(beat===0 || beat===4) kick.triggerAttackRelease("C2", 0.12, time);
        }, "8n");
        const chordEvt = new Tone.Loop((time)=>{
          const root = chords[ci % chords.length];
          padA.frequency.setValueAtTime(root, time);
          padB.frequency.setValueAtTime(root*1.5, time);
          ci++;
        }, "2m");

        return {
          start(){
            if(Tone.Transport.state!=='started') Tone.Transport.start();
            hatLoop.start(0); kickLoop.start(0); chordEvt.start(0);
          },
          stop(){
            hatLoop.stop(); kickLoop.stop(); chordEvt.stop();
          }
        };
      }

      async function ensureReady(){
        if(player || fallbackProc) return;
        player = await makePlayerWithCandidates();
        if(player){
          ready=true;
        }else{
          ready=false;
          fallbackProc = makeProcedural();
          console.warn('[Sudoku] Falling back to procedural lo-fi.');
          statusFn?.("Couldn't load music; using synth lo-fi.");
        }
      }

      async function resumeCtx(){ try{ await Tone.start(); }catch{} }

      function setEnabled(on){
        if(on===enabled) return;
        const doEnable = async ()=>{
          await ensureReady();
          enabled=true;
          if(ready && player){
            try{ player.start(); }catch{}
          }else{
            if(Tone.Transport.state!=='started') Tone.Transport.start();
            fallbackProc && fallbackProc.start();
          }
          try{ musicGain.gain.cancelAndHoldAtTime(Tone.now()); }catch{}
          musicGain.gain.linearRampToValueAtTime(0.32, Tone.now()+0.25);
        };
        const doDisable = ()=>{
          enabled=false;
          try{ musicGain.gain.cancelAndHoldAtTime(Tone.now()); }catch{}
          musicGain.gain.linearRampToValueAtTime(0.0, Tone.now()+0.20);
          try{ player && player.stop(); }catch{}
          fallbackProc && fallbackProc.stop();
        };

        if(on) doEnable(); else doDisable();
      }

      return { setEnabled, resumeCtx };
    }

    function pingSfx(kind){
      switch(kind){
        case 'select': sfx.select(); break;
        case 'move':   sfx.move();   break;
        case 'place':  sfx.place();  break;
        case 'clear':  sfx.clear();  break;
        case 'hint':   sfx.hint();   break;
        case 'error':  sfx.error();  break;
        case 'undo':   sfx.toggle(); break;
        case 'redo':   sfx.toggle(); break;
        case 'unit':   sfx.unit();   break;
        case 'solve':  sfx.solve();  break;
        case 'toggle': sfx.toggle(); break;
        case 'drag':   sfx.drag();   break;
        case 'hover':  sfx.hover();  break;
      }
    }

    // ------------------------------- Tutorial 6.0 --------------------------------
    function startTutorial(fromButton){
      if(tutorialActive) return;
      tutorialActive = true;

      // Build steps + state machine
      tutorial = makeLiveCoach();
      tutorial.start();

      // mark seen once tutorial finishes for the first time (quota-safe)
      tutorial.onFinish = ()=>{
        tutorialActive = false;
        tutorial = null;
        try{ safeStorage.set(tutSeenKey, '1'); }catch{}
      };

      if(fromButton){
        // If user explicitly opens tutorial, do not mark seen until they complete/exit.
      }
    }

    // Live Coach engine
    function makeLiveCoach(){
      let stepIndex = 0;
      const steps = buildCoachSteps();
      let sceneRestore = null;
      let nextTimer = null;
      let autoAdvanceTimer = null;
      let idleTimer = null;
      let lastActionTs = 0;
      let allowFn = null;
      let typing = null;

      // RO to re-anchor mask/card on board/wrap changes
      if(roCoach) roCoach.disconnect();
      roCoach = new ResizeObserver(()=> refreshCoachMask());
      roCoach.observe(wrap);
      roCoach.observe(board);

      function start(){
        coach.style.display = '';
        coachCard.style.display = '';
        stepIndex = 0;
        renderStep();
      }

      function finish(){
        cleanupStep();
        coach.style.display = 'none';
        coachCard.style.display = 'none';
        if(roCoach){ roCoach.disconnect(); roCoach=null; }
        onFinish?.();
      }

      function allow(kind, payload){ return allowFn? allowFn(kind, payload) : true; }
      function onAction(kind, payload){
        lastActionTs = performance.now();
        const s = steps[stepIndex];
        s?.onAction?.(kind, payload, apiForStep());
      }

      function apiForStep(){ return {
        setAllow: fn => allowFn = fn,
        clearAllow: ()=> allowFn = null,
        setMessage: (title, text, {fast=false}={})=>{
          coachCard.querySelector('#coach-title').textContent = title || '';
          typeTextTo(coachCard.querySelector('#coach-body'), text || '', {fast});
        },
        success: ()=> reachGoal(),
        refreshMask: refreshCoachMask,
        preserveState: preserveStateForNextStep,
        mapSelection: mapSelectionIfInvalid
      };}

      function cleanupStep(){
        if(nextTimer) { clearTimeout(nextTimer); nextTimer=null; }
        if(autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer=null; }
        if(idleTimer) { clearTimeout(idleTimer); idleTimer=null; }
        if(typing){ typing.stop && typing.stop(); typing=null; }
        // restore scene if any
        if(sceneRestore){ sceneRestore(); sceneRestore=null; }
        // clear hot classes
        document.querySelectorAll('.coach-hot').forEach(el=> el.classList.remove('coach-hot'));
        // clear mask holes
        const mask = coach.querySelector('#sdCoachMask');
        if(mask){
          [...mask.querySelectorAll('rect[data-hole="1"]')].forEach(n=> n.remove());
        }
      }

      function preserveStateForNextStep(nextStep){
        // snapshot selection and hotel if requested
        const s = steps[stepIndex];
        const pres = (nextStep?.preserve) || s?.preserve;
        if(!pres) return ()=>{};
        const snap = { sel: sel?{...sel}:null, hotelDigit };
        return ()=>{
          // Try to restore into next scene
          if(pres.selection && snap.sel){
            const {r,c} = mapSelectionIfInvalid(snap.sel);
            sel = {r,c};
          }
          if(pres.hotel){
            hotelDigit = snap.hotelDigit;
          }
          draw();
        };
      }

      function mapSelectionIfInvalid(s){
        if(!s) return s;
        const {r,c} = s;
        if(r>=0 && r<N && c>=0 && c<N) return s;
        // Map to nearest valid
        return { r: Math.min(Math.max(0,r|0), N-1), c: Math.min(Math.max(0,c|0), N-1) };
      }

      function renderStep(){
        cleanupStep();
        const step = steps[stepIndex];
        if(!step){ finish(); return; }

        // Apply scene if defined
        if(step.scene){
          const saved = {
            grid: clone(grid), given: clone(given), solution: clone(solution), puzzleInitial: clone(puzzleInitial),
            prefs: JSON.parse(JSON.stringify(prefs)), sel: sel?{...sel}:null, hotelDigit
          };
          if(step.scene.grid && step.scene.solution && step.scene.given){
            grid = clone(step.scene.grid);
            solution = clone(step.scene.solution);
            given = clone(step.scene.given);
            puzzleInitial = clone(step.scene.grid);
            undoStack.length=0; redoStack.length=0;
            // We deliberately do NOT clear selection/hotel here — allow the step to choose via preserve.
          }
          if(step.scene.flags){
            if(step.scene.flags.hasOwnProperty('mistakeFeedback')) prefs.help.mistakeFeedback = step.scene.flags.mistakeFeedback;
            if(step.scene.flags.hasOwnProperty('hints')) prefs.help.hints = step.scene.flags.hints;
            if(step.scene.flags.hasOwnProperty('showValidOnHotel')) prefs.help.showValidOnHotel = step.scene.flags.showValidOnHotel;
          }
          draw();
          sceneRestore = ()=>{
            grid=saved.grid; given=saved.given; solution=saved.solution; puzzleInitial=saved.puzzleInitial;
            prefs = Object.assign(prefs, saved.prefs);
            sel=saved.sel; hotelDigit=saved.hotelDigit;
            draw();
          };
        }

        // Allow actions as defined by step; default = soft allow everything
        allowFn = step.allow || (()=> true);

        // Message typing
        coachCard.querySelector('#coach-title').textContent = step.title || '';
        typeTextTo(coachCard.querySelector('#coach-body'), step.body || '');

        // Build actions
        const actions = coachCard.querySelector('.actions');
        actions.innerHTML = '';
        const btnSkip = mkBtn('✕','Skip','Skip tutorial');
        const btnPrev = mkBtn('←','Back','Previous');
        const btnNext = mkBtn(stepIndex===steps.length-1?'✓':'→', stepIndex===steps.length-1?'Done':'Next', stepIndex===steps.length-1?'Finish':'Next');

        btnPrev.disabled = (stepIndex===0);

        btnSkip.addEventListener('click', ()=> finish());
        btnPrev.addEventListener('click', ()=>{ step.onExit && step.onExit(apiForStep()); stepIndex = Math.max(0, stepIndex-1); renderStep(); });
        btnNext.addEventListener('click', ()=>{
          // preserve requested states if any
          const restore = preserveStateForNextStep(steps[stepIndex+1]);
          step.onExit && step.onExit(apiForStep());
          stepIndex++;
          renderStep();
          restore();
        });

        actions.append(btnSkip, btnPrev, btnNext);
        btnNext.style.visibility = 'hidden';
        nextTimer = setTimeout(()=> { btnNext.style.visibility='visible'; }, TUTOR_NEXT_SHOW_MS);

        // Mask & card placement
        refreshCoachMask(step.spots || []);
        placeCoachCard(step);

        // Enter hook
        step.onEnter && step.onEnter(apiForStep());

        // Auto advance logic when success reached
        function scheduleAutoAdvance(){
          if(autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
          autoAdvanceTimer = setTimeout(()=>{
            // wait for idle
            const since = performance.now() - lastActionTs;
            if(since < TUTOR_IDLE_GRACE_MS){
              if(idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(scheduleAutoAdvance, TUTOR_IDLE_GRACE_MS - since + 50);
              return;
            }
            // go next
            const restore = preserveStateForNextStep(steps[stepIndex+1]);
            step.onExit && step.onExit(apiForStep());
            stepIndex++;
            renderStep();
            restore();
          }, TUTOR_AUTO_ADV_IDLE_MS);
        }

        function reachGoal(){
          // Gentle success cue
          setStatus('Nice! ✅');
          scheduleAutoAdvance();
        }

        // expose
        renderStep.reachGoal = reachGoal;
      }

      function placeCoachCard(step){
        const rect = bestAnchorRect(step.spots || []);
        const wrapRect = wrap.getBoundingClientRect();
        // Default placement: right of rect; fall back to left/top as needed
        let cardX = rect.left + rect.width + 10;
        let cardY = rect.top;
        const cardW = Math.min(380, wrapRect.width*0.92);
        const cardH = 200;

        if(cardX + cardW > wrapRect.width - 8) cardX = Math.max(8, rect.left - 6 - Math.min(340, cardW));
        if(cardY + cardH > wrapRect.height - 8) cardY = Math.max(8, Math.min(rect.top, wrapRect.height - 240));

        coachCard.style.left = cardX+'px';
        coachCard.style.top  = cardY+'px';
      }

      function bestAnchorRect(spots){
        const w = wrap.getBoundingClientRect();
        if(!spots || !spots.length){
          // default to stage
          const r = stage.getBoundingClientRect();
          return { left: Math.max(8, r.left-w.left), top: Math.max(8, r.top-w.top), width:r.width, height:r.height };
        }
        // Use first valid
        for(const s of spots){
          const el = querySpotEl(s.selector);
          if(!el) continue;
          const r = el.getBoundingClientRect();
          const pad = s.padding||6;
          return {
            left: Math.max(8, r.left-w.left - pad),
            top:  Math.max(8, r.top -w.top  - pad),
            width: r.width + pad*2,
            height:r.height+ pad*2
          };
        }
        // fallback: whole topbar
        const r = topbar.getBoundingClientRect();
        return { left: Math.max(8, r.left-w.left), top: Math.max(8, r.top-w.top), width:r.width, height:r.height };
      }

      function querySpotEl(selStr){
        if(!selStr) return null;
        try{
          const el = evalSelector(selStr);
          return el && wrap.contains(el) ? el : null;
        }catch{ return null; }
      }

      function evalSelector(selStr){
        // Known selectors map
        const map = {
          'board': ()=> board,
          'hotel': ()=> hotel,
          'controls': ()=> controls,
          'btnUndo': ()=> btnUndo,
          'btnRedo': ()=> btnRedo,
          'btnHint': ()=> btnHint,
          'btnMusic': ()=> btnMusic,
          'btnSfx': ()=> btnSfx,
          'btnCheck': ()=> btnCheck,
          'btnEraseWrong': ()=> btnEraseWrong,
          'anyCell': ()=> board.querySelector('.sd-cell') || board,
          'clearButton': ()=> hbtns.clear,
        };
        if(map[selStr]) return map[selStr]();
        // otherwise treat as CSS
        return wrap.querySelector(selStr);
      }

      let pendingMaskRaf = null;
      function refreshCoachMaskSoon(){ if(!tutorialActive) return; if(pendingMaskRaf) cancelAnimationFrame(pendingMaskRaf); pendingMaskRaf = requestAnimationFrame(()=> refreshCoachMask()); }
      function refreshCoachMask(spots){
        if(!tutorialActive) return;
        const step = steps[stepIndex];
        const sps = spots || step.spots || [];
        // Elevate targets
        document.querySelectorAll('.coach-hot').forEach(el=> el.classList.remove('coach-hot'));
        const hotEls = [];
        sps.forEach(s=>{
          const el = querySpotEl(s.selector);
          if(el) { el.classList.add('coach-hot'); hotEls.push(el); }
        });
        // If no targets resolved, fallback to big hole over topbar/stage
        const fallbackIfNone = hotEls.length===0;

        const mask = coach.querySelector('#sdCoachMask');
        if(!mask) return;
        // clear holes
        [...mask.querySelectorAll('rect[data-hole="1"]')].forEach(n=> n.remove());

        const w = wrap.getBoundingClientRect();
        const addHole = (r, pad=6)=>{
          const left = Math.max(0, r.left - w.left - pad);
          const top  = Math.max(0, r.top  - w.top  - pad);
          const width = Math.min(w.width - left, r.width + pad*2);
          const height= Math.min(w.height- top , r.height+ pad*2);
          const hole = document.createElementNS('http://www.w3.org/2000/svg','rect');
          hole.setAttribute('x', String(left));
          hole.setAttribute('y', String(top));
          hole.setAttribute('width', String(width));
          hole.setAttribute('height', String(height));
          hole.setAttribute('fill','black');
          hole.setAttribute('data-hole','1');
          mask.appendChild(hole);
        };

        if(fallbackIfNone){
          const r = stage.getBoundingClientRect();
          addHole(r, 8);
        }else{
          hotEls.forEach((el,i)=>{
            const r = el.getBoundingClientRect();
            const sp = sps[i] || {};
            addHole(r, sp.padding||6);
          });
        }

        placeCoachCard(step);
      }

      function typeTextTo(node, text, {fast=false}={}){
        if(typing && typing.stop) typing.stop();
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if(fast || reduced){
          node.textContent = text;
          typing = null;
          return;
        }
        node.textContent = '';
        let i=0, stopped=false;
        const baseDelay = 26; // playful+minimal
        function tick(){
          if(stopped) return;
          if(i>=text.length) { typing=null; return; }
          const ch = text[i++];
          node.textContent += ch;
          let delay = baseDelay;
          if(/[.!?]/.test(ch)) delay += 150+Math.random()*120;
          setTimeout(tick, delay);
        }
        typing = { stop: ()=>{ stopped=true; node.textContent=text; } };
        tick();
        // Fast-forward on click
        node.addEventListener('click', ()=> typing?.stop(), { once:true });
      }

      function reachGoal(){ renderStep.reachGoal && renderStep.reachGoal(); }

      function onExitAll(){
        cleanupStep();
        coach.style.display='none';
        coachCard.style.display='none';
      }

      function next(){ const step = steps[stepIndex]; step.onExit && step.onExit(apiForStep()); stepIndex++; renderStep(); }
      function prev(){ const step = steps[stepIndex]; step.onExit && step.onExit(apiForStep()); stepIndex=Math.max(0,stepIndex-1); renderStep(); }

      // public
      let onFinish = null;
      return { start, finish, onFinish, allow, onAction };
    }

    function refreshCoachMaskSoon(){ tutorial?.start && /* no-op - guarded inside */ null; /* external calls schedule inside coach */ }

    // Coach step scenes
    function sceneBlank(){
      const g = empty(); const sol = genSolved(makeRng(1234));
      const giv = g.map(row=>row.map(()=>false));
      return { grid:g, solution:sol, given:giv, flags:{ mistakeFeedback:true, hints:false, showValidOnHotel:true } };
    }
    function sceneSingleMissingRow(){
      const rnd = makeRng(4321);
      const sol = genSolved(rnd);
      const g = clone(sol);
      const r = 0; g[r][N-1]=0;
      const giv = g.map((row,ri)=>row.map((v,ci)=> !(ri===r && ci===N-1) ));
      return { grid:g, solution:sol, given:giv, flags:{ mistakeFeedback:true, hints:false, showValidOnHotel:false } };
    }
    function sceneWrongEntries(){
      const rnd = makeRng(2222); const sol = genSolved(rnd); const g=clone(sol);
      const wrongs = [[0,0, (sol[0][0]%N)+1], [1,1,(sol[1][1]%N)+1], [2,2,(sol[2][2]%N)+1]];
      wrongs.forEach(([r,c,v])=> g[r][c]=v);
      const giv = g.map((row,ri)=>row.map((v,ci)=> (ri+ci)%3===0 ));
      wrongs.forEach(([r,c])=> giv[r][c]=false);
      return { grid:g, solution:sol, given:giv, flags:{ mistakeFeedback:false, hints:false, showValidOnHotel:false } };
    }

    // Build coach steps (playful+fun+minimal copy, reactive where helpful)
    function buildCoachSteps(){
      const steps = [];

      steps.push({
        title:'Welcome to Sudoku 🎉',
        body:`Quick tour? I’ll be fast, fun, and useful.`,
        spots:[{selector:'stage', padding:8}],
        allow: ()=> true
      });

      steps.push({
        scene: sceneBlank(),
        title:'Click a cell',
        body:`Tap any cell to select it.\n(You can try a few!)`,
        spots:[{selector:'board', padding:6}],
        allow: k=> ['cellClick'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='cellClick'){ api.setMessage('Nice 👌', `That cell is selected.\nTry another, or press Next when ready.`); api.success(); } }
      });

      steps.push({
        title:'Place from the hotel',
        body:`With a cell selected, click a number below to place it.\n(No “arming” needed.)`,
        spots:[{selector:'hotel', padding:8}],
        allow: k=> ['hotelClick'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='hotelClick'){ api.setMessage('Sweet ✨', `Number placed. You can try more!`); api.success(); } }
      });

      steps.push({
        title:'Arm a digit',
        body:`No selection? Clicking a hotel number “arms” it.\nValid spots glow.`,
        spots:[{selector:'hotel', padding:8},{selector:'board', padding:6}],
        allow: k=> ['hotelClick','cellClick'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){
          if(kind==='hotelClick' && !sel){ api.setMessage('Digit armed ✅', `Now click a glowing cell to place it.`); api.success(); }
        }
      });

      steps.push({
        title:'Right-click for candidates',
        body:`Right-click an empty cell to see candidates.\nThen click one to place.`,
        spots:[{selector:'board', padding:6}],
        allow: k=> ['context','tipPlace'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='tipPlace'){ api.setMessage('Clever 😎', `Handy when you’re unsure.`); api.success(); } }
      });

      steps.push({
        title:'Keyboard movement',
        body:`Use arrow keys (Home/End/PgUp/PgDown) to move.\nTry a few presses!`,
        spots:[{selector:'board', padding:6}],
        allow: k=> ['keydown','move'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='move'){ api.setMessage('Smooth 🧊', `Navigation mastered.`); api.success(); } }
      });

      steps.push({
        title:'Clearing cells',
        body:`Backspace/Delete or the × button clears a user entry.`,
        spots:[{selector:'clearButton', padding:8},{selector:'board', padding:6}],
        allow: k=> ['hotelClear','keydown','clear'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='hotelClear' || kind==='clear'){ api.setMessage('Clean slate 🧹', `Poof! Gone.`); api.success(); } }
      });

      steps.push({
        title:'Undo ↩️ and Redo ↪️',
        body:`Press **Undo** first… then **Redo**.\n(I’ll notice which one you hit!)`,
        spots:[{selector:'btnUndo', padding:6},{selector:'btnRedo', padding:6}],
        allow: k=> ['undo','redo'].includes(k),
        preserve:{ selection:true, hotel:true },
        onEnter(api){ api.setMessage('Undo ↩️ and Redo ↪️', `Press **Undo** first… then **Redo**.\nI’m watching 👀`); },
        onAction(kind,_p,api){
          if(kind==='undo'){
            api.setMessage('Nice rewind ⏪', `Now press **Redo** to bring it back.`);
          }else if(kind==='redo'){
            api.setMessage('Back in time ⏩', `Now press **Undo** to try the other direction.`);
          }
          // Consider goal reached when both seen at least once
          this._seen = this._seen || {undo:false, redo:false};
          this._seen[kind]=true;
          if(this._seen.undo && this._seen.redo){
            api.setMessage('All set ✅', `Undo/Redo are your time machine.`);
            api.success();
          }
        }
      });

      steps.push({
        title:'Hints 💡',
        body:`Tap **Hint** to auto-place a deduced digit.`,
        spots:[{selector:'btnHint', padding:6}],
        allow: k=> ['hint'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='hint'){ api.setMessage('Handy! 💡', `Use sparingly for challenge.`); api.success(); } }
      });

      steps.push({
        title:'Peek solution',
        body:`Hold “F” to reveal the solution; release to return.`,
        spots:[{selector:'board', padding:6}],
        allow: (k)=> ['keydown','peekStart','peekEnd'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){
          if(kind==='peekStart'){ api.setMessage('Sneaky 👀', `Release “F” to go back.`); }
          if(kind==='peekEnd'){ api.setMessage('Back to work 💪', `Let’s continue.`); api.success(); }
        }
      });

      steps.push({
        scene: sceneWrongEntries(),
        title:'Check & Erase (plain mode)',
        body:`When mistake feedback is off:\nUse **Check** to highlight wrongs, **Erase** to clear them.`,
        spots:[{selector:'btnCheck', padding:6},{selector:'btnEraseWrong', padding:6}],
        allow: k=> ['check','erase'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='check' || kind==='erase'){ api.setMessage('Got it ✅', `Great for a clean reset.`); api.success(); } }
      });

      steps.push({
        scene: sceneSingleMissingRow(),
        title:'Finish a unit',
        body:`Complete the highlighted row to see the celebration 🎉`,
        spots:[{selector:'board', padding:6}],
        allow: k=> ['cellClick','hotelClick','keydown','place'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){
          const ok = grid[0].every((v,c)=> v===solution[0][c]);
          if(ok){ api.setMessage('Woo! 🥳', `That’s the vibe.`); api.success(); }
        }
      });

      steps.push({
        title:'Daily, Variants, Difficulty',
        body:`📅 loads a seeded daily.\nYou can switch variants or difficulty anytime.`,
        spots:[{selector:'controls', padding:6}],
        allow: ()=> true,
        preserve:{ selection:true, hotel:true }
      });

      steps.push({
        title:'Chill audio 🎵',
        body:`Toggle **Music** to start your lofi.mp3.\nSFX via **SFX**.`,
        spots:[{selector:'btnMusic', padding:6},{selector:'btnSfx', padding:6}],
        allow: k=> ['music','sfx'].includes(k),
        preserve:{ selection:true, hotel:true },
        onAction(kind,_p,api){ if(kind==='music' || kind==='sfx'){ api.setMessage('Vibes ✅', `Lo-fi acquired.`); api.success(); } }
      });

      steps.push({
        title:`You're set!`,
        body:`Reopen this anytime via 🎓 Tutorial.\nHave fun!`,
        spots:[{selector:'stage', padding:8}],
        allow: ()=> true
      });

      return steps;
    }
  }
};
