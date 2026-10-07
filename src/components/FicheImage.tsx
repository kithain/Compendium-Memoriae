import {useEffect,useState} from 'react';

export default function FicheImage({path,name,load}:{path:string;name:string;load:(path:string)=>Promise<Blob>}){
  const [source,setSource]=useState<{path:string;url:string}|null>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let active=true;let objectUrl:string|undefined;
    setSource(null);setError(false);
    void load(path).then(blob=>{
      if(!active)return;
      objectUrl=URL.createObjectURL(blob);setSource({path,url:objectUrl});
    }).catch(()=>{if(active)setError(true);});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path,load]);
  return <figure className="fiche-illustration">
    {source?.path===path?<img src={source.url} alt={`Illustration de ${name}`} width={400} height={300} decoding="async" onError={()=>{setSource(null);setError(true);}}/>:<p role="status">{error?'Illustration indisponible.':'Chargement de l’illustration…'}</p>}
  </figure>;
}
