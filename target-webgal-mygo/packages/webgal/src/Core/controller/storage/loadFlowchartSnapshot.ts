import { WebGAL } from '@/Core/WebGAL';
import { beginSceneMutation, isSceneMutationCurrent } from '@/Core/controller/scene/sceneMutationEpoch';
import { loadGameFromStageData } from './loadGame';
import { webgalStore } from '@/store/store';
import { setVisibility } from '@/store/GUIReducer';
import { logger } from '@/Core/util/logger';

/** The click owns the epoch before IndexedDB resolves, not only once a snapshot exists. */
export async function loadFlowchartSnapshot(flowchartId: string, nodeId: string): Promise<boolean> {
  if (!WebGAL.flowchartManager.isUnlocked(flowchartId, nodeId)) return false;
  const mutation = beginSceneMutation('load-game');
  try {
    const snapshot = await WebGAL.sceneManager.trackSceneWrite(
      mutation,
      WebGAL.flowchartManager.loadSnapshot(flowchartId, nodeId),
    );
    if (!snapshot || !isSceneMutationCurrent(mutation)) return false;
    if (!(await loadGameFromStageData(snapshot, mutation)) || !isSceneMutationCurrent(mutation)) return false;
    webgalStore.dispatch(setVisibility({ component: 'showTextBox', visibility: true }));
    return isSceneMutationCurrent(mutation);
  } catch (error) {
    if (isSceneMutationCurrent(mutation)) logger.error('HISTORY_FLOWCHART_LOAD_FAILED', error);
    return false;
  }
}
