import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneDocumentSaveCoordinator } from '../src/utils/sceneDocumentSaveCoordinator.ts';
import { assertRenameSucceeded, normalizeRenameName, renameEditorTags } from '../src/utils/editorRename.ts';

const source = 'games/g/game/scene/保存.txt', target = 'games/g/game/scene/改名.txt';
const reply = async (request: any) => ({ ...request, ok: true as const, verifiedCurrent: true });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return {promise, resolve}; }

test('renames current and nested tags atomically without matching sibling prefix', () => {
  const tags = ['scene/a/x.txt', 'scene/ab/x.txt', 'scene/a/y.txt'].map(path => ({name:path.split('/').at(-1)!,path,type:'scene' as const}));
  const next = renameEditorTags(tags,tags[0],'scene/a','scene/新目录');
  assert.equal(next.currentTag?.path,'scene/新目录/x.txt');
  assert.deepEqual(next.tags.map(t=>t.path),['scene/新目录/x.txt','scene/ab/x.txt','scene/新目录/y.txt']);
  const file = renameEditorTags(next.tags,next.currentTag,'scene/新目录/x.txt','scene/新目录/新名.txt');
  assert.equal(file.currentTag?.name,'新名.txt');
});

test('successful rename transfers clean identity and rejects stale old saves', async () => {
  const c=new SceneDocumentSaveCoordinator('rename'); c.acceptPersisted(source,'第二稿'); let committed=false;
  await c.rename(source,target,async()=>{},()=>{committed=true}); assert(committed);
  assert.equal(c.getLatestText(target),'第二稿'); assert.equal(c.getLatestText(source),undefined);
  assert.throws(()=>c.save(source,'旧标签',reply),/已重命名/);
  let executed=false; await c.saveAndRun(target,'第二稿',{transport:reply,run:r=>{assert.equal(r.request.path,target);executed=true}}); assert(executed);
  c.reopen(source); await c.save(source,'明确重新创建的文件',reply);
});

test('reopening a renamed path starts a new save session generation', async () => {
  const c = new SceneDocumentSaveCoordinator('generation');
  c.acceptPersisted(source, '旧文件');
  await c.rename(source, target, async () => {}, () => {});
  c.reopen(source);
  c.acceptPersisted(source, '新建旧名');
  let request: any;
  await c.save(source, '新文件内容', async req => {
    request = req;
    return reply(req);
  });
  assert.match(request.saveSessionId, /:reopen-1$/);
  assert.equal(request.revision, 2);
});

test('rename input normalization is shared by duplicate checks and submission', () => {
  assert.equal(normalizeRenameName(' b.txt '), 'b.txt');
});

test('a non-success rename response cannot commit a new document identity', async () => {
  const c = new SceneDocumentSaveCoordinator('response-failure');
  c.acceptPersisted(source, '原稿');
  let committed = false;
  await assert.rejects(
    c.rename(source, target, async () => {
      assertRenameSucceeded({ data: { ok: false } } as any);
    }, () => { committed = true; }),
    /未确认成功/,
  );
  assert.equal(committed, false);
  assert.equal(c.getLatestText(source), '原稿');
  assert.equal(c.getLatestText(target), undefined);
});

test('dirty draft or pending save prevents disk rename', async () => {
  const c=new SceneDocumentSaveCoordinator('dirty');c.stage(source,'草稿'); let renamed=false;
  await assert.rejects(c.rename(source,target,async()=>{renamed=true},()=>{}),/尚未保存/); assert.equal(renamed,false);assert.equal(c.getLatestText(source),'草稿');
  const gate=deferred(); const pending=c.save(source,'草稿',async req=>{await gate.promise;return reply(req)});
  await assert.rejects(c.rename(source,target,async()=>{renamed=true},()=>{}),/正在保存/);gate.resolve();await pending;assert.equal(renamed,false);
});

test('failed rename preserves original document and does not commit tags', async () => {
  const c=new SceneDocumentSaveCoordinator('failure');c.acceptPersisted(source,'原稿');let committed=false;
  await assert.rejects(c.rename(source,target,async()=>{throw new Error('occupied')},()=>{committed=true}),/occupied/);
  assert.equal(committed,false); assert.equal(c.getLatestText(source),'原稿'); assert.equal(c.getLatestText(target),undefined);
  await c.save(source,'原路径仍可保存',reply);
});

test('an edit arriving during rename is preserved at new identity without old-path writes',async()=>{
  const c=new SceneDocumentSaveCoordinator('during');c.acceptPersisted(source,'原稿');const gate=deferred();
  const rename=c.rename(source,target,()=>gate.promise,()=>{});let writes=0;
  await assert.rejects(c.save(source,'新草稿',async req=>{writes++;return reply(req)}),/正在重命名/);
  await assert.rejects(c.rename(source,target,async()=>{},()=>{}),/正在重命名/);
  gate.resolve();await rename;assert.equal(writes,0);assert.equal(c.getLatestText(target),'新草稿');assert(c.hasDirtyDraft(target));
  await c.save(target,'新草稿',reply);assert(!c.hasDirtyDraft(target));
});

test('folder rename retains children and protects dirty destination drafts',async()=>{
  const c=new SceneDocumentSaveCoordinator('folder');c.acceptPersisted(source,'A');c.acceptPersisted(source+'/nested','B');
  c.stage(target,'冲突草稿');await assert.rejects(c.rename(source,target,async()=>{},()=>{}),/尚未保存/);
  await c.save(target,'冲突草稿',reply);await c.rename(source,target,async()=>{},()=>{});assert.equal(c.getLatestText(target+'/nested'),'B');
});
