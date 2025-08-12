import { settingsPanel, makeHUD, makeHiScore } from '../kit/gamekit.js';

export default {
  id:'2048',
  title:'2048',
  category:'puzzle',
  icon:'🧩',
  tags:['merge','swipe','touch'],
  launch(api){
    const N=4;
    let grid, score, hiscore = makeHiScore('2048');
    const hud = makeHUD(api,{score:true,lives:false,time:false,level:false});

    // Settings
    let cfg = { spawn4: 10, board: 4 };
    const sp = settingsPanel(api, [
      {key:'board', label:'Board Size', type:'select', options:[{v:4,l:'4×4'},{v:5,l:'5×5'}], default:4},
      {key:'spawn4', label:'% of 4 tiles', type:'range', min:0,max:50,step:5, default:10}
    ], '2048', s=>{ cfg={...cfg, ...s, board:Number(s.board)}; start(); });

    function start(){
      const S = cfg.board; grid = Array.from({length:S},()=>Array(S).fill(0)); score=0; hud.setScore(score);
      addTile(); addTile(); draw();
      api.setNote(`Use arrows / swipe. Best: ${hiscore.get()}`);
    }

    const root=document.createElement('div');
    root.style.width='min(92vw,480px)'; root.style.margin='16px auto';
    root.style.background='var(--card)'; root.style.border='1px solid var(--ring)'; root.style.borderRadius='12px';
    root.style.padding='10px'; root.style.boxShadow='var(--shadow)';
    const board=document.createElement('div'); root.appendChild(board);
    api.mount.appendChild(root);

    function palette(v){
      if(!v) return '#0f1320';
      const m = Math.log2(v)|0;
      const hues = [210, 200, 190, 160, 120, 60, 30, 0];
      const h = hues[Math.min(hues.length-1, m-1)];
      return `hsl(${h}deg, 75%, ${Math.max(30, 70 - m*5)}%)`;
    }

    function draw(){
      const S=grid.length;
      board.style.display='grid';
      board.style.gridTemplateColumns=`repeat(${S},1fr)`;
      board.style.gap='10px';
      board.innerHTML='';
      for(let r=0;r<S;r++) for(let c=0;c<S;c++){
        const v=grid[r][c];
        const d=document.createElement('div');
        d.style.aspectRatio='1/1'; d.style.display='grid'; d.style.placeItems='center';
        d.style.fontWeight='800'; d.style.border='1px solid var(--ring)'; d.style.borderRadius='10px';
        d.style.background = palette(v); d.style.color = v>8?'#fff':'#111';
        d.textContent = v||'';
        board.appendChild(d);
      }
    }

    function addTile(){
      const S=grid.length, empty=[];
      for(let r=0;r<S;r++) for(let c=0;c<S;c++) if(!grid[r][c]) empty.push([r,c]);
      if(!empty.length) return false;
      const [r,c]=empty[(Math.random()*empty.length)|0];
      grid[r][c] = (Math.random()*100 < cfg.spawn4) ? 4 : 2;
      return true;
    }

    function slide(row){
      const arr=row.filter(v=>v);
      for(let i=0;i<arr.length-1;i++){
        if(arr[i]===arr[i+1]){ arr[i]*=2; score+=arr[i]; arr.splice(i+1,1); }
      }
      while(arr.length<row.length) arr.push(0);
      return arr;
    }
    const rot = g=>g[0].map((_,i)=>g.map(r=>r[i]).reverse());
    const moved = (a,b)=>a.flat().join(',')!==b.flat().join(',');

    function move(dir){ // 0 left,1 up,2 right,3 down
      let g = grid.map(r=>r.slice());
      for(let i=0;i<dir;i++) g=rot(g);
      g=g.map(slide);
      for(let i=0;i<(4-dir)%4;i++) g=rot(g);
      if(moved(grid,g)){ grid=g; hud.setScore(score); hiscore.set(score); addTile(); draw(); if(!hasMove()) api.setNote('No moves. ↻ Restart from settings.'); }
    }
    function hasMove(){
      const S=grid.length;
      if(grid.some(r=>r.some(v=>v===0))) return true;
      for(let r=0;r<S;r++) for(let c=0;c<S;c++){
        if(r+1<S && grid[r][c]===grid[r+1][c]) return true;
        if(c+1<S && grid[r][c]===grid[r][c+1]) return true;
      }
      return false;
    }

    // Input
    window.addEventListener('keydown', e=>{
      if(e.key==='ArrowLeft') move(0);
      else if(e.key==='ArrowUp') move(1);
      else if(e.key==='ArrowRight') move(2);
      else if(e.key==='ArrowDown') move(3);
    });
    let sx=0,sy=0;
    root.addEventListener('touchstart', e=>{ const t=e.touches[0]; sx=t.clientX; sy=t.clientY; },{passive:true});
    root.addEventListener('touchend', e=>{
      const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy;
      if(Math.abs(dx)>Math.abs(dy)) move(dx<0?0:2); else move(dy<0?1:3);
    });

    start();
    return { dispose(){ root.remove(); sp.destroy?.(); } };
  }
}
