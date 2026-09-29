import { parseAttachmentHandBinding } from './hand-binding.generated.mjs';
import { handPreviewLines } from './creator-hand-preview.mjs';
// Initially extracted by 16_creator-service-save/extract-contract.mjs; maintained canonical service contract.
// Only payload contracts + scene template; no old server, writer or release/project guards.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relativePath, guardedPath } from "./terre-path-guard.mjs";
const CREATOR_LEAF_ID = /^[a-z0-9][a-z0-9._-]*$/;
const CREATOR_PREVIEW_SCENE_PATH =
  "game/scene/ATTACHMENT-CREATOR-CURRENT-PREVIEW.txt";
const safeRelativePath = (value) => relativePath(value);
const assertNoReparsePoint = (root, p) =>
  guardedPath(root, p, { missing: true, kind: "file" });
const readJson = (root, p) => {
  const f = guardedPath(root, p, { kind: "file" });
  if (f.stat.size > 1048576n) throw Error("CREATOR_MODEL_JSON_TOO_LARGE");
  return JSON.parse(readFileSync(f.path, "utf8"));
};
const NAMED_SEMANTIC_ANCHORS = new Set([
  "head",
  "hair-top",
  "eyelid-upper-left",
  "eyelid-upper-right",
  "eye-center-left",
  "eye-center-right",
  "nose",
  "mouth",
  "ear-left",
  "ear-right",
  "chin",
]);
const COMPATIBILITY_ALIASES = new Map([
  ["left-ear", "ear-left"],
  ["right-ear", "ear-right"],
]);
const VERIFIED_DOTTED_ANCHORS = new Map([["body.head.top", "head"]]);
export function attachmentNamedAnchor(value) {
  const normalized = value.trim();
  return (
    VERIFIED_DOTTED_ANCHORS.get(normalized) ??
    COMPATIBILITY_ALIASES.get(normalized) ??
    (NAMED_SEMANTIC_ANCHORS.has(normalized) ? normalized : undefined)
  );
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}
function creatorLeafId(value, field) {
  const id = String(value ?? "");
  if (!CREATOR_LEAF_ID.test(id) || id.includes(".."))
    throw new Error(`RC1_${field}_INVALID:${id}`);
  return id;
}
function creatorPresetLeaf(value) {
  const presetId = String(value ?? "");
  const leaf = presetId.startsWith("v2/") ? presetId.slice(3) : presetId;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._（）()-]*$/u.test(leaf) || leaf.includes('..') || leaf.length > 96) throw new Error('RC1_PRESET_ID_INVALID');
  relativePath(leaf, { leaf:true });
  if (presetId !== leaf && presetId !== `v2/${leaf}`)
    throw new Error(`RC1_PRESET_ID_INVALID:${presetId}`);
  return { presetId, leaf };
}
function portableAdaptations(document) {
  if (
    document?.schema !== "webgal-live2d-attachment-package" ||
    ![1, 2].includes(document.schemaVersion)
  ) {
    throw new Error("RC1_PORTABLE_PACKAGE_INVALID");
  }
  const adaptations =
    document.schemaVersion === 2
      ? document.adaptations
      : [{ preset: document.preset, modelProfile: document.modelProfile }];
  if (!Array.isArray(adaptations) || adaptations.length === 0) {
    throw new Error("RC1_PORTABLE_ADAPTATIONS_MISSING");
  }
  for (const entry of adaptations) if (entry?.preset?.handBinding !== undefined) {
    const binding=parseAttachmentHandBinding(entry.preset.handBinding);
    const layers=document.asset?.attachedLayers??document.asset?.layers;
    if(!layers?.[binding.textureLayer]||(layers.front&&layers.back)) throw new Error("HAND_SINGLE_TEXTURE_REQUIRED");
  }
  return adaptations;
}
function canonicalAnchorName(name) {
  return ({ 'left-ear': 'ear-left', 'right-ear': 'ear-right',
    'left-eye': 'eyelid-upper-left', 'right-eye': 'eyelid-upper-right' })[name] ?? name;
}
function profileGeometryKey(profile) {
  return JSON.stringify([profile.modelPath, [...(profile.anchors ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(anchor =>
    [anchor.name, anchor.anchorProfileId, anchor.drawableId, anchor.vertexCount,
      [...(anchor.points ?? [])].sort((a, b) => a.index - b.index).map(point =>
        [point.index, point.weight, point.neutral?.x, point.neutral?.y])])]);
}
function portableBinding(
  document,
  presetId,
  attachmentAssetId,
  modelProfileId,
  anchorName
) {
  const asset = document?.asset;
  if (
    asset?.schema !== "webgal-live2d-attachment-asset" ||
    asset?.attachmentAssetId !== attachmentAssetId
  ) {
    throw new Error("RC1_PORTABLE_ASSET_BINDING_INVALID");
  }
  const adaptations = portableAdaptations(document);
  for (const [index, entry] of adaptations.entries()) {
    if (
      entry?.preset?.schema !== "webgal-live2d-attachment-preset" ||
      entry?.modelProfile?.schema !== "webgal-live2d-model-profile" ||
      entry.preset.presetId !== presetId ||
      entry.preset.attachmentAssetId !== attachmentAssetId ||
      entry.preset.modelProfileId !== entry.modelProfile.modelProfileId ||
      typeof entry.preset.anchorName !== "string" ||
      !entry.preset.anchorName
    ) {
      throw new Error(`RC1_PORTABLE_ADAPTATION_BINDING_INVALID:${index}`);
    }
  }
  const pairs = new Set(), profiles = new Map();
  for (const entry of adaptations) {
    const pair = JSON.stringify([entry.modelProfile.modelProfileId, canonicalAnchorName(entry.preset.anchorName)]);
    if (pairs.has(pair)) throw new Error(`RC1_PORTABLE_ADAPTATION_DUPLICATE:${pair}`);
    pairs.add(pair);
    const geometry = profileGeometryKey(entry.modelProfile);
    const previous = profiles.get(entry.modelProfile.modelProfileId);
    if (previous && previous !== geometry) throw new Error(`RC1_PORTABLE_PROFILE_GEOMETRY_CONFLICT:${entry.modelProfile.modelProfileId}`);
    profiles.set(entry.modelProfile.modelProfileId, geometry);
  }
  const profileRows = adaptations.filter(
    (entry) => entry.modelProfile.modelProfileId === modelProfileId
  );
  if (!profileRows.length)
    throw new Error(`RC1_PORTABLE_PROFILE_NOT_FOUND:${modelProfileId}`);
  const matching = anchorName === undefined ? profileRows : profileRows.filter(entry => canonicalAnchorName(entry.preset.anchorName) === canonicalAnchorName(anchorName));
  if (matching.length > 1 || (anchorName === undefined && profileRows.length > 1))
    throw new Error(`RC1_PORTABLE_ADAPTATION_AMBIGUOUS:${modelProfileId}; choose an anchor`);
  const selected = matching[0];
  if (!selected) throw new Error(`RC1_PORTABLE_ANCHOR_NOT_FOUND:${modelProfileId}/${anchorName}`);
  return { asset, preset: selected.preset, profile: selected.modelProfile };
}
function normalizePortableLayerPath(value, packageRoot) {
  if (typeof value !== "string")
    throw new Error("RC1_PORTABLE_LAYER_PATH_MISSING");
  const path = safeRelativePath(value.replace(/^\.\//, ""));
  const imageRoot = `${packageRoot}/images/`;
  const fileName = path.startsWith(imageRoot)
    ? path.slice(imageRoot.length)
    : "";
  if (
    !fileName ||
    fileName.includes("/") ||
    !fileName.toLowerCase().endsWith(".png")
  ) {
    throw new Error(`RC1_PORTABLE_LAYER_OUTSIDE_PACKAGE:${path}`);
  }
  return path;
}
function normalizeAssetLayerPath(value) {
  if (typeof value !== "string")
    throw new Error("RC1_ASSET_LAYER_PATH_MISSING");
  const path = safeRelativePath(value.replace(/^\.\//, ""));
  if (
    (!path.startsWith("game/attachments/") &&
      !path.startsWith("game/attachments-v2/files/")) ||
    !path.toLowerCase().endsWith(".png")
  ) {
    throw new Error(`RC1_ASSET_LAYER_PATH_NOT_ALLOWED:${path}`);
  }
  return path;
}
function validateApplyPayload(root, body) {
  const { presetId, leaf: presetLeaf } = creatorPresetLeaf(body?.presetId);
  const attachmentAssetId = creatorLeafId(body?.attachmentAssetId, "ASSET_ID");
  const modelProfileId = creatorLeafId(body?.modelProfileId, "PROFILE_ID");
  if (
    !Array.isArray(body.files) ||
    body.files.length < 4 ||
    body.files.length > 5
  ) {
    throw new Error("RC1_APPLY_FILE_SET_INVALID");
  }
  const seen = new Set();
  const files = body.files.map((entry) => {
    const path = safeRelativePath(entry?.path);
    if (seen.has(path)) throw new Error(`RC1_APPLY_FILE_NOT_ALLOWED:${path}`);
    seen.add(path);
    assertNoReparsePoint(root, path);
    const bytes = Buffer.from(String(entry.base64 ?? ""), "base64");
    const hash = sha256(bytes);
    if (
      bytes.byteLength !== entry.bytes ||
      hash !== String(entry.sha256).toUpperCase()
    ) {
      throw new Error(`RC1_APPLY_INTEGRITY_MISMATCH:${path}`);
    }
    return { path, bytes, sha256: hash };
  });
  const parsed = new Map(
    files
      .filter((file) => file.path.endsWith(".json"))
      .map((file) => [file.path, JSON.parse(file.bytes.toString("utf8"))])
  );
  const packageRoot = `game/attachments-v2/portable/${presetLeaf}`;
  const legacyPackageRoot = `game/attachments-v2/${presetLeaf}`;
  const canonicalPackagePath = `${packageRoot}/attachment.json`;
  const legacyPackagePath = `${legacyPackageRoot}/attachment.json`;
  const packagePath = seen.has(canonicalPackagePath)
    ? canonicalPackagePath
    : seen.has(legacyPackagePath)
    ? legacyPackagePath
    : canonicalPackagePath;
  const selectedPackageRoot =
    packagePath === canonicalPackagePath ? packageRoot : legacyPackageRoot;
  if (seen.has(canonicalPackagePath) || seen.has(legacyPackagePath)) {
    if (seen.has(canonicalPackagePath) && seen.has(legacyPackagePath)) {
      throw new Error("RC1_PORTABLE_DUPLICATE_LOCATION");
    }
    if (presetId !== `v2/${presetLeaf}`)
      throw new Error(`RC1_PORTABLE_PRESET_ID_INVALID:${presetId}`);
    const packageDocument = parsed.get(packagePath);
    const selectedManifest = parsed.get(`${selectedPackageRoot}/manifest.json`);
    const selectedAnchor = body?.anchorName ?? selectedManifest?.anchorName;
    const { preset, asset, profile } = portableBinding(
      packageDocument,
      presetId,
      attachmentAssetId,
      modelProfileId,
      selectedAnchor
    );
    const layerPaths = ["back", "front"].flatMap((layer) => {
      const value = asset.layers?.[layer] ?? asset.attachedLayers?.[layer];
      return value
        ? [normalizePortableLayerPath(value, selectedPackageRoot)]
        : [];
    });
    if (
      layerPaths.length < 1 ||
      layerPaths.length > 2 ||
      new Set(layerPaths).size !== layerPaths.length
    ) {
      throw new Error("RC1_APPLY_LAYER_SET_INVALID");
    }
    const readmePath = `${selectedPackageRoot}/使用说明.txt`;
    const manifestPath = `${selectedPackageRoot}/manifest.json`;
    const allowed = new Set([
      packagePath,
      ...layerPaths,
      readmePath,
      manifestPath,
    ]);
    if (
      seen.size !== allowed.size ||
      [...seen].some((path) => !allowed.has(path))
    ) {
      throw new Error("RC1_PORTABLE_FILE_SET_INCOMPLETE");
    }
    const manifest = parsed.get(manifestPath);
    if (
      manifest?.schema !== "webgal-attachment-creator-export-manifest" ||
      manifest?.schemaVersion !== 1 ||
      manifest?.presetId !== presetId ||
      manifest?.attachmentDefinitionId !== attachmentAssetId ||
      manifest?.modelProfileId !== modelProfileId ||
      (body?.anchorName !== undefined && manifest?.anchorName !== body.anchorName) ||
      !Array.isArray(manifest?.files)
    ) {
      throw new Error("RC1_PORTABLE_MANIFEST_INVALID");
    }
    const expectedManifestPaths = new Set(
      [...allowed].filter((path) => path !== manifestPath)
    );
    const manifestPaths = new Set();
    for (const entry of manifest.files) {
      const path = safeRelativePath(String(entry?.path ?? ""));
      if (manifestPaths.has(path))
        throw new Error(`RC1_PORTABLE_MANIFEST_DUPLICATE:${path}`);
      manifestPaths.add(path);
      const file = files.find((candidate) => candidate.path === path);
      if (
        !file ||
        Number(entry?.bytes) !== file.bytes.byteLength ||
        String(entry?.sha256 ?? "").toUpperCase() !== file.sha256
      ) {
        throw new Error(`RC1_PORTABLE_MANIFEST_INTEGRITY_MISMATCH:${path}`);
      }
    }
    if (
      manifestPaths.size !== expectedManifestPaths.size ||
      [...manifestPaths].some((path) => !expectedManifestPaths.has(path))
    ) {
      throw new Error("RC1_PORTABLE_MANIFEST_FILE_SET_INVALID");
    }
    return {
      files,
      presetId,
      attachmentAssetId,
      modelProfileId,
      anchorName: selectedAnchor,
      preset,
      asset,
      profile,
      packageDocument,
      packagePath,
      format: "portable",
    };
  }
  const presetPath = `game/attachments-v2/presets/${presetLeaf}.json`;
  const assetPath = `game/attachments-v2/assets/${attachmentAssetId}.json`;
  const profilePath = `game/attachments-v2/model-profiles/${modelProfileId}.json`;
  const preset = parsed.get(presetPath);
  const asset = parsed.get(assetPath);
  const profile = parsed.get(profilePath);
  if (
    preset?.schema !== "webgal-live2d-attachment-preset" ||
    preset?.presetId !== presetId ||
    preset?.attachmentAssetId !== attachmentAssetId ||
    preset?.modelProfileId !== modelProfileId ||
    typeof preset?.anchorName !== "string" ||
    !preset.anchorName ||
    asset?.schema !== "webgal-live2d-attachment-asset" ||
    asset?.attachmentAssetId !== attachmentAssetId ||
    profile?.schema !== "webgal-live2d-model-profile" ||
    profile?.modelProfileId !== modelProfileId
  ) {
    throw new Error("RC1_APPLY_SCHEMA_OR_BINDING_INVALID");
  }
  const layerPaths = ["back", "front"].flatMap((layer) => {
    const value = asset.layers?.[layer];
    return value ? [normalizeAssetLayerPath(value)] : [];
  });
  if (
    layerPaths.length < 1 ||
    layerPaths.length > 2 ||
    new Set(layerPaths).size !== layerPaths.length
  ) {
    throw new Error("RC1_APPLY_LAYER_SET_INVALID");
  }
  const allowed = new Set([presetPath, assetPath, profilePath, ...layerPaths]);
  if (
    seen.size !== allowed.size ||
    [...seen].some((path) => !allowed.has(path))
  ) {
    throw new Error("RC1_APPLY_FILE_SET_INCOMPLETE");
  }
  return {
    files,
    presetId,
    attachmentAssetId,
    modelProfileId,
    preset,
    asset,
    profile,
    format: "legacy",
  };
}
function creatorPreviewCommandBinding(binding) {
  const presetAnchor = creatorLeafId(
    binding.preset?.anchorName,
    "PREVIEW_ANCHOR"
  );
  const legacyHeadAnchor = /^head(?:-[bc])?$/.test(presetAnchor);
  // Authored names are scoped to the selected profile, not the built-in semantic list.
  // The payload validator has already checked this profile; never accept an absent anchor.
  const authoredAnchor = Array.isArray(binding.profile?.anchors) &&
    binding.profile.anchors.some(anchor => anchor.name === presetAnchor);
  const semanticAnchor = legacyHeadAnchor
    ? "head"
    : authoredAnchor ? presetAnchor : attachmentNamedAnchor(presetAnchor);
  if (
    !semanticAnchor ||
    (!legacyHeadAnchor && semanticAnchor !== presetAnchor)
  ) {
    throw new Error(`RC1_PREVIEW_ANCHOR_INVALID:${presetAnchor}`);
  }
  return {
    semanticAnchor,
    slot: creatorLeafId(binding.asset?.slot, "PREVIEW_SLOT"),
    modelProfileId: creatorLeafId(
      binding.profile?.modelProfileId,
      "PREVIEW_PROFILE"
    ),
  };
}
function buildCreatorPreviewScene(root, binding) {
  const rawModelPath = String(binding.profile?.modelPath ?? "").replace(
    /^\.\//,
    ""
  );
  const modelPath = safeRelativePath(rawModelPath);
  if (
    !modelPath.startsWith("game/figure/") ||
    !modelPath.toLowerCase().endsWith(".json")
  ) {
    throw new Error("CREATOR_PREVIEW_MODEL_PATH_INVALID");
  }
  const modelResource = modelPath.slice("game/figure/".length);
  const model = readJson(root, modelPath);
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
  const characterId = String(binding.profile?.characterId ?? "");
  const motion = motions.includes(`${characterId}/idle01`)
    ? `${characterId}/idle01`
    : motions.find((name) => name.endsWith("/idle01")) ?? motions[0];
  const { semanticAnchor, slot, modelProfileId } =
    creatorPreviewCommandBinding(binding);
  if (binding.preset?.handBinding) {
    const lines=handPreviewLines({modelResource,presetId:binding.presetId,profileId:modelProfileId,anchor:semanticAnchor,slot,motions});
    const bytes=Buffer.from(lines.join('\n')+'\n','utf8');
    return {path:CREATOR_PREVIEW_SCENE_PATH,bytes,sha256:sha256(bytes)};
  }
  const neutral =
    '{"position":{"x":0,"y":0},"scale":{"x":1,"y":1},"skew":{"x":0,"y":0},"rotation":0,"alpha":1,"blur":0,"brightness":1,"contrast":1,"saturation":1,"gamma":1,"colorRed":255,"colorGreen":255,"colorBlue":255}';
  const lightReset = {
    bevel: 0, bevelThickness: 0, bevelRotation: 0, bevelSoftness: 0,
    bevelRed: 255, bevelGreen: 255, bevelBlue: 255,
    bloom: 0, bloomBrightness: 1, bloomBlur: 0, bloomThreshold: 0,
  };
  const light = (target, values, duration = 1000) =>
    `setTransform:${JSON.stringify(values)} -duration=${duration} -ease=easeInOut -target=${target} -next;`;
  const figure = 'creator-current-preview';
  const entity = 'creator:current-attachment';
  const rim = { ...lightReset, bevel: 0.85, bevelThickness: 6, bevelRotation: 45, bevelSoftness: 0.35 };
  const prep = (label, action, focus) =>
    `测试说明:【${label} 准备】点击继续后${action}；请重点观察${focus}。;`;
  const check = (label, expectation) =>
    `测试说明:【${label} 检查点】上一项命令组已触发；如有动画，请等画面稳定后检查：${expectation}。刚才这一步是否正常？如有异常，请停在此处并记录编号与现象。;`;
  const lines = [
    prep('00 人物准备', '载入人物', '人物是否完整出现、动作是否稳定'),
    "changeBg:bg.webp -next;",
    `changeFigure:${modelResource} -id=creator-current-preview -duration=0 -next${
      motion ? ` -motion=${motion}` : ""
    } -zIndex=1;`,
    check('00 人物准备', '人物已完整显示且动作稳定'),
    prep('01 初次附着', '添加附件并按默认时长淡入', '附件是否实际出现、接点和遮挡是否正确；配置：'+binding.presetId),
    `attachment:add -figure=creator-current-preview -id=creator-current-attachment -entity=creator:current-attachment -config=${binding.presetId} -profile=${modelProfileId} -slot=${slot} -anchor=${semanticAnchor} -next;`,
    check('01 初次附着', '附件实际出现并稳定、只有一份，位置与制作器预期一致；本说明不会等待异步淡入完成'),
    prep('02 人物复合变换', '让人物移动、缩放、旋转、变淡并偏冷色', '附件是否保持相对位置并继承相同变化'),
    'setTransform:{"position":{"x":-180,"y":-70},"scale":{"x":1.2,"y":0.88},"skew":{"x":0.08,"y":-0.05},"rotation":0.3,"alpha":0.48,"blur":2,"brightness":1.15,"contrast":1.2,"saturation":0.7,"gamma":1,"colorRed":175,"colorGreen":215,"colorBlue":255} -duration=1100 -ease=easeInOut -target=creator-current-preview -next;',
    check('02 人物复合变换', '人物与附件作为整体变化，无漂移、滞后或滤镜割裂'),
    prep('03 父级复位', '让人物与附件恢复初始状态', '附件能否回到保存时的预期位置'),
    `setTransform:${neutral} -duration=900 -ease=easeInOut -target=creator-current-preview -next;`,
    check('03 父级复位', '附件回到保存时的预期位置'),
    prep('04 附件自身变换', '只移动、缩放、旋转、变淡并染色附件', '人物是否保持不变'),
    'setTransform:{"position":{"x":80,"y":55},"scale":{"x":1.45,"y":0.75},"skew":{"x":0.08,"y":0},"rotation":0.65,"alpha":0.55,"blur":1,"brightness":1.2,"contrast":1.1,"saturation":1.4,"gamma":1,"colorRed":255,"colorGreen":175,"colorBlue":205} -duration=1000 -ease=easeInOut -target=creator:current-attachment -next;',
    check('04 附件自身变换', '只有附件改变，人物保持不变'),
    prep('04 附件复位', '恢复附件自身状态', '附件是否回到原始位置和外观'),
    `setTransform:${neutral} -duration=900 -ease=easeInOut -target=creator:current-attachment -next;`,
    check('04 附件复位', '附件恢复原始位置和外观'),
    prep('05A 隐藏', '隐藏附件', '人物是否保持显示'),
    "stageEntity:hide -entity=creator:current-attachment;",
    check('05A 隐藏', '附件已消失，人物仍在'),
    prep('05B 显示', '重新显示附件', '附件是否在原位置只出现一份'),
    "stageEntity:show -entity=creator:current-attachment;",
    check('05B 显示', '附件在原位置恢复且没有重复'),
    prep('06 分离', '解除附着并随后移动人物', '附件是否留在解除时的世界位置'),
    "stageEntity:detach -entity=creator:current-attachment -continue;",
    'setTransform:{"position":{"x":340,"y":-100},"scale":{"x":0.75,"y":1.12},"skew":{"x":0,"y":0},"rotation":0.48,"alpha":0.5,"blur":0,"brightness":1,"contrast":1,"saturation":1,"gamma":1,"colorRed":255,"colorGreen":255,"colorBlue":255} -duration=1100 -ease=easeInOut -target=creator-current-preview -next;',
    check('06 分离', '人物已移动，分离后的附件留在原地'),
    prep('07 自由附件变换', '只改变已分离附件的位置和外观', '人物是否不受影响'),
    'setTransform:{"position":{"x":-380,"y":-190},"scale":{"x":1.7,"y":1.1},"skew":{"x":-0.1,"y":0.06},"rotation":-0.8,"alpha":0.72,"blur":2,"brightness":1.2,"contrast":1.2,"saturation":1.4,"gamma":1,"colorRed":175,"colorGreen":255,"colorBlue":195} -duration=1100 -ease=easeInOut -target=creator:current-attachment -next;',
    check('07 自由附件变换', '只有自由附件的位置和外观发生变化'),
    prep('08 重新绑定', '将附件重新附着到原人物并复位人物', '附件是否回到预期位置且只有一份'),
    `stageEntity:reattach -entity=creator:current-attachment -figure=creator-current-preview -profile=${modelProfileId} -anchor=${semanticAnchor} -duration=1100 -ease=easeInOut -continue;`,
    `setTransform:${neutral} -duration=1000 -ease=easeInOut -target=creator-current-preview -next;`,
    check('08 重新绑定', '附件已重新附着、只有一份，并重新继承人物变化'),
    prep('09 移除', '永久移除附件', '人物是否保持显示'),
    "stageEntity:remove -entity=creator:current-attachment -duration=700 -ease=easeInOut -continue;",
    check('09 移除', '附件完全消失，人物仍在'),
    prep('10 重新附着', '使用同一配置重新添加附件', '附件是否干净重建并只出现一份'),
    `attachment:add -figure=creator-current-preview -id=creator-current-attachment -entity=creator:current-attachment -config=${binding.presetId} -profile=${modelProfileId} -slot=${slot} -anchor=${semanticAnchor} -next;`,
    check('10 重新附着', '附件实际重新出现并稳定、只有一份且回到预期位置；本说明不会等待异步淡入完成'),
    prep('11 人物重建', '重建人物', '附件是否保持单份且稳定跟随'),
    `changeFigure:${modelResource} -id=creator-current-preview -duration=0 -next${
      motion ? ` -motion=${motion}` : ""
    } -zIndex=1;`,
    check('11 人物重建', '新人物已稳定，附件仍只有一份并正确跟随'),
    prep('12 人物白色边缘光', '给人物添加白色定向亮边', '附件与人物边缘是否协调、有无闪跳或重复加亮；参数仅为测试起点'),
    light(figure, rim),
    check('12 人物白色边缘光', '效果稳定，人物与附件亮边协调且没有闪跳'),
    prep('13 方向、颜色与泛光', '改变光照方向、颜色并加入泛光', '亮边过渡及末尾方向是否稳定，人物与附件是否协调'),
    light(figure, { ...rim, bevelRotation: -135, bevelRed: 180, bevelGreen: 220, bloom: 0.55, bloomBrightness: 1.1, bloomBlur: 4, bloomThreshold: 0.55 }, 1200),
    check('13 方向、颜色与泛光', '人物与附件光效协调，末尾没有突然改变方向'),
    prep('14 人物光效关闭', '关闭人物光效', '人物与附件是否恢复此前外观、没有残留光晕'),
    light(figure, lightReset),
    check('14 人物光效关闭', '人物与附件恢复此前外观，没有残留光晕或染色'),
    prep('15 附件自身光效', '只给附件添加暖色边缘光和泛光', '人物是否保持原样，前后层是否稳定'),
    light(entity, { ...rim, bevelRotation: -45, bevelGreen: 200, bevelBlue: 140, bloom: 0.4, bloomBrightness: 1.1, bloomBlur: 3, bloomThreshold: 0.5 }),
    check('15 附件自身光效', '只有附件有暖色亮边和光晕，人物保持原样，前后层无闪烁'),
    prep('16 分离后光效', '分离附件并改变人物的边缘光', '已分离附件是否保留自己的暖色效果和世界位置'),
    'stageEntity:detach -entity=creator:current-attachment -continue;',
    light(figure, { ...rim, bevelRed: 170, bevelGreen: 210, bevelRotation: 135 }),
    check('16 分离后光效', '人物为冷色亮边，已分离附件仍保留暖色效果和世界位置'),
    prep('17 关闭与重连', '关闭两者光效并重新附着附件', '单份实例、原位置及光效是否恢复'),
    light(figure, lightReset),
    light(entity, lightReset),
    `stageEntity:reattach -entity=${entity} -figure=${figure} -profile=${modelProfileId} -anchor=${semanticAnchor} -duration=1000 -ease=easeInOut -continue;`,
    check('17 关闭与重连', '附件重新附着并稳定、位置正确且只有一份，人物和附件均无残留光效；可另用编辑器对第一句“执行到此句”重演检查复位'),
  ];
  const bytes = Buffer.from(`${lines.join("\n")}\n`, "utf8");
  return { path: CREATOR_PREVIEW_SCENE_PATH, bytes, sha256: sha256(bytes) };
}
export {
  creatorPresetLeaf,
  portableAdaptations,
  portableBinding,
  canonicalAnchorName,
  profileGeometryKey,
  normalizePortableLayerPath,
  validateApplyPayload,
  buildCreatorPreviewScene,
};
