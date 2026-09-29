import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IScene } from './sceneInterface';
import {
  beginSceneMutation,
  commitSceneMutation,
  invalidateSceneMutation,
  isSceneMutationCurrent,
  withSceneMutationContext,
} from './sceneMutationEpoch';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    sceneManager: undefined,
    gameplay: { isFastPreview: false },
    flowchartManager: { waitForCurrentSceneDialog: vi.fn() },
  },
}));
vi.mock('./sceneFetcher', () => ({ sceneFetcher: vi.fn() }));
vi.mock('@/Core/gameScripts/setVar', () => ({ setGameVar: vi.fn() }));
vi.mock('@/Core/parser/sceneParser', () => ({ sceneParser: vi.fn() }));
vi.mock('@/Core/controller/gamePlay/nextSentence', () => ({ continueSentence: vi.fn() }));
vi.mock('@/Core/util/prefetcher/assetsPrefetcher', () => ({ clearPrefetchLinks: vi.fn() }));
vi.mock('@/Core/util/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn() } }));

const { WebGAL } = await import('@/Core/WebGAL');
const { SceneManager } = await import('@/Core/Modules/scene');
const { sceneFetcher } = await import('./sceneFetcher');
const { sceneParser } = await import('@/Core/parser/sceneParser');
const { continueSentence } = await import('@/Core/controller/gamePlay/nextSentence');
const { clearPrefetchLinks } = await import('@/Core/util/prefetcher/assetsPrefetcher');
const { logger } = await import('@/Core/util/logger');
const { changeScene } = await import('./changeScene');
const { callScene } = await import('./callScene');
const { restoreScene } = await import('./restoreScene');
const { returnFromScene } = await import('./returnFromScene');
const { setGameVar } = await import('@/Core/gameScripts/setVar');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeScene(name: string, url = `${name}.txt`): IScene {
  return { sceneName: name, sceneUrl: url, sentenceList: [], assetsList: [], subSceneList: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  WebGAL.sceneManager = new SceneManager();
  WebGAL.sceneManager.sceneData.currentScene = makeScene('original');
  WebGAL.sceneManager.sceneData.currentSentenceId = 7;
  WebGAL.gameplay.isFastPreview = false;
  vi.mocked(sceneParser).mockImplementation((_raw, name, url) => makeScene(name, url));
  vi.mocked(sceneFetcher).mockResolvedValue('text');
  vi.mocked(clearPrefetchLinks).mockImplementation(() => undefined);
  vi.mocked(WebGAL.flowchartManager.waitForCurrentSceneDialog).mockImplementation(() => undefined);
});
afterEach(() => invalidateSceneMutation());

describe('native scene navigation uses shared latest-intent authority', () => {
  it('321 locals and return publish only after the caller scene is fetched', async () => {
    const data = WebGAL.sceneManager.sceneData;
    data.currentLocals = { caller: 7 };
    expect(await callScene('child.txt', 'child', { child: 9 }, 'result')).toBe(true);
    expect(data.currentLocals).toEqual({ child: 9 });
    expect(data.sceneStack[0].locals).toEqual({ caller: 7 });
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
    const restoring = returnFromScene(42);
    await Promise.resolve();
    expect(data.sceneStack).toHaveLength(1);
    expect(data.currentLocals).toEqual({ child: 9 });
    expect(setGameVar).not.toHaveBeenCalled();
    fetch.resolve('caller text');
    expect(await restoring).toBe(true);
    expect(data.sceneStack).toHaveLength(0);
    expect(data.currentLocals).toEqual({ caller: 7 });
    expect(setGameVar).toHaveBeenCalledWith({ key: 'result', value: 42 });
  });
  it('321 failed return preserves the complete callee and caller frame', async () => {
    WebGAL.sceneManager.sceneData.currentLocals = { caller: 7 };
    await callScene('child.txt', 'child', { child: 9 }, 'result');
    vi.mocked(sceneFetcher).mockRejectedValue(new Error('offline'));
    expect(await returnFromScene(42)).toBe(false);
    expect(WebGAL.sceneManager.sceneData.currentLocals).toEqual({ child: 9 });
    expect(WebGAL.sceneManager.sceneData.sceneStack[0].locals).toEqual({ caller: 7 });
    expect(setGameVar).not.toHaveBeenCalled();
  });
  it('321 stale return cannot publish into a newer scene', async () => {
    await callScene('child.txt', 'child', { child: 9 }, 'result');
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValueOnce(fetch.promise);
    const restoring = returnFromScene(42);
    await Promise.resolve();
    vi.mocked(sceneFetcher).mockResolvedValue('new scene');
    expect(await changeScene('latest.txt', 'latest')).toBe(true);
    fetch.resolve('late caller');
    expect(await restoring).toBe(false);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('latest');
    expect(setGameVar).not.toHaveBeenCalled();
  });
  it.each(['old-first', 'new-first'])(
    'two snippet changes sharing one token keep only the newest write: %s',
    async (order) => {
      const parent = beginSceneMutation('terre-snippet');
      const oldFetch = deferred<string>();
      const newFetch = deferred<string>();
      vi.mocked(sceneFetcher).mockImplementation((url) => (url === 'old.txt' ? oldFetch.promise : newFetch.promise));
      const old = withSceneMutationContext(parent, () => changeScene('old.txt', 'old'))!;
      await Promise.resolve();
      const latest = withSceneMutationContext(parent, () => changeScene('new.txt', 'new'))!;
      await Promise.resolve();
      if (order === 'old-first') {
        oldFetch.resolve('old');
        expect(await old).toBe(false);
        expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
        newFetch.resolve('new');
        expect(await latest).toBe(true);
      } else {
        newFetch.resolve('new');
        expect(await latest).toBe(true);
        oldFetch.resolve('old');
        expect(await old).toBe(false);
      }
      expect(isSceneMutationCurrent(parent)).toBe(true);
      expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('new');
      expect(sceneParser).toHaveBeenCalledOnce();
      expect(continueSentence).toHaveBeenCalledOnce();
    },
  );

  it('a snippet call superseded by a same-token change cannot push its old caller', async () => {
    const parent = beginSceneMutation('terre-snippet');
    const oldFetch = deferred<string>();
    vi.mocked(sceneFetcher).mockImplementation((url) =>
      url === 'old.txt' ? oldFetch.promise : Promise.resolve('new'),
    );
    const old = withSceneMutationContext(parent, () => callScene('old.txt', 'old'))!;
    await Promise.resolve();
    expect(await withSceneMutationContext(parent, () => changeScene('new.txt', 'new'))).toBe(true);
    oldFetch.resolve('old');
    expect(await old).toBe(false);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toHaveLength(0);
    expect(sceneParser).toHaveBeenCalledOnce();
  });

  it('a same-token change supersedes a pending return without popping its parent', async () => {
    const parent = beginSceneMutation('terre-snippet');
    const entry = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 3 };
    WebGAL.sceneManager.sceneData.sceneStack.push(entry);
    const oldFetch = deferred<string>();
    vi.mocked(sceneFetcher).mockImplementation((url) =>
      url === entry.sceneUrl ? oldFetch.promise : Promise.resolve('new'),
    );
    const old = withSceneMutationContext(parent, () => restoreScene(entry))!;
    await Promise.resolve();
    expect(await withSceneMutationContext(parent, () => changeScene('new.txt', 'new'))).toBe(true);
    oldFetch.resolve('old');
    expect(await old).toBe(false);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([entry]);
    expect(sceneParser).toHaveBeenCalledOnce();
  });

  it('same-token postcommit replacement prevents old continuation and preserves its newer write lock', async () => {
    const parent = beginSceneMutation('terre-snippet');
    const newFetch = deferred<string>();
    vi.mocked(sceneFetcher).mockImplementation((url) =>
      url === 'new.txt' ? newFetch.promise : Promise.resolve('old'),
    );
    let latest: Promise<boolean> | undefined;
    vi.mocked(WebGAL.flowchartManager.waitForCurrentSceneDialog).mockImplementationOnce(() => {
      latest = withSceneMutationContext(parent, () => changeScene('new.txt', 'new'));
    });
    expect(await withSceneMutationContext(parent, () => changeScene('old.txt', 'old'))).toBe(false);
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    expect(continueSentence).not.toHaveBeenCalled();
    newFetch.resolve('new');
    expect(await latest).toBe(true);
    expect(continueSentence).toHaveBeenCalledOnce();
  });

  it.each(['old-first', 'new-first'])('call then change handles unabortable transport: %s', async (order) => {
    const oldFetch = deferred<string>();
    const newFetch = deferred<string>();
    vi.mocked(sceneFetcher).mockImplementation((url) => (url === 'child.txt' ? oldFetch.promise : newFetch.promise));
    const old = callScene('child.txt', 'child');
    await Promise.resolve();
    const oldSignal = vi.mocked(sceneFetcher).mock.calls[0][1]?.signal;
    const latest = changeScene('latest.txt', 'latest');
    await Promise.resolve();
    expect(oldSignal?.aborted).toBe(true);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([]);
    const latestWait = WebGAL.sceneManager.sceneWritePromise;
    if (order === 'old-first') {
      oldFetch.resolve('old');
      expect(await old).toBe(false);
      expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
      expect(WebGAL.sceneManager.sceneWritePromise).toBe(latestWait);
      newFetch.resolve('new');
      expect(await latest).toBe(true);
    } else {
      newFetch.resolve('new');
      expect(await latest).toBe(true);
      oldFetch.resolve('old');
      expect(await old).toBe(false);
    }
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('latest');
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([]);
    expect(sceneParser).toHaveBeenCalledTimes(1);
    expect(continueSentence).toHaveBeenCalledTimes(1);
    expect(WebGAL.sceneManager.settledScenes).toEqual(new Set(['latest.txt']));
  });

  it.each(['load-game', 'backlog', 'start-game', 'terre-sync', 'end-game'] as const)(
    'a pending call cannot publish over a later %s entry',
    async (source) => {
      const fetch = deferred<string>();
      vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
      const old = callScene('child.txt', 'child');
      await Promise.resolve();
      const latest = beginSceneMutation(source);
      commitSceneMutation(latest, () => {
        WebGAL.sceneManager.sceneData.currentScene = makeScene(source);
      });
      fetch.resolve('late');
      expect(await old).toBe(false);
      expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe(source);
      expect(sceneParser).not.toHaveBeenCalled();
      expect(continueSentence).not.toHaveBeenCalled();
    },
  );

  it.each(['fetch', 'parse'])('failed call keeps the caller and entire return stack (%s)', async (failure) => {
    const existing = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 3 };
    WebGAL.sceneManager.sceneData.sceneStack.push(existing);
    const caller = WebGAL.sceneManager.sceneData.currentScene;
    if (failure === 'fetch') vi.mocked(sceneFetcher).mockRejectedValue(new Error('failure'));
    else
      vi.mocked(sceneParser).mockImplementation(() => {
        throw new Error('failure');
      });
    expect(await callScene('child.txt', 'child')).toBe(false);
    expect(WebGAL.sceneManager.sceneData.currentScene).toBe(caller);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([existing]);
    expect(continueSentence).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(false);
  });

  it('successful call records the request-time caller line only at commit', async () => {
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
    const task = callScene('child.txt', 'child');
    WebGAL.sceneManager.sceneData.currentSentenceId++;
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([]);
    fetch.resolve('child');
    expect(await task).toBe(true);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([
      { sceneName: 'original', sceneUrl: 'original.txt', continueLine: 7, locals: {}, writeReturnTo: undefined },
    ]);
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(0);
    expect(WebGAL.flowchartManager.waitForCurrentSceneDialog).toHaveBeenCalledTimes(1);
  });

  it.each(['fetch', 'parse'])('failed return never removes the exact top entry (%s)', async (failure) => {
    const entry = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 3 };
    WebGAL.sceneManager.sceneData.sceneStack.push(entry);
    if (failure === 'fetch') vi.mocked(sceneFetcher).mockRejectedValue(new Error('failure'));
    else
      vi.mocked(sceneParser).mockImplementation(() => {
        throw new Error('failure');
      });
    expect(await restoreScene(entry)).toBe(false);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([entry]);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('original');
  });

  it('successful return pops only the exact still-owned top entry', async () => {
    const entry = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 3 };
    WebGAL.sceneManager.sceneData.sceneStack.push(entry);
    expect(await restoreScene(entry)).toBe(true);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([]);
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(4);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('parent');
  });

  it('return rejects a copied or replaced top entry without popping another owner', async () => {
    const entry = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 3 };
    WebGAL.sceneManager.sceneData.sceneStack.push(entry);
    expect(await restoreScene({ ...entry })).toBe(false);
    expect(sceneFetcher).not.toHaveBeenCalled();
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
    const task = restoreScene(entry);
    await Promise.resolve();
    WebGAL.sceneManager.sceneData.sceneStack[0] = { ...entry };
    fetch.resolve('text');
    expect(await task).toBe(false);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toHaveLength(1);
    expect(sceneParser).not.toHaveBeenCalled();
  });

  it('restore followed by change cannot pop the previous parent', async () => {
    const entry = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 3 };
    WebGAL.sceneManager.sceneData.sceneStack.push(entry);
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockImplementation((url) =>
      url === entry.sceneUrl ? fetch.promise : Promise.resolve('new'),
    );
    const old = restoreScene(entry);
    await Promise.resolve();
    expect(await changeScene('new.txt', 'new')).toBe(true);
    fetch.resolve('old');
    expect(await old).toBe(false);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([entry]);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('new');
  });

  it('parser reentrancy is checked again before any scene or stack commit', async () => {
    vi.mocked(sceneParser).mockImplementation((_raw, name, url) => {
      beginSceneMutation('load-game');
      return makeScene(name, url);
    });
    expect(await callScene('child.txt', 'child')).toBe(false);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('original');
    expect(WebGAL.sceneManager.sceneData.sceneStack).toEqual([]);
    expect(clearPrefetchLinks).not.toHaveBeenCalled();
  });

  it('postcommit reentrancy preserves the newer lock and prevents old autoNext', async () => {
    const latestWork = deferred<boolean>();
    let latestTask: Promise<boolean> | undefined;
    vi.mocked(clearPrefetchLinks).mockImplementation(() => {
      latestTask = WebGAL.sceneManager.trackSceneWrite(beginSceneMutation('load-game'), latestWork.promise);
    });
    expect(await changeScene('child.txt', 'child')).toBe(false);
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    expect(WebGAL.flowchartManager.waitForCurrentSceneDialog).not.toHaveBeenCalled();
    expect(continueSentence).not.toHaveBeenCalled();
    latestWork.resolve(true);
    await latestTask;
  });

  it('silences stale transport failure and keeps a fresh lock', async () => {
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
    const old = changeScene('old.txt', 'old');
    await Promise.resolve();
    const currentWork = deferred<boolean>();
    const current = WebGAL.sceneManager.trackSceneWrite(beginSceneMutation('backlog'), currentWork.promise);
    fetch.reject(new Error('aborted old transport'));
    expect(await old).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    currentWork.resolve(true);
    await current;
  });

  it('sequential fast-preview call, return, and change retain parent authority without autoNext', async () => {
    const parent = beginSceneMutation('terre-sync');
    WebGAL.gameplay.isFastPreview = true;
    expect(await withSceneMutationContext(parent, () => callScene('child.txt', 'child'))).toBe(true);
    expect(isSceneMutationCurrent(parent)).toBe(true);
    const entry = WebGAL.sceneManager.sceneData.sceneStack[0];
    expect(await withSceneMutationContext(parent, () => restoreScene(entry))).toBe(true);
    expect(isSceneMutationCurrent(parent)).toBe(true);
    expect(await withSceneMutationContext(parent, () => changeScene('last.txt', 'last'))).toBe(true);
    expect(isSceneMutationCurrent(parent)).toBe(true);
    expect(continueSentence).not.toHaveBeenCalled();
  });

  it('a superseded callback inside preview scope cannot resurrect a child scene request', async () => {
    const parent = beginSceneMutation('terre-sync');
    let later = parent;
    const old = withSceneMutationContext(parent, () => {
      later = beginSceneMutation('load-game');
      return changeScene('obsolete.txt', 'obsolete');
    });
    expect(await old).toBe(false);
    expect(isSceneMutationCurrent(later)).toBe(true);
    expect(sceneFetcher).not.toHaveBeenCalled();
  });
});
