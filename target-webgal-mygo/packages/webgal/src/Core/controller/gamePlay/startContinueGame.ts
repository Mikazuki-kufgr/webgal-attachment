import { assetSetter, fileType } from '../../util/gameAssetsAccess/assetSetter';
import { sceneFetcher } from '../scene/sceneFetcher';
import { sceneParser } from '../../parser/sceneParser';
import { resetStage } from '@/Core/controller/stage/resetStage';
import { webgalStore } from '@/store/store';
import { setVisibility } from '@/store/GUIReducer';
import { continueSentence } from '@/Core/controller/gamePlay/nextSentence';
import { setEbg } from '@/Core/gameScripts/changeBg/setEbg';

import { hasFastSaveRecord, loadFastSaveGame } from '@/Core/controller/storage/fastSaveLoad';
import { WebGAL } from '@/Core/WebGAL';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { logger } from '@/Core/util/logger';
import {
  beginSceneMutation,
  commitSceneMutation,
  isSceneMutationCurrent,
  withSceneMutationContext,
} from '@/Core/controller/scene/sceneMutationEpoch';

/**
 * 从头开始游戏
 */
export const startGame = async (): Promise<boolean> => {
  const mutation = beginSceneMutation('start-game');
  const sceneUrl: string = assetSetter('start.txt', fileType.scene);
  try {
    const prepared = await WebGAL.sceneManager.trackSceneWrite(
      mutation,
      (async () => {
        const rawScene = await sceneFetcher(sceneUrl, { signal: mutation.signal });
        if (!isSceneMutationCurrent(mutation)) return false;
        const startScene = sceneParser(rawScene, 'start.txt', sceneUrl);
        return commitSceneMutation(mutation, () => {
          resetStage(true, true, { mutation });
          if (!isSceneMutationCurrent(mutation)) return;
          WebGAL.sceneManager.sceneData.currentScene = startScene;
          WebGAL.flowchartManager.waitForCurrentSceneDialog();
          if (!isSceneMutationCurrent(mutation)) return;
          webgalStore.dispatch(setVisibility({ component: 'showTitle', visibility: false }));
        });
      })(),
    );
    if (!prepared || !isSceneMutationCurrent(mutation)) return false;
    withSceneMutationContext(mutation, () => continueSentence());
    return true;
  } catch (error) {
    if (isSceneMutationCurrent(mutation)) logger.error('初始场景读取失败，游戏未开始', error);
    return false;
  }
};

export async function continueGame(): Promise<boolean> {
  const mutation = beginSceneMutation('continue-game');
  try {
    return await WebGAL.sceneManager.trackSceneWrite(
      mutation,
      (async () => {
        const hasSave = await hasFastSaveRecord(() => isSceneMutationCurrent(mutation));
        if (!isSceneMutationCurrent(mutation) || !hasSave) return false;
        const loaded = await loadFastSaveGame(mutation);
        if (!loaded || !isSceneMutationCurrent(mutation)) return false;
        return commitSceneMutation(mutation, () => {
          setEbg(stageStateManager.getViewStageState().bgName);
          if (!isSceneMutationCurrent(mutation)) return;
          webgalStore.dispatch(setVisibility({ component: 'showTitle', visibility: false }));
        });
      })(),
    );
  } catch (error) {
    if (isSceneMutationCurrent(mutation)) logger.error('继续游戏失败，保留当前画面', error);
    return false;
  }
}
