import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { AttachmentRuntime } from './AttachmentRuntime';
import type { AttachmentConfig, AttachmentFigureTarget } from './types';
import type { Live2DFrameDriverStats, StartLive2DFrameDriverOptions } from '../live2dFrameDriver';

// These CPU lifecycle tests exercise the real Runtime/controllers/PIXI graph.
// Drawable and frame-driver seams are deliberate; they are not a GPU/Live2D visual smoke.
const config: AttachmentConfig = {
  schema: 'webgal-live2d-attachment-v1',
  configId: '5c-integration',
  target: {
    modelPath: 'game/figure/5c/model.json',
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
  layers: { back: 'game/attachments/5c-back.png', front: 'game/attachments/5c-front.png' },
  placement: { spriteAnchor: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, rotationOffsetRad: 0, localScale: 1 },
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
const cleanups: Array<() => void> = [];
let restoreCanvas: () => void;
beforeAll(() => {
  const probe = vi
    .spyOn(PIXI.settings.ADAPTER, 'createCanvas')
    .mockImplementation(() => ({ getContext: () => null } as unknown as HTMLCanvasElement));
  restoreCanvas = () => probe.mockRestore();
});
afterAll(() => restoreCanvas());
afterEach(() => {
  for (const clean of cleanups.splice(0).reverse()) clean();
});
function setup() {
  const app = { ticker: new PIXI.Ticker() } as PIXI.Application;
  const drivers: Array<{ options: StartLive2DFrameDriverOptions; cleaned: number }> = [];
  const runtime = new AttachmentRuntime({
    configLoader: { load: async () => ({ sourceUrl: 'game/attachments/5c.json', config }) } as never,
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
    app.ticker.destroy();
  });
  function figure(key: string, generation: string): AttachmentFigureTarget {
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
    return { key, generation, sourcePath: config.target.modelPath, app, container, model: model as never };
  }
  const declaration = (figureKey: string, attachmentId = 'hat') => ({
    figureKey,
    attachmentId,
    configId: config.configId,
    visible: true,
  });
  return { runtime, drivers, figure, declaration };
}
async function ready(runtime: AttachmentRuntime, key: string, generation: string) {
  for (let i = 0; i < 30; i++) {
    if (runtime.list(key).some((r) => r.figureGeneration === generation && r.phase === 'ready')) return;
    await Promise.resolve();
  }
  throw Error('Expected ready generation ' + generation);
}
describe('5C real Runtime CPU lifecycle integration', () => {
  it('binds the same model path independently to two figure keys', async () => {
    const { runtime, figure, declaration, drivers } = setup();
    runtime.registerFigure(figure('a', 'a1'));
    runtime.registerFigure(figure('b', 'b1'));
    expect((await runtime.upsert(declaration('a'))).phase).toBe('ready');
    expect((await runtime.upsert(declaration('b'))).phase).toBe('ready');
    expect(runtime.list()).toHaveLength(2);
    expect(drivers).toHaveLength(2);
    runtime.remove('a', 'hat');
    expect(runtime.list('b')).toHaveLength(1);
    await runtime.reconcile([], []);
    expect(runtime.list()).toHaveLength(0);
    expect(drivers.every((d) => d.cleaned === 1)).toBe(true);
  });
  it('retains the outgoing presentation until exact old-model destruction', async () => {
    const { runtime, figure, declaration, drivers } = setup();
    const old = figure('a', 'a1');
    runtime.registerFigure(old);
    await runtime.upsert(declaration('a'));
    runtime.registerFigure(figure('a', 'a2'));
    await ready(runtime, 'a', 'a2');
    expect(drivers[0].cleaned).toBe(0);
    expect(runtime.unregisterFigure('a', 'a1')).toBe(false);
    old.model.emit('destroy');
    expect(drivers[0].cleaned).toBe(1);
    expect(runtime.get('a', 'hat')?.figureGeneration).toBe('a2');
    expect(runtime.get('a', 'hat')?.phase).toBe('ready');
  });
  it('hide/show and terminal remove remain instance-local and idempotent', async () => {
    const { runtime, figure, declaration } = setup();
    runtime.registerFigure(figure('a', 'a1'));
    await runtime.upsert(declaration('a'));
    runtime.setVisible('a', 'hat', false);
    expect(runtime.get('a', 'hat')?.visible).toBe(false);
    runtime.setVisible('a', 'hat', true);
    expect(runtime.get('a', 'hat')?.visible).toBe(true);
    expect(runtime.remove('a', 'hat')).toBe(true);
    expect(runtime.remove('a', 'hat')).toBe(false);
    expect(runtime.getDiagnostics().stageEntityCount).toBe(0);
  });
  it('repeated rebuild/cleanup leaves no entity, proxy, driver or pending frame operation', async () => {
    const { runtime, figure, declaration, drivers } = setup();
    let previous: AttachmentFigureTarget | undefined;
    for (let i = 0; i < 30; i++) {
      const next = figure('a', 'g' + i);
      runtime.registerFigure(next);
      if (i === 0) await runtime.upsert(declaration('a'));
      else await ready(runtime, 'a', 'g' + i);
      previous?.model.emit('destroy');
      previous = next;
    }
    await runtime.reconcile([], []);
    runtime.destroy();
    expect(drivers).toHaveLength(30);
    expect(drivers.every((d) => d.cleaned === 1)).toBe(true);
    const d = runtime.getDiagnostics();
    for (const k of [
      'figureCount',
      'retiringFigureCount',
      'frameDriverCount',
      'stageEntityCount',
      'renderProxyCount',
      'retiringRenderProxyCount',
      'freeHostCount',
      'pendingFrameOperationCount',
      'pendingReattachCount',
    ] as const)
      expect(d[k], k).toBe(0);
  });
});
