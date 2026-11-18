import { sb } from './env.js';

export const state = { user: null, profile: null, isAdmin: false, ready: false };
const listeners = new Set();
export const onAuth = (fn) => listeners.add(fn);
const emit = (evt) => listeners.forEach((f) => { try { f(evt, state); } catch (e) { console.error(e); } });

async function applySession(session) {
  state.user = session?.user || null;
  state.profile = null;
  state.isAdmin = false;
  if (state.user) {
    const { data } = await sb.from('profiles').select('display_name,avatar_url,role').eq('id', state.user.id).maybeSingle();
    state.profile = data || null;
    // UI hint only. Real authorization is enforced by Postgres RLS.
    state.isAdmin = data?.role === 'admin';
  }
}

export async function initAuth() {
  if (!sb) { state.ready = true; emit('ready'); return; }
  const { data } = await sb.auth.getSession();
  await applySession(data.session);
  state.ready = true;
  emit('ready');
  sb.auth.onAuthStateChange((event, session) => {
    // Never await Supabase calls directly inside this callback (can deadlock); defer.
    setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') { await applySession(session); emit('recovery'); return; }
      const changed = (session?.user?.id || null) !== (state.user?.id || null);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        if (!changed) return;
        await applySession(session);
        emit('user');
      } else if (event === 'USER_UPDATED') {
        await applySession(session);
        emit('update');
      }
    }, 0);
  });
}

export const displayName = () =>
  state.profile?.display_name || state.user?.user_metadata?.display_name || state.user?.email?.split('@')[0] || 'Account';

const here = () => `${location.origin}/`;

export async function signUp(email, password, name) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { display_name: name || email.split('@')[0] }, emailRedirectTo: here() },
  });
  if (error) throw error;
  // When email confirmation is ON, Supabase returns a user without a session.
  return { needsConfirmation: !data.session };
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } });
  if (error) throw error;
}
export async function sendReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
  if (error) throw error;
}
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() {
  await sb.auth.signOut();
}

export async function updateDisplayName(name) {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error('Display name cannot be empty.');
  const { error } = await sb.from('profiles').update({ display_name: clean }).eq('id', state.user.id);
  if (error) throw error;
  state.profile = { ...state.profile, display_name: clean };
  emit('update');
}

// Resize to a 256px square JPEG in the browser, then upload to <uid>/avatar.jpg in the public bucket.
async function squareJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process image.'))), 'image/jpeg', 0.88));
}

export async function uploadAvatar(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image is too large (max 8 MB).');
  const blob = await squareJpeg(file);
  const path = `${state.user.id}/avatar.jpg`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw error;
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error: e2 } = await sb.from('profiles').update({ avatar_url: url }).eq('id', state.user.id);
  if (e2) throw e2;
  state.profile = { ...state.profile, avatar_url: url };
  emit('update');
}
