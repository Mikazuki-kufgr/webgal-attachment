import type { Live2DModel } from 'pixi-live2d-display-webgal';
import * as PIXI from 'pixi.js';

import type { Live2DAttachmentLayers } from '@/Core/controller/stage/pixi/live2dAttachments';
import {
  isSakikoCasualModelPath,
  syncAttachmentLayersFromModel,
} from '@/Core/controller/stage/pixi/live2dAttachments';
import { isLive2DFigureContainer } from '@/Core/controller/stage/pixi/Live2DFigureContainer';

export const ATTACHMENT_FRAME_DRIVER_PRIORITY = PIXI.UPDATE_PRIORITY.LOW + 1;

export interface Live2DFrameDriverStats {
  driverCount: number;
  tickCount: number;
  modelUpdateCount: number;
  internalModelUpdateCount: number;
  observedInternalModelUpdateCount: number;
  attachmentUpdateCount: number;
  cleanupCount: number;
  doubleUpdateCount: number;
  outOfBandInternalUpdateCount: number;
  unexpectedPendingDeltaCount: number;
  bootstrapRenderWaitCount: number;
  lastDeltaMS: number;
  lastModelDeltaBeforeReset: number;
  lastElapsedTime: number;
}

export interface Live2DFrameDriverLifecycleStats {
  driverCount: number;
  createdCount: number;
  cleanupCount: number;
  peakDriverCount: number;
}

export interface Live2DCurrentFrame {
  frame: number;
  timestamp: number;
  deltaMS: number;
  modelDeltaBeforeReset: number;
  elapsedTime: number;
}

export interface Live2DCurrentFrameConsumer {
  /** Publish command-owned visual state before Pixi begins this render traversal. */
  syncVisualState?(): void;
  update(frame: Live2DCurrentFrame, stats: Live2DFrameDriverStats): void;
  destroy(finalStats: Live2DFrameDriverStats): void;
}

export interface StartLive2DFrameDriverOptions {
  app: PIXI.Application;
  key: string;
  sourcePath: string;
  model: Live2DModel;
  layers: Live2DAttachmentLayers;
  consumer: Live2DCurrentFrameConsumer;
}

export interface Live2DFrameDriverController {
  cleanup(): void;
  getStats(): Live2DFrameDriverStats;
}

const driversByModel = new WeakMap<Live2DModel, Live2DFrameDriver>();
const activeDrivers = new Set<Live2DFrameDriver>();
const lifecycleStats: Live2DFrameDriverLifecycleStats = {
  driverCount: 0,
  createdCount: 0,
  cleanupCount: 0,
  peakDriverCount: 0,
};

function copyStats(stats: Omit<Live2DFrameDriverStats, 'driverCount'>): Live2DFrameDriverStats {
  return { driverCount: activeDrivers.size, ...stats };
}

class Live2DFrameDriver implements Live2DFrameDriverController {
  private readonly previousAutoUpdate: boolean;
  private unregisterRenderPreparation?: () => void;
  private cleaned = false;
  private isTicking = false;
  private isPreparing = false;
  private observedUpdatesThisTick = 0;
  private readonly stats: Omit<Live2DFrameDriverStats, 'driverCount'> = {
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

  private readonly onBeforeMotionUpdate = () => {
    this.stats.observedInternalModelUpdateCount += 1;
    if (!this.isTicking && !this.isPreparing) {
      this.stats.outOfBandInternalUpdateCount += 1;
      return;
    }
    this.observedUpdatesThisTick += 1;
    if (this.observedUpdatesThisTick > 1) {
      this.stats.doubleUpdateCount += 1;
    }
  };

  private readonly onModelDestroy = () => {
    this.cleanup();
  };

  private readonly onTick: PIXI.TickerCallback<Live2DFrameDriver> = () => {
    if (this.cleaned) return;
    if (this.options.model.destroyed || this.options.model.internalModel.destroyed) {
      this.cleanup();
      return;
    }

    this.isTicking = true;
    this.observedUpdatesThisTick = 0;
    this.stats.tickCount += 1;

    const deltaMS = this.options.app.ticker.deltaMS;
    this.stats.lastDeltaMS = deltaMS;
    if (this.options.model.deltaTime !== 0) {
      this.stats.unexpectedPendingDeltaCount += 1;
    }

    try {
      this.options.model.update(deltaMS);
      this.stats.modelUpdateCount += 1;
      this.stats.lastModelDeltaBeforeReset = this.options.model.deltaTime;
      this.stats.lastElapsedTime = this.options.model.elapsedTime;
      syncAttachmentLayersFromModel(this.options.model, this.options.layers);
      this.options.consumer.syncVisualState?.();
    } catch (error) {
      this.reportFailure('ticker-accumulation', error);
      this.cleanup();
    } finally {
      this.isTicking = false;
    }
  };

  private readonly onBeforeFigureRender = (renderer: PIXI.Renderer) => {
    if (this.cleaned || renderer !== this.options.app.renderer) return;
    if (!this.presentationIsAlive()) return;
    const model = this.options.model;
    if (
      model.destroyed ||
      model.internalModel.destroyed ||
      !model.visible ||
      !model.renderable ||
      model.worldAlpha <= 0
    ) {
      return;
    }

    const viewport = renderer.framebuffer.viewport;
    const glContextID = (model as unknown as { glContextID: number }).glContextID;
    if (
      glContextID !== renderer.CONTEXT_UID ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      // Let the natural Live2D _render() bootstrap (or re-bootstrap) its GL
      // context. The attachment stays out of that one render cycle.
      this.stats.bootstrapRenderWaitCount += 1;
      this.options.layers.back.renderable = false;
      this.options.layers.front.renderable = false;
      return;
    }

    // A successful bootstrap may be followed by a frame with no accumulated
    // delta. Restore the planes before the early return so they do not remain
    // hidden after the one-time natural Live2D render.
    this.options.layers.back.renderable = model.renderable;
    this.options.layers.front.renderable = model.renderable;
    const modelDeltaBeforeReset = model.deltaTime;
    if (modelDeltaBeforeReset <= 0) return;

    const currentRenderTexture = renderer.renderTexture.current;
    const sourceFrame = renderer.renderTexture.sourceFrame.clone();
    const destinationFrame = renderer.renderTexture.destinationFrame.clone();
    this.isPreparing = true;
    this.observedUpdatesThisTick = 0;
    let internalUpdateSucceeded = false;
    let rendererRestoreSucceeded = true;

    try {
      renderer.batch.flush();
      renderer.geometry.reset();
      renderer.shader.reset();
      renderer.state.reset();
      renderer.texture.reset();

      model.internalModel.viewport = [
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
      ];
      this.stats.internalModelUpdateCount += 1;
      model.internalModel.update(modelDeltaBeforeReset, model.elapsedTime);
      internalUpdateSucceeded = true;
    } catch (error) {
      this.reportFailure('internal-model-update', error);
    } finally {
      try {
        model.deltaTime = 0;
        renderer.batch.reset();
        renderer.geometry.reset();
        renderer.shader.reset();
        renderer.state.reset();
        renderer.texture.reset();
        renderer.framebuffer.reset();
        renderer.renderTexture.bind(
          currentRenderTexture ?? undefined,
          sourceFrame,
          destinationFrame,
        );
        renderer.gl.colorMask(true, true, true, true);
      } catch (error) {
        rendererRestoreSucceeded = false;
        this.reportFailure('renderer-state-restore', error);
      }
      this.isPreparing = false;
    }

    if (!internalUpdateSucceeded || !rendererRestoreSucceeded) {
      this.cleanup();
      return;
    }

    if (!this.presentationIsAlive()) return;
    try {
      syncAttachmentLayersFromModel(model, this.options.layers);
    } catch (error) {
      this.reportFailure('attachment-layer-sync', error);
      this.cleanup();
      return;
    }

    this.stats.lastModelDeltaBeforeReset = modelDeltaBeforeReset;
    this.stats.lastElapsedTime = model.elapsedTime;
    this.stats.attachmentUpdateCount += 1;
    try {
      this.options.consumer.update(
        {
          frame: this.stats.tickCount,
          timestamp: performance.now(),
          deltaMS: this.stats.lastDeltaMS,
          modelDeltaBeforeReset,
          elapsedTime: model.elapsedTime,
        },
        this.getStats(),
      );
    } catch (error) {
      this.reportFailure('consumer-update', error);
      this.cleanup();
      return;
    }

    // Renderer.render() updated the display tree before entering this hook.
    // The just-applied pose must publish fresh world transforms to this cycle.
    // A consumer can synchronously remove the last attachment and clean up the
    // driver, so re-check ownership before touching either layer.
    if (!this.presentationIsAlive()) return;
    try {
      this.options.layers.back.updateTransform();
      this.options.layers.front.updateTransform();
    } catch (error) {
      this.reportFailure('attachment-transform-update', error);
      this.cleanup();
    }
  };

  public constructor(private readonly options: StartLive2DFrameDriverOptions) {
    const parent = options.model.parent;
    if (!isLive2DFigureContainer(parent)) {
      throw new Error('Live2D attachment driver requires a Live2DFigureContainer parent');
    }
    if (options.model.destroyed || options.model.internalModel.destroyed) {
      throw new Error('Live2D attachment driver cannot start for a destroyed model');
    }

    this.previousAutoUpdate = options.model.autoUpdate;
    const previousDeltaTime = options.model.deltaTime;

    // A shared-ticker callback may have accumulated a partial delta between
    // model initialization and driver installation. Drop it before the one-time
    // WebGL bootstrap render so that _render() cannot perform an out-of-band update.
    try {
      options.model.autoUpdate = false;
      options.model.deltaTime = 0;
      options.model.internalModel.on('beforeMotionUpdate', this.onBeforeMotionUpdate);
      options.model.once('destroy', this.onModelDestroy);
      this.unregisterRenderPreparation = parent.setLive2DRenderPreparation(
        this.onBeforeFigureRender,
      );
      options.app.ticker.add(this.onTick, this, ATTACHMENT_FRAME_DRIVER_PRIORITY);
    } catch (error) {
      this.rollbackConstruction(previousDeltaTime);
      throw error;
    }
  }

  public getStats() {
    return copyStats(this.stats);
  }

  private presentationIsAlive() {
    return (
      !this.cleaned &&
      !this.options.model.destroyed &&
      !this.options.model.internalModel.destroyed &&
      !this.options.layers.back.destroyed &&
      !this.options.layers.front.destroyed
    );
  }

  private reportFailure(phase: string, error: unknown) {
    const detail = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    console.error(`[WebGAL attachment] Live2D frame driver failure:${phase}:${detail}`, {
      phase,
      figureKey: this.options.key,
      sourcePath: this.options.sourcePath,
      cleaned: this.cleaned,
      modelDestroyed: this.options.model.destroyed,
      internalModelDestroyed: this.options.model.internalModel.destroyed,
      error,
    });
  }

  private rollbackConstruction(previousDeltaTime: number) {
    try {
      this.options.app.ticker.remove(this.onTick, this);
    } catch (error) {
      this.reportFailure('constructor-rollback-ticker', error);
    }
    try {
      this.unregisterRenderPreparation?.();
    } catch (error) {
      this.reportFailure('constructor-rollback-render-hook', error);
    }
    this.unregisterRenderPreparation = undefined;
    try {
      this.options.model.off('destroy', this.onModelDestroy);
      this.options.model.internalModel.off('beforeMotionUpdate', this.onBeforeMotionUpdate);
    } catch (error) {
      this.reportFailure('constructor-rollback-listeners', error);
    }
    if (!this.options.model.destroyed && !this.options.model.internalModel.destroyed) {
      try {
        this.options.model.deltaTime = previousDeltaTime;
        this.options.model.autoUpdate = this.previousAutoUpdate;
      } catch (error) {
        this.reportFailure('constructor-rollback-model-state', error);
      }
    }
  }

  public cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;

    try {
      this.options.app.ticker.remove(this.onTick, this);
    } catch (error) {
      this.reportFailure('cleanup-ticker', error);
    }
    try {
      this.unregisterRenderPreparation?.();
    } catch (error) {
      this.reportFailure('cleanup-render-hook', error);
    }
    this.unregisterRenderPreparation = undefined;
    try {
      this.options.model.off('destroy', this.onModelDestroy);
      this.options.model.internalModel.off('beforeMotionUpdate', this.onBeforeMotionUpdate);
    } catch (error) {
      this.reportFailure('cleanup-listeners', error);
    }
    driversByModel.delete(this.options.model);
    activeDrivers.delete(this);

    this.stats.cleanupCount = 1;
    lifecycleStats.driverCount = activeDrivers.size;
    lifecycleStats.cleanupCount += 1;
    try {
      this.options.consumer.destroy(this.getStats());
    } catch (error) {
      this.reportFailure('consumer-destroy', error);
    } finally {
      if (!this.options.model.destroyed && !this.options.model.internalModel.destroyed) {
        try {
          this.options.model.deltaTime = 0;
          this.options.model.autoUpdate = this.previousAutoUpdate;
        } catch (error) {
          this.reportFailure('cleanup-model-state', error);
        }
      }
    }
  }
}

/** Production entry point. One driver is owned per Live2D model. */
export function startLive2DFrameDriver(
  options: StartLive2DFrameDriverOptions,
): Live2DFrameDriverController {
  const existing = driversByModel.get(options.model);
  if (existing) return existing;

  const driver = new Live2DFrameDriver(options);
  driversByModel.set(options.model, driver);
  activeDrivers.add(driver);
  lifecycleStats.driverCount = activeDrivers.size;
  lifecycleStats.createdCount += 1;
  lifecycleStats.peakDriverCount = Math.max(lifecycleStats.peakDriverCount, activeDrivers.size);
  return driver;
}

/** DEV-only and exact-model-only frame driver for the POC-2 validation. */
export function startSakikoLive2DFrameDriver(
  options: StartLive2DFrameDriverOptions,
): Live2DFrameDriverController | undefined {
  if (!import.meta.env.DEV || !isSakikoCasualModelPath(options.sourcePath)) {
    return undefined;
  }

  return startLive2DFrameDriver(options);
}

export function getLive2DFrameDriverLifecycleStats(): Live2DFrameDriverLifecycleStats {
  return { ...lifecycleStats, driverCount: activeDrivers.size };
}
