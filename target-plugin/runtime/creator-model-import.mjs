import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { guardedPath, relativePath, fail, withDirectoryInspectionScope } from "./terre-path-guard.mjs";
import { readChecked, sha, jsonBytes } from "./creator-package.mjs";
import { commitOwned } from "./creator-transaction.mjs";
import { modelImportDependencies, modelImportPath, modelImportReference, MODEL_IMPORT_MAX_BYTES, MODEL_IMPORT_MAX_FILES } from "./creator-model-files.generated.mjs";

const META = "game/attachments-v2/.creator-model-imports";
const modelRoot = id => `game/figure/creator-imports/${id}`;
const readable = (name, fallback) => {
 const value = String(name || fallback).replace(/[\u0000-\u001f<>:"/\\|?*%]/g, ' ').trim().replace(/[\s;'#]+/g, '_').replace(/[. ]+$/g, '').slice(0, 70);
 return !value || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? fallback : value;
};
const rowRoot = row => row.rootPath || modelRoot(row.id);
const recordPath = id => `${META}/${id}.json`;
const checkId = id => {
  if (typeof id !== "string" || !/^model-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    fail("CREATOR_MODEL_IMPORT_ID_INVALID");
  return id;
};
const parse = bytes => JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));

export function createModelImporter({ access, workspace, project, libraryProfiles, localModels = () => [], emit, fault }) {
  const read = (handle, p, max = MODEL_IMPORT_MAX_BYTES) => readChecked(access.resolveProjectRead(handle, p), max);
  const plan = (handle, root) => p => p.startsWith("game/figure/")
    ? access.planCreatorModelWrite(handle, p, root) : access.planAttachmentWrite(handle, p);
  function records() {
    const handle = workspace(), root = access.inspectProject(handle).projectRoot;
    const dir = guardedPath(root, META, { missing: true, kind: "directory" });
    if (!dir.exists) return [];
    const result = [];
    for (const file of fs.readdirSync(dir.path)) {
      if (!/^model-[a-f0-9-]+\.json$/.test(file)) continue;
      try {
        const id = checkId(file.slice(0, -5));
        const row = parse(read(handle, recordPath(id), 1024 * 1024));
        if (row.schema !== "webgal-creator-imported-model" || row.id !== id) continue;
        modelImportPath(row.entryPath);
        const root = rowRoot(row);
        relativePath(root);
        if (!root.startsWith('game/figure/') || root.split('/').length < 4) continue;
        if (row.modelPath !== `${root}/${row.entryPath}` || !Array.isArray(row.profileIds)) continue;
        for (const profileId of row.profileIds) relativePath(profileId, { leaf: true });
        result.push(row);
      } catch { /* Damaged user records cannot grant paths; another import remains possible. */ }
    }
    return result;
  }
  function existingProfileRows() {
    return records().flatMap(row => row.profileIds.map(id => ({ id, modelPath: row.modelPath })));
  }
  function importModel(body, { signal } = {}) {
    const entry = modelImportPath(body?.entryPath);
    if (!Array.isArray(body.files) || !body.files.length || body.files.length > MODEL_IMPORT_MAX_FILES)
      fail("CREATOR_MODEL_IMPORT_TOO_LARGE");
    let total = 0;
    const files = new Map(), folded = new Set();
    for (const file of body.files) {
      const p = modelImportPath(file.path);
      if (folded.has(p.toLowerCase())) fail("CREATOR_MODEL_IMPORT_DUPLICATE_PATH");
      folded.add(p.toLowerCase());
      if (typeof file.base64 !== "string" || file.base64.length > Math.ceil(MODEL_IMPORT_MAX_BYTES / 3) * 4)
        fail("CREATOR_MODEL_IMPORT_ENCODING_INVALID");
      const bytes = Buffer.from(file.base64, "base64");
      if (bytes.toString("base64") !== file.base64) fail("CREATOR_MODEL_IMPORT_ENCODING_INVALID");
      total += bytes.length;
      if (total > MODEL_IMPORT_MAX_BYTES) fail("CREATOR_MODEL_IMPORT_TOO_LARGE");
      files.set(p, bytes);
    }
    if (!files.has(entry)) fail("CREATOR_MODEL_IMPORT_DEPENDENCY_MISSING", entry);
    const model = parse(files.get(entry));
    const dependencies = modelImportDependencies(entry, model);
    for (const p of dependencies) if (!files.has(p)) fail("CREATOR_MODEL_IMPORT_DEPENDENCY_MISSING", p);
    if (files.size !== dependencies.length) fail("CREATOR_MODEL_IMPORT_UNREFERENCED_FILE");
    const id = `model-${randomUUID()}`, handle = workspace();
    const displayName = readable(body.displayName, '未命名人物');
    const appearanceName = readable(entry.split('/').slice(-2,-1)[0] || body.sourceFolderName || displayName, '自定义外观');
    // Names describe the source appearance. Geometry matching only supplies reusable anchors.
    // The short suffix reserves an exclusive per-import subtree without overwriting user folders.
    const root = `game/figure/${displayName}/${appearanceName}（导入-${id.slice(-8)}）`;
    if (guardedPath(access.inspectProject(handle).projectRoot, root, { missing:true, kind:'directory' }).exists)
      fail('CREATOR_MODEL_IMPORT_TARGET_CONFLICT', root);
    const mocSha256 = sha(files.get(modelImportReference(entry, model.model)));
    const matches = libraryProfiles().filter(p => p.fingerprint?.mocSha256?.toUpperCase() === mocSha256 && Array.isArray(p.anchors) && p.anchors.length);
    const characterId = matches.find(p => p.characterId === body.displayName || p.characterId === body.sourceFolderName)?.characterId
      ?? 'character-' + sha(Buffer.from(body.displayName || '未命名人物')).slice(0,12).toLowerCase();
    const profiles = matches.map((p, n) => ({ ...p, characterId, modelProfileId: `${id}-p${n + 1}`,
      modelId: `import-${id.slice(-6)}-${p.modelId}`,
      modelPath: `./${root}/${entry}`, fingerprint: { ...p.fingerprint, modelJsonSha256: sha(files.get(entry)), mocSha256 } }));
    const row = { schema: "webgal-creator-imported-model", schemaVersion: 1, id,
      displayName: typeof body.displayName === "string" ? body.displayName.slice(0, 120).replace(/[\u0000-\u001f]/g, " ") : entry,
      rootPath: root, appearanceName, characterId, sourceFolderName: body.sourceFolderName,
      entryPath: entry, modelPath: `${root}/${entry}`, dependencyCount: files.size,
      profileIds: profiles.map(p => p.modelProfileId),
      status: profiles.length ? "KNOWN_MOC_PROFILE_AVAILABLE" : "NEEDS_PROFILE", importedAt: new Date().toISOString() };
    const result = commitOwned({ access, plan: plan(handle), ownerId: id,
      ownershipPath: `${META}/${id}.owned.json`, journalPath: `${META}/${id}.journal.json`,
      files: [...files].map(([p, bytes]) => ({ path: `${root}/${p}`, bytes })).concat(
        profiles.map(p => ({ path: `game/attachments-v2/model-profiles/${p.modelProfileId}.json`, bytes: jsonBytes(p) })),
        [{ path: recordPath(id), bytes: jsonBytes(row) }]), signal, fault, maxFileBytes: MODEL_IMPORT_MAX_BYTES });
    if (!result.ok) return result;
    emit({ type: "model.import", result: "PERSISTED", modelPath: row.modelPath, status: row.status });
    return { ok: true, model: row, profiles, sourcePreserved: true, userVisualAcceptance: "PENDING" };
  }
  function copyToGame(body, { signal } = {}) {
    const selectedProfileId = typeof body?.id === 'string' && body.id.startsWith('profile:') ? body.id.slice(8) : null;
    const id = selectedProfileId
      ? `known-${sha(Buffer.from(selectedProfileId)).slice(0, 20).toLowerCase()}`
      : /^local-[a-f0-9]{20}$/.test(body?.id) ? body.id : checkId(body?.id);
    const source = workspace(), target = project(body.projectName);
    const sourceRoot = access.inspectProject(source).projectRoot;
    let row;
    if (selectedProfileId) {
      const profile = libraryProfiles().find(p => p.modelProfileId === selectedProfileId && Array.isArray(p.anchors) && p.anchors.length);
      if (!profile) fail('CREATOR_MODEL_IMPORT_NOT_FOUND');
      const modelPath = modelImportPath(String(profile.modelPath ?? '').replace(/^(\.\/)+/, ''));
      const parts = modelPath.split('/');
      if (parts.length < 5 || parts[0] !== 'game' || parts[1] !== 'figure' || !/\.json$/i.test(parts.at(-1)))
        fail('CREATOR_MODEL_IMPORT_PATH_INVALID');
      const rootPath = parts.slice(0, 3).join('/');
      row = { id, rootPath, entryPath: parts.slice(3).join('/'), modelPath };
    } else row = [...records(),...localModels()].find(r => r.id === id);
    if (!row) fail("CREATOR_MODEL_IMPORT_NOT_FOUND");
    const root = rowRoot(row), entryBytes = read(source, row.modelPath, 1024 * 1024);
    // Re-read editable user files, never restore an old hash baseline over user modifications.
    const deps = modelImportDependencies(row.entryPath, parse(entryBytes));
    const files = []; let total = 0;
    withDirectoryInspectionScope(() => {
    for (const p of deps) {
      const bytes = p === row.entryPath ? entryBytes : read(source, `${root}/${p}`, MODEL_IMPORT_MAX_BYTES - total);
      total += bytes.length;
      if (total > MODEL_IMPORT_MAX_BYTES) fail("CREATOR_MODEL_IMPORT_TOO_LARGE");
      files.push({ path: `${root}/${p}`, bytes });
    }
    for (const file of files) {
      const dest = access.planCreatorModelWrite(target, file.path, root);
      if (dest.exists && !readChecked(dest, MODEL_IMPORT_MAX_BYTES).equals(file.bytes))
        fail("CREATOR_MODEL_IMPORT_TARGET_CONFLICT", file.path);
    }
    });
    const result = commitOwned({ access, plan: plan(target, root), ownerId: id,
      ownershipPath: `${META}/${id}.owned.json`, journalPath: `${META}/${id}.journal.json`, files, signal, fault, maxFileBytes: MODEL_IMPORT_MAX_BYTES,
      validateReadSet: () => withDirectoryInspectionScope(() => {
        // Recheck the source capability once per synchronous read-set phase. Each
        // actual file read still checks all ancestors, file identity and contents.
        access.inspectProject(source);
        for (const file of files) {
          const current = readChecked({ owner: sourceRoot, path: `${sourceRoot}/${file.path}` }, MODEL_IMPORT_MAX_BYTES);
          if (!current.equals(file.bytes)) fail("CREATOR_MODEL_IMPORT_SOURCE_CHANGED");
        }
      }) });
    if (result.ok) emit({ type: "model.copy-to-game", result: "PERSISTED", projectName: body.projectName, modelPath: row.modelPath });
    return { ...result, modelPath: row.modelPath, sourcePreserved: true };
  }
  return { records, existingProfileRows, importModel, copyToGame };
}
