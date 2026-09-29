import cloneDeep from 'lodash/cloneDeep';
import { WebGAL } from '@/Core/WebGAL';
import { runScript } from '@/Core/controller/gamePlay/runScript';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { sanitizeStageStateForRestore } from '@/Core/Modules/stage/stageEntityPersistence';
import { ATTACHMENT_COMMAND_ABI } from 'webgal-parser';
import { isSceneMutationCurrent, type SceneMutationToken } from '@/Core/controller/scene/sceneMutationEpoch';

/** Replays only validated durable native performers after the complete scene fetch. */
export const restorePerform = (skipAnimation = false, mutation?: SceneMutationToken): boolean => {
  const isCurrent = () => !mutation || isSceneMutationCurrent(mutation);
  if (!isCurrent()) return false;
  const stage = sanitizeStageStateForRestore(stageStateManager.getCalculationStageState(), ATTACHMENT_COMMAND_ABI);
  const performToRestore = cloneDeep(stage.PerformList);
  stage.PerformList = [];
  stageStateManager.replaceCalculationStageState(stage);
  const controller = WebGAL.gameplay.performController;
  controller.beginCollectingPerforms();
  try {
    for (const perform of performToRestore) {
      if (!isCurrent()) return false;
      runScript(perform.script);
    }
  } finally {
    // This synchronous collection scope must close even if replay starts a newer
    // asynchronous request which later fails without resetting the controller.
    controller.endCollectingPerforms();
  }
  if (!isCurrent()) return false;
  stageStateManager.commit({ applyPixiEffects: false, skipAnimation });
  if (!isCurrent()) return false;
  controller.commitPendingPerforms();
  if (!isCurrent()) return false;
  stageStateManager.applyCommittedPixiEffects();
  return isCurrent();
};
