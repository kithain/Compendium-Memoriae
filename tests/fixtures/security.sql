-- Synthetic Supabase/Dice Forge dependencies for the in-memory security suite.
-- No connection to the application's real Supabase project is made.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.rooms (
  room_code text primary key,
  owner_id uuid references auth.users(id),
  owner_name text
);
create table public.room_members (
  room_code text references public.rooms(room_code),
  user_id uuid references auth.users(id),
  player_name text,
  primary key (room_code, user_id)
);
create schema diceforge_v2;
create table diceforge_v2.campaigns (
  id uuid primary key,
  name text not null,
  owner_user_id uuid references auth.users(id),
  reference_room text references public.rooms(room_code),
  created_at timestamptz not null default now()
);
create table diceforge_v2.campaign_rooms (
  room_code text primary key references public.rooms(room_code),
  campaign_id uuid not null references diceforge_v2.campaigns(id)
);
create table diceforge_v2.mj_users (
  user_id uuid primary key references auth.users(id)
);
revoke all on schema diceforge_v2 from public, anon, authenticated;
revoke all on all tables in schema diceforge_v2 from public, anon, authenticated;
revoke all on public.rooms, public.room_members from public, anon, authenticated;

insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'synthetic.gm.a@example.invalid', '{"player_name":"Meneur A"}'),
  ('00000000-0000-0000-0000-000000000002', 'synthetic.gm.b@example.invalid', '{"player_name":"Meneur B"}'),
  ('00000000-0000-0000-0000-000000000003', 'synthetic.player.a@example.invalid', '{"player_name":"PJ A", "is_mj":true}'),
  ('00000000-0000-0000-0000-000000000004', 'synthetic.player.b@example.invalid', '{"player_name":"PJ B"}'),
  ('00000000-0000-0000-0000-000000000005', 'synthetic.outsider@example.invalid', '{"player_name":"MJ", "role":"admin"}'),
  ('00000000-0000-0000-0000-000000000006', 'synthetic.other.campaign@example.invalid', '{"player_name":"Autre campagne"}'),
  ('00000000-0000-0000-0000-000000000007', 'synthetic.owner.without.role@example.invalid', '{"player_name":"MJ"}');
insert into public.rooms(room_code, owner_id, owner_name) values
  ('AAAA', '00000000-0000-0000-0000-000000000001', 'Meneur A'),
  ('AAAB', '00000000-0000-0000-0000-000000000001', 'Meneur A'),
  ('BBBB', '00000000-0000-0000-0000-000000000002', 'Meneur B'),
  ('CCCC', '00000000-0000-0000-0000-000000000007', 'MJ');
insert into diceforge_v2.campaigns(id, name, owner_user_id, reference_room) values
  ('10000000-0000-0000-0000-000000000001', 'Campagne synthétique A', '00000000-0000-0000-0000-000000000001', 'AAAA'),
  ('10000000-0000-0000-0000-000000000002', 'Campagne synthétique B', '00000000-0000-0000-0000-000000000002', 'BBBB'),
  ('10000000-0000-0000-0000-000000000003', 'Campagne synthétique sans MJ', '00000000-0000-0000-0000-000000000007', 'CCCC');
insert into diceforge_v2.campaign_rooms values
  ('AAAA', '10000000-0000-0000-0000-000000000001'),
  ('AAAB', '10000000-0000-0000-0000-000000000001'),
  ('BBBB', '10000000-0000-0000-0000-000000000002'),
  ('CCCC', '10000000-0000-0000-0000-000000000003');
insert into diceforge_v2.mj_users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
-- The GMs intentionally have no room membership: ownership and the role suffice.
-- Player B is in a different session of A; notes must remain campaign-wide.
insert into public.room_members values
  ('AAAA', '00000000-0000-0000-0000-000000000003', 'Joueur A vérifié'),
  ('AAAB', '00000000-0000-0000-0000-000000000004', 'Joueur B vérifié'),
  ('BBBB', '00000000-0000-0000-0000-000000000006', 'Autre campagne'),
  ('CCCC', '00000000-0000-0000-0000-000000000007', 'MJ');
