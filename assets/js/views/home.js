import { tmdb } from '../lib/api.js';
import { sb } from '../lib/env.js';
import { state } from '../lib/auth.js';
import { recentHistory, ensureWatchlistKeys } from '../lib/data.js';
import { esc, img, yearOf, today } from '../lib/util.js';
import { row, skeletonRow, errorState } from '../ui.js';

const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));

export async function render(root, ctx) {
  root.innerHTML = `
    <section class="hero" id="hero" aria-label="Featured titles"><div class="hero-loading shimmer"></div></section>
    <div id="home-rows">${['Trending now', 'Latest releases', 'Popular series', 'Anime spotlight'].map(() => `<section class="section"><div class="section-head"><div><h2 class="shimmer-text">&nbsp;</h2></div></div>${skeletonRow(7)}</section>`).join('')}</div>`;

  const t = today();
  const [trending, latest, series, anime, top, picks] = await Promise.all([
    settle(tmdb('/trending/all/week')),
    settle(tmdb('/movie/now_playing', { region: 'US' })),
    settle(tmdb('/tv/popular')),
    settle(tmdb('/discover/tv', { with_genres: 16, with_original_language: 'ja', sort_by: 'popularity.desc' })),
    settle(tmdb('/movie/top_rated')),
    sb ? settle(sb.from('catalog').select('tmdb_id,media_type,title,poster_path,vote_average,release_date,is_featured').eq('is_published', true).order('is_featured', { ascending: false }).order('created_at', { ascending: false }).limit(20)) : Promise.resolve({ value: { data: [] } }),
  ]);
  if (ctx.stale()) return;

  if (trending.error && latest.error && series.error) {
    root.innerHTML = `<div class="page">${errorState(trending.error.message)}</div>`;
    return;
  }

  const trendItems = (trending.value?.results || []).filter((x) => x.media_type !== 'person');
  const cleanup = buildHero(root.querySelector('#hero'), trendItems.filter((x) => x.backdrop_path).slice(0, 6));

  await ensureWatchlistKeys();
  if (ctx.stale()) return;

  let cont = '';
  if (state.user && sb) {
    try {
      const hist = (await recentHistory(30)).filter((h) => !h.completed || h.media_type === 'tv');
      const seen = new Set();
      const items = [];
      for (const h of hist) {
        const k = `${h.media_type}:${h.tmdb_id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        items.push({ tmdb_id: h.tmdb_id, media_type: h.media_type, title: h.title, poster_path: h.poster_path });
      }
      cont = row({ eyebrow: 'PICK UP WHERE YOU LEFT OFF', title: 'Continue watching', items: items.slice(0, 15), more: '#/history' });
    } catch { /* optional row */ }
  }

  const pickItems = picks.value?.data || [];
  const parts = [
    cont,
    row({ eyebrow: 'HANDPICKED', title: 'CineOtaku Picks', items: pickItems, badge: 'Pick' }),
    trending.value ? row({ eyebrow: "WHAT'S HOT", title: 'Trending this week', items: trendItems }) : '',
    latest.value ? row({ eyebrow: 'IN THEATRES', title: 'Latest movie releases', items: latest.value.results, type: 'movie', more: '#/movies?sort=latest' }) : '',
    series.value ? row({ eyebrow: 'BINGE-WORTHY', title: 'Popular series', items: series.value.results, type: 'tv', more: '#/tv' }) : '',
    anime.value ? row({ eyebrow: 'ANIMATION, REIMAGINED', title: 'Anime spotlight', items: anime.value.results, type: 'tv', more: '#/anime' }) : '',
    top.value ? row({ eyebrow: 'ALL-TIME GREATS', title: 'Top rated movies', items: top.value.results, type: 'movie', more: '#/movies?sort=rating' }) : '',
  ].filter(Boolean);
  const failed = [trending, latest, series, anime, top].filter((x) => x.error).length;
  root.querySelector('#home-rows').innerHTML = parts.join('') + (failed ? `<div class="notice">Some sections could not be loaded right now. <button class="text-link" type="button" data-retry>Retry</button></div>` : '');
  return cleanup;
}

function buildHero(el, items) {
  if (!items.length) { el.remove(); return () => {}; }
  el.innerHTML = `
    ${items.map((x, i) => `<div class="hero-slide${i === 0 ? ' active' : ''}" data-i="${i}">
      <img class="hero-img" src="${img(x.backdrop_path, 'w1280')}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
      <div class="hero-shade"></div>
      <div class="hero-copy">
        <p class="eyebrow"><span class="live-dot"></span> ${x.media_type === 'tv' ? 'TRENDING SERIES' : 'TRENDING MOVIE'}</p>
        <h1>${esc(x.title || x.name)}</h1>
        <p class="hero-meta">${[yearOf(x.release_date || x.first_air_date), x.vote_average ? `★ ${Number(x.vote_average).toFixed(1)}` : ''].filter(Boolean).join(' · ')}</p>
        <p class="hero-desc">${esc((x.overview || '').slice(0, 220))}${(x.overview || '').length > 220 ? '…' : ''}</p>
        <div class="hero-actions"><a class="btn primary" href="#/title/${x.media_type}/${x.id}">View details</a><a class="btn ghost" href="#/${x.media_type === 'tv' ? 'tv' : 'movies'}">Browse ${x.media_type === 'tv' ? 'series' : 'movies'}</a></div>
      </div>
    </div>`).join('')}
    <div class="hero-dots" role="tablist" aria-label="Choose featured title">${items.map((_, i) => `<button type="button" role="tab" class="${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Show title ${i + 1}"></button>`).join('')}</div>`;
  let cur = 0, timer;
  const show = (i) => {
    cur = (i + items.length) % items.length;
    el.querySelectorAll('.hero-slide').forEach((s, k) => s.classList.toggle('active', k === cur));
    el.querySelectorAll('[data-dot]').forEach((d, k) => d.classList.toggle('active', k === cur));
  };
  const start = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setInterval(() => show(cur + 1), 7000);
  };
  const onClick = (e) => { const d = e.target.closest('[data-dot]'); if (d) { clearInterval(timer); show(Number(d.dataset.dot)); start(); } };
  el.addEventListener('click', onClick);
  start();
  return () => { clearInterval(timer); el.removeEventListener('click', onClick); };
}

