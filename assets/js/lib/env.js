// Browser configuration. Values come from /api/config (public values only).
const CFG = window.CINEOTAKU_CONFIG || {};

export const config = {
  googleAuth: !!CFG.GOOGLE_AUTH,
  misconfigured: !!CFG.SUPABASE_MISCONFIGURED,
};

export const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_PUBLISHABLE_KEY && window.supabase);

// Only the public/publishable key is ever used in the browser; RLS protects all data.
export const sb = configured
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
