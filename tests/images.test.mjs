import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Illustrations follow fiche permissions through Storage RLS',async t=>{
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL('./fixtures/security.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./fixtures/storage.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/images.sql',import.meta.url),'utf8'));
  await db.exec(`insert into compendium.fiches(campaign_id,type,name,summary,image_path,published) values
   ('10000000-0000-0000-0000-000000000001','place','Private','Synthetic','a/private.jpg',false),
   ('10000000-0000-0000-0000-000000000001','place','Public','Synthetic','a/public.jpg',true),
   ('10000000-0000-0000-0000-000000000002','npc','Other campaign','Synthetic','b/public.jpg',true);
   insert into storage.objects(bucket_id,name) values('compendium-images','a/private.jpg'),('compendium-images','a/public.jpg'),('compendium-images','b/public.jpg'),('compendium-images','orphan.jpg'),('other-bucket','a/public.jpg');`);
  async function visible(user){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?`00000000-0000-0000-0000-${user.padStart(12,'0')}`:'']);await db.exec(`set role ${user?'authenticated':'anon'}`);return (await db.query('select name from storage.objects order by name')).rows.map(x=>x.name);}
  await t.test('anonymous users and outsiders cannot download illustrations',async()=>{assert.deepEqual(await visible(null),[]);assert.deepEqual(await visible('5'),[]);});
  await t.test('the campaign MJ sees draft images, but no other campaign or orphan object',async()=>{assert.deepEqual(await visible('1'),['a/private.jpg','a/public.jpg']);});
  await t.test('players in either campaign session see only their published images',async()=>{assert.deepEqual(await visible('3'),['a/public.jpg']);assert.deepEqual(await visible('4'),['a/public.jpg']);assert.deepEqual(await visible('6'),['b/public.jpg']);});
  await t.test('unpublishing immediately removes Storage access and fiche JSON keeps its image',async()=>{await db.exec('reset role');await db.exec("update compendium.fiches set published=false where image_path='a/public.jpg'");assert.deepEqual(await visible('3'),[]);await visible('1');const {rows}=await db.query("select public.cm_list_fiches('10000000-0000-0000-0000-000000000001') as result");assert.equal(rows[0].result.fiches.find(f=>f.name==='Public').imagePath,'a/public.jpg');});
 }finally{await db.close();}
});
