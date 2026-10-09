-- Run after schema.sql, images.sql, deletion.sql, annotations.sql and lore-types.sql.
-- Private files are reserved before upload and linked only by a successful save.
begin;

create table if not exists compendium.attachments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references diceforge_v2.campaigns(id),
  author_id uuid not null references auth.users(id),
  target text not null check (target in ('fiche','annotation')),
  fiche_id uuid,
  annotation_id uuid references compendium.annotations(id),
  name text not null check (length(name) between 1 and 160),
  path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif','application/pdf','text/markdown','text/plain')),
  size integer not null check (size between 1 and 2000000),
  created_at timestamptz not null default clock_timestamp(),
  linked boolean not null default false,
  removed_at timestamptz,
  foreign key (campaign_id,fiche_id) references compendium.fiches(campaign_id,id),
  check (target <> 'fiche' or annotation_id is null),
  check (not linked or fiche_id is not null),
  check (not linked or target <> 'annotation' or annotation_id is not null)
);
create index if not exists cm_attachments_fiche on compendium.attachments(campaign_id,fiche_id) where linked and removed_at is null;
create index if not exists cm_attachments_annotation on compendium.attachments(annotation_id) where linked and removed_at is null;
alter table compendium.attachments enable row level security;
revoke all on compendium.attachments from public,anon,authenticated;

create or replace function compendium.attachment_json(a compendium.attachments) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',a.id,'name',a.name,'path',a.path,'mimeType',a.mime_type,'size',a.size);
$$;

create or replace function compendium.can_view_attachment(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from compendium.attachments a
    where a.path=p_path and (
      compendium.is_mj(a.campaign_id) or exists (
        select 1 from public.room_members rm join diceforge_v2.campaign_rooms cr on cr.room_code=rm.room_code
        where cr.campaign_id=a.campaign_id and rm.user_id=auth.uid()
      )
    ) and (
      -- Discarded pending files stay readable by their owner for Storage cleanup.
      (not a.linked and a.author_id=auth.uid() and (
        (a.target='fiche' and compendium.is_mj(a.campaign_id) and (a.fiche_id is null or exists (
          select 1 from compendium.fiches f where f.campaign_id=a.campaign_id and f.id=a.fiche_id and f.deleted_at is null
        ))) or
        (a.target='annotation' and exists (
          select 1 from compendium.fiches f where f.campaign_id=a.campaign_id and f.id=a.fiche_id
          and f.deleted_at is null and (compendium.is_mj(a.campaign_id) or f.published)
        ))
      )) or
      (a.linked and a.removed_at is null and exists (
        select 1 from compendium.fiches f where f.campaign_id=a.campaign_id and f.id=a.fiche_id
        and f.deleted_at is null and (compendium.is_mj(a.campaign_id) or f.published)
      ) and (a.target='fiche' or exists (
        select 1 from compendium.annotations n where n.id=a.annotation_id and n.campaign_id=a.campaign_id
        and n.fiche_id=a.fiche_id and n.deleted_at is null
      )))
    )
  );
$$;

create or replace function compendium.attachment_metadata_matches(p_size integer,p_mime text,p_metadata jsonb,p_final boolean) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(
    (case when p_metadata->>'size' is null then not p_final
      when p_metadata->>'size' ~ '^[0-9]{1,7}$' then (p_metadata->>'size')::integer=p_size
      else false end)
    and (case when p_metadata->>'mimetype' is null then not p_final
      else lower(trim(split_part(p_metadata->>'mimetype',';',1)))=p_mime end),false);
$$;

create or replace function compendium.can_upload_attachment(p_path text,p_metadata jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from compendium.attachments a where a.path=p_path and a.author_id=auth.uid()
    and not a.linked and a.removed_at is null and compendium.can_view_attachment(a.path)
    -- Storage's permission preflight may omit metadata.size; multipart contentLength
    -- includes boundary bytes. Only final Storage metadata.size is authoritative.
    and compendium.attachment_metadata_matches(a.size,a.mime_type,p_metadata,false)
  );
$$;

create or replace function compendium.can_delete_pending_attachment(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from compendium.attachments a where a.path=p_path and a.author_id=auth.uid()
    -- Discard locks the reservation before marking it removed. Requiring that
    -- mark makes cleanup mutually exclusive with sync/linking the same file.
    and not a.linked and a.removed_at is not null and compendium.can_view_attachment(a.path)
  );
$$;

create or replace function compendium.attachments_json(p_campaign uuid,p_fiche uuid,p_annotation uuid,p_target text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(compendium.attachment_json(a) order by a.created_at,a.id),'[]'::jsonb)
  from compendium.attachments a where a.campaign_id=p_campaign and a.fiche_id=p_fiche and a.target=p_target
  and a.annotation_id is not distinct from p_annotation and a.linked and a.removed_at is null
  and compendium.can_view_attachment(a.path);
$$;

create or replace function compendium.fiche_json(f compendium.fiches) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',f.id,'type',f.type,'name',f.name,'subtitle',f.subtitle,
    'location',f.location,'summary',f.summary,'description',f.description,'published',f.published,
    'imagePath',f.image_path,'deletedAt',f.deleted_at,'updatedAt',f.updated_at,'version',f.version,'annotationCount',
    (select count(*) from compendium.annotations a where a.campaign_id=f.campaign_id and a.fiche_id=f.id),
    'attachments',compendium.attachments_json(f.campaign_id,f.id,null,'fiche'));
$$;

create or replace function compendium.annotations_json(p_campaign uuid,p_fiche uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'ficheId',a.fiche_id,
    'body',case when a.deleted_at is null then a.body else 'Message supprimé par l’utilisateur.' end,
    'author',a.author,'createdAt',a.created_at,'updatedAt',a.updated_at,'version',a.version,
    'deletedAt',a.deleted_at,'canEdit',a.deleted_at is null and a.author_id=auth.uid(),
    'canDelete',a.deleted_at is null and a.author_id=auth.uid(),
    'attachments',compendium.attachments_json(p_campaign,p_fiche,a.id,'annotation')) order by a.created_at,a.id),'[]'::jsonb)
  from compendium.annotations a where a.campaign_id=p_campaign and a.fiche_id=p_fiche;
$$;

create or replace function public.cm_prepare_attachment(p_campaign uuid,p_fiche uuid,p_target text,p_name text,p_size integer,p_mime text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); a compendium.attachments; extension text; expected_mime text; file_name text:=trim(p_name);
begin
  if p_target is null or p_target not in ('fiche','annotation') then raise exception 'Destination de fichier invalide' using errcode='22023'; end if;
  if p_target='fiche' and not mj then raise exception 'Action réservée au MJ' using errcode='42501'; end if;
  if p_fiche is null and p_target='annotation' then raise exception 'Fiche indisponible' using errcode='42501'; end if;
  if p_fiche is not null then
    perform 1 from compendium.fiches where campaign_id=p_campaign and id=p_fiche and deleted_at is null and (mj or published) for share;
    if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
  end if;
  if file_name is null or length(file_name) not between 1 and 160 or file_name ~ '[[:cntrl:]/\\]' then
    raise exception 'Nom de fichier invalide' using errcode='22023';
  end if;
  if p_size is null or p_size not between 1 and 2000000 then raise exception 'Chaque fichier doit peser au maximum 2 Mo' using errcode='22023'; end if;
  extension:=lower(substring(file_name from '\.([^.]+)$'));
  expected_mime:=case extension when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
    when 'gif' then 'image/gif' when 'webp' then 'image/webp' when 'bmp' then 'image/bmp' when 'avif' then 'image/avif'
    when 'pdf' then 'application/pdf' when 'md' then 'text/markdown' when 'txt' then 'text/plain' else null end;
  if expected_mime is null or p_mime is distinct from expected_mime then
    raise exception 'Format accepté : image, PDF, Markdown (.md) ou texte (.txt)' using errcode='22023';
  end if;
  a.id:=gen_random_uuid();
  insert into compendium.attachments(id,campaign_id,author_id,target,fiche_id,name,path,mime_type,size)
    values(a.id,p_campaign,auth.uid(),p_target,p_fiche,file_name,p_campaign::text||'/'||a.id::text||'.'||extension,expected_mime,p_size)
    returning * into a;
  return compendium.attachment_json(a);
end;
$$;

create or replace function public.cm_discard_attachment(p_campaign uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a compendium.attachments;
begin
  perform compendium.require_access(p_campaign);
  select * into a from compendium.attachments where campaign_id=p_campaign and id=p_id for update;
  if not found or a.author_id is distinct from auth.uid() or a.linked then raise exception 'Fichier indisponible' using errcode='42501'; end if;
  update compendium.attachments set removed_at=coalesce(removed_at,clock_timestamp()) where id=a.id;
  return jsonb_build_object('discarded',true);
end;
$$;

create or replace function compendium.sync_attachments(p_campaign uuid,p_fiche uuid,p_annotation uuid,p_target text,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare attachment_ids uuid[]:=coalesce(p_ids,array[]::uuid[]); a compendium.attachments; attachment_id uuid; object_metadata jsonb;
begin
  if cardinality(attachment_ids)>10 or cardinality(attachment_ids)<>(select count(distinct x) from unnest(attachment_ids) x)
  then raise exception 'Au maximum 10 fichiers distincts par fiche ou message' using errcode='22023'; end if;
  -- Parent fiche/message is locked by the saving RPC. Lock reservations in a fixed
  -- order; a simultaneous discard/delete cannot race a successful link.
  for attachment_id in select x from unnest(attachment_ids) x order by x loop
    select * into a from compendium.attachments where id=attachment_id for update;
    if not found or a.campaign_id<>p_campaign or a.author_id is distinct from auth.uid() or a.target<>p_target or a.removed_at is not null
      or (a.fiche_id is not null and a.fiche_id<>p_fiche)
      or (a.linked and (a.fiche_id is distinct from p_fiche or a.annotation_id is distinct from p_annotation))
      or (not a.linked and a.annotation_id is not null)
    then raise exception 'Fichier indisponible' using errcode='42501'; end if;
    select metadata into object_metadata from storage.objects where bucket_id='compendium-attachments' and name=a.path for share;
    if not found or not compendium.attachment_metadata_matches(a.size,a.mime_type,object_metadata,true)
    then raise exception 'Le fichier n’a pas été déposé ou ne correspond pas au fichier annoncé' using errcode='22023'; end if;
    update compendium.attachments set fiche_id=p_fiche,annotation_id=p_annotation,linked=true where id=a.id;
  end loop;
  -- Unlinked historical objects remain private and cannot be overwritten/reused.
  update compendium.attachments set removed_at=clock_timestamp()
    where campaign_id=p_campaign and fiche_id=p_fiche and target=p_target and annotation_id is not distinct from p_annotation
    and linked and removed_at is null and not (id=any(attachment_ids));
end;
$$;

create or replace function public.cm_save_fiche_with_attachments(p_campaign uuid,p_id uuid,p_expected_version integer,p_fiche jsonb,p_attachment_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; saved_id uuid; f compendium.fiches;
begin
  result:=public.cm_save_fiche(p_campaign,p_id,p_expected_version,p_fiche);
  saved_id:=(result->'fiche'->>'id')::uuid;
  perform compendium.sync_attachments(p_campaign,saved_id,null,'fiche',p_attachment_ids);
  select * into f from compendium.fiches where campaign_id=p_campaign and id=saved_id;
  return jsonb_build_object('fiche',compendium.fiche_json(f));
end;
$$;

create or replace function public.cm_save_annotation_with_attachments(p_campaign uuid,p_fiche uuid,p_id uuid,p_expected_version integer,p_body text,p_attachment_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mj boolean:=compendium.require_access(p_campaign); f compendium.fiches; a compendium.annotations; saved_id uuid;
begin
  if p_body is null or length(trim(p_body)) not between 1 and 6000 then raise exception 'Annotation vide ou trop longue' using errcode='22023'; end if;
  select * into f from compendium.fiches where campaign_id=p_campaign and id=p_fiche and deleted_at is null and (mj or published) for share;
  if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
  if p_id is null then
    insert into compendium.annotations(campaign_id,fiche_id,body,author_id,author)
      values(p_campaign,p_fiche,trim(p_body),auth.uid(),compendium.display_name(p_campaign)) returning id into saved_id;
  else
    select * into a from compendium.annotations where id=p_id and campaign_id=p_campaign and fiche_id=p_fiche for update;
    if not found then raise exception 'Annotation indisponible' using errcode='42501'; end if;
    if a.author_id is distinct from auth.uid() then raise exception 'Vous pouvez modifier uniquement vos annotations' using errcode='42501'; end if;
    if p_expected_version is distinct from a.version then raise exception 'Cette annotation a changé. Votre texte est conservé.' using errcode='40001'; end if;
    if a.deleted_at is not null then raise exception 'Ce message a été supprimé et ne peut plus être modifié' using errcode='42501'; end if;
    update compendium.annotations set body=trim(p_body),updated_at=clock_timestamp(),version=version+1 where id=a.id;
    saved_id:=a.id;
  end if;
  perform compendium.sync_attachments(p_campaign,p_fiche,saved_id,'annotation',p_attachment_ids);
  return jsonb_build_object('annotations',compendium.annotations_json(p_campaign,p_fiche));
end;
$$;

revoke all on function compendium.attachment_json(compendium.attachments),compendium.attachments_json(uuid,uuid,uuid,text),
  compendium.attachment_metadata_matches(integer,text,jsonb,boolean),compendium.sync_attachments(uuid,uuid,uuid,text,uuid[]),
  compendium.fiche_json(compendium.fiches),compendium.annotations_json(uuid,uuid) from public,anon,authenticated;
revoke all on function compendium.can_view_attachment(text),compendium.can_upload_attachment(text,jsonb),compendium.can_delete_pending_attachment(text) from public,anon,authenticated;
grant usage on schema compendium to authenticated;
grant execute on function compendium.can_view_attachment(text),compendium.can_upload_attachment(text,jsonb),compendium.can_delete_pending_attachment(text) to authenticated;
revoke all on function public.cm_prepare_attachment(uuid,uuid,text,text,integer,text),public.cm_discard_attachment(uuid,uuid),
  public.cm_save_fiche_with_attachments(uuid,uuid,integer,jsonb,uuid[]),public.cm_save_annotation_with_attachments(uuid,uuid,uuid,integer,text,uuid[]) from public,anon,authenticated;
grant execute on function public.cm_prepare_attachment(uuid,uuid,text,text,integer,text),public.cm_discard_attachment(uuid,uuid),
  public.cm_save_fiche_with_attachments(uuid,uuid,integer,jsonb,uuid[]),public.cm_save_annotation_with_attachments(uuid,uuid,uuid,integer,text,uuid[]) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('compendium-attachments','compendium-attachments',false,2000000,
  array['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif','application/pdf','text/markdown','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists cm_read_attachments on storage.objects;
create policy cm_read_attachments on storage.objects for select to authenticated
  using(bucket_id='compendium-attachments' and compendium.can_view_attachment(name));
drop policy if exists cm_upload_attachments on storage.objects;
create policy cm_upload_attachments on storage.objects for insert to authenticated
  with check(bucket_id='compendium-attachments' and compendium.can_upload_attachment(name,metadata));
drop policy if exists cm_delete_pending_attachments on storage.objects;
create policy cm_delete_pending_attachments on storage.objects for delete to authenticated
  using(bucket_id='compendium-attachments' and compendium.can_delete_pending_attachment(name));
-- No UPDATE policy: an object can never be replaced using upsert.
grant select,insert,delete on storage.objects to authenticated;
notify pgrst,'reload schema';
commit;
