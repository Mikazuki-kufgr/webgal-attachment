import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, put, snapshot, png, payload } from './creator-fixtures.mjs';
import { createCreatorStore } from '../runtime/creator-store.mjs';
import { createCreatorService } from '../runtime/creator-service.mjs';
import { sha } from '../runtime/creator-package.mjs';
import { modelImportDependencies } from '../runtime/creator-model-files.generated.mjs';
const model = { model: '人物.moc', textures: ['纹理.png'], physics: 'physics.json', pose: 'pose.json',
  expressions: [{ name: 'smile', file: '../共用/smile.exp.json' }], motions: { idle: [{ file: '../共用/idle.mtn', sound: '../共用/sound.wav' }] } };
function body(m = model) {
  const files = { '人物/model.json': Buffer.from(JSON.stringify(m)), '人物/人物.moc': Buffer.from('fixture moc'),
    '人物/纹理.png': png, '人物/physics.json': Buffer.from('{}'), '人物/pose.json': Buffer.from('{}'),
    '共用/smile.exp.json': Buffer.from('{}'), '共用/idle.mtn': Buffer.from('fixture motion'), '共用/sound.wav': Buffer.from('fixture sound') };
  return { entryPath: '人物/model.json', displayName: '测试 人物', files: Object.entries(files).map(([path, b]) => ({ path, base64: b.toString('base64') })) };
}
function setup(hooks = {}) {
  const f = fixture('portable'), root = path.join(f.authoring, 'workspace');
  put(root + '/game/config.txt', 'Game_name:模型导入测试;'); put(root + '/game/scene/start.txt', '不得修改;');
  f.options.authorizedAuthoringWorkspaceRoot = root;
  const profile = { schema: 'webgal-live2d-model-profile', schemaVersion: 1, profileVersion: 1,
    modelProfileId: 'known-model', characterId: 'anon', modelId: 'test', modelPath: './game/figure/anon/test/model.json',
    fingerprint: { mocSha256: sha(Buffer.from('fixture moc')), modelJsonSha256: sha(Buffer.from('old json')), drawableCount: 1 },
    anchors: [{ name: 'mouth', anchorProfileId: 'mouth-v1', drawableId: 'D1', vertexCount: 3,
      points: [{ index: 0, weight: 1, neutral: { x: 0, y: 0 } }] }] };
  put(f.authoring + '/library/model-profiles/known-model.json', JSON.stringify(profile));
  put(f.authoring + '/library/model-profiles/index.json', JSON.stringify({ schema: 'webgal-live2d-model-profile-index', schemaVersion: 1, profiles: ['known-model'] }));
  return { ...f, root, store: () => createCreatorStore(f.options, hooks) };
}
test('complete dependencies, preserved input, persistent catalog, explicit game copy and no-op', () => {
  const f = setup(), s = f.store(), input = body(), original = JSON.stringify(input), gameBefore = snapshot(f.project);
  const r = s.importModel(input);
  assert.equal(r.ok, true); assert.equal(r.model.dependencyCount, 8); assert.equal(r.profiles.length, 1);
  assert.equal(JSON.stringify(input), original); assert.deepEqual(snapshot(f.project), gameBefore);
  assert.ok(r.profiles[0].modelProfileId !== 'known-model');
  const root = r.model.modelPath.slice(0, -'人物/model.json'.length);
  for (const file of input.files) assert.equal(fs.readFileSync(path.join(f.root, root, file.path)).toString('base64'), file.base64);
  const context = f.store().context();
  assert.ok(context.authoringWorkspace.availableModelProfileIds.includes(r.profiles[0].modelProfileId));
  const index = JSON.parse(s.readAuthoringResource('game/attachments-v2/model-profiles/index.json'));
  assert.ok(index.profiles.includes('known-model')); assert.ok(index.profiles.includes(r.profiles[0].modelProfileId));
  assert.equal(s.copyImportedModelToGame({ id: r.model.id, projectName: '测试 Demo' }).ok, true);
  const after = snapshot(f.project);
  assert.equal(s.copyImportedModelToGame({ id: r.model.id, projectName: '测试 Demo' }).noOp, true);
  assert.deepEqual(snapshot(f.project), after);
  for (const [p, hash] of Object.entries(gameBefore)) assert.equal(after[p], hash);
  // An imported model can be used by the existing attachment save + generated Runtime scene path.
  const save = s.saveToGame({ ...payload({ modelPath: './' + r.model.modelPath }), expectedRevision: null });
  assert.equal(save.ok, true); assert.ok(fs.readFileSync(path.join(f.project, save.exampleScene), 'utf8').includes(r.model.modelPath.slice('game/figure/'.length)));
  assert.match(r.model.modelPath, /^game\/figure\/测试_人物\/人物（导入-[a-f0-9]{8}）\//);
});
test('unknown moc stays imported but never receives invented anchors', () => {
  const f = setup(), b = body(); b.files.find(f => f.path.endsWith('.moc')).base64 = Buffer.from('other geometry').toString('base64');
  const r = f.store().importModel(b); assert.equal(r.model.status, 'NEEDS_PROFILE'); assert.equal(r.profiles.length, 0);
  assert.equal(f.store().context().importedModels[0].status, 'NEEDS_PROFILE');
});
test('same geometry with renamed appearance and changed texture keeps two distinct readable entries', () => {
  const f = setup(), s = f.store(), a = s.importModel(body()), b = body();
  b.entryPath = '夏装捉虫小祥-捕虫网/model.json';
  b.files = b.files.map(file => ({...file, path:file.path.replace(/^人物\//,'夏装捉虫小祥-捕虫网/')}));
  b.files.find(file=>file.path.endsWith('纹理.png')).base64 = Buffer.concat([png,Buffer.from('modified texture')]).toString('base64');
  const second=s.importModel(b);
  assert.notEqual(a.model.id,second.model.id);assert.notEqual(a.model.modelPath,second.model.modelPath);
  assert.equal(second.model.appearanceName,'夏装捉虫小祥-捕虫网');
  assert.equal(a.profiles[0].fingerprint.mocSha256,second.profiles[0].fingerprint.mocSha256);
  assert.notEqual(a.profiles[0].modelProfileId,second.profiles[0].modelProfileId);
  assert.equal(s.context().importedModels.length,2);
  const index=JSON.parse(s.readAuthoringResource('game/attachments-v2/model-profiles/index.json'));
  assert.equal(index.profileDocuments[second.profiles[0].modelProfileId].modelPath,'./'+second.model.modelPath);
  s.close();
});
test('manually copied appearances are discovered separately and copy only their exact dependencies', () => {
  const f=setup(), input=body();
  for(const outfit of ['人物','人物-换图']) for(const file of input.files) {
    const relative=file.path.replace(/^人物\//,outfit+'/');
    put(path.join(f.root,'game/figure/自制角色',relative),Buffer.from(file.base64,'base64'));
  }
  put(path.join(f.root,'game/figure/自制角色/人物-换图/纹理.png'),Buffer.concat([png,Buffer.from('second texture')]));
  const before=snapshot(f.root), s=f.store(), rows=s.context().importedModels;
  assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(r=>r.appearanceName)),new Set(['人物','人物-换图']));
  assert(rows.every(r=>r.displayName==='自制角色'));assert.notEqual(rows[0].id,rows[1].id);
  const index=JSON.parse(s.readAuthoringResource('game/attachments-v2/model-profiles/index.json'));
  for(const row of rows)assert.equal(index.profileDocuments[row.profileIds[0]].modelPath.replace(/^(\.\/)+/,''),row.modelPath);
  assert.deepEqual(snapshot(f.root),before,'catalog discovery is read-only');
  const chosen=rows.find(r=>r.appearanceName==='人物-换图');
  assert(s.copyImportedModelToGame({id:chosen.id,projectName:'测试 Demo'}).ok);
  assert(fs.existsSync(path.join(f.project,chosen.modelPath)));
  assert(!fs.existsSync(path.join(f.project,'game/figure/自制角色/人物/model.json')));
  const saved=snapshot(f.project);
  assert.throws(()=>s.copyImportedModelToGame({id:'local-'+ 'f'.repeat(20),projectName:'测试 Demo'}));
  assert.deepEqual(snapshot(f.project),saved);s.close();
});
test('known library profile copies complete workspace model without an imported-model row', () => {
  const f = setup(), input = body();
  const profile = JSON.parse(fs.readFileSync(path.join(f.authoring, 'library/model-profiles/known-model.json'), 'utf8'));
  profile.modelProfileId = 'known-copy'; profile.modelPath = './game/figure/anon/copied/model.json';
  put(path.join(f.authoring, 'library/model-profiles/known-copy.json'), JSON.stringify(profile));
  for (const file of input.files) {
    const relative = file.path.replace(/^人物\//, 'copied/');
    put(path.join(f.root, 'game/figure/anon', relative), Buffer.from(file.base64, 'base64'));
  }
  const s = f.store(), beforeSource = snapshot(f.root), beforeGame = snapshot(f.project);
  assert.equal(s.context().importedModels.some(row => row.modelPath === 'game/figure/anon/copied/model.json'), false);
  const request = { id: 'profile:known-copy', projectName: '测试 Demo' };
  assert.equal(s.copyImportedModelToGame(request).ok, true);
  const afterGame = snapshot(f.project);
  for (const [p, hash] of Object.entries(beforeGame)) assert.equal(afterGame[p], hash);
  for (const file of input.files) {
    const relative = file.path.replace(/^人物\//, 'copied/');
    assert.equal(fs.readFileSync(path.join(f.project, 'game/figure/anon', relative)).toString('base64'), file.base64);
  }
  assert.deepEqual(snapshot(f.root), beforeSource);
  assert.equal(s.copyImportedModelToGame(request).noOp, true);
  assert.deepEqual(snapshot(f.project), afterGame);
  put(path.join(f.project, 'game/figure/anon/copied/physics.json'), '{"user":"different"}');
  const conflictState = snapshot(f.project);
  assert.throws(() => s.copyImportedModelToGame(request), /TARGET_CONFLICT/);
  assert.deepEqual(snapshot(f.project), conflictState);
  assert.throws(() => s.copyImportedModelToGame({ id: 'profile:not-in-library', projectName: '测试 Demo' }), /NOT_FOUND/);
  s.close();
});
test('model worker keeps authenticated progress responsive and refuses overlapping writes', async () => {
  const f=setup(), input=body(), raw=JSON.parse(Buffer.from(input.files[0].base64,'base64'));
  raw.motions.bulk=Array.from({length:250},(_,n)=>({file:'../共用/motion-'+n+'.mtn'}));
  input.files[0].base64=Buffer.from(JSON.stringify(raw)).toString('base64');
  for(let n=0;n<250;n++)input.files.push({path:'共用/motion-'+n+'.mtn',base64:Buffer.from('motion').toString('base64')});
  const service=createCreatorService(f.options), {origin,token}=await service.listen();
  const headers={Origin:origin,'Content-Type':'application/json','X-Creator-Session':token};
  let pending;
  try {
    pending=fetch(origin+'/__creator/import-model',{method:'POST',headers,body:JSON.stringify(input)});
    let active=false;
    for(let n=0;n<100;n++){
      const response=await fetch(origin+'/__creator/model-operation',{headers});
      if((await response.json()).active){active=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert(active,'worker should expose active progress before completion');
    const start=performance.now();assert((await (await fetch(origin+'/__rc1/health',{headers})).json()).ok);
    assert(performance.now()-start<1500,'health must not wait for the copy worker');
    const blocked=await fetch(origin+'/__creator/save-local',{method:'POST',headers,body:JSON.stringify(payload())});
    assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'CREATOR_SAVE_BUSY');
    assert.equal((await pending).status,200);
    assert.equal((await (await fetch(origin+'/__creator/model-operation',{headers})).json()).active,false);
  } finally {await pending?.catch(()=>{});await service.close();}
});
for (const [name, mutate, wanted] of [
  ['missing expression', b => b.files.splice(b.files.findIndex(f => f.path.endsWith('exp.json')), 1), /DEPENDENCY_MISSING/],
  ['case collision', b => b.files.push({ ...b.files[0], path: '人物/MODEL.JSON' }), /DUPLICATE_PATH/],
  ['unreferenced executable', b => b.files.push({ path: 'evil.exe', base64: 'YQ==' }), /UNREFERENCED_FILE/],
  ['path escape', b => { b.files[0].path = '../evil.json'; }, /PATH_INVALID/],
  ['absolute field ignored cannot broaden target', b => { b.entryPath = 'C:/outside/model.json'; }, /PATH_INVALID/],
]) test(`${name}: preflight failure writes nothing`, () => {
  const f = setup(), before = snapshot(f.root), b = body(); mutate(b);
  assert.throws(() => f.store().importModel(b), wanted); assert.deepEqual(snapshot(f.root), before);
});
test('references outside folder, remote URLs, modern runtime refused', () => {
  assert.throws(() => modelImportDependencies('model.json', { ...model, model: '../outside.moc' }), /OUTSIDE_FOLDER/);
  assert.throws(() => modelImportDependencies('model.json', { ...model, model: 'https://host/model.moc' }), /REFERENCE_INVALID/);
  assert.throws(() => modelImportDependencies('model3.json', { FileReferences: {} }), /RUNTIME_UNSUPPORTED/);
});
test('partial commit failure rolls back all model/profile files', () => {
  let calls = 0; const f = setup({ fault(stage) { if (stage === 'installed' && ++calls === 2) throw new Error('injected failure'); } });
  const before = snapshot(f.root); assert.throws(() => f.store().importModel(body()), /injected failure/);
  assert.deepEqual(snapshot(f.root), before);
});
test('target edits retained and source edits are copied without exact-hash gate', () => {
  const f = setup(), s = f.store(), r = s.importModel(body());
  const p = r.model.modelPath.replace('model.json', 'physics.json');
  put(path.join(f.root, p), '{"user":"edited"}');
  s.copyImportedModelToGame({ id: r.model.id, projectName: '测试 Demo' });
  assert.equal(fs.readFileSync(path.join(f.project, p), 'utf8'), '{"user":"edited"}');
  put(path.join(f.project, p), '{"target":"different"}'); const before = snapshot(f.project);
  assert.throws(() => s.copyImportedModelToGame({ id: r.model.id, projectName: '测试 Demo' }), /TARGET_CONFLICT/);
  assert.deepEqual(snapshot(f.project), before);
  assert.throws(() => s.copyImportedModelToGame({ id: r.model.id, projectName: 'Other' }), /NOT_AUTHORIZED/);
});
test('HTTP session + import + context + copy all use ordinary public routes', async () => {
  const f = setup(), service = createCreatorService(f.options); const { origin, token } = await service.listen();
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Creator-Session': token };
  try {
    const denied = await fetch(origin + '/__creator/import-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    assert.equal(denied.status, 403);
    const response = await fetch(origin + '/__creator/import-model', { method: 'POST', headers, body: JSON.stringify(body()) });
    assert.equal(response.status, 200); const r = await response.json();
    const copied = await fetch(origin + '/__creator/copy-model-to-game', { method: 'POST', headers, body: JSON.stringify({ id: r.model.id, projectName: '测试 Demo' }) });
    assert.equal(copied.status, 200);
  } finally { await service.close(); }
});
test('source changes during copy staging are detected and target is rolled back', () => {
  let change = () => {}, armed = false;
  const f = setup({ fault(stage) { if (armed && stage === 'staged') { armed = false; change(); } } });
  const s = f.store(), r = s.importModel(body()), before = snapshot(f.project);
  change = () => put(path.join(f.root, r.model.modelPath), JSON.stringify({ ...model, extra: 'changed while copying' }));
  armed = true;
  assert.throws(() => s.copyImportedModelToGame({ id: r.model.id, projectName: '测试 Demo' }), /SOURCE_CHANGED/);
  assert.deepEqual(snapshot(f.project), before);
});
