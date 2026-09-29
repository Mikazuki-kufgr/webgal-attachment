import { sceneFetcher } from './sceneFetcher';
import { sceneParser } from '../../parser/sceneParser';
import { logger } from '../../util/logger';
import { continueSentence } from '@/Core/controller/gamePlay/nextSentence';
import { clearPrefetchLinks } from '@/Core/util/prefetcher/assetsPrefetcher';

import { WebGAL } from '@/Core/WebGAL';
import {
  beginSceneMutation,
  commitSceneMutation,
  inheritSceneMutationToken,
  isSceneMutationCurrent,
} from './sceneMutationEpoch';

/**
 * 切换场景
 * @param sceneUrl 场景路径
 * @param sceneName 场景名称
 */
export const changeScene = (sceneUrl: string, sceneName: string): Promise<boolean> => {
  const mutation = inheritSceneMutationToken() ?? beginSceneMutation('change-scene');
  const manager = WebGAL.sceneManager;
  const isFastPreviewSceneWrite = WebGAL.gameplay.isFastPreview;
  let expectedWrite: Promise<void> | null = null;
  let publishedScene = manager.sceneData.currentScene;
  const ownsWrite = () => isSceneMutationCurrent(mutation) && manager.sceneWritePromise === expectedWrite;
  const work = Promise.resolve()
    .then(async () => {
      if (!ownsWrite()) return false;
      const rawScene = await sceneFetcher(sceneUrl, { signal: mutation.signal });
      if (!ownsWrite()) return false;
      const scene = sceneParser(rawScene, sceneName, sceneUrl);
      if (!ownsWrite()) return false;
      if (
        !commitSceneMutation(mutation, () => {
          manager.sceneData.currentScene = scene;
          manager.sceneData.currentSentenceId = 0;
          manager.settledScenes.add(sceneUrl);
          publishedScene = scene;
        })
      )
        return false;
      clearPrefetchLinks();
      if (!ownsWrite()) return false;
      WebGAL.flowchartManager.waitForCurrentSceneDialog();
      if (!ownsWrite()) return false;
      logger.debug('现在切换场景，切换后的结果：', manager.sceneData);
      return ownsWrite();
    })
    .catch((e) => {
      if (ownsWrite()) logger.error('场景调用错误', e);
      return false;
    });
  const tracked = manager.trackSceneWrite(mutation, work);
  expectedWrite = manager.sceneWritePromise;
  return tracked.then((committed) => {
    if (
      committed &&
      isSceneMutationCurrent(mutation) &&
      !isFastPreviewSceneWrite &&
      !manager.lockSceneWrite &&
      manager.sceneData.currentScene === publishedScene
    )
      continueSentence();
    return committed && isSceneMutationCurrent(mutation);
  });
};
