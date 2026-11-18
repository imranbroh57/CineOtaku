// Reusable UI builders. Every dynamic value is escaped with esc().
import { esc, img, yearOf } from './lib/util.js';
import { watchlist, wlKey } from './lib/data.js';

// Normalise TMDb results, catalog rows and watchlist rows into one card shape.
export function norm(x, fallbackType) {
  const type = x.media_type === 'tv' || x.media_type === 'movie' ? x.media_type : fallbackType || (x.first_air_date ? 'tv' : 'movie');
  return {
    id: x.tmdb_id ?? x.id,
    type,
    title: x.title || x.name || 'Untitled',
    poster: x.poster_path || null,
    year: yearOf(x.release_date || x.first_air_date),
    rating: x.vote_average ? Number(x.vote_average).toFixed(1) : '',
  };
}

export function card(x, fallbackType, opts = {}) {
  const n = norm(x, fallbackType);
  const saved = watchlist.keys.has(wlKey(n.type, n.id));
  const meta = [n.year, n.type === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · ');
  return `<article class="card">
    <a class="card-link" href="#/title/${n.type}/${n.id}" aria-label="${esc(n.title)}">
      <div class="poster-wrap">
        <img class="poster" loading="lazy" decoding="async" alt="" src="${img(n.poster, 'w342')}" width="342" height="513">
        ${n.rating ? `<span class="badge rating-badge">★ ${n.rating}</span>` : ''}
        ${opts.badge ? `<span class="badge pick-badge">${esc(opts.badge)}</span>` : ''}
      </div>
      <h3 class="card-title">${esc(n.title)}</h3>
      <p class="card-meta">${esc(meta)}</p>
    </a>
    <button class="card-save${saved ? ' is-saved' : ''}" type="button" data-save data-id="${n.id}" data-type="${n.type}" data-title="${esc(n.title)}" data-poster="${esc(n.poster || '')}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from' : 'Add to'} My List: ${esc(n.title)}">${saved ? '✓' : '+'}</button>
  </article>`;
}

export const grid = (items, type, opts) => `<div class="grid">${items.map((x) => card(x, type, opts)).join('')}</div>`;

export function row({ eyebrow, title, items, type, badge, more }) {
  if (!items?.length) return '';
  return `<section class="section">
    <div class="section-head">
      <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2></div>
      <div class="section-tools">
        ${more ? `<a class="text-link" href="${esc(more)}">See all →</a>` : ''}
        <button class="scroll-btn" type="button" data-scroll="-1" aria-label="Scroll left">‹</button>
        <button class="scroll-btn" type="button" data-scroll="1" aria-label="Scroll right">›</button>
      </div>
    </div>
    <div class="row" tabindex="-1">${items.map((x) => card(x, type, { badge })).join('')}</div>
  </section>`;
}

export const skeletonRow = (n = 8) =>
  `<div class="row skeleton-row" aria-hidden="true">${'<div class="card"><div class="poster-wrap shimmer"></div><div class="line shimmer"></div><div class="line short shimmer"></div></div>'.repeat(n)}</div>`;

export const skeletonGrid = (n = 12) =>
  `<div class="grid skeleton-row" aria-hidden="true">${'<div class="card"><div class="poster-wrap shimmer"></div><div class="line shimmer"></div></div>'.repeat(n)}</div>`;

export const emptyState = ({ title, text, action }) =>
  `<div class="state empty"><div class="state-icon" aria-hidden="true">◌</div><h3>${esc(title)}</h3><p>${esc(text || '')}</p>${action || ''}</div>`;

export const errorState = (message = 'Something went wrong.') =>
  `<div class="state error" role="alert"><div class="state-icon" aria-hidden="true">!</div><h3>Couldn’t load this</h3><p>${esc(message)}</p><button class="btn ghost" type="button" data-retry>Try again</button></div>`;

// After a save/unsave, sync every visible button for that title.
export function syncSaveButtons() {
  document.querySelectorAll('[data-save]').forEach((b) => {
    const saved = watchlist.keys.has(wlKey(b.dataset.type, b.dataset.id));
    b.classList.toggle('is-saved', saved);
    b.setAttribute('aria-pressed', String(saved));
    if (b.classList.contains('card-save')) b.textContent = saved ? '✓' : '+';
    else b.textContent = saved ? '✓ In My List' : '＋ My List';
  });
}
