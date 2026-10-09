import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const source = await readFile(new URL('../src/lib/organigrammes.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
}).outputText;
const parser = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
const {parseStructuredContent, validateOrganigrammes, ORGANIGRAMME_LIMITS} = parser;

const tableSource = await readFile(new URL('../src/lib/tableaux.ts', import.meta.url), 'utf8');
const tableJS = ts.transpileModule(tableSource, {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
}).outputText;
const tables = await import(`data:text/javascript;base64,${Buffer.from(tableJS).toString('base64')}`);

const formattingSource = await readFile(new URL('../src/lib/formatting.ts', import.meta.url), 'utf8');
const formattingJS = ts.transpileModule(formattingSource, {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
}).outputText;
const formatting = await import(`data:text/javascript;base64,${Buffer.from(formattingJS).toString('base64')}`);

const componentSource = await readFile(new URL('../src/components/StructuredContent.tsx', import.meta.url), 'utf8');
const componentJS = ts.transpileModule(componentSource, {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX},
}).outputText;
const nodeRequire = createRequire(import.meta.url);
const module = {exports:{}};
new Function('require', 'module', 'exports', componentJS)(
  name => name === '../lib/organigrammes' ? parser : name === '../lib/tableaux' ? tables : name === '../lib/formatting' ? formatting : nodeRequire(name), module, module.exports,
);
const StructuredContent = module.exports.default;

const diagram = [
  '> [!organigramme] Synthetic hierarchy',
  '> > [!autorite] Council',
  '> > First description',
  '> > Second description',
  '>',
  '> > [!organigramme-fleche] ↓',
  '> > Delegation',
  '>',
  '> > [!organigramme-ligne]',
  '> > > [!autorite-principale] Officer',
  '> > > Executes decisions',
  '> >',
  '> > > [!autorite] Municipal court',
  '> > > Hears claims',
  '>',
  '> > [!organigramme-groupe]',
  '> > > [!autorite] First court',
  '> > > > Literal quoted body',
  '> >',
  '> > > [!organigramme-fleche] ↕',
  '> > > Limited appeal',
  '> >',
  '> > > [!autorite] Appeal court',
  '>',
  '> > [!autorite-arbitrage] Arbitration court',
  '> > Resolves jurisdiction conflicts',
  '>',
  '> > [!organigramme-note]',
  '> > A different competence',
].join('\n');

test('callouts retain nested hierarchy, multiline bodies, arrows and literal nested quotes', () => {
  const [block] = parseStructuredContent(diagram);
  assert.equal(block.kind, 'diagram');
  assert.equal(block.source, diagram);
  assert.equal(block.root.title, 'Synthetic hierarchy');
  const children = block.root.content.filter(part => part.kind === 'callout');
  assert.deepEqual(children.map(part => part.type), [
    'autorite', 'organigramme-fleche', 'organigramme-ligne', 'organigramme-groupe', 'autorite-arbitrage', 'organigramme-note',
  ]);
  assert.equal(children[0].content[0].text, 'First description\nSecond description');
  assert.equal(children[1].title, '↓');
  assert.equal(children[1].content[0].text, 'Delegation');
  assert.equal(children[2].content[0].type, 'autorite-principale');
  assert.equal(children[2].content[2].title, 'Municipal court');
  assert.equal(children[3].content[0].content[0].text, '> Literal quoted body');
  assert.deepEqual(validateOrganigrammes(diagram), {valid:true, diagramCount:1, errors:[]});
});

test('ordinary descriptions and callouts outside an explicit root remain unchanged', () => {
  for(const text of ['', 'First paragraph\r\n\r\nSecond paragraph\r\n', '> [!autorite] Ordinary quotation\n> body', '# Heading\n**literal**\n<img src=x>']) {
    const result = parseStructuredContent(text);
    assert.deepEqual(result, text ? [{kind:'plain', text}] : []);
    assert.deepEqual(validateOrganigrammes(text), {valid:true, diagramCount:0, errors:[]});
  }
});

test('several diagrams retain all surrounding text and CRLF line endings', () => {
  const one = '> [!organigramme] One\r\n> Body\r\n';
  const two = '> [!organigramme] Two\n> > [!autorite] Child';
  const text = `Before\r\n\r\n${one}\r\nBetween\n${two}\nAfter`;
  const blocks = parseStructuredContent(text);
  assert.deepEqual(blocks.map(block => block.kind), ['plain', 'diagram', 'plain', 'diagram', 'plain']);
  assert.equal(blocks.map(block => block.kind === 'plain' ? block.text : block.source).join(''), text);
  assert.equal(validateOrganigrammes(text).diagramCount, 2);
});

test('diagram-like examples inside fenced code stay literal', () => {
  for(const delimiter of ['```', '~~~']) {
    const text = `${delimiter}markdown\n${diagram}\n${delimiter}\n`;
    assert.deepEqual(parseStructuredContent(text), [{kind:'plain', text}]);
    assert.equal(validateOrganigrammes(text).diagramCount, 0);
  }
});

test('unknown and malformed blocks fall back to the complete original diagram', () => {
  for(const text of [
    '> [!organigramme] Root\n> > [!unknown] Unknown\n> > Retained body',
    '> [!organigramme Root\n> Retained body',
    '> [!organigramme-inconnu] Root\n> Retained body',
    '> [!organigramme] Root\n> > [!autorite Missing bracket\n> > Retained body',
    '> [!organigramme] Root\n> > > [!autorite] Missing parent',
    '> [!organigramme] Root\n> [!autorite] Missing nesting',
    '> [!organigramme] Root\n> > [!organigramme] Nested root',
  ]) {
    assert.deepEqual(parseStructuredContent(text), [{kind:'plain', text}]);
    const validation = validateOrganigrammes(text);
    assert.equal(validation.valid, false, text);
    assert.equal(validation.diagramCount, 0);
    assert.equal(validation.errors.length, 1);
    assert.ok(validation.errors[0].line >= 1);
  }
  const mixed = `Before\n> [!organigramme] Invalid\n> > [!unknown]\n\n${diagram}\nAfter`;
  assert.equal(validateOrganigrammes(mixed).diagramCount, 1);
  assert.equal(validateOrganigrammes(mixed).valid, false);
  assert.equal(parseStructuredContent(mixed).map(block => block.kind === 'plain' ? block.text : block.source).join(''), mixed);
});

test('depth, size and line limits fail closed without throwing or dropping text', () => {
  const tooDeep = ['> [!organigramme] Root'];
  for(let depth = 2; depth <= ORGANIGRAMME_LIMITS.depth + 1; depth++) {
    tooDeep.push(`${'> '.repeat(depth)}[!organigramme-groupe] Level ${depth}`);
  }
  const cases = [
    tooDeep.join('\n'),
    `> [!organigramme] Root\n> ${'x'.repeat(ORGANIGRAMME_LIMITS.characters)}`,
    `> [!organigramme] Root\n${'> Body\n'.repeat(ORGANIGRAMME_LIMITS.lines)}`,
    `> [!organigramme] Root\n${'> '.repeat(ORGANIGRAMME_LIMITS.depth + 1)}Body`,
  ];
  for(const text of cases) {
    assert.deepEqual(parseStructuredContent(text), [{kind:'plain', text}]);
    assert.equal(validateOrganigrammes(text).valid, false);
  }
  assert.equal(validateOrganigrammes(tooDeep.slice(0, -1).join('\n')).valid, true);
});

test('React renders the shared callout classes and treats HTML or scripts only as text', () => {
  const text = 'Before <script>alert(1)</script>\n\n> [!organigramme] <img src=x onerror=alert(1)>\n> > [!autorite] <script>alert(2)</script>\n> > <a href="javascript:alert(3)">Text</a>\n\nAfter';
  const html = renderToStaticMarkup(React.createElement(StructuredContent, {text}));
  assert.match(html, /class="structured-content"/);
  assert.match(html, /class="structured-content-plain"/);
  assert.match(html, /class="callout" data-callout="organigramme"/);
  assert.match(html, /class="callout-title-inner"/);
  assert.match(html, /class="callout-content"/);
  assert.match(html, /class="organigramme-texte"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;a href=&quot;javascript:alert\(3\)&quot;&gt;Text&lt;\/a&gt;/);
  assert.doesNotMatch(html, /<(?:script|img|a)(?:\s|>)/);
});

test('quoted empty separators do not render text nodes while meaningful multiline bodies stay intact', () => {
  const text = [
    '> [!organigramme] Root',
    '>',
    '>   ',
    '> > [!autorite] First',
    '> > First description',
    '> > Second description',
    '>',
    '> > [!organigramme-ligne]',
    '> > > [!autorite] Left',
    '> >',
    '> >    ',
    '> > > [!autorite] Right',
    '>',
  ].join('\n');
  const html = renderToStaticMarkup(React.createElement(StructuredContent, {text}));
  assert.equal((html.match(/class="organigramme-texte"/g) ?? []).length, 1);
  assert.match(html, /<div class="organigramme-texte">First description\nSecond description<\/div>/);
  assert.doesNotMatch(html, /<div class="organigramme-texte">\s*<\/div>/);
  // Rendering omits spacing-only nodes without changing the lossless parser/source.
  const [block] = parseStructuredContent(text);
  assert.equal(block.source, text);
  assert.ok(block.root.content.some(part => part.kind === 'text' && !part.text.trim()));
});

test('React shows a table, an organigramme and surrounding prose in source order', () => {
  const text = [
    'Before the register',
    '',
    '| Department | Cases |',
    '| :--- | ---: |',
    '| Council\\|Harbour | 12 |',
    '| Archive | 8 |',
    '',
    'Between the register and diagram',
    '',
    '> [!organigramme] Administration',
    '> > [!autorite] Officer',
    '> > Executes decisions',
    '',
    'After the diagram',
  ].join('\n');
  const html = renderToStaticMarkup(React.createElement(StructuredContent, {text}));
  const displayed = [
    'Before the register', '<table', 'Department', 'Council|Harbour', 'Archive',
    'Between the register and diagram', 'Administration', 'Officer', 'Executes decisions', 'After the diagram',
  ].map(value => html.indexOf(value));
  assert.ok(displayed.every(position => position >= 0), html);
  assert.ok(displayed.every((position, index) => index === 0 || position > displayed[index - 1]));
  assert.equal((html.match(/<table(?:\s|>)/g) ?? []).length, 1);
  assert.equal((html.match(/<th(?:\s|>)/g) ?? []).length, 2);
  assert.equal((html.match(/<td(?:\s|>)/g) ?? []).length, 4);
  assert.match(html, /<th[^>]*scope="col"[^>]*data-align="left">Department<\/th>/);
  assert.match(html, /<td[^>]*data-align="right">12<\/td>/);
  assert.match(html, /class="structured-table-scroll"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Tableau"/);
  assert.doesNotMatch(html, /\[!organigramme\]|\[!autorite\]|\| :--- \| ---: \|/);
});

test('React renders table headers and cells as escaped text with no executable HTML', () => {
  const text = [
    '| <img src=x onerror=alert(1)> | Description |',
    '| --- | --- |',
    '| <script>alert(2)</script> | <a href="javascript:alert(3)">Example</a> |',
    '| Safe entry | **literal Markdown** |',
  ].join('\n');
  const html = renderToStaticMarkup(React.createElement(StructuredContent, {text}));
  assert.match(html, /<th[^>]*>&lt;img src=x onerror=alert\(1\)&gt;<\/th>/);
  assert.match(html, /<td[^>]*>&lt;script&gt;alert\(2\)&lt;\/script&gt;<\/td>/);
  assert.match(html, /<td[^>]*>&lt;a href=&quot;javascript:alert\(3\)&quot;&gt;Example&lt;\/a&gt;<\/td>/);
  assert.match(html, /<td[^>]*><strong>literal Markdown<\/strong><\/td>/);
  assert.doesNotMatch(html, /<(?:script|img|a)(?:\s|>)/);
});

test('a malformed table remains completely visible while a neighbouring diagram still renders', () => {
  const malformed = [
    '| Department | Cases |',
    '| --- | --- |',
    '| Council | 12 |',
    '| Too | many | cells |',
    '| Archive | 8 |',
  ].join('\n');
  const text = `Before\n\n${malformed}\n\n> [!organigramme] Administration\n> > [!autorite] Officer\n> > Retained body\n\nAfter`;
  const html = renderToStaticMarkup(React.createElement(StructuredContent, {text}));
  assert.doesNotMatch(html, /<table(?:\s|>)/);
  assert.ok(html.includes(malformed), 'Every row and table marker stays in the visible fallback text.');
  assert.match(html, /data-callout="organigramme"/);
  assert.match(html, /Retained body/);
  assert.ok(html.indexOf('Before') < html.indexOf(malformed));
  assert.ok(html.indexOf(malformed) < html.indexOf('Administration'));
  assert.ok(html.indexOf('Retained body') < html.indexOf('After'));
});
