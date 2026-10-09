import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

async function loadParser(filename) {
  const source = await readFile(new URL(`../src/lib/${filename}.ts`, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}
const [formatting, diagrams, tables] = await Promise.all(['formatting', 'organigrammes', 'tableaux'].map(loadParser));
const {parseInlineFormatting, parseFormattingBlocks, safeFormattingUrl} = formatting;
const componentSource = await readFile(new URL('../src/components/StructuredContent.tsx', import.meta.url), 'utf8');
const componentJS = ts.transpileModule(componentSource, {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX},
}).outputText;
const nodeRequire = createRequire(import.meta.url);
const module = {exports:{}};
new Function('require', 'module', 'exports', componentJS)(name => ({
  '../lib/formatting':formatting, '../lib/organigrammes':diagrams, '../lib/tableaux':tables,
})[name] ?? nodeRequire(name), module, module.exports);
const StructuredContent = module.exports.default;
const render = text => renderToStaticMarkup(React.createElement(StructuredContent, {text}));

test('inline formatting handles nested marks, escaping and literal code', () => {
  const html = render('Before **bold and *italic* end**; ***both***; ~~old~~; `**literal**`; \\*plain\\*; after.');
  assert.match(html, /<strong>bold and <em>italic<\/em> end<\/strong>/);
  assert.match(html, /<strong><em>both<\/em><\/strong>/);
  assert.match(html, /<s>old<\/s>/);
  assert.match(html, /<code>\*\*literal\*\*<\/code>/);
  assert.match(html, /; \*plain\*; after\./);
  assert.match(render('**bold *italic***'), /<strong>bold <em>italic<\/em><\/strong>/);
  assert.match(render('*italic **bold***'), /<em>italic <strong>bold<\/strong><\/em>/);
  assert.deepEqual(parseInlineFormatting('An unmatched **mark and `tick.'), [{kind:'text', text:'An unmatched **mark and `tick.'}]);
});

test('only explicit http, https and mailto Markdown links can navigate', () => {
  for(const value of ['https://example.com/page?q=1', 'http://example.com', 'mailto:reader@example.com']) {
    assert.equal(safeFormattingUrl(value), value);
  }
  for(const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>x</script>', 'file:///secret', '//example.com', '/relative', 'https://ex ample.com', 'https:\n//example.com', 'mailto:', '']) {
    assert.equal(safeFormattingUrl(value), null, value);
  }
  const html = render('[**Visit**](https://example.com/a\(b\)) [Mail](mailto:reader@example.com) [Unsafe](javascript:alert(1))');
  assert.match(html, /href="https:\/\/example.com\/a\(b\)"[^>]*><strong>Visit<\/strong><\/a>/);
  assert.match(html, /href="mailto:reader@example.com"/);
  assert.ok(html.includes('[Unsafe](javascript:alert(1))'));
  assert.equal((html.match(/<a(?:\s|>)/g) ?? []).length, 2);
});

test('HTML, image Markdown and code examples never execute or load remote content', () => {
  const html = render('<script>alert(1)</script> <img src="https://example.com/pixel" onerror="x">\n![Image](https://example.com/pixel)\n\n```html\n<script>alert(2)</script>\n**literal**\n```');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=&quot;https:\/\/example.com\/pixel&quot; onerror=&quot;x&quot;&gt;/);
  assert.ok(html.includes('![Image](https://example.com/pixel)'));
  assert.match(html, /<pre class="structured-code"><code>&lt;script&gt;alert\(2\)&lt;\/script&gt;\n\*\*literal\*\*\n<\/code><\/pre>/);
  assert.doesNotMatch(html, /<(?:script|img|iframe)(?:\s|>)/);
  assert.doesNotMatch(html, /href="https:\/\/example.com\/pixel"/);
});

test('headings, both list types and quotations retain source for editor round trips', () => {
  const text = 'Before\r\n\r\n## A **heading**\r\n- One\r\n- Two\r\n\r\n3. Third\r\n4. Fourth\r\n\r\n> A quote\r\n> on two lines\r\n\r\nAfter\r\n';
  const blocks = parseFormattingBlocks(text);
  assert.equal(blocks.map(block => block.source).join(''), text);
  assert.deepEqual(blocks.filter(block => block.kind !== 'text').map(block => block.kind), ['heading', 'list', 'list', 'quote']);
  const html = render(text);
  assert.match(html, /<h2 class="structured-heading">A <strong>heading<\/strong><\/h2>/);
  assert.match(html, /<ul class="structured-list"><li>One<\/li><li>Two<\/li><\/ul>/);
  assert.match(html, /<ol class="structured-list" start="3"><li>Third<\/li><li>Fourth<\/li><\/ol>/);
  assert.match(html, /<blockquote class="structured-quote"><div class="structured-content-plain">A quote\r\non two lines\r\n<\/div><\/blockquote>/);
  assert.ok(html.indexOf('Before') < html.indexOf('<h2'));
  assert.ok(html.indexOf('</blockquote>') < html.indexOf('After'));
});

test('plain paragraphs, unfinished fences and unsupported callouts retain all source', () => {
  for(const text of ['Line one\n\nLine two\n', '```markdown\n# literal heading\n- literal item', '> [!unknown] Unhandled\n> > Nested\n> All source\n']) {
    const blocks = parseFormattingBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'text');
    assert.equal(blocks[0].text, text);
    assert.equal(blocks[0].source, text);
  }
  const text = '> [!organigramme] **Invalid**\n> > [!unknown] Child\n> > Body';
  assert.ok(render(text).includes(text.replace(/>/g, '&gt;')));
  assert.doesNotMatch(render(text), /<strong>/);
});

test('formatting, tables and diagrams coexist without changing order or malformed fallback', () => {
  const text = '# Register\n\n| **Name** | Link |\n| --- | --- |\n| *Council* | [Details](https://example.com) |\n\n> [!organigramme] **Administration**\n> > [!autorite] Officer\n> > Has *authority*\n\nAfter';
  const html = render(text);
  assert.match(html, /<th[^>]*><strong>Name<\/strong><\/th>/);
  assert.match(html, /<td[^>]*><em>Council<\/em><\/td>/);
  assert.match(html, /class="callout-title-inner"><strong>Administration<\/strong>/);
  assert.match(html, /Has <em>authority<\/em>/);
  assert.ok(html.indexOf('<h1') < html.indexOf('<table'));
  assert.ok(html.indexOf('<table') < html.indexOf('data-callout="organigramme"'));
  assert.ok(html.indexOf('Has <em>authority') < html.indexOf('After'));
  const malformed = '| **Name** | Count |\n| --- | --- |\n| Too | many | cells |';
  const fallback = render(malformed);
  assert.doesNotMatch(fallback, /<table(?:\s|>)/);
  assert.ok(fallback.includes(malformed));
});
