// CineOtaku admin dashboard.
// SECURITY: this page only *displays* data. Every write is authorised by Postgres RLS via
// public.is_admin(); a non-admin who bypasses this UI is rejected by the database.
import { sb, configured, config } from './lib/env.js';
import { $, $$, esc, img, toast, safeHttpsUrl, yearOf } from './lib/util.js';
import { tmdb } from './lib/api.js';

let user = null;
let catalog = [];
let sources = [];
let seasonsState = { catalogId: null, seasons: [] };

const dlg = $('#edit-dialog');
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
const setMsg = (sel, text, ok = false) => { const el = $(sel); el.textContent = text || ''; el.className = `status ${text ? (ok ? 'ok' : 'bad') : ''}`; };
const blank = (v) => (v === '' || v === undefined ? null : v);
const errText = (e) => (e?.message || 'Request failed').replace(/row-level security policy/i, 'permission denied (row-level security)');
const show = (id) => ['#gate-login', '#gate-denied', '#dash'].forEach((s) => $(s).classList.toggle('hidden', s !== id));

// ---------------------------------------------------------------- gate
async function gate() {
  if (!configured) {
    $('#config-msg').classList.remove('hidden');
    $('#config-msg').textContent = config.misconfigured
      ? 'A secret key was set as the public key and was blocked. Use the publishable/anon key.'
      : 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel.';
    show('');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user || null;
  $('#signout-btn').classList.toggle('hidden', !user);
  if (!user) { show('#gate-login'); return; }
  // Server-side check: the is_admin() function reads profiles.role inside Postgres.
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || isAdmin !== true) {
    $('#denied-text').textContent = `Signed in as ${user.email}, but this account does not have the admin role.`;
    show('#gate-denied');
    return;
  }
  const { data: prof } = await sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  $('#welcome').textContent = `Signed in as ${prof?.display_name || user.email}. Changes apply to the live site immediately.`;
  show('#dash');
  await refreshAll();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return;
  setMsg('#login-msg', 'Signing in…', true);
  const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
  if (error) { setMsg('#login-msg', error.message); return; }
  setMsg('#login-msg', '');
  await gate();
});
const doSignOut = async () => { await sb.auth.signOut(); user = null; await gate(); };
$('#signout-btn').addEventListener('click', doSignOut);
$('#denied-signout').addEventListener('click', doSignOut);

// ---------------------------------------------------------------- tabs
$('#admin-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  $$('#admin-tabs .tab').forEach((t) => { const on = t === b; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
  $$('.tabpanel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  if (b.dataset.tab === 'seasons') loadSeasons();
});

// ---------------------------------------------------------------- generic edit dialog
function editDialog({ title, fields, submitLabel = 'Save', onSubmit }) {
  const f = (x) => {
    const v = x.value ?? '';
    const common = `name="${x.name}"${x.required ? ' required' : ''}`;
    if (x.type === 'checkbox') return `<label class="checkline"><input type="checkbox" ${common}${x.value ? ' checked' : ''}> ${esc(x.label)}</label>`;
    if (x.type === 'textarea') return `<label class="wide">${esc(x.label)}<textarea ${common}>${esc(v)}</textarea></label>`;
    if (x.type === 'select') return `<label>${esc(x.label)}<select ${common}>${x.options.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select></label>`;
    return `<label${x.wide ? ' class="wide"' : ''}>${esc(x.label)}<input type="${x.type || 'text'}" ${common} value="${esc(v)}"${x.max ? ` maxlength="${x.max}"` : ''}${x.type === 'number' ? ' step="1"' : ''}></label>`;
  };
  $('#edit-body').innerHTML = `<h2>${esc(title)}</h2><form class="edit-form" id="edit-form">${fields.map(f).join('')}<div class="wide"><button class="btn primary" type="submit">${esc(submitLabel)}</button> <span class="status" id="edit-msg" role="status"></span></div></form>`;
  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = {};
    fields.forEach((x) => { values[x.name] = x.type === 'checkbox' ? fd.get(x.name) === 'on' : String(fd.get(x.name) ?? '').trim(); });
    const btn = e.submitter; btn.disabled = true;
    try { await onSubmit(values); dlg.close(); }
    catch (err) { $('#edit-msg').textContent = errText(err); $('#edit-msg').className = 'status bad'; }
    btn.disabled = false;
  });
  dlg.showModal();
}

// ---------------------------------------------------------------- data loading
async function refreshAll() {
  await Promise.all([loadCatalog(), loadSources()]);
  paintStats();
}

async function loadCatalog() {
  const { data, error } = await sb.from('catalog').select('*').order('created_at', { ascending: false });
  if (error) { $('#catalog-table').innerHTML = `<p class="status bad">${esc(errText(error))}</p>`; return; }
  catalog = data || [];
  paintCatalog();
  fillTitleSelects();
}

function fillTitleSelects() {
  const opts = (list) => list.map((c) => `<option value="${c.id}">${esc(c.title)} (${c.media_type === 'tv' ? 'series' : 'movie'}${c.release_date ? `, ${yearOf(c.release_date)}` : ''})</option>`).join('');
  const keep = (sel, html, first = '') => { const el = $(sel); const cur = el.value; el.innerHTML = first + html; if ([...el.options].some((o) => o.value === cur)) el.value = cur; };
  keep('#src-title', opts(catalog), catalog.length ? '' : '<option value="">Add a catalog title first</option>');
  keep('#src-filter', opts(catalog), '<option value="">All titles</option>');
  const tv = catalog.filter((c) => c.media_type === 'tv');
  keep('#se-title', opts(tv), tv.length ? '' : '<option value="">No series in catalog</option>');
  fillScope();
}

function paintStats() {
  const cards = [
    [catalog.length, 'Catalog titles'],
    [catalog.filter((c) => c.is_published).length, 'Published'],
    [catalog.filter((c) => c.is_featured).length, 'Featured'],
    [catalog.filter((c) => c.media_type === 'tv').length, 'Series'],
    [sources.length, 'Provider links'],
    [sources.filter((s) => s.is_active).length, 'Active links'],
  ];
  $('#stats').innerHTML = cards.map(([n, l]) => `<div class="stat-card"><strong>${n}</strong><span>${l}</span></div>`).join('');
}

// ---------------------------------------------------------------- catalog tab
function paintCatalog() {
  const q = $('#cat-filter').value.trim().toLowerCase();
  const st = $('#cat-status').value;
  const list = catalog.filter((c) => (!q || c.title.toLowerCase().includes(q))
    && (!st || (st === 'published' && c.is_published) || (st === 'draft' && !c.is_published) || (st === 'featured' && c.is_featured)));
  $('#catalog-table').innerHTML = list.length ? `<table><thead><tr><th>Title</th><th>Type</th><th>TMDb</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>${list.map((c) => `<tr>
    <td class="t"><img src="${img(c.poster_path, 'w92')}" alt=""><div><strong>${esc(c.title)}</strong><small>${esc(yearOf(c.release_date))}${c.is_anime ? ' · Anime' : ''}</small></div></td>
    <td>${c.media_type === 'tv' ? 'Series' : 'Movie'}</td><td>#${c.tmdb_id}</td>
    <td>${c.is_published ? '<span class="pill ok">Published</span>' : '<span class="pill">Hidden</span>'} ${c.is_featured ? '<span class="pill">Featured</span>' : ''}</td>
    <td><div class="row-actions">
      <button class="small-btn ${c.is_published ? 'on' : ''}" type="button" data-act="publish" data-id="${c.id}">${c.is_published ? 'Hide' : 'Publish'}</button>
      <button class="small-btn ${c.is_featured ? 'on' : ''}" type="button" data-act="feature" data-id="${c.id}">${c.is_featured ? 'Unfeature' : 'Feature'}</button>
      <button class="small-btn" type="button" data-act="edit" data-id="${c.id}">Edit</button>
      <button class="small-btn danger" type="button" data-act="delete" data-id="${c.id}">Delete</button></div></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No catalog entries match. Use “Add from TMDb” to create one.</p>';
}
$('#cat-filter').addEventListener('input', paintCatalog);
$('#cat-status').addEventListener('change', paintCatalog);
$('#refresh-btn').addEventListener('click', async () => { await refreshAll(); toast('Refreshed.'); });

$('#catalog-table').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const c = catalog.find((x) => String(x.id) === b.dataset.id);
  if (!c) return;
  const act = b.dataset.act;
  try {
    if (act === 'publish' || act === 'feature') {
      const patch = act === 'publish' ? { is_published: !c.is_published } : { is_featured: !c.is_featured };
      const { error } = await sb.from('catalog').update(patch).eq('id', c.id);
      if (error) throw error;
      toast('Catalog updated.'); await loadCatalog(); paintStats();
    } else if (act === 'delete') {
      if (!confirm(`Delete “${c.title}”? Its seasons, episodes and provider links will also be deleted. Users’ watchlists are not affected.`)) return;
      const { error } = await sb.from('catalog').delete().eq('id', c.id);
      if (error) throw error;
      toast('Deleted.'); await refreshAll();
    } else if (act === 'edit') {
      editDialog({
        title: `Edit “${c.title}”`,
        fields: [
          { name: 'title', label: 'Title', value: c.title, required: true, max: 300, wide: true },
          { name: 'original_title', label: 'Original title', value: c.original_title, max: 300 },
          { name: 'release_date', label: 'Release date', type: 'date', value: c.release_date },
          { name: 'poster_path', label: 'Poster path (TMDb)', value: c.poster_path },
          { name: 'backdrop_path', label: 'Backdrop path (TMDb)', value: c.backdrop_path },
          { name: 'overview', label: 'Overview', type: 'textarea', value: c.overview },
          { name: 'is_anime', label: 'Anime', type: 'checkbox', value: c.is_anime },
          { name: 'is_published', label: 'Published (visible on site)', type: 'checkbox', value: c.is_published },
          { name: 'is_featured', label: 'Featured', type: 'checkbox', value: c.is_featured },
        ],
        onSubmit: async (v) => {
          const path = (p) => (p && /^\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(p) ? p : null);
          const { error } = await sb.from('catalog').update({
            title: v.title, original_title: blank(v.original_title), release_date: blank(v.release_date),
            poster_path: path(v.poster_path), backdrop_path: path(v.backdrop_path), overview: blank(v.overview),
            is_anime: v.is_anime, is_published: v.is_published, is_featured: v.is_featured,
          }).eq('id', c.id);
          if (error) throw error;
          toast('Saved.'); await loadCatalog(); paintStats();
        },
      });
    }
  } catch (err) { toast(errText(err), 'error'); }
});

// ---------------------------------------------------------------- add from TMDb
$('#tmdb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('#tmdb-results');
  const kind = $('#tmdb-kind').value;
  box.innerHTML = '<p class="muted">Searching TMDb…</p>';
  setMsg('#add-msg', '');
  try {
    const d = await tmdb(`/search/${kind}`, { query: $('#tmdb-q').value.trim() });
    const items = (d.results || []).slice(0, 15);
    box.innerHTML = items.length ? items.map((x) => {
      const t = x.title || x.name || 'Untitled';
      const exists = catalog.some((c) => c.tmdb_id === x.id && c.media_type === kind);
      return `<div class="result-item"><img src="${img(x.poster_path, 'w92')}" alt=""><div><strong>${esc(t)}</strong><small>${kind === 'tv' ? 'Series' : 'Movie'} · ${esc(yearOf(x.release_date || x.first_air_date) || 'year unknown')} · TMDb #${x.id}</small></div>
        ${exists ? '<span class="pill ok">In catalog</span>' : `<button class="btn primary small" type="button" data-add="${x.id}" data-kind="${kind}">Add</button>`}</div>`;
    }).join('') : '<p class="muted">No matches on TMDb.</p>';
  } catch (err) { box.innerHTML = `<p class="status bad">${esc(errText(err))}</p>`; }
});

$('#tmdb-results').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  b.disabled = true; b.textContent = 'Adding…';
  try {
    const row = await addFromTmdb(b.dataset.kind, Number(b.dataset.add));
    b.replaceWith(Object.assign(document.createElement('span'), { className: 'pill ok', textContent: 'Added' }));
    toast(`“${row.title}” added${$('#add-publish').checked ? ' and published' : ' as hidden draft'}.`);
  } catch (err) { b.disabled = false; b.textContent = 'Add'; setMsg('#add-msg', errText(err)); }
});

async function addFromTmdb(kind, tmdbId) {
  setMsg('#add-msg', 'Fetching details from TMDb…', true);
  const d = await tmdb(`/${kind}/${tmdbId}`);
  const row = {
    tmdb_id: d.id, media_type: kind,
    title: d.title || d.name,
    original_title: d.original_title || d.original_name || null,
    overview: d.overview || null,
    poster_path: d.poster_path || null,
    backdrop_path: d.backdrop_path || null,
    release_date: d.release_date || d.first_air_date || null,
    vote_average: d.vote_average != null ? Math.round(d.vote_average * 10) / 10 : null,
    genres: (d.genres || []).map((g) => ({ id: g.id, name: g.name })),
    is_anime: (d.genres || []).some((g) => g.id === 16) && d.original_language === 'ja',
    is_published: $('#add-publish').checked,
    created_by: user.id,
  };
  // Plain insert: an existing entry fails on the unique key instead of silently overwriting visibility.
  const { data, error } = await sb.from('catalog').insert(row).select().single();
  if (error) throw new Error(error.code === '23505' ? 'This title is already in the catalog.' : error.message);
  if (kind === 'tv' && $('#add-import').checked) {
    const n = await importSeasons(data, d);
    setMsg('#add-msg', `Added. Imported ${n.seasons} season(s) and ${n.episodes} episode(s).`, true);
  } else setMsg('#add-msg', 'Added.', true);
  await loadCatalog(); paintStats();
  return data;
}

// Imports seasons and episodes (metadata only) from TMDb. Safe to re-run: upserts on natural keys.
async function importSeasons(cat, details) {
  const seasons = (details.seasons || []).filter((s) => s.season_number >= 0);
  let eps = 0;
  for (const s of seasons) {
    setMsg('#add-msg', `Importing season ${s.season_number}…`, true);
    setMsg('#se-msg', `Importing season ${s.season_number}…`, true);
    const { data: srow, error } = await sb.from('seasons').upsert({
      catalog_id: cat.id, season_number: s.season_number, name: s.name || null, overview: s.overview || null,
      poster_path: s.poster_path || null, air_date: s.air_date || null, episode_count: s.episode_count ?? null,
    }, { onConflict: 'catalog_id,season_number' }).select('id').single();
    if (error) throw error;
    let full;
    try { full = await tmdb(`/tv/${cat.tmdb_id}/season/${s.season_number}`); } catch { continue; }
    const rows = (full.episodes || []).map((e) => ({
      season_id: srow.id, episode_number: e.episode_number, name: e.name || null, overview: e.overview || null,
      still_path: e.still_path || null, runtime: e.runtime ?? null, air_date: e.air_date || null,
    }));
    if (rows.length) {
      const { error: e2 } = await sb.from('episodes').upsert(rows, { onConflict: 'season_id,episode_number' });
      if (e2) throw e2;
      eps += rows.length;
    }
  }
  return { seasons: seasons.length, episodes: eps };
}

// ---------------------------------------------------------------- seasons & episodes tab
async function loadSeasons() {
  const id = Number($('#se-title').value);
  const box = $('#se-list');
  if (!id) { box.innerHTML = '<p class="muted">Add a series to the catalog first.</p>'; return; }
  box.innerHTML = '<p class="muted">Loading…</p>';
  const { data, error } = await sb.from('seasons').select('*, episodes(*)').eq('catalog_id', id).order('season_number');
  if (error) { box.innerHTML = `<p class="status bad">${esc(errText(error))}</p>`; return; }
  seasonsState = { catalogId: id, seasons: data || [] };
  paintSeasons();
}
$('#se-title').addEventListener('change', loadSeasons);

function paintSeasons() {
  const box = $('#se-list');
  if (!seasonsState.seasons.length) { box.innerHTML = '<p class="muted">No seasons yet. Use “Sync from TMDb” or “Add season”.</p>'; return; }
  box.innerHTML = seasonsState.seasons.map((s) => {
    const eps = [...(s.episodes || [])].sort((a, b) => a.episode_number - b.episode_number);
    return `<article class="season-card"><header>
      <h3>${esc(s.season_number === 0 ? 'Specials' : s.name || `Season ${s.season_number}`)} <small>· S${s.season_number} · ${eps.length} episode(s)</small></h3>
      <div class="row-actions"><button class="small-btn" type="button" data-sact="add-ep" data-sid="${s.id}">Add episode</button><button class="small-btn" type="button" data-sact="edit-season" data-sid="${s.id}">Edit</button><button class="small-btn danger" type="button" data-sact="del-season" data-sid="${s.id}">Delete</button></div></header>
      ${eps.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Air date</th><th>Runtime</th><th>Actions</th></tr></thead><tbody>${eps.map((e) => `<tr><td>${e.episode_number}</td><td>${esc(e.name || '—')}</td><td>${esc(e.air_date || '—')}</td><td>${e.runtime ? `${e.runtime} min` : '—'}</td><td><div class="row-actions"><button class="small-btn" type="button" data-sact="edit-ep" data-sid="${s.id}" data-eid="${e.id}">Edit</button><button class="small-btn danger" type="button" data-sact="del-ep" data-eid="${e.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : ''}
    </article>`;
  }).join('');
}

const seasonFields = (s = {}) => [
  { name: 'season_number', label: 'Season number (0 = specials)', type: 'number', value: s.season_number ?? '', required: true },
  { name: 'name', label: 'Name', value: s.name, max: 200 },
  { name: 'air_date', label: 'Air date', type: 'date', value: s.air_date },
  { name: 'overview', label: 'Overview', type: 'textarea', value: s.overview },
];
const episodeFields = (e = {}) => [
  { name: 'episode_number', label: 'Episode number', type: 'number', value: e.episode_number ?? '', required: true },
  { name: 'name', label: 'Name', value: e.name, max: 300 },
  { name: 'air_date', label: 'Air date', type: 'date', value: e.air_date },
  { name: 'runtime', label: 'Runtime (minutes)', type: 'number', value: e.runtime },
  { name: 'overview', label: 'Overview', type: 'textarea', value: e.overview },
];
const nonNeg = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number ≥ 0.`); return n; };

$('#se-add-season').addEventListener('click', () => {
  if (!seasonsState.catalogId) return setMsg('#se-msg', 'Choose a series first.');
  editDialog({
    title: 'Add season', fields: seasonFields(),
    onSubmit: async (v) => {
      const { error } = await sb.from('seasons').insert({ catalog_id: seasonsState.catalogId, season_number: nonNeg(v.season_number, 'Season number'), name: blank(v.name), air_date: blank(v.air_date), overview: blank(v.overview) });
      if (error) throw new Error(error.code === '23505' ? 'That season already exists.' : error.message);
      await loadSeasons();
    },
  });
});

$('#se-sync').addEventListener('click', async () => {
  const cat = catalog.find((c) => c.id === seasonsState.catalogId || String(c.id) === $('#se-title').value);
  if (!cat) return setMsg('#se-msg', 'Choose a series first.');
  const btn = $('#se-sync'); btn.disabled = true;
  try {
    const d = await tmdb(`/tv/${cat.tmdb_id}`);
    const n = await importSeasons(cat, d);
    setMsg('#se-msg', `Synced ${n.seasons} season(s), ${n.episodes} episode(s) from TMDb.`, true);
    await loadSeasons();
  } catch (err) { setMsg('#se-msg', errText(err)); }
  btn.disabled = false;
});

$('#se-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sact]');
  if (!b) return;
  const s = seasonsState.seasons.find((x) => String(x.id) === b.dataset.sid);
  const ep = s?.episodes?.find((x) => String(x.id) === b.dataset.eid);
  const act = b.dataset.sact;
  try {
    if (act === 'del-season') {
      if (!confirm('Delete this season, its episodes and any episode-specific provider links?')) return;
      const { error } = await sb.from('seasons').delete().eq('id', s.id); if (error) throw error;
      await loadSeasons(); await loadSources(); paintStats();
    } else if (act === 'del-ep') {
      if (!confirm('Delete this episode and its provider links?')) return;
      const { error } = await sb.from('episodes').delete().eq('id', b.dataset.eid); if (error) throw error;
      await loadSeasons(); await loadSources(); paintStats();
    } else if (act === 'edit-season') {
      editDialog({ title: 'Edit season', fields: seasonFields(s), onSubmit: async (v) => {
        const { error } = await sb.from('seasons').update({ season_number: nonNeg(v.season_number, 'Season number'), name: blank(v.name), air_date: blank(v.air_date), overview: blank(v.overview) }).eq('id', s.id);
        if (error) throw error; await loadSeasons();
      } });
    } else if (act === 'add-ep') {
      editDialog({ title: 'Add episode', fields: episodeFields(), onSubmit: async (v) => {
        const { error } = await sb.from('episodes').insert({ season_id: s.id, episode_number: nonNeg(v.episode_number, 'Episode number'), name: blank(v.name), air_date: blank(v.air_date), runtime: v.runtime ? nonNeg(v.runtime, 'Runtime') : null, overview: blank(v.overview) });
        if (error) throw new Error(error.code === '23505' ? 'That episode number already exists in this season.' : error.message);
        await loadSeasons();
      } });
    } else if (act === 'edit-ep') {
      editDialog({ title: 'Edit episode', fields: episodeFields(ep), onSubmit: async (v) => {
        const { error } = await sb.from('episodes').update({ episode_number: nonNeg(v.episode_number, 'Episode number'), name: blank(v.name), air_date: blank(v.air_date), runtime: v.runtime ? nonNeg(v.runtime, 'Runtime') : null, overview: blank(v.overview) }).eq('id', ep.id);
        if (error) throw error; await loadSeasons();
      } });
    }
  } catch (err) { toast(errText(err), 'error'); }
});

// ---------------------------------------------------------------- provider links tab
async function loadSources() {
  const { data, error } = await sb.from('stream_sources')
    .select('*, catalog:catalog(title,media_type), episode:episodes(episode_number, season:seasons(season_number))')
    .order('created_at', { ascending: false });
  if (error) { $('#src-table').innerHTML = `<p class="status bad">${esc(errText(error))}</p>`; return; }
  sources = data || [];
  paintSources();
}

function paintSources() {
  const f = $('#src-filter').value;
  const list = sources.filter((s) => !f || String(s.catalog_id) === f);
  $('#src-table').innerHTML = list.length ? `<table><thead><tr><th>Title</th><th>Scope</th><th>Provider</th><th>URL</th><th>Type</th><th>Info</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map((s) => `<tr>
    <td>${esc(s.catalog?.title || '—')}</td>
    <td>${s.episode ? `S${s.episode.season?.season_number} E${s.episode.episode_number}` : 'Whole title'}</td>
    <td>${esc(s.provider_name)}</td><td class="url" title="${esc(s.url)}">${esc(s.url)}</td>
    <td>${s.link_type === 'embed' ? 'Embed' : 'External'}</td>
    <td>${esc([s.quality, s.language, s.region].filter(Boolean).join(' · ') || '—')}</td>
    <td>${s.is_active ? '<span class="pill ok">Active</span>' : '<span class="pill">Inactive</span>'}</td>
    <td><div class="row-actions"><button class="small-btn ${s.is_active ? 'on' : ''}" type="button" data-sa="toggle" data-id="${s.id}">${s.is_active ? 'Deactivate' : 'Activate'}</button><button class="small-btn" type="button" data-sa="edit" data-id="${s.id}">Edit</button><button class="small-btn danger" type="button" data-sa="delete" data-id="${s.id}">Delete</button></div></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No provider links yet.</p>';
}
$('#src-filter').addEventListener('change', paintSources);

// "Applies to" selector: whole title, or one episode of a series.
async function fillScope() {
  const sel = $('#src-scope');
  const id = Number($('#src-title').value);
  const cat = catalog.find((c) => c.id === id);
  sel.innerHTML = '<option value="">Whole title (movie / series)</option>';
  if (!cat || cat.media_type !== 'tv') return;
  const { data } = await sb.from('seasons').select('season_number, episodes(id,episode_number,name)').eq('catalog_id', id).order('season_number');
  if (Number($('#src-title').value) !== id) return; // user changed selection meanwhile
  (data || []).forEach((s) => {
    [...(s.episodes || [])].sort((a, b) => a.episode_number - b.episode_number).forEach((e) => {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = `S${s.season_number} E${e.episode_number}${e.name ? ` — ${e.name}` : ''}`;
      sel.append(o);
    });
  });
}
$('#src-title').addEventListener('change', fillScope);

$('#src-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = safeHttpsUrl($('#src-url').value);
  if (!url) return setMsg('#src-msg', 'Enter a valid HTTPS URL (no embedded credentials).');
  const catalogId = Number($('#src-title').value);
  if (!catalogId) return setMsg('#src-msg', 'Choose a catalog title.');
  const row = {
    catalog_id: catalogId, episode_id: $('#src-scope').value ? Number($('#src-scope').value) : null,
    provider_name: $('#src-name').value.trim(), url, link_type: $('#src-type').value,
    quality: blank($('#src-quality').value.trim()), language: blank($('#src-lang').value.trim()), region: blank($('#src-region').value.trim()),
    sort_order: parseInt($('#src-sort').value, 10) || 0, is_active: $('#src-active').checked, created_by: user.id,
  };
  const { error } = await sb.from('stream_sources').insert(row);
  if (error) return setMsg('#src-msg', errText(error));
  setMsg('#src-msg', 'Link saved.', true);
  ['#src-name', '#src-url', '#src-quality', '#src-lang', '#src-region'].forEach((s) => { $(s).value = ''; });
  $('#src-auth').checked = false; $('#src-active').checked = false;
  await loadSources(); paintStats();
});

$('#src-table').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sa]');
  if (!b) return;
  const s = sources.find((x) => String(x.id) === b.dataset.id);
  if (!s) return;
  try {
    if (b.dataset.sa === 'toggle') {
      const { error } = await sb.from('stream_sources').update({ is_active: !s.is_active }).eq('id', s.id);
      if (error) throw error; toast(s.is_active ? 'Link deactivated.' : 'Link activated.');
      await loadSources(); paintStats();
    } else if (b.dataset.sa === 'delete') {
      if (!confirm(`Delete the link “${s.provider_name}”?`)) return;
      const { error } = await sb.from('stream_sources').delete().eq('id', s.id);
      if (error) throw error; toast('Link deleted.'); await loadSources(); paintStats();
    } else if (b.dataset.sa === 'edit') {
      editDialog({
        title: 'Edit provider link',
        fields: [
          { name: 'provider_name', label: 'Provider name', value: s.provider_name, required: true, max: 80 },
          { name: 'url', label: 'HTTPS URL', type: 'url', value: s.url, required: true, wide: true },
          { name: 'link_type', label: 'Link type', type: 'select', value: s.link_type, options: [['external', 'External (open provider)'], ['embed', 'Embed (play here)']] },
          { name: 'quality', label: 'Quality', value: s.quality, max: 30 },
          { name: 'language', label: 'Language', value: s.language, max: 30 },
          { name: 'region', label: 'Region', value: s.region, max: 30 },
          { name: 'sort_order', label: 'Sort order', type: 'number', value: s.sort_order },
          { name: 'is_active', label: 'Active', type: 'checkbox', value: s.is_active },
        ],
        onSubmit: async (v) => {
          const url = safeHttpsUrl(v.url);
          if (!url) throw new Error('Enter a valid HTTPS URL (no embedded credentials).');
          const { error } = await sb.from('stream_sources').update({
            provider_name: v.provider_name, url, link_type: v.link_type, quality: blank(v.quality), language: blank(v.language),
            region: blank(v.region), sort_order: parseInt(v.sort_order, 10) || 0, is_active: v.is_active,
          }).eq('id', s.id);
          if (error) throw error; toast('Link updated.'); await loadSources(); paintStats();
        },
      });
    }
  } catch (err) { toast(errText(err), 'error'); }
});

// keep the dashboard in sync if the session changes in another tab
if (sb) sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && user) setTimeout(() => { user = null; gate(); }, 0); });
gate();
