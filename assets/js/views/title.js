import { tmdb } from '../lib/api.js';
import { sb } from '../lib/env.js';
import { state } from '../lib/auth.js';
import { watchlist, wlKey, ensureWatchlistKeys, toggleWatchlist, titleHistory, setCompleted, setManyCompleted, markStarted } from '../lib/data.js';
import { esc, img, yearOf, fmtDate, fmtRuntime, today, toast, needSignIn } from '../lib/util.js';
import { row, errorState, syncSaveButtons } from '../ui.js';
import { openSources, openTrailer } from '../player.js';

async function loadSources(type, id) {
  if (!sb) return [];
  try {
    const { data: cat } = await sb.from('catalog').select('id').eq('tmdb_id', id).eq('media_type', type).maybeSingle();
    if (!cat) return [];
    const { data, error } = await sb.from('stream_sources')
      .select('id,provider_name,url,link_type,quality,language,region,episode:episodes(episode_number,season:seasons(season_number))')
      .eq('catalog_id', cat.id).eq('is_active', true).order('sort_order').order('id');
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('sources', e); return []; }
}

export async function render(root, ctx) {
  const [type, idStr] = ctx.params;
  const id = Number(idStr);
  root.innerHTML = '<div class="title-page"><div class="title-backdrop shimmer"></div><div class="title-wrap"><div class="title-poster shimmer"></div><div class="title-info"><div class="line shimmer big"></div><div class="line shimmer"></div><div class="line shimmer short"></div></div></div></div>';

  let d;
  try {
    d = await tmdb(`/${type}/${id}`, { append_to_response: 'credits,videos,recommendations' });
  } catch (e) {
    if (!ctx.stale()) root.innerHTML = `<div class="page">${errorState(e.message === 'Unsupported TMDb endpoint' ? 'Title not found.' : e.message)}</div>`;
    return;
  }
  const [sources, hist] = await Promise.all([loadSources(type, id), titleHistory(id, type).catch(() => []), ensureWatchlistKeys()]);
  if (ctx.stale()) return;

  const title = d.title || d.name || 'Untitled';
  document.title = `${title} — CineOtaku`;
  const item = { tmdb_id: id, media_type: type, title, poster_path: d.poster_path };
  const isAnime = (d.genres || []).some((g) => g.id === 16) && d.original_language === 'ja';
  const year = yearOf(d.release_date || d.first_air_date);
  const trailer = (d.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer') || (d.videos?.results || []).find((v) => v.site === 'YouTube');
  const titleSources = sources.filter((s) => !s.episode);
  const epSources = new Map();
  sources.filter((s) => s.episode).forEach((s) => {
    const k = `${s.episode.season?.season_number}x${s.episode.episode_number}`;
    epSources.set(k, [...(epSources.get(k) || []), s]);
  });

  const histMap = new Map(hist.map((h) => [`${h.season_number}x${h.episode_number}`, h]));
  const meta = [
    d.vote_average ? `★ ${Number(d.vote_average).toFixed(1)}` : '',
    type === 'movie' ? fmtRuntime(d.runtime) : (d.number_of_seasons ? `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}` : ''),
    d.status || '',
    d.release_date ? fmtDate(d.release_date) : '',
  ].filter(Boolean);
  const saved = watchlist.keys.has(wlKey(type, id));
  const movieDone = type === 'movie' && histMap.get('0x0')?.completed;

  root.innerHTML = `<div class="title-page">
    <div class="title-backdrop">${d.backdrop_path ? `<img src="${img(d.backdrop_path, 'w1280')}" alt="">` : ''}<div class="title-shade"></div></div>
    <div class="title-wrap">
      <img class="title-poster" src="${img(d.poster_path, 'w500')}" alt="Poster of ${esc(title)}">
      <div class="title-info">
        <p class="eyebrow">${isAnime ? 'ANIME' : type === 'tv' ? 'SERIES' : 'MOVIE'}${year ? ` · ${year}` : ''}</p>
        <h1>${esc(title)}</h1>
        ${d.tagline ? `<p class="tagline">${esc(d.tagline)}</p>` : ''}
        <p class="meta-line">${meta.map(esc).join('<span class="dot">•</span>')}</p>
        <div class="chips static">${(d.genres || []).map((g) => `<a class="chip" href="#/${type === 'tv' ? 'tv' : 'movies'}?genre=${g.id}">${esc(g.name)}</a>`).join('')}</div>
        <p class="overview">${esc(d.overview || 'No synopsis available.')}</p>
        <div class="actions">
          ${titleSources.length ? '<button class="btn primary" type="button" id="watch-btn">▶ Watch now</button>' : ''}
          ${trailer ? '<button class="btn ghost" type="button" id="trailer-btn">Trailer</button>' : ''}
          <button class="btn ghost" type="button" id="list-btn" data-save data-id="${id}" data-type="${type}" aria-pressed="${saved}">${saved ? '✓ In My List' : '＋ My List'}</button>
          ${type === 'movie' ? `<button class="btn ghost" type="button" id="done-btn" aria-pressed="${!!movieDone}">${movieDone ? '✓ Watched' : 'Mark as watched'}</button>` : ''}
        </div>
        <div id="provider-note"></div>
        ${(d.credits?.cast || []).length ? `<h3 class="sub">Top cast</h3><ul class="cast">${d.credits.cast.slice(0, 10).map((c) => `<li><img loading="lazy" src="${img(c.profile_path, 'w185')}" alt=""><strong>${esc(c.name)}</strong><small>${esc(c.character || '')}</small></li>`).join('')}</ul>` : ''}
      </div>
    </div>
    ${type === 'tv' ? '<section class="section" id="episodes"></section>' : ''}
    <div id="recs"></div>
  </div>`;

  // Honest provider status: never show a fake play button.
  const note = root.querySelector('#provider-note');
  if (!sources.length) note.innerHTML = '<p class="notice subtle">No authorised streaming link has been added for this title yet. You can still save it to your list and track it.</p>';
  else if (type === 'tv' && !titleSources.length) note.innerHTML = '<p class="notice subtle">Provider links are available for individual episodes below.</p>';

  const syncList = () => syncSaveButtons();
  root.querySelector('#trailer-btn')?.addEventListener('click', () => openTrailer(trailer.key, title));
  root.querySelector('#list-btn').addEventListener('click', async () => {
    if (!state.user) return needSignIn('Sign in to save titles to your list.');
    try { const on = await toggleWatchlist(item); toast(on ? 'Added to My List.' : 'Removed from My List.'); syncList(); }
    catch (e) { toast(e.message || 'Could not update list.', 'error'); }
  });

  if (type === 'movie') {
    let done = !!movieDone;
    const btn = root.querySelector('#done-btn');
    btn.addEventListener('click', async () => {
      if (!state.user) return needSignIn('Sign in to track what you watch.');
      try { done = !done; await setCompleted(item, 0, 0, done); btn.textContent = done ? '✓ Watched' : 'Mark as watched'; btn.setAttribute('aria-pressed', String(done)); }
      catch (e) { done = !done; toast(e.message || 'Could not save.', 'error'); }
    });
    root.querySelector('#watch-btn')?.addEventListener('click', () => openSources({
      title, subtitle: [year, 'Movie'].filter(Boolean).join(' · '), sources: titleSources,
      onStart: () => state.user && markStarted(item),
      onWatched: state.user ? async () => { await setCompleted(item, 0, 0, true); done = true; btn.textContent = '✓ Watched'; } : null,
    }));
  } else {
    root.querySelector('#watch-btn')?.addEventListener('click', () => openSources({
      title, subtitle: 'Series', sources: titleSources, onStart: null, onWatched: null,
    }));
    setupEpisodes(root.querySelector('#episodes'), { d, item, id, histMap, epSources, titleSources, ctx });
  }

  const recs = (d.recommendations?.results || []).filter((x) => x.poster_path);
  root.querySelector('#recs').innerHTML = row({ eyebrow: 'YOU MIGHT ALSO LIKE', title: 'More like this', items: recs.map((x) => ({ ...x, media_type: type })), type });
}

function setupEpisodes(sec, { d, item, id, histMap, epSources, titleSources, ctx }) {
  const seasons = (d.seasons || []).filter((s) => s.season_number >= 0 && (s.episode_count || 0) > 0);
  if (!seasons.length) { sec.innerHTML = '<div class="section-head"><h2>Episodes</h2></div><p class="muted">No episode information is available yet.</p>'; return; }
  const totalEpisodes = d.number_of_episodes || seasons.filter((s) => s.season_number > 0).reduce((n, s) => n + s.episode_count, 0);

  // Prefer the season of the most recently watched episode.
  const last = [...histMap.values()].filter((h) => h.season_number > 0).sort((a, b) => b.last_watched_at.localeCompare(a.last_watched_at))[0];
  let current = last && seasons.some((s) => s.season_number === last.season_number) ? last.season_number : (seasons.find((s) => s.season_number > 0) || seasons[0]).season_number;
  let loaded = [];

  sec.innerHTML = `<div class="section-head"><div><p class="eyebrow">TRACK YOUR PROGRESS</p><h2>Episodes</h2></div>
      <div class="ep-tools"><label class="sr-only" for="season-select">Season</label><select id="season-select">${seasons.map((s) => `<option value="${s.season_number}"${s.season_number === current ? ' selected' : ''}>${esc(s.season_number === 0 ? 'Specials' : s.name || `Season ${s.season_number}`)}</option>`).join('')}</select>
      <button class="btn ghost small" type="button" id="season-all">Mark season watched</button></div></div>
    <div class="progress-line" id="series-progress"></div>
    <div id="ep-list" class="ep-list" aria-live="polite"></div>`;

  const list = sec.querySelector('#ep-list');
  const bar = sec.querySelector('#series-progress');
  const key = (s, e) => `${s}x${e}`;
  const doneCount = () => [...histMap.values()].filter((h) => h.completed && h.season_number > 0).length;
  const paintProgress = () => {
    const done = Math.min(doneCount(), totalEpisodes || doneCount());
    const lastTxt = last ? ` · Last watched S${last.season_number} E${last.episode_number}` : '';
    bar.innerHTML = state.user
      ? `<progress max="${totalEpisodes || 1}" value="${done}"></progress><span>${done} / ${totalEpisodes || '?'} episodes watched${esc(lastTxt)}</span>`
      : '<span class="muted">Sign in to track watched episodes across devices.</span>';
  };
  const allBtn = sec.querySelector('#season-all');
  const aired = () => loaded.filter((e) => !e.air_date || e.air_date <= today());
  const paintAllBtn = () => {
    const a = aired();
    const every = a.length && a.every((e) => histMap.get(key(current, e.episode_number))?.completed);
    allBtn.textContent = every ? 'Unmark season' : 'Mark season watched';
    allBtn.dataset.state = every ? 'all' : 'some';
  };

  async function loadSeason(n) {
    current = n;
    list.innerHTML = '<div class="grid skeleton-row"><div class="line shimmer big"></div><div class="line shimmer big"></div><div class="line shimmer big"></div></div>';
    try {
      const s = await tmdb(`/tv/${id}/season/${n}`);
      if (ctx.stale()) return;
      loaded = s.episodes || [];
      paintEpisodes();
    } catch (e) { if (!ctx.stale()) list.innerHTML = errorState(e.message); }
  }

  function epSourcesFor(n) { return epSources.get(key(current, n)) || []; }

  function paintEpisodes() {
    if (!loaded.length) { list.innerHTML = '<p class="muted">No episodes listed for this season yet.</p>'; return; }
    list.innerHTML = loaded.map((e) => {
      const h = histMap.get(key(current, e.episode_number));
      const done = !!h?.completed;
      const hasSrc = epSourcesFor(e.episode_number).length || titleSources.length;
      const unaired = e.air_date && e.air_date > today();
      return `<article class="episode${done ? ' done' : ''}" data-ep="${e.episode_number}">
        <div class="ep-still"><img loading="lazy" src="${img(e.still_path, 'w300')}" alt=""></div>
        <div class="ep-body">
          <h4><span class="ep-num">E${e.episode_number}</span> ${esc(e.name || `Episode ${e.episode_number}`)}${h && !done ? ' <span class="pill">Started</span>' : ''}${unaired ? ' <span class="pill muted-pill">Upcoming</span>' : ''}</h4>
          <p class="ep-meta">${esc([fmtDate(e.air_date), e.runtime ? `${e.runtime} min` : ''].filter(Boolean).join(' · '))}</p>
          <p class="ep-overview">${esc(e.overview || '')}</p>
        </div>
        <div class="ep-actions">
          ${hasSrc && !unaired ? `<button class="btn primary small" type="button" data-ep-watch="${e.episode_number}">▶ Watch</button>` : ''}
          <button class="check${done ? ' on' : ''}" type="button" data-ep-toggle="${e.episode_number}" aria-pressed="${done}" aria-label="${done ? 'Mark as not watched' : 'Mark as watched'}: episode ${e.episode_number}">✓</button>
        </div>
      </article>`;
    }).join('');
    paintProgress();
    paintAllBtn();
  }

  const epOf = (n) => loaded.find((e) => e.episode_number === n);

  list.addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-ep-toggle]');
    const w = e.target.closest('[data-ep-watch]');
    if (tog) {
      if (!state.user) return needSignIn('Sign in to track watched episodes.');
      const n = Number(tog.dataset.epToggle);
      const k = key(current, n);
      const was = !!histMap.get(k)?.completed;
      const ep = epOf(n);
      histMap.set(k, { ...(histMap.get(k) || {}), season_number: current, episode_number: n, completed: !was, last_watched_at: new Date().toISOString() });
      paintEpisodes();
      try { await setCompleted(item, current, n, !was, ep?.name); }
      catch (err) { histMap.set(k, { ...(histMap.get(k) || {}), completed: was }); paintEpisodes(); toast(err.message || 'Could not save.', 'error'); }
    } else if (w) {
      const n = Number(w.dataset.epWatch);
      const ep = epOf(n);
      const specific = epSourcesFor(n);
      const k = key(current, n);
      openSources({
        title: `${item.title} — S${current} E${n}`,
        subtitle: ep?.name || '',
        sources: specific.length ? specific : titleSources,
        onStart: () => state.user && markStarted(item, current, n, ep?.name).then(() => {
          if (!histMap.has(k)) { histMap.set(k, { season_number: current, episode_number: n, completed: false, last_watched_at: new Date().toISOString() }); paintEpisodes(); }
        }),
        onWatched: state.user ? async () => { await setCompleted(item, current, n, true, ep?.name); histMap.set(k, { ...(histMap.get(k) || {}), season_number: current, episode_number: n, completed: true }); paintEpisodes(); } : null,
      });
    }
  });

  allBtn.addEventListener('click', async () => {
    if (!state.user) return needSignIn('Sign in to track watched episodes.');
    const target = allBtn.dataset.state !== 'all';
    const eps = aired();
    const snapshot = new Map(eps.map((e) => [key(current, e.episode_number), histMap.get(key(current, e.episode_number))]));
    eps.forEach((e) => histMap.set(key(current, e.episode_number), { ...(histMap.get(key(current, e.episode_number)) || {}), season_number: current, episode_number: e.episode_number, completed: target, last_watched_at: new Date().toISOString() }));
    paintEpisodes();
    try { await setManyCompleted(item, current, eps, target); }
    catch (err) { snapshot.forEach((v, k) => (v ? histMap.set(k, v) : histMap.delete(k))); paintEpisodes(); toast(err.message || 'Could not save.', 'error'); }
  });

  sec.querySelector('#season-select').addEventListener('change', (e) => loadSeason(Number(e.target.value)));
  paintProgress();
  loadSeason(current);
}
