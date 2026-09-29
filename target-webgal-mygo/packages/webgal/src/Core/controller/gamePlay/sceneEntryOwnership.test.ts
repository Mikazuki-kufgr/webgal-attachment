import cloneDeep from 'lodash/cloneDeep';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initState, stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { SceneManager } from '@/Core/Modules/scene';
import {
  beginSceneMutation,
  commitSceneMutation,
  inheritSceneMutationToken,
  isSceneMutationCurrent,
} from '@/Core/controller/scene/sceneMutationEpoch';
import type { ISaveData } from '@/store/userDataInterface';
import type { ISentence } from '@/Core/controller/scene/sceneInterface';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    gameName: 'fixture',
    gameKey: 'fixture',
    sceneManager: undefined,
    backlogManager: { makeBacklogEmpty: vi.fn() },
    flowchartManager: { waitForCurrentSceneDialog: vi.fn() },
    gameplay: {
      isFastPreview: false,
      pixiStage: { removeAllAnimations: vi.fn() },
      resetGamePlay: vi.fn(),
      performController: {
        removeAllPerform: vi.fn(),
        discardUncommittedNonHoldPerforms: vi.fn(),
        clearNonHoldPerformsFromStageState: vi.fn(),
        hasPendingBlockingStateCalculationPerform: vi.fn(() => false),
        capturePendingStateCalculationBarrier: vi.fn(),
      },
    },
  },
}));
vi.mock('@/store/store', () => {
  const state = { GUI: { showTitle: true, titleBgm: 'title.ogg' }, saveData: { quickSaveData: null }, userData: {} };
  return {
    webgalStore: {
      getState: () => state,
      dispatch: vi.fn((action) => {
        if (action.type === 'fixture/visibility')
          (state.GUI as Record<string, unknown>)[action.payload.component] = action.payload.visibility;
        return action;
      }),
    },
  };
});
vi.mock('@/store/GUIReducer', () => ({
  setVisibility: (payload: unknown) => ({ type: 'fixture/visibility', payload }),
}));
vi.mock('@/Core/controller/scene/sceneFetcher', () => ({ sceneFetcher: vi.fn() }));
vi.mock('@/Core/parser/sceneParser', () => ({ sceneParser: vi.fn() }));
vi.mock('@/Core/util/gameAssetsAccess/assetSetter', () => ({
  fileType: { scene: 0 },
  assetSetter: (name: string) => `game/scene/${name}`,
}));
vi.mock('@/Core/controller/gamePlay/nextSentence', () => ({
  continueSentence: vi.fn(),
  forward: vi.fn(),
  commitForward: vi.fn(),
}));
vi.mock('@/Core/controller/gamePlay/fastSkip', () => ({ stopFast: vi.fn() }));
vi.mock('@/Core/gameScripts/changeBg/setEbg', () => ({ setEbg: vi.fn() }));
vi.mock('@/Core/controller/stage/playBgm', () => ({ playBgm: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ disposeAttachmentStageBridge: vi.fn() }));
vi.mock('@/Core/controller/storage/savesController', () => ({
  dumpFastSaveToStorage: vi.fn(async () => {}),
  getFastSaveFromStorage: vi.fn(),
}));
vi.mock('@/Core/controller/storage/storageController', () => ({ dumpToStorageFast: vi.fn(async () => {}) }));
vi.mock('@/Core/controller/storage/loadGame', () => ({ loadGameFromStageData: vi.fn() }));
vi.mock('@/Core/controller/storage/saveGame', () => ({ generateCurrentStageData: vi.fn() }));
vi.mock('@/Core/util/syncWithEditor/runtime/previewDebugVariables', () => ({ applyPreviewDebugVariables: vi.fn() }));
vi.mock('@/Core/util/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { WebGAL } = await import('@/Core/WebGAL');
const { webgalStore } = await import('@/store/store');
const { sceneFetcher } = await import('@/Core/controller/scene/sceneFetcher');
const { sceneParser } = await import('@/Core/parser/sceneParser');
const { continueSentence, forward, commitForward } = await import('@/Core/controller/gamePlay/nextSentence');
const { getFastSaveFromStorage } = await import('@/Core/controller/storage/savesController');
const { loadGameFromStageData } = await import('@/Core/controller/storage/loadGame');
const { loadFastSaveGame } = await import('@/Core/controller/storage/fastSaveLoad');
const { startGame, continueGame } = await import('./startContinueGame');
const { end } = await import('@/Core/gameScripts/end');
const { resetStage } = await import('@/Core/controller/stage/resetStage');
const { stopFast } = await import('@/Core/controller/gamePlay/fastSkip');
const { setEbg } = await import('@/Core/gameScripts/changeBg/setEbg');
const { disposeAttachmentStageBridge } = await import('@/Core/controller/stage/pixi/syncPixiStageState');
const { executePreviewSyncSceneCommand, runFastPreview } = await import(
  '@/Core/util/syncWithEditor/runtime/previewSyncSceneCommand'
);
const { logger } = await import('@/Core/util/logger');

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function parsed(name: string) {
  return { sceneName: name, sceneUrl: `${name}.txt`, sentenceList: [], assetsList: [], subSceneList: [] };
}
async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
const save: ISaveData = {
  index: -1,
  saveTime: '',
  previewImage: '',
  nowStageState: cloneDeep(initState),
  backlog: [],
  sceneData: { sceneName: 'saved', sceneUrl: 'saved.txt', currentSentenceId: 2, sceneStack: [] },
};
const endSentence = {
  command: 11,
  commandRaw: 'end',
  content: '',
  args: [],
  inlineComment: '',
  isLineBreakHolder: false,
  sentenceAssets: [],
  subScene: [],
} as ISentence;
const previousDocument = globalThis.document;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  beginSceneMutation('stage-reset');
  WebGAL.sceneManager = new SceneManager();
  WebGAL.sceneManager.sceneData.currentScene = parsed('old');
  WebGAL.sceneManager.sceneData.currentSentenceId = 5;
  WebGAL.gameplay.isFastPreview = false;
  vi.mocked(WebGAL.gameplay.performController.removeAllPerform).mockImplementation(() => {});
  vi.mocked(WebGAL.flowchartManager.waitForCurrentSceneDialog).mockImplementation(() => {});
  vi.mocked(stopFast).mockReset();
  vi.mocked(setEbg).mockReset();
  vi.mocked(WebGAL.gameplay.performController.hasPendingBlockingStateCalculationPerform).mockReturnValue(false);
  vi.mocked(WebGAL.gameplay.performController.capturePendingStateCalculationBarrier).mockReset();
  vi.mocked(forward).mockImplementation(() => {
    WebGAL.sceneManager.sceneData.currentSentenceId++;
    return true;
  });
  vi.mocked(sceneFetcher).mockReset();
  vi.mocked(sceneParser).mockImplementation((raw) => parsed(raw));
  vi.mocked(getFastSaveFromStorage).mockReset();
  vi.mocked(loadGameFromStageData).mockResolvedValue(true);
  webgalStore.getState().GUI.showTitle = true;
  stageStateManager.setCommitHandler(null);
  stageStateManager.replaceAllStageState({ ...cloneDeep(initState), figName: 'old-model', GameVar: { old: 1 } });
  (globalThis as unknown as { document: unknown }).document = { querySelector: () => null };
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  (globalThis as unknown as { document: unknown }).document = previousDocument;
});

describe('shared epoch across actual start/continue/end/reset entrypoints', () => {
  it('start does not destroy the current stage or hide title before fetch succeeds', async () => {
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
    vi.mocked(sceneParser).mockImplementation((raw) => {
      expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
      return parsed(raw);
    });
    vi.mocked(WebGAL.flowchartManager.waitForCurrentSceneDialog).mockImplementation(() => {
      expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    });
    const result = startGame();
    expect(stageStateManager.getViewStageState().figName).toBe('old-model');
    expect(webgalStore.getState().GUI.showTitle).toBe(true);
    expect(WebGAL.gameplay.performController.removeAllPerform).not.toHaveBeenCalled();
    fetch.resolve('new-start');
    expect(await result).toBe(true);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('new-start');
    expect(continueSentence).toHaveBeenCalledTimes(1);
    expect(webgalStore.getState().GUI.showTitle).toBe(false);
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(false);
  });

  it('start failure preserves stage/scene/title and observes the rejection', async () => {
    vi.mocked(sceneFetcher).mockRejectedValue(new Error('offline'));
    expect(await startGame()).toBe(false);
    expect(stageStateManager.getViewStageState().figName).toBe('old-model');
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('old');
    expect(webgalStore.getState().GUI.showTitle).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([true, false])('repeated starts only publish the newest request, old-first=%s', async (oldFirst) => {
    const a = deferred<string>(),
      b = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = startGame(),
      second = startGame();
    if (oldFirst) {
      a.resolve('a');
      await flush();
      b.resolve('b');
    } else {
      b.resolve('b');
      await flush();
      a.resolve('a');
    }
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(sceneParser).toHaveBeenCalledTimes(1);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('b');
  });

  it('continue lookup superseded by start cannot begin a fresh fast-load epoch', async () => {
    const read = deferred<ISaveData | null>();
    vi.mocked(getFastSaveFromStorage).mockReturnValue(read.promise);
    const continuing = continueGame();
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    vi.mocked(sceneFetcher).mockResolvedValue('new-start');
    expect(await startGame()).toBe(true);
    read.resolve(save);
    expect(await continuing).toBe(false);
    expect(getFastSaveFromStorage).toHaveBeenCalledTimes(1);
    expect(loadGameFromStageData).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('new-start');
  });

  it('quick-load owns its read before await and does not load after newer mutation', async () => {
    const read = deferred<ISaveData | null>();
    vi.mocked(getFastSaveFromStorage).mockReturnValue(read.promise);
    const loading = loadFastSaveGame();
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    const latest = beginSceneMutation('backlog');
    read.resolve(save);
    expect(await loading).toBe(false);
    expect(loadGameFromStageData).not.toHaveBeenCalled();
    expect(isSceneMutationCurrent(latest)).toBe(true);
  });

  it('continue passes one epoch through both reads and returns the real restore failure', async () => {
    vi.mocked(getFastSaveFromStorage).mockResolvedValue(save);
    vi.mocked(loadGameFromStageData).mockResolvedValue(false);
    expect(await continueGame()).toBe(false);
    expect(getFastSaveFromStorage).toHaveBeenCalledTimes(2);
    const mutation = vi.mocked(loadGameFromStageData).mock.calls[0][1]!;
    expect(mutation.source).toBe('continue-game');
    expect(isSceneMutationCurrent(mutation)).toBe(true);
    expect(webgalStore.getState().GUI.showTitle).toBe(true);
  });

  it('end background fetch and 5ms reset cannot clobber a newer load', async () => {
    const fetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(fetch.promise);
    end(endSentence);
    const latest = beginSceneMutation('load-game');
    commitSceneMutation(latest, () => {
      WebGAL.sceneManager.sceneData.currentScene = parsed('loaded');
      WebGAL.sceneManager.sceneData.currentSentenceId = 12;
    });
    await vi.advanceTimersByTimeAsync(6);
    fetch.resolve('stale-end-start');
    await flush();
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('loaded');
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(12);
    expect(sceneParser).not.toHaveBeenCalled();
  });

  it('end timer no longer erases an already fetched start scene', async () => {
    vi.mocked(sceneFetcher).mockResolvedValue('fresh-start');
    end(endSentence);
    await flush();
    await vi.advanceTimersByTimeAsync(6);
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('fresh-start');
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(0);
  });

  it('parent-owned reset preserves its token and game variables with one view publication', () => {
    const token = beginSceneMutation('load-game'),
      observer = vi.fn();
    const unsubscribe = stageStateManager.subscribe(observer);
    expect(resetStage(false, false, { mutation: token })).toBe(true);
    expect(isSceneMutationCurrent(token)).toBe(true);
    expect(stageStateManager.getViewStageState().GameVar).toEqual({ old: 1 });
    expect(observer).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(disposeAttachmentStageBridge).toHaveBeenCalledTimes(1);
  });

  it('stale reset has no teardown side effects', () => {
    const stale = beginSceneMutation('load-game');
    beginSceneMutation('start-game');
    expect(resetStage(true, true, { mutation: stale })).toBe(false);
    expect(WebGAL.gameplay.performController.removeAllPerform).not.toHaveBeenCalled();
    expect(disposeAttachmentStageBridge).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().figName).toBe('old-model');
  });

  it('reset stops after a teardown callback creates a newer owner', () => {
    const token = beginSceneMutation('load-game');
    vi.mocked(WebGAL.gameplay.performController.removeAllPerform).mockImplementation(() => {
      beginSceneMutation('start-game');
      stageStateManager.replaceAllStageState({ ...cloneDeep(initState), figName: 'replacement' });
    });
    expect(resetStage(true, true, { mutation: token })).toBe(false);
    expect(disposeAttachmentStageBridge).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().figName).toBe('replacement');
  });

  it('reset does not remove performs created by a reentrant stopFast callback', () => {
    const token = beginSceneMutation('load-game');
    vi.mocked(stopFast).mockImplementation(() => {
      beginSceneMutation('start-game');
    });
    expect(resetStage(true, true, { mutation: token })).toBe(false);
    expect(WebGAL.gameplay.performController.removeAllPerform).not.toHaveBeenCalled();
    expect(disposeAttachmentStageBridge).not.toHaveBeenCalled();
  });

  it('start stops before title/continuation after a reentrant flowchart callback', async () => {
    vi.mocked(sceneFetcher).mockResolvedValue('start');
    vi.mocked(WebGAL.flowchartManager.waitForCurrentSceneDialog).mockImplementation(() => {
      beginSceneMutation('load-game');
    });
    expect(await startGame()).toBe(false);
    expect(webgalStore.getState().GUI.showTitle).toBe(true);
    expect(continueSentence).not.toHaveBeenCalled();
  });

  it('continue cannot hide the title after its background callback is superseded', async () => {
    vi.mocked(getFastSaveFromStorage).mockResolvedValue(save);
    vi.mocked(setEbg).mockImplementation(() => {
      beginSceneMutation('load-game');
    });
    expect(await continueGame()).toBe(false);
    expect(webgalStore.getState().GUI.showTitle).toBe(true);
  });
});

describe('native fast-preview revision + shared scene epoch', () => {
  it('settles repeated execute-to-here requests for the same target as two clean reconstructions', async () => {
    vi.mocked(sceneFetcher).mockResolvedValue('editor-source');
    vi.mocked(commitForward).mockImplementation(() => stageStateManager.commit());
    const tiltedFigureEffect = {
      target: 'creator-current-preview',
      transform: { rotation: 0.3, skew: { x: 0.08, y: -0.05 } },
    };
    stageStateManager.replaceAllStageState({
      ...cloneDeep(initState),
      effects: [...cloneDeep(initState.effects), tiltedFigureEffect],
    });
    const execute = () =>
      new Promise<unknown>((resolve) => {
        executePreviewSyncSceneCommand(
          { sceneName: 'editor.txt', sentenceId: 2 },
          { onSettled: (result) => resolve(result) },
        );
      });

    await expect(execute()).resolves.toMatchObject({ sentenceId: 2, stopReason: 'target-reached' });
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(2);
    expect(commitForward).toHaveBeenCalledTimes(1);
    expect(stageStateManager.getViewStageState().effects).not.toContainEqual(tiltedFigureEffect);

    stageStateManager.replaceAllStageState({
      ...stageStateManager.getViewStageState(),
      effects: [...stageStateManager.getViewStageState().effects, tiltedFigureEffect],
    });

    await expect(execute()).resolves.toMatchObject({ sentenceId: 2, stopReason: 'target-reached' });
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(2);
    expect(commitForward).toHaveBeenCalledTimes(2);
    expect(stageStateManager.getViewStageState().effects).not.toContainEqual(tiltedFigureEffect);
    expect(WebGAL.gameplay.performController.removeAllPerform).toHaveBeenCalledTimes(2);
    expect(WebGAL.gameplay.isFastPreview).toBe(false);
  });

  it('lets a newer execute-to-here request supersede an older unresolved request to the same scene', async () => {
    const firstFetch = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValueOnce(firstFetch.promise).mockResolvedValueOnce('newer-editor-source');
    const firstSettled = vi.fn();
    const secondSettled = vi.fn();

    executePreviewSyncSceneCommand({ sceneName: 'editor.txt', sentenceId: 3 }, { onSettled: firstSettled });
    executePreviewSyncSceneCommand({ sceneName: 'editor.txt', sentenceId: 1 }, { onSettled: secondSettled });
    await flush();

    expect(secondSettled).toHaveBeenCalledWith(
      expect.objectContaining({ sentenceId: 1, stopReason: 'target-reached' }),
    );
    firstFetch.resolve('older-editor-source');
    await flush();

    expect(firstSettled).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('newer-editor-source');
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(1);
    expect(commitForward).toHaveBeenCalledTimes(1);
  });

  it('older editor scene fetch never resets a newer start or even invokes parser', async () => {
    const preview = deferred<string>(),
      start = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValueOnce(preview.promise).mockReturnValueOnce(start.promise);
    const onSettled = vi.fn();
    executePreviewSyncSceneCommand({ sceneName: 'editor.txt', sentenceId: 0 }, { onSettled });
    const playing = startGame();
    start.resolve('started');
    await playing;
    preview.resolve('stale-editor');
    await flush();
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('started');
    expect(sceneParser).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('failed editor fetch leaves title and old stage intact', async () => {
    vi.mocked(sceneFetcher).mockRejectedValue(new Error('preview offline'));
    const onSettled = vi.fn();
    executePreviewSyncSceneCommand({ sceneName: 'editor.txt', sentenceId: 3 }, { onSettled });
    await flush();
    expect(stageStateManager.getViewStageState().figName).toBe('old-model');
    expect(webgalStore.getState().GUI.showTitle).toBe(true);
    expect(onSettled).toHaveBeenCalledWith(null);
  });

  it('each fast-preview forward inherits the same epoch across awaited scene writes', async () => {
    const token = beginSceneMutation('terre-sync'),
      pending = deferred<void>();
    WebGAL.sceneManager.sceneData.currentScene = parsed('editor');
    WebGAL.sceneManager.sceneData.currentSentenceId = 0;
    const observed: unknown[] = [];
    vi.mocked(forward).mockImplementation(() => {
      observed.push(inheritSceneMutationToken());
      WebGAL.sceneManager.sceneData.currentSentenceId++;
      if (observed.length === 1) WebGAL.sceneManager.trackSceneWrite(token, pending.promise);
      return true;
    });
    const preview = runFastPreview(2, 'editor', undefined, 'normal', { mutation: token });
    await flush();
    expect(observed).toEqual([token]);
    pending.resolve();
    expect((await preview)?.stopReason).toBe('target-reached');
    expect(observed).toEqual([token, token]);
    expect(isSceneMutationCurrent(token)).toBe(true);
    expect(commitForward).toHaveBeenCalledTimes(1);
  });

  it('stale fast-preview completion cannot commit or clear a newer preview flag', async () => {
    const token = beginSceneMutation('terre-sync'),
      pending = deferred<void>();
    WebGAL.sceneManager.sceneData.currentScene = parsed('editor');
    WebGAL.sceneManager.sceneData.currentSentenceId = 0;
    vi.mocked(forward).mockImplementation(() => {
      WebGAL.sceneManager.sceneData.currentSentenceId++;
      WebGAL.sceneManager.trackSceneWrite(token, pending.promise);
      return true;
    });
    const preview = runFastPreview(2, 'editor', undefined, 'immediate', { mutation: token });
    await flush();
    beginSceneMutation('terre-temp');
    WebGAL.gameplay.isFastPreview = true;
    pending.resolve();
    expect(await preview).toBe(null);
    expect(commitForward).not.toHaveBeenCalled();
    expect(WebGAL.gameplay.isFastPreview).toBe(true);
  });

  it.each([
    ['failed', 'state-calculation-failed'],
    ['cancelled', 'state-calculation-cancelled'],
  ] as const)('reports a %s Runtime barrier without advancing to the selected target', async (outcome, stopReason) => {
    const token = beginSceneMutation('terre-sync');
    WebGAL.sceneManager.sceneData.currentScene = parsed('editor');
    WebGAL.sceneManager.sceneData.currentSentenceId = 0;
    vi.mocked(WebGAL.gameplay.performController.hasPendingBlockingStateCalculationPerform).mockReturnValueOnce(true);
    vi.mocked(WebGAL.gameplay.performController.capturePendingStateCalculationBarrier).mockReturnValueOnce({
      wait: vi.fn(async () => outcome),
    });

    await expect(runFastPreview(2, 'editor', undefined, 'normal', { mutation: token })).resolves.toMatchObject({
      sceneName: 'editor',
      sentenceId: 1,
      stopReason,
    });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(commitForward).toHaveBeenCalledTimes(1);
  });

  it('aborts an exact Runtime barrier waiter when a newer scene mutation supersedes the request', async () => {
    const token = beginSceneMutation('terre-sync');
    const barrier = deferred<'completed'>();
    WebGAL.sceneManager.sceneData.currentScene = parsed('editor');
    WebGAL.sceneManager.sceneData.currentSentenceId = 0;
    vi.mocked(WebGAL.gameplay.performController.hasPendingBlockingStateCalculationPerform).mockReturnValueOnce(true);
    vi.mocked(WebGAL.gameplay.performController.capturePendingStateCalculationBarrier).mockReturnValueOnce({
      wait: vi.fn(() => barrier.promise),
    });

    const preview = runFastPreview(2, 'editor', undefined, 'normal', { mutation: token });
    await flush();
    expect(forward).toHaveBeenCalledTimes(1);
    expect(commitForward).toHaveBeenCalledTimes(1);

    beginSceneMutation('terre-sync');
    barrier.resolve('completed');

    await expect(preview).resolves.toBeNull();
    expect(forward).toHaveBeenCalledTimes(1);
    expect(commitForward).toHaveBeenCalledTimes(1);
  });
});
