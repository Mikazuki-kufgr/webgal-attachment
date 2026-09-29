import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import cloneDeep from 'lodash/cloneDeep';
import { AttachmentRuntime } from '@/Core/controller/stage/pixi/attachments/AttachmentRuntime';
import { AttachmentConfigLoader } from '@/Core/controller/stage/pixi/attachments/configLoader';
import {
  AttachmentStageBridge,
  type AttachmentBridgeHost,
} from '@/Core/controller/stage/pixi/attachments/attachmentStageBridge';
import { ExternalStageObjectRegistry } from '@/Core/controller/stage/pixi/externalStageObjectRegistry';
import { normalizeLayeredModelPath } from '@/Core/controller/stage/pixi/attachments/profileLoader';
import { applyTransformToPixiContainer } from '@/Core/controller/stage/pixi/stageEffectTransform';
import { stageStateManager, initState } from '@/Core/Modules/stage/stageStateManager';
import {
  createCommittedStageSnapshot,
  sanitizeStageStateForRestore,
} from '@/Core/Modules/stage/stageEntityPersistence';
import { ATTACHMENT_COMMAND_ABI } from 'webgal-parser';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import type { PerformController as ControllerType } from '@/Core/Modules/perform/performController';
import type {
  IAnimationObject,
  IStageObject,
  ActiveLive2DFigureResult,
} from '@/Core/controller/stage/pixi/PixiController';
import type { AttachmentConfig, LoadedAttachmentConfig } from '@/Core/controller/stage/pixi/attachments/types';
import type {
  Live2DFrameDriverStats,
  StartLive2DFrameDriverOptions,
} from '@/Core/controller/stage/pixi/live2dFrameDriver';

// Real commands, PerformController, StageStateManager, Runtime, bridge,
// controller geometry and Pixi CPU graph. Only host shell, texture transport,
// synthetic drawable data and frame delivery are seams; there is no SDK/GPU.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const modelPath = 'game/figure/5d-cpu/model.json';
const config: AttachmentConfig = {
  schema: 'webgal-live2d-attachment-v1',
  configId: 'cpu-hat',
  target: {
    modelPath,
    anchorProfile: {
      drawableId: 'head',
      anchors: [
        { index: 0, weight: 1, neutral: { x: -10, y: 0 } },
        { index: 1, weight: 1, neutral: { x: 10, y: 0 } },
        { index: 2, weight: 1, neutral: { x: 0, y: 20 } },
      ],
    },
  },
  fit: { scaleMode: 'uniform' },
  layers: { front: 'game/attachments/cpu-front.png', back: 'game/attachments/cpu-back.png' },
  placement: { spriteAnchor: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, rotationOffsetRad: 0, localScale: 1 },
};
const loaded: LoadedAttachmentConfig = {
  config,
  sourceUrl: 'game/attachments/cpu-hat.json',
  modelBinding: {
    modelProfileId: 'cpu-profile',
    characterId: 'cpu-character',
    modelId: 'cpu-model',
    modelPath: normalizeLayeredModelPath(modelPath),
    profileVersion: 1,
    presetApprovalStatus: 'approved',
    fingerprint: { modelJsonSha256: '0'.repeat(64), drawableCount: 1 },
    anchorName: 'head',
    anchorProfileId: 'cpu-head',
    drawableId: 'head',
    vertexCount: 3,
    anchorVertexIndices: [0, 1, 2],
  },
};
const loader = new AttachmentConfigLoader({
  fetcher: async () => new Response('CPU fixture: missing config', { status: 404 }),
});
loader.registerEphemeral('cpu-hat', loaded);
const app = { ticker: new PIXI.Ticker() } as PIXI.Application;
const stageRoot = new PIXI.Container();
const figureContainer = new PIXI.Container();
stageRoot.addChild(figureContainer);
const outer = new PIXI.Container();
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
    getDrawableIndex: (id: string) => (id === 'head' ? 0 : -1),
    getDrawableVertices: () => new Float32Array([-10, 0, 10, 0, 0, 20]),
    update() {},
  }),
});
outer.addChild(model);
figureContainer.addChild(outer);
const external = new ExternalStageObjectRegistry<IStageObject>();
const animations = new Map<string, { target: string; animation: IAnimationObject }>();
let textureGate: ReturnType<typeof deferred> | undefined;
let texturesRequested = 0;
let renderHolds = 0;
const drivers: Array<{ options: StartLive2DFrameDriverOptions; cleaned: boolean }> = [];
const driverStats = { driverCount: 1, cleanupCount: 0 } as Live2DFrameDriverStats;
const runtime = new AttachmentRuntime({
  configLoader: loader,
  textureLoader: async () => {
    texturesRequested++;
    await textureGate?.promise;
    return PIXI.Texture.EMPTY;
  },
  frameOperationTimeoutMs: 500,
  driverStarter: (options) => {
    const entry = { options, cleaned: false };
    drivers.push(entry);
    return {
      getStats: () => ({ ...driverStats, cleanupCount: Number(entry.cleaned) }),
      cleanup() {
        if (!entry.cleaned) {
          entry.cleaned = true;
          options.consumer.destroy({ ...driverStats, cleanupCount: 1 });
        }
      },
    };
  },
});
const host = {
  currentApp: app,
  figureContainer,
  getActiveLive2DFigure: (): ActiveLive2DFigureResult => ({
    status: 'ready',
    figure: {
      key: 'fig-center',
      uuid: 'cpu-g1',
      sourceUrl: modelPath,
      normalizedSourceUrl: modelPath,
      isExiting: false,
      outerContainer: outer as never,
      model: model as never,
    },
  }),
  subscribeLive2DFigureChanges: () => () => {},
  requestRender() {},
  registerExternalStageObject: (object: IStageObject) => external.register(object),
  unregisterExternalStageObjectByUuid: (uuid: string) => external.unregisterByUuid(uuid),
  getExternalStageObjByUuid: (uuid: string) => external.getByUuid(uuid),
  getExternalStageObjByKey: (key: string) => external.getByKey(key),
  getStageObjByKey: (key: string) => external.getByKey(key),
  isTransformTargetLocked: (target: string) => [...animations.values()].some((a) => a.target === target),
  stopPresetAnimationOnTarget() {},
  registerAnimation(animation: IAnimationObject, key: string, target: string) {
    animations.set(key, { target, animation });
    animation.setStartState();
  },
  removeAnimationWithoutSetEndState(key: string) {
    animations.delete(key);
  },
  acquireExternalRenderActivity() {
    renderHolds++;
    let active = true;
    return () => {
      if (active) {
        active = false;
        renderHolds--;
      }
    };
  },
};
let bridge: AttachmentStageBridge;
let controller: ControllerType;
let frameNumber = 0;
function applyEffects() {
  for (const effect of stageStateManager.getViewStageState().effects) {
    const object = external.getByKey(effect.target);
    if (object && !host.isTransformTargetLocked(effect.target))
      applyTransformToPixiContainer(object.pixiContainer, effect.transform);
  }
}
function refresh() {
  bridge.syncCommittedView(stageStateManager.getViewStageState());
  applyEffects();
}
vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    sceneManager: { lockSceneWrite: false },
    gameplay: { performController: undefined, pixiStage: host },
    flowchartManager: { unlockPendingCurrentScene: vi.fn() },
  },
}));
vi.mock('@/Core/controller/gamePlay/scriptExecutor', () => ({ scriptExecutor: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton', () => ({ attachmentRuntime: runtime }));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ refreshAttachmentPresentation: refresh }));
const { PerformController } = await import('@/Core/Modules/perform/performController');
const { WebGAL } = await import('@/Core/WebGAL');
const { forward, commitForward } = await import('@/Core/controller/gamePlay/nextSentence');
const { scriptExecutor } = await import('@/Core/controller/gamePlay/scriptExecutor');
const { attachment } = await import('./attachment');
const { stageEntity } = await import('./stageEntity');
const { performEntityTransform, removeEntityTransformOnTarget } = await import('./transform/performEntityTransform');
const { getAttachmentCommandPresentationCounts } = await import(
  '@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation'
);
runtime.setTransformTargetRemover(removeEntityTransformOnTarget);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.spyOn(PIXI.settings.ADAPTER, 'createCanvas').mockImplementation(
    () => ({ getContext: () => null } as unknown as HTMLCanvasElement),
  );
  textureGate = undefined;
  texturesRequested = 0;
  frameNumber = 0;
  animations.clear();
  loader.registerEphemeral('cpu-hat', loaded);
  controller = new PerformController();
  WebGAL.gameplay.performController = controller;
  bridge = new AttachmentStageBridge(host as AttachmentBridgeHost, runtime, stageStateManager);
  stageStateManager.setCommitHandler((state, options) => {
    if (options.syncPixiStage) bridge.syncCommittedView(state);
    else if (options.applyPixiEffects) bridge.observeCommittedEffects(state);
    if (options.applyPixiEffects) applyEffects();
  });
  stageStateManager.resetAllStageState({ ...cloneDeep(initState), figName: modelPath });
});
afterEach(async () => {
  textureGate?.resolve();
  await microtasks();
  controller.removeAllPerform();
  bridge.dispose();
  runtime.reset();
  await microtasks();
  vi.advanceTimersByTime(100);
  await microtasks();
  stageStateManager.setCommitHandler(null);
  expect(runtime.getDiagnostics().stageEntityCount).toBe(0);
  expect(renderHolds).toBe(0);
  expect(getAttachmentCommandPresentationCounts()).toEqual({ visibility: 0, visuals: 0, addFailures: 0 });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => {
  runtime.destroy();
  app.ticker.destroy();
  stageRoot.destroy({ children: true });
});
async function microtasks() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}
function drive() {
  frameNumber++;
  const parent = stageRoot.enableTempParent();
  try {
    stageRoot.updateTransform();
    for (const driver of drivers.filter((d) => !d.cleaned)) {
      driver.options.consumer.syncVisualState?.();
      driver.options.consumer.update(
        {
          frame: frameNumber,
          timestamp: frameNumber * 16,
          deltaMS: 16,
          modelDeltaBeforeReset: 16,
          elapsedTime: frameNumber * 16,
        },
        driverStats,
      );
    }
  } finally {
    stageRoot.disableTempParent(parent);
  }
}
async function advance(duration: number) {
  for (let time = 0; time < duration; time += 16) {
    vi.advanceTimersByTime(16);
    drive();
    await microtasks();
  }
}
function sentence(
  kind: 'attachment' | 'stageEntity',
  action: string,
  extra: Record<string, string | number | boolean> = {},
): ISentence {
  const defaults =
    kind === 'attachment'
      ? { figure: 'fig-center', id: 'hat', config: 'cpu-hat', entity: 'entity-hat', anchor: 'head' }
      : { entity: 'entity-hat' };
  return {
    command: kind === 'attachment' ? commandType.attachment : commandType.stageEntity,
    commandRaw: kind,
    content: action,
    args: Object.entries({ ...defaults, ...extra }).map(([key, value]) => ({ key, value })),
    sentenceAssets: [],
    subScene: [],
    inlineComment: '',
    isLineBreakHolder: false,
  };
}
function collect(s: ISentence): IPerform {
  controller.beginCollectingPerforms();
  const p = s.command === commandType.attachment ? attachment(s) : stageEntity(s);
  controller.arrangeNewPerform(p, s);
  controller.endCollectingPerforms();
  return p;
}
function commit() {
  stageStateManager.commit({ applyPixiEffects: false });
  controller.commitPendingPerforms();
  stageStateManager.applyCommittedPixiEffects();
}
async function readyInstant() {
  collect(sentence('attachment', 'add', { duration: 0 }));
  commit();
  await bridge.whenSettled();
  drive();
  await advance(32);
  expect(runtime.get('fig-center', 'hat')?.phase).toBe('ready');
}

describe('5D actual attachment command -> controller -> view bridge -> Runtime CPU integration', () => {
  it('failed replacement restores the actual old Runtime binding and exact I-11 entity/effect state', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await readyInstant();
    stageStateManager.updateEffect({ target: 'entity-hat', transform: { position: { x: 17, y: 9 }, alpha: 0.7 } });
    stageStateManager.commit();
    await bridge.whenSettled();
    drive();
    const old = cloneDeep(stageStateManager.getViewStageState());
    collect(sentence('attachment', 'add', { config: 'missing-cpu-config', duration: 100 }));
    commit();
    await bridge.whenSettled();
    await microtasks();
    drive();
    const view = stageStateManager.getViewStageState();
    expect(view.attachments).toEqual(old.attachments);
    expect(view.stageEntities).toEqual(old.stageEntities);
    expect(view.effects.find((row) => row.target === 'entity-hat')).toEqual(
      old.effects.find((row) => row.target === 'entity-hat'),
    );
    expect(runtime.get('fig-center', 'hat')).toMatchObject({ configId: 'cpu-hat', phase: 'ready', visible: true });
    expect(runtime.getEntity('entity-hat')?.visualState).toMatchObject({ position: { x: 17, y: 9 }, opacity: 0.7 });
    expect(runtime.getDiagnostics().stageEntityCount).toBe(1);
    expect(controller.performList).toHaveLength(0);
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
    expect(errors.mock.calls.some(([error]) => error?.code === 'ATTACHMENT_ADD_FADE_FAILED')).toBe(true);
    expect(errors.mock.calls.some(([error]) => error?.code === 'ATTACHMENT_ADD_ROLLBACK_FAILED')).toBe(false);
  });
  it('starts default add only after commit, waits real texture readiness, then completes real visibility animation', async () => {
    textureGate = deferred();
    collect(sentence('attachment', 'add'));
    expect(runtime.list()).toHaveLength(0);
    expect(texturesRequested).toBe(0);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    commit();
    await microtasks();
    expect(texturesRequested).toBe(2);
    await advance(640);
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(false);
    expect(controller.performList).toHaveLength(1);
    textureGate.resolve();
    await bridge.whenSettled();
    drive();
    await microtasks();
    expect(runtime.get('fig-center', 'hat')?.phase).toBe('ready');
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(true);
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
    await advance(560);
    expect(controller.performList).toHaveLength(0);
    expect(runtime.get('fig-center', 'hat')?.visible).toBe(true);
  });
  it('real show/hide and delayed remove keep declarations until fade finalization and release owned resources', async () => {
    await readyInstant();
    collect(sentence('stageEntity', 'hide', { duration: 64 }));
    commit();
    await advance(96);
    expect(runtime.get('fig-center', 'hat')?.visible).toBe(false);
    collect(sentence('stageEntity', 'show', { duration: 64 }));
    commit();
    await advance(96);
    expect(runtime.get('fig-center', 'hat')?.visible).toBe(true);
    collect(sentence('stageEntity', 'remove', { duration: 64 }));
    commit();
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);
    await advance(96);
    expect(runtime.getEntity('entity-hat')).toBeUndefined();
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(controller.performList).toHaveLength(0);
    expect(drivers.filter((d) => !d.cleaned)).toHaveLength(0);
  });
  it('same calculation add -> remove -> re-add materializes only the final declaration', async () => {
    collect(sentence('attachment', 'add'));
    collect(sentence('attachment', 'remove'));
    collect(sentence('attachment', 'add', { duration: 0 }));
    expect(runtime.list()).toHaveLength(0);
    commit();
    await bridge.whenSettled();
    drive();
    await advance(32);
    expect(runtime.list()).toHaveLength(1);
    expect(runtime.get('fig-center', 'hat')?.phase).toBe('ready');
    expect(runtime.get('fig-center', 'hat')?.visible).toBe(true);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);
  });
  it('actual detach waits a synthetic valid current frame and commits a free entity', async () => {
    await readyInstant();
    const p = collect(sentence('stageEntity', 'detach'));
    commit();
    await microtasks();
    expect(p.blockingNext()).toBe(true);
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).not.toBeNull();
    drive();
    await microtasks();
    expect(runtime.getEntity('entity-hat')?.state).toBe('free');
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).toBeNull();
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.space).toBe('world');
    expect(controller.performList).toHaveLength(0);
  });
  it('loading explicit add plus transform retains the source pose until actual Runtime host is ready', async () => {
    textureGate = deferred();
    collect(sentence('attachment', 'add'));
    controller.beginCollectingPerforms();
    const transform = performEntityTransform({
      target: 'entity-hat',
      animationString: '{"position":{"x":80,"y":20}}',
      duration: 160,
    });
    controller.arrangeNewPerform(transform, sentence('attachment', 'transform'));
    controller.endCollectingPerforms();
    commit();
    await microtasks();
    await advance(32);
    expect(runtime.getEntity('entity-hat')).toBeUndefined();
    textureGate.resolve();
    await bridge.whenSettled();
    drive();
    expect(runtime.getEntity('entity-hat')?.visualState?.position.x).toBeLessThan(80);
    await advance(560);
    expect(runtime.getEntity('entity-hat')?.visualState?.position.x).toBeCloseTo(80);
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(true);
    expect(controller.performList).toHaveLength(0);
  });
});

describe('5E durable snapshot -> reset -> actual Runtime restoration (CPU synthetic frames, no SDK/GPU)', () => {
  it('keeps a detached hat through a subsequent forward/commit and the source-model destroy event', async () => {
    collect(sentence('attachment', 'add'));
    commit();
    // Native figure animation setup can publish an effect after the view commit.
    stageStateManager.updateEffect({ target: 'fig-center', transform: { alpha: 1 } });
    await bridge.whenSettled();
    drive();
    await advance(640);
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.visible).toBe(true);
    vi.mocked(scriptExecutor).mockImplementationOnce(() => {
      const detach = sentence('stageEntity', 'detach', { continue: true });
      controller.arrangeNewPerform(stageEntity(detach), detach);
    });
    expect(forward()).toBe(true);
    commitForward();
    await microtasks();
    drive();
    await microtasks();
    expect(runtime.getEntity('entity-hat')?.state).toBe('free');
    const before = cloneDeep(runtime.getEntity('entity-hat')?.visualState);
    const node = external.getByKey('entity-hat')!.pixiContainer!;
    const absent = vi
      .spyOn(host, 'getActiveLive2DFigure')
      .mockReturnValue({ status: 'absent', figureKey: 'fig-center' });
    vi.mocked(scriptExecutor).mockImplementationOnce(() => {
      stageStateManager.setStage('figName', '');
    });
    try {
      expect(forward()).toBe(true);
      commitForward();
      model.emit('destroy');
      outer.parent?.removeChild(outer);
      await advance(32);
      await bridge.whenSettled();
      expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
      expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).toBeNull();
      expect(runtime.getDiagnostics()).toMatchObject({ figureCount: 0, freeEntityCount: 1 });
      expect(node.destroyed).toBe(false);
      expect(node.parent).toBe(figureContainer);
      expect(node.visible).toBe(true);
      expect(node.alpha).toBeCloseTo(1);
      expect(node.renderable).toBe(true);
      expect(runtime.getEntity('entity-hat')?.visualState).toEqual(before);
      const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
      expect(saved.stageEntities[0].visualState).toMatchObject({ visible: true, opacity: 1 });
    } finally {
      absent.mockRestore();
      if (!outer.parent) figureContainer.addChild(outer);
    }
  });
  it('cold-loads a visible detached entity after the last figure has really exited, then reattaches it', async () => {
    await readyInstant();
    collect(sentence('stageEntity', 'detach'));
    commit();
    await microtasks();
    drive();
    await microtasks();
    expect(runtime.getEntity('entity-hat')?.state).toBe('free');
    const activeFigure = vi.spyOn(host, 'getActiveLive2DFigure');
    activeFigure.mockReturnValue({ status: 'absent', figureKey: 'fig-center' });
    runtime.unregisterFigure('fig-center', 'cpu-g1');
    outer.parent?.removeChild(outer);
    stageStateManager.setStage('figName', '');
    stageStateManager.commit();
    await bridge.whenSettled();
    const saved = JSON.parse(JSON.stringify(createCommittedStageSnapshot(stageStateManager.getViewStageState())));
    expect(saved.figName).toBe('');
    expect(saved.attachments).toHaveLength(0);
    expect(saved.stageEntities[0].visualState.visible).toBe(true);
    const expected = cloneDeep(runtime.getEntity('entity-hat')?.visualState);
    controller.removeAllPerform();
    bridge.dispose();
    runtime.reset();
    // A genuinely new loader and Runtime; no cached config, model registration,
    // frame driver or persistent in-memory controller is available for recovery.
    const cold = new AttachmentRuntime({
      configLoader: new AttachmentConfigLoader({ fetcher: async () => new Response(JSON.stringify(config)) }),
      textureLoader: async () => PIXI.Texture.EMPTY,
      driverStarter: (options) => {
        const entry = { options, cleaned: false };
        drivers.push(entry);
        return {
          getStats: () => driverStats,
          cleanup: () => {
            entry.cleaned = true;
            options.consumer.destroy(driverStats);
          },
        };
      },
    });
    bridge = new AttachmentStageBridge(host as AttachmentBridgeHost, cold, stageStateManager);
    const registration = vi.spyOn(cold, 'registerFigure');
    try {
      stageStateManager.resetAllStageState(sanitizeStageStateForRestore(saved, ATTACHMENT_COMMAND_ABI));
      await bridge.whenSettled();
      expect(registration).not.toHaveBeenCalled();
      expect(cold.getDiagnostics()).toMatchObject({ figureCount: 0, freeEntityCount: 1, frameDriverCount: 0 });
      expect(cold.getEntity('entity-hat')?.visualState).toEqual(expected);
      expect(external.getByKey('entity-hat')?.pixiContainer?.parent).toBe(figureContainer);
      // Restore a real test figure generation only for the separate reattach operation.
      figureContainer.addChild(outer);
      cold.registerFigure({
        key: 'fig-center',
        generation: 'cold-g2',
        sourcePath: modelPath,
        app,
        container: outer,
        model: model as never,
        stage: host as never,
      });
      const preparing = cold.prepareReattach('entity-hat', 'fig-center');
      await microtasks();
      drive();
      await microtasks();
      const target = await preparing;
      const reattaching = cold.commitReattach(target.token);
      await microtasks();
      drive();
      await microtasks();
      await reattaching;
      expect(cold.getEntity('entity-hat')).toMatchObject({
        state: 'attached',
        visible: true,
        figureGeneration: 'cold-g2',
      });
      cold.removeEntity('entity-hat');
      expect(external.getByKey('entity-hat')).toBeUndefined();
    } finally {
      bridge.dispose();
      cold.destroy();
      activeFigure.mockRestore();
      if (!outer.parent) figureContainer.addChild(outer);
    }
  });
  it('restores a detached hidden entity with exact world pose, opacity, skew and appearance', async () => {
    await readyInstant();
    collect(sentence('stageEntity', 'detach'));
    commit();
    await microtasks();
    drive();
    await microtasks();
    collect(sentence('stageEntity', 'hide', { duration: 0 }));
    commit();
    await microtasks();
    stageStateManager.updateEffect({
      target: 'entity-hat',
      transform: {
        position: { x: 123, y: 45 },
        scale: { x: 1.2, y: 0.8 },
        skew: { x: 0.1, y: -0.2 },
        rotation: 0.3,
        alpha: 0.42,
        brightness: 0.8,
        colorRed: 90,
        colorGreen: 130,
        colorBlue: 220,
      },
    });
    stageStateManager.commit();
    await bridge.whenSettled();
    drive();
    const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(saved.stageEntities[0].attachmentLink).toBeNull();
    expect(saved.stageEntities[0].visualState.visible).toBe(false);
    expect(saved.PerformList).toHaveLength(0);
    controller.removeAllPerform();
    bridge.dispose();
    runtime.reset();
    expect(runtime.getDiagnostics().stageEntityCount).toBe(0);
    loader.registerEphemeral('cpu-hat', loaded);
    bridge = new AttachmentStageBridge(host as AttachmentBridgeHost, runtime, stageStateManager);
    stageStateManager.resetAllStageState(sanitizeStageStateForRestore(saved, ATTACHMENT_COMMAND_ABI));
    await bridge.whenSettled();
    drive();
    const restored = runtime.getEntity('entity-hat');
    expect(restored).toMatchObject({ state: 'free', visible: false, representation: 'layer-composition' });
    expect(restored?.visualState).toMatchObject({
      space: 'world',
      position: { x: 123, y: 45 },
      scale: { x: 1.2, y: 0.8 },
      skew: { x: 0.1, y: -0.2 },
      opacity: 0.42,
      visible: false,
      appearance: { brightness: 0.8, color: { red: 90, green: 130, blue: 220 } },
    });
    expect(restored?.visualState?.rotation).toBeCloseTo(0.3);
    const node = external.getByKey('entity-hat')?.pixiContainer;
    expect(node?.parent).toBe(figureContainer);
    expect(node?.position.x).toBeCloseTo(123);
    expect(node?.skew.y).toBeCloseTo(-0.2);
    expect(node?.alpha).toBeCloseTo(0.42);
    expect(node?.visible).toBe(false);
    expect(runtime.getDiagnostics().freeHostCount).toBe(1);
    expect(controller.performList).toHaveLength(0);
  });

  it('reset while texture transport is pending cannot resurrect old declarations or performers', async () => {
    textureGate = deferred();
    const oldTransport = textureGate;
    collect(sentence('attachment', 'add'));
    commit();
    await microtasks();
    expect(texturesRequested).toBe(2);
    const oldBridge = bridge;
    controller.removeAllPerform();
    oldBridge.dispose();
    runtime.reset();
    loader.registerEphemeral('cpu-hat', loaded);
    bridge = new AttachmentStageBridge(host as AttachmentBridgeHost, runtime, stageStateManager);
    stageStateManager.resetAllStageState({ ...cloneDeep(initState), figName: modelPath });
    textureGate = undefined;
    oldTransport.resolve();
    await oldBridge.whenSettled();
    await bridge.whenSettled();
    await advance(640);
    expect(runtime.list()).toHaveLength(0);
    expect(runtime.getEntity('entity-hat')).toBeUndefined();
    expect(external.getByKey('entity-hat')).toBeUndefined();
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(0);
    expect(controller.performList).toHaveLength(0);
    expect(getAttachmentCommandPresentationCounts()).toEqual({ visibility: 0, visuals: 0, addFailures: 0 });
  });

  it('a save during add readiness restores authored visibility without replaying the transient add performer', async () => {
    textureGate = deferred();
    const oldTransport = textureGate;
    collect(sentence('attachment', 'add'));
    commit();
    await microtasks();
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(false);
    const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(saved.attachments[0].visible).toBe(true);
    expect(saved.PerformList).toHaveLength(0);
    const oldBridge = bridge;
    controller.removeAllPerform();
    oldBridge.dispose();
    runtime.reset();
    textureGate = undefined;
    loader.registerEphemeral('cpu-hat', loaded);
    bridge = new AttachmentStageBridge(host as AttachmentBridgeHost, runtime, stageStateManager);
    stageStateManager.resetAllStageState(sanitizeStageStateForRestore(saved, ATTACHMENT_COMMAND_ABI));
    await bridge.whenSettled();
    drive();
    expect(runtime.get('fig-center', 'hat')).toMatchObject({ phase: 'ready', visible: true });
    expect(controller.performList).toHaveLength(0);
    oldTransport.resolve();
    await oldBridge.whenSettled();
    await microtasks();
    expect(runtime.getDiagnostics().stageEntityCount).toBe(1);
    expect(runtime.get('fig-center', 'hat')).toMatchObject({ phase: 'ready', visible: true });
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);
  });

  it('retains an exact pending add save witness across a later real forward', async () => {
    textureGate = deferred();
    collect(sentence('attachment', 'add'));
    commit();
    await microtasks();
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(false);
    expect(controller.performList[0].skipNextCollect).toBe(true);

    vi.mocked(scriptExecutor).mockImplementationOnce(() => {
      stageStateManager.setStage('showText', 'later sentence');
    });
    expect(forward()).toBe(true);
    commitForward();

    expect(stageStateManager.getViewStageState().showText).toBe('later sentence');
    expect(
      stageStateManager
        .getViewStageState()
        .PerformList.some(
          (row) => row.script.command === commandType.attachment && row.script.content.trim() === 'add',
        ),
    ).toBe(true);
    const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(saved.attachments[0].visible).toBe(true);
    expect(saved.stageEntities[0].visualState.visible).toBe(true);
    expect(saved.PerformList).toHaveLength(0);

    vi.mocked(scriptExecutor).mockImplementationOnce(() => {
      const hide = sentence('stageEntity', 'hide', { duration: 0 });
      controller.arrangeNewPerform(stageEntity(hide), hide);
    });
    expect(forward()).toBe(true);
    commitForward();
    const explicitlyHidden = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(explicitlyHidden.attachments[0].visible).toBe(false);
    expect(explicitlyHidden.stageEntities[0].visualState.visible).toBe(false);
    expect(explicitlyHidden.PerformList).toHaveLength(0);
  });

  it('releases a retained witness after a later forward once first-pose supervision settles', async () => {
    textureGate = deferred();
    const add = collect(sentence('attachment', 'add'));
    commit();
    await microtasks();

    vi.mocked(scriptExecutor).mockImplementationOnce(() => {
      stageStateManager.setStage('showText', 'later sentence before readiness');
    });
    expect(forward()).toBe(true);
    commitForward();
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(1);

    textureGate.resolve();
    await bridge.whenSettled();
    drive();
    await microtasks();

    expect(add.skipNextCollect).toBe(false);
    expect(stageStateManager.getViewStageState().showText).toBe('later sentence before readiness');
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(true);
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
    expect(stageStateManager.getCalculationStageState().PerformList).toHaveLength(0);
  });

  it('revokes a pending add witness when a later real forward removes its entity', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    textureGate = deferred();
    collect(sentence('attachment', 'add'));
    commit();
    await microtasks();

    vi.mocked(scriptExecutor).mockImplementationOnce(() => {
      const remove = sentence('stageEntity', 'remove', { duration: 0 });
      controller.arrangeNewPerform(stageEntity(remove), remove);
    });
    expect(forward()).toBe(true);
    commitForward();

    const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(saved.attachments).toHaveLength(0);
    expect(saved.stageEntities).toHaveLength(0);
    expect(saved.PerformList).toHaveLength(0);
  });
});
