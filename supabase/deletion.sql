-- Run after schema.sql and images.sql. Recoverable deletion; no content is purged.
begin;
alter table compendium.fiches add column if not exists deleted_at timestamptz;
create index if not exists cm_deleted_fiches on compendium.fiches(campaign_id,deleted_at desc) where deleted_at is not null;
create or replace function compendium.fiche_json(f compendium.fiches) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',f.id,'type',f.type,'name',f.name,'subtitle',f.subtitle,
    'location',f.location,'summary',f.summary,'description',f.description,'published',f.published,
    'imagePath',f.image_path,'deletedAt',f.deleted_at,'updatedAt',f.updated_at,'version',f.version,'annotationCount',
    (select count(*) from compendium.annotations a where a.campaign_id=f.campaign_id and a.fiche_id=f.id));
$$;

create or replace function compendium.can_view_image(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from compendium.fiches f where f.image_path=p_path and f.deleted_at is null and (
      compendium.is_mj(f.campaign_id) or (f.published and exists (
        select 1 from public.room_members rm
        join diceforge_v2.campaign_rooms cr on cr.room_code=rm.room_code
        where cr.campaign_id=f.campaign_id and rm.user_id=auth.uid()
      ))
    )
  );
$$;

create or replace function public.cm_list_fiches(p_campaign uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); result jsonb;
begin
  select coalesce(jsonb_agg(compendium.fiche_json(f) order by f.name,f.id),'[]'::jsonb) into result
    from compendium.fiches f where f.campaign_id=p_campaign and f.deleted_at is null and (mj or f.published);
  return jsonb_build_object('fiches',result);
end;
$$;

create or replace function public.cm_get_fiche(p_campaign uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); f compendium.fiches;
begin
  select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id and deleted_at is null and (mj or published);
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
    select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id and deleted_at is null for update;
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
  select * into f from compendium.fiches where campaign_id=p_campaign and id=p_fiche and deleted_at is null and (mj or published) for share;
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

create or replace function public.cm_list_deleted_fiches(p_campaign uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not compendium.require_access(p_campaign) then raise exception 'Corbeille réservée au MJ' using errcode='42501'; end if;
 select coalesce(jsonb_agg(compendium.fiche_json(f) order by f.deleted_at desc,f.id),'[]'::jsonb) into result
 from compendium.fiches f where f.campaign_id=p_campaign and f.deleted_at is not null;
 return jsonb_build_object('fiches',result);
end;$$;

create or replace function public.cm_delete_fiche(p_campaign uuid,p_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f compendium.fiches;
begin
 if not compendium.require_access(p_campaign) then raise exception 'Suppression réservée au MJ' using errcode='42501'; end if;
 select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id and deleted_at is null for update;
 if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
 if p_expected_version is distinct from f.version then raise exception 'La fiche a changé. Actualisez-la avant de la supprimer.' using errcode='40001'; end if;
 update compendium.fiches set deleted_at=clock_timestamp(),published=false,updated_at=clock_timestamp(),version=version+1
 where campaign_id=p_campaign and id=p_id returning * into f;
 return jsonb_build_object('fiche',compendium.fiche_json(f));
end;$$;

create or replace function public.cm_restore_fiche(p_campaign uuid,p_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f compendium.fiches;
begin
 if not compendium.require_access(p_campaign) then raise exception 'Restauration réservée au MJ' using errcode='42501'; end if;
 select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id and deleted_at is not null for update;
 if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
 if p_expected_version is distinct from f.version then raise exception 'La fiche a changé. Actualisez la corbeille avant de la restaurer.' using errcode='40001'; end if;
 update compendium.fiches set deleted_at=null,published=false,updated_at=clock_timestamp(),version=version+1
 where campaign_id=p_campaign and id=p_id returning * into f;
 return jsonb_build_object('fiche',compendium.fiche_json(f));
end;$$;
revoke all on function public.cm_list_deleted_fiches(uuid),public.cm_delete_fiche(uuid,uuid,integer),public.cm_restore_fiche(uuid,uuid,integer) from public,anon;
grant execute on function public.cm_list_deleted_fiches(uuid),public.cm_delete_fiche(uuid,uuid,integer),public.cm_restore_fiche(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
