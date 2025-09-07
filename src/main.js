// Main shell: auto-discovers games in src/games via Vite's import.meta.glob
import { createShell } from './shell.js';

const shell = createShell({
  overlayEl: document.getElementById('overlay'),
  galleryEl: document.getElementById('gallery'),
});

const globbed = import.meta.glob('./games/*.js', { eager: true });
const games = Object.values(globbed).map(m => m.default).filter(Boolean);

// Sort by title
games.sort((a, b) => a.title.localeCompare(b.title));

// UI: search, tabs, theme, reset
const q = document.getElementById('search');
q.addEventListener('input', () => render());
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

const THEME_KEY = 'arcade-theme';
const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;
const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
root.classList.toggle('light', savedTheme === 'light');
themeToggle.addEventListener('click', () => {
  const now = root.classList.toggle('light');
  localStorage.setItem(THEME_KEY, now ? 'light' : 'dark');
});

document.getElementById('resetProgress').addEventListener('click', () => {
  if (confirm('Reset favorites, recents and per-game data?')) {
    localStorage.clear();
    location.reload();
  }
});

// Favorites & recent
const FAV_KEY = 'arcade-favs';
const RECENT_KEY = 'arcade-recents';
const favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
const recents = new Set(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
  render();
}
function pushRecent(id) {
  recents.delete(id);
  recents.add(id);
  while (recents.size > 16) recents.delete(recents.values().next().value);
  localStorage.setItem(RECENT_KEY, JSON.stringify([...recents]));
}

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
// ===========================================

function render() {
  const filter = document.querySelector('.tab.active')?.dataset.filter || 'all';
  const term = q.value.trim().toLowerCase();
  const list = games.filter(g => {
    const byTab =
      filter === 'all' ? true :
      filter === 'favorites' ? favs.has(g.id) :
      filter === 'recent' ? recents.has(g.id) :
      g.category === filter;
    const byText = !term || (g.title + ' ' + (g.tags || []).join(' ')).toLowerCase().includes(term);
    return byTab && byText;
  });

  const el = document.getElementById('gallery');
  el.innerHTML = '';

  list.forEach(g => {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb" aria-hidden="true">${g.icon || '🎮'}</div>
      <div class="meta">
        <div class="title">${g.title}</div>
        <div class="row">
          <span class="badge">${g.category}</span>
          <div class="row" style="gap:6px">
            <button class="ghost pill" title="Favorite">${favs.has(g.id) ? '★' : '☆'}</button>
            <button class="pill play">Play</button>
          </div>
        </div>
      </div>
    `;
    card.querySelector('.pill.play').addEventListener('click', () => {
      // Navigate via hash; openFromHash() will launch and push recents
      location.hash = g.id;
    });
    card.querySelector('.ghost.pill').addEventListener('click', () => toggleFav(g.id));
    el.appendChild(card);
  });
}

render();
