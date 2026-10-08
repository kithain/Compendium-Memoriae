-- Run on existing installations after their current supplemental scripts.
-- Expand lore categories without replacing visibility, version or deletion RPCs.
begin;
alter table compendium.fiches drop constraint if exists fiches_type_check;
alter table compendium.fiches add constraint fiches_type_check
  check (type in ('place','npc','faction','cosmogony','history','culture','knowledge'));

create or replace function compendium.validate_fiche(p_fiche jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare k text; limit_length integer;
begin
  if jsonb_typeof(p_fiche) is distinct from 'object' or
     p_fiche->>'type' is null or p_fiche->>'type' not in ('place','npc','faction','cosmogony','history','culture','knowledge') or
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
revoke all on function compendium.validate_fiche(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
