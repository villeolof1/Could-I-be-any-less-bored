// Main shell: auto-discovers games in src/games via Vite's import.meta.glob
import { createShell } from './shell.js';

const galleryEl = document.getElementById('gallery');
const overlayEl = document.getElementById('overlay');

const globbed = import.meta.glob('./games/*.js', { eager: true });
const games = Object.values(globbed).map(m => m.default).filter(Boolean);

// Base order (A–Z) used when no query
games.sort((a, b) => a.title.localeCompare(b.title));

// ===== Storage keys =====
const FAV_KEY = 'arcade-favs';
const RECENT_KEY = 'arcade-recents';
const RATINGS_KEY = 'arcade-ratings:v1';
const CLIENT_KEY = 'arcade-client-id';

// ===== Anonymous client id =====
let clientId = localStorage.getItem(CLIENT_KEY);
if (!clientId && 'crypto' in window && crypto.randomUUID) {
  clientId = crypto.randomUUID();
  localStorage.setItem(CLIENT_KEY, clientId);
} else if (!clientId) {
  clientId = 'local-client';
  localStorage.setItem(CLIENT_KEY, clientId);
}

// ===== Favorites & Recent =====
const favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
const recents = new Set(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));

function saveFavs() {
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
}
function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  saveFavs();
  scheduleRender();
}
function isFav(id) { return favs.has(id); }
function pushRecent(id) {
  recents.delete(id);
  recents.add(id);
  while (recents.size > 16) recents.delete(recents.values().next().value);
  localStorage.setItem(RECENT_KEY, JSON.stringify([...recents]));
}

// ===== Ratings (1–5 stars) =====
function loadRatings() {
  try { return JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveRatings(obj) { localStorage.setItem(RATINGS_KEY, JSON.stringify(obj)); }
function getMyRating(gameId) { return loadRatings()[gameId]?.my || 0; }
function setMyRating(gameId, stars) {
  stars = Math.max(0, Math.min(5, Number(stars) || 0));
  const all = loadRatings();
  const prev = all[gameId]?.my || 0;
  const prevSum = all[gameId]?.sum || 0;
  const prevCount = all[gameId]?.count || 0;
  const wasRatedBefore = prev > 0 || prevCount > 0;
  const nextCount = wasRatedBefore ? Math.max(1, prevCount) : 1;
  const nextSum = (prevSum - prev) + stars;
  all[gameId] = { my: stars, sum: nextSum, count: nextCount };
  saveRatings(all);
}

// ===== Shell with callbacks =====
const shell = createShell({
  overlayEl,
  galleryEl,
  onToggleFavorite: (id) => { toggleFav(id); return isFav(id); },
  isFavorite: (id) => isFav(id),
  getRating: (id) => getMyRating(id),
  setRating: (id, stars) => setMyRating(id, stars),
});

// ===== Hash router =====
function openFromHash() {
  const id = (location.hash || '').slice(1);
  const game = games.find(g => g.id === id);
  if (game) { pushRecent(game.id); shell.launch(game); }
  else { shell.close?.(); }
}
window.addEventListener('hashchange', openFromHash);
openFromHash();

// ===== UI: search + All/Favorites =====
const q = document.getElementById('search');
const btnAll = document.getElementById('filter-all');
const btnFav = document.getElementById('filter-fav');
let mode = 'all'; // 'all' | 'favorites'
let query = '';

document.getElementById('resetProgress').addEventListener('click', () => {
  if (confirm('Reset favorites, recents and per-game data?')) {
    localStorage.clear(); location.reload();
  }
});

function setMode(next) {
  mode = next;
  btnAll.classList.toggle('active', mode === 'all');
  btnFav.classList.toggle('active', mode === 'favorites');
  btnAll.setAttribute('aria-pressed', mode === 'all' ? 'true' : 'false');
  btnFav.setAttribute('aria-pressed', mode === 'favorites' ? 'true' : 'false');
  scheduleRender();
}

function debounce(fn, ms = 80) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
if (q) {
  const doSearch = debounce(() => {
    query = (q.value || '').trim().toLowerCase();
    q.classList.toggle('searching', !!query);
    scheduleRender();
  }, 80);
  q.addEventListener('input', doSearch);
}
btnAll.addEventListener('click', () => setMode('all'));
btnFav.addEventListener('click', () => setMode('favorites'));

/* ===== Search ranking (title-only) ===== */
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const initials = (s) => norm(s).split(/[^a-z0-9]+/g).filter(Boolean).map(w => w[0]).join('');
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  if (a.length > b.length) [a, b] = [b, a];
  const row = new Array(a.length + 1); for (let i = 0; i <= a.length; i++) row[i] = i;
  for (let j = 1; j <= b.length; j++) { let prev = j, val;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      val = Math.min(row[i] + 1, prev + 1, row[i - 1] + cost);
      row[i - 1] = prev; prev = val;
    } row[a.length] = prev;
  } return row[a.length];
}
function rankTitle(q, title) {
  if (!q) return 0;
  const t = norm(title), qi = norm(q), words = t.split(/[^a-z0-9]+/g).filter(Boolean);
  if (t === qi) return 1000;
  if (t.startsWith(qi)) return 900;
  for (const w of words) if (w.startsWith(qi)) return 800;
  if (t.includes(qi)) return 650;
  const ini = initials(title);
  if (ini.startsWith(qi)) return 540;
  if (qi.length <= 5) {
    const d = lev(qi, t.slice(0, Math.min(t.length, qi.length + 3)));
    if (d <= 1) return 520;
    if (d === 2) return 500;
  }
  return 0;
}
function compareRanked(a, b) {
  if (b._score !== a._score) return b._score - a._score;
  const af = favs.has(a.id) ? 1 : 0, bf = favs.has(b.id) ? 1 : 0;
  if (bf !== af) return bf - af;
  const ar = getMyRating(a.id), br = getMyRating(b.id);
  if (br !== ar) return br - ar;
  return a.title.localeCompare(b.title);
}

/* ===== Scheduler: coalesce to one render per frame ===== */
let scheduled = false;
function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    performRender();
  });
}

/* ===== Animation helpers (two-rAF FLIP + enter/exit) ===== */
function measureRects(container) {
  const rects = new Map();
  container.querySelectorAll('.card').forEach(el => {
    rects.set(el.dataset.id, el.getBoundingClientRect());
  });
  return rects;
}
function onTransitionEndOnce(el, cb, timeout = 400) {
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', end);
    cb();
  };
  el.addEventListener('transitionend', end, { once: true });
  setTimeout(end, timeout); // fallback
}
function pinAbsolute(el, rect, parentRect) {
  const x = rect.left - parentRect.left;
  const y = rect.top - parentRect.top;
  const w = rect.width, h = rect.height;

  el.style.transition = 'none';
  el.style.position = 'absolute';
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.zIndex = '1';
  el.style.pointerEvents = 'none';
  // commit styles
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
}
function leaveWithFade(el) {
  el.classList.add('leaving');
  onTransitionEndOnce(el, () => el.remove());
}
function createCard(g) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = g.id;
  card.innerHTML = `
    <div class="thumb" aria-hidden="true">${g.icon || '🎮'}</div>
    <div class="meta">
      <div class="title" title="${g.title}">${g.title}</div>
      <div class="row">
        <span class="badge">${g.category || 'Game'}</span>
        <div class="row" style="gap:6px">
          <button class="ghost pill fav-btn" title="Favorite" aria-pressed="${favs.has(g.id) ? 'true' : 'false'}">
            ${favs.has(g.id) ? '★' : '☆'}
          </button>
          <button class="pill play">Play</button>
        </div>
      </div>
    </div>
  `;
  card.querySelector('.pill.play').addEventListener('click', () => { location.hash = g.id; });
  card.querySelector('.fav-btn').addEventListener('click', (e) => {
    toggleFav(g.id);
    e.currentTarget.innerHTML = favs.has(g.id) ? '★' : '☆';
    e.currentTarget.setAttribute('aria-pressed', favs.has(g.id) ? 'true' : 'false');
  });
  // Enter animation baseline
  card.classList.add('enter');
  requestAnimationFrame(() => card.classList.add('enter-play'));
  return card;
}
function getCard(id) { return galleryEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`); }
function ensureEmptyState(show, mode) {
  let empty = galleryEl.querySelector('.empty');
  if (show) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `
        <div class="empty-card">
          <div class="empty-title">${mode === 'favorites' ? 'No favorites yet' : 'No results'}</div>
          <p class="empty-text">
            ${mode === 'favorites'
              ? 'You currently have no favorites. Click the ☆ on a game to add it here.'
              : 'Try a different search term or clear the search.'}
          </p>
        </div>
      `;
      galleryEl.appendChild(empty);
    }
  } else if (empty) {
    empty.remove();
  }
}

/* ===== Core render with two-rAF FLIP ===== */
function performRender() {
  // 1) Compute target list (data)
  let list = games;
  if (mode === 'favorites') list = list.filter(g => favs.has(g.id));
  const qval = (query || '').trim();
  if (qval) {
    list = list.map(g => ({ ...g, _score: rankTitle(qval, g.title) }))
               .filter(g => g._score > 0)
               .sort(compareRanked);
  }

  const targetIds = list.map(g => g.id);
  const targetSet = new Set(targetIds);

  // Current DOM ids
  const currentCards = Array.from(galleryEl.querySelectorAll('.card'));
  const currentIds = currentCards.map(el => el.dataset.id);
  const currentSet = new Set(currentIds);

  // 2) Measure FIRST for all current cards
  const prevRects = measureRects(galleryEl);
  const parentRect = galleryEl.getBoundingClientRect();

  // 3) EXIT: cards not in target → pin absolute + fade
  currentCards.forEach(el => {
    const id = el.dataset.id;
    if (!targetSet.has(id) && !el.classList.contains('leaving')) {
      const r = prevRects.get(id);
      if (r) {
        pinAbsolute(el, r, parentRect);
        leaveWithFade(el);
      }
    }
  });

  // 4) STAY & ENTER: build DOM in target order (no measuring yet)
  targetIds.forEach((id, idx) => {
    let node = getCard(id);
    if (!node) {
      const g = list[idx];
      node = createCard(g);
      const ref = galleryEl.children[idx] || null;
      galleryEl.insertBefore(node, ref);
    } else {
      // Move node to correct index if needed
      const currentIndex = Array.prototype.indexOf.call(galleryEl.children, node);
      if (currentIndex !== idx) {
        const ref = galleryEl.children[idx] || null;
        galleryEl.insertBefore(node, ref);
      }
      // Refresh fav visual (in case toggled elsewhere)
      const favBtn = node.querySelector('.fav-btn');
      favBtn.innerHTML = favs.has(id) ? '★' : '☆';
      favBtn.setAttribute('aria-pressed', favs.has(id) ? 'true' : 'false');
    }
  });

  // If we have results, ensure empty state is hidden; if none, show it.
  ensureEmptyState(targetIds.length === 0, mode);
  if (targetIds.length === 0) return; // exits are already animating; empty shown

  // 5) rAF #1: measure LAST for STAY cards
  requestAnimationFrame(() => {
    const afterRects = measureRects(galleryEl);

    // 6) Set inversion (translate from prev to new) without transition
    const stayCards = targetIds
      .map(id => getCard(id))
      .filter(Boolean)
      .filter(el => !el.classList.contains('leaving'));

    stayCards.forEach(el => {
      const id = el.dataset.id;
      const from = prevRects.get(id);
      const to = afterRects.get(id);
      if (!from || !to) return;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx || dy) {
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.willChange = 'transform, opacity';
        // commit
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
      }
    });

    // 7) rAF #2: play transitions (clear transform, add easing)
    requestAnimationFrame(() => {
      stayCards.forEach(el => {
        el.style.transition = 'transform 240ms cubic-bezier(.2,.7,.2,1), opacity 180ms ease';
        el.style.transform = '';
        onTransitionEndOnce(el, () => {
          el.style.transition = '';
          el.style.willChange = '';
        });
      });

      // Clear enter classes when done (give a tick so .enter-play applied)
      setTimeout(() => {
        galleryEl.querySelectorAll('.card.enter').forEach(el => {
          el.classList.remove('enter', 'enter-play');
        });
      }, 280);
    });
  });
}

// Initial paint
scheduleRender();
