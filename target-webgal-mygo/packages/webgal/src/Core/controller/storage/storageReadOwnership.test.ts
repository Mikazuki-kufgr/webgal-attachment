import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserData, ISaveData } from '@/store/userDataInterface';
vi.mock('localforage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() }, getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@/Core/WebGAL', () => ({ WebGAL: { gameKey: 'one' } }));
vi.mock('@/store/store', () => ({ webgalStore: { dispatch: vi.fn(), getState: vi.fn() } }));
const { WebGAL } = await import('@/Core/WebGAL');
const { webgalStore } = await import('@/store/store');
const forage = await import('localforage');
const { getFastSaveFromStorage } = await import('./savesController');
const { dumpToStorageFast } = await import('./storageController');
const { initState } = await import('@/store/userDataReducer');
let userData: IUserData;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  WebGAL.gameKey = 'one';
  userData = { ...initState };
  vi.mocked(webgalStore.getState).mockImplementation(() => ({ userData } as ReturnType<typeof webgalStore.getState>));
  vi.mocked(forage.setItem).mockResolvedValue(undefined);
  vi.mocked(forage.getItem).mockResolvedValue(userData);
});
describe('asynchronous storage readback ownership', () => {
  it('discarded quickload does not dispatch its old IndexedDB payload', async () => {
    const pending = deferred<ISaveData | null>();
    let current = true;
    vi.mocked(forage.default.getItem).mockReturnValue(pending.promise);
    const task = getFastSaveFromStorage(() => current);
    current = false;
    pending.resolve({} as ISaveData);
    expect(await task).toBeNull();
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
  });
  it('game identity change discards old quickload even with default caller guard', async () => {
    const pending = deferred<ISaveData | null>();
    vi.mocked(forage.default.getItem).mockReturnValue(pending.promise);
    const task = getFastSaveFromStorage();
    WebGAL.gameKey = 'two';
    pending.resolve({} as ISaveData);
    expect(await task).toBeNull();
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
  });
  it('current quickload returns its exact snapshot and dispatches once', async () => {
    const data = {} as ISaveData;
    vi.mocked(forage.default.getItem).mockResolvedValue(data);
    expect(await getFastSaveFromStorage()).toBe(data);
    expect(webgalStore.dispatch).toHaveBeenCalledOnce();
  });
  it('end-game readback cannot overwrite newer in-memory user data', async () => {
    const pending = deferred<IUserData | null>();
    vi.mocked(forage.getItem).mockReturnValue(pending.promise);
    const task = dumpToStorageFast();
    await Promise.resolve();
    const previous = userData;
    userData = { ...initState };
    pending.resolve(previous);
    await task;
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
  });
  it('stale end-game write completion cannot issue readback into newer scene', async () => {
    const pending = deferred<unknown>();
    vi.mocked(forage.setItem).mockReturnValue(pending.promise);
    let current = true;
    const task = dumpToStorageFast(() => current);
    current = false;
    pending.resolve(null);
    await task;
    expect(forage.getItem).not.toHaveBeenCalled();
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
  });
});
