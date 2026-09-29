import type { AttachmentHandBinding } from '../handBinding';
import type { AttachmentPlacementPreset, Live2DModelProfile, ProfilePoint } from '../profileTypes';
import type { ResolvedAttachmentPreset } from '../profileLoader';
import type { AttachmentEntityVisualState } from '../stageEntityVisualState';

export const ATTACHMENT_CREATOR_SCHEMA = 'webgal-attachment-creator-draft' as const;
export const ATTACHMENT_CREATOR_SCHEMA_VERSION = 1 as const;
export const ATTACHMENT_CREATOR_TOOL_VERSION = 'portable-folder-v1' as const;

export type CreatorLayerMode = 'front-only' | 'back-only' | 'both';
export type CreatorScaleMode = 'fixed' | 'uniform';

export interface CreatorPlacement {
  spriteAnchor: ProfilePoint;
  offset: ProfilePoint;
  rotationOffsetRad: number;
  localScale: number;
  localScaleX: number;
  localScaleY: number;
  scaleMode: CreatorScaleMode;
}

export interface CreatorLayerMetadata {
  sourceFileName: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  outputFileName: string;
  /** Stable game-root-relative path when editing an existing project resource. */
  outputPath?: string;
}

/** Pure serializable draft. File/Blob/URL/Pixi objects live in the session adapter. */
export interface CreatorDraft {
  schema: typeof ATTACHMENT_CREATOR_SCHEMA;
  schemaVersion: typeof ATTACHMENT_CREATOR_SCHEMA_VERSION;
  draftId: string;
  figureKey: string;
  figureGeneration: string;
  modelProfileId: string;
  anchorName: string;
  attachmentDefinitionId: string;
  presetId: string;
  displayName: string;
  attachmentInstanceId: string;
  slot: string;
  layerMode: CreatorLayerMode;
  layers: { back?: CreatorLayerMetadata; front?: CreatorLayerMetadata };
  placement: CreatorPlacement;
  handBinding?: AttachmentHandBinding;
  visualState: AttachmentEntityVisualState & { space: 'local' };
  approvalStatus?: 'approved' | 'candidate';
  sourcePresetId?: string;
}

export interface CreatorProfileCatalogEntry {
  modelProfileId: string;
  sourcePresetByAnchor: Readonly<Record<string, string>>;
  representativeMotions: readonly string[];
}

export interface CreatorFigureView {
  figureKey: string;
  generation: string;
  generationShort: string;
  modelPath: string;
  sourceType: string;
  state: 'ready' | 'loading' | 'exiting' | 'not-live2d' | 'ambiguous';
  compatibleProfiles: Live2DModelProfile[];
}

export interface CreatorValidationIssue {
  level: 'error' | 'warning';
  code: string;
  field: string;
  message: string;
}

export interface CreatorValidationResult {
  valid: boolean;
  errors: CreatorValidationIssue[];
  warnings: CreatorValidationIssue[];
}

export interface CreatorBinaryInput {
  metadata: CreatorLayerMetadata;
  bytes: Uint8Array;
}

export interface CreatorExportFile {
  path: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface CreatorExportManifest {
  schema: 'webgal-attachment-creator-export-manifest';
  schemaVersion: 1;
  toolVersion: typeof ATTACHMENT_CREATOR_TOOL_VERSION;
  createdAt: string;
  attachmentDefinitionId: string;
  presetId: string;
  modelProfileId: string;
  anchorName: string;
  layerMode: CreatorLayerMode;
  displayName: string;
  sourcePngFileNames: string[];
  overwrite: boolean;
  validation: CreatorValidationResult;
  commandSnippet: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface CreatorPackage {
  draft: CreatorDraft;
  profile: Live2DModelProfile;
  preset: AttachmentPlacementPreset;
  commandSnippet: string;
  files: CreatorExportFile[];
  manifest: CreatorExportManifest;
  resolvedConfig: ResolvedAttachmentPreset;
}
