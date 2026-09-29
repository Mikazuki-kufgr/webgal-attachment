import * as PIXI from 'pixi.js';
import { v4 as uuid } from 'uuid';

import { AttachmentConfigError, AttachmentConfigLoader, normalizeGameAssetPath } from './configLoader';
import {
  HatAttachmentController,
  HatAttachmentError,
  type AttachmentDetachFrameReadiness,
  type AttachmentPresentationContinuityEvidence,
  type HatAttachmentCalibrationPreview,
} from './HatAttachmentController';
import { assertAttachmentModelBinding, AttachmentProfileError } from './profileLoader';
import type { ResolvedAttachmentModelBinding } from './profileTypes';
import type {
  AttachmentDeclaration,
  AttachmentFirstValidPoseDeferredReason,
  AttachmentFirstValidPoseWaitResult,
  AttachmentFigureTarget,
  FreeAttachmentDeclaration,
  AttachmentInstanceSnapshot,
  AttachmentRuntimeEvent,
  AttachmentRuntimeErrorCode,
  AttachmentRuntimeObserver,
  AttachmentTextureLoader,
  AttachmentTextureSet,
  LoadedAttachmentConfig,
  SemanticRuntimeBinding,
} from './types';

import {
  attachLive2DAttachmentLayers,
  createLive2DAttachmentLayers,
  destroyLive2DAttachmentLayers,
  type Live2DAttachmentLayers,
} from '@/Core/controller/stage/pixi/live2dAttachments';
import {
  startLive2DFrameDriver,
  type Live2DCurrentFrame,
  type Live2DCurrentFrameConsumer,
  type Live2DFrameDriverController,
  type Live2DFrameDriverStats,
  type StartLive2DFrameDriverOptions,
} from '@/Core/controller/stage/pixi/live2dFrameDriver';
import { WebGALPixiContainer } from '@/Core/controller/stage/pixi/WebGALPixiContainer';
import { deriveLegacyAttachmentEntityId } from './stageEntityIdentity';
import {
  applyAttachmentEntityVisualState,
  cloneAttachmentEntityVisualState,
  destroyAttachmentEntityAppearance,
  readAttachmentEntityVisualState,
  type AttachmentEntityVisualState,
} from './stageEntityVisualState';
import { StageEntityOperationError, toStageEntityOperationError } from './stageEntityOperationError';
import { attachmentSemanticAnchorMatchesPreset, isAmbiguousUnversionedEyeAnchor } from './semanticAnchorContract';
import {
  startAttachmentVisibilityTransition,
  type AttachmentVisibilityTransitionControls,
} from './visibilityTransition';

export interface AttachmentRuntimeOptions {
  configLoader?: AttachmentConfigLoader;
  textureLoader?: AttachmentTextureLoader;
  /** Test seam for lifecycle harnesses that must not start Pixi/WebGL tickers. */
  driverStarter?: (options: StartLive2DFrameDriverOptions) => Live2DFrameDriverController;
  /** Terminally settles shared transforms before an entity target is destroyed. */
  removeTransformOnTarget?: (entityId: string) => boolean;
  /** Bounded valid-frame wait; configurable only to keep deterministic harnesses fast. */
  frameOperationTimeoutMs?: number;
}

interface RuntimeInstance {
  entityId: string;
  declaration: AttachmentDeclaration;
  snapshot: AttachmentInstanceSnapshot;
  token: symbol;
  controller?: HatAttachmentController;
  modelBinding?: ResolvedAttachmentModelBinding;
  transformHost?: WebGALPixiContainer;
  externalStageObjectUuid?: string;
}

type AttachmentEntityRuntimeState = 'attached' | 'free';

interface RuntimeEntityRecord {
  entityId: string;
  attachmentId: string;
  originFigureKey: string;
  state: AttachmentEntityRuntimeState;
  instance: RuntimeInstance;
  stage?: NonNullable<AttachmentFigureTarget['stage']>;
  attachedRecord?: FigureRecord;
  operationRevision: number;
  visibilityTransition?: {
    token: symbol;
    targetVisible: boolean;
    controls: AttachmentVisibilityTransitionControls;
  };
  lastAttachedLocalState: AttachmentEntityVisualState;
  preparedReattach?: {
    token: string;
    figureKey: string;
    figureGeneration: string;
    attachedLocalState: AttachmentEntityVisualState;
    flight?: { from: AttachmentEntityVisualState; progress: number; error?: unknown };
    requestedSemanticAnchor?: string;
    modelProfileId?: string;
    candidate?: {
      controller: HatAttachmentController;
      modelBinding?: ResolvedAttachmentModelBinding;
      freeVisualState: AttachmentEntityVisualState & { space: 'world' };
    };
  };
}

interface AttachmentReconcilePlan {
  readonly authoritativeEntityState: boolean;
  readonly next: ReadonlyMap<string, ReadonlyMap<string, AttachmentDeclaration>>;
  readonly nextFree: ReadonlyMap<string, FreeAttachmentDeclaration>;
  readonly retiringEntities: readonly RuntimeEntityRecord[];
  readonly retiringInstances: ReadonlySet<RuntimeInstance>;
}

interface PendingFrameOperation {
  id: string;
  entityId: string;
  run: () => void;
  reject: (error: unknown) => void;
  evaluate: () => { ready: boolean; details?: unknown };
  lastReadiness?: unknown;
  settled: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

export interface AttachmentEntityTransitionEvidence {
  entityId: string;
  figureKey: string;
  figureGeneration: string;
  proxyIdentityTokens: [string, string] | [string, string, string];
  representation: 'layer-composition' | 'full';
  maxMatrixDelta: number;
  maxWorldAlphaDelta: number;
  presentation: AttachmentPresentationContinuityEvidence;
  capturedAt: number;
}

export interface AttachmentEntityDetachResult {
  /** Sampled native layout basis, excluding the parent author transform. */
  freePositionOrigin?: { x: number; y: number };
  entityId: string;
  figureKey: string;
  attachmentId: string;
  visualState: AttachmentEntityVisualState;
  evidence: AttachmentEntityTransitionEvidence;
}

export interface AttachmentEntityReattachTarget {
  token: string;
  entityId: string;
  figureKey: string;
  figureGeneration: string;
  targetVisualState: AttachmentEntityVisualState;
  modelProfileId?: string;
}

export interface AttachmentEntityReattachResult {
  entityId: string;
  figureKey: string;
  attachmentId: string;
  visualState: AttachmentEntityVisualState;
  modelProfileId?: string;
  evidence: AttachmentEntityTransitionEvidence;
}

export interface AttachmentCalibrationTarget {
  instance: AttachmentInstanceSnapshot;
  sourcePath: string;
  modelBinding?: ResolvedAttachmentModelBinding;
  preview?: HatAttachmentCalibrationPreview;
}

export interface AttachmentRuntimeDiagnostics {
  figureCount: number;
  retiringFigureCount: number;
  modelCount: number;
  frameDriverCount: number;
  renderPreparationHookCount: number;
  ownedTickerListenerCount: number;
  layerPairCount: number;
  attachmentControllerCount: number;
  retiringAttachmentControllerCount: number;
  runtimeObserverCount: number;
  frameObserverCount: number;
  textureCacheEntryCount: number;
  stageEntityCount: number;
  attachedEntityCount: number;
  freeEntityCount: number;
  renderProxyCount: number;
  retiringRenderProxyCount: number;
  freeHostCount: number;
  externalTransformTargetCount: number;
  pendingFrameOperationCount: number;
  pendingReattachCount: number;
  pendingDetachMaterializationCount: number;
  filterInstanceCount: number;
  figures: Array<{
    figureKey: string;
    figureGeneration: string;
    instanceCount: number;
    readyControllerCount: number;
    hasDriver: boolean;
    hasLayerPair: boolean;
  }>;
  retiringFigures: Array<{
    figureKey: string;
    figureGeneration: string;
    instanceCount: number;
    readyControllerCount: number;
    hasDriver: boolean;
    hasLayerPair: boolean;
  }>;
}

export interface FreeAttachmentRestoreDiagnostic {
  entityId: string;
  state: 'restoring' | 'waiting-for-stage' | 'error';
  attempts: number;
  reason: string;
  liveFigureKeys: string[];
}

interface FigureRecord {
  target: AttachmentFigureTarget;
  instances: Map<string, RuntimeInstance>;
  frameObservers: Set<Live2DCurrentFrameConsumer>;
  layers?: Live2DAttachmentLayers;
  driver?: Live2DFrameDriverController;
  presentationDestroyed: boolean;
  onModelDestroy: () => void;
  pendingFrameOperations: PendingFrameOperation[];
}

function defaultTextureLoader(url: string) {
  return PIXI.Texture.fromURL(url);
}

function cloneDeclaration(declaration: AttachmentDeclaration): AttachmentDeclaration {
  return {
    ...declaration,
    ...(declaration.visualState
      ? {
          visualState: cloneAttachmentEntityVisualState(declaration.visualState),
        }
      : {}),
    entityId: declaration.entityId ?? deriveLegacyAttachmentEntityId(declaration.figureKey, declaration.attachmentId),
    ...(declaration.semanticBinding ? { semanticBinding: { ...declaration.semanticBinding } } : {}),
  };
}

function cloneSnapshot(snapshot: AttachmentInstanceSnapshot): AttachmentInstanceSnapshot {
  return {
    ...snapshot,
    firstValidPose: { ...snapshot.firstValidPose },
    ...(snapshot.semanticBinding ? { semanticBinding: { ...snapshot.semanticBinding } } : {}),
    ...(snapshot.modelBinding
      ? {
          modelBinding: {
            ...snapshot.modelBinding,
            fingerprint: { ...snapshot.modelBinding.fingerprint },
            anchorVertexIndices: [...snapshot.modelBinding.anchorVertexIndices],
          },
        }
      : {}),
    ...(snapshot.semanticRuntimeTrace ? { semanticRuntimeTrace: { ...snapshot.semanticRuntimeTrace } } : {}),
  };
}

function cloneModelBinding(modelBinding: ResolvedAttachmentModelBinding | undefined) {
  return modelBinding
    ? {
        ...modelBinding,
        fingerprint: { ...modelBinding.fingerprint },
        anchorVertexIndices: [...modelBinding.anchorVertexIndices],
      }
    : undefined;
}

function sameResolvedModelBinding(
  left: ResolvedAttachmentModelBinding | undefined,
  right: ResolvedAttachmentModelBinding | undefined,
) {
  if (!left || !right) return left === right;
  return (
    left.modelProfileId === right.modelProfileId &&
    left.anchorProfileId === right.anchorProfileId &&
    left.anchorName === right.anchorName &&
    left.drawableId === right.drawableId &&
    left.vertexCount === right.vertexCount &&
    left.modelPath === right.modelPath
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns figure generations, one frame driver/layer pair per model, and an
 * independent `(figureKey, attachmentId)` registry. DEV tools only observe it.
 */
declare const attachmentPreviewOwnerBrand: unique symbol;
/** In-memory Creator ownership; never enters StageStateManager or a save. */
export interface AttachmentPreviewOwner {
  readonly [attachmentPreviewOwnerBrand]: true;
}
interface PreviewClaim {
  figureKey: string;
  figureGeneration: string;
  attachmentId: string;
  entityId: string;
  declaration?: AttachmentDeclaration;
}

export class AttachmentRuntime {
  private readonly configLoader: AttachmentConfigLoader;
  private readonly textureLoader: AttachmentTextureLoader;
  private readonly driverStarter: (options: StartLive2DFrameDriverOptions) => Live2DFrameDriverController;
  private transformTargetRemover?: (entityId: string) => boolean;
  private readonly figures = new Map<string, FigureRecord>();
  private readonly retiringFigures = new Map<string, FigureRecord>();
  private readonly desired = new Map<string, Map<string, AttachmentDeclaration>>();
  private readonly desiredFree = new Map<string, FreeAttachmentDeclaration>();
  private readonly pendingFreeRestores = new Map<
    string,
    { declaration: FreeAttachmentDeclaration; promise: Promise<void> }
  >();
  private readonly freeRestoreDiagnostics = new Map<string, FreeAttachmentRestoreDiagnostic>();
  private freeStageHost?: NonNullable<AttachmentFigureTarget['stage']>;
  private readonly entities = new Map<string, RuntimeEntityRecord>();
  private readonly observers = new Set<AttachmentRuntimeObserver>();
  private readonly detachMaterializationWaits = new Set<() => void>();
  private readonly textureCache = new Map<string, Promise<PIXI.Texture>>();
  private readonly frameOperationTimeoutMs: number;
  private destroyed = false;
  private reconcileRevision = 0;
  private readonly previewClaims = new Map<AttachmentPreviewOwner, PreviewClaim>();

  public constructor(options: AttachmentRuntimeOptions = {}) {
    this.configLoader = options.configLoader ?? new AttachmentConfigLoader();
    this.textureLoader = options.textureLoader ?? defaultTextureLoader;
    this.driverStarter = options.driverStarter ?? startLive2DFrameDriver;
    this.transformTargetRemover = options.removeTransformOnTarget;
    this.frameOperationTimeoutMs = options.frameOperationTimeoutMs ?? 5_000;
    if (!Number.isFinite(this.frameOperationTimeoutMs) || this.frameOperationTimeoutMs <= 0) {
      throw new RangeError('frameOperationTimeoutMs must be a positive finite number');
    }
  }

  /** Installs the shared transition terminal-removal port without a module cycle. */
  public setTransformTargetRemover(remover: (entityId: string) => boolean) {
    this.transformTargetRemover = remover;
  }

  /** The stage exists independently of Live2D figures, including on an empty saved scene. */
  public setStageHost(stage: NonNullable<AttachmentFigureTarget['stage']>) {
    this.assertAlive();
    this.freeStageHost = stage;
  }

  /** DEV Creator seam: injects one memory-only resolved config for an exact profile/anchor. */
  public registerEphemeralConfig(configId: string, loaded: LoadedAttachmentConfig) {
    this.configLoader.registerEphemeral(configId, loaded);
  }

  public unregisterEphemeralConfig(configId: string) {
    return this.configLoader.unregisterEphemeral(configId);
  }

  /** A scoped, exact-generation diagnostic entity which does not occupy a narrative slot. */
  public claimPreviewAttachment(identity: Omit<PreviewClaim, 'declaration'>): AttachmentPreviewOwner {
    this.assertAlive();
    if (this.figureGeneration(identity.figureKey) !== identity.figureGeneration)
      throw new Error('CREATOR_PREVIEW_GENERATION_CHANGED');
    if (
      !identity.attachmentId.startsWith('__mvp2b_creator_preview_') ||
      !identity.entityId.startsWith('creator-preview:') ||
      this.desired.get(identity.figureKey)?.has(identity.attachmentId) ||
      this.entities.has(identity.entityId) ||
      [...this.previewClaims.values()].some(
        (claim) =>
          claim.entityId === identity.entityId ||
          (claim.figureKey === identity.figureKey && claim.attachmentId === identity.attachmentId),
      )
    )
      throw new Error('CREATOR_PREVIEW_OWNER_CONFLICT');
    const owner = Object.freeze({}) as AttachmentPreviewOwner;
    this.previewClaims.set(owner, { ...identity });
    return owner;
  }

  public upsertPreview(owner: AttachmentPreviewOwner, input: AttachmentDeclaration) {
    const claim = this.previewClaims.get(owner);
    if (!claim || this.figureGeneration(claim.figureKey) !== claim.figureGeneration)
      throw new Error('CREATOR_PREVIEW_OWNER_STALE');
    if (
      input.figureKey !== claim.figureKey ||
      input.attachmentId !== claim.attachmentId ||
      input.entityId !== claim.entityId ||
      input.slot !== undefined
    )
      throw new Error('CREATOR_PREVIEW_OWNER_MISMATCH');
    const previous = claim.declaration;
    const next = cloneDeclaration(input);
    claim.declaration = next;
    try {
      return this.upsert(next).catch((error) => {
        if (this.previewClaims.get(owner) === claim && claim.declaration === next) claim.declaration = previous;
        throw error;
      });
    } catch (error) {
      if (claim.declaration === next) claim.declaration = previous;
      throw error;
    }
  }

  public releasePreviewAttachment(owner: AttachmentPreviewOwner): boolean {
    const claim = this.previewClaims.get(owner);
    if (!claim) return false;
    this.previewClaims.delete(owner);
    this.remove(claim.figureKey, claim.attachmentId);
    return true;
  }

  /** Requires a current shared-driver frame. Creator may acknowledge a diagnosed unconfigured hand as loaded but hidden, never as a valid pose. */
  public waitForPreviewFrame(owner: AttachmentPreviewOwner, timeoutMs = 10_000, signal?: AbortSignal, allowUnconfiguredHand = false) {
    const claim = this.previewClaims.get(owner);
    if (!claim || signal?.aborted) return Promise.reject(new Error('CREATOR_PREVIEW_FRAME_CANCELLED'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new Error('CREATOR_PREVIEW_FRAME_CANCELLED'));
      const unsubscribe = this.subscribe((event) => {
        if (
          this.previewClaims.get(owner) !== claim ||
          this.figureGeneration(claim.figureKey) !== claim.figureGeneration
        )
          return finish(new Error('CREATOR_PREVIEW_OWNER_STALE'));
        if (
          event.type !== 'frame' ||
          event.figureKey !== claim.figureKey ||
          event.figureGeneration !== claim.figureGeneration
        )
          return;
        const snapshot = this.get(claim.figureKey, claim.attachmentId);
        if (
          snapshot?.phase === 'ready' &&
          snapshot.visible &&
          snapshot.figureGeneration === claim.figureGeneration &&
          (snapshot.firstValidPose.status === 'ready' ||
            (allowUnconfiguredHand && this.getHandStateDiagnostic(claim.figureKey, claim.attachmentId) === 'unsupported-state'))
        )
          finish();
        else if (snapshot?.phase === 'error' || !snapshot?.visible)
          finish(new Error('CREATOR_PREVIEW_FRAME_NOT_VISIBLE'));
      });
      timer = setTimeout(() => finish(new Error('CREATOR_PREVIEW_FRAME_TIMEOUT')), Math.max(1, timeoutMs));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  private retirePreviewClaims(figureKey: string, generation: string) {
    for (const [owner, claim] of this.previewClaims) {
      if (claim.figureKey === figureKey && claim.figureGeneration === generation) this.releasePreviewAttachment(owner);
    }
  }

  /** Cancels a shared transform only while this runtime still owns its Pixi target. */
  public removeEntityTransform(entityId: string) {
    const entity = this.entities.get(entityId);
    if (!entity || !this.ownsExternalStageObject(entity.instance, entity.stage)) return false;
    return this.transformTargetRemover?.(entityId) ?? false;
  }

  /** Figure-model-ready/generation hook for the future PixiController adapter. */
  public registerFigure(target: AttachmentFigureTarget) {
    this.assertAlive();
    if (target.stage) this.setStageHost(target.stage);
    const existing = this.figures.get(target.key);
    if (existing?.target.generation === target.generation && existing.target.model === target.model) return;
    if (existing) this.retireFigureRecord(existing);

    const record: FigureRecord = {
      target,
      instances: new Map(),
      frameObservers: new Set(),
      presentationDestroyed: false,
      onModelDestroy: () => this.unregisterFigureGeneration(target.key, target.generation),
      pendingFrameOperations: [],
    };
    this.figures.set(target.key, record);
    target.model.once('destroy', record.onModelDestroy);
    this.emit({
      type: 'figure-registered',
      figureKey: target.key,
      figureGeneration: target.generation,
    });

    const desired = this.desired.get(target.key);
    if (desired) {
      for (const declaration of desired.values()) void this.upsertLoaded(record, declaration);
    }
    void this.restoreDesiredFreeEntities();
  }

  public unregisterFigure(figureKey: string, generation?: string) {
    const record = this.figures.get(figureKey);
    if (!record || (generation !== undefined && record.target.generation !== generation)) return false;
    return this.unregisterFigureRecord(record, 'ENTITY_PARENT_NOT_FOUND');
  }

  public hasFigureGeneration(figureKey: string) {
    return this.figures.has(figureKey);
  }

  /** Returns the generation currently owned by the attachment runtime. */
  public figureGeneration(figureKey: string) {
    return this.figures.get(figureKey)?.target.generation;
  }

  /**
   * Waits until the React/Pixi lifecycle bridge has registered the exact
   * Live2D generation already observed by an authoring caller. Pixi model
   * readiness and attachment-runtime registration intentionally occur in
   * separate effects, so treating the former as the latter creates a narrow
   * but repeatable generation race while switching Creator models.
   */
  public waitForFigureGeneration(figureKey: string, generation: string, timeoutMs = 10_000, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(new Error('CREATOR_FIGURE_WAIT_CANCELLED'));
    if (this.figureGeneration(figureKey) === generation) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        signal?.removeEventListener('abort', abort);
        operation();
      };
      const abort = () => finish(() => reject(new Error('CREATOR_FIGURE_WAIT_CANCELLED')));
      const unsubscribe = this.subscribe((event) => {
        if (
          event.type === 'figure-registered' &&
          event.figureKey === figureKey &&
          event.figureGeneration === generation
        ) {
          finish(resolve);
        }
      });
      timeout = setTimeout(() => {
        const actual = this.figureGeneration(figureKey) ?? 'absent';
        finish(() =>
          reject(
            new Error(
              `Figure generation readiness timed out after ${timeoutMs} ms: ${figureKey}; expected=${generation}; actual=${actual}`,
            ),
          ),
        );
      }, Math.max(1, timeoutMs));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  /**
   * A new Pixi generation exists but its Live2D model is not ready yet.
   * Retire the old logical owner now so same-frame attachment declarations
   * prewarm for the incoming generation, while the old presentation remains
   * mounted until its real model destroy event.
   */
  public beginFigureReplacement(figureKey: string, nextGeneration: string) {
    const active = this.figures.get(figureKey);
    if (!active || active.target.generation === nextGeneration) return false;
    return this.retireFigureRecord(active);
  }

  private unregisterFigureGeneration(figureKey: string, generation: string) {
    const active = this.figures.get(figureKey);
    if (active?.target.generation === generation) {
      return this.unregisterFigureRecord(active, 'ENTITY_PARENT_NOT_FOUND');
    }
    const retired = this.retiringFigures.get(generation);
    if (!retired || retired.target.key !== figureKey) return false;
    this.retiringFigures.delete(generation);
    retired.target.model.off('destroy', retired.onModelDestroy);
    if (retired.driver) retired.driver.cleanup();
    else this.destroyPresentation(retired);
    this.emit({
      type: 'figure-unregistered',
      figureKey,
      figureGeneration: generation,
    });
    return true;
  }

  /** Keeps the old generation rendered under its real parent until WebGAL destroys that parent. */
  private retireFigureRecord(record: FigureRecord) {
    const figureKey = record.target.key;
    if (this.figures.get(figureKey) !== record) return false;
    this.retirePreviewClaims(figureKey, record.target.generation);
    this.figures.delete(figureKey);
    this.rejectPendingFrameOperations(
      record,
      new StageEntityOperationError(
        'ENTITY_TRANSITION_TARGET_LOST',
        `Figure ${figureKey} generation ${record.target.generation} is retiring`,
        { details: { figureKey, figureGeneration: record.target.generation } },
      ),
    );
    for (const instance of record.instances.values()) {
      instance.token = Symbol('retiring');
      const entity = this.entities.get(instance.entityId);
      if (entity?.instance !== instance || entity.state !== 'attached') continue;
      this.entities.delete(entity.entityId);
      entity.operationRevision += 1;
      entity.preparedReattach = undefined;
      this.releaseOwnedExternalStageObject(instance, entity.stage);
    }
    this.retiringFigures.set(record.target.generation, record);
    this.emit({
      type: 'figure-retiring',
      figureKey,
      figureGeneration: record.target.generation,
    });
    return true;
  }

  private unregisterFigureRecord(
    record: FigureRecord,
    lossCode: 'ENTITY_PARENT_NOT_FOUND' | 'ENTITY_TRANSITION_TARGET_LOST',
  ) {
    const figureKey = record.target.key;
    if (this.figures.get(figureKey) !== record) return false;
    this.retirePreviewClaims(figureKey, record.target.generation);
    this.figures.delete(figureKey);
    this.rejectPendingFrameOperations(
      record,
      new StageEntityOperationError(
        lossCode,
        `Figure ${figureKey} generation ${record.target.generation} was unregistered`,
        {
          details: {
            figureKey,
            figureGeneration: record.target.generation,
          },
        },
      ),
    );
    for (const entity of this.entities.values()) {
      if (entity.preparedReattach?.figureGeneration === record.target.generation) {
        entity.operationRevision += 1;
        entity.preparedReattach = undefined;
      }
    }
    record.target.model.off('destroy', record.onModelDestroy);
    if (record.driver) record.driver.cleanup();
    else this.destroyPresentation(record);
    this.emit({
      type: 'figure-unregistered',
      figureKey,
      figureGeneration: record.target.generation,
    });
    return true;
  }

  /** Replace all serializable declarations; absent figures remain desired until model-ready. */
  public async reconcile(
    declarations: readonly AttachmentDeclaration[],
    freeDeclarations?: readonly FreeAttachmentDeclaration[],
  ) {
    this.assertAlive();
    const authoritativeEntityState = freeDeclarations !== undefined;
    const next = new Map<string, Map<string, AttachmentDeclaration>>();
    const entityOwners = new Map<string, string>();
    // Narrative commits keep only explicitly leased Creator owners. These rows
    // remain runtime-local and retire with their exact parent generation.
    const previews = [...this.previewClaims.values()].flatMap((claim) =>
      claim.declaration && this.figureGeneration(claim.figureKey) === claim.figureGeneration ? [claim.declaration] : [],
    );
    for (const input of [...declarations, ...previews]) {
      const declaration = cloneDeclaration(input);
      const compositeKey = `${declaration.figureKey}\u0000${declaration.attachmentId}`;
      const previousOwner = entityOwners.get(declaration.entityId!);
      if (previousOwner && previousOwner !== compositeKey) {
        throw new StageEntityOperationError(
          'ENTITY_ID_CONFLICT',
          `Duplicate stage entity id ${JSON.stringify(declaration.entityId)}`,
          { details: { entityId: declaration.entityId } },
        );
      }
      entityOwners.set(declaration.entityId!, compositeKey);
      let byId = next.get(declaration.figureKey);
      if (!byId) next.set(declaration.figureKey, (byId = new Map()));
      if (byId.has(declaration.attachmentId)) {
        throw new StageEntityOperationError(
          'ENTITY_ID_CONFLICT',
          `Duplicate attachment declaration (${declaration.figureKey}, ${declaration.attachmentId})`,
          {
            details: {
              entityId: declaration.entityId,
              figureKey: declaration.figureKey,
              attachmentId: declaration.attachmentId,
            },
          },
        );
      }
      this.assertSlotAvailable(byId, declaration);
      byId.set(declaration.attachmentId, declaration);
    }

    const nextFree = new Map<string, FreeAttachmentDeclaration>();
    for (const input of freeDeclarations ?? []) {
      const declaration: FreeAttachmentDeclaration = {
        ...cloneDeclaration(input),
        visualState: cloneAttachmentEntityVisualState(input.visualState) as FreeAttachmentDeclaration['visualState'],
        lastAttachedLocalVisualState: cloneAttachmentEntityVisualState(
          input.lastAttachedLocalVisualState,
        ) as FreeAttachmentDeclaration['lastAttachedLocalVisualState'],
      };
      const entityId = declaration.entityId!;
      if (entityOwners.has(entityId) || nextFree.has(entityId)) {
        throw new StageEntityOperationError(
          'ENTITY_ID_CONFLICT',
          `Duplicate stage entity id ${JSON.stringify(entityId)}`,
          {
            details: { entityId },
          },
        );
      }
      entityOwners.set(entityId, `free:${entityId}`);
      nextFree.set(entityId, declaration);
    }

    const attachedIds = new Set([...next.values()].flatMap((byId) => [...byId.values()].map((item) => item.entityId!)));
    const retiringEntities = authoritativeEntityState
      ? [...this.entities.values()].filter(
          (entity) =>
            (entity.state === 'free' && attachedIds.has(entity.entityId)) ||
            (entity.state === 'free' &&
              nextFree.has(entity.entityId) &&
              (entity.instance.declaration.configId !== nextFree.get(entity.entityId)!.configId ||
                entity.instance.declaration.modelProfileId !== nextFree.get(entity.entityId)!.modelProfileId)) ||
            (entity.state === 'attached' && nextFree.has(entity.entityId)) ||
            (!attachedIds.has(entity.entityId) && !nextFree.has(entity.entityId)),
        )
      : [];
    const retiringInstances = new Set(retiringEntities.map((entity) => entity.instance));
    // Loading instances do not have a RuntimeEntityRecord yet, but an incoming
    // authoritative view can retire their exact composite just like a ready
    // instance. Include them in preflight before any live mutation.
    for (const record of this.figures.values()) {
      for (const instance of record.instances.values()) {
        const incoming = next.get(record.target.key)?.get(instance.declaration.attachmentId);
        if (!incoming || incoming.entityId !== instance.entityId) retiringInstances.add(instance);
      }
    }
    const reconcilePlan: AttachmentReconcilePlan = {
      authoritativeEntityState,
      next,
      nextFree,
      retiringEntities,
      retiringInstances,
    };

    // Build and validate the complete authoritative plan before retiring any
    // live representation. Instances explicitly scheduled for retirement may
    // hand their entity id to the replacement declaration, while every other
    // live owner remains a hard conflict. A failed preflight therefore leaves
    // both live entities and desired state untouched.
    for (const byId of reconcilePlan.next.values()) {
      for (const declaration of byId.values()) {
        this.assertGlobalEntityIdAvailable(declaration, false, reconcilePlan.retiringInstances);
      }
    }

    // I-19 terminal teardown is failure-contained and non-throwing, so this is
    // the first commit point: after it starts, no fallible ownership validation
    // remains. Retire before replacing desired maps because removeEntity also
    // removes the retiring instance's old desired composite.
    const revision = ++this.reconcileRevision;
    for (const entity of reconcilePlan.retiringEntities) this.removeEntity(entity.entityId);
    for (const record of this.figures.values()) {
      for (const [attachmentId, instance] of [...record.instances]) {
        if (reconcilePlan.retiringInstances.has(instance)) this.removeLoaded(record, attachmentId);
      }
    }

    this.desired.clear();
    for (const [figureKey, byId] of reconcilePlan.next) this.desired.set(figureKey, new Map(byId));
    if (reconcilePlan.authoritativeEntityState) {
      this.desiredFree.clear();
      for (const [entityId, declaration] of reconcilePlan.nextFree) this.desiredFree.set(entityId, declaration);
      for (const [entityId, pendingRestore] of [...this.pendingFreeRestores]) {
        if (reconcilePlan.nextFree.get(entityId) !== pendingRestore.declaration) {
          this.pendingFreeRestores.delete(entityId);
        }
      }
      for (const entityId of [...this.freeRestoreDiagnostics.keys()]) {
        if (!reconcilePlan.nextFree.has(entityId)) this.freeRestoreDiagnostics.delete(entityId);
      }
    }

    // Pending declarations warm their config and textures while Live2D is
    // still loading. A ready event can then create both proxies in the same
    // microtask checkpoint, before the model's first browser render.
    const preparation: Promise<void>[] = [];
    for (const [figureKey, byId] of reconcilePlan.next) {
      if (this.figures.has(figureKey)) continue;
      for (const declaration of byId.values()) preparation.push(this.preloadDeclaration(declaration));
    }
    // Start ready-figure updates before awaiting unrelated absent figures'
    // prewarm. A new config/visibility intent must invalidate or update an
    // existing loading instance in this same synchronous view commit.
    const pending: Promise<AttachmentInstanceSnapshot>[] = [];
    for (const [figureKey, byId] of reconcilePlan.next) {
      const record = this.figures.get(figureKey);
      if (!record) continue;
      for (const declaration of byId.values()) pending.push(this.upsertLoaded(record, declaration));
    }
    for (const declaration of reconcilePlan.nextFree.values()) {
      const entity = this.entities.get(declaration.entityId!);
      if (entity?.state !== 'free') continue;
      entity.instance.declaration.visible = declaration.visible;
      entity.instance.snapshot.visible = declaration.visible;
      entity.lastAttachedLocalState = cloneAttachmentEntityVisualState(declaration.lastAttachedLocalVisualState);
      // updateEffect optimistically publishes a transform's terminal state so
      // save/backlog data remain deterministic. That Redux write also wakes the
      // attachment reconciler. While Pixi's animation lock is active, however,
      // the live host belongs exclusively to the timeline; projecting the
      // optimistic declaration here would produce S -> E -> near-S and expose
      // E as a one-frame flash. Keep discrete declaration state synchronized,
      // but leave continuous live presentation to the locked animation.
      if (!entity.stage?.isTransformTargetLocked(entity.entityId)) {
        this.setEntityVisualState(entity.entityId, declaration.visualState);
      }
      this.syncDeclaredVisibility(entity.instance, declaration.visible);
    }
    const freeRestoration = authoritativeEntityState ? this.restoreDesiredFreeEntities() : Promise.resolve();
    const [attached] = await Promise.all([Promise.all(pending), Promise.allSettled(preparation), freeRestoration]);
    if (this.destroyed || revision !== this.reconcileRevision) return [];
    return attached;
  }

  private async restoreDesiredFreeEntities() {
    const pending: Promise<void>[] = [];
    for (const declaration of this.desiredFree.values()) {
      const entityId = declaration.entityId!;
      if (this.entities.get(entityId)?.state === 'free') continue;
      const existing = this.pendingFreeRestores.get(entityId);
      if (existing?.declaration === declaration) {
        pending.push(existing.promise);
        continue;
      }
      const operation = this.restoreFreeEntity(declaration)
        .catch((error) => {
          if (!this.destroyed && this.desiredFree.get(entityId) === declaration) {
            this.setFreeRestoreDiagnostic(declaration, 'error', errorMessage(error));
            console.error({
              scope: 'webgal.attachment.runtime',
              code: 'ATTACHMENT_FREE_RESTORE_FAILED',
              entityId,
              reason: errorMessage(error),
            });
          }
        })
        .finally(() => {
          if (this.pendingFreeRestores.get(entityId)?.promise === operation) this.pendingFreeRestores.delete(entityId);
        });
      this.pendingFreeRestores.set(entityId, { declaration, promise: operation });
      pending.push(operation);
    }
    await Promise.all(pending);
  }

  private async restoreFreeEntity(declaration: FreeAttachmentDeclaration) {
    const entityId = declaration.entityId!;
    const stage = this.freeStageHost;
    if (!stage?.figureContainer || stage.figureContainer.destroyed) {
      this.setFreeRestoreDiagnostic(declaration, 'waiting-for-stage', 'The attachment stage is not ready.', true);
      return;
    }
    const isCurrent = () =>
      !this.destroyed &&
      this.freeStageHost === stage &&
      !stage.figureContainer.destroyed &&
      this.desiredFree.get(entityId) === declaration;
    this.setFreeRestoreDiagnostic(declaration, 'restoring', 'Loading the saved attachment adaptation independently.');
    // The saved Profile is the identity. Never borrow a model path from whichever
    // figure happens to be on stage. Older unambiguous single-adaptation saves
    // still resolve without a Profile; ambiguous/missing resources fail visibly.
    const loaded = await this.configLoader.load(declaration.configId, undefined, declaration.modelProfileId, declaration.semanticAnchor);
    if (!isCurrent()) return;
    if (declaration.modelProfileId && loaded.modelBinding?.modelProfileId !== declaration.modelProfileId) {
      throw new AttachmentRuntimeFailure(
        'PRESET_MODEL_INCOMPATIBLE',
        'Saved attachment Profile does not match its resource',
      );
    }
    assertRequestedSemanticAnchor(loaded.modelBinding, declaration.semanticAnchor, declaration.configId);
    let textures: AttachmentTextureSet;
    try {
      textures = await this.loadTextures(
        loaded.config.attachedLayers ?? loaded.config.layers,
        loaded.config.freeRenderable,
      );
    } catch (error) {
      throw new AttachmentRuntimeFailure(
        'IMAGE_LOAD_FAILED',
        `Free attachment image load failed: ${errorMessage(error)}`,
      );
    }
    if (!isCurrent()) return;
    if (this.entities.has(entityId)) {
      throw new AttachmentRuntimeFailure('ENTITY_ID_CONFLICT', `Stage entity id is already active: ${entityId}`);
    }
    const transformHost = new WebGALPixiContainer();
    transformHost.attachmentLocalAlpha = true;
    transformHost.name = `__webgal_stage_entity_${encodeURIComponent(entityId)}__`;
    const instance: RuntimeInstance = {
      entityId,
      token: Symbol(entityId),
      declaration: cloneDeclaration(declaration),
      transformHost,
      modelBinding: cloneModelBinding(loaded.modelBinding),
      snapshot: {
        entityId,
        figureKey: declaration.figureKey,
        figureGeneration: '',
        attachmentId: declaration.attachmentId,
        configId: declaration.configId,
        modelProfileId: loaded.modelBinding?.modelProfileId ?? declaration.modelProfileId,
        modelBinding: cloneModelBinding(loaded.modelBinding),
        slot: declaration.slot,
        visible: declaration.visible,
        phase: 'ready',
        firstValidPose: { status: 'pending' },
      },
    };
    const entity: RuntimeEntityRecord = {
      entityId,
      attachmentId: declaration.attachmentId,
      originFigureKey: declaration.figureKey,
      state: 'free',
      instance,
      stage,
      operationRevision: 0,
      lastAttachedLocalState: cloneAttachmentEntityVisualState(declaration.lastAttachedLocalVisualState),
    };
    try {
      instance.controller = new HatAttachmentController({
        instanceId: `free_${encodeURIComponent(entityId)}`,
        config: loaded.config,
        textures,
        transformHost,
        free: { parent: stage.figureContainer, visualState: declaration.visualState },
        onError: (error) => {
          if (this.entities.get(entityId) !== entity || !instance.controller) return;
          if (entity.attachedRecord)
            this.failControllerTerminally(entity.attachedRecord, instance, instance.controller, error);
          else {
            this.destroyEntity(entity, false);
            this.failInstance(instance, error.code, error);
          }
        },
      });
      const externalStageObjectUuid = uuid();
      stage.registerExternalStageObject({
        uuid: externalStageObjectUuid,
        key: entityId,
        pixiContainer: transformHost,
        sourceUrl: '',
        sourceType: 'stage',
        sourceExt: '',
      });
      instance.externalStageObjectUuid = externalStageObjectUuid;
      this.entities.set(entityId, entity);
      this.syncDeclaredVisibility(instance, declaration.visible);
      instance.controller.releaseFreeInheritedPresentation();
    } catch (error) {
      if (this.entities.get(entityId) === entity) this.destroyEntity(entity, false);
      else {
        // Registration can reject a foreign target before this entity is
        // published. Clean up only our candidate graph, never that target.
        const failures: Array<{ step: string; error: unknown }> = [];
        this.runTerminalCleanupStep(failures, 'destroy-free-candidate', () => instance.controller?.destroy());
        this.runTerminalCleanupStep(failures, 'release-free-candidate', () =>
          this.releaseOwnedExternalStageObject(instance, stage),
        );
        this.runTerminalCleanupStep(failures, 'detach-free-candidate', () => {
          transformHost.parent?.removeChild(transformHost);
        });
        this.runTerminalCleanupStep(failures, 'destroy-free-candidate-appearance', () =>
          destroyAttachmentEntityAppearance(transformHost),
        );
        this.runTerminalCleanupStep(failures, 'destroy-free-candidate-host', () =>
          transformHost.destroy({ children: true, texture: false, baseTexture: false }),
        );
        this.reportTerminalCleanupFailures(entityId, failures);
      }
      throw error;
    }
    this.freeRestoreDiagnostics.delete(entityId);
    this.emitInstance(instance);
  }

  private setFreeRestoreDiagnostic(
    declaration: FreeAttachmentDeclaration,
    state: FreeAttachmentRestoreDiagnostic['state'],
    reason: string,
    warn = false,
  ) {
    const entityId = declaration.entityId!;
    if (this.destroyed || this.desiredFree.get(entityId) !== declaration) return;
    const previous = this.freeRestoreDiagnostics.get(entityId);
    const diagnostic: FreeAttachmentRestoreDiagnostic = {
      entityId,
      state,
      attempts: (previous?.attempts ?? 0) + (state === 'restoring' ? 1 : 0),
      reason,
      liveFigureKeys: [...this.figures.keys()],
    };
    this.freeRestoreDiagnostics.set(entityId, diagnostic);
    if (warn && (previous?.state !== state || previous.reason !== reason)) {
      console.warn({
        scope: 'webgal.attachment.runtime',
        code: 'ATTACHMENT_FREE_RESTORE_PENDING',
        ...diagnostic,
      });
    }
  }

  public getFreeRestoreDiagnostics(): FreeAttachmentRestoreDiagnostic[] {
    return [...this.freeRestoreDiagnostics.values()].map((diagnostic) => ({
      ...diagnostic,
      liveFigureKeys: [...diagnostic.liveFigureKeys],
    }));
  }

  public upsert(declarationInput: AttachmentDeclaration): Promise<AttachmentInstanceSnapshot> {
    this.assertAlive();
    const declaration = cloneDeclaration(declarationInput);
    this.assertGlobalEntityIdAvailable(declaration, true);
    let desiredById = this.desired.get(declaration.figureKey);
    if (!desiredById) this.desired.set(declaration.figureKey, (desiredById = new Map()));
    this.assertSlotAvailable(desiredById, declaration);
    desiredById.set(declaration.attachmentId, declaration);

    const record = this.figures.get(declaration.figureKey);
    if (!record) {
      return Promise.resolve({
        figureKey: declaration.figureKey,
        figureGeneration: '',
        attachmentId: declaration.attachmentId,
        configId: declaration.configId,
        slot: declaration.slot,
        visible: declaration.visible,
        phase: 'loading',
        firstValidPose: { status: 'pending' },
      });
    }
    return this.upsertLoaded(record, declaration);
  }

  /**
   * Semantic route with a fail-closed preflight. The selected v2 preset is
   * resolved and compared before desired rows, instances, textures, drivers,
   * proxies, or external targets can be mutated.
   */
  public async upsertSemantic(
    declarationInput: AttachmentDeclaration,
    semanticBinding: SemanticRuntimeBinding,
  ): Promise<AttachmentInstanceSnapshot> {
    await this.assertSemanticBinding(declarationInput, semanticBinding);
    return this.upsert({ ...declarationInput, semanticBinding });
  }

  /** Read-only config/profile comparison; it intentionally owns no runtime state. */
  public async assertSemanticBinding(
    declarationInput: AttachmentDeclaration,
    semanticBinding: SemanticRuntimeBinding,
  ): Promise<void> {
    this.assertAlive();
    const declaration = cloneDeclaration({ ...declarationInput, semanticBinding });
    const loaded = await this.configLoader.load(
      declaration.configId,
      this.figures.get(declaration.figureKey)?.target.sourcePath,
      declaration.modelProfileId,
      declaration.semanticAnchor,
    );
    assertSemanticRuntimeBinding(loaded.modelBinding, semanticBinding, declaration.configId);
  }

  public setVisible(figureKey: string, attachmentId: string, visible: boolean) {
    for (const claim of this.previewClaims.values()) {
      if (claim.figureKey === figureKey && claim.attachmentId === attachmentId && claim.declaration)
        claim.declaration.visible = visible;
    }
    const desired = this.desired.get(figureKey)?.get(attachmentId);
    if (desired) desired.visible = visible;

    const instance = this.figures.get(figureKey)?.instances.get(attachmentId);
    if (!instance) return false;
    instance.declaration.visible = visible;
    instance.snapshot.visible = visible;
    instance.controller?.setVisible(visible);
    this.emitInstance(instance);
    return true;
  }

  public remove(figureKey: string, attachmentId: string) {
    for (const [owner, claim] of this.previewClaims) {
      if (claim.figureKey === figureKey && claim.attachmentId === attachmentId) this.previewClaims.delete(owner);
    }
    const desired = this.desired.get(figureKey);
    desired?.delete(attachmentId);
    if (desired?.size === 0) this.desired.delete(figureKey);

    const record = this.figures.get(figureKey);
    return record ? this.removeLoaded(record, attachmentId) : false;
  }

  public setEntityVisible(entityId: string, visible: boolean) {
    const entity = this.entities.get(entityId);
    if (!entity) return false;
    this.cancelEntityVisibilityTransition(entityId, false);
    entity.instance.declaration.visible = visible;
    entity.instance.snapshot.visible = visible;
    entity.instance.controller?.setVisible(visible);
    this.emitInstance(entity.instance);
    return true;
  }

  /** Starts a non-serializable visibility-factor transition. */
  public beginEntityVisibilityTransition(
    entityId: string,
    visible: boolean,
    duration: number,
    ease = '',
    onComplete?: () => void,
  ) {
    const entity = this.entities.get(entityId);
    const controller = entity?.instance.controller;
    if (!entity || !controller || duration <= 0) return false;
    this.cancelEntityVisibilityTransition(entityId, false);
    const token = Symbol(`visibility-${visible ? 'show' : 'hide'}`);
    controller.beginVisibilityTransition();
    const transition = {
      token,
      targetVisible: visible,
      controls: { stop() {} } as AttachmentVisibilityTransitionControls,
    };
    entity.visibilityTransition = transition;
    const controls = startAttachmentVisibilityTransition({
      from: controller.getVisibilityFactor(),
      to: visible ? 1 : 0,
      duration,
      ease,
      onUpdate: (factor) => {
        if (entity.visibilityTransition?.token !== token) return;
        controller.setVisibilityFactor(factor);
      },
      onComplete: () => {
        if (entity.visibilityTransition?.token !== token) return;
        entity.visibilityTransition = undefined;
        controller.setVisible(visible);
        onComplete?.();
      },
    });
    if (entity.visibilityTransition?.token === token) entity.visibilityTransition.controls = controls;
    else controls.stop();
    return true;
  }

  public cancelEntityVisibilityTransition(entityId: string, settleToDeclared = true) {
    const entity = this.entities.get(entityId);
    const transition = entity?.visibilityTransition;
    if (!entity || !transition) return false;
    entity.visibilityTransition = undefined;
    transition.controls.stop();
    if (settleToDeclared) entity.instance.controller?.setVisible(entity.instance.declaration.visible);
    return true;
  }

  public setEntityVisualState(entityId: string, state: AttachmentEntityVisualState) {
    const entity = this.entities.get(entityId);
    const host = entity?.instance.transformHost;
    if (!entity || !host) return false;
    // A free entity must remain renderable while its visibility factor fades.
    // The terminal logical visibility is already serializable, but must not
    // short-circuit the live transition by hiding its transform host early.
    applyAttachmentEntityVisualState(host, entity.visibilityTransition ? { ...state, visible: true } : state);
    this.syncDeclaredVisibility(entity.instance, state.visible);
    if (entity.state === 'attached') {
      entity.lastAttachedLocalState = cloneAttachmentEntityVisualState({
        ...state,
        space: 'local',
      });
    }
    return true;
  }

  public removeEntity(entityId: string) {
    for (const [owner, claim] of this.previewClaims) {
      if (claim.entityId === entityId) this.previewClaims.delete(owner);
    }
    const removedPendingFreeDeclaration = this.desiredFree.delete(entityId);
    this.pendingFreeRestores.delete(entityId);
    this.freeRestoreDiagnostics.delete(entityId);
    const entity = this.entities.get(entityId);
    if (!entity) return removedPendingFreeDeclaration;
    const attachedRecord = entity.attachedRecord;
    const preparedRecord = entity.preparedReattach ? this.figures.get(entity.preparedReattach.figureKey) : undefined;
    entity.operationRevision += 1;
    this.removeDesiredDeclaration(entity.instance.declaration.figureKey, entity.attachmentId, entity.entityId);
    if (attachedRecord) attachedRecord.instances.delete(entity.attachmentId);
    this.destroyEntity(entity, true);
    const cleanupFailures: Array<{ step: string; error: unknown }> = [];
    if (attachedRecord) {
      this.runTerminalCleanupStep(cleanupFailures, 'stop-attached-presentation', () => {
        this.stopPresentationIfIdle(attachedRecord);
      });
    }
    if (preparedRecord && preparedRecord !== attachedRecord) {
      this.runTerminalCleanupStep(cleanupFailures, 'stop-prepared-presentation', () => {
        this.stopPresentationIfIdle(preparedRecord);
      });
    }
    this.reportTerminalCleanupFailures(entityId, cleanupFailures);
    return true;
  }

  public getEntity(entityId: string) {
    const entity = this.entities.get(entityId);
    if (!entity) return undefined;
    return {
      entityId,
      state: entity.state,
      originFigureKey: entity.originFigureKey,
      figureKey: entity.instance.declaration.figureKey,
      figureGeneration: entity.instance.snapshot.figureGeneration,
      attachmentId: entity.attachmentId,
      visible: entity.instance.snapshot.visible,
      proxyIdentityTokens: entity.instance.controller?.getProxyIdentityTokens(),
      representation: entity.instance.controller?.getRepresentationKind(),
      hasConfiguredFreeRenderable: entity.instance.controller?.hasConfiguredFreeRenderable() ?? false,
      visualState: entity.instance.transformHost
        ? readAttachmentEntityVisualState(
            entity.instance.transformHost,
            entity.state === 'attached' ? 'local' : 'world',
          )
        : undefined,
      hostFilterInstanceCount: entity.instance.transformHost?.containerFilters.size ?? 0,
      proxyFilterInstanceCount: entity.instance.controller?.getOwnedFilterInstanceCount() ?? 0,
      visualSyncDiagnostics: entity.instance.controller?.getVisualSyncDiagnostics(),
    };
  }

  private detachWaitError(entityId: string, reason: string) {
    return new StageEntityOperationError(
      'ENTITY_TRANSITION_TARGET_LOST',
      `Detach materialization wait ${reason}: ${entityId}`,
      { details: { entityId, operation: 'detach-ready' } },
    );
  }

  /** Wait only for this committed declaration, never for unrelated bridge loads. */
  private waitForDetachMaterialization(entityId: string, signal?: AbortSignal): Promise<void> {
    const desired = [...this.desired.values()]
      .flatMap((byId) => [...byId.values()])
      .find((declaration) => declaration.entityId === entityId);
    if (!desired)
      return Promise.reject(new StageEntityOperationError('ENTITY_NOT_FOUND', `Stage entity not found: ${entityId}`));
    const { figureKey, attachmentId } = desired;
    const identity = (declaration: AttachmentDeclaration) =>
      JSON.stringify([
        declaration.entityId,
        declaration.configId,
        declaration.modelProfileId,
        declaration.slot,
        declaration.semanticAnchor,
        declaration.semanticBinding,
      ]);
    const expectedIdentity = identity(desired);
    let record = this.figures.get(figureKey);
    let instance = record?.instances.get(attachmentId);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        this.detachMaterializationWaits.delete(abort);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(this.detachWaitError(entityId, 'cancelled'));
      const probe = () => {
        if (signal?.aborted) return abort();
        const currentDesired = this.desired.get(figureKey)?.get(attachmentId);
        const currentRecord = this.figures.get(figureKey);
        const currentInstance = currentRecord?.instances.get(attachmentId);
        if (
          this.destroyed ||
          !currentDesired ||
          identity(currentDesired) !== expectedIdentity ||
          (record && currentRecord !== record) ||
          (instance && currentInstance !== instance)
        ) {
          return finish(this.detachWaitError(entityId, 'lost its declaration/instance/generation'));
        }
        record ??= currentRecord;
        instance ??= currentInstance;
        if (instance?.snapshot.phase === 'error') {
          return finish(
            new StageEntityOperationError(
              'STAGE_ENTITY_OPERATION_FAILED',
              instance.snapshot.error ?? `Attachment failed before detach: ${entityId}`,
              { details: { entityId, sourceErrorCode: instance.snapshot.errorCode, operation: 'detach-ready' } },
            ),
          );
        }
        const entity = this.entities.get(entityId);
        if (
          entity &&
          entity.instance === instance &&
          entity.state === 'attached' &&
          instance?.snapshot.phase === 'ready'
        )
          finish();
      };
      unsubscribe = this.subscribe(probe);
      this.detachMaterializationWaits.add(abort);
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () =>
          finish(
            new StageEntityOperationError(
              'ENTITY_PARENT_LOADING_TIMEOUT',
              `Attachment did not materialize within ${this.frameOperationTimeoutMs} ms: ${entityId}`,
            ),
          ),
        this.frameOperationTimeoutMs,
      );
      probe();
    });
  }

  public requestDetach(
    entityId: string,
    finalizeState?: (result: Readonly<AttachmentEntityDetachResult>) => boolean,
    signal?: AbortSignal,
  ): Promise<AttachmentEntityDetachResult> {
    this.assertAlive();
    if (signal?.aborted) return Promise.reject(this.detachWaitError(entityId, 'cancelled'));
    if (!this.entities.has(entityId)) {
      return this.waitForDetachMaterialization(entityId, signal).then(() =>
        this.requestDetach(entityId, finalizeState, signal),
      );
    }
    const entity = this.requireEntity(entityId, 'attached');
    const record = entity.attachedRecord;
    const controller = entity.instance.controller;
    if (!record || !controller || !record.layers || !record.driver || !record.target.stage) {
      return Promise.reject(
        new StageEntityOperationError(
          'ENTITY_PARENT_LOADING_TIMEOUT',
          `Stage entity ${entityId} is not ready for detach`,
          {
            details: {
              entityId,
              operation: 'detach',
              figureKey: record?.target.key ?? entity.instance.declaration.figureKey,
              figureGeneration: record?.target.generation,
            },
          },
        ),
      );
    }
    const stage = record.target.stage;
    const revision = ++entity.operationRevision;
    let lastReadiness: AttachmentDetachFrameReadiness | undefined;
    return this.queueFrameOperation(
      record,
      entityId,
      async () => {
        // The frame consumer runs from Live2DFigureContainer's active render
        // hook. Reparenting the proxies or inserting their free transform host
        // before that traversal returns exposes a transient origin-space frame
        // to Pixi. Preserve the freshly published pose, but move the tree only
        // after the current render stack has unwound.
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        this.assertEntityOperation(entity, revision, 'attached', record);
        stage.figureContainer.updateTransform();
        record.target.container.updateTransform();
        record.layers!.back.updateTransform();
        record.layers!.front.updateTransform();
        const attachedLocalState = cloneAttachmentEntityVisualState(
          readAttachmentEntityVisualState(controller.getTransformHost(), 'local'),
        );
        // Read the host contract before mutating the render tree.
        const layoutContainer = record.target.container as typeof record.target.container & {
          getBasePosition?: () => { x: number; y: number };
        };
        const layoutOrigin = layoutContainer.getBasePosition?.() ?? { x: 0, y: 0 };
        let transition;
        try {
          transition = controller.detachToFree(stage.figureContainer);
        } catch (error) {
          throw toStageEntityOperationError(error, 'ENTITY_REPARENT_ATOMIC_ROLLBACK', {
            entityId,
            operation: 'detach',
            figureKey: record.target.key,
            figureGeneration: record.target.generation,
          });
        }
        const result: AttachmentEntityDetachResult = {
          freePositionOrigin: { x: layoutOrigin.x, y: layoutOrigin.y },
          entityId,
          figureKey: record.target.key,
          attachmentId: entity.attachmentId,
          visualState: cloneAttachmentEntityVisualState(transition.visualState),
          evidence: {
            entityId,
            figureKey: record.target.key,
            figureGeneration: record.target.generation,
            proxyIdentityTokens: transition.proxyIdentityTokens,
            representation: transition.representation,
            maxMatrixDelta: transition.reparent.maxMatrixDelta,
            maxWorldAlphaDelta: transition.reparent.maxWorldAlphaDelta,
            presentation: transition.presentation,
            capturedAt: performance.now(),
          },
        };
        try {
          if (finalizeState && !finalizeState(result)) {
            throw new StageEntityOperationError(
              'ENTITY_TRANSITION_TARGET_LOST',
              `Detach state finalizer rejected stage entity ${entityId}`,
              {
                details: {
                  entityId,
                  operation: 'detach-finalize',
                  figureKey: record.target.key,
                  figureGeneration: record.target.generation,
                },
              },
            );
          }
        } catch (error) {
          try {
            controller.reattachFromFree(record.target.model, record.layers!, attachedLocalState, undefined, record.target.app.renderer as PIXI.Renderer);
          } catch (rollbackError) {
            throw new StageEntityOperationError(
              'ENTITY_REPARENT_ATOMIC_ROLLBACK',
              `Detach state finalizer rollback failed for ${entityId}`,
              {
                cause: rollbackError,
                details: {
                  entityId,
                  operation: 'detach-finalize-rollback',
                  figureKey: record.target.key,
                  figureGeneration: record.target.generation,
                  finalizeError: error instanceof Error ? error.message : String(error),
                },
              },
            );
          }
          throw toStageEntityOperationError(error, 'ENTITY_TRANSITION_TARGET_LOST', {
            entityId,
            operation: 'detach-finalize',
            figureKey: record.target.key,
            figureGeneration: record.target.generation,
          });
        }
        // Commit runtime ownership only after the two-proxy reparent transaction
        // and its synchronous serializable-state finalizer have succeeded. A
        // rejection compensates the presentation before any runtime map moves.
        entity.lastAttachedLocalState = attachedLocalState;
        record.instances.delete(entity.attachmentId);
        this.removeDesiredDeclaration(record.target.key, entity.attachmentId, entity.entityId);
        entity.state = 'free';
        entity.attachedRecord = undefined;
        entity.instance.snapshot.figureGeneration = record.target.generation;
        entity.preparedReattach = undefined;
        controller.releaseFreeInheritedPresentation();
        setTimeout(() => this.stopPresentationIfIdle(record), 0);
        return result;
      },
      {
        validate: () => this.assertEntityOperation(entity, revision, 'attached', record),
        readiness: () => {
          lastReadiness = controller.getDetachFrameReadiness(stage.figureContainer);
          return { ready: lastReadiness.ready, details: lastReadiness };
        },
        timeoutError: () =>
          new StageEntityOperationError(
            'ENTITY_ANCHOR_FRAME_UNAVAILABLE',
            `Timed out waiting for a valid detach frame: ${entityId}`,
            {
              details: {
                entityId,
                operation: 'detach',
                figureKey: record.target.key,
                figureGeneration: record.target.generation,
                reason: lastReadiness?.reason ?? 'no-current-frame',
                readiness: lastReadiness,
              },
            },
          ),
      },
    );
  }

  public async prepareReattach(
    entityId: string,
    figureKey: string,
    attachedLocalState?: AttachmentEntityVisualState,
    semanticAnchor?: string,
    modelProfileId?: string,
  ): Promise<AttachmentEntityReattachTarget> {
    this.assertAlive();
    const entity = this.requireEntity(entityId, 'free');
    const record = this.figures.get(figureKey);
    const originalController = entity.instance.controller;
    if (!record || !originalController || !record.target.stage) {
      throw new StageEntityOperationError(
        'ENTITY_REATTACH_PARENT_NOT_READY',
        `Reattach target ${figureKey} is not ready`,
        { details: { entityId, operation: 'reattach-prepare', figureKey } },
      );
    }
    const stage = record.target.stage;
    if (entity.stage !== stage) {
      throw new StageEntityOperationError(
        'ENTITY_SPACE_OVERRIDE_UNSUPPORTED',
        'Reattach across Pixi stage instances is not supported',
        {
          details: {
            entityId,
            operation: 'reattach-prepare',
            figureKey,
            figureGeneration: record.target.generation,
          },
        },
      );
    }
    this.clearPreparedReattach(entity);
    this.assertReattachTargetAvailable(entity, record);
    const resolvedAttachedLocalState = cloneAttachmentEntityVisualState(
      attachedLocalState ?? entity.lastAttachedLocalState,
    );
    const revision = ++entity.operationRevision;
    const token = `${entityId}:${record.target.generation}:${revision}`;
    const originModelPath =
      entity.instance.modelBinding?.modelPath ?? this.figures.get(entity.originFigureKey)?.target.sourcePath;
    const currentModelProfileId =
      entity.instance.declaration.modelProfileId ?? entity.instance.modelBinding?.modelProfileId;
    const sameModelPath =
      Boolean(originModelPath) &&
      normalizeGameAssetPath(originModelPath!) === normalizeGameAssetPath(record.target.sourcePath);
    if (
      sameModelPath &&
      originalController.hasAttachedModelReference() &&
      (!modelProfileId || modelProfileId === currentModelProfileId) &&
      (!semanticAnchor || attachmentSemanticAnchorMatchesPreset(semanticAnchor, entity.instance.modelBinding?.anchorName ?? ''))
    ) {
      // Preserve the established synchronous queueing contract for another
      // figure/generation of the exact same model. No adaptation can change in
      // this branch, so the existing controller remains authoritative.
      assertRequestedSemanticAnchor(entity.instance.modelBinding, semanticAnchor, entity.instance.declaration.configId);
      const layers = this.ensurePresentation(record);
      return this.queueFrameOperation(record, entityId, () => {
        this.assertEntityOperation(entity, revision, 'free');
        if (this.figures.get(figureKey) !== record) {
          throw new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach target generation changed', {
            details: { entityId, operation: 'reattach-prepare', figureKey, figureGeneration: record.target.generation },
          });
        }
        this.assertReattachTargetAvailable(entity, record);
        stage.figureContainer.updateTransform();
        record.target.container.updateTransform();
        layers.back.updateTransform();
        layers.front.updateTransform();
        const targetVisualState = originalController.measureAttachedTarget(
          record.target.model,
          layers,
          stage.figureContainer,
          resolvedAttachedLocalState,
        );
        entity.preparedReattach = {
          token,
          figureKey,
          figureGeneration: record.target.generation,
          attachedLocalState: resolvedAttachedLocalState,
          ...(semanticAnchor ? { requestedSemanticAnchor: semanticAnchor } : {}),
          ...(currentModelProfileId ? { modelProfileId: currentModelProfileId } : {}),
        };
        return {
          token,
          entityId,
          figureKey,
          figureGeneration: record.target.generation,
          targetVisualState: cloneAttachmentEntityVisualState(targetVisualState),
          ...(currentModelProfileId ? { modelProfileId: currentModelProfileId } : {}),
        };
      }).catch((error: unknown) => {
        if (entity.preparedReattach?.token === token) this.clearPreparedReattach(entity, token);
        this.stopPresentationIfIdle(record);
        throw error;
      });
    }
    let candidate: NonNullable<RuntimeEntityRecord['preparedReattach']>['candidate'];
    try {
      // Resolve the preset against the destination model before touching the
      // live free representation. A layered v2 config can select a different
      // model profile, drawable, fingerprint and placement for the same stable
      // config ID; reusing the origin controller would silently retain all of
      // those origin-model facts.
      const loaded = await this.configLoader.load(
        entity.instance.declaration.configId,
        record.target.sourcePath,
        modelProfileId,
        semanticAnchor,
      );
      this.assertEntityOperation(entity, revision, 'free');
      if (this.figures.get(figureKey) !== record) {
        throw new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach target generation changed', {
          details: { entityId, operation: 'reattach-prepare', figureKey, figureGeneration: record.target.generation },
        });
      }
      if (!loaded.modelBinding && normalizeGameAssetPath(record.target.sourcePath) !== loaded.config.target.modelPath) {
        throw new AttachmentRuntimeFailure(
          'MODEL_INCOMPATIBLE',
          `Attachment ${entity.instance.declaration.configId} targets ${
            loaded.config.target.modelPath
          }, not ${normalizeGameAssetPath(record.target.sourcePath)}`,
        );
      }
      if (loaded.modelBinding) {
        const internalModel = record.target.model.internalModel;
        assertAttachmentModelBinding(
          loaded.modelBinding,
          {
            modelPath: record.target.sourcePath,
            drawableCount:
              typeof internalModel.getDrawableIDs === 'function' ? internalModel.getDrawableIDs().length : undefined,
            getDrawableVertexCount: (drawableId) => {
              const drawableIndex = internalModel.getDrawableIndex(drawableId);
              if (drawableIndex < 0) return undefined;
              const vertexCount = internalModel.getDrawableVertices(drawableIndex).length / 2;
              return Number.isInteger(vertexCount) && vertexCount > 0 ? vertexCount : undefined;
            },
          },
          loaded.sourceUrl,
        );
      }
      if (entity.instance.declaration.semanticBinding) {
        // A semantic runtime binding contains an exact model profile identity.
        // Reattaching it to another profile without a newly resolved semantic
        // profile would fabricate evidence, so keep this route fail closed.
        assertSemanticRuntimeBinding(
          loaded.modelBinding,
          entity.instance.declaration.semanticBinding,
          entity.instance.declaration.configId,
        );
      }
      assertRequestedSemanticAnchor(loaded.modelBinding, semanticAnchor, entity.instance.declaration.configId);
      this.assertReattachTargetAvailable(entity, record);

      const layers = this.ensurePresentation(record);
      if (!sameResolvedModelBinding(entity.instance.modelBinding, loaded.modelBinding)) {
        const textures = await this.loadTextures(
          loaded.config.attachedLayers ?? loaded.config.layers,
          loaded.config.freeRenderable,
        );
        this.assertEntityOperation(entity, revision, 'free');
        if (this.figures.get(figureKey) !== record) {
          throw new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach target generation changed', {
            details: {
              entityId,
              operation: 'reattach-candidate',
              figureKey,
              figureGeneration: record.target.generation,
            },
          });
        }
        const transformHost = entity.instance.transformHost;
        if (!transformHost) {
          throw new StageEntityOperationError(
            'ENTITY_TRANSITION_TARGET_LOST',
            `Stage entity ${entityId} has no transform host for reattach`,
            { details: { entityId, operation: 'reattach-candidate', figureKey } },
          );
        }
        const freeVisualState = {
          ...cloneAttachmentEntityVisualState(readAttachmentEntityVisualState(transformHost, 'world')),
          space: 'world' as const,
        };
        let candidateController: HatAttachmentController;
        candidateController = new HatAttachmentController({
          renderer: record.target.app.renderer as PIXI.Renderer,
          instanceId: `${encodeURIComponent(record.target.key)}_${encodeURIComponent(
            entity.attachmentId,
          )}_reattach_${revision}`,
          model: record.target.model,
          layers,
          config: loaded.config,
          // Keep the candidate visually empty while it shares the stable free
          // transform host with the origin controller. The real textures are
          // published only after the serializable state finalizer succeeds.
          textures,
          transformHost,
          onError: (error) => {
            if (
              entity.instance.controller !== candidateController ||
              record.instances.get(entity.attachmentId) !== entity.instance
            )
              return;
            this.failControllerTerminally(record, entity.instance, candidateController, error);
          },
        });
        candidateController.setCalibrationTextures({
          ...(textures.back ? { back: PIXI.Texture.EMPTY } : {}),
          ...(textures.front ? { front: PIXI.Texture.EMPTY } : {}),
          ...(textures.full ? { full: PIXI.Texture.EMPTY } : {}),
        });
        candidateController.restoreFree(stage.figureContainer, freeVisualState);
        candidateController.releaseFreeInheritedPresentation();
        candidate = {
          controller: candidateController,
          modelBinding: loaded.modelBinding,
          freeVisualState,
        };
      }

      const controller = candidate?.controller ?? originalController;
      return await this.queueFrameOperation(record, entityId, () => {
        this.assertEntityOperation(entity, revision, 'free');
        if (this.figures.get(figureKey) !== record) {
          throw new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach target generation changed', {
            details: {
              entityId,
              operation: 'reattach-prepare',
              figureKey,
              figureGeneration: record.target.generation,
            },
          });
        }
        this.assertReattachTargetAvailable(entity, record);
        stage.figureContainer.updateTransform();
        record.target.container.updateTransform();
        layers.back.updateTransform();
        layers.front.updateTransform();
        const targetVisualState = controller.measureAttachedTarget(
          record.target.model,
          layers,
          stage.figureContainer,
          resolvedAttachedLocalState,
        );
        entity.preparedReattach = {
          token,
          figureKey,
          figureGeneration: record.target.generation,
          attachedLocalState: resolvedAttachedLocalState,
          ...(semanticAnchor ? { requestedSemanticAnchor: semanticAnchor } : {}),
          ...(loaded.modelBinding?.modelProfileId ? { modelProfileId: loaded.modelBinding.modelProfileId } : {}),
          ...(candidate ? { candidate } : {}),
        };
        return {
          token,
          entityId,
          figureKey,
          figureGeneration: record.target.generation,
          targetVisualState: cloneAttachmentEntityVisualState(targetVisualState),
          ...(loaded.modelBinding?.modelProfileId ? { modelProfileId: loaded.modelBinding.modelProfileId } : {}),
        };
      });
    } catch (error) {
      if (entity.preparedReattach?.token === token) this.clearPreparedReattach(entity, token);
      else if (candidate) this.disposeReattachCandidate(entity, candidate);
      this.stopPresentationIfIdle(record);
      throw error;
    }
  }

  /** Animation time is external; only the final Live2D frame may choose the moving world target. */
  public setReattachFlightProgress(token: string, progress: number) {
    const entity = [...this.entities.values()].find((candidate) => candidate.preparedReattach?.token === token);
    if (!entity || entity.state !== 'free' || !entity.instance.transformHost || !Number.isFinite(progress)) {
      throw new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach flight token is stale');
    }
    const prepared = entity.preparedReattach!;
    if (prepared.flight?.error) throw prepared.flight.error;
    prepared.flight ??= { from: readAttachmentEntityVisualState(entity.instance.transformHost, 'world'), progress: 0 };
    prepared.flight.progress = progress;
  }

  private applyReattachFlight(entity: RuntimeEntityRecord, record: FigureRecord) {
    const prepared = entity.preparedReattach;
    if (!prepared?.flight) return;
    if (prepared.flight.error) throw prepared.flight.error;
    if (
      entity.state !== 'free' ||
      prepared.figureGeneration !== record.target.generation ||
      this.figures.get(record.target.key) !== record
    ) {
      throw new StageEntityOperationError(
        'ENTITY_TRANSITION_TARGET_LOST',
        'Reattach flight lost its figure generation',
      );
    }
    this.assertReattachTargetAvailable(entity, record);
    const controller = prepared.candidate?.controller ?? entity.instance.controller!;
    const layers = this.ensurePresentation(record);
    record.target.stage!.figureContainer.updateTransform();
    record.target.container.updateTransform();
    layers.back.updateTransform();
    layers.front.updateTransform();
    const target = controller.measureAttachedTarget(
      record.target.model,
      layers,
      record.target.stage!.figureContainer,
      prepared.attachedLocalState,
    );
    const { from, progress } = prepared.flight;
    const mix = (a: number, b: number) => a + (b - a) * progress;
    const current = readAttachmentEntityVisualState(entity.instance.transformHost!, 'world');
    applyAttachmentEntityVisualState(entity.instance.transformHost!, {
      ...current,
      position: { x: mix(from.position.x, target.position.x), y: mix(from.position.y, target.position.y) },
      scale: { x: mix(from.scale.x, target.scale.x), y: mix(from.scale.y, target.scale.y) },
      rotation: mix(from.rotation, target.rotation),
      skew: { x: mix(from.skew?.x ?? 0, target.skew?.x ?? 0), y: mix(from.skew?.y ?? 0, target.skew?.y ?? 0) },
      opacity: Math.max(0, Math.min(1, mix(from.opacity, target.opacity))),
    });
    // Both visible proxies inherit this exact host sample during the same render.
    entity.instance.controller?.syncVisualStateForRender();
  }

  public commitReattach(
    token: string,
    finalizeState?: (result: Readonly<AttachmentEntityReattachResult>) => boolean,
  ): Promise<AttachmentEntityReattachResult> {
    this.assertAlive();
    const entity = [...this.entities.values()].find((item) => item.preparedReattach?.token === token);
    if (!entity || entity.state !== 'free' || !entity.preparedReattach) {
      return Promise.reject(
        new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach token is stale or missing', {
          details: { operation: 'reattach-commit', token },
        }),
      );
    }
    const prepared = entity.preparedReattach;
    const record = this.figures.get(prepared.figureKey);
    const originalController = entity.instance.controller;
    const controller = prepared.candidate?.controller ?? originalController;
    if (!record || record.target.generation !== prepared.figureGeneration || !controller || !record.target.stage) {
      this.clearPreparedReattach(entity, token);
      return Promise.reject(
        new StageEntityOperationError(
          'ENTITY_TRANSITION_TARGET_LOST',
          'Reattach target generation is no longer ready',
          {
            details: {
              entityId: entity.entityId,
              operation: 'reattach-commit',
              figureKey: prepared.figureKey,
              figureGeneration: prepared.figureGeneration,
              token,
            },
          },
        ),
      );
    }
    const revision = entity.operationRevision;
    const layers = this.ensurePresentation(record);
    const stage = record.target.stage;
    return this.queueFrameOperation(record, entity.entityId, () => {
      this.assertEntityOperation(entity, revision, 'free');
      if (entity.preparedReattach?.token !== token) {
        throw new StageEntityOperationError('ENTITY_TRANSITION_TARGET_LOST', 'Reattach token was superseded', {
          details: {
            entityId: entity.entityId,
            operation: 'reattach-commit',
            figureKey: record.target.key,
            figureGeneration: record.target.generation,
            token,
          },
        });
      }
      // Availability can change while the shared return-flight transition is
      // running. Revalidate inside the frame transaction before moving either
      // proxy so a late composite/slot claimant cannot be overwritten.
      this.assertReattachTargetAvailable(entity, record);
      stage.figureContainer.updateTransform();
      record.target.container.updateTransform();
      layers.back.updateTransform();
      layers.front.updateTransform();
      let transition;
      try {
        if (prepared.flight) {
          prepared.flight.progress = 1;
          this.applyReattachFlight(entity, record);
        }
        transition = controller.reattachFromFree(record.target.model, layers, prepared.attachedLocalState, undefined, record.target.app.renderer as PIXI.Renderer);
      } catch (error) {
        throw toStageEntityOperationError(error, 'ENTITY_REPARENT_ATOMIC_ROLLBACK', {
          entityId: entity.entityId,
          operation: 'reattach-commit',
          figureKey: record.target.key,
          figureGeneration: record.target.generation,
          token,
        });
      }
      const result: AttachmentEntityReattachResult = {
        entityId: entity.entityId,
        figureKey: record.target.key,
        attachmentId: entity.attachmentId,
        visualState: cloneAttachmentEntityVisualState(transition.visualState),
        ...(prepared.modelProfileId ? { modelProfileId: prepared.modelProfileId } : {}),
        evidence: {
          entityId: entity.entityId,
          figureKey: record.target.key,
          figureGeneration: record.target.generation,
          proxyIdentityTokens: transition.proxyIdentityTokens,
          representation: transition.representation,
          maxMatrixDelta: transition.reparent.maxMatrixDelta,
          maxWorldAlphaDelta: transition.reparent.maxWorldAlphaDelta,
          presentation: transition.presentation,
          capturedAt: performance.now(),
        },
      };
      try {
        if (finalizeState && !finalizeState(result)) {
          throw new StageEntityOperationError(
            'ENTITY_TRANSITION_TARGET_LOST',
            `Reattach state finalizer rejected stage entity ${entity.entityId}`,
            {
              details: {
                entityId: entity.entityId,
                operation: 'reattach-finalize',
                figureKey: record.target.key,
                figureGeneration: record.target.generation,
                token,
              },
            },
          );
        }
      } catch (error) {
        try {
          controller.detachToFree(stage.figureContainer);
        } catch (rollbackError) {
          throw new StageEntityOperationError(
            'ENTITY_REPARENT_ATOMIC_ROLLBACK',
            `Reattach state finalizer rollback failed for ${entity.entityId}`,
            {
              cause: rollbackError,
              details: {
                entityId: entity.entityId,
                operation: 'reattach-finalize-rollback',
                figureKey: record.target.key,
                figureGeneration: record.target.generation,
                token,
                finalizeError: error instanceof Error ? error.message : String(error),
              },
            },
          );
        }
        throw toStageEntityOperationError(error, 'ENTITY_TRANSITION_TARGET_LOST', {
          entityId: entity.entityId,
          operation: 'reattach-finalize',
          figureKey: record.target.key,
          figureGeneration: record.target.generation,
          token,
        });
      }
      entity.state = 'attached';
      entity.attachedRecord = record;
      if (prepared.candidate) {
        // Publish the destination adaptation only after both the Pixi reparent
        // and serializable state transaction have succeeded. Until this point
        // the origin controller remains the sole visible free representation.
        prepared.candidate.controller.setCalibrationTextures(undefined);
        originalController?.destroy();
        entity.instance.controller = prepared.candidate.controller;
        entity.instance.modelBinding = prepared.candidate.modelBinding;
        entity.instance.snapshot.modelBinding = cloneModelBinding(prepared.candidate.modelBinding);
      }
      if (prepared.requestedSemanticAnchor) {
        entity.instance.declaration.semanticAnchor = prepared.requestedSemanticAnchor;
      }
      entity.instance.declaration.modelProfileId = prepared.modelProfileId;
      entity.instance.snapshot.modelProfileId = prepared.modelProfileId;
      entity.preparedReattach = undefined;
      entity.instance.declaration.figureKey = record.target.key;
      entity.instance.snapshot.figureKey = record.target.key;
      entity.instance.snapshot.figureGeneration = record.target.generation;
      entity.instance.snapshot.firstValidPose = { status: 'pending' };
      record.instances.set(entity.attachmentId, entity.instance);
      return result;
    }).catch((error: unknown) => {
      if (entity.preparedReattach?.token === token) this.clearPreparedReattach(entity, token);
      this.stopPresentationIfIdle(record);
      throw error;
    });
  }

  public cancelEntityOperation(entityId: string) {
    const entity = this.entities.get(entityId);
    if (!entity) return false;
    const preparedRecord = entity.preparedReattach ? this.figures.get(entity.preparedReattach.figureKey) : undefined;
    entity.operationRevision += 1;
    this.clearPreparedReattach(entity);
    this.rejectPendingEntityOperations(
      entityId,
      new StageEntityOperationError(
        'ENTITY_TRANSITION_TARGET_LOST',
        `Stage entity operation was cancelled: ${entityId}`,
        { details: { entityId, operation: 'cancel' } },
      ),
    );
    if (preparedRecord) this.stopPresentationIfIdle(preparedRecord);
    return true;
  }

  public get(figureKey: string, attachmentId: string) {
    const snapshot = this.figures.get(figureKey)?.instances.get(attachmentId)?.snapshot;
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  public getHandStateDiagnostic(figureKey: string, attachmentId: string) {
    return this.figures.get(figureKey)?.instances.get(attachmentId)?.controller?.getHandStateDiagnostic() ?? 'disabled';
  }
  public getHandAxisPreview(figureKey:string,attachmentId:string){return this.figures.get(figureKey)?.instances.get(attachmentId)?.controller?.getHandAxisPreview()??[];}

  public getHandStateDetails(figureKey: string, attachmentId: string) {
    return this.figures.get(figureKey)?.instances.get(attachmentId)?.controller?.getHandStateDetails();
  }

  public getHandRenderDiagnostics(figureKey: string, checkGL = false) {
    const target = this.figures.get(figureKey)?.target;
    return target ? readCubism2HandDiagnostics(target.model,checkGL) : undefined;
  }

  /**
   * Waits for a desired attachment to acquire its real figure/model host.
   * This closes the normal scene-script race where an attachment declaration
   * is evaluated after the figure is declared but before Live2D registration.
   */
  public waitForInstanceReady(figureKey: string, attachmentId: string, timeoutMs = 10_000) {
    const current = this.get(figureKey, attachmentId);
    if (current?.phase === 'ready') return Promise.resolve(current);
    if (current?.phase === 'error') {
      return Promise.reject(new Error(current.error ?? `Attachment failed: ${figureKey}/${attachmentId}`));
    }
    return new Promise<AttachmentInstanceSnapshot>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        operation();
      };
      const unsubscribe = this.subscribe((event) => {
        if (event.type === 'instance-changed' || event.type === 'instance-error') {
          const instance = event.instance;
          if (instance.figureKey !== figureKey || instance.attachmentId !== attachmentId) return;
          if (instance.phase === 'ready') finish(() => resolve(instance));
          else if (instance.phase === 'error') {
            finish(() => reject(new Error(instance.error ?? `Attachment failed: ${figureKey}/${attachmentId}`)));
          }
        } else if (
          event.type === 'instance-removed' &&
          event.figureKey === figureKey &&
          event.attachmentId === attachmentId
        ) {
          finish(() =>
            reject(new Error(`Attachment was removed before it became ready: ${figureKey}/${attachmentId}`)),
          );
        }
      });
      const timeout = setTimeout(() => {
        finish(() =>
          reject(new Error(`Attachment readiness timed out after ${timeoutMs} ms: ${figureKey}/${attachmentId}`)),
        );
      }, Math.max(1, timeoutMs));
    });
  }

  /**
   * Waits for pose evidence from the production frame consumer, not merely
   * config/texture/controller readiness. The exact RuntimeInstance, token and
   * figure generation present at subscription time are captured so a remove,
   * reset, re-add or replacement can never satisfy an older wait.
   *
   * A bounded wait while rendering is intentionally inapplicable (authored
   * hidden state, background document, hidden parent or zero-sized surface)
   * resolves as `deferred`; it is diagnostic state, not a runtime failure.
   */
  public waitForFirstValidPose(
    figureKey: string,
    attachmentId: string,
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<AttachmentFirstValidPoseWaitResult> {
    if (signal?.aborted) {
      return Promise.reject(
        new AttachmentFirstValidPoseWaitError(
          'ATTACHMENT_FIRST_VALID_POSE_CANCELLED',
          `First valid pose wait was cancelled: ${figureKey}/${attachmentId}`,
        ),
      );
    }
    const record = this.figures.get(figureKey);
    const instance = record?.instances.get(attachmentId);
    if (!record || !instance) {
      return Promise.reject(
        new AttachmentFirstValidPoseWaitError(
          'ATTACHMENT_FIRST_VALID_POSE_STALE',
          `Attachment instance is not available for first valid pose wait: ${figureKey}/${attachmentId}`,
        ),
      );
    }
    const generation = record.target.generation;
    const token = instance.token;
    const isCurrent = () =>
      this.figures.get(figureKey) === record &&
      record.target.generation === generation &&
      record.instances.get(attachmentId) === instance &&
      instance.token === token &&
      !record.target.model.destroyed;
    const currentResult = (): AttachmentFirstValidPoseWaitResult | undefined => {
      if (!isCurrent() || instance.snapshot.phase !== 'ready' || instance.snapshot.firstValidPose.status !== 'ready') {
        return undefined;
      }
      return { status: 'ready', instance: cloneSnapshot(instance.snapshot) };
    };
    const ready = currentResult();
    if (ready) return Promise.resolve(ready);
    if (instance.snapshot.phase === 'error') {
      return Promise.reject(
        new AttachmentFirstValidPoseWaitError(
          'ATTACHMENT_FIRST_VALID_POSE_FAILED',
          instance.snapshot.error ?? `Attachment failed before its first valid pose: ${figureKey}/${attachmentId}`,
        ),
      );
    }

    return new Promise<AttachmentFirstValidPoseWaitResult>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', abort);
        operation();
      };
      const stale = (reason: string) =>
        finish(() =>
          reject(
            new AttachmentFirstValidPoseWaitError(
              'ATTACHMENT_FIRST_VALID_POSE_STALE',
              `First valid pose wait lost its exact instance/generation: ${figureKey}/${attachmentId}; ${reason}`,
            ),
          ),
        );
      const probe = () => {
        if (!isCurrent()) return stale('instance was removed, reset, superseded or replaced');
        if (instance.snapshot.phase === 'error') {
          return finish(() =>
            reject(
              new AttachmentFirstValidPoseWaitError(
                'ATTACHMENT_FIRST_VALID_POSE_FAILED',
                instance.snapshot.error ??
                  `Attachment failed before its first valid pose: ${figureKey}/${attachmentId}`,
              ),
            ),
          );
        }
        const result = currentResult();
        if (result) finish(() => resolve(result));
      };
      const abort = () =>
        finish(() =>
          reject(
            new AttachmentFirstValidPoseWaitError(
              'ATTACHMENT_FIRST_VALID_POSE_CANCELLED',
              `First valid pose wait was cancelled: ${figureKey}/${attachmentId}`,
            ),
          ),
        );
      const unsubscribe = this.subscribe((event) => {
        if (
          (event.type === 'instance-changed' || event.type === 'instance-error') &&
          event.instance.figureKey === figureKey &&
          event.instance.attachmentId === attachmentId
        ) {
          probe();
        } else if (
          event.type === 'instance-removed' &&
          event.figureKey === figureKey &&
          event.attachmentId === attachmentId
        ) {
          stale('instance was removed');
        } else if (
          (event.type === 'figure-retiring' || event.type === 'figure-unregistered') &&
          event.figureKey === figureKey &&
          event.figureGeneration === generation
        ) {
          stale('figure generation retired');
        }
      });
      timer = setTimeout(() => {
        if (!isCurrent()) return stale('instance was no longer current at timeout');
        if (instance.snapshot.phase === 'error') return probe();
        const result = currentResult();
        if (result) return finish(() => resolve(result));
        const deferredReason = this.firstValidPoseDeferredReason(record, instance);
        const observedAt = performance.now();
        if (deferredReason) {
          instance.snapshot.firstValidPose = {
            status: 'deferred',
            reason: deferredReason,
            observedAt,
          };
          const deferred: AttachmentFirstValidPoseWaitResult = {
            status: 'deferred',
            reason: deferredReason,
            instance: cloneSnapshot(instance.snapshot),
          };
          finish(() => resolve(deferred));
          this.emitInstance(instance);
          return;
        }
        instance.snapshot.firstValidPose = {
          status: 'timed-out',
          reason: 'no-valid-frame',
          observedAt,
        };
        const stats = record.driver?.getStats();
        finish(() =>
          reject(
            new AttachmentFirstValidPoseWaitError(
              'ATTACHMENT_FIRST_VALID_POSE_TIMEOUT',
              `Attachment resources became ready but no valid pose arrived after ${timeoutMs} ms: ${figureKey}/${attachmentId}; generation=${generation}; ticks=${
                stats?.tickCount ?? 0
              }; attachmentUpdates=${stats?.attachmentUpdateCount ?? 0}; bootstrapWaits=${
                stats?.bootstrapRenderWaitCount ?? 0
              }`,
            ),
          ),
        );
        this.emitInstance(instance);
      }, Math.max(1, timeoutMs));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else probe();
    });
  }

  public list(figureKey?: string) {
    const result: AttachmentInstanceSnapshot[] = [];
    for (const [key, record] of this.figures) {
      if (figureKey !== undefined && key !== figureKey) continue;
      for (const instance of record.instances.values()) result.push(cloneSnapshot(instance.snapshot));
    }
    return result;
  }

  /** Read-only facts for calibration tools; does not expose controller/model ownership. */
  public listCalibrationTargets(): AttachmentCalibrationTarget[] {
    const result: AttachmentCalibrationTarget[] = [];
    for (const record of this.figures.values()) {
      for (const instance of record.instances.values()) {
        result.push({
          instance: cloneSnapshot(instance.snapshot),
          sourcePath: record.target.sourcePath,
          modelBinding: instance.modelBinding
            ? {
                ...instance.modelBinding,
                fingerprint: { ...instance.modelBinding.fingerprint },
                anchorVertexIndices: [...instance.modelBinding.anchorVertexIndices],
              }
            : undefined,
          preview: instance.controller?.getCalibrationPreview(),
        });
      }
    }
    return result;
  }

  /** Serializable ownership counts for multi-figure lifecycle validation. */
  public getDiagnostics(): AttachmentRuntimeDiagnostics {
    const summarize = (record: FigureRecord) => ({
      figureKey: record.target.key,
      figureGeneration: record.target.generation,
      instanceCount: record.instances.size,
      readyControllerCount: [...record.instances.values()].filter((instance) => instance.controller).length,
      hasDriver: record.driver !== undefined,
      hasLayerPair: record.layers !== undefined,
    });
    const figures = [...this.figures.values()].map(summarize);
    const retiringFigures = [...this.retiringFigures.values()].map(summarize);
    const allFigures = [...figures, ...retiringFigures];
    const frameDriverCount = allFigures.filter((figure) => figure.hasDriver).length;
    const entities = [...this.entities.values()];
    const freeEntities = entities.filter((entity) => entity.state === 'free');
    const retiringAttachmentControllerCount = retiringFigures.reduce(
      (total, figure) => total + figure.readyControllerCount,
      0,
    );
    const retiringRenderProxyCount = [...this.retiringFigures.values()].reduce(
      (total, record) =>
        total +
        [...record.instances.values()].reduce(
          (instanceTotal, instance) => instanceTotal + (instance.controller?.getProxyIdentityTokens().length ?? 0),
          0,
        ),
      0,
    );
    return {
      figureCount: figures.length,
      retiringFigureCount: retiringFigures.length,
      modelCount: allFigures.length,
      frameDriverCount,
      renderPreparationHookCount: frameDriverCount,
      ownedTickerListenerCount: frameDriverCount,
      layerPairCount: allFigures.filter((figure) => figure.hasLayerPair).length,
      attachmentControllerCount: allFigures.reduce((total, figure) => total + figure.readyControllerCount, 0),
      retiringAttachmentControllerCount,
      runtimeObserverCount: this.observers.size,
      frameObserverCount: [...this.figures.values(), ...this.retiringFigures.values()].reduce(
        (total, record) => total + record.frameObservers.size,
        0,
      ),
      textureCacheEntryCount: this.textureCache.size,
      stageEntityCount: entities.length,
      attachedEntityCount: entities.length - freeEntities.length,
      freeEntityCount: freeEntities.length,
      renderProxyCount:
        entities.reduce(
          (total, entity) => total + (entity.instance.controller?.getProxyIdentityTokens().length ?? 0),
          0,
        ) + retiringRenderProxyCount,
      retiringRenderProxyCount,
      freeHostCount: freeEntities.filter((entity) => entity.instance.transformHost?.parent).length,
      externalTransformTargetCount: entities.filter((entity) => entity.instance.transformHost).length,
      pendingFrameOperationCount:
        [...this.figures.values()].reduce((total, record) => total + record.pendingFrameOperations.length, 0) +
        this.pendingFreeRestores.size,
      pendingReattachCount: entities.filter((entity) => entity.preparedReattach).length,
      pendingDetachMaterializationCount: this.detachMaterializationWaits.size,
      filterInstanceCount: entities.reduce(
        (total, entity) =>
          total +
          (entity.instance.transformHost?.containerFilters.size ?? 0) +
          (entity.instance.controller?.getOwnedFilterInstanceCount() ?? 0),
        0,
      ),
      figures,
      retiringFigures,
    };
  }

  /** High-frequency read-only evidence used by the RC transition production route. */
  public captureTransitionTrace(phase = 'sample') {
    const diagnostics = this.getDiagnostics();
    const rows: Array<Record<string, unknown>> = [];
    const collect = (record: FigureRecord, retiring: boolean) => {
      for (const instance of record.instances.values()) {
        const visual = instance.controller?.getTransitionVisualSnapshot();
        rows.push({
          timestamp: performance.now(),
          frameNumber: record.driver?.getStats().tickCount ?? 0,
          phase,
          figureKey: record.target.key,
          figureGeneration: record.target.generation,
          figureExists: !record.target.model.destroyed,
          figureVisible: visual?.figureVisible ?? false,
          figureLocalAlpha: visual?.figureLocalAlpha ?? 0,
          figureWorldAlpha: visual?.figureWorldAlpha ?? 0,
          figureRenderable: visual?.figureRenderable ?? false,
          figureTransitionState: retiring ? 'retiring' : 'active',
          attachmentEntityId: instance.entityId,
          attachmentGeneration: instance.snapshot.figureGeneration,
          attachmentState: retiring
            ? 'retiring'
            : this.entities.get(instance.entityId)?.state ?? instance.snapshot.phase,
          attachmentLocalOpacity: visual?.attachmentLocalOpacity ?? 0,
          attachmentLogicalVisible: visual?.attachmentLogicalVisible ?? instance.snapshot.visible,
          attachmentVisibilityFactor: visual?.attachmentVisibilityFactor ?? (instance.snapshot.visible ? 1 : 0),
          firstValidPoseStatus: instance.snapshot.firstValidPose.status,
          firstValidPoseReason: instance.snapshot.firstValidPose.reason ?? '',
          firstValidPoseFrame: instance.snapshot.firstValidPose.frame ?? 0,
          backProxyExists: visual?.back.exists ?? false,
          frontProxyExists: visual?.front.exists ?? false,
          backProxyWorldAlpha: visual?.back.worldAlpha ?? 0,
          frontProxyWorldAlpha: visual?.front.worldAlpha ?? 0,
          backProxyVisible: visual?.back.visible ?? false,
          frontProxyVisible: visual?.front.visible ?? false,
          backProxyRenderable: visual?.back.renderable ?? false,
          frontProxyRenderable: visual?.front.renderable ?? false,
          renderHost: `${visual?.back.renderHost ?? ''}|${visual?.front.renderHost ?? ''}`,
          pendingAsyncCount: [...record.instances.values()].filter(
            (candidate) => candidate.snapshot.phase === 'loading',
          ).length,
          registryCount: diagnostics.stageEntityCount,
          activeFigureCount: diagnostics.figureCount,
          retiringFigureCount: diagnostics.retiringFigureCount,
          renderProxyCount: diagnostics.renderProxyCount,
        });
      }
    };
    for (const record of this.figures.values()) collect(record, false);
    for (const record of this.retiringFigures.values()) collect(record, true);
    return rows;
  }

  /** Applies an ephemeral candidate to the existing production-owned instance. */
  public previewHandCalibration(figureKey:string,attachmentId:string,binding:import('./handBinding').AttachmentHandBinding) {
    return this.figures.get(figureKey)?.instances.get(attachmentId)?.controller?.setHandCalibrationPreview(binding) ?? false;
  }

  public previewCalibration(
    figureKey: string,
    attachmentId: string,
    preview: HatAttachmentCalibrationPreview | undefined,
  ) {
    const instance = this.figures.get(figureKey)?.instances.get(attachmentId);
    return instance?.controller?.setCalibrationPreview(preview) ?? false;
  }

  /** DEV authoring seam: delegates temporary texture ownership to the existing controller. */
  public previewTextures(figureKey: string, attachmentId: string, textures: AttachmentTextureSet | undefined) {
    const instance = this.figures.get(figureKey)?.instances.get(attachmentId);
    return instance?.controller?.setCalibrationTextures(textures) ?? false;
  }

  public subscribe(observer: AttachmentRuntimeObserver) {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  /** DEV seam: observes shared runtime frames and never creates an attachment. */
  public observeFigure(figureKey: string, generation: string, observer: Live2DCurrentFrameConsumer) {
    const record = this.figures.get(figureKey);
    if (!record || record.target.generation !== generation) return undefined;
    record.frameObservers.add(observer);
    return () => record.frameObservers.delete(observer);
  }

  /** Releases reloadable caches only after all serializable/runtime owners are gone. */
  public clearIdleCaches() {
    if (
      this.previewClaims.size > 0 ||
      this.entities.size > 0 ||
      this.desired.size > 0 ||
      this.desiredFree.size > 0 ||
      this.pendingFreeRestores.size > 0 ||
      this.retiringFigures.size > 0 ||
      [...this.figures.values()].some((record) => record.instances.size > 0 || record.pendingFrameOperations.length > 0)
    ) {
      return false;
    }
    this.textureCache.clear();
    this.configLoader.clear();
    return true;
  }

  public destroy() {
    for (const abort of [...this.detachMaterializationWaits]) abort();
    if (this.destroyed) return;
    this.reconcileRevision += 1;
    this.destroyed = true;
    for (const record of [...this.figures.values()]) {
      this.unregisterFigure(record.target.key, record.target.generation);
    }
    for (const record of [...this.retiringFigures.values()]) {
      this.unregisterFigureGeneration(record.target.key, record.target.generation);
    }
    for (const entity of [...this.entities.values()]) this.destroyEntity(entity, false);
    this.desired.clear();
    this.desiredFree.clear();
    this.previewClaims.clear();
    this.pendingFreeRestores.clear();
    this.freeRestoreDiagnostics.clear();
    this.observers.clear();
    this.textureCache.clear();
    this.freeStageHost = undefined;
  }

  /** Reusable lifecycle cleanup for React/HMR without permanently invalidating the singleton. */
  public reset() {
    if (this.destroyed) return;
    for (const abort of [...this.detachMaterializationWaits]) abort();
    this.reconcileRevision += 1;
    for (const record of [...this.figures.values()]) {
      this.unregisterFigure(record.target.key, record.target.generation);
    }
    for (const record of [...this.retiringFigures.values()]) {
      this.unregisterFigureGeneration(record.target.key, record.target.generation);
    }
    for (const entity of [...this.entities.values()]) this.destroyEntity(entity, false);
    this.desired.clear();
    this.desiredFree.clear();
    this.previewClaims.clear();
    this.pendingFreeRestores.clear();
    this.freeRestoreDiagnostics.clear();
    this.observers.clear();
    this.textureCache.clear();
    this.configLoader.clear();
    this.freeStageHost = undefined;
  }

  private async upsertLoaded(
    record: FigureRecord,
    declaration: AttachmentDeclaration,
  ): Promise<AttachmentInstanceSnapshot> {
    const entityId = declaration.entityId!;
    const current = record.instances.get(declaration.attachmentId);
    this.assertGlobalEntityIdAvailable(declaration, false);
    if (
      current &&
      current.snapshot.phase !== 'error' &&
      current.entityId === entityId &&
      current.declaration.configId === declaration.configId &&
      current.declaration.modelProfileId === declaration.modelProfileId &&
      current.declaration.slot === declaration.slot &&
      current.declaration.semanticAnchor === declaration.semanticAnchor
    ) {
      current.declaration = cloneDeclaration(declaration);
      current.snapshot.visible = declaration.visible;
      const entity = this.entities.get(entityId);
      // Attached entities keep their authored local transform on the otherwise
      // empty transform host and mirror it onto both Live2D layer proxies. An
      // add fade initially commits `visible: false`, then publishes
      // `visible: true` after the controller is ready. If an existing-instance
      // reconciliation only updates the logical controller flag, the host
      // remains hidden and syncAttachedVisualState propagates that stale bit to
      // both proxies. Detach later overwrites proxy visibility, producing the
      // misleading "appears only when detached" pop observed in Terre.
      //
      // As with free entities, do not project optimistic terminal transform
      // state while a Pixi transform owns this target. Discrete add/show/hide
      // visibility updates are unlocked and therefore reach the host here.
      if (declaration.visualState && entity?.state === 'attached' && !entity.stage?.isTransformTargetLocked(entityId)) {
        this.setEntityVisualState(entityId, declaration.visualState);
      }
      this.syncDeclaredVisibility(current, declaration.visible);
      this.emitInstance(current);
      return cloneSnapshot(current.snapshot);
    }
    if (current) this.removeLoaded(record, declaration.attachmentId);

    const token = Symbol(declaration.attachmentId);
    const instance: RuntimeInstance = {
      entityId,
      declaration: cloneDeclaration(declaration),
      token,
      snapshot: {
        entityId,
        figureKey: record.target.key,
        figureGeneration: record.target.generation,
        attachmentId: declaration.attachmentId,
        configId: declaration.configId,
        modelProfileId: declaration.modelProfileId,
        slot: declaration.slot,
        visible: declaration.visible,
        phase: 'loading',
        firstValidPose: { status: 'pending' },
        ...(declaration.semanticBinding ? { semanticBinding: { ...declaration.semanticBinding } } : {}),
      },
    };
    record.instances.set(declaration.attachmentId, instance);
    this.emitInstance(instance);

    try {
      const loaded = await this.configLoader.load(
        declaration.configId,
        record.target.sourcePath,
        declaration.modelProfileId,
        declaration.semanticAnchor,
      );
      this.assertCurrent(record, instance, token);
      if (!loaded.modelBinding && normalizeGameAssetPath(record.target.sourcePath) !== loaded.config.target.modelPath) {
        throw new AttachmentRuntimeFailure(
          'MODEL_INCOMPATIBLE',
          `Attachment ${declaration.configId} targets ${loaded.config.target.modelPath}, not ${normalizeGameAssetPath(
            record.target.sourcePath,
          )}`,
        );
      }
      if (loaded.modelBinding) {
        const internalModel = record.target.model.internalModel;
        assertAttachmentModelBinding(
          loaded.modelBinding,
          {
            modelPath: record.target.sourcePath,
            drawableCount:
              typeof internalModel.getDrawableIDs === 'function' ? internalModel.getDrawableIDs().length : undefined,
            getDrawableVertexCount: (drawableId) => {
              const drawableIndex = internalModel.getDrawableIndex(drawableId);
              if (drawableIndex < 0) return undefined;
              const vertexCount = internalModel.getDrawableVertices(drawableIndex).length / 2;
              return Number.isInteger(vertexCount) && vertexCount > 0 ? vertexCount : undefined;
            },
          },
          loaded.sourceUrl,
        );
      }
      assertRequestedSemanticAnchor(loaded.modelBinding, declaration.semanticAnchor, declaration.configId);
      instance.modelBinding = loaded.modelBinding;
      instance.snapshot.modelProfileId = loaded.modelBinding?.modelProfileId ?? declaration.modelProfileId;
      instance.snapshot.modelBinding = loaded.modelBinding
        ? {
            ...loaded.modelBinding,
            fingerprint: { ...loaded.modelBinding.fingerprint },
            anchorVertexIndices: [...loaded.modelBinding.anchorVertexIndices],
          }
        : undefined;

      let textures: AttachmentTextureSet;
      try {
        textures = await this.loadTextures(
          loaded.config.attachedLayers ?? loaded.config.layers,
          loaded.config.freeRenderable,
        );
      } catch (error) {
        throw new AttachmentRuntimeFailure(
          'IMAGE_LOAD_FAILED',
          `Attachment ${declaration.configId} image load failed: ${errorMessage(error)}`,
          error instanceof Error ? { cause: error } : undefined,
        );
      }
      this.assertCurrent(record, instance, token);
      // A newer committed view may update visibility/visual state while the
      // same config is loading. The owned instance carries the latest seed.
      declaration = instance.declaration;
      try {
        const layers = this.ensurePresentation(record);
        const conflictingEntity = this.entities.get(entityId);
        if (conflictingEntity && conflictingEntity.instance !== instance) {
          throw new AttachmentRuntimeFailure('ENTITY_ID_CONFLICT', `Stage entity id is already active: ${entityId}`);
        }
        const transformHost = new WebGALPixiContainer();
        transformHost.attachmentLocalAlpha = true;
        transformHost.name = `__webgal_stage_entity_${encodeURIComponent(entityId)}__`;
        instance.transformHost = transformHost;
        instance.controller = new HatAttachmentController({
          renderer: record.target.app.renderer as PIXI.Renderer,
          instanceId: `${encodeURIComponent(record.target.key)}_${encodeURIComponent(declaration.attachmentId)}`,
          model: record.target.model,
          layers,
          config: loaded.config,
          textures,
          transformHost,
          onError: (error) => {
            if (!this.isCurrent(record, instance, token)) return;
            const controller = instance.controller;
            if (controller) this.failControllerTerminally(record, instance, controller, error);
          },
        });
        if (declaration.visualState) {
          applyAttachmentEntityVisualState(transformHost, declaration.visualState);
        }
        try {
          if (record.target.stage) {
            const externalStageObjectUuid = uuid();
            record.target.stage.registerExternalStageObject({
              uuid: externalStageObjectUuid,
              key: entityId,
              pixiContainer: transformHost,
              sourceUrl: '',
              sourceType: 'stage',
              sourceExt: '',
            });
            instance.externalStageObjectUuid = externalStageObjectUuid;
          }
        } catch (error) {
          throw new AttachmentRuntimeFailure(
            'ENTITY_ID_CONFLICT',
            `Stage entity id conflicts with an existing Pixi target: ${entityId}`,
            error instanceof Error ? { cause: error } : undefined,
          );
        }
        this.entities.set(entityId, {
          entityId,
          attachmentId: declaration.attachmentId,
          originFigureKey: declaration.figureKey,
          state: 'attached',
          instance,
          stage: record.target.stage,
          attachedRecord: record,
          operationRevision: 0,
          lastAttachedLocalState: cloneAttachmentEntityVisualState(
            declaration.visualState ?? readAttachmentEntityVisualState(transformHost, 'local'),
          ),
        });
      } catch (error) {
        instance.controller?.destroy();
        instance.controller = undefined;
        if (instance.transformHost) {
          this.releaseOwnedExternalStageObject(instance, record.target.stage);
          instance.transformHost.parent?.removeChild(instance.transformHost);
          destroyAttachmentEntityAppearance(instance.transformHost);
          instance.transformHost.destroy({
            children: true,
            texture: false,
            baseTexture: false,
          });
          instance.transformHost = undefined;
        }
        if (error instanceof AttachmentRuntimeFailure) throw error;
        throw new AttachmentRuntimeFailure(
          'RUNTIME_CREATE_FAILED',
          `Attachment ${declaration.configId} creation failed: ${errorMessage(error)}`,
          error instanceof Error ? { cause: error } : undefined,
        );
      }
      this.syncDeclaredVisibility(instance, declaration.visible);
      instance.snapshot.phase = 'ready';
      if (declaration.semanticBinding) {
        instance.snapshot.semanticRuntimeTrace = {
          semanticProfileId: declaration.semanticBinding.profileId,
          canonicalSemanticAnchorId: declaration.semanticBinding.semanticAnchorId,
          modelProfileId: declaration.semanticBinding.modelProfileId,
          namedAnchor: declaration.semanticBinding.namedAnchor,
          referenceFrame: declaration.semanticBinding.referenceFrame,
          fitAlgorithm: declaration.semanticBinding.fitAlgorithm,
          currentFrameMesh: true,
          actualProxyCount: 2,
        };
      }
      delete instance.snapshot.errorCode;
      delete instance.snapshot.error;
    } catch (error) {
      if (this.isCurrent(record, instance, token)) {
        const code = this.errorCode(error);
        this.failInstance(instance, code, error);
        this.stopPresentationIfIdle(record);
      }
    }
    if (this.isCurrent(record, instance, token)) this.emitInstance(instance);
    return cloneSnapshot(instance.snapshot);
  }

  private ensurePresentation(record: FigureRecord) {
    if (record.layers && record.driver) return record.layers;
    record.presentationDestroyed = false;
    const layers = createLive2DAttachmentLayers(record.target.model);
    attachLive2DAttachmentLayers(record.target.container, record.target.model, layers);
    record.layers = layers;

    const consumer: Live2DCurrentFrameConsumer = {
      syncVisualState: () => {
        for (const instance of record.instances.values()) instance.controller?.syncVisualStateForRender();
      },
      update: (frame, stats) => this.updateFigure(record, frame, stats),
      destroy: (stats) => this.destroyPresentation(record, stats),
    };
    try {
      record.driver = this.driverStarter({
        app: record.target.app,
        key: record.target.key,
        sourcePath: record.target.sourcePath,
        model: record.target.model,
        layers,
        consumer,
      });
    } catch (error) {
      destroyLive2DAttachmentLayers(layers);
      record.layers = undefined;
      throw error;
    }
    return layers;
  }

  private updateFigure(record: FigureRecord, frame: Live2DCurrentFrame, stats: Live2DFrameDriverStats) {
    for (const instance of record.instances.values()) {
      const controller = instance.controller;
      controller?.update(frame, stats);
      // Only the production frame consumer reaches this method. Resource
      // readiness, visibility animation time and a direct test seam cannot
      // manufacture first-pose evidence.
      if (
        controller &&
        this.figures.get(record.target.key) === record &&
        !record.target.model.destroyed &&
        instance.controller === controller &&
        instance.snapshot.phase === 'ready' &&
        instance.snapshot.figureGeneration === record.target.generation &&
        instance.snapshot.firstValidPose.status !== 'ready' &&
        controller.getLastFit() &&
        !controller.getLastError()
      ) {
        instance.snapshot.firstValidPose = {
          status: 'ready',
          frame: frame.frame,
          timestamp: frame.timestamp,
          observedAt: performance.now(),
        };
        this.emitInstance(instance);
      }
    }
    for (const entity of this.entities.values()) {
      const prepared = entity.preparedReattach;
      if (!prepared?.flight || prepared.figureKey !== record.target.key) continue;
      try {
        this.applyReattachFlight(entity, record);
      } catch (error) {
        prepared.flight.error = error;
      }
    }
    // Invalid source/target frames remain queued. Each live frame revalidates
    // generation/revision first, then readiness, and only the first valid frame
    // may execute the atomic operation.
    for (const operation of [...record.pendingFrameOperations]) {
      if (operation.settled || !record.pendingFrameOperations.includes(operation)) continue;
      try {
        const readiness = operation.evaluate();
        operation.lastReadiness = readiness.details;
        if (!readiness.ready) continue;
        operation.run();
      } catch (error) {
        operation.reject(error);
      }
    }
    for (const observer of record.frameObservers) observer.update(frame, stats);
    this.emit({
      type: 'frame',
      figureKey: record.target.key,
      figureGeneration: record.target.generation,
      frame,
      stats,
    });
  }

  private firstValidPoseDeferredReason(
    record: FigureRecord,
    instance: RuntimeInstance,
  ): AttachmentFirstValidPoseDeferredReason | undefined {
    if (!instance.snapshot.visible || !instance.declaration.visible) return 'attachment-hidden';
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'document-hidden';
    const model = record.target.model;
    // The preparation hook belongs to the figure container. Pixi never calls
    // it when that container or any ancestor is hidden/non-renderable. Inspect
    // both formal targets so a detached/stale model parent cannot hide that
    // fact and turn an intentionally suppressed figure into a timeout error.
    for (const target of [model, record.target.container] as PIXI.DisplayObject[]) {
      for (let current: PIXI.DisplayObject | null = target; current; current = current.parent) {
        if (!current.visible || !current.renderable || current.worldAlpha <= 0) {
          return 'figure-not-renderable';
        }
      }
    }
    const renderer = record.target.app.renderer as
      | (PIXI.Renderer & { framebuffer?: { viewport?: { width?: number; height?: number } } })
      | undefined;
    const viewport = renderer?.framebuffer?.viewport;
    if (viewport && ((viewport.width ?? 0) <= 0 || (viewport.height ?? 0) <= 0)) {
      return 'render-surface-unavailable';
    }
    return undefined;
  }

  private destroyPresentation(record: FigureRecord, stats?: Live2DFrameDriverStats) {
    if (record.presentationDestroyed) return;
    record.presentationDestroyed = true;
    for (const instance of [...record.instances.values()]) {
      const entity = this.entities.get(instance.entityId);
      if (entity?.instance === instance && entity.state === 'attached') {
        this.destroyEntity(entity, false);
      } else {
        this.releaseOwnedExternalStageObject(instance, record.target.stage);
        instance.controller?.destroy();
        instance.controller = undefined;
        instance.transformHost?.parent?.removeChild(instance.transformHost);
        if (instance.transformHost) destroyAttachmentEntityAppearance(instance.transformHost);
        instance.transformHost?.destroy({ children: true, texture: false, baseTexture: false });
        instance.transformHost = undefined;
      }
    }
    record.instances.clear();
    for (const observer of record.frameObservers) {
      observer.destroy(stats ?? record.driver?.getStats() ?? emptyDriverStats());
    }
    record.frameObservers.clear();
    if (record.layers) destroyLive2DAttachmentLayers(record.layers);
    record.layers = undefined;
    record.driver = undefined;
  }

  private removeLoaded(record: FigureRecord, attachmentId: string) {
    const instance = record.instances.get(attachmentId);
    if (!instance) return false;
    instance.token = Symbol('removed');
    record.instances.delete(attachmentId);
    const entity = this.entities.get(instance.entityId);
    if (entity?.instance === instance) this.destroyEntity(entity, false);
    else instance.controller?.destroy();
    this.emit({
      type: 'instance-removed',
      figureKey: record.target.key,
      figureGeneration: record.target.generation,
      attachmentId,
    });
    this.stopPresentationIfIdle(record);
    return true;
  }

  private async loadTextures(
    urls: { back?: string; front?: string },
    freeRenderable?: { full: string },
  ): Promise<AttachmentTextureSet> {
    const [back, front, full] = await Promise.all([
      urls.back ? this.loadTexture(urls.back) : undefined,
      urls.front ? this.loadTexture(urls.front) : undefined,
      freeRenderable ? this.loadTexture(freeRenderable.full) : undefined,
    ]);
    return { back, front, full };
  }

  private async preloadDeclaration(declaration: AttachmentDeclaration) {
    const observedModelPath = this.figures.get(declaration.figureKey)?.target.sourcePath;
    if (!observedModelPath && !declaration.modelProfileId) return;
    const loaded = await this.configLoader.load(declaration.configId, observedModelPath, declaration.modelProfileId, declaration.semanticAnchor);
    await this.loadTextures(loaded.config.attachedLayers ?? loaded.config.layers, loaded.config.freeRenderable);
  }

  private loadTexture(url: string) {
    const existing = this.textureCache.get(url);
    if (existing) return existing;
    const pending = this.textureLoader(url).catch((error) => {
      this.textureCache.delete(url);
      throw error;
    });
    this.textureCache.set(url, pending);
    return pending;
  }

  private assertSlotAvailable(byId: Map<string, AttachmentDeclaration>, declaration: AttachmentDeclaration) {
    if (declaration.slot === undefined) return;
    for (const current of byId.values()) {
      if (current.attachmentId !== declaration.attachmentId && current.slot === declaration.slot) {
        throw new StageEntityOperationError(
          'ENTITY_SLOT_CONFLICT',
          `Attachment slot ${JSON.stringify(declaration.slot)} is already occupied on ${declaration.figureKey}`,
          {
            details: {
              entityId: declaration.entityId,
              figureKey: declaration.figureKey,
              attachmentId: declaration.attachmentId,
              slot: declaration.slot,
            },
          },
        );
      }
    }
  }

  private assertGlobalEntityIdAvailable(
    declaration: AttachmentDeclaration,
    includeDesired: boolean,
    ignoredLiveInstances: ReadonlySet<RuntimeInstance> = new Set(),
  ) {
    const entityId = declaration.entityId!;
    const record = this.figures.get(declaration.figureKey);
    const exactLiveInstance = record?.instances.get(declaration.attachmentId);
    const activeEntity = this.entities.get(entityId);
    if (
      activeEntity &&
      activeEntity.instance !== exactLiveInstance &&
      !ignoredLiveInstances.has(activeEntity.instance)
    ) {
      throw new StageEntityOperationError(
        'ENTITY_ID_CONFLICT',
        `Stage entity id ${JSON.stringify(entityId)} is already owned by another runtime entity`,
        { details: { entityId, figureKey: declaration.figureKey } },
      );
    }
    for (const liveRecord of this.figures.values()) {
      for (const instance of liveRecord.instances.values()) {
        if (instance.entityId === entityId && instance !== exactLiveInstance && !ignoredLiveInstances.has(instance)) {
          throw new StageEntityOperationError(
            'ENTITY_ID_CONFLICT',
            `Stage entity id ${JSON.stringify(entityId)} is already owned by another runtime instance`,
            { details: { entityId, figureKey: declaration.figureKey } },
          );
        }
      }
    }
    if (!includeDesired) return;
    for (const [figureKey, byId] of this.desired) {
      for (const candidate of byId.values()) {
        if (candidate.entityId !== entityId) continue;
        if (figureKey === declaration.figureKey && candidate.attachmentId === declaration.attachmentId) {
          continue;
        }
        throw new StageEntityOperationError(
          'ENTITY_ID_CONFLICT',
          `Stage entity id ${JSON.stringify(entityId)} is already owned by another desired declaration`,
          { details: { entityId, figureKey: declaration.figureKey } },
        );
      }
    }
  }

  private removeDesiredDeclaration(figureKey: string, attachmentId: string, entityId: string) {
    const desired = this.desired.get(figureKey);
    if (desired?.get(attachmentId)?.entityId !== entityId) return false;
    desired.delete(attachmentId);
    if (desired.size === 0) this.desired.delete(figureKey);
    return true;
  }

  private releaseOwnedExternalStageObject(
    instance: RuntimeInstance,
    stage: NonNullable<AttachmentFigureTarget['stage']> | undefined,
  ) {
    const externalUuid = instance.externalStageObjectUuid;
    if (!stage || !externalUuid || !instance.transformHost) return false;
    const ownsCurrentTarget = this.ownsExternalStageObject(instance, stage);
    instance.externalStageObjectUuid = undefined;
    if (!ownsCurrentTarget) return false;
    let transformRemovalError: unknown;
    try {
      this.transformTargetRemover?.(instance.entityId);
    } catch (error) {
      transformRemovalError = error;
    }
    let unregistered = false;
    try {
      unregistered = Boolean(stage.unregisterExternalStageObjectByUuid(externalUuid));
    } finally {
      if (transformRemovalError !== undefined) throw transformRemovalError;
    }
    return unregistered;
  }

  private ownsExternalStageObject(
    instance: RuntimeInstance,
    stage: NonNullable<AttachmentFigureTarget['stage']> | undefined,
  ) {
    const externalUuid = instance.externalStageObjectUuid;
    if (!stage || !externalUuid || !instance.transformHost) return false;
    const byUuid = stage.getExternalStageObjByUuid(externalUuid);
    const byKey = stage.getExternalStageObjByKey(instance.entityId);
    return (
      byUuid?.uuid === externalUuid &&
      byUuid.key === instance.entityId &&
      byUuid.pixiContainer === instance.transformHost &&
      byKey?.uuid === externalUuid &&
      byKey.pixiContainer === instance.transformHost
    );
  }

  /**
   * Guards both the serializable desired projection and the live generation.
   * A free entity is intentionally absent from both maps, so only another
   * entity may claim its target composite or slot while it is in flight.
   */
  private assertReattachTargetAvailable(entity: RuntimeEntityRecord, record: FigureRecord) {
    const expectedSlot = entity.instance.declaration.slot;
    const assertCandidate = (
      candidateEntityId: string | undefined,
      candidateAttachmentId: string,
      candidateSlot: string | undefined,
      candidateInstance?: RuntimeInstance,
    ) => {
      if (candidateInstance === entity.instance) return;
      if (candidateEntityId === entity.entityId) {
        throw new StageEntityOperationError(
          'ENTITY_ID_CONFLICT',
          `Stage entity ${entity.entityId} is already owned by another declaration or runtime instance`,
          {
            details: {
              entityId: entity.entityId,
              figureKey: record.target.key,
              figureGeneration: record.target.generation,
            },
          },
        );
      }
      if (candidateAttachmentId === entity.attachmentId) {
        throw new StageEntityOperationError(
          'ENTITY_ID_CONFLICT',
          `Attachment (${record.target.key}, ${entity.attachmentId}) is already owned by another entity`,
          {
            details: {
              entityId: entity.entityId,
              figureKey: record.target.key,
              figureGeneration: record.target.generation,
              attachmentId: entity.attachmentId,
            },
          },
        );
      }
      if (expectedSlot !== undefined && candidateSlot === expectedSlot) {
        throw new StageEntityOperationError(
          'ENTITY_SLOT_CONFLICT',
          `Attachment slot ${JSON.stringify(expectedSlot)} is already occupied on ${record.target.key}`,
          {
            details: {
              entityId: entity.entityId,
              figureKey: record.target.key,
              figureGeneration: record.target.generation,
              slot: expectedSlot,
            },
          },
        );
      }
    };

    for (const candidate of this.desired.get(record.target.key)?.values() ?? []) {
      assertCandidate(candidate.entityId, candidate.attachmentId, candidate.slot);
    }
    for (const candidate of record.instances.values()) {
      assertCandidate(candidate.entityId, candidate.declaration.attachmentId, candidate.declaration.slot, candidate);
    }
  }

  private isCurrent(record: FigureRecord, instance: RuntimeInstance, token: symbol) {
    return (
      this.figures.get(record.target.key) === record &&
      record.instances.get(instance.declaration.attachmentId) === instance &&
      instance.token === token &&
      !record.target.model.destroyed
    );
  }

  private assertCurrent(record: FigureRecord, instance: RuntimeInstance, token: symbol) {
    if (!this.isCurrent(record, instance, token)) throw new Error('Attachment load was superseded');
  }

  private emitInstance(instance: RuntimeInstance) {
    this.emit({
      type: 'instance-changed',
      instance: cloneSnapshot(instance.snapshot),
    });
  }

  private failInstance(instance: RuntimeInstance, code: AttachmentRuntimeErrorCode, error: unknown) {
    instance.snapshot.phase = 'error';
    instance.snapshot.errorCode = code;
    instance.snapshot.error = errorMessage(error);
    const snapshot = cloneSnapshot(instance.snapshot);
    this.emit({ type: 'instance-changed', instance: snapshot });
    this.emit({ type: 'instance-error', instance: snapshot });
  }

  private errorCode(error: unknown): AttachmentRuntimeErrorCode {
    if (error instanceof AttachmentConfigError || error instanceof HatAttachmentError) return error.code;
    if (error instanceof AttachmentProfileError) return error.code;
    if (error instanceof AttachmentRuntimeFailure) return error.code;
    if (error instanceof StageEntityOperationError && error.code === 'ENTITY_ID_CONFLICT') {
      return error.code;
    }
    return 'RUNTIME_CREATE_FAILED';
  }

  private stopPresentationIfIdle(record: FigureRecord) {
    if ([...record.instances.values()].some((instance) => instance.controller)) return;
    if (record.pendingFrameOperations.length > 0) return;
    if (
      [...this.entities.values()].some(
        (entity) =>
          (entity.state === 'attached' &&
            entity.attachedRecord === record &&
            entity.instance.controller !== undefined) ||
          (entity.preparedReattach?.figureKey === record.target.key &&
            entity.preparedReattach.figureGeneration === record.target.generation),
      )
    ) {
      return;
    }
    record.driver?.cleanup();
  }

  private requireEntity(entityId: string, state?: AttachmentEntityRuntimeState) {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new StageEntityOperationError('ENTITY_NOT_FOUND', `Stage entity not found: ${entityId}`, {
        details: { entityId },
      });
    }
    if (state && entity.state !== state) {
      throw new StageEntityOperationError(
        'ENTITY_STATE_INCOMPATIBLE',
        `Stage entity ${entityId} is ${entity.state}, expected ${state}`,
        {
          details: {
            entityId,
            expectedState: state,
            actualState: entity.state,
          },
        },
      );
    }
    return entity;
  }

  private assertEntityOperation(
    entity: RuntimeEntityRecord,
    revision: number,
    state: AttachmentEntityRuntimeState,
    attachedRecord?: FigureRecord,
  ) {
    if (this.entities.get(entity.entityId) !== entity || entity.operationRevision !== revision) {
      throw new StageEntityOperationError(
        'ENTITY_TRANSITION_TARGET_LOST',
        `Stage entity operation was superseded: ${entity.entityId}`,
        { details: { entityId: entity.entityId, operationRevision: revision } },
      );
    }
    if (entity.state !== state) {
      throw new StageEntityOperationError(
        'ENTITY_STATE_INCOMPATIBLE',
        `Stage entity ${entity.entityId} changed state during operation`,
        {
          details: {
            entityId: entity.entityId,
            expectedState: state,
            actualState: entity.state,
          },
        },
      );
    }
    if (attachedRecord && entity.attachedRecord !== attachedRecord) {
      throw new StageEntityOperationError(
        'ENTITY_TRANSITION_TARGET_LOST',
        `Stage entity ${entity.entityId} changed parent during operation`,
        {
          details: {
            entityId: entity.entityId,
            figureKey: attachedRecord.target.key,
            figureGeneration: attachedRecord.target.generation,
          },
        },
      );
    }
    if (
      attachedRecord &&
      (this.figures.get(attachedRecord.target.key) !== attachedRecord || attachedRecord.target.model.destroyed)
    ) {
      throw new StageEntityOperationError(
        'ENTITY_TRANSITION_TARGET_LOST',
        `Stage entity ${entity.entityId} parent generation is no longer current`,
        {
          details: {
            entityId: entity.entityId,
            figureKey: attachedRecord.target.key,
            figureGeneration: attachedRecord.target.generation,
          },
        },
      );
    }
  }

  private queueFrameOperation<T>(
    record: FigureRecord,
    entityId: string,
    operation: () => T | Promise<T>,
    options: {
      validate?: () => void;
      readiness?: () => { ready: boolean; details?: unknown };
      timeoutError?: (lastReadiness: unknown) => Error;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `${entityId}:${record.target.generation}:${Math.random().toString(16).slice(2)}`;
      const timeoutMs = options.timeoutMs ?? this.frameOperationTimeoutMs;
      const removePending = (pending: PendingFrameOperation) => {
        const index = record.pendingFrameOperations.indexOf(pending);
        if (index >= 0) record.pendingFrameOperations.splice(index, 1);
      };
      let settleResolve!: (value: T) => void;
      let settleReject!: (error: unknown) => void;
      const pending: PendingFrameOperation = {
        id,
        entityId,
        settled: false,
        reject: (error) => settleReject(error),
        evaluate: () => {
          options.validate?.();
          return options.readiness?.() ?? { ready: true };
        },
        timeout: setTimeout(() => {
          const timeoutError =
            options.timeoutError?.(pending.lastReadiness) ??
            new StageEntityOperationError(
              'ENTITY_ANCHOR_FRAME_UNAVAILABLE',
              `Timed out waiting for current frame operation: ${entityId}`,
              {
                details: {
                  entityId,
                  figureKey: record.target.key,
                  figureGeneration: record.target.generation,
                  readiness: pending.lastReadiness,
                },
              },
            );
          settleReject(timeoutError);
        }, timeoutMs),
        run: () => {
          try {
            Promise.resolve(operation()).then(settleResolve, settleReject);
          } catch (error) {
            settleReject(error);
          }
        },
      };
      settleResolve = (value) => {
        if (pending.settled) return;
        pending.settled = true;
        clearTimeout(pending.timeout);
        removePending(pending);
        resolve(value);
        setTimeout(() => this.stopPresentationIfIdle(record), 0);
      };
      settleReject = (error) => {
        if (pending.settled) return;
        pending.settled = true;
        clearTimeout(pending.timeout);
        removePending(pending);
        reject(
          toStageEntityOperationError(error, 'STAGE_ENTITY_OPERATION_FAILED', {
            entityId,
            figureKey: record.target.key,
            figureGeneration: record.target.generation,
          }),
        );
        setTimeout(() => this.stopPresentationIfIdle(record), 0);
      };
      record.pendingFrameOperations.push(pending);
    });
  }

  private rejectPendingFrameOperations(record: FigureRecord, error: unknown) {
    for (const operation of record.pendingFrameOperations.splice(0)) {
      operation.reject(error);
    }
  }

  private rejectPendingEntityOperations(entityId: string, error: unknown) {
    for (const record of this.figures.values()) {
      for (const operation of [...record.pendingFrameOperations]) {
        if (operation.entityId === entityId) operation.reject(error);
      }
    }
  }

  private disposeReattachCandidate(
    entity: RuntimeEntityRecord,
    candidate: NonNullable<NonNullable<RuntimeEntityRecord['preparedReattach']>['candidate']>,
  ) {
    try {
      candidate.controller.destroy();
    } finally {
      const transformHost = entity.instance.transformHost;
      if (entity.state === 'free' && transformHost && entity.instance.controller) {
        applyAttachmentEntityVisualState(transformHost, candidate.freeVisualState);
        entity.instance.controller.releaseFreeInheritedPresentation();
      }
    }
  }

  private clearPreparedReattach(entity: RuntimeEntityRecord, expectedToken?: string) {
    const prepared = entity.preparedReattach;
    if (!prepared || (expectedToken !== undefined && prepared.token !== expectedToken)) return false;
    entity.preparedReattach = undefined;
    if (prepared.candidate) this.disposeReattachCandidate(entity, prepared.candidate);
    return true;
  }

  private failControllerTerminally(
    record: FigureRecord,
    instance: RuntimeInstance,
    controller: HatAttachmentController,
    error: HatAttachmentError,
  ) {
    // The controller destroys its proxies before invoking onError. Claim the
    // exact controller once, then keep every remaining owner cleanup isolated:
    // a transition remover or diagnostic sink must not replace the fit error
    // or strand the entity/host/driver in a half-terminal state.
    if (instance.controller !== controller) return false;
    instance.controller = undefined;
    const cleanupFailures: Array<{ step: string; error: unknown }> = [];
    const entity = this.entities.get(instance.entityId);
    if (entity?.instance === instance) {
      if (entity.visibilityTransition) {
        const transition = entity.visibilityTransition;
        entity.visibilityTransition = undefined;
        this.runTerminalCleanupStep(cleanupFailures, 'stop-visibility-transition', () => transition.controls.stop());
      }
      entity.operationRevision += 1;
      this.runTerminalCleanupStep(cleanupFailures, 'reject-pending-operations', () => {
        this.rejectPendingEntityOperations(
          entity.entityId,
          new StageEntityOperationError(
            'ENTITY_TRANSITION_TARGET_LOST',
            `Stage entity controller failed during an operation: ${entity.entityId}`,
            { details: { entityId: entity.entityId, operation: 'controller-terminal-failure' } },
          ),
        );
      });
      this.runTerminalCleanupStep(cleanupFailures, 'dispose-reattach-candidate', () => {
        this.clearPreparedReattach(entity);
      });
      this.runTerminalCleanupStep(cleanupFailures, 'release-external-stage-object', () => {
        this.releaseOwnedExternalStageObject(instance, entity.stage);
      });
      this.entities.delete(entity.entityId);
    }
    this.runTerminalCleanupStep(cleanupFailures, 'destroy-controller', () => controller.destroy());
    const transformHost = instance.transformHost;
    instance.transformHost = undefined;
    this.runTerminalCleanupStep(cleanupFailures, 'detach-transform-host', () => {
      transformHost?.parent?.removeChild(transformHost);
    });
    this.runTerminalCleanupStep(cleanupFailures, 'destroy-transform-host-appearance', () => {
      if (transformHost) destroyAttachmentEntityAppearance(transformHost);
    });
    this.runTerminalCleanupStep(cleanupFailures, 'destroy-transform-host', () => {
      transformHost?.destroy({ children: true, texture: false, baseTexture: false });
    });
    this.runTerminalCleanupStep(cleanupFailures, 'publish-terminal-error', () => {
      this.failInstance(instance, error.code, error);
    });
    this.runTerminalCleanupStep(cleanupFailures, 'stop-presentation-if-idle', () => {
      this.stopPresentationIfIdle(record);
    });
    this.reportTerminalCleanupFailures(instance.entityId, cleanupFailures);
    return true;
  }

  private destroyEntity(entity: RuntimeEntityRecord, emitRemoval: boolean) {
    if (this.entities.get(entity.entityId) !== entity) return;
    const cleanupFailures: Array<{ step: string; error: unknown }> = [];
    this.runTerminalCleanupStep(cleanupFailures, 'reject-pending-operations', () => {
      this.rejectPendingEntityOperations(
        entity.entityId,
        new StageEntityOperationError(
          'ENTITY_TRANSITION_TARGET_LOST',
          `Stage entity was removed during an operation: ${entity.entityId}`,
          { details: { entityId: entity.entityId, operation: 'remove' } },
        ),
      );
    });
    this.entities.delete(entity.entityId);
    if (entity.visibilityTransition) {
      const transition = entity.visibilityTransition;
      entity.visibilityTransition = undefined;
      this.runTerminalCleanupStep(cleanupFailures, 'stop-visibility-transition', () => transition.controls.stop());
    }
    entity.operationRevision += 1;
    this.runTerminalCleanupStep(cleanupFailures, 'dispose-reattach-candidate', () => {
      this.clearPreparedReattach(entity);
    });
    entity.attachedRecord?.instances.delete(entity.attachmentId);
    entity.instance.token = Symbol('entity-removed');
    this.runTerminalCleanupStep(cleanupFailures, 'release-external-stage-object', () => {
      this.releaseOwnedExternalStageObject(entity.instance, entity.stage);
    });
    const controller = entity.instance.controller;
    entity.instance.controller = undefined;
    this.runTerminalCleanupStep(cleanupFailures, 'destroy-controller', () => controller?.destroy());
    const transformHost = entity.instance.transformHost;
    entity.instance.transformHost = undefined;
    this.runTerminalCleanupStep(cleanupFailures, 'detach-transform-host', () => {
      transformHost?.parent?.removeChild(transformHost);
    });
    this.runTerminalCleanupStep(cleanupFailures, 'destroy-transform-host-appearance', () => {
      if (transformHost) destroyAttachmentEntityAppearance(transformHost);
    });
    this.runTerminalCleanupStep(cleanupFailures, 'destroy-transform-host', () => {
      transformHost?.destroy({
        children: true,
        texture: false,
        baseTexture: false,
      });
    });
    if (emitRemoval) {
      this.runTerminalCleanupStep(cleanupFailures, 'emit-instance-removed', () => {
        this.emit({
          type: 'instance-removed',
          figureKey: entity.instance.declaration.figureKey,
          figureGeneration: entity.instance.snapshot.figureGeneration,
          attachmentId: entity.attachmentId,
        });
      });
    }
    this.reportTerminalCleanupFailures(entity.entityId, cleanupFailures);
  }

  private runTerminalCleanupStep(failures: Array<{ step: string; error: unknown }>, step: string, action: () => void) {
    try {
      action();
    } catch (error) {
      failures.push({ step, error });
    }
  }

  private reportTerminalCleanupFailures(entityId: string, failures: Array<{ step: string; error: unknown }>) {
    if (failures.length === 0) return;
    try {
      console.error({
        scope: 'webgal.attachment.runtime',
        code: 'ATTACHMENT_TERMINAL_CLEANUP_PARTIAL_FAILURE',
        entityId,
        failures: failures.map(({ step, error }) => ({
          step,
          reason: error instanceof Error ? error.message : String(error),
        })),
      });
    } catch {
      // Terminal teardown is complete locally even if the diagnostic sink fails.
    }
  }

  private syncDeclaredVisibility(instance: RuntimeInstance, visible: boolean) {
    if (this.entities.get(instance.entityId)?.visibilityTransition) return;
    instance.controller?.setVisible(visible);
  }

  private emit(event: AttachmentRuntimeEvent) {
    for (const observer of this.observers) observer(event);
  }

  private assertAlive() {
    if (this.destroyed) {
      throw new StageEntityOperationError('ENTITY_STATE_INCOMPATIBLE', 'AttachmentRuntime is destroyed', {
        details: { runtimeDestroyed: true },
      });
    }
  }
}

export type AttachmentFirstValidPoseWaitErrorCode =
  | 'ATTACHMENT_FIRST_VALID_POSE_CANCELLED'
  | 'ATTACHMENT_FIRST_VALID_POSE_STALE'
  | 'ATTACHMENT_FIRST_VALID_POSE_FAILED'
  | 'ATTACHMENT_FIRST_VALID_POSE_TIMEOUT';

export class AttachmentFirstValidPoseWaitError extends Error {
  public constructor(public readonly code: AttachmentFirstValidPoseWaitErrorCode, message: string) {
    super(message);
    this.name = 'AttachmentFirstValidPoseWaitError';
  }
}

class AttachmentRuntimeFailure extends Error {
  public constructor(public readonly code: AttachmentRuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AttachmentRuntimeFailure';
  }
}

function assertSemanticRuntimeBinding(
  modelBinding: ResolvedAttachmentModelBinding | undefined,
  semanticBinding: SemanticRuntimeBinding,
  configId: string,
) {
  if (
    !modelBinding ||
    modelBinding.modelProfileId !== semanticBinding.modelProfileId ||
    modelBinding.anchorName !== semanticBinding.namedAnchor ||
    semanticBinding.fitAlgorithm !== 'fitRigid2D' ||
    semanticBinding.referenceFrame !== 'current-frame-mesh'
  ) {
    throw new AttachmentRuntimeFailure(
      'SEMANTIC_RUNTIME_BINDING_MISMATCH',
      `SEMANTIC_RUNTIME_BINDING_MISMATCH:${configId}:${semanticBinding.modelProfileId}/${semanticBinding.namedAnchor}`,
    );
  }
}

function assertRequestedSemanticAnchor(
  modelBinding: ResolvedAttachmentModelBinding | undefined,
  requestedSemanticAnchor: string | undefined,
  configId: string,
) {
  if (!requestedSemanticAnchor) return;
  if (!modelBinding || !attachmentSemanticAnchorMatchesPreset(requestedSemanticAnchor, modelBinding.anchorName)) {
    const message = isAmbiguousUnversionedEyeAnchor(requestedSemanticAnchor)
      ? `SEMANTIC_ANCHOR_LEGACY_EYE_AMBIGUOUS:${configId}:${requestedSemanticAnchor}/${
          modelBinding?.anchorName ?? 'unbound'
        }:use eyelid-upper-left/right or eye-center-left/right`
      : `SEMANTIC_ANCHOR_CONFIG_MISMATCH:${configId}:${requestedSemanticAnchor}/${
          modelBinding?.anchorName ?? 'unbound'
        }`;
    throw new AttachmentRuntimeFailure('SEMANTIC_RUNTIME_BINDING_MISMATCH', message);
  }
}

function emptyDriverStats(): Live2DFrameDriverStats {
  return {
    driverCount: 0,
    tickCount: 0,
    modelUpdateCount: 0,
    internalModelUpdateCount: 0,
    observedInternalModelUpdateCount: 0,
    attachmentUpdateCount: 0,
    cleanupCount: 0,
    doubleUpdateCount: 0,
    outOfBandInternalUpdateCount: 0,
    unexpectedPendingDeltaCount: 0,
    bootstrapRenderWaitCount: 0,
    lastDeltaMS: 0,
    lastModelDeltaBeforeReset: 0,
    lastElapsedTime: 0,
  };
}
import { readCubism2HandDiagnostics } from './Cubism2HandRenderer';
