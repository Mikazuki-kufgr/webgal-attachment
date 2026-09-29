import { webgalStore } from '@/store/store';
import { ISaveData } from '@/store/userDataInterface';
import { loadGameFromStageData } from '@/Core/controller/storage/loadGame';
import { generateCurrentStageData } from '@/Core/controller/storage/saveGame';
import cloneDeep from 'lodash/cloneDeep';
import throttle from 'lodash/throttle';
import { WebGAL } from '@/Core/WebGAL';
import { saveActions } from '@/store/savesReducer';
import { dumpFastSaveToStorage, getFastSaveFromStorage } from '@/Core/controller/storage/savesController';
import {
  beginSceneMutation,
  isSceneMutationCurrent,
  type SceneMutationToken,
} from '@/Core/controller/scene/sceneMutationEpoch';
import { logger } from '@/Core/util/logger';

export let fastSaveGameKey = '';
export let isFastSaveKey = '';
let lock = true;
let dumpFastSaveTask = Promise.resolve();

export function initKey() {
  lock = false;
  fastSaveGameKey = `FastSaveKey-${WebGAL.gameName}-${WebGAL.gameKey}`;
  isFastSaveKey = `FastSaveActive-${WebGAL.gameName}-${WebGAL.gameKey}`;
}

function dumpFastSaveToStorageSerial() {
  dumpFastSaveTask = dumpFastSaveTask.catch(() => {}).then(dumpFastSaveToStorage);
  return dumpFastSaveTask;
}

/**
 * 用于紧急回避时的数据存储 & 快速保存
 */
export async function fastSaveGame() {
  const showTitle = webgalStore.getState().GUI.showTitle;
  if (showTitle || WebGAL.sceneManager.sceneData.currentSentenceId === 0 || WebGAL.sceneManager.lockSceneWrite) {
    // 如果在标题界面、游戏未开始或场景正在写入（此时状态是撕裂的），不进行快速保存
    return;
  }
  const saveData: ISaveData = generateCurrentStageData(-1, false);
  const newSaveData = cloneDeep(saveData);
  webgalStore.dispatch(saveActions.setFastSave(newSaveData));
  await dumpFastSaveToStorageSerial();
}

export const autoFastSaveGame = throttle(() => {
  void fastSaveGame().catch((error) => logger.error('自动快速存档写入失败', error));
}, 1000);

/**
 * 判断是否有无存储紧急回避时的数据
 */
export async function hasFastSaveRecord(isCurrent: () => boolean = () => true) {
  // Read the quick-save key itself. Loading unrelated user preferences here
  // both missed the actual record and could publish a stale continue read.
  const save = await getFastSaveFromStorage(isCurrent);
  return isCurrent() && save !== null;
}

/**
 * 加载紧急回避时的数据
 */
export async function loadFastSaveGame(existingMutation?: SceneMutationToken): Promise<boolean> {
  const mutation = existingMutation ?? beginSceneMutation('fast-save-load');
  if (!isSceneMutationCurrent(mutation)) return false;
  try {
    return await WebGAL.sceneManager.trackSceneWrite(
      mutation,
      (async () => {
        const loadFile = await getFastSaveFromStorage(() => isSceneMutationCurrent(mutation));
        if (!isSceneMutationCurrent(mutation) || !loadFile) return false;
        return await loadGameFromStageData(loadFile, mutation);
      })(),
    );
  } catch (error) {
    if (isSceneMutationCurrent(mutation)) logger.error('快速存档读取失败，保留当前画面', error);
    return false;
  }
}

/**
 * 移除紧急回避的数据
 */
export async function removeFastSaveGameRecord() {
  autoFastSaveGame.cancel();
  webgalStore.dispatch(saveActions.resetFastSave());
  await dumpFastSaveToStorageSerial();
}
