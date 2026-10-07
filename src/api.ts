import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config';
import type {Fiche,FicheDraft,Annotation} from './lib/fiches';

export const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
  auth:{storageKey:'compendium-memoriae-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
});
export type CampaignContext={campaignId:string;campaignName:string;isGM:boolean;userName:string};
export type CompendiumApi={
  loadImage(path:string):Promise<Blob>;
  listFiches():Promise<Fiche[]>;
  getFiche(id:string):Promise<{fiche:Fiche;annotations:Annotation[]}>;
  saveFiche(draft:FicheDraft,id?:string,version?:number):Promise<Fiche>;
  saveAnnotation(input:{ficheId:string;id?:string;body:string;version?:number}):Promise<Annotation[]>;
};
export function playerEmail(name:string){
  const value=name.trim();
  if(value.includes('@'))return value.toLowerCase();
  const slug=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'');
  if(!slug)throw new Error('Entre ton nom de joueur.');
  return `${slug}@diceforge.app`;
}
async function rpc<T>(name:string,parameters:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.rpc(name,parameters);
  if(error){
    if(error.code==='PGRST202'||error.code==='42883')throw new Error('La base Compendium doit être initialisée par le MJ avant la première utilisation.');
    if(error.code==='40001')throw new Error(error.message);
    if(error.code==='42501')throw new Error(error.message||'Action non autorisée pour ce compte.');
    throw new Error(error.message||'Enregistrement indisponible. Votre texte est conservé.');
  }
  return data as T;
}
export function loadContext(room:string){return rpc<CampaignContext>('cm_context',{p_room:room.trim()});}
export function makeApi(context:CampaignContext):CompendiumApi{
  const p_campaign=context.campaignId;
  return {
    async loadImage(path){const {data,error}=await supabase.storage.from('compendium-images').download(path);if(error||!data)throw new Error('Illustration indisponible.');return data;},
    async listFiches(){return (await rpc<{fiches:Fiche[]}>('cm_list_fiches',{p_campaign})).fiches;},
    getFiche(p_id){return rpc('cm_get_fiche',{p_campaign,p_id});},
    async saveFiche(p_fiche,p_id,p_expected_version){return (await rpc<{fiche:Fiche}>('cm_save_fiche',{p_campaign,p_id:p_id??null,p_expected_version:p_expected_version??null,p_fiche})).fiche;},
    async saveAnnotation({ficheId:p_fiche,id:p_id,body:p_body,version:p_expected_version}){return (await rpc<{annotations:Annotation[]}>('cm_save_annotation',{p_campaign,p_fiche,p_id:p_id??null,p_expected_version:p_expected_version??null,p_body})).annotations;},
  };
}
export async function importFiches(context:CampaignContext,input:unknown){
  if(!Array.isArray(input)||input.length>1000)throw new Error('Sélectionnez un export JSON de fiches.');
  return rpc<{imported:number;skipped:number;total:number}>('cm_import_fiches',{p_campaign:context.campaignId,p_fiches:input});
}
