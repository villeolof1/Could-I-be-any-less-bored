export function createShell({ overlayEl, galleryEl }) {
  let current = null;

  function close() {
    overlayEl.classList.add('hidden');
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = '';
    current?.dispose?.();
    current = null;
  }

  function launch(game) {
    close(); // ensure clean
    overlayEl.classList.remove('hidden');
    overlayEl.removeAttribute('aria-hidden');

    const wrap = document.createElement('div');
    wrap.className = 'game-frame';
    wrap.innerHTML = `
      <div class="frame-top">
        <div class="left">
          <button class="ghost" id="backBtn">← Back</button>
          <div class="title">${game.title}</div>
        </div>
        <div class="frame-actions">
          <button class="ghost" id="pauseBtn">Pause</button>
          <button class="ghost" id="fullBtn">Fullscreen</button>
        </div>
      </div>
      <div class="canvas-wrap" id="gameMount">
        <div class="hud" id="hud"></div>
        <div class="center-note" id="centerNote"></div>
      </div>
    `;
    overlayEl.appendChild(wrap);

    const mount = wrap.querySelector('#gameMount');
    const hud = wrap.querySelector('#hud');
    const status = wrap.querySelector('#status');
    const note = wrap.querySelector('#centerNote');

    function setStatus(s) { status.textContent = s; }
    function setNote(s) { note.textContent = s || ''; note.style.display = s ? 'block' : 'none'; }
    function addHudPill(id, initial='') {
      const el = document.createElement('span');
      el.className = 'pill';
      el.id = id;
      el.textContent = initial;
      hud.appendChild(el);
      return el;
    }

    const api = { mount, hud, addHudPill, setStatus, setNote };

    const ctx = game.launch(api);

    current = {
      dispose: ctx?.dispose || (() => {}),
      pause: ctx?.pause || (() => {}),
      resume: ctx?.resume || (() => {})
    };

    wrap.querySelector('#backBtn').addEventListener('click', close);
    wrap.querySelector('#pauseBtn').addEventListener('click', () => {
      if (!ctx?.pause) return;
      if (wrap.dataset.paused === '1') {
        wrap.dataset.paused = '0'; ctx.resume(); setStatus('Running');
      } else {
        wrap.dataset.paused = '1'; ctx.pause(); setStatus('Paused');
      }
    });
    wrap.querySelector('#fullBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) wrap.requestFullscreen().catch(()=>{});
      else document.exitFullscreen();
    });
  }

  return { launch };
}
