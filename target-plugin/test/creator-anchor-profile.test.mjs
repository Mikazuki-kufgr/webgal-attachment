import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, put, snapshot } from './creator-fixtures.mjs';
import { createCreatorStore } from '../runtime/creator-store.mjs';
import { createCreatorService } from '../runtime/creator-service.mjs';
import { validateAuthoredProfile } from '../runtime/creator-anchor-profile.mjs';

function setup() {
  const f = fixture('portable'), root = f.authoring + '/workspace';
  put(root + '/game/config.txt', 'Game_name:锚点测试;'); put(root + '/game/scene/start.txt', '不可修改;');
  put(root + '/game/figure/人物/model.json', JSON.stringify({ model: 'model.moc', textures: ['texture.png'] }));
  put(root + '/game/figure/人物/model.moc', 'fixture moc, not a real Live2D');
  f.options.authorizedAuthoringWorkspaceRoot = root;
  const store = createCreatorStore(f.options), facts = store.readAnchorModel({ modelPath: 'game/figure/人物/model.json' });
  const p = { schema: 'webgal-live2d-model-profile', schemaVersion: 1, profileVersion: 1,
    modelProfileId: 'user-profile-' + randomUUID(), characterId: 'user-character', modelId: 'pony-tail', modelPath: facts.modelPath,
    fingerprint: { modelJsonSha256: facts.modelJsonSha256, mocSha256: facts.mocSha256, drawableCount: 1 },
    anchors: [{ name: 'user.pony-tail', displayName: '单马尾根部', anchorProfileId: 'anchor-' + randomUUID(), drawableId: 'D1', vertexCount: 3,
      points: [{ index: 0, weight: 1, neutral: { x: 0, y: 0 } }, { index: 1, weight: 1, neutral: { x: 1, y: 0 } }, { index: 2, weight: 1, neutral: { x: 0, y: 1 } }] }] };
  return { ...f, root, store, p };
}
test('save/reopen/update two authored Profiles, fresh store catalog and source preservation', () => {
  const f = setup(), before = snapshot(f.root), game = snapshot(f.project);
  const r = f.store.saveAnchorProfile({ profile: f.p, expectedSha256: null }); assert.equal(r.ok, true);
  const read = f.store.readLibraryProfile({ fileName: f.p.modelProfileId + '.json' }); assert.equal(read.sha256, r.sha256);
  assert.equal(read.profile.anchors[0].displayName, '单马尾根部');
  const other = structuredClone(f.p); other.modelProfileId = 'user-profile-' + randomUUID();
  assert.equal(f.store.saveAnchorProfile({ profile: other }).ok, true);
  const p = structuredClone(f.p); p.anchors[0].displayName = '马尾';
  assert.equal(f.store.saveAnchorProfile({ profile: p, expectedSha256: r.sha256 }).ok, true);
  const fresh = createCreatorStore(f.options);
  const index = JSON.parse(fresh.readAuthoringResource('game/attachments-v2/model-profiles/index.json'));
  assert.ok(index.profiles.includes(p.modelProfileId)); assert.ok(index.profiles.includes(other.modelProfileId));
  assert.ok(fresh.context().authoringWorkspace.availableModelProfileIds.includes(p.modelProfileId));
  assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(f.project), game);
});
test('stale save never overwrites another revision', () => {
  const f = setup(); f.store.saveAnchorProfile({ profile: f.p }); const before = snapshot(f.authoring);
  assert.throws(() => f.store.saveAnchorProfile({ profile: f.p, expectedSha256: null }), /SAVE_CONFLICT/);
  assert.deepEqual(snapshot(f.authoring), before);
});

test('authored profile readiness follows exact imported model path and current moc, without rewriting import records', () => {
  const f = setup(), data = { entryPath: 'model.json', displayName: 'same name', files: [
    { path: 'model.json', base64: Buffer.from(JSON.stringify({ model: 'model.moc', textures: ['texture.png'] })).toString('base64') },
    { path: 'model.moc', base64: Buffer.from('unknown model').toString('base64') },
    { path: 'texture.png', base64: Buffer.from('texture fixture').toString('base64') },
  ] };
  const a = f.store.importModel(data), b = f.store.importModel(data);
  const before = snapshot(f.root), facts = f.store.readAnchorModel({ modelPath: a.model.modelPath });
  const p = { ...f.p, modelPath: facts.modelPath, fingerprint: { ...f.p.fingerprint, mocSha256: facts.mocSha256, modelJsonSha256: facts.modelJsonSha256 } };
  assert.equal(f.store.saveAnchorProfile({ profile: p }).ok, true);
  const rows = f.store.context().importedModels;
  assert.deepEqual(rows.find(r => r.id === a.model.id).profileIds, [p.modelProfileId]);
  assert.deepEqual(rows.find(r => r.id === b.model.id).profileIds, []);
  assert.deepEqual(snapshot(f.root), before);
  put(f.root + '/' + a.model.modelPath.replace('model.json', 'model.moc'), 'changed');
  assert.deepEqual(f.store.context().importedModels.find(r => r.id === a.model.id).profileIds, []);
});
test('foreign edit remains protected even if its latest hash is supplied', () => {
  const f = setup(); f.store.saveAnchorProfile({ profile: f.p });
  const p = structuredClone(f.p); p.anchors[0].displayName = '手改名称';
  put(f.authoring + '/library/model-profiles/' + p.modelProfileId + '.json', JSON.stringify(p));
  const hash = f.store.readLibraryProfile({ fileName: p.modelProfileId + '.json' }).sha256;
  const before = snapshot(f.authoring);
  assert.equal(f.store.saveAnchorProfile({ profile: f.p, expectedSha256: hash }).ok, false);
  assert.deepEqual(snapshot(f.authoring), before);
});
for (const [label, mutate] of [
  ['path traversal', p => { p.modelPath = 'game/figure/../../config.json'; }],
  ['foreign namespace', p => { p.modelProfileId = 'builtin-profile'; }],
  ['geometry changed', p => { p.fingerprint.mocSha256 = 'A'.repeat(64); }],
  ['collinear vertices', p => { p.anchors[0].points[2].neutral = { x: 2, y: 0 }; }],
  ['negative weight', p => { p.anchors[0].points[0].weight = -1; }],
  ['duplicate vertex', p => { p.anchors[0].points[2].index = 0; }],
  ['display control characters', p => { p.anchors[0].displayName = 'a\nb'; }],
  ['invalid index', p => { p.anchors[0].points[2].index = 3; }],
]) test(label + ' rejected before writes', () => {
  const f = setup(), before = snapshot(f.authoring), p = structuredClone(f.p); mutate(p);
  assert.throws(() => f.store.saveAnchorProfile({ profile: p })); assert.deepEqual(snapshot(f.authoring), before);
});
test('validation does not infer semantics or merge same names between models', () => {
  const { p } = setup(); const q = structuredClone(p); q.modelId = 'different-hair'; q.anchors[0].drawableId = 'OTHER';
  assert.equal(validateAuthoredProfile(q).anchors[0].name, p.anchors[0].name);
  assert.notEqual(q.anchors[0].drawableId, p.anchors[0].drawableId);
});
test('real local HTTP routes require session and permit bounded save/reopen', async () => {
  const f = setup(), service = createCreatorService(f.options), address = await service.listen(0);
  const post = (route, body, token = address.token) => fetch(address.origin + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-creator-session': token }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/__creator/anchors/save', { profile: f.p }, '0'.repeat(64))).status, 403);
    const saved = await post('/__creator/anchors/save', { profile: f.p }); assert.equal(saved.status, 200); assert.equal((await saved.json()).ok, true);
    const reopened = await post('/__creator/library/profile', { fileName: f.p.modelProfileId + '.json' });
    assert.equal((await reopened.json()).profile.anchors[0].displayName, '单马尾根部');
    const facts = await post('/__creator/anchors/model', { modelPath: f.p.modelPath }); assert.equal((await facts.json()).mocSha256, f.p.fingerprint.mocSha256);
  } finally { await service.close(); }
});
test('injected transaction fault rolls back profile bytes and ownership', () => {
  const f = setup(), before = snapshot(f.authoring);
  const store = createCreatorStore(f.options, { fault(stage) { if (stage === 'installed') throw new Error('anchor fault'); } });
  assert.throws(() => store.saveAnchorProfile({ profile: f.p }), /anchor fault/);
  assert.deepEqual(snapshot(f.authoring), before);
});
