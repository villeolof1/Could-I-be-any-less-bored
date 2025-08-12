export default {
  id: 'snake',
  title: 'Snake',
  category: 'arcade',
  icon: '🐍',
  tags: ['classic','grid'],
  launch(api) {
    const W = 24, H = 18, SIZE = 28;
    const canvas = document.createElement('canvas');
    canvas.width = W * SIZE; canvas.height = H * SIZE;
    canvas.style.display = 'block'; canvas.style.margin = '0 auto';
    const c = canvas.getContext('2d');
    api.mount.appendChild(canvas);

    const scoreEl = api.addHudPill('score', 'Score: 0');
    api.setNote('Use <kbd>WASD</kbd> / <kbd>Arrow keys</kbd>');

    let snake = [{x:12,y:9}], dir = {x:1,y:0}, nextDir = {x:1,y:0};
    let food = spawn(), score = 0, speedMs = 120, alive = true, raf, last=0, acc=0;

    function spawn() {
      let p;
      do { p = { x: Math.floor(Math.random()*W), y: Math.floor(Math.random()*H) }; }
      while (snake.some(s => s.x===p.x && s.y===p.y));
      return p;
    }
    function drawCell(x,y,color) {
      c.fillStyle = color;
      c.fillRect(x*SIZE+1, y*SIZE+1, SIZE-2, SIZE-2);
    }
    function step(dt) {
      acc += dt;
      if (acc >= speedMs) {
        acc = 0; dir = nextDir;
        const head = { x: (snake[0].x + dir.x + W) % W, y: (snake[0].y + dir.y + H) % H };
        if (snake.some(s => s.x===head.x && s.y===head.y)) { alive=false; api.setNote('Game Over'); }
        snake.unshift(head);
        if (head.x===food.x && head.y===food.y) { score+=10; scoreEl.textContent='Score: '+score; food=spawn(); }
        else snake.pop();
      }
      // draw
      c.fillStyle = '#0e1117'; c.fillRect(0,0,canvas.width,canvas.height);
      for (let x=0;x<W;x++) for (let y=0;y<H;y++) {
        c.fillStyle = (x+y)%2? '#131826' : '#111522';
        c.fillRect(x*SIZE,y*SIZE,SIZE,SIZE);
      }
      drawCell(food.x, food.y, '#7ce2c4');
      snake.forEach((s,i)=> drawCell(s.x,s.y, i? '#6aa6ff' : '#ffffff'));
    }
    function loop(t) {
      if (!alive) return;
      const dt = t - last; last = t;
      step(dt);
      raf = requestAnimationFrame(loop);
    }
    function key(e) {
      const k = e.key.toLowerCase();
      if (k==='arrowup'||k==='w') { if (dir.y!==1) nextDir={x:0,y:-1}; }
      if (k==='arrowdown'||k==='s') { if (dir.y!==-1) nextDir={x:0,y:1}; }
      if (k==='arrowleft'||k==='a') { if (dir.x!==1) nextDir={x:-1,y:0}; }
      if (k==='arrowright'||k==='d') { if (dir.x!==-1) nextDir={x:1,y:0}; }
    }
    window.addEventListener('keydown', key);
    api.setStatus('Running');
    raf = requestAnimationFrame(loop);

    return {
      pause(){ cancelAnimationFrame(raf); },
      resume(){ last=performance.now(); raf=requestAnimationFrame(loop); },
      dispose(){ window.removeEventListener('keydown',key); cancelAnimationFrame(raf); }
    };
  }
}
