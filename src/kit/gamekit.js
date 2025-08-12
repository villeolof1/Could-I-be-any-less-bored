// Shared helpers: responsive canvas, HUD, settings modal, storage, audio, timers, confetti
export function fitCanvas(canvas, width, height) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.maxWidth = '100%';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function persistKey(gameId, key) { return `arcade:${gameId}:${key}`; }
export function load(gameId, key, fallback) {
  try { return JSON.parse(localStorage.getItem(persistKey(gameId,key))) ?? fallback; } catch { return fallback; }
}
export function save(gameId, key, value) {
  try { localStorage.setItem(persistKey(gameId,key), JSON.stringify(value)); } catch {}
}

export function makeHUD(api, { score=true, lives=true, level=false, time=false }={}) {
  const pills = {};
  if (score) pills.score = api.addHudPill('hud-score','Score: 0');
  if (lives) pills.lives = api.addHudPill('hud-lives','Lives: ★★★');
  if (level) pills.level = api.addHudPill('hud-level','Lv 1');
  if (time) pills.time = api.addHudPill('hud-time','00:00');
  return {
    setScore(v){ if(pills.score) pills.score.textContent = `Score: ${v}`; },
    setLives(v){ if(pills.lives) pills.lives.textContent = `Lives: ${'★'.repeat(v)}${v<3?' '+v:''}`; },
    setLevel(v){ if(pills.level) pills.level.textContent = `Lv ${v}`; },
    setTime(ms){
      if(!pills.time) return;
      const s = Math.floor(ms/1000), m = Math.floor(s/60), ss = (s%60).toString().padStart(2,'0');
      pills.time.textContent = `${m}:${ss}`;
    }
  };
}

export function makeOverlayControls(api, { onRestart }) {
  // Show center note as CTA; also add a bottom-right “Restart” pill
  const restartBtn = document.createElement('button');
  restartBtn.className = 'pill';
  restartBtn.textContent = '↻ Restart';
  restartBtn.style.position='absolute'; restartBtn.style.right='10px'; restartBtn.style.bottom='10px';
  restartBtn.addEventListener('click', onRestart);
  api.mount.appendChild(restartBtn);
  return { remove(){ restartBtn.remove(); } };
}

export function settingsPanel(api, schema, gameId, onChange) {
  // schema: [{key,label,type:'range'|'select'|'toggle', min,max,step, options:[{v,l}], default}]
  const box = document.createElement('div');
  box.style.position='absolute'; box.style.right='10px'; box.style.top='50px';
  box.style.background='var(--card)'; box.style.border='1px solid var(--ring)';
  box.style.borderRadius='12px'; box.style.padding='10px'; box.style.minWidth='220px';
  box.style.boxShadow='var(--shadow)'; box.style.maxHeight='70vh'; box.style.overflow='auto';
  const header = document.createElement('div');
  header.style.display='flex'; header.style.justifyContent='space-between'; header.style.alignItems='center';
  header.innerHTML = `<div style="font-weight:700">Settings</div>`;
  const close = document.createElement('button'); close.className='ghost'; close.textContent='✕';
  close.addEventListener('click', ()=> box.remove());
  header.appendChild(close);
  box.appendChild(header);
  const state = load(gameId, 'settings', {});
  schema.forEach(s=>{
    const row = document.createElement('label');
    row.style.display='grid'; row.style.gridTemplateColumns='1fr auto'; row.style.gap='8px'; row.style.alignItems='center';
    row.style.margin='8px 0';
    const left = document.createElement('div'); left.textContent = s.label;
    const right = (()=> {
      const current = state[s.key] ?? s.default;
      if (s.type==='toggle') {
        const b=document.createElement('input'); b.type='checkbox'; b.checked=!!current;
        b.addEventListener('change',()=>{ state[s.key]=b.checked; save(gameId,'settings',state); onChange({...state}); });
        return b;
      }
      if (s.type==='range') {
        const wrap=document.createElement('div');
        const out=document.createElement('span'); out.textContent=String(current);
        const b=document.createElement('input'); b.type='range'; b.min=s.min; b.max=s.max; b.step=s.step||1; b.value=current;
        b.addEventListener('input',()=>{ out.textContent=b.value; });
        b.addEventListener('change',()=>{ state[s.key]=Number(b.value); save(gameId,'settings',state); onChange({...state}); });
        wrap.appendChild(b); wrap.appendChild(out); wrap.style.display='flex'; wrap.style.gap='6px';
        return wrap;
      }
      if (s.type==='select') {
        const sel=document.createElement('select');
        (s.options||[]).forEach(o=>{ const opt=document.createElement('option'); opt.value=o.v; opt.textContent=o.l; sel.appendChild(opt); });
        sel.value = current;
        sel.addEventListener('change',()=>{ state[s.key]=sel.value; save(gameId,'settings',state); onChange({...state}); });
        return sel;
      }
      return document.createTextNode('');
    })();
    row.append(left, right);
    box.appendChild(row);
  });
  api.mount.appendChild(box);
  if (!load(gameId,'settings')) save(gameId,'settings', schema.reduce((a,s)=> (a[s.key]=s.default, a), {}));
  return { state: load(gameId,'settings',{}), destroy(){ box.remove(); } };
}

export function makeHiScore(gameId) {
  return {
    get() { return load(gameId,'hiscore',0); },
    set(v) { const best=this.get(); if(v>best) save(gameId,'hiscore',v); },
  };
}

export function tactile(el, cb){ // click + space/enter
  el.addEventListener('click', cb);
  el.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' ') cb(); });
}

export function mkAudio(ctxs={}) {
  // ultra tiny synth beeps using WebAudio if available
  const Audio = window.AudioContext || window.webkitAudioContext;
  const ac = Audio ? new Audio() : null;
  function beep(freq=440, dur=0.08, type='sine', gain=0.05){
    if(!ac) return;
    const now=ac.currentTime;
    const osc=ac.createOscillator(), g=ac.createGain();
    osc.type=type; osc.frequency.value=freq;
    g.gain.value=gain; osc.connect(g); g.connect(ac.destination);
    osc.start(now); osc.stop(now+dur);
  }
  return { beep, ac };
}

export function makeTicker(cb){
  let raf=0, last=0, paused=false;
  function loop(t){ const dt = Math.min(32, t - last || 16); last=t; if(!paused) cb(dt); raf=requestAnimationFrame(loop); }
  raf=requestAnimationFrame(loop);
  return {
    pause(){ paused=true; },
    resume(){ paused=false; },
    stop(){ cancelAnimationFrame(raf); }
  };
}

/* ------------------------------------------------------------------ *
 *  Modern, lightweight confetti
 *  Usage:
 *     const conf = makeConfetti(canvas, { duration: 6 });
 *     conf.burst({ count: 240 });
 *     // on resize: conf.resize();
 * ------------------------------------------------------------------ */
export function makeConfetti(canvas, userDefaults = {}) {
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const defaults = {
    duration: 6,           // seconds total per particle (longer, nicer)
    linger: 0.33,          // last fraction of life spent fading out
    gravity: 200,          // px/s^2
    windAmp: 14,           // px/s max sideways sway
    windFreq: 0.9,         // Hz for wind wobble
    drag: 0.08,            // air resistance factor
    count: prefersReduced ? 60 : 220,
    colors: ['#F94144','#F3722C','#F8961E','#F9844A','#F9C74F','#90BE6D','#43AA8B','#577590'],
    shapes: ['rect','tri','dot','ribbon'],
    trails: !prefersReduced,  // cheap tiny trail
    maxActive: prefersReduced ? 160 : 420, // safety cap
    from: null,             // {x,y} spawn center in CSS pixels (null = auto)
  };
  const opts = { ...defaults, ...userDefaults };

  let ctx = fitCanvas(canvas, canvas.clientWidth || canvas.offsetWidth || 1, canvas.clientHeight || canvas.offsetHeight || 1);
  let running = false;
  let parts = [];
  let raf = 0;
  let lastT = performance.now()/1000;
  let fpsEMA = 60;

  function resize(){
    ctx = fitCanvas(canvas, canvas.clientWidth || canvas.offsetWidth || 1, canvas.clientHeight || canvas.offsetHeight || 1);
  }

  function rand(a,b){ return a + Math.random()*(b-a); }
  function pick(arr){ return arr[(Math.random()*arr.length)|0]; }

  function spawn(n=opts.count, override={}){
    const W = canvas.clientWidth || canvas.offsetWidth || 1;
    const H = canvas.clientHeight || canvas.offsetHeight || 1;
    const center = override.from || opts.from || { x: W*0.5, y: H*0.3 };
    const parallax = (l)=> (0.7 + (1-l)*0.6); // near = faster

    for (let i=0;i<n;i++){
      if (parts.length >= opts.maxActive) break;
      const layer = Math.pow(Math.random(), 2);   // more far layers
      const speed = rand(220, 360) * parallax(layer);
      const ang = -Math.PI/2 + rand(-0.6, 0.6);
      const life = opts.duration * (0.85 + Math.random()*0.3);
      const sizeBase = 7 + Math.random()*9;
      const shape = pick(opts.shapes);
      const color = pick(opts.colors);

      parts.push({
        x: center.x + rand(-W*0.18, W*0.18),
        y: center.y + rand(-H*0.05, H*0.05),
        vx: Math.cos(ang)*speed,
        vy: Math.sin(ang)*speed,
        rot: rand(0, Math.PI*2),
        vr: rand(-2.0, 2.0),
        life,
        ttl: life,
        size: shape==='ribbon' ? sizeBase*0.9 : (shape==='dot'? sizeBase*0.7 : sizeBase),
        color, shape, layer,
        xPrev: null, yPrev: null,
      });
    }
  }

  function alphaFromLife(life, ttl){
    const t = Math.max(0, life/ttl);
    const cut = 1 - opts.linger; // solid portion
    if (t >= cut) return 1;      // solid
    const k = t / cut;           // 0..1 over fade-out
    return k*k;                  // ease-out quad
  }

  function step(){
    const now = performance.now()/1000;
    let dt = now - lastT; lastT = now;
    if (dt > 0.05) dt = 0.05; // avoid big jumps
    fpsEMA = fpsEMA*0.9 + (1/dt)*0.1;

    const W = canvas.clientWidth || canvas.offsetWidth || 1;
    const H = canvas.clientHeight || canvas.offsetHeight || 1;

    // Adaptive quality: if fps drops, cull oldest quickly
    if (fpsEMA < 48 && parts.length > 60){
      const drop = Math.min(parts.length*0.08|0, 24);
      parts.splice(0, drop);
    }

    ctx.clearRect(0,0,W,H);

    const wind = (t, layer)=> Math.sin(t*opts.windFreq*2*Math.PI + layer*5.7) * opts.windAmp * (0.5 + (1-layer));

    for (let i=0;i<parts.length;i++){
      const p = parts[i];

      // update
      const w = wind(now, p.layer);
      p.vx += w * dt;
      p.vy += opts.gravity * dt;

      const drag = Math.max(0, 1 - opts.drag*dt*(0.8 + p.layer*0.3));
      p.vx *= drag; p.vy *= drag;

      p.xPrev = p.x; p.yPrev = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;

      p.life -= dt;
      const a = alphaFromLife(p.life, p.ttl);

      // draw
      if (a > 0.01){
        ctx.globalAlpha = a;

        if (opts.trails && p.xPrev!=null){
          ctx.lineWidth = Math.max(1, (3*(1-p.layer)));
          ctx.strokeStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(p.xPrev, p.yPrev);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }

        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;

        if (p.shape === 'rect'){
          const w2 = p.size*1.2, h2 = p.size*0.42;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot + Math.atan2(p.vy, p.vx)*0.2);
          ctx.fillRect(-w2/2, -h2/2, w2, h2);
          ctx.restore();
        } else if (p.shape === 'tri'){
          const s = p.size;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot + Math.atan2(p.vy, p.vx)*0.25);
          ctx.beginPath();
          ctx.moveTo(0, -s*0.6);
          ctx.lineTo(s*0.7, s*0.5);
          ctx.lineTo(-s*0.7, s*0.5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (p.shape === 'dot'){
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size*0.35, 0, Math.PI*2);
          ctx.fill();
        } else { // ribbon (cheap polyline)
          const seg = 6, len = p.size*5;
          const nx = Math.cos(p.rot), ny = Math.sin(p.rot);
          const tx = -ny, ty = nx;
          ctx.lineWidth = Math.max(1.5, 3.5*(1-p.layer));
          ctx.beginPath();
          for (let k=0;k<=seg;k++){
            const t = k/seg;
            const wob = Math.sin((now*1.2 + t*10 + p.rot)*1.2) * 5 * (Math.random()<0.5?-1:1);
            const x = p.x + nx*len*t + tx*wob;
            const y = p.y + ny*len*t + ty*wob;
            if (k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          }
          ctx.stroke();
        }
      }
    }

    // cull
    for (let i=parts.length-1;i>=0;i--){
      const p = parts[i];
      if (p.life <= 0 || p.y > H + 80 || p.x < -80 || p.x > W+80) parts.splice(i,1);
    }

    if (parts.length){
      raf = requestAnimationFrame(step);
    } else {
      running = false;
    }
  }

  function go(){
    if (running) return;
    running = true;
    lastT = performance.now()/1000;
    raf = requestAnimationFrame(step);
  }

  // Public API
  return {
    burst(override={}){ spawn(override.count ?? opts.count, override); go(); },
    play(override={}){ this.burst(override); },
    clear(){ parts.length = 0; ctx.clearRect(0,0,canvas.clientWidth||1,canvas.clientHeight||1); },
    resize,
    destroy(){ cancelAnimationFrame(raf); parts.length=0; }
  };
}
