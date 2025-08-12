const WORDS = ['APPLE','BRAIN','STEAM','GHOST','CHIME','PLANT','CRANE','SPARK','MONEY','TIGER','METAL','DELTA','QUIET'];
export default {
  id:'wordle',
  title:'Wordle (lite)',
  category:'logic',
  icon:'🟩',
  tags:['words','guess'],
  launch(api){
    const root=document.createElement('div');
    root.style.maxWidth='420px'; root.style.margin='24px auto'; root.style.textAlign='center';
    api.mount.appendChild(root);

    const secret = WORDS[(Math.random()*WORDS.length)|0];
    let row=0, col=0; const GRID=Array.from({length:6},()=>Array(5).fill(''));
    const board=document.createElement('div'); board.style.display='grid'; board.style.gridTemplateColumns='repeat(5,1fr)'; board.style.gap='8px';
    const tiles=[];
    for(let i=0;i<30;i++){ const d=document.createElement('div'); d.style.border='1px solid var(--ring)';d.style.padding='16px 0';d.style.fontSize='20px';d.style.borderRadius='10px';tiles.push(d); board.appendChild(d); }
    const line=document.createElement('input'); line.placeholder='Type letters, Enter to submit'; line.maxLength=1; line.style.opacity=.001; line.style.position='absolute';
    root.appendChild(board); root.appendChild(line); line.focus();

    function paintRow(r){
      const s=secret.split('');
      const guess=GRID[r].join('').toUpperCase();
      for(let i=0;i<5;i++){
        const idx=r*5+i, el=tiles[idx];
        el.textContent=GRID[r][i];
        el.style.background='';
        if (guess.length<5) continue;
        if (guess[i]===s[i]) el.style.background='#7ce2c4';
        else if (s.includes(guess[i])) el.style.background='#ffd476';
        else el.style.background='#2a2f3f';
      }
      if(guess===secret){ api.setNote('You win!'); }
      else if(r===5){ api.setNote('The word was '+secret); }
    }
    window.addEventListener('keydown', (e)=>{
      if(api.mount.contains(document.activeElement)===false) line.focus();
      const k=e.key.toUpperCase();
      if(k==='BACKSPACE'){ if(col>0){ GRID[row][--col]=''; paintRow(row);} return; }
      if(k==='ENTER'){ if(col===5){ paintRow(row); row++; col=0; } return; }
      if(k>='A'&&k<='Z'&&k.length===1 && col<5){ GRID[row][col++]=k; paintRow(row); }
    });

    return { dispose(){ root.remove(); } };
  }
}
