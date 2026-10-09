import {useEffect,useRef,useState} from 'react';
import {Download,FileImage,FileText,Paperclip,X} from 'lucide-react';
import {attachmentSize,type Attachment} from '../lib/attachments';
import '../styles/attachments.css';

export default function AttachmentList({files,load,onRemove,disabled=false}:{
  files:Attachment[];load?:(path:string)=>Promise<Blob>;
  onRemove?:(file:Attachment)=>void|Promise<void>;disabled?:boolean;
}){
  const [working,setWorking]=useState<string|null>(null);
  const [error,setError]=useState('');
  const mounted=useRef(true);
  const urls=useRef<string[]>([]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current=[];};},[]);
  async function download(file:Attachment){
    if(!load||working||disabled)return;
    setWorking(file.id);setError('');
    try{
      const blob=await load(file.path);
      if(!mounted.current)return;
      const url=URL.createObjectURL(blob);urls.current.push(url);
      const link=document.createElement('a');link.href=url;link.download=file.name;link.rel='noopener';
      document.body.append(link);link.click();link.remove();
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'Téléchargement impossible.');}
    finally{if(mounted.current)setWorking(null);}
  }
  if(!files.length)return null;
  return <div className="attachment-list">
    <div className="attachment-heading"><Paperclip size={15}/>Pièces jointes <span>({files.length})</span></div>
    <ul>{files.map(file=><li key={file.id}>
      {file.mimeType.startsWith('image/')?<FileImage size={20}/>:<FileText size={20}/>}
      <div className="attachment-name"><span>{file.name}</span><small>{attachmentSize(file.size)}</small></div>
      {load&&<button type="button" className="attachment-action" aria-label={`Télécharger ${file.name}`} title="Télécharger" disabled={disabled||!!working} onClick={()=>void download(file)}><Download size={17}/></button>}
      {onRemove&&<button type="button" className="attachment-action" aria-label={`Retirer ${file.name}`} title="Retirer" disabled={disabled||!!working} onClick={()=>void onRemove(file)}><X size={17}/></button>}
    </li>)}</ul>
    {working&&<p role="status">Téléchargement…</p>}
    {error&&<p className="save-error" role="alert">{error}</p>}
  </div>;
}
