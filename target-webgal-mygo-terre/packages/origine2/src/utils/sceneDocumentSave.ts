import { api } from '@/api';
import { eventBus } from '@/utils/eventBus';
import { publishSceneSaveStatus } from './sceneSaveStatus';
import { isEditorRenaming, setEditorRenaming } from './editorRename';
import {
  SceneDocumentSaveCoordinator,
  type SceneDocumentSaveReceipt,
  type SceneDocumentSaveRequest,
  type SceneDocumentSaveResponse,
} from './sceneDocumentSaveCoordinator';

function createSaveSessionId(): string {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `terre-scene-save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const coordinator = new SceneDocumentSaveCoordinator(createSaveSessionId());

export function reopenSceneDocument(path: string) { coordinator.reopen(path); }

export async function renameSceneDocuments(source: string, target: string, operation: () => Promise<void>, commit: () => void) {
  if (isEditorRenaming()) throw new Error('正在重命名，请稍后重试。');
  setEditorRenaming(true);
  try {
    await coordinator.rename(source, target, operation, commit);
  } finally {
    setEditorRenaming(false);
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const responseData = 'response' in error
      ? (error.response as { data?: unknown } | undefined)?.data
      : undefined;
    if (typeof responseData === 'object' && responseData !== null) {
      const nested = 'message' in responseData ? responseData.message : undefined;
      if (typeof nested === 'string' && nested.trim() !== '') return nested;
      if (typeof nested === 'object' && nested !== null && 'message' in nested && typeof nested.message === 'string') {
        return nested.message;
      }
    }
    if ('message' in error && typeof error.message === 'string' && error.message.trim() !== '') {
      return error.message;
    }
  }
  return '未知写入错误';
}

async function transport(request: SceneDocumentSaveRequest): Promise<SceneDocumentSaveResponse> {
  const response = await api.assetsControllerEditTextFile(request);
  const { data } = response;
  if (data.saveSessionId === undefined || data.revision === undefined) {
    throw new Error('场景保存接口未返回修订确认');
  }
  return {
    ...data,
    saveSessionId: data.saveSessionId,
    revision: data.revision,
  };
}

function emitState(state: {
  path: string;
  status: 'saving' | 'saved' | 'error';
  message?: string;
  receipt?: SceneDocumentSaveReceipt;
}) {
  publishSceneSaveStatus({ path: state.path, status: state.status, message: state.message });
  eventBus.emit('editor:scene-save-state', {
    path: state.path,
    status: state.status,
    message: state.message,
    revision: state.receipt?.request.revision,
    contentHash: state.receipt?.request.contentHash,
  });
}

export function stageSceneDocument(path: string, textFile: string): number {
  return coordinator.stage(path, textFile);
}

export function acceptPersistedSceneDocument(path: string, textFile: string): boolean {
  return coordinator.acceptPersisted(path, textFile);
}

export function getSceneDocumentDraft(path: string): string | undefined {
  return coordinator.getLatestText(path);
}

export function hasDirtySceneDocument(path: string): boolean {
  return coordinator.hasDirtyDraft(path);
}

export async function saveSceneDocument(path: string, textFile: string): Promise<SceneDocumentSaveReceipt> {
  emitState({ path, status: 'saving' });
  try {
    const receipt = await coordinator.save(path, textFile, transport);
    if (receipt.status === 'saved') emitState({ path, status: 'saved', receipt });
    return receipt;
  } catch (error) {
    emitState({ path, status: 'error', message: errorMessage(error) });
    throw error;
  }
}

export async function saveSceneDocumentAndRun(
  path: string,
  textFile: string,
  run: (receipt: SceneDocumentSaveReceipt) => void | Promise<void>,
): Promise<boolean> {
  emitState({ path, status: 'saving' });
  try {
    const ran = await coordinator.saveAndRun(path, textFile, {
      transport,
      run: async (receipt) => {
        emitState({ path, status: 'saved', receipt });
        await run(receipt);
      },
    });
    return ran;
  } catch (error) {
    emitState({ path, status: 'error', message: errorMessage(error) });
    throw error;
  }
}
