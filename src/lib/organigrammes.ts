export const ORGANIGRAMME_TYPES = [
  'organigramme',
  'autorite',
  'autorite-principale',
  'autorite-arbitrage',
  'organigramme-ligne',
  'organigramme-groupe',
  'organigramme-fleche',
  'organigramme-note',
] as const;

export type OrganigrammeCalloutType = (typeof ORGANIGRAMME_TYPES)[number];
export type OrganigrammeText = {kind:'text'; text:string};
export type OrganigrammeCallout = {
  kind:'callout';
  type:OrganigrammeCalloutType;
  title:string;
  content:(OrganigrammeCallout | OrganigrammeText)[];
};
export type PlainContentBlock = {kind:'plain'; text:string};
export type DiagramContentBlock = {kind:'diagram'; root:OrganigrammeCallout; source:string};
export type StructuredContentBlock = PlainContentBlock | DiagramContentBlock;
export type OrganigrammeValidation = {
  valid:boolean;
  diagramCount:number;
  errors:{line:number; message:string}[];
};

// Limits apply to a single diagram; exceeding them leaves its original text visible.
export const ORGANIGRAMME_LIMITS = {depth:6, characters:65_536, lines:512} as const;

const types = new Set<string>(ORGANIGRAMME_TYPES);
type SourceLine = {text:string; raw:string; number:number};
type QuotedLine = {depth:number; body:string};
type Header = {type:string; title:string} | {error:string};

function sourceLines(source:string):SourceLine[] {
  const lines:SourceLine[] = [];
  let start = 0;
  while(start < source.length) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline + 1;
    const raw = source.slice(start, end);
    let text = newline === -1 ? raw : raw.slice(0, -1);
    if(text.endsWith('\r')) text = text.slice(0, -1);
    lines.push({text, raw, number:lines.length + 1});
    start = end;
  }
  return lines;
}

function quotedLine(line:string):QuotedLine | null {
  let cursor = 0;
  while(line[cursor] === ' ' || line[cursor] === '\t') cursor++;
  let depth = 0;
  while(line[cursor] === '>') {
    depth++;
    cursor++;
    if(line[cursor] === ' ' || line[cursor] === '\t') cursor++;
  }
  return depth ? {depth, body:line.slice(cursor)} : null;
}

function header(body:string):Header | null {
  const content = body.trimStart();
  if(!content.startsWith('[!')) return null;
  const end = content.indexOf(']');
  if(end === -1) return {error:'En-tête de bloc incomplet.'};
  const type = content.slice(2, end).toLowerCase();
  if(!type || type.includes(' ') || type.includes('\t')) return {error:'Type de bloc incorrect.'};
  return {type, title:content.slice(end + 1).trim()};
}

function startsDiagram(line:QuotedLine | null):boolean {
  if(!line || line.depth !== 1) return false;
  const start = line.body.trimStart();
  if(start.slice(0, 14).toLowerCase() !== '[!organigramme') return false;
  const value = header(start);
  if(!value || 'error' in value) return true;
  return value.type === 'organigramme' || !types.has(value.type);
}

function appendText(node:OrganigrammeCallout, text:string) {
  const previous = node.content[node.content.length - 1];
  if(previous?.kind === 'text') previous.text += `\n${text}`;
  else node.content.push({kind:'text', text});
}

function parseDiagram(lines:SourceLine[]):{root:OrganigrammeCallout} | {line:number; message:string} {
  const fail = (line:number, message:string) => ({line, message});
  const first = lines[0];
  if(lines.length > ORGANIGRAMME_LIMITS.lines) {
    return fail(first.number, `Organigramme limité à ${ORGANIGRAMME_LIMITS.lines} lignes.`);
  }
  if(lines.reduce((length, line) => length + line.raw.length, 0) > ORGANIGRAMME_LIMITS.characters) {
    return fail(first.number, `Organigramme limité à ${ORGANIGRAMME_LIMITS.characters} caractères.`);
  }
  const initial = header(quotedLine(first.text)!.body);
  if(!initial || 'error' in initial) return fail(first.number, initial?.error ?? 'En-tête de bloc incomplet.');
  if(initial.type !== 'organigramme') return fail(first.number, `Type de bloc non reconnu : ${initial.type}.`);
  const root:OrganigrammeCallout = {kind:'callout', type:'organigramme', title:initial.title, content:[]};
  const stack:OrganigrammeCallout[] = [root];
  for(const line of lines.slice(1)) {
    const quote = quotedLine(line.text)!;
    if(quote.depth > ORGANIGRAMME_LIMITS.depth) {
      return fail(line.number, `Organigramme limité à ${ORGANIGRAMME_LIMITS.depth} niveaux.`);
    }
    const value = header(quote.body);
    if(value) {
      if('error' in value) return fail(line.number, value.error);
      if(!types.has(value.type)) return fail(line.number, `Type de bloc non reconnu : ${value.type}.`);
      if(value.type === 'organigramme') return fail(line.number, 'Un organigramme ne peut pas être imbriqué dans un autre.');
      if(quote.depth < 2 || quote.depth > stack.length + 1) {
        return fail(line.number, 'Bloc imbriqué sans conteneur parent.');
      }
      stack.length = quote.depth - 1;
      const node:OrganigrammeCallout = {
        kind:'callout', type:value.type as OrganigrammeCalloutType, title:value.title, content:[],
      };
      stack[stack.length - 1].content.push(node);
      stack.push(node);
    } else {
      // A quoted text line can close a child, or contain a literal additional quote.
      // Keeping unclaimed quote markers avoids discarding non-callout nested text.
      if(quote.depth < stack.length) stack.length = quote.depth;
      appendText(stack[stack.length - 1], '> '.repeat(quote.depth - stack.length) + quote.body);
    }
  }
  return {root};
}

function fence(line:string):{character:string; length:number; ending:boolean} | null {
  const text = line.trimStart();
  const character = text[0];
  if(character !== '`' && character !== '~') return null;
  let length = 0;
  while(text[length] === character) length++;
  return length >= 3 ? {character, length, ending:!text.slice(length).trim()} : null;
}

function analyse(source:string):{blocks:StructuredContentBlock[]; validation:OrganigrammeValidation} {
  const lines = sourceLines(source);
  const blocks:StructuredContentBlock[] = [];
  const errors:OrganigrammeValidation['errors'] = [];
  let diagramCount = 0;
  let plain = '';
  let activeFence:{character:string; length:number} | null = null;
  const flushPlain = () => {
    if(plain) blocks.push({kind:'plain', text:plain});
    plain = '';
  };
  for(let index = 0; index < lines.length;) {
    const line = lines[index];
    const marker = fence(line.text);
    if(activeFence) {
      plain += line.raw;
      if(marker?.character === activeFence.character && marker.length >= activeFence.length && marker.ending) activeFence = null;
      index++;
      continue;
    }
    if(marker) {
      activeFence = marker;
      plain += line.raw;
      index++;
      continue;
    }
    if(!startsDiagram(quotedLine(line.text))) {
      plain += line.raw;
      index++;
      continue;
    }
    let end = index + 1;
    while(end < lines.length) {
      const next = quotedLine(lines[end].text);
      if(!next || startsDiagram(next)) break;
      end++;
    }
    const candidate = lines.slice(index, end);
    const original = candidate.map(value => value.raw).join('');
    const parsed = parseDiagram(candidate);
    if('root' in parsed) {
      flushPlain();
      blocks.push({kind:'diagram', root:parsed.root, source:original});
      diagramCount++;
    } else {
      errors.push(parsed);
      plain += original;
    }
    index = end;
  }
  flushPlain();
  return {blocks, validation:{valid:errors.length === 0, diagramCount, errors}};
}

/** Interpret only explicit organigramme roots. Everything else remains literal text. */
export function parseStructuredContent(text:string):StructuredContentBlock[] {
  return analyse(text).blocks;
}

/** Shared by local import tools; malformed diagrams are never accepted silently. */
export function validateOrganigrammes(text:string):OrganigrammeValidation {
  return analyse(text).validation;
}
