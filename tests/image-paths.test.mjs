import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/lib/image-paths.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {PUBLIC_IMAGE_CATEGORIES,publicImagePath,legacyImagePath,publicImageUrl,loadPublicImage}=await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const campaign='10000000-0000-0000-0000-000000000001';
const path='images/pnj/borin.jpg';
const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,0,0,0xff,0xd9]);

test('Public illustration paths match all seven folders and the SQL ASCII/JPG contract',()=>{
  for(const category of PUBLIC_IMAGE_CATEGORIES)assert.equal(publicImagePath(`images/${category}/nom-2_v1.jpg`),`images/${category}/nom-2_v1.jpg`);
  assert.equal(publicImagePath(` ${path} `),path);
  const longest=`images/pnj/${'a'.repeat(497)}.jpg`;
  assert.equal(longest.length,512);
  assert.equal(publicImagePath(longest),longest);
  assert.equal(publicImagePath(`images/pnj/${'a'.repeat(498)}.jpg`),null);
  for(const invalid of [
    'https://example.com/borin.jpg','//example.com/borin.jpg','/images/pnj/borin.jpg',
    'public/images/pnj/borin.jpg','images/autre/borin.jpg','images/pnj/../borin.jpg',
    'images/pnj/nom/borin.jpg','images/pnj/.borin.jpg','images/pnj/borin.JPG',
    'images/pnj/borin.png','images/pnj/borin.jpg?secret=1','images/pnj/borin.jpg#image',
    'images/pnj/borin%2fautre.jpg','images/pnj/borin%20nom.jpg','images/pnj/borin nom.jpg',
    'images/pnj/borín.jpg','images\\pnj\\borin.jpg','images/pnj/borin\0.jpg',
  ])assert.equal(publicImagePath(invalid),null,invalid);
});

test('Public URLs retain the GitHub Pages base, while legacy keys stay campaign scoped',()=>{
  assert.equal(publicImageUrl(path,'/Compendium-Memoriae/'),'/Compendium-Memoriae/images/pnj/borin.jpg');
  assert.equal(publicImageUrl(path,'/'),'/images/pnj/borin.jpg');
  assert.throws(()=>publicImageUrl(path,'https://example.com/'));
  const old=`${campaign}_20000000-0000-0000-0000-000000000001.jpg`;
  assert.equal(legacyImagePath(old,campaign),old);
  assert.equal(legacyImagePath(`${campaign}/portraits/borin.jpg`,campaign),`${campaign}/portraits/borin.jpg`);
  for(const invalid of [`${campaign}/../borin.jpg`,`${campaign}/borin%2fsecret.jpg`,`${campaign}_borin.jpg?x`,old.replace(campaign,'30000000-0000-0000-0000-000000000001'),'https://example.com/borin.jpg']){
    assert.equal(legacyImagePath(invalid,campaign),null);
  }
});

test('Public download omits credentials, checks the response, and never fetches unsafe paths',async()=>{
  let request;
  const blob=await loadPublicImage(path,'/Compendium-Memoriae/',async(url,options)=>{
    request={url,options};return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
  });
  assert.equal(request.url,'/Compendium-Memoriae/images/pnj/borin.jpg');
  assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.redirect,'error');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),jpeg);
  let fetched=false;
  await assert.rejects(()=>loadPublicImage('images/pnj/../../secret.jpg','/',async()=>{fetched=true;return new Response(jpeg);}),/chemin/);
  assert.equal(fetched,false);
  await assert.rejects(()=>loadPublicImage(path,'/',async()=>new Response('<html>Page</html>',{headers:{'content-type':'text/html'}})),/JPG/);
  await assert.rejects(()=>loadPublicImage(path,'/',async()=>new Response('<html>Page</html>',{headers:{'content-type':'image/jpeg'}})),/JPG/);
  await assert.rejects(()=>loadPublicImage(path,'/',async()=>new Response('Missing',{status:404})),/Publiez/);
});
