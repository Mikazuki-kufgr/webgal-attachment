import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectAbsolute, relativePath } from './terre-path-guard.mjs';

const prefix = 'assets/templates/Derivative_Engine/MyGO_v3.2.1/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const fail = (code, detail) => { throw Object.assign(new Error(`${code}:${detail}`), { code, detail }); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function file(root, rel) {
  relativePath(rel);
  const target = path.join(root, ...rel.split('/'));
  inspectAbsolute(target, { missing: true, kind: 'file' });
  return target;
}
function fact(target) {
  if (!fs.existsSync(target)) return { exists: false };
  inspectAbsolute(target, { kind: 'file' });
  const bytes = fs.readFileSync(target);
  return { exists: true, bytes: bytes.length, sha256: hash(bytes) };
}
export function engineLibraryRoot(request) {
  // This exact mapping is the Terre UserDataService contract; never accept an
  // arbitrary absolute destination from a release manifest or saved journal.
  const root = request.layout?.mode === 'legacy'
    ? path.join(request.hostRoot, prefix.slice(0,-1))
    : path.join(request.authorizedUserDataRoot, 'derivative-engines', 'MyGO_v3.2.1');
  inspectAbsolute(root, { missing: true, kind: 'directory' });
  return root;
}
function checkRoot(request, saved, gameName) {
  if(gameName !== undefined) relativePath(gameName,{leaf:true});
  const expected = gameName === undefined ? engineLibraryRoot(request)
    : path.join(request.authorizedUserDataRoot,'games',gameName);
  inspectAbsolute(expected,{missing:gameName === undefined,kind:'directory'});
  if (path.resolve(saved).toLowerCase() !== expected.toLowerCase()) fail('ENGINE_LIBRARY_ROOT_CHANGED', saved);
  return expected;
}

export function planEngineLibrary({ request, release, previous, mode, gameName }) {
  if (gameName !== undefined) relativePath(gameName,{leaf:true});
  const root = gameName === undefined ? engineLibraryRoot(request)
    : path.join(request.authorizedUserDataRoot,'games',gameName);
  inspectAbsolute(root,{missing:gameName === undefined,kind:'directory'});
  // Legacy Terre already reads the host template modified by the host journal.
  if (path.resolve(root).toLowerCase() === path.resolve(request.hostRoot, prefix).toLowerCase()) return null;
  const old = previous?.engineLibrary;
  if (old) checkRoot(request, old.root);
  const rows = [], prior = new Map((old?.files ?? []).map(row => [row.path,row]));
  const ops = mode === 'uninstall' ? [] : release.adapter.operations.filter(row => row.path.startsWith(prefix));
  const dependencies = [...new Set([
    ...(release.builds?.engine?.files ?? []).map(row=>row.path).filter(rel=>! /\.(ttf|otf|woff2?)(\.gz|\.br)?$/i.test(rel)),
    ...release.adapter.baseFiles.filter(row=>row.path.startsWith(prefix+'lib/')).map(row=>row.path.slice(prefix.length)),
  ])];
  if (mode !== 'uninstall') for(const rel of dependencies) {
    if(ops.some(op=>op.path===prefix+rel) || fs.existsSync(file(root,rel))) continue;
    const seedSource=file(request.hostRoot,prefix+rel),actual=fact(seedSource);
    if(!actual.exists) fail('ENGINE_LIBRARY_DEPENDENCY_MISSING',rel);
    ops.push({path:prefix+rel,postBytes:actual.bytes,postSha256:actual.sha256,seedSource,seed:true});
  }
  if (gameName === undefined && mode !== 'uninstall' && !fs.existsSync(file(root,'index.html')) && !old) {
    for (const base of release.adapter.baseFiles.filter(row => row.path.startsWith(prefix))) {
      if (ops.some(op => op.path === base.path) || fs.existsSync(file(root,base.path.slice(prefix.length)))) continue;
      const seedSource=file(request.hostRoot,base.path);
      if (!fs.existsSync(seedSource)) continue;
      const actual=fact(seedSource);
      ops.push({path:base.path,postBytes:actual.bytes,postSha256:actual.sha256,seedSource,seed:true});
    }
  }
  const next = new Map(ops.map(op => [op.path.slice(prefix.length),op]));
  for (const rel of new Set([...prior.keys(), ...next.keys()])) {
    const current = fact(file(root,rel)), before = prior.get(rel), op = next.get(rel);
    let desired, source;
    if (op) {
      desired = { exists: true, bytes: op.postBytes, sha256: op.postSha256 };
      source = op.seedSource ?? file(release.root, op.payloadPath);
      if (!same(fact(source),desired)) fail('ENGINE_LIBRARY_PAYLOAD_DRIFT', rel);
    } else {
      desired = before.original;
      source = desired.exists ? file(path.join(request.hostRoot,'.webgal-attachment'),before.backupPath) : null;
    }
    if (before) {
      if (!same(current,before.postimage) && !same(current,desired) &&
          !(mode === 'repair' && !current.exists) && !(mode === 'uninstall' && !current.exists))
        fail('ENGINE_LIBRARY_USER_MODIFICATION_CONFLICT', rel);
    } else if (current.exists && !same(current,desired)) {
      // Adopt only exact known baseline/previous managed output. Extra files and
      // unrelated template/game content are not part of this ownership boundary.
      const known = [
        ...release.adapter.baseFiles.filter(row => row.path === prefix+rel).map(row => ({exists:true,bytes:row.bytes,sha256:row.sha256})),
        ...(previous?.hostFiles ?? []).filter(row => row.path === prefix+rel).flatMap(row => [row.original,row.postimage]),
        ...(release.adapter.engineLibraryKnownPreimages ?? []).filter(row => row.path === rel).map(row => ({exists:true,bytes:row.bytes,sha256:row.sha256})),
      ];
      if (!known.some(item => same(item,current))) fail('ENGINE_LIBRARY_USER_MODIFICATION_CONFLICT',rel);
    }
    rows.push({path:rel,before:current,desired,source,original:before?.original ?? current,
      originalBackup:before?.backupPath ?? null, seed:op?.seed ?? false});
  }
  return { root, gameName, dependencies, rows, needsWrite: rows.some(row => !same(row.before,row.desired)) };
}

export function validateEngineLibrary(request, state) {
  if (!state.engineLibrary) fail('ENGINE_LIBRARY_SYNC_REQUIRED', '运行修复以更新新建游戏模板');
  const root = checkRoot(request,state.engineLibrary.root);
  for (const row of state.engineLibrary.files)
    if (!same(fact(file(root,row.path)),row.postimage)) fail('ENGINE_LIBRARY_VALIDATION_FAILED',row.path);
  for(const rel of state.engineLibrary.dependencies ?? [])
    if(!fact(file(root,rel)).exists) fail('ENGINE_LIBRARY_DEPENDENCY_MISSING',rel);
}

export function stageEngineLibrary(plan, txnRoot, stateStage, previousStateRoot) {
  if (!plan) return null;
  const rows = plan.rows.map((row,index) => {
    const backupPath = `backups/engine-library/${hash(Buffer.from(row.path))}.bin`;
    if (stateStage && row.original.exists) {
      const bytes = fs.readFileSync(row.originalBackup
        ? file(previousStateRoot,row.originalBackup) : file(plan.root,row.path));
      if (!same({exists:true,bytes:bytes.length,sha256:hash(bytes)},row.original)) fail('ENGINE_LIBRARY_BACKUP_DRIFT',row.path);
      const dest = file(stateStage,backupPath); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,bytes,{flag:'wx'});
    }
    const rollbackPath = `rollback/engine-library/${index}.bin`;
    if (row.before.exists) {
      const dest = file(txnRoot,rollbackPath); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(file(plan.root,row.path),dest);
      if (!same(fact(dest),row.before)) fail('ENGINE_LIBRARY_CONCURRENT_DRIFT',row.path);
    }
    return { path:row.path,before:row.before,desired:row.desired,source:row.source,rollbackPath,
      original:row.original,backupPath:row.original.exists ? backupPath : null,seed:row.seed };
  });
  return { root:plan.root, gameName:plan.gameName, dependencies:plan.dependencies, rows };
}

function atomicWrite(target, bytes) {
  fs.mkdirSync(path.dirname(target),{recursive:true});
  // Temp is adjacent to its destination: user data and host may be on different drives.
  const temp = `${target}.attachment-${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp,'wx');
    try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp,target);
  } finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function verifyLibraryJournal(request, journal, after = false) {
  if (!journal) return;
  const root = checkRoot(request,journal.root,journal.gameName);
  for(const row of journal.rows) if (!same(fact(file(root,row.path)),after ? row.desired : row.before))
    fail('ENGINE_LIBRARY_CONCURRENT_DRIFT',row.path);
}
export function applyLibraryJournal(request, journal, control) {
  if (!journal) return;
  verifyLibraryJournal(request,journal);
  const root = checkRoot(request,journal.root,journal.gameName);
  let count = 0;
  // Publish index last, so a partially copied new bundle cannot become the entry.
  for (const row of [...journal.rows].sort((a,b) => Number(a.path==='index.html')-Number(b.path==='index.html'))) {
    const target = file(root,row.path);
    if (!same(fact(target),row.before)) fail('ENGINE_LIBRARY_CONCURRENT_DRIFT',row.path);
    if (!same(row.before,row.desired)) {
      if (row.desired.exists) {
        const bytes = fs.readFileSync(row.source);
        if (!same({exists:true,bytes:bytes.length,sha256:hash(bytes)},row.desired)) fail('ENGINE_LIBRARY_PAYLOAD_DRIFT',row.path);
        atomicWrite(target,bytes);
      } else if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    if (++count===1 && control?.point==='after-first-engine-library') {
      if(control.hard) process.exit(86);
      fail('INJECTED_TRANSACTION_FAILURE','after-first-engine-library');
    }
  }
  verifyLibraryJournal(request,journal,true);
}
export function restoreLibraryJournal(request,journal,txnRoot) {
  if(!journal) return [];
  const root = checkRoot(request,journal.root,journal.gameName), drift=[];
  for (const row of [...journal.rows].reverse()) {
    const target=file(root,row.path),current=fact(target);
    if(same(current,row.before)) continue;
    if(!same(current,row.desired) && current.exists) {drift.push(`engine-library/${row.path}`);continue;}
    if(row.before.exists) {
      const backup=file(txnRoot,row.rollbackPath);
      if(!same(fact(backup),row.before)) fail('ENGINE_LIBRARY_BACKUP_DRIFT',row.path);
      atomicWrite(target,fs.readFileSync(backup));
    } else if(fs.existsSync(target)) fs.unlinkSync(target);
    if(!same(fact(target),row.before)) fail('ENGINE_LIBRARY_ROLLBACK_FAILED',row.path);
  }
  return drift;
}
