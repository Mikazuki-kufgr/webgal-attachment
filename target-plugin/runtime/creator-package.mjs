import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { relativePath, guardedPath, fail, stamp } from "./terre-path-guard.mjs";
import {
  creatorPresetLeaf,
  portableAdaptations,
  portableBinding,
  canonicalAnchorName,
  profileGeometryKey,
  normalizePortableLayerPath,
  validateApplyPayload,
  buildCreatorPreviewScene,
} from "./creator-contract.generated.mjs";
export const sha = (b) =>
  createHash("sha256").update(b).digest("hex").toUpperCase();
export const jsonBytes = (value) =>
  Buffer.from(JSON.stringify(value, null, 2) + "\n");
export const MAX_BODY = 12 * 1024 * 1024;
export function leafOf(presetId) {
  const { leaf } = creatorPresetLeaf(presetId);
  if (presetId !== `v2/${leaf}` || leaf.length > 96)
    fail("CREATOR_PRESET_INVALID");
  relativePath(leaf, { leaf: true });
  return leaf;
}
export function readChecked(file, max = MAX_BODY) {
  const info = guardedPath(
    file.owner,
    file.path.slice(file.owner.length + 1).replaceAll("\\", "/"),
    { kind: "file" }
  );
  if (info.stat.size > BigInt(max)) fail("CREATOR_FILE_TOO_LARGE");
  const bytes = fs.readFileSync(info.path);
  if (stamp(fs.lstatSync(info.path, { bigint: true })) !== info.stamp)
    fail("CREATOR_FILE_CHANGED");
  return bytes;
}
function portableStrings(value) {
  if (
    typeof value === "string" &&
    /(?:blob:|file:|https?:|[a-z]:[\\/]|\\\\)/i.test(value)
  )
    fail("CREATOR_NONPORTABLE_REFERENCE");
  if (value && typeof value === "object")
    for (const item of Object.values(value)) portableStrings(item);
}
// No browser decoding claimed: bounded PNG header checks, matching Creator's import limits.
function png(bytes) {
  if (
    bytes.length < 33 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    fail("CREATOR_INVALID_PNG");
  const w = bytes.readUInt32BE(16),
    h = bytes.readUInt32BE(20);
  if (!w || !h || w > 8192 || h > 8192 || w * h > 16 * 1024 * 1024)
    fail("CREATOR_PNG_DIMENSIONS");
}
export function validateDocument(document, presetId, selectedId, selectedAnchor) {
  leafOf(presetId);
  portableStrings(document);
  const ids = new Set(), geometry = new Map();
  for (const a of portableAdaptations(document)) {
    const id = a?.modelProfile?.modelProfileId;
    if (
      typeof id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]*$/.test(id) ||
      ids.has(JSON.stringify([id, canonicalAnchorName(a?.preset?.anchorName)]))
    )
      fail("CREATOR_DUPLICATE_OR_INVALID_PROFILE");
    ids.add(JSON.stringify([id, canonicalAnchorName(a.preset.anchorName)]));
    const profileGeometry = profileGeometryKey(a.modelProfile);
    if (geometry.has(id) && geometry.get(id) !== profileGeometry) fail('CREATOR_PROFILE_GEOMETRY_CONFLICT');
    geometry.set(id, profileGeometry);
    portableBinding(document, presetId, document.asset?.attachmentAssetId, id, a.preset.anchorName);
    const p = a.modelProfile;
    const model = relativePath(String(p.modelPath ?? "").replace(/^\.\//, ""));
    if (!model.startsWith("game/figure/") || !model.toLowerCase().endsWith(".json"))
      fail("CREATOR_MODEL_PATH_INVALID");
    if (
      !Array.isArray(p.anchors) ||
      !p.anchors.some((x) => x.name === a.preset.anchorName)
    )
      fail("CREATOR_PROFILE_ANCHOR_MISSING");
  }
  return portableBinding(
    document,
    presetId,
    document.asset?.attachmentAssetId,
    selectedId,
    selectedAnchor
  );
}
export function validatePayload(root, body) {
  leafOf(body?.presetId);
  if (
    !Array.isArray(body.files) ||
    body.files.length < 4 ||
    body.files.length > 5
  )
    fail("CREATOR_FILE_SET_INVALID");
  let total = 0,
    pngTotal = 0;
  const seen = new Set();
  for (const f of body.files) {
    relativePath(f.path);
    if (seen.has(f.path.toLowerCase())) fail("CREATOR_CASE_COLLISION");
    seen.add(f.path.toLowerCase());
    if (
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > MAX_BODY ||
      typeof f.base64 !== "string" ||
      f.base64.length > (MAX_BODY * 4) / 3 + 4
    )
      fail("CREATOR_FILE_SIZE_INVALID");
    const bytes = Buffer.from(f.base64, "base64");
    if (bytes.toString("base64") !== f.base64) fail("CREATOR_BASE64_INVALID");
    total += bytes.length;
    if (f.path.endsWith(".json") && bytes.length > 1024 * 1024)
      fail("CREATOR_JSON_TOO_LARGE");
    if (/\.png$/i.test(f.path)) {
      png(bytes);
      pngTotal += bytes.length;
    }
  }
  if (total > MAX_BODY || pngTotal > 8 * 1024 * 1024)
    fail("CREATOR_PACKAGE_TOO_LARGE");
  const v = validateApplyPayload(root, body);
  if (v.format !== "portable") fail("CREATOR_SELF_CONTAINED_PACKAGE_REQUIRED");
  validateDocument(v.packageDocument, v.presetId, v.modelProfileId, v.anchorName);
  portableStrings(
    JSON.parse(v.files.find((f) => f.path.endsWith("/manifest.json")).bytes)
  );
  return v;
}
export function encodedPayload(v) {
  return {
    presetId: v.presetId,
    attachmentAssetId: v.attachmentAssetId,
    modelProfileId: v.modelProfileId,
    anchorName: v.anchorName,
    files: v.files.map((f) => ({
      path: f.path,
      bytes: f.bytes.length,
      sha256: sha(f.bytes),
      base64: f.bytes.toString("base64"),
    })),
  };
}
export function mergeAdaptations(root, incoming, existing, createdAt) {
  if (!existing) return incoming;
  validateDocument(
    existing,
    incoming.presetId,
    portableAdaptations(existing)[0].modelProfile.modelProfileId,
    portableAdaptations(existing)[0].preset.anchorName
  );
  if (existing.asset.attachmentAssetId !== incoming.attachmentAssetId)
    fail("CREATOR_ASSET_ID_CONFLICT");
  const next = portableAdaptations(incoming.packageDocument),
    ids = new Set(next.map((a) => JSON.stringify([a.modelProfile.modelProfileId, canonicalAnchorName(a.preset.anchorName)])));
  // A path is a resource location, not adaptation identity. Retain every other pair.
  const adaptations = [
    ...portableAdaptations(existing).filter(
      (a) => !ids.has(JSON.stringify([a.modelProfile.modelProfileId, canonicalAnchorName(a.preset.anchorName)]))
    ),
    ...next,
  ].sort((a, b) =>
    a.modelProfile.modelProfileId.localeCompare(b.modelProfile.modelProfileId) ||
      a.preset.anchorName.localeCompare(b.preset.anchorName)
  );
  const document = {
    ...incoming.packageDocument,
    schemaVersion: 2,
    adaptations,
  };
  const packageBytes = jsonBytes(document),
    manifestFile = incoming.files.find((f) =>
      f.path.endsWith("/manifest.json")
    );
  const manifest = JSON.parse(manifestFile.bytes);
  if (typeof createdAt === "string") manifest.createdAt = createdAt;
  manifest.files = manifest.files.map((f) =>
    f.path === incoming.packagePath
      ? { ...f, bytes: packageBytes.length, sha256: sha(packageBytes) }
      : f
  );
  const files = incoming.files.map((f) =>
    f.path === incoming.packagePath
      ? { ...f, bytes: packageBytes }
      : f === manifestFile
      ? { ...f, bytes: jsonBytes(manifest) }
      : f
  );
  return validatePayload(root, encodedPayload({ ...incoming, files }));
}
export function validateTargetModelDependencies(
  access,
  handle,
  sourceModelPath,
  { motionName } = {}
) {
  if (typeof sourceModelPath !== "string")
    fail("CREATOR_MODEL_PATH_INVALID");
  let modelPath;
  try {
    // Parsed Profiles use canonical project-relative paths without `./`, while
    // older authored Profiles may still carry it. Both spellings identify the
    // same safe in-project file and must pass the same path guard.
    modelPath = relativePath(sourceModelPath.replace(/^\.\//, ""));
  } catch {
    fail("CREATOR_MODEL_PATH_INVALID");
  }
  if (!modelPath.startsWith("game/figure/") || !modelPath.toLowerCase().endsWith(".json"))
    fail("CREATOR_MODEL_PATH_INVALID");
  const missingDependency = (relative) => {
    const error = new Error("CREATOR_TARGET_MODEL_MISSING");
    error.code = "CREATOR_TARGET_MODEL_MISSING";
    error.targetPath = relative;
    error.userMessage = `目标游戏缺少人物模型文件：${relative}`;
    error.suggestion = "请先把这套人物模型完整放入目标游戏的 game/figure，再重新保存；制作器不会静默复制人物模型。";
    throw error;
  };
  const resolveDependency = (relative) => {
    try {
      return access.resolveProjectRead(handle, relative);
    } catch (error) {
      if (error?.code === "TERRE_PATH_MISSING") missingDependency(relative);
      throw error;
    }
  };
  let model;
  try {
    model = JSON.parse(readChecked(resolveDependency(modelPath), 1024 * 1024));
  } catch (error) {
    if (error?.code === "TERRE_PATH_MISSING") missingDependency(modelPath);
    if (error instanceof SyntaxError) fail("CREATOR_TARGET_MODEL_JSON_INVALID");
    throw error;
  }
  const modelDirectory = path.posix.dirname(modelPath);
  const dependencies = new Set();
  const addDependency = (value) => {
    if (typeof value !== "string" || !value) return;
    const relative = path.posix.normalize(path.posix.join(modelDirectory, value));
    relativePath(relative);
    if (!relative.startsWith("game/figure/")) fail("CREATOR_MODEL_DEPENDENCY_PATH_INVALID");
    dependencies.add(relative);
  };
  addDependency(model.model);
  addDependency(model.physics);
  addDependency(model.pose);
  for (const texture of model.textures ?? []) addDependency(texture);
  if (typeof motionName === "string")
    for (const entry of model.motions?.[motionName] ?? [])
      addDependency(entry?.file);
  const refs = model.FileReferences ?? {};
  for (const key of ["Moc", "Physics", "Pose"]) addDependency(refs[key]);
  for (const texture of refs.Textures ?? []) addDependency(texture);
  if (typeof motionName === "string")
    for (const entry of refs.Motions?.[motionName] ?? [])
      addDependency(entry?.File);
  for (const dependency of dependencies) resolveDependency(dependency);
  return { modelPath, model, dependencies: [...dependencies].sort() };
}

export function previewScene(access, handle, v, namedPath) {
  const { modelPath, model } = validateTargetModelDependencies(
    access,
    handle,
    v.profile.modelPath
  );
  const motions = Object.entries(model.motions ?? {})
    .filter(
      ([, entries]) =>
        Array.isArray(entries) &&
        entries.some(
          (entry) => typeof entry?.file === "string" && entry.file.length > 0
        )
    )
    .map(([name]) => name)
    .sort();
  const characterId = String(v.profile?.characterId ?? "");
  const motionName = motions.includes(`${characterId}/idle01`)
    ? `${characterId}/idle01`
    : motions.find((name) => name.endsWith("/idle01")) ?? motions[0];
  if (motionName)
    validateTargetModelDependencies(access, handle, v.profile.modelPath, {
      motionName,
    });
  // Script interpolation must not accept delimiters/flags in filenames or motion names.
  const atom = (s) => {
    if (
      typeof s !== "string" ||
      !s ||
      /[\s;:\\"'<>]/u.test(s) ||
      s.startsWith("-")
    )
      fail("CREATOR_SCRIPT_RESOURCE_UNSAFE");
  };
  atom(modelPath);
  for (const name of Object.keys(model.motions ?? {})) atom(name);
  const info = access.inspectProject(handle),
    scene = buildCreatorPreviewScene(info.projectRoot, v);
  const leaf = leafOf(v.presetId);
  // Internal preview entry has an ASCII allowlist; user-facing game scenes use namedPath.
  const previewLeaf = /^[a-z0-9][a-z0-9._-]*$/.test(leaf) ? leaf : 'attachment-' + sha(Buffer.from(v.presetId)).slice(0,16).toLowerCase();
  scene.path = namedPath ?? `game/scene/ATTACHMENT-CREATOR-PREVIEW-${previewLeaf}.txt`;
  // Do not introduce a dependency on the old sample bg.webp.
  scene.bytes = Buffer.from(
    scene.bytes.toString("utf8").replace("changeBg:bg.webp -next;\n", "")
  );
  scene.sha256 = sha(scene.bytes);
  return scene;
}
