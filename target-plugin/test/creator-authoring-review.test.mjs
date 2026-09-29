import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {test} from 'node:test';
import {fixture,payload,put,encode,snapshot} from './creator-fixtures.mjs';
import {createCreatorStore} from '../runtime/creator-store.mjs';
import {jsonBytes} from '../runtime/creator-package.mjs';
function local(){const f=fixture(),root=path.join(f.authoring,'workspace');put(root+'/game/config.txt','Game_name:Local;');put(root+'/game/scene/start.txt','original');return {...f,root,local:createCreatorStore({...f.options,authorizedAuthoringWorkspaceRoot:root})};}
function manifestBody(at){const p=payload(),m=p.files.find(f=>f.path.endsWith('/manifest.json')),v=JSON.parse(Buffer.from(m.base64,'base64'));v.createdAt=at;v.anchorName='head';v.commandSnippet='stale command';Object.assign(m,encode(m.path,jsonBytes(v)));return p;}
test('R13 timestamp-only second save is byte identical and no-op, without fixed builder date',async()=>{
 const f=local();try{const a=manifestBody(new Date().toISOString()),r=f.local.saveAuthoringAttachment({...a,expectedRevision:null}),before=snapshot(f.root);
 await new Promise(resolve=>setTimeout(resolve,10));const b=manifestBody(new Date().toISOString());assert.notEqual(a.files.at(-1).base64,b.files.at(-1).base64);
 const next=f.local.saveAuthoringAttachment({...b,expectedRevision:r.revision});assert.equal(next.noOp,true);assert.equal(next.revision,r.revision);assert.deepEqual(snapshot(f.root),before);
 }finally{f.local.close();}
});
test('R09 accepted external edit clears impossible preference and command, keeps content; valid choice regenerates command',()=>{
 const f=local();try{const a=manifestBody(new Date().toISOString());f.local.saveAuthoringAttachment({...a,expectedRevision:null});
 let loaded=f.local.loadAuthoringAttachment(a);assert.deepEqual(loaded.preferredSelection,{modelProfileId:'profile-a',anchorName:'head'});
 const p=path.join(f.root,loaded.packageRoot,'attachment.json'),d=JSON.parse(fs.readFileSync(p));d.displayName='changed';fs.writeFileSync(p,JSON.stringify(d));
 loaded=f.local.loadAuthoringAttachment(a);f.local.acceptAuthoringAttachmentChanges({...a,expectedRevision:loaded.revision});
 const m=path.join(f.root,loaded.packageRoot,'manifest.json');assert.match(JSON.parse(fs.readFileSync(m)).commandSnippet,/-profile=profile-a -anchor=head/);
 d.adaptations[0].modelProfile.modelProfileId='profile-b';d.adaptations[0].preset.modelProfileId='profile-b';fs.writeFileSync(p,JSON.stringify(d));const bytes=fs.readFileSync(p);
 loaded=f.local.loadAuthoringAttachment(a);assert.equal(loaded.preferredSelection,undefined);
 const accepted=f.local.acceptAuthoringAttachmentChanges({...a,expectedRevision:loaded.revision});assert.equal(accepted.integrity,'HASH_VALIDATED');assert.equal(accepted.preferredSelection,undefined);assert.deepEqual(fs.readFileSync(p),bytes);
 const after=JSON.parse(fs.readFileSync(m));assert.equal(after.authoringSelectionState,'SELECTION_REQUIRED');assert.equal(after.commandSnippet,undefined);
 }finally{f.local.close();}
});


