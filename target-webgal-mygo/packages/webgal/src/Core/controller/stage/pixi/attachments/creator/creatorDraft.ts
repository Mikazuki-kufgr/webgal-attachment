import { cloneAttachmentHandBinding, parseAttachmentHandBinding, handAppearanceSupported } from '../handBinding';
import { normalizeGameAssetPath } from '../configLoader';
import { compatibleAnchorNames, type AttachmentPlacementPreset, type Live2DModelProfile } from '../profileTypes';
import { cloneAttachmentEntityVisualState, parseAttachmentEntityVisualState } from '../stageEntityVisualState';
import {
  ATTACHMENT_CREATOR_SCHEMA,
  ATTACHMENT_CREATOR_SCHEMA_VERSION,
  type CreatorDraft,
  type CreatorLayerMode,
  type CreatorValidationIssue,
  type CreatorValidationResult,
} from './creatorTypes';

export const CREATOR_PRESET_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._（）()-]*$/u;
export function readableCreatorPresetId(name: string, token: string) {
 const readable = Array.from(name.trim().replace(/[^\p{L}\p{N}._（）()-]/gu, '_').replace(/\.\./g, '_').replace(/^[._-]+|[.]+$/g, '')).slice(0, 48).join('') || '附件';
 return 'v2/' + readable + '-' + token.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase();
}
export const CREATOR_LEAF_ID = /^[a-z0-9][a-z0-9._-]*$/;

export function creatorPresetLeaf(presetId: string) {
  return presetId.startsWith('v2/') ? presetId.slice(3) : presetId;
}

export function validateCreatorLeafId(value: string) {
  return (
    CREATOR_LEAF_ID.test(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('..') &&
    !/[\\/:\u0000-\u001f\u007f]/.test(value) &&
    !/^[a-z]:/i.test(value)
  );
}

export function createBlankCreatorDraft(now = Date.now()): CreatorDraft {
  const token = now.toString(36).slice(-7);
  return {
    schema: ATTACHMENT_CREATOR_SCHEMA,
    schemaVersion: ATTACHMENT_CREATOR_SCHEMA_VERSION,
    draftId: `draft-${now}`,
    figureKey: '',
    figureGeneration: '',
    modelProfileId: '',
    anchorName: '',
    attachmentDefinitionId: `custom-attachment-${token}-assets-v1`,
    presetId: `v2/custom-attachment-${token}-placement-v1`,
    displayName: '新附件',
    attachmentInstanceId: `custom-attachment-${token}`,
    slot: `custom-${token}`,
    layerMode: 'front-only',
    layers: {},
    placement: {
      spriteAnchor: { x: 0.5, y: 0.5 },
      offset: { x: 0, y: 0 },
      rotationOffsetRad: 0,
      localScale: 1,
      localScaleX: 1,
      localScaleY: 1,
      scaleMode: 'fixed',
    },
    visualState: parseAttachmentEntityVisualState({}, 'visualState'),
    approvalStatus: 'candidate',
  };
}

export function cloneCreatorDraft(draft: CreatorDraft): CreatorDraft {
  return {
    ...draft,
    ...(draft.handBinding ? { handBinding: cloneAttachmentHandBinding(draft.handBinding) } : {}),
    layers: {
      back: draft.layers.back ? { ...draft.layers.back } : undefined,
      front: draft.layers.front ? { ...draft.layers.front } : undefined,
    },
    placement: {
      ...draft.placement,
      spriteAnchor: { ...draft.placement.spriteAnchor },
      offset: { ...draft.placement.offset },
      localScaleX: draft.placement.localScaleX ?? draft.placement.localScale,
      localScaleY: draft.placement.localScaleY ?? draft.placement.localScale,
    },
    visualState: draft.visualState
      ? (cloneAttachmentEntityVisualState(draft.visualState) as CreatorDraft['visualState'])
      : parseAttachmentEntityVisualState({}, 'visualState'),
  };
}

export function draftFromPreset(
  preset: AttachmentPlacementPreset,
  options: { figureKey: string; figureGeneration: string; displayName?: string },
): CreatorDraft {
  const suffix = creatorPresetLeaf(preset.presetId);
  const token = Date.now().toString(36);
  return {
    ...createBlankCreatorDraft(),
    draftId: `copy-${Date.now()}`,
    figureKey: options.figureKey,
    figureGeneration: options.figureGeneration,
    modelProfileId: preset.modelProfileId,
    anchorName: preset.anchorName,
    attachmentDefinitionId: `${preset.attachmentAssetId}-copy-${token}`,
    presetId: `v2/${suffix}-copy-${token}`,
    displayName: options.displayName ?? `${suffix} 副本`,
    slot: `custom-${suffix}`,
    placement: {
      spriteAnchor: { ...preset.placement.spriteAnchor },
      offset: { ...preset.placement.offset },
      rotationOffsetRad: preset.placement.rotationOffsetRad,
      localScale: preset.placement.localScale,
      localScaleX: preset.placement.localScaleX ?? preset.placement.localScale,
      localScaleY: preset.placement.localScaleY ?? preset.placement.localScale,
      scaleMode: preset.fit.scaleMode,
    },
    visualState: preset.initialVisualState
      ? (cloneAttachmentEntityVisualState(preset.initialVisualState) as CreatorDraft['visualState'])
      : parseAttachmentEntityVisualState({}, 'visualState'),
    ...(preset.handBinding ? { handBinding: cloneAttachmentHandBinding(preset.handBinding) } : {}),
    sourcePresetId: preset.presetId,
    approvalStatus: 'candidate',
  };
}

export function draftFromProjectPreset(
  preset: AttachmentPlacementPreset,
  options: {
    figureKey: string;
    figureGeneration: string;
    attachmentInstanceId?: string;
    displayName?: string;
  },
): CreatorDraft {
  return {
    ...createBlankCreatorDraft(),
    draftId: `project-${Date.now()}`,
    figureKey: options.figureKey,
    figureGeneration: options.figureGeneration,
    modelProfileId: preset.modelProfileId,
    anchorName: preset.anchorName,
    attachmentDefinitionId: preset.attachmentAssetId,
    presetId: preset.presetId,
    displayName: options.displayName ?? '祥子草帽（正式配置）',
    attachmentInstanceId: options.attachmentInstanceId ?? 'rc1-sakiko-hat',
    slot: `custom-${preset.presetId.replace(/^v2\//, '')}`,
    layerMode: 'both',
    placement: {
      spriteAnchor: { ...preset.placement.spriteAnchor },
      offset: { ...preset.placement.offset },
      rotationOffsetRad: preset.placement.rotationOffsetRad,
      localScale: preset.placement.localScale,
      localScaleX: preset.placement.localScaleX ?? preset.placement.localScale,
      localScaleY: preset.placement.localScaleY ?? preset.placement.localScale,
      scaleMode: preset.fit.scaleMode,
    },
    visualState: preset.initialVisualState
      ? (cloneAttachmentEntityVisualState(preset.initialVisualState) as CreatorDraft['visualState'])
      : parseAttachmentEntityVisualState({}, 'visualState'),
    approvalStatus: preset.approvalStatus,
    ...(preset.handBinding ? { handBinding: cloneAttachmentHandBinding(preset.handBinding) } : {}),
    sourcePresetId: preset.presetId,
  };
}

export function layerNamesForMode(mode: CreatorLayerMode): Array<'back' | 'front'> {
  if (mode === 'back-only') return ['back'];
  if (mode === 'front-only') return ['front'];
  return ['back', 'front'];
}

export function profileMatchesModelPath(profile: Live2DModelProfile, modelPath: string) {
  return normalizeGameAssetPath(profile.modelPath) === normalizeGameAssetPath(modelPath);
}

export function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function issue(
  list: CreatorValidationIssue[],
  code: string,
  field: string,
  message: string,
  level: 'error' | 'warning' = 'error',
) {
  list.push({ level, code, field, message });
}

export function validateCreatorDraft(draft: CreatorDraft, profile?: Live2DModelProfile): CreatorValidationResult {
  const errors: CreatorValidationIssue[] = [];
  const warnings: CreatorValidationIssue[] = [];
  const ids: Array<[string, string]> = [
    ['attachmentDefinitionId', draft.attachmentDefinitionId],
    ['presetId', creatorPresetLeaf(draft.presetId)],
    ['attachmentInstanceId', draft.attachmentInstanceId],
    ['slot', draft.slot],
  ];
  for (const [field, value] of ids) {
    if (!(field === 'presetId' ? CREATOR_PRESET_NAME.test(value) && !value.includes('..') && value.length <= 96 : validateCreatorLeafId(value))) {
      issue(errors, 'INVALID_ID', field, field === 'presetId'
        ? '配置 ID 须以字母或数字开头，可用中文；不得包含路径或 ..，且最长 96 字符。普通用户无需修改，另存为会自动生成。'
        : `${field} 必须是安全 ASCII slug，且不得包含路径或 ..`);
    }
  }
  if (!draft.presetId.startsWith('v2/')) {
    issue(errors, 'INVALID_PRESET_NAMESPACE', 'presetId', 'presetId 必须使用 v2/ 命名空间');
  }
  if (!draft.figureKey) issue(errors, 'FIGURE_REQUIRED', 'figureKey', '请选择精确 figure key');
  if (!draft.figureGeneration) {
    issue(errors, 'GENERATION_REQUIRED', 'figureGeneration', '当前 figure 尚未 ready');
  }
  if (!draft.modelProfileId) {
    issue(errors, 'PROFILE_REQUIRED', 'modelProfileId', '请选择兼容 model profile');
  }
  if (!profile) {
    issue(errors, 'NO_COMPATIBLE_MODEL_PROFILE', 'modelProfileId', '缺少精确兼容的 model profile');
  } else {
    if (profile.modelProfileId !== draft.modelProfileId) {
      issue(errors, 'PROFILE_ID_MISMATCH', 'modelProfileId', '草稿与已加载 profile ID 不一致');
    }
    const compatibleNames = compatibleAnchorNames(draft.anchorName);
    if (!profile.anchors.some((anchor) => compatibleNames.includes(anchor.name))) {
      issue(errors, 'ANCHOR_NOT_FOUND', 'anchorName', 'named anchor 不存在于所选 profile');
    }
  }
  if (!draft.displayName.trim()) {
    issue(errors, 'DISPLAY_NAME_REQUIRED', 'displayName', '显示名称不能为空');
  }
  const values = [
    draft.placement.offset.x,
    draft.placement.offset.y,
    draft.placement.localScale,
    draft.placement.localScaleX,
    draft.placement.localScaleY,
    draft.placement.rotationOffsetRad,
    draft.placement.spriteAnchor.x,
    draft.placement.spriteAnchor.y,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    issue(errors, 'NON_FINITE_PLACEMENT', 'placement', 'placement 数值必须全部 finite');
  }
  if (draft.placement.localScale <= 0 || draft.placement.localScaleX <= 0 || draft.placement.localScaleY <= 0) {
    issue(errors, 'INVALID_SCALE', 'placement.localScale', 'X/Y 大小必须大于 0');
  }
  try {
    parseAttachmentEntityVisualState(draft.visualState ?? {}, 'visualState');
  } catch (error) {
    issue(errors, 'INVALID_VISUAL_STATE', 'visualState', error instanceof Error ? error.message : 'visualState 无效');
  }
  for (const name of layerNamesForMode(draft.layerMode)) {
    const metadata = draft.layers[name];
    if (!metadata) {
      issue(errors, 'LAYER_REQUIRED', `layers.${name}`, `${name} PNG 尚未导入`);
      continue;
    }
    if (metadata.bytes <= 0 || metadata.width <= 0 || metadata.height <= 0) {
      issue(errors, 'INVALID_PNG_METADATA', `layers.${name}`, `${name} PNG 元数据无效`);
    }
    if (!/^[A-F0-9]{64}$/.test(metadata.sha256)) {
      issue(errors, 'INVALID_PNG_HASH', `layers.${name}.sha256`, `${name} PNG SHA-256 无效`);
    }
    if (!validateCreatorLeafId(metadata.outputFileName)) {
      issue(errors, 'INVALID_OUTPUT_FILE', `layers.${name}.outputFileName`, 'PNG 输出文件名不安全');
    }
    if (
      metadata.outputPath &&
      (metadata.outputPath.startsWith('/') ||
        metadata.outputPath.includes('\\') ||
        metadata.outputPath.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
    ) {
      issue(errors, 'INVALID_OUTPUT_PATH', `layers.${name}.outputPath`, 'PNG 正式路径必须位于游戏根目录内');
    }
  }
  for (const name of ['back', 'front'] as const) {
    if (!layerNamesForMode(draft.layerMode).includes(name) && draft.layers[name]) {
      issue(warnings, 'UNUSED_LAYER', `layers.${name}`, `${name} PNG 已导入但当前 layer mode 不会导出`, 'warning');
    }
  }
  if (draft.handBinding) {
    if (!handAppearanceSupported(draft.visualState?.appearance)) issue(errors, 'HAND_APPEARANCE_UNSUPPORTED', 'visualState.appearance', '手部内部遮挡暂不支持附件自身滤镜，请恢复默认滤镜或停用手部模式');
    try { parseAttachmentHandBinding(draft.handBinding); } catch (error) { issue(errors, 'HAND_BINDING_INVALID', 'handBinding', String(error)); }
    if (draft.layerMode === 'both' || !draft.layers[draft.handBinding.textureLayer]) issue(errors, 'HAND_SINGLE_TEXTURE_REQUIRED', 'handBinding', '手部内部遮挡当前使用一张图片，请选择与手部配置一致的前层或后层素材');
    issue(warnings, 'HAND_STATE_SUPPORT_LIMIT', 'handBinding', '只有已配置且可见的手型会显示附件；其他手型暂不显示。请用正式动作检查。', 'warning');
  }
  if (Math.abs(draft.placement.offset.x) > 5000 || Math.abs(draft.placement.offset.y) > 5000) {
    issue(warnings, 'LARGE_OFFSET', 'placement.offset', 'offset 很大，请确认视觉结果', 'warning');
  }
  return { valid: errors.length === 0, errors, warnings };
}
