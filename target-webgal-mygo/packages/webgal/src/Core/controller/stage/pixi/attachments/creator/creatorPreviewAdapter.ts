import { cloneAttachmentHandBinding } from '../handBinding';
import * as PIXI from 'pixi.js';

import type { AttachmentRuntime, AttachmentPreviewOwner } from '../AttachmentRuntime';
import { ATTACHMENT_CONFIG_SCHEMA } from '../types';
import { compatibleAnchorNames, type Live2DModelProfile } from '../profileTypes';
import type { AttachmentTextureSet, LoadedAttachmentConfig } from '../types';
import type { CreatorBinaryInput, CreatorDraft } from './creatorTypes';
import { parseAttachmentEntityVisualState } from '../stageEntityVisualState';

interface OwnedTextureSet {
  textures: AttachmentTextureSet;
  urls: string[];
}

interface BoundPreview {
  owner: AttachmentPreviewOwner;
  figureKey: string;
  generation: string;
  attachmentId: string;
  entityId: string;
  configId: string;
  slot?: string;
}

export interface CreatorPreviewDiagnostics {
  previewGeneration: number;
  boundFigureKey: string | null;
  boundFigureGeneration: string | null;
  runtimeAttachmentCount: number;
  rootPairCount: number;
  spriteCount: number;
  textureCount: number;
  activeObjectUrlCount: number;
  pendingAsyncCount: number;
}

export interface CreatorPreviewBindFailure {
  code: string;
  message: string;
  phase: string;
  expectedFigureGeneration: string;
  actualFigureGeneration: string;
}

function destroyOwned(owned: OwnedTextureSet | undefined) {
  if (!owned) return;
  const unique = new Set(Object.values(owned.textures).filter(Boolean) as PIXI.Texture[]);
  for (const texture of unique) texture.destroy(true);
  for (const url of owned.urls) URL.revokeObjectURL(url);
}

function visualStateForDraft(draft: CreatorDraft) {
  return parseAttachmentEntityVisualState(draft.visualState ?? {}, 'visualState');
}

let creatorPreviewAdapterSequence = 0;

/**
 * Creator adapter over the production controller/frame driver. Its opaque
 * lease survives ordinary narrative reconciliation without entering saves.
 */
export class CreatorPreviewAdapter {
  private readonly previewOwner = ++creatorPreviewAdapterSequence;
  private readonly previewAttachmentId = `__mvp2b_creator_preview_${this.previewOwner}__`;
  private readonly previewEntityId = `creator-preview:${this.previewOwner}`;
  private bound?: BoundPreview;
  private owned?: OwnedTextureSet;
  private lastBindFailure?: CreatorPreviewBindFailure;
  private revision = 0;
  private pendingAsyncCount = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private pendingReadiness?: AbortController;
  private pendingFrame?: AbortController;

  public constructor(
    private readonly runtime: AttachmentRuntime,
    private readonly textureFromUrl: (url: string) => Promise<PIXI.Texture> = (url) => PIXI.Texture.fromURL(url),
  ) {}

  public async bind(draft: CreatorDraft, profile: Live2DModelProfile) {
    const operation = this.beginOperation();
    this.pendingAsyncCount += 1;
    if (this.isCurrent(operation)) this.lastBindFailure = undefined;
    const readiness = new AbortController();
    this.pendingReadiness = readiness;
    try {
      await this.runtime.waitForFigureGeneration(draft.figureKey, draft.figureGeneration, 10_000, readiness.signal);
    } catch (error) {
      if (this.isCurrent(operation)) {
        this.lastBindFailure = {
          code: 'FIGURE_RUNTIME_NOT_READY',
          message: error instanceof Error ? error.message : String(error),
          phase: 'loading',
          expectedFigureGeneration: draft.figureGeneration,
          actualFigureGeneration: this.runtime.figureGeneration(draft.figureKey) ?? '',
        };
      }
      this.pendingAsyncCount -= 1;
      return false;
    } finally {
      if (this.pendingReadiness === readiness) this.pendingReadiness = undefined;
    }
    try {
      return await this.runMutation(
        operation,
        async () => {
          const registerDraftConfig = () => {
            const result = this.createEphemeralConfig(draft, profile, operation);
            this.runtime.registerEphemeralConfig(result.configId, result.loaded);
            return result;
          };
          const current = this.bound;
          if (current?.figureKey === draft.figureKey && current.generation === draft.figureGeneration) {
            const { configId } = registerDraftConfig();
            let snapshot: Awaited<ReturnType<AttachmentRuntime['upsert']>>;
            try {
              snapshot = await this.runtime.upsertPreview(current.owner, {
                figureKey: current.figureKey,
                attachmentId: current.attachmentId,
                entityId: current.entityId,
                configId,
                slot: current.slot,
                // Keep the runtime proxy hidden until the Creator-owned PNG textures
                // have been committed. Otherwise a source preset (for example the
                // straw hat used as a geometry base) can flash for one frame.
                visible: false,
              });
            } catch (error) {
              try {
                await this.restoreDeclaration(current);
              } finally {
                this.runtime.unregisterEphemeralConfig(configId);
              }
              throw error;
            }
            if (!this.isCurrent(operation)) {
              try {
                await this.restoreDeclaration(current);
              } finally {
                this.runtime.unregisterEphemeralConfig(configId);
              }
              return false;
            }
            if (snapshot.phase !== 'ready' || snapshot.figureGeneration !== draft.figureGeneration) {
              this.captureBindFailure(snapshot, draft.figureGeneration);
              try {
                await this.restoreDeclaration(current);
              } finally {
                this.runtime.unregisterEphemeralConfig(configId);
              }
              return false;
            }
            if (current.configId !== configId) this.runtime.unregisterEphemeralConfig(current.configId);
            current.configId = configId;
            return true;
          }

          await this.clearBound();
          if (!this.isCurrent(operation)) return false;
          const { configId } = registerDraftConfig();
          let owner: AttachmentPreviewOwner;
          try {
            owner = this.runtime.claimPreviewAttachment({
              figureKey: draft.figureKey,
              figureGeneration: draft.figureGeneration,
              attachmentId: this.previewAttachmentId,
              entityId: this.previewEntityId,
            });
          } catch (error) {
            this.runtime.unregisterEphemeralConfig(configId);
            throw error;
          }
          const candidate: BoundPreview = {
            owner,
            figureKey: draft.figureKey,
            generation: draft.figureGeneration,
            attachmentId: this.previewAttachmentId,
            entityId: this.previewEntityId,
            configId,
            // Preview is an adapter-owned diagnostic entity. It deliberately
            // does not occupy the authored slot, so an existing real runtime
            // attachment is never borrowed, overwritten, hidden, or restored
            // from an incomplete declaration snapshot.
            slot: undefined,
          };
          let snapshot: Awaited<ReturnType<AttachmentRuntime['upsert']>>;
          try {
            snapshot = await this.runtime.upsertPreview(candidate.owner, {
              figureKey: draft.figureKey,
              attachmentId: candidate.attachmentId,
              entityId: candidate.entityId,
              configId,
              slot: candidate.slot,
              visible: false,
            });
          } catch (error) {
            await this.releaseCandidate(candidate);
            throw error;
          }
          if (!this.isCurrent(operation)) {
            await this.releaseCandidate(candidate);
            return false;
          }
          if (snapshot.phase !== 'ready' || snapshot.figureGeneration !== draft.figureGeneration) {
            this.captureBindFailure(snapshot, draft.figureGeneration);
            await this.releaseCandidate(candidate);
            return false;
          }
          this.bound = candidate;
          if (this.applyPlacement(draft)) return true;
          this.bound = undefined;
          await this.releaseCandidate(candidate);
          return false;
        },
        false,
      );
    } finally {
      this.pendingAsyncCount -= 1;
    }
  }

  public applyHandCalibration(draft: CreatorDraft) {
    if(!draft.handBinding || !this.bound || this.bound.figureKey!==draft.figureKey ||
       this.bound.generation!==draft.figureGeneration || this.runtime.figureGeneration(this.bound.figureKey)!==this.bound.generation) return false;
    return this.runtime.previewHandCalibration(this.bound.figureKey,this.bound.attachmentId,draft.handBinding);
  }

  public applyPlacement(draft: CreatorDraft) {
    if (
      !this.bound ||
      this.bound.figureKey !== draft.figureKey ||
      this.bound.generation !== draft.figureGeneration ||
      this.runtime.figureGeneration(this.bound.figureKey) !== this.bound.generation
    )
      return false;
    const calibrated = this.runtime.previewCalibration(this.bound.figureKey, this.bound.attachmentId, {
      layerView: draft.layerMode === 'front-only' ? 'front' : draft.layerMode === 'back-only' ? 'back' : 'both',
      spriteAnchor: { ...draft.placement.spriteAnchor },
      offset: { ...draft.placement.offset },
      rotationOffsetRad: draft.placement.rotationOffsetRad,
      localScale: draft.placement.localScale,
      localScaleX: draft.placement.localScaleX,
      localScaleY: draft.placement.localScaleY,
      scaleMode: draft.placement.scaleMode,
      visualState: visualStateForDraft(draft),
    });
    return calibrated;
  }

  public setVisible(visible: boolean) {
    if (!this.bound || this.runtime.figureGeneration(this.bound.figureKey) !== this.bound.generation) return false;
    return this.runtime.setVisible(this.bound.figureKey, this.bound.attachmentId, visible);
  }

  /**
   * Commits visibility against the current Creator revision. Normal WebGAL
   * reconciliation can remove the DEV-only controller between texture decode
   * and the final visible commit. Recreate that exact hidden binding once and
   * restore the already decoded textures/placement before exposing it.
   */
  public async commitVisible(visible: boolean, draft?: CreatorDraft) {
    const operation = this.revision;
    const expected = this.bound;
    if (!expected) return false;
    if (visible && (!this.owned || !Object.values(this.owned.textures).some(Boolean))) return false;
    const frame = new AbortController();
    this.pendingFrame?.abort();
    this.pendingFrame = frame;
    this.pendingAsyncCount += 1;
    try {
      return await this.runMutation(
        operation,
        async () => {
          if (this.bound !== expected || this.runtime.figureGeneration(expected.figureKey) !== expected.generation)
            return false;
          const commitFrame = async () => {
            if (visible) await this.runtime.waitForPreviewFrame(expected.owner, 10_000, frame.signal, Boolean(draft?.handBinding));
            return this.isCurrent(operation) && this.bound === expected;
          };
          if (this.runtime.setVisible(expected.figureKey, expected.attachmentId, visible)) return commitFrame();
          const snapshot = await this.runtime.upsertPreview(expected.owner, {
            figureKey: expected.figureKey,
            attachmentId: expected.attachmentId,
            entityId: expected.entityId,
            configId: expected.configId,
            slot: expected.slot,
            visible: false,
          });
          if (
            !this.isCurrent(operation) ||
            this.bound !== expected ||
            snapshot.phase !== 'ready' ||
            snapshot.figureGeneration !== expected.generation
          )
            return false;
          if (
            this.owned &&
            !this.runtime.previewTextures(expected.figureKey, expected.attachmentId, this.owned.textures)
          )
            return false;
          if (draft && !this.applyPlacement(draft)) return false;
          return this.runtime.setVisible(expected.figureKey, expected.attachmentId, visible) ? commitFrame() : false;
        },
        false,
      );
    } catch (error) {
      if (!this.isCurrent(operation) || frame.signal.aborted) return false;
      throw error;
    } finally {
      if (this.pendingFrame === frame) this.pendingFrame = undefined;
      this.pendingAsyncCount -= 1;
    }
  }

  public binding() {
    if (!this.bound) return undefined;
    const { owner: _owner, ...binding } = this.bound;
    return binding;
  }

  public bindFailure() {
    return this.lastBindFailure ? { ...this.lastBindFailure } : undefined;
  }

  public invalidatePending() {
    this.beginOperation();
  }

  public async replaceTextures(options: {
    back?: CreatorBinaryInput;
    front?: CreatorBinaryInput;
    layerMode: CreatorDraft['layerMode'];
  }) {
    if (!this.bound) throw new Error('CREATOR_PREVIEW_NOT_BOUND');
    const expected = this.bound;
    const operation = this.beginOperation();
    this.pendingAsyncCount += 1;
    const urls: string[] = [];
    const textures: AttachmentTextureSet = {};
    try {
      for (const layer of ['back', 'front'] as const) {
        const input = options[layer];
        const enabled = options.layerMode === 'both' || options.layerMode === `${layer}-only`;
        if (!input || !enabled) continue;
        const url = URL.createObjectURL(new Blob([input.bytes], { type: 'image/png' }));
        urls.push(url);
        textures[layer] = await this.textureFromUrl(url);
        if (!this.isCurrent(operation)) {
          destroyOwned({ textures, urls });
          return false;
        }
      }
      if (!this.isCurrent(operation) || this.bound !== expected) {
        destroyOwned({ textures, urls });
        return false;
      }
      const next = { textures, urls };
      const committed = await this.runMutation(
        operation,
        async () => {
          if (this.bound !== expected) return false;
          if (!this.runtime.previewTextures(expected.figureKey, expected.attachmentId, textures)) {
            // A normal WebGAL state reconciliation may run while a project PNG is
            // decoding. Recreate only the binding captured by this operation;
            // a later bind/clear owns any newer controller and wins before commit.
            const rebound = await this.runtime.upsertPreview(expected.owner, {
              figureKey: expected.figureKey,
              attachmentId: expected.attachmentId,
              entityId: expected.entityId,
              configId: expected.configId,
              slot: expected.slot,
              visible: false,
            });
            if (
              !this.isCurrent(operation) ||
              this.bound !== expected ||
              rebound.phase !== 'ready' ||
              rebound.figureGeneration !== expected.generation ||
              !this.runtime.previewTextures(expected.figureKey, expected.attachmentId, textures)
            )
              return false;
          }
          const previous = this.owned;
          this.owned = next;
          destroyOwned(previous);
          return true;
        },
        false,
      );
      if (!committed) destroyOwned(next);
      return committed;
    } catch (error) {
      destroyOwned({ textures, urls });
      throw error;
    } finally {
      this.pendingAsyncCount -= 1;
    }
  }

  public async clear() {
    const operation = this.beginOperation();
    this.pendingAsyncCount += 1;
    try {
      await this.runMutation(operation, () => this.clearBound(), undefined);
    } finally {
      this.pendingAsyncCount -= 1;
    }
  }

  public diagnostics(): CreatorPreviewDiagnostics {
    const runtime = this.runtime.getDiagnostics();
    return {
      previewGeneration: this.revision,
      boundFigureKey: this.bound?.figureKey ?? null,
      boundFigureGeneration: this.bound?.generation ?? null,
      runtimeAttachmentCount: runtime.attachmentControllerCount,
      rootPairCount: runtime.layerPairCount,
      spriteCount: this.bound ? 2 : 0,
      textureCount: this.owned ? Object.values(this.owned.textures).filter(Boolean).length : 0,
      activeObjectUrlCount: this.owned?.urls.length ?? 0,
      pendingAsyncCount: this.pendingAsyncCount,
    };
  }

  public handStateDiagnostic() {
    return this.bound ? this.runtime.getHandStateDiagnostic(this.bound.figureKey, this.bound.attachmentId) : 'disabled';
  }
  public handAxisPreview(){return this.bound?this.runtime.getHandAxisPreview(this.bound.figureKey,this.bound.attachmentId):[];}

  private captureBindFailure(
    snapshot: Awaited<ReturnType<AttachmentRuntime['upsert']>>,
    expectedFigureGeneration: string,
  ) {
    const generationChanged = snapshot.figureGeneration !== expectedFigureGeneration;
    this.lastBindFailure = {
      code: snapshot.errorCode ?? (generationChanged ? 'FIGURE_GENERATION_CHANGED' : 'PREVIEW_NOT_READY'),
      message:
        snapshot.error ??
        (generationChanged
          ? '目标 figure generation 在预览创建期间发生变化'
          : `附件运行时未就绪（phase=${snapshot.phase}）`),
      phase: snapshot.phase,
      expectedFigureGeneration,
      actualFigureGeneration: snapshot.figureGeneration,
    };
  }

  private beginOperation() {
    this.pendingFrame?.abort();
    this.pendingFrame = undefined;
    this.pendingReadiness?.abort();
    this.pendingReadiness = undefined;
    this.revision += 1;
    return this.revision;
  }

  private isCurrent(operation: number) {
    return operation === this.revision;
  }

  private async runMutation<T>(operation: number, mutation: () => Promise<T> | T, staleResult: T): Promise<T> {
    const predecessor = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      if (!this.isCurrent(operation)) return staleResult;
      return await mutation();
    } finally {
      release();
    }
  }

  private async clearBound() {
    const bound = this.bound;
    const owned = this.owned;
    this.bound = undefined;
    this.owned = undefined;
    try {
      if (!bound) return;
      try {
        this.runtime.previewTextures(bound.figureKey, bound.attachmentId, undefined);
      } finally {
        this.runtime.previewCalibration(bound.figureKey, bound.attachmentId, undefined);
      }
    } finally {
      try {
        if (bound) this.runtime.releasePreviewAttachment(bound.owner);
      } finally {
        if (bound) this.runtime.unregisterEphemeralConfig(bound.configId);
        destroyOwned(owned);
      }
    }
  }

  private async restoreDeclaration(bound: BoundPreview) {
    await this.runtime.upsertPreview(bound.owner, {
      figureKey: bound.figureKey,
      attachmentId: bound.attachmentId,
      entityId: bound.entityId,
      configId: bound.configId,
      slot: bound.slot,
      visible: false,
    });
    if (this.owned) {
      this.runtime.previewTextures(bound.figureKey, bound.attachmentId, this.owned.textures);
    }
  }

  private async releaseCandidate(candidate: BoundPreview) {
    try {
      this.runtime.releasePreviewAttachment(candidate.owner);
    } finally {
      this.runtime.unregisterEphemeralConfig(candidate.configId);
    }
  }

  private createEphemeralConfig(
    draft: CreatorDraft,
    profile: Live2DModelProfile,
    operation: number,
  ): {
    configId: string;
    loaded: LoadedAttachmentConfig;
  } {
    const compatibleNames = compatibleAnchorNames(draft.anchorName);
    const anchor = profile.anchors.find((candidate) => compatibleNames.includes(candidate.name));
    if (!anchor) throw new Error(`CREATOR_ANCHOR_NOT_FOUND:${profile.modelProfileId}/${draft.anchorName}`);
    // Layered preset ids require the suffix to begin with an ASCII letter or
    // digit. Keep the in-memory id inside the same ordinary v2 namespace so it
    // passes the exact validator used by saved attachments.
    const configId = `v2/creator-preview-${this.previewOwner}-${profile.modelProfileId}-${anchor.name}-op${operation}`;
    // A transparent pixel is the only initial texture. Creator PNGs are
    // committed atomically while the runtime proxy is hidden.
    const transparentPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAgH9lY5ZAAAAAElFTkSuQmCC';
    return {
      configId,
      loaded: {
        sourceUrl: `creator-memory://${encodeURIComponent(profile.modelProfileId)}/${encodeURIComponent(anchor.name)}`,
        config: {
          schema: ATTACHMENT_CONFIG_SCHEMA,
      ...(draft.handBinding ? { handBinding: cloneAttachmentHandBinding(draft.handBinding) } : {}),
          configId,
          target: {
            modelPath: profile.modelPath,
            anchorProfile: {
              drawableId: anchor.drawableId,
              anchors: anchor.points.map((point) => ({
                index: point.index,
                weight: point.weight,
                neutral: { ...point.neutral },
              })),
            },
          },
          fit: { scaleMode: draft.placement.scaleMode },
          layers: { front: transparentPng },
          attachedLayers: { front: transparentPng },
          placement: {
            spriteAnchor: { ...draft.placement.spriteAnchor },
            offset: { ...draft.placement.offset },
            rotationOffsetRad: draft.placement.rotationOffsetRad,
            localScale: draft.placement.localScale,
            localScaleX: draft.placement.localScaleX,
            localScaleY: draft.placement.localScaleY,
          },
          initialVisualState: visualStateForDraft(draft),
        },
        modelBinding: {
          modelProfileId: profile.modelProfileId,
          characterId: profile.characterId,
          modelId: profile.modelId,
          modelPath: profile.modelPath,
          profileVersion: profile.profileVersion,
          presetApprovalStatus: 'candidate',
          fingerprint: { ...profile.fingerprint },
          anchorName: anchor.name,
          anchorProfileId: anchor.anchorProfileId,
          drawableId: anchor.drawableId,
          vertexCount: anchor.vertexCount,
          anchorVertexIndices: anchor.points.map((point) => point.index),
        },
      },
    };
  }
}
