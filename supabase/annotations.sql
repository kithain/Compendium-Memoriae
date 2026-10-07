-- Run after schema.sql, images.sql and deletion.sql.
-- Authors may erase their own message; its place, author and date remain visible.
begin;
alter table compendium.annotations add column if not exists deleted_at timestamptz;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='compendium.annotations'::regclass and conname='cm_annotations_deleted_body'
  ) then
    alter table compendium.annotations add constraint cm_annotations_deleted_body
      check (deleted_at is null or body='Message supprimé par l’utilisateur.');
  end if;
end;
$$;

create or replace function compendium.annotations_json(p_campaign uuid,p_fiche uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'ficheId',a.fiche_id,
    'body',case when a.deleted_at is null then a.body else 'Message supprimé par l’utilisateur.' end,
    'author',a.author,'createdAt',a.created_at,'updatedAt',a.updated_at,'version',a.version,
    'deletedAt',a.deleted_at,'canEdit',a.deleted_at is null and a.author_id=auth.uid(),
    'canDelete',a.deleted_at is null and a.author_id=auth.uid()) order by a.created_at,a.id),'[]'::jsonb)
  from compendium.annotations a where a.campaign_id=p_campaign and a.fiche_id=p_fiche;
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
    if a.deleted_at is not null then raise exception 'Ce message a été supprimé et ne peut plus être modifié' using errcode='42501'; end if;
    update compendium.annotations set body=trim(p_body),updated_at=clock_timestamp(),version=version+1
      where id=p_id and campaign_id=p_campaign and fiche_id=p_fiche;
  end if;
  return jsonb_build_object('annotations',compendium.annotations_json(p_campaign,p_fiche));
end;
$$;

create or replace function public.cm_delete_annotation(p_campaign uuid,p_fiche uuid,p_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); f compendium.fiches; a compendium.annotations; erased_at timestamptz;
begin
  -- Lock the fiche first: withdrawal/deletion cannot race this authorization check.
  select * into f from compendium.fiches where campaign_id=p_campaign and id=p_fiche and deleted_at is null and (mj or published) for share;
  if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
  select * into a from compendium.annotations where id=p_id and campaign_id=p_campaign and fiche_id=p_fiche for update;
  if not found then raise exception 'Annotation indisponible' using errcode='42501'; end if;
  if a.author_id is distinct from auth.uid() then raise exception 'Vous pouvez supprimer uniquement vos messages' using errcode='42501'; end if;
  if p_expected_version is distinct from a.version then raise exception 'Ce message a changé. Actualisez la fiche avant de le supprimer.' using errcode='40001'; end if;
  if a.deleted_at is not null then raise exception 'Ce message a déjà été supprimé' using errcode='42501'; end if;
  erased_at:=clock_timestamp();
  update compendium.annotations set body='Message supprimé par l’utilisateur.',deleted_at=erased_at,updated_at=erased_at,version=version+1
    where id=p_id and campaign_id=p_campaign and fiche_id=p_fiche;
  return jsonb_build_object('annotations',compendium.annotations_json(p_campaign,p_fiche));
end;
$$;

revoke all on function compendium.annotations_json(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cm_save_annotation(uuid,uuid,uuid,integer,text),public.cm_delete_annotation(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.cm_save_annotation(uuid,uuid,uuid,integer,text),public.cm_delete_annotation(uuid,uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
