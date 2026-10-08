import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const types=['place','npc','faction','cosmogony','history','culture','knowledge'];
const campaign='10000000-0000-0000-0000-000000000001';
const otherCampaign='10000000-0000-0000-0000-000000000002';
const data=(type,overrides={})=>({
  type,name:`Synthetic ${type}`,subtitle:'Synthetic subtitle',location:'Synthetic context',
  summary:'Synthetic summary',description:'Synthetic information',published:true,...overrides,
});
const sql=path=>readFile(new URL(path,import.meta.url),'utf8');

for(const installation of ['fresh','upgrade']){
  test(`All lore categories retain campaign protections on ${installation==='fresh'?'a fresh':'an upgraded'} installation`,async t=>{
    const db=new PGlite();
    try{
      await db.exec(await sql('./fixtures/security.sql'));
      await db.exec(await sql('./fixtures/storage.sql'));
      const schema=await sql('../supabase/schema.sql');
      if(installation==='upgrade'){
        // Recreate the pre-lore schema and its restrictive validator for the upgrade path.
        const accepted=types.map(type=>`'${type}'`).join(',');
        assert.equal(schema.split(accepted).length-1,2);
        await db.exec(schema.replaceAll(accepted,"'place','npc'"));
      }else{
        // A new installation must support the categories without the upgrade script.
        await db.exec(schema);
      }
      for(const file of ['images','deletion','annotations'])await db.exec(await sql(`../supabase/${file}.sql`));

      async function as(user){
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[
          user?`00000000-0000-0000-0000-${String(user).padStart(12,'0')}`:'',
        ]);
        await db.exec(`set role ${user?'authenticated':'anon'}`);
      }
      async function rpc(name,args,casts){
        assert.match(name,/^cm_[a-z_]+$/);
        const parameters=args.map((_,i)=>`$${i+1}::${casts[i]}`).join(',');
        return (await db.query(`select public.${name}(${parameters}) as result`,args)).rows[0].result;
      }
      const denied=(operation,code='42501')=>assert.rejects(operation,error=>{
        assert.equal(error.code,code,error.message);
        return true;
      });
      const save=(value,id=null,version=null,c=campaign)=>rpc('cm_save_fiche',[c,id,version,JSON.stringify(value)],['uuid','uuid','integer','jsonb']);
      const get=id=>rpc('cm_get_fiche',[campaign,id],['uuid','uuid']);
      const list=()=>rpc('cm_list_fiches',[campaign],['uuid']);
      const trash=()=>rpc('cm_list_deleted_fiches',[campaign],['uuid']);
      const importFiches=items=>rpc('cm_import_fiches',[campaign,JSON.stringify(items)],['uuid','jsonb']);
      const annotate=(id,body,noteId=null,version=null)=>rpc('cm_save_annotation',[campaign,id,noteId,version,body],['uuid','uuid','uuid','integer','text']);
      const erase=(id,note)=>rpc('cm_delete_annotation',[campaign,id,note.id,note.version],['uuid','uuid','uuid','integer']);
      const move=(kind,id,version)=>rpc(`cm_${kind}_fiche`,[campaign,id,version],['uuid','uuid','integer']);
      const imagePaths=async()=>new Set((await db.query('select name from storage.objects')).rows.map(row=>row.name));

      if(installation==='upgrade'){
        await t.test('the additive script preserves existing content, messages, images and RPC definitions on repeated application',async()=>{
          await as(1);
          const existing=(await save(data('place'))).fiche;
          await annotate(existing.id,'Existing annotation');
          const deleted=(await save(data('npc',{name:'Existing trash'}))).fiche;
          await move('delete',deleted.id,deleted.version);
          await db.exec('reset role');
          await db.query("update compendium.fiches set image_path='existing.jpg' where id=$1",[existing.id]);
          await db.exec("insert into storage.objects(bucket_id,name) values('compendium-images','existing.jpg')");
          const content=async()=>({
            fiches:(await db.query('select * from compendium.fiches order by id')).rows,
            annotations:(await db.query('select * from compendium.annotations order by id')).rows,
            images:(await db.query('select * from storage.objects order by name')).rows,
            rpcDefinitions:(await db.query("select p.proname,pg_get_functiondef(p.oid) as definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cm_%' order by p.proname")).rows,
          });
          const before=await content();
          await db.exec(await sql('../supabase/lore-types.sql'));
          await db.exec(await sql('../supabase/lore-types.sql'));
          assert.deepEqual(await content(),before);
          await as(1);
          assert.equal((await get(existing.id)).fiche.imagePath,'existing.jpg');
          assert.equal((await get(existing.id)).annotations[0].body,'Existing annotation');
          assert.equal((await trash()).fiches[0].id,deleted.id);
        });
      }

      await t.test('private storage, helpers and RPC grants remain protected',async()=>{
        await db.exec('reset role');
        for(const role of ['anon','authenticated']){
          assert.equal((await db.query("select has_function_privilege($1,'compendium.validate_fiche(jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
          for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']){
            assert.equal((await db.query("select has_table_privilege($1,'compendium.fiches',$2) as allowed",[role,privilege])).rows[0].allowed,false);
          }
          assert.equal((await db.query("select has_function_privilege($1,'public.cm_save_fiche(uuid,uuid,integer,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,role==='authenticated');
        }
        assert.equal((await db.query("select relrowsecurity from pg_class where oid='compendium.fiches'::regclass")).rows[0].relrowsecurity,true);
      });

      for(const type of types){
        await t.test(`${type} supports save/read, private drafts, annotations, illustrations and recoverable deletion`,async()=>{
          await as(1);
          let fiche=(await save(data(type))).fiche;
          const hidden=(await save(data(type,{name:`Hidden ${type}`,published:false,summary:`Secret ${type}`}))).fiche;
          assert.equal(fiche.type,type);
          assert.equal(fiche.version,1);
          await db.exec('reset role');
          const publicPath=`${type}/published.jpg`,privatePath=`${type}/private.jpg`;
          await db.query('update compendium.fiches set image_path=$1 where id=$2',[publicPath,fiche.id]);
          await db.query('update compendium.fiches set image_path=$1 where id=$2',[privatePath,hidden.id]);
          await db.query("insert into storage.objects(bucket_id,name) values('compendium-images',$1),('compendium-images',$2)",[publicPath,privatePath]);
          await as(3);
          assert.equal((await get(fiche.id)).fiche.type,type);
          const visible=(await list()).fiches;
          assert.ok(visible.some(row=>row.id===fiche.id));
          assert.ok(!JSON.stringify(visible).includes(hidden.id));
          assert.ok(!JSON.stringify(visible).includes(`Secret ${type}`));
          await denied(()=>get(hidden.id));
          await denied(()=>annotate(hidden.id,'Guessed hidden UUID'));
          await denied(()=>save(data(type)));
          await denied(()=>importFiches([{...data(type),id:hidden.id}]));
          const note=(await annotate(fiche.id,`Note for ${type}`)).annotations[0];
          assert.equal(note.canDelete,true);
          assert.equal((await imagePaths()).has(publicPath),true);
          assert.equal((await imagePaths()).has(privatePath),false);
          await as(4);
          await denied(()=>erase(fiche.id,note));
          await as(1);
          await denied(()=>erase(fiche.id,note));
          fiche=(await save(data(type,{summary:'Updated summary'}),fiche.id,fiche.version)).fiche;
          assert.equal(fiche.version,2);
          assert.equal(fiche.imagePath,publicPath);
          assert.equal(fiche.annotationCount,1);
          await denied(()=>save(data(type,{summary:'Stale summary'}),fiche.id,1),'40001');
          await denied(()=>move('delete',fiche.id,1),'40001');
          const deleted=(await move('delete',fiche.id,fiche.version)).fiche;
          assert.equal(deleted.type,type);
          assert.equal(deleted.version,3);
          assert.equal(deleted.published,false);
          assert.ok(deleted.deletedAt);
          assert.ok((await trash()).fiches.some(row=>row.id===fiche.id));
          assert.deepEqual(await importFiches([{...data(type),id:fiche.id}]),{imported:0,skipped:1,total:1});
          for(const user of [1,3]){
            await as(user);
            assert.ok(!(await list()).fiches.some(row=>row.id===fiche.id));
            await denied(()=>get(fiche.id));
            await denied(()=>save(data(type),fiche.id,deleted.version));
            await denied(()=>annotate(fiche.id,'Message after deletion'));
            await denied(()=>erase(fiche.id,note));
            assert.equal((await imagePaths()).has(publicPath),false);
          }
          await as(1);
          await denied(()=>move('restore',fiche.id,2),'40001');
          const restored=(await move('restore',fiche.id,deleted.version)).fiche;
          assert.equal(restored.type,type);
          assert.equal(restored.version,4);
          assert.equal(restored.deletedAt,null);
          assert.equal(restored.published,false);
          assert.equal(restored.imagePath,publicPath);
          assert.equal((await get(fiche.id)).annotations[0].body,note.body);
          await as(3);
          await denied(()=>get(fiche.id));
          assert.equal((await imagePaths()).has(publicPath),false);
          await as(1);
          fiche=(await save(data(type),fiche.id,restored.version)).fiche;
          assert.equal(fiche.version,5);
          await as(3);
          assert.equal((await imagePaths()).has(publicPath),true);
          assert.equal((await get(fiche.id)).annotations[0].body,note.body);
          const erased=(await erase(fiche.id,note)).annotations[0];
          assert.equal(erased.body,'Message supprimé par l’utilisateur.');
          assert.equal(erased.canEdit,false);
        });
      }

      await t.test('existing places and NPCs can be reclassified without replacing content, images or annotations',async()=>{
        for(const [originalType,targetType] of [['place','faction'],['npc','cosmogony']]){
          await as(1);
          const payload=data(originalType,{name:`Reclassified ${originalType}`});
          const original=(await save(payload)).fiche;
          const imagePath=`reclassified/${originalType}.jpg`;
          await db.exec('reset role');
          await db.query('update compendium.fiches set image_path=$1 where id=$2',[imagePath,original.id]);
          await db.query("insert into storage.objects(bucket_id,name) values('compendium-images',$1)",[imagePath]);
          await as(3);
          const note=(await annotate(original.id,`Original ${originalType} annotation`)).annotations[0];
          await as(1);
          const reclassified=(await save({...payload,type:targetType},original.id,original.version)).fiche;
          assert.equal(reclassified.id,original.id);
          assert.equal(reclassified.type,targetType);
          assert.equal(reclassified.version,original.version+1);
          assert.equal(reclassified.published,true);
          assert.equal(reclassified.imagePath,imagePath);
          assert.equal(reclassified.annotationCount,1);
          for(const field of ['name','subtitle','location','summary','description'])assert.equal(reclassified[field],original[field]);
          assert.equal((await list()).fiches.filter(row=>row.id===original.id).length,1);
          await denied(()=>save(payload,original.id,original.version),'40001');
          assert.equal((await get(original.id)).fiche.type,targetType);
          await as(3);
          assert.deepEqual((await get(original.id)).annotations,[note]);
          assert.equal((await imagePaths()).has(imagePath),true);

          await as(1);
          const hidden=(await save({...payload,type:targetType,published:false},original.id,reclassified.version)).fiche;
          assert.equal(hidden.id,original.id);
          assert.equal(hidden.type,targetType);
          assert.equal(hidden.version,reclassified.version+1);
          assert.equal((await get(original.id)).annotations[0].id,note.id);
          await as(3);
          assert.ok(!(await list()).fiches.some(row=>row.id===original.id));
          await denied(()=>get(original.id));
          await denied(()=>annotate(original.id,'Hidden reclassified annotation'));
          assert.equal((await imagePaths()).has(imagePath),false);

          await as(1);
          const republished=(await save({...payload,type:targetType},original.id,hidden.version)).fiche;
          assert.equal(republished.id,original.id);
          assert.equal(republished.type,targetType);
          assert.equal(republished.version,hidden.version+1);
          await as(3);
          assert.deepEqual((await get(original.id)).annotations,[note]);
          assert.equal((await imagePaths()).has(imagePath),true);
        }
      });

      await t.test('all categories import as private drafts and duplicate imports preserve existing content',async()=>{
        await as(1);
        const items=types.map((type,i)=>data(type,{
          id:`20000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,name:`Imported ${type}`,
        }));
        assert.deepEqual(await importFiches(items),{imported:types.length,skipped:0,total:types.length});
        for(const item of items){
          const fiche=(await get(item.id)).fiche;
          assert.equal(fiche.type,item.type);
          assert.equal(fiche.published,false);
          assert.equal(fiche.version,1);
        }
        assert.deepEqual(await importFiches(items.map(item=>({...item,name:'Would overwrite'}))),{imported:0,skipped:types.length,total:types.length});
        await as(3);
        for(const item of items)await denied(()=>get(item.id));
        await as(1);
        assert.equal((await get(items[0].id)).fiche.name,items[0].name);
      });

      await t.test('invalid types are rejected by RPCs and the table, and roll back complete imports',async()=>{
        await as(1);
        const before=(await list()).fiches.length;
        for(const type of ['admin','factions','Cosmogony','',null,{},42]){
          await denied(()=>save(data(type)),'22023');
        }
        const valid=data('faction',{id:'30000000-0000-0000-0000-000000000001'});
        const invalid=data('admin',{id:'30000000-0000-0000-0000-000000000002'});
        await denied(()=>importFiches([valid,invalid]),'22023');
        await denied(()=>get(valid.id));
        await denied(()=>get(invalid.id));
        assert.equal((await list()).fiches.length,before);
        await db.exec('reset role');
        await denied(()=>db.query('insert into compendium.fiches(campaign_id,type,name,summary) values($1,$2,$3,$4)',[campaign,'admin','Invalid','Invalid']),'23514');
      });

      await t.test('anonymous identities and other campaigns cannot access new lore',async()=>{
        await as(1);
        const fiche=(await save(data('cosmogony'))).fiche;
        for(const user of [null,2,5,6,7]){
          await as(user);
          await denied(list);
          await denied(()=>get(fiche.id));
          await denied(()=>save(data('cosmogony'),fiche.id,fiche.version));
          await denied(()=>importFiches([]));
          await denied(()=>move('delete',fiche.id,fiche.version));
        }
        await as(2);
        await denied(()=>save(data('faction'),fiche.id,fiche.version,otherCampaign));
        await as(null);
        await db.exec('set role authenticated');
        await denied(()=>save(data('faction')));
      });
    }finally{
      await db.close();
    }
  });
}
