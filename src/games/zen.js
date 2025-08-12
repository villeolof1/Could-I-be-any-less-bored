import { fitCanvas, settingsPanel } from '../kit/gamekit.js';


export default {
  id:'zen',
  title:'Zen Garden+',
  category:'art',
  icon:'🌾',
  tags:['relax','draw','noise'],
  launch(api){
    let cfg={ width:720, height:360, grain:0.18, rake:6 };
    const sp=settingsPanel(api, [
      {key:'width',label:'Width',type:'range',min:480,max:1000,step:20,default:720},
      {key:'height',label:'Height',type:'range',min:260,max:600,step:20,default:360},
      {key:'grain',label:'Grain',type:'range',min:.05,max:.4,step:.01,default:.18},
      {key:'rake',label:'Rake width',type:'range',min:2,max:12,default:6},
    ], 'zen', s=>{ cfg={...cfg, ...s, width:Number(s.width), height:Number(s.height)}; start(); });

    const canvas=document.createElement('canvas'); canvas.style.display='block'; canvas.style.margin='0 auto';
    let g; api.mount.appendChild(canvas);

    function background(){
      const grad=g.createLinearGradient(0,0,0,cfg.height);
      grad.addColorStop(0,'#bfa37a'); grad.addColorStop(1,'#9a7f5a');
      g.fillStyle=grad; g.fillRect(0,0,cfg.width,cfg.height);
      // subtle noise
      const density=cfg.grain;
      g.globalAlpha=0.1;
      for(let i=0;i<cfg.width*cfg.height*density/200;i++){
        const x=Math.random()*cfg.width, y=Math.random()*cfg.height;
        g.fillStyle='rgba(0,0,0,0.2)'; g.fillRect(x,y,1,1);
      }
      g.globalAlpha=1;
    }

    let down=false, last=null;
    function start(){ g=fitCanvas(canvas,cfg.width,cfg.height); background(); }
    canvas.addEventListener('mousedown', e=>{ down=true; last=pos(e); });
    window.addEventListener('mouseup', ()=>down=false);
    canvas.addEventListener('mousemove', e=>{
      if(!down) return;
      const p=pos(e);
      g.strokeStyle='rgba(0,0,0,0.18)'; g.lineWidth=cfg.rake; g.lineCap='round';
      g.beginPath(); g.moveTo(last.x,last.y); g.lineTo(p.x,p.y); g.stroke();
      g.strokeStyle='rgba(255,255,255,0.08)'; g.lineWidth=Math.max(1,cfg.rake-3);
      g.beginPath(); g.moveTo(last.x+2,last.y+2); g.lineTo(p.x+2,p.y+2); g.stroke();
      last=p;
    });
    function pos(e){ const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }

    api.setNote('Drag to rake patterns. Adjust grain & width in settings.');
    start();
    return { dispose(){ sp.destroy?.(); } };
  }
}
