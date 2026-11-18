// Offline tests for the serverless routes (run: node tests/api.test.js). No network or secrets needed.
const assert = require('assert');
process.env.TMDB_READ_ACCESS_TOKEN = 'secret-token';
let seen;
global.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
const tmdb = require('../api/tmdb.js');
const config = require('../api/config.js');
const mkRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(o) { r.body = JSON.stringify(o); return r; }, send(b) { r.body = b; return r; } }; return r; };
const call = async (url, method = 'GET') => { const res = mkRes(); const u = new URL(url, 'http://x'); await tmdb({ method, url, query: Object.fromEntries(u.searchParams) }, res); return res; };
(async () => {
  let r = await call('/api/tmdb?path=/trending/all/week&page=2&evil=1&include_adult=true');
  assert.equal(r.code, 200);
  assert(seen.url.includes('include_adult=false') && !seen.url.includes('evil') && seen.url.includes('page=2'), 'params sanitized, adult forced off');
  assert.equal(seen.opts.headers.Authorization, 'Bearer secret-token');
  assert(!r.body.includes('secret-token') && !JSON.stringify(r.headers).includes('secret-token'), 'token never in response');
  for (const bad of ['/account', '/movie/1/credits', '/../../x', '/movie/abc', 'https://evil.com', '/discover/movie/../../account']) {
    r = await call('/api/tmdb?path=' + encodeURIComponent(bad)); assert.equal(r.code, 400, bad);
  }
  assert.equal((await call('/api/tmdb?path=/movie/popular', 'POST')).code, 405);
  r = await call('/api/tmdb?path=/movie/1&append_to_response=credits,account_states'); assert(seen.url.includes('append_to_response=credits') && !seen.url.includes('account_states'));
  delete process.env.TMDB_READ_ACCESS_TOKEN; assert.equal((await call('/api/tmdb?path=/movie/popular')).code, 500);
  // config: never publishes a service_role / secret key
  const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y';
  process.env.SUPABASE_URL = 'https://abc.supabase.co';
  for (const [key, leaks] of [[jwt('anon'), true], [jwt('service_role'), false], ['sb_secret_abc', false], ['sb_publishable_abc', true]]) {
    process.env.SUPABASE_PUBLISHABLE_KEY = key; const res = mkRes(); config({}, res);
    assert.equal(res.body.includes(key), leaks, key);
  }
  process.env.SUPABASE_URL = 'https://evil.example.com'; const res = mkRes(); config({}, res); assert(res.body.includes('"SUPABASE_URL":""'));
  console.log('api tests passed');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
