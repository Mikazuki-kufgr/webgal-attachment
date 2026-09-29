import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';
import {fixture,payload,put} from './creator-fixtures.mjs';
import {createCreatorStore} from '../runtime/creator-store.mjs';
import {initializeAuthoringWorkspace} from '../runtime/product-materialization.mjs';
test('Chinese attachment name survives local save, reopen, update, and game deployment with stable identity',()=>{
 const f=fixture(),root=path.join(f.authoring,'workspace');
 initializeAuthoringWorkspace({authoringRoot:f.authoring,authorizedWorkspaceRoot:root,template:{sourceKind:'EMPTY_AUTHORING_WORKSPACE',schemaVersion:1}});
 const s=createCreatorStore({...f.options,authorizedAuthoringWorkspaceRoot:root});
 const p={...payload({leaf:'草帽-祥子-a12b34',displayName:'草帽-祥子'}),expectedRevision:null};
 const result=s.saveAuthoringAttachment(p);assert(result.ok);assert(result.attachmentRoot.endsWith('草帽-祥子-a12b34'));
 assert.equal(s.loadAuthoringAttachment(p).presetId,p.presetId);
 const game=s.saveToGame(p);assert(game.ok);assert.match(fs.readFileSync(path.join(f.project,game.exampleScene),'utf8'),/-config=v2\/草帽-祥子-a12b34/);
 assert.equal(s.saveAuthoringAttachment({...p,expectedRevision:result.revision}).noOp,true);
 fs.cpSync(path.join(f.project,'game/figure'),path.join(root,'game/figure'),{recursive:true});
 const preview=s.applyAuthoringPackage({...p,expectedRevision:result.revision});assert(preview.ok);assert.match(preview.exampleScene,/附件测试-草帽-祥子/);
 s.close();
});
test('empty authoring workspace needs no games and later explicit game action stays within selected data root',()=>{
 const f=fixture();const root=path.join(f.authoring,'workspace');
 const r=initializeAuthoringWorkspace({authoringRoot:f.authoring,authorizedWorkspaceRoot:root,template:{sourceKind:'EMPTY_AUTHORING_WORKSPACE',schemaVersion:1}});
 assert.equal(r.status,'CREATED_USER_OWNED');assert(!fs.existsSync(root+'/game/figure'));
 const s=createCreatorStore({...f.options,authorizedAuthoringWorkspaceRoot:root,projectGrants:[],projectSelectionPolicy:'explicit-action'});
 const names=s.context().targetProjects.map(p=>p.name);assert(names.includes('Other'));
 assert(s.saveAuthoringAttachment({...payload(),expectedRevision:null}).ok);
 assert.throws(()=>s.saveToGame({...payload(),projectName:'../outside'}));
 s.close();
});
