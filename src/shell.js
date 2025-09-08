export function createShell({ overlayEl, galleryEl, onToggleFavorite, isFavorite, getRating, setRating }) {
  let current = null;

  function close() {
    overlayEl.classList.add('hidden');
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = '';
    current?.dispose?.();
    current = null;
  }

  // --- Toast helper (bottom-center)
  function showToast(message, ms = 1600) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    wrap.appendChild(t);
    // force reflow to trigger animation
    // eslint-disable-next-line no-unused-expressions
    t.offsetWidth; 
    t.classList.add('show');
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, ms);
  }

  function launch(game) {
    close(); // ensure clean
    overlayEl.classList.remove('hidden');
    overlayEl.removeAttribute('aria-hidden');

    const favOn = isFavorite?.(game.id);
    const myInitial = (getRating?.(game.id)) || 0;

    const wrap = document.createElement('div');
    wrap.className = 'game-frame';
    wrap.innerHTML = `
      <div class="frame-top">
        <div class="left">
          <button class="ghost" id="backBtn">← Back</button>
          <div class="title">${game.title}</div>
        </div>
        <div class="frame-actions">
          <!-- Rating -->
          <div class="rating" id="rating" role="radiogroup" aria-label="Rate this game from 1 to 5 stars">
            <span class="rating-label">Rate</span>
            <button class="star" data-v="1" role="radio" aria-checked="false" title="1 star" aria-label="1 star">★</button>
            <button class="star" data-v="2" role="radio" aria-checked="false" title="2 stars" aria-label="2 stars">★</button>
            <button class="star" data-v="3" role="radio" aria-checked="false" title="3 stars" aria-label="3 stars">★</button>
            <button class="star" data-v="4" role="radio" aria-checked="false" title="4 stars" aria-label="4 stars">★</button>
            <button class="star" data-v="5" role="radio" aria-checked="false" title="5 stars" aria-label="5 stars">★</button>
            <span class="rating-value" id="ratingValue" aria-hidden="true"></span>
          </div>

          <!-- Favorite toggle -->
          <button class="ghost" id="favBtn" aria-pressed="${favOn ? 'true' : 'false'}" title="Favorite">
            ${favOn ? '★ Favorite' : '☆ Favorite'}
          </button>

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
    const note = wrap.querySelector('#centerNote');

    function setStatus(_s) {}
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
    const ctx = game.launch?.(api);

    current = {
      dispose: ctx?.dispose || (() => {}),
      pause: ctx?.pause || (() => {}),
      resume: ctx?.resume || (() => {})
    };

    // Back
    wrap.querySelector('#backBtn').addEventListener('click', () => {
      close();
      if (location.hash) history.pushState('', document.title, window.location.pathname + window.location.search);
    });

    // Pause
    wrap.querySelector('#pauseBtn').addEventListener('click', () => {
      if (!ctx?.pause) return;
      if (wrap.dataset.paused === '1') {
        wrap.dataset.paused = '0'; ctx.resume();
      } else {
        wrap.dataset.paused = '1'; ctx.pause();
      }
    });

    // Fullscreen
    wrap.querySelector('#fullBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) wrap.requestFullscreen().catch(()=>{});
      else document.exitFullscreen();
    });

    // Favorite in overlay
    const favBtn = wrap.querySelector('#favBtn');
    favBtn.addEventListener('click', () => {
      const nowFav = onToggleFavorite?.(game.id);
      favBtn.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
      favBtn.textContent = nowFav ? '★ Favorite' : '☆ Favorite';
      showToast(nowFav ? 'Added to favorites' : 'Removed from favorites');
    });

    // Rating control
    const ratingEl = wrap.querySelector('#rating');
    const starButtons = Array.from(ratingEl.querySelectorAll('.star'));
    const valueEl = wrap.querySelector('#ratingValue');
    let my = myInitial;

    const paint = (val) => {
      starButtons.forEach(btn => {
        const v = Number(btn.dataset.v);
        btn.classList.toggle('on', v <= val);
        btn.setAttribute('aria-checked', v === val ? 'true' : 'false');
      });
      valueEl.textContent = val > 0 ? `${val}/5` : '';
    };
    paint(my);

    // Hover preview + click to set
    starButtons.forEach(btn => {
      btn.addEventListener('mouseenter', () => paint(Number(btn.dataset.v)));
      btn.addEventListener('mouseleave', () => paint(my));
      btn.addEventListener('click', () => {
        my = Number(btn.dataset.v);
        setRating?.(game.id, my);
        paint(my);
        showToast(`Thanks! You rated ${my}★`);
      });
      // Keyboard: pressing Space/Enter while a star is focused sets that value
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          my = Number(btn.dataset.v);
          setRating?.(game.id, my);
          paint(my);
          showToast(`Thanks! You rated ${my}★`);
        }
      });
    });

    // Keyboard: Left/Right to change rating on the whole control
    ratingEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      my = Math.min(5, Math.max(0, my + delta));
      setRating?.(game.id, my);
      paint(my);
      showToast(`Thanks! You rated ${my}★`);
      // move focus to the corresponding star for accessibility
      const target = starButtons[my - 1] || starButtons[0];
      target?.focus();
    });
  }

  return { launch, close };
}
