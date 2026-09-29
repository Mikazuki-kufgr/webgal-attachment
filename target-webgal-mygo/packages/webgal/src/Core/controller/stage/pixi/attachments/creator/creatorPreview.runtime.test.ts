import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { AttachmentRuntime } from '../AttachmentRuntime';
import { CreatorPreviewAdapter } from './creatorPreviewAdapter';
import { createBlankCreatorDraft } from './creatorDraft';
import type { Live2DModelProfile } from '../profileTypes';
import type { AttachmentFigureTarget } from '../types';
import type { CreatorBinaryInput } from './creatorTypes';
import type { Live2DFrameDriverStats, StartLive2DFrameDriverOptions } from '../../live2dFrameDriver';

// Real Runtime, config loader, HatAttachmentController and PIXI graph. Only
// drawable data/frame scheduling and PNG decoder are CPU seams, not a GPU smoke.
const profile: Live2DModelProfile = {
  schema: 'webgal-live2d-model-profile',
  schemaVersion: 1,
  profileVersion: 1,
  modelProfileId: '5h-model',
  characterId: '5h',
  modelId: 'model',
  modelPath: 'game/figure/5h/model.json',
  fingerprint: { modelJsonSha256: 'a'.repeat(64), drawableCount: 1 },
  anchors: [
    {
      name: 'head',
      anchorProfileId: '5h-head',
      drawableId: 'head',
      vertexCount: 3,
      points: [
        { index: 0, weight: 1, neutral: { x: -10, y: 0 } },
        { index: 1, weight: 1, neutral: { x: 10, y: 0 } },
        { index: 2, weight: 1, neutral: { x: 0, y: 20 } },
      ],
    },
  ],
};
const stats: Live2DFrameDriverStats = {
  driverCount: 1,
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
const cleanups: Array<() => void | Promise<void>> = [];
let restoreCanvas: () => void;
beforeAll(() => {
  const spy = vi
    .spyOn(PIXI.settings.ADAPTER, 'createCanvas')
    .mockImplementation(() => ({ getContext: () => null } as unknown as HTMLCanvasElement));
  restoreCanvas = () => spy.mockRestore();
});
afterAll(() => restoreCanvas());
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});
const flush = async () => {
  for (let n = 0; n < 15; n++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function setup() {
  const ticker = new PIXI.Ticker();
  const app = { ticker } as PIXI.Application;
  const drivers: Array<{ options: StartLive2DFrameDriverOptions; cleaned: number }> = [];
  const runtime = new AttachmentRuntime({
    textureLoader: async () => PIXI.Texture.EMPTY,
    driverStarter: (options) => {
      const entry = { options, cleaned: 0 };
      drivers.push(entry);
      return {
        getStats: () => ({ ...stats, cleanupCount: entry.cleaned }),
        cleanup() {
          if (entry.cleaned) return;
          entry.cleaned++;
          options.consumer.destroy({ ...stats, cleanupCount: 1 });
        },
      };
    },
  });
  cleanups.push(() => {
    runtime.destroy();
    ticker.destroy();
  });
  function figure(generation = 'g1', figureKey = 'a', modelPath = profile.modelPath): AttachmentFigureTarget {
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
        update: () => undefined,
      }),
    });
    container.addChild(model);
    return { key: figureKey, generation, sourcePath: modelPath, app, container, model: model as never };
  }
  const owned: PIXI.Texture[] = [];
  const texture = () => {
    const value = new PIXI.Texture(new PIXI.BaseTexture(undefined, { width: 8, height: 8 }));
    owned.push(value);
    return value;
  };
  function adapter(decoder: (url: string) => Promise<PIXI.Texture> = async () => texture()) {
    const value = new CreatorPreviewAdapter(runtime, decoder);
    cleanups.push(() => value.clear());
    return value;
  }
  function frame() {
    for (const entry of [...drivers])
      if (!entry.cleaned) {
        entry.options.consumer.syncVisualState?.();
        entry.options.consumer.update(
          { frame: 1, timestamp: 16, deltaMS: 16, modelDeltaBeforeReset: 0, elapsedTime: 16 },
          stats,
        );
      }
  }
  const draft = (generation = 'g1', key = 'a') => ({
    ...createBlankCreatorDraft(5),
    figureKey: key,
    figureGeneration: generation,
    modelProfileId: profile.modelProfileId,
    anchorName: 'head',
  });
  const input: CreatorBinaryInput = {
    bytes: new Uint8Array([137, 80, 78, 71]),
    metadata: {
      sourceFileName: 'cpu.png',
      mime: 'image/png',
      bytes: 4,
      width: 8,
      height: 8,
      sha256: 'b'.repeat(64),
      outputFileName: 'front.png',
    },
  };
  return { runtime, figure, adapter, frame, texture, owned, draft, input, drivers };
}
describe('5H Creator through actual Runtime CPU graph', () => {
  it('survives narrative reconcile, stays hidden until texture commit and waits for a real shared frame', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    const draft = f.draft();
    expect(await a.bind(draft, profile)).toBe(true);
    const binding = a.binding()!;
    expect(f.runtime.get('a', binding.attachmentId)?.visible).toBe(false);
    expect(await a.replaceTextures({ front: f.input, layerMode: 'front-only' })).toBe(true);
    expect(a.applyPlacement(draft)).toBe(true);
    let completed = false;
    const visible = a.commitVisible(true, draft).then((result) => {
      completed = true;
      return result;
    });
    await flush();
    expect(completed).toBe(false);
    await f.runtime.reconcile([], []);
    expect(f.runtime.get('a', binding.attachmentId)?.visible).toBe(true);
    f.frame();
    expect(await visible).toBe(true);
    await f.runtime.reconcile([], []);
    expect(f.runtime.get('a', binding.attachmentId)?.phase).toBe('ready');
    await a.clear();
    await f.runtime.reconcile([], []);
    expect(f.runtime.list()).toHaveLength(0);
    expect(a.diagnostics().pendingAsyncCount).toBe(0);
    expect(f.owned.every((value) => value.baseTexture === null)).toBe(true);
  });
  it('keeps ordinary same-slot entity and two preview configs independent', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    const b = f.adapter();
    expect(await a.bind(f.draft(), profile)).toBe(true);
    expect(await b.bind(f.draft(), profile)).toBe(true);
    expect(a.binding()?.configId).not.toBe(b.binding()?.configId);
    const configId = a.binding()!.configId;
    const normal = {
      figureKey: 'a',
      attachmentId: 'narrative',
      entityId: 'narrative',
      configId,
      visible: true,
      slot: 'headwear',
    };
    expect((await f.runtime.upsert(normal)).phase).toBe('ready');
    const before = f.runtime.get('a', 'narrative');
    await f.runtime.reconcile([normal], []);
    expect(f.runtime.list()).toHaveLength(3);
    await b.clear();
    expect(f.runtime.get('a', 'narrative')).toEqual(before);
    expect(f.runtime.get('a', a.binding()!.attachmentId)?.phase).toBe('ready');
    await a.clear();
    f.runtime.remove('a', 'narrative');
  });
  it('rejects a narrative collision before removing either owner', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    await a.bind(f.draft(), profile);
    const binding = a.binding()!;
    await expect(
      f.runtime.reconcile(
        [
          {
            figureKey: 'a',
            attachmentId: binding.attachmentId,
            entityId: binding.entityId,
            configId: binding.configId,
            visible: true,
          },
        ],
        [],
      ),
    ).rejects.toThrow('Duplicate attachment declaration');
    expect(f.runtime.get('a', binding.attachmentId)?.phase).toBe('ready');
  });
  it('does not revive an old preview on parent replacement or stale cleanup', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    await a.bind(f.draft(), profile);
    f.runtime.registerFigure(f.figure('g2'));
    await flush();
    expect(f.runtime.list('a')).toHaveLength(0);
    expect(a.applyPlacement(f.draft())).toBe(false);
    expect(await a.commitVisible(true, f.draft())).toBe(false);
    await a.clear();
    expect(await a.bind(f.draft('g2'), profile)).toBe(true);
    await f.runtime.reconcile([], []);
    expect(f.runtime.list('a')[0].figureGeneration).toBe('g2');
  });
  it('cancels missing-generation readiness promptly on clear with zero pending observers', async () => {
    const f = setup();
    const a = f.adapter();
    const pending = a.bind(f.draft(), profile);
    await flush();
    await a.clear();
    expect(await pending).toBe(false);
    expect(a.diagnostics().pendingAsyncCount).toBe(0);
    f.runtime.registerFigure(f.figure());
    await flush();
    expect(f.runtime.list()).toHaveLength(0);
  });
  it('cancels first-frame visibility wait on clear without blocking the mutation queue', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    await a.bind(f.draft(), profile);
    await a.replaceTextures({ front: f.input, layerMode: 'front-only' });
    const pending = a.commitVisible(true, f.draft());
    await flush();
    await a.clear();
    expect(await pending).toBe(false);
    expect(a.diagnostics().pendingAsyncCount).toBe(0);
  });
  it('reports bounded first-frame timeout rather than claiming success', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    await a.bind(f.draft(), profile);
    await a.replaceTextures({ front: f.input, layerMode: 'front-only' });
    const pending = expect(a.commitVisible(true, f.draft())).rejects.toThrow('CREATOR_PREVIEW_FRAME_TIMEOUT');
    await flush();
    await vi.advanceTimersByTimeAsync(10_001);
    await pending;
    expect(a.diagnostics().pendingAsyncCount).toBe(0);
  });
  it('a failed initial fit remains pending until a valid frame, and transparent placeholder alone is not success', async () => {
    const f = setup();
    const figure = f.figure();
    f.runtime.registerFigure(figure);
    const a = f.adapter();
    await a.bind(f.draft(), profile);
    expect(await a.commitVisible(true, f.draft())).toBe(false);
    await a.replaceTextures({ front: f.input, layerMode: 'front-only' });
    vi.spyOn(figure.model.internalModel, 'getDrawableVertices').mockReturnValueOnce(
      new Float32Array([NaN, 0, 10, 0, 0, 20]),
    );
    let completed = false;
    const pending = a.commitVisible(true, f.draft()).then((value) => {
      completed = true;
      return value;
    });
    await flush();
    f.frame();
    await flush();
    expect(completed).toBe(false);
    f.frame();
    expect(await pending).toBe(true);
  });
  it('late decoded PNG cannot mutate a newer binding and is destroyed exactly once', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const late = deferred<PIXI.Texture>();
    const a = f.adapter(() => late.promise);
    await a.bind(f.draft(), profile);
    const pending = a.replaceTextures({ front: f.input, layerMode: 'front-only' });
    await flush();
    await a.clear();
    await a.bind(f.draft(), profile);
    const newer = a.binding()!;
    const texture = f.texture();
    const destroy = vi.spyOn(texture, 'destroy');
    late.resolve(texture);
    expect(await pending).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(a.binding()).toEqual(newer);
    expect(f.runtime.get('a', newer.attachmentId)?.visible).toBe(false);
  });
  it('A to B to A repeatedly leaves only the latest controller and no texture or config ownership residue', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const a = f.adapter();
    for (let n = 0; n < 30; n++) {
      const draft = f.draft();
      draft.placement.offset.x = n % 2 ? 20 : -20;
      expect(await a.bind(draft, profile)).toBe(true);
      expect(await a.replaceTextures({ front: f.input, layerMode: 'front-only' })).toBe(true);
      expect(a.applyPlacement(draft)).toBe(true);
      const visible = a.commitVisible(true, draft);
      await flush();
      f.frame();
      expect(await visible).toBe(true);
      await f.runtime.reconcile([], []);
      expect(f.runtime.list()).toHaveLength(1);
    }
    await a.clear();
    expect(f.runtime.list()).toHaveLength(0);
    expect(f.runtime.clearIdleCaches()).toBe(true);
    expect(f.owned.every((texture) => texture.baseTexture === null)).toBe(true);
    expect(a.diagnostics()).toMatchObject({ activeObjectUrlCount: 0, pendingAsyncCount: 0, textureCount: 0 });
  });
  it('reset invalidates opaque claim and clears delayed preview ownership', async () => {
    const f = setup();
    f.runtime.registerFigure(f.figure());
    const owner = f.runtime.claimPreviewAttachment({
      figureKey: 'a',
      figureGeneration: 'g1',
      attachmentId: '__mvp2b_creator_preview_reset__',
      entityId: 'creator-preview:reset',
    });
    f.runtime.reset();
    f.runtime.registerFigure(f.figure());
    expect(() =>
      f.runtime.upsertPreview(owner, {
        figureKey: 'a',
        attachmentId: '__mvp2b_creator_preview_reset__',
        entityId: 'creator-preview:reset',
        configId: 'x',
        visible: false,
      }),
    ).toThrow('STALE');
    expect(f.runtime.releasePreviewAttachment(owner)).toBe(false);
  });
});
