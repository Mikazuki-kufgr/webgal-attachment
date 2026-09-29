import type { AttachmentAssetDefinition, AttachmentPlacementPreset, Live2DModelProfile } from '../profileTypes';
import type { CreatorPackage } from './creatorTypes';
import { MODEL_IMPORT_BODY_BYTES } from './creatorModelFiles';
import type { MeshLabelDocument } from './meshLabelContract';

export interface Rc1ProjectLayer {
  path: string;
  fileName: string;
  sha256: string;
  bytes: number;
  base64: string;
}

export interface Rc1ProjectSnapshot {
  revision: string;
  project: {
    projectId: string;
    displayName: string;
    root: string;
    safeCopy: false;
    dedicatedWorkspace: true;
    releaseVersion: string;
    releaseRoot: string;
    releaseManifestPath: string;
    projectEntry: string;
    writable: true;
    ownershipStatus: 'CONTENT_VALIDATION_ON_SAVE';
    previewUrl: string;
  };
  preset: AttachmentPlacementPreset;
  asset: AttachmentAssetDefinition;
  profile: Live2DModelProfile;
  layers: { back?: Rc1ProjectLayer; front?: Rc1ProjectLayer };
  ownership: { manifestPath: string; status: 'CONTENT_VALIDATION_ON_SAVE' };
  packageDocument: unknown;
  appliedAt?: string;
}

export interface CreatorProjectErrorDetail {
  code: string;
  message: string;
  targetPath?: string;
  cause?: string;
  suggestion?: string;
  time?: string;
  conflicts?: string[];
  /** A disconnected/timed-out write may have committed before its reply was lost. */
  commitState?: 'UNKNOWN';
}

export class CreatorProjectRequestError extends Error {
  public constructor(public readonly detail: CreatorProjectErrorDetail) {
    super(`${detail.code}: ${detail.message}`);
    this.name = 'CreatorProjectRequestError';
  }
}

const CREATOR_REQUEST_MAX_BYTES = 12 * 1024 * 1024;
export const CREATOR_PROJECT_READ_TIMEOUT_MS = 30_000;
export const CREATOR_PROJECT_WRITE_TIMEOUT_MS = 60_000;

function creatorRequestBody(value: unknown, maxBytes = CREATOR_REQUEST_MAX_BYTES) {
  const body = JSON.stringify(value);
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > maxBytes) {
    throw new CreatorProjectRequestError({
      code: 'CREATOR_REQUEST_TOO_LARGE',
      message: `请求为 ${(bytes / 1024 / 1024).toFixed(2)} MiB，超过 ${maxBytes / 1024 / 1024} MiB 上限。`,
      suggestion:
        maxBytes === CREATOR_REQUEST_MAX_BYTES
          ? '减小 PNG 文件体积或分辨率；原图不会被移动或删除。'
          : '模型复制请求过大，请检查模型及其依赖文件；原模型不会被移动或删除。',
    });
  }
  return body;
}

export interface Rc1ApplyResult {
  revision: string;
  exampleScene: string;
  ok: true;
  projectRoot: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  conflicts: string[];
  files: Array<{ path: string; bytes: number; sha256: string; status: 'created' | 'updated' | 'unchanged' }>;
  presetId: string;
  attachmentAssetId: string;
  modelProfileId: string;
  appliedAt: string;
  previewUrl: string;
}

export interface CreatorServiceContext {
  ok: true;
  importedModels?: CreatorImportedModel[];
  authoringWorkspace: {
    root: string;
    inboxRoot: string;
    attachmentRoot: string;
    status: string;
    savedAttachments: CreatorSavedAttachmentSummary[];
    availableModelProfileIds: string[];
    reviewModelProfileIds: string[];
    unavailableModelProfileCount: number;
    modelAvailabilityStatus: string;
  };
  targetProjects: Array<{
    name: string;
    root: string;
    attachmentRoot: string;
    writable: boolean;
    runtimeCompatibility: string;
  }>;
  savedAttachments: CreatorSavedAttachmentSummary[];
  builtinSamples: Array<{
    id: 'straw-hat' | 'kemomimi' | 'halo' | 'flower' | 'rose';
    name: string;
    description: string;
    presetId: string;
    files: string[];
    completeFolder?: string;
  }>;
}

export interface CreatorImportedModel {
  entryPath: string;
  source?: 'workspace';
  id: string;
  displayName: string;
  modelPath: string;
  profileIds: string[];
  dependencyCount: number;
  appearanceName?: string;
  sourceFolderName?: string;
  rootPath?: string;
  status: 'KNOWN_MOC_PROFILE_AVAILABLE' | 'NEEDS_PROFILE';
}

export interface CreatorSavedAttachmentSummary {
  revision: string;
  key: string;
  projectName: string;
  presetId: string;
  displayName: string;
  adaptationCount: number;
  modelProfileIds: string[];
  anchorNames?: string[];
  adaptationDisplayNames?: string[];
  modelPaths: string[];
}

export interface CreatorSavedAttachmentResult {
  ownershipRequiresReview?: boolean;
  ownershipDifferences?: string[];
  preferredSelection?: { modelProfileId: string; anchorName: string };
  createdAt?: string;
  revision: string;
  ok: true;
  projectName: string;
  presetId: string;
  packageDocument: unknown;
  layers: { back?: Rc1ProjectLayer; front?: Rc1ProjectLayer };
  integrity: 'HASH_VALIDATED' | 'LEGACY_FILESET_ONLY_NO_STORED_HASH' | 'USER_EDITED_REVIEW_REQUIRED' | 'FACTORY_USER_EDITED';
  integrityDifferences: Array<{
    path: string;
    status: 'CONTENT_CHANGED' | 'MANIFEST_ONLY' | 'CURRENT_FILE_NOT_IN_MANIFEST';
    expectedSha256?: string;
    currentSha256?: string;
  }>;
}

export interface CreatorAcceptAttachmentChangesResult extends CreatorSavedAttachmentResult {
  accepted: true;
  contentOverwritten: false;
  acceptedPaths: string[];
}

export type CreatorTargetModelCheckResult =
  | {
      ok: true;
      ready: true;
      projectName: string;
      modelPath: string;
      dependencyCount: number;
      status: 'TARGET_MODEL_READY';
    }
  | {
      ok: true;
      ready: false;
      projectName: string;
      modelPath: string;
      status: 'TARGET_MODEL_NOT_READY';
      warning: {
        code: 'CREATOR_TARGET_MODEL_MISSING';
        message: string;
        targetPath: string;
        suggestion: string;
      };
    };

export interface CreatorSaveToGameResult {
  revision: string;
  runtimeCompatibility: string;
  ok: true;
  projectName: string;
  projectRoot: string;
  attachmentRoot: string;
  exampleScene: string;
  builtinPresetIds: string[];
  created: string[];
  updated: string[];
  unchanged: string[];
  conflicts: string[];
  files: Array<{ path: string; bytes: number; sha256: string; status: 'created' | 'updated' | 'unchanged' }>;
  presetId: string;
  attachmentAssetId: string;
  modelProfileId: string;
  appliedAt: string;
}

export interface CreatorPreviewServiceResult {
  ok: true;
  restarted: boolean;
  previewUrl: string;
  previewPid: number;
  readiness: 'PINNED_SOURCE_FILES_SERVED';
  runtimeCompatibility: 'NOT_GUI_VALIDATED';
}

export interface CreatorOperationEvent {
  sessionId?: string;
  type: string;
  target?: string;
  result?: string;
  detail?: string;
  durationMs?: number;
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

async function jsonResponse<T>(response: Response): Promise<T> {
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new CreatorProjectRequestError({
      code: 'CREATOR_RESPONSE_INVALID',
      message: '制作器服务返回了无法读取的 JSON，请查看服务日志。',
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CreatorProjectRequestError({ code: 'CREATOR_RESPONSE_INVALID', message: '制作器服务响应结构无效。' });
  }
  if (!response.ok || (body && body.ok === false)) {
    const code = typeof body?.code === 'string' ? body.code : `HTTP_${response.status}`;
    const message = typeof body?.message === 'string' ? body.message : response.statusText;
    const conflicts = Array.isArray(body?.conflicts) ? `\n${body.conflicts.join('\n')}` : '';
    throw new CreatorProjectRequestError({
      code,
      message: `${message}${conflicts}`,
      commitState: body?.commitState === 'UNKNOWN' ? 'UNKNOWN' : undefined,
      targetPath: typeof body?.targetPath === 'string' ? body.targetPath : undefined,
      cause: typeof body?.cause === 'string' ? body.cause : undefined,
      suggestion: typeof body?.suggestion === 'string' ? body.suggestion : undefined,
      time: typeof body?.time === 'string' ? body.time : undefined,
      conflicts: Array.isArray(body?.conflicts)
        ? body.conflicts.filter((item: unknown): item is string => typeof item === 'string')
        : undefined,
    });
  }
  return body as T;
}

export function projectLayerBytes(layer: Rc1ProjectLayer) {
  const bytes = decodeBase64(layer.base64);
  if (bytes.byteLength !== layer.bytes) throw new Error(`RC1_LAYER_BYTES_MISMATCH:${layer.path}`);
  return bytes;
}

function packageBody(packageResult: CreatorPackage, lifecycleScript: string) {
  const formalFiles = packageResult.files.filter((file) => file.path.startsWith('game/'));
  return {
    presetId: packageResult.preset.presetId,
    attachmentAssetId: packageResult.preset.attachmentAssetId,
    modelProfileId: packageResult.preset.modelProfileId,
    anchorName: packageResult.preset.anchorName,
    lifecycleScript,
    files: formalFiles.map((file) => ({
      path: file.path,
      bytes: file.bytes.byteLength,
      sha256: file.sha256,
      base64: encodeBase64(file.bytes),
    })),
  };
}

export interface CreatorRequestOptions {
  signal?: AbortSignal;
}

export interface CreatorProjectClientOptions {
  /** Tests/embedded hosts may supply the trusted bootstrap token; never read it from URL or storage. */
  token?: string;
  fetcher?: typeof fetch;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

function expectedRevisionValue(revision: string | null) {
  if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/i.test(revision))) {
    throw new CreatorProjectRequestError({
      code: 'CREATOR_EXPECTED_REVISION_REQUIRED',
      message: '请先明确读取目标附件；新附件应显式使用空 revision，不能猜测覆盖版本。',
    });
  }
  return revision;
}

/** One client belongs to one workbench. Disposing A must never cancel B's requests.
 * The same-origin HTML bootstrap is authenticated by the server; the secret is never persisted.
 */
export function createCreatorProjectClient(options: CreatorProjectClientOptions = {}) {
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const active = new Set<AbortController>();
  const readTimeout = options.readTimeoutMs ?? CREATOR_PROJECT_READ_TIMEOUT_MS;
  const writeTimeout = options.writeTimeoutMs ?? CREATOR_PROJECT_WRITE_TIMEOUT_MS;
  for (const timeout of [readTimeout, writeTimeout]) {
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > CREATOR_PROJECT_WRITE_TIMEOUT_MS) {
      throw new Error('CREATOR_REQUEST_TIMEOUT_INVALID');
    }
  }
  let closed = false;
  function headers() {
    const token =
      options.token ??
      (typeof document !== 'undefined'
        ? document.querySelector<HTMLMetaElement>('meta[name="webgal-creator-session"]')?.content
        : undefined);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
      throw new CreatorProjectRequestError({
        code: 'CREATOR_SESSION_BOOTSTRAP_REQUIRED',
        message: '制作器会话尚未授权，请从本次制作器启动入口打开页面。',
      });
    }
    return { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Creator-Session': token };
  }
  async function request<T>(
    path: string,
    body: unknown | undefined,
    write: boolean,
    requestOptions: CreatorRequestOptions = {},
  ): Promise<T> {
    if (closed || requestOptions.signal?.aborted) {
      throw new CreatorProjectRequestError({ code: 'CREATOR_REQUEST_CANCELLED', message: '本次工作台操作已取消。' });
    }
    const requestHeaders = headers();
    const serialized =
      body === undefined
        ? undefined
        : creatorRequestBody(
            body,
            path === '/__creator/import-model' ? MODEL_IMPORT_BODY_BYTES : CREATOR_REQUEST_MAX_BYTES,
          );
    const controller = new AbortController();
    const timeoutMs =
      path === '/__creator/import-model' || path === '/__creator/copy-model-to-game'
        ? Math.max(writeTimeout, 300_000)
        : write
        ? writeTimeout
        : readTimeout;
    let timedOut = false;
    const cancellationError = () =>
      new CreatorProjectRequestError({
        code: timedOut ? 'CREATOR_REQUEST_TIMEOUT' : 'CREATOR_REQUEST_CANCELLED',
        message: timedOut ? '制作器服务响应超时，请检查服务日志。' : '本次工作台操作已取消。',
        suggestion: write
          ? '保存可能已在服务端完成；请重新读取目标附件核对结果，不要盲目重试覆盖。'
          : '确认制作器 CMD 仍在运行，然后重新执行该操作。',
        ...(write ? { commitState: 'UNKNOWN' as const } : {}),
      });
    const cancel = () => controller.abort();
    requestOptions.signal?.addEventListener('abort', cancel, { once: true });
    let rejectCancelled!: (error: CreatorProjectRequestError) => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancelled = reject;
    });
    const rejectAbort = () => rejectCancelled(cancellationError());
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    active.add(controller);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      // Keep timeout/cancellation ownership through JSON streaming, not just response headers.
      const operation = (async () => {
        const response = await fetcher(path, {
          method: body === undefined ? 'GET' : 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
          headers: requestHeaders,
          body: serialized,
          signal: controller.signal,
        });
        return jsonResponse<T>(response);
      })();
      const result = await Promise.race([operation, cancelled]);
      if (controller.signal.aborted) throw cancellationError();
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw cancellationError();
      // A failed reply is not evidence of a rolled-back write.
      if (write && !(error instanceof CreatorProjectRequestError)) {
        throw new CreatorProjectRequestError({
          code: 'CREATOR_REQUEST_FAILED',
          message: '制作器保存响应未能完成。',
          commitState: 'UNKNOWN',
          cause: error instanceof Error ? error.message : String(error),
          suggestion: '请重新读取目标附件核对结果，不要盲目重试覆盖。',
        });
      }
      if (write && error instanceof CreatorProjectRequestError && !error.detail.commitState &&
        (error.detail.code === 'CREATOR_RESPONSE_INVALID' || error.detail.code.startsWith('HTTP_'))) {
        throw new CreatorProjectRequestError({ ...error.detail, commitState: 'UNKNOWN' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      requestOptions.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', rejectAbort);
      active.delete(controller);
    }
  }
  return Object.freeze({
    readMeshLabels(modelPath: string, requestOptions?: CreatorRequestOptions) {
      return request<{ok: true; document: MeshLabelDocument | null; sha256: string | null; diagnostic?:string; fileName?:string}>(
        '/__creator/mesh-labels/read', {modelPath}, false, requestOptions);
    },
    saveMeshLabels(document: MeshLabelDocument, expectedSha256: string | null, acceptCurrent = false, requestOptions?: CreatorRequestOptions) {
      return request<{ok: boolean; document: MeshLabelDocument; sha256: string; conflicts?: string[]}>(
        '/__creator/mesh-labels/save', {document, expectedSha256, acceptCurrent}, true, requestOptions);
    },
    readAnchorModel(modelPath: string, requestOptions?: CreatorRequestOptions) {
      return request<{ ok: true; modelPath: string; modelJsonSha256: string; mocSha256: string }>(
        '/__creator/anchors/model', { modelPath }, false, requestOptions);
    },
    saveAnchorProfile(profile: Live2DModelProfile, expectedSha256: string | null, requestOptions?: CreatorRequestOptions) {
      return request<{ ok: boolean; profile: Live2DModelProfile; sha256: string; conflicts?: string[] }>(
        '/__creator/anchors/save', { profile, expectedSha256 }, true, requestOptions);
    },
    readAnchorProfile(modelProfileId: string, requestOptions?: CreatorRequestOptions) {
      return request<{ ok: true; profile: Live2DModelProfile; sha256: string }>(
        '/__creator/library/profile', { fileName: modelProfileId + '.json' }, false, requestOptions);
    },
    openRc1Project(presetId: string, modelProfileId: string, requestOptions?: CreatorRequestOptions, anchorName?: string) {
      return request<Rc1ProjectSnapshot>('/__rc1/project', { presetId, modelProfileId, anchorName }, false, requestOptions);
    },
    loadCreatorServiceContext(requestOptions?: CreatorRequestOptions) {
      return request<CreatorServiceContext>('/__creator/context', undefined, false, requestOptions);
    },
    loadCreatorTargetProjects(requestOptions?: CreatorRequestOptions) {
      return request<Pick<CreatorServiceContext, 'ok' | 'targetProjects'>>(
        '/__creator/target-projects', undefined, false, requestOptions,
      );
    },
    loadCreatorAuthoringAttachments(requestOptions?: CreatorRequestOptions) {
      return request<Pick<CreatorServiceContext, 'ok' | 'savedAttachments'>>(
        '/__creator/authoring-attachments', undefined, false, requestOptions,
      );
    },
    loadCreatorProjectAttachments(projectName: string, requestOptions?: CreatorRequestOptions) {
      return request<Pick<CreatorServiceContext, 'ok' | 'savedAttachments'>>(
        '/__creator/project-attachments', { projectName }, false, requestOptions,
      );
    },
    loadCreatorSavedAttachment(projectName: string, presetId: string, requestOptions?: CreatorRequestOptions) {
      return request<CreatorSavedAttachmentResult>(
        projectName === 'authoring-workspace' ? '/__creator/load-local' : '/__creator/load-attachment',
        { projectName, presetId },
        false,
        requestOptions,
      );
    },
    loadCreatorFactorySample(sampleId: string, requestOptions?: CreatorRequestOptions) {
      return request<CreatorSavedAttachmentResult>(
        '/__creator/load-factory-sample', { sampleId }, false, requestOptions,
      );
    },
    checkCreatorTargetModel(projectName: string, modelPath: string, requestOptions?: CreatorRequestOptions) {
      return request<CreatorTargetModelCheckResult>(
        '/__creator/check-target-model',
        { projectName, modelPath },
        false,
        requestOptions,
      );
    },
    importCreatorModel(
      body: { entryPath: string; displayName: string; files: Array<{ path: string; base64: string }> },
      requestOptions?: CreatorRequestOptions,
    ) {
      return request<{ ok: true; model: CreatorImportedModel; profiles: Live2DModelProfile[] }>(
        '/__creator/import-model',
        body,
        true,
        requestOptions,
      );
    },
    modelOperationStatus(requestOptions?: CreatorRequestOptions) {
      return request<{ok:true;active:boolean;phase:string;processed:number}>('/__creator/model-operation', undefined, false, requestOptions);
    },
    copyCreatorModelToGame(id: string, projectName: string, requestOptions?: CreatorRequestOptions) {
      return request<{ ok: true; modelPath: string; sourcePreserved: true; noOp?: boolean }>(
        '/__creator/copy-model-to-game',
        { id, projectName },
        true,
        requestOptions,
      );
    },
    acceptCreatorSavedAttachmentChanges(
      projectName: string,
      presetId: string,
      expectedRevision: string,
      requestOptions?: CreatorRequestOptions,
    ) {
      return request<CreatorAcceptAttachmentChangesResult>(
        projectName === 'authoring-workspace'
          ? '/__creator/accept-local-changes'
          : '/__creator/accept-attachment-changes',
        { projectName, presetId, expectedRevision: expectedRevisionValue(expectedRevision) },
        true,
        requestOptions,
      );
    },
    ensureCreatorPreview(requestOptions?: CreatorRequestOptions) {
      return request<CreatorPreviewServiceResult>('/__creator/ensure-preview', {}, false, requestOptions);
    },
    /** Acknowledges the explicit stop request, not a system-wide process/port audit. */
    shutdownCreatorService(requestOptions?: CreatorRequestOptions) {
      return request<{ ok: true; shutdown: 'REQUESTED'; scope: 'OWNED_SERVER_ONLY' }>(
        '/__creator/shutdown',
        {},
        false,
        requestOptions,
      );
    },
    applyRc1ProjectPackage(
      packageResult: CreatorPackage,
      lifecycleScript: string,
      expectedRevision: string | null,
      requestOptions?: CreatorRequestOptions,
    ) {
      return request<Rc1ApplyResult>(
        '/__rc1/apply',
        {
          ...packageBody(packageResult, lifecycleScript),
          expectedRevision: expectedRevisionValue(expectedRevision),
        },
        true,
        requestOptions,
      );
    },
    saveCreatorPackageLocally(
      packageResult: CreatorPackage,
      expectedRevision: string | null,
      requestOptions?: CreatorRequestOptions,
    ) {
      return request<CreatorSaveToGameResult>(
        '/__creator/save-local',
        { ...packageBody(packageResult, ''), expectedRevision: expectedRevisionValue(expectedRevision) },
        true,
        requestOptions,
      );
    },
    saveCreatorPackageToGame(
      projectName: string,
      packageResult: CreatorPackage,
      lifecycleScript: string,
      expectedRevision: string | null,
      requestOptions?: CreatorRequestOptions,
    ) {
      return request<CreatorSaveToGameResult>(
        '/__creator/save-to-game',
        {
          projectName,
          ...packageBody(packageResult, lifecycleScript),
          expectedRevision: expectedRevisionValue(expectedRevision),
        },
        true,
        requestOptions,
      );
    },
    /** Best-effort final audit is not a save, does not hold workbench request ownership. */
    recordCreatorOperation(event: CreatorOperationEvent) {
      if (closed) return;
      try {
        void fetcher('/__creator/events', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
          headers: headers(),
          body: creatorRequestBody(event),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* Logging must never convert an operation into failure. */
      }
    },
    cancel() {
      closed = true;
      const pending = [...active];
      for (const controller of pending) controller.abort();
      return pending.length;
    },
    diagnostics() {
      return { activeRequestCount: active.size, closed };
    },
  });
}

export type CreatorProjectClient = ReturnType<typeof createCreatorProjectClient>;
