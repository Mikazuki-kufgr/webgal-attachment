export interface SceneDocumentSaveRequest {
  path: string;
  textFile: string;
  saveSessionId: string;
  revision: number;
  contentHash: string;
  verifyOnly?: boolean;
}

export interface SceneDocumentSaveResponse {
  ok: true;
  path: string;
  saveSessionId: string;
  revision: number;
  contentHash: string;
  idempotent?: boolean;
  verifiedCurrent?: boolean;
}

export type SceneDocumentSaveTransport = (
  request: SceneDocumentSaveRequest,
) => Promise<SceneDocumentSaveResponse>;

export interface SceneDocumentSaveReceipt {
  status: 'saved' | 'superseded';
  request: SceneDocumentSaveRequest;
  response: SceneDocumentSaveResponse;
}

interface SceneDocumentDraft {
  path: string;
  textFile: string;
  revision: number;
  contentHash: Promise<string>;
}

interface SceneDocumentState {
  nextRevision: number;
  latestDraft?: SceneDocumentDraft;
  committedRevision?: number;
  committedHash?: string;
  failedRevision?: number;
  tail: Promise<void>;
  pendingByRevision: Map<number, Promise<SceneDocumentSaveReceipt>>;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Utf8(text: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('Web Crypto is required to version scene saves');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function validateResponse(
  request: SceneDocumentSaveRequest,
  response: SceneDocumentSaveResponse,
): SceneDocumentSaveResponse {
  if (
    response?.ok !== true ||
    response.saveSessionId !== request.saveSessionId ||
    response.revision !== request.revision ||
    response.contentHash.toLowerCase() !== request.contentHash ||
    (request.verifyOnly && response.verifiedCurrent !== true)
  ) {
    throw new Error('Scene save response does not match the submitted revision');
  }
  return response;
}

export class SceneDocumentSaveCoordinator {
  private readonly documents = new Map<string, SceneDocumentState>();
  private saveSessionId: string;
  private saveSessionFork = 0;
  private renaming = false;
  private readonly retiredPaths = new Set<string>();

  public reopen(path: string): void {
    if (!this.renaming && this.retiredPaths.delete(path)) {
      this.saveSessionId = `${this.saveSessionId}:reopen-${++this.saveSessionFork}`;
    }
  }

  public async rename(source: string, target: string, operation: () => Promise<void>, commit: () => void): Promise<void> {
    if (this.renaming) throw new Error('正在重命名，请稍后重试。');
    const matches = (value: string, base: string) => value === base || value.startsWith(base + '/');
    const affected = [...this.documents].filter(([key]) => matches(key, source));
    for (const [key, state] of this.documents) {
      if ((matches(key, source) || matches(key, target)) &&
          (this.hasDirtyDraft(key) || state.pendingByRevision.size > 0)) {
        throw new Error('剧情尚未保存或正在保存，请等待保存成功后再重命名。当前内容已保留。');
      }
    }
    this.renaming = true;
    try {
      await operation();
      for (const [key, state] of affected) {
        const newPath = target + key.slice(source.length);
        this.documents.delete(key);
        this.retiredPaths.add(key);
        this.retiredPaths.delete(newPath);
        if (state.latestDraft) state.latestDraft.path = newPath;
        this.documents.set(newPath, state);
      }
      commit();
    } finally {
      this.renaming = false;
    }
  }

  public constructor(saveSessionId: string) {
    if (saveSessionId.trim() === '') {
      throw new Error('Scene save session ID must not be empty');
    }
    this.saveSessionId = saveSessionId;
  }

  public stage(path: string, textFile: string): number {
    if (this.retiredPaths.has(path)) throw new Error('文件已重命名，请使用新标签继续编辑。');
    const state = this.getState(path);
    if (state.latestDraft?.textFile === textFile) {
      return state.latestDraft.revision;
    }
    const revision = state.nextRevision;
    state.nextRevision += 1;
    state.latestDraft = {
      path,
      textFile,
      revision,
      contentHash: sha256Utf8(textFile),
    };
    return revision;
  }

  public acceptPersisted(path: string, textFile: string): boolean {
    if (this.renaming || this.retiredPaths.has(path)) return false;
    const state = this.getState(path);
    if (this.hasDirtyDraft(path)) return false;
    const revision = state.nextRevision;
    state.nextRevision += 1;
    const contentHash = sha256Utf8(textFile);
    state.latestDraft = { path, textFile, revision, contentHash };
    state.committedRevision = revision;
    contentHash.then((hash) => {
      if (state.committedRevision === revision) state.committedHash = hash;
    });
    return true;
  }

  public getLatestText(path: string): string | undefined {
    return this.documents.get(path)?.latestDraft?.textFile;
  }

  public hasDirtyDraft(path: string): boolean {
    const state = this.documents.get(path);
    if (!state?.latestDraft) return false;
    return state.latestDraft.revision !== state.committedRevision || state.failedRevision === state.latestDraft.revision;
  }

  public save(
    path: string,
    textFile: string,
    transport: SceneDocumentSaveTransport,
  ): Promise<SceneDocumentSaveReceipt> {
    this.stage(path, textFile);
    if (this.renaming) return Promise.reject(new Error('正在重命名，当前草稿已保留，请稍后保存。'));
    const state = this.getState(path);
    const draft = state.latestDraft!;

    const pending = state.pendingByRevision.get(draft.revision);
    if (pending) return pending;

    const operation = state.tail.catch(() => undefined).then(async () => {
      const contentHash = await draft.contentHash;
      const request: SceneDocumentSaveRequest = {
        path,
        textFile: draft.textFile,
        saveSessionId: this.saveSessionId,
        revision: draft.revision,
        contentHash,
        // A historical receipt is not proof that another writer left the file unchanged.
        // This also covers a clean document loaded before this server session existed.
        ...(state.committedRevision === draft.revision ? { verifyOnly: true } : {}),
      };
      const response = validateResponse(request, await transport(request));
      state.committedRevision = draft.revision;
      state.committedHash = contentHash;
      if (state.failedRevision === draft.revision) state.failedRevision = undefined;
      return {
        status: state.latestDraft?.revision === draft.revision ? ('saved' as const) : ('superseded' as const),
        request,
        response,
      };
    });

    // Keep a failed verification protected from background reloads as a draft.
    operation.catch(() => { state.failedRevision = draft.revision; });
    state.pendingByRevision.set(draft.revision, operation);
    state.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    const clearPending = () => {
      if (state.pendingByRevision.get(draft.revision) === operation) {
        state.pendingByRevision.delete(draft.revision);
      }
    };
    operation.then(clearPending, clearPending);
    return operation;
  }

  public async saveAndRun(
    path: string,
    textFile: string,
    options: {
      transport: SceneDocumentSaveTransport;
      run: (receipt: SceneDocumentSaveReceipt) => void | Promise<void>;
    },
  ): Promise<boolean> {
    const receipt = await this.save(path, textFile, options.transport);
    if (this.renaming || this.retiredPaths.has(path) || receipt.status !== 'saved' || this.getState(path).latestDraft?.revision !== receipt.request.revision) {
      return false;
    }
    await options.run(receipt);
    return true;
  }

  private getState(path: string): SceneDocumentState {
    const existing = this.documents.get(path);
    if (existing) return existing;
    const state: SceneDocumentState = {
      nextRevision: 1,
      tail: Promise.resolve(),
      pendingByRevision: new Map(),
    };
    this.documents.set(path, state);
    return state;
  }
}
