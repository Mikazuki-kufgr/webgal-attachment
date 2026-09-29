import cloneDeep from 'lodash/cloneDeep';
import { WebGAL } from '@/Core/WebGAL';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { clearPendingCommittedStageEntities } from '@/Core/Modules/stage/stageEntityPersistence';
import { stopAllPerform } from '@/Core/controller/gamePlay/stopAllPerform';
import { disposeAttachmentStageBridge } from '@/Core/controller/stage/pixi/syncPixiStageState';
import { isSceneMutationCurrent, type SceneMutationToken } from '@/Core/controller/scene/sceneMutationEpoch';
import type { IScene } from '@/Core/controller/scene/sceneInterface';
import type { PreparedHistoryRestore } from './historyStateCore';
import { restorePerform } from './restorePerform';

/** No await or deferred replay in the publication interval; stale callbacks have no capability. */
export function commitHistoryRestore(
  prepared: PreparedHistoryRestore,
  scene: IScene,
  mutation: SceneMutationToken,
  skipAnimation: boolean,
): boolean {
  const current = () => isSceneMutationCurrent(mutation);
  if (!current()) return false;
  stopAllPerform();
  if (!current()) return false;
  clearPendingCommittedStageEntities();
  disposeAttachmentStageBridge();
  if (!current()) return false;
  WebGAL.gameplay.pixiStage?.removeAllAnimations();
  if (!current()) return false;
  WebGAL.gameplay.resetGamePlay();
  if (!current()) return false;
  stageStateManager.replaceCalculationStageState(prepared.stage);
  WebGAL.sceneManager.sceneData.currentScene = scene;
  WebGAL.sceneManager.sceneData.currentSentenceId = prepared.scene.currentSentenceId;
  WebGAL.sceneManager.sceneData.sceneStack = cloneDeep(prepared.scene.sceneStack);
  WebGAL.sceneManager.sceneData.currentLocals = cloneDeep(prepared.scene.currentLocals ?? {});
  WebGAL.sceneManager.settledScenes.add(scene.sceneUrl);
  const backlog = WebGAL.backlogManager.getBacklog();
  backlog.splice(0, backlog.length, ...prepared.backlog);
  return restorePerform(skipAnimation, mutation);
}
