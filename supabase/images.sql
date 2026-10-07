-- Run after schema.sql. Illustrations inherit their fiche's campaign visibility.
begin;
alter table compendium.fiches add column if not exists image_path text;
create index if not exists cm_fiches_image on compendium.fiches(image_path) where image_path is not null;
create or replace function compendium.fiche_json(f compendium.fiches) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',f.id,'type',f.type,'name',f.name,'subtitle',f.subtitle,
    'location',f.location,'summary',f.summary,'description',f.description,'published',f.published,
    'imagePath',f.image_path,'updatedAt',f.updated_at,'version',f.version,'annotationCount',
    (select count(*) from compendium.annotations a where a.campaign_id=f.campaign_id and a.fiche_id=f.id));
$$;
create or replace function compendium.can_view_image(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from compendium.fiches f where f.image_path=p_path and (
      compendium.is_mj(f.campaign_id) or (f.published and exists (
        select 1 from public.room_members rm
        join diceforge_v2.campaign_rooms cr on cr.room_code=rm.room_code
        where cr.campaign_id=f.campaign_id and rm.user_id=auth.uid()
      ))
    )
  );
$$;
revoke all on function compendium.can_view_image(text) from public,anon;
grant usage on schema compendium to authenticated;
grant execute on function compendium.can_view_image(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('compendium-images','compendium-images',false,5242880,array['image/jpeg'])
on conflict(id) do nothing;
create policy cm_read_fiche_images on storage.objects for select to authenticated
using(bucket_id='compendium-images' and compendium.can_view_image(name));
notify pgrst,'reload schema';
commit;
