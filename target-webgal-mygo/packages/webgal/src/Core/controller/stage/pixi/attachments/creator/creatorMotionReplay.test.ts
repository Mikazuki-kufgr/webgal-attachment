import { describe, expect, it, vi } from 'vitest';
import { replayCreatorMotion, invalidateCreatorMotionReplay } from './creatorMotionReplay';
import type { ActiveLive2DFigureResult } from '../../PixiController';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture() {
  const host = {};
  const model = { motion: vi.fn(async () => true), internalModel: { motionManager: { stopAllMotions: vi.fn() } } };
  let active: ActiveLive2DFigureResult = {
    status: 'ready',
    figure: {
      key: 'a',
      uuid: 'g1',
      sourceUrl: 'game/figure/a/model.json',
      normalizedSourceUrl: 'game/figure/a/model.json',
      isExiting: false,
      outerContainer: {} as never,
      model: model as never,
    },
  };
  const record = vi.fn();
  const run = (name = 'idle', generation = 'g1') =>
    replayCreatorMotion(host, () => active, record, 'a', name, generation);
  return {
    host,
    model,
    record,
    run,
    setActive: (value: ActiveLive2DFigureResult) => {
      active = value;
    },
    active: () => active,
  };
}
describe('5H exact-generation explicit Live2D motion replay', () => {
  it('replays an identical motion every time and reports the real acceptance', async () => {
    const f = fixture();
    expect((await f.run()).started).toBe(true);
    expect((await f.run()).started).toBe(true);
    expect(f.model.motion).toHaveBeenCalledTimes(2);
    expect(f.model.motion).toHaveBeenLastCalledWith('idle', 0, 3);
    expect(f.record).toHaveBeenCalledTimes(2);
  });
  it('rejects stale generation before touching the model', async () => {
    const f = fixture();
    expect((await f.run('idle', 'g0')).reason).toBe('FIGURE_GENERATION_CHANGED');
    expect(f.model.motion).not.toHaveBeenCalled();
  });
  it('rejects a loading/unsupported host without casting it into a Live2D model', async () => {
    const f = fixture();
    f.setActive({ status: 'unsupported', figureKey: 'a', uuid: 'g1', sourceExt: 'wmdl' });
    expect((await f.run()).started).toBe(false);
    expect(f.model.motion).not.toHaveBeenCalled();
  });
  it('a rejected model.motion is not recorded as started', async () => {
    const f = fixture();
    f.model.motion.mockResolvedValueOnce(false);
    expect(await f.run()).toEqual({
      started: false,
      modelCount: 1,
      acceptedCount: 0,
      reason: 'LIVE2D_MOTION_REJECTED',
    });
    expect(f.record).not.toHaveBeenCalled();
  });
  it('late A acceptance cannot overwrite a completed B intent', async () => {
    const f = fixture();
    const slow = deferred<boolean>();
    f.model.motion.mockReturnValueOnce(slow.promise);
    const old = f.run('a');
    const next = f.run('b');
    expect((await next).started).toBe(true);
    slow.resolve(true);
    expect((await old).reason).toBe('CREATOR_MOTION_SUPERSEDED');
    expect(f.record.mock.calls).toEqual([['a', 'b']]);
  });
  it('native narrative setter invalidates a pending Creator recorder write', async () => {
    const f = fixture();
    const slow = deferred<boolean>();
    f.model.motion.mockReturnValueOnce(slow.promise);
    const pending = f.run();
    invalidateCreatorMotionReplay(f.host, 'a');
    slow.resolve(true);
    expect((await pending).started).toBe(false);
    expect(f.record).not.toHaveBeenCalled();
  });
  it('replacement during motion await cannot report success against a newer UUID', async () => {
    const f = fixture();
    const slow = deferred<boolean>();
    f.model.motion.mockReturnValueOnce(slow.promise);
    const pending = f.run();
    f.setActive({ status: 'absent', figureKey: 'a' });
    slow.resolve(true);
    expect((await pending).started).toBe(false);
    expect(f.record).not.toHaveBeenCalled();
  });
  it('propagates a real model error and allows the next replay', async () => {
    const f = fixture();
    f.model.motion.mockRejectedValueOnce(new Error('motion broken'));
    await expect(f.run()).rejects.toThrow('motion broken');
    expect((await f.run()).started).toBe(true);
  });
  it.each(['', 'idle\n'])('rejects invalid explicit motion %j', async (name) => {
    const f = fixture();
    expect((await f.run(name)).reason).toBe('LIVE2D_MOTION_INVALID');
    expect(f.model.motion).not.toHaveBeenCalled();
  });
});
