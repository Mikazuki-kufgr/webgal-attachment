import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fail, inspectAbsolute } from "./terre-path-guard.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const forbidden = /(?:^|\/)(?:live2d(?:\.min)?\.js|Live2D\.js|CubismCore\.js)$|\.(?:moc3?|model3?\.json|dll|exe)$/i;
const allowed = Object.freeze({
  "library-index": /^library-index\.json$/,
  "attachment-asset": /^attachment-assets\/[A-Za-z0-9._-]+\.json$/,
  "placement-preset": /^placement-presets\/[A-Za-z0-9._-]+\.json$/,
  "model-profile": /^model-profiles\/[A-Za-z0-9._-]+\.json$/,
  "attachment-image": /^files\/[A-Za-z0-9._/-]+\.png$/,
  "validation-record": /^validation\/[A-Za-z0-9._-]+\.json$/,
  "factory-sample-document": /^portable-samples\/[\p{L}0-9._-]+\/[A-Za-z0-9._-]+\/attachment\.json$/u,
  "factory-sample-manifest": /^portable-samples\/[\p{L}0-9._-]+\/[A-Za-z0-9._-]+\/manifest\.json$/u,
  "factory-sample-guide": /^portable-samples\/[\p{L}0-9._-]+\/[A-Za-z0-9._-]+\/使用说明\.txt$/u,
  "factory-sample-image": /^portable-samples\/[\p{L}0-9._-]+\/[A-Za-z0-9._-]+\/images\/(?:back|front)\.png$/u,
});
function relative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("%") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) fail("PRODUCT_RESOURCE_PATH_INVALID");
  return value;
}
function readJson(file, code) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail(code);
  }
  return value;
}
function walk(root, at = root) {
  return fs.readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(at, entry.name);
    if (entry.isSymbolicLink()) fail("PRODUCT_RESOURCE_LINK_REJECTED");
    if (entry.isDirectory()) return walk(root, absolute);
    if (!entry.isFile()) fail("PRODUCT_RESOURCE_KIND_REJECTED");
    return [path.relative(root, absolute).split(path.sep).join("/")];
  });
}

/** A product resource manifest is data, never an authority grant. Every admitted byte is
 * pinned and the directory must contain exactly the manifest file set. SDK/model binaries
 * are rejected even if a future manifest tries to label them as another role.
 */
export function loadProductResources({ root, manifestPath }) {
  root = inspectAbsolute(root, { kind: "directory" }).path;
  manifestPath = inspectAbsolute(manifestPath, { kind: "file" }).path;
  const manifest = readJson(manifestPath, "PRODUCT_RESOURCE_MANIFEST_INVALID");
  if (
    manifest.schema !== "webgal-attachment-product-resources" ||
    manifest.schemaVersion !== 1 ||
    manifest.targetHost?.product !== "webgal-mygo" ||
    manifest.targetHost?.version !== "3.2.1" ||
    manifest.distribution?.live2dSdk !== "PENDING_PERMISSION_EXCLUDED" ||
    manifest.distribution?.modelBinaries !== "NOT_BUNDLED" ||
    !Array.isArray(manifest.files)
  ) fail("PRODUCT_RESOURCE_MANIFEST_INVALID");
  const seen = new Set(), rows = [], bytesByPath = new Map();
  for (const row of manifest.files) {
    const logical = relative(row.path);
    if (seen.has(logical.toLowerCase())) fail("PRODUCT_RESOURCE_DUPLICATE");
    seen.add(logical.toLowerCase());
    if (!allowed[row.role]?.test(logical) || forbidden.test(logical))
      fail("PRODUCT_RESOURCE_NOT_ALLOWED");
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[A-F0-9]{64}$/.test(row.sha256))
      fail("PRODUCT_RESOURCE_MANIFEST_INVALID");
    const absolute = path.join(root, ...logical.split("/"));
    const info = inspectAbsolute(absolute, { kind: "file" });
    const bytes = fs.readFileSync(info.path);
    if (bytes.length !== row.bytes || sha(bytes) !== row.sha256)
      fail("PRODUCT_RESOURCE_HASH_MISMATCH", logical);
    rows.push(Object.freeze({ ...row, path: logical }));
    bytesByPath.set(logical, bytes);
  }
  const actual = walk(root).sort();
  const listed = rows.map((row) => row.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(listed))
    fail("PRODUCT_RESOURCE_DIRECTORY_DRIFT");
  const index = readJson(path.join(root, "library-index.json"), "PRODUCT_LIBRARY_INDEX_INVALID");
  if (
    index.schema !== "webgal-global-authoring-library-index" ||
    index.schemaVersion !== 1 ||
    !Array.isArray(index.builtinSamples)
  ) fail("PRODUCT_LIBRARY_INDEX_INVALID");
  for (const selection of [index.defaultSelection, ...index.builtinSamples]) {
    for (const key of ["modelProfile", "attachmentAsset", "placementPreset"])
      if (!bytesByPath.has(relative(selection[key]))) fail("PRODUCT_LIBRARY_REFERENCE_MISSING");
    if (!Array.isArray(selection.files) || !selection.files.length)
      fail("PRODUCT_LIBRARY_INDEX_INVALID");
    for (const file of selection.files)
      if (!bytesByPath.has(relative(file))) fail("PRODUCT_LIBRARY_REFERENCE_MISSING");
    if (selection.completeFolder) {
      const folder = relative(selection.completeFolder);
      for (const file of ['attachment.json', 'manifest.json', '使用说明.txt'])
        if (!bytesByPath.has(`${folder}/${file}`)) fail('PRODUCT_LIBRARY_REFERENCE_MISSING');
      const document = JSON.parse(bytesByPath.get(`${folder}/attachment.json`).toString('utf8'));
      for (const layer of ['back', 'front']) if (document.asset?.layers?.[layer] &&
        !bytesByPath.has(`${folder}/images/${layer}.png`)) fail('PRODUCT_LIBRARY_REFERENCE_MISSING');
    }
  }
  return Object.freeze({
    root,
    manifest: Object.freeze(manifest),
    rows: Object.freeze(rows),
    index: Object.freeze(index),
    read(logical) {
      const bytes = bytesByPath.get(relative(logical));
      if (!bytes) fail("PRODUCT_RESOURCE_NOT_FOUND");
      return Buffer.from(bytes);
    },
  });
}

export function resourceSelection(resources, sampleId = "default") {
  if (typeof sampleId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(sampleId))
    fail("PRODUCT_SAMPLE_ID_INVALID");
  const selection = sampleId === "default"
    ? resources.index.defaultSelection
    : resources.index.builtinSamples.find((row) => row.id === sampleId);
  if (!selection) fail("PRODUCT_SAMPLE_NOT_FOUND");
  return Object.freeze({
    id: sampleId,
    modelProfile: selection.modelProfile,
    attachmentAsset: selection.attachmentAsset,
    placementPreset: selection.placementPreset,
    files: Object.freeze([...selection.files]),
  });
}
