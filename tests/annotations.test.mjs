import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const campaign='10000000-0000-0000-0000-000000000001';
const otherCampaign='10000000-0000-0000-0000-000000000002';
const missing='90000000-0000-0000-0000-000000000001';
const erasedBody='Message supprimé par l’utilisateur.';

test('Message authors can erase only their own accessible annotations, leaving an immutable trace',async t=>{
  const db=new PGlite();
  try{
    for(const file of ['fixtures/security.sql','fixtures/storage.sql','../supabase/schema.sql','../supabase/images.sql','../supabase/deletion.sql','../supabase/annotations.sql']){
      await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    }
    async function as(user){
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?`00000000-0000-0000-0000-${String(user).padStart(12,'0')}`:'']);
      await db.exec(`set role ${user?'authenticated':'anon'}`);
    }
    async function rpc(name,args,casts){
      assert.match(name,/^cm_[a-z_]+$/);
      const parameters=args.map((_,i)=>`$${i+1}::${casts[i]}`).join(',');
      return (await db.query(`select public.${name}(${parameters}) as result`,args)).rows[0].result;
    }
    const denied=(operation,code='42501',message)=>assert.rejects(operation,error=>{
      assert.equal(error.code,code,error.message);
      if(message)assert.equal(error.message,message);
      return true;
    });
    const draft=(overrides={})=>({type:'place',name:'Synthetic place',subtitle:'',location:'',summary:'Synthetic summary',description:'Synthetic information',published:true,...overrides});
    const saveFiche=(value,id=null,version=null,c=campaign)=>rpc('cm_save_fiche',[c,id,version,JSON.stringify(value)],['uuid','uuid','integer','jsonb']);
    const get=(id,c=campaign)=>rpc('cm_get_fiche',[c,id],['uuid','uuid']);
    const write=(ficheId,id,version,body,c=campaign)=>rpc('cm_save_annotation',[c,ficheId,id,version,body],['uuid','uuid','uuid','integer','text']);
    const erase=(ficheId,id,version,c=campaign)=>rpc('cm_delete_annotation',[c,ficheId,id,version],['uuid','uuid','uuid','integer']);
    const add=async(ficheId,body,c=campaign)=>{
      const result=await write(ficheId,null,null,body,c);
      return result.annotations.find(a=>a.body===body);
    };
    await as(1);
    const place=(await saveFiche(draft())).fiche;
    const npc=(await saveFiche(draft({type:'npc',name:'Synthetic NPC'}))).fiche;
    const withdrawn=(await saveFiche(draft({name:'Withdrawn later'}))).fiche;
    const privateFiche=(await saveFiche(draft({name:'GM private draft',published:false}))).fiche;
    const gmPrivateNote=await add(privateFiche.id,'Private draft note');
    const gmNote=await add(place.id,'GM own message');
    await as(2);
    const foreign=(await saveFiche(draft({name:'Foreign place'}),null,null,otherCampaign)).fiche;
    const foreignNote=await add(foreign.id,'Foreign message',otherCampaign);
    await as(3);
    let playerNote=await add(place.id,'Original private wording to erase');
    const npcNote=await add(npc.id,'NPC author message');
    const withdrawnNote=await add(withdrawn.id,'Message before withdrawal');
    await as(4);
    const otherNote=await add(place.id,'Another player message');

    await t.test('the additive SQL can be run again without modifying existing messages',async()=>{
      await db.exec('reset role');
      await db.exec(await readFile(new URL('../supabase/annotations.sql',import.meta.url),'utf8'));
      await as(3);
      assert.equal((await get(place.id)).annotations.find(a=>a.id===playerNote.id).body,playerNote.body);
    });

    await t.test('anonymous access and null authenticated identities cannot call message RPCs',async()=>{
      await as(null);
      await denied(()=>erase(place.id,playerNote.id,1));
      await denied(()=>write(place.id,playerNote.id,1,'Anonymous edit'));
      await db.exec('set role authenticated');
      await denied(()=>erase(place.id,playerNote.id,1),'42501','Connexion requise');
      await denied(()=>write(place.id,playerNote.id,1,'Missing identity'),'42501','Connexion requise');
    });

    await t.test('storage stays private and only authenticated callers receive the delete RPC grant',async()=>{
      await db.exec('reset role');
      for(const role of ['anon','authenticated']){
        // Image storage policies already grant schema usage, never table access.
        assert.equal((await db.query("select has_schema_privilege($1,'compendium','USAGE') as allowed",[role])).rows[0].allowed,role==='authenticated');
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']){
          assert.equal((await db.query("select has_table_privilege($1,'compendium.annotations',$2) as allowed",[role,privilege])).rows[0].allowed,false);
        }
        assert.equal((await db.query("select has_function_privilege($1,'compendium.annotations_json(uuid,uuid)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
        assert.equal((await db.query("select has_function_privilege($1,'public.cm_delete_annotation(uuid,uuid,uuid,integer)','EXECUTE') as allowed",[role])).rows[0].allowed,role==='authenticated');
      }
      assert.equal((await db.query("select relrowsecurity from pg_class where oid='compendium.annotations'::regclass")).rows[0].relrowsecurity,true);
      const fn=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.cm_delete_annotation(uuid,uuid,uuid,integer)'::regprocedure")).rows[0];
      assert.equal(fn.prosecdef,true);
      assert.ok(fn.proconfig.includes('search_path=""'));
      await as(3);
      await denied(()=>db.query('update compendium.annotations set body=$1 where id=$2',['Direct write',playerNote.id]));
      await denied(()=>db.query('select compendium.annotations_json($1,$2)',[campaign,place.id]));
    });

    await t.test('only the author receives edit and delete controls, including when the viewer is MJ',async()=>{
      for(const [user,ownId] of [[3,playerNote.id],[4,otherNote.id],[1,gmNote.id]]){
        await as(user);
        const {annotations}=await get(place.id);
        assert.equal(annotations.length,3);
        for(const note of annotations){
          assert.equal(note.canEdit,note.id===ownId);
          assert.equal(note.canDelete,note.id===ownId);
          assert.equal(note.deletedAt,null);
        }
      }
    });

    await t.test('another player, the campaign MJ and outsiders cannot erase a players message',async()=>{
      for(const user of [4,1,2,5,6,7]){
        await as(user);
        await denied(()=>erase(place.id,playerNote.id,1));
      }
      await as(3);
      assert.equal((await get(place.id)).annotations.find(a=>a.id===playerNote.id).body,playerNote.body);
      await denied(()=>erase(place.id,gmNote.id,1),'42501','Vous pouvez supprimer uniquement vos messages');
    });

    await t.test('known UUIDs cannot move an annotation across fiches or campaigns',async()=>{
      await as(3);
      await denied(()=>erase(npc.id,playerNote.id,1),'42501','Annotation indisponible');
      await denied(()=>erase(place.id,foreignNote.id,1),'42501','Annotation indisponible');
      await denied(()=>erase(foreign.id,playerNote.id,1));
      await denied(()=>erase(foreign.id,playerNote.id,1,otherCampaign));
      await as(2);
      await denied(()=>erase(foreign.id,playerNote.id,1,otherCampaign),'42501','Annotation indisponible');
      await denied(()=>write(foreign.id,playerNote.id,1,'Cross campaign overwrite',otherCampaign),'42501','Annotation indisponible');
      await as(3);
      await denied(()=>write(npc.id,playerNote.id,1,'Cross fiche overwrite'),'42501','Annotation indisponible');
    });

    await t.test('unknown or null IDs expose no annotation content or version',async()=>{
      await as(3);
      for(const id of [missing,null])await denied(()=>erase(place.id,id,1),'42501','Annotation indisponible');
      await denied(()=>erase(missing,playerNote.id,1),'42501','Fiche indisponible');
      await denied(()=>erase(null,playerNote.id,1),'42501','Fiche indisponible');
    });

    await t.test('stale, null and invalid versions cannot erase an edited message',async()=>{
      await as(3);
      const edited=await write(place.id,playerNote.id,playerNote.version,'Updated private wording to erase');
      playerNote=edited.annotations.find(a=>a.id===playerNote.id);
      assert.equal(playerNote.version,2);
      for(const version of [1,null,0,-1,3])await denied(()=>erase(place.id,playerNote.id,version),'40001');
      await denied(()=>write(place.id,playerNote.id,1,'Stale edit'),'40001');
      await denied(()=>write(place.id,playerNote.id,null,'No version'),'40001');
      assert.equal((await get(place.id)).annotations.find(a=>a.id===playerNote.id).body,playerNote.body);
    });

    await t.test('withdrawn and deleted fiches prevent all player annotation writes, even by their author',async()=>{
      await as(1);
      const hidden=(await saveFiche(draft({name:withdrawn.name,published:false}),withdrawn.id,withdrawn.version)).fiche;
      await as(3);
      await denied(()=>get(hidden.id));
      await denied(()=>erase(hidden.id,withdrawnNote.id,withdrawnNote.version),'42501','Fiche indisponible');
      await denied(()=>write(hidden.id,withdrawnNote.id,withdrawnNote.version,'After withdrawal'),'42501','Fiche indisponible');
      await denied(()=>erase(privateFiche.id,gmPrivateNote.id,1),'42501','Fiche indisponible');
      await as(1);
      await denied(()=>erase(hidden.id,withdrawnNote.id,withdrawnNote.version),'42501','Vous pouvez supprimer uniquement vos messages');
      const deleted=(await rpc('cm_delete_fiche',[campaign,hidden.id,hidden.version],['uuid','uuid','integer'])).fiche;
      for(const user of [1,3]){
        await as(user);
        await denied(()=>erase(deleted.id,withdrawnNote.id,withdrawnNote.version),'42501','Fiche indisponible');
        await denied(()=>write(deleted.id,withdrawnNote.id,withdrawnNote.version,'After deletion'),'42501','Fiche indisponible');
      }
    });

    let erased;
    await t.test('an author erases the stored body and retains the message identity, author, date and order',async()=>{
      await as(3);
      const before=(await get(place.id)).annotations;
      const result=await erase(place.id,playerNote.id,playerNote.version);
      assert.deepEqual(result.annotations.map(a=>a.id),before.map(a=>a.id));
      assert.equal(result.annotations.length,3,'The RPC returns the complete updated thread');
      erased=result.annotations.find(a=>a.id===playerNote.id);
      assert.equal(erased.body,erasedBody);
      assert.equal(erased.id,playerNote.id);
      assert.equal(erased.ficheId,playerNote.ficheId);
      assert.equal(erased.author,playerNote.author);
      assert.equal(erased.createdAt,playerNote.createdAt);
      assert.equal(erased.version,playerNote.version+1);
      assert.ok(erased.deletedAt);
      assert.equal(erased.updatedAt,erased.deletedAt);
      assert.equal(erased.canEdit,false);
      assert.equal(erased.canDelete,false);
      assert.ok(!JSON.stringify(result).includes(playerNote.body));
      assert.ok(!JSON.stringify(result).includes('Original private wording'));
      await db.exec('reset role');
      const row=(await db.query('select body,author_id,deleted_at,created_at,version from compendium.annotations where id=$1',[playerNote.id])).rows[0];
      assert.equal(row.body,erasedBody,'The old body is removed from the live database row');
      assert.ok(row.deleted_at);
      assert.equal(row.author_id,'00000000-0000-0000-0000-000000000003');
      assert.equal(row.version,erased.version);
    });

    await t.test('every authorized viewer sees the same trace with no original body or mutable controls',async()=>{
      for(const user of [3,4,1]){
        await as(user);
        const response=await get(place.id);
        assert.equal(response.fiche.annotationCount,3,'The deleted message still occupies its original place');
        const trace=response.annotations.find(a=>a.id===erased.id);
        assert.deepEqual(trace,erased);
        assert.ok(!JSON.stringify(response).includes(playerNote.body));
        assert.equal(response.annotations.find(a=>a.id===otherNote.id).body,otherNote.body);
        assert.equal(response.annotations.find(a=>a.id===gmNote.id).body,gmNote.body);
      }
    });

    await t.test('duplicate deletion and stale editor submissions cannot change or restore the trace',async()=>{
      await as(3);
      await denied(()=>erase(place.id,erased.id,playerNote.version),'40001');
      await denied(()=>erase(place.id,erased.id,null),'40001');
      await denied(()=>erase(place.id,erased.id,erased.version),'42501','Ce message a déjà été supprimé');
      await denied(()=>write(place.id,erased.id,playerNote.version,'Old editor restore'),'40001');
      await denied(()=>write(place.id,erased.id,erased.version,'New editor restore'),'42501','Ce message a été supprimé et ne peut plus être modifié');
      for(const user of [4,1]){
        await as(user);
        await denied(()=>erase(place.id,erased.id,erased.version),'42501','Vous pouvez supprimer uniquement vos messages');
        await denied(()=>write(place.id,erased.id,erased.version,'Other user restore'),'42501','Vous pouvez modifier uniquement vos annotations');
      }
      assert.deepEqual((await get(place.id)).annotations.find(a=>a.id===erased.id),erased);
    });

    await t.test('a database constraint forbids retaining text in a deleted live row',async()=>{
      await db.exec('reset role');
      await denied(()=>db.query('update compendium.annotations set body=$1 where id=$2',['Retained private text',erased.id]),'23514');
      assert.equal((await db.query('select body from compendium.annotations where id=$1',[erased.id])).rows[0].body,erasedBody);
    });

    await t.test('the same author-only deletion works on NPCs and on the MJs own private messages',async()=>{
      await as(3);
      const npcResult=await erase(npc.id,npcNote.id,npcNote.version);
      assert.equal(npcResult.annotations[0].body,erasedBody);
      assert.equal(npcResult.annotations[0].canDelete,false);
      await as(1);
      const privateResult=await erase(privateFiche.id,gmPrivateNote.id,gmPrivateNote.version);
      assert.equal(privateResult.annotations[0].body,erasedBody);
      const gmResult=await erase(place.id,gmNote.id,gmNote.version);
      assert.equal(gmResult.annotations.find(a=>a.id===gmNote.id).body,erasedBody);
      assert.equal(gmResult.annotations.find(a=>a.id===otherNote.id).body,otherNote.body);
    });

    await t.test('authorship alone does not bypass campaign access after membership is removed',async()=>{
      await db.exec('reset role');
      await db.query('delete from public.room_members where user_id=$1',['00000000-0000-0000-0000-000000000004']);
      await as(4);
      await denied(()=>erase(place.id,otherNote.id,otherNote.version));
      await denied(()=>write(place.id,otherNote.id,otherNote.version,'Former member edit'));
      await as(1);
      assert.equal((await get(place.id)).annotations.find(a=>a.id===otherNote.id).body,otherNote.body);
    });

    await t.test('ordinary annotation validation still rejects empty, oversized and null bodies',async()=>{
      await as(3);
      for(const body of ['', '  ',null,'x'.repeat(6001)]){
        await denied(()=>write(place.id,null,null,body),'22023');
      }
      const result=await write(place.id,null,null,'New message after deleting another');
      assert.equal(result.annotations.length,4);
      assert.deepEqual(result.annotations.find(a=>a.id===erased.id),erased);
      assert.equal(result.annotations.find(a=>a.body==='New message after deleting another').canDelete,true);
    });
  }finally{await db.close();}
});
