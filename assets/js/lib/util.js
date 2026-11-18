export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const NO_IMG = '/assets/img/no-poster.svg';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
// TMDb image paths always look like "/abc123.jpg"; reject anything else.
const okPath = (p) => typeof p === 'string' && /^\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(p);
export const img = (path, size = 'w342') => (okPath(path) ? `${TMDB_IMG}/${size}${path}` : NO_IMG);

let toastTimer;
export function toast(message, kind = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export const yearOf = (d) => (d ? String(d).slice(0, 4) : '');
export const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
export const fmtRuntime = (m) => (m ? `${Math.floor(m / 60) ? Math.floor(m / 60) + 'h ' : ''}${m % 60}m` : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// Replace broken images with the local placeholder (CSP forbids inline onerror handlers).
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && !t.dataset.fallback) {
    t.dataset.fallback = '1';
    t.src = NO_IMG;
  }
}, true);

export function safeHttpsUrl(value) {
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}

// Ask the app shell to open the sign-in dialog (keeps views decoupled from the shell).
export function needSignIn(message = 'Sign in to use this feature.') {
  toast(message);
  document.dispatchEvent(new CustomEvent('cineotaku:signin'));
}
