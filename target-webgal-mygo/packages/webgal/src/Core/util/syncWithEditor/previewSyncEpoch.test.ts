import cloneDeep from 'lodash/cloneDeep';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initState, stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { SceneManager } from '@/Core/Modules/scene';
import {
  beginSceneMutation,
  getSceneMutationEpochForDiagnostics,
  inheritSceneMutationToken,
  isSceneMutationCurrent,
} from '@/Core/controller/scene/sceneMutationEpoch';
import {
  createRequestEnvelope,
  createResponseEnvelope,
  EDITOR_PREVIEW_PROTOCOL_V1_SUBPROTOCOL,
} from '@/types/editorPreviewProtocol';
import type { AnyProtocolEnvelope, PreviewCommandType, RequestPayloadByType } from '@/types/editorPreviewProtocol';
import type { PreviewSyncTransportOptions, PreviewSyncTransportSocket } from './runtime/previewSyncTransport';
import type { PreviewSyncSceneCommandCallbacks } from './runtime/previewSyncSceneCommand';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    gameKey: 'fixture-game',
    sceneManager: undefined,
    events: { styleUpdate: { emit: vi.fn() } },
    gameplay: { isFastPreview: false, pixiStage: { removeAnimationByTargetKey: vi.fn() } },
  },
}));
vi.mock('@/store/store', () => ({ webgalStore: { dispatch: vi.fn(), getState: () => ({ GUI: {} }) } }));
vi.mock('@/store/GUIReducer', () => ({
  setVisibility: (payload: unknown) => ({ type: 'visibility', payload }),
  setFontOptimization: vi.fn(),
}));
vi.mock('@/Core/parser/sceneParser', () => ({ sceneParser: vi.fn(), WebgalParser: { parse: vi.fn() } }));
vi.mock('@/Core/controller/gamePlay/runScript', () => ({ runScript: vi.fn() }));
vi.mock('@/Core/controller/gamePlay/nextSentence', () => ({ continueSentence: vi.fn() }));
vi.mock('@/Core/controller/stage/resetStage', () => ({ resetStage: vi.fn(() => true) }));
vi.mock('@/Core/util/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ applyStageEffectToTarget: vi.fn() }));
vi.mock('./runtime/embeddedPreviewBootstrap', () => ({ requestEmbeddedLaunchId: vi.fn(async () => 'fixture-launch') }));
vi.mock('./runtime/previewSyncTransport', () => ({ createPreviewSyncTransport: vi.fn() }));
vi.mock('./runtime/previewSyncSceneCommand', () => ({ executePreviewSyncSceneCommand: vi.fn() }));
vi.mock('@/Core/Modules/readHistory', () => ({ setDebugTextReadMode: vi.fn() }));
vi.mock('./runtime/previewDebugVariables', () => ({ applyPreviewDebugVariables: vi.fn() }));
vi.mock('./runtime/handlers/referenceBoxQueryHandler', () => ({ handleReferenceBoxQuery: vi.fn() }));

const { WebGAL } = await import('@/Core/WebGAL');
const { createPreviewSyncTransport } = await import('./runtime/previewSyncTransport');
const { executePreviewSyncSceneCommand } = await import('./runtime/previewSyncSceneCommand');
const { sceneParser, WebgalParser } = await import('@/Core/parser/sceneParser');
const { runScript } = await import('@/Core/controller/gamePlay/runScript');
const { continueSentence } = await import('@/Core/controller/gamePlay/nextSentence');
const { resetStage } = await import('@/Core/controller/stage/resetStage');
const { startPreviewSyncRuntime } = await import('./previewSyncRuntime');

let callbacks: PreviewSyncTransportOptions;
const sent: AnyProtocolEnvelope[] = [];
const socket: PreviewSyncTransportSocket = {
  readyState: 1,
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
  send: vi.fn(),
  close: vi.fn(),
};
const fakeWindow = { location: { protocol: 'http:', hostname: '127.0.0.1', port: '3000' }, addEventListener: vi.fn() };
const previousWindow = globalThis.window,
  previousDocument = globalThis.document;
const transport = {
  connect: vi.fn(),
  ensureConnected: vi.fn(),
  dispose: vi.fn(),
  send: vi.fn((envelope: unknown) => {
    sent.push(envelope as AnyProtocolEnvelope);
    return true;
  }),
  isSocketOpen: () => true,
  isActiveSocket: () => true,
};
function message(envelope: unknown) {
  callbacks.onMessage(JSON.stringify(envelope), socket);
}
function command<T extends PreviewCommandType>(type: T, payload: RequestPayloadByType[T]) {
  message(createRequestEnvelope(type, `fixture-${type}`, payload));
}
function latestSyncCallbacks(): PreviewSyncSceneCommandCallbacks {
  return vi.mocked(executePreviewSyncSceneCommand).mock.calls.at(-1)![1]!;
}
function snapshotEvents() {
  return sent.filter((value) => value.kind === 'event' && value.type === 'stage.snapshot.updated');
}
function parsed(name: string) {
  return { sceneName: name, sceneUrl: `${name}.txt`, sentenceList: [], assetsList: [], subSceneList: [] };
}
async function register() {
  await callbacks.onOpen(socket);
  const registration = [...sent]
    .reverse()
    .find((value) => value.kind === 'request' && value.type === 'session.register-preview');
  if (!registration || registration.kind !== 'request') throw new Error('Registration not sent');
  message(createResponseEnvelope('session.register-preview', registration.requestId, {}));
}
beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
  (globalThis as unknown as { document: unknown }).document = {
    querySelector: () => null,
    addEventListener: vi.fn(),
    visibilityState: 'visible',
  };
  vi.mocked(createPreviewSyncTransport).mockImplementation((options) => {
    callbacks = options;
    return transport;
  });
  WebGAL.sceneManager = new SceneManager();
  startPreviewSyncRuntime();
});
beforeEach(async () => {
  callbacks.onConnecting?.();
  beginSceneMutation('stage-reset');
  vi.useFakeTimers();
  WebGAL.sceneManager = new SceneManager();
  WebGAL.sceneManager.sceneData.currentScene = parsed('old');
  WebGAL.gameplay.isFastPreview = false;
  stageStateManager.setCommitHandler(null);
  stageStateManager.replaceAllStageState(cloneDeep(initState));
  vi.mocked(executePreviewSyncSceneCommand).mockClear();
  vi.mocked(runScript).mockReset();
  vi.mocked(continueSentence).mockClear();
  vi.mocked(resetStage).mockClear();
  vi.mocked(sceneParser).mockImplementation((raw) => parsed(raw));
  vi.mocked(WebgalParser.parse).mockReturnValue(parsed('snippet'));
  sent.length = 0;
  await register();
  sent.length = 0;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
afterAll(() => {
  const pagehide = fakeWindow.addEventListener.mock.calls.find((call) => call[0] === 'pagehide')?.[1] as
    | (() => void)
    | undefined;
  pagehide?.();
  (globalThis as unknown as { window: unknown }).window = previousWindow;
  (globalThis as unknown as { document: unknown }).document = previousDocument;
});

describe('actual editor V1 command frontdoor scene ownership', () => {
  it('COORD01 returns author baseline and previews/commits exactly one native origin offset', async () => {
    const { initialLegacyAttachmentLocalVisualState, legacyAttachmentLink } = await import(
      '@/Core/Modules/stage/stageEntityStateTransaction'
    );
    const { applyStageEffectToTarget } = await import('@/Core/controller/stage/pixi/syncPixiStageState');
    const local = initialLegacyAttachmentLocalVisualState();
    const attachment = { figureKey: 'actor', attachmentId: 'rose', entityId: 'rose', configId: 'rose', visible: true };
    expect(
      stageStateManager.applyStageEntityTransaction({
        kind: 'upsert-explicit-attachment',
        attachment,
        entity: {
          schemaVersion: 0,
          entityId: 'rose',
          renderableKind: 'attachment-sprite-group',
          source: { configId: 'rose', legacyAlias: { originFigureKey: 'actor', attachmentId: 'rose' } },
          visualState: local,
          attachmentLink: legacyAttachmentLink(attachment, local),
        },
      }).applied,
    ).toBe(true);
    expect(
      stageStateManager.applyStageEntityTransaction({
        kind: 'detach',
        entityId: 'rose',
        freePositionOrigin: { x: 850, y: 800 },
        visualState: { ...local, space: 'world', position: { x: 1000, y: 650 } },
      }).applied,
    ).toBe(true);
    stageStateManager.commit();
    command('preview.command.sync-scene', { sceneName: 'new', sentenceId: 3, transformBaselineRevision: 'coord' });
    latestSyncCallbacks().onBeforeTargetScriptExecute?.();
    latestSyncCallbacks().onSettled?.({
      sceneName: 'new',
      sentenceId: 3,
      isTimedOut: false,
      stopReason: 'target-reached',
    });
    command('preview.command.set-effect', { target: 'rose', phase: 'preview', transform: { position: { x: -180 } } });
    expect(applyStageEffectToTarget).toHaveBeenLastCalledWith(
      'rose',
      expect.objectContaining({ position: { x: 670, y: 650 } }),
    );
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.position).toEqual({ x: 1000, y: 650 });
    command('preview.command.set-effect', { target: 'rose', phase: 'commit', transform: { position: { x: -180 } } });
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.position).toEqual({ x: 670, y: 650 });
  });

  it('preserves V1 registration and rejects unregistered scene requests without an epoch', () => {
    expect(callbacks.subprotocol).toBe(EDITOR_PREVIEW_PROTOCOL_V1_SUBPROTOCOL);
    expect(callbacks.url).toBe('ws://127.0.0.1:3000/api/webgalsync');
    callbacks.onClose?.(socket);
    const epoch = getSceneMutationEpochForDiagnostics();
    command('preview.command.sync-scene', { sceneName: 'new', sentenceId: 3 });
    expect(getSceneMutationEpochForDiagnostics()).toBe(epoch);
    expect(executePreviewSyncSceneCommand).not.toHaveBeenCalled();
  });

  it('passes current epoch and unchanged payload/revision semantics through V1 sync', () => {
    const payload = {
      sceneName: 'new',
      sentenceId: 3,
      settleMode: 'immediate' as const,
      transformBaselineRevision: 'revision-7',
    };
    command('preview.command.sync-scene', payload);
    expect(vi.mocked(executePreviewSyncSceneCommand).mock.calls[0][0]).toEqual(payload);
    const owner = latestSyncCallbacks();
    expect(owner.mutation?.source).toBe('terre-sync');
    expect(owner.isLatest?.()).toBe(true);
    expect(sent.some((value) => value.kind === 'response' && value.type === 'preview.command.sync-scene')).toBe(true);
    owner.onBeforeTargetScriptExecute?.();
    owner.onSettled?.({ sceneName: 'new', sentenceId: 3, isTimedOut: false, stopReason: 'target-reached' });
    expect(snapshotEvents()).toHaveLength(1);
  });

  it.each(['state-calculation-failed', 'state-calculation-cancelled'] as const)(
    'does not publish a falsely settled target snapshot when Runtime continuation is %s',
    (stopReason) => {
      command('preview.command.sync-scene', { sceneName: 'new', sentenceId: 3 });
      const owner = latestSyncCallbacks();
      owner.onSettled?.({ sceneName: 'new', sentenceId: 1, isTimedOut: false, stopReason });
      expect(snapshotEvents()).toHaveLength(0);
    },
  );

  it('external start retires pending revision even without old completion, allowing new snapshots', () => {
    command('preview.command.sync-scene', { sceneName: 'old-request', sentenceId: 3 });
    const owner = latestSyncCallbacks();
    WebGAL.gameplay.isFastPreview = true;
    stageStateManager.replaceAllStageState({ ...cloneDeep(initState), figName: 'suppressed' });
    expect(snapshotEvents()).toHaveLength(0);
    const start = beginSceneMutation('start-game');
    expect(owner.mutation?.signal.aborted).toBe(true);
    expect(owner.isLatest?.()).toBe(false);
    expect(WebGAL.gameplay.isFastPreview).toBe(false);
    stageStateManager.replaceAllStageState({ ...cloneDeep(initState), figName: 'new-start' });
    expect(snapshotEvents()).toHaveLength(1);
    owner.onSettled?.({ sceneName: 'old-request', sentenceId: 3, isTimedOut: false, stopReason: 'target-reached' });
    expect(snapshotEvents()).toHaveLength(1);
    expect(isSceneMutationCurrent(start)).toBe(true);
  });

  it('late connection close does not invalidate external ownership or clear its preview flag', () => {
    command('preview.command.sync-scene', { sceneName: 'old-request', sentenceId: 3 });
    const external = beginSceneMutation('load-game');
    WebGAL.gameplay.isFastPreview = true;
    callbacks.onClose?.(socket);
    expect(isSceneMutationCurrent(external)).toBe(true);
    expect(WebGAL.gameplay.isFastPreview).toBe(true);
  });

  it('connection close invalidates a currently owned sync and its blocked revision', () => {
    command('preview.command.sync-scene', { sceneName: 'new', sentenceId: 3 });
    const owner = latestSyncCallbacks();
    WebGAL.gameplay.isFastPreview = true;
    callbacks.onClose?.(socket);
    expect(owner.mutation?.signal.aborted).toBe(true);
    expect(WebGAL.gameplay.isFastPreview).toBe(false);
    expect(owner.isLatest?.()).toBe(false);
  });

  it('temp-scene timer cannot continue a newer load and reset keeps the parent token', () => {
    command('preview.command.run-scene-content', { sceneContent: 'temp-text' });
    expect(WebGAL.sceneManager.sceneData.currentScene.sceneName).toBe('temp-text');
    const options = vi.mocked(resetStage).mock.calls[0][2];
    expect(options?.mutation?.source).toBe('terre-temp');
    const newer = beginSceneMutation('load-game');
    vi.advanceTimersByTime(100);
    expect(continueSentence).not.toHaveBeenCalled();
    expect(isSceneMutationCurrent(newer)).toBe(true);
  });

  it('temp-scene continuation inherits the exact scene token', () => {
    command('preview.command.run-scene-content', { sceneContent: 'temp-text' });
    const mutation = vi.mocked(resetStage).mock.calls[0][2]?.mutation;
    vi.mocked(continueSentence).mockImplementation(() => {
      expect(inheritSceneMutationToken()).toBe(mutation);
      return undefined;
    });
    vi.advanceTimersByTime(100);
    expect(continueSentence).toHaveBeenCalledTimes(1);
  });

  it('snippet scripts share a parent token and stop when a synchronous script supersedes it', () => {
    const scene = parsed('snippet');
    vi.mocked(WebgalParser.parse).mockReturnValue({
      ...scene,
      sentenceList: [
        {
          command: 0,
          commandRaw: 'say',
          content: 'first',
          args: [],
          inlineComment: '',
          isLineBreakHolder: false,
          startLine: 0,
          endLine: 0,
          sentenceAssets: [],
          subScene: [],
        },
        {
          command: 1,
          commandRaw: 'changeBg',
          content: 'second',
          args: [],
          inlineComment: '',
          isLineBreakHolder: false,
          startLine: 0,
          endLine: 0,
          sentenceAssets: [],
          subScene: [],
        },
      ],
    });
    vi.mocked(runScript).mockImplementation(() => {
      expect(inheritSceneMutationToken()?.source).toBe('terre-snippet');
      beginSceneMutation('load-game');
      return undefined;
    });
    command('preview.command.run-snippet', { snippet: 'first\nsecond' });
    expect(runScript).toHaveBeenCalledTimes(1);
  });
});
