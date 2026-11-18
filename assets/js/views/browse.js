import { tmdb, genres } from '../lib/api.js';
import { esc, today } from '../lib/util.js';
import { grid, card, skeletonGrid, emptyState, errorState } from '../ui.js';
import { ensureWatchlistKeys } from '../lib/data.js';

const TITLES = { movies: 'Movies', tv: 'TV Series', anime: 'Anime' };
const SORTS = {
  popular: 'Most popular',
  rating: 'Top rated',
  latest: 'Latest releases',
  oldest: 'Oldest first',
};

function buildParams(kind, type, q) {
  const sort = q.get('sort') || 'popular';
  const p = { page: 1 };
  const dateKey = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  if (sort === 'rating') { p.sort_by = 'vote_average.desc'; p['vote_count.gte'] = type === 'tv' ? 150 : 400; }
  else if (sort === 'latest') { p.sort_by = `${dateKey}.desc`; p[`${dateKey}.lte`] = today(); p['vote_count.gte'] = 5; }
  else if (sort === 'oldest') { p.sort_by = `${dateKey}.asc`; p['vote_count.gte'] = 100; }
  else p.sort_by = 'popularity.desc';

  let genre = q.get('genre') || '';
  if (kind === 'anime') {
    p.with_original_language = 'ja';
    genre = ['16', ...genre.split(',').filter((g) => g && g !== '16')].join(',');
  }
  if (genre) p.with_genres = genre;
  const year = q.get('year');
  if (/^\d{4}$/.test(year || '')) p[type === 'tv' ? 'first_air_date_year' : 'primary_release_year'] = year;
  return p;
}

export async function render(root, ctx) {
  const kind = ctx.params[0]; // movies | tv | anime
  const q = ctx.query;
  const type = kind === 'anime' ? (q.get('type') === 'movie' ? 'movie' : 'tv') : kind === 'movies' ? 'movie' : 'tv';
  const sort = q.get('sort') || 'popular';
  const genre = q.get('genre') || '';
  const year = q.get('year') || '';

  const years = Array.from({ length: 40 }, (_, i) => new Date().getFullYear() + 1 - i);
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><p class="eyebrow">${kind === 'anime' ? 'ANIMATION' : 'BROWSE'}</p><h1 class="page-title">${TITLES[kind]}</h1></div></div>
    <form class="filters" id="filters" aria-label="Filters">
      ${kind === 'anime' ? `<label>Format<select name="type"><option value="tv"${type === 'tv' ? ' selected' : ''}>Series</option><option value="movie"${type === 'movie' ? ' selected' : ''}>Movies</option></select></label>` : ''}
      <label>Sort<select name="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Year<select name="year"><option value="">Any year</option>${years.map((y) => `<option${String(y) === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
    </form>
    <div class="chips" id="genre-chips" role="group" aria-label="Genres"></div>
    <div id="results">${skeletonGrid(12)}</div>
    <div class="load-more" id="more-wrap"></div>
  </div>`;

  // Genre chips (anime excludes the implicit "Animation" chip).
  genres(type).then((list) => {
    if (ctx.stale()) return;
    const sel = new Set(genre.split(',').filter(Boolean));
    const chips = list.filter((g) => !(kind === 'anime' && g.id === 16));
    const box = root.querySelector('#genre-chips');
    if (!box) return;
    box.innerHTML = `<button type="button" class="chip${sel.size ? '' : ' active'}" data-genre="">All</button>` +
      chips.map((g) => `<button type="button" class="chip${sel.has(String(g.id)) ? ' active' : ''}" data-genre="${g.id}">${esc(g.name)}</button>`).join('');
  }).catch(() => {});

  const apply = (patch) => {
    const n = new URLSearchParams(q);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    const qs = n.toString();
    location.hash = `#/${kind}${qs ? `?${qs}` : ''}`;
  };
  const form = root.querySelector('#filters');
  form.addEventListener('change', (e) => { const el = e.target; apply({ [el.name]: el.value, ...(el.name === 'type' ? { genre: '' } : {}) }); });
  root.querySelector('#genre-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-genre]'); if (b) apply({ genre: b.dataset.genre }); });

  const base = buildParams(kind, type, q);
  const endpoint = `/discover/${type}`;
  let page = 1, totalPages = 1;
  const results = root.querySelector('#results');
  const moreWrap = root.querySelector('#more-wrap');

  async function load(first) {
    try {
      const d = await tmdb(endpoint, { ...base, page });
      if (ctx.stale()) return;
      totalPages = Math.min(d.total_pages || 1, 500);
      const items = d.results || [];
      await ensureWatchlistKeys();
      if (first) {
        results.innerHTML = items.length ? grid(items, type) : emptyState({ title: 'No titles match', text: 'Try removing a filter or choosing a different genre.' });
      } else {
        results.querySelector('.grid')?.insertAdjacentHTML('beforeend', items.map((x) => card(x, type)).join(''));
      }
      moreWrap.innerHTML = page < totalPages && items.length ? '<button class="btn ghost" type="button" id="more-btn">Load more</button>' : '';
    } catch (e) {
      if (ctx.stale()) return;
      if (first) results.innerHTML = errorState(e.message);
      else { page -= 1; moreWrap.innerHTML = '<p class="muted">Could not load more. </p><button class="btn ghost" type="button" id="more-btn">Retry</button>'; }
    }
  }
  moreWrap.addEventListener('click', (e) => {
    const b = e.target.closest('#more-btn');
    if (!b) return;
    b.disabled = true; b.textContent = 'Loading…';
    page += 1; load(false);
  });
  await load(true);
}

// Search view (movies + series), also used by the header search box.
export async function renderSearch(root, ctx) {
  const query = (ctx.query.get('q') || '').trim();
  root.innerHTML = `<div class="page"><div class="page-head"><div><p class="eyebrow">SEARCH</p><h1 class="page-title">${query ? `Results for “${esc(query)}”` : 'Search'}</h1></div></div>
    <form class="searchbar" id="page-search" role="search"><input type="search" name="q" value="${esc(query)}" placeholder="Search movies, series, anime…" autocomplete="off" maxlength="100" aria-label="Search"><button class="btn primary" type="submit">Search</button></form>
    <div class="tabs" id="search-tabs" role="tablist"><button type="button" class="tab active" data-f="all">All</button><button type="button" class="tab" data-f="movie">Movies</button><button type="button" class="tab" data-f="tv">Series</button><button type="button" class="tab" data-f="anime">Anime</button></div>
    <div id="results"></div></div>`;
  const input = root.querySelector('input');
  root.querySelector('#page-search').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) location.hash = `#/search?q=${encodeURIComponent(v)}`; });
  if (!query) { root.querySelector('#results').innerHTML = emptyState({ title: 'Find something to watch', text: 'Type a movie, series or anime title above.' }); root.querySelector('#search-tabs').remove(); input.focus(); return; }
  const results = root.querySelector('#results');
  results.innerHTML = skeletonGrid(12);
  try {
    const [m, t] = await Promise.all([tmdb('/search/movie', { query }), tmdb('/search/tv', { query })]);
    if (ctx.stale()) return;
    const all = [...(m.results || []).map((x) => ({ ...x, media_type: 'movie' })), ...(t.results || []).map((x) => ({ ...x, media_type: 'tv' }))]
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    await ensureWatchlistKeys();
    const show = (f) => {
      const list = all.filter((x) => f === 'all' || (f === 'anime' ? x.genre_ids?.includes(16) && x.original_language === 'ja' : x.media_type === f));
      results.innerHTML = list.length ? grid(list) : emptyState({ title: 'No results', text: `Nothing found for “${query}”${f !== 'all' ? ' in this filter' : ''}. Check the spelling or try another title.` });
    };
    show('all');
    root.querySelector('#search-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      show(b.dataset.f);
    });
  } catch (e) { if (!ctx.stale()) results.innerHTML = errorState(e.message); }
}

