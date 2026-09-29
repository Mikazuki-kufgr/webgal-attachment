import { sceneFetcher } from './sceneFetcher';
import { sceneParser } from '../../parser/sceneParser';
import { logger } from '../../util/logger';
import { continueSentence } from '@/Core/controller/gamePlay/nextSentence';
import { ISceneEntry } from '@/Core/Modules/scene';
import { setGameVar } from '@/Core/gameScripts/setVar';

import { WebGAL } from '@/Core/WebGAL';
import {
  beginSceneMutation,
  commitSceneMutation,
  inheritSceneMutationToken,
  isSceneMutationCurrent,
} from './sceneMutationEpoch';

/**
 * 恢复场景
 * @param entry 场景入口
 */
export const restoreScene = (entry: ISceneEntry, returnValue: string | boolean | number = ''): Promise<boolean> => {
  const mutation = inheritSceneMutationToken() ?? beginSceneMutation('restore-scene');
  const manager = WebGAL.sceneManager;
  const isFastPreviewSceneWrite = WebGAL.gameplay.isFastPreview;
  let expectedWrite: Promise<void> | null = null;
  let publishedScene = manager.sceneData.currentScene;
  const ownsWrite = () => isSceneMutationCurrent(mutation) && manager.sceneWritePromise === expectedWrite;
  const expectedStack = manager.sceneData.sceneStack;
  const expectedLength = expectedStack.length;
  const ownsEntry = () =>
    manager.sceneData.sceneStack === expectedStack &&
    expectedStack.length === expectedLength &&
    expectedStack[expectedLength - 1] === entry;
  const work = Promise.resolve()
    .then(async () => {
      if (!ownsWrite() || !ownsEntry()) return false;
      const rawScene = await sceneFetcher(entry.sceneUrl, { signal: mutation.signal });
      if (!ownsWrite() || !ownsEntry()) return false;
      const scene = sceneParser(rawScene, entry.sceneName, entry.sceneUrl);
      if (!ownsWrite() || !ownsEntry()) return false;
      if (
        !commitSceneMutation(mutation, () => {
          expectedStack.pop();
          manager.sceneData.currentLocals = entry.locals ?? {};
          if (entry.writeReturnTo) setGameVar({ key: entry.writeReturnTo, value: returnValue });
          manager.sceneData.currentScene = scene;
          manager.sceneData.currentSentenceId = entry.continueLine + 1;
          publishedScene = scene;
        })
      )
        return false;
      logger.debug('现在恢复场景，恢复后场景：', manager.sceneData.currentScene);
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
