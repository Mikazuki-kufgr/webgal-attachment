import { logger } from '../../util/logger';
import { sceneFetcher } from '../scene/sceneFetcher';
import { sceneParser } from '../../parser/sceneParser';
import { webgalStore } from '@/store/store';
import { setVisibility } from '@/store/GUIReducer';
import cloneDeep from 'lodash/cloneDeep';
import { WebGAL } from '@/Core/WebGAL';
import { beginSceneMutation, isSceneMutationCurrent } from '../scene/sceneMutationEpoch';
import { prepareHistoryRestore } from './historyStateCore';
import { commitHistoryRestore } from './commitHistoryRestore';

export { restorePerform } from './restorePerform';

/** Backlog uses the same validated scene/stage transaction as normal and quick loads. */
export const jumpFromBacklog = async (index: number, refetchScene = true): Promise<boolean> => {
  const items = WebGAL.backlogManager.getBacklog();
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    logger.error('HISTORY_BACKLOG_INDEX_INVALID', index);
    return false;
  }
  const token = beginSceneMutation('backlog');
  try {
    const item = items[index];
    const prepared = prepareHistoryRestore(
      item.currentStageState,
      items.slice(0, index + 1),
      item.saveScene,
      item.commandAbi,
    );
    const currentScene = WebGAL.sceneManager.sceneData.currentScene;
    // A no-refetch caller cannot combine one scene's sentences with another scene's pointer.
    if (
      !refetchScene &&
      (currentScene.sceneUrl !== prepared.scene.sceneUrl || currentScene.sceneName !== prepared.scene.sceneName)
    ) {
      throw new Error('HISTORY_BACKLOG_SCENE_MISMATCH');
    }
    const work = Promise.resolve().then(async () => {
      if (!isSceneMutationCurrent(token)) return false;
      const raw = refetchScene ? await sceneFetcher(prepared.scene.sceneUrl, { signal: token.signal }) : undefined;
      if (!isSceneMutationCurrent(token)) return false;
      const scene =
        raw === undefined
          ? cloneDeep(currentScene)
          : sceneParser(raw, prepared.scene.sceneName, prepared.scene.sceneUrl);
      if (!isSceneMutationCurrent(token)) return false;
      if (!commitHistoryRestore(prepared, scene, token, false)) return false;
      if (!isSceneMutationCurrent(token)) return false;
      WebGAL.backlogManager.isSaveBacklogNext = true;
      webgalStore.dispatch(setVisibility({ component: 'showBacklog', visibility: false }));
      if (!isSceneMutationCurrent(token)) return false;
      webgalStore.dispatch(setVisibility({ component: 'showTextBox', visibility: true }));
      if (!isSceneMutationCurrent(token)) return false;
      WebGAL.gameplay.pixiStage?.requestRender();
      return isSceneMutationCurrent(token);
    });
    return await WebGAL.sceneManager.trackSceneWrite(token, work);
  } catch (error) {
    if (isSceneMutationCurrent(token)) logger.error('HISTORY_BACKLOG_RESTORE_FAILED', error);
    return false;
  }
};
