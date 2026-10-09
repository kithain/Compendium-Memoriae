import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Bold, Italic, List, ListOrdered, Link as LinkIcon, Table, Undo2, Redo2, Paperclip} from 'lucide-react';
import StructuredContent from './StructuredContent';
import {parseStructuredContent} from '../lib/organigrammes';
import {parseMarkdownTables} from '../lib/tableaux';
import {parseFormattingBlocks, safeFormattingUrl} from '../lib/formatting';
import '../styles/editor.css';

export type RichTextEditorProps = {
  id:string;
  value:string;
  onChange:(text:string)=>void;
  label?:string;
  maxLength?:number;
  disabled?:boolean;
  onFiles?:(files:File[])=>void|Promise<void>;
  attachmentHint?:string;
  attachmentSlot?:ReactNode;
};

type SourcePart = {source:string; protected:boolean; semantic:boolean};
type OriginalPart = SourcePart & {html:string};

function sourceParts(source:string):SourcePart[] {
  return parseStructuredContent(source).flatMap<SourcePart>(block => block.kind === 'diagram'
    ? [{source:block.source, protected:true, semantic:true}]
    : parseMarkdownTables(block.text).flatMap(part => part.kind === 'table'
      ? [{source:part.source, protected:false, semantic:true}]
      : parseFormattingBlocks(part.text).map(part => ({source:part.source, protected:false, semantic:part.kind !== 'text'}))));
}

function escapeMarkdownText(text:string) {
  return text.replace(/[\\`*\[\]~]/g, '\\$&');
}

function escapeMarkdownUrl(url:string) {
  return url.replace(/[\\()]/g, '\\$&');
}

function escapeTableCell(text:string) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// Only known semantic elements produce formatting. HTML pasted by a browser is
// never copied into the stored source; text nodes stay plain text.
function isBlockNode(node:Node) {
  return node instanceof HTMLElement && /^(?:DIV|P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE)$/.test(node.tagName);
}

function serializeChildren(node:Node):string {
  let source = '';
  let previous:Node|null = null;
  for(const child of Array.from(node.childNodes)) {
    const value = serializeNode(child);
    if(source && value && (isBlockNode(previous!) || isBlockNode(child)) && !source.endsWith('\n') && !value.startsWith('\n')) source += '\n';
    source += value;
    previous = child;
  }
  return source;
}

function serializeNode(node:Node):string {
  if(node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.textContent ?? '');
  if(!(node instanceof HTMLElement)) return '';
  const content = () => serializeChildren(node);
  const tag = node.tagName.toLowerCase();
  if(tag === 'br') return '\n';
  if(tag === 'strong' || tag === 'b') return `**${content()}**`;
  if(tag === 'em' || tag === 'i') return `*${content()}*`;
  if(tag === 's' || tag === 'del') return `~~${content()}~~`;
  if(tag === 'a') {
    const href = safeFormattingUrl(node.getAttribute('href') ?? '');
    return href ? `[${content()}](${escapeMarkdownUrl(href)})` : content();
  }
  if(tag === 'pre') return `\`\`\`\n${node.textContent ?? ''}\n\`\`\``;
  if(tag === 'code') return `\`${node.textContent ?? ''}\``;
  if(/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${content()}`;
  if(tag === 'blockquote') return content().split('\n').map(line => `> ${line}`).join('\n');
  if(tag === 'ul' || tag === 'ol') {
    const start = tag === 'ol' ? Number(node.getAttribute('start') ?? '1') : 1;
    return Array.from(node.children).filter(child => child.tagName === 'LI').map((child, index) =>
      `${tag === 'ol' ? `${start + index}.` : '-'} ${serializeChildren(child)}`).join('\n');
  }
  if(tag === 'table') {
    const rows = Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.children)
      .filter(cell => cell.tagName === 'TH' || cell.tagName === 'TD')
      .map(cell => escapeTableCell(Array.from(cell.childNodes).map(serializeNode).join('').trim())));
    if(!rows.length) return '';
    const header = `| ${rows[0].join(' | ')} |`;
    const alignments = Array.from(node.querySelectorAll('thead th')).map(cell => cell.getAttribute('data-align'));
    const separator = `| ${rows[0].map((_, index) => alignments[index] === 'center' ? ':---:' : alignments[index] === 'right' ? '---:' : alignments[index] === 'left' ? ':---' : '---').join(' | ')} |`;
    return [header, separator, ...rows.slice(1).map(row => `| ${row.join(' | ')} |`)].join('\n');
  }
  if(tag === 'p') return content() || '\n';
  if(tag === 'div' && !node.classList.contains('structured-content')
    && !node.classList.contains('structured-content-plain')
    && !node.classList.contains('formatted-text')
    && !node.classList.contains('structured-table-scroll')) return content() || '\n';
  return content();
}

export default function RichTextEditor({id, value, onChange, label='Texte', maxLength=6000,
  disabled=false, onFiles, attachmentHint='Images, PDF, MD et TXT · 2 Mo par fichier', attachmentSlot}:RichTextEditorProps) {
  const [mode, setMode] = useState<'visual'|'text'>('visual');
  const [displayedSource, setDisplayedSource] = useState(value);
  const [status, setStatus] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('https://');
  const [dragging, setDragging] = useState(false);
  const [displayVersion, setDisplayVersion] = useState(0);
  const visualRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const selectedRange = useRef<Range|null>(null);
  const selectedText = useRef({start:0, end:0});
  const originals = useRef(new Map<string, OriginalPart>());
  const lastValue = useRef(value);
  const history = useRef({values:[value], index:0});
  const [, refreshHistory] = useState(0);
  const parts = sourceParts(displayedSource);

  useEffect(() => {
    if(value !== lastValue.current) {
      lastValue.current = value;
      history.current = {values:[value], index:0};
      setDisplayedSource(value);
      setStatus('');
      refreshHistory(count => count + 1);
    }
  }, [value]);

  useLayoutEffect(() => {
    if(mode !== 'visual' || !visualRef.current) return;
    const next = new Map<string, OriginalPart>();
    visualRef.current.querySelectorAll<HTMLElement>('[data-rich-part]').forEach(node => {
      const key = node.dataset.richPart!;
      const part = parts[Number(key)];
      if(part) next.set(key, {...part, html:node.innerHTML});
    });
    originals.current = next;
  // Input leaves the displayed DOM intact to keep its native selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedSource, displayVersion, mode]);

  function commit(next:string, redraw=false) {
    if(disabled) return false;
    if(next.length > maxLength) {
      setStatus(`Le texte dépasse la limite de ${maxLength.toLocaleString('fr-FR')} caractères.`);
      if(redraw || mode === 'visual') {setDisplayedSource(lastValue.current); setDisplayVersion(count => count + 1);}
      return false;
    }
    setStatus('');
    if(next !== lastValue.current) {
      const current = history.current;
      current.values = current.values.slice(0, current.index + 1);
      current.values.push(next);
      if(current.values.length > 100) current.values.shift();
      current.index = current.values.length - 1;
      lastValue.current = next;
      onChange(next);
      refreshHistory(count => count + 1);
    }
    if(redraw) setDisplayedSource(next);
    return true;
  }

  function redrawVisual() {
    setDisplayedSource(lastValue.current);
    setDisplayVersion(count => count + 1);
  }

  function readVisual():string|null {
    const root = visualRef.current;
    if(!root) return lastValue.current;
    for(const [key, original] of originals.current) {
      if(!original.protected) continue;
      const node:HTMLElement|null = root.querySelector<HTMLElement>(`[data-rich-part="${key}"]`);
      if(!node || node.parentElement !== root || node.innerHTML !== original.html) {
        setStatus('Les organigrammes se modifient dans l’onglet Texte. Votre modification visuelle a été annulée.');
        redrawVisual();
        return null;
      }
    }
    let source = '';
    let previousGenerated = false;
    for(const node of Array.from(root.childNodes)) {
      let generated = true;
      let chunk:string;
      if(node instanceof HTMLElement && node.dataset.richPart !== undefined) {
        generated = false;
        const original = originals.current.get(node.dataset.richPart);
        if(original && (original.protected || original.html === node.innerHTML)) chunk = original.source;
        else {
          chunk = serializeChildren(node);
          const ending = original?.semantic ? original.source.match(/(?:\r?\n[\t ]*)+$/)?.[0] ?? '' : '';
          if(ending && !chunk.endsWith('\n')) chunk += ending;
        }
      } else chunk = serializeNode(node);
      if(source && chunk && (generated || previousGenerated) && !source.endsWith('\n') && !chunk.startsWith('\n')) source += '\n';
      source += chunk;
      previousGenerated = generated;
    }
    return source;
  }

  function commitVisual() {
    const next = readVisual();
    return next !== null && commit(next);
  }

  function rememberSelection() {
    if(mode === 'text') {
      if(textRef.current) selectedText.current = {start:textRef.current.selectionStart, end:textRef.current.selectionEnd};
      return;
    }
    const selection = window.getSelection();
    if(selection?.rangeCount && visualRef.current?.contains(selection.anchorNode)) selectedRange.current = selection.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    visualRef.current?.focus();
    if(selectedRange.current && visualRef.current?.contains(selectedRange.current.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(selectedRange.current);
    }
  }

  function editText(before:string, after=before) {
    const textarea = textRef.current;
    const {start, end} = textarea ? {start:textarea.selectionStart, end:textarea.selectionEnd} : selectedText.current;
    const selected = lastValue.current.slice(start, end);
    if(commit(lastValue.current.slice(0, start) + before + selected + after + lastValue.current.slice(end), true)) {
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + before.length, end + before.length);
      });
    }
  }

  function command(action:string, argument?:string) {
    if(disabled) return;
    if(mode === 'text') {
      if(action === 'bold') editText('**');
      else if(action === 'italic') editText('*');
      else {
        const textarea = textRef.current;
        const selectionStart = textarea?.selectionStart ?? selectedText.current.start;
        const selectionEnd = textarea?.selectionEnd ?? selectedText.current.end;
        const start = lastValue.current.lastIndexOf('\n', selectionStart - 1) + 1;
        const newline = lastValue.current.indexOf('\n', selectionEnd);
        const end = newline === -1 ? lastValue.current.length : newline;
        const selected = lastValue.current.slice(start, end).split('\n').map((line, index) => {
          const text = line.replace(/^(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)/, '');
          if(action === 'insertUnorderedList') return '- ' + text;
          if(action === 'insertOrderedList') return `${index + 1}. ${text}`;
          return argument === 'p' ? text : '#'.repeat(Number(argument?.slice(1) ?? '1')) + ' ' + text;
        }).join('\n');
        if(commit(lastValue.current.slice(0, start) + selected + lastValue.current.slice(end), true)) requestAnimationFrame(() => {textarea?.focus(); textarea?.setSelectionRange(start, start + selected.length);});
      }
      return;
    }
    if(selectedRange.current && visualRef.current && Array.from(visualRef.current.querySelectorAll('.rich-editor-protected')).some(node => selectedRange.current!.intersectsNode(node))) {
      setStatus('Sélectionnez le texte à mettre en forme sans inclure un organigramme.');
      return;
    }
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(action, false, argument);
    commitVisual();
    rememberSelection();
  }

  function undo(direction:-1|1) {
    const nextIndex = history.current.index + direction;
    if(nextIndex < 0 || nextIndex >= history.current.values.length || disabled) return;
    history.current.index = nextIndex;
    const next = history.current.values[nextIndex];
    lastValue.current = next;
    onChange(next);
    setDisplayedSource(next);
    setStatus('');
    refreshHistory(count => count + 1);
  }

  function openLink() {
    rememberSelection();
    if(mode === 'visual' && selectedRange.current && visualRef.current && Array.from(visualRef.current.querySelectorAll('.rich-editor-protected')).some(node => selectedRange.current!.intersectsNode(node))) {
      setStatus('Sélectionnez le texte du lien sans inclure un organigramme.');
      return;
    }
    setLinkText(mode === 'text' ? value.slice(selectedText.current.start, selectedText.current.end) : window.getSelection()?.toString() ?? '');
    setLinkUrl('https://');
    setLinkOpen(true);
  }

  function insertLink() {
    if(mode === 'visual' && selectedRange.current && visualRef.current && Array.from(visualRef.current.querySelectorAll('.rich-editor-protected')).some(node => selectedRange.current!.intersectsNode(node))) {
      setStatus('Sélectionnez le texte du lien sans inclure un organigramme.');
      return;
    }
    const href = safeFormattingUrl(linkUrl);
    if(!href) {setStatus('Utilisez une adresse http://, https:// ou mailto:.'); return;}
    const text = linkText.trim() || href;
    if(mode === 'text') {
      const {start, end} = selectedText.current;
      commit(value.slice(0, start) + `[${escapeMarkdownText(text)}](${escapeMarkdownUrl(href)})` + value.slice(end), true);
    } else {
      restoreSelection();
      document.execCommand('insertText', false, text);
      const selection = window.getSelection();
      if(selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if(range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset >= text.length) {
          range.setStart(range.endContainer, range.endOffset - text.length);
          document.execCommand('createLink', false, href);
          selection.collapseToEnd();
        }
      }
      commitVisual();
    }
    setLinkOpen(false);
  }

  async function receiveFiles(files:File[]) {
    if(!onFiles || disabled || !files.length) return;
    try {await onFiles(files);} catch(error) {setStatus(error instanceof Error ? error.message : 'Le dépôt du fichier a échoué.');}
  }

  return <div className={`rich-editor${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
    onDragOver={event => {if(onFiles && !disabled && event.dataTransfer.types.includes('Files')) {event.preventDefault(); setDragging(true);}}}
    onDragLeave={event => {if(!event.currentTarget.contains(event.relatedTarget as Node|null)) setDragging(false);}}
    onDrop={event => {if(event.dataTransfer.files.length) {event.preventDefault(); setDragging(false); void receiveFiles(Array.from(event.dataTransfer.files));}}}>
    <label id={`${id}-label`} htmlFor={mode === 'text' ? id : undefined} className="rich-editor-label">{label}</label>
    <div className="rich-editor-box">
      <div className="rich-editor-toolbar" role="toolbar" aria-label={`Mise en forme : ${label}`}>
        <select aria-label="Style du texte" disabled={disabled} defaultValue="p" onMouseDown={rememberSelection}
          onChange={event => {command('formatBlock', event.target.value); event.target.value = 'p';}}>
          <option value="p">Style</option><option value="h1">Titre 1</option><option value="h2">Titre 2</option><option value="h3">Titre 3</option>
        </select>
        <button type="button" title="Gras" aria-label="Gras" disabled={disabled} onMouseDown={event => {rememberSelection(); event.preventDefault();}} onClick={() => command('bold')}><Bold size={16}/></button>
        <button type="button" title="Italique" aria-label="Italique" disabled={disabled} onMouseDown={event => {rememberSelection(); event.preventDefault();}} onClick={() => command('italic')}><Italic size={16}/></button>
        <span className="rich-editor-separator"/>
        <button type="button" title="Liste à puces" aria-label="Liste à puces" disabled={disabled} onMouseDown={event => {rememberSelection(); event.preventDefault();}} onClick={() => command('insertUnorderedList')}><List size={16}/></button>
        <button type="button" title="Liste numérotée" aria-label="Liste numérotée" disabled={disabled} onMouseDown={event => {rememberSelection(); event.preventDefault();}} onClick={() => command('insertOrderedList')}><ListOrdered size={16}/></button>
        <button type="button" title="Insérer un lien" aria-label="Insérer un lien" disabled={disabled} onMouseDown={event => {rememberSelection(); event.preventDefault();}} onClick={openLink}><LinkIcon size={16}/></button>
        <button type="button" title="Ajouter un tableau" aria-label="Ajouter un tableau" disabled={disabled}
          onClick={() => commit(value + (value ? '\n\n' : '') + '| Colonne 1 | Colonne 2 |\n| --- | --- |\n| Valeur 1 | Valeur 2 |\n', true)}><Table size={16}/></button>
        {onFiles && <button type="button" title="Joindre des fichiers" aria-label="Joindre des fichiers" disabled={disabled} onClick={() => filesRef.current?.click()}><Paperclip size={16}/></button>}
      </div>
      {linkOpen && <div className="rich-editor-link" role="group" aria-label="Nouveau lien">
        <label htmlFor={`${id}-link-text`}>Texte du lien<input id={`${id}-link-text`} value={linkText} onChange={event => setLinkText(event.target.value)} autoFocus/></label>
        <label htmlFor={`${id}-link-url`}>Adresse du lien<input id={`${id}-link-url`} type="url" value={linkUrl} onChange={event => setLinkUrl(event.target.value)}/></label>
        <div><button type="button" onClick={insertLink} disabled={disabled}>Insérer</button><button type="button" onClick={() => {setLinkOpen(false); setStatus('');}}>Annuler</button></div>
      </div>}
      {mode === 'visual' ? <div key={`${displayVersion}:${displayedSource}`} id={id} ref={visualRef} className="rich-editor-visual" role="textbox" aria-multiline="true"
        aria-labelledby={`${id}-label`} aria-describedby={onFiles ? `${id}-hint` : undefined} aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning
        onInput={commitVisual} onMouseUp={rememberSelection} onKeyUp={rememberSelection}
        onKeyDown={event => {if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); undo(event.shiftKey ? 1 : -1);} if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {event.preventDefault(); undo(1);}}}
        onPaste={event => {event.preventDefault(); if(event.clipboardData.files.length) void receiveFiles(Array.from(event.clipboardData.files)); else {document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); commitVisual();}}}>
        {parts.map((part, index) => <div key={index} data-rich-part={index} contentEditable={part.protected ? false : undefined}
          className={part.protected ? 'rich-editor-protected' : undefined}>
          {part.protected && <span className="rich-editor-protected-label">Organigramme · modifiable dans l’onglet Texte</span>}
          <StructuredContent text={part.source}/>
        </div>)}
      </div> : <textarea id={id} ref={textRef} className="rich-editor-source" value={value} disabled={disabled} maxLength={maxLength}
        aria-describedby={onFiles ? `${id}-hint` : undefined} onChange={event => commit(event.target.value, true)} onSelect={rememberSelection}
        onKeyDown={event => {if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); undo(event.shiftKey ? 1 : -1);} if((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {event.preventDefault(); undo(1);}}}/>}
      <div className="rich-editor-footer">
        <div className="rich-editor-tabs" role="tablist" aria-label="Mode de rédaction">
          <button type="button" role="tab" aria-selected={mode === 'visual'} disabled={disabled} onClick={() => {setDisplayedSource(value); setMode('visual'); setLinkOpen(false);}}>Visuel</button>
          <button type="button" role="tab" aria-selected={mode === 'text'} disabled={disabled} onClick={() => {setMode('text'); setLinkOpen(false);}}>Texte</button>
        </div>
        <div className="rich-editor-history"><button type="button" aria-label="Annuler la modification" title="Annuler la modification" disabled={disabled || history.current.index === 0} onClick={() => undo(-1)}><Undo2 size={15}/></button><button type="button" aria-label="Rétablir la modification" title="Rétablir la modification" disabled={disabled || history.current.index === history.current.values.length - 1} onClick={() => undo(1)}><Redo2 size={15}/></button></div>
        <span className="rich-editor-counter" aria-label="Nombre de caractères">{value.length.toLocaleString('fr-FR')} / {maxLength.toLocaleString('fr-FR')}</span>
      </div>
    </div>
    {onFiles && <><input ref={filesRef} className="rich-editor-file-input" type="file" multiple disabled={disabled}
      accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.avif,.pdf,.md,.txt" aria-label="Fichiers à joindre" onChange={event => {void receiveFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '';}}/>
      <div id={`${id}-hint`} className="rich-editor-file-hint"><Paperclip size={14}/><span>{attachmentHint} · Glissez un fichier ici ou utilisez le trombone.</span></div></>}
    {attachmentSlot}
    {status && <p className="rich-editor-status" role="status">{status}</p>}
  </div>;
}
