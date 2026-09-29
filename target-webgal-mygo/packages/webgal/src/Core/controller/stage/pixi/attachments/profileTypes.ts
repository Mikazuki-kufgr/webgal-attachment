import type { AttachmentHandBinding } from './handBinding';
import type { AttachmentEntityVisualState } from './stageEntityVisualState';

export const MODEL_PROFILE_SCHEMA = 'webgal-live2d-model-profile' as const;
export const ATTACHMENT_ASSET_SCHEMA = 'webgal-live2d-attachment-asset' as const;
export const ATTACHMENT_PRESET_SCHEMA = 'webgal-live2d-attachment-preset' as const;
export const ATTACHMENT_PROFILE_SCHEMA_VERSION = 1 as const;
export const ATTACHMENT_PRESET_SCHEMA_VERSION = 2 as const;
export const LAYERED_ATTACHMENT_CONFIG_PREFIX = 'v2/' as const;

const LEGACY_PROFILE_ANCHOR_MIGRATION: Readonly<Record<string, string>> = Object.freeze({
  'left-ear': 'ear-left',
  'right-ear': 'ear-right',
  'left-eye': 'eyelid-upper-left',
  'right-eye': 'eyelid-upper-right',
});

export function migrateLegacyProfileAnchorName(name: string): string {
  return LEGACY_PROFILE_ANCHOR_MIGRATION[name] ?? name;
}

export function isAmbiguousLegacyEyeAnchor(name: string): boolean {
  return name === 'left-eye' || name === 'right-eye';
}

/** Runtime lookup compatibility after versioned parsing has canonicalized old profile IDs. */
const ANCHOR_NAME_COMPATIBILITY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'left-ear': Object.freeze(['ear-left', 'left-ear', 'viewer-left-ear']),
  'ear-left': Object.freeze(['ear-left', 'left-ear', 'viewer-left-ear']),
  'viewer-left-ear': Object.freeze(['ear-left', 'left-ear', 'viewer-left-ear']),
  'right-ear': Object.freeze(['ear-right', 'right-ear', 'viewer-right-ear']),
  'ear-right': Object.freeze(['ear-right', 'right-ear', 'viewer-right-ear']),
  'viewer-right-ear': Object.freeze(['ear-right', 'right-ear', 'viewer-right-ear']),
  'left-eye': Object.freeze(['eyelid-upper-left', 'left-eye']),
  'eyelid-upper-left': Object.freeze(['eyelid-upper-left', 'left-eye']),
  'right-eye': Object.freeze(['eyelid-upper-right', 'right-eye']),
  'eyelid-upper-right': Object.freeze(['eyelid-upper-right', 'right-eye']),
  'eye-left': Object.freeze(['eye-center-left', 'eye-left', 'viewer-left-eye']),
  'eye-center-left': Object.freeze(['eye-center-left', 'eye-left', 'viewer-left-eye']),
  'viewer-left-eye': Object.freeze(['eye-center-left', 'eye-left', 'viewer-left-eye']),
  'eye-right': Object.freeze(['eye-center-right', 'eye-right', 'viewer-right-eye']),
  'eye-center-right': Object.freeze(['eye-center-right', 'eye-right', 'viewer-right-eye']),
  'viewer-right-eye': Object.freeze(['eye-center-right', 'eye-right', 'viewer-right-eye']),
});

export function compatibleAnchorNames(name: string): readonly string[] {
  return ANCHOR_NAME_COMPATIBILITY[name] ?? [name];
}

export type AttachmentProfileErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'DUPLICATE_ID'
  | 'PATH_TRAVERSAL'
  | 'MODEL_PROFILE_NOT_FOUND'
  | 'MODEL_PROFILE_INVALID'
  | 'MODEL_FINGERPRINT_MISMATCH'
  | 'ANCHOR_NOT_FOUND'
  | 'PRESET_MODEL_INCOMPATIBLE'
  | 'DRAWABLE_NOT_FOUND';

export interface ProfilePoint {
  x: number;
  y: number;
}

export interface ModelProfileAnchorPoint {
  index: number;
  weight: number;
  neutral: ProfilePoint;
}

export interface ModelProfileAnchor {
  name: string;
  /** User-owned label. The stable name remains the script/config identity. */
  displayName?: string;
  /** Stable identity proving an explicit cross-model anchor decision. */
  anchorProfileId: string;
  drawableId: string;
  vertexCount: number;
  points: ModelProfileAnchorPoint[];
}

export interface ModelFingerprint {
  modelJsonSha256: string;
  mocSha256?: string;
  drawableCount: number;
}

/** Exact, versioned binding facts for one Live2D model revision. */
export interface Live2DModelProfile {
  schema: typeof MODEL_PROFILE_SCHEMA;
  schemaVersion: typeof ATTACHMENT_PROFILE_SCHEMA_VERSION;
  profileVersion: number;
  modelProfileId: string;
  characterId: string;
  modelId: string;
  modelPath: string;
  fingerprint: ModelFingerprint;
  anchors: ModelProfileAnchor[];
}

/** Shared image layers; intentionally contains no model-specific placement. */
export interface AttachmentAssetDefinition {
  schema: typeof ATTACHMENT_ASSET_SCHEMA;
  schemaVersion: typeof ATTACHMENT_PROFILE_SCHEMA_VERSION;
  attachmentAssetId: string;
  slot: string;
  layers: {
    back?: string;
    front?: string;
  };
  attachedLayers?: {
    back?: string;
    front?: string;
  };
  freeRenderable?: {
    full: string;
  };
}

/** Selects one shared asset, one exact model profile, and one named anchor. */
export interface AttachmentPlacementPreset {
  schema: typeof ATTACHMENT_PRESET_SCHEMA;
  schemaVersion: 1 | typeof ATTACHMENT_PRESET_SCHEMA_VERSION;
  presetId: string;
  handBinding?: AttachmentHandBinding;
  approvalStatus: 'approved' | 'candidate';
  attachmentAssetId: string;
  modelProfileId: string;
  anchorName: string;
  fit: {
    scaleMode: 'fixed' | 'uniform';
  };
  placement: {
    spriteAnchor: ProfilePoint;
    offset: ProfilePoint;
    rotationOffsetRad: number;
    localScale: number;
    localScaleX?: number;
    localScaleY?: number;
  };
  initialVisualState?: AttachmentEntityVisualState & { space: 'local' };
}

/** Profile facts retained beside the legacy-shaped resolved runtime config. */
export interface ResolvedAttachmentModelBinding {
  modelProfileId: string;
  characterId: string;
  modelId: string;
  modelPath: string;
  profileVersion: number;
  presetApprovalStatus: AttachmentPlacementPreset['approvalStatus'];
  fingerprint: ModelFingerprint;
  anchorName: string;
  anchorProfileId: string;
  drawableId: string;
  vertexCount: number;
  anchorVertexIndices: number[];
}

export interface ObservedAttachmentModelBinding {
  modelPath: string;
  modelJsonSha256?: string;
  mocSha256?: string;
  drawableCount?: number;
  getDrawableVertexCount(drawableId: string): number | undefined;
}
