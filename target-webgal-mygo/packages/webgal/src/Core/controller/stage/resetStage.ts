import cloneDeep from 'lodash/cloneDeep';
import { WebGAL } from '@/Core/WebGAL';
import { initState, stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { stopFast } from '@/Core/controller/gamePlay/fastSkip';
import {
  beginSceneMutation,
  isSceneMutationCurrent,
  type SceneMutationToken,
} from '@/Core/controller/scene/sceneMutationEpoch';
import { disposeAttachmentStageBridge } from '@/Core/controller/stage/pixi/syncPixiStageState';
import { clearPendingCommittedStageEntities } from '@/Core/Modules/stage/stageEntityPersistence';

export interface ResetStageOptions {
  commitStageState?: boolean;
  mutation?: SceneMutationToken;
}

export const resetStage = (resetBacklog: boolean, resetSceneAndVar = true, options: ResetStageOptions = {}) => {
  const { commitStageState = true } = options;
  const mutation = options.mutation ?? beginSceneMutation('stage-reset');
  if (!isSceneMutationCurrent(mutation)) return false;
  /**
   * 清空运行时
   */
  if (resetBacklog) {
    WebGAL.backlogManager.makeBacklogEmpty();
  }
  if (!isSceneMutationCurrent(mutation)) return false;
  // 清空sceneData，并重新获取
  if (resetSceneAndVar) {
    WebGAL.sceneManager.resetScene({ mutation });
  }
  if (!isSceneMutationCurrent(mutation)) return false;

  // 清空所有演出和timeOut
  WebGAL.gameplay.pixiStage?.removeAllAnimations();
  if (!isSceneMutationCurrent(mutation)) return false;
  stopFast();
  if (!isSceneMutationCurrent(mutation)) return false;
  WebGAL.gameplay.performController.removeAllPerform();
  if (!isSceneMutationCurrent(mutation)) return false;
  clearPendingCommittedStageEntities();
  disposeAttachmentStageBridge();
  if (!isSceneMutationCurrent(mutation)) return false;
  WebGAL.gameplay.resetGamePlay();
  if (!isSceneMutationCurrent(mutation)) return false;

  // 清空舞台状态表
  const initSceneDataCopy = cloneDeep(initState);
  const currentVars = stageStateManager.getCalculationStageState().GameVar;
  if (!resetSceneAndVar) initSceneDataCopy.GameVar = cloneDeep(currentVars);
  if (commitStageState) {
    stageStateManager.resetAllStageState(initSceneDataCopy, { skipAnimation: true });
  } else {
    stageStateManager.resetCalculationStageState(initSceneDataCopy);
  }
  return isSceneMutationCurrent(mutation);
};
