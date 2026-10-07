-- Additive Compendium schema for the existing Dice-Forge production project.
-- No campaign content, account password or administrative key belongs here.
begin;
create schema if not exists compendium;
revoke all on schema compendium from public, anon, authenticated;

create table if not exists compendium.fiches (
  campaign_id uuid not null references diceforge_v2.campaigns(id),
  id uuid not null default gen_random_uuid(),
  type text not null check (type in ('place','npc')),
  name text not null check (length(trim(name)) between 1 and 160),
  subtitle text not null default '' check (length(subtitle)<=160),
  location text not null default '' check (length(location)<=160),
  summary text not null check (length(trim(summary)) between 1 and 300),
  description text not null default '' check (length(description)<=6000),
  published boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  version integer not null default 1 check (version>0),
  primary key (campaign_id,id)
);
create index if not exists cm_fiches_campaign_published on compendium.fiches(campaign_id,published,name);
create table if not exists compendium.annotations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  fiche_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 6000),
  author_id uuid not null references auth.users(id),
  author text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  version integer not null default 1 check (version>0),
  foreign key (campaign_id,fiche_id) references compendium.fiches(campaign_id,id)
);
create index if not exists cm_annotations_fiche on compendium.annotations(campaign_id,fiche_id,created_at,id);
alter table compendium.fiches enable row level security;
alter table compendium.annotations enable row level security;
revoke all on all tables in schema compendium from public, anon, authenticated;

create or replace function compendium.is_mj(p_campaign uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from diceforge_v2.campaigns c
    join diceforge_v2.mj_users m on m.user_id=c.owner_user_id
    where c.id=p_campaign and c.owner_user_id=auth.uid()
  );
$$;
create or replace function compendium.require_access(p_campaign uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare mj boolean:=compendium.is_mj(p_campaign);
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  if not mj and not exists (
    select 1 from public.room_members rm
    join diceforge_v2.campaign_rooms cr on cr.room_code=rm.room_code
    where cr.campaign_id=p_campaign and rm.user_id=auth.uid()
  ) then raise exception 'Rejoignez un salon de cette campagne dans Dice-Forge' using errcode='42501'; end if;
  return mj;
end;
$$;
create or replace function compendium.display_name(p_campaign uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select nullif(max(rm.player_name),'') from public.room_members rm
     join diceforge_v2.campaign_rooms cr on cr.room_code=rm.room_code
     where cr.campaign_id=p_campaign and rm.user_id=auth.uid()),
    (select nullif(u.raw_user_meta_data->>'player_name','') from auth.users u where u.id=auth.uid()),
    (select split_part(u.email,'@',1) from auth.users u where u.id=auth.uid()),
    'Joueur'
  );
$$;
create or replace function compendium.fiche_json(f compendium.fiches) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',f.id,'type',f.type,'name',f.name,'subtitle',f.subtitle,
    'location',f.location,'summary',f.summary,'description',f.description,'published',f.published,
    'updatedAt',f.updated_at,'version',f.version,'annotationCount',
    (select count(*) from compendium.annotations a where a.campaign_id=f.campaign_id and a.fiche_id=f.id));
$$;
create or replace function compendium.annotations_json(p_campaign uuid,p_fiche uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'ficheId',a.fiche_id,'body',a.body,
    'author',a.author,'createdAt',a.created_at,'updatedAt',a.updated_at,'version',a.version,
    'canEdit',a.author_id=auth.uid()) order by a.created_at,a.id),'[]'::jsonb)
  from compendium.annotations a where a.campaign_id=p_campaign and a.fiche_id=p_fiche;
$$;
create or replace function compendium.validate_fiche(p_fiche jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare k text; limit_length integer;
begin
  if jsonb_typeof(p_fiche) is distinct from 'object' or
     p_fiche->>'type' is null or p_fiche->>'type' not in ('place','npc') or
     jsonb_typeof(p_fiche->'published') is distinct from 'boolean'
  then raise exception 'Fiche invalide' using errcode='22023'; end if;
  for k,limit_length in select * from (values ('name',160),('subtitle',160),('location',160),('summary',300),('description',6000)) v loop
    if jsonb_typeof(p_fiche->k) is distinct from 'string' or length(p_fiche->>k)>limit_length
    then raise exception 'Champ invalide : %',k using errcode='22023'; end if;
  end loop;
  if length(trim(p_fiche->>'name'))=0 or length(trim(p_fiche->>'summary'))=0
  then raise exception 'Nom et présentation requis' using errcode='22023'; end if;
end;
$$;

create or replace function public.cm_context(p_room text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare campaign uuid; mj boolean; campaign_name text;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  select c.id,c.name into campaign,campaign_name from diceforge_v2.campaign_rooms cr
    join diceforge_v2.campaigns c on c.id=cr.campaign_id where cr.room_code=upper(trim(p_room));
  if campaign is null then raise exception 'Salon sans campagne' using errcode='42501'; end if;
  mj:=compendium.require_access(campaign);
  return jsonb_build_object('campaignId',campaign,'campaignName',campaign_name,'isGM',mj,'userName',compendium.display_name(campaign));
end;
$$;
create or replace function public.cm_list_fiches(p_campaign uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); result jsonb;
begin
  select coalesce(jsonb_agg(compendium.fiche_json(f) order by f.name,f.id),'[]'::jsonb) into result
    from compendium.fiches f where f.campaign_id=p_campaign and (mj or f.published);
  return jsonb_build_object('fiches',result);
end;
$$;
create or replace function public.cm_get_fiche(p_campaign uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); f compendium.fiches;
begin
  select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id and (mj or published);
  if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
  return jsonb_build_object('fiche',compendium.fiche_json(f),'annotations',compendium.annotations_json(p_campaign,p_id));
end;
$$;
create or replace function public.cm_save_fiche(p_campaign uuid,p_id uuid,p_expected_version integer,p_fiche jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f compendium.fiches;
begin
  if not compendium.require_access(p_campaign) then raise exception 'Action réservée au MJ' using errcode='42501'; end if;
  perform compendium.validate_fiche(p_fiche);
  if p_id is null then
    insert into compendium.fiches(campaign_id,type,name,subtitle,location,summary,description,published)
      values(p_campaign,p_fiche->>'type',trim(p_fiche->>'name'),trim(p_fiche->>'subtitle'),trim(p_fiche->>'location'),trim(p_fiche->>'summary'),trim(p_fiche->>'description'),(p_fiche->>'published')::boolean)
      returning * into f;
  else
    select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id for update;
    if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
    if p_expected_version is distinct from f.version then raise exception 'La fiche a changé. Votre texte est conservé ; rechargez sa version actuelle.' using errcode='40001'; end if;
    update compendium.fiches set type=p_fiche->>'type',name=trim(p_fiche->>'name'),subtitle=trim(p_fiche->>'subtitle'),location=trim(p_fiche->>'location'),summary=trim(p_fiche->>'summary'),description=trim(p_fiche->>'description'),published=(p_fiche->>'published')::boolean,updated_at=clock_timestamp(),version=version+1
      where campaign_id=p_campaign and id=p_id returning * into f;
  end if;
  return jsonb_build_object('fiche',compendium.fiche_json(f));
end;
$$;
create or replace function public.cm_save_annotation(p_campaign uuid,p_fiche uuid,p_id uuid,p_expected_version integer,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); f compendium.fiches; a compendium.annotations;
begin
  if p_body is null or length(trim(p_body)) not between 1 and 6000 then raise exception 'Annotation vide ou trop longue' using errcode='22023'; end if;
  select * into f from compendium.fiches where campaign_id=p_campaign and id=p_fiche and (mj or published) for share;
  if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
  if p_id is null then
    insert into compendium.annotations(campaign_id,fiche_id,body,author_id,author)
      values(p_campaign,p_fiche,trim(p_body),auth.uid(),compendium.display_name(p_campaign));
  else
    select * into a from compendium.annotations where id=p_id and campaign_id=p_campaign and fiche_id=p_fiche for update;
    if not found then raise exception 'Annotation indisponible' using errcode='42501'; end if;
    if a.author_id is distinct from auth.uid() then raise exception 'Vous pouvez modifier uniquement vos annotations' using errcode='42501'; end if;
    if p_expected_version is distinct from a.version then raise exception 'Cette annotation a changé. Votre texte est conservé.' using errcode='40001'; end if;
    update compendium.annotations set body=trim(p_body),updated_at=clock_timestamp(),version=version+1 where id=p_id;
  end if;
  return jsonb_build_object('annotations',compendium.annotations_json(p_campaign,p_fiche));
end;
$$;
create or replace function public.cm_import_fiches(p_campaign uuid,p_fiches jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; changed integer; inserted integer:=0; skipped integer:=0;
begin
  if not compendium.require_access(p_campaign) then raise exception 'Import réservé au MJ' using errcode='42501'; end if;
  if jsonb_typeof(p_fiches) is distinct from 'array' or jsonb_array_length(p_fiches)>1000 then raise exception 'Import invalide' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_fiches) loop
    item:=item||jsonb_build_object('published',false);
    perform compendium.validate_fiche(item);
    insert into compendium.fiches(campaign_id,id,type,name,subtitle,location,summary,description,published)
      values(p_campaign,(item->>'id')::uuid,item->>'type',trim(item->>'name'),trim(item->>'subtitle'),trim(item->>'location'),trim(item->>'summary'),trim(item->>'description'),false)
      on conflict(campaign_id,id) do nothing;
    get diagnostics changed=row_count;
    inserted:=inserted+changed; skipped:=skipped+1-changed;
  end loop;
  return jsonb_build_object('imported',inserted,'skipped',skipped,'total',jsonb_array_length(p_fiches));
end;
$$;
revoke all on all functions in schema compendium from public, anon, authenticated;
revoke all on function public.cm_context(text),public.cm_list_fiches(uuid),public.cm_get_fiche(uuid,uuid),public.cm_save_fiche(uuid,uuid,integer,jsonb),public.cm_save_annotation(uuid,uuid,uuid,integer,text),public.cm_import_fiches(uuid,jsonb) from public,anon;
grant execute on function public.cm_context(text),public.cm_list_fiches(uuid),public.cm_get_fiche(uuid,uuid),public.cm_save_fiche(uuid,uuid,integer,jsonb),public.cm_save_annotation(uuid,uuid,uuid,integer,text),public.cm_import_fiches(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
