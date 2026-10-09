import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const campaign='10000000-0000-0000-0000-000000000001';
const otherCampaign='10000000-0000-0000-0000-000000000002';
const missing='90000000-0000-0000-0000-000000000001';
const bucket='compendium-attachments';

test('Private attachments enforce the upload contract and inherit fiche/message permissions',async t=>{
  const db=new PGlite();
  try{
    for(const file of ['fixtures/security.sql','fixtures/storage.sql','../supabase/schema.sql','../supabase/images.sql','../supabase/deletion.sql','../supabase/annotations.sql','../supabase/lore-types.sql']){
      await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    }
    // Real Storage stores final size and MIME in metadata and uniquely identifies paths.
    await db.exec('alter table storage.objects add column metadata jsonb; create unique index storage_object_path on storage.objects(bucket_id,name);');
    const script=await readFile(new URL('../supabase/attachments.sql',import.meta.url),'utf8');
    await db.exec(script);
    let currentUser;
    async function as(user){
      currentUser=user;
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?`00000000-0000-0000-0000-${String(user).padStart(12,'0')}`:'']);
      await db.exec(`set role ${user?'authenticated':'anon'}`);
    }
    async function rpc(name,args,casts){
      const parameters=args.map((_,i)=>`$${i+1}::${casts[i]}`).join(',');
      return (await db.query(`select public.${name}(${parameters}) as result`,args)).rows[0].result;
    }
    const denied=(operation,code='42501')=>assert.rejects(operation,error=>{assert.equal(error.code,code,error.message);return true;});
    const draft=(overrides={})=>({type:'knowledge',name:'Synthetic entry',subtitle:'',location:'',summary:'Synthetic summary',description:'Synthetic text',published:true,...overrides});
    const oldSave=(value,id=null,version=null,c=campaign)=>rpc('cm_save_fiche',[c,id,version,JSON.stringify(value)],['uuid','uuid','integer','jsonb']);
    const get=(id,c=campaign)=>rpc('cm_get_fiche',[c,id],['uuid','uuid']);
    const prepare=(fiche,target='annotation',name='note.txt',size=100,mime='text/plain',c=campaign)=>rpc('cm_prepare_attachment',[c,fiche,target,name,size,mime],['uuid','uuid','text','text','integer','text']);
    const discard=(id,c=campaign)=>rpc('cm_discard_attachment',[c,id],['uuid','uuid']);
    const saveFiche=(value,ids=[],id=null,version=null,c=campaign)=>rpc('cm_save_fiche_with_attachments',[c,id,version,JSON.stringify(value),ids],['uuid','uuid','integer','jsonb','uuid[]']);
    const saveNote=(fiche,body,ids=[],id=null,version=null,c=campaign)=>rpc('cm_save_annotation_with_attachments',[c,fiche,id,version,body,ids],['uuid','uuid','uuid','integer','text','uuid[]']);
    const upload=(file,metadata={size:file.size,mimetype:file.mimeType})=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[bucket,file.path,JSON.stringify(metadata)]);
    const paths=async()=> (await db.query('select name from storage.objects where bucket_id=$1 order by name',[bucket])).rows.map(x=>x.name);
    async function admin(operation){const user=currentUser;await db.exec('reset role');try{return await operation();}finally{await as(user);}}
    await as(1);
    let place=(await oldSave(draft())).fiche;
    const hidden=(await oldSave(draft({name:'Private draft',published:false}))).fiche;
    const otherPlace=(await oldSave(draft({name:'Second fiche'}))).fiche;
    await as(2);
    const foreign=(await oldSave(draft({name:'Foreign campaign'}),null,null,otherCampaign)).fiche;

    await t.test('anonymous users, outsiders and user-editable MJ claims cannot reserve files',async()=>{
      for(const user of [null,5,6,7]){await as(user);await denied(()=>prepare(place.id));}
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await denied(()=>prepare(place.id));
      await as(3);
      await denied(()=>prepare(place.id,'fiche'));
      await denied(()=>prepare(null,'annotation'));
      for(const fiche of [hidden.id,foreign.id,missing])await denied(()=>prepare(fiche));
    });

    await t.test('private metadata and helper functions are unavailable to client roles',async()=>{
      await admin(async()=>{
        for(const role of ['anon','authenticated']){
          for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query("select has_table_privilege($1,'compendium.attachments',$2) as ok",[role,privilege])).rows[0].ok,false);
          for(const signature of ['compendium.sync_attachments(uuid,uuid,uuid,text,uuid[])','compendium.attachments_json(uuid,uuid,uuid,text)','compendium.attachment_metadata_matches(integer,text,jsonb,boolean)']){
            assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,signature])).rows[0].ok,false);
          }
          for(const signature of ['public.cm_prepare_attachment(uuid,uuid,text,text,integer,text)','public.cm_save_fiche_with_attachments(uuid,uuid,integer,jsonb,uuid[])','public.cm_save_annotation_with_attachments(uuid,uuid,uuid,integer,text,uuid[])']){
            assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,signature])).rows[0].ok,role==='authenticated');
            const fn=(await db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
            assert.equal(fn.prosecdef,true);assert.ok(fn.proconfig.includes('search_path=""'));
          }
        }
        assert.equal((await db.query("select relrowsecurity from pg_class where oid='compendium.attachments'::regclass")).rows[0].relrowsecurity,true);
        const config=(await db.query('select * from storage.buckets where id=$1',[bucket])).rows[0];
        assert.equal(config.public,false);assert.equal(Number(config.file_size_limit),2000000);
        assert.deepEqual([...config.allowed_mime_types].sort(),['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif','application/pdf','text/markdown','text/plain'].sort());
      });
      await denied(()=>db.query('select * from compendium.attachments'));
    });

    await t.test('only exact image/PDF/md/txt extension-MIME pairs within 2,000,000 bytes reserve files',async()=>{
      await as(3);
      for(const [extension,mime] of [['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['bmp','image/bmp'],['avif','image/avif'],['pdf','application/pdf'],['md','text/markdown'],['txt','text/plain']]){
        const file=await prepare(place.id,'annotation',`Nom avec accents é.${extension.toUpperCase()}`,2000000,mime);
        assert.equal(file.name,`Nom avec accents é.${extension.toUpperCase()}`);
        assert.equal(file.mimeType,mime);assert.equal(file.size,2000000);
        assert.equal(file.path,`${campaign}/${file.id}.${extension}`);
        assert.deepEqual(Object.keys(file).sort(),['id','name','path','mimeType','size'].sort());
        await discard(file.id);
      }
      for(const [name,mime] of [['x.svg','image/svg+xml'],['x.html','text/plain'],['x.exe','application/pdf'],['x.md','text/plain'],['x.txt','text/markdown'],['x.png','image/jpeg'],['x','text/plain'],['x.pdf.exe','application/pdf'],['../x.txt','text/plain'],['folder\\x.txt','text/plain'],['x\n.txt','text/plain'],['x'.repeat(157)+'.txt','text/plain'],[null,'text/plain']]){
        await denied(()=>prepare(place.id,'annotation',name,10,mime),'22023');
      }
      for(const size of [null,-1,0,2000001])await denied(()=>prepare(place.id,'annotation','x.txt',size),'22023');
      await denied(()=>prepare(place.id,'bad-target'),'22023');
      await denied(()=>prepare(place.id,'annotation','x.txt',10,null),'22023');
    });

    let pending;
    await t.test('pending uploads are owner-only and deny arbitrary paths, metadata changes and overwrites',async()=>{
      await as(3);pending=await prepare(place.id);
      await denied(()=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,`${campaign}/${missing}.txt`,{size:100,mimetype:'text/plain'}]));
      await denied(()=>upload(pending,{size:101,mimetype:'text/plain'}));
      await denied(()=>upload(pending,{size:100,mimetype:'application/pdf'}));
      await denied(()=>upload(pending,{size:'999999999999999',mimetype:'text/plain'}));
      await denied(()=>upload(pending,{size:1.5,mimetype:'text/plain'}));
      await as(4);await denied(()=>upload(pending));
      await as(3);await upload(pending);
      assert.ok((await paths()).includes(pending.path));
      assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,pending.path])).rows.length,0,'An active reservation must be discarded before Storage cleanup');
      assert.ok((await paths()).includes(pending.path),'A pending file remains available for successful save');
      for(const user of [4,1,2,5,null]){await as(user);assert.ok(!(await paths()).includes(pending.path));}
      await as(3);
      assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,`${campaign}/${missing}.txt`])).rows.length,0);
      // No update policy is granted; a global Storage UPDATE grant cannot enable replacement.
      await admin(()=>db.exec('grant update on storage.objects to authenticated'));
      assert.equal((await db.query('update storage.objects set metadata=$1 where bucket_id=$2 and name=$3 returning name',[{size:101,mimetype:'text/plain'},bucket,pending.path])).rows.length,0);
      await denied(()=>upload(pending),'23505');
    });

    await t.test('a successful message save links its files to all campaign viewers and preserves existing fields',async()=>{
      await as(3);
      const result=await saveNote(place.id,'Attached synthetic message',[pending.id]);
      const note=result.annotations.find(x=>x.body==='Attached synthetic message');
      assert.deepEqual(note.attachments,[pending]);assert.equal(note.canEdit,true);assert.equal(note.canDelete,true);assert.equal(note.deletedAt,null);
      for(const user of [1,3,4]){
        await as(user);assert.ok((await paths()).includes(pending.path));
        assert.deepEqual((await get(place.id)).annotations.find(x=>x.id===note.id).attachments,[pending]);
      }
      for(const user of [2,5,6,null]){await as(user);assert.ok(!(await paths()).includes(pending.path));}
      await as(3);
      await denied(()=>discard(pending.id));
      assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,pending.path])).rows.length,0);
    });

    await t.test('preflight metadata may omit final size, but save rejects missing or mismatched final metadata transactionally',async()=>{
      await as(3);
      const file=await prepare(place.id,'annotation','preflight.md',50,'text/markdown');
      await upload(file,{mimetype:'text/markdown',contentLength:300});
      const before=(await get(place.id)).annotations.length;
      await denied(()=>saveNote(place.id,'Never committed',[file.id]),'22023');
      assert.equal((await get(place.id)).annotations.length,before);
      for(const metadata of [null,{size:49,mimetype:'text/markdown'},{size:50,mimetype:'text/plain'},{size:'50oops',mimetype:'text/markdown'}]){
        await admin(()=>db.query('update storage.objects set metadata=$1 where name=$2',[metadata,file.path]));
        await denied(()=>saveNote(place.id,'Never committed',[file.id]),'22023');
      }
      await admin(()=>db.query('update storage.objects set metadata=$1 where name=$2',[{size:50,mimetype:'text/markdown; charset=UTF-8'},file.path]));
      assert.equal((await saveNote(place.id,'Verified final metadata',[file.id])).annotations.find(x=>x.body==='Verified final metadata').attachments[0].id,file.id);
      const absent=await prepare(place.id);
      await denied(()=>saveNote(place.id,'Absent object',[absent.id]),'22023');
    });

    await t.test('file claims cannot cross authors, destinations, fiches or campaigns and do not create a message on failure',async()=>{
      await as(3);const own=await prepare(place.id);await upload(own);
      const before=(await get(place.id)).annotations.length;
      await denied(()=>saveNote(otherPlace.id,'Wrong fiche',[own.id]));
      await as(4);await denied(()=>saveNote(place.id,'Wrong owner',[own.id]));
      await as(2);const cross=await prepare(foreign.id,'annotation','foreign.txt',100,'text/plain',otherCampaign);await upload(cross);
      await as(3);await denied(()=>saveNote(place.id,'Wrong campaign',[cross.id]));
      await denied(()=>saveNote(place.id,'Unknown attachment',[missing]));
      assert.equal((await get(place.id)).annotations.length,before);
      await as(1);const ficheFile=await prepare(place.id,'fiche');await upload(ficheFile);
      await denied(()=>saveNote(place.id,'Wrong target',[ficheFile.id]));
      await denied(()=>saveFiche(draft(),[own.id],place.id,place.version));
      assert.equal((await get(place.id)).fiche.version,place.version,'Failed sync rolls back fiche save/version');
    });

    let note;
    await t.test('full attachment lists preserve, remove and add files with author/version checks',async()=>{
      await as(3);
      const first=await prepare(place.id);await upload(first);
      note=(await saveNote(place.id,'Versioned attachment message',[first.id])).annotations.find(x=>x.body==='Versioned attachment message');
      const second=await prepare(place.id,'annotation','new.pdf',200,'application/pdf');await upload(second);
      for(const user of [1,4]){await as(user);await denied(()=>saveNote(place.id,'Foreign edit',[first.id],note.id,note.version));}
      await as(3);
      await denied(()=>saveNote(place.id,'Stale edit',[second.id],note.id,null),'40001');
      note=(await saveNote(place.id,'Version two',[first.id,second.id],note.id,note.version)).annotations.find(x=>x.id===note.id);
      assert.equal(note.version,2);assert.equal(note.attachments.length,2);
      await denied(()=>saveNote(place.id,'Stale edit',[second.id],note.id,1),'40001');
      note=(await saveNote(place.id,'Only the new file',[second.id],note.id,note.version)).annotations.find(x=>x.id===note.id);
      assert.deepEqual(note.attachments,[second]);assert.ok(!(await paths()).includes(first.path));
      await denied(()=>saveNote(place.id,'Reuse removed file',[first.id],note.id,note.version));
      assert.equal((await get(place.id)).annotations.find(x=>x.id===note.id).version,note.version);
      const another=await prepare(place.id);await upload(another);
      await denied(()=>saveNote(place.id,'Reuse linked file',[second.id]));
      await denied(()=>saveNote(place.id,'Duplicates',[another.id,another.id]),'22023');
      await denied(()=>saveNote(place.id,'Null IDs',[null]),'22023');
      await denied(()=>saveNote(place.id,'Too many',Array.from({length:11},(_,i)=>`90000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`)),'22023');
      for(const body of ['',null,'x'.repeat(6001)])await denied(()=>saveNote(place.id,body),'22023');
    });

    await t.test('new and existing MJ fiches save their complete list without changing publication rules',async()=>{
      await as(1);
      const file=await prepare(null,'fiche','reference.png',300,'image/png');await upload(file);
      let created=(await saveFiche(draft({name:'Created with file',published:false}),[file.id])).fiche;
      assert.deepEqual(created.attachments,[file]);assert.equal(created.published,false);
      await as(3);assert.ok(!(await paths()).includes(file.path));await denied(()=>saveFiche(draft(),[],created.id,created.version));
      await as(1);
      created=(await saveFiche(draft({name:created.name,published:true}),[file.id],created.id,created.version)).fiche;
      await as(4);assert.ok((await paths()).includes(file.path));
      await as(1);
      await denied(()=>saveFiche(draft({name:created.name}),[],created.id,1),'40001');
      assert.deepEqual((await get(created.id)).fiche.attachments,[file]);
      created=(await saveFiche(draft({name:created.name}),[],created.id,created.version)).fiche;
      assert.deepEqual(created.attachments,[]);assert.ok(!(await paths()).includes(file.path));
      const failedFile=await prepare(null,'fiche');
      const countBefore=await admin(async()=>Number((await db.query('select count(*) as count from compendium.fiches')).rows[0].count));
      await denied(()=>saveFiche(draft({name:'Rolled back creation'}),[failedFile.id]),'22023');
      assert.equal(await admin(async()=>Number((await db.query('select count(*) as count from compendium.fiches')).rows[0].count)),countBefore);
    });

    await t.test('discard is owner-only/idempotent and cleans pending Storage without permitting a later save',async()=>{
      await as(3);const file=await prepare(place.id);await upload(file);
      for(const user of [4,1,2]){await as(user);await denied(()=>discard(file.id));}
      await as(3);await denied(()=>discard(file.id,otherCampaign));
      assert.deepEqual(await discard(file.id),{discarded:true});assert.deepEqual(await discard(file.id),{discarded:true});
      await denied(()=>saveNote(place.id,'Discarded object',[file.id]));
      await denied(()=>upload(file));
      assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,file.path])).rows.length,1);
      assert.ok(!(await paths()).includes(file.path));
    });

    await t.test('deleted messages hide their files from everyone and retain an immutable trace',async()=>{
      await as(3);
      const file=note.attachments[0];
      const result=await rpc('cm_delete_annotation',[campaign,place.id,note.id,note.version],['uuid','uuid','uuid','integer']);
      const trace=result.annotations.find(x=>x.id===note.id);
      assert.deepEqual(trace.attachments,[]);assert.equal(trace.body,'Message supprimé par l’utilisateur.');assert.equal(trace.canEdit,false);
      for(const user of [1,3,4]){await as(user);assert.ok(!(await paths()).includes(file.path));assert.deepEqual((await get(place.id)).annotations.find(x=>x.id===note.id).attachments,[]);}
      await as(3);await denied(()=>saveNote(place.id,'Restore deleted message',[file.id],note.id,trace.version));
    });

    await t.test('withdrawal, deletion and removed membership revoke download and reservation access immediately',async()=>{
      await as(3);const file=await prepare(otherPlace.id);await upload(file);
      await saveNote(otherPlace.id,'Visible before withdrawal',[file.id]);
      await as(1);
      let changed=(await oldSave(draft({name:otherPlace.name,published:false}),otherPlace.id,otherPlace.version)).fiche;
      await as(3);assert.ok(!(await paths()).includes(file.path));await denied(()=>prepare(changed.id));
      await denied(()=>saveNote(changed.id,'Hidden write',[file.id]));
      await as(1);assert.ok((await paths()).includes(file.path));
      changed=(await rpc('cm_delete_fiche',[campaign,changed.id,changed.version],['uuid','uuid','integer'])).fiche;
      assert.deepEqual(changed.attachments,[]);assert.ok(!(await paths()).includes(file.path));
      await denied(()=>prepare(changed.id,'fiche'));await denied(()=>saveNote(changed.id,'Deleted write',[file.id]));
      await as(4);assert.ok((await paths()).includes(pending.path));
      await admin(()=>db.query('delete from public.room_members where user_id=$1',['00000000-0000-0000-0000-000000000004']));
      assert.ok(!(await paths()).includes(pending.path));await denied(()=>prepare(place.id));
    });

    await t.test('script reruns preserve files and old RPCs remain usable without attachment arguments',async()=>{
      await as(1);
      const before=await admin(()=>db.query('select id,path,linked,removed_at from compendium.attachments order by id'));
      await admin(()=>db.exec(script));
      const after=await admin(()=>db.query('select id,path,linked,removed_at from compendium.attachments order by id'));
      assert.deepEqual(after.rows,before.rows);
      place=(await oldSave(draft({name:place.name,description:'Legacy edit'}),place.id,place.version)).fiche;
      assert.equal(place.description,'Legacy edit');assert.ok(Array.isArray(place.attachments));
      await as(3);
      const result=await rpc('cm_save_annotation',[campaign,place.id,null,null,'Legacy message'],['uuid','uuid','uuid','integer','text']);
      assert.deepEqual(result.annotations.find(x=>x.body==='Legacy message').attachments,[]);
    });
  }finally{await db.close();}
});
