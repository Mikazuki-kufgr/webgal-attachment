import cloneDeep from 'lodash/cloneDeep';
import type { IBacklogItem } from '@/Core/Modules/backlog';
import type { IStageState, IGameVar } from '@/Core/Modules/stage/stageInterface';
import type { ISaveScene } from '@/store/userDataInterface';
import { inspectStageStateForRestore } from '@/Core/Modules/stage/stageEntityPersistence';
import { logger } from '@/Core/util/logger';
import { ATTACHMENT_COMMAND_ABI } from 'webgal-parser';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function line(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function locals(input: unknown): IGameVar {
  if (input === undefined) return {};
  if (!record(input)) throw new Error('HISTORY_LOCALS_INVALID');
  const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
  for (const value of Object.values(input)) {
    if (!scalar(value) && !(Array.isArray(value) && value.every(scalar))) throw new Error('HISTORY_LOCALS_INVALID');
  }
  return cloneDeep(input) as IGameVar;
}

/** Validate the whole scene envelope before stopping performers or touching live state. */
export function sanitizeHistoryScene(input: unknown): ISaveScene {
  if (
    !record(input) ||
    !line(input.currentSentenceId) ||
    typeof input.sceneName !== 'string' ||
    typeof input.sceneUrl !== 'string' ||
    !input.sceneUrl ||
    !Array.isArray(input.sceneStack) ||
    input.sceneStack.length > 100000
  ) {
    throw new Error('HISTORY_SCENE_INVALID');
  }
  const sceneStack = Array.from(input.sceneStack, (entry) => {
    if (
      !record(entry) ||
      typeof entry.sceneName !== 'string' ||
      typeof entry.sceneUrl !== 'string' ||
      !entry.sceneUrl ||
      !line(entry.continueLine)
    )
      throw new Error('HISTORY_SCENE_STACK_INVALID');
    if (entry.writeReturnTo !== undefined && typeof entry.writeReturnTo !== 'string') throw new Error('HISTORY_SCENE_STACK_INVALID');
    return { sceneName: entry.sceneName, sceneUrl: entry.sceneUrl, continueLine: entry.continueLine,
      locals: locals(entry.locals), ...(entry.writeReturnTo === undefined ? {} : { writeReturnTo: entry.writeReturnTo }) };
  });
  return {
    currentSentenceId: input.currentSentenceId,
    sceneName: input.sceneName,
    sceneUrl: input.sceneUrl,
    sceneStack,
    currentLocals: locals(input.currentLocals),
  };
}

/** Historical rows never receive runtime-only pending snapshots from the current scene. */
export function captureHistoryBacklogSnapshots(input: unknown, fallbackAbi?: unknown): IBacklogItem[] {
  if (!Array.isArray(input) || input.length > 100000) throw new Error('HISTORY_BACKLOG_INVALID');
  return Array.from(input, (entry) => {
    if (!record(entry)) throw new Error('HISTORY_BACKLOG_ENTRY_INVALID');
    return {
      currentStageState: inspectHistoryStage(
        entry.currentStageState,
        entry.commandAbi === undefined ? fallbackAbi : entry.commandAbi,
      ),
      saveScene: sanitizeHistoryScene(entry.saveScene),
      commandAbi: ATTACHMENT_COMMAND_ABI,
    };
  });
}

export interface PreparedHistoryRestore {
  stage: IStageState;
  backlog: IBacklogItem[];
  scene: ISaveScene;
}

function inspectHistoryStage(input: unknown, abi?: unknown): IStageState {
  const result = inspectStageStateForRestore(input, abi);
  if (result.diagnostics.length) logger.warn('HISTORY_STAGE_ROWS_QUARANTINED', result.diagnostics);
  return result.state;
}

export function prepareHistoryRestore(
  stage: unknown,
  backlog: unknown,
  scene: unknown,
  commandAbi?: unknown,
): PreparedHistoryRestore {
  const prepared = {
    stage: inspectHistoryStage(stage, commandAbi),
    backlog: captureHistoryBacklogSnapshots(backlog, commandAbi),
    scene: sanitizeHistoryScene(scene),
  };
  prepared.stage.isRead = true;
  return cloneDeep(prepared);
}
