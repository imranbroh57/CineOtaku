# CineOtaku

Free, ad-free discovery for **movies, anime and TV series**. Dark cinematic UI, responsive on mobile/tablet/desktop.

- **100% free, no ads, no premium/VIP, no subscriptions, no paywalls.** Every user gets the same features. Admin is only for site management. There is no monetisation code anywhere (`node scripts/check.js` verifies this).
- **Stack:** GitHub → **Vercel** (static frontend + serverless API) · **Supabase** (auth, Postgres, storage) · **TMDb** (metadata).
- No build step, no framework, no npm dependencies.

> Free tiers have limits (Vercel bandwidth/function invocations, Supabase DB size/auth emails/egress, TMDb rate limits). Nothing here is "unlimited"; the TMDb proxy is edge-cached to help stay within limits.

## Features
**Users:** email/password sign-up & login, optional Google login, password reset, profile (display name + photo), secure logout · **Discovery:** trending, popular, latest releases, top rated, movies / series / anime pages with genre, sort and year filters, search, detail pages with trailer, cast, recommendations · **Tracking (synced via Supabase):** My List, watch history, per-season and per-episode completion, series progress bar, "continue watching".
**Admin (`/admin`):** role-verified login · search TMDb and add titles · edit / publish / hide / feature / delete catalog entries · import or manually manage seasons & episodes · add, edit, activate/deactivate, delete authorised provider links (whole title or a single episode).

## Project layout
```
index.html, admin.html        pages (hash-routed SPA + admin)
assets/css, assets/js         styles and ES modules (no inline scripts/styles: strict CSP)
api/tmdb.js                   allow-listed TMDb proxy (holds the private token)
api/config.js                 serves PUBLIC Supabase URL/key to the browser
supabase/schema.sql           complete schema, indexes, RLS, storage policies
vercel.json                   security headers + CSP
.env.example                  environment variables
tests/, scripts/              offline tests and a hygiene check (not deployed)
```

## 1. TMDb setup
1. Create a free account at <https://www.themoviedb.org>, then go to **Settings → API** and request a developer key.
2. Copy the **API Read Access Token** (the long `eyJ…` token, *not* the short API key). This is `TMDB_READ_ACCESS_TOKEN`.
3. Follow TMDb's attribution terms (the footer notice is included; add the TMDb logo if you want to follow their branding guide).

## 2. Supabase setup
1. Create a project at <https://supabase.com>.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, **Run**. It is safe to run again.
3. **Project Settings → API**: copy the **Project URL** and the **publishable** (or legacy `anon`) key. Never copy or use the `service_role` / secret key.
4. **Authentication → URL Configuration**: set **Site URL** to your Vercel URL (e.g. `https://cineotaku.vercel.app`) and add it plus your custom domain, and `http://localhost:3000`, to **Redirect URLs**. Password-reset and confirmation emails depend on this.
5. **Authentication → Providers → Email**: keep enabled. Decide whether "Confirm email" is on (recommended). Configure a custom SMTP before launch; Supabase's built-in mailer is heavily rate limited.
6. *(Optional) Google login:* create an OAuth client in Google Cloud Console, add the Supabase callback URL shown in **Providers → Google**, paste client ID/secret into Supabase, then set `GOOGLE_AUTH_ENABLED=true` in Vercel. Until then the Google button stays hidden.
7. **Storage** → the `avatars` bucket is created by the SQL (public read, 2 MB, JPG/PNG/WebP, users may write only in their own `<user-id>/` folder).

### Create your first admin
1. Open your deployed site and sign up with the email you want to use as admin (confirm the email if required).
2. In the Supabase SQL Editor run (replace the email):
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Sign in at `/admin`. This is deliberately a manual step: no API call can grant or change roles.

## 3. GitHub
```bash
cd cineotaku
git init
git add .
git commit -m "Initial CineOtaku"
git branch -M main
git remote add origin https://github.com/<you>/cineotaku.git
git push -u origin main
```
`.gitignore` already excludes `.env*`. Never commit secrets.

## 4. Deploy on Vercel
1. <https://vercel.com/new> → import the GitHub repository. **Framework preset: Other.** Leave build command and output directory empty.
2. **Settings → Environment Variables** (Production + Preview):

   | Name | Value | Exposed to browser? |
   |---|---|---|
   | `TMDB_READ_ACCESS_TOKEN` | TMDb read access token | **No** (server only) |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` | Yes (public) |
   | `SUPABASE_PUBLISHABLE_KEY` | publishable / anon key | Yes (public, protected by RLS) |
   | `GOOGLE_AUTH_ENABLED` | `true` only if configured | flag |

3. **Deploy** (or redeploy after changing variables).
4. Open the site, then `/admin`. In the admin: *Add from TMDb* → add a title → *Publish* → *Provider links* to attach authorised sources.

Local development: `npm i -g vercel`, copy `.env.example` to `.env.local`, run `vercel dev`.

## Security model
- **Secrets:** the TMDb token exists only in Vercel env and is used in `api/tmdb.js`. `api/config.js` publishes only the Supabase URL + publishable key and refuses to publish a `service_role`/`sb_secret_` key.
- **TMDb proxy:** GET only, endpoint allow-list, parameter allow-list/validation, adult content forced off, 8 s timeout, edge caching.
- **RLS on every table.** Users can touch only their own `watchlist` and `watch_history`; `profiles` allows updating only `display_name` and `avatar_url` (column grants + trigger make role escalation impossible via the API). Catalog, seasons, episodes and `stream_sources` are writable only when `public.is_admin()` is true, evaluated inside Postgres. Hiding admin buttons is not the security boundary.
- Public can read only **published** catalog data and **active** links of published titles. Provider URLs must be `https://` (DB constraint).
- **Browser hardening:** strict CSP (no inline script/style), HSTS, `X-Frame-Options: DENY`, Referrer/Permissions policies. Embedded providers run in a sandboxed iframe **without** `allow-popups`/top-navigation.
- **Legal:** only add links you own or are licensed/permitted to distribute. The project contains no scraping, no DRM bypass and no signed-CDN extraction. The MovieBox-Tui source was reviewed only for ideas (provider organisation, history/favourites model, search UX); none of its scraping/stream-extraction code was used.

## Verification status (what was and was not tested)
Tested in the build environment:
- `supabase/schema.sql` runs twice without error on PostgreSQL 16 (with stand-ins for Supabase's `auth`/`storage` schemas), and **55 RLS assertions pass** (`tests/harness/rls_test.sh`): anon/user/admin access, role-escalation attempts, cross-user access, URL constraints, storage folder rules.
- `api/tmdb.js` and `api/config.js` handlers: `node tests/api.test.js`.
- Browser flows in headless Chrome (desktop 1280px and mobile 390px) with the real API handlers and the real CSP header: **71 checks pass** (`tests/harness/`), covering browse/filter/search, auth, password reset, profile, My List, history, episode tracking, admin CRUD, provider links, player sandbox, no console/CSP errors, no horizontal scroll.

**Not tested** (needs your real accounts; no network/credentials were available):
- The real Supabase service (the UI tests used an in-memory stand-in for `supabase-js`, so PostgREST query syntax — e.g. the embedded selects — and Auth emails were not exercised live), real TMDb responses, Google OAuth, email delivery, and an actual Vercel deployment.
- Do the "second account" check after deploying: a normal user must be denied at `/admin` and unable to write to catalog tables.

## Known limitations
- **Watch progress is by episode/title state** (started / completed), not video timestamps: external and embedded providers don't expose playback position to us. The `progress_seconds` column is reserved for a future player.
- Account deletion is not self-service (it would require a service-role key, which this project intentionally never uses). Delete users from the Supabase dashboard; their data cascades.
- `supabase-js` is loaded from jsDelivr (`@2`). For stricter supply-chain control, pin an exact version and add a Subresource Integrity hash in `index.html` and `admin.html`.
- Hash-based routing (`/#/title/movie/123`) is used so no server rewrites are needed.
