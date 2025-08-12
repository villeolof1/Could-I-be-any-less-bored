export default {
  id: 'flappy',
  title: 'Flappy Bird',
  category: 'arcade',
  icon: '🐤',
  tags: ['tap','side-scroll'],
  launch(api) {
    const W=420,H=560; const g=0.0009, jump=-0.32, gap=150, speed=0.18;
    const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
    canvas.style.display='block'; canvas.style.margin='0 auto';
    const c=canvas.getContext('2d'); api.mount.appendChild(canvas);

    let y=H/2, v=0, pipes=[], t=0, score=0, alive=true, raf;
    const scoreEl=api.addHudPill('score','Score: 0'); api.setNote('Click / Space to flap');

    function addPipe(x){ const top=60+Math.random()*(H-240); pipes.push({x, top}); }
    for (let i=0;i<4;i++) addPipe(W+ i*200);

    function draw() {
      c.fillStyle='#0d1016'; c.fillRect(0,0,W,H);
      // ground
      c.fillStyle='#151b29'; c.fillRect(0,H-60,W,60);
      // pipes
      c.fillStyle='#7ce2c4';
      pipes.forEach(p=>{
        c.fillRect(p.x,0,60,p.top);
        c.fillRect(p.x,p.top+gap,60,H-p.top-gap-60);
      });
      // bird
      c.fillStyle='#fff'; c.beginPath(); c.arc(120,y,14,0,Math.PI*2); c.fill();
    }
    function step(dt){
      t+=dt; v+=g*dt; y+=v*dt;
      pipes.forEach(p=>p.x-=speed*dt);
      if (pipes[0].x<-60){ pipes.shift(); addPipe(pipes[pipes.length-1].x+200); score++; scoreEl.textContent='Score: '+score; }
      const p=pipes[0];
      const hit = (120>p.x && 120<p.x+60) && (y-14<p.top || y+14>p.top+gap) || (y>H-60) || (y<0);
      if (hit){ alive=false; api.setNote('Game Over'); api.setStatus('Stopped'); }
    }
    function loop(now){ if(!alive) return; draw(); step(16); raf=requestAnimationFrame(loop); }
    function flap(){ if(!alive){ return; } v=jump; }

    window.addEventListener('keydown', e=>{ if(e.code==='Space') flap(); });
    canvas.addEventListener('mousedown', flap);

    api.setStatus('Running'); raf=requestAnimationFrame(loop);
    return {
      pause(){ cancelAnimationFrame(raf); },
      resume(){ raf=requestAnimationFrame(loop); },
      dispose(){ cancelAnimationFrame(raf); canvas.remove(); }
    }
  }
}
