import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname);
const revision=process.env.RELEASE_REVISION || 'MYGO321-CANDIDATE.1';
const buildOutput=path.resolve(root,process.env.BUILD_OUTPUT || 'build-output');
assert(buildOutput.startsWith(root+path.sep),'Task-local build output required');
const engine=path.join(root,'target-webgal-mygo/packages/webgal');
const terre=path.join(root,'target-webgal-mygo-terre');
const evidence=path.join(buildOutput,'evidence');
fs.mkdirSync(evidence,{recursive:true});
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
const write=(name,data)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(data,null,2));
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[{path:prefix+e.name,bytes:fs.statSync(path.join(dir,e.name)).size,sha256:hash(path.join(dir,e.name))}]);
const kinds=process.argv.slice(2); assert(kinds.length,'Specify engine creator preview editor backend');
process.env.NODE_ENV='production';
function run(file,args,cwd){const r=spawnSync(process.execPath,[file,...args],{cwd,stdio:'inherit',env:process.env});assert.equal(r.status,0,`${file} failed`);}
for(const kind of kinds){
 if(kind==='backend'){
  const protocol=path.join(terre,'packages/editor-preview-protocol');
  const req=createRequire(path.join(terre,'package.json'));
  for(const target of ['esm','cjs'])run(req.resolve('typescript/bin/tsc'),['-p',`tsconfig.${target}.json`],protocol);
  const cwd=path.join(terre,'packages/terre2');process.chdir(cwd);
  const r=createRequire(path.join(cwd,'package.json')),webpack=r('webpack'),config=r('./standalone.js');
  const out=path.join(buildOutput,'backend');assert(!fs.existsSync(out),'Fresh output required');
  // Explicit standalone configuration: no update-webgal download or historical dist input.
  config.mode='production';config.output={...config.output,path:out};
  const stats=await new Promise((resolve,reject)=>webpack(config,(err,stats)=>err?reject(err):resolve(stats)));
  const json=stats.toJson({all:false,errors:true,warnings:true,modules:true,nestedModules:true,assets:true});
  write('backend-webpack.json',json);assert(!stats.hasErrors(),JSON.stringify(json.errors));
  const modules=[];function collect(rows){for(const row of rows||[]){if(row.nameForCondition&&fs.existsSync(row.nameForCondition))modules.push({path:path.relative(root,row.nameForCondition).replaceAll('\\','/'),sha256:hash(row.nameForCondition)});collect(row.modules);}}collect(json.modules);
  write('backend-BUILD.json',{revision,files:walk(out),modules,compiler:'webpack standalone.js production',sourceRoot:'.'});
  continue;
 }
 assert(['engine','creator','preview','editor'].includes(kind));
 const cwd=kind==='editor'?path.join(terre,'packages/origine2'):engine;process.chdir(cwd);
 const req=createRequire(path.join(cwd,'package.json')),vite=await import(pathToFileURL(path.join(path.dirname(req.resolve('vite/package.json')),'dist/node/index.js')).href);
 const out=path.join(buildOutput,kind);assert(!fs.existsSync(out),'Fresh output required');
 const rendered=new Map();const plugins=[{name:'distribution-provenance',generateBundle(_opts,bundle){for(const c of Object.values(bundle))if(c.type==='chunk')for(const [id,v] of Object.entries(c.modules))if(v.renderedLength>0)rendered.set(id,v.renderedLength);}}];
 if(kind==='creator'||kind==='preview')plugins.push({name:'creator-entry',transformIndexHtml:{order:'pre',handler:()=>fs.readFileSync(path.join(engine,'creator.html'),'utf8')}});
 const options=kind==='editor'?{}:{resolve:{alias:{'@':path.join(engine,'src'),'webgal-parser':path.join(root,'target-webgal-mygo/packages/parser/src/index.ts')}},define:{__WEBGAL_MVP2B_CREATOR__:kind==='creator',__WEBGAL_CREATOR_PREVIEW__:kind==='preview',__WEBGAL_MVP2B_APPROVED_ASSET_ROOT__:JSON.stringify(''),__WEBGAL_CREATOR_RELEASE_VERSION__:JSON.stringify(revision)}};
 await vite.build({configFile:path.join(cwd,'vite.config.ts'),root:cwd,base:'./',plugins,...options,build:{outDir:out,emptyOutDir:false,copyPublicDir:false,sourcemap:false}});
 const modules=[...rendered].map(([id,renderedLength])=>{const file=id.split('?')[0];return {id:path.relative(root,id).replaceAll('\\','/').replaceAll(root.replaceAll('\\','/'),'$SOURCE_ROOT'),renderedLength,...(fs.existsSync(file)&&fs.statSync(file).isFile()?{sha256:hash(file)}:{})};});
 assert(!modules.some(r=>/node_modules\/cloudlogjs\//.test(r.id)),'Cloud logging rendered');
 for(const f of walk(out))if(f.path.endsWith('.js'))for(const marker of ['Logged to cloud.','Logging to cloud failed!','mongodb://localhost:27017/'])assert(!fs.readFileSync(path.join(out,f.path),'utf8').includes(marker));
 write(kind+'-BUILD.json',{kind,revision,files:walk(out),modules,cloudlogRendered:false,jschardetModules:modules.filter(r=>/node_modules\/jschardet\//.test(r.id))});
 console.log(`${kind.toUpperCase()}_INDEPENDENT_BUILD_PASS`);
}
