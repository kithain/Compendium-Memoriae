#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// The browser and this local export use exactly the same validation rules.
const parserSource = await readFile(new URL('../src/lib/organigrammes.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(parserSource, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
}).outputText;
const {validateOrganigrammes, parseStructuredContent} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

export const DESCRIPTION_LIMIT = 6000;

function quotedLine(line) {
  let rest = line;
  let depth = 0;
  while (/^ {0,3}>/.test(rest)) {
    rest = rest.replace(/^ {0,3}>[\t ]?/, '');
    depth += 1;
  }
  return {depth, rest};
}

/** Extract only explicitly marked root callouts, never the surrounding note. */
export function extractOrganigrammes(note) {
  if (typeof note !== 'string') throw new TypeError('La note doit être du texte.');
  const lines = note.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)[\t ]*$/.test(line));
    if (end < 0) throw new Error('En-tête YAML non terminé : export refusé.');
    start = end + 1;
  }

  const blocks = [];
  let fence = null;
  for (let index = start; index < lines.length; index += 1) {
    const {depth, rest} = quotedLine(lines[index]);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(rest);
    if (fence) {
      if (marker && depth === fence.depth && marker[1][0] === fence.character &&
          marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) {
      fence = {depth, character: marker[1][0], length: marker[1].length};
      continue;
    }
    // Include malformed attempts so validation fails instead of silently dropping them.
    if (depth !== 1 || !/^\[!organigramme/i.test(rest.trimStart())) continue;

    const block = [lines[index]];
    while (index + 1 < lines.length && quotedLine(lines[index + 1]).depth > 0) {
      const next = quotedLine(lines[index + 1]);
      if (next.depth === 1 && /^\[!organigramme/i.test(next.rest.trimStart())) break;
      index += 1;
      block.push(lines[index]);
    }
    blocks.push(block.join('\n').trimEnd());
  }

  if (!blocks.length) throw new Error('Aucun callout racine [!organigramme] trouvé dans la note.');
  const output = `${blocks.join('\n\n')}\n`;
  const validation = validateOrganigrammes(output);
  if (!validation.valid || validation.diagramCount !== blocks.length) {
    const details = validation.errors.map(error => `ligne ${error.line} : ${error.message}`).join('; ');
    throw new Error(`Organigramme invalide : ${details || 'racine ou délimitation non reconnue'}.`);
  }
  if (output.length > DESCRIPTION_LIMIT) {
    throw new Error(`Export trop long (${output.length} caractères, limite ${DESCRIPTION_LIMIT}).`);
  }
  return output;
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--validate') return {validate: true};
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--help' || option === '-h') return {help: true};
    if (!['--note', '--output'].includes(option) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Argument incorrect : ${option}. Utilisez --note <note.md> --output <export.txt>.`);
    }
    if (result[option]) throw new Error(`Argument répété : ${option}.`);
    result[option] = args[++index];
  }
  if (!result['--note'] || !result['--output']) {
    throw new Error('Utilisez --note <note.md> --output <export.txt>.');
  }
  const notePath = resolve(result['--note']);
  const outputPath = resolve(result['--output']);
  if (notePath.toLowerCase() === outputPath.toLowerCase()) {
    throw new Error('Le fichier de sortie doit être différent de la note source.');
  }
  if (!/\.txt$/i.test(outputPath)) throw new Error('Le fichier de sortie doit avoir une extension .txt.');
  return {notePath, outputPath};
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write('Usage : node scripts/export-organigramme.mjs --note <note.md> --output <export.txt>\nValidation JSON : node scripts/export-organigramme.mjs --validate < description.txt\nExtrait et valide les callouts [!organigramme], sans réseau ni modification de la note.\n');
    return;
  }
  if (options.validate) {
    process.stdin.setEncoding('utf8');
    let source = '';
    for await (const chunk of process.stdin) source += chunk;
    const validation = validateOrganigrammes(source);
    const plainText = parseStructuredContent(source).filter(block => block.kind === 'plain').map(block => block.text).join('\n');
    process.stdout.write(`${JSON.stringify({...validation, plainText})}\n`);
    if (!validation.valid) process.exitCode = 1;
    return;
  }
  const output = extractOrganigrammes(await readFile(options.notePath, 'utf8'));
  await writeFile(options.outputPath, output, 'utf8');
  process.stdout.write(`Export enregistré : ${options.outputPath} (${output.length}/${DESCRIPTION_LIMIT} caractères).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
