import { fitCanvas, settingsPanel, makeHUD } from '../kit/gamekit.js';

export default {
  id:'nonogram',
  title:'Nonogram+',
  category:'logic',
  icon:'🧩',
  tags:['picross','paint-by-hints'],
  launch(api){
    let cfg={ n:10, cell:28, assist:true };
    const sp=settingsPanel(api, [
      {key:'n',label:'Size',type:'select',options:[{v:10,l:'10×10'},{v:15,l:'15×15'}], default:10},
      {key:'assist',label:'Assist (cross empties)',type:'toggle',default:true}
    ], 'nonogram', s=>{ cfg={...cfg, ...s, n:Number(s.n)}; start(); });

    const canvas=document.createElement('canvas'); canvas.style.display='block'; canvas.style.margin='0 auto';
    const g=fitCanvas(canvas, cfg.n*cfg.cell+140, cfg.n*cfg.cell+100); api.mount.appendChild(canvas);
    const hud=makeHUD(api,{score:false,lives:false}); let done=false;

    let pattern, marks, rows, cols, N;
    function generateHeart(N){
      const p=Array.from({length:N},()=>Array(N).fill(0));
      const cx=N/2, cy=N/2;
      for(let y=0;y<N;y++) for(let x=0;x<N;x++){
        const dx=Math.abs(x-cx), dy=Math.abs(y-cy);
        if(y< N*0.35 && ( (dx< N*0.18) || (Math.hypot(dx- N*0.18, y- N*0.2)< N*0.18) )) p[y][x]=1;
        if(y>=N*0.35 && Math.hypot(dx, y- N*0.35) < N*0.35) p[y][x]=1;
      }
      return p;
    }

    function hints(lines){
      return lines.map(line=>{
        const out=[]; let c=0; line.forEach(v=>{ if(v) c++; else if(c){ out.push(c); c=0; } });
        if(c) out.push(c); return out.length? out : [0];
      });
    }

    function draw(){
      const S=cfg.cell;
      g.fillStyle='#0f1320'; g.fillRect(0,0,canvas.width,canvas.height);
      // hints
      g.fillStyle='#8a90a2'; g.font='12px Inter, system-ui';
      rows.forEach((h,r)=> g.fillText(h.join(' '), 8, 80 + r*S + S*0.7));
      cols.forEach((h,c)=> {
        const x=120 + c*S + 6; let y=12;
        h.forEach(v=>{ g.fillText(String(v), x, y); y+=12; });
      });
      // grid
      for(let r=0;r<=N;r++){ g.strokeStyle = (r%5===0)? '#2a3447':'#1a2130'; g.beginPath(); g.moveTo(120,80+r*S); g.lineTo(120+N*S,80+r*S); g.stroke(); }
      for(let c=0;c<=N;c++){ g.strokeStyle = (c%5===0)? '#2a3447':'#1a2130'; g.beginPath(); g.moveTo(120+c*S,80); g.lineTo(120+c*S,80+N*S); g.stroke(); }
      // marks
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        const x=120+c*S, y=80+r*S;
        if(marks[r][c]===1){ g.fillStyle='#7ce2c4'; g.fillRect(x+2,y+2,S-4,S-4); }
        else if(marks[r][c]===2){ g.strokeStyle='#ff7a7a'; g.beginPath(); g.moveTo(x+5,y+5); g.lineTo(x+S-5,y+S-5); g.moveTo(x+S-5,y+5); g.lineTo(x+5,y+S-5); g.stroke(); }
      }
    }

    function hit(e){
      const r=canvas.getBoundingClientRect();
      const x=e.clientX-r.left-120, y=e.clientY-r.top-80;
      const c=Math.floor(x/cfg.cell), rr=Math.floor(y/cfg.cell);
      return (c>=0&&c<N&&rr>=0&&rr<N)? [rr,c] : null;
    }

    function checkWin(){
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        if((pattern[r][c]===1) !== (marks[r][c]===1)) return false;
      } return true;
    }

    let down=false, mode=1;
    canvas.addEventListener('mousedown', e=>{ const p=hit(e); if(!p) return; down=true; mode = (e.button===2)? 2 : (marks[p[0]][p[1]]===1?0:1); e.preventDefault(); });
    canvas.addEventListener('mousemove', e=>{ if(!down) return; const p=hit(e); if(!p) return; marks[p[0]][p[1]]=mode; draw(); });
    window.addEventListener('mouseup', ()=>{ if(down){ down=false; if(checkWin()){ api.setNote('Solved! ✅'); done=true; } }});
    canvas.addEventListener('contextmenu', e=>e.preventDefault());

    function start(){
      N=cfg.n;
      pattern = generateHeart(N);
      rows = hints(pattern);
      cols = hints(Array.from({length:N},(_,c)=> pattern.map(r=>r[c])));
      marks = Array.from({length:N},()=>Array(N).fill(0));
      done=false; api.setNote('Left-drag fill, right-click cross.');
      draw();
    }

    start();
    return { dispose(){ sp.destroy?.(); } };
  }
}
