import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Only the campaign MJ can delete and restore complete fiches',async t=>{
 const db=new PGlite();
 const campaign='10000000-0000-0000-0000-000000000001';
 const otherCampaign='10000000-0000-0000-0000-000000000002';
 const draft={type:'place',name:'Synthetic place',subtitle:'',location:'',summary:'Synthetic summary',description:'Synthetic information',published:true};
 try{
  for(const file of ['fixtures/security.sql','fixtures/storage.sql','../supabase/schema.sql','../supabase/images.sql','../supabase/deletion.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  async function as(user){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?`00000000-0000-0000-0000-${String(user).padStart(12,'0')}`:'']);await db.exec(`set role ${user?'authenticated':'anon'}`);}
  async function rpc(name,args,casts){const params=args.map((_,i)=>`$${i+1}::${casts[i]}`).join(',');return (await db.query(`select public.${name}(${params}) as result`,args)).rows[0].result;}
  const list=()=>rpc('cm_list_fiches',[campaign],['uuid']);
  const trash=()=>rpc('cm_list_deleted_fiches',[campaign],['uuid']);
  const denied=(fn,code='42501')=>assert.rejects(fn,e=>{assert.equal(e.code,code,e.message);return true;});
  await as(1);
  const {fiche}=await rpc('cm_save_fiche',[campaign,null,null,JSON.stringify(draft)],['uuid','uuid','integer','jsonb']);
  const id=fiche.id;
  const move=(kind,version,c=campaign)=>rpc(`cm_${kind}_fiche`,[c,id,version],['uuid','uuid','integer']);
  const get=()=>rpc('cm_get_fiche',[campaign,id],['uuid','uuid']);
  await db.exec('reset role');
  await db.query("update compendium.fiches set image_path='test/image.jpg' where id=$1",[id]);
  await db.exec("insert into storage.objects(bucket_id,name)values('compendium-images','test/image.jpg')");
  await as(3);
  const note=(await rpc('cm_save_annotation',[campaign,id,null,null,'Remember the visit'],['uuid','uuid','uuid','integer','text'])).annotations[0];
  await t.test('anonymous users, players and forged MJ identities cannot move fiches or read the trash',async()=>{
   for(const user of [null,3,4,5,6,7]){await as(user);await denied(()=>move('delete',fiche.version));await denied(()=>move('restore',fiche.version));await denied(trash);}
  });
  await t.test('another genuine MJ cannot delete or restore across campaigns',async()=>{
   await as(2);await denied(()=>move('delete',fiche.version));await denied(()=>move('delete',fiche.version,otherCampaign));await denied(()=>move('restore',fiche.version));
  });
  await t.test('stale and missing versions cannot delete a current fiche',async()=>{
   await as(1);await denied(()=>move('delete',0),'40001');await denied(()=>move('delete',null),'40001');assert.equal((await list()).fiches.length,1);
  });
  let deleted;
  await t.test('deletion removes the fiche from active lists but retains its data in the MJ trash',async()=>{
   await as(1);deleted=(await move('delete',fiche.version)).fiche;
   assert.ok(deleted.deletedAt);assert.equal(deleted.published,false);assert.equal(deleted.version,fiche.version+1);
   assert.deepEqual((await list()).fiches,[]);assert.equal((await trash()).fiches[0].id,id);
   await denied(()=>move('delete',deleted.version));
   await db.exec('reset role');
   assert.equal((await db.query('select body from compendium.annotations where fiche_id=$1',[id])).rows[0].body,note.body);
   assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1);
  });
  await t.test('deleted fiche UUIDs cannot read, edit, annotate or download the old image',async()=>{
   for(const user of [1,3]){
    await as(user);await denied(get);
    await denied(()=>rpc('cm_save_fiche',[campaign,id,deleted.version,JSON.stringify(draft)],['uuid','uuid','integer','jsonb']));
    await denied(()=>rpc('cm_save_annotation',[campaign,id,null,null,'After deletion'],['uuid','uuid','uuid','integer','text']));
    await denied(()=>rpc('cm_save_annotation',[campaign,id,note.id,note.version,'Overwrite'],['uuid','uuid','uuid','integer','text']));
    assert.deepEqual((await db.query('select name from storage.objects')).rows,[]);
   }
  });
  await t.test('an import cannot resurrect a deleted record',async()=>{
   await as(1);const result=await rpc('cm_import_fiches',[campaign,JSON.stringify([{...draft,id}])],['uuid','jsonb']);
   assert.equal(result.imported,0);assert.equal(result.skipped,1);assert.deepEqual((await list()).fiches,[]);assert.equal((await trash()).fiches.length,1);
  });
  let restored;
  await t.test('only the owning MJ restores the expected version, always as a private draft',async()=>{
   await as(1);await denied(()=>move('restore',deleted.version-1),'40001');
   restored=(await move('restore',deleted.version)).fiche;
   assert.equal(restored.deletedAt,null);assert.equal(restored.published,false);assert.equal(restored.version,deleted.version+1);assert.equal(restored.imagePath,'test/image.jpg');assert.equal(restored.annotationCount,1);
   assert.deepEqual((await trash()).fiches,[]);assert.equal((await get()).annotations[0].body,note.body);
   await denied(()=>move('restore',restored.version));
   await as(3);assert.deepEqual((await list()).fiches,[]);await denied(get);assert.deepEqual((await db.query('select name from storage.objects')).rows,[]);
  });
  await t.test('republication restores access to the same image and the original authors annotations',async()=>{
   await as(1);await rpc('cm_save_fiche',[campaign,id,restored.version,JSON.stringify(draft)],['uuid','uuid','integer','jsonb']);
   await as(3);const result=await get();assert.equal(result.annotations[0].id,note.id);assert.equal(result.annotations[0].canEdit,true);assert.equal(result.annotations[0].body,note.body);
   assert.deepEqual((await db.query('select name from storage.objects')).rows,[{name:'test/image.jpg'}]);
  });
 }finally{await db.close();}
});
