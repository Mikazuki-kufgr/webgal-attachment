import { registerCubism2HandRenderer, type HandRenderPresentation } from './Cubism2HandRenderer';
import { handAppearanceSupported, parseAttachmentHandBinding, type AttachmentHandBinding, type AttachmentHandState } from './handBinding';
import { reflectHandPoint, resolveHandFlipAxis } from './handLocalFlip';
import type { Live2DModel } from 'pixi-live2d-display-webgal';
import * as PIXI from 'pixi.js';
import { applyLocalOpacity, effectiveLocalOpacity, effectiveWorldOpacity } from '../effectiveOpacity';

import type {
  AttachmentConfig,
  AttachmentRuntimeErrorCode,
  AttachmentScaleMode,
  AttachmentTextureSet,
} from '@/Core/controller/stage/pixi/attachments/types';
import type { Live2DAttachmentLayers } from '@/Core/controller/stage/pixi/live2dAttachments';
import type { Live2DCurrentFrame, Live2DFrameDriverStats } from '@/Core/controller/stage/pixi/live2dFrameDriver';
import { fitRigid2D, type Point2D, type RigidFit2D } from '@/Core/controller/stage/pixi/live2dRigidFit';
import { WebGALPixiContainer } from '@/Core/controller/stage/pixi/WebGALPixiContainer';
import {
  applyAttachmentEntityAppearance,
  applyAttachmentEntityVisualState,
  cloneAttachmentEntityVisualState,
  readAttachmentEntityVisualState,
  destroyAttachmentEntityAppearance,
  type AttachmentEntityVisualState,
} from './stageEntityVisualState';
import { AttachmentFitFailurePolicy } from './attachmentFitFailurePolicy';
import {
  reparentPreserveWorld,
  type ReparentPreserveWorldOptions,
  type ReparentPreserveWorldResult,
} from '@/Core/controller/stage/pixi/reparentPreserveWorld';

const ATTACHMENT_SPRITE_PLUGIN_NAME = '__webgal_attachment_single_texture_batch__';
export const DETACH_PRESENTATION_ALPHA_EPSILON = 1e-8;

/** Renderer-scoped Sprite batch that avoids Cubism 2's stale multi-sampler state. */
class AttachmentSingleTextureBatchRenderer extends PIXI.BatchRenderer {
  public contextChange() {
    const previousMaximum = PIXI.settings.SPRITE_MAX_TEXTURES;
    try {
      PIXI.settings.SPRITE_MAX_TEXTURES = 1;
      super.contextChange();
    } finally {
      PIXI.settings.SPRITE_MAX_TEXTURES = previousMaximum;
    }
  }
}

function ensureAttachmentSpriteRenderer(renderer: PIXI.Renderer) {
  const plugins = renderer.plugins as Record<string, PIXI.ObjectRenderer | undefined>;
  if (plugins[ATTACHMENT_SPRITE_PLUGIN_NAME]) return;
  const plugin = new AttachmentSingleTextureBatchRenderer(renderer);
  plugin.contextChange();
  plugins[ATTACHMENT_SPRITE_PLUGIN_NAME] = plugin;
}

/** Flushes Pixi state around a Sprite rendered next to Cubism 2 raw WebGL. */
class SpriteRenderBoundary extends PIXI.Container {
  public constructor(private readonly restoreRenderTarget: boolean, private readonly sprite?: PIXI.Sprite) {
    super();
  }

  protected _render(renderer: PIXI.Renderer) {
    const renderTexture = this.restoreRenderTarget ? renderer.renderTexture.current : undefined;
    const sourceFrame = this.restoreRenderTarget ? renderer.renderTexture.sourceFrame.clone() : undefined;
    const destinationFrame = this.restoreRenderTarget ? renderer.renderTexture.destinationFrame.clone() : undefined;
    renderer.batch.flush();
    renderer.geometry.reset();
    renderer.shader.reset();
    renderer.state.reset();
    renderer.texture.reset();
    if (this.restoreRenderTarget) {
      renderer.framebuffer.reset();
      renderer.renderTexture.bind(renderTexture ?? undefined, sourceFrame, destinationFrame);
      renderer.gl.colorMask(true, true, true, true);
    }
    if (this.sprite) ensureAttachmentSpriteRenderer(renderer);
  }
}

function mapPoint(point: Point2D, matrix: PIXI.Matrix): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function sameAttachedVisualState(left: AttachmentEntityVisualState | undefined, right: AttachmentEntityVisualState) {
  if (!left) return false;
  const leftAppearance = left.appearance;
  const rightAppearance = right.appearance;
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.scale.x === right.scale.x &&
    left.scale.y === right.scale.y &&
    left.rotation === right.rotation &&
    (left.skew?.x ?? 0) === (right.skew?.x ?? 0) &&
    (left.skew?.y ?? 0) === (right.skew?.y ?? 0) &&
    left.opacity === right.opacity &&
    left.visible === right.visible &&
    (leftAppearance?.blur ?? 0) === (rightAppearance?.blur ?? 0) &&
    (leftAppearance?.brightness ?? 1) === (rightAppearance?.brightness ?? 1) &&
    (leftAppearance?.contrast ?? 1) === (rightAppearance?.contrast ?? 1) &&
    (leftAppearance?.saturation ?? 1) === (rightAppearance?.saturation ?? 1) &&
    (leftAppearance?.gamma ?? 1) === (rightAppearance?.gamma ?? 1) &&
    (leftAppearance?.color.red ?? 255) === (rightAppearance?.color.red ?? 255) &&
    (leftAppearance?.color.green ?? 255) === (rightAppearance?.color.green ?? 255) &&
    (leftAppearance?.color.blue ?? 255) === (rightAppearance?.color.blue ?? 255) &&
    (leftAppearance?.bevel?.strength ?? 0) === (rightAppearance?.bevel?.strength ?? 0) &&
    (leftAppearance?.bevel?.thickness ?? 0) === (rightAppearance?.bevel?.thickness ?? 0) &&
    (leftAppearance?.bevel?.rotation ?? 0) === (rightAppearance?.bevel?.rotation ?? 0) &&
    (leftAppearance?.bevel?.softness ?? 0) === (rightAppearance?.bevel?.softness ?? 0) &&
    (leftAppearance?.bevel?.color.red ?? 255) === (rightAppearance?.bevel?.color.red ?? 255) &&
    (leftAppearance?.bevel?.color.green ?? 255) === (rightAppearance?.bevel?.color.green ?? 255) &&
    (leftAppearance?.bevel?.color.blue ?? 255) === (rightAppearance?.bevel?.color.blue ?? 255) &&
    (leftAppearance?.bloom?.strength ?? 0) === (rightAppearance?.bloom?.strength ?? 0) &&
    (leftAppearance?.bloom?.brightness ?? 1) === (rightAppearance?.bloom?.brightness ?? 1) &&
    (leftAppearance?.bloom?.blur ?? 0) === (rightAppearance?.bloom?.blur ?? 0) &&
    (leftAppearance?.bloom?.threshold ?? 0) === (rightAppearance?.bloom?.threshold ?? 0) &&
    (leftAppearance?.shockwave ?? 0) === (rightAppearance?.shockwave ?? 0) &&
    (leftAppearance?.radiusAlpha ?? 0) === (rightAppearance?.radiusAlpha ?? 0)
  );
}

export class HatAttachmentError extends Error {
  public constructor(
    public readonly code: Extract<
      AttachmentRuntimeErrorCode,
      'DRAWABLE_NOT_FOUND' | 'VERTEX_OUT_OF_RANGE' | 'RUNTIME_CREATE_FAILED'
    >,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HatAttachmentError';
  }
}

function pointFromVertices(vertices: ArrayLike<number>, index: number): Point2D {
  const x = vertices[index * 2];
  const y = vertices[index * 2 + 1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new HatAttachmentError('VERTEX_OUT_OF_RANGE', `Drawable vertex ${index} is unavailable or non-finite`);
  }
  return { x, y };
}

function destroyRoot(root: PIXI.Container) {
  root.parent?.removeChild(root);
  root.destroy({ children: true, texture: false, baseTexture: false });
}

interface HatAttachmentControllerBaseOptions {
  renderer?: PIXI.Renderer;
  instanceId: string;
  config: AttachmentConfig;
  textures: AttachmentTextureSet;
  transformHost: WebGALPixiContainer;
  onError?: (error: HatAttachmentError) => void;
}

export type HatAttachmentControllerOptions = HatAttachmentControllerBaseOptions &
  (
    | { model: Live2DModel; layers: Live2DAttachmentLayers; free?: never }
    | {
        model?: never;
        layers?: never;
        free: { parent: PIXI.Container; visualState: AttachmentEntityVisualState & { space: 'world' } };
      }
  );

export type AttachmentCalibrationLayerView = 'back' | 'front' | 'both';

export interface AttachmentPresentationTransition {
  visualState: AttachmentEntityVisualState;
  reparent: ReparentPreserveWorldResult;
  proxyIdentityTokens: [string, string] | [string, string, string];
  representation: 'layer-composition' | 'full';
  presentation: AttachmentPresentationContinuityEvidence;
}

export interface AttachmentEffectivePresentationState {
  visible: boolean;
  renderable: boolean;
  worldAlpha: number;
}

export interface AttachmentProxyPresentationEvidence {
  identityToken: string;
  before: AttachmentEffectivePresentationState;
  afterReparent: AttachmentEffectivePresentationState;
  final: AttachmentEffectivePresentationState;
}

export interface AttachmentPresentationContinuityEvidence {
  logicalVisible: boolean;
  representation: 'layer-composition' | 'full';
  hostFinal: AttachmentEffectivePresentationState;
  proxies: AttachmentProxyPresentationEvidence[];
}

export interface AttachmentDetachFrameReadiness {
  ready: boolean;
  reason?:
    | 'controller-destroyed'
    | 'presentation-not-attached'
    | 'anchor-pose-unavailable'
    | 'hand-transition-in-progress'
    | 'source-ancestry-hidden'
    | 'source-ancestry-not-renderable'
    | 'source-ancestry-alpha-unavailable'
    | 'target-parent-hidden'
    | 'target-parent-not-renderable'
    | 'target-parent-alpha-unavailable'
    | 'non-finite-matrix'
    | 'target-parent-singular';
  logicalVisible: boolean;
  hasValidPose: boolean;
  matricesFinite: boolean;
  targetParentDeterminant: number;
  sourceAncestry: AttachmentEffectivePresentationState;
  targetParent: AttachmentEffectivePresentationState;
}

/** Ephemeral, absolute placement candidate used by diagnostics. */
export interface HatAttachmentCalibrationPreview {
  layerView: AttachmentCalibrationLayerView;
  spriteAnchor: Point2D;
  offset: Point2D;
  rotationOffsetRad: number;
  localScale: number;
  localScaleX?: number;
  localScaleY?: number;
  scaleMode: AttachmentScaleMode;
  visualState?: AttachmentEntityVisualState & { space: 'local' };
}

type HandPoseFit=RigidFit2D & {handOffset?:Point2D;handFlip?:{origin:Point2D;angleRad:number;source:string}};

/** Production hat controller: no DOM, globals, tracing, overlay, or asset loading. */
export class HatAttachmentController {
  private readonly backPose = new PIXI.Container();
  private readonly frontPose = new PIXI.Container();
  private readonly backContent = new WebGALPixiContainer();
  private readonly frontContent = new WebGALPixiContainer();
  private readonly backProxy = new WebGALPixiContainer();
  private readonly frontProxy = new WebGALPixiContainer();
  private readonly fullProxy?: WebGALPixiContainer;
  private readonly backSprite: PIXI.Sprite;
  private readonly frontSprite: PIXI.Sprite;
  private readonly fullSprite?: PIXI.Sprite;
  private visible = true;
  private visibilityFactor = 1;
  private hasValidPose = false;
  private destroyed = false;
  private unregisterHandRenderer?: () => void;
  private handRendererModel?: Live2DModel;
  private handTargetRenderer?: PIXI.Renderer;
  private handCoverage = 0;
  private handPresentations: HandRenderPresentation[] = [];
  private handStateDiagnostic: 'disabled' | 'supported' | 'unsupported-state' = 'disabled';
  private lastError?: Error;
  private lastFit?: HandPoseFit;
  private handCalibrationPreview?: AttachmentHandBinding;
  private get handBinding() { return this.handCalibrationPreview ?? this.options.config.handBinding; }

  /** Updates only calibration on the same model, texture and drawable registration.
   * The existing frame driver renders the latest candidate; no async rebuild. */
  public setHandCalibrationPreview(candidate: AttachmentHandBinding) {
    const base=this.options.config.handBinding;
    if(this.destroyed || this.presentationState !== 'attached' || !base || !this.model) return false;
    const parsed=parseAttachmentHandBinding(candidate);
    const geometry=(b:AttachmentHandBinding)=>JSON.stringify({runtime:b.runtime,textureLayer:b.textureLayer,
      states:b.states.map(({id,drawableId,anchors,contact})=>({id,drawableId,anchors,contact}))});
    if(geometry(parsed)!==geometry(base)) return false;
    this.handCalibrationPreview=parsed;
    return true;
  }
  private readonly fitFailurePolicy = new AttachmentFitFailurePolicy();
  private calibrationPreview?: HatAttachmentCalibrationPreview;
  private calibrationTextures?: AttachmentTextureSet;
  private model?: Live2DModel;
  private layers?: Live2DAttachmentLayers;
  private presentationState: 'attached' | 'free' = 'attached';
  private transformHostParkingRevision = 0;
  private freeVisibilityContinuityFactor = true;
  private freeRuntimeRenderable = true;
  private attachedVisualSyncCount = 0;
  private attachedVisualSyncAttempts = 0;
  private attachedVisualSyncSkips = 0;
  private attachedVisualProxyApplyCount = 0;
  private lastAttachedVisualLayerMask = -1;
  private lastAttachedVisualSync?: AttachmentEntityVisualState;

  public constructor(private readonly options: HatAttachmentControllerOptions) {
    this.model = options.model;
    this.layers = options.layers;
    this.backSprite = new PIXI.Sprite(options.textures.back ?? PIXI.Texture.EMPTY);
    this.frontSprite = new PIXI.Sprite(options.textures.front ?? PIXI.Texture.EMPTY);
    if (options.textures.full) {
      this.fullProxy = new WebGALPixiContainer();
      this.fullSprite = new PIXI.Sprite(options.textures.full);
    }

    this.backPose.name = `__webgal_attachment_${options.instanceId}_back_pose__`;
    this.frontPose.name = `__webgal_attachment_${options.instanceId}_front_pose__`;
    this.backContent.name = `__webgal_attachment_${options.instanceId}_back_content__`;
    this.frontContent.name = `__webgal_attachment_${options.instanceId}_front_content__`;
    this.backProxy.name = `__webgal_attachment_${options.instanceId}_back_proxy__`;
    this.frontProxy.name = `__webgal_attachment_${options.instanceId}_front_proxy__`;
    this.backSprite.name = `__webgal_attachment_${options.instanceId}_back_sprite__`;
    this.frontSprite.name = `__webgal_attachment_${options.instanceId}_front_sprite__`;
    if (this.fullProxy && this.fullSprite) {
      this.fullProxy.name = `__webgal_attachment_${options.instanceId}_full_proxy__`;
      this.fullSprite.name = `__webgal_attachment_${options.instanceId}_full_sprite__`;
      this.installSprite(this.fullProxy, this.fullSprite, true);
    }

    this.installSprite(this.backProxy, this.backSprite, Boolean(options.textures.back));
    this.installSprite(this.frontProxy, this.frontSprite, Boolean(options.textures.front));
    this.backContent.addChild(this.backProxy);
    this.frontContent.addChild(this.frontProxy);
    this.backPose.addChild(this.backContent);
    this.frontPose.addChild(this.frontContent);
    if (this.layers) {
      this.layers.back.addChild(this.backPose);
      this.layers.front.addChild(this.frontPose);
    }
    this.applyStaticPlacement();
    try { if (options.config.handBinding && this.model) {
      this.unregisterHandRenderer = this.registerHandRenderer(this.model);
      this.handRendererModel = this.model;
    }
    if (options.free) this.restoreFree(options.free.parent, options.free.visualState);
    else this.applyPoseVisibility();
    } catch (error) { this.destroy(); throw error; }
  }

  /** Cold free restoration has no live model to validate or sample. */
  public hasAttachedModelReference() {
    return this.model !== undefined;
  }

  private requireModel() {
    if (!this.model) throw new Error('Attached presentation requires a Live2D model');
    return this.model;
  }

  private registerHandRenderer(model: Live2DModel) {
    const options = this.options, binding = this.handBinding!;
    const renderer = this.handTargetRenderer ?? options.renderer;
    if (!renderer) throw new HatAttachmentError('RUNTIME_CREATE_FAILED', 'HAND_RENDERER_REQUIRED');
    if (!options.textures[binding.textureLayer] || (options.textures.front && options.textures.back))
      throw new HatAttachmentError('RUNTIME_CREATE_FAILED', 'HAND_SINGLE_TEXTURE_REQUIRED:手部内部遮挡必须使用一张匹配素材');
    for (const state of binding.states) if (model.internalModel.getDrawableIndex(state.drawableId) < 0)
      throw new HatAttachmentError('DRAWABLE_NOT_FOUND', 'HAND_STATE_DRAWABLE_MISSING:' + state.drawableId);
    return registerCubism2HandRenderer(model, {
      renderer,
      presentations: () => this.presentationState === 'attached' && !this.destroyed && this.visible ? this.handPresentations : [],
      fail: error => { if (this.destroyed) return; this.destroy(); options.onError?.(new HatAttachmentError('RUNTIME_CREATE_FAILED', error.message, { cause: error })); },
    });
  }

  private requireLayers() {
    if (!this.layers) throw new Error('Attached presentation requires Live2D layers');
    return this.layers;
  }

  public update(_frame: Live2DCurrentFrame, _stats: Live2DFrameDriverStats) {
    if (this.destroyed) return;
    try {
      if (this.presentationState === 'free') return;
      const fit = this.handBinding ? this.prepareHandFrame() : this.calculateFit(this.requireModel());
      if(!fit){this.hasValidPose=false;this.handPresentations=[];this.applyPoseVisibility();return;}
      this.applyFit(fit);
      this.syncAttachedVisualState();
      this.hasValidPose = true;
      this.applyPoseVisibility();
      this.lastFit = fit;
      if(this.handBinding)this.handPresentations=this.buildHandPresentations();
      this.fitFailurePolicy.recordSuccess();
      this.lastError = undefined;
    } catch (error) {
      const normalized =
        error instanceof HatAttachmentError
          ? error
          : new HatAttachmentError(
              'RUNTIME_CREATE_FAILED',
              error instanceof Error ? error.message : String(error),
              error instanceof Error ? { cause: error } : undefined,
            );
      this.lastError = normalized;
      const retryable = normalized.code !== 'DRAWABLE_NOT_FOUND';
      if (this.fitFailurePolicy.recordFailure(retryable)) {
        // Preserve the last valid pose for a bounded number of frames. Before
        // the first valid pose, applyPoseVisibility keeps every proxy hidden.
        this.applyPoseVisibility();
        return;
      }
      // Persistent or structural failures must never leave a stale attachment frozen on screen.
      // destroy() makes the controller terminal before notifying its owner, so
      // even an identical retryable error is reported exactly once.
      this.destroy();
      this.options.onError?.(normalized);
    }
  }

  public setVisible(visible: boolean) {
    this.visible = visible;
    this.visibilityFactor = visible ? 1 : 0;
    if (this.presentationState === 'free') this.options.transformHost.visible = visible;
    this.applyPoseVisibility();
  }

  public beginVisibilityTransition() {
    this.visible = true;
    this.applyPoseVisibility();
  }

  public setVisibilityFactor(value: number) {
    this.visibilityFactor = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    this.applyPoseVisibility();
  }

  public getVisibilityFactor() {
    return this.visibilityFactor;
  }

  public isVisible() {
    return this.visible;
  }

  /**
   * Runs from the shared ticker before Pixi traverses back -> model -> front.
   * This keeps both layer proxies on one command-owned opacity/visibility
   * snapshot; the figure container's real transition remains their ancestor.
   */
  public syncVisualStateForRender() {
    if (this.destroyed) return;
    if (this.presentationState === 'free') {
      this.publishFreeTransformChain();
      return;
    }
    this.syncAttachedVisualState();
    this.applyPoseVisibility();
    this.publishAttachedWorldTransforms();
  }

  /** Read-only frame evidence for transition validation; never mutates serializable state. */
  public getTransitionVisualSnapshot() {
    if (!this.destroyed && this.presentationState === 'attached') this.publishAttachedWorldTransforms();
    const figureContainer = this.model?.parent;
    const proxy = (layer: 'back' | 'front', value: WebGALPixiContainer) => ({
      layer,
      exists: !this.destroyed && !value.destroyed && value.parent !== null,
      localAlpha: effectiveLocalOpacity(value),
      worldAlpha: effectiveWorldOpacity(value),
      visible: effectiveBoolean(value, 'visible'),
      renderable: effectiveBoolean(value, 'renderable'),
      renderHost: value.parent?.parent?.name ?? value.parent?.name ?? '',
    });
    return {
      state: this.destroyed ? ('destroyed' as const) : this.presentationState,
      attachmentLocalOpacity: effectiveLocalOpacity(this.options.transformHost),
      attachmentLogicalVisible: this.visible,
      attachmentVisibilityFactor: this.visibilityFactor,
      figureLocalAlpha: figureContainer ? effectiveLocalOpacity(figureContainer) : 0,
      figureWorldAlpha: figureContainer ? effectiveWorldOpacity(figureContainer) : 0,
      figureVisible: figureContainer ? effectiveBoolean(figureContainer, 'visible') : false,
      figureRenderable: figureContainer ? effectiveBoolean(figureContainer, 'renderable') : false,
      back: proxy('back', this.backProxy),
      front: proxy('front', this.frontProxy),
    };
  }

  /** DEV authoring seam: swaps sprite textures without owning or destroying them. */
  public setCalibrationTextures(textures: AttachmentTextureSet | undefined) {
    if (this.destroyed) return false;
    this.calibrationTextures = textures ? { ...textures } : undefined;
    const active = this.calibrationTextures ?? this.options.textures;
    this.backSprite.texture = active.back ?? PIXI.Texture.EMPTY;
    this.frontSprite.texture = active.front ?? PIXI.Texture.EMPTY;
    this.backSprite.visible = Boolean(active.back);
    this.frontSprite.visible = Boolean(active.front);
    this.lastAttachedVisualSync = undefined;
    this.lastAttachedVisualLayerMask = -1;
    this.applyPoseVisibility();
    return true;
  }

  public getLastError() {
    return this.lastError;
  }

  public getLastFit() {
    return this.lastFit;
  }

  public getPresentationState() {
    return this.presentationState;
  }

  public getRepresentationKind() {
    return this.presentationState === 'free' && this.fullProxy ? ('full' as const) : ('layer-composition' as const);
  }

  public hasConfiguredFreeRenderable() {
    return this.fullProxy !== undefined;
  }

  public getTransformHost() {
    return this.options.transformHost;
  }

  /** Rebuilds a settled free representation directly from logical state. */
  public restoreFree(freeParent: PIXI.Container, visualState: AttachmentEntityVisualState & { space: 'world' }) {
    if (this.destroyed) throw new Error('Attachment controller is destroyed');
    if (this.presentationState !== 'attached') throw new Error('Attachment is already free');
    const host = this.options.transformHost;
    // Cross-model reattach candidates share the stable entity host with the
    // visible origin controller. Preserve its existing sibling slot while the
    // candidate is still only a hidden preflight owner.
    if (host.parent !== freeParent) {
      host.parent?.removeChild(host);
      freeParent.addChild(host);
    }
    // A normal detach always parks both attached proxies under the free host,
    // even when a dedicated full sprite is the active free representation.
    // Rebuild the same ownership graph after persistence restore so a later
    // reattach can preserve the restored host transform and opacity instead of
    // treating the disconnected attached-content parents as already current.
    this.backProxy.parent?.removeChild(this.backProxy);
    this.frontProxy.parent?.removeChild(this.frontProxy);
    host.addChild(this.backProxy, this.frontProxy);
    this.backPose.parent?.removeChild(this.backPose);
    this.frontPose.parent?.removeChild(this.frontPose);
    this.presentationState = 'free';
    this.releaseHandRenderer();
    this.freeVisibilityContinuityFactor = true;
    this.freeRuntimeRenderable = true;
    this.activateFreeRepresentation();
    applyAttachmentEntityVisualState(host, visualState);
    this.visible = visualState.visible;
    this.applyPoseVisibility();
    host.renderable = true;
    return cloneAttachmentEntityVisualState(readAttachmentEntityVisualState(host, 'world'));
  }

  public getProxyIdentityTokens(): [string, string] | [string, string, string] {
    return this.fullProxy
      ? [this.backProxy.name, this.frontProxy.name, this.fullProxy.name]
      : [this.backProxy.name, this.frontProxy.name];
  }

  public getOwnedFilterInstanceCount() {
    return [this.backProxy, this.frontProxy, this.fullProxy]
      .filter((proxy): proxy is WebGALPixiContainer => proxy !== undefined)
      .reduce((total, proxy) => total + proxy.containerFilters.size, 0);
  }

  public getVisualSyncDiagnostics() {
    return {
      attachedVisualSyncCount: this.attachedVisualSyncCount,
      attachedVisualSyncAttempts: this.attachedVisualSyncAttempts,
      attachedVisualSyncSkips: this.attachedVisualSyncSkips,
      attachedVisualProxyApplyCount: this.attachedVisualProxyApplyCount,
      lastAttachedVisualSync: this.lastAttachedVisualSync,
    };
  }

  /**
   * Evaluates detach readiness against the just-updated frame. Logical entity
   * hiding is deliberately excluded from the source ancestry gate.
   */
  public getDetachFrameReadiness(
    freeParent: PIXI.Container,
    epsilon = DETACH_PRESENTATION_ALPHA_EPSILON,
  ): AttachmentDetachFrameReadiness {
    const emptyState: AttachmentEffectivePresentationState = {
      visible: false,
      renderable: false,
      worldAlpha: Number.NaN,
    };
    const base = {
      logicalVisible: this.visible,
      hasValidPose: this.hasValidPose,
      matricesFinite: false,
      targetParentDeterminant: Number.NaN,
      sourceAncestry: emptyState,
      targetParent: emptyState,
    };
    if (this.destroyed) return { ...base, ready: false, reason: 'controller-destroyed' };
    if (this.presentationState !== 'attached') {
      return { ...base, ready: false, reason: 'presentation-not-attached' };
    }
    if (!this.hasValidPose) {
      return { ...base, ready: false, reason: 'anchor-pose-unavailable' };
    }
    if (this.handBinding && this.handSamples().filter(sample => sample.weight > 1e-4).length > 1)
      return { ...base, ready: false, reason: 'hand-transition-in-progress' };

    freeParent.updateTransform();
    this.publishAttachedTransformChains();
    const representativePose = this.getRepresentativePose();
    const sourceRoot = representativePose.parent;
    const sourceAncestry = sourceRoot ? captureEffectivePresentation(sourceRoot) : emptyState;
    const targetParent = captureEffectivePresentation(freeParent);
    const targetMatrix = freeParent.worldTransform;
    const targetParentDeterminant = targetMatrix.a * targetMatrix.d - targetMatrix.b * targetMatrix.c;
    const matricesFinite = [
      freeParent,
      this.requireLayers().back,
      this.backPose,
      this.backContent,
      this.backProxy,
      this.requireLayers().front,
      this.frontPose,
      this.frontContent,
      this.frontProxy,
    ].every(hasFiniteWorldMatrix);
    const result = {
      logicalVisible: this.visible,
      hasValidPose: this.hasValidPose,
      matricesFinite,
      targetParentDeterminant,
      sourceAncestry,
      targetParent,
    };

    if (!matricesFinite) return { ...result, ready: false, reason: 'non-finite-matrix' };
    if (!Number.isFinite(targetParentDeterminant) || Math.abs(targetParentDeterminant) <= 1e-10) {
      return { ...result, ready: false, reason: 'target-parent-singular' };
    }
    // Logical entity hiding is represented by `this.visible` and is allowed.
    // An unavailable source ancestry is different: committing from it would
    // capture a hidden frame and then reveal the free host, causing a pop-in.
    if (!sourceAncestry.visible) {
      return { ...result, ready: false, reason: 'source-ancestry-hidden' };
    }
    if (!sourceAncestry.renderable) {
      return { ...result, ready: false, reason: 'source-ancestry-not-renderable' };
    }
    if (!Number.isFinite(sourceAncestry.worldAlpha) || Math.abs(sourceAncestry.worldAlpha) <= epsilon) {
      return { ...result, ready: false, reason: 'source-ancestry-alpha-unavailable' };
    }
    if (!targetParent.visible) {
      return { ...result, ready: false, reason: 'target-parent-hidden' };
    }
    if (!targetParent.renderable) {
      return {
        ...result,
        ready: false,
        reason: 'target-parent-not-renderable',
      };
    }
    if (!Number.isFinite(targetParent.worldAlpha) || Math.abs(targetParent.worldAlpha) <= epsilon) {
      return {
        ...result,
        ready: false,
        reason: 'target-parent-alpha-unavailable',
      };
    }
    return { ...result, ready: true };
  }

  /** Publish the complete attached ancestry after same-frame fit/placement writes. */
  private publishAttachedTransformChains() {
    this.requireLayers().back.updateTransform();
    this.backPose.updateTransform();
    this.backContent.updateTransform();
    this.backProxy.updateTransform();
    this.requireLayers().front.updateTransform();
    this.frontPose.updateTransform();
    this.frontContent.updateTransform();
    this.frontProxy.updateTransform();
  }

  /** Publish the free host before either proxy is captured for reattachment. */
  private publishFreeTransformChain() {
    this.options.transformHost.updateTransform();
    this.backProxy.updateTransform();
    this.frontProxy.updateTransform();
  }

  /**
   * Promotes the two internal render proxies into one free transform host.
   * The caller must publish current layer/parent transforms in the same frame.
   */
  public detachToFree(
    freeParent: PIXI.Container,
    options: ReparentPreserveWorldOptions = {},
  ): AttachmentPresentationTransition {
    if (this.destroyed) throw new Error('Attachment controller is destroyed');
    if (this.presentationState !== 'attached') throw new Error('Attachment is already free');
    if (!this.hasValidPose) throw new Error('Attachment has no valid current-frame anchor pose');

    const readiness = this.getDetachFrameReadiness(freeParent);
    if (!readiness.ready) {
      throw new Error(`Attachment detach frame is not ready: ${readiness.reason}`);
    }

    freeParent.updateTransform();
    this.publishAttachedTransformChains();
    const representative = this.getRepresentativeProxy();
    const detachedLayerView = this.getCalibrationPreview().layerView;
    let sourceStageSibling: PIXI.DisplayObject = representative;
    while (sourceStageSibling.parent && sourceStageSibling.parent !== freeParent) {
      sourceStageSibling = sourceStageSibling.parent;
    }
    const sourceStageIndex =
      sourceStageSibling.parent === freeParent
        ? freeParent.getChildIndex(sourceStageSibling)
        : freeParent.children.length;
    const beforeRepresentative = captureEffectivePresentation(representative);
    const parentWorld = freeParent.worldTransform.clone();
    const determinant = parentWorld.a * parentWorld.d - parentWorld.b * parentWorld.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-10) {
      throw new Error('Free entity parent world transform is not invertible');
    }

    const host = this.options.transformHost;
    const previousHostParent = host.parent;
    const previousHostIndex = previousHostParent?.getChildIndex(host) ?? -1;
    const previousHostState = readAttachmentEntityVisualState(host, 'local');
    const previousHostOpacityChannels = { alpha: host.alpha, alphaFilter: host.alphaFilterVal };
    const previousHostPivot = { x: host.pivot.x, y: host.pivot.y };
    const previousHostRenderable = host.renderable;
    const previousHostZIndex = host.zIndex;
    const previousFreeVisibilityContinuityFactor = this.freeVisibilityContinuityFactor;
    const previousFreeRuntimeRenderable = this.freeRuntimeRenderable;

    try {
      // A compensating reattach rollback can detach again while the empty host
      // is already parked under this same parent. Keep its sibling slot stable
      // during the active Pixi render traversal instead of remove/add reordering.
      if (host.parent !== freeParent) {
        host.parent?.removeChild(host);
        const putBehind = detachedLayerView === 'back';
        const insertionIndex = Math.max(
          0,
          Math.min(sourceStageIndex + (putBehind ? 0 : 1), freeParent.children.length),
        );
        freeParent.addChildAt(host, insertionIndex);
        // figureContainer may use sortableChildren, in which case sibling
        // insertion order alone is insufficient. Preserve the attachment's
        // front/back semantic relative to the source figure in both modes.
        host.zIndex = sourceStageSibling.zIndex + (putBehind ? -0.001 : 0.001);
      }
      const hostLocal = representative.worldTransform.clone().prepend(parentWorld.invert());
      host.transform.setFromMatrix(hostLocal);
      const freeParentOpacity = effectiveWorldOpacity(freeParent);
      applyLocalOpacity(
        host,
        Math.abs(freeParentOpacity) <= DETACH_PRESENTATION_ALPHA_EPSILON
          ? 1
          : effectiveWorldOpacity(representative) / freeParentOpacity,
      );
      this.freeVisibilityContinuityFactor = this.visible ? beforeRepresentative.visible : true;
      this.freeRuntimeRenderable = beforeRepresentative.renderable;
      host.visible = this.visible && this.freeVisibilityContinuityFactor;
      host.renderable = this.freeRuntimeRenderable;
      host.updateTransform();

      const reparent = reparentPreserveWorld(
        [
          {
            displayObject: this.backProxy,
            newParent: host,
            identityToken: this.backProxy.name,
          },
          {
            displayObject: this.frontProxy,
            newParent: host,
            identityToken: this.frontProxy.name,
          },
        ],
        options,
      );
      this.activateFreeRepresentation();
      this.backPose.parent?.removeChild(this.backPose);
      this.frontPose.parent?.removeChild(this.frontPose);
      this.transformHostParkingRevision += 1;
      this.presentationState = 'free';
      this.applyPoseVisibility();
      this.publishFreeTransformChain();
      const visualState = readAttachmentEntityVisualState(host, 'world');
      visualState.visible = this.visible;
      const presentation = this.capturePresentationEvidence(reparent);
      this.releaseHandRenderer();
      return {
        visualState,
        reparent,
        proxyIdentityTokens: this.getProxyIdentityTokens(),
        representation: this.fullProxy ? 'full' : 'layer-composition',
        presentation,
      };
    } catch (error) {
      host.parent?.removeChild(host);
      if (previousHostParent) {
        previousHostParent.addChildAt(host, Math.min(previousHostIndex, previousHostParent.children.length));
      }
      host.pivot.set(previousHostPivot.x, previousHostPivot.y);
      applyAttachmentEntityVisualState(host, previousHostState);
      host.alpha = previousHostOpacityChannels.alpha;
      host.alphaFilterVal = previousHostOpacityChannels.alphaFilter;
      host.renderable = previousHostRenderable;
      host.zIndex = previousHostZIndex;
      this.freeVisibilityContinuityFactor = previousFreeVisibilityContinuityFactor;
      this.freeRuntimeRenderable = previousFreeRuntimeRenderable;
      if (host.parent) host.updateTransform();
      throw error;
    }
  }

  /** Releases only inherited presentation gates after the detach commit. */
  public releaseFreeInheritedPresentation() {
    if (this.destroyed || this.presentationState !== 'free') return false;
    this.freeVisibilityContinuityFactor = true;
    this.freeRuntimeRenderable = true;
    this.options.transformHost.visible = this.visible;
    this.options.transformHost.renderable = true;
    return true;
  }

  /** Captures the current target anchor without moving either live proxy. */
  public measureAttachedTarget(
    model: Live2DModel,
    layers: Live2DAttachmentLayers,
    freeParent: PIXI.Container,
    attachedLocalState: AttachmentEntityVisualState,
  ): AttachmentEntityVisualState {
    if (this.destroyed) throw new Error('Attachment controller is destroyed');
    if (this.presentationState !== 'free') throw new Error('Attachment is not free');
    const previousModel = this.model;
    const previousLayers = this.layers;
    this.model = model;
    this.layers = layers;
    layers.back.addChild(this.backPose);
    layers.front.addChild(this.frontPose);
    const measurementPose = this.getRepresentativePose();
    const previousMeasurementPosePresentation = {
      alpha: measurementPose.alpha,
      visible: measurementPose.visible,
      renderable: measurementPose.renderable,
    };
    const measurement = new PIXI.Container();
    try {
      this.applyStaticPlacement();
      this.applyFit(this.fitForAttachedTarget(model));
      // The free entity may currently be hidden. Its own attached pose gate is
      // not part of the target anchor: reattach must measure the stored local
      // state against the parent, not multiply it by the entity's temporary
      // free visibility. Parent/figure visibility remains in the ancestry.
      measurementPose.alpha = 1;
      measurementPose.visible = true;
      measurementPose.renderable = true;
      const measurementParent = this.getRepresentativeContent();
      measurementParent.addChild(measurement);
      applyAttachmentEntityVisualState(measurement, {
        ...attachedLocalState,
        space: 'local',
      });
      freeParent.updateTransform();
      this.publishAttachedTransformChains();
      measurement.updateTransform();

      const parentWorld = freeParent.worldTransform.clone();
      const determinant = parentWorld.a * parentWorld.d - parentWorld.b * parentWorld.c;
      if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-10) {
        throw new Error('Free entity parent world transform is not invertible');
      }
      const local = measurement.worldTransform.clone().prepend(parentWorld.invert());
      const decomposed = new PIXI.Container();
      decomposed.transform.setFromMatrix(local);
      const freeParentOpacity = effectiveWorldOpacity(freeParent);
      applyLocalOpacity(
        decomposed,
        Math.abs(freeParentOpacity) <= DETACH_PRESENTATION_ALPHA_EPSILON
          ? 1
          : effectiveWorldOpacity(measurement) / freeParentOpacity,
      );
      decomposed.visible = effectiveBoolean(measurement, 'visible');
      return readAttachmentEntityVisualState(decomposed, 'world');
    } finally {
      measurement.parent?.removeChild(measurement);
      measurement.destroy({
        children: true,
        texture: false,
        baseTexture: false,
      });
      this.backPose.parent?.removeChild(this.backPose);
      this.frontPose.parent?.removeChild(this.frontPose);
      measurementPose.alpha = previousMeasurementPosePresentation.alpha;
      measurementPose.visible = previousMeasurementPosePresentation.visible;
      measurementPose.renderable = previousMeasurementPosePresentation.renderable;
      this.model = previousModel;
      this.layers = previousLayers;
    }
  }

  /** Rebinds the stable proxies after the shared return-flight transition settles. */
  public reattachFromFree(
    model: Live2DModel,
    layers: Live2DAttachmentLayers,
    _attachedLocalState: AttachmentEntityVisualState,
    options: ReparentPreserveWorldOptions = {},
    targetRenderer?: PIXI.Renderer,
  ): AttachmentPresentationTransition {
    if (this.destroyed) throw new Error('Attachment controller is destroyed');
    if (this.presentationState !== 'free') throw new Error('Attachment is already attached');
    const previousModel = this.model;
    const previousLayers = this.layers;
    const previousRenderer = this.handTargetRenderer;
    this.handTargetRenderer = targetRenderer ?? this.handTargetRenderer;
    this.model = model;
    this.layers = layers;
    layers.back.addChild(this.backPose);
    layers.front.addChild(this.frontPose);
    const previousPosePresentation = [this.backPose, this.frontPose].map((pose) => ({
      pose,
      alpha: pose.alpha,
      visible: pose.visible,
      renderable: pose.renderable,
    }));
    // Free-state visibility lives on transformHost while attached visibility
    // lives on the pose nodes. Keep the target parents neutral for the atomic
    // reparent, then reapply the controller's logical gate after commit.
    for (const { pose } of previousPosePresentation) {
      pose.alpha = 1;
      pose.visible = true;
      pose.renderable = true;
    }
    this.applyStaticPlacement();
    this.publishAttachedTransformChains();
    this.publishFreeTransformChain();
    const freeAppearance = readAttachmentEntityVisualState(this.options.transformHost, 'world').appearance;

    let nextHandRenderer: (() => void) | undefined;
    try {
      this.applyFit(this.fitForAttachedTarget(model));
      this.publishAttachedTransformChains();
      if (this.handBinding && this.handRendererModel !== model)
        nextHandRenderer = this.registerHandRenderer(model);
      this.deactivateFreeRepresentation();
      const reparent = reparentPreserveWorld(
        [
          {
            displayObject: this.backProxy,
            newParent: this.backContent,
            identityToken: this.backProxy.name,
          },
          {
            displayObject: this.frontProxy,
            newParent: this.frontContent,
            identityToken: this.frontProxy.name,
          },
        ],
        options,
      );
      // The parent may have moved after prepareReattach captured its target.
      // The atomic move above has already derived the actual local transform
      // that preserves the settled free-host world pose against this frame's
      // parent. Persist that value instead of overwriting it with the stale
      // prepared preset.
      const committedLocalState = readAttachmentEntityVisualState(this.getRepresentativeProxy(), 'local');
      committedLocalState.appearance = freeAppearance;
      applyAttachmentEntityVisualState(this.options.transformHost, committedLocalState);
      this.presentationState = 'attached';
      if (nextHandRenderer) {
        this.unregisterHandRenderer?.();
        this.unregisterHandRenderer = nextHandRenderer;
        this.handRendererModel = model;
        nextHandRenderer = undefined;
      }
      this.syncAttachedVisualState();
      this.hasValidPose = true;
      this.applyPoseVisibility();
      this.deferTransformHostParkingAfterRender();
      return {
        visualState: readAttachmentEntityVisualState(this.options.transformHost, 'local'),
        reparent,
        proxyIdentityTokens: this.getProxyIdentityTokens(),
        representation: this.fullProxy ? 'full' : 'layer-composition',
        presentation: this.capturePresentationEvidence(reparent),
      };
    } catch (error) {
      nextHandRenderer?.();
      this.handTargetRenderer = previousRenderer;
      this.activateFreeRepresentation();
      for (const previous of previousPosePresentation) {
        previous.pose.alpha = previous.alpha;
        previous.pose.visible = previous.visible;
        previous.pose.renderable = previous.renderable;
      }
      this.backPose.parent?.removeChild(this.backPose);
      this.frontPose.parent?.removeChild(this.frontPose);
      this.model = previousModel;
      this.layers = previousLayers;
      throw error;
    }
  }

  /**
   * Applies an in-memory candidate to this existing runtime instance.
   * It neither mutates the loaded config nor creates another attachment.
   */
  public setCalibrationPreview(preview: HatAttachmentCalibrationPreview | undefined) {
    if (this.destroyed) return false;
    if (preview) {
      const values = [
        preview.spriteAnchor.x,
        preview.spriteAnchor.y,
        preview.offset.x,
        preview.offset.y,
        preview.rotationOffsetRad,
        preview.localScale,
        preview.localScaleX ?? preview.localScale,
        preview.localScaleY ?? preview.localScale,
      ];
      if (
        values.some((value) => !Number.isFinite(value)) ||
        preview.localScale <= 0 ||
        (preview.localScaleX ?? preview.localScale) <= 0 ||
        (preview.localScaleY ?? preview.localScale) <= 0 ||
        (preview.scaleMode !== 'fixed' && preview.scaleMode !== 'uniform')
      ) {
        throw new TypeError(
          'Attachment calibration values must be finite, localScale must be positive, and scaleMode must be valid',
        );
      }
      this.calibrationPreview = {
        layerView: preview.layerView,
        spriteAnchor: { ...preview.spriteAnchor },
        offset: { ...preview.offset },
        rotationOffsetRad: preview.rotationOffsetRad,
        localScale: preview.localScale,
        ...(preview.localScaleX === undefined ? {} : { localScaleX: preview.localScaleX }),
        ...(preview.localScaleY === undefined ? {} : { localScaleY: preview.localScaleY }),
        scaleMode: preview.scaleMode,
        ...(preview.visualState
          ? {
              visualState: cloneAttachmentEntityVisualState(
                preview.visualState,
              ) as HatAttachmentCalibrationPreview['visualState'],
            }
          : {}),
      };
    } else {
      this.calibrationPreview = undefined;
    }
    this.applyStaticPlacement();
    if (this.lastFit) this.applyFit(this.lastFit);
    this.applyPoseVisibility();
    return true;
  }

  public getCalibrationPreview(): HatAttachmentCalibrationPreview {
    const placement = this.options.config.placement;
    const preview = this.calibrationPreview;
    return {
      layerView: preview?.layerView ?? 'both',
      spriteAnchor: { ...(preview?.spriteAnchor ?? placement.spriteAnchor) },
      offset: { ...(preview?.offset ?? placement.offset) },
      rotationOffsetRad: preview?.rotationOffsetRad ?? placement.rotationOffsetRad,
      localScale: preview?.localScale ?? placement.localScale,
      ...(preview
        ? preview.localScaleX === undefined
          ? {}
          : { localScaleX: preview.localScaleX }
        : placement.localScaleX === undefined
        ? {}
        : { localScaleX: placement.localScaleX }),
      ...(preview
        ? preview.localScaleY === undefined
          ? {}
          : { localScaleY: preview.localScaleY }
        : placement.localScaleY === undefined
        ? {}
        : { localScaleY: placement.localScaleY }),
      scaleMode: preview?.scaleMode ?? this.options.config.fit.scaleMode,
      ...(preview?.visualState ?? this.options.config.initialVisualState
        ? {
            visualState: cloneAttachmentEntityVisualState(
              (preview?.visualState ?? this.options.config.initialVisualState)!,
            ) as HatAttachmentCalibrationPreview['visualState'],
          }
        : {}),
    };
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseHandRenderer();this.handPresentations=[];
    this.transformHostParkingRevision += 1;
    this.backProxy.parent?.removeChild(this.backProxy);
    this.frontProxy.parent?.removeChild(this.frontProxy);
    this.fullProxy?.parent?.removeChild(this.fullProxy);
    destroyAttachmentEntityAppearance(this.backProxy);
    destroyAttachmentEntityAppearance(this.frontProxy);
    destroyAttachmentEntityAppearance(this.backContent);
    destroyAttachmentEntityAppearance(this.frontContent);
    if (this.fullProxy) destroyAttachmentEntityAppearance(this.fullProxy);
    destroyRoot(this.backPose);
    destroyRoot(this.frontPose);
    destroyRoot(this.backProxy);
    destroyRoot(this.frontProxy);
    if (this.fullProxy) destroyRoot(this.fullProxy);
  }

  private installSprite(content: PIXI.Container, sprite: PIXI.Sprite, hasTexture: boolean) {
    sprite.pluginName = ATTACHMENT_SPRITE_PLUGIN_NAME;
    sprite.visible = hasTexture;
    content.addChild(new SpriteRenderBoundary(true, sprite), sprite, new SpriteRenderBoundary(false));
  }

  private applyStaticPlacement() {
    const preview = this.getCalibrationPreview();
    const visualState = preview.visualState;
    for (const content of [this.backContent, this.frontContent]) {
      content.position.set(visualState?.position.x ?? 0, visualState?.position.y ?? 0);
      content.rotation = preview.rotationOffsetRad + (visualState?.rotation ?? 0);
      content.scale.set(
        (preview.localScaleX ?? preview.localScale) * (visualState?.scale.x ?? 1),
        (preview.localScaleY ?? preview.localScale) * (visualState?.scale.y ?? 1),
      );
      content.pivot.set(0, 0);
      content.skew.set(visualState?.skew?.x ?? 0, visualState?.skew?.y ?? 0);
      content.alpha = visualState?.opacity ?? 1;
      content.visible = visualState?.visible ?? true;
      applyAttachmentEntityAppearance(content, visualState?.appearance);
    }
    this.backSprite.anchor.set(preview.spriteAnchor.x, preview.spriteAnchor.y);
    this.frontSprite.anchor.set(preview.spriteAnchor.x, preview.spriteAnchor.y);
    this.fullSprite?.anchor.set(preview.spriteAnchor.x, preview.spriteAnchor.y);
  }

  private applyFit(fit: HandPoseFit) {
    const reflected=fit.handFlip?reflectHandPoint(fit.referenceCentroid,fit.handFlip.origin,fit.handFlip.angleRad):fit.referenceCentroid;
    const dx=reflected.x-fit.referenceCentroid.x,dy=reflected.y-fit.referenceCentroid.y;
    const c=Math.cos(fit.rotation),s=Math.sin(fit.rotation);
    for (const root of [this.backPose, this.frontPose]) {
      root.pivot.set(fit.referenceCentroid.x, fit.referenceCentroid.y);
      root.position.set(fit.currentCentroid.x+fit.scale*(c*dx-s*dy)+(fit.handOffset?.x??0),fit.currentCentroid.y+fit.scale*(s*dx+c*dy)+(fit.handOffset?.y??0));
      // Parent reflection acts after content rotation/scale/offset, never on raw PNG axes.
      root.rotation = fit.rotation+(fit.handFlip?2*fit.handFlip.angleRad:0);
      root.scale.set(fit.scale,fit.handFlip?-fit.scale:fit.scale);
      root.skew.set(0, 0);
    }
    const offset = this.getCalibrationPreview().offset;
    const visualPosition = this.getCalibrationPreview().visualState?.position ?? { x: 0, y: 0 };
    for (const content of [this.backContent, this.frontContent]) {
      content.position.set(
        fit.referenceCentroid.x + offset.x + visualPosition.x,
        fit.referenceCentroid.y + offset.y + visualPosition.y,
      );
    }
  }

  public getHandStateDiagnostic() { return this.handStateDiagnostic; }
  /** Read-only authoring overlay; never updates the model or stores a pose. */
  public getHandAxisPreview() {
    if(!this.handBinding||!this.model||this.presentationState!=='attached')return [];
    const model=this.model,internal=model.internalModel;
    return this.handSamples().filter(s=>s.weight>1e-4).map(({state,fit,weight})=>{
      const axis=resolveHandFlipAxis(state,this.options.config.target.modelPath,internal.localTransform),c=Math.cos(fit.rotation),s=Math.sin(fit.rotation);
      const origin={x:fit.currentCentroid.x+fit.scale*(c*axis.offset.x-s*axis.offset.y),y:fit.currentCentroid.y+fit.scale*(s*axis.offset.x+c*axis.offset.y)};
      const angle=fit.rotation+axis.angleRad,vertices=internal.getDrawableVertices(internal.getDrawableIndex(state.drawableId));
      return {drawableId:state.drawableId,weight,origin,angleRad:angle,source:axis.source,vertices:Array.from({length:Math.min(vertices.length/2,80)},(_,i)=>mapPoint(pointFromVertices(vertices,i),internal.localTransform))};
    });
  }
  public getHandStateDetails() {
    return {state:this.handStateDiagnostic,coverage:this.handCoverage,activeStates:this.handPresentations.map(p=>({drawableId:p.id,weight:p.weight,opacity:p.opacity,insertion:p.insertion,modelSourceQuad:Array.from(p.quad)}))};
  }

  private releaseHandRenderer() {
    this.unregisterHandRenderer?.();
    this.unregisterHandRenderer = undefined;
    this.handRendererModel = undefined;
  }

  private handSamples(): {state:AttachmentHandState;fit:HandPoseFit;weight:number}[] {
    const model=this.requireModel(),internal=model.internalModel,core=(internal as any).coreModel,mc=core.getModelContext();
    const samples=this.handBinding!.states.map(state=>{
      const index=internal.getDrawableIndex(state.drawableId),vertices=internal.getDrawableVertices(index),transform=internal.localTransform;
      const data=mc.getDrawData(index),context=mc._$C2(index);
      const opacity=data.getOpacity(mc,context)*mc._$Hr[context._$IP].getPartsOpacity()*context.baseOpacity;
      const fit:HandPoseFit=fitRigid2D(state.anchors.map(anchor=>({index:anchor.index,weight:anchor.weight,reference:mapPoint(anchor.neutral,transform),current:mapPoint(pointFromVertices(vertices,anchor.index),transform)})),this.getCalibrationPreview().scaleMode==='uniform');
      const reference={x:0,y:0},current={x:0,y:0};for(const point of state.contact){const a=state.anchors.find(a=>a.index===point.index)!;const r=mapPoint(a.neutral,transform),c=mapPoint(pointFromVertices(vertices,point.index),transform);reference.x+=r.x*point.weight;reference.y+=r.y*point.weight;current.x+=c.x*point.weight;current.y+=c.y*point.weight;}
      fit.referenceCentroid=reference;fit.currentCentroid=current;
      if(state.poseOffset){const c=Math.cos(fit.rotation),s=Math.sin(fit.rotation),o=state.poseOffset;
        fit.handOffset={x:fit.scale*(c*o.x-s*o.y),y:fit.scale*(s*o.x+c*o.y)};}
      fit.rotation+=state.rotationOffsetRad;
      if(state.mirrorX){const axis=resolveHandFlipAxis(state,this.options.config.target.modelPath,transform);fit.handFlip={origin:{x:reference.x+axis.offset.x,y:reference.y+axis.offset.y},angleRad:axis.angleRad,source:axis.source};}
      return {state,fit,weight:Math.max(0,Number.isFinite(opacity)?opacity:0)};
    });
    const total=samples.reduce((n,s)=>n+s.weight,0);this.handCoverage=Math.min(1,total);return total>1e-6?samples.map(s=>({...s,weight:s.weight/total})):[];
  }

  private prepareHandFrame(): HandPoseFit | undefined {
    const samples=this.handSamples();if(!samples.length){this.handStateDiagnostic='unsupported-state';return undefined;}this.handStateDiagnostic='supported';
    const chosen=samples.reduce((a,b)=>b.weight>a.weight?b:a),fit={...chosen.fit,referenceCentroid:{...chosen.fit.referenceCentroid},currentCentroid:{...chosen.fit.currentCentroid}};
    fit.currentCentroid={x:samples.reduce((n,s)=>n+s.fit.currentCentroid.x*s.weight,0),y:samples.reduce((n,s)=>n+s.fit.currentCentroid.y*s.weight,0)};
    return fit;
  }

  private fitForAttachedTarget(model: Live2DModel): HandPoseFit {
    if (!this.handBinding) return this.calculateFit(model);
    if (this.handSamples().filter(sample => sample.weight > 1e-4).length > 1)
      throw new Error('HAND_TARGET_TRANSITION_UNSTABLE:手型仍在交接，请在稳定手型帧重新绑定，避免把两种轮廓强制变成单张图');
    const fit = this.prepareHandFrame();
    if (!fit) throw new Error('HAND_TARGET_STATE_UNSUPPORTED:当前手型没有配置，请切换到已配置手型后重新绑定');
    return fit;
  }

  private buildHandPresentations(): HandRenderPresentation[] {
    if (!handAppearanceSupported(this.getCalibrationPreview().visualState?.appearance) ||
        !handAppearanceSupported(readAttachmentEntityVisualState(this.options.transformHost, 'local').appearance))
      throw new Error('HAND_APPEARANCE_UNSUPPORTED:手部内部遮挡暂不支持附件自身滤镜，请恢复附件的默认滤镜或停用手部模式');
    const model=this.requireModel(),binding=this.handBinding!,texture=(this.calibrationTextures??this.options.textures)[binding.textureLayer];
    if(!texture)return [];
    const samples=this.handSamples(),sprite=binding.textureLayer==='front'?this.frontSprite:this.backSprite;
    const restore=this.lastFit!;const result:HandRenderPresentation[]=[];
    for(const sample of samples){if(sample.weight<=1e-6)continue;this.applyFit(sample.fit);this.publishAttachedWorldTransforms();sprite.updateTransform();
      const toSource=model.internalModel.localTransform.clone().invert().append(model.worldTransform.clone().invert()).append(sprite.worldTransform);
      const x=-sprite.anchor.x*texture.orig.width,y=-sprite.anchor.y*texture.orig.height,quad=new Float32Array(8);
      [[x,y],[x+texture.orig.width,y],[x+texture.orig.width,y+texture.orig.height],[x,y+texture.orig.height]].forEach(([x,y],i)=>{const p=mapPoint({x,y},toSource);quad[i*2]=p.x;quad[i*2+1]=p.y;});
      const opacity=this.visible&&this.hasValidPose&&effectiveBoolean(sprite,'visible')?this.handCoverage*effectiveWorldOpacity(sprite)/Math.max(effectiveWorldOpacity(model),1e-8):0;
      result.push({id:sample.state.drawableId,insertion:sample.state.insertion,weight:sample.weight,quad,texture,opacity});
    }
    this.applyFit(restore);this.publishAttachedWorldTransforms();return result;
  }

  private calculateFit(model: Live2DModel) {
    const internalModel = model.internalModel;
    const anchorProfile = this.options.config.target.anchorProfile;
    const drawableIndex = internalModel.getDrawableIndex(anchorProfile.drawableId);
    if (drawableIndex < 0) {
      throw new HatAttachmentError(
        'DRAWABLE_NOT_FOUND',
        `Attachment drawable is unavailable: ${anchorProfile.drawableId}`,
      );
    }
    const vertices = internalModel.getDrawableVertices(drawableIndex);
    const transform = internalModel.localTransform;
    return fitRigid2D(
      anchorProfile.anchors.map((anchor) => ({
        index: anchor.index,
        weight: anchor.weight,
        reference: mapPoint(anchor.neutral, transform),
        current: mapPoint(pointFromVertices(vertices, anchor.index), transform),
      })),
      this.getCalibrationPreview().scaleMode === 'uniform',
    );
  }

  private syncAttachedVisualState() {
    if (this.presentationState !== 'attached') return;
    this.attachedVisualSyncAttempts += 1;
    const localState = readAttachmentEntityVisualState(this.options.transformHost, 'local');
    const layerView = this.getCalibrationPreview().layerView;
    const textures = this.calibrationTextures ?? this.options.textures;
    const syncBack = layerView !== 'front' && Boolean(textures.back);
    const syncFront = layerView !== 'back' && Boolean(textures.front);
    const layerMask = (syncBack ? 1 : 0) | (syncFront ? 2 : 0);
    if (
      layerMask === this.lastAttachedVisualLayerMask &&
      sameAttachedVisualState(this.lastAttachedVisualSync, localState)
    ) {
      this.attachedVisualSyncSkips += 1;
      return;
    }
    if (syncBack) {
      applyAttachmentEntityVisualState(this.backProxy, localState);
      this.attachedVisualProxyApplyCount += 1;
    }
    if (syncFront) {
      applyAttachmentEntityVisualState(this.frontProxy, localState);
      this.attachedVisualProxyApplyCount += 1;
    }
    this.attachedVisualSyncCount += 1;
    this.lastAttachedVisualSync = cloneAttachmentEntityVisualState(localState);
    this.lastAttachedVisualLayerMask = layerMask;
  }

  private publishAttachedWorldTransforms() {
    // The Live2D consumer runs between the back and front render positions.
    // Explicitly publish both subtrees so transition diagnostics and the
    // remaining traversal observe the same current-frame effective alpha.
    updateTransformAncestry(this.requireLayers().back);
    this.backPose.updateTransform();
    this.backContent.updateTransform();
    this.backProxy.updateTransform();
    updateTransformAncestry(this.requireLayers().front);
    this.frontPose.updateTransform();
    this.frontContent.updateTransform();
    this.frontProxy.updateTransform();
  }

  private activateFreeRepresentation() {
    this.lastAttachedVisualSync = undefined;
    this.lastAttachedVisualLayerMask = -1;
    // The free host already captures the representative proxy's complete
    // world transform and effective alpha. Appearance filters are not part of
    // a Pixi transform matrix, so carry only the Creator-authored base
    // appearance onto the free render proxies. The Stage Entity appearance
    // remains on transformHost and composes above this layer.
    const authoredAppearance = this.getCalibrationPreview().visualState?.appearance;
    applyAttachmentEntityAppearance(this.backProxy, authoredAppearance);
    applyAttachmentEntityAppearance(this.frontProxy, authoredAppearance);
    if (!this.fullProxy) return;
    this.backProxy.renderable = false;
    this.frontProxy.renderable = false;
    this.fullProxy.position.set(0, 0);
    this.fullProxy.scale.set(1, 1);
    this.fullProxy.skew.set(0, 0);
    this.fullProxy.rotation = 0;
    this.fullProxy.alpha = 1;
    this.fullProxy.visible = true;
    this.fullProxy.renderable = true;
    applyAttachmentEntityAppearance(this.fullProxy, authoredAppearance);
    this.options.transformHost.addChild(this.fullProxy);
  }

  private deactivateFreeRepresentation() {
    if (this.fullProxy) {
      this.fullProxy.parent?.removeChild(this.fullProxy);
      this.fullProxy.renderable = false;
    }
    this.backProxy.renderable = true;
    this.frontProxy.renderable = true;
  }

  /**
   * Keeps the now-empty free host in its current child slot until the active
   * Pixi render traversal has returned. Pixi caches a Container's child count;
   * synchronously removing this sibling from a figure pre-render consumer can
   * otherwise leave the parent loop reading beyond the shortened child array.
   */
  private deferTransformHostParkingAfterRender() {
    const host = this.options.transformHost;
    const expectedParent = host.parent;
    const revision = ++this.transformHostParkingRevision;
    host.renderable = false;
    queueMicrotask(() => {
      if (
        this.destroyed ||
        this.presentationState !== 'attached' ||
        this.transformHostParkingRevision !== revision ||
        host.parent !== expectedParent
      ) {
        return;
      }
      expectedParent?.removeChild(host);
    });
  }

  private getRepresentativeProxy() {
    const view = this.getCalibrationPreview().layerView;
    if (view !== 'back' && this.frontSprite.texture !== PIXI.Texture.EMPTY) return this.frontProxy;
    return this.backProxy;
  }

  private getRepresentativePose() {
    const view = this.getCalibrationPreview().layerView;
    if (view !== 'back' && this.frontSprite.texture !== PIXI.Texture.EMPTY) return this.frontPose;
    return this.backPose;
  }

  private getRepresentativeContent() {
    const view = this.getCalibrationPreview().layerView;
    if (view !== 'back' && this.frontSprite.texture !== PIXI.Texture.EMPTY) return this.frontContent;
    return this.backContent;
  }

  private applyPoseVisibility() {
    const layerView = this.getCalibrationPreview().layerView;
    // Keep ancestor visibility meaningful for detach readiness. Only the ordinary
    // Sprite draw is suppressed while the SDK insertion owns this presentation.
    const ordinary = this.presentationState === 'free' || !this.handBinding;
    this.backSprite.renderable = ordinary;
    this.frontSprite.renderable = ordinary;
    if (this.presentationState === 'free') {
      this.options.transformHost.visible =
        this.visible && this.visibilityFactor > 0.0001 && this.freeVisibilityContinuityFactor;
      this.options.transformHost.renderable = this.freeRuntimeRenderable;
      if (this.fullProxy) this.fullProxy.alpha = this.visibilityFactor;
      this.backProxy.visible = layerView !== 'front';
      this.frontProxy.visible = layerView !== 'back';
      return;
    }
    this.backPose.alpha = this.visibilityFactor;
    this.frontPose.alpha = this.visibilityFactor;
    const visible = this.visible && this.visibilityFactor > 0.0001 && this.hasValidPose;
    this.backPose.visible = visible && layerView !== 'front';
    this.frontPose.visible = visible && layerView !== 'back';
  }

  private capturePresentationEvidence(reparent: ReparentPreserveWorldResult): AttachmentPresentationContinuityEvidence {
    this.options.transformHost.updateTransform();
    this.backProxy.updateTransform();
    this.frontProxy.updateTransform();
    return {
      logicalVisible: this.visible,
      representation: this.fullProxy ? 'full' : 'layer-composition',
      hostFinal: captureEffectivePresentation(this.options.transformHost),
      proxies: reparent.entries.map((entry) => ({
        identityToken: entry.identityToken,
        before: {
          visible: entry.before.worldVisible,
          renderable: entry.before.worldRenderable,
          worldAlpha: entry.before.worldAlpha,
        },
        afterReparent: {
          visible: entry.after.worldVisible,
          renderable: entry.after.worldRenderable,
          worldAlpha: entry.after.worldAlpha,
        },
        final: captureEffectivePresentation(entry.displayObject),
      })),
    };
  }
}

function effectiveBoolean(displayObject: PIXI.DisplayObject, property: 'visible' | 'renderable') {
  let current: PIXI.DisplayObject | null = displayObject;
  while (current) {
    if (!current[property]) return false;
    current = current.parent;
  }
  return true;
}

function updateTransformAncestry(displayObject: PIXI.DisplayObject) {
  const ancestry: PIXI.DisplayObject[] = [];
  let current: PIXI.DisplayObject | null = displayObject;
  while (current?.parent) {
    ancestry.push(current);
    current = current.parent;
  }
  for (let index = ancestry.length - 1; index >= 0; index -= 1) ancestry[index].updateTransform();
}

function captureEffectivePresentation(displayObject: PIXI.DisplayObject): AttachmentEffectivePresentationState {
  return {
    visible: effectiveBoolean(displayObject, 'visible'),
    renderable: effectiveBoolean(displayObject, 'renderable'),
    worldAlpha: effectiveWorldOpacity(displayObject),
  };
}

function hasFiniteWorldMatrix(displayObject: PIXI.DisplayObject) {
  const matrix = displayObject.worldTransform;
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(Number.isFinite);
}
