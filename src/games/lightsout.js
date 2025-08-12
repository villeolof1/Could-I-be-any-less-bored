import { makeHUD, settingsPanel } from '../kit/gamekit.js';

export default {
  id:'lightsout',
  title:'Lights Out+',
  category:'puzzle',
  icon:'💡',
  tags:['toggle','grid'],
  launch(api){
    let cfg={ n:5, randomMoves:12, wrap:false };
    const sp=settingsPanel(api, [
      {key:'n',label:'Size',type:'range',min:3,max:8,default:5},
      {key:'randomMoves',label:'Scramble Moves',type:'range',min:5,max:30,default:12},
      {key:'wrap',label:'Wrap Edges',type:'toggle',default:false},
    ], 'lightsout', s=>{ cfg={...cfg, ...s, n:Number(s.n), randomMoves:Number(s.randomMoves)}; start(); });

    const hud=makeHUD(api,{score:false,lives:false}); let grid, N, moves=0;
    const root=document.createElement('div'); root.style.margin='24px auto';
    const board=document.createElement('div'); root.appendChild(board); api.mount.appendChild(root);

    function flip(r,c){
      const nbs = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
      nbs.forEach(([dr,dc])=>{
        let rr=r+dr, cc=c+dc;
        if(cfg.wrap){ rr=(rr+N)%N; cc=(cc+N)%N; }
        if(rr>=0&&cc>=0&&rr<N&&cc<N) grid[rr][cc]^=1;
      });
    }
    function draw(){
      board.style.display='grid'; board.style.gridTemplateColumns=`repeat(${N},56px)`; board.style.gap='8px';
      board.innerHTML='';
      for(let r=0;r<N;r++) for(let c=0;c<N;c++){
        const b=document.createElement('button');
        b.style.height='56px'; b.style.border='1px solid var(--ring)'; b.style.borderRadius='10px';
        b.style.background=grid[r][c]?'#ffd476':'#121726';
        b.addEventListener('click',()=>{ flip(r,c); moves++; draw(); if(win()) api.setNote(`You win! (${moves} moves)`); });
        board.appendChild(b);
      }
    }
    function win(){ return grid.every(row=>row.every(v=>v===0)); }
    function start(){
      N=cfg.n; moves=0; grid=Array.from({length:N},()=>Array(N).fill(0));
      for(let i=0;i<cfg.randomMoves;i++) flip((Math.random()*N)|0,(Math.random()*N)|0);
      draw(); api.setNote('Turn all lights OFF.');
    }
    start();
    return { dispose(){ sp.destroy?.(); } };
  }
}
