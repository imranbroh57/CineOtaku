import { sb } from '../lib/env.js';
import { state, displayName, updateDisplayName, uploadAvatar, updatePassword, signOut } from '../lib/auth.js';
import { stats } from '../lib/data.js';
import { esc, toast } from '../lib/util.js';
import { emptyState } from '../ui.js';

export const avatarHtml = (cls = 'avatar') => state.profile?.avatar_url
  ? `<img class="${cls}" src="${esc(state.profile.avatar_url)}" alt="">`
  : `<span class="${cls} initial" aria-hidden="true">${esc(displayName().charAt(0).toUpperCase())}</span>`;

export async function renderProfile(root, ctx) {
  if (!sb || !state.user) {
    root.innerHTML = `<div class="page">${emptyState({ title: 'Sign in to view your profile', text: 'Manage your name, photo and password.', action: '<button class="btn primary" type="button" data-open-auth>Sign in</button>' })}</div>`;
    return;
  }
  const hasPassword = (state.user.app_metadata?.providers || []).includes('email');
  root.innerHTML = `<div class="page narrow"><div class="page-head"><div><p class="eyebrow">YOUR ACCOUNT</p><h1 class="page-title">Profile</h1></div></div>
    <section class="panel profile-card">
      <div class="avatar-block"><div id="avatar-slot">${avatarHtml('avatar big')}</div>
        <div><label class="btn ghost small" for="avatar-input">Change photo</label><input id="avatar-input" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp"><p class="muted small">JPG, PNG or WebP. Cropped to a square.</p></div></div>
      <form id="name-form" class="stack"><label>Display name<input name="name" maxlength="60" required value="${esc(displayName())}"></label>
        <p class="muted small">Email: ${esc(state.user.email || '')}</p>
        <div><button class="btn primary" type="submit">Save profile</button></div></form>
    </section>
    <section class="panel" id="stats"><h2 class="panel-h">Your activity</h2><p class="muted">Loading…</p></section>
    ${hasPassword ? `<section class="panel"><h2 class="panel-h">Change password</h2>
      <form id="pw-form" class="stack"><label>New password<input type="password" name="pw" minlength="8" autocomplete="new-password" required></label>
      <label>Confirm new password<input type="password" name="pw2" minlength="8" autocomplete="new-password" required></label>
      <div><button class="btn ghost" type="submit">Update password</button></div><p class="status" id="pw-msg" role="status"></p></form></section>` : ''}
    <section class="panel"><h2 class="panel-h">Session</h2><button class="btn ghost" type="button" id="logout">Sign out</button></section></div>`;

  stats().then((s) => { if (!ctx.stale()) root.querySelector('#stats').innerHTML = `<h2 class="panel-h">Your activity</h2><div class="stat-row"><div><strong>${s.list}</strong><span>in My List</span></div><div><strong>${s.done}</strong><span>watched</span></div></div>`; })
    .catch(() => { if (!ctx.stale()) root.querySelector('#stats').innerHTML = '<h2 class="panel-h">Your activity</h2><p class="muted">Could not load stats.</p>'; });

  root.querySelector('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    try { await updateDisplayName(new FormData(e.target).get('name')); toast('Profile saved.'); }
    catch (err) { toast(err.message || 'Could not save.', 'error'); }
    btn.disabled = false;
  });
  root.querySelector('#avatar-input').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    toast('Uploading photo…');
    try { await uploadAvatar(f); root.querySelector('#avatar-slot').innerHTML = avatarHtml('avatar big'); toast('Photo updated.'); }
    catch (err) { toast(err.message || 'Upload failed.', 'error'); }
    e.target.value = '';
  });
  root.querySelector('#pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), msg = root.querySelector('#pw-msg');
    if (fd.get('pw') !== fd.get('pw2')) { msg.textContent = 'Passwords do not match.'; return; }
    try { await updatePassword(fd.get('pw')); e.target.reset(); msg.textContent = 'Password updated.'; }
    catch (err) { msg.textContent = err.message || 'Could not update password.'; }
  });
  root.querySelector('#logout').addEventListener('click', async () => { await signOut(); location.hash = '#/'; });
}
