import type { AttachmentHandBinding } from './handBinding';
import type { Live2DModel } from 'pixi-live2d-display-webgal';
import type * as PIXI from 'pixi.js';
import type PixiStage from '@/Core/controller/stage/pixi/PixiController';
import type { AttachmentEntityVisualState } from './stageEntityVisualState';

import type { AttachmentProfileErrorCode, ResolvedAttachmentModelBinding } from './profileTypes';

import type { Live2DCurrentFrame, Live2DFrameDriverStats } from '@/Core/controller/stage/pixi/live2dFrameDriver';

export const ATTACHMENT_CONFIG_SCHEMA = 'webgal-live2d-attachment-v1' as const;

export interface AttachmentPoint {
  x: number;
  y: number;
}

export interface AttachmentBindingAnchor {
  index: number;
  weight: number;
  neutral: AttachmentPoint;
}

export type AttachmentScaleMode = 'fixed' | 'uniform';

/** Canonical, data-only production contract. */
export interface AttachmentConfig {
  schema: typeof ATTACHMENT_CONFIG_SCHEMA;
  configId: string;
  handBinding?: AttachmentHandBinding;
  target: {
    modelPath: string;
    anchorProfile: {
      drawableId: string;
      anchors: AttachmentBindingAnchor[];
    };
  };
  fit: {
    scaleMode: AttachmentScaleMode;
  };
  /** Legacy v1 spelling retained for old configs and creator round-trips. */
  layers: {
    back?: string;
    front?: string;
  };
  /** Canonical MVP-3B attached representation. */
  attachedLayers?: {
    back?: string;
    front?: string;
  };
  /** Optional single renderable used only while the logical entity is free. */
  freeRenderable?: {
    full: string;
  };
  placement: {
    spriteAnchor: AttachmentPoint;
    offset: AttachmentPoint;
    rotationOffsetRad: number;
    localScale: number;
    /** Optional non-uniform authoring scale. Legacy readers continue to use localScale. */
    localScaleX?: number;
    localScaleY?: number;
  };
  /** Creator-authored local content transform/appearance below the Stage Entity host. */
  initialVisualState?: AttachmentEntityVisualState & { space: 'local' };
}

export interface LoadedAttachmentConfig {
  sourceUrl: string;
  config: AttachmentConfig;
  /** A valid target using shared defaults still needs user calibration. */
  calibrationStatus?: 'saved' | 'default-uncalibrated';
  /** Present only for explicitly namespaced layered v2 presets. */
  modelBinding?: ResolvedAttachmentModelBinding;
}

export interface AttachmentDeclaration {
  figureKey: string;
  attachmentId: string;
  /** Stable scene identity. Legacy declarations may omit it and use the deterministic adapter. */
  entityId?: string;
  configId: string;
  /** Stable schema-v2 adaptation identity. Legacy single-match declarations may omit it. */
  modelProfileId?: string;
  slot?: string;
  visible: boolean;
  /** Serializable seed copied into the runtime-only transform host at creation. */
  visualState?: AttachmentEntityVisualState;
  /** Script-level semantic contract; it must match the selected preset's actual named anchor. */
  semanticAnchor?: string;
  /** Canonical semantic contract resolved before any runtime ownership mutation. */
  semanticBinding?: SemanticRuntimeBinding;
}

export interface SemanticRuntimeBinding {
  profileId: string;
  semanticAnchorId: string;
  modelProfileId: string;
  namedAnchor: string;
  fitAlgorithm: 'fitRigid2D';
  referenceFrame: 'current-frame-mesh';
}

/** Serializable seed for rebuilding a committed free entity after runtime loss. */
export interface FreeAttachmentDeclaration extends AttachmentDeclaration {
  visualState: AttachmentEntityVisualState & { space: 'world' };
  lastAttachedLocalVisualState: AttachmentEntityVisualState & { space: 'local' };
}

export interface AttachmentFigureTarget {
  /** Stable state key used by WebGAL commands. */
  key: string;
  /** Per-creation UUID; prevents an old async load binding to a replacement. */
  generation: string;
  sourcePath: string;
  app: PIXI.Application;
  container: PIXI.Container;
  model: Live2DModel;
  /** Runtime-only registry/host owner; never enters serializable stage state. */
  stage?: PixiStage;
}

export type AttachmentInstancePhase = 'loading' | 'ready' | 'error';

export type AttachmentFirstValidPoseDeferredReason =
  | 'attachment-hidden'
  | 'document-hidden'
  | 'figure-not-renderable'
  | 'render-surface-unavailable';

/**
 * Runtime-only first-pose evidence. Resource/controller readiness remains in
 * `phase`; only the production frame consumer may promote this state to
 * `ready` for the current instance and figure generation.
 */
export interface AttachmentFirstValidPoseSnapshot {
  status: 'pending' | 'ready' | 'deferred' | 'timed-out';
  frame?: number;
  timestamp?: number;
  observedAt?: number;
  reason?: AttachmentFirstValidPoseDeferredReason | 'no-valid-frame';
}

export type AttachmentFirstValidPoseWaitResult =
  | {
      status: 'ready';
      instance: AttachmentInstanceSnapshot;
    }
  | {
      status: 'deferred';
      reason: AttachmentFirstValidPoseDeferredReason;
      instance: AttachmentInstanceSnapshot;
    };

export type AttachmentRuntimeErrorCode =
  | AttachmentProfileErrorCode
  | 'IMAGE_LOAD_FAILED'
  | 'MODEL_INCOMPATIBLE'
  | 'ENTITY_ID_CONFLICT'
  | 'VERTEX_OUT_OF_RANGE'
  | 'RUNTIME_CREATE_FAILED'
  | 'SEMANTIC_RUNTIME_BINDING_MISMATCH';

export interface AttachmentInstanceSnapshot {
  entityId?: string;
  figureKey: string;
  figureGeneration: string;
  attachmentId: string;
  configId: string;
  modelProfileId?: string;
  slot?: string;
  visible: boolean;
  phase: AttachmentInstancePhase;
  firstValidPose: AttachmentFirstValidPoseSnapshot;
  errorCode?: AttachmentRuntimeErrorCode;
  error?: string;
  semanticBinding?: SemanticRuntimeBinding;
  modelBinding?: ResolvedAttachmentModelBinding;
  semanticRuntimeTrace?: {
    semanticProfileId: string;
    canonicalSemanticAnchorId: string;
    modelProfileId: string;
    namedAnchor: string;
    referenceFrame: 'current-frame-mesh';
    fitAlgorithm: 'fitRigid2D';
    currentFrameMesh: true;
    actualProxyCount: number;
  };
}

export type AttachmentRuntimeEvent =
  | { type: 'figure-registered'; figureKey: string; figureGeneration: string }
  | { type: 'figure-retiring'; figureKey: string; figureGeneration: string }
  | { type: 'figure-unregistered'; figureKey: string; figureGeneration: string }
  | { type: 'instance-changed'; instance: AttachmentInstanceSnapshot }
  | { type: 'instance-error'; instance: AttachmentInstanceSnapshot }
  | {
      type: 'instance-removed';
      figureKey: string;
      figureGeneration: string;
      attachmentId: string;
    }
  | {
      type: 'frame';
      figureKey: string;
      figureGeneration: string;
      frame: Live2DCurrentFrame;
      stats: Live2DFrameDriverStats;
    };

export type AttachmentRuntimeObserver = (event: AttachmentRuntimeEvent) => void;

export interface AttachmentTextureSet {
  back?: PIXI.Texture;
  front?: PIXI.Texture;
  full?: PIXI.Texture;
}

export type AttachmentTextureLoader = (url: string) => Promise<PIXI.Texture>;
