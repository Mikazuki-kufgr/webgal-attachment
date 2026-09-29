import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { commitOwned } from "./creator-transaction.mjs";
import { jsonBytes } from "./creator-package.mjs";
import { fail, inspectAbsolute } from "./terre-path-guard.mjs";
import { resourceSelection } from "./product-resources.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const facts = (relative, bytes) => ({
  path: relative, bytes: bytes.length, sha256: sha(bytes),
  ...( /\.(?:json|txt)$/i.test(relative)
    ? { normalizedSha256: sha(Buffer.from(bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"))) }
    : {}),
});
const parse = (bytes, code) => {
  try { return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
  catch { fail(code); }
};
function exactRelative(value) {
  if (
    typeof value !== "string" || !value || value.includes("\\") || value.includes("%") ||
    path.posix.isAbsolute(value) || value.split("/").some((p) => !p || p === "." || p === "..")
  ) fail("PRODUCT_MATERIALIZATION_PATH_INVALID");
  return value;
}

function userEditableResourcePlan({ plan, ownerId, ownershipPath, files }) {
  const ownership = plan(ownershipPath);
  let rows = [];
  if (ownership.exists) {
    const ledger = parse(fs.readFileSync(ownership.path), "CREATOR_OWNERSHIP_INVALID");
    if (
      ledger.schema !== "webgal-attachment-creator-owned-files" ||
      ledger.schemaVersion !== 2 ||
      ledger.ownerId !== ownerId ||
      !Array.isArray(ledger.files)
    )
      fail("CREATOR_OWNERSHIP_INVALID");
    rows = ledger.files;
  }
  const prior = new Map(rows.map((row) => [String(row.path).toLowerCase(), row]));
  const managed = [], preserved = [], releasePaths = [];
  for (const file of files) {
    const target = plan(file.path);
    if (!target.exists) {
      managed.push(file);
      continue;
    }
    const current = fs.readFileSync(target.path), old = prior.get(file.path.toLowerCase());
    const normalized = /\.(?:json|txt)$/i.test(file.path)
      ? sha(Buffer.from(current.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")))
      : undefined;
    const stillFactoryBaseline =
      old &&
      ((current.length === old.bytes && sha(current) === old.sha256) ||
        (normalized !== undefined && normalized === old.normalizedSha256));
    if (stillFactoryBaseline) managed.push(file);
    else {
      preserved.push({ ...facts(file.path, current), status: "preserved-user-file" });
      releasePaths.push(file.path);
    }
  }
  return { managed, preserved, releasePaths };
}

export function seedGlobalLibrary({ access, resources, fault, signal }) {
  const files = resources.rows.map((row) => ({ path: row.path, bytes: resources.read(row.path) }));
  const described = access.describe();
  const library = inspectAbsolute(described.libraryRoot, { missing: true, kind: "directory" });
  const ownerId = `webgal-attachment-product-resources:${resources.manifest.resourceSetId}`;
  // Fresh-library fast path: factory defaults appear atomically. Once materialized,
  // these are ordinary user-editable library files. Later seeds update only an
  // unchanged factory baseline; edited/replaced files are preserved and released
  // from product ownership instead of causing a conflict.
  // A failed unchanged stage is removed precisely; external stage drift is preserved for review.
  if (!library.exists) {
    const plans = files.map((file) => access.planLibraryWrite(file.path));
    const ownershipPath = ".webgal-attachment-product/resource-ownership-v1.json";
    const ownershipPlan = access.planLibraryWrite(ownershipPath);
    const stage = path.join(described.authoringRoot, `.library-staging-${randomUUID()}`);
    if (path.dirname(stage).toLowerCase() !== path.resolve(described.authoringRoot).toLowerCase())
      fail("PRODUCT_LIBRARY_STAGE_INVALID");
    let staged = null;
    try {
      staged = createOwnedStageWriter(stage, {
        invalidCode: "PRODUCT_LIBRARY_STAGE_INVALID",
        changedCode: "PRODUCT_LIBRARY_STAGE_CHANGED",
      });
      for (const file of files) {
        if (signal?.aborted) fail("CREATOR_SAVE_ABORTED");
        const target = path.join(stage, ...file.path.split("/"));
        staged.write(target, file.bytes);
      }
      const appliedAt = new Date().toISOString();
      const ownership = jsonBytes({
        schema: "webgal-attachment-creator-owned-files", schemaVersion: 2,
        ownerId, appliedAt,
        files: files.map((file) => facts(file.path, file.bytes)).sort((a, b) => a.path.localeCompare(b.path)),
      });
      const stagedOwnership = path.join(stage, ...ownershipPath.split("/"));
      staged.write(stagedOwnership, ownership);
      fault?.("preflight", { stage, libraryRoot: described.libraryRoot });
      staged.verify();
      for (const plan of [...plans, ownershipPlan]) access.revalidateWritePlan(plan);
      staged.verify();
      if (inspectAbsolute(described.libraryRoot, { missing: true }).exists) fail("PRODUCT_LIBRARY_APPEARED");
      fs.renameSync(stage, described.libraryRoot);
      return {
        ok: true, noOp: false, appliedAt, atomicDirectorySeed: true,
        files: files.map((file) => ({ ...facts(file.path, file.bytes), status: "created" })), warnings: [],
      };
    } catch (error) {
      staged?.cleanup();
      throw error;
    }
  }
  const ownershipPath = ".webgal-attachment-product/resource-ownership-v1.json";
  const selection = userEditableResourcePlan({
    plan: (relative) => access.planLibraryWrite(relative),
    ownerId,
    ownershipPath,
    files,
  });
  const result = commitOwned({
    access,
    plan: (relative) => access.planLibraryWrite(relative),
    ownerId,
    ownershipPath,
    journalPath: ".webgal-attachment-product/resource-transaction-v1.json",
    files: selection.managed,
    releasePaths: selection.releasePaths,
    fault,
    signal,
  });
  return {
    ...result,
    files: [...result.files, ...selection.preserved].sort((a, b) => a.path.localeCompare(b.path)),
    preservedUserFiles: selection.preserved.map((file) => file.path),
  };
}

function outputPath(resourcePath) {
  if (resourcePath.startsWith("attachment-assets/"))
    return `game/attachments-v2/assets/${path.posix.basename(resourcePath)}`;
  if (resourcePath.startsWith("placement-presets/"))
    return `game/attachments-v2/presets/${path.posix.basename(resourcePath)}`;
  if (resourcePath.startsWith("model-profiles/"))
    return `game/attachments-v2/model-profiles/${path.posix.basename(resourcePath)}`;
  if (resourcePath.startsWith("files/")) return `game/attachments-v2/${resourcePath}`;
  fail("PRODUCT_MATERIALIZATION_RESOURCE_ROLE_INVALID");
}
function existingJson(plan, code) {
  return plan.exists ? parse(fs.readFileSync(plan.path), code) : null;
}

/** Materializes exactly one bundled selection. It never touches start.txt, ordinary scenes,
 * figure/model files, config, or files outside attachments-v2. The shared global source is
 * a factory-default source. Materialized files become ordinary user content:
 * later calls update unchanged defaults but preserve edited/replaced files.
 */
export function materializeProductSelection({
  access, handle, resources, sampleId = "default", ownerId, fault, signal,
}) {
  if (typeof ownerId !== "string" || !/^[A-Za-z0-9:._-]{1,160}$/.test(ownerId))
    fail("PRODUCT_OWNER_ID_INVALID");
  const selected = resourceSelection(resources, sampleId);
  const inputs = [selected.attachmentAsset, selected.modelProfile, selected.placementPreset, ...selected.files];
  const files = inputs.map((sourcePath) => ({ path: outputPath(sourcePath), bytes: resources.read(sourcePath) }));
  const metadataPath = `game/attachments-v2/.webgal-attachment-materialization/${sampleId}.json`;
  const metadataPlan = access.planAttachmentWrite(handle, metadataPath);
  const stable = {
    schema: "webgal-project-attachment-materialization",
    schemaVersion: 2,
    materializationId: `product:${sampleId}`,
    sourceResourceSetId: resources.manifest.resourceSetId,
    selection: selected,
    files: files.map((file) => facts(file.path, file.bytes)),
  };
  const prior = existingJson(metadataPlan, "PRODUCT_MATERIALIZATION_METADATA_INVALID");
  const priorStable = prior && { ...prior };
  if (priorStable) delete priorStable.materializedAt;
  const materializedAt = prior && JSON.stringify(priorStable) === JSON.stringify(stable)
    ? prior.materializedAt : new Date().toISOString();
  const ownershipPath = "game/attachments-v2/.webgal-attachment-product/project-owned-v2.json";
  const selection = userEditableResourcePlan({
    plan: (relative) => access.planAttachmentWrite(handle, relative),
    ownerId,
    ownershipPath,
    files,
  });
  selection.managed.push({ path: metadataPath, bytes: jsonBytes({ ...stable, materializedAt }) });
  const result = commitOwned({
    access,
    plan: (relative) => access.planAttachmentWrite(handle, relative),
    ownerId,
    ownershipPath,
    journalPath: "game/attachments-v2/.webgal-attachment-product/project-transaction-v2.json",
    files: selection.managed,
    releasePaths: selection.releasePaths,
    fault,
    signal,
  });
  return {
    ...result,
    files: [...result.files, ...selection.preserved].sort((a, b) => a.path.localeCompare(b.path)),
    preservedUserFiles: selection.preserved.map((file) => file.path),
  };
}

/** Converts an old v1 hash ledger into the v2 ownership ledger only with caller-pinned
 * manifest hash + project + release evidence and exact current file bytes. Fileset-only
 * historical manifests and equal-but-foreign bytes are intentionally insufficient.
 */
export function adoptLegacyOwnership({ access, handle, ownerId, evidence }) {
  if (!evidence || evidence.authority !== "EXACT_HISTORICAL_HASH_LEDGER" ||
      typeof evidence.legacyPath !== "string" ||
      !/^[A-F0-9]{64}$/.test(evidence.legacyManifestSha256 ?? "") ||
      typeof evidence.expectedProjectId !== "string" ||
      typeof evidence.expectedReleaseVersion !== "string")
    fail("LEGACY_OWNERSHIP_EVIDENCE_INSUFFICIENT");
  exactRelative(evidence.legacyPath);
  const legacyPlan = access.resolveProjectRead(handle, evidence.legacyPath);
  const legacyBytes = fs.readFileSync(legacyPlan.path);
  if (sha(legacyBytes) !== evidence.legacyManifestSha256)
    fail("LEGACY_OWNERSHIP_MANIFEST_HASH_MISMATCH");
  const legacy = parse(legacyBytes, "LEGACY_OWNERSHIP_INVALID");
  if (legacy.schema !== "webgal-attachment-creator-owned-files" || legacy.schemaVersion !== 1 ||
      legacy.projectId !== evidence.expectedProjectId ||
      legacy.releaseVersion !== evidence.expectedReleaseVersion || !Array.isArray(legacy.files) || !legacy.files.length)
    fail("LEGACY_OWNERSHIP_EVIDENCE_MISMATCH");
  const seen = new Set(), rows = [];
  for (const row of legacy.files) {
    exactRelative(row.path);
    if (!row.path.startsWith("game/attachments-v2/") || seen.has(row.path.toLowerCase()) ||
        !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[A-F0-9]{64}$/.test(row.sha256))
      fail("LEGACY_OWNERSHIP_INVALID");
    seen.add(row.path.toLowerCase());
    const current = fs.readFileSync(access.resolveProjectRead(handle, row.path).path);
    if (current.length !== row.bytes || sha(current) !== row.sha256)
      fail("LEGACY_OWNERSHIP_CURRENT_BYTES_CHANGED", row.path);
    rows.push({ path: row.path, bytes: row.bytes, sha256: row.sha256 });
  }
  const targetRelative = "game/attachments-v2/.webgal-attachment-product/project-owned-v2.json";
  const target = access.planAttachmentWrite(handle, targetRelative);
  if (target.exists) fail("LEGACY_OWNERSHIP_ALREADY_MIGRATED");
  const bytes = jsonBytes({
    schema: "webgal-attachment-creator-owned-files", schemaVersion: 2, ownerId,
    appliedAt: new Date().toISOString(), files: rows,
    adoption: {
      authority: evidence.authority, legacyPath: evidence.legacyPath,
      legacyManifestSha256: evidence.legacyManifestSha256,
      projectId: evidence.expectedProjectId, releaseVersion: evidence.expectedReleaseVersion,
    },
  });
  access.revalidateWritePlan(target);
  fs.mkdirSync(path.dirname(target.path), { recursive: true });
  let fd, created;
  try {
    fd = fs.openSync(target.path, "wx");
    created = fs.fstatSync(fd, { bigint: true });
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
      try {
        const now = fs.lstatSync(target.path, { bigint: true });
        if (created && now.dev === created.dev && now.ino === created.ino && now.birthtimeNs === created.birthtimeNs)
          fs.unlinkSync(target.path);
      } catch {}
    }
    throw error;
  }
  fs.closeSync(fd);
  return Object.freeze({ ok: true, status: "ADOPTED_EXACT_HASH_PROOF", files: rows.length, path: targetRelative, sha256: sha(bytes) });
}

function validatePinnedTree(tree) {
  if (tree?.sourceKind === 'EMPTY_AUTHORING_WORKSPACE' && tree.schemaVersion === 1) {
    const files = [
      { relative:'game/config.txt', bytes:Buffer.from('Game_name:附件制作区;\nGame_width:1920;\nGame_height:1080;\n') },
      { relative:'game/scene/start.txt', bytes:Buffer.from('; 附件制作区不使用用户游戏剧情。\n') },
    ];
    return { root:null, files, setHash:sha(jsonBytes(files.map(f=>facts(f.relative,f.bytes)))) };
  }
  if (!tree || tree.sourceKind !== "USER_LOCAL_PROJECT" || !Array.isArray(tree.files) || !tree.files.length)
    fail("AUTHORING_TEMPLATE_PROOF_REQUIRED");
  const root = inspectAbsolute(tree.root, { kind: "directory" }).path;
  const seen = new Set(), files = [];
  for (const row of tree.files) {
    const relative = exactRelative(row.path);
    if (seen.has(relative.toLowerCase()) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[A-F0-9]{64}$/.test(row.sha256))
      fail("AUTHORING_TEMPLATE_PROOF_INVALID");
    seen.add(relative.toLowerCase());
    const absolute = inspectAbsolute(path.join(root, ...relative.split("/")), { kind: "file" }).path;
    const bytes = fs.readFileSync(absolute);
    const actualHash = sha(bytes);
    if (bytes.length !== row.bytes || actualHash !== row.sha256) {
      throw Object.assign(new Error(`制作区模板文件已变化：${relative}。为避免使用未经确认的模板，本次未创建制作区。`), {
        code: 'AUTHORING_TEMPLATE_HASH_MISMATCH', stage: 'authoring-template-validation',
        operation: 'verify-template', path: absolute, relativePath: relative,
        expectedHash: row.sha256, actualHash, expectedSize: row.bytes, actualSize: bytes.length,
        hint: '请完全退出 Terre 和制作器，从完整安装包运行“04_修复安装.cmd”，确认使用当前已授权游戏刷新初始化模板后，再打开制作器。修复不会覆盖用户游戏或已有制作区。',
      });
    }
    files.push({ relative, bytes });
  }
  return { root, files, setHash: sha(jsonBytes(tree.files)) };
}

export function verifyAuthoringWorkspaceTemplate(template) {
  const source = validatePinnedTree(template);
  return Object.freeze({ root: source.root, files: source.files.length, sourceSetSha256: source.setHash });
}

const canonicalPathKey = (value) => path.resolve(value).toLowerCase();

function cleanupOwnedStage(files, directories) {
  for (const record of [...files].reverse()) {
    try {
      const current = inspectAbsolute(record.path, { missing: true, kind: "file" });
      if (!current.exists || current.identity !== record.identity) continue;
      const bytes = fs.readFileSync(current.path);
      if (bytes.length === record.bytes && sha(bytes) === record.sha256) fs.unlinkSync(current.path);
    } catch {}
  }
  for (const record of [...directories].reverse()) {
    try {
      const current = inspectAbsolute(record.path, { missing: true, kind: "directory" });
      if (current.exists && current.identity === record.identity) fs.rmdirSync(current.path);
    } catch {}
  }
}

function verifyOwnedStage(stage, directories, files, changedCode) {
  const expectedDirectories = new Map(directories.map((record) => [canonicalPathKey(record.path), record]));
  const expectedFiles = new Map(files.map((record) => [canonicalPathKey(record.path), record]));
  let directoryCount = 0, fileCount = 0;
  const visit = (directory) => {
    const expectedDirectory = expectedDirectories.get(canonicalPathKey(directory));
    const currentDirectory = inspectAbsolute(directory, { kind: "directory" });
    if (!expectedDirectory || currentDirectory.identity !== expectedDirectory.identity)
      fail(changedCode);
    directoryCount += 1;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        const expectedFile = expectedFiles.get(canonicalPathKey(target));
        const currentFile = inspectAbsolute(target, { kind: "file" });
        const bytes = fs.readFileSync(currentFile.path);
        if (!expectedFile || currentFile.identity !== expectedFile.identity ||
            bytes.length !== expectedFile.bytes || sha(bytes) !== expectedFile.sha256)
          fail(changedCode);
        fileCount += 1;
      } else {
        fail(changedCode);
      }
    }
  };
  visit(stage);
  if (directoryCount !== expectedDirectories.size || fileCount !== expectedFiles.size)
    fail(changedCode);
}

function createOwnedStageWriter(stage, { invalidCode, changedCode }) {
  const directories = [], files = [], directoryByPath = new Map();
  const rememberDirectory = (record) => {
    directories.push(record);
    directoryByPath.set(canonicalPathKey(record.path), record);
  };
  try {
    const parent = inspectAbsolute(path.dirname(stage), { kind: "directory" });
    if (inspectAbsolute(stage, { missing: true }).exists) fail(changedCode);
    try { fs.mkdirSync(stage); }
    catch (error) {
      if (error?.code === "EEXIST") fail(changedCode);
      throw error;
    }
    const createdStage = inspectAbsolute(stage, { kind: "directory" });
    rememberDirectory({ path: createdStage.path, identity: createdStage.identity });
    if (inspectAbsolute(parent.path, { kind: "directory" }).identity !== parent.identity) fail(changedCode);

    const ensureParent = (target) => {
      const parentPath = path.dirname(target), relative = path.relative(stage, parentPath);
      if (relative === "") return;
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(invalidCode);
      let cursor = stage;
      for (const part of relative.split(path.sep)) {
        cursor = path.join(cursor, part);
        const known = directoryByPath.get(canonicalPathKey(cursor));
        if (known) {
          if (inspectAbsolute(cursor, { kind: "directory" }).identity !== known.identity) fail(changedCode);
          continue;
        }
        if (inspectAbsolute(cursor, { missing: true, kind: "directory" }).exists) fail(changedCode);
        try { fs.mkdirSync(cursor); }
        catch (error) {
          if (error?.code === "EEXIST") fail(changedCode);
          throw error;
        }
        const created = inspectAbsolute(cursor, { kind: "directory" });
        rememberDirectory({ path: created.path, identity: created.identity });
      }
    };
    const write = (target, bytes) => {
      ensureParent(target);
      fs.writeFileSync(target, bytes, { flag: "wx" });
      const created = inspectAbsolute(target, { kind: "file" });
      const written = fs.readFileSync(created.path), expectedSha256 = sha(bytes);
      if (written.length !== bytes.length || sha(written) !== expectedSha256) fail(changedCode);
      files.push({ path: created.path, identity: created.identity, bytes: bytes.length, sha256: expectedSha256 });
    };
    return {
      write,
      verify: () => verifyOwnedStage(stage, directories, files, changedCode),
      cleanup: () => cleanupOwnedStage(files, directories),
    };
  } catch (error) {
    cleanupOwnedStage(files, directories);
    throw error;
  }
}

/** One-time copy into a dedicated user-owned authoring workspace. Existing unmarked
 * directories are never adopted; marked workspaces are never rewritten by this initializer.
 */
export function initializeAuthoringWorkspace({ authoringRoot, authorizedWorkspaceRoot, template, fault }) {
  const inspectedRoot = inspectAbsolute(authoringRoot, { missing: true, kind: "directory" });
  authoringRoot = inspectedRoot.path;
  const expected = path.join(authoringRoot, "workspace");
  const authorizedWorkspace = inspectAbsolute(authorizedWorkspaceRoot, { missing: true, kind: "directory" }).path;
  if (canonicalPathKey(authorizedWorkspace) !== canonicalPathKey(expected))
    fail("AUTHORING_WORKSPACE_NOT_AUTHORIZED");
  const current = inspectAbsolute(expected, { missing: true, kind: "directory" });
  if (current.exists) {
    const markerPath = path.join(expected, ".webgal-attachment-authoring-workspace.json");
    const markerFile = inspectAbsolute(markerPath, { missing: true, kind: "file" });
    if (!markerFile.exists) fail("AUTHORING_WORKSPACE_UNCLAIMED");
    const marker = parse(fs.readFileSync(markerFile.path), "AUTHORING_WORKSPACE_MARKER_INVALID");
    if (marker.schema !== "webgal-attachment-authoring-workspace" || marker.schemaVersion !== 2 || marker.userOwned !== true)
      fail("AUTHORING_WORKSPACE_MARKER_INVALID");
    return Object.freeze({ ok: true, status: "REUSED_USER_OWNED", wrote: false, workspaceRoot: expected });
  }
  const source = validatePinnedTree(template);
  const stage = path.join(authoringRoot, `.workspace-staging-${randomUUID()}`);
  if (canonicalPathKey(path.dirname(stage)) !== canonicalPathKey(authoringRoot))
    fail("AUTHORING_WORKSPACE_STAGE_INVALID");
  const ownedRootDirectories = [];
  let staged = null;
  let activeRootIdentity = inspectedRoot.identity;
  try {
    if (!inspectedRoot.exists) {
      const parent = inspectAbsolute(path.dirname(authoringRoot), { kind: "directory" });
      fault?.("before-root-create", { authoringRoot });
      try { fs.mkdirSync(authoringRoot); }
      catch (error) {
        if (error?.code === "EEXIST") fail("AUTHORING_ROOT_APPEARED");
        throw error;
      }
      const createdRoot = inspectAbsolute(authoringRoot, { kind: "directory" });
      if (inspectAbsolute(parent.path, { kind: "directory" }).identity !== parent.identity)
        fail("AUTHORING_ROOT_CHANGED");
      activeRootIdentity = createdRoot.identity;
      ownedRootDirectories.push({ path: createdRoot.path, identity: createdRoot.identity });
    } else if (inspectAbsolute(authoringRoot, { kind: "directory" }).identity !== activeRootIdentity) {
      fail("AUTHORING_ROOT_CHANGED");
    }
    if (inspectAbsolute(expected, { missing: true, kind: "directory" }).exists)
      fail("AUTHORING_WORKSPACE_APPEARED");
    staged = createOwnedStageWriter(stage, {
      invalidCode: "AUTHORING_WORKSPACE_STAGE_INVALID",
      changedCode: "AUTHORING_WORKSPACE_STAGE_CHANGED",
    });
    for (const file of source.files) {
      const target = path.join(stage, ...file.relative.split("/"));
      staged.write(target, file.bytes);
    }
    const markerBytes = jsonBytes({
      schema: "webgal-attachment-authoring-workspace", schemaVersion: 2, userOwned: true,
      createdAt: new Date().toISOString(), sourceKind: template.sourceKind,
      sourceRoot: source.root, sourceSetSha256: source.setHash,
      maintenancePolicy: "SEED_MISSING_ONLY_NEVER_OVERWRITE_OR_DELETE",
    });
    staged.write(path.join(stage, ".webgal-attachment-authoring-workspace.json"), markerBytes);
    fault?.("before-workspace-commit", { stage, workspaceRoot: expected });
    if (inspectAbsolute(authoringRoot, { kind: "directory" }).identity !== activeRootIdentity)
      fail("AUTHORING_ROOT_CHANGED");
    staged.verify();
    if (inspectAbsolute(expected, { missing: true }).exists) fail("AUTHORING_WORKSPACE_APPEARED");
    fs.renameSync(stage, expected);
    return Object.freeze({ ok: true, status: "CREATED_USER_OWNED", wrote: true, workspaceRoot: expected, files: source.files.length + 1 });
  } catch (error) {
    staged?.cleanup();
    cleanupOwnedStage([], ownedRootDirectories);
    throw error;
  }
}
