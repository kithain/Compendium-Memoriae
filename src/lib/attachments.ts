export const MAX_ATTACHMENT_SIZE = 2_000_000;
export const MAX_ATTACHMENTS = 10;
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif,.pdf,.md,.txt';
export type Attachment = {id:string; name:string; path:string; mimeType:string; size:number};
export type AttachmentTarget = 'fiche' | 'annotation';

const mimeTypes:Record<string,string> = {
  png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',
  bmp:'image/bmp',avif:'image/avif',pdf:'application/pdf',md:'text/markdown',txt:'text/plain',
};
export function attachmentSize(size:number) {
  return size >= 1_000_000 ? `${(size / 1_000_000).toLocaleString('fr-FR',{maximumFractionDigits:2})} Mo`
    : `${Math.max(1,Math.ceil(size / 1000))} ko`;
}
/** Use the extension and file bytes, never a browser-provided MIME alone. */
export async function validateAttachmentFile(file:File):Promise<{name:string;size:number;mimeType:string}> {
  if(!file.name || file.name.length > 160 || /[\x00-\x1f\x7f/\\]/.test(file.name)) throw new Error('Nom de fichier invalide ou trop long.');
  if(file.size < 1) throw new Error(`${file.name} : le fichier est vide.`);
  if(file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${file.name} : la taille dépasse 2 Mo.`);
  const extension=file.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType=mimeTypes[extension];
  if(!mimeType) throw new Error(`${file.name} : choisissez une image, un PDF, un fichier MD ou TXT.`);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const starts=(signature:number[])=>signature.every((value,index)=>bytes[index]===value);
  const ascii=(start:number,length:number)=>String.fromCharCode(...bytes.slice(start,start+length));
  let valid=false;
  switch(extension){
    case 'png': valid=starts([137,80,78,71,13,10,26,10]); break;
    case 'jpg': case 'jpeg': valid=starts([255,216,255]); break;
    case 'gif': valid=['GIF87a','GIF89a'].includes(ascii(0,6)); break;
    case 'webp': valid=ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP'; break;
    case 'bmp': valid=ascii(0,2)==='BM'; break;
    case 'avif': valid=ascii(4,4)==='ftyp' && /avif|avis/.test(ascii(8,Math.min(bytes.length-8,56))); break;
    case 'pdf': valid=ascii(0,Math.min(bytes.length,1024)).includes('%PDF-'); break;
    case 'md': case 'txt':
      try { const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); valid=!text.includes('\0'); } catch { valid=false; }
      break;
  }
  if(!valid) throw new Error(`${file.name} : le contenu ne correspond pas à ce format${extension==='md'||extension==='txt'?' (texte UTF-8 attendu)':''}.`);
  return {name:file.name,size:file.size,mimeType};
}
