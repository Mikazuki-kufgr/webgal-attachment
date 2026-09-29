import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandType, type ISentence } from './sceneInterface';
import { beginSceneMutation, invalidateSceneMutation, withSceneMutationContext } from './sceneMutationEpoch';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    sceneManager: undefined,
    readHistoryManager: { checkIsRead: vi.fn() },
    backlogManager: { saveCurrentStateToBacklog: vi.fn() },
    gameplay: { performController: { hasPendingBlockingStateCalculationPerform: () => false } },
  },
}));
vi.mock('@/Core/controller/gamePlay/runScript', () => ({ runScript: vi.fn() }));
vi.mock('./restoreScene', () => ({ restoreScene: vi.fn() }));
vi.mock('@/Core/util/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/store/store', () => ({ webgalStore: { getState: () => ({ userData: { globalGameVar: {} } }) } }));
vi.mock('@/Core/gameScripts/setVar', () => ({ getValueFromStateElseKey: vi.fn() }));
vi.mock('@/Core/controller/gamePlay/strIf', () => ({ strIf: () => true }));
vi.mock('@/Core/Modules/stage/stageStateManager', () => ({
  stageStateManager: { getCalculationStageState: () => ({}) },
}));
vi.mock('@/Core/gameScripts/label/jumpToLabel', () => ({ jumpToLabel: () => false }));
vi.mock('@/Core/util/prefetcher/progressPrefetcher', () => ({ prefetchCurrentSceneByProgress: vi.fn() }));

const { WebGAL } = await import('@/Core/WebGAL');
const { SceneManager } = await import('@/Core/Modules/scene');
const { scriptExecutor } = await import('@/Core/controller/gamePlay/scriptExecutor');
const { runScript } = await import('@/Core/controller/gamePlay/runScript');
const { restoreScene } = await import('./restoreScene');
const sentence: ISentence = {
  command: commandType.say,
  commandRaw: 'say',
  content: 'text',
  args: [],
  sentenceAssets: [],
  subScene: [],
  inlineComment: '',
  isLineBreakHolder: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  WebGAL.sceneManager = new SceneManager();
  WebGAL.sceneManager.sceneData.currentScene.sentenceList = [sentence];
  vi.mocked(runScript).mockImplementation(() => undefined);
});
afterEach(() => invalidateSceneMutation());

describe('native script executor respects a scoped preview mutation', () => {
  it('a superseding beforeSentenceExecute callback cannot run or advance the old sentence', () => {
    const parent = beginSceneMutation('terre-sync');
    withSceneMutationContext(parent, () =>
      scriptExecutor(0, {
        beforeSentenceExecute: () => {
          beginSceneMutation('load-game');
        },
      }),
    );
    expect(runScript).not.toHaveBeenCalled();
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(0);
    expect(WebGAL.backlogManager.saveCurrentStateToBacklog).not.toHaveBeenCalled();
  });

  it('a command that begins a newer mutation cannot append old backlog or increment its pointer', () => {
    vi.mocked(runScript).mockImplementation(() => {
      beginSceneMutation('end-game');
    });
    withSceneMutationContext(beginSceneMutation('terre-sync'), () => scriptExecutor());
    expect(runScript).toHaveBeenCalledOnce();
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(0);
    expect(WebGAL.backlogManager.saveCurrentStateToBacklog).not.toHaveBeenCalled();
  });

  it('the ordinary unscoped executor still advances and records a native say', () => {
    scriptExecutor();
    expect(runScript).toHaveBeenCalledWith(sentence);
    expect(WebGAL.sceneManager.sceneData.currentSentenceId).toBe(1);
    expect(WebGAL.backlogManager.saveCurrentStateToBacklog).toHaveBeenCalledOnce();
  });

  it('end of child scene peeks at the parent without popping before restore succeeds', () => {
    const entry = { sceneName: 'parent', sceneUrl: 'parent.txt', continueLine: 8 };
    WebGAL.sceneManager.sceneData.sceneStack.push(entry);
    WebGAL.sceneManager.sceneData.currentSentenceId = 1;
    scriptExecutor();
    expect(restoreScene).toHaveBeenCalledWith(entry, '');
    expect(WebGAL.sceneManager.sceneData.sceneStack[0]).toBe(entry);
    expect(WebGAL.sceneManager.sceneData.sceneStack).toHaveLength(1);
  });
});
