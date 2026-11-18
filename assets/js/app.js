// CineOtaku app shell: hash router, header, auth dialog, global actions.
import { $, $$, esc, toast, needSignIn } from './lib/util.js';
import { configured, config } from './lib/env.js';
import { state, initAuth, onAuth, displayName, signIn, signUp, signOut, signInWithGoogle, sendReset, updatePassword } from './lib/auth.js';
import { resetUserData, toggleWatchlist } from './lib/data.js';
import { syncSaveButtons } from './ui.js';
import { avatarHtml, renderProfile } from './views/profile.js';
import * as home from './views/home.js';
import * as browse from './views/browse.js';
import * as title from './views/title.js';
import { renderList, renderHistory } from './views/library.js';

const view = $('#view');
const routes = [
  [/^\/$/, home.render, 'Discover'],
  [/^\/(movies|tv|anime)$/, browse.render, null],
  [/^\/search$/, browse.renderSearch, 'Search'],
  [/^\/title\/(movie|tv)\/(\d+)$/, title.render, null],
  [/^\/list$/, renderList, 'My List'],
  [/^\/history$/, renderHistory, 'Watch history'],
  [/^\/profile$/, renderProfile, 'Profile'],
];
const NAMES = { movies: 'Movies', tv: 'TV Series', anime: 'Anime' };

let token = 0;
let cleanup = null;

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

async function route() {
  const my = ++token;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const { path, query } = parseHash();
  let match = null;
  for (const [re, fn, label] of routes) {
    const m = path.match(re);
    if (m) { match = { fn, label, params: m.slice(1) }; break; }
  }
  $$('nav a[data-nav]').forEach((a) => {
    const on = a.dataset.nav === (match ? path.split('/')[1] || 'home' : 'home');
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (!match) { location.replace('#/'); return; }
  document.title = `${match.label || NAMES[match.params[0]] || 'CineOtaku'} — CineOtaku`;
  window.scrollTo(0, 0);
  const ctx = { params: match.params, query, stale: () => my !== token };
  try {
    const result = await match.fn(view, ctx);
    if (my === token) cleanup = result;
    else if (typeof result === 'function') result();
  } catch (e) {
    console.error(e);
    if (my === token) view.innerHTML = '<div class="page"><div class="state error" role="alert"><h3>Something went wrong</h3><p>Please try again.</p><button class="btn ghost" type="button" data-retry>Try again</button></div></div>';
  }
}

// ---------- header ----------
function paintAccount() {
  const slot = $('#account-slot');
  if (!state.user) {
    slot.innerHTML = '<button class="btn primary small" type="button" data-open-auth>Sign in</button>';
    return;
  }
  slot.innerHTML = `<div class="menu"><button class="avatar-btn" type="button" id="menu-btn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${avatarHtml()}</button>
    <div class="menu-panel" id="menu-panel" hidden>
      <div class="menu-user"><strong>${esc(displayName())}</strong><small>${esc(state.user.email || '')}</small></div>
      <a href="#/profile">Profile</a><a href="#/list">My List</a><a href="#/history">Watch history</a>
      ${state.isAdmin ? '<a href="/admin">Admin dashboard</a>' : ''}
      <button type="button" id="menu-logout">Sign out</button>
    </div></div>`;
}
function closeMenu() {
  const p = $('#menu-panel');
  if (p && !p.hidden) { p.hidden = true; $('#menu-btn')?.setAttribute('aria-expanded', 'false'); }
}

// ---------- auth dialog ----------
const authDlg = $('#auth-dialog');
const authBody = $('#auth-body');
let authMode = 'signin';

function authView(mode) {
  authMode = mode;
  const google = config.googleAuth && mode !== 'forgot' && mode !== 'recovery'
    ? '<div class="or"><span>or</span></div><button class="btn ghost wide" type="button" id="google-btn">Continue with Google</button>' : '';
  const titles = { signin: 'Welcome back', signup: 'Create your free account', forgot: 'Reset your password', recovery: 'Choose a new password' };
  const fields = {
    signin: '<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>',
    signup: '<label>Display name<input name="name" maxlength="60" autocomplete="nickname" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password (min 8 characters)<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>',
    forgot: '<p class="muted">Enter your email and we’ll send you a reset link.</p><label>Email<input name="email" type="email" autocomplete="email" required></label>',
    recovery: '<label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input name="password2" type="password" minlength="8" autocomplete="new-password" required></label>',
  };
  const submit = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', recovery: 'Update password' };
  const links = {
    signin: '<button class="text-link" type="button" data-auth-mode="forgot">Forgot password?</button><button class="text-link" type="button" data-auth-mode="signup">Create an account</button>',
    signup: '<button class="text-link" type="button" data-auth-mode="signin">I already have an account</button>',
    forgot: '<button class="text-link" type="button" data-auth-mode="signin">Back to sign in</button>',
    recovery: '',
  };
  authBody.innerHTML = `<p class="eyebrow">YOUR CINEOTAKU ACCOUNT</p><h2 id="auth-title">${titles[mode]}</h2>
    <form id="auth-form" class="stack" novalidate>${fields[mode]}<button class="btn primary wide" type="submit">${submit[mode]}</button></form>
    <p id="auth-msg" class="status" role="status" aria-live="polite"></p>${google}<div class="auth-links">${links[mode]}</div>
    <p class="muted small">Free forever · no ads · no paid plans.</p>`;
  authBody.querySelector('input')?.focus();
}
function openAuth(mode = 'signin') {
  if (!configured) {
    toast(config.misconfigured ? 'Server misconfigured: a secret key was set as the public key.' : 'Accounts are not configured on this site yet.', 'error');
    return;
  }
  authView(mode);
  if (!authDlg.open) authDlg.showModal();
}
const authMsg = (t, ok) => { const m = $('#auth-msg'); if (m) { m.textContent = t; m.className = `status ${ok ? 'ok' : 'bad'}`; } };

authBody.addEventListener('click', async (e) => {
  const sw = e.target.closest('[data-auth-mode]');
  if (sw) return authView(sw.dataset.authMode);
  if (e.target.closest('#google-btn')) {
    try { await signInWithGoogle(); } catch (err) { authMsg(err.message || 'Google sign-in is not available.'); }
  }
});
authBody.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.submitter; btn.disabled = true;
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  try {
    if (authMode === 'signin') { await signIn(email, password); authDlg.close(); toast('Signed in.'); }
    else if (authMode === 'signup') {
      const r = await signUp(email, password, String(fd.get('name') || '').trim());
      if (r.needsConfirmation) authMsg('Account created. Check your email to confirm it, then sign in.', true);
      else { authDlg.close(); toast('Welcome to CineOtaku!'); }
    } else if (authMode === 'forgot') {
      await sendReset(email);
      authMsg('If that email has an account, a reset link is on its way.', true);
    } else if (authMode === 'recovery') {
      if (password !== fd.get('password2')) throw new Error('Passwords do not match.');
      await updatePassword(password);
      authDlg.close(); toast('Password updated.');
    }
  } catch (err) { authMsg(err.message || 'Something went wrong.'); }
  btn.disabled = false;
});

// ---------- global delegated actions ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-open-auth]')) { openAuth('signin'); return; }
  if (t.closest('[data-retry]')) { route(); return; }
  const sc = t.closest('[data-scroll]');
  if (sc) {
    const r = sc.closest('.section')?.querySelector('.row');
    r?.scrollBy({ left: Number(sc.dataset.scroll) * r.clientWidth * 0.85, behavior: 'smooth' });
    return;
  }
  if (t.closest('#menu-btn')) {
    const p = $('#menu-panel'); p.hidden = !p.hidden;
    $('#menu-btn').setAttribute('aria-expanded', String(!p.hidden));
    return;
  }
  if (t.closest('#menu-logout')) { closeMenu(); await signOut(); toast('Signed out.'); location.hash = '#/'; return; }
  if (!t.closest('.menu')) closeMenu();
  if (t.closest('.menu-panel a')) closeMenu();

  const save = t.closest('.card-save');
  if (save) {
    if (!state.user) return needSignIn('Sign in to save titles to your list.');
    save.disabled = true;
    try {
      const on = await toggleWatchlist({ tmdb_id: Number(save.dataset.id), media_type: save.dataset.type, title: save.dataset.title, poster_path: save.dataset.poster || null });
      toast(on ? 'Added to My List.' : 'Removed from My List.');
      syncSaveButtons();
      if (!on && parseHash().path === '/list') route();
    } catch (err) { toast(err.message || 'Could not update your list.', 'error'); }
    save.disabled = false;
  }
});
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
document.addEventListener('cineotaku:signin', () => openAuth('signin'));

// header search
const searchForm = $('#search-form');
$('#search-toggle').addEventListener('click', () => {
  const open = searchForm.classList.toggle('open');
  $('#search-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#search-input').focus();
});
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (!q) return;
  location.hash = `#/search?q=${encodeURIComponent(q)}`;
  searchForm.classList.remove('open');
  $('#search-input').blur();
});

// ---------- boot ----------
onAuth((evt) => {
  paintAccount();
  if (evt === 'user') { resetUserData(); route(); }
  if (evt === 'recovery') openAuth('recovery');
});
window.addEventListener('hashchange', route);

(async function boot() {
  if (!configured) {
    const b = $('#config-banner');
    b.hidden = false;
    b.textContent = config.misconfigured
      ? 'Configuration error: a Supabase secret key was provided as the public key. It was blocked. Use the publishable/anon key.'
      : 'Accounts, My List and curated picks are unavailable until Supabase is configured (see README). Browsing TMDb titles still works.';
  }
  paintAccount();
  await initAuth();
  paintAccount();
  route();
})();
