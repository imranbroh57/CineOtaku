/**
 * /api/config — serves PUBLIC browser configuration as a script.
 *
 * Only values that are designed to be public are exposed here:
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY).
 * The Supabase service_role key and the TMDb token are NEVER read by this file.
 */
module.exports = function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  // Refuse to publish a secret key by mistake (service_role keys / new secret keys).
  const looksSecret = key.startsWith('sb_secret_') || decodeRole(key) === 'service_role';
  const config = {
    SUPABASE_URL: /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) ? url : '',
    SUPABASE_PUBLISHABLE_KEY: looksSecret ? '' : key,
    SUPABASE_MISCONFIGURED: looksSecret,
    GOOGLE_AUTH: process.env.GOOGLE_AUTH_ENABLED === 'true',
  };

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(`window.CINEOTAKU_CONFIG = ${JSON.stringify(config)};`);
};

function decodeRole(jwt) {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).role || null;
  } catch {
    return null;
  }
}
