import { fitCanvas, makeHUD, settingsPanel, makeHiScore, makeTicker } from '../kit/gamekit.js';

export default {
  id:'breakout',
  title:'Breakout+',
  category:'arcade',
  icon:'🧱',
  tags:['paddle','ball','powerups'],
  launch(api){
    const W=640,H=420;
    const canvas=document.createElement('canvas'); canvas.style.display='block'; canvas.style.margin='0 auto';
    const g=fitCanvas(canvas,W,H); api.mount.appendChild(canvas);
    const hud=makeHUD(api,{score:true,lives:true,level:true}); const hi=makeHiScore('breakout');
    let cfg = { rows:5, cols:10, speed:1, lives:3 };
    const sp=settingsPanel(api, [
      {key:'rows', label:'Rows', type:'range', min:3,max:10,default:5},
      {key:'cols', label:'Cols', type:'range', min:6,max:14,default:10},
      {key:'speed', label:'Speed', type:'range', min:1,max:3,step:0.5, default:1},
      {key:'lives', label:'Lives', type:'select', options:[{v:2,l:'2'},{v:3,l:'3'},{v:5,l:'5'}], default:3}
    ], 'breakout', s=>{ cfg={...cfg, ...s, rows:Number(s.rows), cols:Number(s.cols), speed:Number(s.speed), lives:Number(s.lives)}; start(); });

    let paddle, ball, bricks, score, lives, level, ticker, powerups;

    function start(){
      score=0; lives=cfg.lives; level=1; setupLevel(); loopStart();
    }
    function setupLevel(){
      paddle={x:W/2-50,y:H-22,w:100,h:10,vx:0};
      ball={x:W/2,y:H-40,vx:(Math.random()<.5?-1:1)*3*cfg.speed,vy:-3.2*cfg.speed,r:6,stuck:true};
      bricks=[]; powerups=[];
      const bw=(W-40)/cfg.cols, bh=20;
      for(let r=0;r<cfg.rows;r++) for(let c=0;c<cfg.cols;c++){
        bricks.push({x:20+c*bw+2,y:50+r*(bh+8),w:bw-4,h:bh,hp:1+Math.floor(level/3)});
      }
      hud.setLives(lives); hud.setLevel(level); hud.setScore(score);
      api.setNote('Move mouse or ← →. Click / Space to launch.');
    }

    function draw(){
      g.fillStyle='#0d1016'; g.fillRect(0,0,W,H);
      // bricks
      bricks.forEach(b=>{ if(b.hp<=0) return; g.fillStyle=`hsl(${200-b.y/3},70%,55%)`; g.fillRect(b.x,b.y,b.w,b.h); });
      // paddle
      g.fillStyle='#fff'; g.fillRect(paddle.x,paddle.y,paddle.w,paddle.h);
      // ball
      g.beginPath(); g.fillStyle='#7ce2c4'; g.arc(ball.x,ball.y,ball.r,0,Math.PI*2); g.fill();
      // powerups
      powerups.forEach(p=>{ g.fillStyle=p.t==='life'?'#ffd476':'#b18cff'; g.fillRect(p.x-8,p.y-8,16,16); });
    }

    function step(dt){
      // Paddle friction
      paddle.x += paddle.vx * dt * 0.02;
      paddle.x = Math.max(0, Math.min(W-paddle.w, paddle.x));

      // Ball
      if(ball.stuck){ ball.x=paddle.x+paddle.w/2; ball.y=paddle.y-12; }
      else {
        ball.x += ball.vx; ball.y += ball.vy;
        if(ball.x<ball.r || ball.x>W-ball.r) ball.vx*=-1;
        if(ball.y<ball.r) ball.vy*=-1;
      }

      // Collisions paddle
      if(!ball.stuck && ball.y>paddle.y-ball.r && ball.x>paddle.x && ball.x<paddle.x+paddle.w){
        const rel=(ball.x-(paddle.x+paddle.w/2))/(paddle.w/2);
        ball.vy = -Math.abs(ball.vy);
        ball.vx = rel*4.2*cfg.speed;
      }

      // Collisions bricks
      bricks.forEach(b=>{
        if(b.hp<=0) return;
        if(ball.x>b.x && ball.x<b.x+b.w && ball.y>b.y && ball.y<b.y+b.h){
          ball.vy*=-1; b.hp--; score+=10; hud.setScore(score); hi.set(score);
          if(Math.random()<0.08) powerups.push({x:b.x+b.w/2,y:b.y,t:Math.random()<0.5?'life':'wide',vy:1.2});
        }
      });

      // Powerups
      powerups.forEach(p=>{
        p.y += p.vy * dt * 0.06;
        if(p.y>H) p.dead=true;
        if(p.y>paddle.y-8 && p.x>paddle.x && p.x<paddle.x+paddle.w){
          if(p.t==='life') { lives++; hud.setLives(lives); }
          else if(p.t==='wide') { paddle.w=Math.min(180,paddle.w+30); }
          p.dead=true;
        }
      });
      powerups = powerups.filter(p=>!p.dead);

      // Lose / Win
      if(ball.y>H+50){
        lives--; hud.setLives(lives);
        if(lives<=0){ api.setNote('Out of lives — try again!'); setupLevel(); lives=cfg.lives; }
        else { ball.stuck=true; ball.x=paddle.x+paddle.w/2; ball.y=paddle.y-12; }
      }
      if(bricks.every(b=>b.hp<=0)){
        level++; setupLevel();
        // up difficulty a bit
        ball.vx*=1.05; ball.vy*=1.05;
      }

      draw();
    }

    // Input
    canvas.addEventListener('mousemove', e=>{
      const r=canvas.getBoundingClientRect(); const x=e.clientX-r.left;
      paddle.vx = (x-(paddle.x+paddle.w/2));
      paddle.x = Math.max(0, Math.min(W-paddle.w, x - paddle.w/2));
    });
    const launch=()=>{ ball.stuck=false; };
    canvas.addEventListener('mousedown', launch);
    window.addEventListener('keydown', e=>{
      if(e.code==='Space') launch();
      if(e.key==='ArrowLeft') paddle.vx=-6;
      if(e.key==='ArrowRight') paddle.vx=6;
    });

    function loopStart(){
      if(ticker) ticker.stop();
      ticker = makeTicker(step);
    }

    loopStart();
    return {
      pause(){ ticker?.pause(); },
      resume(){ ticker?.resume(); },
      dispose(){ ticker?.stop(); }
    };
  }
}
