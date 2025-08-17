// coach-script.js — Orchestrates the interactive tutorial for the Coach Stage (v6)
// Requires: coach-stage.js (v8 or newer)
//
// Public: CoachTutorial.launch({ mount?: HTMLElement })
//
(function () {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const randInt = (a,b)=> (a + Math.floor(Math.random()*(b-a+1)));

  // Move the stage's yellow guide-ball to any element smoothly (no teleport)
  function glideBallToElement(stage, el, durMS=500){
    if(!el) return;
    const ball = stage.wrap.querySelector('.guide-ball');
    if(!ball) return;
    const w = stage.wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const tx = (r.left - w.left) + r.width/2;
    const ty = (r.top  - w.top ) + r.height/2;
    const prev = { x: parseFloat(ball.style.left)||tx, y: parseFloat(ball.style.top)||ty };
    const dist = Math.hypot(tx-prev.x, ty-prev.y);
    const dur = Math.min(900, Math.max(240, (durMS || 500) * (dist/220)));
    ball.style.setProperty('--t', dur+'ms');
    ball.style.left = tx+'px';
    ball.style.top  = ty+'px';
  }

  // A tiny CSS injection for shakes/alerts used by the countdown
  function ensureExtraCSS(stage){
    if(stage.wrap.querySelector('style[data-coach-script]')) return;
    const s = document.createElement('style');
    s.setAttribute('data-coach-script','1');
    s.textContent = `
      .cs-crazy{ animation: csShake .15s linear infinite; }
      @keyframes csShake { 0%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}50%{transform:translate(1px,-2px)}75%{transform:translate(-1px,2px)}100%{transform:translate(0,0)} }
      .cs-blink{ animation: csBlink .22s steps(1) 10; }
      @keyframes csBlink { 50%{ box-shadow:0 0 0 10px rgba(255,60,60,.28) inset } }
      .coach-countdown{ position:absolute; right:8px; top:50%; transform:translateY(-50%); font-weight:900; font-size: clamp(40px, 13vw, 160px); color:#fff; text-shadow:0 2px 10px rgba(0,0,0,.55); opacity:.95; letter-spacing:-2px; user-select:none; pointer-events:none; }
      .coach-countdown.warn{ color:#ffb3b3; }
      .coach-countdown.crazy{ color:#ff6b6b; }
    `;
    stage.wrap.appendChild(s);
  }

  // Simple countdown on stage.wrap that resolves when time ends or a cancel is called.
  function startCountdown(stage, seconds, { onTick } = {}){
    ensureExtraCSS(stage);
    const el = document.createElement('div');
    el.className = 'coach-countdown';
    el.textContent = String(seconds);
    stage.wrap.appendChild(el);
    let t = seconds;
    const timer = setInterval(()=>{
      t--;
      if(t<=3) el.classList.add('warn');
      if(t<=2) { el.classList.add('crazy'); stage.wrap.classList.add('cs-crazy','cs-blink'); stage.setMood('worried'); }
      el.textContent = String(Math.max(0,t));
      onTick && onTick(t);
      if(t<=0){ stop(); }
    }, 1000);
    function stop(){
      clearInterval(timer);
      el.remove();
      stage.wrap.classList.remove('cs-crazy','cs-blink');
      stage.setMood(null);
    }
    return { stop };
  }

  // Wait until the board cell gets a value (poll stage.state)
  async function waitForCellFilled(stage, r, c, timeoutMs=15000){
    const start = performance.now();
    for(;;){
      const v = stage.state.grid[r][c];
      if(v) return true;
      if(performance.now() - start > timeoutMs) return false;
      await wait(40);
    }
  }

  // Pick a far-ish target from (r,c)
  function farTarget(stage, r, c){
    const N = stage.state.N;
    const options = [];
    const minDist = Math.max(2, Math.floor(N/2));
    for(let rr=0; rr<N; rr++){
      for(let cc=0; cc<N; cc++){
        const d = Math.abs(rr-r) + Math.abs(cc-c);
        if(d >= minDist) options.push({r:rr,c:cc,d});
      }
    }
    if(!options.length) return { r:(N-1-r+N)%N, c:(N-1-c+N)%N };
    options.sort((a,b)=> b.d-a.d);
    return options[randInt(0, Math.max(0, Math.min(3, options.length-1)))];
  }

  // Guide to press a toolbar button (yellow ball + pulse text)
  async function guideToButton(stage, btn){
    if(!btn) return;
    glideBallToElement(stage, btn, 600);
    await wait(650);
    stage.say(`Tap <b>${btn.textContent.trim()}</b> up there. I’ll do the dance when you do ✨`);
  }

  // Make the hotel do a one-time wave (without touching stage internals)
  function waveHotelOnce(stage){
    const list = Array.from(stage.hotel.querySelectorAll('.sd-hbtn'));
    list.forEach((b,i)=> setTimeout(()=> {
      b.style.transform = 'translateY(-6px) scale(1.04)';
      setTimeout(()=> b.style.transform='', 180);
    }, i*34));
  }

  // Highlight + lock a specific hotel digit, with yellow ball glide
  function lockDigitWithBall(stage, d){
    stage.lockHotelToDigit(d);
    const btn = stage.hotel.querySelectorAll('.sd-hbtn')[d-1];
    if(btn) glideBallToElement(stage, btn, 600);
  }

  // Challenge: navigate with arrows to target within a time; returns true if success
  async function arrowChallenge(stage, target, seconds){
    // Start far away, unlock selection guard (free roam)
    const N = stage.state.N;
    const start = { r: (target.r+Math.max(1,Math.floor(N/2)))%N, c:(target.c+Math.max(2,Math.floor(N/2)))%N };
    stage.select(start);
    stage.showGuideTarget(target.r, target.c);
    glideBallToElement(stage, /*guide ball to target cell*/ (function(){ return stage.board.querySelector(`.sd-cell[data-r="${target.r}"][data-c="${target.c}"]`); })(), 700);

    // Countdown UI
    stage.say(`Mini challenge! Use your <b>arrow keys</b> to reach the glowing cell before time runs out.`);
    await wait(400);
    const c = startCountdown(stage, seconds);

    // Poll for success
    let ok = false;
    const startMs = performance.now();
    while(performance.now() - startMs < seconds*1000){
      const sel = stage.state.sel;
      if(sel && sel.r===target.r && sel.c===target.c){ ok = true; break; }
      await wait(50);
    }
    c.stop();
    stage.hideGuideTarget();
    return ok;
  }

  // Ask user to right-click a given cell (twice if needed)
  async function requireRightClickOnCell(stage, rc, times=1){
    stage.lockSelectionToCell(rc.r, rc.c);
    stage.select(rc);
    stage.showGuideTarget(rc.r, rc.c);
    stage.say(`Try a <b>right-click</b> on the glowing cell. (It’s like “doing it right” 😉)`);
    const need = times;
    let got = 0;

    async function waitOnce(){
      return new Promise(res=>{
        const onCtx = (e)=>{
          const cell = e.target.closest('.sd-cell');
          if(!cell) return;
          const r = +cell.dataset.r, c = +cell.dataset.c;
          if(r===rc.r && c===rc.c){
            e.preventDefault();
            got++;
            stage.rippleAtCell(r,c);
            res();
          }
        };
        stage.board.addEventListener('contextmenu', onCtx, { once:true });
      });
    }

    while(got < need){ await waitOnce(); }
    stage.hideGuideTarget();
    stage.unlockSelectionLock();
  }

  // Pick a conflicting move: choose row/col/box conflict and force a wrong digit
  function pickConflictMove(stage){
    const { N, grid } = stage.state;
    // Find any filled spot and an empty spot in same row/col/box to clash
    for(let r=0;r<N;r++){
      for(let c=0;c<N;c++){
        const v = grid[r][c];
        if(!v) continue;
        // same row empty
        for(let cc=0; cc<N; cc++){
          if(cc===c) continue;
          if(grid[r][cc]===0) return { r, c:cc, v, reason:'row' };
        }
        // same col empty
        for(let rr=0; rr<N; rr++){
          if(rr===r) continue;
          if(grid[rr][c]===0) return { r:rr, c, v, reason:'col' };
        }
      }
    }
    // fallback: pick any empty and clash with a neighbor
    for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(grid[r][c]===0) return { r, c, v:1, reason:'any' };
    return null;
  }

  // Enforce that only digit d can be typed (optionally to force wrong choice)
  function enforceOnlyDigit(stage, d, { angryMsg }={}){
    stage.setInputInterceptor((e)=>{
      const key = e.key;
      if(!/^[0-9A-Za-z]$/.test(key)) return false;
      let n = NaN;
      if(/^[1-9]$/.test(key)) n = Number(key);
      else {
        const u = key.toUpperCase();
        const code = u.charCodeAt(0);
        if(code>=65 && code<=90) n = code-55;
      }
      if(!Number.isInteger(n)) return false;
      if(n!==d){
        stage.setMood('angry');
        stage.say(angryMsg || `Hey! I said <b>${d}</b> 😤 — try again, friend.`);
        stage.wiggle(700);
        setTimeout(()=> stage.setMood(null), 800);
        return true; // consume
      }
      return false; // allow correct (enforced) digit
    });
  }
  function clearEnforce(stage){ stage.setInputInterceptor(null); }

  // Move yellow ball to settings button
  function ballToSettings(stage){
    const btn = stage.controlsMap?.settings;
    if(btn){ glideBallToElement(stage, btn, 700); }
  }

  // —— Tutorial flow ——
  async function runTutorial(stage){
    stage.setVariant('mini4');
    stage.open();
    stage.ensureCoachVisible();

    // Intro
    stage.say(`Welcome! I’m your puzzle coach. Let’s play it hands-on — no long texts, just <b>try</b> and I’ll react. Start by tapping <b>any cell</b>.`);
    // Wait for any cell selection
    const firstClick = await new Promise(res=>{
      const onClick = (e)=>{
        const cell = e.target.closest('.sd-cell');
        if(!cell) return;
        const r=+cell.dataset.r, c=+cell.dataset.c;
        stage.select({r,c});
        res({r,c});
      };
      stage.board.addEventListener('click', onClick, { once:true });
    });

    // Ask for a digit; wave hotel; lock selection to this one cell
    stage.lockSelectionToCell(firstClick.r, firstClick.c);
    stage.say(`Nice! Now type a <b>digit</b> from your keyboard <i>or</i> hit one below. (They’ll do a little wave 🌊)`);
    waveHotelOnce(stage);

    // Let any digit be placed there
    const cellFilled = await waitForCellFilled(stage, firstClick.r, firstClick.c);
    if(!cellFilled){ /* fallback */ stage.place(firstClick.r, firstClick.c, 1, false); }

    stage.unlockSelectionLock();
    stage.rippleAtCell(firstClick.r, firstClick.c);
    await wait(400);

    // Challenge: navigate with arrows to a glowing target
    const tgt = farTarget(stage, firstClick.r, firstClick.c);
    stage.say(`Try this: see the glowing cell? Use only your <b>arrow keys</b> to reach it.`);
    let ok = await arrowChallenge(stage, tgt, 5);
    if(!ok){
      stage.say(`Close! I’ll give you <b>10 seconds</b> — you’ve got this.`);
      ok = await arrowChallenge(stage, tgt, 10);
      if(!ok){
        stage.say(`Time! We’ll keep moving — I’ll call you <i>strategically slow</i> 😄`);
      } else {
        stage.say(`Boom! Speedy fingers 🏁`);
      }
    } else {
      stage.say(`Perfect! You’re steering like a pro ✨`);
    }
    await wait(700);

    // Right-click demo (twice)
    const rcCell = { r: tgt.r, c: tgt.c };
    await requireRightClickOnCell(stage, rcCell, 1);
    stage.say(`Haha, <b>right</b>-click — you did it right! 😆`);
    await wait(600);
    stage.say(`Do it once more to deselect/close stuff.`);
    await requireRightClickOnCell(stage, rcCell, 1);
    stage.say(`Beautiful. Right ×2 = you’re alright.`); await wait(600);

    // Variants demo with liquid split/join
    stage.say(`Watch how boards morph. First, to a classic board…`);
    await stage.runMosaic('classic9', { sayLine: null });
    await wait(300);
    stage.say(`And now to a giant one — I’m getting a little sweaty…`);
    await stage.runMosaic('giant16', { sayLine: null, sweat:true });
    await wait(400);
    stage.say(`Aaand back to classic — that’s the size we’ll use.`);
    await stage.runMosaic('classic9', { sayLine: null });

    // Slight “I’m dizzy” gag
    stage.say(`Whew. I might be a puzzle coach, not a washing machine 🌀`);
    stage.wiggle(1000);
    await wait(900);

    // Generate a puzzle: rain → stick half
    stage.say(`Let’s conjure a board. Digits will <b>rain</b> for a moment, then the real ones <b>stick</b>.`);
    await stage.rainThenStickHalf({ durationMs: 3000 });
    await wait(300);
    stage.say(`Clean! Half-filled — perfect for practicing.`);

    // Conflict demo: force a wrong number in a highlighted spot
    const conflict = pickConflictMove(stage);
    if(conflict){
      stage.lockSelectionToCell(conflict.r, conflict.c);
      stage.showGuideTarget(conflict.r, conflict.c);
      glideBallToElement(stage, stage.board.querySelector(`.sd-cell[data-r="${conflict.r}"][data-c="${conflict.c}"]`), 650);

      // highlight & lock the exact digit that will conflict
      lockDigitWithBall(stage, conflict.v);
      enforceOnlyDigit(stage, conflict.v, { angryMsg: `Nope — humor me: try the <b>${conflict.v}</b> I asked for 😤` });

      stage.say(`Pop into the glowing cell and try this digit ↓. (Don’t worry, it’s wrong — on purpose!)`);
      // Wait for it to be placed
      await waitForCellFilled(stage, conflict.r, conflict.c);
      clearEnforce(stage);
      stage.unlockHotelLock();
      stage.hideGuideTarget();

      // Show the red scopes + coach tears
      stage.showWrongOverlay(conflict.r, conflict.c, conflict.v, 3000);
      stage.say(`See how it lights up? That digit already exists in its row/column/box.`);
      stage.coachCry({ drops: 22, spread: 60, durationMs: 1400 });
      await wait(1300);
    }

    // Show solution hint (hold F)
    stage.say(`Pro tip: hold the key <b>F</b> to peek at the solution. Try it — but don’t <i>overuse</i> it… or else I’ll dramatically sigh.`); 
    await wait(1800);

    // Music button
    stage.say(`Now, tap <b>Music</b> to turn on a groove. If it’s loud I’ll wiggle.`);
    await guideToButton(stage, stage.controlsMap?.music);
    await new Promise(res=>{
      stage.controlsMap?.music?.addEventListener('click', ()=>{ res(); }, { once:true });
    });
    await wait(600);

    // Hint button
    stage.say(`Hit <b>Hint</b> — I’ll show one logical fill with a lightbulb.`);
    await guideToButton(stage, stage.controlsMap?.hint);
    await new Promise(res=>{
      stage.controlsMap?.hint?.addEventListener('click', ()=>{ res(); }, { once:true });
    });
    await wait(900);

    // New button — will re-run rain→stick
    stage.say(`Try <b>New</b> to reshuffle — watch the digits rain and settle again.`);
    await guideToButton(stage, stage.controlsMap?.new);
    await new Promise(res=>{
      stage.controlsMap?.new?.addEventListener('click', ()=>{ res(); }, { once:true });
    });
    await wait(3200);

    // Settings pointer via yellow ball
    stage.say(`Settings & help live here — you can replay me anytime.`);
    ballToSettings(stage);
    await wait(800);

    // Wrap up
    stage.say(`That’s the tour! Have fun, experiment, and I’ll keep cheering you on.`);
    await wait(1000);
    stage.close();
  }

  const CoachTutorial = {
    async launch({ mount } = {}){
      const stage = window.makeCoachStage({ mount });
      try{
        await runTutorial(stage);
      }catch(err){
        console.error('Tutorial crashed:', err);
        try { stage.say(`Oops — my bad. I tripped over my own animation 🤦. Reload and I’ll behave!`); } catch{}
      }
    }
  };

  window.CoachTutorial = CoachTutorial;
})();
