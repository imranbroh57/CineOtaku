-- =====================================================================
-- CineOtaku — complete Supabase schema (tables, indexes, triggers, RLS)
-- Run the whole file once in: Supabase Dashboard -> SQL Editor -> New query.
-- It is idempotent: safe to re-run (policies/triggers are dropped and recreated).
--
-- Tables: profiles, catalog, seasons, episodes, watchlist, watch_history, stream_sources
-- Storage: public "avatars" bucket (users may only write inside their own folder)
--
-- SECURITY MODEL
--   * Every table has Row Level Security enabled. Privileges are revoked first and
--     re-granted minimally, so a missing policy means "no access".
--   * Normal users can only read/write THEIR OWN profile (display_name, avatar_url only),
--     watchlist and watch_history rows.
--   * Only profiles.role = 'admin' can write catalog / seasons / episodes / stream_sources.
--     Role is checked in the database via public.is_admin(); hiding buttons in the UI
--     is NOT the security boundary.
--   * Nobody can change a role through the API (column grants + trigger). Promote the
--     first admin manually from the SQL editor (see bottom of this file).
--   * There is no payment, plan, tier, subscription or ad table — by design.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  avatar_url   text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048)),
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.catalog (
  id             bigint generated always as identity primary key,
  tmdb_id        bigint not null,
  media_type     text not null check (media_type in ('movie', 'tv')),
  is_anime       boolean not null default false,
  title          text not null check (char_length(title) between 1 and 300),
  original_title text,
  overview       text,
  poster_path    text,
  backdrop_path  text,
  release_date   date,
  vote_average   numeric(3,1) check (vote_average is null or (vote_average >= 0 and vote_average <= 10)),
  genres         jsonb not null default '[]'::jsonb,
  is_published   boolean not null default false,  -- catalog visibility
  is_featured    boolean not null default false,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

create table if not exists public.seasons (
  id            bigint generated always as identity primary key,
  catalog_id    bigint not null references public.catalog(id) on delete cascade,
  season_number integer not null check (season_number >= 0),
  name          text,
  overview      text,
  poster_path   text,
  air_date      date,
  episode_count integer check (episode_count is null or episode_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (catalog_id, season_number)
);

create table if not exists public.episodes (
  id             bigint generated always as identity primary key,
  season_id      bigint not null references public.seasons(id) on delete cascade,
  episode_number integer not null check (episode_number >= 0),
  name           text,
  overview       text,
  still_path     text,
  runtime        integer check (runtime is null or runtime >= 0),
  air_date       date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (season_id, episode_number)
);

-- Watchlist ("My List"): keyed by TMDb id so users can save any title, not only catalog ones.
create table if not exists public.watchlist (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tmdb_id     bigint not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  title       text not null check (char_length(title) between 1 and 300),
  poster_path text,
  created_at  timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);

-- Watch history / progress / episode tracking.
-- Movies use season_number = 0 and episode_number = 0.
-- Each series episode is one row (unique per user + title + season + episode).
create table if not exists public.watch_history (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  tmdb_id          bigint not null,
  media_type       text not null check (media_type in ('movie', 'tv')),
  title            text not null check (char_length(title) between 1 and 300),
  poster_path      text,
  season_number    integer not null default 0 check (season_number >= 0),
  episode_number   integer not null default 0 check (episode_number >= 0),
  episode_title    text,
  progress_seconds integer not null default 0 check (progress_seconds >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  completed        boolean not null default false,
  last_watched_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  check (media_type = 'tv' or (season_number = 0 and episode_number = 0)),
  unique (user_id, tmdb_id, media_type, season_number, episode_number)
);

-- Authorized provider links. Only add links you own or are licensed to distribute.
create table if not exists public.stream_sources (
  id            bigint generated always as identity primary key,
  catalog_id    bigint not null references public.catalog(id) on delete cascade,
  episode_id    bigint references public.episodes(id) on delete cascade, -- null = whole movie/series
  provider_name text not null check (char_length(btrim(provider_name)) between 2 and 80),
  url           text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2048),
  link_type     text not null default 'external' check (link_type in ('external', 'embed')),
  quality       text check (quality is null or char_length(quality) <= 30),
  language      text check (language is null or char_length(language) <= 30),
  region        text check (region is null or char_length(region) <= 30),
  is_active     boolean not null default false,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. INDEXES (foreign keys + hot query paths)
-- ---------------------------------------------------------------------
create index if not exists catalog_visibility_idx   on public.catalog (is_published, is_featured, created_at desc);
create index if not exists catalog_type_anime_idx   on public.catalog (media_type, is_anime);
create index if not exists catalog_created_by_idx   on public.catalog (created_by);
create index if not exists seasons_catalog_idx      on public.seasons (catalog_id, season_number);
create index if not exists episodes_season_idx      on public.episodes (season_id, episode_number);
create index if not exists watchlist_user_idx       on public.watchlist (user_id, created_at desc);
create index if not exists history_user_recent_idx  on public.watch_history (user_id, last_watched_at desc);
create index if not exists history_user_title_idx   on public.watch_history (user_id, tmdb_id, media_type);
create index if not exists sources_catalog_idx      on public.stream_sources (catalog_id, is_active, sort_order);
create index if not exists sources_episode_idx      on public.stream_sources (episode_id);
create index if not exists sources_created_by_idx   on public.stream_sources (created_by);

-- ---------------------------------------------------------------------
-- 3. FUNCTIONS & TRIGGERS
-- ---------------------------------------------------------------------

-- New auth user -> non-admin profile. Runs as definer so it works with RLS on.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    ), 60),
    case when new.raw_user_meta_data->>'avatar_url' ~ '^https://'
         then left(new.raw_user_meta_data->>'avatar_url', 2048) end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Back-fill profiles for users that already exist.
insert into public.profiles (id, display_name)
select id, left(split_part(coalesce(email, 'user'), '@', 1), 60) from auth.users
on conflict (id) do nothing;

-- Admin check used by RLS and by the admin UI. SECURITY DEFINER avoids RLS recursion on profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Defense in depth: even if a grant is ever widened by mistake, API users cannot change roles.
-- (The SQL editor / postgres / service role have no auth.uid(), so manual promotion still works.)
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and (select auth.uid()) is not null then
    raise exception 'profiles.role cannot be changed through the API' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Seasons may only belong to series; keeps data model honest.
create or replace function public.seasons_require_tv()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.catalog c where c.id = new.catalog_id and c.media_type = 'tv') then
    raise exception 'Seasons can only be added to catalog entries of type tv' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_change on public.profiles;
create trigger profiles_prevent_role_change before update on public.profiles
  for each row execute function public.prevent_role_change();

drop trigger if exists seasons_require_tv_trg on public.seasons;
create trigger seasons_require_tv_trg before insert or update of catalog_id on public.seasons
  for each row execute function public.seasons_require_tv();

do $$
declare t text;
begin
  foreach t in array array['profiles','catalog','seasons','episodes','stream_sources'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.catalog        enable row level security;
alter table public.seasons        enable row level security;
alter table public.episodes       enable row level security;
alter table public.watchlist      enable row level security;
alter table public.watch_history  enable row level security;
alter table public.stream_sources enable row level security;

-- Least privilege first (Supabase default privileges are broad).
revoke all on public.profiles, public.catalog, public.seasons, public.episodes,
              public.watchlist, public.watch_history, public.stream_sources
  from anon, authenticated;

-- Drop old/starter/current policies so the file can be re-run.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','catalog','seasons','episodes','watchlist','watch_history','stream_sources','catalog_entries')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---- profiles: own row only; admins may read all (no role edits via API) ----
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No INSERT/DELETE policy: profiles are created by trigger and removed with the auth user.

-- ---- catalog: everyone reads published; only admins write ----
grant select on public.catalog to anon, authenticated;
grant insert, update, delete on public.catalog to authenticated;
grant usage, select on sequence public.catalog_id_seq to authenticated;

create policy catalog_select_published on public.catalog
  for select to anon, authenticated
  using (is_published = true or (select public.is_admin()));
create policy catalog_admin_insert on public.catalog
  for insert to authenticated with check ((select public.is_admin()));
create policy catalog_admin_update on public.catalog
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy catalog_admin_delete on public.catalog
  for delete to authenticated using ((select public.is_admin()));

-- ---- seasons: visible when parent catalog entry is published ----
grant select on public.seasons to anon, authenticated;
grant insert, update, delete on public.seasons to authenticated;
grant usage, select on sequence public.seasons_id_seq to authenticated;

create policy seasons_select_visible on public.seasons
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.catalog c where c.id = seasons.catalog_id and c.is_published)
  );
create policy seasons_admin_insert on public.seasons
  for insert to authenticated with check ((select public.is_admin()));
create policy seasons_admin_update on public.seasons
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy seasons_admin_delete on public.seasons
  for delete to authenticated using ((select public.is_admin()));

-- ---- episodes: visible when the parent title is published ----
grant select on public.episodes to anon, authenticated;
grant insert, update, delete on public.episodes to authenticated;
grant usage, select on sequence public.episodes_id_seq to authenticated;

create policy episodes_select_visible on public.episodes
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.seasons s join public.catalog c on c.id = s.catalog_id
      where s.id = episodes.season_id and c.is_published
    )
  );
create policy episodes_admin_insert on public.episodes
  for insert to authenticated with check ((select public.is_admin()));
create policy episodes_admin_update on public.episodes
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy episodes_admin_delete on public.episodes
  for delete to authenticated using ((select public.is_admin()));

-- ---- watchlist: strictly own rows ----
grant select, insert, update, delete on public.watchlist to authenticated;
grant usage, select on sequence public.watchlist_id_seq to authenticated;

create policy watchlist_select_own on public.watchlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy watchlist_insert_own on public.watchlist
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy watchlist_update_own on public.watchlist
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy watchlist_delete_own on public.watchlist
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---- watch_history: strictly own rows ----
grant select, insert, update, delete on public.watch_history to authenticated;
grant usage, select on sequence public.watch_history_id_seq to authenticated;

create policy history_select_own on public.watch_history
  for select to authenticated using (user_id = (select auth.uid()));
create policy history_insert_own on public.watch_history
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy history_update_own on public.watch_history
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy history_delete_own on public.watch_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---- stream_sources: active links of published titles are public; admins manage everything ----
grant select on public.stream_sources to anon, authenticated;
grant insert, update, delete on public.stream_sources to authenticated;
grant usage, select on sequence public.stream_sources_id_seq to authenticated;

create policy sources_select_active on public.stream_sources
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or (
      is_active = true
      and exists (select 1 from public.catalog c where c.id = stream_sources.catalog_id and c.is_published)
    )
  );
create policy sources_admin_insert on public.stream_sources
  for insert to authenticated with check ((select public.is_admin()));
create policy sources_admin_update on public.stream_sources
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy sources_admin_delete on public.stream_sources
  for delete to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- 5. STORAGE: public "avatars" bucket, writes only inside <user-id>/ folder
--    (wrapped so the rest of the file still works if Storage is not enabled)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = true,
          file_size_limit = 2097152,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

    drop policy if exists avatars_insert_own on storage.objects;
    drop policy if exists avatars_update_own on storage.objects;
    drop policy if exists avatars_delete_own on storage.objects;

    create policy avatars_insert_own on storage.objects
      for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
    create policy avatars_update_own on storage.objects
      for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
    create policy avatars_delete_own on storage.objects
      for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- FIRST ADMIN (manual, trusted step — never exposed through the API)
--   1. Sign up on your deployed site with the email you want to use as admin.
--   2. Run this in the SQL editor with YOUR email:
--
--      update public.profiles
--         set role = 'admin'
--       where id = (select id from auth.users where email = 'you@example.com');
--
--   3. Sign in at /admin.
-- ---------------------------------------------------------------------
