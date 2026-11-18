// Test server: serves the project statically, runs the REAL api/*.js handlers with a mocked TMDb upstream,
// and applies the REAL vercel.json headers (including the strict CSP).
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const headersFor = (url) => {
  const out = {};
  for (const h of vercel.headers) {
    const re = new RegExp('^' + h.source.replace('(.*)', '.*') + '$');
    if (re.test(url)) h.headers.forEach(({ key, value }) => (out[key] = value));
  }
  return out;
};
process.env.TMDB_READ_ACCESS_TOKEN = 'test-token';
process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.GOOGLE_AUTH_ENABLED = 'true';
const upstreamCalls = [];
const mk = (i, tv, extra = {}) => ({ id: i, [tv ? 'name' : 'title']: `${tv ? 'Show' : 'Film'} ${i}`, poster_path: `/p${i}.jpg`, backdrop_path: `/b${i}.jpg`, vote_average: 7.5, overview: 'An overview for test title ' + i, [tv ? 'first_air_date' : 'release_date']: '2024-05-01', genre_ids: [16, 18], original_language: 'ja', popularity: 100 - i, media_type: tv ? 'tv' : 'movie', ...extra });
global.fetch = async (url, opts) => {
  const u = new URL(url); upstreamCalls.push({ url: u.href, auth: opts?.headers?.Authorization });
  const p = u.pathname.replace('/3', '');
  const json = (o, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o) });
  if (p.startsWith('/genre/')) return json({ genres: [{ id: 16, name: 'Animation' }, { id: 18, name: 'Drama' }, { id: 28, name: 'Action' }] });
  let m;
  if ((m = p.match(/^\/tv\/(\d+)\/season\/(\d+)$/))) return json({ season_number: +m[2], episodes: [1, 2, 3].map((n) => ({ episode_number: n, name: `Episode ${n}`, overview: 'ep overview', still_path: `/s${n}.jpg`, runtime: 24, air_date: n === 3 ? '2999-01-01' : '2024-01-0' + n })) });
  if ((m = p.match(/^\/(movie|tv)\/(\d+)$/))) { const tv = m[1] === 'tv'; return json({ ...mk(+m[2], tv), genres: [{ id: 16, name: 'Animation' }, { id: 18, name: 'Drama' }], tagline: 'A tagline', runtime: 110, status: 'Released', number_of_seasons: 2, number_of_episodes: 6, seasons: [{ season_number: 1, name: 'Season 1', episode_count: 3 }, { season_number: 2, name: 'Season 2', episode_count: 3 }], credits: { cast: [{ name: 'Actor One', character: 'Hero', profile_path: '/c1.jpg' }] }, videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abcdefghijk' }] }, recommendations: { results: [mk(900, tv), mk(901, tv)] } }); }
  if (p.startsWith('/search/')) return json({ results: [mk(7, p.endsWith('tv')), mk(8, p.endsWith('tv'))] });
  const tv = p.includes('/tv') || p.includes('on_the_air') || p.includes('airing');
  return json({ page: 1, total_pages: 3, results: Array.from({ length: 12 }, (_, i) => mk(i + 1, tv)) });
};
const api = { tmdb: require(path.join(ROOT, 'api/tmdb.js')), config: require(path.join(ROOT, 'api/config.js')) };
const wrapRes = (res) => { res.status = (c) => { res.statusCode = c; return res; }; res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); }; res.send = (b) => res.end(b); return res; };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const h = headersFor(u.pathname); Object.entries(h).forEach(([k, v]) => res.setHeader(k, v));
  if (u.pathname === '/__calls') { res.end(JSON.stringify(upstreamCalls)); return; }
  if (u.pathname === '/api/tmdb' || u.pathname === '/api/config') { wrapRes(res); req.query = Object.fromEntries(u.searchParams); return api[u.pathname.slice(5)](req, res); }
  let f = u.pathname === '/' ? '/index.html' : u.pathname === '/admin' ? '/admin.html' : u.pathname;
  const fp = path.join(ROOT, f);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(fp)] || 'application/octet-stream'); res.end(fs.readFileSync(fp));
});
server.listen(4173, () => console.log('test server on 4173'));
