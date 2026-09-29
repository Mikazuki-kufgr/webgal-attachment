import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneManager } from '@/Core/Modules/scene';
import {
  beginSceneMutation,
  commitSceneMutation,
  getSceneMutationEpochForDiagnostics,
  inheritSceneMutationToken,
  invalidateSceneMutation,
  isSceneMutationCurrent,
  isSceneMutationEpochCurrent,
  withSceneMutationContext,
} from './sceneMutationEpoch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => invalidateSceneMutation());

describe('shared scene mutation authority', () => {
  it('rejects stale, ABA and copied token authority', () => {
    const first = beginSceneMutation('load-game');
    beginSceneMutation('start-game');
    const latest = beginSceneMutation('load-game');
    expect(first.signal.aborted).toBe(true);
    expect(isSceneMutationCurrent(first)).toBe(false);
    expect(isSceneMutationCurrent({ ...latest })).toBe(false);
    expect(isSceneMutationCurrent(latest)).toBe(true);
    expect(getSceneMutationEpochForDiagnostics()).toBe(latest.epoch);
    expect(isSceneMutationEpochCurrent(first.epoch)).toBe(false);
    expect(isSceneMutationEpochCurrent(latest.epoch)).toBe(true);
    const action = vi.fn();
    expect(commitSceneMutation(first, action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('an abort callback can supersede the request that caused the abort', () => {
    const first = beginSceneMutation('call-scene');
    let nested = first;
    first.signal.addEventListener('abort', () => {
      nested = beginSceneMutation('backlog');
    });
    const outer = beginSceneMutation('start-game');
    expect(isSceneMutationCurrent(outer)).toBe(false);
    expect(outer.signal.aborted).toBe(true);
    expect(isSceneMutationCurrent(nested)).toBe(true);
  });

  it('commit reports callback supersession and synchronous context is restored on throw', () => {
    const token = beginSceneMutation('terre-sync');
    expect(() =>
      withSceneMutationContext(token, () => {
        expect(inheritSceneMutationToken()).toBe(token);
        throw new Error('callback');
      }),
    ).toThrow('callback');
    expect(inheritSceneMutationToken()).toBeUndefined();
    expect(
      commitSceneMutation(token, () => {
        beginSceneMutation('end-game');
      }),
    ).toBe(false);
    expect(withSceneMutationContext(token, () => true)).toBeUndefined();
  });

  it('does not leak inherited authority across await', async () => {
    const token = beginSceneMutation('terre-sync');
    const task = withSceneMutationContext(token, async () => {
      expect(inheritSceneMutationToken()).toBe(token);
      await Promise.resolve();
      expect(inheritSceneMutationToken()).toBeUndefined();
    });
    await task;
  });

  it('retains a superseded synchronous scope instead of authorizing a fresh mutation', () => {
    const token = beginSceneMutation('terre-sync');
    withSceneMutationContext(token, () => {
      beginSceneMutation('load-game');
      expect(inheritSceneMutationToken()).toBe(token);
      expect(isSceneMutationCurrent(inheritSceneMutationToken()!)).toBe(false);
    });
  });
});

describe('scene write lock ownership', () => {
  it('old settlement cannot unlock a newer write, and abort releases captured preview wait', async () => {
    const manager = new SceneManager();
    const firstWork = deferred<string>();
    const first = manager.trackSceneWrite(beginSceneMutation('call-scene'), firstWork.promise);
    const oldPreviewWait = manager.sceneWritePromise;
    const secondToken = beginSceneMutation('load-game');
    const secondWork = deferred<string>();
    const second = manager.trackSceneWrite(secondToken, secondWork.promise);
    const newPreviewWait = manager.sceneWritePromise;
    await oldPreviewWait;
    expect(manager.lockSceneWrite).toBe(true);
    firstWork.resolve('old');
    expect(await first).toBe('old');
    expect(manager.lockSceneWrite).toBe(true);
    expect(manager.sceneWritePromise).toBe(newPreviewWait);
    secondWork.resolve('new');
    expect(await second).toBe('new');
    expect(manager.lockSceneWrite).toBe(false);
    expect(manager.sceneWritePromise).toBeNull();
  });

  it('uses exact write identity even when two writes share a parent preview token', async () => {
    const manager = new SceneManager();
    const token = beginSceneMutation('terre-sync');
    const firstWork = deferred<boolean>();
    const secondWork = deferred<boolean>();
    const first = manager.trackSceneWrite(token, firstWork.promise);
    const firstWait = manager.sceneWritePromise;
    const second = manager.trackSceneWrite(token, secondWork.promise);
    await firstWait;
    firstWork.resolve(false);
    await first;
    expect(manager.lockSceneWrite).toBe(true);
    secondWork.resolve(true);
    expect(await second).toBe(true);
  });

  it('handles preview rejection separately while preserving the caller rejection', async () => {
    const manager = new SceneManager();
    const work = deferred<boolean>();
    const task = manager.trackSceneWrite(beginSceneMutation('load-game'), work.promise);
    const previewWait = manager.sceneWritePromise;
    work.reject(new Error('transport'));
    await expect(task).rejects.toThrow('transport');
    await expect(previewWait).resolves.toBeUndefined();
    expect(manager.lockSceneWrite).toBe(false);
  });

  it('owned reset preserves its write; default reset invalidates; stale reset is inert', async () => {
    const manager = new SceneManager();
    const token = beginSceneMutation('load-game');
    const work = deferred<boolean>();
    const task = manager.trackSceneWrite(token, work.promise);
    const pending = manager.sceneWritePromise;
    manager.settledScenes.add('before.txt');
    expect(manager.resetScene({ mutation: token })).toBe(true);
    expect(isSceneMutationCurrent(token)).toBe(true);
    expect(manager.sceneWritePromise).toBe(pending);
    expect(manager.lockSceneWrite).toBe(true);
    expect(manager.settledScenes.size).toBe(0);
    expect(manager.resetScene()).toBe(true);
    expect(token.signal.aborted).toBe(true);
    expect(manager.lockSceneWrite).toBe(false);
    manager.sceneData.currentSentenceId = 42;
    expect(manager.resetScene({ mutation: token })).toBe(false);
    expect(manager.sceneData.currentSentenceId).toBe(42);
    work.resolve(false);
    await task;
  });
});
