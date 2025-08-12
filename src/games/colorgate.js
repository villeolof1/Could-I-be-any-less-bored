import { fitCanvas, makeHUD, settingsPanel, makeTicker } from '../kit/gamekit.js';

export default {
  id:'colorgate',
  title:'Color Gate+',
  category:'arcade',
  icon:'🌀',
  tags:['endless','reflex'],
  launch(api){
    let cfg={ speed:2.2, gap:84, spacing:180, colors:4 };
    const sp=settingsPanel(api, [
      {key:'colors',label:'Colors',type:'range',min:3,max:6,default:4},
      {key:'gap',label:'Gap',type:'range',min:60,max:140,default:84},
      {key:'spacing',label:'Spacing',type:'range',min:130,max:260,default:180},
      {key:'speed',label:'Speed',type:'range',min:1,max:4,step:.2,default:2.2},
    ], 'colorgate', s=>{ cfg={...cfg, ...s, colors:Number(s.colors)}; start(); });

    const W=560,H=300, COLORS=['#6aa6ff','#7ce2c4','#ffd476','#ff7a7a','#b18cff','#ffa6d1'];
    const canvas=document.createElement('canvas'); const g=fitCanvas(canvas,W,H);
    canvas.style.display='block'; canvas.style.margin='0 auto'; api.mount.appendChild(canvas);
    const hud=makeHUD(api,{score:true,lives:true}); let score, lives, player, gates, ticker;

    function draw(){
      g.fillStyle='#0d1016'; g.fillRect(0,0,W,H);
      // player
      g.fillStyle=COLORS[player]; g.beginPath(); g.arc(80,H/2,14,0,Math.PI*2); g.fill();
      // gates
      gates.forEach(gt=>{
        g.fillStyle=COLORS[gt.color];
        g.fillRect(gt.x,0,18,gt.gapY-cfg.gap/2);
        g.fillRect(gt.x,gt.gapY+cfg.gap/2,18,H-(gt.gapY+cfg.gap/2));
      });
    }
    function step(dt){
      gates.forEach(gt=>gt.x -= cfg.speed * dt * 0.06);
      if(gates[0].x<-20){
        gates.shift(); addGate(gates[gates.length-1].x + cfg.spacing);
        score++; hud.setScore(score);
      }
      const gt=gates[0];
      const collide = gt.x<94 && gt.x+18>66 && player!==gt.color;
      if(collide){ lives--; hud.setLives(lives); // brief penalty
        if(lives<=0){ api.setNote('Out of lives — click to restart'); ticker.pause(); }
        else { // nudge player color to correct for the next gate
          player=gt.color;
        }
      }
      draw();
    }
    function addGate(x){ gates.push({x,color:(Math.random()*cfg.colors)|0, gapY:60+Math.random()*(H-120)}); }
    function start(){
      score=0; lives=3; hud.setScore(0); hud.setLives(lives); player=0; gates=[];
      for(let i=0;i<4;i++) addGate(W+i*cfg.spacing);
      draw(); api.setNote('Click / A-S-D-F to cycle color');
      ticker?.stop(); ticker = makeTicker(step);
    }

    window.addEventListener('keydown', e=>{
      const map={'a':0,'s':1,'d':2,'f':3};
      if(map[e.key]!==undefined) player = map[e.key] % cfg.colors;
    });
    canvas.addEventListener('mousedown', ()=>{ if(lives<=0) start(); else player=(player+1)%cfg.colors; });

    start();
    return { pause(){ ticker?.pause(); }, resume(){ ticker?.resume(); }, dispose(){ ticker?.stop(); sp.destroy?.(); } };
  }
}
