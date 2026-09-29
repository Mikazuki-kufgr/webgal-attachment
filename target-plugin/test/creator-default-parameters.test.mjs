import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, payload, mutateDocument } from './creator-fixtures.mjs';

test('save/load/merge retains explicit attachment defaults independently of per-model placement',()=>{
 const f=fixture(),store=f.store();
 try {
  const body=mutateDocument(payload(),d=>{d.defaultParameters={anchorName:'head',placement:{offset:{x:12,y:3}}};d.adaptations[0].preset.placement.offset.x=45;});
  const first=store.saveToGame(body);
  const loaded=store.loadAttachment(body);
  assert.equal(loaded.packageDocument.defaultParameters.placement.offset.x,12);
  const second=mutateDocument(payload({profileId:'profile-b'}),d=>{d.defaultParameters=loaded.packageDocument.defaultParameters;d.adaptations[0].preset.placement.offset.x=90;});
  store.saveToGame({...second,expectedRevision:first.revision});
  const result=store.loadAttachment(second);
  assert.deepEqual(result.packageDocument.defaultParameters,loaded.packageDocument.defaultParameters);
  assert.deepEqual(result.packageDocument.adaptations.map(a=>[a.modelProfile.modelProfileId,a.preset.placement.offset.x]),[['profile-a',45],['profile-b',90]]);
  assert.equal(Object.keys(result.layers).length,1);
 } finally {store.close();}
});
