/**
 * /api/tmdb — read-only, allow-listed proxy for TMDb v3.
 *
 * The TMDb "API Read Access Token" lives ONLY in the Vercel environment variable
 * TMDB_READ_ACCESS_TOKEN. It is never sent to the browser.
 *
 * Usage from the browser:  /api/tmdb?path=/trending/all/week&page=1
 */

// Only these TMDb endpoints can be reached (no arbitrary proxying).
const ALLOWED_PATHS = [
  /^\/trending\/(all|movie|tv)\/(day|week)$/,
  /^\/(movie|tv)\/(popular|top_rated)$/,
  /^\/movie\/(now_playing|upcoming)$/,
  /^\/tv\/(on_the_air|airing_today)$/,
  /^\/discover\/(movie|tv)$/,
  /^\/search\/(movie|tv|multi)$/,
  /^\/genre\/(movie|tv)\/list$/,
  /^\/(movie|tv)\/\d{1,9}$/,
  /^\/(movie|tv)\/\d{1,9}\/(similar|recommendations)$/,
  /^\/tv\/\d{1,9}\/season\/\d{1,3}$/,
];

// Only these query parameters are forwarded to TMDb. Everything else is dropped.
const ALLOWED_PARAMS = new Set([
  'page', 'query', 'language', 'region', 'sort_by', 'with_genres', 'without_genres',
  'with_original_language', 'primary_release_year', 'first_air_date_year', 'year',
  'primary_release_date.gte', 'primary_release_date.lte', 'first_air_date.gte', 'first_air_date.lte',
  'vote_count.gte', 'vote_average.gte', 'append_to_response',
]);

const ALLOWED_APPEND = new Set(['credits', 'videos', 'external_ids', 'recommendations', 'similar', 'watch/providers']);
const SORTS = /^[a-z_]+\.(asc|desc)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sanitize(searchParams) {
  const out = new URLSearchParams();
  for (const [key, raw] of searchParams) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    const value = String(raw).slice(0, 200);
    if (key === 'page') {
      const n = parseInt(value, 10);
      if (!(n >= 1 && n <= 500)) continue;
      out.set('page', String(n));
    } else if (key === 'sort_by') {
      if (!SORTS.test(value)) continue;
      out.set(key, value);
    } else if (key.endsWith('.gte') || key.endsWith('.lte')) {
      if (key.startsWith('vote_')) {
        if (!/^\d{1,5}(\.\d+)?$/.test(value)) continue;
      } else if (!DATE.test(value)) continue;
      out.set(key, value);
    } else if (key === 'with_genres' || key === 'without_genres') {
      if (!/^[\d,|]{1,60}$/.test(value)) continue;
      out.set(key, value);
    } else if (key === 'primary_release_year' || key === 'first_air_date_year' || key === 'year') {
      if (!/^\d{4}$/.test(value)) continue;
      out.set(key, value);
    } else if (key === 'with_original_language' || key === 'language' || key === 'region') {
      if (!/^[A-Za-z]{2}(-[A-Za-z]{2})?$/.test(value)) continue;
      out.set(key, value);
    } else if (key === 'append_to_response') {
      const parts = value.split(',').map((s) => s.trim()).filter((s) => ALLOWED_APPEND.has(s));
      if (parts.length) out.set(key, parts.join(','));
    } else {
      out.set(key, value);
    }
  }
  // Never allow adult content through this proxy.
  out.set('include_adult', 'false');
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TMDb is not configured. Set TMDB_READ_ACCESS_TOKEN in Vercel.' });
  }

  const query = req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  const path = typeof query.path === 'string' ? query.path : '';
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return res.status(400).json({ error: 'Unsupported TMDb endpoint' });
  }

  const incoming = new URL(req.url, 'http://localhost').searchParams;
  const params = sanitize(incoming);
  if (!params.has('language')) params.set('language', 'en-US');

  const url = `https://api.themoviedb.org/3${path}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (upstream.ok) {
      // Edge-cache successful responses to stay inside TMDb and Vercel free-tier limits.
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    return res.status(upstream.status).send(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Catalog request failed' });
  } finally {
    clearTimeout(timer);
  }
};

module.exports._internals = { sanitize, ALLOWED_PATHS };
