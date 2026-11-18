#!/bin/bash
# Runs RLS assertions against the local Postgres. Each case: expect pass/fail.
P="psql -h /tmp -p 54329 -U postgres -d cine -v ON_ERROR_STOP=0 -q -t -A"
A=aaaaaaaa-0000-0000-0000-000000000001; B=bbbbbbbb-0000-0000-0000-000000000002; C=cccccccc-0000-0000-0000-000000000003
$P <<SQL >/dev/null
truncate public.stream_sources, public.episodes, public.seasons, public.catalog, public.watchlist, public.watch_history restart identity cascade;
delete from auth.users;
insert into auth.users(id,email) values ('$A','a@x.com'),('$B','b@x.com'),('$C','c@x.com');
update public.profiles set role='admin' where id='$C';
insert into public.catalog(tmdb_id,media_type,title,is_published) values (1,'movie','Pub Movie',true),(2,'tv','Pub Series',true),(3,'movie','Draft Movie',false);
insert into public.seasons(catalog_id,season_number) values (2,1);
insert into public.episodes(season_id,episode_number,name) values (1,1,'Ep1');
insert into public.stream_sources(catalog_id,provider_name,url,is_active) values (1,'Prov Active','https://ok.example/a',true),(1,'Prov Off','https://ok.example/b',false),(3,'Prov Draft','https://ok.example/c',true);
SQL
pass=0; fail=0
# t "name" role uid expected(ok|deny|N rows) "sql"
t() {
  local name="$1" role="$2" uid="$3" expect="$4" sql="$5" out
  out=$($P 2>&1 <<SQL
begin;
set local role $role;
select set_config('request.jwt.claims', '{"sub":"$uid"}', true);
$sql
rollback;
SQL
)
  local got
  if echo "$out" | grep -qiE 'ERROR|permission denied|violates row-level'; then got=deny
  else got=$(echo "$out" | grep -v -E '^(BEGIN|SET|ROLLBACK|)$' | grep -v '^{"sub"' | tail -1); fi
  # normalize: 'rows=N' style via select count
  if [ "$got" == "$expect" ]; then pass=$((pass+1)); echo "PASS  $name"; else fail=$((fail+1)); echo "FAIL  $name (expected '$expect', got '$got')"; echo "$out" | head -5; fi
}
N=00000000-0000-0000-0000-000000000000
t "anon sees only published catalog"            anon $N 2 "select count(*) from public.catalog;"
t "admin sees all catalog"                      authenticated $C 3 "select count(*) from public.catalog;"
t "user sees only published catalog"            authenticated $A 2 "select count(*) from public.catalog;"
t "anon cannot insert catalog"                  anon $N deny "insert into public.catalog(tmdb_id,media_type,title) values (9,'movie','x');"
t "user cannot insert catalog"                  authenticated $A deny "insert into public.catalog(tmdb_id,media_type,title) values (9,'movie','x');"
t "user cannot update catalog (0 rows)"         authenticated $A 0 "with u as (update public.catalog set title='hacked' where id=1 returning 1) select count(*) from u;"
t "user cannot delete catalog (0 rows)"         authenticated $A 0 "with d as (delete from public.catalog where id=1 returning 1) select count(*) from d;"
t "admin can insert catalog"                    authenticated $C 1 "with i as (insert into public.catalog(tmdb_id,media_type,title) values (9,'movie','x') returning 1) select count(*) from i;"
t "admin can update catalog"                    authenticated $C 1 "with u as (update public.catalog set is_featured=true where id=1 returning 1) select count(*) from u;"
t "admin can delete catalog"                    authenticated $C 1 "with d as (delete from public.catalog where id=3 returning 1) select count(*) from d;"
t "is_admin true for admin"                     authenticated $C t "select public.is_admin();"
t "is_admin false for user"                     authenticated $A f "select public.is_admin();"
t "is_admin false for anon"                     anon $N f "select public.is_admin();"
t "user sees only own profile"                  authenticated $A 1 "select count(*) from public.profiles;"
t "admin sees all profiles"                     authenticated $C 3 "select count(*) from public.profiles;"
t "anon cannot read profiles"                   anon $N deny "select count(*) from public.profiles;"
t "user can update own display_name"            authenticated $A 1 "with u as (update public.profiles set display_name='New' where id='$A' returning 1) select count(*) from u;"
t "user can update own avatar_url"              authenticated $A 1 "with u as (update public.profiles set avatar_url='https://x.supabase.co/a.png' where id='$A' returning 1) select count(*) from u;"
t "user cannot set non-https avatar"            authenticated $A deny "update public.profiles set avatar_url='javascript:alert(1)' where id='$A';"
t "user cannot escalate own role"               authenticated $A deny "update public.profiles set role='admin' where id='$A';"
t "user cannot update other profile (0 rows)"   authenticated $A 0 "with u as (update public.profiles set display_name='x' where id='$B' returning 1) select count(*) from u;"
t "admin cannot change roles via API either"    authenticated $C deny "update public.profiles set role='admin' where id='$B';"
t "user cannot insert profile"                  authenticated $A deny "insert into public.profiles(id,display_name) values (gen_random_uuid(),'x');"
t "role trigger blocks even if grant widened"   postgres $A deny "grant update(role) on public.profiles to authenticated; set local role authenticated; update public.profiles set role='admin' where id='$A';"
t "user inserts own watchlist"                  authenticated $A 1 "with i as (insert into public.watchlist(user_id,tmdb_id,media_type,title) values ('$A',10,'movie','M') returning 1) select count(*) from i;"
t "user cannot insert watchlist for others"     authenticated $A deny "insert into public.watchlist(user_id,tmdb_id,media_type,title) values ('$B',10,'movie','M');"
t "user cannot read others' watchlist"          authenticated $B 0 "insert into public.watchlist(user_id,tmdb_id,media_type,title) values ('$B',11,'movie','M'); select count(*) from public.watchlist where user_id='$A';"
t "anon cannot read watchlist"                  anon $N deny "select * from public.watchlist;"
t "user inserts movie history"                  authenticated $A 1 "with i as (insert into public.watch_history(user_id,tmdb_id,media_type,title,progress_seconds) values ('$A',1,'movie','M',100) returning 1) select count(*) from i;"
t "user inserts episode history"                authenticated $A 1 "with i as (insert into public.watch_history(user_id,tmdb_id,media_type,title,season_number,episode_number,completed) values ('$A',2,'tv','S',1,3,true) returning 1) select count(*) from i;"
t "movie history rejects season>0"              authenticated $A deny "insert into public.watch_history(user_id,tmdb_id,media_type,title,season_number) values ('$A',1,'movie','M',1);"
t "history rejects negative progress"           authenticated $A deny "insert into public.watch_history(user_id,tmdb_id,media_type,title,progress_seconds) values ('$A',1,'movie','M',-5);"
t "history for other user denied"               authenticated $A deny "insert into public.watch_history(user_id,tmdb_id,media_type,title) values ('$B',1,'movie','M');"
t "history upsert on conflict works"            authenticated $A 1 "insert into public.watch_history(user_id,tmdb_id,media_type,title,season_number,episode_number) values ('$A',2,'tv','S',1,1); with u as (insert into public.watch_history(user_id,tmdb_id,media_type,title,season_number,episode_number,completed) values ('$A',2,'tv','S',1,1,true) on conflict (user_id,tmdb_id,media_type,season_number,episode_number) do update set completed=excluded.completed returning 1) select count(*) from u;"
t "anon sees only active+published sources"     anon $N 1 "select count(*) from public.stream_sources;"
t "admin sees all sources"                      authenticated $C 3 "select count(*) from public.stream_sources;"
t "user cannot insert source"                   authenticated $A deny "insert into public.stream_sources(catalog_id,provider_name,url) values (1,'Evil','https://evil.example');"
t "user cannot update source (0 rows)"          authenticated $A 0 "with u as (update public.stream_sources set is_active=true where id=2 returning 1) select count(*) from u;"
t "admin inserts source"                        authenticated $C 1 "with i as (insert into public.stream_sources(catalog_id,episode_id,provider_name,url,link_type) values (2,1,'Prov','https://ok.example/ep','embed') returning 1) select count(*) from i;"
t "admin toggles source"                        authenticated $C 1 "with u as (update public.stream_sources set is_active=true where id=2 returning 1) select count(*) from u;"
t "source rejects http url"                     authenticated $C deny "insert into public.stream_sources(catalog_id,provider_name,url) values (1,'Prov','http://insecure.example');"
t "source rejects javascript url"               authenticated $C deny "insert into public.stream_sources(catalog_id,provider_name,url) values (1,'Prov','javascript:alert(1)');"
t "source rejects url with spaces"              authenticated $C deny "insert into public.stream_sources(catalog_id,provider_name,url) values (1,'Prov','https://a.example/x y');"
t "anon reads seasons of published series"      anon $N 1 "select count(*) from public.seasons;"
t "anon reads episodes of published series"     anon $N 1 "select count(*) from public.episodes;"
t "user cannot insert season"                   authenticated $A deny "insert into public.seasons(catalog_id,season_number) values (2,2);"
t "admin inserts season for tv"                 authenticated $C 1 "with i as (insert into public.seasons(catalog_id,season_number) values (2,2) returning 1) select count(*) from i;"
t "season for a movie rejected"                 authenticated $C deny "insert into public.seasons(catalog_id,season_number) values (1,1);"
t "user cannot insert episode"                  authenticated $A deny "insert into public.episodes(season_id,episode_number) values (1,9);"
t "admin inserts episode"                       authenticated $C 1 "with i as (insert into public.episodes(season_id,episode_number) values (1,9) returning 1) select count(*) from i;"
t "unpublish hides seasons from anon"           postgres $N 0 "update public.catalog set is_published=false where id=2; set local role anon; select count(*) from public.seasons;"
t "avatar upload to own folder allowed"         authenticated $A 1 "with i as (insert into storage.objects(bucket_id,name) values ('avatars','$A/me.png') returning 1) select count(*) from i;"
t "avatar upload to other folder denied"        authenticated $A deny "insert into storage.objects(bucket_id,name) values ('avatars','$B/me.png');"
t "upload to other bucket denied"               authenticated $A deny "insert into storage.objects(bucket_id,name) values ('secrets','$A/me.png');"
t "deleting auth user cascades private data"    postgres $A 0 "insert into public.watchlist(user_id,tmdb_id,media_type,title) values ('$A',77,'movie','Z'); delete from auth.users where id='$A'; select count(*) from public.watchlist where user_id='$A' union all select count(*) from public.profiles where id='$A' limit 1;"
echo "---- $pass passed, $fail failed"
