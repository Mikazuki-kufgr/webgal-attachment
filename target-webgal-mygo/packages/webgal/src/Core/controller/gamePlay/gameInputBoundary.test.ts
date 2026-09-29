import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireGameAdvanceLock,
  releaseGameAdvanceLock,
  isGameAdvanceLocked,
  shouldIgnoreGameAdvance,
  beginGameInputBoundaryGesture,
  finishGameInputBoundaryGesture,
  cancelGameInputBoundaryGesture,
  gameInputBoundaryDiagnostics,
} from './gameInputBoundary';

afterEach(() => {
  for (const owner of gameInputBoundaryDiagnostics().advanceLockOwners) releaseGameAdvanceLock(owner);
  cancelGameInputBoundaryGesture();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Creator input ownership CPU contract (not browser/visual acceptance)', () => {
  it('ordinary unowned events remain game owned', () =>
    expect(shouldIgnoreGameAdvance(new Event('click'))).toBe(false));
  it.each(['click', 'dblclick', 'keydown', 'wheel', 'contextmenu'])('locks %s before any DOM access', (type) => {
    acquireGameAdvanceLock('creator-A');
    expect(shouldIgnoreGameAdvance(new Event(type))).toBe(true);
  });
  it('distinct workbenches cannot release each other', () => {
    acquireGameAdvanceLock('A');
    acquireGameAdvanceLock('B');
    releaseGameAdvanceLock('A');
    expect(isGameAdvanceLocked()).toBe(true);
    releaseGameAdvanceLock('B');
    expect(isGameAdvanceLocked()).toBe(false);
  });
  it('empty owner rejected', () => expect(() => acquireGameAdvanceLock(' ')).toThrow('OWNER_REQUIRED'));
  it('consumes only the immediate drag synthetic click', () => {
    vi.useFakeTimers();
    beginGameInputBoundaryGesture(7);
    expect(finishGameInputBoundaryGesture(7, true)).toBe(true);
    expect(shouldIgnoreGameAdvance(new Event('click'))).toBe(true);
    expect(shouldIgnoreGameAdvance(new Event('click'))).toBe(false);
    vi.runAllTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('unrelated pointer cannot cancel/finish an active drag', () => {
    beginGameInputBoundaryGesture(9);
    expect(cancelGameInputBoundaryGesture(8)).toBe(false);
    expect(finishGameInputBoundaryGesture(8, true)).toBe(false);
    expect(gameInputBoundaryDiagnostics().activePointerId).toBe(9);
  });
  it('cancellation clears suppression and timer', () => {
    vi.useFakeTimers();
    beginGameInputBoundaryGesture(9);
    finishGameInputBoundaryGesture(9, true);
    cancelGameInputBoundaryGesture();
    expect(vi.getTimerCount()).toBe(0);
    expect(shouldIgnoreGameAdvance(new Event('click'))).toBe(false);
  });
  it('honors composed-path editable and boundary nodes without relying on event.target', () => {
    class FixtureElement {
      constructor(private readonly selector: string) {}
      closest(value: string) {
        return value.includes(this.selector) ? this : null;
      }
    }
    vi.stubGlobal('Element', FixtureElement);
    for (const selector of ['input', 'data-webgal-game-input-boundary']) {
      const event = new Event('keydown');
      Object.defineProperty(event, 'composedPath', { value: () => [new FixtureElement(selector)] });
      expect(shouldIgnoreGameAdvance(event)).toBe(true);
    }
  });
});
