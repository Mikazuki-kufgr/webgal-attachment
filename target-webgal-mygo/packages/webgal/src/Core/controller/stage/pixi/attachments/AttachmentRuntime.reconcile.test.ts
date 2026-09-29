import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { AttachmentRuntime } from './AttachmentRuntime';
import { AttachmentConfigLoader } from './configLoader';
import { normalizeLayeredModelPath } from './profileLoader';
import { ExternalStageObjectRegistry } from '../externalStageObjectRegistry';
import { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  initialLegacyAttachmentLocalVisualState,
  legacyAttachmentLink,
} from '@/Core/Modules/stage/stageEntityStateTransaction';
import { AttachmentStageBridge, type AttachmentBridgeHost } from './attachmentStageBridge';
import type {
  AttachmentConfig,
  AttachmentDeclaration,
  AttachmentFigureTarget,
  FreeAttachmentDeclaration,
} from './types';
import type { IStageObject, ActiveLive2DFigureResult } from '../PixiController';
import type { Live2DFrameDriverStats } from '../live2dFrameDriver';

// Actual Runtime, config parser, controllers and PIXI CPU graph. Transport,
// drawable and frame-driver seams are explicit; no GPU/real-model claim.
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
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected CPU lifecycle checkpoint');
}
function setup() {
  const fetchGates = new Map<string, ReturnType<typeof deferred>>();
  const textureGates = new Map<string, ReturnType<typeof deferred>>();
  const texturesRequested = new Set<string>();
  const modelPath = 'game/figure/reconcile/model.json';
  const configuration = (id: string): AttachmentConfig => ({
    schema: 'webgal-live2d-attachment-v1',
    configId: id,
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
    layers: { front: `game/attachments/${id}.png` },
    placement: { spriteAnchor: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, rotationOffsetRad: 0, localScale: 1 },
  });
  const configLoader = new AttachmentConfigLoader({
    fetcher: async (input) => {
      const id = String(input)
        .split('/')
        .at(-1)!
        .replace(/\.json$/, '');
      await fetchGates.get(id)?.promise;
      return new Response(JSON.stringify(configuration(id)), { status: 200 });
    },
  });
  const app = { ticker: new PIXI.Ticker() } as PIXI.Application;
  const external = new ExternalStageObjectRegistry<IStageObject>();
  const stage = {
    currentApp: app,
    figureContainer: new PIXI.Container(),
    isTransformTargetLocked: () => false,
    registerExternalStageObject: (object: IStageObject) => external.register(object),
    unregisterExternalStageObjectByUuid: (uuid: string) => external.unregisterByUuid(uuid),
    getExternalStageObjByUuid: (uuid: string) => external.getByUuid(uuid),
    getExternalStageObjByKey: (key: string) => external.getByKey(key),
    requestRender: () => {},
    acquireExternalRenderActivity: () => () => {},
    subscribeLive2DFigureChanges: () => () => {},
  };
  const stats = { driverCount: 1, cleanupCount: 0 } as Live2DFrameDriverStats;
  const runtime = new AttachmentRuntime({
    configLoader,
    textureLoader: async (url) => {
      texturesRequested.add(url);
      await textureGates.get(url)?.promise;
      return PIXI.Texture.EMPTY;
    },
    driverStarter: (options) => {
      let cleaned = false;
      return {
        getStats: () => ({ ...stats, cleanupCount: Number(cleaned) }),
        cleanup: () => {
          if (!cleaned) {
            cleaned = true;
            options.consumer.destroy({ ...stats, cleanupCount: 1 });
          }
        },
      };
    },
  });
  cleanups.push(() => {
    runtime.destroy();
    app.ticker.destroy();
    stage.figureContainer.destroy({ children: true });
  });
  const figure = (key = 'fig-center', generation = 'g1'): AttachmentFigureTarget => {
    const container = new PIXI.Container();
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
        update: () => {},
      }),
    });
    container.addChild(model);
    stage.figureContainer.addChild(container);
    return { key, generation, sourcePath: modelPath, app, container, model: model as never, stage: stage as never };
  };
  const declaration = (configId = 'a', figureKey = 'fig-center'): AttachmentDeclaration => ({
    figureKey,
    attachmentId: 'hat',
    entityId: figureKey === 'fig-center' ? 'entity-hat' : 'entity-slow',
    configId,
    visible: true,
  });
  return {
    runtime,
    configLoader,
    figure,
    declaration,
    stage,
    modelPath,
    fetchGates,
    textureGates,
    texturesRequested,
    external,
    configuration,
  };
}

describe('HF37 F04 independent free restoration with production Runtime/controller and CPU Pixi', () => {
  const freeDeclaration = (f: ReturnType<typeof setup>, visible = true): FreeAttachmentDeclaration => {
    const local = initialLegacyAttachmentLocalVisualState(visible);
    return {
      ...f.declaration(),
      visible,
      lastAttachedLocalVisualState: local,
      visualState: {
        ...local,
        space: 'world',
        position: { x: 123, y: 45 },
        scale: { x: 1.2, y: 0.8 },
        skew: { x: 0.1, y: -0.2 },
        rotation: 0.3,
        opacity: 0.42,
      },
    };
  };
  it.each([true, false])('restores visible=%s without registering or loading any figure', async (visible) => {
    const f = setup(),
      declaration = freeDeclaration(f, visible);
    f.runtime.setStageHost(f.stage as never);
    const register = vi.spyOn(f.runtime, 'registerFigure');
    await f.runtime.reconcile([], [declaration]);
    expect(register).not.toHaveBeenCalled();
    expect(f.runtime.getDiagnostics()).toMatchObject({
      figureCount: 0,
      frameDriverCount: 0,
      freeEntityCount: 1,
      freeHostCount: 1,
    });
    expect(f.runtime.getEntity('entity-hat')?.visualState).toMatchObject(declaration.visualState);
    expect(f.external.getByKey('entity-hat')?.pixiContainer?.parent).toBe(f.stage.figureContainer);
    expect(f.texturesRequested.has('game/attachments/a.png')).toBe(true);
    expect(f.runtime.getFreeRestoreDiagnostics()).toEqual([]);
    f.runtime.setEntityVisible('entity-hat', !visible);
    expect(f.runtime.getEntity('entity-hat')?.visible).toBe(!visible);
    f.runtime.setEntityVisible('entity-hat', visible);
    f.runtime.setEntityVisualState('entity-hat', { ...declaration.visualState, position: { x: 31, y: 27 } });
    expect(f.runtime.getEntity('entity-hat')?.visualState?.position).toEqual({ x: 31, y: 27 });
    f.runtime.removeEntity('entity-hat');
    expect(f.external.getByKey('entity-hat')).toBeUndefined();
    expect(f.stage.figureContainer.children).toHaveLength(0);
  });
  it('does not use or alter the only incompatible figure', async () => {
    const f = setup(),
      target = { ...f.figure(), sourcePath: 'game/figure/unrelated/model.json' };
    f.runtime.registerFigure(target);
    await f.runtime.reconcile([], [freeDeclaration(f)]);
    expect(f.runtime.getDiagnostics()).toMatchObject({ figureCount: 1, frameDriverCount: 0, freeEntityCount: 1 });
    expect(target.container.children).toEqual([target.model]);
    expect(f.runtime.getEntity('entity-hat')?.state).toBe('free');
  });
  it.each(['remove', 'reset', 'destroy'] as const)(
    '%s prevents a pending free texture load from resurrecting',
    async (action) => {
      const f = setup(),
        gate = deferred();
      f.runtime.setStageHost(f.stage as never);
      f.textureGates.set('game/attachments/a.png', gate);
      const old = f.runtime.reconcile([], [freeDeclaration(f)]);
      await until(() => f.texturesRequested.has('game/attachments/a.png'));
      if (action === 'remove') f.runtime.removeEntity('entity-hat');
      else f.runtime[action]();
      gate.resolve();
      await old;
      expect(f.runtime.getDiagnostics().stageEntityCount).toBe(0);
      expect(f.external.getByKey('entity-hat')).toBeUndefined();
      expect(f.stage.figureContainer.children).toHaveLength(0);
    },
  );
  it('a later free config wins against a pending earlier load and can replace a ready config', async () => {
    const f = setup(),
      gate = deferred(),
      declaration = freeDeclaration(f);
    f.runtime.setStageHost(f.stage as never);
    f.fetchGates.set('a', gate);
    const old = f.runtime.reconcile([], [declaration]);
    await f.runtime.reconcile([], [{ ...declaration, configId: 'b' }]);
    const firstNode = f.external.getByKey('entity-hat')!.pixiContainer!;
    gate.resolve();
    await old;
    expect(f.external.getByKey('entity-hat')!.pixiContainer).toBe(firstNode);
    expect(f.texturesRequested.has('game/attachments/a.png')).toBe(false);
    await f.runtime.reconcile([], [{ ...declaration, configId: 'c' }]);
    expect(firstNode.destroyed).toBe(true);
    expect(f.runtime.getDiagnostics().freeHostCount).toBe(1);
    expect(f.texturesRequested.has('game/attachments/c.png')).toBe(true);
  });
  it('a missing resource is diagnosed without a partial host and can be retried', async () => {
    const f = setup(),
      declaration = freeDeclaration(f);
    f.runtime.setStageHost(f.stage as never);
    const reject = vi.spyOn(f.configLoader, 'load').mockRejectedValueOnce(new Error('missing saved attachment'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await f.runtime.reconcile([], [declaration]);
      expect(f.runtime.getFreeRestoreDiagnostics()[0]).toMatchObject({
        state: 'error',
        reason: 'missing saved attachment',
      });
      expect(f.stage.figureContainer.children).toHaveLength(0);
      reject.mockRestore();
      await f.runtime.reconcile([], [declaration]);
      expect(f.runtime.getEntity('entity-hat')?.state).toBe('free');
    } finally {
      reject.mockRestore();
      error.mockRestore();
    }
  });
  it('preserves a foreign registered target when publication conflicts', async () => {
    const f = setup(),
      foreign = new PIXI.Container();
    f.runtime.setStageHost(f.stage as never);
    f.external.register({
      uuid: 'foreign',
      key: 'entity-hat',
      pixiContainer: foreign as never,
      sourceUrl: '',
      sourceType: 'stage',
      sourceExt: '',
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await f.runtime.reconcile([], [freeDeclaration(f)]);
      expect(f.external.getByKey('entity-hat')?.uuid).toBe('foreign');
      expect(foreign.destroyed).toBe(false);
      expect(f.runtime.getDiagnostics().stageEntityCount).toBe(0);
      expect(f.stage.figureContainer.children).toHaveLength(0);
      expect(f.runtime.getFreeRestoreDiagnostics()[0].state).toBe('error');
    } finally {
      error.mockRestore();
      foreign.destroy();
    }
  });
  it('diagnoses a missing texture and retries the full free representation without a figure', async () => {
    const f = setup(),
      gate = deferred(),
      declaration = freeDeclaration(f);
    const loaded = await f.configLoader.load('a');
    f.configLoader.registerEphemeral('a', {
      ...loaded,
      config: { ...loaded.config, freeRenderable: { full: 'game/attachments/full.png' } },
    });
    f.runtime.setStageHost(f.stage as never);
    f.textureGates.set('game/attachments/full.png', gate);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const restoring = f.runtime.reconcile([], [declaration]);
      await until(() => f.texturesRequested.has('game/attachments/full.png'));
      gate.reject(new Error('texture unavailable'));
      await restoring;
      expect(f.runtime.getFreeRestoreDiagnostics()[0]).toMatchObject({ state: 'error' });
      expect(f.runtime.getFreeRestoreDiagnostics()[0].reason).toContain('texture unavailable');
      expect(f.stage.figureContainer.children).toHaveLength(0);
      f.textureGates.delete('game/attachments/full.png');
      await f.runtime.reconcile([], [declaration]);
      expect(f.runtime.getEntity('entity-hat')).toMatchObject({
        state: 'free',
        hasConfiguredFreeRenderable: true,
        representation: 'full',
      });
      expect(f.runtime.getFreeRestoreDiagnostics()).toEqual([]);
      f.runtime.removeEntity('entity-hat');
      expect(f.stage.figureContainer.children).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
  });
});

describe('accepted-view reconcile supersession with real Runtime CPU graph', () => {
  it('absent A slow prewarm cannot resurrect after a newer remove and ready event', async () => {
    const f = setup(),
      gate = deferred();
    f.fetchGates.set('a', gate);
    const old = f.runtime.reconcile([f.declaration()], []);
    await f.runtime.reconcile([], []);
    f.runtime.registerFigure(f.figure());
    gate.resolve();
    await old;
    expect(f.runtime.list()).toEqual([]);
    expect(f.runtime.getDiagnostics().stageEntityCount).toBe(0);
  });
  it('config B immediately replaces loading A despite an unrelated slow prewarm', async () => {
    const f = setup(),
      texture = deferred(),
      slow = deferred();
    f.textureGates.set('game/attachments/a.png', texture);
    f.fetchGates.set('slow', slow);
    f.runtime.registerFigure(f.figure());
    const a = f.runtime.reconcile([f.declaration()], []);
    await until(() => f.texturesRequested.has('game/attachments/a.png'));
    const b = f.runtime.reconcile([f.declaration('b'), f.declaration('slow', 'absent')], []);
    expect(f.runtime.get('fig-center', 'hat')?.configId).toBe('b');
    texture.resolve();
    await until(() => f.runtime.get('fig-center', 'hat')?.phase === 'ready');
    expect(f.runtime.get('fig-center', 'hat')?.configId).toBe('b');
    slow.resolve();
    await Promise.all([a, b]);
    expect(f.runtime.list('fig-center')).toHaveLength(1);
  });
  it('same-config hidden/visual seed reaches the owned load before unrelated prewarm finishes', async () => {
    const f = setup(),
      texture = deferred(),
      slow = deferred();
    f.textureGates.set('game/attachments/a.png', texture);
    f.fetchGates.set('slow', slow);
    f.runtime.registerFigure(f.figure());
    const a = f.runtime.reconcile([f.declaration()], []);
    await until(() => f.texturesRequested.has('game/attachments/a.png'));
    const visual = { ...initialLegacyAttachmentLocalVisualState(false), opacity: 0.25 };
    const b = f.runtime.reconcile(
      [{ ...f.declaration(), visible: false, visualState: visual }, f.declaration('slow', 'absent')],
      [],
    );
    texture.resolve();
    await until(() => f.runtime.get('fig-center', 'hat')?.phase === 'ready');
    expect(f.runtime.get('fig-center', 'hat')?.visible).toBe(false);
    expect(f.runtime.getEntity('entity-hat')?.visualState?.opacity).toBe(0.25);
    slow.resolve();
    await Promise.all([a, b]);
  });
  it('effects-only view updates the real pending seed without a transform host yet', async () => {
    const f = setup(),
      texture = deferred();
    f.textureGates.set('game/attachments/a.png', texture);
    // This explicit semantic state needs an equally explicit fixture binding;
    // an unbound legacy config correctly rejects a named-anchor request.
    const parsed = await f.configLoader.load('a');
    f.configLoader.registerEphemeral('a', {
      ...parsed,
      modelBinding: {
        modelProfileId: 'cpu-profile',
        characterId: 'cpu-character',
        modelId: 'cpu-model',
        modelPath: normalizeLayeredModelPath(f.modelPath),
        profileVersion: 1,
        presetApprovalStatus: 'approved',
        fingerprint: { modelJsonSha256: '0'.repeat(64), drawableCount: 1 },
        anchorName: 'head',
        anchorProfileId: 'cpu-head',
        drawableId: 'head',
        vertexCount: 3,
        anchorVertexIndices: [0, 1, 2],
      },
    });
    const target = f.figure();
    const manager = new StageStateManager();
    manager.setStage('figName', f.modelPath);
    const row = { figureKey: 'fig-center', attachmentId: 'hat', entityId: 'entity-hat', configId: 'a', visible: true };
    const visual = initialLegacyAttachmentLocalVisualState(true);
    manager.applyStageEntityTransaction({
      kind: 'upsert-explicit-attachment',
      attachment: row,
      entity: {
        schemaVersion: 0,
        entityId: row.entityId,
        renderableKind: 'attachment-sprite-group',
        source: { configId: 'a', legacyAlias: { originFigureKey: row.figureKey, attachmentId: row.attachmentId } },
        visualState: visual,
        attachmentLink: legacyAttachmentLink(row, visual),
      },
    });
    manager.commit();
    const host = Object.assign(f.stage, {
      getActiveLive2DFigure: (): ActiveLive2DFigureResult => ({
        status: 'ready',
        figure: {
          key: target.key,
          uuid: target.generation,
          sourceUrl: target.sourcePath,
          normalizedSourceUrl: target.sourcePath,
          isExiting: false,
          outerContainer: target.container as never,
          model: target.model,
        },
      }),
    });
    const bridge = new AttachmentStageBridge(host as AttachmentBridgeHost, f.runtime, manager);
    cleanups.push(() => bridge.dispose());
    bridge.syncCommittedView(manager.getViewStageState());
    await until(() => f.texturesRequested.has('game/attachments/a.png'));
    expect(f.runtime.getEntity('entity-hat')).toBeUndefined();
    manager.updateEffect({ target: 'entity-hat', transform: { alpha: 0.3 } });
    manager.commit({ syncPixiStage: false, applyPixiEffects: true });
    bridge.observeCommittedEffects(manager.getViewStageState());
    texture.resolve();
    await bridge.whenSettled();
    expect(f.runtime.getEntity('entity-hat')?.visualState?.opacity).toBe(0.3);
  });
  it.each(['reset', 'destroy'] as const)('%s invalidates a suspended accepted plan', async (action) => {
    const f = setup(),
      gate = deferred();
    f.fetchGates.set('a', gate);
    const old = f.runtime.reconcile([f.declaration()], []);
    f.runtime[action]();
    gate.resolve();
    await old;
    expect(f.runtime.list()).toEqual([]);
    expect(f.runtime.getDiagnostics().stageEntityCount).toBe(0);
  });
  it('already-free visibility and opacity update before unrelated resource prewarm', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const local = initialLegacyAttachmentLocalVisualState(true);
    const free: FreeAttachmentDeclaration = {
      ...f.declaration(),
      visualState: { ...local, space: 'world' },
      lastAttachedLocalVisualState: local,
    };
    await f.runtime.reconcile([], [free]);
    expect(f.runtime.getDiagnostics().freeEntityCount).toBe(1);
    const slow = deferred();
    f.fetchGates.set('slow', slow);
    const next = f.runtime.reconcile(
      [f.declaration('slow', 'absent')],
      [{ ...free, visible: false, visualState: { ...free.visualState, visible: false, opacity: 0.2 } }],
    );
    expect(f.runtime.getEntity('entity-hat')?.visualState?.opacity).toBe(0.2);
    expect(f.runtime.getEntity('entity-hat')?.visualState?.visible).toBe(false);
    slow.resolve();
    await next;
  });
});
