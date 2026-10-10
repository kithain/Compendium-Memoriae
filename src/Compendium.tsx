import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronUp, Eye, LogOut, MapPin, MessageSquare,
  Feather, Hourglass, Pencil, Plus, RefreshCw, Save, Search, Shield, Sparkles, Trash2, Undo2, Users,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import type { CompendiumApi } from './api';
import type { Annotation, Fiche, FicheDraft, FicheType } from './lib/fiches';
import { emptyFiche, ficheTypes, isFicheType } from './lib/fiches';
import { loreCategories } from './lib/lore';
import FicheImage from './components/FicheImage';
import StructuredContent from './components/StructuredContent';
import RichTextEditor from './components/RichTextEditor';
import AttachmentList from './components/AttachmentList';
import {MAX_ATTACHMENTS,validateAttachmentFile,type Attachment,type AttachmentTarget} from './lib/attachments';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { Checkbox } from './components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from './components/ui/alert-dialog';

type GuardedAction = () => void | Promise<void>;

const categoryIcons = {
  place: MapPin, npc: Users, faction: Shield, cosmogony: Sparkles,
  history: Hourglass, culture: Feather, knowledge: BookOpen,
} satisfies Record<FicheType, typeof MapPin>;

export type CompendiumProps = {
  api: CompendiumApi;
  userName: string;
  isGM: boolean;
  campaignName: string;
  onSignOut: GuardedAction;
  onLeaveCampaign?: GuardedAction;
  footerActions?: ReactNode;
  refreshRevision?: number;
};

const stamp = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris',
}).format(new Date(value));

const noteDate = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium', timeZone: 'Europe/Paris',
}).format(new Date(value));

const asDraft = (fiche: Fiche): FicheDraft => ({
  type: fiche.type, name: fiche.name, subtitle: fiche.subtitle,
  location: fiche.location, summary: fiche.summary,
  description: fiche.description, published: fiche.published, imagePath: fiche.imagePath ?? '',
});

const searchable = (value: string) => value.normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr');

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function Compendium({
  api, userName, isGM, campaignName, onSignOut, onLeaveCampaign, footerActions, refreshRevision = 0,
}: CompendiumProps) {
  const [type, setType] = useState<FicheType>('place');
  const [fiches, setFiches] = useState<Fiche[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [listCollapsed, setListCollapsed] = useState(true);
  const [preview, setPreview] = useState(false);
  const [trash, setTrash] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Fiche | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const moveInFlight = useRef(false);
  const [draft, setDraft] = useState<FicheDraft | null>(null);
  const [base, setBase] = useState<Fiche | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationBody, setAnnotationBody] = useState('');
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [ficheFiles,setFicheFiles] = useState<Attachment[]>([]);
  const [noteFiles,setNoteFiles] = useState<Attachment[]>([]);
  const [fileUploading,setFileUploading] = useState(false);
  const fileInFlight = useRef(false);
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<Annotation | null>(null);
  const [noteDeleteError, setNoteDeleteError] = useState('');
  const [noteDeleting, setNoteDeleting] = useState(false);
  const noteDeleteInFlight = useRef(false);
  const noteDeleteTrigger = useRef<HTMLButtonElement | null>(null);
  const noteDeleteConfirm = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteLoading, setNoteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [actionError, setActionError] = useState('');
  const [discard, setDiscard] = useState(false);
  const firstDraft = useRef<FicheDraft | null>(null);
  const listGeneration = useRef(0);
  const noteGeneration = useRef(0);
  const lifecycle = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<GuardedAction | null>(null);
  const noteFicheId = useRef<string | null>(null);
  const apiRef = useRef(api);
  const pageArea = useRef<HTMLDivElement>(null);
  const ficheList = useRef<HTMLElement>(null);
  const lastRefreshRevision = useRef(refreshRevision);
  const sectionTabs = useRef<HTMLDivElement>(null);
  apiRef.current = api;

  const playerView = !isGM || preview;
  const collection = fiches.filter(fiche => fiche.type === type && !!fiche.deletedAt === trash && (!playerView || fiche.published));
  const search = searchable(query.trim());
  const rows = search ? collection.filter(fiche => searchable(
    `${fiche.name} ${fiche.subtitle} ${fiche.location}`,
  ).includes(search)) : collection;
  // Filtering the list never moves the fiche to which an unsaved note belongs.
  const selected = id ? collection.find(fiche => fiche.id === id) ?? null : collection[0] ?? null;
  const gmView = isGM && !preview;
  const dirty = (!!draft && JSON.stringify(draft) !== JSON.stringify(base ? asDraft(base) : firstDraft.current))
    || (!!draft && JSON.stringify(ficheFiles.map(file=>file.id)) !== JSON.stringify((base?.attachments??[]).map(file=>file.id)))
    || annotationBody !== (editingAnnotation?.body ?? '')
    || JSON.stringify(noteFiles.map(file=>file.id)) !== JSON.stringify((editingAnnotation?.attachments??[]).map(file=>file.id));
  const busy = saving || noteSaving || noteDeleting || leaving || moving || fileUploading;
  const state = useRef({ dirty, busy, selected });
  state.current = { dirty, busy, selected };

  const reload = useCallback(async () => {
    const generation = ++listGeneration.current;
    try {
      const result = await (trash && gmView ? api.listDeletedFiches() : api.listFiches());
      if (generation === listGeneration.current && apiRef.current === api
          && !state.current.dirty && !state.current.busy) {
        setFiches(result);
        setError('');
      }
    } catch (cause) {
      if (generation === listGeneration.current && apiRef.current === api) {
        setError(message(cause, 'Impossible de charger les fiches.'));
      }
    } finally {
      if (generation === listGeneration.current && apiRef.current === api) setLoading(false);
    }
  }, [api, trash, gmView]);

  const loadNotes = useCallback(async (ficheId: string) => {
    const generation = ++noteGeneration.current;
    setNoteLoading(true);
    setNoteError('');
    try {
      const result = await api.getFiche(ficheId);
      if (generation === noteGeneration.current && apiRef.current === api) {
        setAnnotations(result.annotations);
      }
    } catch (cause) {
      if (generation === noteGeneration.current && apiRef.current === api) {
        setNoteError(message(cause, 'Cette fiche ou ses annotations ne sont plus disponibles.'));
      }
    } finally {
      if (generation === noteGeneration.current && apiRef.current === api) setNoteLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      ++lifecycle.current;
      ++listGeneration.current;
      ++noteGeneration.current;
    };
  }, [reload]);

  useEffect(() => { if (!id && selected) setId(selected.id); }, [id, selected?.id]);

  // A new selection starts at the top of its fiche without moving the list.
  useEffect(() => { if (pageArea.current) pageArea.current.scrollTop = 0; }, [selected?.id, type, trash, !!draft]);
  useEffect(() => { if (ficheList.current) ficheList.current.scrollTop = 0; }, [type, trash]);
  useEffect(() => {
    const list = sectionTabs.current;
    const active = list?.querySelector<HTMLElement>('[data-state="active"]');
    if (!list || !active) return;
    const listBox = list.getBoundingClientRect(), activeBox = active.getBoundingClientRect();
    if (activeBox.left < listBox.left) list.scrollLeft += activeBox.left - listBox.left;
    else if (activeBox.right > listBox.right) list.scrollLeft += activeBox.right - listBox.right;
  }, [type]);
  useEffect(() => {
    const list = ficheList.current;
    if (listCollapsed && list?.contains(document.activeElement)
        && getComputedStyle(list).display === 'none') {
      pageArea.current?.focus({ preventScroll: true });
    }
  }, [listCollapsed, selected?.id]);
  useEffect(() => {
    if (listCollapsed) return;
    const list = ficheList.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !active) return;
    const listBox = list.getBoundingClientRect(), activeBox = active.getBoundingClientRect();
    if (activeBox.top < listBox.top) list.scrollTop += activeBox.top - listBox.top;
    else if (activeBox.bottom > listBox.bottom) list.scrollTop += activeBox.bottom - listBox.bottom;
  }, [listCollapsed]);
  useEffect(() => {
    if (noteDeleteError && !noteDeleting) noteDeleteConfirm.current?.focus({ preventScroll: true });
  }, [noteDeleteError, noteDeleting]);

  useEffect(() => {
    setAnnotations([]);
    setNoteError('');
    if (selected && !trash) void loadNotes(selected.id);
    else {
      ++noteGeneration.current;
      setNoteLoading(false);
    }
  }, [selected?.id, loadNotes, trash]);

  useEffect(() => {
    // Refresh only after an explicit import, without interrupting fiche reading.
    if (lastRefreshRevision.current === refreshRevision) return;
    lastRefreshRevision.current = refreshRevision;
    void reload();
  }, [refreshRevision, reload]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function runAction(action: GuardedAction) {
    setActionError('');
    const generation = lifecycle.current;
    try {
      const result = action();
      if (result) {
        setLeaving(true);
        void result.catch(cause => {
          if (mounted.current && generation === lifecycle.current) {
            setActionError(message(cause, 'Cette action a échoué. Votre texte est conservé.'));
          }
        }).finally(() => {
          if (mounted.current && generation === lifecycle.current) setLeaving(false);
        });
      }
    } catch (cause) {
      setActionError(message(cause, 'Cette action a échoué. Votre texte est conservé.'));
    }
  }

  function guard(action: GuardedAction) {
    if (state.current.busy) return;
    if (state.current.dirty) {
      pending.current = action;
      setDiscard(true);
    } else runAction(action);
  }

  function discardPending(files:Attachment[],existing:Attachment[]) {
    const discardFile=api.discardAttachment;
    if(discardFile)void Promise.allSettled(files.filter(file=>!existing.some(saved=>saved.id===file.id)).map(discardFile));
  }

  async function uploadFiles(files:File[],target:AttachmentTarget) {
    if(busy||fileInFlight.current||!api.uploadAttachment)return;
    const ownerId=target==='fiche'?base?.id:selected?.id;
    if(target==='annotation'&&!ownerId)return;
    if(target==='annotation')noteFicheId.current=ownerId!;
    const current=target==='fiche'?ficheFiles:noteFiles;
    const setter=target==='fiche'?setFicheFiles:setNoteFiles;
    const setFailure=target==='fiche'?setSaveError:setNoteError;
    const generation=lifecycle.current,currentApi=api;
    fileInFlight.current=true;setFileUploading(true);setFailure('');
    const failures:string[]=[];
    let count=current.length;
    try {
      for(const file of files) {
        if(count>=MAX_ATTACHMENTS){failures.push(`Un contenu accepte au maximum ${MAX_ATTACHMENTS} pièces jointes.`);break;}
        try {
          await validateAttachmentFile(file);
          const uploaded=await currentApi.uploadAttachment!(file,target,ownerId);
          if(!mounted.current||generation!==lifecycle.current||apiRef.current!==currentApi){
            void currentApi.discardAttachment?.(uploaded).catch(()=>{});break;
          }
          setter(previous=>[...previous,uploaded]);count++;
        } catch(cause){failures.push(message(cause,`${file.name} : dépôt impossible.`));}
      }
      if(mounted.current&&generation===lifecycle.current&&apiRef.current===currentApi)setFailure(failures.join('\n'));
    } finally {
      fileInFlight.current=false;
      if(mounted.current&&generation===lifecycle.current&&apiRef.current===currentApi)setFileUploading(false);
    }
  }

  async function removeFile(file:Attachment,target:AttachmentTarget) {
    if(busy||fileInFlight.current)return;
    const existing=target==='fiche'?base?.attachments:editingAnnotation?.attachments;
    const setter=target==='fiche'?setFicheFiles:setNoteFiles;
    if(existing?.some(saved=>saved.id===file.id)){setter(previous=>previous.filter(value=>value.id!==file.id));return;}
    const setFailure=target==='fiche'?setSaveError:setNoteError;
    const currentApi=api,generation=lifecycle.current;
    fileInFlight.current=true;setFileUploading(true);setFailure('');
    try{
      await currentApi.discardAttachment?.(file);
      if(mounted.current&&generation===lifecycle.current&&apiRef.current===currentApi)setter(previous=>previous.filter(value=>value.id!==file.id));
    }catch(cause){if(mounted.current&&generation===lifecycle.current)setFailure(message(cause,'Retrait du fichier impossible.'));}
    finally{fileInFlight.current=false;if(mounted.current&&generation===lifecycle.current)setFileUploading(false);}
  }

  function resetNote(discardFiles=true) {
    if(discardFiles)discardPending(noteFiles,editingAnnotation?.attachments??[]);
    setNoteFiles([]);
    setAnnotationBody('');
    setEditingAnnotation(null);
    setNoteError('');
    noteFicheId.current = null;
  }

  function closeEditor(discardFiles=true) {
    if(discardFiles)discardPending(ficheFiles,base?.attachments??[]);
    setFicheFiles([]);
    setDraft(null);
    setBase(null);
    setSaveError('');
  }

  function start() {
    guard(() => {
      discardPending(ficheFiles,base?.attachments??[]);
      const fresh = emptyFiche(type);
      firstDraft.current = fresh;
      setBase(null);
      setFicheFiles([]);
      setDraft(fresh);
      setSaveError('');
      resetNote();
    });
  }

  function edit() {
    if (!selected || !gmView) return;
    guard(() => {
      discardPending(ficheFiles,base?.attachments??[]);
      setBase(selected);
      setFicheFiles(selected.attachments??[]);
      setDraft(asDraft(selected));
      setSaveError('');
      resetNote();
    });
  }

  async function saveFiche() {
    if (!draft || busy || !gmView) return;
    const generation = lifecycle.current;
    const currentApi = api;
    ++listGeneration.current;
    setLoading(false);
    setSaving(true);
    setSaveError('');
    try {
      const result = await currentApi.saveFiche(draft, base?.id, base?.version,
        ficheFiles.length||base?.attachments?.length?ficheFiles.map(file=>file.id):undefined);
      if (!mounted.current || lifecycle.current !== generation || apiRef.current !== currentApi) return;
      ++listGeneration.current;
      setFiches(previous => [result, ...previous.filter(fiche => fiche.id !== result.id)]
        .sort((left, right) => left.name.localeCompare(right.name, 'fr')));
      setId(result.id);
      setType(result.type);
      if (result.type !== type) setQuery('');
      closeEditor(false);
      toast.success(result.published ? 'La fiche est visible par les joueurs.' : 'Le brouillon est enregistré.');
    } catch (cause) {
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) {
        setSaveError(message(cause, 'Enregistrement impossible. Votre texte est conservé.'));
      }
    } finally {
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) setSaving(false);
    }
  }

  async function saveNote() {
    if (!selected || busy || !annotationBody.trim()) return;
    const ficheId = noteFicheId.current ?? selected.id;
    if (ficheId !== selected.id) {
      setNoteError('Ce brouillon appartient à une autre fiche. Revenez à la fiche d’origine pour l’enregistrer.');
      return;
    }
    const generation = lifecycle.current;
    const currentApi = api;
    ++noteGeneration.current;
    ++listGeneration.current;
    setLoading(false);
    setNoteLoading(false);
    setNoteSaving(true);
    setNoteError('');
    try {
      const result = await currentApi.saveAnnotation({
        ficheId, id: editingAnnotation?.id, body: annotationBody, version: editingAnnotation?.version,
        attachmentIds:noteFiles.length||editingAnnotation?.attachments?.length?noteFiles.map(file=>file.id):undefined,
      });
      if (!mounted.current || lifecycle.current !== generation || apiRef.current !== currentApi) return;
      ++noteGeneration.current;
      setAnnotations(result);
      setFiches(previous => previous.map(fiche => fiche.id === ficheId
        ? { ...fiche, annotationCount: result.length } : fiche));
      resetNote(false);
      toast.success('Votre annotation est enregistrée.');
    } catch (cause) {
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) {
        setNoteError(message(cause, 'Enregistrement impossible. Votre texte est conservé.'));
      }
    } finally {
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) setNoteSaving(false);
    }
  }

  async function deleteNote() {
    const target = noteDeleteTarget;
    if (!target || !selected || target.ficheId !== selected.id || !target.canDelete
        || target.deletedAt || busy || noteDeleteInFlight.current) return;
    noteDeleteInFlight.current = true;
    const generation = lifecycle.current;
    const currentApi = api;
    ++noteGeneration.current;
    ++listGeneration.current;
    setLoading(false); setNoteLoading(false); setNoteDeleting(true); setNoteDeleteError('');
    try {
      const result = await currentApi.deleteAnnotation({ficheId: target.ficheId, id: target.id, version: target.version});
      if (!mounted.current || lifecycle.current !== generation || apiRef.current !== currentApi) return;
      setAnnotations(result);
      setFiches(previous => previous.map(fiche => fiche.id === target.ficheId
        ? {...fiche, annotationCount: result.length} : fiche));
      if (editingAnnotation?.id === target.id) resetNote();
      setNoteDeleteTarget(null);
      toast.success('Votre message a été supprimé.');
    } catch (cause) {
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) {
        setNoteDeleteError(message(cause, 'Suppression impossible. Votre message est conservé.'));
      }
    } finally {
      noteDeleteInFlight.current = false;
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) setNoteDeleting(false);
    }
  }

  async function moveFiche(target: Fiche, restore = false) {
    if (!gmView || busy || moveInFlight.current) return;
    moveInFlight.current = true;
    const generation = lifecycle.current;
    const currentApi = api;
    ++listGeneration.current;
    ++noteGeneration.current;
    setMoving(true); setLoading(false); setNoteLoading(false);
    setDeleteError(''); setActionError('');
    try {
      if (restore) await currentApi.restoreFiche(target.id, target.version);
      else await currentApi.deleteFiche(target.id, target.version);
      if (!mounted.current || lifecycle.current !== generation || apiRef.current !== currentApi) return;
      setFiches(previous => previous.filter(fiche => fiche.id !== target.id));
      setId(null); resetNote(); closeEditor(); setDeleteTarget(null);
      toast.success(restore ? 'La fiche est restaurée en brouillon.' : 'La fiche est placée dans la corbeille du MJ.');
    } catch (cause) {
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) {
        const text = message(cause, 'Cette action a échoué. La fiche est conservée.');
        if (restore) setActionError(text); else setDeleteError(text);
      }
    } finally {
      moveInFlight.current = false;
      if (mounted.current && lifecycle.current === generation && apiRef.current === currentApi) setMoving(false);
    }
  }

  const category = loreCategories[type];
  const editorCategory = loreCategories[draft?.type ?? type];
  const Icon = categoryIcons[type];
  const EditorIcon = categoryIcons[draft?.type ?? type];

  return <div className="notebook-shell">
    <Toaster richColors />
    <header className="topbar">
      {onLeaveCampaign ? <button className="brand" onClick={() => guard(onLeaveCampaign)} disabled={busy} aria-label="Compendium Memoriae, choisir une campagne">
        <span className="brand-mark"><BookOpen size={24} /></span>
        <span>COMPENDIUM<span className="brand-sub">MEMORIAE</span></span>
      </button> : <div className="brand">
        <span className="brand-mark"><BookOpen size={24} /></span>
        <span>COMPENDIUM<span className="brand-sub">MEMORIAE</span></span>
      </div>}
      <div className="campaign-identity"><span>{campaignName}</span><small>{isGM ? 'Espace MJ' : 'Espace joueurs'}</small></div>
      <div className="user"><span className="avatar">{userName.charAt(0).toUpperCase()}</span><span className="user-name">{userName}</span></div>
      <nav className="account-actions" aria-label="Compte et campagne">
        {onLeaveCampaign && <button className="header-action" onClick={() => guard(onLeaveCampaign)} disabled={busy}><ArrowLeft size={16} /><span>Campagnes</span></button>}
        <button className="header-action" onClick={() => guard(onSignOut)} disabled={busy}><LogOut size={16} /><span>Déconnexion</span></button>
      </nav>
    </header>
    <main className="workspace">
      <div className="workspace-heading">
        <div><div className="eyebrow">LORE DE LA CAMPAGNE · {campaignName}</div><h1>{trash ? 'La corbeille du MJ.' : 'Les fiches de votre aventure.'}</h1>
          <p>{trash ? 'Restaurez une fiche supprimée : elle reviendra en brouillon avec ses annotations et son image.' : gmView ? 'Publiez ce que les personnages connaissent. Les joueurs ajoutent leurs notes.' : 'Retrouvez vos découvertes et annotez les fiches ensemble.'}</p>
        </div>
        <div className="fiche-top-actions">
          {isGM && <label className="preview-toggle"><Checkbox checked={preview} disabled={busy} onCheckedChange={value => guard(() => {
            setPreview(value === true); setTrash(false); closeEditor(); setId(null); resetNote(); setLoading(true);
          })} /><Eye size={16} />Vue joueurs</label>}
          {gmView && <button className="secondary" onClick={() => guard(() => {setTrash(!trash); setId(null); setQuery(''); closeEditor(); resetNote(); setLoading(true);})} disabled={busy}>{trash ? <ArrowLeft size={17}/> : <Trash2 size={17}/>} {trash ? 'Fiches actives' : 'Corbeille'}</button>}
          {gmView && !trash && <button className="primary" onClick={start} disabled={busy} aria-label={category.createLabel}><Plus size={18} /><span className="desktop-action-label">{category.newLabel}</span><span className="mobile-action-label">Nouveau</span></button>}
        </div>
      </div>
      <Tabs value={type} onValueChange={value => guard(() => {
        if (!isFicheType(value)) return;
        setType(value); setId(null); setQuery(''); closeEditor(); resetNote();
      })}>
        <TabsList ref={sectionTabs} variant="line" className="section-tabs" aria-label="Catégories du lore">
          {ficheTypes.map(ficheType => {
            const TabIcon = categoryIcons[ficheType];
            return <TabsTrigger key={ficheType} value={ficheType} className="section-tab" disabled={busy}><TabIcon size={18} />{loreCategories[ficheType].label}<span className="tab-count">{fiches.filter(fiche => fiche.type === ficheType && !!fiche.deletedAt === trash && (!playerView || fiche.published)).length}</span></TabsTrigger>;
          })}
        </TabsList>
      </Tabs>
      <div className={`fiche-grid${listCollapsed ? ' mobile-list-collapsed' : ''}`}>
        <aside className="collection fiche-collection">
          <button type="button" className="mobile-list-toggle" aria-expanded={!listCollapsed} aria-controls="compendium-fiche-list" onClick={() => setListCollapsed(value => !value)}><Icon size={16}/><span>{listCollapsed ? 'Choisir une fiche' : 'Réduire la liste'}</span>{listCollapsed ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}</button>
          <div className="collection-controls">
          <div className="collection-title"><span>{category.collectionTitle.toLocaleUpperCase('fr')}</span>
            <button className="icon-button" aria-label="Actualiser les fiches" disabled={busy || dirty} onClick={() => {
              void reload(); if (selected && !trash) void loadNotes(selected.id);
            }}><RefreshCw size={16} /></button>
          </div>
          <label className="fiche-search"><Search size={17} /><span className="sr-only">Rechercher dans {category.label}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={category.searchPlaceholder} /></label>
          {search && <p className="search-count" role="status">{rows.length} sur {collection.length} fiches</p>}
          </div>
          {loading ? <p className="collection-hint" role="status">Ouverture des fiches…</p> : rows.length ? <nav id="compendium-fiche-list" className="fiche-list" ref={ficheList} aria-label={`Liste : ${category.label}`} tabIndex={0}>{rows.map(fiche =>
            <button key={fiche.id} className={`fiche-link ${selected?.id === fiche.id && !draft ? 'active' : ''}`} aria-current={selected?.id === fiche.id && !draft ? 'true' : undefined} disabled={busy} onClick={() => guard(() => {
              setId(fiche.id); setListCollapsed(true); closeEditor(); resetNote();
            })}>
              <span className="fiche-mini-icon"><Icon size={19} /></span>
              <span className="fiche-link-text"><span className="entry-title">{fiche.name}</span>
                {fiche.subtitle && <span className="fiche-subtitle">{fiche.subtitle}</span>}
                <span className="fiche-list-meta">{!fiche.published && <span className="draft-badge">{trash ? 'Dans la corbeille' : 'Brouillon MJ'}</span>}<MessageSquare size={12} />{fiche.annotationCount} {fiche.annotationCount > 1 ? 'annotations' : 'annotation'}</span>
              </span>
            </button>,
          )}</nav> : <p className="collection-hint">{search ? 'Aucune fiche ne correspond à cette recherche.' : trash ? 'La corbeille est vide pour cette catégorie.' : gmView ? 'Ajoutez une fiche, puis rendez-la visible quand le groupe la découvre.' : 'Les fiches publiées par le MJ apparaîtront ici.'}</p>}
        </aside>
        <div className="page-area" ref={pageArea} role="region" aria-label={`Fiche : ${editorCategory.label}`} tabIndex={0}>
          {actionError && <div className="notice error" role="alert">{actionError}</div>}
          {error && <div className="notice error" role="alert">{error}<button disabled={busy || dirty} onClick={() => void reload()}>Réessayer</button></div>}
          {draft ? <article className="journal-page fiche-editor">
            <div className="page-topline"><span><EditorIcon size={15} />{editorCategory.singular.toLocaleUpperCase('fr')} · FICHE DU MJ</span><span>VERSION JOUEURS</span></div>
            <form className="editor" onSubmit={event => { event.preventDefault(); void saveFiche(); }}>
              <fieldset disabled={busy}>
                <label className="field-label" htmlFor="fiche-type">Catégorie du lore</label>
                <select id="fiche-type" className="fiche-type-select" value={draft.type} onChange={event => {
                  const value = event.target.value;
                  if (isFicheType(value)) setDraft({ ...draft, type: value });
                }}>{ficheTypes.map(ficheType => <option key={ficheType} value={ficheType}>{loreCategories[ficheType].label}</option>)}</select>
                <label className="field-label" htmlFor="fiche-name">Nom</label>
                <input id="fiche-name" className="title-input" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={160} placeholder={editorCategory.namePlaceholder} autoFocus />
                <div className="fiche-fields">
                  <div><label className="field-label" htmlFor="fiche-subtitle">{editorCategory.subtitleLabel}</label><input id="fiche-subtitle" value={draft.subtitle} onChange={event => setDraft({ ...draft, subtitle: event.target.value })} maxLength={160} placeholder={editorCategory.subtitlePlaceholder} /></div>
                  <div><label className="field-label" htmlFor="fiche-location">{editorCategory.locationLabel}</label><input id="fiche-location" value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} maxLength={160} placeholder={editorCategory.locationPlaceholder} /></div>
                </div>
                <label className="field-label" htmlFor="fiche-summary">Présentation courte</label>
                <textarea id="fiche-summary" className="summary-input" value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} required maxLength={300} placeholder={editorCategory.summaryPlaceholder} />
                <section className="fiche-image-editor" aria-labelledby="fiche-image-heading">
                  <h3 id="fiche-image-heading">Illustration</h3>
                  {base?.imagePath && draft.imagePath?.trim()
                    ? <FicheImage path={base.imagePath} name={draft.name || base.name} load={api.loadImage}/>
                    : <p className="image-editor-empty">Aucune illustration enregistrée pour ce choix.</p>}
                  <label className="field-label" htmlFor="fiche-image-path">Chemin de l’image</label>
                  <input id="fiche-image-path" type="text" value={draft.imagePath ?? ''} onChange={event => setDraft({ ...draft, imagePath: event.target.value })} maxLength={512} autoComplete="off" spellCheck={false} aria-describedby="fiche-image-help" placeholder={`images/${editorCategory.label.toLocaleLowerCase('fr')}/nom.jpg`}/>
                  <p id="fiche-image-help" className="editor-help">Déposez le JPG dans <code>public/images/{editorCategory.label.toLocaleLowerCase('fr')}/</code>, publiez avec <code>publier.cmd</code>, puis renseignez son chemin. Nom sans espaces ni accents. Images publiques, même en brouillon. Videz le champ pour retirer l’image.</p>
                  {draft.imagePath?.trim() && draft.imagePath.trim() !== base?.imagePath && <p className="image-editor-status">La nouvelle illustration s’affichera après l’enregistrement.</p>}
                </section>
                <RichTextEditor id="fiche-description" label="Informations révélées" value={draft.description} onChange={description=>setDraft({...draft,description})} disabled={busy} onFiles={api.uploadAttachment?files=>uploadFiles(files,'fiche'):undefined} attachmentSlot={<><AttachmentList files={ficheFiles} load={api.loadAttachment} onRemove={file=>removeFile(file,'fiche')} disabled={busy}/>{fileUploading&&<p className="attachment-status" role="status">Dépôt du fichier…</p>}</>}/>
                <label className="publish-choice"><Checkbox checked={draft.published} onCheckedChange={value => setDraft({ ...draft, published: value === true })} disabled={busy} /><span><strong>Visible par les joueurs</strong><small>Décochez pour garder cette fiche en brouillon MJ.</small></span></label>
                <p className="editor-help">Cette fiche contient uniquement la version destinée aux joueurs.</p>
                {saveError && <p className="save-error" role="alert">{saveError}</p>}
                <div className="editor-actions"><button type="button" className="secondary" onClick={() => guard(closeEditor)}>Annuler</button><button type="submit" className="primary"><Save size={16} />{saving ? 'Enregistrement…' : draft.published ? 'Enregistrer et publier' : 'Enregistrer le brouillon'}</button></div>
              </fieldset>
            </form>
          </article> : selected ? <>
            <article className="journal-page fiche-reader">
              <div className="page-topline"><span><Icon size={15} />{category.singular.toLocaleUpperCase('fr')} · FICHE DU MJ</span><span className={selected.published ? 'published-badge' : 'draft-badge'}>{trash ? 'Dans la corbeille' : selected.published ? 'Partagée avec les joueurs' : 'Brouillon MJ'}</span></div>
              <div className="fiche-identity"><div className="fiche-large-icon"><Icon size={34} /></div><div>{selected.subtitle && <div className="fiche-role">{selected.subtitle}</div>}<h2>{selected.name}</h2>{selected.location && <div className="fiche-location"><MapPin size={15} />{selected.location}</div>}</div></div>
              <p className="fiche-summary">{selected.summary}</p>
              {selected.imagePath && !trash && <FicheImage key={selected.imagePath} path={selected.imagePath} name={selected.name} load={api.loadImage}/>}
              {selected.description && <div className="revealed"><h3>Ce que vous savez</h3><StructuredContent text={selected.description} /></div>}
              {!trash&&<AttachmentList files={selected.attachments??[]} load={api.loadAttachment}/>}
              <div className="fiche-official-footer"><span>{trash ? 'Fiche supprimée le' : 'Fiche mise à jour le'} {stamp(selected.deletedAt || selected.updatedAt)}</span>{gmView && <div className="fiche-management">{trash ? <button className="secondary" disabled={busy} onClick={() => void moveFiche(selected, true)}><Undo2 size={15}/>{moving ? 'Restauration…' : 'Restaurer en brouillon'}</button> : <><button className="secondary" onClick={edit} disabled={busy}><Pencil size={15} />Modifier la fiche</button><button className="secondary danger" disabled={busy} onClick={() => guard(() => {setDeleteError(''); setDeleteTarget(selected);})}><Trash2 size={15}/>Supprimer</button></>}</div>}</div>
            </article>
            {!trash && <section className="annotations" aria-label="Annotations des joueurs">
              <div className="annotations-heading"><h2>Notes du groupe <span>({annotations.length})</span></h2></div>
              {noteLoading ? <p className="annotation-help" role="status">Chargement des annotations…</p> : annotations.length ? <div className="annotation-list">{annotations.map(note =>
                <article key={note.id} className={`annotation${note.deletedAt ? ' annotation-deleted' : ''}`}><header><div className="annotation-author"><strong>{note.author}</strong><time dateTime={note.deletedAt || note.updatedAt} title={`${note.deletedAt ? 'Supprimé le ' : note.updatedAt !== note.createdAt ? 'Modifiée le ' : ''}${stamp(note.deletedAt || note.updatedAt)}`} aria-label={`${note.deletedAt ? 'Supprimé le ' : note.updatedAt !== note.createdAt ? 'Modifiée le ' : ''}${stamp(note.deletedAt || note.updatedAt)}`}>{noteDate(note.deletedAt || note.updatedAt)}</time></div><div className="annotation-tools">{note.canEdit && !note.deletedAt && <button className="icon-button" aria-label={`Modifier votre annotation du ${stamp(note.updatedAt)}`} onClick={() => guard(() => {
                  discardPending(noteFiles,editingAnnotation?.attachments??[]); noteFicheId.current = note.ficheId; setEditingAnnotation(note); setAnnotationBody(note.body); setNoteFiles(note.attachments??[]); setNoteError('');
                })} disabled={busy}><Pencil size={15} /></button>}{note.canDelete && !note.deletedAt && <button className="icon-button danger" aria-label={`Supprimer votre annotation du ${stamp(note.updatedAt)}`} disabled={busy} onClick={event => {noteDeleteTrigger.current = event.currentTarget; setNoteDeleteError(''); setNoteDeleteTarget(note);}}><Trash2 size={15}/></button>}</div></header>{note.deletedAt?<p>Message supprimé par l’utilisateur.</p>:<><StructuredContent text={note.body}/><AttachmentList files={note.attachments??[]} load={api.loadAttachment}/></>}</article>,
              )}</div> : <p className="annotation-empty">Aucune annotation pour le moment.</p>}
              <form className="annotation-form" onSubmit={event => { event.preventDefault(); void saveNote(); }}>
                <RichTextEditor id="annotation-body" label={editingAnnotation?'Modifier votre annotation':'Ajouter une annotation'} value={annotationBody} onChange={text=>{noteFicheId.current=selected.id;setAnnotationBody(text);}} disabled={busy} onFiles={api.uploadAttachment?files=>uploadFiles(files,'annotation'):undefined} attachmentSlot={<><AttachmentList files={noteFiles} load={api.loadAttachment} onRemove={file=>removeFile(file,'annotation')} disabled={busy}/>{fileUploading&&<p className="attachment-status" role="status">Dépôt du fichier…</p>}</>}/>
                {noteError && <p className="save-error" role="alert">{noteError}</p>}
                <div className="annotation-actions"><div>{(editingAnnotation||annotationBody||noteFiles.length>0) && <button type="button" className="secondary" onClick={() => guard(resetNote)} disabled={busy}>Annuler</button>}<button type="submit" className="primary" disabled={!annotationBody.trim() || busy}>{noteSaving ? 'Enregistrement…' : editingAnnotation ? 'Enregistrer' : 'Ajouter'}</button></div></div>
              </form>
            </section>}
          </> : <article className="journal-page">
              <div className="page-topline"><span><Icon size={15} />{category.pageTitle.toLocaleUpperCase('fr')}</span><span>FICHES PARTAGÉES</span></div>
            <div className="empty-page"><span className="empty-symbol"><Icon size={30} /></span><div className="eyebrow">{trash ? 'CORBEILLE DU MJ' : gmView ? 'PRÉPARER UNE DÉCOUVERTE' : 'LES DÉCOUVERTES DU GROUPE'}</div><h2>{trash ? 'Aucune fiche supprimée.' : gmView ? category.emptyTitle : 'Les prochaines découvertes vous attendent.'}</h2><p>{trash ? 'Les fiches supprimées de cette catégorie apparaîtront ici. Vous pourrez les restaurer en brouillon.' : gmView ? 'Un nom, une présentation courte et les informations révélées. Les joueurs pourront ensuite ajouter leurs annotations sur chaque fiche.' : 'Votre MJ publie ici les découvertes et les savoirs de votre campagne. Chaque fiche dispose d’un espace pour vos annotations.'}</p>{gmView && !trash && <button className="primary" onClick={start} disabled={busy}><Plus size={17} />{category.createLabel}</button>}{!trash && <div className="empty-prompts"><div><span>01</span>La fiche du MJ</div><div><span>02</span>Les informations connues</div><div><span>03</span>Les notes des joueurs</div></div>}</div>
          </article>}
        </div>
      </div>
      <footer className="workspace-footer"><span>Les fiches du MJ, les annotations du groupe.</span><div className="workspace-footer-actions">{footerActions}<span>Le lore de votre campagne</span></div></footer>
    </main>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => {if (!open && !busy) {setDeleteTarget(null); setDeleteError('');}}}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Supprimer « {deleteTarget?.name} » ?</AlertDialogTitle><AlertDialogDescription>Cette fiche quittera les fiches actives. Les joueurs n’auront plus accès à son texte, ses annotations ni son image. Vous pourrez la restaurer depuis la corbeille du MJ.</AlertDialogDescription></AlertDialogHeader>
        {deleteError && <p className="save-error" role="alert">{deleteError}</p>}
        <div className="dialog-actions"><AlertDialogCancel className="secondary" disabled={busy}>Annuler</AlertDialogCancel><AlertDialogAction className="primary danger" disabled={busy} onClick={event => {event.preventDefault(); if (deleteTarget) void moveFiche(deleteTarget);}}>{moving ? 'Suppression…' : 'Supprimer la fiche'}</AlertDialogAction></div>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!noteDeleteTarget} onOpenChange={open => {if (!open && !busy) {setNoteDeleteTarget(null); setNoteDeleteError('');}}}>
      <AlertDialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        const trigger = noteDeleteTrigger.current;
        (trigger?.isConnected ? trigger : pageArea.current)?.focus({ preventScroll: true });
      }}><AlertDialogHeader><AlertDialogTitle>Supprimer votre message ?</AlertDialogTitle><AlertDialogDescription>Le texte sera effacé. Votre nom, la date et la mention « Message supprimé par l’utilisateur » resteront visibles.</AlertDialogDescription></AlertDialogHeader>
        {noteDeleteTarget && <p className="annotation-delete-preview">{noteDeleteTarget.body.length > 200 ? `${noteDeleteTarget.body.slice(0, 200)}…` : noteDeleteTarget.body}</p>}
        {noteDeleteTarget && editingAnnotation?.id === noteDeleteTarget.id && dirty && <p className="annotation-delete-warning">Les modifications en cours de ce message seront aussi abandonnées.</p>}
        {noteDeleteError && <p className="save-error" role="alert">{noteDeleteError}</p>}
        <div className="dialog-actions"><AlertDialogCancel className="secondary" disabled={busy}>Conserver le message</AlertDialogCancel><AlertDialogAction ref={noteDeleteConfirm} className="primary danger" disabled={busy} onClick={event => {event.preventDefault(); void deleteNote();}}>{noteDeleting ? 'Suppression…' : 'Supprimer mon message'}</AlertDialogAction></div>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={discard} onOpenChange={open => { setDiscard(open); if (!open) pending.current = null; }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle><AlertDialogDescription>Votre fiche ou votre annotation contient des modifications non enregistrées.</AlertDialogDescription></AlertDialogHeader><div className="dialog-actions"><AlertDialogCancel className="secondary">Continuer à écrire</AlertDialogCancel><AlertDialogAction className="primary" onClick={() => {
        const action = pending.current; pending.current = null; if (action) runAction(action);
      }}>Abandonner les modifications</AlertDialogAction></div></AlertDialogContent>
    </AlertDialog>
  </div>;
}
