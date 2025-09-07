// wordle.js — Wordle+ Ultra v7
// - Fullscreen-aware confetti (moves into fullscreen element, fills it, no clipping)
// - Zero-jank fullscreen transitions (ResizeObserver + RAF sizing + ref counting)
// - Classic Wordle editing (no free cursor)
// - Hint fills the letter bank: marks a few "present" (yellow) and "absent" (grey). No scans, instant.
// - Silky CSS reveal with minimal JS
// - Active tile outline; dark, modern UI

import { makeConfetti } from '/src/kit/gamekit.js';

/* ============================================================
 *  WORD LISTS (cache-aware, with safe fallback)
 * ============================================================ */
const DICT_VERSION = 'v1';
const DICT_PATH = '/wordlists/english-5.json';
const ANSWERS_PATH = '/wordlists/answers-5.json';

async function loadWordLists() {
  try {
    const meta = JSON.parse(localStorage.getItem('wordle.dict.meta') || 'null');
    const dict = JSON.parse(localStorage.getItem('wordle.dict.words') || 'null');
    const answers = JSON.parse(localStorage.getItem('wordle.dict.answers') || 'null');
    if (meta?.version === DICT_VERSION && Array.isArray(dict) && Array.isArray(answers) && dict.length && answers.length) {
      const up = w => w.toUpperCase();
      return { dictSet: new Set(dict.map(up)), answersUP: answers.map(up) };
    }
  } catch {}

  const [d, a] = await Promise.allSettled([
    fetch(DICT_PATH, { cache: 'no-cache' }),
    fetch(ANSWERS_PATH, { cache: 'no-cache' })
  ]);

  if (d.status === 'fulfilled' && a.status === 'fulfilled' && d.value.ok && a.value.ok) {
    const [dict, answers] = await Promise.all([d.value.json(), a.value.json()]);
    try {
      localStorage.setItem('wordle.dict.meta', JSON.stringify({ version: DICT_VERSION, ts: Date.now() }));
      localStorage.setItem('wordle.dict.words', JSON.stringify(dict));
      localStorage.setItem('wordle.dict.answers', JSON.stringify(answers));
    } catch {}
    const up = w => w.toUpperCase();
    return { dictSet: new Set(dict.map(up)), answersUP: answers.map(up) };
  }

  // Fallback to keep game playable offline
  const fallbackAnswers = ['apple','brain','steam','ghost','chime','plant','crane','spark','money','tiger','metal','delta','quiet'];
  const fallbackDict = fallbackAnswers.concat(['about','angle','arise','candy','chair','clean','eager','glory','honey','river','story','trace']);
  const up = w => w.toUpperCase();
  return { dictSet: new Set(fallbackDict.map(up)), answersUP: fallbackAnswers.map(up) };
}

/* ============================================================
 *  WORDLE SCORING + SMALL HELPERS
 * ============================================================ */
function scoreGuess(secret, guess) {
  const s = secret.split(''), g = guess.split('');
  const res = Array(5).fill('absent'); const counts = {};
  for (let i=0;i<5;i++){ if (g[i]===s[i]) res[i]='correct'; else counts[s[i]]=(counts[s[i]]||0)+1; }
  for (let i=0;i<5;i++){ if (res[i]==='correct') continue; const ch=g[i]; if (counts[ch]>0){ res[i]='present'; counts[ch]--; } }
  return res;
}
function rowLen(row){ let i=5; while(i>0 && row[i-1]==='') i--; return i; }
const isTouch = () => matchMedia?.('(hover: none)').matches || /Mobi|Android/i.test(navigator.userAgent);

/* ============================================================
 *  FULLSCREEN-AWARE CONFETTI MANAGER (singleton + ref counted)
 *  - Canvas is reparented into the fullscreen element when active; otherwise <body>
 *  - ResizeObserver resizes to parent (no storms)
 *  - RAF used for cheap synchronous fits
 *  - visibilitychange/fullscreenchange pause & clear safely
 * ============================================================ */
(function initConfettiManager(){
  if (window.__ConfettiManager) return;

  function fitToParent(canvas) {
    const parent = canvas.parentElement || document.body;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const CM = {
    canvas: null,
    conf: null,
    ro: null,
    refCount: 0,
    listenersAttached: false,
    paused: false,

    ensureParent(){
      const target = document.fullscreenElement || document.body;
      if (!this.canvas) {
        const c = document.createElement('canvas');
        Object.assign(c.style, {
          position: 'fixed', inset: '0', width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: '2147483647'
        });
        target.appendChild(c);
        this.canvas = c;
        this.conf = makeConfetti(c, { duration: 5.8, count: 160, maxActive: 260 });
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(target);
        requestAnimationFrame(() => this.resize());
      } else if (this.canvas.parentElement !== target) {
        // Move canvas to fullscreen element (or back to body)
        const oldParent = this.canvas.parentElement;
        try { this.ro && oldParent && this.ro.unobserve(oldParent); } catch {}
        target.appendChild(this.canvas);
        try { this.ro && this.ro.observe(target); } catch {}
        requestAnimationFrame(() => this.resize());
      }
    },

    resize(){
      if (this.paused || !this.canvas) return;
      fitToParent(this.canvas);
      try { this.conf.resize(); } catch {}
    },

    attachGlobalListeners(){
      if (this.listenersAttached) return;
      const onResize = () => requestAnimationFrame(() => this.resize());
      const onVis = () => {
        if (document.hidden) { this.paused = true; this.conf?.clear(); }
        else { this.paused = false; this.resize(); }
      };
      const onFS = () => {
        // Reparent canvas to new fullscreen container, then resize
        this.paused = true;
        this.conf?.clear();
        this.ensureParent();
        requestAnimationFrame(() => { this.paused = false; this.resize(); });
      };
      window.addEventListener('resize', onResize, { passive: true });
      document.addEventListener('visibilitychange', onVis);
      document.addEventListener('fullscreenchange', onFS);
      this._off = () => {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('fullscreenchange', onFS);
      };
      this.listenersAttached = true;
    },

    use(){
      this.refCount++;
      this.ensureParent();
      this.attachGlobalListeners();
      return {
        burst: (opts={}) => { if (!CM.paused) CM.conf?.burst(opts); },
        clear: () => CM.conf?.clear(),
        release: () => {
          CM.refCount = Math.max(0, CM.refCount - 1);
          if (CM.refCount === 0) {
            try { CM._off && CM._off(); } catch {}
            CM.listenersAttached = false;
            try { CM.ro && CM.canvas && CM.ro.unobserve(CM.canvas.parentElement); } catch {}
            try { CM.conf?.clear(); } catch {}
            try { CM.canvas?.remove(); } catch {}
            CM.ro = null; CM.canvas = null; CM.conf = null;
          }
        }
      };
    }
  };

  window.__ConfettiManager = CM;
})();

/* ============================================================
 *  GAME
 * ============================================================ */
export default {
  id: 'wordle',
  title: 'Wordle+ Ultra',
  category: 'logic',
  icon: '🟩',
  tags: ['words','guess'],

  async launch(api){
    const { dictSet: VALID, answersUP } = await loadWordLists();
    const confetti = window.__ConfettiManager.use();

    // Root / shadow
    const host = document.createElement('div');
    host.style.maxWidth = '560px';
    host.style.margin = '24px auto';
    host.style.contain = 'content';
    host.tabIndex = 0;
    const shadow = host.attachShadow({ mode: 'open' });
    api.mount.appendChild(host);

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial}
      .wrap{
        display:grid;gap:14px;justify-items:stretch;padding:10px;
        background: radial-gradient(1200px 360px at 50% -40px, rgba(255,255,255,0.05), transparent),
                    linear-gradient(180deg,#0f172a,#0b1222);
        border:1px solid rgba(255,255,255,0.06); border-radius:16px;
        box-shadow:0 6px 24px rgba(0,0,0,.25); color:#e5e7eb;
      }
      .title{font:700 18px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto;opacity:.85;text-align:center;letter-spacing:.3px}
      .toolbar{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
      .pill,.ghost{
        appearance:none;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);
        color:#e5e7eb;padding:6px 10px;border-radius:999px;font-weight:600;cursor:pointer;
        transition:transform .18s cubic-bezier(.22,.61,.36,1), background .25s, border-color .25s, opacity .25s;
      }
      .pill:hover{transform:translateY(-1px);background:rgba(255,255,255,.09)}
      .ghost{opacity:.85}.ghost:hover{opacity:1}
      .status,.hintbox{min-height:22px;font-size:14px;text-align:center;opacity:.92}
      .hintbox{font-size:13px;color:#cbd5e1}

      .board{
        --tile: clamp(44px, min(12vw, 8.5vh), 76px);
        --gap: clamp(6px, 1.8vw, 11px);
        display:grid; grid-template-columns:repeat(5, var(--tile)); grid-auto-rows:var(--tile);
        gap:var(--gap); justify-content:center; perspective:1400px;
      }
      .tile{
        border-radius:12px; background:#141b2b; border:1px solid rgba(255,255,255,0.08);
        display:grid; place-items:center; font:800 22px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto;
        letter-spacing:1px; text-transform:uppercase; user-select:none; color:#e5e7eb;
        box-shadow:inset 0 -2px 0 rgba(0,0,0,.25), 0 1px 1px rgba(0,0,0,.12);
        transition: border-color .18s, background .18s, color .18s, box-shadow .18s;
        transform-style:preserve-3d;
      }
      .tile.filled{border-color:rgba(255,255,255,0.16); box-shadow:inset 0 -2px 0 rgba(0,0,0,.3), 0 6px 18px rgba(0,0,0,.22)}
      .tile.active{outline:2px solid rgba(125,211,252,.88); outline-offset:2px}
      .tile.shake{animation:shake .32s ease}
      .tile.win{animation:bounce .64s ease}

      .tile[data-state="absent"]{background:#0b1321;color:#f8fafc;border-color:#0b1321}
      .tile[data-state="present"]{background:#ffd476;color:#452b00;border-color:#eac062}
      .tile[data-state="correct"]{background:#7ce2c4;color:#053a2a;border-color:#53caa9}

      .tile.reveal{animation:flipReveal .68s cubic-bezier(.22,.61,.36,1) var(--delay,0ms) forwards}
      .tile.reveal.pop{
        animation:flipReveal .68s cubic-bezier(.22,.61,.36,1) var(--delay,0ms) forwards,
                   settlePop .2s cubic-bezier(.22,.61,.36,1) calc(var(--delay,0ms)+.68s) forwards
      }
      @keyframes flipReveal{0%{transform:rotateX(0)}50%{transform:rotateX(90deg)}100%{transform:rotateX(0)}}
      @keyframes settlePop{0%{transform:scale(.96)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
      @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
      @keyframes bounce{0%{transform:translateY(0)}35%{transform:translateY(-11px)}65%{transform:translateY(0)}85%{transform:translateY(-4px)}100%{transform:translateY(0)}}

      .kbd{display:grid;gap:6px;width:100%}
      .row{display:grid;grid-auto-flow:column;gap:6px;justify-content:center}
      .key{
        border:1px solid rgba(255,255,255,.18);
        background:rgba(148,163,184,.18);
        color:#e5e7eb; padding:12px 8px; border-radius:10px; min-width:36px; text-align:center;
        font-weight:700; user-select:none; cursor:pointer; box-shadow:0 1px 1px rgba(0,0,0,.18);
        transition: transform .1s cubic-bezier(.22,.61,.36,1), background .2s, border-color .2s, color .2s, opacity .2s;
      }
      .key:active{ transform: translateY(1px) scale(.985); }
      .key[data-state="unused"]{background:rgba(148,163,184,.18);border-color:rgba(148,163,184,.35);color:#e2e8f0}
      .key[data-state="absent"]{background:#0b1321;border-color:#0b1321;color:#f8fafc}
      .key[data-state="present"]{background:#ffd476;color:#452b00;border-color:#eac062}
      .key[data-state="correct"]{background:#7ce2c4;color:#053a2a;border-color:#53caa9}

      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    `;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="title">Wordle+ Ultra</div>
      <div class="toolbar">
        <button id="btn-hint" class="pill" title="Hint (⌘/Ctrl+H)">💡 Hint</button>
        <button id="btn-reveal" class="ghost" title="Reveal letter (⌘/Ctrl+R)">✨ Reveal</button>
        <button id="btn-giveup" class="ghost" title="Give up (⌘/Ctrl+G)">🛑 Give up</button>
        <button id="btn-new" class="pill" title="New game (⌘/Ctrl+N)">↻ New</button>
      </div>
      <div class="status" aria-live="polite"></div>
      <div class="hintbox" aria-live="polite"></div>
      <div class="board" role="grid" aria-label="Word grid"></div>
      <div class="kbd" aria-label="Keyboard"></div>
      <input class="sr-only" type="text" id="kbd-trap" inputmode="text" autocapitalize="none" autocomplete="off" />
    `;
    shadow.appendChild(wrap);

    // Refs
    const statusEl = wrap.querySelector('.status');
    const hintEl = wrap.querySelector('.hintbox');
    const board = wrap.querySelector('.board');
    const kbd = wrap.querySelector('.kbd');
    const trap = wrap.querySelector('#kbd-trap');
    const btnHint = wrap.querySelector('#btn-hint');
    const btnReveal = wrap.querySelector('#btn-reveal');
    const btnGiveUp = wrap.querySelector('#btn-giveup');
    const btnNew = wrap.querySelector('#btn-new');

    // Game state
    const rows = 6, cols = 5;
    let secret = answersUP[(Math.random() * answersUP.length) | 0];
    let row = 0; let locked = false; let assisted = false;
    const GRID = Array.from({ length: rows }, () => Array(cols).fill(''));

    // Timers (safe cleanup)
    const timers = new Set();
    const addTimer = id => (timers.add(id), id);
    const clearTimers = () => { timers.forEach(id => clearTimeout(id)); timers.clear(); };

    // Build board
    const frag = document.createDocumentFragment(); const tiles = [];
    for (let i=0;i<rows*cols;i++){ const t=document.createElement('div'); t.className='tile'; t.setAttribute('role','gridcell'); tiles.push(t); frag.appendChild(t); }
    board.appendChild(frag);

    // Active outline + paint
    function updateActiveOutline(){
      const len = rowLen(GRID[row]);
      tiles.forEach(t => t.classList.remove('active'));
      tiles[row*cols + Math.min(len, cols-1)]?.classList.add('active');
    }
    function paintRow(r){
      const start = r*cols; const data = GRID[r];
      for (let i=0;i<cols;i++){ const el=tiles[start+i]; const ch=data[i]; el.textContent=ch; el.classList.toggle('filled', ch!==''); }
      board.setAttribute('aria-label', `Row ${r+1}: ${GRID[r].join('')||'empty'}`);
      updateActiveOutline();
    }
    function flashInvalid(r,msg){
      for (let i=0;i<cols;i++){ const el=tiles[r*cols+i]; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
      setStatus(msg||''); vibrate(40);
    }

    // Keyboard UI
    const layout = [
      'QWERTYUIOP'.split(''),
      'ASDFGHJKL'.split(''),
      ['Enter', ...'ZXCVBNM'.split(''), 'Back']
    ];
    layout.forEach(keys=>{
      const rowEl=document.createElement('div'); rowEl.className='row';
      keys.forEach(k=>{
        const b=document.createElement('button');
        b.className='key'; b.type='button'; b.textContent=(k==='Back')?'⌫':k;
        b.dataset.key=k; b.dataset.state='unused'; rowEl.appendChild(b);
      });
      kbd.appendChild(rowEl);
    });
    const keyElems = new Map();
    kbd.querySelectorAll('.key').forEach(k=>{
      const name = k.dataset.key.toUpperCase();
      keyElems.set(name, (keyElems.get(name)||[]).concat(k));
    });
    function updateKeys(guess, states){
      const rank = v => v==='correct'?3 : v==='present'?2 : v==='absent'?1 : 0;
      for (let i=0;i<cols;i++){
        const ch = guess[i]; const st = states[i];
        (keyElems.get(ch)||[]).forEach(el=>{
          const prev = el.dataset.state || 'unused';
          if (rank(st) > rank(prev)) el.dataset.state = st;
        });
      }
    }

    // UX helpers
    const vibrate = (ms)=>{ try{ navigator.vibrate && navigator.vibrate(ms); } catch{} };
    const setStatus = (t)=> statusEl.textContent = t || '';
    const setHint = (t)=> hintEl.textContent = t || '';

    // Classic editing
    function typeLetter(k){
      if (locked) return;
      if (k.length!==1 || k<'A' || k>'Z') return;
      const len = rowLen(GRID[row]); if (len>=cols) return;
      GRID[row][len] = k; paintRow(row); vibrate(5);
    }
    function backspace(){
      if (locked) return;
      const len = rowLen(GRID[row]); if (len===0){ flashInvalid(row); return; }
      GRID[row][len-1]=''; paintRow(row); vibrate(5);
    }

    // Reveal (CSS + tracked timers)
    const STAGGER = 200, FLIP_MS = 680, POP_MS = 200;
    function revealRow(guess, states){
      for (let i=0;i<cols;i++){
        const el=tiles[row*cols+i];
        el.style.setProperty('--delay', `${i*STAGGER}ms`);
        el.classList.remove('reveal','pop');
      }
      for (let i=0;i<cols;i++){
        const el=tiles[row*cols+i];
        el.classList.add('reveal');
        addTimer(setTimeout(()=>{ el.dataset.state = states[i]; }, i*STAGGER + FLIP_MS*0.5));
        addTimer(setTimeout(()=>{ el.classList.add('pop'); }, i*STAGGER + FLIP_MS));
      }
      const total = (cols-1)*STAGGER + FLIP_MS + POP_MS + 16;
      return new Promise(res => addTimer(setTimeout(res, total)));
    }

    // HINT: fills the letter bank (present/absent) with zero scans
    const COMMON = 'ETAOINSHRDLUCMFYWGPBVKXQJZ'.split('');
    function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
    function showHint(){
      // Letters already decided
      const discovered = new Set();
      kbd.querySelectorAll('.key').forEach(el=>{
        const st = el.dataset.state;
        if (st==='correct' || st==='present' || st==='absent') discovered.add(el.dataset.key.toUpperCase());
      });

      const secretSet = new Set(secret.split(''));
      const unknown = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(ch => !discovered.has(ch));
      const canIn  = unknown.filter(ch => secretSet.has(ch));
      const canOut = unknown.filter(ch => !secretSet.has(ch));

      // Progress heuristic + small randomness
      const progress = [...kbd.querySelectorAll('.key')].filter(k => k.dataset.state==='correct'||k.dataset.state==='present').length;
      let inCount = (progress<2)? (Math.random()<0.75?1:0)
                 : (progress<4)? (Math.random()<0.55?1:0)
                 : (Math.random()<0.35?1:0);
      if (progress<=1 && Math.random()<0.22) inCount = 2;
      inCount = Math.min(inCount, canIn.length);

      let outBase = (progress<2)?3 : (progress<4)?2 : 1;
      let outCount = Math.min(canOut.length, outBase + (Math.random()<0.2?1:0));

      const inLetters = shuffle([...canIn]).slice(0, inCount);
      const outPref = COMMON.concat(unknown.filter(ch => !COMMON.includes(ch)));
      const outLetters = [];
      for (const ch of outPref) {
        if (outLetters.length >= outCount) break;
        if (!secretSet.has(ch) && !inLetters.includes(ch) && canOut.includes(ch)) outLetters.push(ch);
      }

      // Upgrade-only updates to keyboard states
      const rank = v => v==='correct'?3 : v==='present'?2 : v==='absent'?1 : 0;
      const setStateIfBetter = (ch, target) => {
        (keyElems.get(ch)||[]).forEach(el=>{
          const prev = el.dataset.state || 'unused';
          if (rank(target) > rank(prev)) el.dataset.state = target;
        });
      };
      inLetters.forEach(ch => setStateIfBetter(ch, 'present'));
      outLetters.forEach(ch => setStateIfBetter(ch, 'absent'));

      const msg = [
        inLetters.length  ? `present: ${inLetters.join(' ')}` : '',
        outLetters.length ? `absent: ${outLetters.join(' ')}` : ''
      ].filter(Boolean).join(' · ');
      setHint(msg || 'No strong hint right now');
    }

    // Board center cache (avoid sync layout during fullscreen/resize)
    let boardCenter = { x: 0, y: 0 }, centerDirty = true;
    function updateBoardCenter(){
      const r = board.getBoundingClientRect();
      boardCenter = { x: r.left + r.width/2, y: r.top + r.height/2 };
      centerDirty = false;
    }
    const markCenterDirty = () => { centerDirty = true; };
    const centerLoop = () => { if (centerDirty) updateBoardCenter(); requestAnimationFrame(centerLoop); };
    requestAnimationFrame(centerLoop);
    window.addEventListener('resize', markCenterDirty, { passive:true });
    document.addEventListener('fullscreenchange', markCenterDirty);
    window.addEventListener('scroll', markCenterDirty, { passive:true });

    // Flow
    async function attemptSubmit(){
      if (locked) return;
      const len = rowLen(GRID[row]); if (len<cols){ flashInvalid(row,'Not enough letters'); return; }
      const guess = GRID[row].join(''); if (!VALID.has(guess)){ flashInvalid(row,'Not in word list'); return; }
      setStatus(''); setHint(''); locked = true;

      const states = scoreGuess(secret, guess);
      updateKeys(guess, states);
      await revealRow(guess, states);

      if (guess === secret) {
        for (let i=0;i<cols;i++) setTimeout(() => tiles[row*cols+i].classList.add('win'), i*64);
        if (centerDirty) updateBoardCenter();
        confetti.burst({ count: assisted ? 140 : 260, from: { x: boardCenter.x, y: boardCenter.y } });
        vibrate([20,30,20]);
        api.setNote(assisted ? 'You win (assisted)! 🎉' : 'You win! 🎉');
        setStatus(`Solved in ${row+1} ${row===0?'try':'tries'}${assisted?' — with help':''}`);
        return; // remain locked after win
      }

      if (row === rows - 1) {
        vibrate(60);
        api.setNote(`The word was ${secret}`);
        setStatus(`Answer: ${secret}`);
        return; // locked
      }

      row++; locked = false; paintRow(row); markCenterDirty(); ensureFocus();
    }

    function revealOneLetter(){
      const len = rowLen(GRID[row]); if (len>=cols){ setStatus('Row is full.'); return; }
      GRID[row][len] = secret[len]; assisted = true; paintRow(row); setStatus('Revealed one letter.');
    }
    function giveUp(){
      if (locked) return;
      locked = true; api.setNote(`Gave up. The word was ${secret}`); setStatus(`Answer: ${secret}`);
      kbd.querySelectorAll('.key').forEach(k => k.disabled = true);
    }
    function restart(){
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) GRID[r][c]='';
      tiles.forEach(t => { t.textContent=''; t.dataset.state=''; t.className='tile'; t.style.removeProperty('--delay'); });
      kbd.querySelectorAll('.key').forEach(k => { k.disabled=false; k.dataset.state='unused'; });
      secret = answersUP[(Math.random()*answersUP.length)|0];
      row=0; locked=false; assisted=false;
      setStatus('Type letters, Enter to submit'); setHint('');
      paintRow(0); markCenterDirty(); ensureFocus();
    }

    // Focus (soft; avoid tug-of-war in fullscreen)
    function canRefocus(){
      if (document.hidden) return false;
      if (document.fullscreenElement && !shadow.contains(document.fullscreenElement)) return false;
      return true;
    }
    function ensureFocus(){ if (!canRefocus()) return; trap.focus(); host.focus(); }
    shadow.addEventListener('pointerdown', ensureFocus, { passive:true });
    trap.addEventListener('blur', () => addTimer(setTimeout(() => ensureFocus(), 0)));

    // Keyboard
    const onKey = (e) => {
      if (e.isComposing) return;
      const k = e.key; const ctrlOrCmd = (e.ctrlKey || e.metaKey) && !isTouch();

      if (ctrlOrCmd) {
        if (k.toLowerCase()==='h'){ e.preventDefault(); showHint(); return; }
        if (k.toLowerCase()==='r'){ e.preventDefault(); revealOneLetter(); return; }
        if (k.toLowerCase()==='g'){ e.preventDefault(); giveUp(); return; }
        if (k.toLowerCase()==='n'){ e.preventDefault(); restart(); return; }
      }

      if (k==='Enter'){ e.preventDefault(); attemptSubmit(); return; }
      if (k==='Backspace'){ e.preventDefault(); backspace(); return; }
      if (/^[a-zA-Z]$/.test(k)){ e.preventDefault(); typeLetter(k.toUpperCase()); return; }
    };
    window.addEventListener('keydown', onKey, true);

    // On-screen keyboard
    kbd.addEventListener('click', (e)=>{
      const btn = e.target.closest('.key'); if (!btn) return;
      const key = btn.dataset.key;
      if (key==='Enter') return attemptSubmit();
      if (key==='Back')  return backspace();
      typeLetter(key.toUpperCase());
    });

    // Buttons
    btnHint.addEventListener('click', showHint);
    btnReveal.addEventListener('click', revealOneLetter);
    btnGiveUp.addEventListener('click', giveUp);
    btnNew.addEventListener('click', restart);

    // Initial
    paintRow(0);
    setStatus('Type letters, Enter to submit');
    markCenterDirty();
    ensureFocus();

    // Pause/clean work on hide/FS change
    const onHidden = () => { if (document.hidden) clearTimers(); };
    const onFSChange = () => { clearTimers(); markCenterDirty(); };
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('fullscreenchange', onFSChange);

    // Cleanup
    return {
      dispose(){
        window.removeEventListener('keydown', onKey, true);
        shadow.removeEventListener('pointerdown', ensureFocus);
        document.removeEventListener('visibilitychange', onHidden);
        document.removeEventListener('fullscreenchange', onFSChange);
        window.removeEventListener('resize', markCenterDirty);
        document.removeEventListener('fullscreenchange', markCenterDirty);
        window.removeEventListener('scroll', markCenterDirty);
        clearTimers();
        confetti.clear();
        confetti.release(); // drop listeners & canvas when last user exits
        host.remove();
      }
    };
  }
};



