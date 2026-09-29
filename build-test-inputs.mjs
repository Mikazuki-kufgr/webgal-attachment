import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=import.meta.dirname, engine=path.join(root,'target-webgal-mygo');
const esbuild=createRequire(path.join(engine,'package.json'))('esbuild');
const creator=path.join(engine,'packages/webgal/src/Core/controller/stage/pixi/attachments/creator').replaceAll('\\','/');
const parser=path.join(engine,'packages/parser/src/index.ts').replaceAll('\\','/');
const jobs=[{name:'canonical-creator-producer',source:`export {buildCreatorPackage} from '${creator}/creatorPackageBuilder.ts'; export {createBlankCreatorDraft} from '${creator}/creatorDraft.ts';`},{name:'target-parser',source:`export {default as SceneParser} from '${parser}'; export * from '${parser}';`}];
const evidence=[];
for(const job of jobs){const result=await esbuild.build({stdin:{contents:job.source,resolveDir:root,sourcefile:job.name+'.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',target:'node24',outfile:path.join(root,'16_creator-service-save/test-inputs',job.name+'.mjs'),metafile:true});evidence.push({name:job.name,inputs:Object.keys(result.metafile.inputs).filter(p=>!p.endsWith(job.name+'.ts')).map(p=>({path:path.relative(root,path.resolve(p)),sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')}))});}
fs.writeFileSync(path.join(root,'evidence/test-input-provenance.json'),JSON.stringify(evidence,null,2));
