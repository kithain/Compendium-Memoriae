import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {extractOrganigrammes, DESCRIPTION_LIMIT} from '../scripts/export-organigramme.mjs';

const run = promisify(execFile);
const nodeFlags = process.execArgv.filter(argument => /^--preserve-symlinks(?:-main)?$/.test(argument));
const diagram = '> [!organigramme] Administration du Port\n> > [!autorite] Conseil du Port\n> > Détermine les règles.';

test('export includes only marked roots and excludes YAML, surrounding prose and code examples', () => {
  const note = `---\nprivate: secret-yaml\nexample: |\n  > [!organigramme] YAML secret\n---\n\nSecret avant.\n\n\`\`\`markdown\n${diagram.replace('Administration du Port', 'Exemple secret')}\n\`\`\`\n\n> \`\`\`markdown\n> [!organigramme] Exemple cité secret\n> \`\`\`\n\n${diagram}\n\nSecret après.\n\n> [!note] Note externe secrète\n> Texte externe.\n`;
  const exported = extractOrganigrammes(note);
  assert.equal(exported, `${diagram}\n`);
  assert.doesNotMatch(exported, /secret|Secret|private|Exemple|Texte externe/);
});

test('several roots are preserved in order and CRLF is normalized', () => {
  const second = diagram.replaceAll('Port', 'Marché');
  assert.equal(extractOrganigrammes(`${diagram}\r\n\r\nTexte hors blocs.\r\n\r\n${second}`), `${diagram}\n\n${second}\n`);
  assert.equal(extractOrganigrammes(`${diagram}\n${second}`), `${diagram}\n\n${second}\n`);
  const spaced = diagram.replaceAll('> [!', '>   [!');
  assert.equal(extractOrganigrammes(spaced), `${spaced}\n`);
});

test('validation CLI shares the reader rules and separates plain text without writing any file', async () => {
  const script = fileURLToPath(new URL('../scripts/export-organigramme.mjs', import.meta.url));
  const validate = source => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [...nodeFlags, script, '--validate'], (error, stdout, stderr) => {
      try { resolve({code: error?.code ?? 0, value: JSON.parse(stdout), stderr}); }
      catch (parseError) { reject(parseError); }
    });
    child.stdin.end(source);
  });
  const good = await validate(`Préface publique.\n\n${diagram}\n\nTexte final.`);
  assert.equal(good.code, 0);
  assert.equal(good.value.valid, true);
  assert.equal(good.value.diagramCount, 1);
  assert.match(good.value.plainText, /Préface publique/);
  assert.match(good.value.plainText, /Texte final/);
  assert.doesNotMatch(good.value.plainText, /Conseil du Port|\[!autorite\]/);
  assert.equal(good.stderr, '');
  const bad = await validate('> [!organigramme] Port\n> > [!inconnu] Conseil');
  assert.equal(bad.code, 1);
  assert.equal(bad.value.valid, false);
  assert.ok(bad.value.errors.length > 0);
  assert.equal(bad.stderr, '');
});

test('unknown children, malformed roots and nested roots reject the entire export', () => {
  for (const invalid of [
    '> [!organigramme] Port\n> > [!inconnu] Administration',
    '> [!organigramme Port\n> Corps',
    '> [!organigramme] Port\n> > [!organigramme] Autre racine',
  ]) assert.throws(() => extractOrganigrammes(invalid), /invalide/i, invalid);
  assert.throws(() => extractOrganigrammes('Note ordinaire sans bloc.'), /Aucun callout racine/);
  assert.throws(() => extractOrganigrammes('---\nsecret: oui\n' + diagram), /YAML non terminé/);
});

test('export enforces the exact description limit including the final newline', () => {
  const prefix = `${diagram}\n> > `;
  const atLimit = prefix + 'a'.repeat(DESCRIPTION_LIMIT - prefix.length - 1);
  assert.equal(extractOrganigrammes(atLimit).length, DESCRIPTION_LIMIT);
  assert.throws(() => extractOrganigrammes(atLimit + 'a'), /Export trop long/);
});

test('CLI writes a text export and leaves source and previous output untouched on validation failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'compendium-organigramme-'));
  try {
    const note = join(directory, 'note.md');
    const output = join(directory, 'export.txt');
    const script = fileURLToPath(new URL('../scripts/export-organigramme.mjs', import.meta.url));
    await writeFile(note, `${diagram}\n\nSecret après.`);
    await run(process.execPath, [...nodeFlags, script, '--note', note, '--output', output]);
    assert.equal(await readFile(output, 'utf8'), `${diagram}\n`);
    assert.match(await readFile(note, 'utf8'), /Secret après/);
    await writeFile(note, '> [!organigramme] Port\n> > [!inconnu] Conseil');
    await assert.rejects(run(process.execPath, [...nodeFlags, script, '--note', note, '--output', output]), /invalide/i);
    assert.equal(await readFile(output, 'utf8'), `${diagram}\n`);
    await assert.rejects(run(process.execPath, [...nodeFlags, script, '--note', note, '--output', note]), /différent/i);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
