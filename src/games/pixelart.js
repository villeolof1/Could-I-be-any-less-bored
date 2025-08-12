export default {
  id:'pixelart',
  title:'Pixel Art',
  category:'art',
  icon:'🎨',
  tags:['editor','canvas'],
  launch(api){
    // Config
    const PX=32, PY=24, SCALE=16;
    const wrap=document.createElement('div'); wrap.style.display='grid'; wrap.style.gridTemplateColumns='260px 1fr'; wrap.style.gap='12px'; wrap.style.padding='12px';
    api.mount.appendChild(wrap);

    // Canvas
    const cWrap=document.createElement('div'); cWrap.style.position='relative';
    const canvas=document.createElement('canvas'); canvas.width=PX*SCALE; canvas.height=PY*SCALE;
    canvas.style.border='1px solid var(--ring)'; canvas.style.background='#0c0f15';
    cWrap.appendChild(canvas); const ctx=canvas.getContext('2d');
    const status=document.createElement('div'); status.style.marginTop='8px'; status.style.color='var(--muted)';
    cWrap.appendChild(status);

    // Tools panel
    const panel=document.createElement('div');
    panel.style.background='var(--card)'; panel.style.border='1px solid var(--ring)'; panel.style.borderRadius='12px'; panel.style.padding='10px';
    panel.innerHTML = `<div style="font-weight:700;margin-bottom:8px">Tools</div>`;
    const tools = [
      ['pen','✏️'],['eraser','🩹'],['fill','🪣'],['line','📏'],['rect','▭'],['circle','◯'],['picker','🧪'],['select','🔲']
    ];
    const toolBtns = tools.map(([id,icon])=>{
      const b=document.createElement('button'); b.textContent=icon+' '+id; b.style.display='block'; b.style.width='100%'; b.style.margin='4px 0';
      panel.appendChild(b); b.addEventListener('click',()=>setTool(id)); return [id,b];
    });
    const palette=document.createElement('div'); palette.style.display='grid'; palette.style.gridTemplateColumns='repeat(8,1fr)'; palette.style.gap='6px'; palette.style.marginTop='10px';
    const COLORS=['#000','#333','#666','#999','#ccc','#fff','#7ce2c4','#6aa6ff','#ffd476','#ff7a7a','#b18cff','#ffa6d1','#a1f77d','#ffb86b','#72d5ff','#e0ff72'];
    let fg='#ffffff', bg='#000000';
    function swatch(color){ const d=document.createElement('button'); d.style.height='24px'; d.style.borderRadius='6px'; d.style.border='1px solid var(--ring)'; d.style.background=color; d.title=color; d.addEventListener('click',()=>fg=color); return d; }
    COLORS.forEach(c=>palette.appendChild(swatch(c)));
    const swap=document.createElement('button'); swap.textContent='Swap FG/BG'; swap.style.marginTop='8px'; swap.addEventListener('click',()=>{ const t=fg; fg=bg; bg=t; });
    const clearBtn=document.createElement('button'); clearBtn.textContent='Clear'; clearBtn.style.marginTop='8px';
    panel.appendChild(palette); panel.appendChild(swap); panel.appendChild(clearBtn);

    // State
    const img = Array.from({length:PY},()=>Array(PX).fill(null));
    let tool='pen'; let down=false; let sx=0, sy=0, sel=null;
    function setTool(id){ tool=id; }
    function grid(){ ctx.clearRect(0,0,canvas.width,canvas.height);
      for(let y=0;y<PY;y++) for(let x=0;x<PX;x++){ ctx.fillStyle=img[y][x]||'#0c0f15'; ctx.fillRect(x*SCALE,y*SCALE,SCALE,SCALE); }
      ctx.strokeStyle='rgba(255,255,255,.06)';
      for(let x=0;x<=PX;x++){ ctx.beginPath(); ctx.moveTo(x*SCALE,0); ctx.lineTo(x*SCALE,canvas.height); ctx.stroke(); }
      for(let y=0;y<=PY;y++){ ctx.beginPath(); ctx.moveTo(0,y*SCALE); ctx.lineTo(canvas.width,y*SCALE); ctx.stroke(); }
    }
    function put(x,y,color){ if(x<0||y<0||x>=PX||y>=PY) return; img[y][x]=color; }
    function fill(x,y,from,to){ if(from===to) return; const q=[[x,y]]; const seen=new Set();
      while(q.length){ const [cx,cy]=q.pop(); const key=cx+','+cy; if(seen.has(key)) continue; seen.add(key);
        if(cx<0||cy<0||cx>=PX||cy>=PY) continue; if(img[cy][cx]!==from) continue; img[cy][cx]=to;
        q.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]); }
    }
    function onDown(e){ down=true; const r=canvas.getBoundingClientRect(); const x=((e.clientX-r.left)/SCALE|0), y=((e.clientY-r.top)/SCALE|0); sx=x; sy=y;
      const col=img[y][x]; if(tool==='pen') put(x,y,fg);
      else if(tool==='eraser') put(x,y,null);
      else if(tool==='fill') fill(x,y,col,fg);
      else if(tool==='picker') fg = col || fg;
      else if(tool==='select') sel={x,y,w:1,h:1};
      grid();
    }
    function onMove(e){ if(!down) return; const r=canvas.getBoundingClientRect(); const x=((e.clientX-r.left)/SCALE|0), y=((e.clientY-r.top)/SCALE|0);
      if(tool==='pen') put(x,y,fg);
      else if(tool==='eraser') put(x,y,null);
      else if(tool==='line'||tool==='rect'||tool==='circle'||tool==='select') { grid(); ctx.strokeStyle='#6aa6ff'; ctx.setLineDash([4,3]);
        if(tool==='line'){ ctx.beginPath(); ctx.moveTo((sx+.5)*SCALE,(sy+.5)*SCALE); ctx.lineTo((x+.5)*SCALE,(y+.5)*SCALE); ctx.stroke(); }
        if(tool==='rect'){ const rx=Math.min(sx,x), ry=Math.min(sy,y), rw=Math.abs(x-sx)+1, rh=Math.abs(y-sy)+1; ctx.strokeRect(rx*SCALE,ry*SCALE,rw*SCALE,rh*SCALE); }
        if(tool==='circle'){ const dx=x-sx, dy=y-sy, r=Math.sqrt(dx*dx+dy*dy); ctx.beginPath(); ctx.arc(sx*SCALE,sy*SCALE,r*SCALE,0,Math.PI*2); ctx.stroke(); }
        if(tool==='select'){ sel={x:Math.min(sx,x),y:Math.min(sy,y),w:Math.abs(x-sx)+1,h:Math.abs(y-sy)+1}; }
        ctx.setLineDash([]);
      }
      grid();
    }
    function onUp(e){ down=false; const r=canvas.getBoundingClientRect(); const x=((e.clientX-r.left)/SCALE|0), y=((e.clientY-r.top)/SCALE|0);
      if(tool==='line'){ const steps=Math.max(Math.abs(x-sx),Math.abs(y-sy)); for(let i=0;i<=steps;i++){ const px=Math.round(sx+(x-sx)*i/steps), py=Math.round(sy+(y-sy)*i/steps); put(px,py,fg);} }
      if(tool==='rect'){ const rx=Math.min(sx,x), ry=Math.min(sy,y), rw=Math.abs(x-sx), rh=Math.abs(y-sy); for(let i=0;i<=rw;i++){ put(rx+i,ry,fg); put(rx+i,ry+rh,fg);} for(let j=0;j<=rh;j++){ put(rx,ry+j,fg); put(rx+rw,ry+j,fg);} }
      if(tool==='circle'){ const dx=x-sx, dy=y-sy, r=Math.round(Math.sqrt(dx*dx+dy*dy)); for(let a=0;a<Math.PI*2;a+=.01){ const px=Math.round(sx + Math.cos(a)*r), py=Math.round(sy + Math.sin(a)*r); put(px,py,fg);} }
      grid();
    }
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    clearBtn.addEventListener('click', ()=>{ for(let y=0;y<PY;y++) for(let x=0;x<PX;x++) img[y][x]=null; grid(); });

    wrap.appendChild(panel); wrap.appendChild(cWrap);
    grid();
    status.textContent='Cursor shows pixel coordinates.';

    return { dispose(){ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); } }
  }
}
