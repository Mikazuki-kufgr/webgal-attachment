import { ISaveData } from '@/store/userDataInterface';
import { logger } from '../../util/logger';
import { sceneFetcher } from '../scene/sceneFetcher';
import { sceneParser } from '../../parser/sceneParser';
import { webgalStore } from '@/store/store';
import { setVisibility } from '@/store/GUIReducer';
import { setEbg } from '@/Core/gameScripts/changeBg/setEbg';
import { WebGAL } from '@/Core/WebGAL';
import { beginSceneMutation, isSceneMutationCurrent, type SceneMutationToken } from '../scene/sceneMutationEpoch';
import { prepareHistoryRestore } from './historyStateCore';
import { commitHistoryRestore } from './commitHistoryRestore';

export const loadGame = (index: number): Promise<boolean> =>
  loadGameFromStageData(webgalStore.getState().saveData.saveData[index]);

/** Prepare and fetch first; no old perform, backlog, stage or GUI mutation on failure. */
export async function loadGameFromStageData(stageData: ISaveData, mutation?: SceneMutationToken): Promise<boolean> {
  if (!stageData) {
    logger.info('暂无存档');
    return false;
  }
  const token = mutation ?? beginSceneMutation('load-game');
  if (!isSceneMutationCurrent(token)) return false;
  try {
    const prepared = prepareHistoryRestore(
      stageData.nowStageState,
      stageData.backlog,
      stageData.sceneData,
      stageData.commandAbi,
    );
    const work = Promise.resolve().then(async () => {
      if (!isSceneMutationCurrent(token)) return false;
      const raw = await sceneFetcher(prepared.scene.sceneUrl, { signal: token.signal });
      if (!isSceneMutationCurrent(token)) return false;
      const scene = sceneParser(raw, prepared.scene.sceneName, prepared.scene.sceneUrl);
      if (!isSceneMutationCurrent(token)) return false;
      if (!commitHistoryRestore(prepared, scene, token, true)) return false;
      if (!isSceneMutationCurrent(token)) return false;
      webgalStore.dispatch(setVisibility({ component: 'showTitle', visibility: false }));
      if (!isSceneMutationCurrent(token)) return false;
      webgalStore.dispatch(setVisibility({ component: 'showMenuPanel', visibility: false }));
      if (!isSceneMutationCurrent(token)) return false;
      setEbg(prepared.stage.bgName, 0);
      return isSceneMutationCurrent(token);
    });
    return await WebGAL.sceneManager.trackSceneWrite(token, work);
  } catch (error) {
    if (isSceneMutationCurrent(token)) logger.error('HISTORY_LOAD_FAILED', error);
    return false;
  }
}
