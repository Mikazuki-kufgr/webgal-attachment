import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as popmotion from 'popmotion';
import { wallClockDriver } from './wallClockDriver';

let now = 0, next = 0;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  now = 0; next = 0; frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback); return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function tick(time: number) {
  now = time;
  const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time));
}
describe('real popmotion with wall clock keyframes', () => {
  it.each([15, 60])('finishes at the first frame reaching duration at %s FPS', fps => {
    const values: number[] = [], complete = vi.fn();
    popmotion.animate({from: 0, to: 100, duration: 5100, ease: popmotion.easeInOut,
      driver: wallClockDriver, onUpdate: v => values.push(v), onComplete: complete});
    for (let t = 1000/fps; t < 5100; t += 1000/fps) tick(t);
    expect(complete).not.toHaveBeenCalled();
    tick(5100);
    expect(values.at(-1)).toBe(100);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it('counts a delayed/background frame once and stops scheduling at completion', () => {
    const complete = vi.fn(), update = vi.fn();
    popmotion.animate({from:0,to:1,duration:1000,driver:wallClockDriver,onUpdate:update,onComplete:complete});
    tick(50); tick(4000);
    expect(update).toHaveBeenLastCalledWith(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it('replacement stops old queued updates without completing or applying its endpoint', () => {
    const complete = vi.fn(), update = vi.fn();
    const old = popmotion.animate({from:0,to:100,duration:1000,driver:wallClockDriver,onUpdate:update,onComplete:complete});
    tick(100); old.stop(); const count=update.mock.calls.length; tick(2000);
    expect(update).toHaveBeenCalledTimes(count); expect(complete).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});
