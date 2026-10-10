import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config';
import type {Fiche,FicheDraft,Annotation} from './lib/fiches';
import {validateAttachmentFile,type Attachment,type AttachmentTarget} from './lib/attachments';
import {legacyImagePath,loadPublicImage,publicImagePath} from './lib/image-paths';

export const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
  auth:{storageKey:'compendium-memoriae-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
});
export type CampaignContext={campaignId:string;campaignName:string;isGM:boolean;userName:string};
export type CompendiumApi={
  uploadAttachment?(file:File,target:AttachmentTarget,ficheId?:string):Promise<Attachment>;
  discardAttachment?(attachment:Attachment):Promise<void>;
  loadAttachment?(path:string):Promise<Blob>;
  loadImage(path:string):Promise<Blob>;
  listFiches():Promise<Fiche[]>;
  listDeletedFiches():Promise<Fiche[]>;
  deleteFiche(id:string,version:number):Promise<Fiche>;
  restoreFiche(id:string,version:number):Promise<Fiche>;
  getFiche(id:string):Promise<{fiche:Fiche;annotations:Annotation[]}>;
  saveFiche(draft:FicheDraft,id?:string,version?:number,attachmentIds?:string[]):Promise<Fiche>;
  saveAnnotation(input:{ficheId:string;id?:string;body:string;version?:number;attachmentIds?:string[]}):Promise<Annotation[]>;
  deleteAnnotation(input:{ficheId:string;id:string;version:number}):Promise<Annotation[]>;
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
    if(error.code==='PGRST202'||error.code==='42883')throw new Error(name.includes('attachment')?'Le dépôt de fichiers doit être activé par le MJ. Votre texte est conservé.':'La base Compendium doit être initialisée par le MJ avant la première utilisation.');
    if(error.code==='40001')throw new Error(error.message);
    if(error.code==='42501')throw new Error(error.message||'Action non autorisée pour ce compte.');
    throw new Error(error.message||'Enregistrement indisponible. Votre texte est conservé.');
  }
  return data as T;
}
export function loadContext(room:string){return rpc<CampaignContext>('cm_context',{p_room:room.trim()});}
export function makeApi(context:CampaignContext):CompendiumApi{
  const p_campaign=context.campaignId;
  const knownImagePaths=new Map<string,string|null>();
  const remember=(fiche:Fiche)=>{knownImagePaths.set(fiche.id,fiche.imagePath??null);return fiche;};
  return {
    async uploadAttachment(file,target,ficheId){
      const validated=await validateAttachmentFile(file);
      const attachment=await rpc<Attachment>('cm_prepare_attachment',{p_campaign,p_fiche:ficheId??null,p_target:target,p_name:validated.name,p_size:validated.size,p_mime:validated.mimeType});
      try {
        const {error}=await supabase.storage.from('compendium-attachments').upload(attachment.path,file,{contentType:validated.mimeType,upsert:false,cacheControl:'0'});
        if(error)throw new Error(error.message||'Dépôt du fichier impossible.');
        return attachment;
      } catch(cause) {
        await rpc('cm_discard_attachment',{p_campaign,p_id:attachment.id}).catch(()=>{});
        await supabase.storage.from('compendium-attachments').remove([attachment.path]).catch(()=>{});
        throw cause;
      }
    },
    async discardAttachment(attachment){
      await rpc('cm_discard_attachment',{p_campaign,p_id:attachment.id});
      const {error}=await supabase.storage.from('compendium-attachments').remove([attachment.path]);
      if(error)throw new Error('Le retrait du fichier a échoué. Réessayez.');
    },
    async loadAttachment(path){const {data,error}=await supabase.storage.from('compendium-attachments').download(path);if(error||!data)throw new Error('Pièce jointe indisponible.');return data;},
    async loadImage(path){
      const publicPath=publicImagePath(path);
      if(publicPath)return loadPublicImage(publicPath,import.meta.env.BASE_URL);
      const oldPath=legacyImagePath(path,p_campaign);
      if(!oldPath)throw new Error('Chemin d’illustration invalide.');
      const {data,error}=await supabase.storage.from('compendium-images').download(oldPath);
      if(error||!data)throw new Error('Illustration indisponible.');
      return data;
    },
    async listFiches(){return (await rpc<{fiches:Fiche[]}>('cm_list_fiches',{p_campaign})).fiches.map(remember);},
    async listDeletedFiches(){return (await rpc<{fiches:Fiche[]}>('cm_list_deleted_fiches',{p_campaign})).fiches.map(remember);},
    async deleteFiche(p_id,p_expected_version){return (await rpc<{fiche:Fiche}>('cm_delete_fiche',{p_campaign,p_id,p_expected_version})).fiche;},
    async restoreFiche(p_id,p_expected_version){return (await rpc<{fiche:Fiche}>('cm_restore_fiche',{p_campaign,p_id,p_expected_version})).fiche;},
    async getFiche(p_id){const result=await rpc<{fiche:Fiche;annotations:Annotation[]}>('cm_get_fiche',{p_campaign,p_id});remember(result.fiche);return result;},
    async saveFiche(p_fiche,p_id,p_expected_version,attachmentIds){
      if(p_fiche.imagePath!==undefined&&p_fiche.imagePath!==null){
        const path=p_fiche.imagePath.trim();
        if(path&&!publicImagePath(path)&&!(p_id&&path===knownImagePaths.get(p_id)&&legacyImagePath(path,p_campaign))) {
          throw new Error('Utilisez un chemin images/catégorie/nom.jpg, sans espaces ni accents.');
        }
        p_fiche={...p_fiche,imagePath:path||null};
      }
      const result=(await rpc<{fiche:Fiche}>(attachmentIds===undefined?'cm_save_fiche':'cm_save_fiche_with_attachments',{p_campaign,p_id:p_id??null,p_expected_version:p_expected_version??null,p_fiche,...(attachmentIds===undefined?{}:{p_attachment_ids:attachmentIds})})).fiche;
      return remember(result);
    },
    async saveAnnotation({ficheId:p_fiche,id:p_id,body:p_body,version:p_expected_version,attachmentIds}){return (await rpc<{annotations:Annotation[]}>(attachmentIds===undefined?'cm_save_annotation':'cm_save_annotation_with_attachments',{p_campaign,p_fiche,p_id:p_id??null,p_expected_version:p_expected_version??null,p_body,...(attachmentIds===undefined?{}:{p_attachment_ids:attachmentIds})})).annotations;},
    async deleteAnnotation({ficheId:p_fiche,id:p_id,version:p_expected_version}){return (await rpc<{annotations:Annotation[]}>('cm_delete_annotation',{p_campaign,p_fiche,p_id,p_expected_version})).annotations;},
  };
}
export async function importFiches(context:CampaignContext,input:unknown){
  if(!Array.isArray(input)||input.length>1000)throw new Error('Sélectionnez un export JSON de fiches.');
  return rpc<{imported:number;skipped:number;total:number}>('cm_import_fiches',{p_campaign:context.campaignId,p_fiches:input});
}
