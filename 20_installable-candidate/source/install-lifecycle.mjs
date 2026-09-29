import { planEngineLibrary, validateEngineLibrary, stageEngineLibrary, verifyLibraryJournal, applyLibraryJournal, restoreLibraryJournal } from './engine-library-sync.mjs';
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { errorDiagnostic } from './lifecycle-diagnostics.mjs';
import { assertHostProcessesStopped } from './lifecycle-process-preflight.mjs';
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTerreProjectAccess, discoverTerreLayout } from "./terre-project-access.mjs";
import { inspectAbsolute } from "./terre-path-guard.mjs";
import { resolveHostCompatibilityPlan, rejectHostDiagnostics } from './host-compatibility.mjs';
import { lifecycleUserFailureMessage, lifecycleUserSuccessMessage, lifecycleHumanLines } from "./lifecycle-user-messages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_ROOT = path.resolve(HERE, "..");
const STATE_NAME = ".webgal-attachment";
const STATE_FILE = "install-state.json";
const MANAGER_NAME = "WebGAL-Attachment-Manager";
const TXN_PREFIX = ".webgal-attachment.txn-";
const LOCK_NAME = ".webgal-attachment.lifecycle.lock";
const SCHEMA = "webgal-attachment-install-state";
const sha = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

class LifecycleError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}
const fail = (code, detail) => { throw new LifecycleError(code, detail); };

function safeRelative(input, { leaf = false } = {}) {
  if (typeof input !== "string" || !input || input.includes("\\")) fail("PACKAGE_PATH_INVALID", String(input));
  if (path.posix.isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("//") || input.includes(":"))
    fail("PACKAGE_PATH_INVALID", input);
  const parts = input.split("/");
  if (leaf && parts.length !== 1) fail("PACKAGE_PATH_INVALID", input);
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  for (const part of parts) {
    if (!part || part === "." || part === ".." || /[. ]$/.test(part) || reserved.test(part) || /[\x00-\x1f]/.test(part))
      fail("PACKAGE_PATH_INVALID", input);
  }
  return input;
}

function absoluteDirectory(input, { missing = false } = {}) {
  if (typeof input !== "string" || !path.isAbsolute(input)) fail("ABSOLUTE_DIRECTORY_REQUIRED", String(input));
  const resolved = path.resolve(input);
  if (!missing) {
    let stat;
    try { stat = fs.lstatSync(resolved); } catch { fail("DIRECTORY_NOT_FOUND", resolved); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("DIRECTORY_TYPE_INVALID", resolved);
  }
  return resolved;
}

function under(root, relative, { missing = true } = {}) {
  relative = safeRelative(relative);
  const target = path.resolve(root, ...relative.split("/"));
  const prefix = `${path.resolve(root)}${path.sep}`.toLowerCase();
  if (!target.toLowerCase().startsWith(prefix)) fail("PATH_ESCAPES_ROOT", relative);
  let cursor = path.dirname(target);
  while (cursor.toLowerCase().startsWith(prefix)) {
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PATH_COMPONENT_UNSAFE", cursor);
    }
    if (samePath(cursor, root)) break;
    cursor = path.dirname(cursor);
  }
  if (!missing && !fs.existsSync(target)) fail("FILE_NOT_FOUND", relative);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) fail("PATH_COMPONENT_UNSAFE", relative);
  return target;
}

function durableWrite(file, bytes, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, exclusive ? "wx" : "w");
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function readJson(file, code = "JSON_INVALID") {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail(code, file); }
  return value;
}

function hashFile(file) { return sha(fs.readFileSync(file)); }
function fileFact(file) {
  if (!fs.existsSync(file)) return { exists: false };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("FILE_TYPE_UNSAFE", file);
  return { exists: true, bytes: stat.size, sha256: hashFile(file) };
}
function equalFact(a, b) {
  return Boolean(a?.exists) === Boolean(b?.exists) && (!a?.exists || (a.bytes === b.bytes && a.sha256 === b.sha256));
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

function inspectLifecycleCoordination(hostRoot) {
  const lockPath = path.join(hostRoot, LOCK_NAME), gatePath = `${lockPath}.acquire`;
  if (fs.existsSync(gatePath)) {
    let gate;
    try { gate = readJson(gatePath, "LIFECYCLE_GATE_INVALID"); }
    catch { fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", gatePath); }
    if (gate?.schema !== "webgal-attachment-lifecycle-gate" || gate.schemaVersion !== 1 ||
        typeof gate.token !== "string" || !Number.isSafeInteger(gate.pid) || gate.pid <= 0 ||
        typeof gate.hostRoot !== "string" || !samePath(gate.hostRoot, hostRoot))
      fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", gatePath);
    if (processIsAlive(gate.pid)) fail("LIFECYCLE_BUSY", String(gate.pid));
    fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", gatePath);
  }
  if (!fs.existsSync(lockPath)) return;
  let owner;
  try { owner = readJson(lockPath, "LIFECYCLE_LOCK_INVALID"); }
  catch { fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath); }
  if (owner?.schema !== "webgal-attachment-lifecycle-lock" || ![1, 2].includes(owner.schemaVersion) ||
      typeof owner.token !== "string" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.hostRoot !== "string" || !samePath(owner.hostRoot, hostRoot))
    fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath);
  if (processIsAlive(owner.pid)) fail("LIFECYCLE_BUSY", String(owner.pid));
  if (owner.schemaVersion !== 2) fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath);
}

function acquireLifecycleGate(hostRoot, lockPath, token, control = null) {
  const gatePath = `${lockPath}.acquire`;
  let fd;
  try {
    fd = fs.openSync(gatePath, "wx");
    const record = { schema: "webgal-attachment-lifecycle-gate", schemaVersion: 1, token, pid: process.pid,
      hostRoot, acquiredAt: new Date().toISOString() };
    fs.writeFileSync(fd, jsonBytes(record)); fs.fsyncSync(fd);
    if (Number.isSafeInteger(control?.gateWaitMs) && control.gateWaitMs > 0)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(control.gateWaitMs, 30000));
    return { fd, gatePath, token, hostRoot };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(gatePath); } catch {} }
    if (error?.code !== "EEXIST") throw error;
    let owner;
    try { owner = readJson(gatePath, "LIFECYCLE_GATE_INVALID"); }
    catch { fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", gatePath); }
    if (owner?.schema !== "webgal-attachment-lifecycle-gate" || owner.schemaVersion !== 1 ||
        typeof owner.token !== "string" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
        typeof owner.hostRoot !== "string" || !samePath(owner.hostRoot, hostRoot))
      fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", gatePath);
    if (processIsAlive(owner.pid)) fail("LIFECYCLE_BUSY", String(owner.pid));
    fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", gatePath);
  }
}

function releaseLifecycleGate(gate) {
  try { fs.closeSync(gate.fd); } catch {}
  let owner;
  try { owner = readJson(gate.gatePath, "LIFECYCLE_GATE_INVALID"); }
  catch { fail("LIFECYCLE_LOCK_OWNERSHIP_LOST", gate.gatePath); }
  if (owner.token !== gate.token || owner.pid !== process.pid || !samePath(owner.hostRoot, gate.hostRoot))
    fail("LIFECYCLE_LOCK_OWNERSHIP_LOST", gate.gatePath);
  fs.unlinkSync(gate.gatePath);
}

function acquireLifecycleLock(hostRoot, control = null) {
  const lockPath = path.join(hostRoot, LOCK_NAME), token = randomUUID();
  if (typeof control?.onLifecycleLockAttempt === "function") control.onLifecycleLockAttempt(lockPath);
  const gate = acquireLifecycleGate(hostRoot, lockPath, token, control);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        const record = { schema: "webgal-attachment-lifecycle-lock", schemaVersion: 2, token, pid: process.pid,
          hostRoot, acquiredAt: new Date().toISOString() };
        try { fs.writeFileSync(fd, jsonBytes(record)); fs.fsyncSync(fd); }
        catch (error) { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(lockPath); } catch {} throw error; }
        return { fd, lockPath, token };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let owner;
        try { owner = readJson(lockPath, "LIFECYCLE_LOCK_INVALID"); }
        catch { fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath); }
        if (owner?.schema !== "webgal-attachment-lifecycle-lock" || ![1, 2].includes(owner.schemaVersion) ||
            typeof owner.token !== "string" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
            typeof owner.hostRoot !== "string" || !samePath(owner.hostRoot, hostRoot))
          fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath);
        if (processIsAlive(owner.pid)) fail("LIFECYCLE_BUSY", String(owner.pid));
        if (owner.schemaVersion !== 2) fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath);
        const stale = `${lockPath}.stale-${token}`;
        try {
          fs.renameSync(lockPath, stale);
          const moved = readJson(stale, "LIFECYCLE_LOCK_INVALID");
          if (moved.schema !== owner.schema || moved.schemaVersion !== owner.schemaVersion ||
              moved.token !== owner.token || moved.pid !== owner.pid || !samePath(moved.hostRoot, owner.hostRoot))
            fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", stale);
          fs.rmSync(stale, { force: true });
        } catch (stealError) {
          if (["ENOENT", "EEXIST"].includes(stealError?.code)) continue;
          if (stealError instanceof LifecycleError) throw stealError;
          fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath);
        }
      }
    }
    fail("LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", lockPath);
  } finally {
    releaseLifecycleGate(gate);
  }
}

function releaseLifecycleLock(lock) {
  try { fs.closeSync(lock.fd); } catch {}
  let owner;
  try { owner = readJson(lock.lockPath, "LIFECYCLE_LOCK_INVALID"); }
  catch { fail("LIFECYCLE_LOCK_OWNERSHIP_LOST", lock.lockPath); }
  if (owner.token !== lock.token || owner.pid !== process.pid) fail("LIFECYCLE_LOCK_OWNERSHIP_LOST", lock.lockPath);
  fs.unlinkSync(lock.lockPath);
}

function walkFiles(root, { exclude = new Set() } = {}) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  const visit = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (exclude.has(rel)) continue;
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail("TREE_LINK_FORBIDDEN", rel);
      if (stat.isDirectory()) visit(full, rel);
      else if (stat.isFile()) rows.push({ path: rel, bytes: stat.size, sha256: hashFile(full) });
      else fail("TREE_ENTRY_FORBIDDEN", rel);
    }
  };
  visit(root);
  return rows;
}
function rowsDigest(rows) { return sha(jsonBytes(rows.map((r) => ({ path: r.path, bytes: r.bytes, sha256: r.sha256 })))); }
function treeDigest(root, exclude = new Set()) { return rowsDigest(walkFiles(root, { exclude })); }

function verifyRows(root, rows, { exact = false, allowedExtra = [] } = {}) {
  if (!Array.isArray(rows)) fail("MANIFEST_INVALID");
  const expected = new Map();
  for (const row of rows) {
    const rel = safeRelative(row.path);
    const key = rel.toLowerCase();
    if (expected.has(key) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[A-F0-9]{64}$/.test(row.sha256))
      fail("MANIFEST_INVALID", rel);
    expected.set(key, row);
    const fact = fileFact(under(root, rel, { missing: false }));
    if (!equalFact(fact, { exists: true, bytes: row.bytes, sha256: row.sha256 })) fail("MANIFEST_HASH_MISMATCH", rel);
  }
  if (exact) {
    const allowed = new Set(allowedExtra.map((x) => x.toLowerCase()));
    for (const row of walkFiles(root))
      if (!expected.has(row.path.toLowerCase()) && !allowed.has(row.path.toLowerCase())) fail("MANIFEST_EXTRA_FILE", row.path);
  }
  return rowsDigest(rows);
}

function loadRelease(releaseRoot = RELEASE_ROOT, { strict = true } = {}) {
  releaseRoot = absoluteDirectory(releaseRoot);
  const manifestPath = path.join(releaseRoot, "manifests", "release-files.json");
  const manifest = readJson(manifestPath, "RELEASE_MANIFEST_INVALID");
  if (manifest.schema !== "webgal-attachment-release-files" || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files))
    fail("RELEASE_MANIFEST_INVALID");
  const manifestSha256 = hashFile(manifestPath);
  verifyRows(releaseRoot, manifest.files, { exact: strict, allowedExtra: ["manifests/release-files.json"] });
  const product = readJson(path.join(releaseRoot, "manifests", "product.json"), "PRODUCT_MANIFEST_INVALID");
  const adapter = readJson(path.join(releaseRoot, "manifests", "host-adapter.json"), "HOST_ADAPTER_INVALID");
  const builds = readJson(path.join(releaseRoot, "manifests", "builds.json"), "BUILD_MANIFEST_INVALID");
  if (product.schema !== "webgal-attachment-product" || product.schemaVersion !== 1 ||
      adapter.schema !== "webgal-attachment-host-adapter" || adapter.schemaVersion !== 1 ||
      builds.schema !== "webgal-attachment-builds" || builds.schemaVersion !== 1)
    fail("RELEASE_METADATA_INVALID");
  return { root: releaseRoot, manifest, manifestSha256, product, adapter, builds };
}

function statePaths(hostRoot) {
  const stateRoot = path.join(hostRoot, STATE_NAME);
  return { stateRoot, statePath: path.join(stateRoot, STATE_FILE), managerRoot: path.join(hostRoot, MANAGER_NAME) };
}
function loadState(hostRoot, { optional = true } = {}) {
  const paths = statePaths(hostRoot);
  if (!fs.existsSync(paths.statePath)) {
    if (optional) return { paths, state: null };
    fail("PRODUCT_NOT_INSTALLED");
  }
  const state = readJson(paths.statePath, "INSTALL_STATE_INVALID");
  if (state.schema !== SCHEMA || state.schemaVersion !== 1 || !["INSTALLED", "UNINSTALLED"].includes(state.status) ||
      !samePath(state.hostRoot, hostRoot) || !samePath(state.managerRoot, paths.managerRoot)) fail("INSTALL_STATE_INVALID");
  return { paths, state };
}

function loadRequest(requestPath, releaseRoot, { detachedUserContext = false } = {}) {
  if (!requestPath) {
    const fallback = path.join(releaseRoot, "config", "install-request.json");
    if (fs.existsSync(fallback)) requestPath = fallback;
  }
  if (!requestPath || !path.isAbsolute(requestPath) || !fs.existsSync(requestPath)) fail("INSTALL_REQUEST_REQUIRED");
  const request = readJson(requestPath, "INSTALL_REQUEST_INVALID");
  if (request.schema !== "webgal-attachment-install-request" || request.schemaVersion !== 1 ||
      !Array.isArray(request.projectGrants) || (request.authoringTemplateProject != null && typeof request.authoringTemplateProject !== "string"))
    fail("INSTALL_REQUEST_INVALID");
  request.hostRoot = absoluteDirectory(request.hostRoot);
  request.hostHomeRoot = absoluteDirectory(request.hostHomeRoot, { missing: detachedUserContext });
  request.authorizedUserDataRoot = absoluteDirectory(request.authorizedUserDataRoot, { missing: true });
  request.authorizedAuthoringRoot = absoluteDirectory(request.authorizedAuthoringRoot, { missing: true });
  if (!detachedUserContext) {
    try {
      const authoringRoot = inspectAbsolute(request.authorizedAuthoringRoot, { missing: true, kind: "directory" });
      request.authorizedAuthoringRoot = authoringRoot.path;
      if (!authoringRoot.exists) inspectAbsolute(path.dirname(authoringRoot.path), { kind: "directory" });
    } catch (error) {
      fail("AUTHORING_ROOT_PREFLIGHT_INVALID", error?.code ?? "PATH_GUARD_FAILED");
    }
  }
  request.authoringTemplateProject ||= "";
  if (request.authoringTemplateProject) safeRelative(request.authoringTemplateProject, { leaf: true });
  for (const grant of request.projectGrants) {
    safeRelative(grant.name, { leaf: true });
    if (!["read", "attachment-write"].includes(grant.access)) fail("INSTALL_REQUEST_INVALID");
  }
  if (request.authoringTemplateProject && !request.projectGrants.some((g) => g.name.toLowerCase() === request.authoringTemplateProject.toLowerCase()))
    fail("AUTHORING_TEMPLATE_PROJECT_NOT_GRANTED");
  const expectedManager = path.join(request.hostRoot, MANAGER_NAME);
  if (request.managementRoot && !samePath(request.managementRoot, expectedManager)) fail("MANAGEMENT_ROOT_NOT_AUTHORIZED");
  request.managementRoot = expectedManager;
  const layout = detachedUserContext ? null : discoverTerreLayout({ installRoot: request.hostRoot, hostHomeRoot: request.hostHomeRoot });
  if (layout && !samePath(layout.resolvedUserDataRoot, request.authorizedUserDataRoot)) fail("TERRE_USER_DATA_NOT_AUTHORIZED");
  if (!samePath(request.authorizedAuthoringRoot, path.join(request.hostRoot, "WebGAL-Attachment-Authoring")) && !request.allowCustomAuthoringRoot)
    fail("AUTHORING_ROOT_NOT_AUTHORIZED");
  return { request, requestPath: path.resolve(requestPath), layout };
}

function storedRequest(request) {
  return {
    schema: "webgal-attachment-install-request", schemaVersion: 1,
    hostRoot: path.resolve(request.hostRoot), hostHomeRoot: path.resolve(request.hostHomeRoot),
    authorizedUserDataRoot: path.resolve(request.authorizedUserDataRoot),
    authorizedAuthoringRoot: path.resolve(request.authorizedAuthoringRoot),
    authoringTemplateProject: request.authoringTemplateProject,
    projectGrants: request.projectGrants.map((row) => ({ name: row.name, access: row.access }))
      .sort((a, b) => `${a.name.toLowerCase()}\0${a.access}`.localeCompare(`${b.name.toLowerCase()}\0${b.access}`, "en")),
    managementRoot: path.join(path.resolve(request.hostRoot), MANAGER_NAME),
    ...(request.allowCustomAuthoringRoot ? { allowCustomAuthoringRoot: true } : {}),
  };
}

function requestIdentityDigest(request) {
  const value = storedRequest(request);
  for (const key of ["hostRoot", "hostHomeRoot", "authorizedUserDataRoot", "authorizedAuthoringRoot", "managementRoot"])
    value[key] = value[key].toLowerCase();
  value.authoringTemplateProject = value.authoringTemplateProject.toLowerCase();
  value.projectGrants = value.projectGrants.map((row) => ({ name: row.name.toLowerCase(), access: row.access }));
  return sha(jsonBytes(value));
}

function expectedBaseMap(adapter) {
  resolveHostCompatibilityPlan(adapter);
  if (!Array.isArray(adapter.baseFiles) || adapter.baseFiles.length !== adapter.baseFileCount) fail("HOST_ADAPTER_INVALID");
  const map = new Map();
  for (const row of adapter.baseFiles) {
    safeRelative(row.path);
    if (map.has(row.path.toLowerCase())) fail("HOST_ADAPTER_INVALID");
    map.set(row.path.toLowerCase(), { exists: true, bytes: row.bytes, sha256: row.sha256 });
  }
  return map;
}
function normalizeOperations(adapter) {
  if (!Array.isArray(adapter.operations)) fail("HOST_ADAPTER_INVALID");
  const base = expectedBaseMap(adapter), seen = new Set();
  return adapter.operations.map((row) => {
    const relative = safeRelative(row.path), key = relative.toLowerCase();
    if (seen.has(key) || !["write", "retire"].includes(row.action)) fail("HOST_ADAPTER_INVALID", relative);
    seen.add(key);
    const original = base.get(key) ?? { exists: false };
    if (row.action === "write") {
      safeRelative(row.payloadPath);
      if (!Number.isSafeInteger(row.postBytes) || !/^[A-F0-9]{64}$/.test(row.postSha256)) fail("HOST_ADAPTER_INVALID", relative);
      return { path: relative, action: row.action, payloadPath: row.payloadPath, original,
        postimage: { exists: true, bytes: row.postBytes, sha256: row.postSha256 } };
    }
    if (!original.exists) fail("HOST_ADAPTER_INVALID", relative);
    return { path: relative, action: row.action, original, postimage: { exists: false } };
  });
}

function expectedInstalledFact(adapter, relativePath) {
  const relative = safeRelative(relativePath);
  const operation = normalizeOperations(adapter).find((row) => row.path.toLowerCase() === relative.toLowerCase());
  if (operation) {
    if (!operation.postimage.exists) fail("HOST_ADAPTER_REQUIRED_FILE_RETIRED", relative);
    return operation.postimage;
  }
  const base = expectedBaseMap(adapter).get(relative.toLowerCase());
  if (!base?.exists) fail("HOST_ADAPTER_REQUIRED_FILE_MISSING", relative);
  return base;
}

function validateStateOperationIdentity(state, adapter) {
  if (!Array.isArray(state.hostFiles)) fail("INSTALL_STATE_INVALID");
  const expected = normalizeOperations(adapter), actual = new Map();
  for (const row of state.hostFiles) {
    if (!row || typeof row.path !== "string" || actual.has(row.path.toLowerCase())) fail("INSTALL_STATE_INVALID");
    actual.set(row.path.toLowerCase(), row);
  }
  if (actual.size !== expected.length) fail("INSTALL_STATE_RELEASE_MISMATCH", "hostFiles");
  for (const op of expected) {
    const row = actual.get(op.path.toLowerCase());
    if (!row || row.path !== op.path || row.action !== op.action || !equalFact(row.postimage, op.postimage))
      fail("INSTALL_STATE_RELEASE_MISMATCH", op.path);
  }
}

function validateStateAgainstRelease(release, state) {
  if (state.productVersion !== release.product.version || state.releaseRevision !== release.product.releaseRevision ||
      state.releaseManifestSha256 !== release.manifestSha256 || state.hostAdapterId !== release.adapter.id ||
      state.hostFingerprintSha256 !== release.adapter.fingerprintSha256)
    fail("INSTALL_STATE_RELEASE_MISMATCH");
  validateStateOperationIdentity(state, release.adapter);
}

function validateStateAgainstInstalledManager(paths, state) {
  const releaseManifest = path.join(paths.managerRoot, "manifests", "release-files.json");
  const product = readJson(path.join(paths.managerRoot, "manifests", "product.json"), "MANAGEMENT_PRODUCT_INVALID");
  const adapter = readJson(path.join(paths.managerRoot, "manifests", "host-adapter.json"), "MANAGEMENT_ADAPTER_INVALID");
  if (hashFile(releaseManifest) !== state.releaseManifestSha256 || product.version !== state.productVersion ||
      product.releaseRevision !== state.releaseRevision || adapter.id !== state.hostAdapterId ||
      adapter.fingerprintSha256 !== state.hostFingerprintSha256)
    fail("INSTALL_STATE_MANAGER_IDENTITY_MISMATCH");
  validateStateOperationIdentity(state, adapter);
  const installedRequest = readJson(path.join(paths.managerRoot, "config", "install-request.json"), "MANAGEMENT_REQUEST_INVALID");
  if (requestIdentityDigest(installedRequest) !== state.installRequestSha256) fail("INSTALL_STATE_MANAGER_REQUEST_MISMATCH");
  return { product, adapter, installedRequest };
}

function validateRequestedIdentity(request, state) {
  if (requestIdentityDigest(request) !== state.installRequestSha256)
    fail("INSTALL_CONFIGURATION_CHANGED_REQUIRES_RECONFIGURE");
}

function validateFreshHost(hostRoot, adapter) {
  const base = expectedBaseMap(adapter);
  const diagnostics=[];
  for (const row of resolveHostCompatibilityPlan(adapter).dependencies) {
    const fact = fileFact(under(hostRoot, row.path));
    if (!equalFact(fact, base.get(row.path.toLowerCase()))) diagnostics.push({code:'HOST_DEPENDENCY_INCOMPATIBLE',path:row.path,role:'DEPENDENCY_READONLY',expected:base.get(row.path.toLowerCase()),actual:fact});
  }
  for (const op of normalizeOperations(adapter)) {
    const fact = fileFact(under(hostRoot, op.path));
    if (!equalFact(fact, op.original)) diagnostics.push({code:'HOST_FINGERPRINT_MISMATCH',path:op.path,role:op.original.exists?'MANAGED_TRANSFORM_TARGET':'PLUGIN_OWNED_NEW',expected:op.original,actual:fact});
  }
  rejectHostDiagnostics(adapter,diagnostics);
  return adapter.fingerprintSha256;
}

function validateInstalledManager(paths, state, { allowMissing = false, allowCreatorSession = false } = {}) {
  const manifestPath = path.join(paths.managerRoot, "config", "installed-files.json");
  if (!fs.existsSync(manifestPath)) {
    if (allowMissing) return { missing: true, missingFiles: ["config/installed-files.json"] };
    fail("MANAGEMENT_TOOL_MISSING");
  }
  if (hashFile(manifestPath) !== state.managerManifestSha256) fail("MANAGEMENT_MANIFEST_DRIFT");
  const manifest = readJson(manifestPath, "MANAGEMENT_MANIFEST_INVALID");
  const missing = [];
  for (const row of manifest.files) {
    const file = under(paths.managerRoot, row.path);
    if (!fs.existsSync(file)) { missing.push(row.path); continue; }
    if (!equalFact(fileFact(file), { exists: true, bytes: row.bytes, sha256: row.sha256 })) fail("MANAGEMENT_TOOL_DRIFT", row.path);
  }
  const actual = walkFiles(paths.managerRoot).map((x) => x.path.toLowerCase());
  const expected = new Set(manifest.files.map((x) => x.path.toLowerCase()).concat(["config/installed-files.json"]));
  for (const rel of actual) if (!expected.has(rel)) {
    if (rel === "creator-session-v1.json") {
      if (allowCreatorSession) continue;
      fail("PRODUCT_CREATOR_SESSION_ACTIVE");
    }
    fail("MANAGEMENT_TOOL_EXTRA_FILE", rel);
  }
  if (missing.length && !allowMissing) fail("MANAGEMENT_TOOL_MISSING", missing[0]);
  return { missing: missing.length > 0, missingFiles: missing, manifest };
}

function removeDeadCreatorSessionForLifecycle(hostRoot) {
  const paths = statePaths(hostRoot);
  const sessionPath = path.join(paths.managerRoot, "creator-session-v1.json");
  if (!fs.existsSync(sessionPath)) return false;

  const configPath = path.join(paths.managerRoot, "config", "creator-launch.json");
  let sessionBytes, configBytes, stateBytes, session, config, state;
  try {
    sessionBytes = fs.readFileSync(sessionPath);
    configBytes = fs.readFileSync(configPath);
    stateBytes = fs.readFileSync(paths.statePath);
    session = JSON.parse(sessionBytes.toString("utf8").replace(/^\uFEFF/, ""));
    config = JSON.parse(configBytes.toString("utf8").replace(/^\uFEFF/, ""));
    state = JSON.parse(stateBytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }

  if (state.schema !== SCHEMA || state.schemaVersion !== 1 || state.status !== "INSTALLED" ||
      typeof state.hostRoot !== "string" || typeof state.managerRoot !== "string" ||
      !samePath(state.hostRoot, hostRoot) || !samePath(state.managerRoot, paths.managerRoot))
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  const identity = config.installationIdentity;
  if (config.schema !== "webgal-attachment-creator-launch" || config.schemaVersion !== 1 ||
      typeof config.managementRoot !== "string" || !samePath(config.managementRoot, paths.managerRoot) ||
      typeof config.statePath !== "string" || !samePath(config.statePath, sessionPath) ||
      identity?.schema !== "webgal-attachment-installed-launch-identity" || identity.schemaVersion !== 1 ||
      identity.productVersion !== state.productVersion || identity.releaseRevision !== state.releaseRevision ||
      identity.releaseManifestSha256 !== state.releaseManifestSha256 || identity.hostAdapterId !== state.hostAdapterId ||
      identity.hostFingerprintSha256 !== state.hostFingerprintSha256 ||
      identity.installRequestSha256 !== state.installRequestSha256 || identity.managerGenerationId !== state.managerGenerationId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.managerGenerationId ?? ""))
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  if (session.schema !== "webgal-attachment-creator-session" || session.schemaVersion !== 1 ||
      typeof session.configPath !== "string" || !samePath(session.configPath, configPath) ||
      typeof session.hostRoot !== "string" || !samePath(session.hostRoot, hostRoot) ||
      session.managerGenerationId !== state.managerGenerationId ||
      !Number.isSafeInteger(session.pid) || session.pid <= 0)
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");

  validateInstalledManager(paths, state, { allowCreatorSession: true });
  validateStateAgainstInstalledManager(paths, state);
  if (processIsAlive(session.pid)) fail("PRODUCT_CREATOR_SESSION_ACTIVE", String(session.pid));

  let currentSession, currentConfig, currentState;
  try {
    currentSession = fs.readFileSync(sessionPath);
    currentConfig = fs.readFileSync(configPath);
    currentState = fs.readFileSync(paths.statePath);
  } catch {
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  if (!currentSession.equals(sessionBytes) || !currentConfig.equals(configBytes) || !currentState.equals(stateBytes))
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  const quarantinePath = path.join(paths.managerRoot, `.creator-session-recovery-${randomUUID()}.quarantine`);
  try { fs.renameSync(sessionPath, quarantinePath); }
  catch { fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW"); }
  let movedBytes;
  try { movedBytes = fs.readFileSync(quarantinePath); }
  catch {
    const error = new LifecycleError("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
    error.coordinationWritesApplied = 1;
    throw error;
  }
  if (!movedBytes.equals(sessionBytes)) {
    let restored = false;
    try {
      if (!fs.existsSync(sessionPath)) {
        fs.renameSync(quarantinePath, sessionPath);
        restored = true;
      }
    } catch {}
    if (!restored) {
      const error = new LifecycleError("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
      error.coordinationWritesApplied = 1;
      throw error;
    }
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  try { fs.unlinkSync(quarantinePath); }
  catch {
    const error = new LifecycleError("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
    error.coordinationWritesApplied = 1;
    throw error;
  }
  if (fs.existsSync(quarantinePath) || fs.existsSync(sessionPath)) {
    const error = new LifecycleError("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
    error.coordinationWritesApplied = 1;
    throw error;
  }
  return true;
}

function validateRepairableManagerTree(managerRoot, expectedManifest) {
  if (!fs.existsSync(managerRoot)) return;
  const expected = new Map(expectedManifest.files.map((row) => [row.path.toLowerCase(), row]));
  for (const row of walkFiles(managerRoot)) {
    if (row.path.toLowerCase() === "config/installed-files.json") continue;
    const pin = expected.get(row.path.toLowerCase());
    if (!pin) fail("MANAGEMENT_TOOL_EXTRA_FILE", row.path);
    if (pin.bytes !== row.bytes || pin.sha256 !== row.sha256) fail("MANAGEMENT_TOOL_DRIFT", row.path);
  }
}

function validateInstalledHost(hostRoot, adapter, state, { allowRepair = false, allowAlreadyAbsent = false } = {}) {
  if (state.hostAdapterId !== adapter.id || state.hostFingerprintSha256 !== adapter.fingerprintSha256)
    fail('HOST_ADAPTER_UPGRADE_UNSUPPORTED', 'Cross-host upgrades require a separately verified adapter migration');
  const diagnostics=[];
  for (const row of resolveHostCompatibilityPlan(adapter).dependencies) {
    const expected = { exists: true, bytes: row.bytes, sha256: row.sha256 };
    const fact = fileFact(under(hostRoot, row.path));
    if (!equalFact(fact, expected)) {
      diagnostics.push({code:'HOST_DEPENDENCY_INCOMPATIBLE',path:row.path,role:'DEPENDENCY_READONLY',expected,actual:fact});
    }
  }
  const repairable = [];
  let alreadyAbsent = 0;
  for (const owned of state.hostFiles) {
    const fact = fileFact(under(hostRoot, owned.path));
    if (equalFact(fact, owned.postimage)) continue;
    if (allowRepair && !owned.original.exists && owned.postimage.exists && !fact.exists) repairable.push(owned.path);
    else if (allowAlreadyAbsent && !owned.original.exists && owned.postimage.exists && !fact.exists) alreadyAbsent++;
    else diagnostics.push({code:'OWNED_FILE_DRIFT',path:owned.path,role:owned.original.exists?'MANAGED_TRANSFORM_TARGET':'PLUGIN_OWNED_NEW',expected:owned.postimage,actual:fact});
  }
  for (const row of state.hostFiles) if (row.original.exists) {
    const backup = under(statePaths(hostRoot).stateRoot, row.backupPath, { missing: false });
    if (!equalFact(fileFact(backup), row.original)) fail("ORIGINAL_BACKUP_DRIFT", row.path);
  }
  rejectHostDiagnostics(adapter,diagnostics);
  return { repairable, alreadyAbsent };
}

function validateUpgradeTargets(hostRoot, operations, previous) {
  const old = new Set(previous.hostFiles.map((row) => row.path.toLowerCase()));
  for (const op of operations) if (!old.has(op.path.toLowerCase())) {
    const current = fileFact(under(hostRoot, op.path));
    if (!equalFact(current, op.original)) fail("HOST_TARGET_OWNERSHIP_CONFLICT", op.path);
  }
}

function currentHostProof(request, adapter, state) {
  const required = [...new Set(["WebGAL_Terre.exe", "assets/templates/Derivative_Engine/MyGO_v3.2.1/webgal-engine.json", "assets/templates/Derivative_Engine/MyGO_v3.2.1/index.html",
    ...resolveHostCompatibilityPlan(adapter).dependencies.map(row => row.path)])];
  const managed = new Map((state?.hostFiles ?? []).map((x) => [x.path.toLowerCase(), x.postimage]));
  const base = expectedBaseMap(adapter);
  return required.map((relative) => {
    const fact = fileFact(under(request.hostRoot, relative, { missing: false }));
    const expected = managed.get(relative.toLowerCase()) ?? base.get(relative.toLowerCase());
    if (!expected || !equalFact(fact, expected)) fail("TERRE_HOST_FINGERPRINT_MISMATCH", relative);
    return { path: relative, sha256: fact.sha256 };
  });
}

function authorizeRequest(request, adapter, state) {
  const options = {
    installRoot: request.hostRoot,
    hostHomeRoot: request.hostHomeRoot,
    authorizedUserDataRoot: request.authorizedUserDataRoot,
    authorizedAuthoringRoot: request.authorizedAuthoringRoot,
    authorizedAuthoringWorkspaceRoot: path.join(request.authorizedAuthoringRoot, "workspace"),
    hostFiles: currentHostProof(request, adapter, state),
    projectGrants: request.projectGrants,
    projectSelectionPolicy: "explicit-action",
  };
  const access = createTerreProjectAccess(options);
  try { for (const grant of request.projectGrants) access.openProject(grant.name); } finally { access.close(); }
  return options;
}

function pinTree(root) {
  root = absoluteDirectory(root);
  const rows = walkFiles(root);
  if (!rows.length) fail("AUTHORING_TEMPLATE_EMPTY");
  return { root, sourceKind: "USER_LOCAL_PROJECT", files: rows };
}

function copyVerified(source, target, expected) {
  const fact = fileFact(source);
  if (!equalFact(fact, { exists: true, bytes: expected.bytes, sha256: expected.sha256 })) fail("SOURCE_HASH_MISMATCH", source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  if (!equalFact(fileFact(target), fact)) fail("COPY_VERIFY_FAILED", target);
}

function managerManifest(stage) {
  const rel = "config/installed-files.json";
  const files = walkFiles(stage, { exclude: new Set([rel]) });
  const manifest = { schema: "webgal-attachment-installed-files", schemaVersion: 1, files };
  durableWrite(path.join(stage, ...rel.split("/")), jsonBytes(manifest), { exclusive: true });
  return { manifest, sha256: hashFile(path.join(stage, ...rel.split("/"))) };
}

function buildManagerStage({ txnRoot, release, request, accessOptions, layout, repair = null }) {
  const stage = path.join(txnRoot, "manager-new");
  const managerGenerationId = repair?.state.managerGenerationId ?? randomUUID();
  fs.mkdirSync(stage);
  for (const row of release.manifest.files)
    copyVerified(under(release.root, row.path, { missing: false }), under(stage, row.path), row);
  copyVerified(path.join(release.root, "manifests", "release-files.json"), path.join(stage, "manifests", "release-files.json"),
    { bytes: fs.statSync(path.join(release.root, "manifests", "release-files.json")).size, sha256: release.manifestSha256 });

  for (const build of [release.builds.creator, release.builds.preview]) {
    if (!build || !Array.isArray(build.files)) fail("BUILD_MANIFEST_INVALID");
    const buildRoot = path.join(stage, "builds", build.kind);
    for (const row of build.files) {
      const target = under(buildRoot, row.path);
      if (fs.existsSync(target)) {
        if (!equalFact(fileFact(target), { exists: true, bytes: row.bytes, sha256: row.sha256 })) fail("BUILD_PAYLOAD_MISMATCH", `${build.kind}/${row.path}`);
        continue;
      }
      const source = under(path.join(request.hostRoot, "assets", "templates", "Derivative_Engine", "MyGO_v3.2.1"), row.path, { missing: false });
      copyVerified(source, target, row);
    }
    verifyRows(buildRoot, build.files, { exact: true });
  }

  const template = { sourceKind: "EMPTY_AUTHORING_WORKSPACE", schemaVersion: 1 };
  const normalizedRequest = storedRequest(request);
  durableWrite(path.join(stage, "config", "install-request.json"), jsonBytes(normalizedRequest), { exclusive: true });
  const launch = {
    schema: "webgal-attachment-creator-launch", schemaVersion: 1, port: 0,
    installationIdentity: {
      schema: "webgal-attachment-installed-launch-identity", schemaVersion: 1,
      productVersion: release.product.version, releaseRevision: release.product.releaseRevision,
      releaseManifestSha256: release.manifestSha256, hostAdapterId: release.adapter.id,
      hostFingerprintSha256: release.adapter.fingerprintSha256,
      installRequestSha256: requestIdentityDigest(request), managerGenerationId,
    },
    managementRoot: normalizedRequest.managementRoot,
    statePath: path.join(normalizedRequest.managementRoot, "creator-session-v1.json"),
    resources: {
      root: path.join(normalizedRequest.managementRoot, "resources", "global-library"),
      manifestPath: path.join(normalizedRequest.managementRoot, "resources", "product-resources.json"),
    },
    workspace: {
      authoringRoot: request.authorizedAuthoringRoot,
      authorizedWorkspaceRoot: path.join(request.authorizedAuthoringRoot, "workspace"),
      template,
    },
    terre: accessOptions,
    workbench: { root: path.join(normalizedRequest.managementRoot, "builds", "creator"), files: release.builds.creator.files },
    preview: { root: path.join(normalizedRequest.managementRoot, "builds", "preview"), files: release.builds.preview.files },
  };
  durableWrite(path.join(stage, "config", "creator-launch.json"), jsonBytes(launch), { exclusive: true });
  // Repair preserves authenticated installation-local configuration. The game's
  // template may have been edited since installation; it is not configuration drift.
  if (repair?.manifest) {
    for (const relative of ["config/install-request.json", "config/creator-launch.json"]) {
      const pin = repair.manifest.files.find((row) => row.path === relative);
      const source = under(repair.managerRoot, relative);
      if (pin && fs.existsSync(source)) {
        fs.unlinkSync(under(stage, relative));
        copyVerified(source, under(stage, relative), pin);
        if (relative === "config/creator-launch.json") {
          const preserved = readJson(under(stage, relative), "CREATOR_CONFIG_INVALID");
          // The authorized template is user content, not an immutable install
          // payload. Refresh only this observation before the launch check.
          preserved.workspace.template = template;
          durableWrite(under(stage, relative), jsonBytes(preserved));
        }
      }
    }
  }
  const installed = managerManifest(stage);
  return { stage, template, launch, installed, managerGenerationId };
}

function backupName(relative) { return `backups/original/${sha(Buffer.from(relative.toLowerCase()))}.bin`; }
function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const row of walkFiles(source)) copyVerified(under(source, row.path, { missing: false }), under(target, row.path), row);
}

function buildNextState({ txnRoot, release, request, layout, previous, manager, operations, mode }) {
  const stateStage = path.join(txnRoot, "state-new");
  fs.mkdirSync(stateStage);
  const previousRows = new Map((previous?.hostFiles ?? []).map((x) => [x.path.toLowerCase(), x]));
  const hostFiles = [];
  for (const op of operations) {
    const observedPreimage = fileFact(under(request.hostRoot, op.path));
    let original = observedPreimage, backupPath = null;
    const old = previousRows.get(op.path.toLowerCase());
    if (!old && !equalFact(observedPreimage, op.original)) fail('HOST_TARGET_OWNERSHIP_CONFLICT', op.path);
    if (old) { original = old.original; backupPath = old.backupPath ?? null; }
    else if (original.exists) backupPath = backupName(op.path);
    if (original.exists) {
      const destination = under(stateStage, backupPath);
      if (old) copyVerified(under(statePaths(request.hostRoot).stateRoot, old.backupPath, { missing: false }), destination, original);
      else copyVerified(under(request.hostRoot, op.path, { missing: false }), destination, original);
    }
    hostFiles.push({ path: op.path, action: op.action, original, backupPath, postimage: op.postimage,
      releaseSampleFact: op.original, observedPreimage, installedPostimage: op.postimage });
  }
  const now = new Date().toISOString();
  const firstInstalledAt = previous?.firstInstalledAt ?? previous?.installedAt ?? now;
  const state = {
    schema: SCHEMA, schemaVersion: 1, status: "INSTALLED",
    productVersion: release.product.version, releaseRevision: release.product.releaseRevision,
    releaseManifestSha256: release.manifestSha256, hostAdapterId: release.adapter.id,
    hostFingerprintSha256: release.adapter.fingerprintSha256,
    hostRoot: request.hostRoot, managerRoot: request.managementRoot,
    installRequestSha256: requestIdentityDigest(request),
    managerGenerationId: manager.keep ? previous?.managerGenerationId : manager.managerGenerationId,
    layoutMode: layout.mode, authorizedUserDataRoot: request.authorizedUserDataRoot,
    authorizedAuthoringRoot: request.authorizedAuthoringRoot,
    firstInstalledAt, installedAt: mode === "upgrade" ? firstInstalledAt : now, updatedAt: now,
    managerManifestSha256: manager.installed.sha256,
    managerFiles: manager.installed.manifest.files.length,
    hostFiles,
    sdkRedistribution: "PENDING_PERMISSION_EXCLUDED",
    modelBinariesBundled: false,
    legacyV1Ownership: "NOT_ADOPTED_USER_OR_LEGACY_DRIFT",
  };
  durableWrite(path.join(stateStage, STATE_FILE), jsonBytes(state), { exclusive: true });
  return { stage: stateStage, state };
}

function buildUninstalledState(txnRoot, previous) {
  const stage = path.join(txnRoot, "state-new"); fs.mkdirSync(stage);
  const state = { ...previous, status: "UNINSTALLED", uninstalledAt: new Date().toISOString(), hostFiles: [],
    managementToolRetained: true };
  for (const key of ["firstInstalledAt", "installedAt"]) if (!state[key]) delete state[key];
  durableWrite(path.join(stage, STATE_FILE), jsonBytes(state), { exclusive: true });
  return { stage, state };
}

function desiredTransition(release, previous, operations, mode) {
  const old = new Map((previous?.hostFiles ?? []).map((x) => [x.path.toLowerCase(), x]));
  const next = new Map(operations.map((x) => [x.path.toLowerCase(), x]));
  const paths = new Set([...old.keys(), ...next.keys()]);
  const transitions = [];
  for (const key of paths) {
    const op = next.get(key), prior = old.get(key);
    let desired, source = null, relative = op?.path ?? prior.path;
    if (mode === "uninstall" || !op) {
      const original = prior.original;
      desired = original;
      if (original.exists) source = under(statePaths(previous.hostRoot).stateRoot, prior.backupPath, { missing: false });
    } else {
      desired = op.postimage;
      if (desired.exists) source = under(release.root, op.payloadPath, { missing: false });
    }
    transitions.push({ path: relative, desired, source });
  }
  return transitions.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function treeDigestOrNull(root) {
  if (!fs.existsSync(root)) return null;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("TREE_ENTRY_FORBIDDEN", root);
  return treeDigest(root);
}

function captureMutationGuard(hostRoot, relativePaths) {
  const paths = statePaths(hostRoot), targets = {};
  for (const relative of [...new Set(relativePaths)].sort((a, b) => a.localeCompare(b, "en")))
    targets[relative] = fileFact(under(hostRoot, relative));
  return { targets, managerDigest: treeDigestOrNull(paths.managerRoot), stateDigest: treeDigestOrNull(paths.stateRoot) };
}

function assertMutationGuard(hostRoot, guard) {
  const paths = statePaths(hostRoot);
  for (const [relative, expected] of Object.entries(guard.targets))
    if (!equalFact(fileFact(under(hostRoot, relative)), expected)) fail("CONCURRENT_DRIFT_ZERO_MUTATION", relative);
  if (treeDigestOrNull(paths.managerRoot) !== guard.managerDigest) fail("CONCURRENT_DRIFT_ZERO_MUTATION", "manager");
  if (treeDigestOrNull(paths.stateRoot) !== guard.stateDigest) fail("CONCURRENT_DRIFT_ZERO_MUTATION", "state");
}

function prepareRollback(txnRoot, hostRoot, transitions, guard) {
  assertMutationGuard(hostRoot, guard);
  const rows = [];
  let index = 0;
  for (const item of transitions) {
    const target = under(hostRoot, item.path), current = fileFact(target);
    let rollbackPath = null;
    if (current.exists) {
      rollbackPath = `rollback/host/${sha(Buffer.from(item.path.toLowerCase()))}.bin`;
      copyVerified(target, under(txnRoot, rollbackPath), current);
    }
    rows.push({ index, path: item.path, before: current, rollbackPath, desired: item.desired });
    index++;
  }
  assertMutationGuard(hostRoot, guard);
  return rows;
}

function replaceWithFile(target, source, expected, before, txnRoot, index, control, relative) {
  const temp = path.join(txnRoot, "outgoing", `${index}.tmp`);
  copyVerified(source, temp, expected);
  if (!equalFact(fileFact(target), before)) fail("CONCURRENT_DRIFT_ZERO_MUTATION", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    fs.mkdirSync(path.join(txnRoot, "displaced"), { recursive: true });
    const displaced = path.join(txnRoot, "displaced", `${index}.bin`);
    fs.renameSync(target, displaced);
    if (!equalFact(fileFact(displaced), before)) {
      if (!fs.existsSync(target)) fs.renameSync(displaced, target);
      fail("CONCURRENT_DRIFT_ZERO_MUTATION", relative);
    }
    maybeInject(control, "replace-after-displace-before-install", relative);
  }
  fs.renameSync(temp, target);
  if (!equalFact(fileFact(target), expected)) fail("POSTIMAGE_VERIFY_FAILED", target);
}
function removeTarget(target, before, txnRoot, index, control, relative) {
  if (!equalFact(fileFact(target), before)) fail("CONCURRENT_DRIFT_ZERO_MUTATION", relative);
  if (fs.existsSync(target)) {
    fs.mkdirSync(path.join(txnRoot, "displaced"), { recursive: true });
    const displaced = path.join(txnRoot, "displaced", `${index}.bin`);
    fs.renameSync(target, displaced);
    if (!equalFact(fileFact(displaced), before)) {
      if (!fs.existsSync(target)) fs.renameSync(displaced, target);
      fail("CONCURRENT_DRIFT_ZERO_MUTATION", relative);
    }
    maybeInject(control, "remove-after-displace", relative);
  }
  if (fs.existsSync(target)) fail("POSTIMAGE_VERIFY_FAILED", target);
}

function maybeInject(control, point, detail = point) {
  if (!control || control.point !== point) return;
  if (Number.isSafeInteger(control.waitMs) && control.waitMs > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(control.waitMs, 30000));
  if (control.hard) process.exit(86);
  fail("INJECTED_TRANSACTION_FAILURE", detail);
}

function journalWrite(txnRoot, journal, control = null) {
  const finalPath = path.join(txnRoot, "journal.json");
  const tempPath = path.join(txnRoot, `journal-${randomUUID()}.publishing`);
  durableWrite(tempPath, jsonBytes(journal), { exclusive: true });
  maybeInject(control, "journal-after-temp-before-publish");
  fs.renameSync(tempPath, finalPath);
}

function isolateForRollback(target, txnRoot, label) {
  if (!fs.existsSync(target)) return;
  const quarantine = path.join(txnRoot, "rollback-quarantine", `${label}-${randomUUID()}`);
  fs.mkdirSync(path.dirname(quarantine), { recursive: true });
  fs.renameSync(target, quarantine);
}

function restoreHostRow(hostRoot, txnRoot, row, control) {
  const target = under(hostRoot, row.path), current = fileFact(target);
  if (!equalFact(current, row.before) && !equalFact(current, row.desired) && current.exists)
    return { externalDriftPreserved: row.path };
  if (row.before.exists) {
    const backup = under(txnRoot, row.rollbackPath, { missing: false });
    if (!equalFact(fileFact(backup), row.before)) fail("ROLLBACK_SOURCE_DRIFT", row.path);
    if (equalFact(current, row.before)) return { externalDriftPreserved: null };
    const restoreTemp = path.join(txnRoot, "rollback-ready", `${row.index}.bin`);
    if (fs.existsSync(restoreTemp) && !equalFact(fileFact(restoreTemp), row.before))
      isolateForRollback(restoreTemp, txnRoot, `rollback-ready-${row.index}`);
    if (!fs.existsSync(restoreTemp)) copyVerified(backup, restoreTemp, row.before);
    isolateForRollback(target, txnRoot, `host-${row.index}`);
    maybeInject(control, "rollback-after-target-isolated", row.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(restoreTemp, target);
  } else if (current.exists) {
    isolateForRollback(target, txnRoot, `host-${row.index}`);
    maybeInject(control, "rollback-after-target-isolated", row.path);
  }
  if (!equalFact(fileFact(target), row.before)) fail("ROLLBACK_VERIFY_FAILED", row.path);
  return { externalDriftPreserved: null };
}

function restoreTreeSlot(root, oldRoot, previousDigest, newDigest, txnRoot, label) {
  const current = treeDigestOrNull(root);
  if (current === previousDigest) return { externalDriftPreserved: null };
  if (current !== null && current !== newDigest) {
    if (!fs.existsSync(oldRoot)) return { externalDriftPreserved: label };
    fail("RECOVERY_STATE_CONFLICT", label);
  }
  if (previousDigest !== null) {
    if (!fs.existsSync(oldRoot) || treeDigestOrNull(oldRoot) !== previousDigest) fail("ROLLBACK_SOURCE_DRIFT", label);
    isolateForRollback(root, txnRoot, label);
    fs.renameSync(oldRoot, root);
  } else isolateForRollback(root, txnRoot, label);
  if (treeDigestOrNull(root) !== previousDigest) fail("ROLLBACK_VERIFY_FAILED", label);
  return { externalDriftPreserved: null };
}

function restoreJournal(hostRoot, txnRoot, journal, { cleanup = true, control = null, request } = {}) {
  const paths = statePaths(hostRoot);
  for (const row of journal.rollback) {
    if (row.before.exists) {
      const backup = under(txnRoot, row.rollbackPath, { missing: false });
      if (!equalFact(fileFact(backup), row.before)) fail("ROLLBACK_SOURCE_DRIFT", row.path);
    }
  }
  const externalDriftPreserved = restoreLibraryJournal(request, journal.engineLibrary, txnRoot);
  for (const row of [...journal.rollback].reverse()) {
    const restored = restoreHostRow(hostRoot, txnRoot, row, control);
    if (restored.externalDriftPreserved) externalDriftPreserved.push(restored.externalDriftPreserved);
  }
  const manager = restoreTreeSlot(paths.managerRoot, path.join(txnRoot, "manager-old"), journal.previousManagerDigest,
    journal.newManagerDigest, txnRoot, "manager");
  const state = restoreTreeSlot(paths.stateRoot, path.join(txnRoot, "state-old"), journal.previousStateDigest,
    journal.newStateDigest, txnRoot, "state");
  if (manager.externalDriftPreserved) externalDriftPreserved.push(manager.externalDriftPreserved);
  if (state.externalDriftPreserved) externalDriftPreserved.push(state.externalDriftPreserved);
  for (const row of journal.rollback) {
    const current = fileFact(under(hostRoot, row.path));
    if (!equalFact(current, row.before) && !externalDriftPreserved.includes(row.path)) fail("ROLLBACK_VERIFY_FAILED", row.path);
  }
  if (cleanup) fs.rmSync(txnRoot, { recursive: true, force: true });
  return { externalDriftPreserved };
}

function assertTransactionProgress(hostRoot, journal, nextIndex, { managerDigest = journal.previousManagerDigest,
  stateDigest = journal.previousStateDigest } = {}) {
  for (const row of journal.rollback) {
    const expected = row.index < nextIndex ? row.desired : row.before;
    if (!equalFact(fileFact(under(hostRoot, row.path)), expected)) fail("CONCURRENT_DRIFT_ZERO_MUTATION", row.path);
  }
  const paths = statePaths(hostRoot);
  if (treeDigestOrNull(paths.managerRoot) !== managerDigest) fail("CONCURRENT_DRIFT_ZERO_MUTATION", "manager");
  if (treeDigestOrNull(paths.stateRoot) !== stateDigest) fail("CONCURRENT_DRIFT_ZERO_MUTATION", "state");
}

function recoverExisting(hostRoot, control = null, request) {
  const txns = fs.readdirSync(hostRoot, { withFileTypes: true })
    .filter((x) => x.isDirectory() && x.name.startsWith(TXN_PREFIX)).map((x) => path.join(hostRoot, x.name));
  if (!txns.length) return null;
  if (txns.length !== 1) fail("MULTIPLE_TRANSACTIONS_REQUIRE_REVIEW");
  const txnRoot = txns[0], journalPath = path.join(txnRoot, "journal.json");
  if (!fs.existsSync(journalPath)) {
    const pre = readJson(path.join(txnRoot, "prejournal.json"), "TRANSACTION_JOURNAL_INVALID");
    if (pre.schema !== "webgal-attachment-transaction-staging" || !samePath(pre.hostRoot, hostRoot) || pre.transactionId !== path.basename(txnRoot))
      fail("TRANSACTION_JOURNAL_INVALID");
    fs.rmSync(txnRoot, { recursive: true, force: true });
    return { status: "DISCARDED_UNCOMMITTED_STAGING" };
  }
  const journal = readJson(journalPath, "TRANSACTION_JOURNAL_INVALID");
  if (!samePath(journal.hostRoot, hostRoot) || journal.schema !== "webgal-attachment-transaction") fail("TRANSACTION_JOURNAL_INVALID");
  const paths = statePaths(hostRoot);
  let libraryComplete = true;
  try { verifyLibraryJournal(request, journal.engineLibrary, true); } catch { libraryComplete = false; }
  const completed = libraryComplete && treeDigestOrNull(paths.stateRoot) === journal.newStateDigest &&
    treeDigestOrNull(paths.managerRoot) === journal.newManagerDigest &&
    journal.rollback.every((row) => equalFact(fileFact(under(hostRoot, row.path)), row.desired));
  if (completed) { fs.rmSync(txnRoot, { recursive: true, force: true }); return { status: "FINALIZED_COMMITTED_TRANSACTION" }; }
  const restored = restoreJournal(hostRoot, txnRoot, journal, { control, request });
  return { status: restored.externalDriftPreserved.length
    ? "ROLLED_BACK_EXTERNAL_DRIFT_PRESERVED"
    : "ROLLED_BACK_INCOMPLETE_TRANSACTION", externalDriftPreserved: restored.externalDriftPreserved };
}

async function runTransaction({ txnRoot, release, request, previous, manager, nextState, transitions, mode, control, guard,
  beforeStateCommit = null, libraryJournal = null }) {
  const hostRoot = request.hostRoot, paths = statePaths(hostRoot);
  const rollback = prepareRollback(txnRoot, hostRoot, transitions, guard);
  const journal = {
    schema: "webgal-attachment-transaction", schemaVersion: 1, transactionId: path.basename(txnRoot),
    engineLibrary: libraryJournal, mode, hostRoot, preparedAt: new Date().toISOString(), status: "PREPARED", rollback,
    managerKeep: Boolean(manager.keep), managerRemove: Boolean(manager.remove),
    previousManagerDigest: treeDigestOrNull(paths.managerRoot),
    newManagerDigest: manager.remove ? null : manager.keep ? treeDigestOrNull(paths.managerRoot) : treeDigest(manager.stage),
    previousStateDigest: treeDigestOrNull(paths.stateRoot),
    newStateDigest: nextState.stage ? treeDigest(nextState.stage) : null,
  };
  journalWrite(txnRoot, journal, control);
  let stage = 'host-files';
  try {
    maybeInject(control, "after-journal");
    let index = 0;
    for (const item of transitions) {
      if (typeof control?.beforeTransition === "function") control.beforeTransition({ index, item });
      assertTransactionProgress(hostRoot, journal, index);
      const target = under(hostRoot, item.path);
      const before = journal.rollback[index].before;
      if (item.desired.exists) replaceWithFile(target, item.source, item.desired, before, txnRoot, index, control, item.path);
      else removeTarget(target, before, txnRoot, index, control, item.path);
      index++;
      if (index === 1) maybeInject(control, "after-first-host");
      if (item.path.startsWith("assets/templates/Derivative_Engine/MyGO_v3.2.1/") &&
          !transitions[index]?.path.startsWith("assets/templates/Derivative_Engine/MyGO_v3.2.1/")) maybeInject(control, "after-engine");
      if (item.path.startsWith("public/") && !transitions[index]?.path.startsWith("public/")) maybeInject(control, "after-editor");
    }
    stage = 'engine-library';
    applyLibraryJournal(request, libraryJournal, control);
    maybeInject(control, 'after-engine-library');
    stage = 'manager-commit';
    if (typeof control?.beforeManagerGuard === "function") control.beforeManagerGuard();
    assertTransactionProgress(hostRoot, journal, transitions.length);
    if (manager.remove) {
      if (fs.existsSync(paths.managerRoot)) {
        const oldRoot = path.join(txnRoot, "manager-old");
        fs.renameSync(paths.managerRoot, oldRoot);
        if (treeDigestOrNull(oldRoot) !== journal.previousManagerDigest) {
          if (!fs.existsSync(paths.managerRoot)) fs.renameSync(oldRoot, paths.managerRoot);
          fail("CONCURRENT_DRIFT_ZERO_MUTATION", "manager");
        }
      }
      maybeInject(control, "after-manager");
    } else if (!manager.keep) {
      if (fs.existsSync(paths.managerRoot)) {
        const oldRoot = path.join(txnRoot, "manager-old");
        fs.renameSync(paths.managerRoot, oldRoot);
        if (treeDigestOrNull(oldRoot) !== journal.previousManagerDigest) {
          if (!fs.existsSync(paths.managerRoot)) fs.renameSync(oldRoot, paths.managerRoot);
          fail("CONCURRENT_DRIFT_ZERO_MUTATION", "manager");
        }
      }
      fs.renameSync(manager.stage, paths.managerRoot);
      if (treeDigestOrNull(paths.managerRoot) !== journal.newManagerDigest) fail("POSTIMAGE_VERIFY_FAILED", "manager");
      maybeInject(control, "after-manager");
    }
    stage = 'post-install-check';
    if (beforeStateCommit) await beforeStateCommit();
    verifyLibraryJournal(request, libraryJournal, true);
    stage = 'state-commit';
    if (typeof control?.beforeStateGuard === "function") control.beforeStateGuard();
    assertTransactionProgress(hostRoot, journal, transitions.length, {
      managerDigest: journal.newManagerDigest, stateDigest: journal.previousStateDigest,
    });
    if (fs.existsSync(paths.stateRoot)) {
      const oldRoot = path.join(txnRoot, "state-old");
      fs.renameSync(paths.stateRoot, oldRoot);
      if (treeDigestOrNull(oldRoot) !== journal.previousStateDigest) {
        if (!fs.existsSync(paths.stateRoot)) fs.renameSync(oldRoot, paths.stateRoot);
        fail("CONCURRENT_DRIFT_ZERO_MUTATION", "state");
      }
    }
    maybeInject(control, "before-state");
    if (nextState.stage) fs.renameSync(nextState.stage, paths.stateRoot);
    if (treeDigestOrNull(paths.stateRoot) !== journal.newStateDigest) fail("POSTIMAGE_VERIFY_FAILED", "state");
    for (const item of transitions) if (!equalFact(fileFact(under(hostRoot, item.path)), item.desired)) fail("POSTIMAGE_VERIFY_FAILED", item.path);
    verifyLibraryJournal(request, libraryJournal, true);
    if (treeDigestOrNull(paths.managerRoot) !== journal.newManagerDigest || treeDigestOrNull(paths.stateRoot) !== journal.newStateDigest)
      fail("TRANSACTION_COMMIT_VERIFY_FAILED");
  } catch (error) {
    error.stage ??= stage;
    error.operation ??= mode;
    try {
      const restored = restoreJournal(hostRoot, txnRoot, journal, { control, request });
      if (restored.externalDriftPreserved.length) error.externalDriftPreserved = restored.externalDriftPreserved;
    }
    catch (rollbackError) {
      const wrapped = new LifecycleError("ROLLBACK_INCOMPLETE_RECOVERY_REQUIRED", `${error.code ?? error.message}|${rollbackError.code ?? rollbackError.message}`);
      wrapped.diagnostics = [errorDiagnostic(error), errorDiagnostic(rollbackError, { stage: 'rollback', operation: mode })];
      Object.assign(wrapped, errorDiagnostic(error));
      wrapped.recoveryRequired = true; wrapped.writesApplied = null; throw wrapped;
    }
    error.rolledBack = true; error.writesApplied = 0;
    throw error;
  }
  try { fs.rmSync(txnRoot, { recursive: true, force: true }); return { cleanupPending: false }; }
  catch (error) { return { cleanupPending: true, diagnostic: errorDiagnostic(error, { stage: 'committed-cleanup', operation: mode }) }; }
}

function prepareTxn(hostRoot) {
  const txnRoot = path.join(hostRoot, `${TXN_PREFIX}${randomUUID()}`);
  fs.mkdirSync(txnRoot);
  durableWrite(path.join(txnRoot, "prejournal.json"), jsonBytes({
    schema: "webgal-attachment-transaction-staging", schemaVersion: 1,
    transactionId: path.basename(txnRoot), hostRoot, createdAt: new Date().toISOString(),
    hostMutationStarted: false,
  }), { exclusive: true });
  return txnRoot;
}

function verifyPayloadOperations(release, operations) {
  for (const op of operations) if (op.postimage.exists) {
    const fact = fileFact(under(release.root, op.payloadPath, { missing: false }));
    if (!equalFact(fact, op.postimage)) fail("HOST_PAYLOAD_HASH_MISMATCH", op.path);
  }
}

function inspectPendingTransaction(hostRoot) {
  const txns = fs.readdirSync(hostRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TXN_PREFIX))
    .map((entry) => path.join(hostRoot, entry.name));
  if (!txns.length) return null;
  if (txns.length !== 1) fail("MULTIPLE_TRANSACTIONS_REQUIRE_REVIEW");
  const txnRoot = txns[0], journalPath = path.join(txnRoot, "journal.json");
  if (fs.existsSync(journalPath)) {
    const journal = readJson(journalPath, "TRANSACTION_JOURNAL_INVALID");
    if (journal.schema !== "webgal-attachment-transaction" || !samePath(journal.hostRoot, hostRoot) ||
        journal.transactionId !== path.basename(txnRoot)) fail("TRANSACTION_JOURNAL_INVALID");
    return { txnRoot, status: "JOURNAL_PUBLISHED" };
  }
  const pre = readJson(path.join(txnRoot, "prejournal.json"), "TRANSACTION_JOURNAL_INVALID");
  if (pre.schema !== "webgal-attachment-transaction-staging" || !samePath(pre.hostRoot, hostRoot) ||
      pre.transactionId !== path.basename(txnRoot)) fail("TRANSACTION_JOURNAL_INVALID");
  return { txnRoot, status: "PREJOURNAL_ONLY" };
}

function preflightBeforeLifecycleLock({ normalizedMode, release, request }) {
  inspectLifecycleCoordination(request.hostRoot);
  if (inspectPendingTransaction(request.hostRoot)) return { pendingTransaction: true };
  const operations = normalizeOperations(release.adapter);
  verifyPayloadOperations(release, operations);
  const loadedState = loadState(request.hostRoot), paths = loadedState.paths, previous = loadedState.state;

  if (normalizedMode === "recover") {
    if (!previous) validateFreshHost(request.hostRoot, release.adapter);
    else if (previous.status === "INSTALLED") {
      validateStateAgainstRelease(release, previous);
      validateInstalledHost(request.hostRoot, release.adapter, previous);
      validateInstalledManager(paths, previous, { allowCreatorSession: true });
      validateStateAgainstInstalledManager(paths, previous);
    }
    return { pendingTransaction: false };
  }
  if (normalizedMode === "validate") {
    if (!previous || previous.status !== "INSTALLED") fail("PRODUCT_NOT_INSTALLED");
    validateStateAgainstRelease(release, previous);
    validateInstalledHost(request.hostRoot, release.adapter, previous);
    validateInstalledManager(paths, previous, { allowCreatorSession: true });
    validateStateAgainstInstalledManager(paths, previous);
    validateRequestedIdentity(request, previous);
    authorizeRequest(request, release.adapter, previous);
    return { lifecycleMode: "validate" };
  }
  if (normalizedMode === "install" && previous?.status === "INSTALLED" &&
      previous.releaseRevision === release.product.releaseRevision) {
    validateStateAgainstRelease(release, previous);
    validateInstalledHost(request.hostRoot, release.adapter, previous);
    validateInstalledManager(paths, previous, { allowCreatorSession: true });
    validateStateAgainstInstalledManager(paths, previous);
    validateRequestedIdentity(request, previous);
    authorizeRequest(request, release.adapter, previous);
    return { lifecycleMode: "repeat" };
  }

  if (normalizedMode === 'uninstall' && !previous && !fs.existsSync(paths.managerRoot) && !fs.existsSync(paths.stateRoot)) {
    validateFreshHost(request.hostRoot, release.adapter);
    return { lifecycleMode: 'already-uninstalled' };
  }
  let lifecycleMode = "fresh";
  if (normalizedMode === "uninstall") lifecycleMode = "uninstall";
  else if (normalizedMode === "repair") lifecycleMode = "repair";
  else if (previous?.status === "INSTALLED") lifecycleMode = "upgrade";
  if (lifecycleMode === "fresh") {
    validateFreshHost(request.hostRoot, release.adapter);
    if (!previous && (fs.existsSync(paths.stateRoot) || fs.existsSync(paths.managerRoot))) fail("UNCLAIMED_PRODUCT_PATH_CONFLICT");
    if (previous?.status === "UNINSTALLED" && fs.existsSync(paths.managerRoot))
      validateInstalledManager(paths, previous, { allowCreatorSession: true });
    authorizeRequest(request, release.adapter, null);
    return { lifecycleMode };
  }
  if (!previous || previous.status !== "INSTALLED") fail("PRODUCT_NOT_INSTALLED");
  if (lifecycleMode === "repair" && previous.releaseRevision !== release.product.releaseRevision) fail("REPAIR_REVISION_MISMATCH");
  if (lifecycleMode !== "upgrade") validateStateAgainstRelease(release, previous);
  validateInstalledHost(request.hostRoot, release.adapter, previous, {
    allowRepair: lifecycleMode === "repair", allowAlreadyAbsent: lifecycleMode === "uninstall",
  });
  const installedManager = validateInstalledManager(paths, previous, {
    allowMissing: lifecycleMode === "repair", allowCreatorSession: true,
  });
  if (!installedManager.missing) validateStateAgainstInstalledManager(paths, previous);
  if (lifecycleMode !== "upgrade") validateRequestedIdentity(request, previous);
  if (lifecycleMode === "upgrade") validateUpgradeTargets(request.hostRoot, operations, previous);
  if (lifecycleMode !== "uninstall") authorizeRequest(request, release.adapter, previous);
  return { lifecycleMode };
}

async function postInstallCheck(paths) {
  const modulePath = path.join(paths.managerRoot, "runtime", "creator-launch.mjs");
  const { checkCreatorLaunch } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
  const result = await checkCreatorLaunch(path.join(paths.managerRoot, "config", "creator-launch.json"));
  if (!result.ok || result.status !== "CHECK_ONLY_NO_WRITES") fail("POSTINSTALL_LAUNCH_CHECK_FAILED");
  return result;
}

function resultBase(mode, release, request, extra = {}) {
  return {
    schema: "webgal-attachment-lifecycle-result", schemaVersion: 1, mode, ok: true,
    code: "PASS", productVersion: release.product.version, releaseRevision: release.product.releaseRevision,
    hostFingerprint: release.adapter.fingerprintSha256, layoutMode: request.layout?.mode,
    hostRoot: request.hostRoot, managerRoot: request.managementRoot,
    creatorEntryPath: path.join(request.managementRoot, '02_打开附件制作器.cmd'),
    releaseManifestSha256: release.manifestSha256, networkUsed: false, guiOpened: false, ...extra,
  };
}

export async function __testExecute({ mode, requestPath, releaseRoot = RELEASE_ROOT, control = null } = {}) {
  return executeLifecycle({ mode, requestPath, releaseRoot, control });
}

export async function executeLifecycle({ mode, requestPath, releaseRoot = RELEASE_ROOT, control = null, preflightOnly = false, onValidated = null } = {}) {
  const normalizedMode = String(mode ?? "Install").toLowerCase();
  if (!["install", "validate", "repair", "uninstall", "recover"].includes(normalizedMode)) fail("MODE_INVALID");
  if (onValidated && normalizedMode !== 'validate') fail('MODE_INVALID', 'onValidated');
  const strictRelease = !fs.existsSync(path.join(releaseRoot, "config", "installed-files.json"));
  let release;
  try { release = loadRelease(releaseRoot, { strict: strictRelease }); }
  catch (error) {
    if (normalizedMode === "repair" && !strictRelease && error.code === "FILE_NOT_FOUND") {
      const failure = new LifecycleError("REPAIR_COMPLETE_PACKAGE_REQUIRED", `${error.code}:${error.detail ?? ""}`);
      failure.writesApplied = 0;
      throw failure;
    }
    throw error;
  }
  const loaded = loadRequest(requestPath, release.root, {
    detachedUserContext: normalizedMode === "uninstall" || normalizedMode === "recover",
  }), request = loaded.request, layout = loaded.layout;
  request.layout = layout;
  try {
    if (normalizedMode !== 'validate') assertHostProcessesStopped(request.hostRoot);
    preflightBeforeLifecycleLock({ normalizedMode, release, request });
    if (!inspectPendingTransaction(request.hostRoot) && normalizedMode !== 'recover') {
      const previous = loadState(request.hostRoot).state;
      if (normalizedMode === 'validate' || (normalizedMode === 'install' && previous?.releaseRevision === release.product.releaseRevision))
        validateEngineLibrary(request, previous);
      else planEngineLibrary({request, release, previous, mode:normalizedMode});
    }
  }
  catch(error) { error.writesApplied=0; error.coordinationWritesApplied=0; throw error; }
  if (preflightOnly) return resultBase(mode, release, request, { code: 'PREFLIGHT_ONLY', writesApplied: 0, coordinationWritesApplied: 0 });
  const lock = acquireLifecycleLock(request.hostRoot, control);
  try {
    if (normalizedMode !== 'validate') assertHostProcessesStopped(request.hostRoot);
    maybeInject(control, "after-lock");
    const result = await executeLifecycleLocked({ normalizedMode, release, request, layout, control });
    if (onValidated) {
      assertHostProcessesStopped(request.hostRoot);
      return await onValidated({ result, request });
    }
    return result;
  } finally { releaseLifecycleLock(lock); }
}

async function executeLifecycleLocked({ normalizedMode, release, request, layout, control }) {
  const recovered = recoverExisting(request.hostRoot, control, request);
  let creatorSessionRecovered = false;
  try {
    creatorSessionRecovered = removeDeadCreatorSessionForLifecycle(request.hostRoot);
    return await executeLifecycleAfterRecovery({ normalizedMode, release, request, layout, control }, recovered,
      creatorSessionRecovered);
  } catch (error) {
    if (creatorSessionRecovered && !Number.isSafeInteger(error.coordinationWritesApplied))
      error.coordinationWritesApplied = 1;
    throw error;
  }
}

async function executeLifecycleAfterRecovery({ normalizedMode, release, request, layout, control }, recovered,
  creatorSessionRecovered) {
  if (normalizedMode === "recover") return resultBase("Recover", release, request, {
    code: recovered ? "TRANSACTION_RECOVERED" : creatorSessionRecovered ? "CREATOR_SESSION_RECOVERED" : "NO_TRANSACTION",
    recovered: recovered?.status ?? null, creatorSessionRecovered, writesApplied: recovered ? 1 : 0,
    coordinationWritesApplied: creatorSessionRecovered ? 1 : 0,
    sentinels: [
      recovered ? "TERRE_INSTALL_TRANSACTION_RECOVERY_PASS" : "TERRE_NO_TRANSACTION_TO_RECOVER",
      ...(creatorSessionRecovered ? ["TERRE_DEAD_CREATOR_SESSION_RECOVERY_PASS"] : []),
    ],
  });
  const operations = normalizeOperations(release.adapter); verifyPayloadOperations(release, operations);
  const loadedState = loadState(request.hostRoot), paths = loadedState.paths, previous = loadedState.state;
  const guardedPaths = [...operations.map((row) => row.path), ...(previous?.hostFiles ?? []).map((row) => row.path)];
  const mutationGuard = captureMutationGuard(request.hostRoot, guardedPaths);
  if (!layout && previous?.layoutMode) {
    layout = { mode: previous.layoutMode };
    request.layout = layout;
  }

  if (normalizedMode === "validate") {
    if (!previous || previous.status !== "INSTALLED") fail("PRODUCT_NOT_INSTALLED");
    validateStateAgainstRelease(release, previous);
    validateInstalledHost(request.hostRoot, release.adapter, previous);
    validateInstalledManager(paths, previous);
    validateStateAgainstInstalledManager(paths, previous);
    validateRequestedIdentity(request, previous);
    authorizeRequest(request, release.adapter, previous);
    validateEngineLibrary(request, previous);
    assertMutationGuard(request.hostRoot, mutationGuard);
    return resultBase("Validate", release, request, { code: "VALIDATED",
      creatorSessionRecovered, coordinationWritesApplied: creatorSessionRecovered ? 1 : 0,
      writesPlanned: 0, writesApplied: 0,
      stateSha256: hashFile(paths.statePath), managedHostFiles: previous.hostFiles.length,
      sentinels: ["TERRE_RELEASE_PLUGIN_VALIDATE_PASS", `TERRE_LAYOUT_PASS:${layout.mode.toUpperCase()}`,
        ...(creatorSessionRecovered ? ["TERRE_DEAD_CREATOR_SESSION_RECOVERY_PASS"] : [])] });
  }

  if (normalizedMode === "install" && previous?.status === "INSTALLED" && previous.releaseRevision === release.product.releaseRevision) {
    validateStateAgainstRelease(release, previous);
    validateInstalledHost(request.hostRoot, release.adapter, previous); validateInstalledManager(paths, previous);
    validateStateAgainstInstalledManager(paths, previous);
    validateRequestedIdentity(request, previous);
    authorizeRequest(request, release.adapter, previous);
    validateEngineLibrary(request, previous);
    assertMutationGuard(request.hostRoot, mutationGuard);
    return resultBase("Install", release, request, {
      code: creatorSessionRecovered ? "REPEAT_INSTALL_COORDINATION_RECOVERED" : "REPEAT_INSTALL_NOOP",
      noOp: !creatorSessionRecovered, creatorSessionRecovered,
      coordinationWritesApplied: creatorSessionRecovered ? 1 : 0, writesPlanned: 0, writesApplied: 0,
      stateSha256: hashFile(paths.statePath), sentinels: [
        ...(!creatorSessionRecovered ? ["TERRE_RELEASE_REPEAT_INSTALL_NOOP"] : []), `TERRE_LAYOUT_PASS:${layout.mode.toUpperCase()}`,
        ...(creatorSessionRecovered ? ["TERRE_DEAD_CREATOR_SESSION_RECOVERY_PASS"] : [])] });
  }

  if (normalizedMode === 'uninstall' && !previous && !fs.existsSync(paths.managerRoot) && !fs.existsSync(paths.stateRoot)) {
    validateFreshHost(request.hostRoot, release.adapter);
    assertMutationGuard(request.hostRoot, mutationGuard);
    return resultBase('Uninstall', release, request, { code: 'ALREADY_UNINSTALLED', noOp: true, writesApplied: 0, writesPlanned: 0 });
  }
  let lifecycleMode = "fresh";
  if (normalizedMode === "uninstall") lifecycleMode = "uninstall";
  else if (normalizedMode === "repair") lifecycleMode = "repair";
  else if (previous?.status === "INSTALLED") lifecycleMode = "upgrade";

  if (lifecycleMode === "fresh") {
    validateFreshHost(request.hostRoot, release.adapter);
    if (!previous && (fs.existsSync(paths.stateRoot) || fs.existsSync(paths.managerRoot))) fail("UNCLAIMED_PRODUCT_PATH_CONFLICT");
    if (previous?.status === "UNINSTALLED" && fs.existsSync(paths.managerRoot)) validateInstalledManager(paths, previous);
  } else {
    if (!previous || previous.status !== "INSTALLED") fail("PRODUCT_NOT_INSTALLED");
    if (lifecycleMode === "repair" && previous.releaseRevision !== release.product.releaseRevision) fail("REPAIR_REVISION_MISMATCH");
    if (lifecycleMode !== "upgrade") validateStateAgainstRelease(release, previous);
    validateInstalledHost(request.hostRoot, release.adapter, previous, {
      allowRepair: lifecycleMode === "repair", allowAlreadyAbsent: lifecycleMode === "uninstall",
    });
    const installedManager = validateInstalledManager(paths, previous, { allowMissing: lifecycleMode === "repair" });
    if (lifecycleMode === "repair" && installedManager.missing && samePath(release.root, paths.managerRoot))
      fail("REPAIR_COMPLETE_PACKAGE_REQUIRED", installedManager.missingFiles[0]);
    if (!installedManager.missing) validateStateAgainstInstalledManager(paths, previous);
    if (lifecycleMode !== "upgrade") validateRequestedIdentity(request, previous);
    if (lifecycleMode === "upgrade") validateUpgradeTargets(request.hostRoot, operations, previous);
  }
  const accessOptions = lifecycleMode === "uninstall"
    ? null
    : authorizeRequest(request, release.adapter, lifecycleMode === "fresh" ? null : previous);

  const libraryPlan = planEngineLibrary({ request, release, previous, mode:lifecycleMode });
  let refreshTemplate = false;
  if (lifecycleMode === "repair") {
    const hostStatus = validateInstalledHost(request.hostRoot, release.adapter, previous, { allowRepair: true });
    const managerStatus = validateInstalledManager(paths, previous, { allowMissing: true });
    if (!managerStatus.missing) {
      const config = readJson(path.join(paths.managerRoot, 'config/creator-launch.json'), 'CREATOR_CONFIG_INVALID');
      const currentTemplate = { sourceKind: "EMPTY_AUTHORING_WORKSPACE", schemaVersion: 1 };
      refreshTemplate = JSON.stringify(config.workspace.template) !== JSON.stringify(currentTemplate);
    }
    if (!hostStatus.repairable.length && !managerStatus.missing && !refreshTemplate && !libraryPlan?.needsWrite && previous.engineLibrary) {
      assertMutationGuard(request.hostRoot, mutationGuard);
      return resultBase("Repair", release, request, {
      code: creatorSessionRecovered ? "REPAIR_COORDINATION_RECOVERED" : "REPAIR_NOOP",
      noOp: !creatorSessionRecovered, creatorSessionRecovered,
      coordinationWritesApplied: creatorSessionRecovered ? 1 : 0, writesPlanned: 0, writesApplied: 0,
      sentinels: ["TERRE_RELEASE_PLUGIN_REPAIR_PASS", `TERRE_LAYOUT_PASS:${layout.mode.toUpperCase()}`,
        ...(creatorSessionRecovered ? ["TERRE_DEAD_CREATOR_SESSION_RECOVERY_PASS"] : [])],
      });
    }
  }

  const txnRoot = prepareTxn(request.hostRoot);
  try {
    let manager, nextState, transitions;
    if (lifecycleMode === "uninstall") {
      manager = { keep: false, remove: true, stage: null };
      nextState = { stage: null, state: null };
      transitions = desiredTransition(release, previous, [], "uninstall");
    } else {
      const repairHost = lifecycleMode === "repair"
        ? validateInstalledHost(request.hostRoot, release.adapter, previous, { allowRepair: true })
        : null;
      const repairManager = lifecycleMode === "repair"
        ? validateInstalledManager(paths, previous, { allowMissing: true })
        : null;
      manager = lifecycleMode === "repair" && !repairManager.missing && !refreshTemplate
        ? { keep: true, stage: null, installed: { manifest: repairManager.manifest, sha256: previous.managerManifestSha256 } }
        : buildManagerStage({ txnRoot, release, request, accessOptions: {
        ...accessOptions,
        hostFiles: [...new Set(['WebGAL_Terre.exe','assets/templates/Derivative_Engine/MyGO_v3.2.1/webgal-engine.json','assets/templates/Derivative_Engine/MyGO_v3.2.1/index.html',
          ...resolveHostCompatibilityPlan(release.adapter).dependencies.map(row=>row.path)])].map(relative=>({path:relative,sha256:expectedInstalledFact(release.adapter,relative).sha256})),
      }, layout, repair: lifecycleMode === "repair" ? {
        state: previous, managerRoot: paths.managerRoot, manifest: repairManager.manifest,
      } : null });
      // Existing files are owned by the authenticated old manifest, not by a
      // freshly generated configuration. Without it, require exact reconstruction.
      if (lifecycleMode === "repair" && repairManager.missing)
        validateRepairableManagerTree(paths.managerRoot, repairManager.manifest ?? manager.installed.manifest);
      nextState = buildNextState({ txnRoot, release, request, layout, previous: lifecycleMode === "fresh" ? null : previous,
        manager, operations, mode: lifecycleMode });
      if (lifecycleMode === "repair") {
        const repairable = new Set(repairHost.repairable.map((x) => x.toLowerCase()));
        transitions = desiredTransition(release, previous, operations, "repair").filter((x) => repairable.has(x.path.toLowerCase()));
      } else transitions = desiredTransition(release, lifecycleMode === "fresh" ? null : previous, operations, lifecycleMode);
    }
    const libraryJournal = stageEngineLibrary(libraryPlan, txnRoot, nextState.stage, paths.stateRoot);
    const engineLibraryWrites = libraryJournal?.rows.filter(row=>!equalFact(row.before,row.desired)).length ?? 0;
    if (nextState.stage && libraryJournal) {
      nextState.state.engineLibrary = { root: libraryJournal.root, dependencies: libraryJournal.dependencies, files: libraryJournal.rows.filter(row=>!row.seed).map(row=>({
        path:row.path,original:row.original,backupPath:row.backupPath,postimage:row.desired,
      })) };
      durableWrite(path.join(nextState.stage, STATE_FILE), jsonBytes(nextState.state));
    }
    if (typeof control?.beforeMutationGuard === "function") control.beforeMutationGuard();
    const transaction = await runTransaction({ txnRoot, release, request, previous, manager, nextState, transitions,
      mode: lifecycleMode, control, guard: mutationGuard, libraryJournal,
      beforeStateCommit: lifecycleMode === "uninstall" ? null : () => postInstallCheck(paths) });
    if (transaction.cleanupPending) {
      const error = new LifecycleError('TRANSACTION_COMMITTED_CLEANUP_PENDING_RECOVER_REQUIRED');
      Object.assign(error, transaction.diagnostic, { nativeCode: transaction.diagnostic.nativeCode,
        recoveryRequired: true, writesApplied: transitions.length + 2 + engineLibraryWrites });
      throw error;
    }
    if (lifecycleMode === "uninstall") {
      validateFreshHost(request.hostRoot, release.adapter);
      if (fs.existsSync(paths.managerRoot) || fs.existsSync(paths.stateRoot)) fail("UNINSTALL_PRODUCT_FILES_REMAIN");
      const result = resultBase("Uninstall", release, request, { code: "UNINSTALLED", restored: transitions.filter((x) => x.desired.exists).length,
        engineLibraryRestored: true, engineLibraryWrites,
        removed: transitions.filter((x) => !x.desired.exists).length, managementToolRetained: false,
        creatorSessionRecovered, coordinationWritesApplied: creatorSessionRecovered ? 1 : 0,
        sentinels: ["TERRE_RELEASE_PLUGIN_UNINSTALL_PASS", "TERRE_EXACT_HOST_RESTORE_PASS", "TERRE_PLUGIN_OWNED_CORE_REMOVED_PASS",
          "TERRE_PROJECT_DATA_PRESERVED_PASS", `TERRE_LAYOUT_PASS:${layout.mode.toUpperCase()}`] });
      return result;
    }
    const installed = loadState(request.hostRoot, { optional: false }).state;
    validateInstalledHost(request.hostRoot, release.adapter, installed); validateInstalledManager(paths, installed);
    validateStateAgainstRelease(release, installed); validateStateAgainstInstalledManager(paths, installed);
    validateEngineLibrary(request, installed);
    const names = lifecycleMode === "fresh" ? ["TERRE_RELEASE_PLUGIN_INSTALL_PASS"] :
      lifecycleMode === "upgrade" ? [`TERRE_RELEASE_PLUGIN_UPGRADE_PASS:${previous.releaseRevision}->${release.product.releaseRevision}`] :
      ["TERRE_RELEASE_PLUGIN_REPAIR_PASS"];
    names.push(`TERRE_LAYOUT_PASS:${layout.mode.toUpperCase()}`);
    names.push('TERRE_NEW_GAME_ENGINE_LIBRARY_SYNC_PASS');
    if (creatorSessionRecovered) names.push("TERRE_DEAD_CREATOR_SESSION_RECOVERY_PASS");
    return resultBase(normalizedMode[0].toUpperCase() + normalizedMode.slice(1), release, request, {
      code: lifecycleMode.toUpperCase(), creatorSessionRecovered,
      coordinationWritesApplied: creatorSessionRecovered ? 1 : 0,
      writesPlanned: transitions.length + 2 + engineLibraryWrites, writesApplied: transitions.length + 2 + engineLibraryWrites,
      engineLibraryRoot: libraryJournal?.root ?? null, engineLibraryWrites,
      stateSha256: hashFile(paths.statePath), managedHostFiles: installed.hostFiles.length, sentinels: names,
    });
  } catch (error) {
    if (fs.existsSync(txnRoot) && !fs.existsSync(path.join(txnRoot, "journal.json"))) fs.rmSync(txnRoot, { recursive: true, force: true });
    throw error;
  }
}

async function cli() {
  const args = process.argv.slice(2), value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const mode = value("--mode") ?? "Install", requestPath = value("--request");
  const human = args.includes("--human");
  let target = null;
  if (human) {
    try { target = JSON.parse(fs.readFileSync(requestPath || path.join(RELEASE_ROOT, "config/install-request.json"), "utf8").replace(/^\uFEFF/, "")).hostRoot; } catch { /* Lifecycle reports invalid requests below. */ }
  }
  const emitHuman = (result) => {
    let diagnosticPath, diagnosticError;
    try {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "WebGAL-Attachment-diagnostic-"));
      diagnosticPath = path.join(directory, "result.json");
      fs.writeFileSync(diagnosticPath, JSON.stringify({ ...result, target, recordedAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    } catch (error) { diagnosticPath = null; diagnosticError = error.message; }
    const stream = result.ok ? process.stdout : process.stderr;
    stream.write(lifecycleHumanLines(result, { target, diagnosticPath, diagnosticError }).join("\n") + "\n");
  };
  try {
    const result = await executeLifecycle({ mode, requestPath, preflightOnly: args.includes('--preflight-only') });
    if (human) { emitHuman(result); return; }
    for (const sentinel of result.sentinels ?? []) process.stdout.write(`${sentinel}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stdout.write(`${lifecycleUserSuccessMessage(result)}\n`);
  } catch (error) {
    const code = error.code ?? "UNEXPECTED_LIFECYCLE_ERROR";
    const zeroWriteCodes = ["HOST_FINGERPRINT_MISMATCH", "TERRE_HOST_VERSION_MISMATCH", "TERRE_USER_DATA_NOT_AUTHORIZED",
      "OWNED_FILE_DRIFT", "HOST_TARGET_OWNERSHIP_CONFLICT", "INSTALL_STATE_RELEASE_MISMATCH", "REPAIR_COMPLETE_PACKAGE_REQUIRED",
      "INSTALL_CONFIGURATION_CHANGED_REQUIRES_RECONFIGURE", "AUTHORING_ROOT_PREFLIGHT_INVALID",
      "LIFECYCLE_BUSY", "LIFECYCLE_BUSY_OR_STALE_LOCK_REVIEW", "PRODUCT_CREATOR_SESSION_ACTIVE",
      "PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW", "CONCURRENT_DRIFT_ZERO_MUTATION"];
    if (!human && ["HOST_FINGERPRINT_MISMATCH", "TERRE_HOST_VERSION_MISMATCH", "TERRE_USER_DATA_NOT_AUTHORIZED"].includes(code))
      process.stderr.write(`UNSUPPORTED_HOST_ZERO_WRITE_PASS:${code}\n`);
    if (!human) process.stderr.write(`${code}${error.detail ? `:${error.detail}` : ""}\n`);
    const failure = { schema: "webgal-attachment-lifecycle-result", schemaVersion: 1, mode, ok: false,
      code, detail: errorDiagnostic(error, { operation: mode }), adapterId:error.adapterId??null, diagnostics:error.diagnostics??[], writesApplied: Number.isSafeInteger(error.writesApplied) ? error.writesApplied :
        null, rolledBack: Boolean(error.rolledBack), recoveryRequired: Boolean(error.recoveryRequired),
      coordinationWritesApplied: Number.isSafeInteger(error.coordinationWritesApplied) ? error.coordinationWritesApplied : 0,
      externalDriftPreserved: Array.isArray(error.externalDriftPreserved) ? error.externalDriftPreserved : [], networkUsed: false };
    if (human) emitHuman(failure);
    else {
      process.stderr.write(`${JSON.stringify(failure)}\n`);
      process.stderr.write(`${lifecycleUserFailureMessage(failure)}\n`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await cli();
