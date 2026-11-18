// User data synced through Supabase (watchlist + watch history). All rows are protected by RLS.
import { sb } from './env.js';
import { state } from './auth.js';

export const wlKey = (type, id) => `${type}:${id}`;
export const watchlist = { keys: new Set(), loaded: false };

export function resetUserData() { watchlist.keys = new Set(); watchlist.loaded = false; }

export async function loadWatchlist() {
  if (!sb || !state.user) return [];
  const { data, error } = await sb.from('watchlist').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  watchlist.keys = new Set(data.map((r) => wlKey(r.media_type, r.tmdb_id)));
  watchlist.loaded = true;
  return data;
}

export async function ensureWatchlistKeys() {
  if (state.user && !watchlist.loaded) { try { await loadWatchlist(); } catch { /* shown elsewhere */ } }
}

// Returns true when the title is now in the list, false when removed.
export async function toggleWatchlist({ tmdb_id, media_type, title, poster_path }) {
  const key = wlKey(media_type, tmdb_id);
  if (watchlist.keys.has(key)) {
    const { error } = await sb.from('watchlist').delete().eq('user_id', state.user.id).eq('tmdb_id', tmdb_id).eq('media_type', media_type);
    if (error) throw error;
    watchlist.keys.delete(key);
    return false;
  }
  const { error } = await sb.from('watchlist').upsert(
    { user_id: state.user.id, tmdb_id, media_type, title, poster_path: poster_path || null },
    { onConflict: 'user_id,tmdb_id,media_type' },
  );
  if (error) throw error;
  watchlist.keys.add(key);
  return true;
}

const HIST_CONFLICT = 'user_id,tmdb_id,media_type,season_number,episode_number';

export async function titleHistory(tmdb_id, media_type) {
  if (!sb || !state.user) return [];
  const { data, error } = await sb.from('watch_history').select('*').eq('tmdb_id', tmdb_id).eq('media_type', media_type);
  if (error) throw error;
  return data || [];
}

export async function recentHistory(limit = 60) {
  const { data, error } = await sb.from('watch_history').select('*').order('last_watched_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

function histRow(item, season, episode, extra = {}) {
  return {
    user_id: state.user.id,
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path || null,
    season_number: item.media_type === 'tv' ? season : 0,
    episode_number: item.media_type === 'tv' ? episode : 0,
    last_watched_at: new Date().toISOString(),
    ...extra,
  };
}

// Mark as started (opened a provider). Does not touch an existing "completed" flag.
export async function markStarted(item, season = 0, episode = 0, episodeTitle = null) {
  const { error } = await sb.from('watch_history').upsert(histRow(item, season, episode, { episode_title: episodeTitle }), { onConflict: HIST_CONFLICT });
  if (error) throw error;
}

export async function setCompleted(item, season, episode, completed, episodeTitle = null) {
  const { error } = await sb.from('watch_history').upsert(
    histRow(item, season, episode, { completed, episode_title: episodeTitle }),
    { onConflict: HIST_CONFLICT },
  );
  if (error) throw error;
}

export async function setManyCompleted(item, season, episodes, completed) {
  if (!episodes.length) return;
  const rows = episodes.map((e) => histRow(item, season, e.episode_number, { completed, episode_title: e.name || null }));
  const { error } = await sb.from('watch_history').upsert(rows, { onConflict: HIST_CONFLICT });
  if (error) throw error;
}

export async function removeHistory(id) {
  const { error } = await sb.from('watch_history').delete().eq('id', id);
  if (error) throw error;
}
export async function clearHistory() {
  const { error } = await sb.from('watch_history').delete().eq('user_id', state.user.id);
  if (error) throw error;
}

export async function stats() {
  const [{ count: list }, { count: done }] = await Promise.all([
    sb.from('watchlist').select('id', { count: 'exact', head: true }),
    sb.from('watch_history').select('id', { count: 'exact', head: true }).eq('completed', true),
  ]);
  return { list: list || 0, done: done || 0 };
}
