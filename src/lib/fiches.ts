export const ficheTypes=['place','npc'] as const;
export type FicheType=typeof ficheTypes[number];
export type FicheDraft={type:FicheType;name:string;subtitle:string;location:string;summary:string;description:string;published:boolean};
export type Fiche=FicheDraft & {id:string;updatedAt:string;version:number;annotationCount:number;imagePath?:string|null};
export type Annotation={id:string;ficheId:string;body:string;author:string;createdAt:string;updatedAt:string;version:number;canEdit:boolean};
export function emptyFiche(type:FicheType):FicheDraft{return {type,name:'',subtitle:'',location:'',summary:'',description:'',published:false};}
export function validateFiche(input:unknown):FicheDraft|null{
  if(!input||typeof input!=='object')return null;
  const d=input as Record<string,unknown>;
  if(!ficheTypes.includes(d.type as FicheType)||typeof d.published!=='boolean')return null;
  for(const [key,max] of Object.entries({name:160,subtitle:160,location:160,summary:300,description:6000}))if(typeof d[key]!=='string'||(d[key] as string).length>max)return null;
  if(!(d.name as string).trim()||!(d.summary as string).trim())return null;
  return {type:d.type as FicheType,name:(d.name as string).trim(),subtitle:(d.subtitle as string).trim(),location:(d.location as string).trim(),summary:(d.summary as string).trim(),description:(d.description as string).trim(),published:d.published};
}
export function validateAnnotation(input:unknown):string|null{
  if(!input||typeof input!=='object')return null;
  const body=(input as {body:unknown}).body;
  return typeof body==='string'&&body.trim().length>0&&body.length<=6000?body.trim():null;
}
