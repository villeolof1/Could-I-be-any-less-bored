// Main shell: auto-discovers games in src/games via Vite's import.meta.glob
import { createShell } from './shell.js';

const galleryEl = document.getElementById('gallery');
const overlayEl = document.getElementById('overlay');

const globbed = import.meta.glob('./games/*.js', { eager: true });
const games = Object.values(globbed).map(m => m.default).filter(Boolean);

// Sort by title
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
  render();
}
function isFav(id) {
  return favs.has(id);
}
function pushRecent(id) {
  recents.delete(id);
  recents.add(id);
  while (recents.size > 16) recents.delete(recents.values().next().value);
  localStorage.setItem(RECENT_KEY, JSON.stringify([...recents]));
}

// ===== Ratings (1–5 stars) =====
// Structure in localStorage under RATINGS_KEY:
// { [gameId]: { my: number|0, sum: number, count: number } }
function loadRatings() {
  try { return JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveRatings(obj) {
  localStorage.setItem(RATINGS_KEY, JSON.stringify(obj));
}
function getMyRating(gameId) {
  const r = loadRatings()[gameId];
  return r?.my || 0;
}
function setMyRating(gameId, stars) {
  stars = Math.max(0, Math.min(5, Number(stars) || 0));
  const all = loadRatings();
  const prev = all[gameId]?.my || 0;
  const prevSum = all[gameId]?.sum || 0;
  const prevCount = all[gameId]?.count || 0;

  // Update aggregate (local-only; future multi-user can merge server-side)
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
  onToggleFavorite: (id) => {
    toggleFav(id);
    // reflect state to caller
    return isFav(id);
  },
  isFavorite: (id) => isFav(id),
  getRating: (id) => getMyRating(id),
  setRating: (id, stars) => setMyRating(id, stars),
});

// ===== Hash router (deep link to games) =====
function openFromHash() {
  const id = (location.hash || '').slice(1);
  const game = games.find(g => g.id === id);
  if (game) {
    pushRecent(game.id);
    shell.launch(game);
  } else {
    shell.close?.();
  }
}
window.addEventListener('hashchange', openFromHash);
openFromHash(); // handle initial load with hash

// ===== UI: search + All/Favorites filter =====
const q = document.getElementById('search');
const btnAll = document.getElementById('filter-all');
const btnFav = document.getElementById('filter-fav');
let mode = 'all'; // 'all' | 'favorites'
let query = '';

document.getElementById('resetProgress').addEventListener('click', () => {
  if (confirm('Reset favorites, recents and per-game data?')) {
    localStorage.clear();
    location.reload();
  }
});

function setMode(next) {
  mode = next;
  btnAll.classList.toggle('active', mode === 'all');
  btnFav.classList.toggle('active', mode === 'favorites');
  btnAll.setAttribute('aria-pressed', mode === 'all' ? 'true' : 'false');
  btnFav.setAttribute('aria-pressed', mode === 'favorites' ? 'true' : 'false');
  render();
}

q.addEventListener('input', () => {
  query = q.value.trim().toLowerCase();
  render();
});
btnAll.addEventListener('click', () => setMode('all'));
btnFav.addEventListener('click', () => setMode('favorites'));

// ===== Render =====
function render() {
  let list = games;

  if (mode === 'favorites') {
    list = list.filter(g => favs.has(g.id));
  }

  if (query) {
    list = list.filter(g => {
      const hay = (g.title + ' ' + (g.tags || []).join(' ')).toLowerCase();
      return hay.includes(query);
    });
  }

  const el = galleryEl;
  el.innerHTML = '';

  if (list.length === 0 && mode === 'favorites') {
    // Empty-state message
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="empty-card">
        <div class="empty-title">No favorites yet</div>
        <p class="empty-text">
          You currently have no favorites. Click the <span class="star">☆</span> on a game card,
          or use the <strong>Favorite</strong> button inside a puzzle to add it here.
        </p>
      </div>
    `;
    el.appendChild(empty);
    return;
  }

  list.forEach(g => {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb" aria-hidden="true">
        ${g.icon || '🎮'}
      </div>
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

    card.querySelector('.pill.play').addEventListener('click', () => {
      location.hash = g.id; // openFromHash() will launch and push recents
    });
    card.querySelector('.fav-btn').addEventListener('click', (e) => {
      toggleFav(g.id);
      e.currentTarget.innerHTML = favs.has(g.id) ? '★' : '☆';
      e.currentTarget.setAttribute('aria-pressed', favs.has(g.id) ? 'true' : 'false');
    });

    el.appendChild(card);
  });
}

// Initial paint
render();
