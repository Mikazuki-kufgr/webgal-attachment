import fs from 'node:fs';import path from 'node:path';import {it,expect} from 'vitest';import {AttachmentProfileLoader} from '../profileLoader';
const authoring=process.env.WEBGAL_MIGRATED_LIBRARY;
it.skipIf(!authoring)('actual migrated user attachments select exact profiles with both new and old script IDs; read only',async()=>{
 const root=path.resolve(authoring!),portable=path.join(root,'game/attachments-v2/portable');let count=0;
 for(const leaf of ['straw-hat-both-v1','kemomimi-front-v1','halo-front-v1','flower-front-v1','rose-front-v1']){
  const p=path.join(portable,leaf,'attachment.json');if(!fs.existsSync(p))continue;const doc=JSON.parse(fs.readFileSync(p,'utf8'));
  const loader=new AttachmentProfileLoader({fetcher:async(url)=>{const f=path.resolve(root,String(url).replace(/^\.\//,''));expect(f.startsWith(root+path.sep)).toBe(true);return new Response(fs.readFileSync(f),{status:200});}});
  for(const a of doc.adaptations){const current=await loader.load('v2/'+leaf,a.modelProfile.modelPath,a.modelProfile.modelProfileId),old=await loader.load('v2/anon-'+leaf,a.modelProfile.modelPath,a.modelProfile.modelProfileId);expect(current.modelBinding?.modelProfileId).toBe(a.modelProfile.modelProfileId);expect(current.config.layers).toEqual(doc.asset.layers);expect(current.config.placement.offset).toEqual(a.preset.placement.offset);expect({...old.config,configId:current.config.configId}).toEqual(current.config);expect(old.modelBinding).toEqual(current.modelBinding);count++;}
 }expect(count).toBeGreaterThanOrEqual(5);
});
