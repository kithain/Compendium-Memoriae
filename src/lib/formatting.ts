export type InlineFormattingNode =
  | {kind:'text' | 'code'; text:string}
  | {kind:'strong' | 'emphasis' | 'strike'; children:InlineFormattingNode[]}
  | {kind:'link'; href:string; children:InlineFormattingNode[]};

export type FormattingBlock =
  | {kind:'text'; text:string; source:string; literal?:boolean}
  | {kind:'heading'; level:number; text:string; source:string}
  | {kind:'list'; ordered:boolean; start:number; items:string[]; source:string}
  | {kind:'quote'; text:string; source:string}
  | {kind:'code'; text:string; source:string};

const MAX_INLINE_DEPTH = 12;
const ESCAPABLE = /[\\`*{}[\]()#+\-.!_>~|]/;

/** Links are explicit and limited to protocols a reader can safely navigate. */
export function safeFormattingUrl(value:string):string | null {
  if(!value || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if(url.protocol === 'http:' || url.protocol === 'https:') return url.hostname ? value : null;
    if(url.protocol === 'mailto:' && url.pathname) return value;
  } catch {
    // A malformed or relative destination remains visible Markdown.
  }
  return null;
}

function escaped(text:string, index:number):boolean {
  let count = 0;
  while(index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
}

function codeEnd(text:string, start:number, marker:string):number {
  let end = text.indexOf(marker, start);
  while(end !== -1) {
    if(text[end - 1] !== '`' && text[end + marker.length] !== '`') return end;
    end = text.indexOf(marker, end + marker.length);
  }
  return -1;
}

function closingMark(text:string, start:number, marker:string, parent = '', depth = 0):number {
  if(depth >= MAX_INLINE_DEPTH) return -1;
  for(let index = start; index < text.length; index++) {
    if(escaped(text, index)) continue;
    if(text[index] === '`') {
      let length = 1;
      while(text[index + length] === '`') length++;
      const end = codeEnd(text, index + length, '`'.repeat(length));
      if(end !== -1) {index = end + length - 1; continue;}
    }
    if(text.startsWith(marker, index) && !/\s/.test(text[index - 1] ?? '')) {
      // In **bold *italic***, the first of the three stars closes the inner emphasis.
      if(marker !== '*' || text[index + 1] !== '*' || (parent === '**' && text.startsWith('***', index))) return index;
    }
    const nested = text.startsWith('***', index) ? '***'
      : text.startsWith('**', index) ? '**'
      : text.startsWith('~~', index) ? '~~'
      : text[index] === '*' ? '*' : null;
    if(nested && nested !== marker && text[index + nested.length] && !/\s/.test(text[index + nested.length])) {
      const end = closingMark(text, index + nested.length, nested, marker, depth + 1);
      if(end > index + nested.length) index = end + nested.length - 1;
    }
  }
  return -1;
}

function bracketEnd(text:string, start:number):number {
  let depth = 1;
  for(let index = start; index < text.length; index++) {
    if(escaped(text, index)) continue;
    if(text[index] === '[') depth++;
    if(text[index] === ']' && --depth === 0) return index;
  }
  return -1;
}

function destinationEnd(text:string, start:number):number {
  let depth = 1;
  for(let index = start; index < text.length; index++) {
    if(escaped(text, index)) continue;
    if(text[index] === '(') depth++;
    if(text[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

/** A deliberately small Markdown subset. Unsupported syntax remains visible text. */
export function parseInlineFormatting(text:string, depth = 0):InlineFormattingNode[] {
  if(depth >= MAX_INLINE_DEPTH) return text ? [{kind:'text', text}] : [];
  const nodes:InlineFormattingNode[] = [];
  let plain = '';
  const flush = () => {
    if(plain) nodes.push({kind:'text', text:plain});
    plain = '';
  };
  for(let index = 0; index < text.length;) {
    const character = text[index];
    if(character === '\\' && text[index + 1] && ESCAPABLE.test(text[index + 1])) {
      plain += text[index + 1];
      index += 2;
      continue;
    }
    if(character === '`') {
      let length = 1;
      while(text[index + length] === '`') length++;
      const end = codeEnd(text, index + length, '`'.repeat(length));
      if(end !== -1) {
        flush();
        nodes.push({kind:'code', text:text.slice(index + length, end)});
        index = end + length;
        continue;
      }
    }
    const image = character === '!' && text[index + 1] === '[';
    if(character === '[' || image) {
      const labelStart = index + (image ? 2 : 1);
      const labelEnd = bracketEnd(text, labelStart);
      if(labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const end = destinationEnd(text, labelEnd + 2);
        if(end !== -1) {
          const href = safeFormattingUrl(text.slice(labelEnd + 2, end).replace(/\\([()\\])/g, '$1'));
          if(href && !image && labelEnd > labelStart) {
            flush();
            nodes.push({kind:'link', href, children:parseInlineFormatting(text.slice(labelStart, labelEnd), depth + 1)});
          } else {
            // Images are attachment resources, never implicit external requests.
            plain += text.slice(index, end + 1);
          }
          index = end + 1;
          continue;
        }
      }
    }
    const marker = text.startsWith('***', index) ? '***'
      : text.startsWith('**', index) ? '**'
      : text.startsWith('~~', index) ? '~~'
      : character === '*' ? '*' : null;
    if(marker && text[index + marker.length] && !/\s/.test(text[index + marker.length])) {
      const end = closingMark(text, index + marker.length, marker);
      if(end > index + marker.length) {
        flush();
        const children = parseInlineFormatting(text.slice(index + marker.length, end), depth + 1);
        nodes.push(marker === '***' ? {kind:'strong', children:[{kind:'emphasis', children}]}
          : {kind:marker === '**' ? 'strong' : marker === '~~' ? 'strike' : 'emphasis', children});
        index = end + marker.length;
        continue;
      }
    }
    plain += character;
    index++;
  }
  flush();
  return nodes;
}

type Line = {text:string; raw:string};
function sourceLines(source:string):Line[] {
  const lines:Line[] = [];
  for(let start = 0; start < source.length;) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline + 1;
    const raw = source.slice(start, end);
    lines.push({text:raw.replace(/\r?\n$/, ''), raw});
    start = end;
  }
  return lines;
}

function listItem(line:string):{ordered:boolean; start:number; text:string} | null {
  const match = line.match(/^ {0,3}(-|\+|\*|\d{1,9}[.)])[\t ]+(.+)$/);
  if(!match) return null;
  const ordered = /^\d/.test(match[1]);
  return {ordered, start:ordered ? Number.parseInt(match[1], 10) : 1, text:match[2]};
}

function fence(line:string):{marker:string; length:number; rest:string} | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  return match ? {marker:match[1][0], length:match[1].length, rest:match[2]} : null;
}

function literalCallout(line:string):boolean {
  return /^\s*>\s*(?:>\s*)*\[!/.test(line);
}

/** Keep every source byte for editor round trips, including unsupported blocks. */
export function parseFormattingBlocks(text:string):FormattingBlock[] {
  const lines = sourceLines(text);
  const blocks:FormattingBlock[] = [];
  let plain = '';
  const flush = () => {
    if(plain) blocks.push({kind:'text', text:plain, source:plain});
    plain = '';
  };
  for(let index = 0; index < lines.length;) {
    const line = lines[index];
    const opening = fence(line.text);
    if(opening) {
      let end = index + 1;
      while(end < lines.length) {
        const closing = fence(lines[end].text);
        if(closing?.marker === opening.marker && closing.length >= opening.length && !closing.rest.trim()) break;
        end++;
      }
      if(end < lines.length) {
        flush();
        blocks.push({kind:'code', text:lines.slice(index + 1, end).map(value => value.raw).join(''),
          source:lines.slice(index, end + 1).map(value => value.raw).join('')});
        index = end + 1;
        continue;
      }
      // An unfinished example stays entirely literal instead of consuming later blocks.
      flush();
      const source = lines.slice(index).map(value => value.raw).join('');
      blocks.push({kind:'text', text:source, source, literal:true});
      break;
    }
    if(literalCallout(line.text)) {
      flush();
      let source = '';
      do {source += lines[index++].raw;} while(index < lines.length && /^\s*>/.test(lines[index].text));
      blocks.push({kind:'text', text:source, source, literal:true});
      continue;
    }
    // The table parser has already handled valid tables. Keep failed table source literal.
    const next = lines[index + 1]?.text ?? '';
    if(/^\s*\|/.test(line.text) || (line.text.includes('|') && /^[\t |:-]+$/.test(next) && next.includes('|'))) {
      flush();
      let source = '';
      do {source += lines[index++].raw;} while(index < lines.length && lines[index].text.includes('|') && !fence(lines[index].text));
      blocks.push({kind:'text', text:source, source, literal:true});
      continue;
    }
    const heading = line.text.match(/^ {0,3}(#{1,6})[\t ]+(.+)$/);
    if(heading) {
      flush();
      blocks.push({kind:'heading', level:heading[1].length, text:heading[2], source:line.raw});
      index++;
      continue;
    }
    const item = listItem(line.text);
    if(item) {
      flush();
      const start = index;
      const items:string[] = [];
      while(index < lines.length) {
        const next = listItem(lines[index].text);
        if(!next || next.ordered !== item.ordered) break;
        items.push(next.text);
        index++;
        // Continuation lines retain their content and line break within the item.
        while(index < lines.length && /^(?: {4}|\t)\S/.test(lines[index].text) && !listItem(lines[index].text)) {
          items[items.length - 1] += '\n' + lines[index].text.replace(/^(?: {4}|\t)/, '');
          index++;
        }
      }
      blocks.push({kind:'list', ordered:item.ordered, start:item.start, items,
        source:lines.slice(start, index).map(value => value.raw).join('')});
      continue;
    }
    if(/^ {0,3}>[\t ]?/.test(line.text)) {
      const start = index;
      const quote:string[] = [];
      while(index < lines.length && /^ {0,3}>[\t ]?/.test(lines[index].text) && !literalCallout(lines[index].text)) {
        quote.push(lines[index].raw.replace(/^ {0,3}>[\t ]?/, ''));
        index++;
      }
      flush();
      blocks.push({kind:'quote', text:quote.join(''), source:lines.slice(start, index).map(value => value.raw).join('')});
      continue;
    }
    plain += line.raw;
    index++;
  }
  flush();
  return blocks;
}
