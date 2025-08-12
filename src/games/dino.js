export default {
  id:'dino',
  title:'Dino Runner',
  category:'arcade',
  icon:'🦖',
  tags:['runner','jump'],
  launch(api){
    const W=720,H=220; const cpx=90;
    const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
    canvas.style.display='block'; canvas.style.margin='0 auto';
    const g=canvas.getContext('2d'); api.mount.appendChild(canvas);

    let y=H-40, vy=0, onGround=true, t=0, speed=4, obs=[], score=0, alive=true, raf;
    const scoreEl=api.addHudPill('score','Score: 0'); api.setNote('Space / click to jump');

    function spawn(){ obs.push({x:W+Math.random()*300+200, w:18, h:30+Math.random()*26}); }
    for(let i=0;i<3;i++) spawn();

    function jump(){ if(onGround){ vy=-10; onGround=false; } }
    window.addEventListener('keydown', e=>{ if(e.code==='Space') jump(); });
    canvas.addEventListener('mousedown', jump);

    function draw(){
      g.fillStyle='#0d1016'; g.fillRect(0,0,W,H);
      // ground
      g.fillStyle='#1c2233'; g.fillRect(0,H-20,W,2);
      // dino
      g.fillStyle='#fff'; g.fillRect(cpx-12,y-24,24,24);
      // obstacles
      g.fillStyle='#7ce2c4';
      obs.forEach(o=> g.fillRect(o.x,H-20-o.h,o.w,o.h));
    }
    function update(){
      // physics
      vy+=0.6; y+=vy; if(y>H-40){ y=H-40; vy=0; onGround=true; }
      obs.forEach(o=> o.x-=speed);
      if (obs[0].x < -20){ obs.shift(); spawn(); score+=1; scoreEl.textContent='Score: '+score; speed+=.05; }
      // collision
      const o=obs[0]; const hit = cpx > o.x-12 && cpx < o.x+o.w+12 && y > H-20-o.h;
      if(hit){ alive=false; api.setNote('Game Over'); }
    }
    function loop(){ if(!alive) return; draw(); update(); raf=requestAnimationFrame(loop); }
    raf=requestAnimationFrame(loop);
    return { pause(){ cancelAnimationFrame(raf); }, resume(){ raf=requestAnimationFrame(loop); }, dispose(){ cancelAnimationFrame(raf);} }
  }
}
