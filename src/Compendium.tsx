import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronUp, Eye, LogOut, MapPin, MessageSquare,
  Pencil, Plus, RefreshCw, Save, Search, Trash2, Undo2, Users,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import type { CompendiumApi } from './api';
import type { Annotation, Fiche, FicheDraft, FicheType } from './lib/fiches';
import { emptyFiche } from './lib/fiches';
import FicheImage from './components/FicheImage';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { Checkbox } from './components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from './components/ui/alert-dialog';

type GuardedAction = () => void | Promise<void>;

export type CompendiumProps = {
  api: CompendiumApi;
  userName: string;
  isGM: boolean;
  campaignName: string;
  onSignOut: GuardedAction;
  onLeaveCampaign: GuardedAction;
  footerActions?: ReactNode;
  refreshRevision?: number;
};

const stamp = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris',
}).format(new Date(value));

const asDraft = (fiche: Fiche): FicheDraft => ({
  type: fiche.type, name: fiche.name, subtitle: fiche.subtitle,
  location: fiche.location, summary: fiche.summary,
  description: fiche.description, published: fiche.published,
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
    || annotationBody !== (editingAnnotation?.body ?? '');
  const busy = saving || noteSaving || noteDeleting || leaving || moving;
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

  function resetNote() {
    setAnnotationBody('');
    setEditingAnnotation(null);
    setNoteError('');
    noteFicheId.current = null;
  }

  function closeEditor() {
    setDraft(null);
    setBase(null);
    setSaveError('');
  }

  function start() {
    guard(() => {
      const fresh = emptyFiche(type);
      firstDraft.current = fresh;
      setBase(null);
      setDraft(fresh);
      setSaveError('');
      resetNote();
    });
  }

  function edit() {
    if (!selected || !gmView) return;
    guard(() => {
      setBase(selected);
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
      const result = await currentApi.saveFiche(draft, base?.id, base?.version);
      if (!mounted.current || lifecycle.current !== generation || apiRef.current !== currentApi) return;
      ++listGeneration.current;
      setFiches(previous => [result, ...previous.filter(fiche => fiche.id !== result.id)]
        .sort((left, right) => left.name.localeCompare(right.name, 'fr')));
      setId(result.id);
      closeEditor();
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
      });
      if (!mounted.current || lifecycle.current !== generation || apiRef.current !== currentApi) return;
      ++noteGeneration.current;
      setAnnotations(result);
      setFiches(previous => previous.map(fiche => fiche.id === ficheId
        ? { ...fiche, annotationCount: result.length } : fiche));
      resetNote();
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

  const Icon = type === 'place' ? MapPin : Users;

  return <div className="notebook-shell">
    <Toaster richColors />
    <header className="topbar">
      <button className="brand" onClick={() => guard(onLeaveCampaign)} disabled={busy} aria-label="Compendium Memoriae, choisir une campagne">
        <span className="brand-mark"><BookOpen size={24} /></span>
        <span>COMPENDIUM<span className="brand-sub">MEMORIAE</span></span>
      </button>
      <div className="campaign-identity"><span>{campaignName}</span><small>{isGM ? 'Espace MJ' : 'Espace joueurs'}</small></div>
      <div className="user"><span className="avatar">{userName.charAt(0).toUpperCase()}</span><span className="user-name">{userName}</span></div>
      <nav className="account-actions" aria-label="Compte et campagne">
        <button className="header-action" onClick={() => guard(onLeaveCampaign)} disabled={busy}><ArrowLeft size={16} /><span>Campagnes</span></button>
        <button className="header-action" onClick={() => guard(onSignOut)} disabled={busy}><LogOut size={16} /><span>Déconnexion</span></button>
      </nav>
    </header>
    <main className="workspace">
      <div className="workspace-heading">
        <div><div className="eyebrow">LIEUX & PERSONNAGES · {campaignName}</div><h1>{trash ? 'La corbeille du MJ.' : 'Les fiches de votre aventure.'}</h1>
          <p>{trash ? 'Restaurez une fiche supprimée : elle reviendra en brouillon avec ses annotations et son image.' : gmView ? 'Publiez ce que les personnages connaissent. Les joueurs ajoutent leurs notes.' : 'Retrouvez vos découvertes et annotez les fiches ensemble.'}</p>
        </div>
        <div className="fiche-top-actions">
          {isGM && <label className="preview-toggle"><Checkbox checked={preview} disabled={busy} onCheckedChange={value => guard(() => {
            setPreview(value === true); setTrash(false); closeEditor(); setId(null); resetNote(); setLoading(true);
          })} /><Eye size={16} />Vue joueurs</label>}
          {gmView && <button className="secondary" onClick={() => guard(() => {setTrash(!trash); setId(null); setQuery(''); closeEditor(); resetNote(); setLoading(true);})} disabled={busy}>{trash ? <ArrowLeft size={17}/> : <Trash2 size={17}/>} {trash ? 'Fiches actives' : 'Corbeille'}</button>}
          {gmView && !trash && <button className="primary" onClick={start} disabled={busy} aria-label={type === 'place' ? 'Créer une fiche de lieu' : 'Créer une fiche de PNJ'}><Plus size={18} /><span className="desktop-action-label">{type === 'place' ? 'Nouveau lieu' : 'Nouveau PNJ'}</span><span className="mobile-action-label">Nouveau</span></button>}
        </div>
      </div>
      <Tabs value={type} onValueChange={value => guard(() => {
        setType(value as FicheType); setId(null); setQuery(''); closeEditor(); resetNote();
      })}>
        <TabsList variant="line" className="section-tabs">
          <TabsTrigger value="place" className="section-tab" disabled={busy}><MapPin size={18} />Lieux<span className="tab-count">{fiches.filter(fiche => fiche.type === 'place' && (!playerView || fiche.published)).length}</span></TabsTrigger>
          <TabsTrigger value="npc" className="section-tab" disabled={busy}><Users size={18} />PNJ<span className="tab-count">{fiches.filter(fiche => fiche.type === 'npc' && (!playerView || fiche.published)).length}</span></TabsTrigger>
        </TabsList>
      </Tabs>
      <div className={`fiche-grid${listCollapsed ? ' mobile-list-collapsed' : ''}`}>
        <aside className="collection fiche-collection">
          <button type="button" className="mobile-list-toggle" aria-expanded={!listCollapsed} aria-controls="compendium-fiche-list" onClick={() => setListCollapsed(value => !value)}><Icon size={16}/><span>{listCollapsed ? 'Choisir une fiche' : 'Réduire la liste'}</span>{listCollapsed ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}</button>
          <div className="collection-controls">
          <div className="collection-title"><span>{type === 'place' ? 'LES LIEUX CONNUS' : 'LES PERSONNAGES RENCONTRÉS'}</span>
            <button className="icon-button" aria-label="Actualiser les fiches" disabled={busy || dirty} onClick={() => {
              void reload(); if (selected && !trash) void loadNotes(selected.id);
            }}><RefreshCw size={16} /></button>
          </div>
          <label className="fiche-search"><Search size={17} /><span className="sr-only">Rechercher un lieu ou un personnage</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={type === 'place' ? 'Rechercher un lieu…' : 'Rechercher un personnage…'} /></label>
          {search && <p className="search-count" role="status">{rows.length} sur {collection.length} {type === 'place' ? 'lieux' : 'personnages'}</p>}
          </div>
          {loading ? <p className="collection-hint" role="status">Ouverture des fiches…</p> : rows.length ? <nav id="compendium-fiche-list" className="fiche-list" ref={ficheList} aria-label={type === 'place' ? 'Liste des lieux' : 'Liste des PNJ'} tabIndex={0}>{rows.map(fiche =>
            <button key={fiche.id} className={`fiche-link ${selected?.id === fiche.id && !draft ? 'active' : ''}`} aria-current={selected?.id === fiche.id && !draft ? 'true' : undefined} disabled={busy} onClick={() => guard(() => {
              setId(fiche.id); setListCollapsed(true); closeEditor(); resetNote();
            })}>
              <span className="fiche-mini-icon"><Icon size={19} /></span>
              <span className="fiche-link-text"><span className="entry-title">{fiche.name}</span>
                {fiche.subtitle && <span className="fiche-subtitle">{fiche.subtitle}</span>}
                <span className="fiche-list-meta">{!fiche.published && <span className="draft-badge">{trash ? 'Dans la corbeille' : 'Brouillon MJ'}</span>}<MessageSquare size={12} />{fiche.annotationCount} {fiche.annotationCount > 1 ? 'annotations' : 'annotation'}</span>
              </span>
            </button>,
          )}</nav> : <p className="collection-hint">{search ? 'Aucune fiche ne correspond à cette recherche.' : trash ? 'La corbeille est vide pour cette catégorie.' : gmView ? 'Ajoutez une fiche légère, puis rendez-la visible quand le groupe découvre ce lieu ou ce personnage.' : 'Les fiches publiées par le MJ apparaîtront ici.'}</p>}
        </aside>
        <div className="page-area" ref={pageArea} role="region" aria-label={type === 'place' ? 'Fiche du lieu' : 'Fiche du PNJ'} tabIndex={0}>
          {actionError && <div className="notice error" role="alert">{actionError}</div>}
          {error && <div className="notice error" role="alert">{error}<button disabled={busy || dirty} onClick={() => void reload()}>Réessayer</button></div>}
          {draft ? <article className="journal-page fiche-editor">
            <div className="page-topline"><span><Icon size={15} />{type === 'place' ? 'FICHE DE LIEU' : 'FICHE DE PNJ'}</span><span>VERSION JOUEURS</span></div>
            <form className="editor" onSubmit={event => { event.preventDefault(); void saveFiche(); }}>
              <fieldset disabled={busy}>
                <label className="field-label" htmlFor="fiche-name">Nom</label>
                <input id="fiche-name" className="title-input" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={160} placeholder={type === 'place' ? 'Le nom du lieu…' : 'Le nom du personnage…'} autoFocus />
                <div className="fiche-fields">
                  <div><label className="field-label" htmlFor="fiche-subtitle">{type === 'place' ? 'Type de lieu' : 'Rôle connu'}</label><input id="fiche-subtitle" value={draft.subtitle} onChange={event => setDraft({ ...draft, subtitle: event.target.value })} maxLength={160} placeholder={type === 'place' ? 'Taverne, quartier, bibliothèque…' : 'Herboriste, garde, marchande…'} /></div>
                  <div><label className="field-label" htmlFor="fiche-location">{type === 'place' ? 'Quartier ou région' : 'Lieu connu'}</label><input id="fiche-location" value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} maxLength={160} placeholder="Ce que les personnages connaissent…" /></div>
                </div>
                <label className="field-label" htmlFor="fiche-summary">Présentation courte</label>
                <textarea id="fiche-summary" className="summary-input" value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} required maxLength={300} placeholder="Deux ou trois phrases pour reconnaître le lieu ou le PNJ." />
                <label className="field-label" htmlFor="fiche-description">Informations révélées</label>
                <textarea id="fiche-description" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} maxLength={6000} placeholder="Apparence, services connus, faits découverts en partie…" />
                <label className="publish-choice"><Checkbox checked={draft.published} onCheckedChange={value => setDraft({ ...draft, published: value === true })} disabled={busy} /><span><strong>Visible par les joueurs</strong><small>Décochez pour garder cette fiche en brouillon MJ.</small></span></label>
                <p className="editor-help">Cette fiche contient uniquement la version destinée aux joueurs.</p>
                {saveError && <p className="save-error" role="alert">{saveError}</p>}
                <div className="editor-actions"><button type="button" className="secondary" onClick={() => guard(closeEditor)}>Annuler</button><button type="submit" className="primary"><Save size={16} />{saving ? 'Enregistrement…' : draft.published ? 'Enregistrer et publier' : 'Enregistrer le brouillon'}</button></div>
              </fieldset>
            </form>
          </article> : selected ? <>
            <article className="journal-page fiche-reader">
              <div className="page-topline"><span><Icon size={15} />{selected.type === 'place' ? 'LIEU' : 'PNJ'} · FICHE DU MJ</span><span className={selected.published ? 'published-badge' : 'draft-badge'}>{trash ? 'Dans la corbeille' : selected.published ? 'Partagée avec les joueurs' : 'Brouillon MJ'}</span></div>
              <div className="fiche-identity"><div className="fiche-large-icon"><Icon size={34} /></div><div>{selected.subtitle && <div className="fiche-role">{selected.subtitle}</div>}<h2>{selected.name}</h2>{selected.location && <div className="fiche-location"><MapPin size={15} />{selected.location}</div>}</div></div>
              <p className="fiche-summary">{selected.summary}</p>
              {selected.imagePath && !trash && <FicheImage key={selected.imagePath} path={selected.imagePath} name={selected.name} load={api.loadImage}/>}
              {selected.description && <div className="revealed"><h3>Ce que vous savez</h3><p>{selected.description}</p></div>}
              <div className="fiche-official-footer"><span>{trash ? 'Fiche supprimée le' : 'Fiche mise à jour le'} {stamp(selected.deletedAt || selected.updatedAt)}</span>{gmView && <div className="fiche-management">{trash ? <button className="secondary" disabled={busy} onClick={() => void moveFiche(selected, true)}><Undo2 size={15}/>{moving ? 'Restauration…' : 'Restaurer en brouillon'}</button> : <><button className="secondary" onClick={edit} disabled={busy}><Pencil size={15} />Modifier la fiche</button><button className="secondary danger" disabled={busy} onClick={() => guard(() => {setDeleteError(''); setDeleteTarget(selected);})}><Trash2 size={15}/>Supprimer</button></>}</div>}</div>
            </article>
            {!trash && <section className="annotations" aria-label="Annotations des joueurs">
              <div className="annotations-heading"><div><span className="eyebrow">LA MÉMOIRE DU GROUPE</span><h2>Vos annotations <span>{annotations.length}</span></h2></div><MessageSquare size={22} /></div>
              <p className="annotation-help">Observations, souvenirs et théories du groupe, à côté de la fiche du MJ.</p>
              {noteLoading ? <p className="annotation-help" role="status">Chargement des annotations…</p> : annotations.length ? <div className="annotation-list">{annotations.map(note =>
                <article key={note.id} className={`annotation${note.deletedAt ? ' annotation-deleted' : ''}`}><header><span className="avatar">{note.author.charAt(0).toUpperCase()}</span><div className="annotation-author"><strong>{note.author}</strong><time dateTime={note.deletedAt || note.updatedAt}>{stamp(note.deletedAt || note.updatedAt)}{note.deletedAt ? ' · supprimé' : note.updatedAt !== note.createdAt ? ' · modifiée' : ''}</time></div><div className="annotation-tools">{note.canEdit && !note.deletedAt && <button className="icon-button" aria-label={`Modifier votre annotation du ${stamp(note.updatedAt)}`} onClick={() => guard(() => {
                  noteFicheId.current = note.ficheId; setEditingAnnotation(note); setAnnotationBody(note.body); setNoteError('');
                })} disabled={busy}><Pencil size={15} /></button>}{note.canDelete && !note.deletedAt && <button className="icon-button danger" aria-label={`Supprimer votre annotation du ${stamp(note.updatedAt)}`} disabled={busy} onClick={event => {noteDeleteTrigger.current = event.currentTarget; setNoteDeleteError(''); setNoteDeleteTarget(note);}}><Trash2 size={15}/></button>}</div></header><p>{note.deletedAt ? 'Message supprimé par l’utilisateur.' : note.body}</p></article>,
              )}</div> : <p className="annotation-empty">Aucune annotation pour le moment.</p>}
              <form className="annotation-form" onSubmit={event => { event.preventDefault(); void saveNote(); }}>
                <label htmlFor="annotation-body">{editingAnnotation ? 'Modifier votre annotation' : 'Ajouter une annotation'}</label>
                <textarea id="annotation-body" value={annotationBody} onChange={event => {
                  noteFicheId.current = selected.id; setAnnotationBody(event.target.value);
                }} required maxLength={6000} disabled={busy} placeholder="Une information à retenir, une hypothèse, une rencontre…" />
                {noteError && <p className="save-error" role="alert">{noteError}</p>}
                <div className="annotation-actions"><span>Visible par le groupe · signé {userName}</span><div>{editingAnnotation && <button type="button" className="secondary" onClick={() => guard(resetNote)} disabled={busy}>Annuler</button>}<button type="submit" className="primary" disabled={!annotationBody.trim() || busy}><MessageSquare size={16} />{noteSaving ? 'Enregistrement…' : editingAnnotation ? 'Enregistrer' : 'Ajouter ma note'}</button></div></div>
              </form>
            </section>}
          </> : <article className="journal-page">
            <div className="page-topline"><span><Icon size={15} />{type === 'place' ? 'LES LIEUX DE LA CAMPAGNE' : 'LES VISAGES DE LA CAMPAGNE'}</span><span>FICHES PARTAGÉES</span></div>
            <div className="empty-page"><span className="empty-symbol"><Icon size={30} /></span><div className="eyebrow">{trash ? 'CORBEILLE DU MJ' : gmView ? 'PRÉPARER UNE DÉCOUVERTE' : 'LES DÉCOUVERTES DU GROUPE'}</div><h2>{trash ? 'Aucune fiche supprimée.' : gmView ? (type === 'place' ? 'Le premier lieu à partager.' : 'Le premier visage à retenir.') : 'Les prochaines découvertes vous attendent.'}</h2><p>{trash ? 'Les fiches supprimées de cette catégorie apparaîtront ici. Vous pourrez les restaurer en brouillon.' : gmView ? 'Un nom, une présentation courte et les informations révélées. Les joueurs pourront ensuite ajouter leurs annotations sur chaque fiche.' : 'Votre MJ publie ici les lieux et les personnages que vous connaissez. Chaque fiche dispose d’un espace pour vos annotations.'}</p>{gmView && !trash && <button className="primary" onClick={start} disabled={busy}><Plus size={17} />{type === 'place' ? 'Créer une fiche de lieu' : 'Créer une fiche de PNJ'}</button>}{!trash && <div className="empty-prompts"><div><span>01</span>La fiche du MJ</div><div><span>02</span>Les informations connues</div><div><span>03</span>Les notes des joueurs</div></div>}</div>
          </article>}
        </div>
      </div>
      <footer className="workspace-footer"><span>Les fiches du MJ, les annotations du groupe.</span><div className="workspace-footer-actions">{footerActions}<span>Lieux · PNJ</span></div></footer>
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
