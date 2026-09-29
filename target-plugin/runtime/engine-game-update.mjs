import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectAbsolute,relativePath} from './terre-path-guard.mjs';
import {assertHostProcessesStopped} from './lifecycle-process-preflight.mjs';
import {planEngineLibrary,stageEngineLibrary,applyLibraryJournal,restoreLibraryJournal,verifyLibraryJournal} from './engine-library-sync.mjs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const save=(p,obj)=>{const temp=p+'.'+randomUUID()+'.tmp',fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,JSON.stringify(obj,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,p);};
const failure=(code,detail)=>{throw Object.assign(new Error(`${code}:${detail}`),{code,detail});};

export async function updateGameEngine({releaseRoot,requestPath,gameName,control}) {
  relativePath(gameName,{leaf:true});
  const {executeLifecycle}=await import(pathToFileURL(path.join(releaseRoot,'runtime/install-lifecycle.mjs')).href);
  return executeLifecycle({mode:'Validate',requestPath,releaseRoot,onValidated:async ({request}) => {
  inspectAbsolute(request.authorizedUserDataRoot,{kind:'directory'});
  assertHostProcessesStopped(request.hostRoot);
  const gameRoot=path.join(request.authorizedUserDataRoot,'games',gameName);
  inspectAbsolute(gameRoot,{kind:'directory'});
  const backupRoot=path.join(request.authorizedUserDataRoot,'engine-update-backups',gameName);
  inspectAbsolute(backupRoot,{missing:true,kind:'directory'});
  fs.mkdirSync(backupRoot,{recursive:true});
  for(const entry of fs.readdirSync(backupRoot,{withFileTypes:true})) {
    relativePath(entry.name,{leaf:true});
    if(!entry.isDirectory() || entry.isSymbolicLink()) failure('ENGINE_GAME_BACKUP_INVALID',entry.name);
    const txn=path.join(backupRoot,entry.name),file=path.join(txn,'journal.json');
    inspectAbsolute(txn,{kind:'directory'});
    if(!fs.existsSync(file)) continue; // Only unpublished backup preparation; no target writes occurred.
    const saved=read(file);
    if(saved.schema!=='webgal-game-engine-update' || saved.gameName!==gameName) failure('ENGINE_GAME_BACKUP_INVALID',entry.name);
    if(saved.status!=='PREPARED') continue;
    let complete=true;try{verifyLibraryJournal(request,saved.library,true);}catch{complete=false;}
    if(complete){saved.status='COMMITTED_RECOVERED';save(file,saved);continue;}
    const drift=restoreLibraryJournal(request,saved.library,txn);
    if(drift.length) failure('ENGINE_GAME_RECOVERY_CONFLICT',drift.join(','));
    saved.status='ROLLED_BACK_RECOVERED';save(file,saved);
  }
  const release={root:releaseRoot,adapter:read(path.join(releaseRoot,'manifests/host-adapter.json')),builds:read(path.join(releaseRoot,'manifests/builds.json'))};
  const plan=planEngineLibrary({request,release,mode:'upgrade',gameName});
  if(!plan.needsWrite) return {ok:true,code:'GAME_ENGINE_CURRENT',gameName,writesApplied:0};
  const txn=path.join(backupRoot,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  fs.mkdirSync(txn);
  const library=stageEngineLibrary(plan,txn,null,null);
  const journal={schema:'webgal-game-engine-update',schemaVersion:1,status:'PREPARED',gameName,library,at:new Date().toISOString()};
  const file=path.join(txn,'journal.json');save(file,journal);
  try {
    applyLibraryJournal(request,library,control);
    journal.status='COMMITTED';save(file,journal);
    return {ok:true,code:'GAME_ENGINE_UPDATED',gameName,writesApplied:plan.rows.filter(row=>JSON.stringify(row.before)!==JSON.stringify(row.desired)).length,backup:txn,
      contentPreserved:true,oldAssetsRetained:true,guiValidated:false,userAccepted:false};
  } catch(error) {
    const drift=restoreLibraryJournal(request,library,txn);
    if(drift.length) {error.recoveryRequired=true;error.externalDriftPreserved=drift;throw error;}
    journal.status='ROLLED_BACK';save(file,journal);error.rolledBack=true;throw error;
  }
  }});
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const releaseRoot=path.resolve(import.meta.dirname,'..');
  const requestPath=path.join(releaseRoot,'config/install-request.json');
  try {
    if(process.argv[2]==='--list') {
      const request=read(requestPath),games=path.join(request.authorizedUserDataRoot,'games');
      inspectAbsolute(games,{kind:'directory'});
      console.log(JSON.stringify(fs.readdirSync(games,{withFileTypes:true}).filter(row=>row.isDirectory()&&!row.isSymbolicLink()).map(row=>row.name)));
    } else console.log(JSON.stringify(await updateGameEngine({releaseRoot,requestPath,gameName:process.argv[2]})));
  } catch(error) { console.error(`更新失败，未覆盖用户剧情和素材。${error.code??error.message} ${error.detail??''}`);process.exitCode=1; }
}
