// Provider/trailer dialog. Only admin-authorised HTTPS links are ever opened.
import { $, esc, safeHttpsUrl, toast } from './lib/util.js';

const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms'; // no popups / top navigation
let wired = false;

function dialog() {
  const dlg = $('#player-dialog');
  if (!wired) {
    wired = true;
    dlg.addEventListener('close', () => { $('#player-content').innerHTML = ''; }); // stops playback
  }
  return dlg;
}

function makeFrame(src) {
  const f = document.createElement('iframe');
  f.src = src;
  f.setAttribute('sandbox', EMBED_SANDBOX);
  f.setAttribute('allow', 'fullscreen; picture-in-picture; autoplay; encrypted-media');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('allowfullscreen', '');
  f.title = 'Player';
  f.className = 'player-frame';
  return f;
}

export function openTrailer(key, title) {
  if (!/^[\w-]{6,20}$/.test(key || '')) return toast('Trailer is not available.');
  const dlg = dialog();
  $('#player-content').innerHTML = `<h2>${esc(title)} — Trailer</h2><div id="player-stage" class="stage"></div>`;
  $('#player-stage').append(makeFrame(`https://www.youtube-nocookie.com/embed/${key}?rel=0`));
  dlg.showModal();
}

/**
 * sources: [{provider_name, url, link_type, quality, language, region}]
 * onStart(): called when a provider is opened. onWatched(): optional "mark as watched" handler.
 */
export function openSources({ title, subtitle, sources, onStart, onWatched }) {
  const dlg = dialog();
  const usable = sources.map((s) => ({ ...s, href: safeHttpsUrl(s.url) })).filter((s) => s.href);
  const box = $('#player-content');
  box.innerHTML = `<h2>${esc(title)}</h2>${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}
    <p class="muted small">Links below were added by CineOtaku admins as authorised sources. CineOtaku is free and has no ads; third-party providers have their own terms.</p>
    <div id="player-stage" class="stage hidden"></div>
    <div class="provider-list">${usable.length ? usable.map((s, i) => `<div class="provider">
      <div><strong>${esc(s.provider_name)}</strong><small>${esc([s.quality, s.language, s.region].filter(Boolean).join(' · '))}</small></div>
      <button class="btn primary" type="button" data-open="${i}">${s.link_type === 'embed' ? '▶ Play here' : 'Open provider ↗'}</button></div>`).join('') : '<p class="muted">No usable provider links.</p>'}</div>
    ${onWatched ? '<div class="player-foot"><button class="btn ghost" type="button" data-watched>✓ Mark as watched</button></div>' : ''}`;
  box.onclick = async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const s = usable[Number(open.dataset.open)];
      if (s.link_type === 'embed') {
        const stage = $('#player-stage');
        stage.classList.remove('hidden');
        stage.replaceChildren(makeFrame(s.href));
        stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        window.open(s.href, '_blank', 'noopener,noreferrer');
      }
      try { await onStart?.(); } catch { /* history is best-effort */ }
      return;
    }
    if (e.target.closest('[data-watched]')) {
      try { await onWatched(); toast('Marked as watched.'); dlg.close(); } catch (err) { toast(err.message || 'Could not save.', 'error'); }
    }
  };
  dlg.showModal();
}
