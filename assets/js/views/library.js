import { sb } from '../lib/env.js';
import { state } from '../lib/auth.js';
import { loadWatchlist, recentHistory, removeHistory, clearHistory } from '../lib/data.js';
import { esc, img, toast, fmtDate } from '../lib/util.js';
import { grid, skeletonGrid, emptyState, errorState } from '../ui.js';

const signInPrompt = (what) => emptyState({
  title: 'Sign in to continue',
  text: `Your ${what} is saved to your free CineOtaku account and syncs across devices.`,
  action: '<button class="btn primary" type="button" data-open-auth>Sign in</button>',
});

export async function renderList(root, ctx) {
  root.innerHTML = `<div class="page"><div class="page-head"><div><p class="eyebrow">SAVED FOR LATER</p><h1 class="page-title">My List</h1></div></div><div id="body">${skeletonGrid(6)}</div></div>`;
  const body = root.querySelector('#body');
  if (!sb || !state.user) { body.innerHTML = signInPrompt('list'); return; }
  try {
    const rows = await loadWatchlist();
    if (ctx.stale()) return;
    body.innerHTML = rows.length
      ? grid(rows, undefined)
      : emptyState({ title: 'Your list is empty', text: 'Tap the + on any poster to save it here.', action: '<a class="btn primary" href="#/">Discover titles</a>' });
  } catch (e) { if (!ctx.stale()) body.innerHTML = errorState(e.message); }
}

export async function renderHistory(root, ctx) {
  root.innerHTML = `<div class="page"><div class="page-head"><div><p class="eyebrow">YOUR ACTIVITY</p><h1 class="page-title">Watch history</h1></div><button class="btn ghost small hidden" id="clear-hist" type="button">Clear history</button></div><div id="body">${skeletonGrid(6)}</div></div>`;
  const body = root.querySelector('#body');
  if (!sb || !state.user) { body.innerHTML = signInPrompt('history'); return; }
  let rows;
  try { rows = await recentHistory(200); } catch (e) { if (!ctx.stale()) body.innerHTML = errorState(e.message); return; }
  if (ctx.stale()) return;

  const paint = () => {
    root.querySelector('#clear-hist').classList.toggle('hidden', !rows.length);
    if (!rows.length) {
      body.innerHTML = emptyState({ title: 'Nothing watched yet', text: 'Titles you open or mark as watched will show up here.', action: '<a class="btn primary" href="#/">Discover titles</a>' });
      return;
    }
    body.innerHTML = `<ul class="history">${rows.map((h) => {
      const label = h.media_type === 'tv' ? `S${h.season_number} E${h.episode_number}${h.episode_title ? ` · ${h.episode_title}` : ''}` : 'Movie';
      return `<li class="hist-item">
        <a class="hist-link" href="#/title/${h.media_type}/${h.tmdb_id}"><img loading="lazy" src="${img(h.poster_path, 'w154')}" alt=""><div><strong>${esc(h.title)}</strong><small>${esc(label)}</small><small class="muted">${esc(fmtDate(h.last_watched_at.slice(0, 10)))}</small></div></a>
        <span class="pill ${h.completed ? 'ok' : ''}">${h.completed ? 'Watched' : 'Started'}</span>
        <button class="icon-btn small" type="button" data-hist-del="${h.id}" aria-label="Remove ${esc(h.title)} from history">✕</button>
      </li>`;
    }).join('')}</ul>`;
  };
  paint();

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hist-del]');
    if (!b) return;
    try { await removeHistory(b.dataset.histDel); rows = rows.filter((r) => String(r.id) !== b.dataset.histDel); paint(); }
    catch (err) { toast(err.message || 'Could not remove.', 'error'); }
  });
  root.querySelector('#clear-hist').addEventListener('click', async () => {
    if (!confirm('Clear your entire watch history? This cannot be undone.')) return;
    try { await clearHistory(); rows = []; paint(); toast('History cleared.'); }
    catch (err) { toast(err.message || 'Could not clear.', 'error'); }
  });
}
