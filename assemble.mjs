import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {resolveHostCompatibilityPlan} from './target-plugin/runtime/host-compatibility.mjs';
const root=import.meta.dirname,revision=process.env.RELEASE_REVISION || 'MYGO321-CANDIDATE.1';
const host=path.resolve(root,'../MYGO321_HOST_UPGRADE_ASSESSMENT_20260919/cold-extract/release');
const out=path.resolve(process.argv[2]||path.join(root,'packaging/staging/WebGAL-Attachment-MyGO321-Candidate1'));
assert(out.startsWith(root+path.sep)&&!fs.existsSync(out),'fresh task-local output required');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
const copy=(a,b)=>{fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b);assert.equal(hash(a),hash(b));};
const walk=(d,prefix='')=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);assert(!fs.lstatSync(p).isSymbolicLink());return e.isDirectory()?walk(p,prefix+e.name+'/'):[{path:prefix+e.name,bytes:fs.statSync(p).size,sha256:hash(p)}];}).sort((a,b)=>a.path.localeCompare(b.path,'en'));
const template=path.join(root,'distribution-template');
const admitted=new Set(['licenses','resources','manifests','01_安装或升级.cmd','02_打开附件制作器.cmd','03_验证安装.cmd','04_修复安装.cmd','05_停止附件服务.cmd','06_卸载插件.cmd','Invoke-WebGALAttachment.ps1','Prepare-WebGALAttachmentInstall.ps1','install-request.example.json','LICENSE','NOTICE.md','THIRD_PARTY_NOTICES.md','README.md']);
fs.cpSync(template,out,{recursive:true,filter:p=>p===template||admitted.has(path.relative(template,p).split(path.sep)[0])});
copy(path.join(root,'target-plugin/resources/product-resources.json'),path.join(out,'resources/product-resources.json'));
for(const r of read(path.join(root,'build-tools/runtime-sources.json'))){const a=path.join(root,r.source),b=path.join(out,r.shipped);copy(a,b);if(r.shipped==='runtime/creator-launch.mjs')fs.writeFileSync(b,fs.readFileSync(a,'utf8').replace('__WEBGAL_ATTACHMENT_RELEASE_REVISION__',revision));}
assert.equal(hash(process.execPath),read(path.join(out,'manifests/node-provenance.json')).sha256);copy(process.execPath,path.join(out,'runtime/node/node.exe'));
// A complete adapter for the archived community build, never version-string-only.
const baseFiles=[];
for(const base of ['assets/templates','public/assets','public/wasm','public/monaco-iframe','lib'])for(const f of walk(path.join(host,base)))baseFiles.push({...f,path:`${base}/${f.path}`});
for(const rel of ['WebGAL_Terre.exe','public/index.html'])baseFiles.push({path:rel,bytes:fs.statSync(path.join(host,rel)).size,sha256:hash(path.join(host,rel))});
const adapter={schema:'webgal-attachment-host-adapter',schemaVersion:1,compatibilityVersion:1,id:'mygo3.2.1-terre4.6.4-community-028f20b8',sourceArchiveSha256:'028F20B89C931B714ED8278FF710AE6BD5EDE9A2574B9CF31147D7F72FD5DC8F',baseFileCount:baseFiles.length,baseFiles,operations:[],extraFilePolicy:'PRESERVE_AND_IGNORE_EXCEPT_MANAGED_TARGET_COLLISIONS',sdkPolicy:'DEPENDENCY_READONLY_USER_HOST_NOT_REDISTRIBUTED'};
const dependencies=new Set(),builds={schema:'webgal-attachment-builds',schemaVersion:1};
const optionalFont=p=>/\.(?:ttf|otf|woff2?)(?:\.gz|\.br)?$/i.test(p);
for(const kind of ['engine','creator','preview','editor']){
 const b=read(path.join(root,'build-output/evidence',kind+'-BUILD.json'));
 assert(b.revision===revision || (kind==='editor' && ['MYGO321-CANDIDATE.2','MYGO321-CANDIDATE.3','MYGO321-CANDIDATE.4'].includes(revision) && b.revision==='MYGO321-CANDIDATE.1') || (revision==='MYGO321-CANDIDATE.4' && kind!=='editor' && b.revision==='MYGO321-CANDIDATE.3'),'Unexpected build revision');
 const base=kind==='editor'?'public':'assets/templates/Derivative_Engine/MyGO_v3.2.1';
 const sources=[];for(const f of b.files){const source=path.join(root,'build-output',kind,f.path);assert.equal(hash(source),f.sha256);const baseline=path.join(host,base,f.path),pinned=fs.existsSync(baseline)&&hash(baseline)===f.sha256;
  if(optionalFont(f.path)){if(pinned)dependencies.add(`${base}/${f.path}`);continue;}
  sources.push({path:f.path,source:pinned?'PINNED_HOST_TEMPLATE':'PACKAGE_PAYLOAD'});
  if(pinned)dependencies.add(`${base}/${f.path}`);
  else{const rel=['creator','preview'].includes(kind)?`builds/${kind}/${f.path}`:`payload/host/${kind}/${f.path}`;copy(source,path.join(out,rel));if(kind==='engine'||kind==='editor')adapter.operations.push({path:`${base}/${f.path}`,action:'write',payloadPath:rel,postBytes:f.bytes,postSha256:f.sha256});}
 }
 builds[kind==='editor'?'terreEditor':kind]={kind,buildRevision:b.revision,files:b.files.filter(f=>!optionalFont(f.path)),optionalHostResources:b.files.filter(f=>optionalFont(f.path)).map(f=>({path:f.path,required:false})),sources,payloadFiles:sources.filter(x=>x.source==='PACKAGE_PAYLOAD').length,hostTemplateFiles:sources.filter(x=>x.source==='PINNED_HOST_TEMPLATE').length};
}
for(const rel of ['WebGAL_Terre.exe',...read(path.join(root,'build-output/evidence/backend-BUILD.json')).files.filter(f=>f.path!=='main.js'&&!f.path.endsWith('.LICENSE.txt')).map(f=>f.path)]){
 const source=path.join(root,'build-output/backend',rel),payload=`payload/host/backend/${rel}`;copy(source,path.join(out,payload));
 adapter.operations.push({path:rel,action:'write',payloadPath:payload,postBytes:fs.statSync(source).size,postSha256:hash(source)});
}
copy(path.join(root,'build-output/backend/main.js.LICENSE.txt'),path.join(out,'licenses/terre-backend-bundled.LICENSE.txt'));
// Unmodified executable/static support is an actual dependency. Sample game,
// author styles, unused old bundles, auxiliary sample fonts are only references.
for(const row of baseFiles)if(/^(?:assets\/templates\/Derivative_Engine\/MyGO_v3\.2\.1\/(?:lib\/|icons\/|webgal-engine\.json$|webgal-serviceworker\.js$|manifest\.json$)|public\/(?:wasm\/|monaco-iframe\/)|lib\/)/.test(row.path))dependencies.add(row.path);
const operations=new Map(adapter.operations.map(op=>[op.path.toLowerCase(),op]));assert.equal(operations.size,adapter.operations.length);
const baseMap=new Map(baseFiles.map(row=>[row.path.toLowerCase(),row]));
for(const row of baseFiles){row.role=operations.has(row.path.toLowerCase())?'MANAGED_TRANSFORM_TARGET':dependencies.has(row.path)?'DEPENDENCY_READONLY':'REFERENCE_ONLY';row.roleReason=row.role==='REFERENCE_ONLY'?'Unmodified release sample; not used as execution or ownership proof':row.role==='DEPENDENCY_READONLY'?'Shared static/runtime dependency retained on host':'Exact preimage approved for replacement by this complete adapter';}
for(const op of adapter.operations)op.role=baseMap.has(op.path.toLowerCase())?'MANAGED_TRANSFORM_TARGET':'PLUGIN_OWNED_NEW';
adapter.baseFiles.sort((a,b)=>a.path.localeCompare(b.path,'en'));adapter.operations.sort((a,b)=>a.path.localeCompare(b.path,'en'));
// Stable host identity does not include plugin revision-specific postimages.
adapter.fingerprintSha256=createHash('sha256').update(JSON.stringify(adapter.baseFiles)).digest('hex').toUpperCase();
for(const row of adapter.baseFiles.filter(row=>optionalFont(row.path))){row.role='REFERENCE_ONLY';row.roleReason='Optional host typography; no plugin copy, hash pin or ownership';}
adapter.compatibilityPolicyRevision='OPTIONAL_HOST_FONT_V1';
resolveHostCompatibilityPlan(adapter);
const exe=path.join(root,'build-output/backend/WebGAL_Terre.exe'),main=path.join(root,'build-output/backend/main.js');
builds.terreBackend={kind:'terre-backend-windows-x64',sourceEntrypoint:{path:'build-output/backend/main.js',bytes:fs.statSync(main).size,sha256:hash(main)},executable:{bytes:fs.statSync(exe).size,sha256:hash(exe)},pkg:{package:'@yao-pkg/pkg@6.4.1',target:'node22-win-x64',baseName:'node-v22.14.0-win-x64',baseSha256:'44B59E0E44E358ECFD6F3696FFACF67D0491C6037EB2CC5343813F70884523D7'}};
write(path.join(out,'manifests/host-adapter.json'),adapter);write(path.join(out,'manifests/builds.json'),builds);
const product=read(path.join(out,'manifests/product.json'));Object.assign(product,{releaseRevision:revision,status:'ISOLATED_TECHNICAL_CANDIDATE_PENDING_GUI',supportedHost:'MyGO 3.2.1 / Terre 4.6.4 community archive 028F20B8; adapter mygo3.2.1-terre4.6.4-community-028f20b8 only',publicBetaCandidateReady:false,realHostInstalled:false,guiValidated:false});write(path.join(out,'manifests/product.json'),product);
copy(path.join(root,'CANDIDATE_README.md'),path.join(out,'README.md'));
write(path.join(out,'manifests/release-files.json'),{schema:'webgal-attachment-release-files',schemaVersion:1,files:walk(out).filter(f=>f.path!=='manifests/release-files.json')});
write(path.join(root,'evidence/assembly.json'),{out,revision,roles:Object.fromEntries(['REFERENCE_ONLY','DEPENDENCY_READONLY','MANAGED_TRANSFORM_TARGET','PLUGIN_OWNED_NEW'].map(role=>[role,role==='PLUGIN_OWNED_NEW'?adapter.operations.filter(x=>x.role===role).length:baseFiles.filter(x=>x.role===role).length])),exe:builds.terreBackend.executable});
console.log(JSON.stringify({out,revision,files:walk(out).length}));
