import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';

import { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  initialLegacyAttachmentLocalVisualState,
  legacyAttachmentLink,
} from '@/Core/Modules/stage/stageEntityStateTransaction';
import type { IAttachmentState, StageEntityStateV0 } from '@/Core/Modules/stage/stageInterface';
import type { ActiveLive2DFigureResult, IStageObject } from '../PixiController';
import { ExternalStageObjectRegistry } from '../externalStageObjectRegistry';
import type { Live2DFrameDriverStats, StartLive2DFrameDriverOptions } from '../live2dFrameDriver';
import { AttachmentRuntime } from './AttachmentRuntime';
import { AttachmentStageBridge, type AttachmentBridgeHost } from './attachmentStageBridge';
import { AttachmentConfigLoader } from './configLoader';
import { normalizeLayeredModelPath } from './profileLoader';
import type { AttachmentConfig, AttachmentRuntimeEvent } from './types';

// This is a CPU-only ownership test. It uses the real Runtime, bridge,
// controller and PIXI graph while keeping the Live2D drawable/frame driver as
// deterministic seams; it does not claim a real renderer or GPU validation.
const modelPath = 'game/figure/fit-failure-runtime/model.json';
const figureKey = 'fig-center';
const generation = 'fit-failure-generation';
const reattachFigureKey = 'fig-reattach';
const reattachGeneration = 'fit-failure-reattach-generation';
const reattachModelPath = 'game/figure/fit-failure-reattach/model.json';
const badId = 'bad-fit';
const goodId = 'good-fit';
const badEntityId = 'entity-bad-fit';
const goodEntityId = 'entity-good-fit';
const crossModelConfigId = 'v2/fit-failure-cross-model';
const validVertices = new Float32Array([-10, 0, 10, 0, 0, 20]);
const invalidVertices = new Float32Array([Number.NaN, 0, 10, 0, 0, 20]);

const cleanups: Array<() => void> = [];
let restoreCanvas: () => void;

beforeAll(() => {
  const canvas = vi
    .spyOn(PIXI.settings.ADAPTER, 'createCanvas')
    .mockImplementation(() => ({ getContext: () => null } as unknown as HTMLCanvasElement));
  restoreCanvas = () => canvas.mockRestore();
});

afterAll(() => restoreCanvas());

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function config(configId: string, drawableId: string, targetModelPath = modelPath): AttachmentConfig {
  return {
    schema: 'webgal-live2d-attachment-v1',
    configId,
    target: {
      modelPath: targetModelPath,
      anchorProfile: {
        drawableId,
        anchors: [
          { index: 0, weight: 1, neutral: { x: -10, y: 0 } },
          { index: 1, weight: 1, neutral: { x: 10, y: 0 } },
          { index: 2, weight: 1, neutral: { x: 0, y: 20 } },
        ],
      },
    },
    fit: { scaleMode: 'uniform' },
    layers: { front: `game/attachments/${configId}/front.png` },
    placement: {
      spriteAnchor: { x: 0.5, y: 0.5 },
      offset: { x: 0, y: 0 },
      rotationOffsetRad: 0,
      localScale: 1,
    },
  };
}

function crossModelPackage() {
  const points = [
    { index: 0, weight: 1, neutral: { x: -10, y: 0 } },
    { index: 1, weight: 1, neutral: { x: 10, y: 0 } },
    { index: 2, weight: 1, neutral: { x: 0, y: 20 } },
  ];
  const adaptation = (target: boolean) => {
    const profileId = target ? 'fit-failure-reattach-profile' : 'fit-failure-profile';
    const anchorName = target ? 'ear-left' : 'head';
    return {
      preset: {
        schema: 'webgal-live2d-attachment-preset',
        schemaVersion: 2,
        presetId: crossModelConfigId,
        approvalStatus: 'approved',
        attachmentAssetId: 'fit-failure-cross-model-assets',
        modelProfileId: profileId,
        anchorName,
        fit: { scaleMode: 'uniform' },
        placement: {
          spriteAnchor: { x: 0.5, y: 0.5 },
          offset: { x: target ? 20 : 0, y: 0 },
          rotationOffsetRad: 0,
          localScale: 1,
        },
      },
      modelProfile: {
        schema: 'webgal-live2d-model-profile',
        schemaVersion: 1,
        profileVersion: 1,
        modelProfileId: profileId,
        characterId: target ? 'fit-failure-reattach-character' : 'fit-failure-character',
        modelId: target ? 'fit-failure-reattach-model' : 'fit-failure-model',
        modelPath: target ? reattachModelPath : modelPath,
        fingerprint: { modelJsonSha256: (target ? '1' : '0').repeat(64), drawableCount: target ? 1 : 2 },
        anchors: [
          {
            name: anchorName,
            anchorProfileId: target ? 'reattach-ear-left' : 'bad-head',
            drawableId: badId,
            vertexCount: 3,
            points,
          },
        ],
      },
    };
  };
  return {
    schema: 'webgal-live2d-attachment-package',
    schemaVersion: 2,
    displayName: 'cross-model fit failure fixture',
    asset: {
      schema: 'webgal-live2d-attachment-asset',
      schemaVersion: 1,
      attachmentAssetId: 'fit-failure-cross-model-assets',
      slot: 'headwear',
      layers: { front: './game/attachments-v2/portable/fit-failure-cross-model/images/front.png' },
    },
    adaptations: [adaptation(false), adaptation(true)],
  };
}

function addExplicitAttachment(
  manager: StageStateManager,
  attachmentId: string,
  entityId: string,
  configId = attachmentId,
) {
  const row: IAttachmentState = {
    figureKey,
    attachmentId,
    entityId,
    configId,
    visible: true,
  };
  const visual = initialLegacyAttachmentLocalVisualState(true);
  const entity: StageEntityStateV0 = {
    schemaVersion: 0,
    entityId,
    renderableKind: 'attachment-sprite-group',
    source: {
      configId,
      legacyAlias: { originFigureKey: figureKey, attachmentId },
    },
    visualState: visual,
    attachmentLink: legacyAttachmentLink(row, visual),
  };
  const result = manager.applyStageEntityTransaction({
    kind: 'upsert-explicit-attachment',
    attachment: { ...row, entityId },
    entity,
  });
  if (!result.applied) throw new Error(`Failed to seed attachment ${attachmentId}`);
}

function setup(options: { throwingTransformRemovalEntityIds?: readonly string[]; packageDocument?: unknown } = {}) {
  const app = { ticker: new PIXI.Ticker() } as PIXI.Application;
  const stageRoot = new PIXI.Container();
  const figureContainer = new PIXI.Container();
  stageRoot.addChild(figureContainer);
  const outer = new PIXI.Container();
  figureContainer.addChild(outer);
  const getDrawableVertices = vi.fn((drawableIndex: number) => (drawableIndex === 0 ? invalidVertices : validVertices));
  const model = Object.assign(new PIXI.Container(), {
    autoUpdate: true,
    deltaTime: 0,
    elapsedTime: 0,
    internalModel: Object.assign(new PIXI.utils.EventEmitter(), {
      destroyed: false,
      viewport: new Float32Array([0, 0, 1920, 1080]),
      width: 1920,
      height: 1080,
      localTransform: new PIXI.Matrix(),
      getDrawableIDs: () => [badId, goodId],
      getDrawableIndex: (id: string) => (id === badId ? 0 : id === goodId ? 1 : -1),
      getDrawableVertices,
      update: () => undefined,
    }),
  });
  outer.addChild(model);

  const external = new ExternalStageObjectRegistry<IStageObject>();
  const throwingTransformRemovalEntityIds = new Set(options.throwingTransformRemovalEntityIds ?? []);
  const transformRemovalFailure = new Error('synthetic transform remover failure');
  const transformRemovals: Array<{ entityId: string; registeredDuringRemoval: boolean }> = [];
  const drivers: Array<{ options: StartLive2DFrameDriverOptions; cleaned: number }> = [];
  const stats = { driverCount: 1, cleanupCount: 0 } as Live2DFrameDriverStats;
  const runtime = new AttachmentRuntime({
    ...(options.packageDocument
      ? {
          configLoader: new AttachmentConfigLoader({
            fetcher: async () => new Response(JSON.stringify(options.packageDocument)),
          }),
        }
      : {}),
    textureLoader: async () => PIXI.Texture.EMPTY,
    removeTransformOnTarget: (entityId) => {
      transformRemovals.push({ entityId, registeredDuringRemoval: Boolean(external.getByKey(entityId)) });
      if (throwingTransformRemovalEntityIds.has(entityId)) throw transformRemovalFailure;
      return true;
    },
    driverStarter: (options) => {
      const entry = { options, cleaned: 0 };
      drivers.push(entry);
      return {
        getStats: () => ({ ...stats, cleanupCount: entry.cleaned }),
        cleanup: () => {
          if (entry.cleaned) return;
          entry.cleaned += 1;
          options.consumer.destroy({ ...stats, cleanupCount: entry.cleaned });
        },
      };
    },
  });
  if (!options.packageDocument) runtime.registerEphemeralConfig(badId, {
    sourceUrl: `game/attachments/${badId}/attachment.json`,
    config: config(badId, badId),
    modelBinding: {
      modelProfileId: 'fit-failure-profile',
      characterId: 'fit-failure-character',
      modelId: 'fit-failure-model',
      modelPath: normalizeLayeredModelPath(modelPath),
      profileVersion: 1,
      presetApprovalStatus: 'approved',
      fingerprint: { modelJsonSha256: '0'.repeat(64), drawableCount: 2 },
      anchorName: 'head',
      anchorProfileId: 'bad-head',
      drawableId: badId,
      vertexCount: 3,
      anchorVertexIndices: [0, 1, 2],
    },
  });
  runtime.registerEphemeralConfig(goodId, {
    sourceUrl: `game/attachments/${goodId}/attachment.json`,
    config: config(goodId, goodId),
    modelBinding: {
      modelProfileId: 'fit-failure-profile',
      characterId: 'fit-failure-character',
      modelId: 'fit-failure-model',
      modelPath: normalizeLayeredModelPath(modelPath),
      profileVersion: 1,
      presetApprovalStatus: 'approved',
      fingerprint: { modelJsonSha256: '0'.repeat(64), drawableCount: 2 },
      anchorName: 'head',
      anchorProfileId: 'good-head',
      drawableId: goodId,
      vertexCount: 3,
      anchorVertexIndices: [0, 1, 2],
    },
  });

  const activeFigure: ActiveLive2DFigureResult = {
    status: 'ready',
    figure: {
      key: figureKey,
      uuid: generation,
      sourceUrl: modelPath,
      normalizedSourceUrl: modelPath,
      isExiting: false,
      outerContainer: outer as never,
      model: model as never,
    },
  };
  const requestRender = vi.fn();
  const releaseRenderActivity = vi.fn();
  const host = {
    currentApp: app,
    figureContainer,
    getActiveLive2DFigure: () => activeFigure,
    subscribeLive2DFigureChanges: () => () => undefined,
    requestRender,
    acquireExternalRenderActivity: () => releaseRenderActivity,
    registerExternalStageObject: (object: IStageObject) => external.register(object),
    unregisterExternalStageObjectByUuid: (uuid: string) => external.unregisterByUuid(uuid),
    getExternalStageObjByUuid: (uuid: string) => external.getByUuid(uuid),
    getExternalStageObjByKey: (key: string) => external.getByKey(key),
    isTransformTargetLocked: () => false,
  };

  const manager = new StageStateManager();
  manager.setStage('figName', modelPath);
  addExplicitAttachment(manager, badId, badEntityId, options.packageDocument ? crossModelConfigId : badId);
  addExplicitAttachment(manager, goodId, goodEntityId);
  manager.commit();

  const events: AttachmentRuntimeEvent[] = [];
  const unsubscribeEvents = runtime.subscribe((event) => events.push(event));
  const report = vi.fn();
  const bridge = new AttachmentStageBridge(host as unknown as AttachmentBridgeHost, runtime, manager, report);
  bridge.syncCommittedView(manager.getViewStageState());

  cleanups.push(() => {
    bridge.dispose();
    unsubscribeEvents();
    runtime.destroy();
    app.ticker.destroy();
    stageRoot.destroy({ children: true });
  });

  return {
    app,
    bridge,
    drivers,
    events,
    external,
    figureContainer,
    getDrawableVertices,
    host,
    manager,
    report,
    runtime,
    stats,
    transformRemovalFailure,
    transformRemovals,
  };
}

describe('AttachmentRuntime terminal fit failure ownership', () => {
  it('keeps a fit failure primary and completes terminal cleanup when transform removal throws', async () => {
    const f = setup({ throwingTransformRemovalEntityIds: [badEntityId] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanups.push(() => consoleError.mockRestore());
    await f.bridge.whenSettled();
    f.getDrawableVertices.mockClear();
    const driver = f.drivers[0];
    const badTarget = f.external.getByKey(badEntityId);
    const goodTarget = f.external.getByKey(goodEntityId);
    expect(badTarget).toBeDefined();
    expect(goodTarget).toBeDefined();

    const tick = () => driver.options.consumer.update({} as never, f.stats);
    expect(() => {
      tick();
      tick();
      tick();
    }).not.toThrow();

    expect(f.runtime.get(figureKey, badId)).toMatchObject({
      phase: 'error',
      errorCode: 'VERTEX_OUT_OF_RANGE',
      error: 'Drawable vertex 0 is unavailable or non-finite',
    });
    expect(f.events.filter((event) => event.type === 'instance-error')).toHaveLength(1);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ATTACHMENT_VERTEX_OUT_OF_RANGE',
        reason: 'Drawable vertex 0 is unavailable or non-finite',
      }),
    );
    expect(f.external.getByKey(badEntityId)).toBeUndefined();
    expect(badTarget?.pixiContainer?.destroyed).toBe(true);
    expect(badTarget?.pixiContainer?.parent).toBeNull();
    expect(f.external.getByKey(goodEntityId)).toBe(goodTarget);
    expect(goodTarget?.pixiContainer?.destroyed).toBe(false);
    expect(driver.cleaned).toBe(0);
    expect(f.runtime.getDiagnostics()).toMatchObject({
      frameDriverCount: 1,
      attachmentControllerCount: 1,
      stageEntityCount: 1,
      renderProxyCount: 2,
      externalTransformTargetCount: 1,
    });
    expect(f.transformRemovals).toEqual([{ entityId: badEntityId, registeredDuringRemoval: true }]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ATTACHMENT_TERMINAL_CLEANUP_PARTIAL_FAILURE',
        entityId: badEntityId,
        failures: [
          {
            step: 'release-external-stage-object',
            reason: f.transformRemovalFailure.message,
          },
        ],
      }),
    );

    tick();
    expect(f.events.filter((event) => event.type === 'instance-error')).toHaveLength(1);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);

    await f.bridge.whenSettled();
    expect(f.runtime.get(figureKey, badId)).toBeUndefined();
    expect(f.manager.getViewStageState().attachments.map((row) => row.attachmentId)).toEqual([goodId]);

    const view = f.manager.getViewStageState();
    const goodRow = view.attachments.find((row) => row.entityId === goodEntityId);
    const goodEntity = view.stageEntities.find((entity) => entity.entityId === goodEntityId);
    expect(goodRow).toBeDefined();
    expect(goodEntity).toBeDefined();
    const removal = f.manager.applyStageEntityTransaction({
      kind: 'remove',
      entityId: goodEntityId,
      expectedAttachment: goodRow,
      expectedEntity: goodEntity,
    });
    expect(removal.applied).toBe(true);
    f.manager.commit();
    f.bridge.syncCommittedView(f.manager.getViewStageState());
    await f.bridge.whenSettled();

    expect(driver.cleaned).toBe(1);
    expect(f.external.getAll()).toEqual([]);
    expect(goodTarget?.pixiContainer?.destroyed).toBe(true);
    expect(f.runtime.getDiagnostics()).toMatchObject({
      frameDriverCount: 0,
      attachmentControllerCount: 0,
      stageEntityCount: 0,
      renderProxyCount: 0,
      externalTransformTargetCount: 0,
    });
  });

  it('reattaches one package-backed entity across model and anchor before handling target fit failure', async () => {
    const f = setup({ throwingTransformRemovalEntityIds: [badEntityId], packageDocument: crossModelPackage() });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanups.push(() => consoleError.mockRestore());
    await f.bridge.whenSettled();
    expect(f.runtime.get(figureKey, badId)).toMatchObject({
      entityId: badEntityId,
      configId: crossModelConfigId,
      modelBinding: { modelProfileId: 'fit-failure-profile', anchorName: 'head' },
    });

    // Give the origin controller one valid production frame so detach owns a
    // concrete published pose instead of bypassing the real frame gate.
    f.getDrawableVertices.mockReturnValue(validVertices);
    const originDriver = f.drivers[0];
    originDriver.options.consumer.update({} as never, f.stats);
    const detachPromise = f.runtime.requestDetach(badEntityId);
    originDriver.options.consumer.update({} as never, f.stats);
    await detachPromise;
    expect(f.runtime.getEntity(badEntityId)?.state).toBe('free');

    let targetVertices = validVertices;
    const targetOuter = new PIXI.Container();
    const targetModel = Object.assign(new PIXI.Container(), {
      autoUpdate: true,
      deltaTime: 0,
      elapsedTime: 0,
      internalModel: Object.assign(new PIXI.utils.EventEmitter(), {
        destroyed: false,
        viewport: new Float32Array([0, 0, 1920, 1080]),
        width: 1920,
        height: 1080,
        localTransform: new PIXI.Matrix(),
        getDrawableIDs: () => [badId],
        getDrawableIndex: (id: string) => (id === badId ? 0 : -1),
        getDrawableVertices: () => targetVertices,
        update: () => undefined,
      }),
    });
    targetOuter.addChild(targetModel);
    f.figureContainer.addChild(targetOuter);
    f.runtime.registerFigure({
      key: reattachFigureKey,
      generation: reattachGeneration,
      sourcePath: reattachModelPath,
      app: f.app,
      container: targetOuter,
      model: targetModel as never,
      stage: f.host as never,
    });
    const preparePromise = f.runtime.prepareReattach(
      badEntityId,
      reattachFigureKey,
      undefined,
      'ear-left',
      'fit-failure-reattach-profile',
    );
    for (let index = 0; index < 20 && f.drivers.length < 2; index += 1) await Promise.resolve();
    expect(f.drivers).toHaveLength(2);
    const targetDriver = f.drivers[1];
    for (let index = 0; index < 20 && f.runtime.getDiagnostics().pendingFrameOperationCount < 1; index += 1) {
      await Promise.resolve();
    }
    targetDriver.options.consumer.update({} as never, f.stats);
    const prepared = await preparePromise;
    const commitPromise = f.runtime.commitReattach(prepared.token);
    targetDriver.options.consumer.update({} as never, f.stats);
    await commitPromise;
    expect(f.runtime.getEntity(badEntityId)).toMatchObject({
      state: 'attached',
      figureKey: reattachFigureKey,
      figureGeneration: reattachGeneration,
    });
    expect(f.runtime.get(reattachFigureKey, badId)).toMatchObject({
      entityId: badEntityId,
      configId: crossModelConfigId,
      modelBinding: { modelProfileId: 'fit-failure-reattach-profile', anchorName: 'ear-left' },
    });

    const badTarget = f.external.getByKey(badEntityId);
    const goodTarget = f.external.getByKey(goodEntityId);
    expect(badTarget).toBeDefined();
    expect(goodTarget).toBeDefined();
    targetVertices = invalidVertices;
    expect(() => {
      targetDriver.options.consumer.update({} as never, f.stats);
      targetDriver.options.consumer.update({} as never, f.stats);
      targetDriver.options.consumer.update({} as never, f.stats);
    }).not.toThrow();

    const errors = f.events.filter((event) => event.type === 'instance-error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      instance: {
        figureKey: reattachFigureKey,
        figureGeneration: reattachGeneration,
        attachmentId: badId,
        phase: 'error',
        errorCode: 'VERTEX_OUT_OF_RANGE',
        error: 'Drawable vertex 0 is unavailable or non-finite',
      },
    });
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ATTACHMENT_VERTEX_OUT_OF_RANGE',
        figureKey: reattachFigureKey,
        figureGeneration: reattachGeneration,
        reason: 'Drawable vertex 0 is unavailable or non-finite',
      }),
    );
    expect(f.external.getByKey(badEntityId)).toBeUndefined();
    expect(badTarget?.pixiContainer?.destroyed).toBe(true);
    expect(badTarget?.pixiContainer?.parent).toBeNull();
    expect(f.external.getByKey(goodEntityId)).toBe(goodTarget);
    expect(goodTarget?.pixiContainer?.destroyed).toBe(false);
    expect(targetDriver.cleaned).toBe(1);
    expect(originDriver.cleaned).toBe(0);
    expect(f.runtime.getEntity(badEntityId)).toBeUndefined();
    expect(f.runtime.get(figureKey, goodId)).toMatchObject({ phase: 'ready', figureGeneration: generation });
    expect(f.runtime.getDiagnostics()).toMatchObject({
      frameDriverCount: 1,
      attachmentControllerCount: 1,
      stageEntityCount: 1,
      attachedEntityCount: 1,
      renderProxyCount: 2,
      externalTransformTargetCount: 1,
      pendingFrameOperationCount: 0,
      pendingReattachCount: 0,
    });
    expect(f.transformRemovals).toEqual([{ entityId: badEntityId, registeredDuringRemoval: true }]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ATTACHMENT_TERMINAL_CLEANUP_PARTIAL_FAILURE',
        entityId: badEntityId,
        failures: [
          {
            step: 'release-external-stage-object',
            reason: f.transformRemovalFailure.message,
          },
        ],
      }),
    );

    targetDriver.options.consumer.update({} as never, f.stats);
    expect(f.events.filter((event) => event.type === 'instance-error')).toHaveLength(1);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('reports once, releases only the failed entity, and preserves a same-generation sibling', async () => {
    const f = setup();
    await f.bridge.whenSettled();

    expect(f.runtime.list(figureKey)).toMatchObject([
      { attachmentId: badId, phase: 'ready' },
      { attachmentId: goodId, phase: 'ready' },
    ]);
    // Exclude the one vertex-count probe performed by model-binding validation;
    // the remaining calls below are the injected Runtime frame failures.
    f.getDrawableVertices.mockClear();
    expect(f.drivers).toHaveLength(1);
    const driver = f.drivers[0];
    const badTarget = f.external.getByKey(badEntityId);
    const goodTarget = f.external.getByKey(goodEntityId);
    expect(badTarget).toBeDefined();
    expect(goodTarget).toBeDefined();
    const goodProxyIdentity = f.runtime.getEntity(goodEntityId)?.proxyIdentityTokens;

    const tick = () => driver.options.consumer.update({} as never, f.stats);
    tick();
    tick();
    expect(f.events.filter((event) => event.type === 'instance-error')).toHaveLength(0);

    tick();
    expect(f.runtime.get(figureKey, badId)).toMatchObject({
      phase: 'error',
      errorCode: 'VERTEX_OUT_OF_RANGE',
      figureGeneration: generation,
    });
    expect(f.events.filter((event) => event.type === 'instance-error')).toHaveLength(1);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ATTACHMENT_VERTEX_OUT_OF_RANGE',
        figureGeneration: generation,
        attachmentId: badId,
      }),
    );
    expect(f.external.getByKey(badEntityId)).toBeUndefined();
    expect(badTarget?.pixiContainer?.destroyed).toBe(true);
    expect(badTarget?.pixiContainer?.parent).toBeNull();
    expect(f.transformRemovals).toEqual([{ entityId: badEntityId, registeredDuringRemoval: true }]);

    await f.bridge.whenSettled();
    expect(f.runtime.get(figureKey, badId)).toBeUndefined();
    expect(f.manager.getViewStageState().attachments.map((row) => row.attachmentId)).toEqual([goodId]);
    expect(f.manager.getViewStageState().stageEntities.map((entity) => entity.entityId)).toEqual([goodEntityId]);
    expect(f.runtime.get(figureKey, goodId)).toMatchObject({ phase: 'ready', figureGeneration: generation });
    expect(f.runtime.getEntity(goodEntityId)?.proxyIdentityTokens).toEqual(goodProxyIdentity);
    expect(f.external.getByKey(goodEntityId)).toBe(goodTarget);
    expect(goodTarget?.pixiContainer?.destroyed).toBe(false);
    expect(driver.cleaned).toBe(0);
    expect(f.runtime.getDiagnostics()).toMatchObject({
      frameDriverCount: 1,
      attachmentControllerCount: 1,
      stageEntityCount: 1,
      attachedEntityCount: 1,
      renderProxyCount: 2,
      externalTransformTargetCount: 1,
    });

    tick();
    expect(f.events.filter((event) => event.type === 'instance-error')).toHaveLength(1);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(f.getDrawableVertices.mock.calls.filter(([index]) => index === 0)).toHaveLength(3);
    expect(f.runtime.get(figureKey, goodId)?.phase).toBe('ready');

    const view = f.manager.getViewStageState();
    const goodRow = view.attachments.find((row) => row.entityId === goodEntityId);
    const goodEntity = view.stageEntities.find((entity) => entity.entityId === goodEntityId);
    expect(goodRow).toBeDefined();
    expect(goodEntity).toBeDefined();
    const removal = f.manager.applyStageEntityTransaction({
      kind: 'remove',
      entityId: goodEntityId,
      expectedAttachment: goodRow,
      expectedEntity: goodEntity,
    });
    expect(removal.applied).toBe(true);
    f.manager.commit();
    f.bridge.syncCommittedView(f.manager.getViewStageState());
    await f.bridge.whenSettled();

    expect(driver.cleaned).toBe(1);
    expect(f.external.getAll()).toEqual([]);
    expect(goodTarget?.pixiContainer?.destroyed).toBe(true);
    expect(f.transformRemovals).toEqual([
      { entityId: badEntityId, registeredDuringRemoval: true },
      { entityId: goodEntityId, registeredDuringRemoval: true },
    ]);
    expect(f.runtime.getDiagnostics()).toMatchObject({
      frameDriverCount: 0,
      layerPairCount: 0,
      attachmentControllerCount: 0,
      stageEntityCount: 0,
      renderProxyCount: 0,
      externalTransformTargetCount: 0,
    });
  });
});
