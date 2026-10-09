export type MarkdownTableAlignment = 'left' | 'center' | 'right' | null;
export type MarkdownTableBlock = {
  kind:'table';
  headers:string[];
  rows:string[][];
  alignments:MarkdownTableAlignment[];
  source:string;
};
export type MarkdownTableContentBlock = {kind:'plain'; text:string} | MarkdownTableBlock;

// Oversized or malformed tables remain visible in their complete original form.
export const MARKDOWN_TABLE_LIMITS = {columns:20, rows:200, characters:65_536} as const;

type SourceLine = {text:string; raw:string};
type ParsedRow = {cells:string[]; pipes:number};
type Fence = {character:string; length:number; ending:boolean};

function sourceLines(source:string):SourceLine[] {
  const lines:SourceLine[] = [];
  let start = 0;
  while(start < source.length) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline + 1;
    const raw = source.slice(start, end);
    let text = newline === -1 ? raw : raw.slice(0, -1);
    if(text.endsWith('\r')) text = text.slice(0, -1);
    lines.push({text, raw});
    start = end;
  }
  return lines;
}

function splitRow(line:string):ParsedRow {
  const text = line.trim();
  const cells:string[] = [];
  let cell = '';
  let pipes = 0;
  let firstPipe = -1;
  let lastPipe = -1;
  for(let index = 0; index < text.length; index++) {
    if(text[index] === '\\') {
      let end = index;
      while(text[end] === '\\') end++;
      const count = end - index;
      if(text[end] === '|' && count % 2 === 1) {
        // Only the slash escaping a pipe is consumed. Other slashes stay literal.
        cell += '\\'.repeat(count - 1) + '|';
        index = end;
      } else {
        cell += '\\'.repeat(count);
        index = end - 1;
      }
    } else if(text[index] === '|') {
      cells.push(cell.trim());
      cell = '';
      pipes++;
      if(firstPipe === -1) firstPipe = index;
      lastPipe = index;
    } else {
      cell += text[index];
    }
  }
  cells.push(cell.trim());
  if(firstPipe === 0) cells.shift();
  if(lastPipe === text.length - 1 && lastPipe !== -1) cells.pop();
  return {cells, pipes};
}

function fence(line:string):Fence | null {
  const text = line.trimStart();
  const character = text[0];
  if(character !== '`' && character !== '~') return null;
  let length = 0;
  while(text[length] === character) length++;
  return length >= 3 ? {character, length, ending:!text.slice(length).trim()} : null;
}

function alignment(cell:string):MarkdownTableAlignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : left ? 'left' : right ? 'right' : null;
}

/** Parse pipe tables without interpreting HTML or changing the surrounding text. */
export function parseMarkdownTables(text:string):MarkdownTableContentBlock[] {
  const lines = sourceLines(text);
  const blocks:MarkdownTableContentBlock[] = [];
  let plain = '';
  let activeFence:Pick<Fence, 'character' | 'length'> | null = null;
  const flushPlain = () => {
    if(plain) blocks.push({kind:'plain', text:plain});
    plain = '';
  };

  for(let index = 0; index < lines.length;) {
    const line = lines[index];
    const marker = fence(line.text);
    if(activeFence) {
      plain += line.raw;
      if(marker?.character === activeFence.character && marker.length >= activeFence.length && marker.ending) {
        activeFence = null;
      }
      index++;
      continue;
    }
    if(marker) {
      activeFence = marker;
      plain += line.raw;
      index++;
      continue;
    }
    const next = lines[index + 1];
    if(!line.text.trim() || !next || fence(next.text)) {
      plain += line.raw;
      index++;
      continue;
    }
    const header = splitRow(line.text);
    const delimiter = splitRow(next.text);
    if(!header.cells.length || (!header.pipes && !delimiter.pipes)
      || header.cells.length !== delimiter.cells.length
      || !delimiter.cells.every(cell => /^:?-{2,}:?$/.test(cell))) {
      plain += line.raw;
      index++;
      continue;
    }

    const rows:string[][] = [];
    let end = index + 2;
    let characters = line.raw.length + next.raw.length;
    let valid = header.cells.length <= MARKDOWN_TABLE_LIMITS.columns
      && characters <= MARKDOWN_TABLE_LIMITS.characters;
    let rowCount = 0;
    while(end < lines.length && !fence(lines[end].text)) {
      const row = splitRow(lines[end].text);
      if(!row.pipes) break;
      rowCount++;
      characters += lines[end].raw.length;
      if(row.cells.length !== header.cells.length || rowCount > MARKDOWN_TABLE_LIMITS.rows
        || characters > MARKDOWN_TABLE_LIMITS.characters) valid = false;
      // Keep scanning the source after a failure so no part of the bad table disappears.
      if(valid) rows.push(row.cells);
      end++;
    }
    const source = lines.slice(index, end).map(value => value.raw).join('');
    if(valid) {
      flushPlain();
      blocks.push({kind:'table', headers:header.cells, rows,
        alignments:delimiter.cells.map(alignment), source});
    } else {
      plain += source;
    }
    index = end;
  }
  flushPlain();
  return blocks;
}
