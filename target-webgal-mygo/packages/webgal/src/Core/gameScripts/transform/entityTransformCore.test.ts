import { afterEach, describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  clearPendingCommittedStageEntities,
  createCommittedStageSnapshot,
  getPendingCommittedStageEntityCount,
  retainPendingCommittedStageEntity,
  releasePendingCommittedStageEntity,
} from '@/Core/Modules/stage/stageEntityPersistence';
import {
  initialLegacyAttachmentLocalVisualState,
  legacyAttachmentLink,
} from '@/Core/Modules/stage/stageEntityStateTransaction';
import type { AttachmentRuntime } from '@/Core/controller/stage/pixi/attachments/AttachmentRuntime';
import type { AttachmentEntityVisualState } from '@/Core/controller/stage/pixi/attachments/stageEntityVisualState';
import type { AttachmentRuntimeObserver, AttachmentRuntimeEvent } from '@/Core/controller/stage/pixi/attachments/types';
import type { IAnimationObject } from '@/Core/controller/stage/pixi/PixiController';
import { createEntityTransformPerformer, type EntityTransformHost } from './entityTransformCore';

afterEach(() => {
  clearPendingCommittedStageEntities();
  vi.useRealTimers();
});
function fixture() {
  vi.useFakeTimers();
  const manager = new StageStateManager();
  const attachment = {
    figureKey: 'fig-center',
    attachmentId: 'hat',
    configId: 'hat-preset',
    entityId: 'hat',
    visible: true,
  };
  const initial = initialLegacyAttachmentLocalVisualState();
  manager.applyStageEntityTransaction({
    kind: 'upsert-explicit-attachment',
    attachment,
    entity: {
      schemaVersion: 0,
      entityId: 'hat',
      renderableKind: 'attachment-sprite-group',
      source: {
        configId: attachment.configId,
        legacyAlias: { originFigureKey: attachment.figureKey, attachmentId: attachment.attachmentId },
      },
      visualState: initial,
      attachmentLink: legacyAttachmentLink(attachment, initial),
    },
  });
  manager.commit();
  let visible: AttachmentEntityVisualState | undefined = cloneDeep(initial);
  let object = { uuid: 'runtime-owner-1', pixiContainer: {} };
  const observers = new Set<AttachmentRuntimeObserver>();
  const runtime = {
    getEntity: vi.fn(() => (visible ? { entityId: 'hat', visualState: cloneDeep(visible) } : undefined)),
    setEntityVisualState: vi.fn((id: string, value: AttachmentEntityVisualState) => {
      visible = cloneDeep(value);
      return true;
    }),
    subscribe: vi.fn((observer: AttachmentRuntimeObserver) => {
      observers.add(observer);
      return () => observers.delete(observer);
    }),
  };
  const animations = new Map<string, IAnimationObject>();
  let renderOwners = 0;
  const host: EntityTransformHost = {
    getStageObjByKey: () => (visible ? object : undefined),
    registerAnimation: vi.fn((animation, key) => {
      animations.set(key, animation);
      animation.setStartState();
    }),
    removeAnimationWithoutSetEndState: vi.fn((key) => {
      animations.get(key)?.forceStopWithoutSetEndState?.();
      animations.delete(key);
    }),
    requestRender: vi.fn(),
    acquireExternalRenderActivity: () => {
      renderOwners++;
      let active = true;
      return () => {
        if (active) {
          active = false;
          renderOwners--;
        }
      };
    },
  };
  const drivers: Array<{ update: (p: number) => void; complete: () => void; stop: ReturnType<typeof vi.fn> }> = [];
  const complete = vi.fn(),
    report = vi.fn(),
    reserve = vi.fn(() => ({ release: vi.fn() }));
  const performer = createEntityTransformPerformer({
    manager,
    runtime: runtime as unknown as Pick<AttachmentRuntime, 'getEntity' | 'setEntityVisualState' | 'subscribe'>,
    host: () => host,
    animate: (duration, ease, update, done) => {
      const driver = { update, complete: done, stop: vi.fn() };
      drivers.push(driver);
      return driver;
    },
    complete,
    reserve,
    report,
  });
  return {
    manager,
    runtime,
    host,
    performer,
    drivers,
    animations,
    complete,
    report,
    reserve,
    observers,
    get visual(): AttachmentEntityVisualState {
      return visible!;
    },
    setVisual(v: AttachmentEntityVisualState | undefined) {
      visible = v;
    },
    get renderOwners() {
      return renderOwners;
    },
    replaceObject: () => {
      object = { uuid: 'runtime-owner-2', pixiContainer: {} };
    },
    emit: (event: AttachmentRuntimeEvent) => {
      [...observers].forEach((observer) => observer(event));
    },
    start: (perform: ReturnType<typeof performer.perform>) => {
      manager.commit();
      perform.isStarted = true;
      perform.startFunction?.();
    },
  };
}
async function drain() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function freeFixture() {
  const f = fixture();
  const world = { ...cloneDeep(f.visual), space: 'world' as const, position: { x: 20, y: 30 } };
  expect(f.manager.applyStageEntityTransaction({ kind: 'detach', entityId: 'hat', visualState: world }).applied).toBe(
    true,
  );
  f.manager.commit();
  f.setVisual(world);
  return f;
}

describe('reattach deferred committed endpoint persistence', () => {
  it('cancel after an intermediate real transform sample leaves durable source intact even after retention release', async () => {
    const f = freeFixture(),
      original = cloneDeep(f.manager.getViewStageState().stageEntities[0]);
    const retained = retainPendingCommittedStageEntity(original);
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100,"y":200}}',
      committed: true,
      deferCommittedEffectUntilSettled: true,
      onSettled: () => {
        releasePendingCommittedStageEntity(retained);
      },
    });
    f.start(p);
    expect(f.manager.getViewStageState().stageEntities[0]).toEqual(original);
    expect(f.manager.getCalculationStageState().stageEntities[0]).toEqual(original);
    f.drivers[0].update(0.5);
    expect(f.visual.position).toEqual({ x: 60, y: 115 });
    p.removeTransform();
    await drain();
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    expect(createCommittedStageSnapshot(f.manager.getViewStageState()).stageEntities[0]).toEqual(original);
    expect(f.manager.getCalculationStageState().stageEntities[0]).toEqual(original);
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
  });

  it('publishes natural terminal endpoint before callback, even across an unrelated native view commit', async () => {
    const f = freeFixture(),
      observed: number[] = [];
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100,"y":200}}',
      committed: true,
      deferCommittedEffectUntilSettled: true,
      onSettled: () => {
        observed.push(f.manager.getViewStageState().stageEntities[0].visualState.position.x);
      },
    });
    f.start(p);
    f.drivers[0].update(0.5);
    f.manager.setStage('showText', 'unrelated committed text');
    f.manager.commit();
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(20);
    f.drivers[0].complete();
    await drain();
    expect(observed).toEqual([100]);
    expect(f.manager.getViewStageState().showText).toBe('unrelated committed text');
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position).toEqual({ x: 100, y: 200 });
    expect(f.manager.getCalculationStageState().stageEntities[0].visualState.position).toEqual({ x: 100, y: 200 });
  });

  it('never overwrites a newer durable entity declaration at deferred settlement', async () => {
    const f = freeFixture();
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100}}',
      committed: true,
      deferCommittedEffectUntilSettled: true,
    });
    f.start(p);
    f.manager.updateEffect({ target: 'hat', transform: { position: { x: 999 } } });
    f.manager.commit();
    f.drivers[0].complete();
    await drain();
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(999);
    expect(f.manager.getCalculationStageState().stageEntities[0].visualState.position.x).toBe(999);
  });

  it('refuses a deferred durable terminal write after same-ID runtime owner replacement', async () => {
    const f = freeFixture(),
      original = cloneDeep(f.manager.getViewStageState().stageEntities[0]);
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100}}',
      committed: true,
      deferCommittedEffectUntilSettled: true,
    });
    f.start(p);
    f.replaceObject();
    f.drivers[0].complete();
    await drain();
    expect(f.manager.getViewStageState().stageEntities[0]).toEqual(original);
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
  });

  it('does not publish an old deferred endpoint when unregister starts a same-value new owner', async () => {
    const f = freeFixture(),
      settled = vi.fn();
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100}}',
      committed: true,
      deferCommittedEffectUntilSettled: true,
      onSettled: settled,
    });
    f.start(p);
    vi.mocked(f.host.removeAnimationWithoutSetEndState).mockImplementationOnce((key) => {
      f.animations.delete(key);
      const replacement = f.performer.perform({
        target: 'hat',
        animationString: '{"position":{"x":300}}',
        committed: true,
        deferCommittedEffectUntilSettled: true,
      });
      replacement.startFunction?.();
    });
    f.drivers[0].complete();
    await drain();
    expect(settled.mock.calls[0][0].signal.aborted).toBe(true);
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(20);
    expect(f.animations.size).toBe(1);
    f.drivers[1].complete();
    await drain();
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(300);
  });

  it.each(['forced', 'replaced'] as const)(
    'publishes a %s terminal world pose only after actually sampling its owned endpoint',
    async (reason) => {
      const f = freeFixture();
      const p = f.performer.perform({
        target: 'hat',
        animationString: '{"position":{"x":100}}',
        committed: true,
        deferCommittedEffectUntilSettled: true,
      });
      f.start(p);
      if (reason === 'forced') p.forceTransform();
      else p.stopFunction('replaced');
      await drain();
      expect(f.visual.position.x).toBe(100);
      expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(100);
      expect(f.manager.getViewStageState().stageEntities[0].attachmentLink).toBe(null);
      expect(f.complete).toHaveBeenCalledWith(p, reason);
    },
  );
});

describe('deferred entity transform / actual StageStateManager contracts', () => {
  it('authors only calculation until start, and discarded performs never access Runtime or timers', () => {
    const f = fixture(),
      view = f.manager.getViewStageState();
    const p = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}' });
    expect(f.manager.getViewStageState()).toBe(view);
    expect(f.manager.getCalculationStageState().stageEntities[0].visualState.position.x).toBe(100);
    expect(f.runtime.getEntity).not.toHaveBeenCalled();
    expect(f.runtime.setEntityVisualState).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.drivers).toHaveLength(0);
    p.onDiscard?.();
    expect(f.reserve.mock.results[0].value.release).toHaveBeenCalledTimes(1);
    p.startFunction?.();
    expect(f.drivers).toHaveLength(0);
  });
  it('registers the lock before sampling animation, preserves omitted axes, signed scale, rotation and skew', async () => {
    const f = fixture();
    f.setVisual({ ...f.visual, position: { x: 4, y: 9 }, scale: { x: 1, y: 2 } });
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100},"scale":{"x":-2},"rotation":1,"skew":{"x":0.4,"y":-0.2}}',
      ignoreDefault: true,
    });
    f.start(p);
    expect(f.animations.size).toBe(1);
    expect(f.visual.position).toEqual({ x: 4, y: 9 });
    f.drivers[0].update(0.5);
    expect(f.visual.position).toEqual({ x: 52, y: 9 });
    expect(f.visual.scale).toEqual({ x: -0.5, y: 2 });
    expect(f.visual.skew).toEqual({ x: 0.2, y: -0.1 });
    f.drivers[0].complete();
    await drain();
    expect(f.visual.position).toEqual({ x: 100, y: 9 });
    expect(f.animations.size).toBe(0);
    expect(f.renderOwners).toBe(0);
    expect(f.complete).toHaveBeenCalledWith(p, 'natural');
  });
  it('explicit zero duration settles instantly only after start', async () => {
    const f = fixture(),
      hook = vi.fn();
    const p = f.performer.perform({ target: 'hat', animationString: '{"alpha":0.2}', duration: 0, onSettled: hook });
    expect(f.visual.opacity).toBe(1);
    f.start(p);
    expect(f.visual.opacity).toBeCloseTo(0.2);
    expect(f.drivers).toHaveLength(0);
    await drain();
    expect(hook.mock.calls[0][0].reason).toBe('natural');
    expect(f.complete).toHaveBeenCalledTimes(1);
  });
  it('continuous transforms preserve a hidden logical declaration while its temporary host gate is visible', () => {
    const f = fixture();
    f.runtime.getEntity.mockImplementation(() => ({
      entityId: 'hat',
      visualState: cloneDeep(f.visual),
      visible: false,
    }));
    const p = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}' });
    f.start(p);
    f.setVisual({ ...f.visual, visible: true });
    f.drivers[0].update(0.5);
    expect(f.visual.visible).toBe(false);
    p.removeTransform();
  });
  it('rejects unsupported film/mask, partial skew and nonfinite/out of range appearance without any writes', () => {
    for (const animationString of [
      '{"oldFilm":1}',
      '{"mask":{}}',
      '{"skew":{"x":1}}',
      '{"alpha":2}',
      '{"gamma":0}',
      '{"colorRed":300}',
      '{"position":{"x":"2"}}',
    ]) {
      const f = fixture(),
        calc = f.manager.getCalculationStageState(),
        view = f.manager.getViewStageState();
      expect(() => f.performer.perform({ target: 'hat', animationString })).toThrow();
      expect(f.manager.getCalculationStageState()).toBe(calc);
      expect(f.manager.getViewStageState()).toBe(view);
      expect(f.runtime.getEntity).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it('zero-valued native film defaults remain compatible and writeDefault resets old entity values', () => {
    const f = fixture();
    f.manager.updateEffect({ target: 'hat', transform: { position: { x: 30, y: 40 }, alpha: 0.5 } });
    f.manager.commit();
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":10},"oldFilm":0}',
      writeDefault: true,
    });
    expect(f.manager.getCalculationStageState().stageEntities[0].visualState.position).toEqual({ x: 10, y: 0 });
    expect(f.manager.getCalculationStageState().stageEntities[0].visualState.opacity).toBe(1);
    p.onDiscard?.();
  });
  it('replacement force settles old endpoint but stale removal cannot remove the newer transform', async () => {
    const f = fixture(),
      oldHook = vi.fn();
    const a = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}', onSettled: oldHook });
    f.start(a);
    f.drivers[0].update(0.3);
    const b = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":200}}' });
    f.start(b);
    expect(f.visual.position.x).toBe(100);
    expect(f.animations.size).toBe(1);
    a.removeTransform();
    f.drivers[0].update(1);
    expect(f.animations.size).toBe(1);
    expect(f.visual.position.x).toBe(100);
    f.drivers[1].update(0.5);
    expect(f.visual.position.x).toBe(150);
    await drain();
    expect(oldHook.mock.calls[0][0].reason).toBe('replaced');
    expect(oldHook.mock.calls[0][0].signal.aborted).toBe(true);
    b.removeTransform();
    await drain();
    expect(f.animations.size).toBe(0);
  });
  it('parallel disjoint axes compose without overwriting one another', () => {
    const f = fixture();
    const x = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}', parallel: true });
    const y = f.performer.perform({ target: 'hat', animationString: '{"position":{"y":80}}', parallel: true });
    f.start(x);
    f.start(y);
    f.drivers[0].update(0.5);
    f.drivers[1].update(0.25);
    expect(f.visual.position).toEqual({ x: 50, y: 20 });
    expect(f.animations.size).toBe(2);
    x.removeTransform();
    y.removeTransform();
  });
  it('keep freezes sampled position when replaced instead of forcing endpoint', () => {
    const f = fixture(),
      a = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}', keep: true });
    f.start(a);
    f.drivers[0].update(0.3);
    const b = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":200}}' });
    f.start(b);
    expect(f.visual.position.x).toBe(30);
    expect(a.isHoldOn).toBe(true);
    b.removeTransform();
  });
  it('kept completed animation releases render activity but retains lock until explicitly removed', () => {
    const f = fixture(),
      p = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}', keep: true });
    f.start(p);
    f.drivers[0].complete();
    expect(f.renderOwners).toBe(0);
    expect(f.animations.size).toBe(1);
    expect(p.blockingAuto()).toBe(false);
    expect(f.complete).not.toHaveBeenCalled();
    p.removeTransform();
    expect(f.animations.size).toBe(0);
  });
  it('waits for missing Runtime entity only after start and releases waiter on readiness', () => {
    const f = fixture(),
      initial = f.visual;
    f.setVisual(undefined);
    const p = f.performer.perform({ target: 'hat', animationString: '{"rotation":1}' });
    f.start(p);
    expect(p.blockingNext()).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    f.setVisual(initial);
    f.emit({ type: 'figure-registered', figureKey: 'fig-center', figureGeneration: '1' });
    expect(f.drivers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.observers.size).toBe(0);
    p.removeTransform();
  });
  it('bounded readiness failure completes diagnostically and cannot resurrect', async () => {
    const f = fixture(),
      initial = f.visual;
    f.setVisual(undefined);
    const p = f.performer.perform({ target: 'hat', animationString: '{}' });
    f.start(p);
    vi.advanceTimersByTime(10000);
    await drain();
    expect(f.report).toHaveBeenCalledWith('ENTITY_TRANSFORM_TARGET_TIMEOUT', expect.any(String));
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
    f.setVisual(initial);
    f.emit({ type: 'figure-registered', figureKey: 'fig-center', figureGeneration: '1' });
    expect(f.drivers).toHaveLength(0);
    expect(f.observers.size).toBe(0);
  });
  it('exact UUID replacement rejects stale animation callbacks without affecting successor', async () => {
    const f = fixture(),
      p = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}' });
    f.start(p);
    f.drivers[0].update(0.3);
    f.replaceObject();
    f.drivers[0].update(0.7);
    await drain();
    expect(f.visual.position.x).toBe(30);
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
    expect(f.animations.size).toBe(0);
  });
  it('terminal committed patch does not publish any newer future calculation', async () => {
    const f = fixture(),
      p = f.performer.perform({ target: 'hat', animationString: '{"position":{"x":100}}' });
    f.start(p);
    f.manager.setStage('showText', 'future-only');
    f.manager.updateEffect({ target: 'hat', transform: { position: { x: 999 } } });
    const future = cloneDeep(f.manager.getCalculationStageState());
    f.drivers[0].complete();
    await drain();
    expect(f.manager.getCalculationStageState()).toEqual(future);
    expect(f.manager.getViewStageState().showText).not.toBe('future-only');
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(100);
  });
  it('nested committed mode authors no pre-start state and holds until asynchronous reattach settlement', async () => {
    const f = fixture();
    let resolve!: () => void;
    const settlement = new Promise<void>((r) => {
      resolve = r;
    });
    const calc = f.manager.getCalculationStageState(),
      view = f.manager.getViewStageState();
    const p = f.performer.perform({
      target: 'hat',
      animationString: '{"position":{"x":100}}',
      committed: true,
      holdNextUntilSettled: true,
      onSettled: () => settlement,
    });
    expect(f.manager.getCalculationStageState()).toBe(calc);
    expect(f.manager.getViewStageState()).toBe(view);
    expect(f.reserve).not.toHaveBeenCalled();
    p.startFunction?.();
    expect(f.manager.getViewStageState().stageEntities[0].visualState.position.x).toBe(100);
    f.drivers[0].complete();
    await drain();
    expect(p.blockingNext()).toBe(true);
    expect(f.complete).not.toHaveBeenCalled();
    resolve();
    await drain();
    expect(p.blockingNext()).toBe(false);
    expect(f.complete).toHaveBeenCalledWith(p, 'natural');
  });
  it('reset/remove cancel without writing endpoint and callback failures are isolated', async () => {
    const f = fixture(),
      p = f.performer.perform({
        target: 'hat',
        animationString: '{"position":{"x":100}}',
        onSettled: () => {
          throw Error('hook failure');
        },
      });
    f.start(p);
    f.drivers[0].update(0.2);
    p.stopFunction('reset');
    await drain();
    expect(f.visual.position.x).toBe(20);
    expect(f.report).toHaveBeenCalledWith(
      'ENTITY_TRANSFORM_SETTLEMENT_FAILED',
      expect.stringContaining('hook failure'),
    );
    expect(f.animations.size).toBe(0);
    expect(f.renderOwners).toBe(0);
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
  });
  it('a driver stop failure cannot strand the owned animation lock, render token or terminal perform', async () => {
    const f = fixture(),
      p = f.performer.perform({ target: 'hat', animationString: '{"rotation":1}' });
    f.start(p);
    f.drivers[0].stop.mockImplementation(() => {
      throw Error('driver-stop-fault');
    });
    expect(() => p.removeTransform()).not.toThrow();
    await drain();
    expect(f.animations.size).toBe(0);
    expect(f.renderOwners).toBe(0);
    expect(f.performer.removeTarget('hat')).toBe(false);
    expect(f.report).toHaveBeenCalledWith(
      'ENTITY_TRANSFORM_CLEANUP_FAILED',
      expect.stringContaining('driver-stop-fault'),
    );
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
  });
  it('a Runtime setter failure cancels the exact transform and releases its owners', async () => {
    const f = fixture(),
      p = f.performer.perform({ target: 'hat', animationString: '{"rotation":1}' });
    f.start(p);
    f.runtime.setEntityVisualState.mockImplementation(() => {
      throw Error('runtime-update-fault');
    });
    expect(() => f.drivers[0].update(0.5)).not.toThrow();
    await drain();
    expect(f.animations.size).toBe(0);
    expect(f.renderOwners).toBe(0);
    expect(f.report).toHaveBeenCalledWith(
      'ENTITY_TRANSFORM_UPDATE_FAILED',
      expect.stringContaining('runtime-update-fault'),
    );
    expect(f.complete).toHaveBeenCalledWith(p, 'cancelled');
  });
});
