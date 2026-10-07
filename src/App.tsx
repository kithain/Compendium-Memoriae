import {useEffect,useMemo,useRef,useState} from 'react';
import type {User} from '@supabase/supabase-js';
import {BookOpen,LogOut} from 'lucide-react';
import Compendium from './Compendium';
import CampaignImport from './components/CampaignImport';
import {supabase,playerEmail,loadContext,makeApi,importFiches,type CampaignContext} from './api';

const roomKey=(userId:string)=>`compendium-room:${userId}`;
export default function App(){
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[context,setContext]=useState<CampaignContext|null>(null);
  const [login,setLogin]=useState(''),[password,setPassword]=useState(''),[room,setRoom]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const [importMessage,setImportMessage]=useState(''),[importPending,setImportPending]=useState(false);
  const currentUser=useRef<string|null>(null),generation=useRef(0);
  const api=useMemo(()=>context?makeApi(context):null,[context]);
  useEffect(()=>{
    let active=true;
    const reset=(next:User|null)=>{if(!active)return;if((next?.id??null)!==currentUser.current){++generation.current;currentUser.current=next?.id??null;setContext(null);setError('');setPassword('');setPending(false);setImportPending(false);setRoom(next?localStorage.getItem(roomKey(next.id))??'':'');setImportMessage('');}setUser(next);};
    const initialGeneration=generation.current;
    void supabase.auth.getUser().then(({data})=>{if(generation.current===initialGeneration)reset(data.user);if(active)setReady(true)});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>reset(session?.user??null));
    return()=>{active=false;subscription.unsubscribe();};
  },[]);
  async function signIn(event:React.FormEvent){event.preventDefault();setPending(true);setError('');try{const {data,error}=await supabase.auth.signInWithPassword({email:playerEmail(login),password});if(error||!data.user)throw new Error(error?.message==='Invalid login credentials'?'Nom de joueur ou mot de passe incorrect.':error?.message??'Connexion refusée.');setPassword('');setUser(data.user);}catch(e){setError(e instanceof Error?e.message:'Connexion impossible.');}finally{setPending(false)}}
  async function openCampaign(event:React.FormEvent){event.preventDefault();if(!user||pending)return;const seq=++generation.current;setPending(true);setError('');try{const data=await loadContext(room);if(seq!==generation.current)return;localStorage.setItem(roomKey(user.id),room.trim());setContext(data);}catch(e){if(seq===generation.current)setError(e instanceof Error?e.message:'Campagne indisponible.');}finally{if(seq===generation.current)setPending(false)}}
  async function signOut(){++generation.current;setPending(false);setImportPending(false);const {error}=await supabase.auth.signOut();if(error){setError('La déconnexion a échoué. Réessayez.');return Promise.reject(new Error('La déconnexion a échoué. Réessayez.'));}setContext(null);setUser(null);setRoom('');setPassword('');setImportMessage('');}
  async function handleImport(file:File){if(!context||!context.isGM||importPending)return;const seq=generation.current;setImportPending(true);setImportMessage('');try{if(file.size>2_000_000)throw new Error('Le fichier dépasse 2 Mo.');const input=JSON.parse(await file.text());if(seq!==generation.current)return;const result=await importFiches(context,input);if(seq!==generation.current)return;setImportMessage(`${result.imported} fiches importées en brouillon · ${result.skipped} fiches déjà présentes.`);window.dispatchEvent(new Event('focus'));}catch(e){if(seq===generation.current)setImportMessage(e instanceof Error?e.message:'Import impossible.');}finally{if(seq===generation.current)setImportPending(false)}}
  if(context&&api&&user)return <Compendium key={`${user.id}:${context.campaignId}`} api={api} userName={context.userName} isGM={context.isGM} campaignName={context.campaignName} onSignOut={signOut} onLeaveCampaign={()=>{++generation.current;setContext(null);setPending(false);setImportPending(false);setImportMessage('');}} footerActions={context.isGM?<CampaignImport pending={importPending} message={importMessage} onImport={handleImport}/>:undefined}/>;
  return <main className="auth-shell"><a className="brand" href={import.meta.env.BASE_URL}><span className="brand-mark"><BookOpen size={24}/></span><span>COMPENDIUM<span className="brand-sub">MEMORIAE</span></span></a><section className="auth-card">
    {!ready?<p role="status">Vérification de la connexion…</p>:!user?<><h1>Le carnet de votre campagne.</h1><p>Connectez-vous avec votre compte Dice-Forge.</p><form onSubmit={signIn}><label htmlFor="player">Nom de joueur</label><input id="player" autoComplete="username" value={login} onChange={event=>setLogin(event.target.value)} required disabled={pending}/><label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required disabled={pending}/><button className="primary" disabled={pending}>{pending?'Connexion…':'Se connecter'}</button></form><p className="auth-help">Les comptes sont fournis par l’administrateur de Dice-Forge.</p></>:<><h1>Ouvrir votre campagne.</h1><p>Utilisez le code d’un salon Dice-Forge auquel vous avez déjà accès.</p><form onSubmit={openCampaign}><label htmlFor="room">Code du salon</label><input id="room" value={room} onChange={event=>setRoom(event.target.value)} required autoComplete="off" disabled={pending}/><button className="primary" disabled={pending}>{pending?'Ouverture…':'Ouvrir les fiches'}</button></form><p className="auth-help">Pour rejoindre une nouvelle campagne, rejoignez d’abord son salon dans <a href="https://kithain.github.io/Dice-Forge/" target="_blank" rel="noreferrer">Dice-Forge</a>.</p><button className="secondary" onClick={()=>void signOut().catch(()=>{})}><LogOut size={16}/>Se déconnecter</button></>}
    {error&&<p className="save-error" role="alert">{error}</p>}
  </section></main>;
}
