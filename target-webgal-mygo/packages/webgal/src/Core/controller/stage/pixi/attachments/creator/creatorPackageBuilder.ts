import { cloneAttachmentHandBinding } from '../handBinding';
import {
  createAttachmentProfileRegistry,
  parseAttachmentAssetDefinition,
  parseAttachmentPlacementPreset,
  parseLive2DModelProfile,
  modelProfileGeometryKey,
  resolveAttachmentPlacementPreset,
} from '../profileLoader';
import {
  migrateLegacyProfileAnchorName,
  type AttachmentAssetDefinition,
  type AttachmentPlacementPreset,
  type Live2DModelProfile,
} from '../profileTypes';
import { creatorPresetLeaf, layerNamesForMode, validateCreatorDraft } from './creatorDraft';
import { parseCreatorDefaultParameters, type CreatorDefaultParameters } from './creatorDefaultParameters';
import { inspectPngBytes, sha256Bytes } from './pngImport';
import { cloneAttachmentEntityVisualState, parseAttachmentEntityVisualState } from '../stageEntityVisualState';
import {
  ATTACHMENT_CREATOR_TOOL_VERSION,
  type CreatorBinaryInput,
  type CreatorDraft,
  type CreatorExportFile,
  type CreatorExportManifest,
  type CreatorPackage,
} from './creatorTypes';

const encoder = new TextEncoder();

export interface CreatorPackageAdaptation {
  preset: AttachmentPlacementPreset;
  modelProfile: Live2DModelProfile;
}

function textBytes(value: string) {
  return encoder.encode(value);
}

function jsonBytes(value: unknown) {
  return textBytes(`${JSON.stringify(value, null, 2)}\n`);
}

function commandSnippet(draft: CreatorDraft, anchorName = migrateLegacyProfileAnchorName(draft.anchorName)) {
  return `attachment:add -figure=${draft.figureKey} -id=${draft.attachmentInstanceId} -config=${draft.presetId} -profile=${draft.modelProfileId} -anchor=${anchorName} -slot=${draft.slot} -duration=500 -ease=easeInOut;`;
}

export function creatorLifecycleScript(draft: CreatorDraft) {
  const add = commandSnippet(draft);
  return [
    add,
    `attachment:hide -figure=${draft.figureKey} -id=${draft.attachmentInstanceId} -duration=500 -ease=easeInOut -next;`,
    `attachment:show -figure=${draft.figureKey} -id=${draft.attachmentInstanceId} -duration=500 -ease=easeInOut -next;`,
    `attachment:remove -figure=${draft.figureKey} -id=${draft.attachmentInstanceId} -next;`,
  ].join('\n');
}

function gameAssetPath(draft: CreatorDraft, layer: 'back' | 'front') {
  const metadata = draft.layers[layer];
  if (!metadata) return undefined;
  return `./game/attachments-v2/portable/${creatorPresetLeaf(draft.presetId)}/images/${metadata.outputFileName}`;
}

function exportAssetPath(draft: CreatorDraft, layer: 'back' | 'front') {
  const metadata = draft.layers[layer];
  if (!metadata) return undefined;
  return `game/attachments-v2/portable/${creatorPresetLeaf(draft.presetId)}/images/${metadata.outputFileName}`;
}

async function exportFile(path: string, mime: string, bytes: Uint8Array): Promise<CreatorExportFile> {
  return { path, mime, bytes, sha256: await sha256Bytes(bytes) };
}

function assertPortable(value: unknown) {
  const serialized = JSON.stringify(value);
  if (/blob:/i.test(serialized) || /(?:[A-Za-z]:\\|\\\\|file:\/\/)/.test(serialized)) {
    throw new Error('CREATOR_EXPORT_CONTAINS_LOCAL_OR_BLOB_PATH');
  }
}

export async function buildCreatorPackage(options: {
  draft: CreatorDraft;
  profile: Live2DModelProfile;
  back?: CreatorBinaryInput;
  front?: CreatorBinaryInput;
  overwrite?: boolean;
  createdAt?: string;
  existingAdaptations?: readonly CreatorPackageAdaptation[];
  defaultParameters?: CreatorDefaultParameters;
}): Promise<CreatorPackage> {
  const { draft, profile } = options;
  const outputAnchorName = migrateLegacyProfileAnchorName(draft.anchorName);
  const visualState = draft.visualState ?? parseAttachmentEntityVisualState({}, 'visualState');
  const validation = validateCreatorDraft(draft, profile);
  if (!validation.valid) {
    throw new Error(`CREATOR_VALIDATION_FAILED: ${validation.errors.map((item) => item.code).join(', ')}`);
  }
  const inputs = { back: options.back, front: options.front };
  for (const layer of layerNamesForMode(draft.layerMode)) {
    const input = inputs[layer];
    const metadata = draft.layers[layer];
    if (!input || !metadata) throw new Error(`CREATOR_LAYER_BYTES_MISSING:${layer}`);
    inspectPngBytes(input.bytes);
    const actualHash = await sha256Bytes(input.bytes);
    if (actualHash !== metadata.sha256 || input.bytes.byteLength !== metadata.bytes) {
      throw new Error(`CREATOR_LAYER_INTEGRITY_MISMATCH:${layer}`);
    }
  }

  const assetRaw: AttachmentAssetDefinition = {
    schema: 'webgal-live2d-attachment-asset',
    schemaVersion: 1,
    attachmentAssetId: draft.attachmentDefinitionId,
    slot: draft.slot,
    layers: {
      back: draft.layerMode !== 'front-only' ? gameAssetPath(draft, 'back') : undefined,
      front: draft.layerMode !== 'back-only' ? gameAssetPath(draft, 'front') : undefined,
    },
  };
  const presetRaw = {
    schema: 'webgal-live2d-attachment-preset' as const,
    schemaVersion: 2 as const,
    presetId: draft.presetId,
    approvalStatus: draft.approvalStatus ?? 'candidate',
    attachmentAssetId: draft.attachmentDefinitionId,
    modelProfileId: draft.modelProfileId,
    anchorName: outputAnchorName,
    fit: { scaleMode: draft.placement.scaleMode },
    placement: {
      spriteAnchor: { ...draft.placement.spriteAnchor },
      offset: { ...draft.placement.offset },
      rotationOffsetRad: draft.placement.rotationOffsetRad,
      localScale: draft.placement.localScale,
      localScaleX: draft.placement.localScaleX,
      localScaleY: draft.placement.localScaleY,
    },
    ...(draft.handBinding ? { handBinding: cloneAttachmentHandBinding(draft.handBinding) } : {}),
    initialVisualState: cloneAttachmentEntityVisualState(visualState),
  };
  const asset = parseAttachmentAssetDefinition(assetRaw, 'creator://asset');
  const preset = parseAttachmentPlacementPreset(presetRaw, 'creator://preset');
  const registry = createAttachmentProfileRegistry({
    modelProfiles: [profile],
    attachmentAssets: [asset],
    presets: [preset],
  });
  const resolvedConfig = resolveAttachmentPlacementPreset(registry, preset.presetId, 'creator://round-trip');
  const command = commandSnippet(draft, outputAnchorName);
  const files: CreatorExportFile[] = [];
  const packageRoot = `game/attachments-v2/portable/${creatorPresetLeaf(draft.presetId)}`;
  const currentAdaptation: CreatorPackageAdaptation = { preset, modelProfile: profile };
  const existingAdaptations = options.existingAdaptations ?? [];
  const existingPairs = new Set<string>();
  const profilesById = new Map<string, string>();
  for (const adaptation of existingAdaptations) {
    if (
      adaptation.preset.presetId !== preset.presetId ||
      adaptation.preset.attachmentAssetId !== asset.attachmentAssetId ||
      adaptation.preset.modelProfileId !== adaptation.modelProfile.modelProfileId
    ) {
      throw new Error('CREATOR_EXISTING_ADAPTATION_BINDING_MISMATCH');
    }
    const pair = JSON.stringify([adaptation.modelProfile.modelProfileId, migrateLegacyProfileAnchorName(adaptation.preset.anchorName)]);
    if (existingPairs.has(pair)) {
      throw new Error('CREATOR_EXISTING_ADAPTATION_ID_DUPLICATE');
    }
    existingPairs.add(pair);
    // Validate every retained adaptation, not only the actively edited one. Keep
    // original profile data; parsing here must not silently retarget old artwork.
    const retainedProfile = parseLive2DModelProfile(adaptation.modelProfile, 'creator://retained-profile');
    const geometry = modelProfileGeometryKey(retainedProfile);
    const previousGeometry = profilesById.get(retainedProfile.modelProfileId);
    if (previousGeometry && previousGeometry !== geometry)
      throw new Error('CREATOR_EXISTING_PROFILE_GEOMETRY_CONFLICT');
    profilesById.set(retainedProfile.modelProfileId, geometry);
    if (retainedProfile.modelProfileId === profile.modelProfileId && modelProfileGeometryKey(parseLive2DModelProfile(profile, 'creator://active-profile')) !== geometry)
      throw new Error('CREATOR_EXISTING_PROFILE_GEOMETRY_CONFLICT');
    const retainedPreset = parseAttachmentPlacementPreset(adaptation.preset, 'creator://retained-preset');
    resolveAttachmentPlacementPreset(
      createAttachmentProfileRegistry({
        modelProfiles: [retainedProfile],
        attachmentAssets: [asset],
        presets: [retainedPreset],
      }),
      retainedPreset.presetId,
      'creator://retained-round-trip',
    );
  }
  const adaptations = [
    // A Profile may calibrate several anchors; only this exact target is replaced.
    ...existingAdaptations.filter((adaptation) => adaptation.modelProfile.modelProfileId !== profile.modelProfileId ||
      migrateLegacyProfileAnchorName(adaptation.preset.anchorName) !== outputAnchorName),
    currentAdaptation,
  ]
    .map((adaptation) => ({
      ...adaptation,
      preset: {
        ...adaptation.preset,
        schemaVersion: 2 as const,
        anchorName: migrateLegacyProfileAnchorName(adaptation.preset.anchorName),
      },
    }))
    .sort((left, right) => {
      const a = left.modelProfile.modelProfileId,
        b = right.modelProfile.modelProfileId;
      return a < b ? -1 : a > b ? 1 : left.preset.anchorName.localeCompare(right.preset.anchorName);
    });
  const packageDocument = {
    schema: 'webgal-live2d-attachment-package' as const,
    schemaVersion: 2 as const,
    displayName: draft.displayName,
    asset,
    adaptations,
    defaultParameters: parseCreatorDefaultParameters(options.defaultParameters, preset),
  };
  files.push(await exportFile(`${packageRoot}/attachment.json`, 'application/json', jsonBytes(packageDocument)));
  for (const layer of layerNamesForMode(draft.layerMode)) {
    const input = inputs[layer]!;
    files.push(await exportFile(exportAssetPath(draft, layer)!, 'image/png', input.bytes));
  }
  const readme =
    `${draft.displayName}\n\n` +
    `这是一个完整的 WebGAL 附件模型文件夹。图片只保存一份；不同人物/立绘的锚点与位置会合并到 attachment.json 的 adaptations 中。\n` +
    `迁移时请复制整个“${creatorPresetLeaf(draft.presetId)}”文件夹到另一个游戏的 game\\attachments-v2\\portable。\n\n` +
    `在 Terre 的“附件配置”中选择本文件夹里的 attachment.json。\n` +
    `配置名称：${draft.presetId}\n`;
  files.push(await exportFile(`${packageRoot}/使用说明.txt`, 'text/plain', textBytes(readme)));

  const manifest: CreatorExportManifest = {
    schema: 'webgal-attachment-creator-export-manifest',
    schemaVersion: 1,
    toolVersion: ATTACHMENT_CREATOR_TOOL_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    attachmentDefinitionId: draft.attachmentDefinitionId,
    presetId: draft.presetId,
    modelProfileId: draft.modelProfileId,
    anchorName: outputAnchorName,
    layerMode: draft.layerMode,
    displayName: draft.displayName,
    sourcePngFileNames: layerNamesForMode(draft.layerMode).map((layer) => draft.layers[layer]!.sourceFileName),
    overwrite: options.overwrite === true,
    validation,
    commandSnippet: command,
    files: files.map((file) => ({ path: file.path, bytes: file.bytes.byteLength, sha256: file.sha256 })),
  };
  assertPortable({ packageDocument, manifest });
  files.push(await exportFile(`${packageRoot}/manifest.json`, 'application/json', jsonBytes(manifest)));
  return { draft, profile, preset, commandSnippet: command, files, manifest, resolvedConfig };
}
