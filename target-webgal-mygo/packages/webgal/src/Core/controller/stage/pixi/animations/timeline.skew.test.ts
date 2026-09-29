import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { assignPixiTransform, applyTransformToPixiContainer } from '../stageEffectTransform';

vi.mock('@/Core/WebGAL', () => ({ WebGAL: { gameplay: { pixiStage: { getStageObjByKey: vi.fn() } } } }));
vi.mock('@/Core/controller/stage/pixi/PixiController', async () => {
  const { assignPixiTransform } = await import('../stageEffectTransform');
  return { default: { assignTransform: assignPixiTransform } };
});
const { WebGAL } = await import('@/Core/WebGAL');
const { generateTimelineObj } = await import('./timeline');
let now = 0, id = 0, frames: Map<number, FrameRequestCallback>, container: Container;
beforeEach(() => {
  now = 0; id = 0; frames = new Map(); container = new Container();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  vi.mocked(WebGAL.gameplay.pixiStage!.getStageObjByKey).mockReturnValue({ pixiContainer: container } as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function tick(time: number) { now = time; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(time)); }
function matrix() {
  container.transform.updateLocalTransform();
  const { a, b, c, d, tx, ty } = container.localTransform;
  return [a, b, c, d, tx, ty];
}
describe('native timeline skew endpoint continuity on real Pixi transforms', () => {
  it.each([15, 60])('interpolates both skew axes before cleanup at %i FPS, including CC-01 rotation/nonuniform scale', fps => {
    const endpoint = { position: { x: -180, y: -70 }, scale: { x: 1.2, y: .88 }, skew: { x: .08, y: -.05 }, rotation: .3, duration: 1100, ease: 'easeInOut' };
    let animation: ReturnType<typeof generateTimelineObj>;
    const done = vi.fn(() => {
      expect(container.skew.x).toBeCloseTo(.08, 10); expect(container.skew.y).toBeCloseTo(-.05, 10);
      const before = matrix(); animation.setEndState(); expect(matrix()).toEqual(before);
    });
    animation = generateTimelineObj([{ position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, skew: { x: 0, y: 0 }, rotation: 0, duration: 0, ease: '' }, endpoint], 'figure', 1100, done);
    animation.setStartState(); tick(550);
    expect(container.skew.x).toBeCloseTo(.04, 10); expect(container.skew.y).toBeCloseTo(-.025, 10);
    for (let t = 550 + 1000 / fps; t < 1100; t += 1000 / fps) tick(t);
    expect(done).not.toHaveBeenCalled(); tick(1100); expect(done).toHaveBeenCalledTimes(1);
  });
  it('returns smoothly from nonzero skew to zero and settles forced completion', () => {
    const animation = generateTimelineObj([{ skew: { x: .08, y: -.05 }, duration: 0, ease: '' }, { skew: { x: 0, y: 0 }, duration: 900, ease: 'linear' }], 'figure', 900);
    animation.setStartState(); tick(450);
    expect(container.skew.x).toBeCloseTo(.04); expect(container.skew.y).toBeCloseTo(-.025);
    animation.setEndState(); tick(1200); expect(container.skew.x).toBe(0); expect(container.skew.y).toBe(0);
  });
  it('preserves an omitted axis in partial parallel/ignoreDefault timelines, and cancellation freezes it', () => {
    container.skew.set(.1, .7);
    const animation = generateTimelineObj([{ skew: { x: .1 } as any, duration: 0, ease: '' }, { skew: { x: .3 } as any, duration: 1000, ease: 'linear' }], 'figure', 1000);
    animation.setStartState(); tick(500);
    expect(container.skew.x).toBeCloseTo(.2); expect(container.skew.y).toBe(.7);
    const before = matrix(); animation.forceStopWithoutSetEndState?.(); tick(1500); expect(matrix()).toEqual(before);
  });
  it('replaying an untransformed committed figure clears stale skew on the reused Pixi container', () => {
    assignPixiTransform(container, { skew: { x: .08, y: -.05 }, rotation: .3 });
    applyTransformToPixiContainer(container as any, undefined);
    expect(container.skew.x).toBe(0); expect(container.skew.y).toBe(0); expect(container.rotation).toBe(0);
    assignPixiTransform(container, { skew: { x: .08, y: -.05 } });
    applyTransformToPixiContainer(container as any, { rotation: 0 });
    expect(container.skew.x).toBe(0); expect(container.skew.y).toBe(0);
  });
});
