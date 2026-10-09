import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/attachments.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {validateAttachmentFile,MAX_ATTACHMENT_SIZE}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('file validation accepts only supported extensions with matching content and canonical MIME',async()=>{
  for(const [name,content,mimeType] of [
    ['carte.PNG',new Uint8Array([137,80,78,71,13,10,26,10,0]),'image/png'],
    ['carte.jpeg',new Uint8Array([255,216,255,0]),'image/jpeg'],
    ['carte.gif','GIF89a data','image/gif'],['carte.webp','RIFFdataWEBPbody','image/webp'],
    ['carte.bmp','BMexample','image/bmp'],['carte.avif','0000ftypavifdata','image/avif'],
    ['notes.pdf','%PDF-1.7\nexample','application/pdf'],['notes.md','# Équipement','text/markdown'],['notes.txt','Texte\nLibre','text/plain'],
  ])assert.deepEqual(await validateAttachmentFile(new File([content],name,{type:'application/octet-stream'})),{name,size:new Blob([content]).size,mimeType});
});
test('2 Mo limit is exact and empty or oversized uploads are rejected before reading',async()=>{
  const boundary=new File(['x'.repeat(MAX_ATTACHMENT_SIZE)],'notes.txt');
  assert.equal((await validateAttachmentFile(boundary)).size,MAX_ATTACHMENT_SIZE);
  await assert.rejects(validateAttachmentFile(new File(['x'.repeat(MAX_ATTACHMENT_SIZE+1)],'notes.txt')),/dépasse 2 Mo/);
  await assert.rejects(validateAttachmentFile(new File([],'notes.txt')),/vide/);
});
test('renamed binary data, SVG, executable/HTML types and unsafe names are rejected',async()=>{
  for(const file of [new File(['<svg/>'],'image.svg'),new File(['<html/>'],'page.html'),new File(['app'],'app.exe'),new File(['not png'],'image.png'),new File(['no pdf'],'notes.pdf'),new File([new Uint8Array([255,0])],'notes.txt'),new File(['text\0binary'],'notes.md'),new File(['note'],'../notes.txt'),new File(['note'],'bad\nname.txt'),new File(['note'],'x'.repeat(161)+'.txt')])await assert.rejects(validateAttachmentFile(file));
});
