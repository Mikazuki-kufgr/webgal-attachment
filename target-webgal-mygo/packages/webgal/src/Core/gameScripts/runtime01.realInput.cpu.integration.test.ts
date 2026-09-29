import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import * as PIXI from 'pixi.js';

import { AttachmentRuntime } from '@/Core/controller/stage/pixi/attachments/AttachmentRuntime';
import { AttachmentConfigLoader } from '@/Core/controller/stage/pixi/attachments/configLoader';
import {
  AttachmentStageBridge,
  type AttachmentBridgeHost,
} from '@/Core/controller/stage/pixi/attachments/attachmentStageBridge';
import { ExternalStageObjectRegistry } from '@/Core/controller/stage/pixi/externalStageObjectRegistry';
import { applyTransformToPixiContainer } from '@/Core/controller/stage/pixi/stageEffectTransform';
import { initState, stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { createCommittedStageSnapshot } from '@/Core/Modules/stage/stageEntityPersistence';
import { commandType, type IScene, type ISentence } from '@/Core/controller/scene/sceneInterface';
import { beginSceneMutation } from '@/Core/controller/scene/sceneMutationEpoch';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import type { PerformController as ControllerType } from '@/Core/Modules/perform/performController';
import type {
  ActiveLive2DFigureResult,
  IAnimationObject,
  IStageObject,
} from '@/Core/controller/stage/pixi/PixiController';
import type {
  Live2DFrameDriverStats,
  StartLive2DFrameDriverOptions,
} from '@/Core/controller/stage/pixi/live2dFrameDriver';

/**
 * Runtime01 task-scoped CPU contract.
 *
 * This harness reads the byte-frozen 5L failure input in place and sends its
 * generated scene through the production parser/executor/perform/state/bridge/
 * Runtime chain. Only browser presentation, texture transport, Live2D model
 * vertices and frame delivery are deterministic CPU seams. It provides no GPU
 * or real Live2D-frame evidence and must never be presented as visual approval.
 */
const evidenceRoot = fileURLToPath(
  new URL(
    '../../../../../../23_5l-execution/evidence/runtime01-static-remediation-20260908/real-input/',
    import.meta.url,
  ),
);
const matrixSceneRoot = fileURLToPath(
  new URL('../../../../../../23_5l-execution/evidence/runtime-matrix-20260909/scenes/', import.meta.url),
);
const independentSceneCases = [
  { file: 'R01-ATTACH-COLD.txt', addCount: 1, stageEntityCount: 0 },
  { file: 'R02-PARENT-TRANSFORM-COLD.txt', addCount: 1, stageEntityCount: 0 },
  { file: 'R03-HIDE-SHOW-COLD.txt', addCount: 1, stageEntityCount: 2 },
  { file: 'R04-REMOVE-READD-COLD.txt', addCount: 2, stageEntityCount: 1 },
] as const;
const relativeScene = 'scene/ATTACHMENT-CREATOR-PREVIEW-custom-attachment-tp9vwgu-placement-v1.txt';
const relativeAttachment = 'portable/attachment.json';
const relativeManifest = 'portable/manifest.json';
const relativeModel = 'figure/model.json';
const relativePng = 'portable/images/front.png';
const expectedHashes = {
  [relativeScene]: '9E3134C6F91B543B2A1F9A8E225B5437C1C0CFAA0AE4690A18C1F0204320C3A5',
  [relativeAttachment]: '16023B5303F88A8537E007A67F55427A14B42706B5A38E064CF95F139F4B7D2B',
  [relativeManifest]: '162AD82AB7E6BB720A2715ACB27EC2C89E763B7CA08023F917C923241FD0E586',
  [relativeModel]: '3A12FD70F2703423EE11DC80179C4D63B038F7A4ED13E10AEB770E08247CC8ED',
  [relativePng]: '067A658EE96E136C1AC08B4CCD411B410357147AD823B1C5D3F887DF46A520D9',
} as const;

function frozenBytes(relativePath: keyof typeof expectedHashes): Buffer {
  const bytes = readFileSync(new URL(relativePath, `file:///${evidenceRoot.replace(/\\/gu, '/')}/`));
  expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(expectedHashes[relativePath]);
  return bytes;
}

const sceneBytes = frozenBytes(relativeScene);
const attachmentBytes = frozenBytes(relativeAttachment);
const manifestBytes = frozenBytes(relativeManifest);
const modelBytes = frozenBytes(relativeModel);
const pngBytes = frozenBytes(relativePng);
const rawScene = sceneBytes.toString('utf8');
const attachmentPackage = JSON.parse(attachmentBytes.toString('utf8')) as {
  asset: { layers: { front: string }; attachedLayers: { front: string } };
  adaptations: Array<{
    preset: {
      presetId: string;
      modelProfileId: string;
      anchorName: string;
      placement: { offset: { x: number; y: number }; localScale: number };
    };
    modelProfile: {
      modelProfileId: string;
      modelPath: string;
      fingerprint: { modelJsonSha256: string; drawableCount: number; mocSha256: string };
      anchors: Array<{
        name: string;
        drawableId: string;
        vertexCount: number;
        points: Array<{ index: number; weight: number; neutral: { x: number; y: number } }>;
      }>;
    };
  }>;
};
JSON.parse(modelBytes.toString('utf8'));
JSON.parse(manifestBytes.toString('utf8'));

const presetId = 'v2/custom-attachment-tp9vwgu-placement-v1';
const figureKey = 'creator-current-preview';
const attachmentId = 'creator-current-attachment';
const entityId = 'creator:current-attachment';
const profileId = 'anon-school_winter-2023-semantic-v1';
const modelPath = 'game/figure/anon/school_winter-2023/model.json';
const frontUrl = './game/attachments-v2/portable/custom-attachment-tp9vwgu-placement-v1/images/front.png';
const packageUrl = './game/attachments-v2/portable/custom-attachment-tp9vwgu-placement-v1/attachment.json';
const adaptation = attachmentPackage.adaptations[0];
const mouth = adaptation.modelProfile.anchors.find((anchor) => anchor.name === 'mouth')!;
const exactAddLine = rawScene.split(/\r?\n/gu).find((line) => line.startsWith('attachment:add '))!;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const configRequests: string[] = [];
const textureRequests: string[] = [];
const loader = new AttachmentConfigLoader({
  fetcher: async (input) => {
    const url = String(input);
    configRequests.push(url);
    return url === packageUrl
      ? new Response(attachmentBytes, { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('not found', { status: 404 });
  },
});

const app = { ticker: new PIXI.Ticker() } as PIXI.Application;
const stageRoot = new PIXI.Container();
const figureContainer = new PIXI.Container();
const outer = new PIXI.Container();
const vertices = new Float32Array(mouth.vertexCount * 2);
for (const point of mouth.points) {
  vertices[point.index * 2] = point.neutral.x;
  vertices[point.index * 2 + 1] = point.neutral.y;
}
const drawableIds = ['D_PSD.50', ...Array.from({ length: 154 }, (_, index) => `cpu-${index}`)];
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
    getDrawableIDs: () => drawableIds,
    getDrawableIndex: (id: string) => (id === 'D_PSD.50' ? 0 : -1),
    getDrawableVertices: (index: number) => (index === 0 ? vertices : new Float32Array()),
    update() {},
  }),
});
stageRoot.addChild(figureContainer);
figureContainer.addChild(outer);
outer.addChild(model);

const external = new ExternalStageObjectRegistry<IStageObject>();
const animations = new Map<string, { target: string; animation: IAnimationObject }>();
let textureGate: ReturnType<typeof deferred> | undefined;
let renderHolds = 0;
let frameNumber = 0;
const drivers: Array<{ options: StartLive2DFrameDriverOptions; cleaned: boolean }> = [];
const driverStats = {
  driverCount: 1,
  cleanupCount: 0,
  tickCount: 0,
  attachmentUpdateCount: 0,
  bootstrapRenderWaitCount: 0,
} as Live2DFrameDriverStats;

const runtime = new AttachmentRuntime({
  configLoader: loader,
  textureLoader: async (url) => {
    textureRequests.push(url);
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
        if (entry.cleaned) return;
        entry.cleaned = true;
        options.consumer.destroy({ ...driverStats, cleanupCount: 1 });
      },
    };
  },
});

const host = {
  currentApp: app,
  figureContainer,
  getActiveLive2DFigure: (key: string): ActiveLive2DFigureResult =>
    key === figureKey
      ? {
          status: 'ready',
          figure: {
            key: figureKey,
            uuid: 'runtime01-cpu-generation',
            sourceUrl: modelPath,
            normalizedSourceUrl: modelPath,
            isExiting: false,
            outerContainer: outer as never,
            model: model as never,
          },
        }
      : { status: 'absent', figureKey: key },
  subscribeLive2DFigureChanges: () => () => {},
  requestRender() {},
  registerExternalStageObject: (object: IStageObject) => external.register(object),
  unregisterExternalStageObjectByUuid: (uuid: string) => external.unregisterByUuid(uuid),
  getExternalStageObjByUuid: (uuid: string) => external.getByUuid(uuid),
  getExternalStageObjByKey: (key: string) => external.getByKey(key),
  getStageObjByKey: (key: string) => external.getByKey(key),
  isTransformTargetLocked: (target: string) => [...animations.values()].some((entry) => entry.target === target),
  stopPresetAnimationOnTarget() {},
  registerAnimation(animation: IAnimationObject, key: string, target: string) {
    animations.set(key, { target, animation });
    animation.setStartState();
  },
  removeAnimationWithoutSetEndState(key: string) {
    animations.delete(key);
  },
  acquireExternalRenderActivity() {
    renderHolds += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      renderHolds -= 1;
    };
  },
};

let bridge: AttachmentStageBridge;
let controller: ControllerType;

function applyEffects() {
  for (const effect of stageStateManager.getViewStageState().effects) {
    const object = external.getByKey(effect.target);
    if (object && !host.isTransformTargetLocked(effect.target)) {
      applyTransformToPixiContainer(object.pixiContainer, effect.transform);
    }
  }
}

function refresh() {
  bridge.syncCommittedView(stageStateManager.getViewStageState());
  applyEffects();
}

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    animationManager: { addAnimation: vi.fn() },
    sceneManager: undefined,
    readHistoryManager: { checkIsRead: vi.fn() },
    backlogManager: { saveCurrentStateToBacklog: vi.fn() },
    gameplay: { performController: undefined, pixiStage: host, isFastPreview: false },
    flowchartManager: { requestUnlockCurrentScene: vi.fn(), unlockPendingCurrentScene: vi.fn() },
    events: { textSettle: { emit: vi.fn() }, userInteractNext: { emit: vi.fn() } },
  },
}));
vi.mock('@/store/store', () => ({
  webgalStore: {
    getState: () => ({
      GUI: { showTitle: false },
      userData: { globalGameVar: {}, optionData: { textSpeed: 1, voiceInterruption: 1 } },
    }),
  },
}));
vi.mock('@/hooks/useTextOptions', () => ({ useTextDelay: () => 0, useTextAnimationDuration: () => 0 }));
vi.mock('@/Stage/TextBox/TextBox', () => ({ compileSentence: (text: string) => [text] }));
vi.mock('@/Core/gameScripts/vocal', () => ({ playVocal: vi.fn() }));
vi.mock('@/Core/util/prefetcher/assetsPrefetcher', () => ({ assetsPrefetcher: vi.fn() }));
vi.mock('@/Core/util/prefetcher/progressPrefetcher', () => ({ prefetchCurrentSceneByProgress: vi.fn() }));
vi.mock('@/Core/util/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/Core/initializeScript', () => ({ isIOS: false, initializeScript: vi.fn() }));
vi.mock('@/Core/Modules/animationFunctions', () => ({
  applyAnimationEndState: vi.fn(),
  getAnimateDuration: () => 0,
}));
vi.mock('@/Core/controller/stage/pixi/PixiController', () => ({ default: class PixiStageCpuSeam {} }));
vi.mock('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton', () => ({ attachmentRuntime: runtime }));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ refreshAttachmentPresentation: refresh }));

const { PerformController } = await import('@/Core/Modules/perform/performController');
const { SceneManager } = await import('@/Core/Modules/scene');
const { WebGAL } = await import('@/Core/WebGAL');
const { sceneParser } = await import('@/Core/parser/sceneParser');
const { forward, commitForward, nextSentence } = await import('@/Core/controller/gamePlay/nextSentence');
const { runFastPreview } = await import('@/Core/util/syncWithEditor/runtime/previewSyncSceneCommand');
const { gameInputBoundaryDiagnostics } = await import('@/Core/controller/gamePlay/gameInputBoundary');
const { getAttachmentCommandPresentationCounts } = await import(
  '@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation'
);
const { getPendingAttachmentAddIntentCount } = await import('./stageEntityCommandState');

function arg(sentence: ISentence, key: string) {
  return sentence.args.find((candidate) => candidate.key === key)?.value;
}

function pendingAddWitnesses() {
  return stageStateManager
    .getViewStageState()
    .PerformList.filter((row) => row.script.command === commandType.attachment && row.script.content.trim() === 'add');
}

function operationPerform(): IPerform | undefined {
  return controller.performList.find((perform) => perform.performName === `stage-entity-operation-${entityId}`);
}

function installScene(scene: IScene, sentenceId = 0) {
  WebGAL.sceneManager.sceneData.currentScene = scene;
  WebGAL.sceneManager.sceneData.currentSentenceId = sentenceId;
}

function runRaw(raw: string, name: string) {
  const scene = sceneParser(raw, name, `./game/scene/${name}.txt`);
  installScene(scene);
  const visited: Array<{ sentenceId: number; command: commandType }> = [];
  expect(
    forward({
      scriptExecution: {
        beforeSentenceExecute: ({ sentenceId }) => {
          visited.push({ sentenceId, command: scene.sentenceList[sentenceId].command });
        },
      },
    }),
  ).toBe(true);
  commitForward();
  return { scene, visited };
}

async function microtasks() {
  for (let index = 0; index < 80; index += 1) await Promise.resolve();
}

function drive() {
  frameNumber += 1;
  driverStats.tickCount += 1;
  const parent = stageRoot.enableTempParent();
  try {
    stageRoot.updateTransform();
    for (const driver of drivers.filter((candidate) => !candidate.cleaned)) {
      driver.options.consumer.syncVisualState?.();
      driver.options.consumer.update(
        {
          frame: frameNumber,
          timestamp: frameNumber * 16,
          deltaMS: 16,
          modelDeltaBeforeReset: 16,
          elapsedTime: frameNumber * 16,
        },
        { ...driverStats, attachmentUpdateCount: driverStats.attachmentUpdateCount + 1 },
      );
    }
  } finally {
    stageRoot.disableTempParent(parent);
  }
}

async function advance(duration: number) {
  for (let elapsed = 0; elapsed < duration; elapsed += 16) {
    vi.advanceTimersByTime(16);
    drive();
    await microtasks();
  }
}

function exactSceneAndAddIndex() {
  const scene = sceneParser(rawScene, 'Runtime01-frozen', './game/scene/Runtime01-frozen.txt');
  const addIndex = scene.sentenceList.findIndex(
    (sentence) =>
      sentence.command === commandType.attachment &&
      sentence.content.trim() === 'add' &&
      arg(sentence, 'entity') === entityId,
  );
  expect(addIndex).toBeGreaterThanOrEqual(0);
  return { scene, addIndex };
}

async function startExactPendingAdd() {
  textureGate = deferred();
  const { scene, addIndex } = exactSceneAndAddIndex();
  installScene(scene, addIndex);
  const visited: number[] = [];
  expect(
    forward({
      scriptExecution: { beforeSentenceExecute: ({ sentenceId }) => visited.push(sentenceId) },
    }),
  ).toBe(true);
  expect(visited).toEqual([addIndex, addIndex + 1]);
  commitForward();
  await microtasks();
  const perform = operationPerform();
  expect(perform).toMatchObject({ duration: 500, skipNextCollect: true, manualCompletion: true });
  expect(stageStateManager.getViewStageState().showText).toBe(scene.sentenceList[addIndex + 1].content);
  expect(stageStateManager.getViewStageState().attachments[0]).toMatchObject({
    figureKey,
    attachmentId,
    entityId,
    configId: presetId,
    slot: 'headwear',
    semanticAnchor: 'mouth',
    visible: false,
  });
  return { scene, addIndex, perform: perform! };
}

async function replayExactSceneToBeforeAdd() {
  controller.removeAllPerform();
  const previousBridge = bridge;
  previousBridge.dispose();
  runtime.reset();
  stageStateManager.resetCalculationStageState(cloneDeep(initState));
  bridge = new AttachmentStageBridge(host as unknown as AttachmentBridgeHost, runtime, stageStateManager);

  const { scene, addIndex } = exactSceneAndAddIndex();
  installScene(scene, 0);
  while (WebGAL.sceneManager.sceneData.currentSentenceId < addIndex) {
    expect(forward()).toBe(true);
    commitForward();
    await microtasks();
  }

  expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(addIndex);
  expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
  expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(0);
  expect(runtime.list()).toHaveLength(0);
  return { scene, addIndex, previousBridge };
}

async function executeAndSettleExactAdd() {
  textureGate = deferred();
  expect(forward()).toBe(true);
  commitForward();
  await microtasks();
  const gate = textureGate;
  const perform = operationPerform();
  expect(perform).toMatchObject({ duration: 500, skipNextCollect: true, manualCompletion: true });
  gate.resolve();
  await bridge.whenSettled();
  drive();
  await advance(520);
  expect(runtime.list(figureKey)).toHaveLength(1);
  expect(runtime.getEntity(entityId)).toMatchObject({ visible: true });
  expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
  expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);
  expect(pendingAddWitnesses()).toHaveLength(0);
}

beforeEach(() => {
  delete (outer as typeof outer & { getBasePosition?: unknown }).getBasePosition;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.spyOn(PIXI.settings.ADAPTER, 'createCanvas').mockImplementation(
    () => ({ getContext: () => null } as unknown as HTMLCanvasElement),
  );
  configRequests.length = 0;
  textureRequests.length = 0;
  drivers.length = 0;
  animations.clear();
  loader.clear();
  textureGate = undefined;
  frameNumber = 0;
  driverStats.tickCount = 0;
  driverStats.attachmentUpdateCount = 0;
  renderHolds = 0;
  controller = new PerformController();
  WebGAL.gameplay.performController = controller;
  WebGAL.sceneManager = new SceneManager();
  bridge = new AttachmentStageBridge(host as unknown as AttachmentBridgeHost, runtime, stageStateManager);
  stageStateManager.setCommitHandler((state, options) => {
    if (options.syncPixiStage) bridge.syncCommittedView(state);
    else if (options.applyPixiEffects) bridge.observeCommittedEffects(state);
    if (options.applyPixiEffects) applyEffects();
  });
  stageStateManager.resetAllStageState({
    ...cloneDeep(initState),
    freeFigure: [{ basePosition: 'center', name: modelPath, key: figureKey }],
  });
});

afterEach(async () => {
  textureGate?.resolve();
  await bridge.whenSettled();
  controller.removeAllPerform();
  bridge.dispose();
  runtime.reset();
  await microtasks();
  vi.runOnlyPendingTimers();
  await microtasks();
  stageStateManager.setCommitHandler(null);
  stageStateManager.resetAllStageState(cloneDeep(initState));
  loader.clear();
  expect(runtime.getDiagnostics()).toMatchObject({
    frameDriverCount: 0,
    attachmentControllerCount: 0,
    renderProxyCount: 0,
    externalTransformTargetCount: 0,
    stageEntityCount: 0,
  });
  expect(external.getAll()).toHaveLength(0);
  expect(drivers.every((driver) => driver.cleaned)).toBe(true);
  expect(renderHolds).toBe(0);
  expect(getPendingAttachmentAddIntentCount()).toBe(0);
  expect(getAttachmentCommandPresentationCounts()).toEqual({ visibility: 0, visuals: 0, addFailures: 0 });
  expect(gameInputBoundaryDiagnostics().advanceLockOwners).toEqual([]);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  runtime.destroy();
  app.ticker.destroy();
  stageRoot.destroy({ children: true });
});

describe('Runtime01 frozen real-input CPU chain (no GPU and no real Live2D frame)', () => {
  it.each(independentSceneCases)(
    'parses independent cold-start scene $file',
    ({ file, addCount, stageEntityCount }) => {
      const raw = readFileSync(new URL(file, `file:///${matrixSceneRoot.replace(/\\/gu, '/')}/`), 'utf8');
      const scene = sceneParser(raw, file, `./game/scene/${file}`);
      expect(scene.sentenceList[0].command).toBe(commandType.changeFigure);
      expect(scene.sentenceList.filter((sentence) => sentence.command === commandType.attachment)).toHaveLength(
        addCount,
      );
      expect(scene.sentenceList.filter((sentence) => sentence.command === commandType.stageEntity)).toHaveLength(
        stageEntityCount,
      );
      const authored = scene.sentenceList.filter((sentence) => sentence.command !== commandType.comment);
      expect(authored[authored.length - 1]?.command).toBe(commandType.say);
    },
  );

  it('settles parsed add and entity transform through the production fast-preview replay path', async () => {
    const sceneName = 'IR02-F01-fast-preview';
    const scene = sceneParser(
      [
        `attachment:add -figure=${figureKey} -id=${attachmentId} -entity=${entityId} -config=${presetId} -profile=${profileId} -slot=headwear -anchor=mouth -duration=500 -next;`,
        `setTransform:{"position":{"x":70,"y":20},"alpha":0.6} -target=${entityId} -duration=500;`,
        'F01 intermediate dialogue;',
        'F01 target dialogue;',
      ].join('\n'),
      sceneName,
      `./game/scene/${sceneName}.txt`,
    );
    installScene(scene);

    const result = await runFastPreview(4, sceneName);

    expect(result).toMatchObject({ stopReason: 'target-reached', sceneName, sentenceId: 4, isTimedOut: false });
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(4);
    const view = stageStateManager.getViewStageState();
    expect(view.showText).toBe('F01 target dialogue');
    expect(view.attachments[0]).toMatchObject({ entityId, visible: true });
    expect(view.stageEntities[0].visualState).toMatchObject({
      visible: true,
      position: { x: 70, y: 20 },
      opacity: 0.6,
    });
    expect(view.effects.find((effect) => effect.target === entityId)?.transform).toMatchObject({
      position: { x: 70, y: 20 },
      alpha: 0.6,
    });
    expect(operationPerform()).toBeUndefined();
    expect(
      controller.performList.some((perform) => perform.performName.startsWith(`entity-transform-${entityId}-`)),
    ).toBe(false);
  });

  it.each(['normal', 'immediate'] as const)(
    'keeps %s execute-to-here pending across a real detach barrier and resumes the original target once',
    async (settleMode) => {
      await startExactPendingAdd();
      textureGate!.resolve();
      await bridge.whenSettled();
      drive();
      await advance(520);
      expect(runtime.getEntity(entityId)).toMatchObject({ state: 'attached', visible: true });

      const sceneName = `IR02-F02-detach-${settleMode}`;
      const scene = sceneParser(
        [
          `stageEntity:detach -entity=${entityId};`,
          `setTransform:{"position":{"x":123,"y":45}} -target=${entityId} -duration=0;`,
          `${settleMode} target dialogue;`,
        ].join('\n'),
        sceneName,
        `./game/scene/${sceneName}.txt`,
      );
      installScene(scene);

      let settled = false;
      const preview = runFastPreview(3, sceneName, undefined, settleMode).then((result) => {
        settled = true;
        return result;
      });
      await microtasks();

      expect(settled).toBe(false);
      expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(1);
      expect(operationPerform()).toMatchObject({ manualCompletion: true });
      expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).not.toBeNull();

      drive();
      await microtasks();

      await expect(preview).resolves.toMatchObject({
        stopReason: 'target-reached',
        sceneName,
        sentenceId: 3,
        isTimedOut: false,
      });
      expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(3);
      expect(stageStateManager.getViewStageState().showText).toBe(`${settleMode} target dialogue`);
      expect(stageStateManager.getViewStageState().stageEntities[0]).toMatchObject({
        entityId,
        attachmentLink: null,
        visualState: { space: 'world', position: { x: 123, y: 45 } },
      });
      expect(runtime.getEntity(entityId)).toMatchObject({ state: 'free' });
      expect(operationPerform()).toBeUndefined();
    },
  );

  it('waits for a real reattach return flight before resuming the original execute-to-here target', async () => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);

    const detachSceneName = 'IR02-F02-reattach-setup';
    const detachScene = sceneParser(
      [`stageEntity:detach -entity=${entityId};`, 'detached;'].join('\n'),
      detachSceneName,
      `./game/scene/${detachSceneName}.txt`,
    );
    installScene(detachScene);
    const detached = runFastPreview(2, detachSceneName);
    await microtasks();
    drive();
    await microtasks();
    await expect(detached).resolves.toMatchObject({ stopReason: 'target-reached', sentenceId: 2 });
    expect(runtime.getEntity(entityId)).toMatchObject({ state: 'free' });

    const sceneName = 'IR02-F02-reattach';
    const scene = sceneParser(
      [
        `stageEntity:reattach -entity=${entityId} -figure=${figureKey} -anchor=mouth -profile=${profileId} -duration=0;`,
        'reattach target dialogue;',
      ].join('\n'),
      sceneName,
      `./game/scene/${sceneName}.txt`,
    );
    installScene(scene);

    let settled = false;
    const preview = runFastPreview(2, sceneName).then((result) => {
      settled = true;
      return result;
    });
    await microtasks();
    expect(settled).toBe(false);
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(1);
    expect(operationPerform()).toMatchObject({ manualCompletion: true });

    await advance(32);
    await bridge.whenSettled();
    drive();
    await microtasks();

    await expect(preview).resolves.toMatchObject({
      stopReason: 'target-reached',
      sceneName,
      sentenceId: 2,
    });
    expect(stageStateManager.getViewStageState().showText).toBe('reattach target dialogue');
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).toMatchObject({
      parentFigureKey: figureKey,
      semanticAnchor: 'mouth',
    });
    expect(runtime.getEntity(entityId)).toMatchObject({ state: 'attached' });
    expect(operationPerform()).toBeUndefined();
  });

  it('does not resume an exact detach barrier after a newer scene mutation resets its operation owner', async () => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);

    const sceneName = 'IR02-F02-detach-superseded';
    const scene = sceneParser(
      [`stageEntity:detach -entity=${entityId};`, 'stale target must not execute;'].join('\n'),
      sceneName,
      `./game/scene/${sceneName}.txt`,
    );
    installScene(scene);
    const mutation = beginSceneMutation('terre-sync');
    const preview = runFastPreview(2, sceneName, undefined, 'normal', { mutation });
    await microtasks();

    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(1);
    expect(operationPerform()).toMatchObject({ manualCompletion: true });

    beginSceneMutation('terre-sync');
    controller.removeAllPerform();
    await expect(preview).resolves.toBeNull();
    drive();
    await microtasks();

    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(1);
    expect(stageStateManager.getViewStageState().showText).not.toBe('stale target must not execute');
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).not.toBeNull();
    expect(runtime.getEntity(entityId)).toMatchObject({ state: 'attached' });
    expect(operationPerform()).toBeUndefined();
  });

  it('keeps exact package/scene identity and proves -next dialogue is not a readiness barrier', async () => {
    expect(pngBytes.byteLength).toBe(736_998);
    expect(pngBytes.readUInt32BE(16)).toBe(2172);
    expect(pngBytes.readUInt32BE(20)).toBe(724);
    expect(adaptation.preset).toMatchObject({
      presetId,
      modelProfileId: profileId,
      anchorName: 'mouth',
      placement: { offset: { x: 15, y: -10 }, localScale: 0.1 },
    });
    expect(adaptation.modelProfile).toMatchObject({
      modelProfileId: profileId,
      modelPath,
      fingerprint: {
        modelJsonSha256: expectedHashes[relativeModel],
        drawableCount: 155,
        mocSha256: '0E3AF40095E57255DC855C03756176F7B40889EE4E43655151275F93E496F0ED',
      },
    });
    expect(mouth).toMatchObject({
      drawableId: 'D_PSD.50',
      vertexCount: 55,
    });
    expect(mouth.points.map((point) => point.index)).toEqual([13, 16, 28, 40, 42]);
    expect(attachmentPackage.asset.layers.front).toBe(frontUrl);
    expect(attachmentPackage.asset.attachedLayers.front).toBe(frontUrl);
    expect(exactAddLine).toContain('-next;');
    expect(exactAddLine).not.toContain('-duration=');

    const loaded = await loader.load(presetId, modelPath);
    expect(loaded.sourceUrl).toBe(packageUrl);
    expect(loaded.config).toMatchObject({
      configId: presetId,
      target: { modelPath, anchorProfile: { drawableId: 'D_PSD.50' } },
      layers: { front: frontUrl },
      placement: { offset: { x: 15, y: -10 }, localScale: 0.1 },
    });
    expect(loaded.config.target.anchorProfile.anchors.map((point) => point.index)).toEqual([13, 16, 28, 40, 42]);
    expect(loaded.modelBinding).toMatchObject({
      modelProfileId: profileId,
      modelPath,
      anchorName: 'mouth',
      drawableId: 'D_PSD.50',
      vertexCount: 55,
      anchorVertexIndices: [13, 16, 28, 40, 42],
    });
    loader.clear();
    configRequests.length = 0;

    const { scene, addIndex, perform } = await startExactPendingAdd();
    expect(scene.sentenceList[addIndex]).toMatchObject({ command: commandType.attachment, content: 'add' });
    expect(arg(scene.sentenceList[addIndex], 'next')).toBe(true);
    expect(arg(scene.sentenceList[addIndex], 'duration')).toBeUndefined();
    expect(arg(scene.sentenceList[addIndex], 'figure')).toBe(figureKey);
    expect(arg(scene.sentenceList[addIndex], 'id')).toBe(attachmentId);
    expect(arg(scene.sentenceList[addIndex], 'entity')).toBe(entityId);
    expect(arg(scene.sentenceList[addIndex], 'config')).toBe(presetId);
    expect(arg(scene.sentenceList[addIndex], 'slot')).toBe('headwear');
    expect(arg(scene.sentenceList[addIndex], 'anchor')).toBe('mouth');
    expect(configRequests).toEqual([packageUrl]);
    expect(textureRequests).toEqual([frontUrl]);
    expect(runtime.get(figureKey, attachmentId)?.phase).not.toBe('ready');
    expect(pendingAddWitnesses()).toHaveLength(1);

    const further = forward({
      scriptExecution: {
        beforeSentenceExecute: ({ sentenceId }) => expect(sentenceId).toBe(addIndex + 2),
      },
    });
    expect(further).toBe(true);
    commitForward();
    expect(stageStateManager.getViewStageState().showText).toBe(scene.sentenceList[addIndex + 2].content);
    expect(operationPerform()).toBe(perform);
    expect(pendingAddWitnesses()).toHaveLength(1);
    const pendingSave = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(pendingSave.attachments[0].visible).toBe(true);
    expect(pendingSave.stageEntities[0].visualState.visible).toBe(true);
    expect(
      pendingSave.PerformList.some(
        (row) => row.script.command === commandType.attachment && row.script.content.trim() === 'add',
      ),
    ).toBe(false);

    textureGate!.resolve();
    await bridge.whenSettled();
    await microtasks();
    expect(runtime.get(figureKey, attachmentId)).toMatchObject({
      phase: 'ready',
      visible: true,
      firstValidPose: { status: 'pending' },
      modelBinding: { modelProfileId: profileId, drawableId: 'D_PSD.50', vertexCount: 55 },
    });
    expect(pendingAddWitnesses()).toHaveLength(1);
    expect(operationPerform()).toBe(perform);

    drive();
    await microtasks();
    expect(runtime.get(figureKey, attachmentId)?.firstValidPose.status).toBe('ready');
    expect(perform.skipNextCollect).toBe(false);
    expect(pendingAddWitnesses()).toHaveLength(0);
    expect(operationPerform()).toBe(perform);

    await advance(520);
    expect(operationPerform()).toBeUndefined();
    expect(runtime.get(figureKey, attachmentId)).toMatchObject({ phase: 'ready', visible: true });
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(true);
  });

  it('an actual parsed hide retracts the exact pending witness and persists authored hidden state', async () => {
    const pending = await startExactPendingAdd();
    const { visited } = runRaw(`stageEntity:hide -entity=${entityId} -duration=0;`, 'Runtime01-hide');
    expect(visited).toEqual([{ sentenceId: 0, command: commandType.stageEntity }]);
    expect(controller.performList).not.toContain(pending.perform);
    expect(operationPerform()?.skipNextCollect).not.toBe(true);
    expect(pendingAddWitnesses()).toHaveLength(0);
    const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
    expect(saved.attachments[0].visible).toBe(false);
    expect(saved.stageEntities[0].visualState.visible).toBe(false);
    expect(saved.PerformList).toHaveLength(0);
    textureGate!.resolve();
    await bridge.whenSettled();
    await advance(32);
    expect(runtime.getEntity(entityId)?.visible).toBe(false);
  });

  it('does not let queued user clicks outrun the first inspectable attachment pose', async () => {
    const { scene, addIndex } = await startExactPendingAdd();
    const firstInspectableDialogue = scene.sentenceList[addIndex + 1].content;
    const firstSafeNextSentenceId = addIndex + 2;

    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(firstSafeNextSentenceId);
    expect(stageStateManager.getViewStageState().showText).toBe(firstInspectableDialogue);

    nextSentence();
    nextSentence();
    nextSentence();

    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(firstSafeNextSentenceId);
    expect(stageStateManager.getViewStageState().showText).toBe(firstInspectableDialogue);
    expect(operationPerform()).toMatchObject({ skipNextCollect: true, manualCompletion: true });
    expect(pendingAddWitnesses()).toHaveLength(1);

    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await microtasks();
    expect(runtime.getEntity(entityId)).toMatchObject({ visible: true });
    expect(operationPerform()?.skipNextCollect).toBe(false);

    nextSentence();
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(firstSafeNextSentenceId);
    nextSentence();
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBeGreaterThan(firstSafeNextSentenceId);
  });

  it('a second parsed exact add supersedes only the old operation owner and settles as one entity', async () => {
    const first = await startExactPendingAdd();
    const { scene, visited } = runRaw(
      `${exactAddLine}\n替代说明:replacement remains non-blocking;`,
      'Runtime01-supersede',
    );
    expect(visited).toEqual([
      { sentenceId: 0, command: commandType.attachment },
      { sentenceId: 1, command: commandType.say },
    ]);
    const second = operationPerform();
    expect(second).toBeDefined();
    expect(second).not.toBe(first.perform);
    expect(controller.performList).not.toContain(first.perform);
    expect(pendingAddWitnesses()).toHaveLength(1);
    expect(pendingAddWitnesses()[0].script).toEqual(scene.sentenceList[0]);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);

    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    expect(runtime.list(figureKey)).toHaveLength(1);
    expect(runtime.getEntity(entityId)).toBeDefined();
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);
    expect(pendingAddWitnesses()).toHaveLength(0);
  });

  it('an actual parsed remove retracts state and late texture completion cannot resurrect it', async () => {
    const order: Array<Record<string, unknown>> = [];
    const errors: unknown[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((diagnostic) => {
      errors.push(diagnostic);
      order.push({
        event: 'diagnostic',
        code: (diagnostic as { code?: string })?.code,
        oldAddStillActive: pending ? controller.performList.includes(pending.perform) : undefined,
        currentOperationIsOldAdd: pending ? operationPerform() === pending.perform : undefined,
      });
    });
    let pending: Awaited<ReturnType<typeof startExactPendingAdd>> | undefined;
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type !== 'instance-removed' || event.figureKey !== figureKey || event.attachmentId !== attachmentId)
        return;
      order.push({
        event: 'runtime-instance-removed',
        oldAddStillActive: pending ? controller.performList.includes(pending.perform) : undefined,
        currentOperationIsOldAdd: pending ? operationPerform() === pending.perform : undefined,
      });
    });
    pending = await startExactPendingAdd();
    runRaw(`stageEntity:remove -entity=${entityId} -duration=0;`, 'Runtime01-remove');
    unsubscribe();
    expect(controller.performList).not.toContain(pending.perform);
    expect(operationPerform()?.skipNextCollect).not.toBe(true);
    expect(pendingAddWitnesses()).toHaveLength(0);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(0);
    textureGate!.resolve();
    await bridge.whenSettled();
    await advance(32);
    expect(runtime.get(figureKey, attachmentId)).toBeUndefined();
    expect(runtime.getEntity(entityId)).toBeUndefined();
    expect(external.getByKey(entityId)).toBeUndefined();
    expect(order).toEqual([
      { event: 'runtime-instance-removed', oldAddStillActive: true, currentOperationIsOldAdd: true },
    ]);
    expect(errors).toEqual([]);
    errorSpy.mockRestore();
  });

  it('still reports a real unexpected Runtime removal while the exact add declaration remains current', async () => {
    const errors: Array<{ code?: string; message?: string }> = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((diagnostic) => {
      errors.push(diagnostic as { code?: string; message?: string });
    });
    await startExactPendingAdd();
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(false);
    expect(runtime.remove(figureKey, attachmentId)).toBe(true);
    await microtasks();
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'ATTACHMENT_ADD_FADE_FAILED',
        message: 'Attachment removed before its add became ready',
      }),
    ]);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(0);
    expect(operationPerform()).toBeUndefined();
    textureGate!.resolve();
    await bridge.whenSettled();
    await advance(32);
    expect(runtime.get(figureKey, attachmentId)).toBeUndefined();
    expect(runtime.getEntity(entityId)).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('reconstructs exactly one visible attachment when the same execute-to-here path is replayed after a settled add', async () => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    expect(runtime.list(figureKey)).toHaveLength(1);
    expect(runtime.getEntity(entityId)).toMatchObject({ visible: true });

    await replayExactSceneToBeforeAdd();
    await executeAndSettleExactAdd();
  });

  it('prevents a late first replay from deleting or replacing the second replay of the same add', async () => {
    await startExactPendingAdd();
    const firstTextureGate = textureGate!;
    const { previousBridge } = await replayExactSceneToBeforeAdd();

    textureGate = deferred();
    const secondTextureGate = textureGate;
    expect(forward()).toBe(true);
    commitForward();
    await microtasks();
    expect(operationPerform()).toMatchObject({ duration: 500, skipNextCollect: true, manualCompletion: true });

    firstTextureGate.resolve();
    await previousBridge.whenSettled();
    await microtasks();
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);

    secondTextureGate.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    expect(runtime.list(figureKey)).toHaveLength(1);
    expect(runtime.getEntity(entityId)).toMatchObject({ visible: true });
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(1);
    expect(pendingAddWitnesses()).toHaveLength(0);
  });

  it('reset retracts the pending owner before a late transport settles', async () => {
    await startExactPendingAdd();
    const oldBridge = bridge;
    controller.removeAllPerform();
    oldBridge.dispose();
    runtime.reset();
    stageStateManager.resetAllStageState(cloneDeep(initState));
    textureGate!.resolve();
    await oldBridge.whenSettled();
    await advance(32);
    expect(controller.performList).toHaveLength(0);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(0);
    expect(runtime.list()).toHaveLength(0);
    expect(runtime.getEntity(entityId)).toBeUndefined();
    expect(external.getByKey(entityId)).toBeUndefined();

    bridge = new AttachmentStageBridge(host as unknown as AttachmentBridgeHost, runtime, stageStateManager);
  });
});

describe('COORD01 parser/state/Runtime author boundary', () => {
  it('rejects an unknown coordinate mode without detaching or mutating the committed entity', async () => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    const previous = cloneDeep(stageStateManager.getViewStageState().stageEntities);
    const detach = vi.spyOn(runtime, 'requestDetach'),
      diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    runRaw(`stageEntity:detach -entity=${entityId} -coordinates=unknown;`, 'COORD01-invalid');
    drive();
    await microtasks();
    expect(detach).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'STAGE_ENTITY_COORDINATES_INVALID' }));
    expect(stageStateManager.getViewStageState().stageEntities).toEqual(previous);
  });
  it.each([
    { mode: 'figure', x: 960, y: 540 },
    { mode: 'figure', x: 530, y: 700 },
    { mode: 'figure', x: 1390, y: 540 },
    { mode: 'world', x: 960, y: 540 },
  ])('$mode origin $x,$y stays frozen through parent movement and return flight', async ({ mode, x, y }) => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    const nativeOrigin = { x, y };
    Object.assign(outer, { getBasePosition: () => nativeOrigin });
    outer.position.set(x + 260, y + 100);
    drive();
    const local = cloneDeep(runtime.getEntity(entityId)!.visualState!);
    runRaw(`stageEntity:detach -entity=${entityId} -coordinates=${mode};`, 'COORD01-detach');
    drive();
    await microtasks();
    expect(runtime.getEntity(entityId)?.state).toBe('free');
    const world = cloneDeep(runtime.getEntity(entityId)!.visualState!);
    const source = stageStateManager.getViewStageState().stageEntities[0].source;
    expect(source.freePositionOrigin).toEqual(mode === 'figure' ? { x, y } : undefined);
    // The origin is a value snapshot, never an alias or an observer of the parent.
    nativeOrigin.x += 333;
    outer.position.x += 222;
    drive();
    expect(runtime.getEntity(entityId)!.visualState!.position).toEqual(world.position);
    const saved = JSON.parse(JSON.stringify(createCommittedStageSnapshot(stageStateManager.getViewStageState())));
    controller.removeAllPerform();
    bridge.dispose();
    runtime.reset();
    bridge = new AttachmentStageBridge(host as unknown as AttachmentBridgeHost, runtime, stageStateManager);
    stageStateManager.resetAllStageState(saved);
    refresh();
    await bridge.whenSettled();
    drive();
    await microtasks();
    expect(runtime.getEntity(entityId)?.state).toBe('free');
    expect(runtime.getEntity(entityId)!.visualState!.position.x).toBeCloseTo(world.position.x, 5);
    expect(runtime.getEntity(entityId)!.visualState!.position.y).toBeCloseTo(world.position.y, 5);
    expect(stageStateManager.getViewStageState().stageEntities[0].source.freePositionOrigin).toEqual(
      mode === 'figure' ? { x, y } : undefined,
    );
    runRaw(`setTransform:{"position":{"x":-180,"y":-100}} -target=${entityId} -duration=900;`, 'COORD01-transform');
    await advance(960);
    expect(runtime.getEntity(entityId)!.visualState!.position).toEqual({
      x: (mode === 'figure' ? x : 0) - 180,
      y: (mode === 'figure' ? y : 0) - 100,
    });
    runRaw(
      `stageEntity:reattach -entity=${entityId} -figure=${figureKey} -anchor=mouth -duration=1100;`,
      'COORD01-return',
    );
    drive();
    await advance(1200);
    expect(runtime.getEntity(entityId)?.state).toBe('attached');
    expect(runtime.getEntity(entityId)!.visualState!.position.x).toBeCloseTo(local.position.x, 5);
    expect(runtime.getEntity(entityId)!.visualState!.position.y).toBeCloseTo(local.position.y, 5);
    expect(stageStateManager.getViewStageState().stageEntities[0].source.freePositionOrigin).toBeUndefined();
  });
});

describe('R05 regression: production CPU seams, no GUI acceptance', () => {
  it.each(['timeout', 'replacement', 'reset', 'new-request', 'remove-readd'] as const)(
    'retires cold detach readiness on %s without executing the following dialogue',
    async (action) => {
      textureGate = deferred();
      const name = `R05-cold-${action}`;
      installScene(
        sceneParser(
          [
            `attachment:add -figure=${figureKey} -id=${attachmentId} -entity=${entityId} -config=${presetId} -slot=headwear -anchor=mouth -next;`,
            'baseline;',
            `stageEntity:detach -entity=${entityId} -continue;`,
            'must not execute;',
          ].join('\n'),
          name,
          `./game/scene/${name}.txt`,
        ),
      );
      const mutation = beginSceneMutation('terre-sync');
      const preview = runFastPreview(4, name, undefined, 'normal', { mutation });
      await microtasks();
      expect(runtime.getDiagnostics().pendingDetachMaterializationCount).toBe(1);
      if (action === 'timeout') await advance(520);
      else if (action === 'replacement') runtime.beginFigureReplacement(figureKey, 'new-generation');
      else if (action === 'remove-readd') {
        runtime.remove(figureKey, attachmentId);
        refresh();
      } else if (action === 'reset') runtime.reset();
      else {
        beginSceneMutation('terre-sync');
        controller.removeAllPerform();
      }
      await microtasks();
      const result = await preview;
      if (action === 'new-request') expect(result).toBeNull();
      else expect(result?.stopReason).toBe('state-calculation-failed');
      expect(stageStateManager.getViewStageState().showText).toBe('baseline');
      expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(3);
      expect(runtime.getDiagnostics().pendingDetachMaterializationCount).toBe(0);
      textureGate.resolve();
      await bridge.whenSettled();
      await advance(32);
      expect(runtime.getEntity(entityId)?.state).not.toBe('free');
    },
  );

  it('reports config failure without consuming continue or leaking readiness', async () => {
    vi.spyOn(loader, 'load').mockRejectedValue(new Error('R05 injected configuration failure'));
    const name = 'R05-config-failure';
    installScene(
      sceneParser(
        [
          `attachment:add -figure=${figureKey} -id=${attachmentId} -entity=${entityId} -config=${presetId} -slot=headwear -anchor=mouth -next;`,
          'baseline;',
          `stageEntity:detach -entity=${entityId} -continue;`,
          'must not execute;',
        ].join('\n'),
        name,
        `./game/scene/${name}.txt`,
      ),
    );
    const preview = runFastPreview(4, name);
    await microtasks();
    await bridge.whenSettled();
    await advance(520);
    expect((await preview)?.stopReason).toBe('state-calculation-failed');
    expect(stageStateManager.getViewStageState().showText).toBe('baseline');
    expect(runtime.getDiagnostics().pendingDetachMaterializationCount).toBe(0);
  });

  it.each([false, true])('follows the current frame throughout return flight; cancel=%s', async (cancel) => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    runRaw(
      `setTransform:{"position":{"x":7,"y":9},"scale":{"x":1.2,"y":0.8},"rotation":0.1} -target=${entityId} -duration=0;`,
      'R05-authored-local',
    );
    await advance(32);
    const initialLocal = cloneDeep(runtime.getEntity(entityId)!.visualState!);
    runRaw(`stageEntity:detach -entity=${entityId};`, 'R05-detach');
    drive();
    await microtasks();
    const from = cloneDeep(runtime.getEntity(entityId)!.visualState!);
    const progressSpy = vi.spyOn(runtime, 'setReattachFlightProgress');
    const prepareSpy = vi.spyOn(runtime, 'prepareReattach');
    const commitSpy = vi.spyOn(runtime, 'commitReattach');
    runRaw(
      `stageEntity:reattach -entity=${entityId} -figure=${figureKey} -anchor=mouth -duration=1100 -ease=easeInOut;`,
      'R05-moving-return',
    );
    drive();
    await microtasks();
    const destination = (await prepareSpy.mock.results[0].value).targetVisualState;
    const initialVertices = vertices.slice();
    const initialOuterY = outer.y;
    try {
      for (let frame = 1; frame <= 30; frame++) {
        const delta = Math.sin(frame / 6) * 12;
        for (const point of mouth.points) vertices[point.index * 2 + 1] = initialVertices[point.index * 2 + 1] + delta;
        outer.y = initialOuterY + frame;
        await advance(16);
        const progress = progressSpy.mock.calls.at(-1)![1];
        const deltaRounded = vertices[mouth.points[0].index * 2 + 1] - initialVertices[mouth.points[0].index * 2 + 1];
        expect(runtime.getEntity(entityId)!.visualState!.position.y).toBeCloseTo(
          from.position.y + (destination.position.y + deltaRounded + frame - from.position.y) * progress,
          3,
        );
        const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
        expect(saved.stageEntities[0].attachmentLink).toBeNull();
      }
      if (cancel) {
        const sampled = cloneDeep(runtime.getEntity(entityId)!.visualState!);
        controller.removeAllPerform();
        await advance(64);
        expect(runtime.getEntity(entityId)?.state).toBe('free');
        expect(runtime.getEntity(entityId)!.visualState!.position).toEqual(sampled.position);
        expect(commitSpy).not.toHaveBeenCalled();
      } else {
        await advance(750);
        expect(runtime.getEntity(entityId)?.state).toBe('attached');
        const local = runtime.getEntity(entityId)!.visualState!;
        expect(local.position.x).toBeCloseTo(initialLocal.position.x, 5);
        expect(local.position.y).toBeCloseTo(initialLocal.position.y, 5);
        expect(local.rotation).toBeCloseTo(initialLocal.rotation, 5);
        expect(local.scale.x).toBeCloseTo(initialLocal.scale.x, 5);
        expect(local.scale.y).toBeCloseTo(initialLocal.scale.y, 5);
        const saved = createCommittedStageSnapshot(stageStateManager.getViewStageState());
        expect(saved.stageEntities[0].attachmentLink?.attachedLocalVisualState.position.y).toBeCloseTo(
          initialLocal.position.y,
          5,
        );
      }
      expect(runtime.getDiagnostics().pendingReattachCount).toBe(0);
    } finally {
      vertices.set(initialVertices);
      outer.y = initialOuterY;
    }
  });
  it.each([6, 8, 10, 11, 12, 14])('EXACT_R05 target pointer %s must not stop at A', async (target) => {
    const raw = readFileSync(
      new URL(
        '../../../../../../23_5l-execution/evidence/runtime-r05-preparation-20260911/R05-DETACH-TRANSFORM-REATTACH-COLD.txt',
        import.meta.url,
      ),
      'utf8',
    );
    expect(createHash('sha256').update(raw).digest('hex').toUpperCase()).toBe(
      'B5CCC521EACF7C32E8AD03631DD9185420614307E44C56DCABB87C9CE38DBB61',
    );
    const name = 'R05-DETACH-TRANSFORM-REATTACH-COLD.txt';
    // Figure is ready via the existing CPU seam; replay the unmodified authored
    // add onward. This deliberately does not claim to test figure loading or GUI reset.
    installScene(sceneParser(raw, name, `./game/scene/${name}`), 2);
    const result = runFastPreview(target, name);
    await microtasks();
    await bridge.whenSettled();
    await advance(1400);

    await expect(result).resolves.toMatchObject({ stopReason: 'target-reached', sentenceId: target });
  });

  it.each([
    { x: 0, y: 0 },
    { x: -180, y: -100 },
    { x: 180, y: 100 },
  ])('COORD legacy world mode endpoint $x,$y remains absolute', async (position) => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    runRaw(`stageEntity:detach -entity=${entityId} -coordinates=world;`, 'R05-coordinate-detach');
    drive();
    await microtasks();
    const detached = runtime.getEntity(entityId)!.visualState!;
    runRaw(`setTransform:${JSON.stringify({ position })} -target=${entityId} -duration=0;`, 'R05-coordinate-endpoint');
    await advance(32);
    const actual = runtime.getEntity(entityId)!.visualState!;
    const { WebGALPixiContainer } = await import('@/Core/controller/stage/pixi/WebGALPixiContainer');
    const native = new WebGALPixiContainer();
    native.setBaseX(960);
    native.setBaseY(540);
    applyTransformToPixiContainer(native, { position } as never);

    expect(actual.position).toEqual(position);
    expect(actual.scale).toEqual(detached.scale);
    expect(native.position.x).toBe(position.x + 960);
    expect(native.position.y).toBe(position.y + 540);
    native.destroy();
  });

  it.each([
    ['cold', 'normal', false],
    ['cold', 'normal', true],
    ['cold', 'immediate', false],
    ['cold', 'immediate', true],
    ['ready', 'normal', false],
    ['ready', 'normal', true],
    ['ready', 'immediate', false],
    ['ready', 'immediate', true],
  ] as const)('SEEK %s %s continue=%s', async (readiness, mode, useContinue) => {
    const errors = vi.spyOn(console, 'error');
    if (readiness === 'ready') {
      await startExactPendingAdd();
      textureGate!.resolve();
      await bridge.whenSettled();
      drive();
      await advance(520);
    }
    const lines = [
      ...(readiness === 'cold'
        ? [
            `attachment:add -figure=${figureKey} -id=${attachmentId} -entity=${entityId} -config=${presetId} -slot=headwear -anchor=mouth -next;`,
            'R05 baseline;',
          ]
        : []),
      `stageEntity:detach -entity=${entityId}${useContinue ? ' -continue' : ''};`,
      'R05A detached;',
      `setTransform:{"position":{"x":180,"y":100}} -target=${entityId} -duration=0;`,
      'R05C target;',
    ];
    const name = `R05-${readiness}-${mode}-${useContinue}`;
    installScene(sceneParser(lines.join('\n'), name, `./game/scene/${name}.txt`));
    let result: unknown;
    let done = false;
    const preview = runFastPreview(lines.length, name, undefined, mode).then((value) => {
      result = value;
      done = true;
      return value;
    });
    await microtasks();
    await bridge.whenSettled();
    await advance(1100);

    expect(done).toBe(true);
    await expect(preview).resolves.toMatchObject({ stopReason: 'target-reached', sentenceId: lines.length });
    expect(runtime.getEntity(entityId)?.state).toBe('free');
  });

  it.each([0, 12, -12])('REATTACH restores local placement after mouth delta %s', async (deltaY) => {
    await startExactPendingAdd();
    textureGate!.resolve();
    await bridge.whenSettled();
    drive();
    await advance(520);
    const initialLocal = cloneDeep(runtime.getEntity(entityId)!.visualState!);
    runRaw(`stageEntity:detach -entity=${entityId};`, 'R05-detach-setup');
    drive();
    await microtasks();
    expect(runtime.getEntity(entityId)?.state).toBe('free');
    const preparedSpy = vi.spyOn(runtime, 'prepareReattach');
    runRaw(
      `stageEntity:reattach -entity=${entityId} -figure=${figureKey} -anchor=mouth -duration=1100 -ease=easeInOut;`,
      'R05-reattach-moving-mouth',
    );
    drive();
    await microtasks();
    expect(preparedSpy).toHaveBeenCalledTimes(1);
    const prepared = await preparedSpy.mock.results[0].value;
    expect(prepared.targetVisualState.space).toBe('world');
    const previousVertices = vertices.slice();
    try {
      for (const point of mouth.points) vertices[point.index * 2 + 1] += deltaY;
      await advance(1200);
      const finalLocal = runtime.getEntity(entityId)!.visualState!;
      const persisted = stageStateManager.getViewStageState().stageEntities[0].attachmentLink?.attachedLocalVisualState;

      expect(runtime.getEntity(entityId)?.state).toBe('attached');
      expect(finalLocal.position.x).toBeCloseTo(initialLocal.position.x, 5);
      expect(finalLocal.position.y).toBeCloseTo(initialLocal.position.y, 5);
      expect(persisted?.position.y).toBeCloseTo(initialLocal.position.y, 5);
    } finally {
      vertices.set(previousVertices);
    }
  });
});
