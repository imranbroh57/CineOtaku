const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:4173';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let pass = 0, fail = 0; const failures = [];
const ok = (c, name) => { if (c) { pass++; console.log('PASS ', name); } else { fail++; failures.push(name); console.log('FAIL ', name); } };

(async () => {
  const browser = await chromium.launch();
  const mkctx = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...opts });
    await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(__dirname + '/fake-supabase.js') }));
    await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
    await ctx.route('**/image.tmdb.org/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
    await ctx.route('**/*.supabase.co/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
    return ctx;
  };
  const watch = (page, bag) => {
    page.on('console', (m) => { if (m.type() === 'error') bag.push(m.text()); });
    page.on('pageerror', (e) => bag.push('PAGEERROR ' + e.message));
    page.on('dialog', (d) => d.accept());
  };

  // ============ desktop, signed out ============
  const ctx = await mkctx(); const page = await ctx.newPage(); const errs = []; watch(page, errs);
  await page.goto(BASE + '/'); await page.waitForSelector('.hero-slide.active');
  ok(await page.locator('.hero-slide').count() === 6, 'home: hero with 6 slides');
  await page.waitForSelector('#home-rows .row .card');
  ok((await page.locator('#home-rows section.section').count()) >= 5, 'home: content rows rendered');
  ok((await page.locator('.skeleton-row').count()) === 0, 'home: skeletons replaced');
  await page.screenshot({ path: 'shot-home.png' });
  await page.click('[data-dot="2"]');
  ok(await page.locator('.hero-slide.active').getAttribute('data-i') === '2', 'home: hero dot navigation');

  // nav + browse
  await page.click('nav a[data-nav="movies"]'); await page.waitForSelector('#results .grid .card');
  ok(await page.locator('nav a.active').innerText() === 'Movies', 'nav: Movies active');
  ok(await page.locator('#genre-chips .chip').count() >= 3, 'browse: genre chips');
  await page.click('#genre-chips [data-genre="28"]'); await page.waitForSelector('#genre-chips .chip.active[data-genre="28"]');
  ok(page.url().includes('genre=28'), 'browse: genre filter in URL');
  await page.selectOption('select[name="sort"]', 'latest'); await page.waitForSelector('#results .grid .card');
  ok(page.url().includes('sort=latest'), 'browse: sort in URL');
  const before = await page.locator('#results .card').count();
  await page.click('#more-btn'); await page.waitForFunction((b) => document.querySelectorAll('#results .card').length > b, before);
  ok(true, 'browse: load more appends cards');
  await page.goto(BASE + '/#/anime'); await page.waitForSelector('#results .grid .card');
  ok(await page.locator('select[name="type"]').count() === 1, 'anime: format switch present');
  await page.goto(BASE + '/#/tv'); await page.waitForSelector('#results .grid .card');

  // search
  await page.fill('#search-input', 'naruto'); await page.press('#search-input', 'Enter');
  await page.waitForSelector('#results .grid .card');
  ok(page.url().includes('search?q=naruto'), 'search: routed');
  await page.waitForTimeout(300); const nsr = await page.locator('#results .card').count(); console.log('search cards', nsr); ok(nsr === 4, 'search: movie+tv merged results');
  await page.click('.tab[data-f="tv"]'); ok(await page.locator('#results .card').count() === 2, 'search: filter tabs');

  // title page (movie)
  await page.goto(BASE + '/#/title/movie/5'); await page.waitForSelector('.title-info h1');
  ok((await page.locator('.title-info h1').innerText()) === 'Film 5', 'title: movie heading');
  ok(await page.locator('#watch-btn').count() === 0, 'title: no fake Watch button without sources');
  ok((await page.locator('#provider-note').innerText()).includes('No authorised streaming link'), 'title: honest no-provider message');
  await page.click('#trailer-btn'); await page.waitForSelector('#player-dialog[open] iframe');
  const src = await page.locator('#player-dialog iframe').getAttribute('src');
  ok(src.startsWith('https://www.youtube-nocookie.com/embed/'), 'trailer: nocookie embed');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); ok(await page.locator('#player-content iframe').count() === 0, 'trailer: closing removes iframe');
  // signed out -> list button prompts sign-in
  await page.click('#list-btn'); await page.waitForSelector('#auth-dialog[open]');
  ok(true, 'title: signed-out My List opens auth dialog');

  // ============ auth flows ============
  ok(await page.locator('#google-btn').count() === 1, 'auth: Google button shown when GOOGLE_AUTH_ENABLED');
  await page.click('[data-auth-mode="forgot"]'); await page.fill('input[name=email]', 'user@x.com'); await page.click('#auth-form button[type=submit]');
  await page.waitForSelector('#auth-msg.ok'); ok((await page.evaluate(() => window.__resetFor)) === 'user@x.com', 'auth: password reset requested');
  await page.click('[data-auth-mode="signin"]');
  await page.fill('input[name=email]', 'user@x.com'); await page.fill('input[name=password]', 'wrongwrong'); await page.click('#auth-form button[type=submit]');
  await page.waitForSelector('#auth-msg.bad'); ok(true, 'auth: wrong password shows error');
  await page.fill('input[name=password]', 'userpass12'); await page.click('#auth-form button[type=submit]');
  await page.waitForSelector('.avatar-btn'); ok(true, 'auth: sign-in shows avatar menu');
  ok(await page.locator('#auth-dialog[open]').count() === 0, 'auth: dialog closes after sign-in');
  await page.click('#menu-btn'); ok(await page.locator('#menu-panel a[href="/admin"]').count() === 0, 'menu: no Admin link for normal user');
  await page.keyboard.press('Escape');

  // watchlist
  await page.waitForSelector('#list-btn'); await page.click('#list-btn');
  await page.waitForFunction(() => document.querySelector('#list-btn').textContent.includes('In My List'));
  ok(true, 'watchlist: add from title page');
  await page.click('#done-btn'); await page.waitForFunction(() => document.querySelector('#done-btn').textContent.includes('Watched'));
  ok(true, 'history: movie marked watched');
  await page.goto(BASE + '/#/list'); await page.waitForSelector('#body .grid .card');
  ok(await page.locator('#body .card').count() === 1, 'my list: shows saved title');
  await page.hover('.card'); await page.click('.card-save');
  await page.waitForSelector('.state.empty'); ok(true, 'my list: remove shows empty state');
  await page.goto(BASE + '/#/history'); await page.waitForSelector('.hist-item');
  ok((await page.locator('.hist-item .pill').innerText()) === 'WATCHED', 'history: entry listed as Watched');

  // tv episodes
  await page.goto(BASE + '/#/title/tv/6'); await page.waitForSelector('.episode');
  ok(await page.locator('.episode').count() === 3, 'tv: episodes listed');
  ok(await page.locator('.pill.muted-pill').count() === 1, 'tv: unaired episode flagged Upcoming');
  await page.click('[data-ep-toggle="1"]'); await page.waitForSelector('.episode.done');
  ok((await page.locator('#series-progress').innerText()).includes('1 / 6'), 'tv: progress counts 1/6');
  await page.click('#season-all'); await page.waitForFunction(() => document.querySelectorAll('.episode.done').length === 2);
  ok(true, 'tv: mark season watched (aired only)');
  await page.selectOption('#season-select', '2'); await page.waitForSelector('.episode');
  ok(await page.locator('.episode.done').count() === 0, 'tv: season 2 independent');
  await page.reload(); await page.waitForSelector('.episode');
  ok((await page.locator('#series-progress').innerText()).includes('2 / 6'), 'tv: progress persisted after reload');
  ok((await page.locator('#season-select').inputValue()) === '1', 'tv: resumes last-watched season');

  // profile
  await page.goto(BASE + '/#/profile'); await page.waitForSelector('#name-form');
  await page.fill('#name-form input[name=name]', 'Renamed User'); await page.click('#name-form button');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Profile saved'));
  ok(true, 'profile: display name saved');
  await page.setInputFiles('#avatar-input', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForFunction(() => window.__uploaded);
  ok((await page.evaluate(() => window.__uploaded.p)) === 'u-user/avatar.jpg' || (await page.evaluate(() => window.__uploaded.p)).endsWith('/avatar.jpg'), 'profile: avatar uploaded to own folder');
  await page.fill('#pw-form input[name=pw]', 'newpassword1'); await page.fill('#pw-form input[name=pw2]', 'different'); await page.click('#pw-form button');
  ok((await page.locator('#pw-msg').innerText()).includes('do not match'), 'profile: password mismatch rejected');
  await page.fill('#pw-form input[name=pw2]', 'newpassword1'); await page.click('#pw-form button');
  await page.waitForFunction(() => document.querySelector('#pw-msg').textContent.includes('updated')); ok(true, 'profile: password updated');

  // password recovery event
  await page.evaluate(() => window.__fakeAuth.__recovery());
  await page.waitForSelector('#auth-dialog[open] input[name=password2]'); ok(true, 'auth: recovery event opens new-password form');
  await page.keyboard.press('Escape');

  // logout
  await page.click('#menu-btn'); await page.click('#menu-logout'); await page.waitForSelector('[data-open-auth]');
  ok(true, 'auth: sign out returns to Sign in button');
  await page.goto(BASE + '/#/list'); await page.waitForSelector('.state');
  ok((await page.locator('.state').innerText()).includes('Sign in'), 'my list: signed-out prompt');

  // admin as normal user -> denied
  await page.goto(BASE + '/admin'); await page.waitForSelector('#gate-login:not(.hidden)');
  await page.fill('#login-email', 'user@x.com'); await page.fill('#login-password', 'newpassword1'); await page.click('#login-form button');
  await page.waitForSelector('#gate-denied:not(.hidden)'); ok(true, 'admin: normal user is denied');
  ok(await page.locator('#dash.hidden').count() === 1, 'admin: dashboard hidden for normal user');
  // normal user cannot write catalog even by calling the client directly
  const direct = await page.evaluate(async () => { const c = window.supabase.createClient(); const r = await c.from('catalog').insert({ tmdb_id: 1, media_type: 'movie', title: 'x' }); return r.error ? 'denied' : 'allowed'; });
  ok(direct === 'denied', 'admin: direct client write by non-admin is rejected (mock RLS)');
  await page.click('#denied-signout');

  // ============ admin flow ============
  await page.waitForSelector('#gate-login:not(.hidden)');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-password', 'adminpass1'); await page.click('#login-form button');
  await page.waitForSelector('#dash:not(.hidden)'); ok(true, 'admin: admin signs in');
  await page.click('[data-tab="add"]');
  await page.check('#add-publish');
  await page.fill('#tmdb-q', 'show'); await page.selectOption('#tmdb-kind', 'tv'); await page.click('#tmdb-form button');
  await page.waitForSelector('[data-add]'); await page.click('[data-add]');
  await page.waitForFunction(() => document.querySelector('#add-msg').textContent.includes('Imported'));
  ok((await page.locator('#add-msg').innerText()).includes('Imported 2 season(s) and 6 episode(s)'), 'admin: add series imports 2 seasons / 6 episodes');
  await page.click('[data-tab="catalog"]'); await page.waitForSelector('#catalog-table tr');
  ok((await page.locator('#catalog-table .pill.ok').first().innerText()).toLowerCase() === 'published', 'admin: published on add');
  await page.click('[data-act="publish"]'); await page.waitForFunction(() => document.querySelector('#catalog-table .pill')?.textContent === 'Hidden');
  ok(true, 'admin: hide/unpublish toggle'); await page.click('[data-act="publish"]'); await page.waitForSelector('#catalog-table .pill.ok');
  await page.click('[data-act="feature"]'); await page.waitForSelector('#catalog-table .small-btn.on'); ok(true, 'admin: feature toggle');
  await page.click('[data-act="edit"]'); await page.fill('#edit-form input[name=title]', 'Edited Show'); await page.click('#edit-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#catalog-table strong')?.textContent === 'Edited Show'); ok(true, 'admin: edit catalog entry');
  await page.click('[data-tab="seasons"]'); await page.waitForSelector('.season-card');
  ok(await page.locator('.season-card').count() === 2, 'admin: seasons listed');
  await page.click('[data-sact="add-ep"] >> nth=0'); await page.fill('#edit-form input[name=episode_number]', '9'); await page.fill('#edit-form input[name=name]', 'Bonus'); await page.click('#edit-form button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.season-card td')].some((t) => t.textContent === 'Bonus')); ok(true, 'admin: add episode');
  await page.click('[data-tab="providers"]');
  await page.fill('#src-name', 'Official Provider'); await page.fill('#src-url', 'http://insecure.example/x');
  await page.check('#src-auth'); await page.click('#src-form button[type=submit]');
  ok((await page.locator('#src-msg').innerText()).includes('HTTPS'), 'admin: http URL rejected client-side');
  await page.fill('#src-url', 'https://provider.example/watch/1'); await page.selectOption('#src-type', 'embed'); await page.check('#src-active');
  await page.click('#src-form button[type=submit]'); await page.waitForSelector('#src-table tr td');
  ok((await page.locator('#src-table').innerText()).includes('Official Provider'), 'admin: provider link saved');
  // episode-scoped link
  await page.waitForFunction(() => document.querySelectorAll('#src-scope option').length > 1);
  await page.selectOption('#src-scope', { index: 1 }); await page.fill('#src-name', 'Ep Provider'); await page.fill('#src-url', 'https://provider.example/ep1'); await page.check('#src-active'); await page.check('#src-auth');
  await page.click('#src-form button[type=submit]'); await page.waitForFunction(() => document.querySelectorAll('#src-table tbody tr').length === 2);
  ok((await page.locator('#src-table').innerText()).includes('S1 E1'), 'admin: episode-scoped link');
  await page.click('[data-sa="toggle"] >> nth=0'); await page.waitForTimeout(150); ok(true, 'admin: activate/deactivate link');
  await page.screenshot({ path: 'shot-admin.png', fullPage: true });
  await page.click('#signout-btn'); await page.waitForSelector('#gate-login:not(.hidden)');

  // ============ viewer sees admin-managed provider links ============
  await page.goto(BASE + '/#/title/tv/7'); await page.waitForSelector('.episode');
  ok(await page.locator('#watch-btn').count() === 1, 'viewer: Watch now appears once title-level link is active');
  ok(await page.locator('[data-ep-watch]').count() >= 1, 'viewer: episode Watch buttons appear');
  await page.click('#watch-btn'); await page.waitForSelector('#player-dialog[open] [data-open]');
  await page.click('[data-open="0"]'); await page.waitForSelector('#player-stage iframe');
  const sb = await page.locator('#player-stage iframe').getAttribute('sandbox');
  ok(sb && !sb.includes('allow-popups') && !sb.includes('allow-top-navigation'), 'player: embed sandbox blocks popups/top navigation');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'shot-title.png' });

  ok(errs.filter((e) => !/Failed to load resource/.test(e)).length === 0, 'no console errors / CSP violations (desktop)');
  if (errs.length) console.log('console issues:', errs.slice(0, 8));

  // ============ mobile ============
  const mctx = await mkctx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage(); const merrs = []; watch(mp, merrs);
  await mp.goto(BASE + '/'); await mp.waitForSelector('#home-rows .row .card');
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile: no horizontal page scroll (home)');
  ok(await mp.evaluate(() => getComputedStyle(document.querySelector('nav')).position === 'fixed'), 'mobile: bottom navigation');
  await mp.screenshot({ path: 'shot-m-home.png' });
  await mp.click('#search-toggle'); ok(await mp.locator('#search-form.open').count() === 1, 'mobile: search expands');
  await mp.goto(BASE + '/#/title/tv/6'); await mp.waitForSelector('.episode');
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile: no horizontal scroll (title page)');
  await mp.screenshot({ path: 'shot-m-title.png' });
  await mp.goto(BASE + '/#/movies'); await mp.waitForSelector('#results .card');
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile: no horizontal scroll (browse)');
  await mp.goto(BASE + '/admin'); await mp.waitForSelector('#gate-login:not(.hidden)');
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile: no horizontal scroll (admin login)');
  ok(merrs.filter((e) => !/Failed to load resource/.test(e)).length === 0, 'no console errors (mobile)');
  if (merrs.length) console.log('mobile issues:', merrs.slice(0, 5));

  // ============ signup + email confirmation path ============
  const c3 = await mkctx(); const p3 = await c3.newPage(); watch(p3, []);
  await p3.addInitScript(() => { window.__confirm = true; });
  await p3.goto(BASE + '/'); await p3.waitForSelector('[data-open-auth]'); await p3.click('[data-open-auth]');
  await p3.click('[data-auth-mode="signup"]'); await p3.fill('input[name=name]', 'Newbie'); await p3.fill('input[name=email]', 'new@x.com'); await p3.fill('input[name=password]', 'longpassword1');
  await p3.click('#auth-form button[type=submit]'); await p3.waitForSelector('#auth-msg.ok');
  ok((await p3.locator('#auth-msg').innerText()).includes('Check your email'), 'auth: signup with email confirmation message');

  console.log(`\n==== ${pass} passed, ${fail} failed`); if (fail) console.log(failures);
  await browser.close();
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
