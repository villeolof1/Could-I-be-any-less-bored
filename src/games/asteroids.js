import { fitCanvas, makeHUD, makeTicker, settingsPanel, makeHiScore } from '../kit/gamekit.js';

export default {
  id:'asteroids',
  title:'Asteroids+',
  category:'arcade',
  icon:'🛸',
  tags:['thrust','shoot','wrap'],
  launch(api){
    let cfg={ rocks:6, thrust:0.12, friction:0.995, bulletSpeed:5, split:true };
    const sp=settingsPanel(api, [
      {key:'rocks',label:'Rocks',type:'range',min:4,max:12,default:6},
      {key:'thrust',label:'Thrust',type:'range',min:.06,max:.2,step:.01,default:.12},
      {key:'friction',label:'Friction',type:'range',min:.98,max:.999,step:.001,default:.995},
      {key:'bulletSpeed',label:'Bullet speed',type:'range',min:3,max:8,step:.5,default:5},
      {key:'split',label:'Split on hit',type:'toggle',default:true}
    ], 'asteroids', s=>{ cfg={...cfg, ...s, rocks:Number(s.rocks), thrust:Number(s.thrust), friction:Number(s.friction), bulletSpeed:Number(s.bulletSpeed)}; start(); });

    const W=720,H=440; const canvas=document.createElement('canvas'); const g=fitCanvas(canvas,W,H);
    canvas.style.display='block'; canvas.style.margin='0 auto'; api.mount.appendChild(canvas);
    const hud=makeHUD(api,{score:true,lives:true}); const hi=makeHiScore('asteroids');

    let ship, bullets, rocks, lives, score, ticker;
    const keys={}; window.addEventListener('keydown',e=>keys[e.key]=true); window.addEventListener('keyup',e=>keys[e.key]=false);

    function spawnRock(){ rocks.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()*2-1)*1.4,vy:(Math.random()*2-1)*1.4,r:18+Math.random()*22}); }
    function wrap(o){ if(o.x<0) o.x+=W; if(o.x>W) o.x-=W; if(o.y<0) o.y+=H; if(o.y>H) o.y-=H; }

    function start(){
      ship={x:W/2,y:H/2,a:0,vx:0,vy:0};
      bullets=[]; rocks=[]; for(let i=0;i<cfg.rocks;i++) spawnRock();
      lives=3; score=0; hud.setLives(lives); hud.setScore(0); api.setNote(`← → rotate, ↑ thrust, Space shoot. Best ${hi.get()}`);
      ticker?.stop(); ticker=makeTicker(step);
    }

    function fire(){ bullets.push({x:ship.x,y:ship.y,vx:Math.cos(ship.a)*cfg.bulletSpeed,vy:Math.sin(ship.a)*cfg.bulletSpeed,t:0}); }
    canvas.addEventListener('mousedown', fire);

    function drawShip(){
      g.save(); g.translate(ship.x,ship.y); g.rotate(ship.a);
      g.strokeStyle='#fff'; g.beginPath(); g.moveTo(14,0); g.lineTo(-12,8); g.lineTo(-8,0); g.lineTo(-12,-8); g.closePath(); g.stroke();
      if(keys['ArrowUp']){ g.strokeStyle='#ffd476'; g.beginPath(); g.moveTo(-12,6); g.lineTo(-20,0); g.lineTo(-12,-6); g.stroke(); }
      g.restore();
    }

    function step(){
      // input
      if(keys['ArrowLeft']) ship.a-=0.08;
      if(keys['ArrowRight']) ship.a+=0.08;
      if(keys['ArrowUp']){ ship.vx+=Math.cos(ship.a)*cfg.thrust; ship.vy+=Math.sin(ship.a)*cfg.thrust; }
      if(keys[' ']) fire();

      // physics
      ship.x+=ship.vx; ship.y+=ship.vy; ship.vx*=cfg.friction; ship.vy*=cfg.friction; wrap(ship);
      bullets.forEach(b=>{ b.x+=b.vx; b.y+=b.vy; wrap(b); b.t++; });
      rocks.forEach(r=>{ r.x+=r.vx; r.y+=r.vy; wrap(r); });

      // collisions
      for(let i=rocks.length-1;i>=0;i--){
        const r=rocks[i];
        // ship hit
        const dx=r.x-ship.x, dy=r.y-ship.y; if(Math.hypot(dx,dy)<r.r+9){
          lives--; hud.setLives(lives);
          ship={x:W/2,y:H/2,a:0,vx:0,vy:0};
          if(lives<=0){ api.setNote('Ship destroyed — click to restart'); ticker.pause(); }
        }
        // bullets
        for(let j=bullets.length-1;j>=0;j--){
          const b=bullets[j]; if(Math.hypot(b.x-r.x,b.y-r.y)<r.r){
            bullets.splice(j,1); rocks.splice(i,1); score+=10; hud.setScore(score); hi.set(score);
            if(cfg.split && r.r>18){
              for(let k=0;k<2;k++) rocks.push({x:r.x,y:r.y,vx:(Math.random()*2-1)*1.8,vy:(Math.random()*2-1)*1.8,r:r.r*0.6});
            }
            break;
          }
        }
      }
      if(rocks.length<Math.max(4,cfg.rocks-2)) spawnRock();

      // draw
      g.fillStyle='#0d1016'; g.fillRect(0,0,W,H);
      rocks.forEach(r=>{ g.strokeStyle='#7ce2c4'; g.beginPath(); g.arc(r.x,r.y,r.r,0,Math.PI*2); g.stroke(); });
      bullets.forEach(b=>{ g.fillStyle='#fff'; g.fillRect(b.x-1,b.y-1,2,2); });
      drawShip();
    }

    canvas.addEventListener('mousedown', ()=>{ if(lives<=0) start(); });
    start();
    return { pause(){ ticker?.pause(); }, resume(){ ticker?.resume(); }, dispose(){ ticker?.stop(); sp.destroy?.(); } };
  }
}
