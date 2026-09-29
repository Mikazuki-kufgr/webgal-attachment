import { beforeEach, describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { initState, stageStateManager } from './stage/stageStateManager';
import type { IUserAnimation } from './animations';
vi.mock('@/Core/WebGAL', () => ({ WebGAL: { animationManager: { getAnimations: vi.fn() } } }));
vi.mock('@/Core/util/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/Core/controller/stage/pixi/animations/timeline', () => ({ generateTimelineObj: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/animations/universalSoftOff', () => ({ generateUniversalSoftOffAnimationObj: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/PixiController', async () => {
  const { assignPixiTransform } = await import('@/Core/controller/stage/pixi/stageEffectTransform');
  return { default: { assignTransform: assignPixiTransform } };
});
const { WebGAL } = await import('@/Core/WebGAL');
const { getAnimationTimeline } = await import('./animationFunctions');
const { generateTransformAnimationObj } = await import('@/Core/controller/stage/pixi/animations/generateTransformAnimationObj');
beforeEach(() => {
  stageStateManager.resetAllStageState(cloneDeep(initState));
  stageStateManager.replaceAllStageState({ ...cloneDeep(initState), effects: [{ target: 'figure', transform: { skew: { x: .08, y: -.05 }, rotation: .3 } }] });
});
function map(effects: IUserAnimation['effects'], full = true) {
  vi.mocked(WebGAL.animationManager.getAnimations).mockReturnValue([{ name: 'test', effects }]);
  return getAnimationTimeline('test', 'figure', false, full)!;
}
describe('named / generated transform timelines preserve skew axis ownership', () => {
  it('fills zero axes on an ordinary legacy timeline without skew', () => {
    stageStateManager.resetAllStageState(cloneDeep(initState));
    expect(map([{ rotation: .3, duration: 1000, ease: 'linear' }])[0].skew).toEqual({ x: 0, y: 0 });
  });
  it('keeps the untouched current skew axis for ordinary complete effects', () => {
    expect(map([{ skew: { x: .2 } as any, duration: 1000, ease: 'linear' }])[0].skew).toEqual({ x: .2, y: -.05 });
  });
  it('partial named timeline owns x alone, including missing-axis inheritance across segments', () => {
    const mapped = map([{ duration: 0, ease: '' }, { skew: { x: .2 } as any, duration: 1000, ease: 'linear' }], false);
    expect(mapped[0].skew).toEqual({ x: .08 }); expect(mapped[1].skew).toEqual({ x: .2 });
  });
  it('parallel setTransform does not acquire the omitted y axis from its start frame', () => {
    const frames = generateTransformAnimationObj('figure', { skew: { x: .2 } as any, duration: 1000, ease: 'linear' }, 1000, 'linear', false);
    expect(frames[0].skew).toEqual({ x: .08 });
    expect(map(frames, false).map(f => f.skew)).toEqual([{ x: .08 }, { x: .2 }]);
  });
  it('committing a partial native skew endpoint retains the other axis for following state sync/save', () => {
    stageStateManager.replaceAllStageState({ ...cloneDeep(initState), effects: [{ target: 'fig-center', transform: { skew: { x: .08, y: -.05 } } }] });
    stageStateManager.updateEffect({ target: 'fig-center', transform: { skew: { x: .2 } } });
    expect(stageStateManager.getCalculationStageState().effects.find(e => e.target === 'fig-center')?.transform?.skew).toEqual({ x: .2, y: -.05 });
  });
});
