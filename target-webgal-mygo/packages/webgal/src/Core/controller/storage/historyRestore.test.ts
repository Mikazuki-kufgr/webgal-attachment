import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import type { ISaveData } from '@/store/userDataInterface';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import { ATTACHMENT_COMMAND_ABI, LEGACY_HOTFIX37_COMMAND_ABI, resolveSerializedCommandType } from 'webgal-parser';
vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    sceneManager: undefined,
    backlogManager: undefined,
    gameplay: {
      performController: undefined,
      pixiStage: { removeAllAnimations: vi.fn(), requestRender: vi.fn() },
      resetGamePlay: vi.fn(),
    },
  },
}));
vi.mock('@/Core/parser/sceneParser', () => ({
  sceneParser: vi.fn((raw, sceneName, sceneUrl) => ({
    sceneName,
    sceneUrl,
    sentenceList: [],
    assetsList: [],
    subSceneList: [],
    raw,
  })),
}));
vi.mock('@/Core/controller/scene/sceneFetcher', () => ({ sceneFetcher: vi.fn() }));
vi.mock('@/Core/controller/gamePlay/runScript', () => ({ runScript: vi.fn() }));
vi.mock('@/Core/controller/gamePlay/nextSentence', () => ({ continueSentence: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ disposeAttachmentStageBridge: vi.fn() }));
vi.mock('@/Core/gameScripts/changeBg/setEbg', () => ({ setEbg: vi.fn() }));
vi.mock('@/store/store', () => ({
  webgalStore: { dispatch: vi.fn(), getState: () => ({ saveData: { saveData: [] } }) },
}));
const { WebGAL } = await import('@/Core/WebGAL');
const { SceneManager } = await import('@/Core/Modules/scene');
const { BacklogManager } = await import('@/Core/Modules/backlog');
const { PerformController } = await import('@/Core/Modules/perform/performController');
const { stageStateManager, initState } = await import('@/Core/Modules/stage/stageStateManager');
const { sceneFetcher } = await import('@/Core/controller/scene/sceneFetcher');
const { sceneParser } = await import('@/Core/parser/sceneParser');
const { loadGameFromStageData } = await import('./loadGame');
const { jumpFromBacklog } = await import('./jumpFromBacklog');
const { generateCurrentStageData } = await import('./saveGame');
const { prepareHistoryRestore } = await import('./historyStateCore');

describe('MyGO 321 scene locals storage', () => {
  it('restores current locals and caller locals with detached copies', async () => {
    const input = save('locals');
    input.sceneData.currentLocals = { child: [1, 'two', true] };
    input.sceneData.sceneStack = [{ sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 2, locals: { caller: 7 }, writeReturnTo: 'result' }];
    expect(await loadGameFromStageData(input)).toBe(true);
    expect(WebGAL.sceneManager.sceneData.currentLocals).toEqual({ child: [1, 'two', true] });
    expect(WebGAL.sceneManager.sceneData.currentLocals).not.toBe(input.sceneData.currentLocals);
    expect(WebGAL.sceneManager.sceneData.sceneStack[0].writeReturnTo).toBe('result');
    expect(WebGAL.sceneManager.sceneData.sceneStack[0].locals).toEqual({ caller: 7 });
  });
  it('rejects malformed locals before a scene fetch or runtime reset', async () => {
    const input = save('bad-locals');
    Object.assign(input.sceneData, { currentLocals: { nested: {} } });
    expect(await loadGameFromStageData(input)).toBe(false);
    expect(sceneFetcher).not.toHaveBeenCalled();
  });
});
const { runScript } = await import('@/Core/controller/gamePlay/runScript');
const { webgalStore } = await import('@/store/store');
const { disposeAttachmentStageBridge } = await import('@/Core/controller/stage/pixi/syncPixiStageState');
const { beginSceneMutation } = await import('@/Core/controller/scene/sceneMutationEpoch');
const { loadFlowchartSnapshot } = await import('./loadFlowchartSnapshot');
const { FlowchartManager } = await import('@/Core/Modules/flowchart');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function sentence(command: commandType = commandType.say): ISentence {
  return { command, commandRaw: '', content: 'saved', args: [], sentenceAssets: [], subScene: [], inlineComment: '', isLineBreakHolder: false };
}
function save(name: string): ISaveData {
  return {
    commandAbi: ATTACHMENT_COMMAND_ABI,
    nowStageState: { ...cloneDeep(initState), showText: name, figName: name + '.json' },
    backlog: [],
    sceneData: {
      currentSentenceId: 4,
      sceneStack: [{ sceneName: 'parent', sceneUrl: '/parent.txt', continueLine: 3 }],
      sceneName: name,
      sceneUrl: '/' + name + '.txt',
    },
    index: 1,
    saveTime: '',
    previewImage: '',
  };
}
function backlog(saved: ISaveData) {
  return {
    commandAbi: saved.commandAbi,
    currentStageState: cloneDeep(saved.nowStageState),
    saveScene: cloneDeep(saved.sceneData),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  beginSceneMutation('initialize');
  WebGAL.sceneManager = new SceneManager();
  WebGAL.backlogManager = new BacklogManager(WebGAL.sceneManager);
  WebGAL.flowchartManager = new FlowchartManager(WebGAL.sceneManager);
  WebGAL.gameplay.performController = new PerformController();
  stageStateManager.setCommitHandler(null);
  stageStateManager.resetAllStageState({ ...cloneDeep(initState), showText: 'original' });
  WebGAL.sceneManager.sceneData.currentScene = {
    sceneName: 'original',
    sceneUrl: '/original.txt',
    sentenceList: [],
    assetsList: [],
    subSceneList: [],
  };
  WebGAL.sceneManager.sceneData.currentSentenceId = 2;
  vi.mocked(sceneFetcher).mockResolvedValue('raw');
  vi.mocked(runScript).mockImplementation(() => {});
});
afterEach(() => {
  WebGAL.gameplay.performController.removeAllPerform();
  stageStateManager.setCommitHandler(null);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('actual history entrypoints / state managers / perform ownership', () => {
  it('does not publish stage, pointer, backlog, stop or GUI before fetch succeeds', async () => {
    const pending = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValue(pending.promise);
    const stop = vi.spyOn(WebGAL.gameplay.performController, 'removeAllPerform');
    const current = stageStateManager.getViewStageState();
    const task = loadGameFromStageData(save('A'));
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    expect(stageStateManager.getViewStageState()).toBe(current);
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(2);
    expect(stop).not.toHaveBeenCalled();
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
    pending.resolve('A raw');
    expect(await task).toBe(true);
    expect(stageStateManager.getViewStageState().showText).toBe('A');
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('A');
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(4);
    expect(stop).toHaveBeenCalledOnce();
    expect(disposeAttachmentStageBridge).toHaveBeenCalledOnce();
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(false);
  });
  it('failed fetch preserves previous scene, stage and live performers', async () => {
    const old = stageStateManager.getViewStageState();
    const stop = vi.spyOn(WebGAL.gameplay.performController, 'removeAllPerform');
    vi.mocked(sceneFetcher).mockRejectedValue(new Error('offline'));
    expect(await loadGameFromStageData(save('bad'))).toBe(false);
    expect(stageStateManager.getViewStageState()).toBe(old);
    expect(stop).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('original');
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('older unabortable load cannot parse, publish, replay or unlock newer load', async () => {
    const a = deferred<string>(),
      b = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = loadGameFromStageData(save('A'));
    await Promise.resolve();
    const second = loadGameFromStageData(save('B'));
    await Promise.resolve();
    a.resolve('A');
    expect(await first).toBe(false);
    expect(sceneParser).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    b.resolve('B');
    expect(await second).toBe(true);
    expect(stageStateManager.getViewStageState().showText).toBe('B');
    expect(sceneParser).toHaveBeenCalledOnce();
  });
  it('backlog supersedes load atomically and truncates only after fetch', async () => {
    const firstSave = save('history'),
      newerSave = save('latest');
    WebGAL.backlogManager.getBacklog().push(backlog(firstSave), backlog(newerSave));
    const a = deferred<string>(),
      b = deferred<string>();
    vi.mocked(sceneFetcher).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const load = loadGameFromStageData(save('load'));
    await Promise.resolve();
    const jump = jumpFromBacklog(0);
    await Promise.resolve();
    expect(WebGAL.backlogManager.getBacklog()).toHaveLength(2);
    b.resolve('history');
    expect(await jump).toBe(true);
    a.resolve('load');
    expect(await load).toBe(false);
    expect(WebGAL.backlogManager.getBacklog()).toHaveLength(1);
    expect(stageStateManager.getViewStageState().showText).toBe('history');
    expect(WebGAL.backlogManager.isSaveBacklogNext).toBe(true);
  });
  it('failed backlog leaves all history entries and live stage intact', async () => {
    const item = backlog(save('history'));
    WebGAL.backlogManager.getBacklog().push(item);
    vi.mocked(sceneFetcher).mockRejectedValue(new Error('offline'));
    expect(await jumpFromBacklog(0)).toBe(false);
    expect(WebGAL.backlogManager.getBacklog()[0]).toBe(item);
    expect(stageStateManager.getViewStageState().showText).toBe('original');
  });
  it('no-refetch backlog rejects mismatched scene identity', async () => {
    WebGAL.backlogManager.getBacklog().push(backlog(save('other')));
    expect(await jumpFromBacklog(0, false)).toBe(false);
    expect(sceneFetcher).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().showText).toBe('original');
  });
  it('same-scene no-refetch uses actual existing sentences without network', async () => {
    WebGAL.backlogManager.getBacklog().push(backlog(save('original')));
    expect(await jumpFromBacklog(0, false)).toBe(true);
    expect(sceneFetcher).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(4);
  });
  it('rejects malformed nested history/scene before stop or fetch', async () => {
    const input = save('A');
    input.backlog = [backlog(save('old'))];
    input.backlog[0].saveScene.currentSentenceId = NaN;
    expect(await loadGameFromStageData(input)).toBe(false);
    expect(sceneFetcher).not.toHaveBeenCalled();
    expect(disposeAttachmentStageBridge).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().showText).toBe('original');
  });
  it('resolves34 as Steam without ambiguity but refuses it as a durable replay performer', async () => {
    const ambiguous = save('A');
    delete ambiguous.commandAbi;
    ambiguous.nowStageState.PerformList = [{ id: 'p', isHoldOn: true, script: sentence(commandType.callSteam) }];
    expect(await loadGameFromStageData(ambiguous)).toBe(false);
    expect(runScript).not.toHaveBeenCalled();
    ambiguous.commandAbi = ATTACHMENT_COMMAND_ABI;
    expect(resolveSerializedCommandType({ command: 34, sourceAbi: ambiguous.commandAbi })).toEqual({
      ok: true,
      command: 34,
      migrated: false,
    });
    // The real callSteam handler returns None, so a genuine saved PerformList
    // cannot contain it. Never invoke Steam or attachment as a restore side effect.
    expect(await loadGameFromStageData(ambiguous)).toBe(false);
    expect(runScript).not.toHaveBeenCalled();
  });
  it('legacy35 stageEntity performer is not executed as current attachment', async () => {
    const input = save('old');
    input.commandAbi = LEGACY_HOTFIX37_COMMAND_ABI;
    input.nowStageState.PerformList = [
      {
        id: 'stageEntity-p',
        isHoldOn: true,
        script: { ...sentence(35), commandRaw: 'stageEntity', content: 'detach' },
      },
    ];
    expect(await loadGameFromStageData(input)).toBe(true);
    expect(runScript).not.toHaveBeenCalled();
  });
  it('native performers replay synchronously after scene swap and before owned commit', async () => {
    const input = save('A');
    input.nowStageState.PerformList = [{ id: 'p', isHoldOn: true, script: sentence() }];
    vi.mocked(runScript).mockImplementation(() => {
      expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
      expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('A');
      expect(stageStateManager.getCalculationStageState().PerformList).toHaveLength(0);
      stageStateManager.setStage('showText', 'replayed');
    });
    expect(await loadGameFromStageData(input)).toBe(true);
    expect(stageStateManager.getViewStageState().showText).toBe('replayed');
    expect(vi.getTimerCount()).toBe(0);
    expect(input.nowStageState.PerformList).toHaveLength(1);
  });
  it('reentrant newer entry during stopping prevents old state, backlog and GUI writes', async () => {
    vi.spyOn(WebGAL.gameplay.performController, 'removeAllPerform').mockImplementationOnce(() => {
      beginSceneMutation('end-game');
    });
    expect(await loadGameFromStageData(save('A'))).toBe(false);
    expect(stageStateManager.getViewStageState().showText).toBe('original');
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
  });
  it('new save and newly created backlog stamp current ABI and clone durable snapshots', () => {
    WebGAL.backlogManager.saveCurrentStateToBacklog();
    const captured = generateCurrentStageData(-1, false);
    expect(captured.commandAbi).toBe(ATTACHMENT_COMMAND_ABI);
    expect(captured.backlog[0].commandAbi).toBe(ATTACHMENT_COMMAND_ABI);
    expect(captured.nowStageState).not.toBe(stageStateManager.getCalculationStageState());
    captured.nowStageState.showText = 'changed';
    expect(stageStateManager.getCalculationStageState().showText).toBe('original');
  });
  it('history entry own ABI overrides enclosing save metadata', () => {
    const native = save('native');
    const legacy = backlog(save('legacy'));
    legacy.commandAbi = LEGACY_HOTFIX37_COMMAND_ABI;
    legacy.currentStageState.PerformList = [
      { id: 'p', isHoldOn: true, script: { ...sentence(35), commandRaw: 'stageEntity' } },
    ];
    const prepared = prepareHistoryRestore(native.nowStageState, [legacy], native.sceneData, native.commandAbi);
    expect(prepared.backlog[0].currentStageState.PerformList).toEqual([]);
    expect(prepared.backlog[0].commandAbi).toBe(ATTACHMENT_COMMAND_ABI);
  });
  it('slow flowchart IndexedDB read cannot overtake a newer ordinary load', async () => {
    const pending = deferred<ISaveData>();
    vi.spyOn(WebGAL.flowchartManager, 'isUnlocked').mockReturnValue(true);
    vi.spyOn(WebGAL.flowchartManager, 'loadSnapshot').mockReturnValue(pending.promise);
    const jump = loadFlowchartSnapshot('main', 'old');
    expect(WebGAL.sceneManager.lockSceneWrite).toBe(true);
    expect(await loadGameFromStageData(save('new'))).toBe(true);
    pending.resolve(save('old'));
    expect(await jump).toBe(false);
    expect(stageStateManager.getViewStageState().showText).toBe('new');
    expect(sceneFetcher).toHaveBeenCalledOnce();
  });
  it('flowchart click waits for complete scene restore before showing textbox', async () => {
    const pending = deferred<string>();
    vi.spyOn(WebGAL.flowchartManager, 'isUnlocked').mockReturnValue(true);
    vi.spyOn(WebGAL.flowchartManager, 'loadSnapshot').mockResolvedValue(save('chapter'));
    vi.mocked(sceneFetcher).mockReturnValue(pending.promise);
    const jump = loadFlowchartSnapshot('main', 'chapter');
    await Promise.resolve();
    expect(webgalStore.dispatch).not.toHaveBeenCalled();
    pending.resolve('raw');
    expect(await jump).toBe(true);
    expect(webgalStore.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { component: 'showTextBox', visibility: true } }),
    );
  });
  it('native flowchart snapshot producer stamps ABI and snapshots committed view, not future calculation', () => {
    stageStateManager.setStage('showText', 'future');
    // Exercise the actual private producer without a DOM/flowchart rendering claim.
    const snapshot = Reflect.get(WebGAL.flowchartManager, 'createSnapshot').call(WebGAL.flowchartManager) as ISaveData;
    expect(snapshot.commandAbi).toBe(ATTACHMENT_COMMAND_ABI);
    expect(snapshot.nowStageState.showText).toBe('original');
    expect(snapshot.backlog).toEqual([]);
  });
  it('a replay which starts a newer pending request still closes its synchronous collection scope', async () => {
    const input = save('A');
    input.nowStageState.PerformList = [{ id: 'p', isHoldOn: true, script: sentence() }];
    vi.mocked(runScript).mockImplementation(() => {
      beginSceneMutation('load-game');
    });
    expect(await loadGameFromStageData(input)).toBe(false);
    const start = vi.fn();
    WebGAL.gameplay.performController.arrangeNewPerform(
      {
        performName: 'probe',
        duration: 0,
        isHoldOn: false,
        blockingNext: () => false,
        blockingAuto: () => false,
        startFunction: start,
        stopFunction() {},
      },
      sentence(),
    );
    expect(start).toHaveBeenCalledOnce();
  });
  it('explicit invalid entry ABI and sparse scene/history arrays fail closed', () => {
    const input = save('A');
    const entry = backlog(input);
    Object.assign(entry, { commandAbi: null });
    expect(() =>
      prepareHistoryRestore(input.nowStageState, [entry], input.sceneData, ATTACHMENT_COMMAND_ABI),
    ).toThrow();
    expect(() =>
      prepareHistoryRestore(input.nowStageState, new Array(1), input.sceneData, ATTACHMENT_COMMAND_ABI),
    ).toThrow();
    expect(() =>
      prepareHistoryRestore(
        input.nowStageState,
        [],
        { ...input.sceneData, sceneStack: new Array(1) },
        ATTACHMENT_COMMAND_ABI,
      ),
    ).toThrow();
  });
});
