// In-memory stand-in for supabase-js used ONLY by the UI test harness. It mimics query-builder semantics and a
// coarse version of the RLS rules (admin-only writes on catalog/seasons/episodes/stream_sources, own-rows on user tables).
(function () {
  const db = JSON.parse(localStorage.getItem('__db') || 'null') || { users: [{ id: 'u-admin', email: 'admin@x.com', password: 'adminpass1', role: 'admin', name: 'Boss' }, { id: 'u-user', email: 'user@x.com', password: 'userpass12', role: 'user', name: 'Normal' }], profiles: [], catalog: [], seasons: [], episodes: [], watchlist: [], watch_history: [], stream_sources: [], seq: 100 };
  const save = () => localStorage.setItem('__db', JSON.stringify(db));
  let session = JSON.parse(localStorage.getItem('__session') || 'null');
  const listeners = new Set();
  const setSession = (s, evt) => { session = s; localStorage.setItem('__session', JSON.stringify(s)); listeners.forEach((f) => f(evt, s)); };
  const userObj = (u) => ({ id: u.id, email: u.email, user_metadata: { display_name: u.name }, app_metadata: { providers: ['email'] } });
  const profile = (id) => { let p = db.profiles.find((x) => x.id === id); if (!p) { const u = db.users.find((x) => x.id === id); p = { id, display_name: u?.name, avatar_url: null, role: u?.role || 'user' }; db.profiles.push(p); } return p; };
  const isAdmin = () => !!session && profile(session.user.id).role === 'admin';
  const ADMIN_ONLY = ['catalog', 'seasons', 'episodes', 'stream_sources'];
  const OWN = ['watchlist', 'watch_history'];
  const denied = { message: 'new row violates row-level security policy', code: '42501' };
  function from(table) {
    let rows, op = 'select', payload, filters = [], orderBy = [], lim, single, count, head, conflict, wantRows = false;
    const q = {
      select(cols, o) { if (op === 'select') { op = 'select'; q._cols = cols; count = o?.count; head = o?.head; } else wantRows = true; return q; },
      insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; }, delete() { op = 'delete'; return q; },
      upsert(p, o) { op = 'upsert'; payload = p; conflict = o?.onConflict; return q; },
      eq(c, v) { filters.push((r) => String(r[c]) === String(v)); return q; }, lte() { return q; },
      order(c, o) { orderBy.push([c, o?.ascending !== false]); return q; }, limit(n) { lim = n; return q; },
      maybeSingle() { single = 'maybe'; return q; }, single() { single = 'one'; return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    function visible(r) {
      if (OWN.includes(table)) return session && r.user_id === session.user.id;
      if (table === 'profiles') return session && (r.id === session.user.id || isAdmin());
      if (table === 'catalog') return r.is_published || isAdmin();
      if (table === 'stream_sources') return isAdmin() || (r.is_active && db.catalog.find((c) => c.id === r.catalog_id)?.is_published);
      return true;
    }
    function embed(r, cols) {
      const out = { ...r };
      if (cols && table === 'stream_sources') {
        if (/episode:episodes/.test(cols)) { const e = db.episodes.find((x) => x.id === r.episode_id); out.episode = e ? { episode_number: e.episode_number, season: { season_number: db.seasons.find((s) => s.id === e.season_id)?.season_number } } : null; }
        if (/catalog:catalog/.test(cols)) { const c = db.catalog.find((x) => x.id === r.catalog_id); out.catalog = c ? { title: c.title, media_type: c.media_type } : null; }
      }
      if (cols && table === 'seasons' && /episodes\(/.test(cols)) out.episodes = db.episodes.filter((e) => e.season_id === r.id);
      return out;
    }
    function run() {
      const t = db[table]; if (!t) return { data: null, error: { message: 'no table ' + table } };
      const pass = (r) => filters.every((f) => f(r));
      if (op === 'select') {
        let out = t.filter((r) => visible(r) && pass(r));
        if (head) return { data: null, count: out.length, error: null };
        orderBy.slice().reverse().forEach(([c, asc]) => out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)));
        if (lim) out = out.slice(0, lim);
        out = out.map((r) => embed(r, q._cols));
        if (single) return { data: out[0] || null, error: single === 'one' && !out[0] ? { message: 'no rows' } : null };
        return { data: out, error: null };
      }
      const writable = (r) => (ADMIN_ONLY.includes(table) ? isAdmin() : OWN.includes(table) ? session && (r.user_id === session.user.id) : table === 'profiles' ? session && r.id === session.user.id : false);
      if (op === 'update') {
        if (table === 'profiles' && 'role' in payload) return { data: null, error: denied };
        if (!session || (ADMIN_ONLY.includes(table) && !isAdmin())) return { data: [], error: null };
        const hit = t.filter((r) => pass(r) && writable(r)); hit.forEach((r) => Object.assign(r, payload)); save();
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        if (!session || (ADMIN_ONLY.includes(table) && !isAdmin())) return { data: [], error: null };
        const hit = t.filter((r) => pass(r) && writable(r)); hit.forEach((r) => t.splice(t.indexOf(r), 1));
        if (table === 'catalog') hit.forEach((c) => { db.seasons.filter((s) => s.catalog_id === c.id).forEach((s) => db.seasons.splice(db.seasons.indexOf(s), 1)); db.stream_sources = db.stream_sources.filter((s) => s.catalog_id !== c.id); });
        save(); return { data: hit, error: null };
      }
      // insert / upsert
      const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ ...r }));
      const added = [];
      for (const r of list) {
        if (!writable(r) && !(ADMIN_ONLY.includes(table) && isAdmin())) return { data: null, error: denied };
        if (OWN.includes(table) && r.user_id !== session?.user.id) return { data: null, error: denied };
        const keys = conflict ? conflict.split(',') : null;
        const existing = keys ? t.find((x) => keys.every((k) => x[k] === r[k])) : null;
        if (existing) { if (op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key' } }; Object.assign(existing, r); added.push(existing); continue; }
        if (op === 'insert' && table === 'catalog' && t.find((x) => x.tmdb_id === r.tmdb_id && x.media_type === r.media_type)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        if (table !== 'profiles') r.id = r.id ?? ++db.seq;
        if (OWN.includes(table) && !('completed' in r) && table === 'watch_history') r.completed = false;
        if (table === 'stream_sources') r.is_active = !!r.is_active;
        r.created_at = new Date().toISOString(); t.push(r); added.push(r);
      }
      save();
      const data = single ? added[0] : added; return { data, error: null };
    }
    return q;
  }
  const auth = {
    async getSession() { return { data: { session } }; },
    onAuthStateChange(f) { listeners.add(f); return { data: { subscription: { unsubscribe() { listeners.delete(f); } } } }; },
    async signInWithPassword({ email, password }) { const u = db.users.find((x) => x.email === email && x.password === password); if (!u) return { error: { message: 'Invalid login credentials' } }; profile(u.id); setSession({ user: userObj(u) }, 'SIGNED_IN'); return { data: {}, error: null }; },
    async signUp({ email, password, options }) { if (db.users.some((x) => x.email === email)) return { error: { message: 'User already registered' } }; const u = { id: 'u-' + (++db.seq), email, password, role: 'user', name: options?.data?.display_name }; db.users.push(u); profile(u.id); save(); if (window.__confirm) return { data: { session: null }, error: null }; setSession({ user: userObj(u) }, 'SIGNED_IN'); return { data: { session }, error: null }; },
    async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
    async resetPasswordForEmail(email) { window.__resetFor = email; return { error: null }; },
    async updateUser({ password }) { const u = db.users.find((x) => x.id === session.user.id); u.password = password; save(); setSession(session, 'USER_UPDATED'); return { error: null }; },
    async signInWithOAuth() { window.__oauth = true; return { error: null }; },
    __recovery() { listeners.forEach((f) => f('PASSWORD_RECOVERY', session)); },
  };
  const storage = { from: () => ({ async upload(p, blob) { window.__uploaded = { p, size: blob.size }; return { error: null }; }, getPublicUrl: (p) => ({ data: { publicUrl: 'https://abcdefgh.supabase.co/storage/v1/object/public/avatars/' + p } }) }) };
  window.__fakeAuth = auth;
  window.supabase = { createClient: () => ({ auth, from, storage, async rpc(name) { return name === 'is_admin' ? { data: isAdmin(), error: null } : { data: null, error: { message: 'no rpc' } }; } }) };
})();
