import { fitCanvas, makeHUD, settingsPanel } from '../kit/gamekit.js';

export default {
  id:'match3',
  title:'Match-3+',
  category:'puzzle',
  icon:'🍬',
  tags:['swap','cascades','combo'],
  launch(api){
    const SIZE=52;
    let cfg={ n:8, colors:6, gravity:'down' };
    const sp=settingsPanel(api, [
      {key:'n',label:'Board',type:'range',min:6,max:10,default:8},
      {key:'colors',label:'Colors',type:'range',min:4,max:8,default:6},
      {key:'gravity',label:'Gravity',type:'select', options:[{v:'down',l:'Down'},{v:'up',l:'Up'},{v:'left',l:'Left'},{v:'right',l:'Right'}], default:'down'}
    ], 'match3', s=>{ cfg={...cfg, ...s, n:Number(s.n), colors:Number(s.colors)}; start(); });

    const canvas=document.createElement('canvas'); const g=fitCanvas(canvas, cfg.n*SIZE, cfg.n*SIZE);
    canvas.style.display='block'; canvas.style.margin='0 auto'; api.mount.appendChild(canvas);
    const hud=makeHUD(api,{score:true,lives:false}); let score=0;

    let board=[], sel=null, animating=false;

    function rnd(){ return (Math.random()*cfg.colors)|0; }
    function init(){
      board=Array.from({length:cfg.n},()=>Array(cfg.n).fill(0));
      for(let r=0;r<cfg.n;r++) for(let c=0;c<cfg.n;c++){ do{ board[r][c]=rnd(); } while(isMatchAt(r,c)); }
    }
    function isMatchAt(r,c){
      const v=board[r][c]; if(v==null) return false;
      const H = c>=2 && board[r][c-1]===v && board[r][c-2]===v;
      const V = r>=2 && board[r-1][c]===v && board[r-2][c]===v;
      return H||V;
    }

    function draw(){
      g.fillStyle='#0f1320'; g.fillRect(0,0,canvas.width,canvas.height);
      for(let r=0;r<cfg.n;r++) for(let c=0;c<cfg.n;c++){
        const v=board[r][c]; if(v==null) continue;
        g.fillStyle=`hsl(${(v*60)%360},75%,60%)`;
        g.fillRect(c*SIZE+6,r*SIZE+6,SIZE-12,SIZE-12);
      }
      if(sel){ g.strokeStyle='#fff'; g.lineWidth=2; g.strokeRect(sel.c*SIZE+4, sel.r*SIZE+4, SIZE-8, SIZE-8); }
    }

    function findMatches(){
      const kill=Array.from({length:cfg.n},()=>Array(cfg.n).fill(false));
      // horizontal
      for(let r=0;r<cfg.n;r++){
        let run=1;
        for(let c=1;c<=cfg.n;c++){
          if(c<cfg.n && board[r][c]!=null && board[r][c]===board[r][c-1]) run++; else {
            if(run>=3){ for(let k=1;k<=run;k++) kill[r][c-k]=true; }
            run=1;
          }
        }
      }
      // vertical
      for(let c=0;c<cfg.n;c++){
        let run=1;
        for(let r=1;r<=cfg.n;r++){
          if(r<cfg.n && board[r][c]!=null && board[r][c]===board[r-1][c]) run++; else {
            if(run>=3){ for(let k=1;k<=run;k++) kill[r-k][c]=true; }
            run=1;
          }
        }
      }
      return kill;
    }

    function collapse(kill){
      let cleared=0;
      if(cfg.gravity==='down'){
        for(let c=0;c<cfg.n;c++){
          let write=cfg.n-1;
          for(let r=cfg.n-1;r>=0;r--){
            if(!kill[r][c]) board[write--][c]=board[r][c]; else cleared++;
          }
          for(let r=write;r>=0;r--) board[r][c]=rnd();
        }
      } else if(cfg.gravity==='up'){
        for(let c=0;c<cfg.n;c++){
          let write=0;
          for(let r=0;r<cfg.n;r++){
            if(!kill[r][c]) board[write++][c]=board[r][c]; else cleared++;
          }
          for(let r=write;r<cfg.n;r++) board[r][c]=rnd();
        }
      } else if(cfg.gravity==='left'){
        for(let r=0;r<cfg.n;r++){
          let write=0;
          for(let c=0;c<cfg.n;c++){
            if(!kill[r][c]) board[r][write++]=board[r][c]; else cleared++;
          }
          for(let c=write;c<cfg.n;c++) board[r][c]=rnd();
        }
      } else {
        for(let r=0;r<cfg.n;r++){
          let write=cfg.n-1;
          for(let c=cfg.n-1;c>=0;c--){
            if(!kill[r][c]) board[r][write--]=board[r][c]; else cleared++;
          }
          for(let c=write;c>=0;c--) board[r][c]=rnd();
        }
      }
      if(cleared){ score+=cleared*10; hud.setScore(score); }
      return cleared>0;
    }

    function resolve(){
      animating=true;
      const kill=findMatches();
      if(kill.flat().some(Boolean)){ collapse(kill); draw(); setTimeout(resolve, 120); }
      else { animating=false; draw(); }
    }

    function trySwap(r1,c1,r2,c2){
      const tmp=board[r1][c1]; board[r1][c1]=board[r2][c2]; board[r2][c2]=tmp;
      const any = findMatches().flat().some(Boolean);
      if(!any){ // swap back
        board[r2][c2]=board[r1][c1]; board[r1][c1]=tmp; draw(); return false;
      }
      resolve();
      return true;
    }

    canvas.addEventListener('mousedown', e=>{
      if(animating) return;
      const rect=canvas.getBoundingClientRect();
      const c=Math.floor((e.clientX-rect.left)/SIZE), r=Math.floor((e.clientY-rect.top)/SIZE);
      if(!sel) { sel={r,c}; draw(); }
      else {
        const dr=Math.abs(sel.r-r), dc=Math.abs(sel.c-c);
        if(dr+dc===1) trySwap(sel.r,sel.c,r,c);
        sel=null; draw();
      }
    });

    function start(){ init(); score=0; hud.setScore(0); draw(); api.setNote('Swap adjacent tiles to match 3+.'); }
    start();
    return { dispose(){ sp.destroy?.(); } };
  }
}
