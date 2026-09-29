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
import { IGameVar } from '@/Core/Modules/stage/stageInterface';
import { MAX_SCENE_STACK_DEPTH } from '@/Core/Modules/scene';

/**
 * 调用场景
 * @param sceneUrl 场景路径
 * @param sceneName 场景名称
 * @param locals 传入被调用场景的局部变量
 * @param writeReturnTo 返回值写回本场景的哪个变量
 */
export const callScene = (sceneUrl: string, sceneName: string, locals: IGameVar = {}, writeReturnTo?: string): Promise<boolean> => {
  if (WebGAL.sceneManager.sceneData.sceneStack.length >= MAX_SCENE_STACK_DEPTH) {
    logger.error(`场景调用层数超过 ${MAX_SCENE_STACK_DEPTH}`, sceneUrl);
    return Promise.resolve(false);
  }
  const mutation = inheritSceneMutationToken() ?? beginSceneMutation('call-scene');
  const manager = WebGAL.sceneManager;
  const isFastPreviewSceneWrite = WebGAL.gameplay.isFastPreview;
  let expectedWrite: Promise<void> | null = null;
  let publishedScene = manager.sceneData.currentScene;
  const ownsWrite = () => isSceneMutationCurrent(mutation) && manager.sceneWritePromise === expectedWrite;
  const callerScene = manager.sceneData.currentScene;
  const callerStack = manager.sceneData.sceneStack;
  const stackSnapshot = callerStack.slice();
  const returnEntry = {
    sceneName: callerScene.sceneName,
    sceneUrl: callerScene.sceneUrl,
    continueLine: manager.sceneData.currentSentenceId,
    locals: manager.sceneData.currentLocals,
    writeReturnTo,
  };
  const ownsCaller = () =>
    manager.sceneData.currentScene === callerScene &&
    manager.sceneData.sceneStack === callerStack &&
    callerStack.length === stackSnapshot.length &&
    callerStack.every((entry, index) => entry === stackSnapshot[index]);
  const work = Promise.resolve()
    .then(async () => {
      if (!ownsWrite()) return false;
      const rawScene = await sceneFetcher(sceneUrl, { signal: mutation.signal });
      if (!ownsWrite() || !ownsCaller()) return false;
      const scene = sceneParser(rawScene, sceneName, sceneUrl);
      if (!ownsWrite() || !ownsCaller()) return false;
      if (
        !commitSceneMutation(mutation, () => {
          callerStack.push(returnEntry);
          manager.sceneData.currentLocals = locals;
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
      logger.debug('现在调用场景，调用结果：', manager.sceneData);
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
