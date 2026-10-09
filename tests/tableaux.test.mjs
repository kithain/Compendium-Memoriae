import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/tableaux.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
}).outputText;
const {parseMarkdownTables, MARKDOWN_TABLE_LIMITS} = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`,
);

const original = blocks => blocks.map(block => block.kind === 'table' ? block.source : block.text).join('');
const twoColumns = '| Autorité | Rôle |\n| --- | --- |\n| Conseil | Lois |';

test('Markdown tables retain headers, all rows, explicit alignments and their exact source', () => {
  const text = '| Gauche | Centre | Droite | Défaut |\n| :-- | :---: | --: | --- |\n| A | B | C | D |\n| E | F | G | H |';
  assert.deepEqual(parseMarkdownTables(text), [{kind:'table',
    headers:['Gauche', 'Centre', 'Droite', 'Défaut'],
    alignments:['left', 'center', 'right', null],
    rows:[['A', 'B', 'C', 'D'], ['E', 'F', 'G', 'H']], source:text,
  }]);
});

test('optional outer pipes, empty cells and single-column tables are supported', () => {
  const text = 'Nom | Fonction\n-- | --\n| | Arbitrage |\nValombre | |\n';
  const [table] = parseMarkdownTables(text);
  assert.equal(table.kind, 'table');
  assert.deepEqual(table.headers, ['Nom', 'Fonction']);
  assert.deepEqual(table.rows, [['', 'Arbitrage'], ['Valombre', '']]);
  // A trailing pipe is an optional border; an empty last cell needs a second pipe.
  const emptyLast = '| Nom | Fonction |\n| -- | -- |\n| Valombre | |';
  assert.deepEqual(parseMarkdownTables(emptyLast)[0].rows, [['Valombre', '']]);
  const single = '| Autorité |\n| -- |\n| Conseil |';
  assert.deepEqual(parseMarkdownTables(single)[0].rows, [['Conseil']]);
  assert.equal(parseMarkdownTables('| Nom |\n| -- |')[0].kind, 'table');
});

test('escaped pipes are cell text while other backslashes and HTML remain literal', () => {
  const text = String.raw`| Autorité\|territoire | Référence |
| -- | -- |
| Conseil\|Valombre | D:\notes\lois |
| <script>alert(1)</script> | **literal** |`;
  const [table] = parseMarkdownTables(text);
  assert.deepEqual(table.headers, ['Autorité|territoire', 'Référence']);
  assert.deepEqual(table.rows, [
    ['Conseil|Valombre', String.raw`D:\notes\lois`],
    ['<script>alert(1)</script>', '**literal**'],
  ]);
  const parity = String.raw`| A | B |
| -- | -- |
| double\\| right |
| triple\\\|pipe | right |`;
  const [withSlashes] = parseMarkdownTables(parity);
  assert.deepEqual(withSlashes.rows, [[String.raw`double\\`, 'right'], [String.raw`triple\\|pipe`, 'right']]);
  assert.equal(table.source, text);
});

test('paragraphs, several tables and CRLF line endings are preserved byte for byte', () => {
  const first = twoColumns.replaceAll('\n', '\r\n');
  const second = '| Nom |\n| -- |\n| Cour |\n';
  const text = `  Avant\r\n\r\n${first}\r\n\r\nMilieu\n\n${second}\nAprès  `;
  const blocks = parseMarkdownTables(text);
  assert.deepEqual(blocks.map(block => block.kind), ['plain', 'table', 'plain', 'table', 'plain']);
  assert.equal(blocks[0].text, '  Avant\r\n\r\n');
  assert.equal(blocks[1].source, `${first}\r\n`);
  assert.equal(blocks[2].text, '\r\nMilieu\n\n');
  assert.equal(original(blocks), text);
});

test('ordinary content and malformed tables remain intact', () => {
  for(const text of [
    '', 'Avant\r\n\r\nAprès\r\n', 'Titre\n---\nParagraphe', '\n| -- |\n',
    String.raw`A\|B` + '\n--\n',
    '| A | B |\n| -- | -- | -- |\n| C | D |',
    '| A | B |\n| - | -- |\n| C | D |',
    '| A | B |\n| -- | invalid |\n| C | D |',
    `${twoColumns}\n| Ligne incomplète |\n| Encore | Conservé |`,
    `${twoColumns}\n| Trop | de | cellules |`,
  ]) {
    assert.deepEqual(parseMarkdownTables(text), text ? [{kind:'plain', text}] : []);
  }
  const text = `${twoColumns}\n| Incorrect |\n\nUn autre tableau\n\n${twoColumns}`;
  const blocks = parseMarkdownTables(text);
  assert.deepEqual(blocks.map(block => block.kind), ['plain', 'table']);
  assert.equal(original(blocks), text);
});

test('tables inside fenced examples stay literal until the matching fence closes', () => {
  for(const delimiter of ['```', '~~~', '````']) {
    const text = `${delimiter}markdown\n${twoColumns}\n${delimiter}\n\n${twoColumns}`;
    const blocks = parseMarkdownTables(text);
    assert.deepEqual(blocks.map(block => block.kind), ['plain', 'table']);
    assert.equal(original(blocks), text);
  }
  for(const text of [
    `\`\`\`\`markdown\n${twoColumns}\n\`\`\`\n${twoColumns}`,
    `~~~markdown\n${twoColumns}\n\`\`\`\n${twoColumns}`,
    `\`\`\`markdown\n${twoColumns}\n\`\`\` still inside\n${twoColumns}`,
  ]) assert.deepEqual(parseMarkdownTables(text), [{kind:'plain', text}]);
});

test('column, row and character limits accept their boundary and preserve oversized tables', () => {
  const columnTable = count => `| ${Array(count).fill('Header').join(' | ')} |\n| ${Array(count).fill('--').join(' | ')} |\n| ${Array(count).fill('Cell').join(' | ')} |`;
  const rowTable = count => `| A | B |\n| -- | -- |\n${Array(count).fill('| C | D |').join('\n')}`;
  const prefix = '| A |\n| -- |\n| ';
  const suffix = ' |';
  const characterTable = size => prefix + 'x'.repeat(size - prefix.length - suffix.length) + suffix;
  for(const text of [columnTable(MARKDOWN_TABLE_LIMITS.columns), rowTable(MARKDOWN_TABLE_LIMITS.rows), characterTable(MARKDOWN_TABLE_LIMITS.characters)]) {
    assert.equal(parseMarkdownTables(text)[0].kind, 'table');
    assert.equal(original(parseMarkdownTables(text)), text);
  }
  for(const text of [columnTable(MARKDOWN_TABLE_LIMITS.columns + 1), rowTable(MARKDOWN_TABLE_LIMITS.rows + 1), characterTable(MARKDOWN_TABLE_LIMITS.characters + 1)]) {
    assert.deepEqual(parseMarkdownTables(text), [{kind:'plain', text}]);
  }
});
