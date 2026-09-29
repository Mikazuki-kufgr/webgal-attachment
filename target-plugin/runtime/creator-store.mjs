import { withDirectoryInspectionScope, directoryInspectionScope } from "./terre-path-guard.mjs";
import {
  builtinIdentity,
  canonicalBuiltinId,
  legacyBuiltinAlias,
} from "./builtin-identity.mjs";
import { creatorScenePath } from "./creator-scene-name.mjs";
import { authoringSelection, repairAuthoringSelection } from './creator-authoring-selection.mjs';
import fs from "node:fs";
import path from "node:path";
import { createTerreProjectAccess } from "./terre-project-access.mjs";
import { guardedPath, relativePath, fail } from "./terre-path-guard.mjs";
import {
  portableAdaptations,
  normalizePortableLayerPath,
} from "./creator-contract.generated.mjs";
import {
  leafOf,
  readChecked,
  validateDocument,
  validatePayload,
  validateTargetModelDependencies,
  mergeAdaptations,
  previewScene,
  sha,
  jsonBytes,
} from "./creator-package.mjs";
import { commitOwned } from "./creator-transaction.mjs";
import { AUTHORED_PROFILE_ID, validateAuthoredProfile } from './creator-anchor-profile.mjs';
import { createMeshLabelStore } from './creator-mesh-labels.mjs';
import { modelImportReference } from './creator-model-files.generated.mjs';
import { createModelImporter } from "./creator-model-import.mjs";
import { MODEL_IMPORT_MAX_BYTES } from "./creator-model-files.generated.mjs";
const OWN = "game/attachments-v2/.webgal-attachment-creator/game-save-v2.json";
const JOURNAL =
  "game/attachments-v2/.webgal-attachment-creator/transaction-v2.json";
const warning = "NOT_VALIDATED";
const WORKSPACE = Symbol("trusted-authoring-workspace");
const BUILTIN_SAMPLES = Object.freeze([
  Object.freeze({
    id: "flower",
    name: "花朵",
    description: "单前层、可调整位置的完整附件样例。",
    presetId: "v2/flower-front-v1",
    files: Object.freeze([
      "game/attachments-v2/files/builtin-samples/flower/front.png",
    ]),
    required: Object.freeze([
      "placement-presets/anon-flower-front-v1.json",
      "attachment-assets/builtin-flower-front-v1.json",
      "files/builtin-samples/flower/front.png",
    ]),
  }),
  Object.freeze({
    id: "rose",
    name: "玫瑰",
    description: "单前层、可调整位置的完整附件样例。",
    presetId: "v2/rose-front-v1",
    files: Object.freeze([
      "game/attachments-v2/files/builtin-samples/rose/front.png",
    ]),
    required: Object.freeze([
      "placement-presets/anon-rose-front-v1.json",
      "attachment-assets/builtin-rose-front-v1.json",
      "files/builtin-samples/rose/front.png",
    ]),
  }),
  Object.freeze({
    id: "straw-hat",
    name: "草帽",
    description: "前后双层、随人物头部运动的完整附件样例。",
    presetId: "v2/straw-hat-both-v1",
    files: Object.freeze([
      "game/attachments-v2/files/builtin-samples/straw-hat/back.png",
      "game/attachments-v2/files/builtin-samples/straw-hat/front.png",
    ]),
    required: Object.freeze([
      "placement-presets/anon-straw-hat-both-v1.json",
      "attachment-assets/builtin-straw-hat-both-v1.json",
      "files/builtin-samples/straw-hat/back.png",
      "files/builtin-samples/straw-hat/front.png",
    ]),
  }),
  Object.freeze({
    id: "kemomimi",
    name: "兽耳",
    description: "单前层、随人物头部运动的完整附件样例。",
    presetId: "v2/kemomimi-front-v1",
    files: Object.freeze([
      "game/attachments-v2/files/builtin-samples/kemomimi/front.png",
    ]),
    required: Object.freeze([
      "placement-presets/anon-kemomimi-front-v1.json",
      "attachment-assets/builtin-kemomimi-front-v1.json",
      "files/builtin-samples/kemomimi/front.png",
    ]),
  }),
  Object.freeze({
    id: "halo",
    name: "光环",
    description: "单前层、随人物头部运动的完整附件样例。",
    presetId: "v2/halo-front-v1",
    files: Object.freeze([
      "game/attachments-v2/files/builtin-samples/halo/front.png",
    ]),
    required: Object.freeze([
      "placement-presets/anon-halo-front-v1.json",
      "attachment-assets/builtin-halo-front-v1.json",
      "files/builtin-samples/halo/front.png",
    ]),
  }),
]);
const BUILTIN_LIBRARY_RESOURCE_MAP = new Map([
  [
    "game/attachments-v2/presets/anon-flower-front-v1.json",
    "placement-presets/anon-flower-front-v1.json",
  ],
  [
    "game/attachments-v2/assets/builtin-flower-front-v1.json",
    "attachment-assets/builtin-flower-front-v1.json",
  ],
  [
    "game/attachments-v2/files/builtin-samples/flower/front.png",
    "files/builtin-samples/flower/front.png",
  ],
  [
    "game/attachments-v2/presets/anon-rose-front-v1.json",
    "placement-presets/anon-rose-front-v1.json",
  ],
  [
    "game/attachments-v2/assets/builtin-rose-front-v1.json",
    "attachment-assets/builtin-rose-front-v1.json",
  ],
  [
    "game/attachments-v2/files/builtin-samples/rose/front.png",
    "files/builtin-samples/rose/front.png",
  ],
  [
    "game/attachments-v2/presets/anon-straw-hat-both-v1.json",
    "placement-presets/anon-straw-hat-both-v1.json",
  ],
  [
    "game/attachments-v2/presets/anon-kemomimi-front-v1.json",
    "placement-presets/anon-kemomimi-front-v1.json",
  ],
  [
    "game/attachments-v2/presets/anon-halo-front-v1.json",
    "placement-presets/anon-halo-front-v1.json",
  ],
  [
    "game/attachments-v2/assets/builtin-straw-hat-both-v1.json",
    "attachment-assets/builtin-straw-hat-both-v1.json",
  ],
  [
    "game/attachments-v2/assets/builtin-kemomimi-front-v1.json",
    "attachment-assets/builtin-kemomimi-front-v1.json",
  ],
  [
    "game/attachments-v2/assets/builtin-halo-front-v1.json",
    "attachment-assets/builtin-halo-front-v1.json",
  ],
  [
    "game/attachments-v2/files/builtin-samples/straw-hat/back.png",
    "files/builtin-samples/straw-hat/back.png",
  ],
  [
    "game/attachments-v2/files/builtin-samples/straw-hat/front.png",
    "files/builtin-samples/straw-hat/front.png",
  ],
  [
    "game/attachments-v2/files/builtin-samples/kemomimi/front.png",
    "files/builtin-samples/kemomimi/front.png",
  ],
  [
    "game/attachments-v2/files/builtin-samples/halo/front.png",
    "files/builtin-samples/halo/front.png",
  ],
]);

/** Trusted launcher grants only. No caller-supplied absolute project/library path is used. */
export function createCreatorStore(options, { log = () => {}, fault } = {}) {
  options = structuredClone(options);
  const access = createTerreProjectAccess(options),
    handles = new Map();
  const emit = (event) => {
    try {
      log({ time: new Date().toISOString(), ...event });
    } catch {
      /* Logging must never turn a committed save into failure. */
    }
  };
  function handle(name) {
    if (name === WORKSPACE) {
      if (!handles.has(WORKSPACE))
        handles.set(WORKSPACE, access.openAuthoringWorkspace());
      return handles.get(WORKSPACE);
    }
    relativePath(name, { leaf: true });
    const key = name.toLowerCase();
    if (!handles.has(key)) handles.set(key, access.openProject(name));
    return handles.get(key);
  }
  function info(name) {
    return access.inspectProject(handle(name));
  }
  function read(name, p) {
    return readChecked(
      access.resolveProjectRead(handle(name), p),
      p.startsWith("game/figure/") ? MODEL_IMPORT_MAX_BYTES : undefined
    );
  }
  function libraryModelProfiles() {
    const dir = guardedPath(access.describe().libraryRoot, "model-profiles", {
      missing: true,
      kind: "directory",
    });
    if (!dir.exists) return [];
    const result = [];
    for (const name of fs.readdirSync(dir.path)) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      try {
        const p = JSON.parse(
          readChecked(
            access.resolveLibraryRead(`model-profiles/${name}`),
            4 * 1024 * 1024
          )
            .toString("utf8")
            .replace(/^\uFEFF/, "")
        );
        if (
          p.schema === "webgal-live2d-model-profile" &&
          p.schemaVersion === 1 &&
          typeof p.modelProfileId === "string"
        )
          result.push(p);
      } catch {
        /* Invalid unrelated library files do not become import candidates. */
      }
    }
    return result;
  }
  function authoredProfiles() {
    return libraryModelProfiles().filter(p => AUTHORED_PROFILE_ID.test(p.modelProfileId));
  }
  const discoveredByScope = new WeakMap();
  function discoverLocalModels() {
    return withDirectoryInspectionScope(() => {
      const scope=directoryInspectionScope(); if(discoveredByScope.has(scope)) return discoveredByScope.get(scope);
      const result={models:[],profiles:[]}; discoveredByScope.set(scope,result);
      if(!options.authorizedAuthoringWorkspaceRoot) return result;
      const root=info(WORKSPACE).projectRoot, library=libraryModelProfiles();
      const known=new Set([...library.map(p=>p.modelPath.replace(/^(\.\/)+/,'')),...modelImporter.records().map(m=>m.modelPath)]);
      const figure=guardedPath(root,'game/figure',{missing:true,kind:'directory'});if(!figure.exists)return result;
      let visited=0;
      function visit(relative) {
        if(++visited>4096) fail('CREATOR_MODEL_IMPORT_TOO_LARGE');
        const dir=guardedPath(root,relative,{kind:'directory'});
        for(const file of fs.readdirSync(dir.path,{withFileTypes:true})) {
          if(file.name.startsWith('.'))continue;
          const p=relative+'/'+file.name;
          if(file.isDirectory()){visit(p);continue;}
          if(!file.isFile() || !/\.json$/i.test(file.name) || known.has(p))continue;
          try {
            const entry=read(WORKSPACE,p), raw=JSON.parse(entry.toString('utf8').replace(/^\uFEFF/,''));
            if(typeof raw.model!=='string'||!Array.isArray(raw.textures)||!raw.model.endsWith('.moc'))continue;
            const mocPath=modelImportReference(p,raw.model);if(!mocPath.startsWith('game/figure/'))continue;
            const mocHash=sha(read(WORKSPACE,mocPath));
            const parts=p.split('/'), displayName=parts[2], appearanceName=parts.length>4?parts.at(-2):file.name.replace(/\.json$/i,'');
            const id='local-'+sha(Buffer.from(p)).slice(0,20).toLowerCase(),rootPath='game/figure/'+parts[2];
            const matches=library.filter(profile=>profile.fingerprint?.mocSha256?.toUpperCase()===mocHash && profile.anchors?.length);
            const characterId=library.find(profile=>profile.characterId===displayName)?.characterId || 'character-'+sha(Buffer.from(displayName)).slice(0,12).toLowerCase();
            const profiles=matches.map((profile,n)=>({...profile,modelProfileId:id+'-p'+(n+1),characterId,modelId:id,
              modelPath:p,fingerprint:{...profile.fingerprint,mocSha256:mocHash,modelJsonSha256:sha(entry)}}));
            result.profiles.push(...profiles);
            result.models.push({id,displayName,appearanceName,rootPath,entryPath:p.slice(rootPath.length+1),modelPath:p,
              characterId,profileIds:profiles.map(p=>p.modelProfileId),source:'workspace',status:profiles.length?'KNOWN_MOC_PROFILE_AVAILABLE':'NEEDS_PROFILE'});
          }catch(error){if(error.code==='TERRE_REPARSE_POINT_BLOCKED')throw error;}
        }
      }
      visit('game/figure');return result;
    });
  }
  function importedModelsWithAuthoredProfiles() {
    const profiles = authoredProfiles();
    return [...modelImporter.records(),...discoverLocalModels().models].map(row => {
      let current;
      try { current = anchorModelFacts(row.modelPath); } catch { return row; }
      const added = profiles.filter(p => p.modelPath.replace(/^(\.\/)+/, '') === row.modelPath &&
        p.fingerprint?.mocSha256?.toUpperCase() === current.mocSha256 && p.anchors?.length).map(p => p.modelProfileId);
      const profileIds = [...new Set([...row.profileIds, ...added])];
      return added.length ? { ...row, profileIds, status: 'KNOWN_MOC_PROFILE_AVAILABLE' } : row;
    });
  }
  function anchorModelFacts(modelPath) {
    const model = relativePath(String(modelPath ?? '').replace(/^\.\//, ''));
    if (!model.startsWith('game/figure/') || !model.toLowerCase().endsWith('.json')) fail('CREATOR_MODEL_PATH_INVALID');
    const bytes = read(WORKSPACE, model), raw = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (raw.FileReferences || typeof raw.model !== 'string' || !/\.moc$/i.test(raw.model)) fail('CREATOR_MODEL_IMPORT_RUNTIME_UNSUPPORTED');
    const moc = modelImportReference(model, raw.model);
    if (!moc.startsWith('game/figure/')) fail('CREATOR_MODEL_PATH_INVALID');
    return { modelPath: model, modelJsonSha256: sha(bytes), mocSha256: sha(read(WORKSPACE, moc)) };
  }
  const modelImporter = createModelImporter({
    access,
    workspace: () => handle(WORKSPACE),
    project: handle,
    libraryProfiles: libraryModelProfiles,
    localModels: () => discoverLocalModels().models,
    emit,
    fault,
  });
  function effectiveModelProfileIndex() {
    let index;
    try {
      let bytes;
      try {
        bytes = read(
          WORKSPACE,
          "game/attachments-v2/model-profiles/index.json"
        );
      } catch (error) {
        if (error.code !== "TERRE_PATH_MISSING") throw error;
        bytes = readChecked(
          access.resolveLibraryRead("model-profiles/index.json"),
          1024 * 1024
        );
      }
      index = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      if (error.code !== "TERRE_PATH_MISSING") throw error;
      index = {
        schema: "webgal-live2d-model-profile-index",
        schemaVersion: 1,
        profiles: [],
      };
    }
    if (
      index.schema !== "webgal-live2d-model-profile-index" ||
      index.schemaVersion !== 1 ||
      !Array.isArray(index.profiles)
    )
      fail("CREATOR_PROFILE_INDEX_INVALID");
    return {
      ...index,
      profiles: [
        ...new Set([
          ...index.profiles,
          ...modelImporter.existingProfileRows().map((p) => p.id),
          ...authoredProfiles().map(p => p.modelProfileId),
          ...discoverLocalModels().profiles.map(p=>p.modelProfileId),
        ]),
      ],
    };
  }
  function availableBuiltinSamples() {
    return BUILTIN_SAMPLES.filter((sample) =>
      [...sample.required, ...['attachment.json', 'manifest.json', '使用说明.txt'].map(file =>
        `portable-samples/${sample.name}/${sample.presetId.slice(3)}/${file}`)].every((relative) => {
        try {
          readChecked(access.resolveLibraryRead(relative), 16 * 1024 * 1024);
          return true;
        } catch {
          return false;
        }
      })
    ).map(({ required, ...sample }) => ({
      ...sample,
      files: [...sample.files],
      completeFolder: `portable-samples/${sample.name}/${sample.presetId.slice(3)}`,
    }));
  }
  function loadFactorySample(sampleId) {
    const sample = availableBuiltinSamples().find(row => row.id === sampleId);
    if (!sample) fail('CREATOR_FACTORY_SAMPLE_NOT_FOUND');
    const folder = sample.completeFolder;
    const readFactory = relative => readChecked(access.resolveLibraryRead(`${folder}/${relative}`), 16 * 1024 * 1024);
    const documentBytes = readFactory('attachment.json');
    const manifestBytes = readFactory('manifest.json');
    const document = JSON.parse(documentBytes.toString('utf8').replace(/^\uFEFF/, ''));
    const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
    const first = portableAdaptations(document)[0];
    validateDocument(document, sample.presetId, first.modelProfile.modelProfileId, first.preset.anchorName);
    if (manifest.presetId !== sample.presetId || manifest.attachmentDefinitionId !== document.asset.attachmentAssetId)
      fail('CREATOR_FACTORY_SAMPLE_MANIFEST_INVALID');
    const gameRoot = `game/attachments-v2/portable/${sample.presetId.slice(3)}`;
    const files = new Map([[`${gameRoot}/attachment.json`, documentBytes],
      [`${gameRoot}/使用说明.txt`, readFactory('使用说明.txt')]]);
    const layers = {};
    for (const layer of ['back', 'front']) {
      const source = document.asset.layers?.[layer];
      if (!source) continue;
      if (source !== `./${gameRoot}/images/${layer}.png`) fail('CREATOR_FACTORY_SAMPLE_LAYER_INVALID');
      const bytes = readFactory(`images/${layer}.png`);
      files.set(`${gameRoot}/images/${layer}.png`, bytes);
      layers[layer] = { path: `${gameRoot}/images/${layer}.png`, fileName: `${layer}.png`,
        bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') };
    }
    const differences = [];
    for (const [logical, bytes] of files) {
      const expected = manifest.files?.find(row => row.path === logical);
      if (!expected || expected.bytes !== bytes.length || expected.sha256 !== sha(bytes))
        differences.push({ path: logical, status: 'CONTENT_CHANGED', expectedSha256: expected?.sha256, currentSha256: sha(bytes) });
    }
    return { ok: true, projectName: 'factory-library', presetId: sample.presetId,
      packageDocument: document, preferredSelection: authoringSelection(document, manifest),
      createdAt: manifest.createdAt, layers, revision: sha(jsonBytes([...files].map(([logical, bytes]) => [logical, sha(bytes)]).sort())),
      integrity: differences.length ? 'FACTORY_USER_EDITED' : 'HASH_VALIDATED', integrityDifferences: differences };
  }
  function availableAuthoringModelProfiles() {
    const result = {
      status: "PROFILE_INDEX_UNAVAILABLE",
      ids: [],
      reviewIds: [],
      unavailableCount: 0,
    };
    if (!options.authorizedAuthoringWorkspaceRoot) return result;
    let index;
    try {
      index = effectiveModelProfileIndex();
    } catch {
      return result;
    }
    if (
      index?.schema !== "webgal-live2d-model-profile-index" ||
      index.schemaVersion !== 1 ||
      !Array.isArray(index.profiles)
    )
      return { ...result, status: "PROFILE_INDEX_INVALID" };
    const importedIds = new Set(
      modelImporter.existingProfileRows().map((p) => p.id)
    );
    for (const id of index.profiles) {
      try {
        relativePath(id, { leaf: true });
        const local = discoverLocalModels().profiles.find(p=>p.modelProfileId===id);
        const profile = local ?? JSON.parse(
          readChecked(
            importedIds.has(id)
              ? access.resolveProjectRead(
                  handle(WORKSPACE),
                  `game/attachments-v2/model-profiles/${id}.json`
                )
              : access.resolveLibraryRead(`model-profiles/${id}.json`),
            4 * 1024 * 1024
          )
            .toString("utf8")
            .replace(/^\uFEFF/, "")
        );
        if (
          profile?.modelProfileId !== id ||
          typeof profile.modelPath !== "string" ||
          typeof profile.fingerprint?.mocSha256 !== "string"
        )
          throw new Error("PROFILE_IDENTITY_INVALID");
        const modelRelative = profile.modelPath.replace(/^\.\//, "");
        relativePath(modelRelative);
        if (
          !modelRelative.startsWith("game/figure/") ||
          !modelRelative.toLowerCase().endsWith(".json")
        )
          throw new Error("PROFILE_MODEL_PATH_INVALID");
        const modelBytes = readChecked(
          access.resolveProjectRead(handle(WORKSPACE), modelRelative),
          4 * 1024 * 1024
        );
        const model = JSON.parse(
          modelBytes.toString("utf8").replace(/^\uFEFF/, "")
        );
        if (typeof model?.model !== "string")
          throw new Error("PROFILE_MOC_PATH_MISSING");
        const mocRelative = path.posix.normalize(
          path.posix.join(path.posix.dirname(modelRelative), model.model)
        );
        relativePath(mocRelative);
        if (!mocRelative.startsWith("game/figure/"))
          throw new Error("PROFILE_MOC_PATH_INVALID");
        const mocBytes = readChecked(
          access.resolveProjectRead(handle(WORKSPACE), mocRelative),
          64 * 1024 * 1024
        );
        if (sha(mocBytes) === profile.fingerprint.mocSha256)
          result.ids.push(id);
        else result.reviewIds.push(id);
      } catch {
        result.unavailableCount += 1;
      }
    }
    result.status = result.ids.length
      ? result.reviewIds.length
        ? "READY_WITH_USER_REVIEW_MODELS"
        : "READY_COMPATIBLE_MODELS"
      : result.reviewIds.length
      ? "USER_REVIEW_MODELS_ONLY"
      : "NO_LOCAL_MODELS_AVAILABLE";
    return result;
  }
  function findPackage(name, presetId) {
    const leaf = leafOf(presetId),
      root = info(name).projectRoot;
    const candidates = [
      `game/attachments-v2/portable/${leaf}`,
      `game/attachments-v2/${leaf}`,
    ].filter(
      (p) =>
        guardedPath(root, p + "/attachment.json", {
          missing: true,
          kind: "file",
        }).exists
    );
    if (candidates.length > 1) fail("CREATOR_DUPLICATE_PACKAGE_LOCATION");
    return candidates[0];
  }
  function load(name, presetId) {
    const canonical = canonicalBuiltinId(presetId);
    if (canonical !== presetId && findPackage(name, canonical))
      presetId = canonical;
    const location = findPackage(name, presetId);
    if (!location) fail("CREATOR_SAVED_ATTACHMENT_NOT_FOUND");
    const parse = (b) => JSON.parse(b.toString("utf8").replace(/^\uFEFF/, ""));
    const packageBytes = read(name, location + "/attachment.json"),
      doc = parse(packageBytes);
    const adaptations = portableAdaptations(doc),
      selected = adaptations[0]?.modelProfile?.modelProfileId;
    validateDocument(doc, presetId, selected, adaptations[0]?.preset?.anchorName);
    const files = new Map([[location + "/attachment.json", packageBytes]]),
      layers = {};
    for (const layer of ["back", "front"]) {
      const value =
        doc.asset.layers?.[layer] ?? doc.asset.attachedLayers?.[layer];
      if (!value) continue;
      const p = normalizePortableLayerPath(value, location),
        bytes = read(name, p);
      files.set(p, bytes);
      layers[layer] = {
        path: p,
        fileName: path.posix.basename(p),
        bytes: bytes.length,
        sha256: sha(bytes),
        base64: bytes.toString("base64"),
      };
    }
    if (Object.keys(layers).length < 1) fail("CREATOR_LAYER_MISSING");
    files.set(
      location + "/使用说明.txt",
      read(name, location + "/使用说明.txt")
    );
    const manifestBytes = read(name, location + "/manifest.json"),
      manifest = parse(manifestBytes);
    let owners = [];
    if (
      guardedPath(info(name).projectRoot, OWN, { missing: true, kind: "file" })
        .exists
    ) {
      let ledger;
      try { ledger = parse(read(name, OWN)); }
      catch { fail("CREATOR_OWNERSHIP_INVALID", "附件保存记录无法解析，请保留附件与记录文件，先检查或恢复记录；制作器不会覆盖它。"); }
      if (
        ledger.schema === "webgal-attachment-creator-owned-files" &&
        ledger.schemaVersion === 2 &&
        ledger.ownerId === `terre-project:${info(name).name}` &&
        Array.isArray(ledger.files)
      )
        owners = ledger.files;
    }
    const matches = (row, bytes) => {
      if (
        bytes.length === row.bytes &&
        sha(bytes) === String(row.sha256).toUpperCase()
      )
        return true;
      if (!/\.(json|txt)$/i.test(row.path)) return false;
      const owner = owners.find(
        (f) =>
          f.path === row.path &&
          f.sha256 === String(row.sha256).toUpperCase() &&
          f.bytes === row.bytes
      );
      return (
        owner?.normalizedSha256 ===
        sha(
          Buffer.from(
            bytes
              .toString("utf8")
              .replace(/^\uFEFF/, "")
              .replace(/\r\n/g, "\n")
          )
        )
      );
    };
    let integrity,
      integrityDifferences = [];
    if (manifest.schema === "webgal-attachment-creator-export-manifest") {
      if (
        manifest.schemaVersion !== 1 ||
        manifest.presetId !== presetId ||
        manifest.attachmentDefinitionId !== doc.asset.attachmentAssetId ||
        !Array.isArray(manifest.files)
      )
        fail("CREATOR_SAVED_MANIFEST_INVALID");
      const seen = new Set();
      for (const row of manifest.files) {
        const bytes = files.get(row.path);
        if (
          !row ||
          typeof row.path !== "string" ||
          !Number.isSafeInteger(row.bytes) ||
          row.bytes < 0 ||
          !/^[A-F0-9]{64}$/i.test(String(row.sha256 ?? "")) ||
          seen.has(row.path)
        )
          fail("CREATOR_SAVED_MANIFEST_INVALID");
        if (!bytes)
          integrityDifferences.push({
            path: row.path,
            status: "MANIFEST_ONLY",
          });
        else if (!matches(row, bytes))
          integrityDifferences.push({
            path: row.path,
            status: "CONTENT_CHANGED",
            expectedSha256: String(row.sha256).toUpperCase(),
            currentSha256: sha(bytes),
          });
        seen.add(row.path);
      }
      for (const [filePath, bytes] of files)
        if (!seen.has(filePath))
          integrityDifferences.push({
            path: filePath,
            status: "CURRENT_FILE_NOT_IN_MANIFEST",
            currentSha256: sha(bytes),
          });
      integrity = integrityDifferences.length
        ? "USER_EDITED_REVIEW_REQUIRED"
        : "HASH_VALIDATED";
    } else if (
      manifest.schema === "webgal-attachment-portable-folder" &&
      manifest.schemaVersion === 1 &&
      manifest.presetId === presetId &&
      Array.isArray(manifest.files)
    ) {
      const wanted = [...files.keys()]
        .map((p) => p.slice(location.length + 1))
        .sort();
      if (JSON.stringify([...manifest.files].sort()) !== JSON.stringify(wanted))
        fail("CREATOR_SAVED_MANIFEST_INVALID");
      integrity = "LEGACY_FILESET_ONLY_NO_STORED_HASH";
    } else fail("CREATOR_SAVED_MANIFEST_INVALID");
    files.set(location + "/manifest.json", manifestBytes);
    // Content integrity and local write ownership are separate. A copied,
    // hash-valid package is readable but must not be silently claimed by scan.
    const ownershipDifferences = [...files].filter(([filePath, bytes]) => {
      const row = owners.find(f => typeof f?.path === "string" &&
        f.path.toLowerCase() === filePath.toLowerCase());
      if (!row) return true;
      if (row.bytes === bytes.length && row.sha256 === sha(bytes)) return false;
      return !(/\.(json|txt)$/i.test(filePath) && row.normalizedSha256 ===
        sha(Buffer.from(bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"))));
    }).map(([filePath]) => filePath);
    const revision = sha(
      jsonBytes([...files].map(([p, b]) => [p, sha(b)]).sort())
    );
    access.inspectProject(handle(name));
    return {
      ok: true,
      projectName: name,
      presetId,
      packageDocument: doc,
      preferredSelection: authoringSelection(doc, manifest),
      createdAt: manifest.createdAt,
      layers,
      revision,
      packageRoot: location,
      integrity,
      integrityDifferences,
      ownershipRequiresReview: ownershipDifferences.length > 0,
      ownershipDifferences,
      runtimeCompatibility: warning,
      adaptationSelection: "EXPLICIT_PROFILE_ID_REQUIRED",
      readSet: [...files].map(([path, b]) => ({ path, sha256: sha(b) })),
    };
  }
  function listSaved(name) {
    const project = info(name),
      found = new Set(),
      saved = [],
      rejected = [];
    for (const rel of ["game/attachments-v2/portable", "game/attachments-v2"]) {
      const dir = guardedPath(project.projectRoot, rel, {
        missing: true,
        kind: "directory",
      });
      if (!dir.exists) continue;
      for (const e of fs.readdirSync(dir.path, { withFileTypes: true })) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue;
        if (
          e.name.startsWith(".") ||
          ["portable", "assets", "presets", "model-profiles", "files"].includes(
            e.name
          ) ||
          found.has(e.name)
        )
          continue;
        try {
          const marker = guardedPath(
            project.projectRoot,
            rel + "/" + e.name + "/attachment.json",
            { missing: true, kind: "file" }
          );
          if (!marker.exists) continue;
          if (
            JSON.parse(
              fs.readFileSync(marker.path, "utf8").replace(/^\uFEFF/, "")
            ).compatibilityAliasFor
          )
            continue;
          const item = load(name, `v2/${e.name}`),
            a = portableAdaptations(item.packageDocument);
          found.add(e.name);
          saved.push({
            key: `${project.name}|${item.presetId}`,
            projectName: project.name,
            presetId: item.presetId,
            displayName: item.packageDocument.displayName ?? e.name,
            adaptationCount: a.length,
            modelProfileIds: a.map((x) => x.modelProfile.modelProfileId),
            anchorNames: a.map((x) => x.preset.anchorName),
            adaptationDisplayNames: a.map(x => `${x.modelProfile.characterId ?? '人物'} / ${x.modelProfile.modelId ?? '外观'} · ${x.preset.handBinding ? '手部状态随动' : x.modelProfile.anchors?.find(anchor => anchor.name === x.preset.anchorName)?.displayName ?? x.preset.anchorName}`),
            modelPaths: a.map((x) => x.modelProfile.modelPath),
            revision: item.revision,
          });
        } catch (error) {
          rejected.push({
            projectName: name,
            name: e.name,
            code: error.code ?? error.message,
          });
        }
      }
    }
    return { saved, rejected };
  }
  function projectPlan(name, p) {
    if (p.startsWith("game/attachments-v2/"))
      return access.planAttachmentWrite(handle(name), p);
    const match =
      /^game\/scene\/ATTACHMENT-CREATOR-PREVIEW-([a-z0-9][a-z0-9._-]*)\.txt$/.exec(
        p
      );
    if (match) return access.planCreatorSceneWrite(handle(name), match[1]);
    if (p.startsWith("game/scene/附件测试-"))
      return access.planNamedCreatorSceneWrite(handle(name), p);
    fail("CREATOR_WRITE_SCOPE_INVALID");
  }
  return Object.freeze({
    projectAttachments(body) {
      const rows = listSaved(body.projectName);
      return { ok: true, savedAttachments: rows.saved, rejected: rows.rejected };
    },
    authoringAttachments() {
      // Fresh user-owned attachment inventory only. Loading an attachment must not
      // wait for every unrelated model/Profile and target game to be scanned.
      const rows = options.authorizedAuthoringWorkspaceRoot
        ? listSaved(WORKSPACE)
        : { saved: [], rejected: [] };
      return { ok: true, savedAttachments: rows.saved, rejected: rows.rejected };
    },
    targetProjects() {
      return withDirectoryInspectionScope(() => {
        const listed = access.listProjects();
        return { ok: true, targetProjects: listed.projects
          .filter(p => p.authorizedAccess)
          .map(p => ({ name: p.name, root: p.projectRoot,
            attachmentRoot: path.join(p.gameRoot, "attachments-v2"),
            writable: p.authorizedAccess === "attachment-write",
            runtimeCompatibility: warning })), rejected: listed.rejected };
      });
    },
    context() {
      return withDirectoryInspectionScope(() => {
      const layout = access.describe(),
        listed = access.listProjects(),
        targetProjects = [],
        savedAttachments = [],
        rejected = [...listed.rejected];
      for (const p of listed.projects) {
        if (!p.authorizedAccess) continue;
        const rows = listSaved(p.name);
        targetProjects.push({
          name: p.name,
          root: p.projectRoot,
          attachmentRoot: path.join(p.gameRoot, "attachments-v2"),
          writable: p.authorizedAccess === "attachment-write",
          runtimeCompatibility: warning,
        });
        savedAttachments.push(...rows.saved);
        rejected.push(...rows.rejected);
      }
      let workspace = {
        status: "NOT_AUTHORIZED",
        savedAttachments: [],
        rejected: [],
        availableModelProfileIds: [],
        reviewModelProfileIds: [],
        unavailableModelProfileCount: 0,
        modelAvailabilityStatus: "NOT_AUTHORIZED",
      };
      if (options.authorizedAuthoringWorkspaceRoot) {
        const rows = listSaved(WORKSPACE);
        const availableModels = availableAuthoringModelProfiles();
        workspace = {
          status: "AUTHORIZED_EXISTING_WORKSPACE",
          savedAttachments: rows.saved,
          rejected: rows.rejected,
          availableModelProfileIds: availableModels.ids,
          reviewModelProfileIds: availableModels.reviewIds,
          unavailableModelProfileCount: availableModels.unavailableCount,
          modelAvailabilityStatus: availableModels.status,
        };
      }
      const builtinSamples = availableBuiltinSamples();
      return {
        ok: true,
        importedModels: options.authorizedAuthoringWorkspaceRoot
          ? importedModelsWithAuthoredProfiles()
          : [],
        authoringWorkspace: {
          root: layout.workspaceRoot,
          inboxRoot: path.join(layout.authoringRoot, "inbox"),
          attachmentRoot: path.join(
            layout.workspaceRoot,
            "game/attachments-v2"
          ),
          ...workspace,
        },
        libraryRoot: layout.libraryRoot,
        targetProjects,
        savedAttachments,
        builtinSamples,
        builtinSamplesStatus:
          builtinSamples.length === BUILTIN_SAMPLES.length
            ? "READY_FROM_READ_ONLY_LIBRARY"
            : "PARTIAL_OR_MISSING",
        rejected,
        runtimeCompatibility: warning,
      };
      });
    },
    openAuthoringProject(body) {
      if (typeof body?.modelProfileId !== "string" || !body.modelProfileId)
        fail("CREATOR_EXPLICIT_ADAPTATION_REQUIRED");
      const result = load(WORKSPACE, body.presetId),
        selected = portableAdaptations(result.packageDocument).filter(
          (a) => a.modelProfile.modelProfileId === body.modelProfileId &&
            (body.anchorName === undefined || a.preset.anchorName === body.anchorName)
        );
      if (selected.length !== 1) fail("CREATOR_EXPLICIT_ADAPTATION_NOT_FOUND");
      const project = info(WORKSPACE);
      const owned = projectPlan(WORKSPACE, OWN);
      const paths = owned.exists ? JSON.parse(fs.readFileSync(owned.path, 'utf8')).files.map(f => f.path) : [];
      return {
        ok: true,
        project: {
          projectId: "creator-authoring-workspace",
          displayName: "附件制作工作区",
          root: project.projectRoot,
          safeCopy: false,
          dedicatedWorkspace: true,
          releaseVersion: "SOURCE_MIGRATION_5H",
          releaseRoot: options.installRoot,
          releaseManifestPath: "",
          projectEntry: creatorScenePath(result.presetId, result.packageDocument.displayName, paths),
          writable: true,
          ownershipStatus: "CONTENT_VALIDATION_ON_SAVE",
          previewUrl: "/preview/",
        },
        preset: selected[0].preset,
        profile: selected[0].modelProfile,
        asset: result.packageDocument.asset,
        packageDocument: result.packageDocument,
        layers: result.layers,
        revision: result.revision,
        ownership: { manifestPath: OWN, status: "CONTENT_VALIDATION_ON_SAVE" },
        runtimeCompatibility: warning,
      };
    },
    applyAuthoringPackage(body, options = {}) {
      if (
        !Object.hasOwn(body, "expectedRevision") ||
        !(
          body.expectedRevision === null ||
          typeof body.expectedRevision === "string"
        )
      )
        fail("CREATOR_EXPECTED_REVISION_REQUIRED");
      const result = this.saveToGame(
        { ...body, projectName: WORKSPACE },
        options
      );
      return {
        ...result,
        projectName: "authoring-workspace",
        previewUrl: "/preview/",
      };
    },
    saveAuthoringAttachment(body, options = {}) {
      if (
        !Object.hasOwn(body, "expectedRevision") ||
        !(
          body.expectedRevision === null ||
          typeof body.expectedRevision === "string"
        )
      )
        fail("CREATOR_EXPECTED_REVISION_REQUIRED");
      // Trusted workspace selection and save-only mode never come from request paths.
      return {
        ...this.saveToGame(
          { ...body, projectName: WORKSPACE },
          { ...options, saveOnly: true }
        ),
        projectName: "authoring-workspace",
      };
    },
    loadAuthoringAttachment(body) {
      return {
        ...load(WORKSPACE, body.presetId),
        projectName: "authoring-workspace",
      };
    },
    acceptAuthoringAttachmentChanges(body, options) {
      return {
        ...this.acceptAttachmentChanges(
          { ...body, projectName: WORKSPACE },
          options
        ),
        projectName: "authoring-workspace",
      };
    },
    readAuthoringResource(relative) {
      const localId = /^game\/attachments-v2\/model-profiles\/(local-[a-f0-9]{20}-p[0-9]+)\.json$/.exec(relative);
      if(localId){const profile=discoverLocalModels().profiles.find(p=>p.modelProfileId===localId[1]);if(profile)return jsonBytes(profile);fail("CREATOR_SAVED_ATTACHMENT_NOT_FOUND");}
      const neutral = /^game\/attachments-v2\/presets\/([^/]+)\.json$/.exec(
        relative
      );
      const builtin = neutral && builtinIdentity(`v2/${neutral[1]}`);
      if (builtin && builtin.id === `v2/${neutral[1]}`) {
        const bytes = this.readAuthoringResource(
          `game/attachments-v2/presets/${builtin.oldLeaf}.json`
        );
        const preset = JSON.parse(
          bytes.toString("utf8").replace(/^\uFEFF/, "")
        );
        preset.presetId = builtin.id;
        return jsonBytes(preset);
      }
      if (relative === 'game/attachments-v2/model-profiles/index.json')
        return withDirectoryInspectionScope(() => {
          const index = effectiveModelProfileIndex(), profileDocuments = {};
          for (const id of index.profiles) {
            relativePath(id,{leaf:true});
            try { profileDocuments[id] = JSON.parse(this.readAuthoringResource('game/attachments-v2/model-profiles/'+id+'.json').toString('utf8').replace(/^\uFEFF/,'')); } catch { /* Keep this ID for the client to report its individual error without losing other models. */ }
          }
          return jsonBytes({...index, profileDocuments});
        });
      try {
        return read(WORKSPACE, relative);
      } catch (error) {
        // The authoring project deliberately does not copy or redistribute the
        // Live2D SDK. Resolve only lib/* through Terre's exact shared-engine
        // preview route, whose host files are pinned by the installed launch
        // configuration. Do not extend this fallback to game/figure models.
        if (error.code === "TERRE_PATH_MISSING" && relative.startsWith("lib/"))
          return readChecked(
            access.resolvePreviewFile(handle(WORKSPACE), relative),
            64 * 1024 * 1024
          );
        // The bundled library is a read-only factory-default source. Once a sample is
        // materialized into the active workspace, that exact path overrides the default
        // and is ordinary user-editable content. Missing figure models still fail.
        const builtinLibraryPath = BUILTIN_LIBRARY_RESOURCE_MAP.get(relative);
        if (error.code === "TERRE_PATH_MISSING" && builtinLibraryPath)
          return readChecked(
            access.resolveLibraryRead(builtinLibraryPath),
            16 * 1024 * 1024
          );
        // Existing explicit library Profile bytes only. Missing models remain missing;
        // no materialization, synthesized index or model path guessing.
        const match =
          /^game\/attachments-v2\/(model-profiles\/[^/]+\.json)$/.exec(
            relative
          );
        if (
          error.code !== "TERRE_PATH_MISSING" ||
          !options.authorizedAuthoringRoot ||
          !match
        )
          throw error;
        return readChecked(access.resolveLibraryRead(match[1]), 1024 * 1024);
      }
    },
    readOptionalHostFont(relative) {
      try {
        return readChecked(
          access.resolveOptionalHostFont(relative),
          16 * 1024 * 1024
        );
      } catch (error) {
        // A missing optional font uses browser fallback, not a failed operation.
        // Unsafe paths, access failures and all other errors remain visible.
        if (error.code === "TERRE_PATH_MISSING") return null;
        throw error;
      }
    },
    readHostRuntimeResource(relative) {
      return readChecked(
        access.resolvePreviewFile(handle(WORKSPACE), relative),
        16 * 1024 * 1024
      );
    },
    describeAuthoringWorkspace() {
      const project = info(WORKSPACE);
      return { root: project.projectRoot, runtimeCompatibility: warning };
    },
    loadAttachment(body) {
      const result = load(body.projectName, body.presetId);
      emit({
        type: "attachment.load",
        result: "OK",
        projectName: body.projectName,
        presetId: body.presetId,
      });
      return result;
    },
    loadFactorySample(body) {
      return loadFactorySample(body?.sampleId);
    },
    importModel(body, options) {
      return modelImporter.importModel(body, options);
    },
    copyImportedModelToGame(body, options) {
      return modelImporter.copyToGame(body, options);
    },
    checkTargetModel(body) {
      const project = info(body?.projectName);
      if (project.authorizedAccess !== "attachment-write")
        fail("TERRE_PROJECT_WRITE_NOT_AUTHORIZED");
      try {
        const checked = validateTargetModelDependencies(
          access,
          handle(body.projectName),
          body?.modelPath
        );
        return {
          ok: true,
          ready: true,
          projectName: project.name,
          modelPath: checked.modelPath,
          dependencyCount: checked.dependencies.length,
          status: "TARGET_MODEL_READY",
        };
      } catch (error) {
        if (error?.code !== "CREATOR_TARGET_MODEL_MISSING") throw error;
        return {
          ok: true,
          ready: false,
          projectName: project.name,
          modelPath: relativePath(String(body.modelPath).replace(/^\.\//, "")),
          status: "TARGET_MODEL_NOT_READY",
          warning: {
            code: error.code,
            message:
              typeof error.userMessage === "string"
                ? error.userMessage
                : "目标游戏缺少这套人物模型的必要文件。",
            targetPath: error.targetPath,
            suggestion:
              typeof error.suggestion === "string"
                ? error.suggestion
                : "请先把这套人物模型完整放入目标游戏的 game/figure，再重新保存；制作器不会静默复制人物模型。",
          },
        };
      }
    },
    acceptAttachmentChanges(body, { signal } = {}) {
      const name = body?.projectName;
      if (projectPlan(name, "game/attachments-v2/.builtin-identity-migration.json").exists)
        fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", "名称迁移尚待恢复，请保留迁移备份与日志，完成检查后再保存或接受修改。");
      const current = load(name, body?.presetId);
      if (current.revision !== body?.expectedRevision)
        fail("CREATOR_STALE_DRAFT_RELOAD_REQUIRED");
      const contentChanged = current.integrity === "USER_EDITED_REVIEW_REQUIRED";
      if (!contentChanged && !current.ownershipRequiresReview)
        fail("CREATOR_NO_USER_CHANGES_TO_ACCEPT");
      const manifestPath = `${current.packageRoot}/manifest.json`;
      const manifest = JSON.parse(
        read(name, manifestPath)
          .toString("utf8")
          .replace(/^\uFEFF/, "")
      );
      if (contentChanged) repairAuthoringSelection(current.packageDocument, manifest);
      const contentPaths = current.readSet
        .map((row) => row.path)
        .filter((filePath) => filePath !== manifestPath);
      if (contentChanged) manifest.files = contentPaths
        .map((filePath) => {
          const bytes = read(name, filePath);
          return { path: filePath, bytes: bytes.length, sha256: sha(bytes) };
        })
        .sort((a, b) => a.path.localeCompare(b.path));
      const acceptedFiles = [
        ...contentPaths.map((filePath) => ({
          path: filePath,
          bytes: read(name, filePath),
        })),
        { path: manifestPath, bytes: contentChanged ? jsonBytes(manifest) : read(name, manifestPath) },
      ];
      const validateReadSet = () => {
        for (const row of current.readSet)
          if (sha(read(name, row.path)) !== row.sha256)
            fail("CREATOR_STALE_DRAFT_RELOAD_REQUIRED");
      };
      const applied = commitOwned({
        access,
        plan: (relative) => projectPlan(name, relative),
        ownerId: `terre-project:${info(name).name}`,
        ownershipPath: OWN,
        journalPath: JOURNAL,
        files: acceptedFiles,
        acceptedCurrentPaths: acceptedFiles.map((file) => file.path),
        releasePaths: current.integrityDifferences
          .filter((row) => row.status === "MANIFEST_ONLY" && row.path.startsWith(current.packageRoot + "/"))
          .map((row) => row.path),
        signal,
        validateReadSet,
        fault,
      });
      if (!applied.ok) return applied;
      const accepted = load(name, body.presetId);
      emit({
        type: "attachment.user-edit.accept",
        result: contentChanged ? "BASELINE_REBUILT" : "COPIED_PACKAGE_REGISTERED",
        projectName: name,
        presetId: body.presetId,
        changedPaths: current.integrityDifferences.map((row) => row.path),
      });
      return {
        ...accepted,
        accepted: true,
        contentOverwritten: false,
        acceptedPaths: [...new Set([...current.integrityDifferences.map((row) => row.path), ...current.ownershipDifferences])],
      };
    },
    saveToGame(body, { signal, saveOnly = false } = {}) {
      const name = body.projectName,
        project = info(name);
      if (project.authorizedAccess !== "attachment-write")
        fail("TERRE_PROJECT_WRITE_NOT_AUTHORIZED");
      if (projectPlan(name, "game/attachments-v2/.builtin-identity-migration.json").exists)
        fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", "名称迁移尚待恢复，请保留迁移备份与日志，完成检查后再保存或接受修改。");
      if (projectPlan(name, JOURNAL).exists)
        fail("CREATOR_RECOVERY_REQUIRED", projectPlan(name, JOURNAL).path);
      let v = validatePayload(project.projectRoot, body),
        existing;
      if (findPackage(name, v.presetId)) existing = load(name, v.presetId);
      if ((existing?.revision ?? null) !== (body.expectedRevision ?? null))
        fail("CREATOR_STALE_DRAFT_RELOAD_REQUIRED");
      if (
        existing &&
        existing.packageRoot !== path.posix.dirname(v.packagePath)
      )
        fail("CREATOR_PACKAGE_LOCATION_CHANGE_REQUIRES_MIGRATION");
      v = mergeAdaptations(project.projectRoot, v, existing?.packageDocument, existing?.createdAt);
      if (saveOnly && name !== WORKSPACE) fail("CREATOR_WRITE_SCOPE_INVALID");
      let previousPaths = [];
      const owned = projectPlan(name, OWN);
      if (owned.exists)
        previousPaths = JSON.parse(
          fs.readFileSync(owned.path, "utf8")
        ).files.map((f) => f.path);
      const scene = saveOnly
        ? undefined
        : previewScene(
            access,
            handle(name),
            v,
            creatorScenePath(
              v.presetId,
              v.packageDocument.displayName,
              previousPaths
            )
          );
      const alias = legacyBuiltinAlias(v.packageDocument);
      const revision = sha(
        jsonBytes(v.files.map((f) => [f.path, sha(f.bytes)]).sort())
      );
      const validateReadSet = () => {
        if (existing) {
          for (const row of existing.readSet)
            if (sha(read(name, row.path)) !== row.sha256)
              fail("CREATOR_STALE_DRAFT_RELOAD_REQUIRED");
        } else if (findPackage(name, v.presetId))
          fail("CREATOR_STALE_DRAFT_RELOAD_REQUIRED");
      };
      const applied = commitOwned({
        access,
        plan: (p) => projectPlan(name, p),
        ownerId: `terre-project:${project.name}`,
        ownershipPath: OWN,
        journalPath: JOURNAL,
        files: [
          ...v.files,
          ...(alias
            ? [{ path: alias.path, bytes: jsonBytes(alias.document) }]
            : []),
          ...(scene ? [scene] : []),
        ],
        signal,
        validateReadSet,
        fault,
      });
      if (!applied.ok) {
        emit({
          type: "attachment.save",
          result: "CONFLICT",
          projectName: name,
          conflicts: applied.conflicts,
        });
        return applied;
      }
      const result = {
        ...applied,
        projectName: name,
        projectRoot: project.projectRoot,
        attachmentRoot: path.join(
          project.projectRoot,
          path.posix.dirname(v.packagePath)
        ),
        exampleScene: scene?.path ?? "",
        savedLocally: saveOnly,
        builtinPresetIds: [],
        presetId: v.presetId,
        attachmentAssetId: v.attachmentAssetId,
        modelProfileId: v.modelProfileId,
        revision,
        runtimeCompatibility: warning,
        userVisualAcceptance: "PENDING",
      };
      for (const status of ["created", "updated", "unchanged"])
        result[status] = applied.files
          .filter((f) => f.status === status)
          .map((f) => f.path);
      emit({
        type: "attachment.save",
        result: "PERSISTED",
        projectName: name,
        presetId: v.presetId,
        revision,
      });
      return result;
    },
    readAnchorModel(body) {
      return { ok: true, ...anchorModelFacts(body.modelPath) };
    },
    ...createMeshLabelStore({access, modelFacts:anchorModelFacts, emit, fault}),
    saveAnchorProfile(body, { signal } = {}) {
      const profile = validateAuthoredProfile(body.profile), facts = anchorModelFacts(profile.modelPath);
      if (facts.modelJsonSha256 !== profile.fingerprint.modelJsonSha256.toUpperCase() ||
          facts.mocSha256 !== profile.fingerprint.mocSha256.toUpperCase()) fail('CREATOR_ANCHOR_MODEL_CHANGED');
      profile.modelPath = facts.modelPath;
      const relative = `model-profiles/${profile.modelProfileId}.json`,
        own = '.creator-anchor-owned-v1.json', journal = '.creator-anchor-transaction-v1.json';
      const plan = p => {
        if (p !== own && p !== journal && !/^model-profiles\/user-profile-[a-f0-9-]{36}\.json$/.test(p)) fail('CREATOR_LIBRARY_WRITE_SCOPE_INVALID');
        return access.planLibraryWrite(p);
      };
      const existing = plan(relative);
      const expected = body.expectedSha256 ?? null;
      const current = existing.exists ? sha(readChecked(existing)) : null;
      if (current !== expected) fail('CREATOR_ANCHOR_SAVE_CONFLICT');
      const bytes = jsonBytes(profile);
      if (bytes.length > 1024 * 1024) fail('CREATOR_ANCHOR_PROFILE_TOO_LARGE');
      const result = commitOwned({ access, plan, ownerId: 'creator-anchor-authoring', ownershipPath: own, journalPath: journal,
        files: [{ path: relative, bytes }], signal, fault,
        validateReadSet: () => {
          const now = anchorModelFacts(profile.modelPath);
          if (now.modelJsonSha256 !== facts.modelJsonSha256 || now.mocSha256 !== facts.mocSha256) fail('CREATOR_ANCHOR_MODEL_CHANGED');
        } });
      emit({ type: 'anchor.profile.save', result: result.ok ? 'PERSISTED' : 'CONFLICT', modelProfileId: profile.modelProfileId });
      return { ...result, profile, sha256: sha(bytes), fileName: profile.modelProfileId + '.json', semanticValidation: 'USER_REVIEW_REQUIRED' };
    },
    library() {
      const root = access.describe().libraryRoot,
        dir = guardedPath(root, "model-profiles", {
          missing: true,
          kind: "directory",
        }),
        profiles = [],
        rejected = [];
      if (dir.exists)
        for (const e of fs.readdirSync(dir.path, { withFileTypes: true })) {
          if (!e.name.endsWith(".json") || e.name === "index.json") continue;
          try {
            const bytes = readChecked(
                access.resolveLibraryRead("model-profiles/" + e.name),
                1024 * 1024
              ),
              p = JSON.parse(bytes);
            if (p.schema !== "webgal-live2d-model-profile")
              fail("CREATOR_LIBRARY_PROFILE_INVALID");
            profiles.push({
              fileName: e.name,
              modelProfileId: p.modelProfileId,
              modelPath: p.modelPath,
              sha256: sha(bytes),
            });
          } catch (error) {
            rejected.push({
              fileName: e.name,
              code: error.code ?? error.message,
            });
          }
        }
      return { ok: true, root, profiles, rejected, seeded: false };
    },
    readLibraryProfile(body) {
      relativePath(body.fileName, { leaf: true });
      if (!body.fileName.endsWith(".json"))
        fail("CREATOR_LIBRARY_PROFILE_INVALID");
      const bytes = readChecked(
          access.resolveLibraryRead("model-profiles/" + body.fileName),
          1024 * 1024
        ),
        profile = JSON.parse(bytes);
      if (profile.schema !== "webgal-live2d-model-profile")
        fail("CREATOR_LIBRARY_PROFILE_INVALID");
      return { ok: true, profile, sha256: sha(bytes) };
    },
    importLibraryProfile(body, { signal } = {}) {
      // Source is an authorized project's existing file, never a browser-provided absolute path.
      relativePath(body.fileName, { leaf: true });
      if (
        !body.fileName.endsWith(".json") ||
        body.fileName.toLowerCase() === "index.json"
      )
        fail("CREATOR_LIBRARY_PROFILE_INVALID");
      const bytes = read(
          body.projectName,
          "game/attachments-v2/model-profiles/" + body.fileName
        ),
        profile = JSON.parse(bytes);
      if (
        profile.schema !== "webgal-live2d-model-profile" ||
        typeof profile.modelProfileId !== "string"
      )
        fail("CREATOR_LIBRARY_PROFILE_INVALID");
      const model = relativePath(
        String(profile.modelPath ?? "").replace(/^\.\//, "")
      );
      if (
        !model.startsWith("game/figure/") ||
        !model.toLowerCase().endsWith(".json")
      )
        fail("CREATOR_MODEL_PATH_INVALID");
      const own = ".creator-profile-owned-v1.json",
        journal = ".creator-profile-transaction-v1.json";
      const plan = (p) => {
        if (
          p !== own &&
          p !== journal &&
          !/^model-profiles\/[^/]+\.json$/.test(p)
        )
          fail("CREATOR_LIBRARY_WRITE_SCOPE_INVALID");
        return access.planLibraryWrite(p);
      };
      const entries = this.library();
      const sameName = entries.profiles.find(
        (p) => p.fileName.toLowerCase() === body.fileName.toLowerCase()
      );
      if (sameName && sameName.modelProfileId !== profile.modelProfileId)
        fail("CREATOR_LIBRARY_PROFILE_ID_COLLISION");
      const existing = entries.profiles.find(
        (p) =>
          p.modelProfileId === profile.modelProfileId &&
          p.fileName !== body.fileName
      );
      if (existing) fail("CREATOR_LIBRARY_PROFILE_ID_COLLISION");
      const result = commitOwned({
        access,
        plan,
        ownerId: "creator-global-library",
        ownershipPath: own,
        journalPath: journal,
        files: [{ path: "model-profiles/" + body.fileName, bytes }],
        signal,
        fault,
      });
      emit({
        type: "library.import",
        result: result.ok ? "PERSISTED" : "CONFLICT",
        fileName: body.fileName,
      });
      return { ...result, sourcePreserved: true };
    },
    close() {
      access.close();
      handles.clear();
    },
  });
}
