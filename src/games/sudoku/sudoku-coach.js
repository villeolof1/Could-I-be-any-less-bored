// sudoku-coach.js — Tutorial / Coach (v7)
// Standalone overlay + gating for Sudoku.
// Depends on nothing except DOM + callbacks provided from sudoku.js.
//
// Export: makeSudokuCoach(options)
//  options = {
//    wrap, board, controls, topbar, statusEl, progressEl,
//    getState(): { N, BR, BC, prefs, isSolved(), hasSelection(), selection(), hotelDigit() },
//    api: { draw(), select(rc), setHotelDigit(n), place(r,c,n), canPlace(r,c,n),
//           focusBoard(), ping(kind), checkWrong(), eraseWrong(), toggleMusic(), toggleSfx(),
//           newGameDaily(), newGameRng(), undo(), redo(), startOver(), showHelpPopover() },
//    text: { setStatus(msg) },
//    timing: { NEXT_APPEAR_MS, AUTO_ADV_IDLE_MS, IDLE_AFTER_INTERACT_MS },
//  }
//
// The coach exposes:
//  { start(fromButton), stop(), isActive(), allow(kind, payload), react(kind), handleResize(), queueReposition() }

export function makeSudokuCoach(opts){
  const {
    wrap, board, controls, topbar, statusEl, progressEl,
    getState, api, text, timing
  } = opts;

  // ---------------- Root nodes ----------------
  const coach = document.createElement('div');
  coach.className = 'sd-coach hidden';
  coach.innerHTML = `
    <svg aria-hidden="true">
      <defs><mask id="sd-mask" maskUnits="userSpaceOnUse">
        <rect x="0" y="0" width="100%" height="100%" fill="white"></rect>
      </mask></defs>
      <rect class="sd-mask-dim sd-mask-blur" x="0" y="0" width="100%" height="100%" mask="url(#sd-mask)"></rect>
    </svg>
  `;
  // coach card
  const coachCard = document.createElement('div');
  coachCard.className = 'sd-coach-card';
  coachCard.style.opacity='0';
  coach.appendChild(coachCard);

  // glowing pointer
  const pointer = document.createElement('div');
  pointer.className = 'sd-pointer';
  coach.appendChild(pointer);

  // CSS (scoped, light)
  const css = document.createElement('style');
  css.textContent = `
  .sd-coach{ position:fixed; inset:0; z-index:9910; pointer-events:none; }
  .sd-coach.hidden{ display:none; }
  .sd-coach svg{ position:absolute; inset:0; width:100%; height:100%; }
  .sd-mask-dim{ fill: rgba(10,14,22,.66); }
  .sd-mask-blur{ filter: var(--blurMask, blur(2px)); }
  .sd-coach-card{
    position:absolute; z-index:9920; pointer-events:auto;
    max-width:min(380px, 92vw); background:rgba(20,24,32,.98); color:var(--fg,#e9ecf4);
    border:1px solid var(--ring,#2c3850); border-radius:12px; padding:10px 12px;
    box-shadow:0 8px 24px rgba(0,0,0,.35); transform-origin: top left;
    transition: transform .16s ease, opacity .16s ease;
  }
  .sd-coach-card h4{ margin:0 0 6px; font-size:14px; }
  .sd-coach-card p{ margin:0 0 8px; font-size:12px; color:var(--muted,#a3acc3); min-height:1.1em; }
  .sd-coach-card .actions{ display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
  .coach-hot{ position:relative; z-index:9930 !important; }

  .sd-coach.dock .sd-coach-card{
    left: 8px !important; right: 8px !important; bottom: 8px !important; top: auto !important;
    max-width: none; width: auto;
  }

  .tw-caret::after{ content:''; display:inline-block; width:6px; height:1em; margin-left:2px; background:currentColor; opacity:.65; animation: twBlink 1s steps(2,end) infinite; vertical-align:-.15em; }
  @keyframes twBlink { 0%,49%{opacity:.0;} 50%,100%{opacity:.65;} }

  /* glowing pointer */
  .sd-pointer{
    position:absolute; width:16px; height:16px; border-radius:50%;
    background: var(--yellow,#ffd447);
    box-shadow: 0 0 12px rgba(255,212,71,.9), 0 0 28px rgba(255,212,71,.7);
    transform: translate(-50%, -50%); pointer-events:none; opacity:0;
    transition: opacity .18s ease, transform .18s ease;
  }
  .sd-pointer.show{ opacity:1; }
  .sd-pointer.pulse{ animation: sdPulse 1.1s ease-in-out infinite; }
  @keyframes sdPulse {
    0%{ transform: translate(-50%,-50%) scale(1.0); }
    50%{ transform: translate(-50%,-50%) scale(1.18); }
    100%{ transform: translate(-50%,-50%) scale(1.0); }
  }
  `;
  document.head.appendChild(css);

  // parent: must live inside the fullscreen element when applicable
  reparentToFullscreenRoot();
  function reparentToFullscreenRoot(){
    const host = document.fullscreenElement || document.body;
    if (coach.parentNode !== host) host.appendChild(coach);
  }
  document.addEventListener('fullscreenchange', ()=>{
    reparentToFullscreenRoot();
    queueReposition();
  });

  // --------------- internal state ----------------
  let active = false;
  let stepIdx = 0;
  let allowFn = null;
  let nextVisible = false;
  let timers = [];
  let lastMsg = '';
  let repositionRAF = null;
  const observed = new Set();
  const ro = new ResizeObserver(()=> queueReposition());

  const pools = makePools();

  // --------------- public api --------------------
  function start(fromButton){
    if(active) stop();
    active = true;
    stepIdx = 0;
    coach.classList.remove('hidden');
    writeStep();
  }
  function stop(){
    active = false;
    coach.classList.add('hidden');
    clearTimers();
    unobserveAll();
    allowFn = null;
    nextVisible = false;
  }
  function isActive(){ return active; }
  function allow(kind, payload){
    if(!active) return true;
    const step = STEPS[stepIdx];
    if(!step) return true;
    if(step.allow) return step.allow(kind, payload)!==false;
    return true;
  }
  function react(kind){
    if(!active) return;
    pools.bump(kind);
    const step = STEPS[stepIdx];
    if(step && typeof step.goal==='function' && step.goal(kind)){
      // wait for idle then auto next
      planAutoAdvance();
    }
    // live copy refresh
    if(step && typeof step.body === 'function'){
      typeInto(coachCard.querySelector('#coach-body'), step.body());
    }
  }
  function queueReposition(){
    if(!active) return;
    if(repositionRAF) cancelAnimationFrame(repositionRAF);
    repositionRAF = requestAnimationFrame(()=> positionCardAndMask());
  }
  function handleResize(){ queueReposition(); }

  // --------------- steps model -------------------
  const STEPS = buildSteps();

  function buildSteps(){
    const s = [];
    // If not fullscreen, begin by nudging to press our Fullscreen button (⛶)
    s.push({
      title: ()=> 'Welcome!',
      body: ()=> pools.pick('intro', [
        'Let’s do a quick guided tour. We’ll point to exactly where to click.',
        'Ready for a smooth tour? We’ll show precisely what to do.'
      ]),
      hot: ()=> [controls, board],
      pointerTo: ()=> {
        const fsBtn = controls.querySelector('.sd-btn[data-coach-fs]');
        return document.fullscreenElement ? board : (fsBtn || controls);
      },
      allow: (k)=> true,
      goal: (k)=>{
        // If already fullscreen, we can continue immediately after 3s.
        if(document.fullscreenElement) return k==='noop' || k==='fullscreen';
        return k==='fullscreen';
      },
      actions: { nextAfter: ()=> document.fullscreenElement ? 1500 : 0 }
    });

    // Select a cell
    s.push({
      title: ()=> 'Select a cell',
      body: ()=> pools.pick('select', [
        'Click any cell to select it. It will glow a little ✨',
        'Tap a square — any square.',
        'Pick a tile to get started.'
      ]),
      hot: ()=> [board],
      pointerTo: ()=> board,
      allow: (k)=> ['cellClick','keydown','mousedown'].includes(k),
      goal: (k)=> k==='cellClick'
    });

    // Place via hotel (instant if selected)
    s.push({
      title: ()=> 'Place a number',
      body: ()=> 'With a cell selected, click a number in the bar to place it instantly.',
      hot: ()=> [board, wrap.querySelector('.sd-hotel')],
      pointerTo: ()=> wrap.querySelector('.sd-hotel .sd-hbtn') || wrap.querySelector('.sd-hotel') || board,
      allow: (k)=> ['hotelClick','cellClick','keydown'].includes(k),
      goal: (k)=> k==='place'
    });

    // Arm a digit, see valid spots
    s.push({
      title: ()=> 'Arm a digit',
      body: ()=> 'Click a number with no cell selected → valid spots glow. Click again to unarm.',
      hot: ()=> [wrap.querySelector('.sd-hotel'), board],
      pointerTo: ()=> wrap.querySelector('.sd-hotel .sd-hbtn') || wrap.querySelector('.sd-hotel') || board,
      allow: (k)=> ['hotelClick','cellClick','keydown'].includes(k),
      goal: (k)=> pools.count('hotel')>0 || k==='place'
    });

    // Candidates (right-click)
    s.push({
      title: ()=> 'Candidates',
      body: ()=> 'Right-click an empty cell to show suggested candidates. Right-click again to toggle.',
      hot: ()=> [board],
      pointerTo: ()=> board,
      allow: (k)=> ['context','cellClick','keydown'].includes(k),
      goal: (k)=> k==='tip'
    });

    // Keyboard movement
    s.push({
      title: ()=> 'Move with keys',
      body: ()=> pools.pick('move', [
        'Use Arrow keys (Home/End/PgUp/PgDn) to roam fast.',
        'Arrow around — smooth 🧊.'
      ]),
      hot: ()=> [board],
      pointerTo: ()=> board,
      allow: (k)=> ['keydown','cellClick'].includes(k),
      goal: (k)=> k==='move'
    });

    // Undo & Redo
    s.push({
      title: ()=> 'Undo / Redo',
      body: ()=> pools.count('undo')===0
          ? 'Try ↩️ Undo — then ↪️ Redo to bring it back.'
          : 'Nice! Undo/Redo are your time machine.',
      hot: ()=> [controls],
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Undo"]') || controls,
      allow: (k)=> ['undo','redo','keydown','cellClick'].includes(k),
      goal: ()=> pools.count('undo')>0 && pools.count('redo')>0
    });

    // Error demo (ask them to intentionally cause a conflict)
    s.push({
      title: ()=> 'What happens on errors',
      body: ()=> 'Try placing a number that conflicts (duplicate in row/col/box). Watch the red scopes — then clear it.',
      hot: ()=> [board],
      pointerTo: ()=> board,
      allow: (k)=> ['place','clear','keydown','cellClick','hotelClick'].includes(k),
      goal: ()=> pools.count('error')>0
    });

    // Plain tools (Check & Erase Wrong)
    s.push({
      title: ()=> 'Plain tools',
      body: ()=> 'With mistake feedback off, use 🧪 Check to highlight wrongs and 🧹 Erase to clear them.',
      hot: ()=> [controls],
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Highlight wrong entries"]') || controls,
      allow: (k)=> ['check','erase','keydown','cellClick'].includes(k),
      goal: (k)=> k==='check' || k==='erase'
    });

    // Daily / Variant / Difficulty
    s.push({
      title: ()=> 'Daily & variants',
      body: ()=> '📅 gives a seeded daily. You can switch variant or difficulty anytime.',
      hot: ()=> [controls],
      pointerTo: ()=> controls,
      allow: ()=> true
    });

    // Music toggle
    s.push({
      title: ()=> 'Chill audio',
      body: ()=> 'Toggle 🎵 for lo-fi music (first tap enables audio).',
      hot: ()=> [controls],
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Toggle music"]') || controls,
      allow: (k)=> k==='music' || k==='sfx' || k==='keydown',
      goal: (k)=> k==='music'
    });

    // Done
    s.push({
      title: ()=> 'You’re set!',
      body: ()=> 'Reopen tutorial any time via 🎓 Tutorial. Have fun!',
      hot: ()=> [controls, board],
      pointerTo: ()=> board,
      allow: ()=> true
    });

    return s;
  }

  // --------------- layout + mask -----------------
  function positionCardAndMask(){
    const step = STEPS[stepIdx];
    if(!step){ return; }

    // build holes
    const svg = coach.querySelector('svg');
    const mask = svg.querySelector('#sd-mask');
    // clear previous rects (keep the base)
    for(let i=mask.children.length-1; i>=0; i--){
      const n = mask.children[i];
      if(n.tagName.toLowerCase()!=='rect' || n.getAttribute('fill')!=='black') continue;
      mask.removeChild(n);
    }
    // remove hot classes
    document.querySelectorAll('.coach-hot').forEach(el=> el.classList.remove('coach-hot'));

    const hotEls = flatten((step.hot?.() || []).map(normalizeEl)).filter(Boolean);
    hotEls.forEach(el=> el.classList.add('coach-hot'));

    const addHole = (el, pad=6)=>{
      const r = el.getBoundingClientRect();
      const hole = document.createElementNS('http://www.w3.org/2000/svg','rect');
      hole.setAttribute('fill','black');
      hole.setAttribute('x', String(Math.max(0, r.left - pad)));
      hole.setAttribute('y', String(Math.max(0, r.top - pad)));
      hole.setAttribute('width', String(r.width + pad*2));
      hole.setAttribute('height', String(r.height + pad*2));
      mask.appendChild(hole);
    };
    if(hotEls.length===0){ addHole(controls); addHole(board); }
    else hotEls.forEach(el=> addHole(el));

    // pointer
    const anchor = normalizeEl(step.pointerTo?.()) || board;
    const ar = anchor.getBoundingClientRect();
    const px = Math.max(8, Math.min(ar.left + ar.width/2, window.innerWidth - 8));
    const py = Math.max(8, Math.min(ar.bottom + 10, window.innerHeight - 8));
    pointer.style.left = px + 'px';
    pointer.style.top  = py + 'px';
    pointer.classList.add('show','pulse');

    // card positioning (score candidates + nudge)
    const dock = (wrap.getBoundingClientRect().width < 480);
    coach.classList.toggle('dock', dock);
    if(dock){
      coachCard.style.left   = (wrap.getBoundingClientRect().left + 8) + 'px';
      coachCard.style.right  = (window.innerWidth - wrap.getBoundingClientRect().right + 8) + 'px';
      coachCard.style.bottom = (window.innerHeight - wrap.getBoundingClientRect().bottom + 8) + 'px';
      coachCard.style.top    = 'auto';
      coachCard.style.opacity='1';
      return;
    }
    const cw = coachCard.offsetWidth || 320;
    const ch = coachCard.offsetHeight || 160;
    const candidates = [
      { x: ar.right + 12, y: ar.top, side:'right' },
      { x: ar.left - cw - 12, y: ar.top, side:'left' },
      { x: ar.left, y: ar.bottom + 12, side:'bottom' },
      { x: ar.left, y: ar.top - ch - 12, side:'top' }
    ];
    const hotRects = hotEls.map(el=> el.getBoundingClientRect());

    function score(p){
      const r = { left:p.x, top:p.y, right:p.x+cw, bottom:p.y+ch };
      let overlap=0;
      hotRects.forEach(hr=> overlap += intersectArea(r, hr));
      const offX = Math.max(0, -r.left) + Math.max(0, r.right - (window.innerWidth-8));
      const offY = Math.max(0, -r.top)  + Math.max(0, r.bottom - (window.innerHeight-8));
      const off = offX*2 + offY*2;
      return -(overlap*10 + off);
    }
    let best=candidates[0], bestScore=-Infinity;
    for(const c of candidates){
      const s = score(c);
      if(s>bestScore){ best=c; bestScore=s; }
    }
    // nudge away from collisions if needed
    let x = best.x, y = best.y;
    const r0 = { left:x, top:y, right:x+cw, bottom:y+ch };
    const collide = hotRects.some(hr=> intersectArea(r0, hr) > 48);
    if(collide){
      if(best.side==='right') x = Math.max(8, ar.right + 12);
      if(best.side==='left')  x = Math.max(8, Math.min(ar.left - cw - 12, window.innerWidth - cw - 8));
      if(best.side==='bottom')y = Math.min(window.innerHeight - ch - 8, ar.bottom + 12);
      if(best.side==='top')   y = Math.max(8, ar.top - ch - 12);
    }
    x = Math.max(8, Math.min(x, window.innerWidth - cw - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - ch - 8));
    coachCard.style.left = x + 'px';
    coachCard.style.top  = y + 'px';
    coachCard.style.right= 'auto';
    coachCard.style.bottom='auto';
    coachCard.style.opacity='1';
  }

  // --------------- write step -------------------
  function writeStep(){
    clearTimers();
    unobserveAll();

    const step = STEPS[stepIdx];
    if(!step){ stop(); return; }

    // card
    const title = step.title?.() || '';
    const body  = (typeof step.body==='function' ? step.body() : (step.body||'')).trim();
    coachCard.innerHTML = `
      <h4>${title}</h4>
      <p id="coach-body" class="${prefersReduced()?'':'tw-caret'}"></p>
      <div class="actions"></div>
    `;
    const bodyEl = coachCard.querySelector('#coach-body');
    typeInto(bodyEl, body);

    // actions
    const actions = coachCard.querySelector('.actions');
    const mkBtn = (emoji,label,title)=>{ const b=document.createElement('button'); b.className='sd-btn'; b.type='button'; b.title=title||label; const i=document.createElement('span'); i.textContent=emoji; const l=document.createElement('span'); l.textContent=label; b.append(i,l); return b; };

    const btnSkip = mkBtn('✕','Skip','Skip tutorial');
    const btnBack = mkBtn('←','Back','Previous');
    const btnNext = mkBtn('→','Next','Next');
    btnBack.disabled = (stepIdx===0);

    btnSkip.addEventListener('click', ()=> stop());
    btnBack.addEventListener('click', ()=>{ stepIdx = Math.max(0, stepIdx-1); writeStep(); });
    btnNext.addEventListener('click', ()=> advance());

    actions.append(btnSkip, btnBack, btnNext);

    // next delay (anti-spam)
    nextVisible = false;
    const openMs = timing?.NEXT_APPEAR_MS ?? 3000;
    timers.push(setTimeout(()=>{ nextVisible=true; refreshActions(); }, openMs));

    function refreshActions(){
      btnNext.disabled = !nextVisible;
      btnBack.disabled = stepIdx===0;
    }

    // mask + pointer + RO
    positionCardAndMask();
    observeHot(step);
    queueReposition();

    // Special: if step expects fullscreen and we’re not there, show pointer over FS button
    if(stepIdx===0){
      if(!document.fullscreenElement){
        // expose event requirement
        pointer.classList.add('show','pulse');
      }
    }
  }

  function advance(){
    if(stepIdx >= STEPS.length-1){ stop(); return; }
    stepIdx++;
    writeStep();
  }

  function planAutoAdvance(){
    const idleMs = timing?.AUTO_ADV_IDLE_MS ?? 4000;
    timers.push(setTimeout(()=> advance(), idleMs));
  }

  function observeHot(step){
    const hotEls = flatten((step.hot?.() || []).map(normalizeEl)).filter(Boolean);
    hotEls.concat([coachCard, wrap]).forEach(el=> { try{ ro.observe(el); observed.add(el); }catch{} });
  }
  function unobserveAll(){
    observed.forEach(n=> ro.unobserve(n));
    observed.clear();
  }
  function clearTimers(){
    timers.forEach(t=> clearTimeout(t));
    timers.length=0;
  }

  // --------------- helpers ----------------------
  function prefersReduced(){ return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
  function typeInto(el, text){
    // never repeat same message twice in a row
    if(text === lastMsg){ return; }
    lastMsg = text;

    if(prefersReduced()){ el.classList.remove('tw-caret'); el.textContent = text; queueReposition(); return; }
    el.textContent='';
    el.classList.add('tw-caret');
    let i=0, cancelled=false;
    function next(){
      if(cancelled) return;
      if(i>=text.length){ el.classList.remove('tw-caret'); queueReposition(); return; }
      el.textContent = text.slice(0, ++i);
      const ch = text[i-1];
      const pause = ('.!?'.includes(ch) ? 200 : 26);
      timers.push(setTimeout(next, pause));
    }
    el.addEventListener('click', ()=>{ cancelled=true; el.textContent=text; el.classList.remove('tw-caret'); queueReposition(); }, { once:true });
    next();
  }

  function normalizeEl(x){
    if(!x) return null;
    if(x instanceof Element) return x;
    if(typeof x==='string') return document.querySelector(x);
    if(Array.isArray(x)) return x[0] || null;
    return null;
  }
  function flatten(a){ return a.reduce((acc,v)=> (Array.isArray(v)? acc.push(...v):acc.push(v), acc), []); }
  function intersectArea(a,b){
    const l = Math.max(a.left, b.left), r = Math.min(a.right, b.right);
    const t = Math.max(a.top, b.top), bt = Math.min(a.bottom, b.bottom);
    const w = Math.max(0, r-l), h = Math.max(0, bt-t);
    return w*h;
  }

  function makePools(){
    const pools = {
      intro:  ["Quick tour incoming.","Guided tour — no guesswork.","Let’s breeze through it."],
      select: ["Click any cell.","Pick a tile.","Tap a square — any square.","Select one to begin."],
      move:   ["Arrow keys glide.","Smooth 🧊","Zoom zoom.","Cruising."],
    };
    const bag = {};
    Object.keys(pools).forEach(k=> bag[k]=shuffleBag(pools[k]));
    const counts = {};
    function shuffleBag(arr){
      const a = arr.slice(); let i=a.length;
      return ()=>{ if(i<=0) i=a.length; const j=Math.floor(Math.random()*i); const v=a[j]; [a[j],a[i-1]]=[a[i-1],a[j]]; i--; return v; };
    }
    return {
      pick(kind, fallback){ const fn = bag[kind]; return fn?fn(): (fallback && fallback[0]) || ''; },
      bump(kind){ counts[kind]=(counts[kind]||0)+1; },
      count(kind){ return counts[kind]||0; }
    };
  }

  // --------------- global event taps ------------
  // intercept fullscreen toggles from outside
  document.addEventListener('fullscreenchange', ()=>{
    if(document.fullscreenElement) react('fullscreen');
    queueReposition();
  });

  // mount once
  // parent chosen in reparentToFullscreenRoot()
  // (no-op if already appended)
  if(!coach.parentNode) reparentToFullscreenRoot();

  return { start, stop, isActive, allow, react, handleResize, queueReposition };
}
