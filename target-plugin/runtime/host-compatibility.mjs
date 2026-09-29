import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const roles = new Set(['REFERENCE_ONLY', 'DEPENDENCY_READONLY', 'MANAGED_TRANSFORM_TARGET', 'PLUGIN_OWNED_NEW']);
function fail(code, detail) { const error = new Error(`${code}:${detail}`); Object.assign(error, {code, detail}); throw error; }
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') ||
      value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$|[\x00-\x1f]/.test(p))) fail('HOST_ADAPTER_INVALID', value);
  return value;
}
/** One complete adapter supplies the plan; never combine per-file adapters. */
export function resolveHostCompatibilityPlan(adapter) {
  if (!Array.isArray(adapter.baseFiles) || !Array.isArray(adapter.operations) || adapter.baseFiles.length !== adapter.baseFileCount)
    fail('HOST_ADAPTER_INVALID', 'collections');
  const base = new Map(), operations = new Map();
  for (const row of adapter.baseFiles) {
    const key = relative(row.path).toLowerCase();
    if (base.has(key) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[A-F0-9]{64}$/.test(row.sha256)) fail('HOST_ADAPTER_INVALID', row.path);
    base.set(key, row);
  }
  for (const op of adapter.operations) {
    const key = relative(op.path).toLowerCase();
    if (operations.has(key) || !['write','retire'].includes(op.action)) fail('HOST_ADAPTER_INVALID', op.path);
    if (op.action === 'write') {
      relative(op.payloadPath);
      if (!Number.isSafeInteger(op.postBytes) || op.postBytes < 0 || !/^[A-F0-9]{64}$/.test(op.postSha256)) fail('HOST_ADAPTER_INVALID', op.path);
    } else if (!base.has(key)) fail('HOST_ADAPTER_INVALID', op.path);
    operations.set(key, op);
  }
  const explicit = adapter.compatibilityVersion === 1;
  if (adapter.compatibilityVersion !== undefined && !explicit) fail('HOST_ADAPTER_INVALID', 'compatibilityVersion');
  const references = [], dependencies = [];
  for (const [key, row] of base) {
    const role = explicit ? row.role : operations.has(key) ? 'MANAGED_TRANSFORM_TARGET' : 'DEPENDENCY_READONLY';
    if (!roles.has(role) || role === 'PLUGIN_OWNED_NEW' || (operations.has(key) !== (role === 'MANAGED_TRANSFORM_TARGET')))
      fail('HOST_ADAPTER_ROLE_INVALID', row.path);
    if (role === 'REFERENCE_ONLY') references.push(row);
    if (role === 'DEPENDENCY_READONLY') dependencies.push(row);
  }
  for (const [key, op] of operations) {
    const role = base.has(key) ? 'MANAGED_TRANSFORM_TARGET' : 'PLUGIN_OWNED_NEW';
    if (explicit && op.role !== role) fail('HOST_ADAPTER_ROLE_INVALID', op.path);
  }
  return { adapterId: adapter.id, base, operations, references, dependencies, explicit };
}

export function rejectHostDiagnostics(adapter, diagnostics) {
  if (!diagnostics.length) return;
  const error = new Error(`${diagnostics[0].code}:${diagnostics.map(row=>row.path).join(', ')}`);
  Object.assign(error,{code:diagnostics[0].code,detail:diagnostics.map(row=>row.path).join(', '),adapterId:adapter.id,diagnostics});
  throw error;
}

/** Launch uses the same readonly and managed contracts as lifecycle validation. */
export function verifyInstalledHostCompatibility(hostRoot, adapter, state) {
  const plan = resolveHostCompatibilityPlan(adapter);
  if (state.hostAdapterId !== adapter.id || state.hostFingerprintSha256 !== adapter.fingerprintSha256)
    fail('INSTALL_STATE_RELEASE_MISMATCH', 'adapter');
  if (!Array.isArray(state.hostFiles)) fail('INSTALL_STATE_RELEASE_MISMATCH','hostFiles');
  const owned = new Map(state.hostFiles.map(row => [relative(row.path).toLowerCase(), row]));
  if (owned.size !== state.hostFiles.length) fail('INSTALL_STATE_RELEASE_MISMATCH','duplicate hostFiles');
  if (owned.size !== plan.operations.size) fail('INSTALL_STATE_RELEASE_MISMATCH', 'operations');
  const rows = plan.dependencies.map(row => ({path:row.path, expected:{exists:true,bytes:row.bytes,sha256:row.sha256},code:'HOST_DEPENDENCY_INCOMPATIBLE'}));
  for (const [key, op] of plan.operations) {
    const row = owned.get(key);
    const expected = op.action === 'retire' ? {exists:false} : {exists:true,bytes:op.postBytes,sha256:op.postSha256};
    if (!row?.postimage || row.action !== op.action || row.postimage.exists !== expected.exists || (expected.exists && (row.postimage.bytes !== expected.bytes || row.postimage.sha256 !== expected.sha256)))
      fail('INSTALL_STATE_RELEASE_MISMATCH', op.path);
    rows.push({path:op.path,expected,code:'OWNED_FILE_DRIFT'});
  }
  const diagnostics=[];
  if (fs.lstatSync(hostRoot).isSymbolicLink()) fail('HOST_PATH_UNSAFE',hostRoot);
  for (const row of rows) {
    let target = path.resolve(hostRoot), missing = false;
    for (const part of relative(row.path).split('/')) {
      target = path.join(target,part);
      if (missing) continue;
      try { if(fs.lstatSync(target).isSymbolicLink()) fail('HOST_PATH_UNSAFE', row.path); }
      catch(error) { if(error.code !== 'ENOENT') throw error; missing = true; }
    }
    if (missing) { if(row.expected.exists) diagnostics.push({...row,actual:{exists:false}}); continue; }
    if (!row.expected.exists || !fs.statSync(target).isFile()) {diagnostics.push({...row,actual:{exists:true}});continue;}
    const data=fs.readFileSync(target),sha=createHash('sha256').update(data).digest('hex').toUpperCase();
    if(data.length!==row.expected.bytes||sha!==row.expected.sha256)diagnostics.push({...row,actual:{exists:true,bytes:data.length,sha256:sha}});
  }
  rejectHostDiagnostics(adapter,diagnostics);
  return plan;
}
