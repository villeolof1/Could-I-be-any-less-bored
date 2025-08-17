// sudoku-coach.js — Coach / Playground (v21)
// -----------------------------------------------------------------------------
// Coach v2: playground-first, fully scripted, no Next/Back, gated inputs,
// short-copy card, creative micro-FX, Face 2.0, polls in-card only.
// Sandboxes a 4×4 blank board; mistake feedback OFF except in "mistakes" step.
// -----------------------------------------------------------------------------
// Public API (unchanged for sudoku.js):
//  { start(fromButton), stop(), isActive(), allow(kind,payload), react(kind),
//    handleResize(), queueReposition() }
//
// Optional sudoku.js hooks (if present; coach will gracefully fallback):
//  api.setPrefs?(patch)                  // deep-merge into prefs, then draw()
//  api.lockInput?(locks)                 // visual/UX locks (board/hotel/toolbar)
//  api.loadSandboxBoard?(grid)           // swap in an empty (or custom) board
//  api.restoreBoard?()                   // restore previously-snapshotted board
//  api.highlight?(cells, styleId)        // pulse borders for "targets"
// -----------------------------------------------------------------------------
// Notes:
// - One fixed overlay; transform-only pointer/card moves; RAF-coalesced.
// - Pointer “yellow dot” kept, plus many new clean FX with reduced-motion fallbacks.
// - Polls & quizzes are *inside* the card (always on top, pointer-events:auto).
// - State safety: prefs/board/selection snapshot & restore.

export function makeSudokuCoach(opts){
  const {
    wrap, board, controls, topbar, statusEl, progressEl,
    getState, api, text, timing
  } = opts;

  // -------------------- Root overlay (single, fixed, always-on-top) -----------
  const coach = document.createElement('div');
  coach.className = 'sd-coach hidden';
  coach.setAttribute('aria-hidden','false');
  coach.innerHTML = `
    <div class="sd-coach-effects" aria-hidden="true"></div>
    <div class="sd-pointer" aria-hidden="true"></div>
    <div class="sd-cardwrap">
      <div class="sd-coach-card" role="dialog" aria-live="polite" aria-modal="false"></div>
    </div>
  `;
  // Mount to FS root or body (never reparent card per step)
  function mountCoach(){
    const host = document.fullscreenElement || document.body;
    if (coach.parentNode !== host) host.appendChild(coach);
  }
  mountCoach();

  // -------------------- CSS (scoped) ------------------------------------------
  const css = document.createElement('style');
  css.textContent = `
  .sd-coach{ position:fixed; inset:0; z-index:10100; pointer-events:none; }
  .sd-coach.hidden{ display:none; }
  .sd-coach-effects{ position:fixed; inset:0; pointer-events:none; z-index:0; }
  .sd-cardwrap{ position:fixed; left:0; top:0; width:0; height:0; pointer-events:none; z-index:2; }
  .sd-coach-card{
    position:absolute; left:0; top:0; transform:translate3d(24px,24px,0);
    will-change: transform, opacity; pointer-events:auto;
    max-width:min(460px, 96vw);
    background:rgba(20,24,32,.98); color:var(--fg,#e9ecf4);
    border:1px solid var(--ring,#2c3850); border-radius:14px; padding:12px 14px 10px;
    box-shadow:0 12px 30px rgba(0,0,0,.38);
    transition: opacity .16s ease, box-shadow .16s ease, transform .16s ease;
  }
  .sd-coach-card .hdr{ display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .sd-coach-card .hdr h4{ margin:0; font-size:14px; }
  .sd-coach-card .body{ font-size:12px; color:var(--muted,#a3acc3); min-height:1.1em; }
  .sd-coach-card .rail{ display:flex; flex-direction:column; gap:4px; margin-top:8px; }

  .sd-bubble{ font-size:11px; color:#cfe2ff; background:rgba(130,170,255,.12); border:1px solid rgba(130,170,255,.25);
              padding:6px 8px; border-radius:10px; opacity:0; transform:translateY(4px);
              animation: sdBubbleIn 220ms ease-out forwards; }
  @keyframes sdBubbleIn { to{ opacity:1; transform:translateY(0);} }
  .sd-bubble.fade{ animation: sdBubbleOut 400ms ease-in forwards; }
  @keyframes sdBubbleOut { to{ opacity:0; transform:translateY(-3px);} }
  .sd-coach-card.flash{ box-shadow:0 12px 30px rgba(0,0,0,.38), 0 0 0 2px rgba(255,255,255,.06) inset, 0 0 28px rgba(130,200,255,.35); }

  /* pointer (yellow dot) */
  .sd-pointer{
    position:fixed; left:0; top:0; width:16px; height:16px; border-radius:50%;
    background: var(--yellow,#ffd447);
    box-shadow: 0 0 12px rgba(255,212,71,.9), 0 0 28px rgba(255,212,71,.7);
    transform: translate3d(-9999px,-9999px,0); opacity:0; will-change: transform, opacity;
    transition: opacity .22s ease; z-index:1; pointer-events:none;
  }
  .sd-pointer.show{ opacity:1; }
  .sd-pointer.pulse{ animation: sdPulse 1.1s ease-in-out infinite; }
  @keyframes sdPulse {
    0%{ transform: translate3d(var(--px,-9999px), var(--py,-9999px), 0) scale(1.0); }
    50%{ transform: translate3d(var(--px,-9999px), var(--py,-9999px), 0) scale(1.18); }
    100%{ transform: translate3d(var(--px,-9999px), var(--py,-9999px), 0) scale(1.0); }
  }

  /* Face 2.0 (more expressive) */
  .sd-face{ flex:0 0 auto; }
  .sd-face .cans{ opacity:0; transform-origin:50% 0%; }
  .sd-face.headbob{ animation: headBob 900ms ease-in-out 2; }
  @keyframes headBob{ 0%{ transform:translateY(0) } 50%{ transform:translateY(-1.2px)} 100%{ transform:translateY(0)} }

  /* slim timer bar */
  .slimtimer{ position:relative; height:4px; border-radius:999px; background:rgba(255,255,255,.06); overflow:hidden; margin:8px 0 2px; display:none; }
  .slimtimer .fill{ position:absolute; left:0; top:0; bottom:0; width:0%; background:linear-gradient(90deg, #86b4ff, #a5e8ff); transition: width .12s linear; }

  /* Dock on narrow */
  .sd-coach.dock .sd-coach-card{ transform:translate3d(var(--dockX,16px), var(--dockY,0px), 0); max-width: none; width: calc(100vw - 24px); }

  /* FX elements (new + existing) */
  .fx-beacon{ position:fixed; width:28px; height:28px; border-radius:50%; pointer-events:none; border:2px solid rgba(130,200,255,.9); box-shadow:0 0 18px rgba(130,200,255,.55); transform:translate3d(-9999px,-9999px,0) scale(.6); opacity:0; }
  .fx-beacon.show{ animation: fxBeacon 1.2s ease-in-out infinite; }
  @keyframes fxBeacon{ 0%{ opacity:.9; transform:translate3d(var(--px),var(--py),0) scale(.65); } 50%{ opacity:.5; transform:translate3d(var(--px),var(--py),0) scale(1.0);} 100%{ opacity:0.3; transform:translate3d(var(--px),var(--py),0) scale(1.15);} }

  .fx-pencil{ position:fixed; border:2px solid rgba(200,220,255,.6); border-radius:10px; pointer-events:none; opacity:.0; }
  .fx-pencil.draw{ animation: fxSketch 380ms ease-out forwards; }
  @keyframes fxSketch{ 0%{ opacity:.0; } 30%{ opacity:.9; } 100%{ opacity:.0; } }

  .fx-scan{ position:fixed; height:8px; pointer-events:none; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(130,200,255,.18), rgba(255,255,255,0)); opacity:.0; }
  .fx-scan.show{ animation: fxScan 650ms ease-out forwards; }
  @keyframes fxScan{ 0%{ opacity:.0; transform:translateX(-160px) } 10%{ opacity:1 } 100%{ opacity:0; transform:translateX(160px) } }

  .fx-chalk{ position:fixed; width:4px; height:4px; border-radius:50%; background:rgba(210,230,255,.85); opacity:0; }
  .fx-chalk.puff{ animation: fxChalk 620ms ease-out forwards; }
  @keyframes fxChalk{ 0%{ opacity:.9; transform:translate(var(--px),var(--py)) scale(.9) } 100%{ opacity:0; transform:translate(calc(var(--px) + var(--dx,0px)), calc(var(--py) - 18px)) scale(1.2) } }

  .fx-ribbon{ position:fixed; height:3px; border-radius:999px; background:linear-gradient(90deg, rgba(130,200,255,.0), rgba(130,200,255,.6), rgba(130,200,255,.0)); opacity:0; transform-origin:left center; }
  .fx-ribbon.show{ animation: fxRibbon 350ms ease-out forwards; }
  @keyframes fxRibbon{ 0%{ opacity:0; } 20%{ opacity:1; } 100%{ opacity:0; } }

  .fx-iris{ position:fixed; inset:0; pointer-events:none; background: rgba(10,14,22,.66); }
  .fx-iris .hole{ position:absolute; border-radius:10px; box-shadow:0 0 0 9999px rgba(10,14,22,.66); }

  .fx-bloom{ position:fixed; font-size:10px; pointer-events:none; opacity:0; }
  .fx-bloom.pop{ animation: fxBloom 420ms ease-out forwards; }
  @keyframes fxBloom{ 0%{ opacity:.0; transform:translate(var(--px),var(--py)) scale(.9) rotate(-6deg) }
                       50%{ opacity:1; }
                       100%{ opacity:0; transform:translate(calc(var(--px) + var(--dx,0px)), calc(var(--py) + var(--dy,0px))) scale(1.3) rotate(0deg) } }

  .fx-wire{ position:fixed; border:2px solid rgba(130,200,255,.28); border-radius:8px; opacity:0; }
  .fx-wire.pulse{ animation: fxWire 480ms ease-out forwards; }
  @keyframes fxWire{ 0%{ opacity:.0; } 30%{ opacity:.8; } 100%{ opacity:.0; } }

  .fx-ink{ position:fixed; width:24px; height:24px; border-radius:50%; pointer-events:none;
           background: radial-gradient(circle, rgba(200,220,255,.25) 0%, rgba(200,220,255,0) 70%); opacity:0; }
  .fx-ink.ripple{ animation: fxInk 500ms ease-out forwards; }
  @keyframes fxInk{ 0%{ opacity:0; transform:scale(.6) translate(var(--px),var(--py)) } 40%{ opacity:.8 } 100%{ opacity:0; transform:scale(1.8) translate(var(--px),var(--py)) } }

  /* reduced motion */
  @media (prefers-reduced-motion: reduce){
    .sd-pointer.pulse{ animation:none; }
    .sd-face.headbob{ animation:none; }
    .fx-beacon.show, .fx-scan.show, .fx-ribbon.show{ animation:none; opacity:.6; }
    .fx-pencil.draw, .fx-wire.pulse, .fx-bloom.pop, .fx-ink.ripple{ animation:none; opacity:.35; }
  }
  `;
  document.head.appendChild(css);

  // -------------------- Face 2.0 (inline SVG) ---------------------------------
  const faceSVG = `
    <svg class="sd-face" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2a3346"/>
          <stop offset="100%" stop-color="#1b2230"/>
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#g1)" stroke="rgba(44,56,80,1)" />
      <!-- eyes -->
      <circle class="eye eyeL" cx="11" cy="13" r="2.2" fill="#fff"/>
      <circle class="eye eyeR" cx="21" cy="13" r="2.2" fill="#fff"/>
      <!-- pupils -->
      <circle class="pupil pupilL" cx="11" cy="13" r="1.1" fill="#1b2230"/>
      <circle class="pupil pupilR" cx="21" cy="13" r="1.1" fill="#1b2230"/>
      <!-- lids (for analyze/narrow) -->
      <rect class="lid lidT" x="9" y="11.2" width="14" height="0.0" rx="0.8" fill="#2a3346" opacity=".9"/>
      <rect class="lid lidB" x="9" y="14.8" width="14" height="0.0" rx="0.8" fill="#2a3346" opacity=".9"/>
      <!-- brows -->
      <rect class="brow browL" x="7.5" y="8.4" width="7" height="1.6" rx="0.8" fill="#cfe2ff" opacity=".7"/>
      <rect class="brow browR" x="17.5" y="8.4" width="7" height="1.6" rx="0.8" fill="#cfe2ff" opacity=".7"/>
      <!-- mouth (moods) -->
      <path class="mouth" d="M10,20 C13,24 19,24 22,20" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
      <!-- headphones + eq -->
      <g class="cans" transform="translate(0,-1)">
        <rect x="6" y="7" width="4" height="7" rx="1.2" fill="#cfe2ff" opacity=".85"/>
        <rect x="22" y="7" width="4" height="7" rx="1.2" fill="#cfe2ff" opacity=".85"/>
        <path d="M10,7 C10,4 22,4 22,7" stroke="#cfe2ff" stroke-width="2" fill="none" opacity=".85"/>
      </g>
      <g class="eq" opacity="0">
        <rect class="e1" x="14" y="24" width="1.2" height="5" rx="0.6" fill="#cfe2ff"/>
        <rect class="e2" x="16" y="22" width="1.2" height="7" rx="0.6" fill="#cfe2ff"/>
        <rect class="e3" x="18" y="24" width="1.2" height="5" rx="0.6" fill="#cfe2ff"/>
      </g>
    </svg>
  `;

  const effectsLayer = coach.querySelector('.sd-coach-effects');
  const pointer = coach.querySelector('.sd-pointer');
  const cardWrap = coach.querySelector('.sd-cardwrap');
  const card = coach.querySelector('.sd-coach-card');

  // -------------------- State & perf guards ------------------------------------
  let active = false;
  let stepIdx = 0;
  const STEPS = [];
  let timers = [];
  let raf = null;
  let anchorEl = null;
  let pointerMode = 'anchor'; // 'anchor' | 'hidden'
  let lastAnchorRect = {x:0,y:0,w:0,h:0};
  let dock = false;

  const pools = makePools();
  let lastMsg = '';
  let eqPulseTO = null;
  let blinkTO = null;
  let preserve = { prefs:null, selection:null, sandbox:false, restored:false };
  let stepDone = new Set(); // per-step done flags

  // -------------------- Layout / Reposition (RAF, transforms) ------------------
  const ro = new ResizeObserver(()=> queueReposition());
  try{ ro.observe(wrap); ro.observe(board); ro.observe(controls); }catch{}
  document.addEventListener('scroll', ()=> queueReposition(), { passive:true });
  document.addEventListener('fullscreenchange', ()=> { mountCoach(); queueReposition(); });

  function queueReposition(){ if(!active) return; if(raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(reposition); }

  function reposition(){
    raf = null;
    dock = (wrap.getBoundingClientRect().width < 520);
    coach.classList.toggle('dock', dock);

    if(pointerMode==='anchor' && anchorEl){
      const ar = anchorEl.getBoundingClientRect();
      if(changed(ar, lastAnchorRect, 0.5)){
        lastAnchorRect = { x:ar.left, y:ar.top, w:ar.width, h:ar.height };
        const px = clamp(ar.left + ar.width/2, 8, window.innerWidth-8);
        const py = clamp(ar.bottom + 14, 8, window.innerHeight-8);
        pointer.style.setProperty('--px', px+'px');
        pointer.style.setProperty('--py', py+'px');
        pointer.style.transform = `translate3d(${px}px, ${py}px, 0)`;
        eyeTrackTo(px, py);
      }
    }
    // Position card
    const target = anchorEl || controls || board;
    const ar = (target && target.getBoundingClientRect()) || {left:16, top:16, width:1, height:1, right:200, bottom:200};
    const cw = card.offsetWidth || 360;
    const ch = card.offsetHeight || 200;

    const candidates = dock
      ? [{ x: wrap.getBoundingClientRect().left+12, y: Math.max(8, window.innerHeight - ch - 8), side:'dock'}]
      : [
          { x: ar.right + 12, y: ar.top, side:'right' },
          { x: ar.left - cw - 12, y: ar.top, side:'left' },
          { x: ar.left, y: ar.bottom + 12, side:'bottom' },
          { x: ar.left, y: ar.top - ch - 12, side:'top' }
        ];

    const hotRects = hotRectsForStep();
    function score(p){
      const r = { left:p.x, top:p.y, right:p.x+cw, bottom:p.y+ch };
      let overlap=0; hotRects.forEach(hr=> overlap += intersectArea(r, hr));
      const offX = Math.max(0, -r.left) + Math.max(0, r.right - (window.innerWidth-8));
      const offY = Math.max(0, -r.top)  + Math.max(0, r.bottom - (window.innerHeight-8));
      return -(overlap*10 + (offX*2 + offY*2));
    }
    let best = candidates[0], bestScore = -Infinity;
    for(const c of candidates){ const s = score(c); if(s>bestScore){ best=c; bestScore=s; } }
    const x = clamp(best.x, 8, window.innerWidth - cw - 8);
    const y = clamp(best.y, 8, window.innerHeight - ch - 8);
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    cardWrap.style.setProperty('--dockX', '12px');
    cardWrap.style.setProperty('--dockY', (window.innerHeight - ch - 12) + 'px');
  }

  function hotRectsForStep(){
    const step = STEPS[stepIdx];
    const hotEls = normalizeEls(step?.hot?.() || [board, controls]);
    return hotEls.map(el=> el.getBoundingClientRect());
  }

  // -------------------- Card writing (typewriter, stable height) ---------------
  function writeCard(title, textBody, {poll=null, timerBar=null}={}){
    card.onmousedown = (e)=> e.stopPropagation();
    card.onpointerdown = (e)=> e.stopPropagation();

    card.innerHTML = `
      <div class="hdr">${faceSVG}<h4>${title||''}</h4></div>
      <div class="slimtimer" style="display:${timerBar?'block':'none'}"><div class="fill"></div></div>
      <div class="body"></div>
      <div class="rail"></div>
    `;
    const bodyEl = card.querySelector('.body');
    bodyEl.style.minHeight = measureTextHeight(textBody) + 'px';
    typeInto(bodyEl, (textBody||'').trim());
    if(poll) renderPoll(poll);
    microFlash();
    scheduleBlink();

    if(timerBar){
      const fill = card.querySelector('.slimtimer .fill');
      const t0 = performance.now();
      const total = Math.max(0, timerBar.ms||4000);
      (function step(){
        if(!fill) return;
        const p = Math.min(1, (performance.now()-t0)/total);
        fill.style.width = (p*100)+'%';
        if(p<1) requestAnimationFrame(step);
      })();
    }
  }
  function renderPoll({ question, options, onAnswer }){
    const poll = document.createElement('div');
    poll.className='poll';
    poll.innerHTML = `<p class="q" style="margin:0 0 6px;font-size:12px;">${question}</p><div class="opts" role="radiogroup" style="display:flex;gap:6px;flex-wrap:wrap;"></div>`;
    const wrapOpts = poll.querySelector('.opts');
    options.forEach((opt)=> {
      const b = document.createElement('button');
      b.type='button'; b.className='opt'; b.setAttribute('role','radio');
      b.setAttribute('aria-pressed','false'); b.textContent = opt.label;
      b.style.cssText = 'padding:6px 8px;border-radius:10px;border:1px solid var(--ring,#2c3850);background:rgba(255,255,255,.06);cursor:pointer;font-size:12px;user-select:none;';
      b.addEventListener('click', ()=>{
        wrapOpts.querySelectorAll('.opt').forEach(x=> x.setAttribute('aria-pressed','false'));
        b.setAttribute('aria-pressed','true');
        const prev = getState()?.selection || null;
        Promise.resolve(onAnswer(opt.value)).finally(()=>{ if(prev && api?.select) api.select(prev); });
      });
      wrapOpts.appendChild(b);
    });
    card.querySelector('.rail').appendChild(poll);
  }

  function typeInto(el, text){
    if(text === lastMsg){ el.textContent = text; return; }
    lastMsg = text;
    if(prefersReducedMotion()){ el.textContent = text; visemeTick('stop'); return; }
    el.textContent=''; let i=0, cancelled=false;
    visemeTick('start');
    function next(){
      if(cancelled) return;
      if(i>=text.length){ visemeTick('stop'); return; }
      el.textContent = text.slice(0, ++i);
      const ch = text[i-1];
      const pause = ('.!?'.includes(ch) ? 150 : 18);
      timers.push(setTimeout(next, pause));
    }
    el.addEventListener('click', ()=>{ cancelled=true; el.textContent=text; visemeTick('stop'); }, { once:true });
    next();
  }
  function measureTextHeight(text){
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute; left:-9999px; top:-9999px; width:280px; font-size:12px; line-height:1.35; white-space:pre-wrap;';
    tmp.textContent = text || '';
    document.body.appendChild(tmp);
    const h = tmp.getBoundingClientRect().height|0; tmp.remove();
    return Math.max(18, h);
  }

  // -------------------- Gating & events ----------------------------------------
  let allowedKinds = null;
  function setGate(kinds){ allowedKinds = new Set(kinds || []); }
  function allow(kind){
    if(!active) return true;
    // normalize here too (in case sudoku.js still sends 'select')
    if(kind==='select') kind='cellClick';
    if(!allowedKinds) return true;
    const ok = allowedKinds.has(kind);
    if(!ok){
      const key = `nudge:${stepIdx}:${kind}`;
      if(!stepDone.has(key)){ stepDone.add(key); bubble(offpathQuip(kind)); }
      return false;
    }
    return true;
  }

  function offpathQuip(kind){
    const map = {
      undo: "Undo’s coming up.",
      redo: "Redo’s next.",
      hint: "Hints soon.",
      hotelClick: "Hold — digits in a sec.",
      check: "That’s later.",
      erase: "We’ll erase soon.",
      music: "We’ll jam later 🎧",
      sfx: "Clicks later.",
      variant: "Variants peek later.",
      daily: "Daily is later.",
      startOver: "Almost there.",
    };
    return map[kind] || "One thing at a time.";
  }

  function advanceAfter(ms){ timers.push(setTimeout(()=> advance(), ms)); }
  function advance(){
    const cur = STEPS[stepIdx]; cur?.onExit?.();
    if(stepIdx >= STEPS.length-1){ stop(); return; }
    stepIdx++; stepDone.add(`entered:${stepIdx}`);
    const nx = STEPS[stepIdx]; nx?.onEnter?.();
    queueReposition();
  }

  // -------------------- Public API ---------------------------------------------
  function start(){
    if(active) stop();
    active = true;
    stepIdx = 0; stepDone.clear();
    preserve.selection = getState()?.selection || null;
    preserve.prefs = clonePrefs(getState()?.prefs || null);
    preserve.sandbox = false; preserve.restored = false;

    coach.classList.remove('hidden');
    writeStep(true);
    queueReposition();
  }
  function stop(){
    active = false;
    clearTimers();
    card.innerHTML = '';
    coach.classList.add('hidden');
    effectsLayer.innerHTML=''; pointer.classList.remove('show','pulse');
    pointerMode='anchor'; lastMsg='';
    // restore prefs/locks/board
    if(preserve.prefs && api?.setPrefs) api.setPrefs(preserve.prefs);
    if(api?.lockInput) api.lockInput(null);
    if(api?.restoreBoard && !preserve.restored){ try{ api.restoreBoard(); }catch{} preserve.restored=true; }
  }
  function isActive(){ return active; }
  function react(kind){
    if(!active) return;
    // normalize incoming kind for goals
    if(kind==='select') kind='cellClick';
    pools.bump(kind);

    // Face reactions
    if(kind==='music'){ setMood('loud'); cansVisible(true); card.classList.add('shake'); faceHeadBob(); setTimeout(()=>{ card.classList.remove('shake'); setMood('happy'); }, 720); eqPulse(); }
    if(kind==='undo'){ coachFx.emit('chevron', anchorEl||board, {dir:'left'}); eyesGlance('left'); }
    if(kind==='redo'){ coachFx.emit('chevron', anchorEl||board, {dir:'right'}); eyesGlance('right'); }
    if(kind==='hint'){ setMood('think'); }
    if(kind==='check'){ setMood('analyze'); lidsNarrow(true); setTimeout(()=> lidsNarrow(false), 700); }
    if(kind==='erase'){ mouthShape('o'); setTimeout(()=> setMood('happy'), 500); }

    const step = STEPS[stepIdx];
    const line = reactionLine(kind, pools.count(kind)); if(line) bubble(line, 1600);

    if(step && typeof step.goal==='function' && step.goal(kind)){
      const onceKey = `goal:${stepIdx}`;
      if(!stepDone.has(onceKey)){ stepDone.add(onceKey); advanceAfter(rand(1100,1600)); }
    }

    if(step && typeof step.body==='function'){
      const body = card.querySelector('.body');
      const txt = step.body(); if(body && txt && txt!==lastMsg){ typeInto(body, txt); }
    }
  }
  function handleResize(){ queueReposition(); }
  function queueRepositionPublic(){ queueReposition(); }
  function allowPublic(kind,payload){ return allow(kind,payload); }

  // -------------------- Build steps (S0..S14) ----------------------------------
  buildSteps();

  function writeStep(initial=false){
    clearTimers();
    const s = STEPS[stepIdx]; if(!s) { stop(); return; }
    if(s.pointer==='hidden'){ pointerMode='hidden'; pointer.classList.remove('show','pulse'); }
    else { pointerMode='anchor'; pointer.classList.add('show','pulse'); }
    anchorEl = normalizeEl(s.pointerTo?.()) || board;
    queueReposition();
    s.onEnter?.();
  }

  function buildSteps(){
    const T = timing || {};
    const NEXT = clamp(T.NEXT_APPEAR_MS ?? 1800, 600, 3000);

    // S0 — Welcome
    STEPS.push({
      id:'welcome',
      title: ()=> 'Welcome!',
      body: ()=> 'Fullscreen gives you a clearer view. Optional, but nice.',
      hot: ()=> [controls, board],
      pointer: 'anchor',
      pointerTo: ()=> (!document.fullscreenElement
                        ? controls.querySelector('.sd-btn[title^="Toggle fullscreen"]') || controls
                        : board),
      onEnter: ()=>{
        setGate(['fullscreen','noop','music','sfx']);
        setMood(document.fullscreenElement?'happy':'think');
        writeCard('Welcome!', 'Fullscreen gives you a clearer view. Optional, but nice.');
        if(document.fullscreenElement){ advanceAfter(1200); }
        else { advanceAfter(4800); }
      },
      goal: (k)=> (document.fullscreenElement ? (k==='noop'||k==='fullscreen') : k==='fullscreen')
    });

    // S1 — Pick a cell (blank 4×4 sandbox)
    STEPS.push({
      id:'pick',
      title: ()=> 'Pick a square',
      body: ()=> 'Click any square.',
      hot: ()=> [board],
      pointer: 'anchor',
      pointerTo: ()=> board,
      onEnter: async ()=>{
        await ensureSandboxEmpty4();
        sandboxPrefs({ help:{ mistakeFeedback:false, showValidOnHotel:true, sameDigit:true, showRowColBars:true, hints:true } });
        if(api?.lockInput) api.lockInput({ board:false, hotel:true, toolbar:true });
        setGate(['cellClick','move','music','sfx']);
        writeCard('Pick a square', 'Click any square.');
      },
      goal: (k)=> (k==='cellClick' || k==='move')
    });

    // S2 — Arrow glide
    STEPS.push({
      id:'glide',
      title: ()=> 'Arrow glide',
      body: ()=> 'Use arrows to reach the glowing square. Click works too.',
      hot: ()=> [board],
      pointer: 'hidden',
      pointerTo: ()=> null,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:true, toolbar:true });
        setGate(['keydown','cellClick','move','music','sfx']);
        const target = pickTargetCell();
        highlightTarget(target, 10000);
        writeCard('Arrow glide', 'Use arrows to reach the glowing square. Click works too.', { timerBar:{ms:10000} });
      },
      goal: ()=> {
        const sel = getState()?.selection, t=currentTarget;
        return !!(sel && t && sel.r===t.r && sel.c===t.c);
      }
    });

    // S3 — Place (select + hotel)
    STEPS.push({
      id:'place1',
      title: ()=> 'Place a number',
      body: ()=> 'Select a square, then click a digit.',
      hot: ()=> [board, wrap.querySelector('.sd-hotel')],
      pointer: 'anchor',
      pointerTo: ()=> wrap.querySelector('.sd-hotel') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:false, toolbar:true });
        setGate(['hotelClick','place','cellClick','music','sfx']);
        writeCard('Place a number', 'Select a square, then click a digit.');
      },
      goal: (k)=> (k==='place')
    });

    // S3b — Poll: another way?
    STEPS.push({
      id:'place1poll',
      title: ()=> 'Another way?',
      body: ()=> 'Want another way to place?',
      hot: ()=> [board, wrap.querySelector('.sd-hotel')],
      pointer: 'anchor',
      pointerTo: ()=> wrap.querySelector('.sd-hotel') || board,
      onEnter: ()=>{
        setGate(['hotelClick','place','cellClick','music','sfx']);
        writeCard('Another way?', 'Want another way to place?', {
          poll: {
            question: 'See another way to place?',
            options: [{label:'Yes', value:'yes'}, {label:'No', value:'no'}],
            onAnswer: (v)=> { if(v==='no'){ stepIdx+=1; } advance(); } // skip S4 if "No"
          },
          timerBar:{ms:5000}
        });
        advanceAfter(5200); // default Yes
      },
      goal: ()=> true
    });

    // S4 — Place (arm digit + tap)
    STEPS.push({
      id:'place2',
      title: ()=> 'Arm + tap',
      body: ()=> 'With no selection, click a digit to arm it, then tap a glowing spot.',
      hot: ()=> [board, wrap.querySelector('.sd-hotel')],
      pointer: 'anchor',
      pointerTo: ()=> wrap.querySelector('.sd-hotel') || board,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:false, toolbar:true });
        setGate(['hotelClick','place','cellClick','music','sfx']);
        writeCard('Arm + tap', 'With no selection, click a digit to arm it, then tap a glowing spot.');
      },
      goal: (k)=> (k==='place')
    });

    // S4b — Poll: another?
    STEPS.push({
      id:'place2poll',
      title: ()=> 'Another?',
      body: ()=> 'Want one more method?',
      hot: ()=> [board, wrap.querySelector('.sd-hotel')],
      pointer: 'anchor',
      pointerTo: ()=> wrap.querySelector('.sd-hotel') || board,
      onEnter: ()=>{
        setGate(['hotelClick','place','cellClick','music','sfx']);
        writeCard('Another?', 'Want one more method?', {
          poll: {
            question: 'Keyboard/Drag too?',
            options: [{label:'Yes', value:'yes'}, {label:'No', value:'no'}],
            onAnswer: (v)=> { if(v==='no'){ stepIdx+=2; } advance(); } // skip S5,S5c if "No"
          },
          timerBar:{ms:5000}
        });
        advanceAfter(5200);
      },
      goal: ()=> true
    });

    // S5 — Place (drag & drop)
    STEPS.push({
      id:'place3',
      title: ()=> 'Drag & drop',
      body: ()=> 'Drag a digit from the hotel onto a square.',
      hot: ()=> [wrap.querySelector('.sd-hotel'), board],
      pointer: 'anchor',
      pointerTo: ()=> wrap.querySelector('.sd-hotel') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:false, toolbar:true });
        setGate(['dropPlace','place','music','sfx']);
        writeCard('Drag & drop', 'Drag a digit from the hotel onto a square.');
      },
      goal: (k)=> (k==='dropPlace' || k==='place')
    });

    // S5c — Place (keyboard)
    STEPS.push({
      id:'place4',
      title: ()=> 'Keyboard digits',
      body: ()=> 'Select a square, then press 1–4.',
      hot: ()=> [board],
      pointer: 'anchor',
      pointerTo: ()=> board,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:true, toolbar:true });
        setGate(['keydown','place','music','sfx','move','cellClick']);
        writeCard('Keyboard digits', 'Select a square, then press 1–4.');
      },
      goal: (k)=> (k==='place')
    });

    // S6 — Clear
    STEPS.push({
      id:'clear',
      title: ()=> 'Erase',
      body: ()=> 'Backspace/Delete (or ×) clears a square.',
      hot: ()=> [board, wrap.querySelector('.sd-hotel')],
      pointer: 'anchor',
      pointerTo: ()=> wrap.querySelector('.sd-hotel') || board,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:false, toolbar:true });
        setGate(['clear','music','sfx','cellClick']);
        writeCard('Erase', 'Backspace/Delete (or ×) clears a square.');
      },
      goal: (k)=> (k==='clear')
    });

    // S7 — Candidates
    STEPS.push({
      id:'cands',
      title: ()=> 'Notes',
      body: ()=> 'Right-click an empty square to toggle notes.',
      hot: ()=> [board],
      pointer: 'anchor',
      pointerTo: ()=> board,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:true, toolbar:true });
        setGate(['context','tip','cellClick','music','sfx']);
        writeCard('Notes', 'Right-click an empty square to toggle notes.');
      },
      goal: (k)=> (k==='tip')
    });

    // S8 — Undo then Redo
    STEPS.push({
      id:'undo',
      title: ()=> 'Undo',
      body: ()=> 'Tap ↩️ Undo once.',
      hot: ()=> [controls],
      pointer: 'anchor',
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Undo"]') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:true, hotel:true, toolbar:{ allow:['Undo'] } });
        setGate(['undo','music','sfx']);
        writeCard('Undo', 'Tap ↩️ Undo once.');
      },
      goal: (k)=> (k==='undo'),
      onExit: ()=>{}
    });
    STEPS.push({
      id:'redo',
      title: ()=> 'Redo',
      body: ()=> 'Now ↪️ Redo.',
      hot: ()=> [controls],
      pointer: 'anchor',
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Redo"]') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:true, hotel:true, toolbar:{ allow:['Redo'] } });
        setGate(['redo','music','sfx']);
        writeCard('Redo', 'Now ↪️ Redo.');
      },
      goal: (k)=> (k==='redo')
    });

    // S9 — Mistakes demo (feedback ON briefly)
    STEPS.push({
      id:'mistakes',
      title: ()=> 'Mistakes',
      body: ()=> 'Try a conflicting number to see scopes and a gentle fade.',
      hot: ()=> [board],
      pointer: 'anchor',
      pointerTo: ()=> board,
      onEnter: ()=>{
        sandboxPrefs({ help:{ mistakeFeedback:true } });
        if(api?.lockInput) api.lockInput({ board:false, hotel:false, toolbar:true });
        setGate(['place','hotelClick','dropPlace','cellClick','error','music','sfx']);
        writeCard('Mistakes', 'Try a conflicting number to see scopes and a gentle fade.');
      },
      goal: (k)=> (k==='error'),
      onExit: ()=> sandboxPrefs({ help:{ mistakeFeedback:false } })
    });

    // S10 — Check & Erase (plain)
    STEPS.push({
      id:'plain',
      title: ()=> 'Check → Erase',
      body: ()=> 'With feedback OFF: Check highlights wrongs; Erase clears them.',
      hot: ()=> [controls],
      pointer: 'anchor',
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Highlight wrong entries"]') || controls,
      onEnter: ()=>{
        sandboxPrefs({ help:{ mistakeFeedback:false } });
        if(api?.lockInput) api.lockInput({ board:true, hotel:true, toolbar:{ allow:['Check','Erase'] } });
        setGate(['check','erase','music','sfx']);
        writeCard('Check → Erase', 'With feedback OFF: Check highlights wrongs; Erase clears them.');
      },
      goal: (k)=> (pools.count('check')>0 && pools.count('erase')>0)
    });

    // S11 — Hint
    STEPS.push({
      id:'hint',
      title: ()=> 'Hint',
      body: ()=> 'Tap 💡 Hint once.',
      hot: ()=> [controls],
      pointer: 'anchor',
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Smart hint"]') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:false, hotel:false, toolbar:{ allow:['Hint'] } });
        setGate(['hint','place','music','sfx']);
        writeCard('Hint', 'Tap 💡 Hint once.');
      },
      goal: (k)=> (k==='hint')
    });

    // S12 — Variants & Daily (peek)
    STEPS.push({
      id:'variants',
      title: ()=> 'Variants / Daily',
      body: ()=> 'Peek variants or Daily — or watch a quick demo.',
      hot: ()=> [controls],
      pointer: 'anchor',
      pointerTo: ()=> controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:true, hotel:true, toolbar:{ allow:['Daily'] } });
        setGate(['variant','daily','diff','music','sfx']);
        writeCard('Variants / Daily', 'Peek variants or Daily — or watch a quick demo.');
        tryAutoCycleVariants();
        advanceAfter(4200);
      },
      onExit: ()=> stopVariantCycle(),
      goal: (k)=> (k==='variant' || k==='daily' || k==='diff')
    });

    // S13 — Audio
    STEPS.push({
      id:'audio',
      title: ()=> 'Chill audio',
      body: ()=> 'Toggle 🎵 once.',
      hot: ()=> [controls],
      pointer: 'anchor',
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Toggle music"]') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:true, hotel:true, toolbar:{ allow:['Music','SFX'] } });
        setGate(['music','sfx']);
        writeCard('Chill audio', 'Toggle 🎵 once.');
      },
      goal: (k)=> (k==='music')
    });

    // S14 — Finish
    STEPS.push({
      id:'finish',
      title: ()=> 'All set!',
      body: ()=> 'Restart this tour anytime from ⚙️ Help.',
      hot: ()=> [controls, board],
      pointer: 'anchor',
      pointerTo: ()=> controls.querySelector('.sd-btn[title^="Help"]') || controls,
      onEnter: ()=>{
        if(api?.lockInput) api.lockInput({ board:true, hotel:true, toolbar:{ allow:['Help'] } });
        setGate(['settings','music','sfx','noop']);
        writeCard('All set!', 'Restart this tour anytime from ⚙️ Help.');
        // restore board when exiting this step
        advanceAfter(2200);
      },
      onExit: ()=>{
        if(api?.restoreBoard && !preserve.restored){ try{ api.restoreBoard(); }catch{} preserve.restored=true; }
        if(preserve.prefs && api?.setPrefs) api.setPrefs(preserve.prefs);
        if(api?.lockInput) api.lockInput(null);
      },
      goal: ()=> true
    });
  }

  // -------------------- Sandbox helpers ---------------------------------------
  async function ensureSandboxEmpty4(){
    if(preserve.sandbox) return;
    const gs = getState();
    if(api?.loadSandboxBoard && gs && gs.N){
      const N = 4;
      const empty = Array.from({length:N},()=>Array(N).fill(0));
      try{ await api.loadSandboxBoard(empty); preserve.sandbox=true; return; }catch{}
    }
    // fallback visual-only
    wrap.classList.add('coach-sim-empty');
    preserve.sandbox=true;
  }
  function sandboxPrefs(patch){
    if(api?.setPrefs){ api.setPrefs(patch); }
    else { text?.setStatus?.(''); }
  }

  // -------------------- FX library --------------------------------------------
  const coachFx = {
    emit(name, target, opts={}){
      const pr = prefersReducedMotion();
      if(name==='beacon'){
        const { x,y,w,h } = rectCenter(target);
        const el = mk('div','fx-beacon'); el.style.setProperty('--px', (x-14)+'px'); el.style.setProperty('--py', (y-14)+'px');
        effectsLayer.appendChild(el); if(!pr) el.classList.add('show'); setTimeout(()=> el.remove(), pr? 900 : 1600);
      }
      if(name==='pencil'){
        const r = rectOf(target, 2);
        const el = mk('div','fx-pencil'); placeRect(el, r);
        effectsLayer.appendChild(el); el.classList.add('draw'); setTimeout(()=> el.remove(), 420);
      }
      if(name==='scan'){
        const r = rectOf(target, 0);
        const el = mk('div','fx-scan'); el.style.left = r.left+'px'; el.style.top = (r.top + r.height/2 - 4)+'px'; el.style.width = r.width+'px';
        effectsLayer.appendChild(el); el.classList.add('show'); setTimeout(()=> el.remove(), 680);
      }
      if(name==='chalk'){
        const r = rectOf(target, 0);
        for(let i=0;i<6+((Math.random()*4)|0);i++){
          const dot = mk('div','fx-chalk');
          dot.style.setProperty('--px', (r.left + r.width/2 + rand(-8,8))+'px');
          dot.style.setProperty('--py', (r.top + r.height/2 + rand(-4,4))+'px');
          dot.style.setProperty('--dx', rand(-10,10)+'px');
          effectsLayer.appendChild(dot); dot.classList.add('puff'); setTimeout(()=> dot.remove(), 640);
        }
      }
      if(name==='ribbon'){
        const a = rectCenter(opts.from), b = rectCenter(opts.to);
        const dx=b.x-a.x, dy=b.y-a.y; const len=Math.sqrt(dx*dx+dy*dy); const ang=Math.atan2(dy,dx)*180/Math.PI;
        const el = mk('div','fx-ribbon'); el.style.left=a.x+'px'; el.style.top=a.y+'px'; el.style.width=len+'px'; el.style.transform=`rotate(${ang}deg)`; 
        effectsLayer.appendChild(el); el.classList.add('show'); setTimeout(()=> el.remove(), 360);
      }
      if(name==='iris'){
        const r = rectOf(target, 8);
        const el = mk('div','fx-iris'); const hole = mk('div','hole');
        hole.style.left = r.left+'px'; hole.style.top = r.top+'px'; hole.style.width = r.width+'px'; hole.style.height = r.height+'px';
        el.appendChild(hole); effectsLayer.appendChild(el);
        setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=> el.remove(), 240); }, opts.ms||1200);
      }
      if(name==='bloom'){
        const r = rectOf(target, 0);
        const origin = { x:r.left + r.width/2, y:r.top + r.height/2 };
        for(let i=0;i<4;i++){
          const el = mk('div','fx-bloom'); el.textContent = opts.symbol || '•';
          el.style.setProperty('--px', origin.x+'px'); el.style.setProperty('--py', origin.y+'px');
          el.style.setProperty('--dx', rand(-16,16)+'px'); el.style.setProperty('--dy', rand(-16,16)+'px');
          effectsLayer.appendChild(el); el.classList.add('pop'); setTimeout(()=> el.remove(), 440);
        }
      }
      if(name==='wire'){
        const r = rectOf(target, -2);
        const el = mk('div','fx-wire'); placeRect(el, r); effectsLayer.appendChild(el); el.classList.add('pulse'); setTimeout(()=> el.remove(), 500);
      }
      if(name==='ink'){
        const r = rectOf(target, 0);
        const el = mk('div','fx-ink'); el.style.setProperty('--px', (r.left + r.width/2 - 12)+'px'); el.style.setProperty('--py', (r.top + r.height/2 - 12)+'px');
        effectsLayer.appendChild(el); el.classList.add('ripple'); setTimeout(()=> el.remove(), 520);
      }
      if(name==='chevron'){
        // reuse from previous version via simple ribbon with shorter len
        const base = opts.dir==='left' ? -36 : 36;
        const from = anchorEl || target;
        const a = rectCenter(from); const b = { x: a.x + base, y: a.y };
        coachFx.emit('ribbon', null, { from:{getBoundingClientRect(){return {left:a.x, top:a.y, width:1, height:1}}}, to:{getBoundingClientRect(){return {left:b.x, top:b.y, width:1, height:1}}} });
      }
    }
  };
  function placeRect(el, r){ el.style.left=r.left+'px'; el.style.top=r.top+'px'; el.style.width=r.width+'px'; el.style.height=r.height+'px'; }

  // -------------------- Face utilities -----------------------------------------
  function microFlash(){ card.classList.add('flash'); setTimeout(()=> card.classList.remove('flash'), 260); }
  function setMood(m){
    const mouth = card.querySelector('.sd-face .mouth');
    const browsL = card.querySelector('.sd-face .browL');
    const browsR = card.querySelector('.sd-face .browR');
    if(!mouth) return;
    if(m==='happy'){ mouth.setAttribute('d','M10,20 C13,24 19,24 22,20'); browsL.setAttribute('y','8.4'); browsR.setAttribute('y','8.4'); }
    if(m==='think'){ mouth.setAttribute('d','M10,21 C13,20 19,20 22,21'); browsL.setAttribute('y','8.0'); browsR.setAttribute('y','8.8'); }
    if(m==='oops'){  mouth.setAttribute('d','M15,21 a1,1 0 1,0 2,0 a1,1 0 1,0 -2,0'); browsL.setAttribute('y','9.0'); browsR.setAttribute('y','9.0'); }
    if(m==='analyze'){ browsL.setAttribute('y','8.6'); browsR.setAttribute('y','8.6'); }
    if(m==='loud'){ mouth.setAttribute('d','M11,19 C13,26 19,26 21,19'); }
  }
  function mouthShape(kind){
    const mouth = card.querySelector('.sd-face .mouth'); if(!mouth) return;
    if(kind==='o') mouth.setAttribute('d','M15,21 a1,1 0 1,0 2,0 a1,1 0 1,0 -2,0');
  }
  function eqPulse(){
    const eq = card.querySelector('.sd-face .eq'); if(!eq) return;
    eq.style.opacity='1'; clearTimeout(eqPulseTO); eqPulseTO = setTimeout(()=> eq.style.opacity='0', 1600);
  }
  function cansVisible(on){
    const cans = card.querySelector('.sd-face .cans'); if(!cans) return;
    cans.style.opacity = on ? '1' : '0';
  }
  function eyeTrackTo(px,py){
    const face = card.querySelector('.sd-face'); if(!face) return;
    const r = face.getBoundingClientRect();
    const dx = Math.max(-3, Math.min(3, (px-(r.left+r.width/2))/20));
    const dy = Math.max(-3, Math.min(3, (py-(r.top+r.height/2))/20));
    ['pupilL','pupilR'].forEach(cls=>{
      const el = face.querySelector('.'+cls); if(!el) return;
      const base = cls==='pupilL' ? {x:11,y:13} : {x:21,y:13};
      el.setAttribute('cx', String(base.x+dx)); el.setAttribute('cy', String(base.y+dy));
    });
  }
  function scheduleBlink(){
    clearTimeout(blinkTO);
    blinkTO = setTimeout(()=>{
      const pupils = card.querySelectorAll('.sd-face .pupil');
      pupils.forEach(p=> p.setAttribute('r','0.2'));
      setTimeout(()=> pupils.forEach(p=> p.setAttribute('r','1.1')), 120);
      scheduleBlink();
    }, 5200 + Math.random()*1800);
  }
  function lidsNarrow(on){
    const t = card.querySelector('.sd-face .lidT');
    const b = card.querySelector('.sd-face .lidB');
    if(!t||!b) return;
    t.setAttribute('height', on? '1.0' : '0.0');
    b.setAttribute('height', on? '1.0' : '0.0');
  }
  function eyesGlance(dir){
    const pupils = card.querySelectorAll('.sd-face .pupil');
    const dx = (dir==='left')? -1.2 : 1.2;
    pupils.forEach(p=> p.setAttribute('cx', String((+p.getAttribute('cx')) + dx)));
    setTimeout(()=>{ pupils.forEach(p=> p.setAttribute('cx', String((+p.getAttribute('cx')) - dx))); }, 280);
  }
  function faceHeadBob(){
    const f = card.querySelector('.sd-face'); if(!f) return;
    f.classList.add('headbob'); setTimeout(()=> f.classList.remove('headbob'), 2000);
  }
  function visemeTick(mode){
    const mouth = card.querySelector('.sd-face .mouth'); if(!mouth) return;
    if(mode==='start'){ mouth.dataset._v='1'; tick(); }
    if(mode==='stop'){ delete mouth.dataset._v; }
    function tick(){
      if(!mouth.dataset._v) return;
      const v = mouth.dataset._v==='1' ? '2' : '1';
      mouth.dataset._v = v;
      mouth.setAttribute('d', v==='1' ? 'M10,20 C13,24 19,24 22,20' : 'M10,21 C13,20 19,20 22,21');
      timers.push(setTimeout(tick, 140));
    }
  }

  // -------------------- Target highlight ---------------------------------------
  let currentTarget = null;
  function pickTargetCell(){
    const gs = getState(); if(!gs) return null;
    const N = Math.min(gs.N||9, 4);
    currentTarget = { r: Math.floor(Math.random()*N), c: Math.floor(Math.random()*N) };
    return currentTarget;
  }
  function highlightTarget(rc, ms){
    if(!rc) return;
    const el = cellEl(rc.r, rc.c); if(!el) return;
    coachFx.emit('beacon', el, {});
    if(ms){ setTimeout(()=>{}, ms); }
  }

  function cellEl(r,c){ return board?.querySelector?.(`.sd-cell[data-r="${r}"][data-c="${c}"]`) || null; }

  // -------------------- Reactions text -----------------------------------------
  function reactionLine(kind, n){
    const phrases = {
      select: ['Selected.', 'Nice pick.', 'That square glows.'],
      cellClick: ['Selected.', 'Nice pick.', 'That square glows.'],
      move: ['Glide.', 'Zoom.', 'Navigator vibes.'],
      place: ['Placed ✨', 'Clean drop.', 'Snug fit.'],
      dropPlace: ['Dropped!', 'Landing!'],
      clear: ['Cleared.', 'Poof!', 'Reset.'],
      undo: ['Back in time.', 'Undo ✓'],
      redo: ['Fast-forward.', 'Redo ✓'],
      hotel: ['Armed.', 'Digit ready.'],
      tip: ['Notes toggled.', 'Candidates on.'],
      error: ['Conflict demo!', 'Red scopes.'],
      check: ['Scanning…'],
      erase: ['Wiping…'],
      music: ['Vibes on 🛋️', 'Whoa 🎧'],
      sfx: ['Clicks toggled.'],
      daily: ['Daily loaded.'],
      variant: ['New shape!'],
      diff: ['Spice shift.'],
      startOver: ['Fresh slate.'],
      fullscreen: ['Full focus.']
    };
    const arr = phrases[kind]; if(!arr) return '';
    return arr[(n-1)%arr.length];
  }

  // -------------------- Utils ---------------------------------------------------
  function prefersReducedMotion(){ return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
  function mk(tag, cls){ const el=document.createElement(tag); if(cls) el.className=cls; return el; }
  function rectOf(el, pad=0){ const r = el.getBoundingClientRect(); return { left:r.left-pad, top:r.top-pad, width:r.width+pad*2, height:r.height+pad*2 }; }
  function rectCenter(el){ const r = el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height }; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function changed(ar, prev, eps){
    return (Math.abs(ar.left - (prev.x||0))>eps
         || Math.abs(ar.top  - (prev.y||0))>eps
         || Math.abs(ar.width - (prev.w||0))>eps
         || Math.abs(ar.height- (prev.h||0))>eps);
  }
  function normalizeEl(x){ if(!x) return null; if(x instanceof Element) return x; if(typeof x==='string') return document.querySelector(x); if(Array.isArray(x)) return x[0]||null; return null; }
  function normalizeEls(list){ return (list||[]).map(normalizeEl).filter(Boolean); }
  function intersectArea(a,b){ const l=Math.max(a.left,b.left), r=Math.min(a.right,b.right), t=Math.max(a.top,b.top), bt=Math.min(a.bottom,b.bottom); const w=Math.max(0,r-l), h=Math.max(0,bt-t); return w*h; }
  function rand(a,b){ return a + Math.random()*(b-a); }
  function clearTimers(){ timers.forEach(t=> clearTimeout(t)); timers.length=0; clearTimeout(eqPulseTO); clearTimeout(blinkTO); }
  function clonePrefs(p){ try{ return JSON.parse(JSON.stringify(p||null)); }catch{ return null; } }

  // -------------------- Pools helper (phrases + counters) ----------------------
  function makePools(){
    const pools = { intro: ["Quick tour?","I’ll point — you click.","Smooth & painless."] };
    const bag = {}; Object.keys(pools).forEach(k=> bag[k]=shuffleBag(pools[k]));
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

  // -------------------- Variant auto-cycle (used in S12) -----------------------
  let variantCycleTO = null;
  function tryAutoCycleVariants(){
    const sel = controls?.querySelector?.('select.sd-select[title="Variant"]') || controls?.querySelector?.('select.sd-select');
    if(!sel || sel.options.length < 2) return;
    const original = sel.value;
    const picks = [];
    for(let i=0; i<sel.options.length && picks.length<2; i++){ const v = sel.options[i].value; if(v!==original) picks.push(v); }
    let i=0;
    function cycle(){
      if(!active || stepIdx>=STEPS.length) return;
      if(i>=picks.length){ sel.value = original; sel.dispatchEvent(new Event('change',{bubbles:true})); return; }
      sel.value = picks[i++]; sel.dispatchEvent(new Event('change',{bubbles:true}));
      bubble('Variant peek 👀'); variantCycleTO = setTimeout(cycle, 1000);
    }
    variantCycleTO = setTimeout(cycle, 600);
  }
  function stopVariantCycle(){ clearTimeout(variantCycleTO); }

  // -------------------- Bubbles -------------------------------------------------
  function bubble(msg, ms=2200){
    const rail = card.querySelector('.rail'); if(!rail) return;
    const b = document.createElement('div'); b.className='sd-bubble'; b.textContent=msg;
    rail.appendChild(b); while(rail.children.length>4) rail.removeChild(rail.firstChild);
    setTimeout(()=> b.classList.add('fade'), ms);
    setTimeout(()=> b.remove(), ms+480);
  }

  // -------------------- Global taps --------------------------------------------
  document.addEventListener('fullscreenchange', ()=>{ if(!active) return; react('fullscreen'); setMood(document.fullscreenElement?'happy':'think'); queueReposition(); }, { passive:true });

  // -------------------- Expose API ---------------------------------------------
  return { start, stop, isActive, allow: allowPublic, react, handleResize, queueReposition: queueRepositionPublic };
}
