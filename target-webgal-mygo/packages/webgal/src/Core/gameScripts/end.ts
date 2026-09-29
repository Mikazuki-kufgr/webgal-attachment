import { ISentence } from '@/Core/controller/scene/sceneInterface';
import { createNonePerform, IPerform } from '@/Core/Modules/perform/performInterface';
import { assetSetter, fileType } from '@/Core/util/gameAssetsAccess/assetSetter';
import { sceneFetcher } from '@/Core/controller/scene/sceneFetcher';
import { sceneParser } from '@/Core/parser/sceneParser';
import { resetStage } from '@/Core/controller/stage/resetStage';
import { webgalStore } from '@/store/store';
import { setVisibility } from '@/store/GUIReducer';
import { playBgm } from '@/Core/controller/stage/playBgm';
import { WebGAL } from '@/Core/WebGAL';
import { dumpToStorageFast } from '@/Core/controller/storage/storageController';
import { removeFastSaveGameRecord } from '../controller/storage/fastSaveLoad';
import { logger } from '@/Core/util/logger';
import {
  beginSceneMutation,
  commitSceneMutation,
  isSceneMutationCurrent,
} from '@/Core/controller/scene/sceneMutationEpoch';

/**
 * 结束游戏
 * @param sentence
 */
export const end = (sentence: ISentence): IPerform => {
  const mutation = beginSceneMutation('end-game');
  resetStage(true, true, { mutation });
  if (!isSceneMutationCurrent(mutation)) return createNonePerform();
  const dispatch = webgalStore.dispatch;
  // 重新获取初始场景
  const sceneUrl: string = assetSetter('start.txt', fileType.scene);
  // 为了在 scriptExecutor 自增 sentenceId 后再重置场景
  setTimeout(() => {
    commitSceneMutation(mutation, () => {
      WebGAL.sceneManager.sceneData.currentSentenceId = 0;
    });
  }, 5);
  void removeFastSaveGameRecord().catch((error) => logger.error('结束游戏后清理快速存档失败', error));
  void dumpToStorageFast(() => isSceneMutationCurrent(mutation));
  void WebGAL.sceneManager
    .trackSceneWrite(
      mutation,
      (async () => {
        const rawScene = await sceneFetcher(sceneUrl, { signal: mutation.signal });
        if (
          !isSceneMutationCurrent(mutation) ||
          !webgalStore.getState().GUI.showTitle ||
          WebGAL.sceneManager.sceneData.currentScene.sceneName !== ''
        )
          return;
        const initial = sceneParser(rawScene, 'start.txt', sceneUrl);
        commitSceneMutation(mutation, () => {
          WebGAL.sceneManager.sceneData.currentScene = initial;
          WebGAL.sceneManager.sceneData.currentSentenceId = 0;
        });
      })(),
    )
    .catch((error) => {
      if (isSceneMutationCurrent(mutation)) logger.error('结束游戏后读取初始场景失败', error);
    });
  dispatch(setVisibility({ component: 'showTitle', visibility: true }));
  playBgm(webgalStore.getState().GUI.titleBgm);
  return createNonePerform();
};
