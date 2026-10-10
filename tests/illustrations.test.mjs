import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const campaign='10000000-0000-0000-0000-000000000001';
const foreignCampaign='10000000-0000-0000-0000-000000000002';
const missing='90000000-0000-0000-0000-000000000001';
const bucket='compendium-images';
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const draft=(overrides={})=>({type:'place',name:'Synthetic place',subtitle:'Synthetic subtitle',location:'Synthetic location',summary:'Synthetic summary',description:'Synthetic revealed information',published:true,...overrides});

async function install(db,attachments){
  for(const file of ['fixtures/security.sql','fixtures/storage.sql','../supabase/schema.sql','../supabase/images.sql','../supabase/deletion.sql','../supabase/annotations.sql','../supabase/lore-types.sql']){
    await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  }
  await db.exec('alter table storage.objects add column metadata jsonb; create unique index storage_object_path on storage.objects(bucket_id,name);');
  if(attachments)await db.exec(await readFile(new URL('../supabase/attachments.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/illustrations.sql',import.meta.url),'utf8'));
}

function helpers(db){
  let currentUser;
  async function as(user){
    currentUser=user;await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?uid(user):'']);
    await db.exec(`set role ${user?'authenticated':'anon'}`);
  }
  async function admin(operation){const user=currentUser;await db.exec('reset role');try{return await operation();}finally{await as(user);}}
  async function rpc(name,args,casts){
    const parameters=args.map((_,i)=>`$${i+1}::${casts[i]}`).join(',');
    return (await db.query(`select public.${name}(${parameters}) as result`,args)).rows[0].result;
  }
  const denied=(operation,code='42501')=>assert.rejects(operation,error=>{assert.equal(error.code,code,error.message);return true;});
  const save=(value,id=null,version=null,c=campaign)=>rpc('cm_save_fiche',[c,id,version,JSON.stringify(value)],['uuid','uuid','integer','jsonb']);
  const get=(id,c=campaign)=>rpc('cm_get_fiche',[c,id],['uuid','uuid']);
  const saveWithFiles=(value,ids,id=null,version=null,c=campaign)=>rpc('cm_save_fiche_with_attachments',[c,id,version,JSON.stringify(value),ids],['uuid','uuid','integer','jsonb','uuid[]']);
  const uploadImage=path=>admin(()=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[bucket,path,JSON.stringify({size:100,mimetype:'image/jpeg'})]));
  const visibleImages=async()=> (await db.query('select name from storage.objects where bucket_id=$1 order by name',[bucket])).rows.map(row=>row.name);
  return {as,admin,rpc,denied,save,get,saveWithFiles,uploadImage,visibleImages};
}

test('MJ illustration edits preserve lore, permissions, versions and private attachments',async t=>{
  const db=new PGlite();
  try{
    await install(db,true);
    const {as,admin,rpc,denied,save,get,saveWithFiles,uploadImage,visibleImages}=helpers(db);
    const originalPath=`${campaign}_${missing}.jpg`;
    const replacementPath=`${campaign}/illustrations/replacement.jpg`;
    const foreignPath=`${foreignCampaign}_${missing}.jpg`;
    const misleadingPath=`${campaign}_legacy-foreign-reference.jpg`;
    await as(1);
    for(const path of [originalPath,replacementPath,foreignPath,misleadingPath])await uploadImage(path);
    let fiche=(await save(draft({imagePath:originalPath}))).fiche;
    const second=(await save(draft({name:'Second synthetic place',published:false}))).fiche;
    await as(2);
    const foreign=(await save(draft({name:'Foreign synthetic place',imagePath:foreignPath}),null,null,foreignCampaign)).fiche;
    const misleading=(await save(draft({name:'Legacy inconsistent association'}),null,null,foreignCampaign)).fiche;
    await admin(()=>db.query('update compendium.fiches set image_path=$1 where campaign_id=$2 and id=$3',[misleadingPath,foreignCampaign,misleading.id]));
    await as(3);
    const note=(await rpc('cm_save_annotation',[campaign,fiche.id,null,null,'Group note that must remain intact'],['uuid','uuid','uuid','integer','text'])).annotations[0];

    await t.test('anonymous users, players, forged MJ metadata and another campaign MJ cannot change illustrations',async()=>{
      for(const user of [null,3,4,5,6,7,2]){
        await as(user);
        await denied(()=>save(draft({imagePath:replacementPath}),fiche.id,fiche.version));
        await denied(()=>save(draft({imagePath:'images/lieux/synthetic-place.jpg'}),fiche.id,fiche.version));
        await denied(()=>saveWithFiles(draft({imagePath:null}),[],fiche.id,fiche.version));
      }
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await denied(()=>save(draft({imagePath:replacementPath}),fiche.id,fiche.version));
      await as(1);
      assert.equal((await get(fiche.id)).fiche.imagePath,originalPath);
    });

    await t.test('save RPC grants remain narrow and the images bucket stays private and read-only to the browser',async()=>{
      await admin(async()=>{
        for(const role of ['anon','authenticated']){
          assert.equal((await db.query("select has_function_privilege($1,'public.cm_save_fiche(uuid,uuid,integer,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,role==='authenticated');
          for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query("select has_table_privilege($1,'compendium.fiches',$2) as allowed",[role,privilege])).rows[0].allowed,false);
        }
        const fn=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.cm_save_fiche(uuid,uuid,integer,jsonb)'::regprocedure")).rows[0];
        assert.equal(fn.prosecdef,true);assert.ok(fn.proconfig.includes('search_path=""'));
        assert.equal((await db.query('select public from storage.buckets where id=$1',[bucket])).rows[0].public,false);
      });
      await denied(()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,`${campaign}_client-upload.jpg`]));
      assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,originalPath])).affectedRows,0);
      await denied(()=>db.query('update storage.objects set name=$1 where bucket_id=$2',[`${campaign}_overwrite.jpg`,bucket]));
    });

    await t.test('the MJ changes the association and all official fields in one versioned save',async()=>{
      const changed=draft({type:'history',name:'Changed synthetic lore',subtitle:'Changed subtitle',location:'Changed location',summary:'Changed summary',description:'Changed revealed information',imagePath:`  ${replacementPath}  `});
      const result=await save(changed,fiche.id,fiche.version);
      assert.equal(result.fiche.id,fiche.id);
      assert.equal(result.fiche.version,fiche.version+1);
      assert.equal(result.fiche.imagePath,replacementPath);
      for(const key of ['type','name','subtitle','location','summary','description','published'])assert.equal(result.fiche[key],changed[key]);
      assert.equal(result.fiche.annotationCount,1);
      assert.deepEqual(result.fiche.attachments,[]);
      assert.equal((await get(fiche.id)).annotations[0].id,note.id);
      fiche=result.fiche;
    });

    await t.test('replacement revokes the old image association without deleting either Storage object',async()=>{
      for(const user of [1,3,4]){
        await as(user);
        const visible=await visibleImages();
        assert.ok(visible.includes(replacementPath));
        assert.ok(!visible.includes(originalPath));
        assert.ok(!visible.includes(foreignPath));
        assert.ok(!visible.includes(misleadingPath));
      }
      await admin(async()=>{
        assert.equal((await db.query('select count(*)::int as n from storage.objects where bucket_id=$1 and name=any($2::text[])',[bucket,[originalPath,replacementPath]])).rows[0].n,2);
      });
      await as(1);
    });

    await t.test('an old client omitting imagePath retains the current association and group notes',async()=>{
      fiche=(await save(draft({type:fiche.type,name:fiche.name}),fiche.id,fiche.version)).fiche;
      assert.equal(fiche.imagePath,replacementPath);
      const result=await get(fiche.id);
      assert.equal(result.annotations[0].body,note.body);
      assert.equal(result.annotations[0].version,note.version);
    });

    await t.test('explicit null, empty and whitespace paths remove the association without removing the file',async()=>{
      for(const imagePath of [null,'','   ']){
        fiche=(await save(draft({imagePath:originalPath}),fiche.id,fiche.version)).fiche;
        fiche=(await save(draft({imagePath}),fiche.id,fiche.version)).fiche;
        assert.equal(fiche.imagePath,null);
        assert.equal(fiche.annotationCount,1);
        await as(3);assert.deepEqual(await visibleImages(),[]);
        await as(1);
        assert.equal((await get(fiche.id)).annotations[0].id,note.id);
        await admin(async()=>assert.equal((await db.query('select count(*)::int as n from storage.objects where bucket_id=$1 and name=$2',[bucket,originalPath])).rows[0].n,1));
      }
    });

    await t.test('malformed JSON values, external URLs, traversal and ambiguous keys are refused atomically',async()=>{
      const before=(await get(fiche.id)).fiche;
      const invalid=[0,false,{},[],['x'],'https://example.invalid/image.jpg','javascript:alert(1)','data:image/jpeg;base64,abc','//example.invalid/image.jpg','public/images/local.jpg',`/${campaign}/image.jpg`,`${campaign}wrong/image.jpg`,`${campaign}/../foreign.jpg`,`${campaign}/nested/../../foreign.jpg`,`${campaign}/./image.jpg`,`${campaign}//image.jpg`,`${campaign}/image.jpg/`,`${campaign}\\image.jpg`,`${campaign}_back\\slash.jpg`,`${campaign}/%2e%2e/foreign.jpg`,`${campaign}/image%2f.jpg`,`${campaign}/image.jpg?download=1`,`${campaign}/image.jpg#fragment`,`${campaign}_https://example.invalid/image.jpg`,`${campaign}/line\nfeed.jpg`,`${campaign}/${'x'.repeat(513)}.jpg`];
      for(const imagePath of invalid){
        await denied(()=>save(draft({name:'Must not replace the current name',imagePath}),fiche.id,fiche.version),'22023');
        assert.deepEqual((await get(fiche.id)).fiche,before);
      }
    });

    await t.test('objects must already exist in compendium-images and use the owning campaigns namespace',async()=>{
      const missingPath=`${campaign}_missing.jpg`;
      const wrongBucketPath=`${campaign}/wrong-bucket.jpg`;
      await admin(()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['other-bucket',wrongBucketPath]));
      for(const path of [missingPath,wrongBucketPath,foreignPath]){
        await denied(()=>save(draft({imagePath:path}),fiche.id,fiche.version),'22023');
      }
      assert.equal((await get(fiche.id)).fiche.imagePath,null);
    });

    await t.test('a misleading own-prefix path associated to another campaign cannot expose that campaigns image',async()=>{
      await denied(()=>save(draft({imagePath:misleadingPath}),fiche.id,fiche.version));
      await as(2);
      await rpc('cm_delete_fiche',[foreignCampaign,misleading.id,misleading.version],['uuid','uuid','integer']);
      await as(1);
      await denied(()=>save(draft({imagePath:misleadingPath}),fiche.id,fiche.version));
      await as(3);
      assert.ok(!(await visibleImages()).includes(misleadingPath));
      await as(1);
    });

    await t.test('missing and stale versions cannot change, detach or overwrite newer illustration edits',async()=>{
      const previousVersion=fiche.version;
      fiche=(await save(draft({imagePath:replacementPath}),fiche.id,fiche.version)).fiche;
      const expected=fiche;
      for(const version of [null,0,previousVersion,fiche.version+1]){
        for(const imagePath of [null,originalPath])await denied(()=>save(draft({imagePath}),fiche.id,version),'40001');
      }
      await denied(()=>saveWithFiles(draft({imagePath:null}),[],fiche.id,previousVersion),'40001');
      assert.deepEqual((await get(fiche.id)).fiche,expected);
    });

    await t.test('public JPEG paths in every lore folder save without Storage objects and preserve the complete thread',async()=>{
      const storageCount=await admin(async()=>(await db.query('select count(*)::int as n from storage.objects')).rows[0].n);
      const folders={place:'lieux',npc:'pnj',faction:'factions',cosmogony:'cosmogonie',history:'histoire',culture:'cultures',knowledge:'savoirs'};
      for(const [type,folder] of Object.entries(folders)){
        const path=`images/${folder}/Synthetic-42_v1.2.jpg`;
        const created=(await save(draft({type,name:`Public image ${type}`,published:false,imagePath:path}))).fiche;
        assert.equal(created.imagePath,path);assert.equal(created.type,type);assert.equal(created.published,false);
        assert.equal(created.version,1);assert.deepEqual(created.attachments,[]);
        await as(3);await denied(()=>get(created.id));await as(1);
      }
      const publicPath='images/lieux/synthetic-place.jpg';
      const previousVersion=fiche.version;
      fiche=(await save(draft({imagePath:`  ${publicPath}  `}),fiche.id,fiche.version)).fiche;
      assert.equal(fiche.imagePath,publicPath);assert.equal(fiche.version,previousVersion+1);
      assert.equal(fiche.annotationCount,1);assert.equal((await get(fiche.id)).annotations[0].body,note.body);
      await denied(()=>save(draft({imagePath:'images/pnj/stale.jpg'}),fiche.id,previousVersion),'40001');
      fiche=(await save(draft({name:'Old client preserves public image'}),fiche.id,fiche.version)).fiche;
      assert.equal(fiche.imagePath,publicPath);
      assert.equal(await admin(async()=>(await db.query('select count(*)::int as n from storage.objects')).rows[0].n),storageCount);
      await as(3);
      assert.equal((await get(fiche.id)).fiche.imagePath,publicPath);
      assert.ok(!(await visibleImages()).includes(replacementPath),'The previous private key loses its association');
      await as(1);
    });

    await t.test('public assets can be reused without changing private campaign permissions',async()=>{
      const publicPath='images/lieux/shared-public.jpg';
      await as(2);
      const saved=(await save(draft({name:foreign.name,imagePath:publicPath}),foreign.id,foreign.version,foreignCampaign)).fiche;
      assert.equal(saved.imagePath,publicPath);
      await as(1);
      fiche=(await save(draft({imagePath:publicPath}),fiche.id,fiche.version)).fiche;
      assert.equal(fiche.imagePath,publicPath);
      await denied(()=>get(foreign.id,foreignCampaign));
      await denied(()=>save(draft({imagePath:foreignPath}),fiche.id,fiche.version),'22023');
      assert.equal((await get(fiche.id)).annotations[0].id,note.id);
    });

    await t.test('public paths reject traversal, external targets, encoding, unsupported folders and non-ASCII names atomically',async()=>{
      const before=(await get(fiche.id)).fiche;
      const invalid=[
        'images/lieux/../secret.jpg','images/../lieux/image.jpg','images/lieux/./image.jpg',
        'images/lieux/nested/../../secret.jpg','images//lieux/image.jpg','images/lieux//image.jpg',
        'images/lieux/image.jpg/','images/lieux/nested/image.jpg','/images/lieux/image.jpg',
        'https://example.invalid/images/lieux/image.jpg','images/lieux/https://example.invalid/image.jpg',
        'images/lieux/image%2e.jpg','images/lieux/%2e%2e/image.jpg','images/lieux/%252e%252e/image.jpg',
        'images/lieux/image%2Fsecret.jpg','images/lieux/image\\secret.jpg','images\\lieux\\image.jpg',
        'images/lieux/image.jpg?download=1','images/lieux/image.jpg#fragment','images/lieux/image\n.jpg',
        'images/lieux/image\t.jpg','images/lieux/image\u0001.jpg','images/lieux/église.jpg',
        'images/lieux/image avec espaces.jpg','images/lieux/image\u202e.jpg','images/lieux/.hidden.jpg',
        'images/autre/image.jpg','images/Lieux/image.jpg','images/lieux/image.png','images/lieux/image.svg',
        'images/lieux/image.jpeg','images/lieux/image.JPG','images/lieux/image.jpg.exe',
        `images/lieux/${'x'.repeat(512)}.jpg`,
      ];
      for(const imagePath of invalid){
        await denied(()=>save(draft({name:'Must not replace lore',imagePath}),fiche.id,fiche.version),'22023');
        assert.deepEqual((await get(fiche.id)).fiche,before);
      }
    });

    await t.test('all seven lore categories accept an illustration on creation and retain it when reclassified',async()=>{
      for(const type of ['place','npc','faction','cosmogony','history','culture','knowledge']){
        const path=`${campaign}_category-${type}.jpg`;
        await uploadImage(path);
        let created=(await save(draft({type,name:`Synthetic ${type}`,published:false,imagePath:path}))).fiche;
        assert.equal(created.type,type);assert.equal(created.imagePath,path);assert.equal(created.version,1);
        created=(await save(draft({type:'knowledge',name:created.name,published:false}),created.id,created.version)).fiche;
        assert.equal(created.type,'knowledge');assert.equal(created.imagePath,path);assert.equal(created.published,false);
      }
      const created=(await save(draft({name:'No illustration'}))).fiche;
      assert.equal(created.imagePath,null);
    });

    let attachment;
    await t.test('the attachment wrapper links files and illustration changes together without losing any field or note',async()=>{
      attachment=await rpc('cm_prepare_attachment',[campaign,fiche.id,'fiche','source.txt',100,'text/plain'],['uuid','uuid','text','text','integer','text']);
      await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',['compendium-attachments',attachment.path,JSON.stringify({size:100,mimetype:'text/plain'})]);
      fiche=(await saveWithFiles(draft({type:'culture',imagePath:originalPath}),[attachment.id],fiche.id,fiche.version)).fiche;
      assert.equal(fiche.type,'culture');assert.equal(fiche.imagePath,originalPath);
      assert.deepEqual(fiche.attachments,[attachment]);assert.equal(fiche.annotationCount,1);
      fiche=(await saveWithFiles(draft({type:'culture',imagePath:replacementPath}),[attachment.id],fiche.id,fiche.version)).fiche;
      assert.deepEqual(fiche.attachments,[attachment]);assert.equal(fiche.imagePath,replacementPath);
      fiche=(await saveWithFiles(draft({type:'culture',imagePath:'images/cultures/attached-entry.jpg'}),[attachment.id],fiche.id,fiche.version)).fiche;
      assert.deepEqual(fiche.attachments,[attachment]);assert.equal(fiche.imagePath,'images/cultures/attached-entry.jpg');
      fiche=(await save(draft({type:'culture',imagePath:null}),fiche.id,fiche.version)).fiche;
      assert.deepEqual(fiche.attachments,[attachment]);assert.equal(fiche.imagePath,null);
      assert.equal((await get(fiche.id)).annotations[0].body,note.body);
    });

    await t.test('an invalid attachment rolls back the illustration change, all text fields and the version',async()=>{
      const before=(await get(fiche.id)).fiche;
      await denied(()=>saveWithFiles(draft({name:'Must roll back',imagePath:originalPath}),[missing],fiche.id,fiche.version));
      assert.deepEqual((await get(fiche.id)).fiche,before);
      await denied(()=>saveWithFiles(draft({name:'Must roll back public image',imagePath:'images/lieux/rolled-back.jpg'}),[missing],fiche.id,fiche.version));
      assert.deepEqual((await get(fiche.id)).fiche,before);
      await denied(()=>saveWithFiles(draft({imagePath:`${campaign}_missing.jpg`}),[],fiche.id,fiche.version),'22023');
      assert.deepEqual((await get(fiche.id)).fiche,before);
    });

    await t.test('image permissions still follow publication and recoverable fiche deletion',async()=>{
      fiche=(await saveWithFiles(draft({imagePath:originalPath,published:false}),[attachment.id],fiche.id,fiche.version)).fiche;
      await as(3);assert.ok(!(await visibleImages()).includes(originalPath));await denied(()=>get(fiche.id));
      await as(1);assert.ok((await visibleImages()).includes(originalPath));
      fiche=(await saveWithFiles(draft({imagePath:originalPath,published:true}),[attachment.id],fiche.id,fiche.version)).fiche;
      await as(3);assert.ok((await visibleImages()).includes(originalPath));
      await as(1);
      const deleted=(await rpc('cm_delete_fiche',[campaign,fiche.id,fiche.version],['uuid','uuid','integer'])).fiche;
      await denied(()=>save(draft({imagePath:replacementPath}),deleted.id,deleted.version));
      await denied(()=>saveWithFiles(draft({imagePath:null}),[],deleted.id,deleted.version));
      assert.ok(!(await visibleImages()).includes(originalPath));
      await as(3);assert.ok(!(await visibleImages()).includes(originalPath));
      await as(1);
      fiche=(await rpc('cm_restore_fiche',[campaign,deleted.id,deleted.version],['uuid','uuid','integer'])).fiche;
      assert.equal(fiche.imagePath,originalPath);assert.equal(fiche.published,false);
      assert.deepEqual(fiche.attachments,[attachment]);
      assert.equal((await get(fiche.id)).annotations[0].id,note.id);
    });

    await t.test('unknown or cross-campaign fiche IDs remain unavailable and rerunning the supplement preserves associations',async()=>{
      await denied(()=>save(draft({imagePath:originalPath}),missing,1));
      await denied(()=>save(draft({imagePath:originalPath}),foreign.id,foreign.version));
      await denied(()=>save(draft({imagePath:originalPath}),second.id,second.version,foreignCampaign));
      const before=(await get(fiche.id)).fiche;
      await admin(()=>db.exec(readIllustrations));
      assert.deepEqual((await get(fiche.id)).fiche,before);
    });
  }finally{await db.close();}
});

const readIllustrations=await readFile(new URL('../supabase/illustrations.sql',import.meta.url),'utf8');

test('Illustration edits also work on an existing installation without optional attachments RPCs',async()=>{
  const db=new PGlite();
  try{
    await install(db,false);
    const {as,save,uploadImage,get}=helpers(db);
    await as(1);
    const first=`${campaign}_first.jpg`,second=`${campaign}_second.jpg`;
    await uploadImage(first);await uploadImage(second);
    let fiche=(await save(draft({type:'cosmogony',imagePath:first}))).fiche;
    assert.equal(fiche.imagePath,first);
    assert.equal('attachments' in fiche,false);
    fiche=(await save(draft({type:'cosmogony',imagePath:second}),fiche.id,fiche.version)).fiche;
    assert.equal(fiche.imagePath,second);
    fiche=(await save(draft({type:'cosmogony'}),fiche.id,fiche.version)).fiche;
    assert.equal(fiche.imagePath,second);
    fiche=(await save(draft({type:'cosmogony',imagePath:''}),fiche.id,fiche.version)).fiche;
    assert.equal((await get(fiche.id)).fiche.imagePath,null);
    fiche=(await save(draft({type:'cosmogony',imagePath:'images/cosmogonie/example.jpg'}),fiche.id,fiche.version)).fiche;
    assert.equal((await get(fiche.id)).fiche.imagePath,'images/cosmogonie/example.jpg');
  }finally{await db.close();}
});
