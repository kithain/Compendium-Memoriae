import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ids = {
  gmA: '00000000-0000-0000-0000-000000000001',
  gmB: '00000000-0000-0000-0000-000000000002',
  playerA: '00000000-0000-0000-0000-000000000003',
  playerB: '00000000-0000-0000-0000-000000000004',
  outsider: '00000000-0000-0000-0000-000000000005',
  otherPlayer: '00000000-0000-0000-0000-000000000006',
  ownerWithoutRole: '00000000-0000-0000-0000-000000000007',
  campaignA: '10000000-0000-0000-0000-000000000001',
  campaignB: '10000000-0000-0000-0000-000000000002',
  campaignC: '10000000-0000-0000-0000-000000000003',
  missing: '90000000-0000-0000-0000-000000000001',
};

test('PostgreSQL authorization for shared campaign archives', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/security.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));

    async function as(user) {
      await db.exec('reset role;');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
      await db.exec(`set role ${user ? 'authenticated' : 'anon'};`);
    }
    async function rpc(name, args = [], casts = []) {
      assert.match(name, /^cm_[a-z_]+$/);
      const parameters = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ''}`).join(', ');
      const { rows } = await db.query(`select public.${name}(${parameters}) as result`, args);
      return rows[0].result;
    }
    async function denied(operation, code = '42501') {
      await assert.rejects(operation, (error) => {
        assert.equal(error.code, code, `Expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
        return true;
      });
    }

    await t.test('anonymous callers cannot execute any archive RPC', async () => {
      await as(null);
      await denied(() => rpc('cm_context', ['AAAA'], ['text']));
      await denied(() => rpc('cm_list_fiches', [ids.campaignA], ['uuid']));
      await denied(() => rpc('cm_get_fiche', [ids.campaignA, ids.missing], ['uuid', 'uuid']));
      await denied(() => rpc('cm_save_fiche', [ids.campaignA, null, null, '{}'], ['uuid', 'uuid', 'integer', 'jsonb']));
      await denied(() => rpc('cm_save_annotation', [ids.campaignA, ids.missing, null, null, 'Intrusion'], ['uuid', 'uuid', 'uuid', 'integer', 'text']));
      await denied(() => rpc('cm_import_fiches', [ids.campaignA, '[]'], ['uuid', 'jsonb']));
    });

    await t.test('private tables and helpers have no browser-role privileges', async () => {
      await db.exec('reset role;');
      const { rows: tables } = await db.query("select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='compendium' and c.relkind in ('r','p','v','m','S')");
      assert.ok(tables.length > 0, 'The archive owns private storage');
      for (const role of ['anon', 'authenticated']) {
        for (const table of tables) {
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            const result = await db.query('select has_table_privilege($1, $2::oid, $3) as allowed', [role, table.oid, privilege]);
            assert.equal(result.rows[0].allowed, false, `${role} must not ${privilege} ${table.relname}`);
          }
        }
        const { rows: helpers } = await db.query("select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='compendium'");
        for (const helper of helpers) {
          const result = await db.query('select has_function_privilege($1, $2::oid, \'EXECUTE\') as allowed', [role, helper.oid]);
          assert.equal(result.rows[0].allowed, false, `${role} must not execute private helper ${helper.proname}`);
        }
      }
      await as(ids.playerA);
      await denied(() => db.query('select * from compendium.fiches'));
    });

    await t.test('a forged MJ display name or metadata does not grant access', async () => {
      await as(ids.outsider);
      await denied(() => rpc('cm_context', ['AAAA'], ['text']));
      await denied(() => rpc('cm_list_fiches', [ids.campaignA], ['uuid']));
      await denied(() => rpc('cm_get_fiche', [ids.campaignA, ids.missing], ['uuid', 'uuid']));
      await denied(() => rpc('cm_save_fiche', [ids.campaignA, null, null, '{}'], ['uuid', 'uuid', 'integer', 'jsonb']));
      await denied(() => rpc('cm_save_annotation', [ids.campaignA, ids.missing, null, null, 'Intrusion'], ['uuid', 'uuid', 'uuid', 'integer', 'text']));
      await denied(() => rpc('cm_import_fiches', [ids.campaignA, '[]'], ['uuid', 'jsonb']));
    });

    await t.test('campaign context recognizes owner plus explicit MJ role', async () => {
      await as(ids.gmA);
      const gm = await rpc('cm_context', ['AAAA'], ['text']);
      assert.equal(gm.campaignId, ids.campaignA);
      assert.equal(gm.isGM, true, 'A real MJ need not also be a room member');
      assert.deepEqual(await rpc('cm_context', [' aaaa '], ['text']), gm,
        'Room codes accept lowercase and surrounding whitespace');
      await as(ids.playerA);
      const player = await rpc('cm_context', ['AAAA'], ['text']);
      assert.equal(player.campaignId, ids.campaignA);
      assert.equal(player.isGM, false, 'User metadata is not an authorization source');
      assert.equal(player.userName, 'Joueur A vérifié', 'Names come from server membership, not user metadata');
      await as(ids.playerB);
      const nextSession = await rpc('cm_context', ['AAAB'], ['text']);
      assert.equal(nextSession.campaignId, ids.campaignA);
      assert.equal(nextSession.isGM, false);
      await as(ids.ownerWithoutRole);
      const fakeOwner = await rpc('cm_context', ['CCCC'], ['text']);
      assert.equal(fakeOwner.isGM, false, 'Owning a room/campaign alone is not the MJ role');
      await as(ids.gmB);
      await denied(() => rpc('cm_context', ['AAAA'], ['text']));
    });

    const ficheData = (overrides = {}) => ({
      type: 'place', name: 'Lieu synthétique', subtitle: 'Repère de test', location: 'Région de test',
      summary: 'Présentation synthétique pour les joueurs.',
      description: 'Une description uniquement utilisée dans PostgreSQL en mémoire.',
      published: true, ...overrides,
    });
    const saveFiche = (campaign, id, version, value) => rpc('cm_save_fiche',
      [campaign, id, version, JSON.stringify(value)], ['uuid', 'uuid', 'integer', 'jsonb']);
    const list = (campaign = ids.campaignA) => rpc('cm_list_fiches', [campaign], ['uuid']);
    const get = (id, campaign = ids.campaignA) => rpc('cm_get_fiche', [campaign, id], ['uuid', 'uuid']);
    const annotate = (fiche, id, version, body, campaign = ids.campaignA) => rpc('cm_save_annotation',
      [campaign, fiche, id, version, body], ['uuid', 'uuid', 'uuid', 'integer', 'text']);
    const importFiches = (values, campaign = ids.campaignA) => rpc('cm_import_fiches',
      [campaign, JSON.stringify(values)], ['uuid', 'jsonb']);
    let published, hidden, anotherPublic, foreignFiche, playerNote;

    await t.test('MJ creates published and private records; players receive only published data', async () => {
      await as(ids.gmA);
      published = (await saveFiche(ids.campaignA, null, null, ficheData())).fiche;
      hidden = (await saveFiche(ids.campaignA, null, null,
        ficheData({ type: 'npc', name: 'PNJ privé synthétique', summary: 'SECRET SYNTHÉTIQUE', published: false }))).fiche;
      anotherPublic = (await saveFiche(ids.campaignA, null, null,
        ficheData({ name: 'Second lieu synthétique' }))).fiche;
      assert.equal(published.version, 1);
      assert.equal(hidden.version, 1);
      assert.equal((await list()).fiches.length, 3);
      assert.equal((await get(hidden.id)).fiche.summary, 'SECRET SYNTHÉTIQUE');
      await annotate(hidden.id, null, null, 'Annotation synthétique réservée au MJ');

      await as(ids.playerA);
      const visible = await list();
      assert.deepEqual(visible.fiches.map(f => f.id).sort(), [published.id, anotherPublic.id].sort());
      assert.ok(!JSON.stringify(visible).includes('SECRET SYNTHÉTIQUE'));
      assert.ok(!JSON.stringify(visible).includes(hidden.id));
      await denied(() => get(hidden.id));
      await denied(() => annotate(hidden.id, null, null, 'UUID privé deviné'));
      await denied(() => saveFiche(ids.campaignA, published.id, 1, ficheData({ name: 'Usurpation PJ' })));
      await denied(() => saveFiche(ids.campaignA, null, null, ficheData()));
      await denied(() => importFiches([]));

      await as(ids.playerB);
      assert.equal((await list()).fiches.length, 2, 'Another session of the same campaign shares published archives');
      await as(ids.ownerWithoutRole);
      await denied(() => saveFiche(ids.campaignC, null, null, ficheData()));
      await denied(() => importFiches([], ids.campaignC));
    });

    await t.test('the MJ role and UUIDs do not cross campaign boundaries', async () => {
      await as(ids.gmB);
      foreignFiche = (await saveFiche(ids.campaignB, null, null, ficheData({ name: 'Autre campagne privée', published: false }))).fiche;
      await denied(() => list(ids.campaignA));
      await denied(() => get(published.id, ids.campaignA));
      await denied(() => saveFiche(ids.campaignA, published.id, 1, ficheData()));
      await denied(() => importFiches([], ids.campaignA));
      await as(ids.otherPlayer);
      await denied(() => list(ids.campaignA));
      await denied(() => get(published.id, ids.campaignA));
      await denied(() => annotate(published.id, null, null, 'Autre campagne'));
      await as(ids.gmA);
      await denied(() => get(foreignFiche.id));
      await denied(() => saveFiche(ids.campaignA, foreignFiche.id, 1, ficheData()));
      await denied(() => annotate(foreignFiche.id, null, null, 'Fiche extérieure'));
      assert.equal((await get(published.id)).fiche.name, published.name);
    });

    await t.test('annotations use the authenticated author and only that author can edit', async () => {
      await as(ids.playerA);
      const added = await annotate(published.id, null, null, '  Note synthétique du PJ A  ');
      playerNote = added.annotations.find(a => a.body === 'Note synthétique du PJ A');
      assert.ok(playerNote);
      assert.equal(playerNote.author, 'Joueur A vérifié');
      assert.equal(playerNote.canEdit, true);
      assert.equal(playerNote.version, 1);
      assert.equal((await get(published.id)).fiche.annotationCount, 1);
      await as(ids.playerB);
      const viewed = await get(published.id);
      assert.equal(viewed.annotations.find(a => a.id === playerNote.id).canEdit, false);
      await denied(() => annotate(published.id, playerNote.id, 1, 'Usurpation par PJ B'));
      await annotate(published.id, null, null, 'Contribution du PJ B');
      await denied(() => annotate(anotherPublic.id, playerNote.id, 1, 'Déplacement vers autre fiche'));
      await as(ids.gmA);
      assert.equal((await get(published.id)).annotations.find(a => a.id === playerNote.id).canEdit, false);
      await denied(() => annotate(published.id, playerNote.id, 1, 'Même le MJ ne réécrit pas un autre auteur'));
      await as(ids.playerA);
      assert.equal((await get(published.id)).annotations.find(a => a.id === playerNote.id).body, playerNote.body);
    });

    await t.test('stale annotation writes fail without replacing the successful version', async () => {
      await as(ids.playerA);
      const saved = await annotate(published.id, playerNote.id, 1, 'Version corrigée du PJ A');
      const current = saved.annotations.find(a => a.id === playerNote.id);
      assert.equal(current.version, 2);
      assert.equal(current.body, 'Version corrigée du PJ A');
      await denied(() => annotate(published.id, playerNote.id, 1, 'Ancien onglet concurrent'), '40001');
      await denied(() => annotate(published.id, playerNote.id, null, 'Révision manquante'), '40001');
      const after = (await get(published.id)).annotations.find(a => a.id === playerNote.id);
      assert.equal(after.body, current.body);
      assert.equal(after.version, 2);
      assert.equal(after.author, 'Joueur A vérifié');
    });

    await t.test('stale fiche writes and duplicate submissions preserve the newer version', async () => {
      await as(ids.gmA);
      const changed = (await saveFiche(ids.campaignA, published.id, 1,
        ficheData({ name: 'Lieu corrigé par le MJ' }))).fiche;
      assert.equal(changed.version, 2);
      assert.equal(changed.id, published.id);
      await denied(() => saveFiche(ids.campaignA, published.id, 1,
        ficheData({ name: 'Ancien texte' })), '40001');
      await denied(() => saveFiche(ids.campaignA, published.id, null, ficheData()), '40001');
      assert.equal((await get(published.id)).fiche.name, changed.name);
      assert.equal((await get(published.id)).fiche.version, 2);
    });

    await t.test('unpublishing hides the page and its existing annotations immediately', async () => {
      await as(ids.gmA);
      published = (await saveFiche(ids.campaignA, published.id, 2,
        ficheData({ name: 'Lieu corrigé par le MJ', published: false }))).fiche;
      assert.equal((await get(published.id)).annotations.length, 2);
      await as(ids.playerA);
      assert.ok(!(await list()).fiches.some(f => f.id === published.id));
      await denied(() => get(published.id));
      await denied(() => annotate(published.id, playerNote.id, 2, 'Écriture après retrait'));
      await denied(() => annotate(published.id, null, null, 'Ajout après retrait'));
      await as(ids.gmA);
      published = (await saveFiche(ids.campaignA, published.id, 3,
        ficheData({ name: 'Lieu corrigé par le MJ', published: true }))).fiche;
      await as(ids.playerA);
      assert.equal((await get(published.id)).annotations.length, 2);
    });

    await t.test('imports start private, are idempotent, and never overwrite an edited record', async () => {
      const importedId = '20000000-0000-0000-0000-000000000001';
      const item = ficheData({ id: importedId, name: 'Import synthétique', published: true });
      await as(ids.gmA);
      assert.deepEqual(await importFiches([item]), { imported: 1, skipped: 0, total: 1 });
      const initial = (await get(importedId)).fiche;
      assert.equal(initial.published, false, 'The import does not publish even if the input says true');
      assert.equal(initial.version, 1);
      await as(ids.playerA);
      await denied(() => get(importedId));
      await as(ids.gmA);
      const edited = (await saveFiche(ids.campaignA, importedId, 1,
        ficheData({ name: 'Import enrichi par le MJ', published: true }))).fiche;
      assert.deepEqual(await importFiches([item]), { imported: 0, skipped: 1, total: 1 });
      assert.deepEqual((await get(importedId)).fiche, edited);
      assert.deepEqual(await importFiches([item, item]), { imported: 0, skipped: 2, total: 2 });
      await as(ids.gmB);
      assert.deepEqual(await importFiches([item], ids.campaignB), { imported: 1, skipped: 0, total: 1 });
      assert.equal((await get(importedId, ids.campaignB)).fiche.published, false);
      await as(ids.gmA);
      assert.equal((await get(importedId)).fiche.name, 'Import enrichi par le MJ');
    });

    await t.test('an invalid item rolls back the entire import', async () => {
      await as(ids.gmA);
      const goodId = '20000000-0000-0000-0000-000000000002';
      const badId = '20000000-0000-0000-0000-000000000003';
      const good = ficheData({ id: goodId });
      const bad = ficheData({ id: badId, summary: '' });
      await denied(() => importFiches([good, bad]), '22023');
      await denied(() => get(goodId));
      await denied(() => get(badId));
      assert.deepEqual(await importFiches([good, good]), { imported: 1, skipped: 1, total: 2 });
    });

    await t.test('server-side field limits reject malformed or oversized content', async () => {
      await as(ids.gmA);
      for (const invalid of [
        { name: ' ' }, { summary: ' ' }, { name: 'x'.repeat(161) },
        { summary: 'x'.repeat(301) }, { description: 'x'.repeat(6001) },
        { subtitle: 'x'.repeat(161) }, { location: 'x'.repeat(161) },
        { type: 'admin' }, { published: 'true' }, { description: { hidden: 'wrong type' } },
      ]) {
        await denied(() => saveFiche(ids.campaignA, null, null, ficheData(invalid)), '22023');
      }
      await denied(() => importFiches({ not: 'an array' }), '22023');
      await denied(() => importFiches(Array.from({ length: 1001 }, () => ficheData({ id: ids.missing }))), '22023');
      await as(ids.playerA);
      for (const body of ['', '   ', 'x'.repeat(6001), null]) {
        await denied(() => annotate(published.id, null, null, body), '22023');
      }
      assert.equal((await get(published.id)).annotations.length, 2);
    });
  } finally {
    await db.close();
  }
});
