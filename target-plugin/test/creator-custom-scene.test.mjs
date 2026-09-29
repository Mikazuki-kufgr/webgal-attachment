import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture,payload,mutateDocument} from './creator-fixtures.mjs';
import fs from 'node:fs';import path from 'node:path';
import {createCreatorService} from '../runtime/creator-service.mjs';
const name='user.a-9226dedc-0435-4acf-b813-78b2b866f120';
test('custom profile anchor saves to game and generated attach/reattach preserve exact identity',()=>{
 const f=fixture();f.store=f.store();try{const p=mutateDocument(payload(),d=>{const a=d.adaptations[0];a.preset.anchorName=name;a.modelProfile.anchors[0].name=name;});
 p.anchorName=name;const result=f.store.saveToGame({...p,expectedRevision:null});const scene=fs.readFileSync(path.join(f.project,result.exampleScene),'utf8');assert(scene.includes('-anchor='+name));assert(scene.includes('stageEntity:reattach'));assert(!scene.includes('-anchor=head '));
 }finally{f.store.close();}
});
test('authenticated scoped game inventory reads the written row without rescanning models and refuses ungranted games',async()=>{
 const f=fixture(),service=createCreatorService(f.options);const s=f.store();
 try {s.saveToGame({...payload(),expectedRevision:null});
  const {origin,token}=await service.listen(0);
  const call=name=>fetch(origin+'/__creator/project-attachments',{method:'POST',headers:{'Content-Type':'application/json','X-Creator-Session':token},body:JSON.stringify({projectName:name})});
  const r=await call('测试 Demo');assert.equal(r.status,200);const d=await r.json();assert.equal(d.savedAttachments.length,1);assert.equal(d.savedAttachments[0].presetId,'v2/test-hat');assert.equal(d.savedAttachments[0].projectName,'测试 Demo');
  assert.notEqual((await call('Other')).status,200);assert.notEqual((await call('../Other')).status,200);
 }finally{s.close();await service.close();}
});
test('missing profile anchor and script-breaking anchor names fail without game writes',()=>{
 const f=fixture();f.store=f.store();try{for(const bad of [name,'user.bad;attachment:remove']){const p=mutateDocument(payload(),d=>{d.adaptations[0].preset.anchorName=bad;});p.anchorName=bad;assert.throws(()=>f.store.saveToGame(p));}assert.equal(fs.readFileSync(path.join(f.project,'game/scene/start.txt'),'utf8'),'用户原剧情不变;');
 }finally{f.store.close();}
});

