export default {
  id: 'tetris',
  title: 'Tetris',
  category: 'arcade',
  icon: '🧱',
  tags: ['falling','grid'],
  launch(api){
    const COLS=10, ROWS=20, S=28;
    const canvas=document.createElement('canvas');
    canvas.width=COLS*S; canvas.height=ROWS*S;
    canvas.style.display='block'; canvas.style.margin='0 auto';
    const c=canvas.getContext('2d'); api.mount.appendChild(canvas);

    const shapes = {
      I:[[1,1,1,1]], O:[[1,1],[1,1]], T:[[0,1,0],[1,1,1]],
      S:[[0,1,1],[1,1,0]], Z:[[1,1,0],[0,1,1]],
      J:[[1,0,0],[1,1,1]], L:[[0,0,1],[1,1,1]],
    };
    const colors = { I:'#7ce2c4', O:'#ffd476', T:'#6aa6ff', S:'#a1f77d', Z:'#ff7a7a', J:'#b18cff', L:'#ffa6d1' };

    let grid = Array.from({length:ROWS},()=>Array(COLS).fill(0));
    let piece = spawn();
    let dropMs=550, acc=0, last=0, raf, score=0;
    const scoreEl = api.addHudPill('score','Score: 0');
    api.setNote('← → move, ↑ rotate, ↓ soft drop, Space hard drop');

    function spawn(){
      const keys=Object.keys(shapes); const k=keys[(Math.random()*keys.length)|0];
      return {k, m:shapes[k].map(r=>r.slice()), x:3, y:0};
    }
    function rotate(m){ return m[0].map((_,i)=>m.map(r=>r[i]).reverse()); }
    function collide(p,dx,dy,mat){ const m=mat||p.m;
      for(let y=0;y<m.length;y++)for(let x=0;x<m[0].length;x++){
        if(!m[y][x]) continue;
        const nx=p.x+x+dx, ny=p.y+y+dy;
        if(ny>=ROWS || nx<0 || nx>=COLS || (ny>=0 && grid[ny][nx])) return true;
      } return false;
    }
    function merge(p){
      p.m.forEach((row,y)=>row.forEach((v,x)=>{ if(v && p.y+y>=0) grid[p.y+y][p.x+x]=p.k; }));
      // clear
      let cleared=0;
      grid = grid.filter(r=>r.some(c=>!c) ).concat(Array.from({length:grid.length - grid.filter(r=>r.some(c=>!c)).length}, ()=>Array(COLS).fill(0)));
      cleared = ROWS - grid.filter(r=>r.some(c=>!c)).length;
      if (cleared>0){ score+= [0,100,300,500,800][cleared] || cleared*250; scoreEl.textContent='Score: '+score; }
    }
    function draw(){
      c.fillStyle='#0f1320'; c.fillRect(0,0,canvas.width,canvas.height);
      // board
      for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
        c.fillStyle = grid[y][x] ? colors[grid[y][x]] : ((x+y)%2?'#141a2a':'#121726');
        c.fillRect(x*S,y*S,S-1,S-1);
      }
      // piece
      c.fillStyle=colors[piece.k];
      piece.m.forEach((row,yy)=>row.forEach((v,xx)=>{ if(v && piece.y+yy>=0) c.fillRect((piece.x+xx)*S,(piece.y+yy)*S,S-1,S-1); }));
    }
    function drop(){
      if(!collide(piece,0,1)){ piece.y++; }
      else { merge(piece); piece=spawn(); if(collide(piece,0,0)){ api.setNote('Game Over'); cancelAnimationFrame(raf); } }
    }
    function loop(t){ const dt=t-last; last=t; acc+=dt; if(acc>dropMs){acc=0; drop();} draw(); raf=requestAnimationFrame(loop); }
    function key(e){
      if(e.repeat) return;
      if(e.key==='ArrowLeft' && !collide(piece,-1,0)) piece.x--;
      if(e.key==='ArrowRight'&& !collide(piece,1,0)) piece.x++;
      if(e.key==='ArrowUp'){ const r=rotate(piece.m); if(!collide(piece,0,0,r)) piece.m=r; }
      if(e.key==='ArrowDown' && !collide(piece,0,1)) piece.y++;
      if(e.code==='Space'){ while(!collide(piece,0,1)) piece.y++; drop(); }
    }
    window.addEventListener('keydown', key);
    raf=requestAnimationFrame(loop);
    return {
      pause(){ cancelAnimationFrame(raf); },
      resume(){ raf=requestAnimationFrame(loop); },
      dispose(){ cancelAnimationFrame(raf); window.removeEventListener('keydown', key); }
    }
  }
}
