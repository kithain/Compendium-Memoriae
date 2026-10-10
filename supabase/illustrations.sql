-- Run after schema.sql, images.sql, deletion.sql, annotations.sql and lore-types.sql;
-- if attachments.sql is installed, run this after it too. Attachments are optional.
-- Does not upload or delete Storage files.
-- Public GitHub Pages paths use images/<lore folder>/<ASCII filename>.jpg.
-- Existing private keys (<campaign UUID>_<fiche UUID>.jpg or campaign folders)
-- remain accepted during transition and still require the owning campaign.
begin;
create or replace function public.cm_save_fiche(p_campaign uuid,p_id uuid,p_expected_version integer,p_fiche jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f compendium.fiches; next_image_path text;
begin
  if not compendium.require_access(p_campaign) then raise exception 'Action réservée au MJ' using errcode='42501'; end if;
  perform compendium.validate_fiche(p_fiche);
  if p_id is not null then
    select * into f from compendium.fiches where campaign_id=p_campaign and id=p_id and deleted_at is null for update;
    if not found then raise exception 'Fiche indisponible' using errcode='42501'; end if;
    if p_expected_version is distinct from f.version then raise exception 'La fiche a changé. Votre texte est conservé ; rechargez sa version actuelle.' using errcode='40001'; end if;
  end if;
  -- An older client that omits imagePath preserves the current association.
  next_image_path:=f.image_path;
  if p_fiche ? 'imagePath' then
    if jsonb_typeof(p_fiche->'imagePath')='null' then
      next_image_path:=null;
    elsif jsonb_typeof(p_fiche->'imagePath')='string' then
      next_image_path:=nullif(trim(p_fiche->>'imagePath'),'');
    else
      raise exception 'Le chemin de l’illustration doit être un texte ou vide' using errcode='22023';
    end if;
    if next_image_path is not null then
      if length(next_image_path)>512
        or next_image_path ~ '[[:cntrl:]\\:%?#]'
        or next_image_path ~ '(^|/)\.{1,2}(/|$)|//|/$'
      then raise exception 'Utilisez un chemin d’image relatif, sans lien externe ni traversée de dossier' using errcode='22023'; end if;
      if starts_with(next_image_path,'images/') then
        if next_image_path !~ '^images/(lieux|pnj|factions|cosmogonie|histoire|cultures|savoirs)/[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$'
        then raise exception 'Utilisez images/<catégorie>/<nom-ascii>.jpg pour une illustration publique' using errcode='22023'; end if;
        -- Public repository files are deployed by GitHub, not stored in Supabase.
        -- They can be reused across fiches without granting any private access.
      else
        if not (starts_with(next_image_path,p_campaign::text||'_') or starts_with(next_image_path,p_campaign::text||'/'))
        then raise exception 'Illustration privée indisponible pour cette campagne' using errcode='22023'; end if;
        -- A known legacy association in another campaign must never become readable
        -- through a newly published fiche in this one, even with a misleading key.
        if exists (select 1 from compendium.fiches where image_path=next_image_path and campaign_id<>p_campaign)
        then raise exception 'Illustration indisponible pour cette campagne' using errcode='42501'; end if;
        perform 1 from storage.objects where bucket_id='compendium-images' and name=next_image_path for share;
        if not found then raise exception 'Illustration introuvable dans les images privées de la campagne' using errcode='22023'; end if;
      end if;
    end if;
  end if;
  if p_id is null then
    insert into compendium.fiches(campaign_id,type,name,subtitle,location,summary,description,published,image_path)
      values(p_campaign,p_fiche->>'type',trim(p_fiche->>'name'),trim(p_fiche->>'subtitle'),trim(p_fiche->>'location'),trim(p_fiche->>'summary'),trim(p_fiche->>'description'),(p_fiche->>'published')::boolean,next_image_path)
      returning * into f;
  else
    update compendium.fiches set type=p_fiche->>'type',name=trim(p_fiche->>'name'),subtitle=trim(p_fiche->>'subtitle'),location=trim(p_fiche->>'location'),summary=trim(p_fiche->>'summary'),description=trim(p_fiche->>'description'),published=(p_fiche->>'published')::boolean,image_path=next_image_path,updated_at=clock_timestamp(),version=version+1
      where campaign_id=p_campaign and id=p_id returning * into f;
  end if;
  -- The current serializer includes all lore fields, annotations and attachments.
  -- cm_save_fiche_with_attachments calls this RPC within its existing transaction.
  return jsonb_build_object('fiche',compendium.fiche_json(f));
end;
$$;
revoke all on function public.cm_save_fiche(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.cm_save_fiche(uuid,uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
