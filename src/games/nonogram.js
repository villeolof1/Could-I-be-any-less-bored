// -----------------------------------------------------------------------------
// nonogram.js — Nonogram+ (creator+gallery build v3.2, fullscreen-safe)
// -----------------------------------------------------------------------------
// What’s new in 3.2 (focused fixes):
// • 100% fullscreen-safe overlays: Settings, ⋯ menus, Share, Import, Confirm/Prompt.
// • Popovers & modals render in a portal attached to the fullscreen element.
// • Pointer Events with pointer-capture: single-click paints immediately; drag continues.
// • Editor validation: only rejects all-blank (rows/cols may be blank).
// • Editor output never stores crosses; right-click = erase; left-click toggles.
// • Import dialog: Paste code OR Upload JSON → Play Now (ephemeral) OR Add to Gallery (asks Name).
// • Share dialog: Copy Code, Copy Text, Share… (Web Share fallback), Export JSON.
// • Play-from-Gallery parity: fully interactive; deep copy, rebuild hints, reset state.
// • Post-solve reveal: crosses fade out; hints/grid dim to show a clean pixel image.
// • Removed “Add Random” in Gallery toolbar. Removed keyboard & selection ring.
// • Buttons (Undo/Redo/Restart/New/Hint) audited; Restart uses custom confirm.
// • First load always starts a fresh Random puzzle (unless deep link ?p=…).
// -----------------------------------------------------------------------------

import { fitCanvas, makeHUD, makeConfetti, load, save } from '../kit/gamekit.js';

export default {
  id: 'nonogram',
  title: 'Nonogram+',
  category: 'puzzle',
  icon: '🧩',
  tags: ['picross','paint-by-hints','logic'],
  launch(api){

    // =========================================================================
    // Config / Flags
    // =========================================================================
    const url = new URL(location.href);
    const FLAGS = {
      dev: url.searchParams.get('dev')==='1',
      seed: url.searchParams.has('seed') ? Number(url.searchParams.get('seed')) : null,
      deepPuzzleCode: url.searchParams.get('p') || null,
    };

    const DEFAULTS = {
      size: 15,                   // 10 | 15 | 20
      mode: 'random',             // random | daily | rush | challenge
      theme: 'dark',              // dark | light | highcontrast
      assist: true,               // auto-cross + hover
      errorMode: 'soft',          // soft | strict
      sound: true,
      haptics: false,
      rushSeconds: 300,
      challengeStrikes: 3,
    };

    let cfg = { ...DEFAULTS, ...load('nonogram','cfg',{}) };

    const TUNABLES = {
      maxUndo: 200,
      hoverGlowAlpha: 0.08,
      confirmGreyAlpha: 0.06,
      animFillMs: 120,
      animCrossMs: 140,
      confettiMs: 6000,
      warnBlinkStart: 5,
      hardShakeStart: 2,
      minCell: 22,
      maxCell: 44,
      postSolveFadeMs: 650,
    };

    // =========================================================================
    // Utils
    // =========================================================================
    const clamp = (x,a,b)=> Math.max(a, Math.min(b, x));
    const formatTime = (ms)=>{ const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
    const mulberry32 = (seed)=>()=>{ let t=seed+=0x6D2B79F5; t=Math.imul(t^(t>>>15), t|1); t^=t+Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967296; };
    function dailySeedUTC(size, offsetDays=0){
      const now=new Date(); const base=new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      base.setUTCDate(base.getUTCDate()+offsetDays);
      const y=base.getUTCFullYear(), m=base.getUTCMonth()+1, d=base.getUTCDate();
      return (y*10000+m*100+d) * (size*31+7);
    }
    const transpose = (A)=>{ const N=A.length, M=A[0]?.length||0; const T=Array.from({length:M},()=>Array(N).fill(0)); for(let r=0;r<N;r++) for(let c=0;c<M;c++) T[c][r]=A[r][c]; return T; };
    const lineHintsFromPattern = (lines)=> lines.map(line=>{ const out=[]; let c=0; for(const v of line){ if(v) c++; else if(c){ out.push(c); c=0; } } if(c) out.push(c); return out.length?out:[0]; });

    // Generator
    function genRandomSym(N, rng=Math.random){
      const p=Array.from({length:N},()=>Array(N).fill(0));
      for(let y=0;y<N;y++){
        for(let x=0;x<Math.ceil(N/2);x++){
          const v = rng()<0.45?1:0; p[y][x]=v; p[y][N-1-x]=v;
        }
      }
      return p;
    }

    // Audio
    let AC=null;
    function ensureAC(){ if(!cfg.sound) return null; try{ if(!AC) AC=new (window.AudioContext||window.webkitAudioContext)(); }catch{} return AC; }
    function blip(freq=420, dur=0.06, type='square', vol=0.0009){
      if(!cfg.sound) return; const ac=ensureAC(); if(!ac) return;
      try{ const o=ac.createOscillator(), g=ac.createGain(); o.type=type; o.frequency.value=freq; g.gain.value=vol; o.connect(g).connect(ac.destination); const t0=ac.currentTime; o.start(t0); g.gain.exponentialRampToValueAtTime(0.00001, t0+dur*.9); o.stop(t0+dur);}catch{}
    }
    const vibrate = (ms)=>{ if(cfg.haptics && navigator?.vibrate) try{navigator.vibrate(ms);}catch{} };

    // Share code
    function base64urlBytes(bytes){ const bin=String.fromCharCode.apply(null, bytes); return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
    function unbase64urlToBytes(str){ const pad=str.length%4?'='.repeat(4-(str.length%4)) : ''; const bin=atob(str.replace(/-/g,'+').replace(/_/g,'/')+pad); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
    function crc8(bytes){ let s=0; for(let i=0;i<bytes.length;i++) s=(s+bytes[i])&0xFF; return s; }
    function encodeGridToCode(grid){
      const N=grid.length, sizeCode=N===10?0:N===15?1:N===20?2:1;
      const bits=[]; for(let y=0;y<N;y++) for(let x=0;x<N;x++) bits.push(grid[y][x]===1?1:0);
      const rle=[]; let cur=bits[0], run=1;
      for(let i=1;i<bits.length;i++){ if(bits[i]===cur && run<127) run++; else { rle.push((cur?0x80:0)|run); cur=bits[i]; run=1; } }
      rle.push((cur?0x80:0)|run);
      const header=new Uint8Array([2,sizeCode]); const body=new Uint8Array(rle);
      const pre=new Uint8Array(header.length+body.length); pre.set(header,0); pre.set(body,header.length);
      const check=crc8(pre); const bytes=new Uint8Array(pre.length+1); bytes.set(pre,0); bytes[bytes.length-1]=check;
      return 'ng2:'+base64urlBytes(bytes);
    }
    function decodeCodeToGrid(code){
      if(!code.startsWith('ng2:')) throw new Error('Bad code prefix');
      const bytes=unbase64urlToBytes(code.slice(4)); if(bytes.length<3) throw new Error('Code too short');
      const chk=bytes[bytes.length-1]; const data=bytes.slice(0,-1); if(crc8(data)!==chk) throw new Error('Checksum mismatch');
      if(data[0]!==2) throw new Error('Unsupported version');
      const N=data[1]===0?10:data[1]===1?15:data[1]===2?20:15;
      const bits=[]; for(const b of data.slice(2)){ const v=(b&0x80)?1:0, len=(b&0x7F)||1; for(let i=0;i<len;i++) bits.push(v); }
      if(bits.length!==N*N) throw new Error('Bit length mismatch');
      const grid=Array.from({length:N},()=>Array(N).fill(0)); let k=0; for(let y=0;y<N;y++) for(let x=0;x<N;x++) grid[y][x]=bits[k++]?1:0; return {size:N, grid};
    }

    // =========================================================================
    // State
    // =========================================================================
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `width:min(96vw, 980px); margin:0 auto; position:relative; display:flex; flex-direction:column; gap:8px; align-items:center;`;
    api.mount.appendChild(wrapper);

    const getPortalRoot = ()=> document.fullscreenElement || wrapper;

    let view='play';                 // 'play'|'create'|'gallery'
    let modeSource='random';         // 'random'|'daily'|'gallery'|'code'|'code-temp'
    let currentCode=null;

    let N=Number(cfg.size);
    let pattern=null;                // 0/1
    let marks=null;                  // 0 blank, 1 green, 2 cross
    let rowsHints=null, colsHints=null;

    let solved=false, solvedAt=0;
    let strikes=0;
    let undoStack=[], redoStack=[];
    let timerMs=0, rushLeftMs=0, tick=null;

    // Interaction
    let strokeTarget=null;           // Play: 0|1|2; Create: 'fill'|'blank'
    let dragging=false;
    let activePointer=null;
    let batchSnapshot=null;

    // Editor
    let editorGrid=null;             // 0/1 only
    let editorSym='none';            // none|H|V|HV
    let editorContext=null;          // {id} when editing existing

    // Render helpers
    const lastChange=new Map();
    const pulseWrong=new Set();
    const lineGlow=[];
    const dirty=new Set(); const markDirty=(r,c)=>dirty.add(`${r},${c}`); const dirtyAll=()=>{ for(let r=0;r<N;r++) for(let c=0;c<N;c++) markDirty(r,c); };
    let rowHintsCanvas=null, colHintsCanvas=null; const invalidateHints=()=>{ rowHintsCanvas=null; colHintsCanvas=null; };
    let layout={ left:120, top:84, S:32, hintW:120, hintH:84, wide:true };

    // Debounced save
    let saveT=null; const persistDebounced=()=>{ clearTimeout(saveT); saveT=setTimeout(persist,120); };
    function persist(){ save('nonogram','save',{version:'3.2', cfg, N, pattern, marks, timerMs, rushLeftMs, strikes, mode:cfg.mode, modeSource, when:Date.now()}); }

    // =========================================================================
    // Styles
    // =========================================================================
    const style=document.createElement('style');
    style.textContent=`
      @keyframes rush-blink { 0%,50%,100%{opacity:1} 25%,75%{opacity:.25} }
      @keyframes hard-shake { 0%{transform:translate(0,0)} 20%{transform:translate(-6px,3px)} 40%{transform:translate(5px,-4px)} 60%{transform:translate(-5px,2px)} 80%{transform:translate(6px,-3px)} 100%{transform:translate(0,0)} }
      .rush-warn { color:#ff3b3b; animation: rush-blink .7s linear infinite; }
      .rush-shake { animation: hard-shake .2s linear infinite; }
      .seg { display:inline-flex; background:var(--seg-bg,#1f2432); border-radius:999px; padding:4px; gap:4px; }
      .seg .segbtn { padding:6px 10px; border-radius:999px; border:0; cursor:pointer; font:600 12px ui-sans-serif,system-ui; color:var(--seg-fg,#cfd6ea); background:transparent; }
      .seg .segbtn[aria-pressed="true"] { background:var(--seg-on,#2f374e); color:#fff; }
      .pill { border:0; border-radius:999px; padding:8px 12px; cursor:pointer; font:600 12px ui-sans-serif,system-ui; background:var(--pill-bg,#2a9d8f); color:#fff; }
      .pill.alt { background:var(--pill-alt,#2f374e); color:#cfd6ea; }
      .pill.small { padding:6px 10px; font-weight:600; }
      .popover { position:fixed; z-index:60; min-width:260px; background:var(--pop-bg,#121623); color:#cfd6ea; border-radius:12px; padding:8px; box-shadow:0 12px 28px rgba(0,0,0,.35); }
      .row { display:flex; align-items:center; gap:10px; margin:6px 0; }
      .lab { min-width:70px; font:600 12px ui-sans-serif; opacity:.9; }
      .toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:center; }
      .card { background:rgba(255,255,255,.04); border-radius:14px; padding:10px; display:flex; flex-direction:column; gap:8px; }
      .card .title { font:600 13px ui-sans-serif; display:flex; align-items:center; justify-content:space-between; gap:6px; }
      .card .meta { font:500 11px ui-sans-serif; opacity:.8; }
      .card .thumb { width:100%; border-radius:10px; background:#111; }
      .menu { position:fixed; z-index:60; background:var(--pop-bg,#121623); color:#cfd6ea; border-radius:10px; padding:6px; box-shadow:0 12px 28px rgba(0,0,0,.35); }
      .menu button { display:block; width:100%; text-align:left; background:transparent; border:0; padding:8px 10px; border-radius:8px; color:inherit; cursor:pointer; }
      .menu button:hover { background:rgba(255,255,255,.07); }
      .modal-back { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:80; display:flex; align-items:center; justify-content:center; padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
      .modal { background:var(--pop-bg,#121623); color:#cfd6ea; border-radius:14px; padding:14px; min-width:280px; max-width:92vw; }
      .modal h3 { margin:0 0 6px; font:700 14px ui-sans-serif; }
      .modal .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
      .input { width:100%; border:0; border-radius:10px; padding:8px 10px; background:#1f2432; color:#fff; font:500 12px ui-sans-serif; }
    `;
    document.head.appendChild(style);

    // Theme tokens
    function applyTheme(){
      const root=wrapper;
      if(cfg.theme==='dark'){
        root.style.setProperty('--ngp-bar-bg','#202536');
        root.style.setProperty('--ngp-bar-fill','#4fe3b0');
        root.style.setProperty('--seg-bg','#1f2432');
        root.style.setProperty('--seg-on','#2f374e');
        root.style.setProperty('--pill-bg','#2a9d8f');
        root.style.setProperty('--pill-alt','#2f374e');
      } else if(cfg.theme==='light'){
        root.style.setProperty('--ngp-bar-bg','#dcdfe7');
        root.style.setProperty('--ngp-bar-fill','#2a9d8f');
        root.style.setProperty('--seg-bg','#e9edf6');
        root.style.setProperty('--seg-on','#cfd6ea');
        root.style.setProperty('--pill-bg','#2a9d8f');
        root.style.setProperty('--pill-alt','#cfd6ea');
      } else {
        root.style.setProperty('--ngp-bar-bg','#000');
        root.style.setProperty('--ngp-bar-fill','#ff0');
        root.style.setProperty('--seg-bg','#000');
        root.style.setProperty('--seg-on','#222');
        root.style.setProperty('--pill-bg','#ff0');
        root.style.setProperty('--pill-alt','#222');
      }
    }
    applyTheme();

    // Header
    const topBar = document.createElement('div');
    topBar.style.cssText = `width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:4px;`;
    wrapper.appendChild(topBar);

    const title = document.createElement('div');
    title.textContent = 'Nonogram+';
    title.style.cssText = `font:600 18px/1.1 ui-sans-serif,system-ui; letter-spacing:.2px;`;
    topBar.appendChild(title);

    const headerRight = document.createElement('div');
    headerRight.style.cssText='display:flex; align-items:center; gap:8px;';
    topBar.appendChild(headerRight);

    const bestChip = document.createElement('div');
    bestChip.style.cssText = `font:500 12px ui-sans-serif,system-ui; opacity:.8;`;
    headerRight.appendChild(bestChip);

    const fsBtn = document.createElement('button');
    fsBtn.className='pill small alt';
    fsBtn.textContent='⛶';
    fsBtn.title='Toggle fullscreen';
    fsBtn.onclick=async()=>{
      try{
        if(document.fullscreenElement) await document.exitFullscreen();
        else await wrapper.requestFullscreen({navigationUI:'hide'});
      }catch{}
    };
    headerRight.appendChild(fsBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.className='pill small alt';
    settingsBtn.textContent = '⚙ Settings';
    headerRight.appendChild(settingsBtn);

    // Seg + helpers
    function seg(items, activeIndex, onChange){
      const wrap = document.createElement('div'); wrap.className='seg';
      items.forEach((name,i)=>{
        const b=document.createElement('button');
        b.className='segbtn'; b.textContent=name;
        b.setAttribute('aria-pressed', i===activeIndex?'true':'false');
        b.onclick=()=>{ if(b.getAttribute('aria-pressed')==='true') return;
          Array.from(wrap.children).forEach(c=>c.setAttribute('aria-pressed','false'));
          b.setAttribute('aria-pressed','true'); onChange(i);
        };
        wrap.appendChild(b);
      });
      return wrap;
    }
    function pill(txt, cb, alt=false){ const b=document.createElement('button'); b.className='pill'+(alt?' alt':''); b.textContent=txt; b.onclick=cb; return b; }

    // Portal helpers (fullscreen-safe)
    function placePopover(panel, anchor, offset=8){
      const root=getPortalRoot();
      panel.style.visibility='hidden';
      root.appendChild(panel);
      const ar=anchor.getBoundingClientRect();
      const pw=panel.offsetWidth, ph=panel.offsetHeight;
      let left = clamp(ar.left + (ar.width - pw)/2, 8, window.innerWidth - pw - 8);
      let top  = ar.bottom + offset;
      if(top + ph > window.innerHeight - 8){ top = Math.max(8, ar.top - ph - offset); }
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top  = `${Math.round(top)}px`;
      panel.style.visibility='visible';
      const close=(ev)=>{ if(!panel.contains(ev.target) && ev.target!==anchor){ panel.remove(); document.removeEventListener('mousedown', close, true); } };
      document.addEventListener('mousedown', close, true);
    }

    // Modals (fullscreen-safe)
    function openModal({title, content, actions}){
      const root=getPortalRoot();
      const back=document.createElement('div'); back.className='modal-back';
      const box=document.createElement('div'); box.className='modal'; back.appendChild(box);
      if(title){ const h=document.createElement('h3'); h.textContent=title; box.appendChild(h); }
      box.appendChild(content);
      const act=document.createElement('div'); act.className='actions';
      actions.forEach(a=>{ const b=pill(a.label,()=>{ a.onClick?.(); close(); }, a.alt); act.appendChild(b); });
      box.appendChild(act);
      root.appendChild(back);
      function close(){ back.remove(); }
      return { close };
    }
    function openConfirm(message, onYes){
      const content=document.createElement('div'); content.textContent=message;
      openModal({title:'Confirm', content, actions:[
        {label:'Cancel', alt:true, onClick:()=>{}},
        {label:'OK', onClick:onYes}
      ]});
    }
    function openPromptText(promptLabel, defaultValue, onOK){
      const wrap=document.createElement('div');
      const lab=document.createElement('div'); lab.textContent=promptLabel; lab.style.cssText='font:600 12px ui-sans-serif; margin-bottom:6px;';
      const inp=document.createElement('input'); inp.className='input'; inp.value=defaultValue||'';
      wrap.append(lab, inp);
      const m=openModal({title:'', content:wrap, actions:[
        {label:'Cancel', alt:true, onClick:()=>{}},
        {label:'Save', onClick:()=> onOK(inp.value.trim()||defaultValue||'Untitled')}
      ]});
      setTimeout(()=>inp.focus(), 0);
      return m;
    }

    // Toast (fullscreen-safe)
    let toastT=0;
    function toast(msg, danger=false){
      const root=getPortalRoot();
      let t=root.querySelector('#nonogram-toast');
      if(!t){ t=document.createElement('div'); t.id='nonogram-toast';
        t.style.cssText='position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:#202536cc; color:#fff; padding:10px 14px; border-radius:999px; z-index:90; font:500 13px ui-sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.25);';
        root.appendChild(t);
      }
      t.style.background = danger ? '#b00020' : '#202536cc';
      t.textContent=msg; t.style.opacity='1';
      clearTimeout(toastT); toastT=setTimeout(()=>{ t.style.transition='opacity .3s'; t.style.opacity='0'; }, 1400);
    }

    // Settings popover
    let settingsPop=null;
    settingsBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      if(settingsPop){ settingsPop.remove(); settingsPop=null; return; }
      settingsPop = buildSettingsPopover();
      placePopover(settingsPop, settingsBtn);
    });

    function buildSettingsPopover(){
      const p=document.createElement('div'); p.className='popover';
      p.style.setProperty('--pop-bg', cfg.theme==='light'?'#fff':'#121623');
      const row = (label, node)=>{ const r=document.createElement('div'); r.className='row'; const l=document.createElement('div'); l.className='lab'; l.textContent=label; r.append(l,node); return r; };
      const sizeSeg = seg(['10×10','15×15','20×20'], [10,15,20].indexOf(cfg.size), (i)=>{ cfg.size=[10,15,20][i]; save('nonogram','cfg',cfg); N=cfg.size; newGame(true); });
      const modeSeg = seg(['Random','Daily','Rush','Challenge'], ['random','daily','rush','challenge'].indexOf(cfg.mode), (i)=>{ cfg.mode=['random','daily','rush','challenge'][i]; save('nonogram','cfg',cfg); newGame(true); });
      const themeSeg= seg(['Dark','Light','HC'], ['dark','light','highcontrast'].indexOf(cfg.theme), (i)=>{ cfg.theme=['dark','light','highcontrast'][i]; save('nonogram','cfg',cfg); applyTheme(); dirtyAll(); });
      const assistSeg= seg(['Assist Off','Assist On'], cfg.assist?1:0, (i)=>{ cfg.assist=!!i; save('nonogram','cfg',cfg); });
      const errSeg   = seg(['Soft','Strict'], cfg.errorMode==='soft'?0:1, (i)=>{ cfg.errorMode=i? 'strict':'soft'; save('nonogram','cfg',cfg); });

      const importBtn = pill('Import…', ()=> openImportPopover(importBtn), true);

      p.append(
        row('Size', sizeSeg),
        row('Mode', modeSeg),
        row('Theme', themeSeg),
        row('Assist', assistSeg),
        row('Errors', errSeg),
        importBtn
      );
      return p;
    }

    // Import (paste code / upload JSON) → Play Now or Add to Gallery
    const jsonInput = document.createElement('input'); jsonInput.type='file'; jsonInput.accept='.json,application/json'; jsonInput.style.display='none'; wrapper.appendChild(jsonInput);
    function openImportPopover(anchorBtn){
      const p=document.createElement('div'); p.className='popover';
      const inputRow=document.createElement('div'); inputRow.className='row';
      const input=document.createElement('input'); input.placeholder='Paste puzzle code (ng2:...)'; input.className='input';
      inputRow.append(input);
      const preview=document.createElement('div'); preview.style.cssText='margin:6px 0; font:500 11px ui-sans-serif; opacity:.85;';
      preview.textContent='No puzzle loaded.';
      const actions=document.createElement('div'); actions.className='toolbar';
      const playBtn=pill('Play Now', ()=>{ if(!curGrid){ toast('Paste a code or upload JSON first.',true); return; } navSelect(0); setPatternAndReset(curGrid,'code-temp'); p.remove(); });
      const addBtn=pill('Add to Gallery', ()=>{ if(!curGrid){ toast('Paste a code or upload JSON first.',true); return; } openPromptText('Name this puzzle', 'Imported', (name)=>{ const code=encodeGridToCode(curGrid); addToGallery({name, size:curGrid.length, grid:curGrid, code}); toast('Added to My Gallery.'); renderGallery(); p.remove(); }); }, true);
      const uploadBtn=pill('Upload JSON', ()=> jsonInput.click(), true);
      actions.append(playBtn, addBtn, uploadBtn);
      p.append(inputRow, preview, actions);

      let curGrid=null;
      function setPreviewFromGrid(grid){ curGrid=grid; preview.textContent = `Loaded ${grid.length}×${grid.length} puzzle.`; }
      input.addEventListener('change', tryDecode);
      input.addEventListener('keyup', (ev)=> ev.key==='Enter' && tryDecode());
      function tryDecode(){
        try{ const {size, grid} = decodeCodeToGrid(input.value.trim()); setPreviewFromGrid(grid); }
        catch(err){ preview.textContent = (input.value.trim()? (err?.message||'Invalid code'): 'No puzzle loaded.'); curGrid=null; }
      }
      jsonInput.onchange = async (e)=>{
        const f=e.target.files?.[0]; if(!f) return;
        try{
          const obj=JSON.parse(await f.text());
          if(Array.isArray(obj?.grid) && obj.size){
            const grid=normalizeToGrid(obj.grid, obj.size); setPreviewFromGrid(grid);
          } else { toast('Invalid JSON.',true); }
        }catch{ toast('Invalid JSON.',true); }
        jsonInput.value='';
      };

      placePopover(p, anchorBtn);
    }

    // Share (Copy, Copy Text, Share…, Export JSON)
    function openSharePopover(anchorBtn){
      const code = currentCode || (pattern? encodeGridToCode(pattern) : '');
      const p=document.createElement('div'); p.className='popover';
      const label=document.createElement('div'); label.textContent='Share code'; label.style.cssText='font:600 12px ui-sans-serif; margin-bottom:6px;';
      const input=document.createElement('input'); input.className='input'; input.readOnly=true; input.value=code;
      const actions=document.createElement('div'); actions.className='toolbar';
      const copyBtn=pill('Copy Code', async ()=>{ try{ await navigator.clipboard.writeText(code); toast('Copied!'); }catch{ toast('Copy failed', true); } });
      const copyText=pill('Copy Text', async ()=>{ const text=`Play my Nonogram+: ${location.origin+location.pathname}?p=${encodeURIComponent(code)}\nCode: ${code}`; try{ await navigator.clipboard.writeText(text); toast('Copied text!'); }catch{ toast('Copy failed', true); } }, true);
      const sysBtn=pill('Share…', async ()=>{
        if(navigator.share){ try{ await navigator.share({text:`Play Nonogram+`, url: location.origin + location.pathname + '?p='+encodeURIComponent(code)}); }catch{} }
        else { try{ await navigator.clipboard.writeText(code); toast('Copied code.'); }catch{ toast('Copy failed', true); } }
      }, true);
      const expBtn=pill('Export JSON', ()=>{
        const blob = new Blob([JSON.stringify({size:N, grid:pattern}, null, 2)],{type:'application/json'});
        const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=`nonogram_${N}.json`; getPortalRoot().appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
      }, true);
      actions.append(copyBtn, copyText, sysBtn, expBtn);
      p.append(label, input, actions);
      placePopover(p, anchorBtn);
    }

    // Nav
    const nav = seg(['Play','Create','My Gallery'], 0, (i)=>{ view = (i===0)?'play' : (i===1)?'create' : 'gallery'; switchView(); });
    wrapper.appendChild(nav);

    // Rush panel + canvas + HUD
    const rushPanel = document.createElement('div');
    rushPanel.style.cssText = `display:none; align-items:center; justify-content:center; font:700 clamp(28px,8vw,64px) ui-monospace,monospace; padding:4px 10px; min-width:120px;`;
    wrapper.appendChild(rushPanel);

    const canvas = document.createElement('canvas');
    canvas.style.display='block'; canvas.style.margin='0 auto'; canvas.setAttribute('aria-label','Nonogram board');
    canvas.style.touchAction='none';
    wrapper.appendChild(canvas);
    const g = canvas.getContext('2d');

    const hud = makeHUD(api,{score:false,lives:false,time:true});
    const confettiCanvas = document.createElement('canvas');
    confettiCanvas.style.cssText='position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:50;';
    wrapper.appendChild(confettiCanvas);
    const confetti = makeConfetti(confettiCanvas,{duration:TUNABLES.confettiMs/1000});

    const progressBar = document.createElement('div');
    progressBar.style.cssText='height:8px; border-radius:6px; overflow:hidden; width:100%; max-width:820px; background:var(--ngp-bar-bg,#2a2f3b);';
    const progressFill = document.createElement('div');
    progressFill.style.cssText='height:100%; width:0%; background:var(--ngp-bar-fill,#4fe3b0); transition:width .18s ease;';
    progressBar.appendChild(progressFill);
    wrapper.appendChild(progressBar);

    // Play controls
    const playControls = document.createElement('div');
    playControls.className='toolbar';
    const btnUndo = pill('Undo', ()=>undo());
    const btnRedo = pill('Redo', ()=>redo());
    const btnHint = pill('Hint', ()=>useHint(), true);
    const btnRestart = pill('Restart', ()=>openConfirm('Restart this puzzle? Progress will be cleared.', ()=>restartSame()), true);
    const btnNew = pill('New', ()=>newGame());
    const btnSaveToGallery = pill('Save to Gallery', ()=>saveCurrentPatternToGallery(), true);
    const btnShare = pill('Share', (ev)=> openSharePopover(btnShare), true);
    playControls.append(btnUndo, btnRedo, btnHint, btnRestart, btnNew, btnSaveToGallery, btnShare);
    wrapper.appendChild(playControls);

    // Create toolbar (Fill/Blank only)
    const createBar = document.createElement('div');
    createBar.className='toolbar'; createBar.style.display='none';
    const toolSeg = seg(['■ Fill','☐ Blank'], 0, (i)=> editorTool = (i===0?'fill':'blank') );
    const symSeg = seg(['No Sym','Mirror H','Mirror V','Mirror HV'], 0, (i)=> editorSym = ['none','H','V','HV'][i]);
    const btnClear = pill('Clear', ()=> editorClear(), true);
    const btnValidate = pill('Validate', ()=> editorValidate());
    const btnSave = pill('Save to My Gallery', ()=> editorSave());
    const btnImport = pill('Import…', (ev)=> openImportPopover(btnImport), true);
    createBar.append(toolSeg, symSeg, btnClear, btnValidate, btnSave, btnImport);
    wrapper.appendChild(createBar);

    // Gallery view
    const galleryView = document.createElement('div');
    galleryView.style.cssText='display:none; width:100%;';
    const galleryTools = document.createElement('div'); galleryTools.className='toolbar';
    const btnImportGallery = pill('Import…', (ev)=> openImportPopover(btnImportGallery), true);
    galleryTools.append(btnImportGallery);
    galleryView.appendChild(galleryTools);

    const cardsWrap = document.createElement('div');
    cardsWrap.style.cssText='display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; width:100%;';
    galleryView.appendChild(cardsWrap);
    wrapper.appendChild(galleryView);

    // =========================================================================
    // View switching
    // =========================================================================
    function navSelect(i){
      Array.from(nav.children).forEach((ch,idx)=> ch.setAttribute('aria-pressed', idx===i?'true':'false'));
      view = (i===0)?'play' : (i===1)?'create' : 'gallery';
      switchView();
    }
    function switchView(){
      const playOn = view==='play', createOn=view==='create', galOn=view==='gallery';
      canvas.style.display='block';
      playControls.style.display = playOn? 'flex':'none';
      createBar.style.display = createOn? 'flex':'none';
      galleryView.style.display = galOn? 'block':'none';
      rushPanel.style.display = (cfg.mode==='rush' && playOn)? 'flex':'none';
      if(createOn){
        if(!editorGrid || editorGrid.length!==N) editorInit(N);
      }
      if(galOn){ renderGallery(); }
      layoutAndFit(); dirtyAll(); updateSaveBtnState(); updateUndoRedoButtons();
    }

    // =========================================================================
    // Game Flow (Play)
    // =========================================================================
    function updateBestChip(){
      const key = `best_${cfg.mode}_${N}`;
      const best = load('nonogram', key, null);
      bestChip.textContent = (best==null ? 'Best: —' : `Best: ${formatTime(best)}`);
    }
    function setPatternAndReset(srcPattern, src){
      modeSource = src || 'random';
      pattern = srcPattern.map(r=> r.slice());
      rowsHints = lineHintsFromPattern(pattern);
      colsHints = lineHintsFromPattern(transpose(pattern));
      marks = Array.from({length:N},()=>Array(N).fill(0));
      solved=false; solvedAt=0; strikes=0; dragging=false; strokeTarget=null; activePointer=null;
      undoStack=[]; redoStack=[]; pulseWrong.clear(); lineGlow.length=0; lastChange.clear();
      invalidateHints(); dirtyAll();
      timerMs=0;
      rushLeftMs = (cfg.mode==='rush')? cfg.rushSeconds*1000 : 0;
      currentCode = encodeGridToCode(pattern);
      updateSaveBtnState();
      updateBestChip();
      layoutAndFit();
      startTimer();
      persistDebounced();
      updateRushUI();
      progressFill.style.width='0%';
    }
    function newGame(fromSettings=false){
      N=Number(cfg.size);
      const srcPattern = (cfg.mode==='daily')
        ? genRandomSym(N, mulberry32(FLAGS.seed ?? dailySeedUTC(N)))
        : genRandomSym(N);
      setPatternAndReset(srcPattern, cfg.mode==='daily' ? 'daily':'random');
      if(!fromSettings) toast('New puzzle.');
      if(view!=='play') navSelect(0);
    }
    function restartSame(){ if(!pattern) return; setPatternAndReset(pattern, modeSource); toast('Restarted.'); }
    function startTimer(){
      clearInterval(tick);
      tick=setInterval(()=>{
        if(solved) return;
        if(cfg.mode==='rush'){
          rushLeftMs = Math.max(0, rushLeftMs-1000);
          hud.setTime(rushLeftMs); updateRushUI();
          if(rushLeftMs===0 && !solved) onLose('Time is up!');
        } else {
          timerMs += 1000; hud.setTime(timerMs);
        }
      }, 1000);
    }
    function onLose(reason){ toast(`Game Over — ${reason}`, true); vibrate(200); }
    function onWin(){
      if(solved) return;
      solved=true; solvedAt=performance.now(); clearInterval(tick);
      const key = `best_${cfg.mode}_${N}`;
      const timeVal = (cfg.mode==='rush') ? (cfg.rushSeconds*1000 - rushLeftMs) : timerMs;
      const best=load('nonogram',key,null); if(best==null || timeVal<best) save('nonogram',key,timeVal);
      updateBestChip();
      confetti.resize(); confetti.burst({count:260});
      toast('Solved! 🎉');
      updateGalleryStatsForPattern(pattern, timeVal);
    }

    // Save current pattern to gallery (dedupe)
    function saveCurrentPatternToGallery(){
      if(!pattern) return;
      const code = currentCode || encodeGridToCode(pattern);
      const g=loadGallery();
      if(g.some(x=>x.code===code)){ toast('Already in My Gallery.'); return; }
      openPromptText('Name this puzzle', 'My Puzzle', (name)=>{ addToGallery({name, size:N, grid:pattern, code}); toast('Saved to My Gallery.'); });
    }
    function updateSaveBtnState(){
      const code = pattern ? (currentCode || encodeGridToCode(pattern)) : null;
      const exists = code ? loadGallery().some(x=>x.code===code) : false;
      btnSaveToGallery.disabled = exists;
      btnSaveToGallery.title = exists ? 'Already in My Gallery' : '';
    }

    // =========================================================================
    // Create (Editor)
    // =========================================================================
    let editorTool='fill';
    function editorInit(size){
      N=size; editorGrid=Array.from({length:N},()=>Array(N).fill(0)); editorContext=null;
      rowsHints=lineHintsFromPattern(editorGrid); colsHints=lineHintsFromPattern(transpose(editorGrid));
      invalidateHints(); dirtyAll(); layoutAndFit();
    }
    function editorClear(){
      if(!editorGrid) return;
      for(let r=0;r<N;r++) for(let c=0;c<N;c++) editorGrid[r][c]=0;
      rowsHints=lineHintsFromPattern(editorGrid); colsHints=lineHintsFromPattern(transpose(editorGrid));
      invalidateHints(); dirtyAll(); toast('Cleared.');
    }
    function editorApplyCell(r,c, tool){
      let v = tool==='fill'? 1 : 0; // only 0/1
      if(editorSym==='H' || editorSym==='HV'){ const cc=N-1-c; if(editorGrid[r][cc]!==v){ editorGrid[r][cc]=v; markDirty(r,cc);} }
      if(editorSym==='V' || editorSym==='HV'){ const rr=N-1-r; if(editorGrid[rr][c]!==v){ editorGrid[rr][c]=v; markDirty(rr,c);} }
      if(editorGrid[r][c]!==v){ editorGrid[r][c]=v; markDirty(r,c); }
      rowsHints=lineHintsFromPattern(editorGrid); colsHints=lineHintsFromPattern(transpose(editorGrid));
    }
    function editorValidate(){
      const hasAny = editorGrid.flat().some(v=>v===1);
      if(!hasAny) return toast('Add some filled cells first.', true);
      toast('Looks good!');
    }
    function editorSave(){
      const grid = editorGrid.map(row=> row.map(v=> v===1?1:0));
      const code = encodeGridToCode(grid);
      const g=loadGallery(); if(g.some(x=>x.code===code)){ toast('Already in My Gallery.'); navSelect(2); return; }
      const nameDefault = editorContext?.name || 'My Creation';
      openPromptText('Name your creation', nameDefault, (name)=>{
        if(editorContext?.id){
          const gg=loadGallery(); const idx=gg.findIndex(x=>x.id===editorContext.id);
          if(idx>=0){ gg[idx].name=name; gg[idx].grid=grid; gg[idx].size=grid.length; gg[idx].code=code; saveGallery(gg); toast('Saved changes.'); renderGallery(); navSelect(2); return; }
        }
        addToGallery({name, size:N, grid, code}); toast('Saved to My Gallery.'); navSelect(2);
      });
    }

    // =========================================================================
    // Gallery
    // =========================================================================
    function loadGallery(){ return load('nonogram','gallery',[])||[]; }
    function saveGallery(arr){ save('nonogram','gallery',arr); }
    const newId = ()=> 'ng_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);

    function addToGallery({name, size, grid, code}){
      const g=loadGallery(); if(code && g.some(x=>x.code===code)){ saveGallery(g); renderGallery(); return; }
      g.push({ id:newId(), name, size, grid, code, createdAt:Date.now(), tags:[], stats:{plays:0, bestMs:null} });
      saveGallery(g); renderGallery();
    }
    function renderGallery(){
      const g = loadGallery();
      cardsWrap.innerHTML='';
      if(!g.length){
        const empty = document.createElement('div');
        empty.style.cssText='opacity:.7; font:500 13px ui-sans-serif; text-align:center; padding:20px;';
        empty.textContent='Your gallery is empty. Create a puzzle or import a code to get started.';
        cardsWrap.appendChild(empty);
        return;
      }
      g.forEach(item=>{
        const card = document.createElement('div'); card.className='card';
        const ttl = document.createElement('div'); ttl.className='title';
        const nameSpan = document.createElement('span'); nameSpan.textContent=item.name;
        const menuBtn = pill('⋯', ()=> openCardMenu(menuBtn, item), true);
        ttl.append(nameSpan, menuBtn);

        const canvasThumb = document.createElement('canvas'); canvasThumb.width=120; canvasThumb.height=120; canvasThumb.className='thumb';
        const cg = canvasThumb.getContext('2d'); const s=item.size, cell=Math.floor(120/s);
        cg.fillStyle='#111'; cg.fillRect(0,0,120,120);
        for(let y=0;y<s;y++) for(let x=0;x<s;x++) if(item.grid[y][x]){ cg.fillStyle='#4fe3b0'; cg.fillRect(x*cell+2,y*cell+2,cell-4,cell-4); }
        const meta = document.createElement('div'); meta.className='meta'; meta.textContent=`${item.size}×${item.size} · plays ${item.stats?.plays||0}${item.stats?.bestMs? ` · best ${formatTime(item.stats.bestMs)}`:''}`;

        const row = document.createElement('div'); row.className='toolbar';
        const playBtn = pill('Play', ()=> playGalleryItem(item));
        const shareBtn = pill('Share', (ev)=> openShareSpecific(item, shareBtn), true);
        row.append(playBtn, shareBtn);

        card.append(ttl, canvasThumb, meta, row);
        cardsWrap.appendChild(card);
      });
    }
    function openCardMenu(anchor, item){
      const m=document.createElement('div'); m.className='menu';
      const opt = (label, cb)=>{ const b=document.createElement('button'); b.textContent=label; b.onclick=()=>{ cb(); m.remove(); }; m.appendChild(b); };
      opt('Rename', ()=> openPromptText('Rename puzzle', item.name, (nv)=>{ const g=loadGallery(); const idx=g.findIndex(x=>x.id===item.id); if(idx>=0){ g[idx].name=nv; saveGallery(g); renderGallery(); }}));
      opt('Edit', ()=> { navSelect(1); editorInit(item.size); editorContext={id:item.id, name:item.name}; for(let r=0;r<N;r++) for(let c=0;c<N;c++) editorGrid[r][c]=item.grid[r][c]; invalidateHints(); dirtyAll(); toast('Loaded in editor.'); });
      opt('Duplicate', ()=>{ const g=loadGallery(); const idx=g.findIndex(x=>x.id===item.id); if(idx>=0){ const clone=JSON.parse(JSON.stringify(g[idx])); clone.id=newId(); clone.name=clone.name+' (copy)'; clone.createdAt=Date.now(); g.push(clone); saveGallery(g); renderGallery(); }});
      opt('Export JSON', ()=>{ const blob=new Blob([JSON.stringify({size:item.size, grid:item.grid}, null, 2)],{type:'application/json'}); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=`${item.name.replace(/\s+/g,'_')}.json`; getPortalRoot().appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); });
      opt('Delete', ()=> openConfirm('Delete this puzzle?', ()=>{ const g=loadGallery(); const idx=g.findIndex(x=>x.id===item.id); if(idx>=0){ g.splice(idx,1); saveGallery(g); renderGallery(); toast('Deleted.'); } }));
      // place
      getPortalRoot().appendChild(m);
      const ar=anchor.getBoundingClientRect(); const mw=180, mh=m.offsetHeight||160;
      let left = clamp(ar.left - 40, 8, window.innerWidth - mw - 8);
      let top  = ar.bottom + 6; if(top + mh > window.innerHeight - 8) top = Math.max(8, ar.top - mh - 6);
      m.style.left=`${left}px`; m.style.top=`${top}px`;
      const close=(ev)=>{ if(!m.contains(ev.target) && ev.target!==anchor){ m.remove(); document.removeEventListener('mousedown', close, true); } };
      document.addEventListener('mousedown', close, true);
    }
    function openShareSpecific(item, anchorBtn){
      const code = item.code || encodeGridToCode(item.grid);
      const p=document.createElement('div'); p.className='popover';
      const label=document.createElement('div'); label.textContent='Share code'; label.style.cssText='font:600 12px ui-sans-serif; margin-bottom:6px;';
      const input=document.createElement('input'); input.className='input'; input.readOnly=true; input.value=code;
      const actions=document.createElement('div'); actions.className='toolbar';
      const copyBtn=pill('Copy Code', async ()=>{ try{ await navigator.clipboard.writeText(code); toast('Copied!'); }catch{ toast('Copy failed', true); } });
      const copyText=pill('Copy Text', async ()=>{ const text=`Play "${item.name}" in Nonogram+: ${location.origin+location.pathname}?p=${encodeURIComponent(code)}\nCode: ${code}`; try{ await navigator.clipboard.writeText(text); toast('Copied text!'); }catch{ toast('Copy failed', true); } }, true);
      const sysBtn=pill('Share…', async ()=>{ if(navigator.share){ try{ await navigator.share({text:`Play "${item.name}"`, url: location.origin + location.pathname + '?p='+encodeURIComponent(code)}); }catch{} } else { try{ await navigator.clipboard.writeText(code); toast('Copied code.'); }catch{ toast('Copy failed', true); } } }, true);
      const expBtn=pill('Export JSON', ()=>{ const blob=new Blob([JSON.stringify({size:item.size, grid:item.grid}, null, 2)],{type:'application/json'}); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=`${item.name.replace(/\s+/g,'_')}.json`; getPortalRoot().appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); }, true);
      actions.append(copyBtn, copyText, sysBtn, expBtn);
      p.append(label, input, actions);
      placePopover(p, anchorBtn);
    }
    function playGalleryItem(item){
      cfg.size = item.size; save('nonogram','cfg',cfg);
      N=item.size; navSelect(0);
      setPatternAndReset(item.grid, 'gallery');
      toast(`Playing: ${item.name}`);
    }
    function updateGalleryStatsForPattern(grid, timeMs){
      const g=loadGallery(); const match = g.find(it=> it.size===N && equalGrid(it.grid, grid));
      if(match){
        match.stats = match.stats || {plays:0,bestMs:null};
        match.stats.plays = (match.stats.plays|0)+1;
        if(match.stats.bestMs==null || timeMs<match.stats.bestMs) match.stats.bestMs=timeMs;
        saveGallery(g); renderGallery();
      }
    }
    const equalGrid = (a,b)=> a.length===b.length && a.every((row,i)=> row.length===b[i].length && row.every((v,j)=> v===b[i][j]));

    // =========================================================================
    // Layout & responsive
    // =========================================================================
    const ro = new ResizeObserver(()=> layoutAndFit());
    ro.observe(wrapper);

    function layoutAndFit(){
      const W = wrapper.clientWidth;
      const wide = W>=640; layout.wide=wide;
      rushPanel.style.display = (cfg.mode==='rush' && view==='play') ? 'flex':'none';

      const hintW = Math.max(110, Math.floor(18 + N * (cfg.theme==='highcontrast'? 10: 8)));
      const hintH = Math.max(84,  Math.floor(18 + N * (cfg.theme==='highcontrast'? 10: 8)));
      const sidebar = (cfg.mode==='rush' && view==='play' && wide) ? 160 : 0;
      const pad = 20;

      const Sguess = Math.floor(Math.min((W - hintW - pad - sidebar) / N, (window.innerHeight*0.65 - hintH - pad) / N));
      const S = clamp(Sguess, TUNABLES.minCell, TUNABLES.maxCell);
      layout.S = S; layout.left=hintW; layout.top=hintH; layout.hintW=hintW; layout.hintH=hintH;

      const cw = N*S + hintW + pad + sidebar;
      const ch = N*S + hintH + pad;
      fitCanvas(canvas, cw, ch);

      if(cfg.mode==='rush' && view==='play'){
        if(wide){ rushPanel.style.alignSelf='flex-end'; rushPanel.style.order='0'; rushPanel.style.marginLeft='auto'; rushPanel.style.marginTop='0'; }
        else { rushPanel.style.order='3'; rushPanel.style.marginTop='6px'; rushPanel.style.marginLeft='0'; }
      }
    }
    function updateRushUI(){
      if(cfg.mode!=='rush' || view!=='play') return;
      const s = Math.floor(rushLeftMs/1000);
      rushPanel.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      const warn = s<=TUNABLES.warnBlinkStart, shake = s<=TUNABLES.hardShakeStart;
      rushPanel.classList.toggle('rush-warn', warn);
      wrapper.classList.toggle('rush-shake', shake);
    }

    // =========================================================================
    // Input — Pointer Events (instant click + drag)
    // =========================================================================
    function decideStrokeTarget(button, startState){
      if(view==='create'){ return (button===2)? 'blank' : ((startState===0)? 'fill':'blank'); }
      // PLAY
      if(button===0) return (startState===0)? 1 : 0;
      if(button===2) return 2;
      return 1;
    }
    function eventToCell(e){
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const {left,top,S} = layout;
      const c = Math.floor((x - left)/S), r = Math.floor((y - top)/S);
      if(c>=0 && c<N && r>=0 && r<N) return [r,c];
      return null;
    }

    canvas.addEventListener('pointerdown', (e)=>{
      if(view==='gallery') return;
      const cell = eventToCell(e); if(!cell) return;
      activePointer=e.pointerId; canvas.setPointerCapture(activePointer);
      const [r,c]=cell;
      if(view==='create'){
        dragging=true; strokeTarget = decideStrokeTarget(e.button, editorGrid[r][c]);
        editorApplyCell(r,c, strokeTarget==='fill'?'fill':'blank');
        e.preventDefault(); return;
      }
      if(solved) return;
      dragging=true; strokeTarget = decideStrokeTarget(e.button, marks[r][c]);
      beginBatch(); paintCell(r,c, strokeTarget); e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e)=>{
      if(!dragging) return;
      const cell = eventToCell(e); if(!cell) return;
      const [r,c]=cell;
      if(view==='create'){ editorApplyCell(r,c, strokeTarget==='fill'?'fill':'blank'); }
      else { paintCell(r,c, strokeTarget); }
      e.preventDefault();
    });
    function endPointer(){
      if(!dragging) return; dragging=false; strokeTarget=null;
      if(view==='create'){ invalidateHints(); dirtyAll(); return; }
      endBatch(); persistDebounced(); if(checkWin()) onWin();
    }
    canvas.addEventListener('pointerup', ()=>{ try{ if(activePointer!=null) canvas.releasePointerCapture(activePointer); }catch{} activePointer=null; endPointer(); });
    canvas.addEventListener('pointercancel', ()=>{ try{ if(activePointer!=null) canvas.releasePointerCapture(activePointer); }catch{} activePointer=null; endPointer(); });
    canvas.addEventListener('contextmenu', (e)=> e.preventDefault());

    // =========================================================================
    // Paint (Play)
    // =========================================================================
    function paintCell(r,c,target){
      if(marks[r][c]===target) return;
      marks[r][c]=target; markDirty(r,c);
      lastChange.set(`${r},${c}`, {t:performance.now(), s:target});
      if(target===1){
        if(cfg.errorMode==='soft' && pattern[r][c]===0){
          pulseWrong.add(`${r},${c}`); vibrate(30); blip(340,.06,'square',.0007);
          setTimeout(()=> pulseWrong.delete(`${r},${c}`), 160);
        } else { blip(380,.06,'square',.0007); }
      } else if(target===2){ blip(220,.06,'square',.0007); }

      const beforeRow = rowSolved(r), beforeCol = colSolved(c);
      autoCrossCompletedLines(r,c);
      const afterRow = rowSolved(r), afterCol = colSolved(c);
      if(!beforeRow && afterRow){
        lineGlow.push({type:'row', idx:r, t0:performance.now()});
        if(cfg.mode==='rush'){ rushLeftMs = Math.min(rushLeftMs + 5000, cfg.rushSeconds*1000); updateRushUI(); }
      }
      if(!beforeCol && afterCol){
        lineGlow.push({type:'col', idx:c, t0:performance.now()});
        if(cfg.mode==='rush'){ rushLeftMs = Math.min(rushLeftMs + 5000, cfg.rushSeconds*1000); updateRushUI(); }
      }
      progressFill.style.width=`${Math.floor(computeProgress()*100)}%`;
    }
    function beginBatch(){ batchSnapshot = serializeMarks(marks); }
    function endBatch(){
      const snap2 = serializeMarks(marks);
      if(snap2!==batchSnapshot){
        undoStack.push(batchSnapshot);
        if(undoStack.length>TUNABLES.maxUndo) undoStack.shift();
        redoStack.length=0;
      }
      batchSnapshot=null; updateUndoRedoButtons();
    }
    function updateUndoRedoButtons(){
      btnUndo.disabled = !undoStack.length;
      btnRedo.disabled = !redoStack.length;
    }
    const serializeMarks = (m)=> m.map(r=>r.join('')).join('|');
    const deserializeMarks = (s)=> s.split('|').map(line=> line.split('').map(Number));
    function undo(){ if(!undoStack.length) return; redoStack.push(serializeMarks(marks)); marks = deserializeMarks(undoStack.pop()); persistDebounced(); dirtyAll(); updateUndoRedoButtons(); }
    function redo(){ if(!redoStack.length) return; undoStack.push(serializeMarks(marks)); marks = deserializeMarks(redoStack.pop()); persistDebounced(); dirtyAll(); updateUndoRedoButtons(); }

    // Hints (Play)
    function useHint(){
      if(view!=='play' || solved) return;
      if(cfg.errorMode==='strict' || cfg.mode==='challenge'){ toast('Hints disabled in Strict/Challenge.', true); return; }
      const cand=[];
      for(let r=0;r<N;r++) if(!rowSolved(r)) cand.push({type:'row', idx:r, left: lineRemaining(r,true)});
      for(let c=0;c<N;c++) if(!colSolved(c)) cand.push({type:'col', idx:c, left: lineRemaining(c,false)});
      if(!cand.length){ toast('Nothing to hint.'); return; }
      cand.sort((a,b)=> a.left - b.left);
      const pick = cand[0];
      beginBatch();
      if(pick.type==='row'){
        const r=pick.idx; for(let c=0;c<N;c++){ const want = pattern[r][c]?1:2; if(marks[r][c]!==want){ marks[r][c]=want; markDirty(r,c); } }
        lineGlow.push({type:'row', idx:r, t0:performance.now()});
      } else {
        const c=pick.idx; for(let r=0;r<N;r++){ const want = pattern[r][c]?1:2; if(marks[r][c]!==want){ marks[r][c]=want; markDirty(r,c); } }
        lineGlow.push({type:'col', idx:c, t0:performance.now()});
      }
      endBatch(); autoCrossSweep(); persistDebounced();
      if(checkWin()) onWin(); else blip(660,.08,'sine',.0008);
    }
    function lineRemaining(i, isRow){
      let rem=0;
      if(isRow){ for(let c=0;c<N;c++) if(marks[i][c]!== (pattern[i][c]?1:2)) rem++; }
      else { for(let r=0;r<N;r++) if(marks[r][i]!== (pattern[r][i]?1:2)) rem++; }
      return rem;
    }

    // Logic helpers
    function rowSolved(r){
      for(let c=0;c<N;c++){
        if(pattern[r][c]===1 && marks[r][c]!==1) return false;
        if(pattern[r][c]===0 && marks[r][c]===1) return false;
      }
      return true;
    }
    function colSolved(c){
      for(let r=0;r<N;r++){
        if(pattern[r][c]===1 && marks[r][c]!==1) return false;
        if(pattern[r][c]===0 && marks[r][c]===1) return false;
      }
      return true;
    }
    function autoCrossCompletedLines(r,c){
      if(!cfg.assist) return;
      if(rowSolved(r)) for(let cc=0; cc<N; cc++) if(pattern[r][cc]===0 && marks[r][cc]===0){ marks[r][cc]=2; tagChange(r,cc,2); markDirty(r,cc); }
      if(colSolved(c)) for(let rr=0; rr<N; rr++) if(pattern[rr][c]===0 && marks[rr][c]===0){ marks[rr][c]=2; tagChange(rr,c,2); markDirty(rr,c); }
    }
    function autoCrossSweep(){
      if(!cfg.assist) return;
      for(let r=0;r<N;r++) if(rowSolved(r)) for(let c=0;c<N;c++) if(pattern[r][c]===0 && marks[r][c]===0){ marks[r][c]=2; tagChange(r,c,2); markDirty(r,c); }
      for(let c=0;c<N;c++) if(colSolved(c)) for(let r=0;r<N;r++) if(pattern[r][c]===0 && marks[r][c]===0){ marks[r][c]=2; tagChange(r,c,2); markDirty(r,c); }
    }
    function computeProgress(){
      let correct=0, total=N*N;
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if( (pattern[r][c]===1 && marks[r][c]===1) || (pattern[r][c]===0 && marks[r][c]!==1) ) correct++;
      }
      return correct/total;
    }
    function checkWin(){
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if((pattern[r][c]===1)!==(marks[r][c]===1)) return false;
      }
      return true;
    }
    function tagChange(r,c,state){
      lastChange.set(`${r},${c}`,{t:performance.now(), s:state});
      if(lastChange.size> N*N) lastChange.clear();
    }

    // =========================================================================
    // Render
    // =========================================================================
    const currentBG = ()=> cfg.theme==='dark' ? '#0f1320' : (cfg.theme==='light' ? '#f9f9f9' : '#000');
    const gridBold  = ()=> cfg.theme==='highcontrast' ? '#fff' : '#2a3447';
    const gridThin  = ()=> cfg.theme==='highcontrast' ? '#aaa' : '#1a2130';
    const fillColor = ()=> cfg.theme==='highcontrast' ? '#ff0' : '#4fe3b0';
    const crossColor= ()=> cfg.theme==='highcontrast' ? '#ff0' : '#ff6b6b';

    function renderHints(g,left,top,S, useGridForHints=null, dim=false){
      const HsrcRows = useGridForHints || pattern;
      const HsrcCols = transpose(useGridForHints || pattern);
      if(!rowHintsCanvas){ rowHintsCanvas = document.createElement('canvas'); rowHintsCanvas.width = left-10; rowHintsCanvas.height = top + N*S; }
      if(!colHintsCanvas){ colHintsCanvas = document.createElement('canvas'); colHintsCanvas.width = left + N*S; colHintsCanvas.height = top; }
      const alpha = dim ? 0.18 : 1;

      // Rows
      {
        const cg = rowHintsCanvas.getContext('2d');
        cg.clearRect(0,0,rowHintsCanvas.width,rowHintsCanvas.height);
        cg.save(); cg.globalAlpha=alpha;
        cg.fillStyle = (cfg.theme==='light') ? '#333' : '#b7c2db';
        cg.textAlign='right'; cg.textBaseline='middle';
        cg.font = (cfg.theme==='highcontrast'?'bold ':'') + '13px Inter, system-ui, "Segoe UI", Roboto';
        const hRows = lineHintsFromPattern(HsrcRows);
        for(let r=0;r<N;r++){ cg.fillText(hRows[r].join(' '), left-10, top + r*S + S/2); }
        cg.restore();
      }
      // Cols
      {
        const cg = colHintsCanvas.getContext('2d');
        cg.clearRect(0,0,colHintsCanvas.width,colHintsCanvas.height);
        cg.save(); cg.globalAlpha=alpha;
        cg.fillStyle = (cfg.theme==='light') ? '#333' : '#b7c2db';
        cg.textAlign='center'; cg.textBaseline='middle';
        cg.font = (cfg.theme==='highcontrast'?'bold ':'') + '13px Inter, system-ui, "Segoe UI", Roboto';
        const hCols = lineHintsFromPattern(HsrcCols);
        for(let c=0;c<N;c++){
          let y = Math.min(16, Math.max(12, Math.floor(S*0.4)));
          const x = left + c*S + S/2;
          for(const h of hCols[c]){ cg.fillText(String(h), x, y); y += Math.min(16, Math.max(12, Math.floor(S*0.45))); }
        }
        cg.restore();
      }
      g.drawImage(rowHintsCanvas, 0, 0);
      g.drawImage(colHintsCanvas, 0, 0);
    }

    function draw(){
      const {left,top,S} = layout;
      const W=canvas.width, H=canvas.height;
      g.fillStyle=currentBG(); g.fillRect(0,0,W,H);

      // Hints
      const dimHints = solved;
      if(view==='create'){ renderHints(g,left,top,S, editorGrid, dimHints); }
      else if(pattern){ renderHints(g,left,top,S, null, dimHints); }

      // Hover row/col glow removed for simplicity; can re-add if needed.

      // Grid lines
      g.lineWidth=1;
      g.globalAlpha = solved ? 0.25 : 1;
      for(let r=0;r<=N;r++){ g.strokeStyle=(r%5===0)?gridBold():gridThin(); g.beginPath(); g.moveTo(left, top + r*S); g.lineTo(left+N*S, top + r*S); g.stroke(); }
      for(let c=0;c<=N;c++){ g.strokeStyle=(c%5===0)?gridBold():gridThin(); g.beginPath(); g.moveTo(left + c*S, top); g.lineTo(left + c*S, top + N*S); g.stroke(); }
      g.globalAlpha = 1;

      // Completed line glow (Play)
      if(view==='play'){
        for(let i=lineGlow.length-1;i>=0;i--){
          const L=lineGlow[i]; const t=(performance.now()-L.t0), dur=400;
          if(t>dur){ lineGlow.splice(i,1); continue; }
          const a=0.20*(1 - t/dur); g.fillStyle=`rgba(79,227,176,${a})`;
          if(L.type==='row') g.fillRect(left, top + L.idx*S, N*S, S);
          else g.fillRect(left + L.idx*S, top, S, N*S);
        }
      }

      // Cells
      if(view==='create'){
        for(let r=0;r<N;r++) for(let c=0;c<N;c++){
          if(editorGrid[r][c]===1){ g.fillStyle=fillColor(); g.fillRect(left + c*S + 2, top + r*S + 2, S-4, S-4); }
        }
      } else {
        const fade = solved ? clamp((performance.now() - solvedAt)/TUNABLES.postSolveFadeMs, 0, 1) : 0;
        for(let r=0;r<N;r++) for(let c=0;c<N;c++){
          if((rowSolved(r)||colSolved(c)) && marks[r][c]===0 && !solved){
            g.fillStyle=`rgba(255,255,255,${TUNABLES.confirmGreyAlpha})`;
            g.fillRect(left + c*S, top + r*S, S, S);
          }
          const key=`${r},${c}`; const anim= lastChange.get(key);
          if(pulseWrong.has(key)){ g.fillStyle='rgba(240,80,80,.25)'; g.fillRect(left + c*S, top + r*S, S, S); }
          if(marks[r][c]===1){
            let pad=2; if(anim && anim.s===1){ const k=clamp((performance.now()-anim.t)/TUNABLES.animFillMs,0,1); pad=Math.floor((1-k)*(S*0.25)); }
            g.fillStyle=fillColor();
            g.fillRect(left + c*S + 2 + pad, top + r*S + 2 + pad, S-4-2*pad, S-4-2*pad);
          } else if(marks[r][c]===2){
            const k=(anim && anim.s===2)? clamp((performance.now()-anim.t)/TUNABLES.animCrossMs,0,1) : 1;
            g.save(); g.globalAlpha = solved ? (1 - fade) : 1;
            g.strokeStyle=crossColor(); g.lineWidth=2; g.beginPath();
            g.moveTo(left+c*S+5, top+r*S+5); g.lineTo(left+c*S+5 + (S-10)*k, top+r*S+5 + (S-10)*k);
            g.moveTo(left+c*S+S-5, top+r*S+5); g.lineTo(left+c*S+S-5 - (S-10)*k, top+r*S+5 + (S-10)*k); g.stroke();
            g.restore();
          }
        }
      }

      // Solved bloom
      if(view==='play' && solved){
        const rad=Math.max(W,H); const grd=g.createRadialGradient(W/2,H/2,0,W/2,H/2,rad*0.9);
        grd.addColorStop(0,'rgba(79,227,176,0.12)'); grd.addColorStop(1,'rgba(79,227,176,0)'); g.fillStyle=grd; g.fillRect(0,0,W,H);
      }

      requestAnimationFrame(draw);
    }

    // Normalize helper (JSON import)
    function normalizeToGrid(grid, size){
      const N=size, h=grid.length, w=Array.isArray(grid[0])? grid[0].length : String(grid[0]).length;
      const out=Array.from({length:N},()=>Array(N).fill(0));
      for(let y=0;y<N;y++) for(let x=0;x<N;x++){
        const yy=Math.floor(y*h/N), xx=Math.floor(x*w/N);
        const v = Array.isArray(grid[0]) ? grid[yy][xx] : (String(grid[yy])[xx]??'0');
        out[y][x] = (v===1||v===true||v==='1'||v==='#')?1:0;
      }
      return out;
    }

    // =========================================================================
    // Startup (always fresh random unless deep link ?p=…)
    // =========================================================================
    function updateBestChip(){ /* (defined earlier, already used) */ }

    function renderStart(){
      updateBestChip();
      layoutAndFit();
      requestAnimationFrame(draw);

      if(FLAGS.deepPuzzleCode){
        try{
          const { size, grid } = decodeCodeToGrid(FLAGS.deepPuzzleCode);
          cfg.size = size; save('nonogram','cfg',cfg); N=size;
          navSelect(0);
          setPatternAndReset(grid, 'code');
          toast('Loaded puzzle from code. You can Save to Gallery if you want.');
        }catch{ newGame(true); }
      } else {
        newGame(true); // always start fresh
      }
      switchView();
    }

    // Init Gallery helpers used above
    function saveGallery(arr){ save('nonogram','gallery',arr); }
    function updateGalleryStatsForPattern(){ /* defined above */ }

    renderStart();

    // =========================================================================
    // Public dispose
    // =========================================================================
    return {
      dispose(){
        clearInterval(tick);
        document.head.contains(style) && style.remove();
        wrapper.remove();
      }
    };
  }
};
