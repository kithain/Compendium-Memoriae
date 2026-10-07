import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {User} from '@supabase/supabase-js';
import {BookOpen,LogOut} from 'lucide-react';
import Compendium from './Compendium';
import CampaignImport from './components/CampaignImport';
import {supabase,playerEmail,loadContext,makeApi,importFiches,type CampaignContext} from './api';
import {CAMPAIGN_ROOM} from './config';

export type AppServices={
  auth:Pick<typeof supabase.auth,'getUser'|'onAuthStateChange'|'signInWithPassword'|'signOut'>;
  loadCampaign:()=>Promise<CampaignContext>;
  makeApi:typeof makeApi;
  importFiches:typeof importFiches;
};
const defaultServices:AppServices={
  auth:supabase.auth,loadCampaign:()=>loadContext(CAMPAIGN_ROOM),makeApi,importFiches,
};

export default function App({services=defaultServices}:{services?:AppServices}={}){
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[context,setContext]=useState<CampaignContext|null>(null);
  const [login,setLogin]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const [campaignLoading,setCampaignLoading]=useState(true),[campaignAttempt,setCampaignAttempt]=useState(0);
  const [importMessage,setImportMessage]=useState(''),[importPending,setImportPending]=useState(false);
  const [refreshRevision,setRefreshRevision]=useState(0);
  const currentUser=useRef<string|null>(null),generation=useRef(0),authGeneration=useRef(0);
  const api=useMemo(()=>context?services.makeApi(context):null,[context,services]);

  const acceptUser=useCallback((next:User|null)=>{
    if((next?.id??null)!==currentUser.current){
      ++generation.current;++authGeneration.current;currentUser.current=next?.id??null;
      setContext(null);setError('');setPassword('');setPending(false);
      setCampaignLoading(true);setImportPending(false);setImportMessage('');
    }
    setUser(next);
  },[]);

  useEffect(()=>{
    let active=true;
    const initialGeneration=generation.current;
    void services.auth.getUser().then(({data})=>{
      if(!active)return;
      if(generation.current===initialGeneration)acceptUser(data.user);
      setReady(true);
    }).catch(()=>{
      if(!active)return;
      if(generation.current===initialGeneration){acceptUser(null);setError('Impossible de vérifier la connexion. Vous pouvez réessayer.');}
      setReady(true);
    });
    const {data:{subscription}}=services.auth.onAuthStateChange((event,session)=>{
      if(!active)return;
      if(event==='SIGNED_OUT'){++authGeneration.current;setPending(false);}
      acceptUser(session?.user??null);
    });
    return()=>{active=false;subscription.unsubscribe();};
  },[acceptUser,services]);

  useEffect(()=>{
    if(!ready||!user)return;
    let active=true;
    const userId=user.id,seq=++generation.current;
    setCampaignLoading(true);setError('');
    const isCurrent=()=>active&&seq===generation.current&&currentUser.current===userId;
    // Auth callbacks only update identity; the RPC runs after their lock is released.
    void services.loadCampaign().then(data=>{
      if(isCurrent())setContext(data);
    }).catch(cause=>{
      if(isCurrent())setError(cause instanceof Error?cause.message:'Campagne indisponible.');
    }).finally(()=>{if(isCurrent())setCampaignLoading(false);});
    return()=>{active=false;};
  },[ready,user?.id,campaignAttempt,services]);

  async function signIn(event:React.FormEvent){
    event.preventDefault();if(pending)return;
    const seq=++authGeneration.current;
    setPending(true);setError('');
    try{
      const {data,error}=await services.auth.signInWithPassword({email:playerEmail(login),password});
      if(seq!==authGeneration.current)return;
      if(error||!data.user)throw new Error(error?.message==='Invalid login credentials'?'Nom de joueur ou mot de passe incorrect.':error?.message??'Connexion refusée.');
      if(!currentUser.current||currentUser.current===data.user.id){setPassword('');acceptUser(data.user);}
    }catch(cause){if(seq===authGeneration.current)setError(cause instanceof Error?cause.message:'Connexion impossible.');}
    finally{if(seq===authGeneration.current)setPending(false);}
  }

  async function signOut(){
    ++generation.current;const seq=++authGeneration.current;
    setPending(true);setImportPending(false);
    try{
      const {error}=await services.auth.signOut();
      if(seq!==authGeneration.current)return;
      if(error)throw new Error('La déconnexion a échoué. Réessayez.');
      acceptUser(null);setPassword('');setImportMessage('');
    }catch(cause){
      if(seq!==authGeneration.current)return;
      setCampaignLoading(false);
      const text=cause instanceof Error?cause.message:'La déconnexion a échoué. Réessayez.';
      setError(text);throw new Error(text);
    }finally{if(seq===authGeneration.current)setPending(false);}
  }

  async function handleImport(file:File){
    if(!context||!context.isGM||importPending)return;
    const seq=generation.current;setImportPending(true);setImportMessage('');
    try{
      if(file.size>2_000_000)throw new Error('Le fichier dépasse 2 Mo.');
      const input=JSON.parse(await file.text());if(seq!==generation.current)return;
      const result=await services.importFiches(context,input);if(seq!==generation.current)return;
      setImportMessage(`${result.imported} fiches importées en brouillon · ${result.skipped} fiches déjà présentes.`);
      setRefreshRevision(value=>value+1);
    }catch(cause){if(seq===generation.current)setImportMessage(cause instanceof Error?cause.message:'Import impossible.');}
    finally{if(seq===generation.current)setImportPending(false);}
  }

  if(context&&api&&user)return <Compendium key={`${user.id}:${context.campaignId}`} api={api} userName={context.userName} isGM={context.isGM} campaignName={context.campaignName} refreshRevision={refreshRevision} onSignOut={signOut} footerActions={context.isGM?<CampaignImport pending={importPending} message={importMessage} onImport={handleImport}/>:undefined}/>;
  return <main className="auth-shell"><a className="brand" href={import.meta.env.BASE_URL}><span className="brand-mark"><BookOpen size={24}/></span><span>COMPENDIUM<span className="brand-sub">MEMORIAE</span></span></a><section className="auth-card">
    {!ready?<p role="status">Vérification de la connexion…</p>:!user?<><h1>Le carnet de votre campagne.</h1><p>Connectez-vous avec votre compte Dice-Forge.</p><form onSubmit={signIn}><label htmlFor="player">Nom de joueur</label><input id="player" autoComplete="username" value={login} onChange={event=>setLogin(event.target.value)} required disabled={pending}/><label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required disabled={pending}/><button className="primary" disabled={pending}>{pending?'Connexion…':'Se connecter'}</button></form><p className="auth-help">Les comptes sont fournis par l’administrateur de Dice-Forge.</p></>:<><h1>{campaignLoading?'Ouverture de votre campagne…':'Votre campagne.'}</h1>
      {campaignLoading?<p role="status">Chargement des fiches…</p>:<button className="primary" disabled={pending} onClick={()=>setCampaignAttempt(value=>value+1)}>Réessayer</button>}
      <p className="auth-help">Votre accès est lié à votre compte Dice-Forge.</p><button className="secondary" disabled={pending} onClick={()=>void signOut().catch(()=>{})}><LogOut size={16}/>Se déconnecter</button></>}
    {error&&<p className="save-error" role="alert">{error}</p>}
  </section></main>;
}
