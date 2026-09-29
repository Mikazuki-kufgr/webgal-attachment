import { afterEach, describe, expect, it, vi } from 'vitest';
import { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { cancelCreatorFigureReplacement, replaceCreatorFigure, waitForCreatorHandRenderer } from './creatorRuntimeHost';
import type { ActiveLive2DFigureResult, Live2DFigureChangeEvent } from '../../PixiController';

const flush = async () => {
  for (let n = 0; n < 8; n++) await Promise.resolve();
};
const modelPath = 'game/figure/new/model.json';
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
function fixture() {
  const manager = new StageStateManager();
  manager.setStageAndCommit('freeFigure', [
    { key: 'authoring-model', name: './game/figure/old/model.json', basePosition: 'left' },
    { key: 'unrelated', name: './game/figure/other/model.json', basePosition: 'right' },
  ]);
  const listeners = new Set<(event: Live2DFigureChangeEvent) => void>();
  const removed: string[] = [];
  let active: ActiveLive2DFigureResult = { status: 'absent', figureKey: 'authoring-model' };
  const objects = new Map<string, { uuid: string; key: string }>([
    ['authoring-model', { uuid: 'old', key: 'authoring-model' }],
  ]);
  const waits = new Set<{
    key: string;
    generation: string;
    resolve: () => void;
    reject: (error: Error) => void;
    dispose: () => void;
  }>();
  let registered = '';
  const stage = {
    getActiveLive2DFigure: () => active,
    getStageObjByKey: (key: string) => objects.get(key) as never,
    removeStageObjectByUuid: (uuid: string) => {
      removed.push(uuid);
      for (const [key, obj] of objects) if (obj.uuid === uuid) objects.delete(key);
    },
    subscribeLive2DFigureChanges(listener: (event: Live2DFigureChangeEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const runtime = {
    figureGeneration: () => registered,
    waitForFigureGeneration: vi.fn((key: string, generation: string, _timeout?: number, signal?: AbortSignal) => {
      if (signal?.aborted) return Promise.reject(new Error('CANCELLED'));
      if (registered === generation) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const abort = () => {
          pending.dispose();
          reject(new Error('CANCELLED'));
        };
        const pending = {
          key,
          generation,
          resolve: () => {
            pending.dispose();
            resolve();
          },
          reject,
          dispose: () => {
            waits.delete(pending);
            signal?.removeEventListener('abort', abort);
          },
        };
        waits.add(pending);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }),
  };
  let sequence = 0;
  const created: Array<{ key: string; generation: string; source: string }> = [];
  manager.setCommitHandler((state) => {
    const row = state.freeFigure.find((figure) => figure.key === 'authoring-model') ?? state.freeFigure[0];
    const generation = 'new-' + ++sequence;
    const source = row.name.replace(/^\.\//, '');
    created.push({ key: row.key, generation, source });
    objects.set(row.key, { uuid: generation, key: row.key });
    active = {
      status: 'loading',
      figure: {
        key: row.key,
        uuid: generation,
        normalizedSourceUrl: source,
        sourceUrl: './' + source,
        isExiting: false,
        outerContainer: {} as never,
      },
    };
    listeners.forEach((fn) => fn({ type: 'created', figureKey: row.key, uuid: generation, sourceUrl: './' + source }));
  });
  function ready(index = created.length - 1) {
    const item = created[index];
    active = {
      status: 'ready',
      figure: {
        key: item.key,
        uuid: item.generation,
        normalizedSourceUrl: item.source,
        sourceUrl: './' + item.source,
        isExiting: false,
        outerContainer: {} as never,
        model: {} as never,
      },
    };
    listeners.forEach((fn) =>
      fn({ type: 'ready', figureKey: item.key, uuid: item.generation, sourceUrl: './' + item.source }),
    );
  }
  function register(index = created.length - 1) {
    registered = created[index].generation;
    for (const item of waits) if (item.generation === registered) item.resolve();
  }
  const run = (extra: Partial<Parameters<typeof replaceCreatorFigure>[0]> = {}) =>
    replaceCreatorFigure({ stage, manager, runtime, profile: { modelPath }, ...extra });
  cleanups.push(() => cancelCreatorFigureReplacement(stage));
  return {
    manager,
    stage,
    runtime,
    listeners,
    removed,
    objects,
    created,
    ready,
    register,
    run,
    waits,
    setActive: (value: ActiveLive2DFigureResult) => {
      active = value;
    },
  };
}
describe('5H committed Creator figure replacement', () => {
  it('replaces exactly one figure through real manager, preserves unrelated rows, waits for Runtime registration', async () => {
    const f = fixture();
    const pending = f.run();
    expect(f.removed).toEqual(['old']);
    expect(f.listeners.size).toBe(1);
    expect(f.manager.getViewStageState().freeFigure).toEqual([
      { key: 'unrelated', name: './game/figure/other/model.json', basePosition: 'right' },
      { key: 'authoring-model', name: './' + modelPath, basePosition: 'left' },
    ]);
    f.ready();
    await flush();
    expect(f.waits.size).toBe(1);
    expect(f.listeners.size).toBe(0);
    f.register();
    expect(await pending).toEqual({ figureKey: 'authoring-model', generation: 'new-1' });
    expect(f.waits.size).toBe(0);
    expect(f.manager.isCalculationSynchronizedWithView()).toBe(true);
  });
  it('rejects future calculation without removing a Pixi owner or publishing a pending script state', async () => {
    const f = fixture();
    f.manager.setStage('showText', 'future');
    const view = f.manager.getViewStageState();
    await expect(f.run()).rejects.toThrow('CREATOR_STAGE_CALCULATION_PENDING');
    expect(f.removed).toHaveLength(0);
    expect(f.manager.getViewStageState()).toBe(view);
    expect(f.manager.getCalculationStageState().showText).toBe('future');
    expect(f.listeners.size).toBe(0);
  });
  it('A to B cancels the old host wait and ignores a late wrong-source ready event', async () => {
    const f = fixture();
    const old = f.run();
    const oldRejection = expect(old).rejects.toThrow('CANCELLED');
    const next = f.run({ profile: { modelPath: 'game/figure/b/model.json' } });
    await oldRejection;
    f.ready(0);
    await flush();
    expect(f.runtime.waitForFigureGeneration).not.toHaveBeenCalled();
    f.ready(1);
    await flush();
    f.register(1);
    expect(await next).toEqual({ figureKey: 'authoring-model', generation: 'new-2' });
    expect(f.listeners.size).toBe(0);
    expect(f.waits.size).toBe(0);
  });
  it('A to B aborts the old Runtime wait after Pixi readiness and only B succeeds', async () => {
    const f = fixture();
    const old = f.run();
    const oldRejection = expect(old).rejects.toThrow('CANCELLED');
    f.ready(0);
    await flush();
    expect(f.waits.size).toBe(1);
    const next = f.run({ profile: { modelPath: 'game/figure/b/model.json' } });
    await oldRejection;
    expect(f.waits.size).toBe(0);
    f.ready(1);
    await flush();
    f.register(1);
    expect((await next).generation).toBe('new-2');
  });
  it('external abort and explicit workbench cleanup release listeners', async () => {
    const f = fixture();
    const controller = new AbortController();
    const one = f.run({ signal: controller.signal });
    const rejected = expect(one).rejects.toThrow('CANCELLED');
    controller.abort();
    await rejected;
    expect(f.listeners.size).toBe(0);
    const two = f.run();
    const rejectedTwo = expect(two).rejects.toThrow('CANCELLED');
    cancelCreatorFigureReplacement(f.stage);
    await rejectedTwo;
    expect(f.listeners.size).toBe(0);
  });
  it('missing host readiness times out with no recurring polling or listener residue', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = expect(f.run({ timeoutMs: 25 })).rejects.toThrow('READY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(26);
    await pending;
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const retry = f.run({ timeoutMs: 25 });
    f.ready();
    await flush();
    f.register();
    await expect(retry).resolves.toEqual({ figureKey: 'authoring-model', generation: 'new-2' });
  });
  it('rejects unsupported ready surfaces rather than claiming a Live2D figure', async () => {
    const f = fixture();
    const pending = f.run();
    const rejected = expect(pending).rejects.toThrow('UNSUPPORTED');
    f.setActive({ status: 'unsupported', figureKey: 'authoring-model', uuid: 'new-1', sourceExt: 'wmdl' });
    f.listeners.forEach((fn) =>
      fn({ type: 'ready', figureKey: 'authoring-model', uuid: 'new-1', sourceUrl: './' + modelPath }),
    );
    await rejected;
    expect(f.listeners.size).toBe(0);
  });
  it('rechecks UUID after Runtime readiness so external replacement cannot masquerade as success', async () => {
    const f = fixture();
    const pending = f.run();
    f.ready();
    await flush();
    f.setActive({ status: 'absent', figureKey: 'authoring-model' });
    f.register();
    await expect(pending).rejects.toThrow('GENERATION_CHANGED');
    expect(f.listeners.size).toBe(0);
  });
  it.each([
    'game/figure/../x/model.json',
    'game/figure/x/model.json?inject=1',
    'https://example.com/model.json',
    'game/figure/x/model.json\n',
  ])('rejects invalid model path %s before writes', async (path) => {
    const f = fixture();
    await expect(f.run({ profile: { modelPath: path } })).rejects.toThrow('MODEL_PATH_INVALID');
    expect(f.removed).toHaveLength(0);
    expect(f.created).toHaveLength(0);
  });
  it('accepts a user-renamed Live2D JSON file inside game/figure', async () => {
    const f = fixture();
    const pending = f.run({ profile: { modelPath: 'game/figure/anon/custom-look.json' } });
    f.ready();
    f.register();
    await expect(pending).resolves.toEqual({ figureKey: 'authoring-model', generation: 'new-1' });
    expect(f.created[0].source).toBe('game/figure/anon/custom-look.json');
  });
  it('removes the historical library alias as an exact UUID and does not leave a second declaration', async () => {
    const f = fixture();
    f.manager.setCommitHandler(null);
    f.manager.setStageAndCommit('freeFigure', [
      ...f.manager.getViewStageState().freeFigure,
      { key: 'creator-library-preview', name: './game/figure/old/model.json', basePosition: 'center' },
    ]);
    f.objects.set('creator-library-preview', { uuid: 'legacy', key: 'creator-library-preview' });
    const controller = new AbortController();
    const pending = f.run({ signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('CANCELLED');
    expect(f.removed).toEqual(['old', 'legacy']);
    expect(f.manager.getViewStageState().freeFigure.some((row) => row.key === 'creator-library-preview')).toBe(false);
    controller.abort();
    await rejected;
  });
});

describe('hand preview after a Creator figure switch', () => {
  function handFigure(generation = 'winter-2') {
    const context = { _$Ws: [], _$Er: [] };
    const drawParam = { _$Uo: () => undefined, getClipBufPre_clipContextDraw: () => null };
    const internal = {
      draw: () => undefined,
      coreModel: { getModelContext: () => context, getDrawParam: () => drawParam },
    };
    const stage = { getActiveLive2DFigure: () => ({ status: 'ready', figure: {
      uuid: generation, model: { internalModel: internal },
    } }) } as never;
    return { stage, internal, context, drawParam };
  }

  it('waits for the returned model draw context before creating a hand preview', async () => {
    vi.useFakeTimers();
    const { stage, drawParam } = handFigure();
    const draw = drawParam as { _$Uo?: () => void };
    delete draw._$Uo;
    const pending = waitForCreatorHandRenderer({ stage, figureKey: 'authoring-model', generation: 'winter-2', current: () => true });
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(32);
    expect(settled).toBe(false);
    draw._$Uo = () => undefined;
    await vi.advanceTimersByTimeAsync(16);
    expect(await pending).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a different generation and stops when the switch is superseded', async () => {
    vi.useFakeTimers();
    const { stage } = handFigure('other-generation');
    await expect(waitForCreatorHandRenderer({ stage, figureKey: 'authoring-model', generation: 'winter-2', current: () => true }))
      .rejects.toThrow('CREATOR_FIGURE_GENERATION_CHANGED');
    const waiting = handFigure();
    delete (waiting.drawParam as { _$Uo?: () => void })._$Uo;
    let current = true;
    const pending = waitForCreatorHandRenderer({ stage: waiting.stage, figureKey: 'authoring-model', generation: 'winter-2', current: () => current });
    current = false;
    await vi.advanceTimersByTimeAsync(16);
    expect(await pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
