// Client for the /api/tmdb serverless proxy (the TMDb token never reaches the browser).
const cache = new Map();

export function tmdb(path, params = {}) {
  const u = new URL('/api/tmdb', location.origin);
  u.searchParams.set('path', path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  const key = u.search;
  if (cache.has(key)) return cache.get(key);
  const p = fetch(u).then(async (r) => {
    if (!r.ok) {
      let msg = 'Catalog service unavailable';
      try { const j = await r.json(); if (j.error) msg = j.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return r.json();
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

let genreCache;
export async function genres(type) {
  genreCache ||= {};
  genreCache[type] ||= tmdb(`/genre/${type}/list`).then((d) => d.genres || []);
  return genreCache[type];
}
