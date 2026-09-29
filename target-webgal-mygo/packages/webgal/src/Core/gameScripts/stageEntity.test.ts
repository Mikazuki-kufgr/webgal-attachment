import cloneDeep from 'lodash/cloneDeep';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import { stageStateManager, initState } from '@/Core/Modules/stage/stageStateManager';
import {
  clearPendingCommittedStageEntities,
  createCommittedStageSnapshot,
  getPendingCommittedStageEntityCount,
} from '@/Core/Modules/stage/stageEntityPersistence';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import type {
  AttachmentEntityDetachResult,
  AttachmentEntityReattachResult,
} from '@/Core/controller/stage/pixi/attachments/AttachmentRuntime';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    gameplay: {
      performController: { completePerform: vi.fn(), arrangeNewPerform: vi.fn() },
      pixiStage: { getActiveLive2DFigure: vi.fn(() => ({ status: 'ready' })) },
    },
  },
}));
vi.mock('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton', () => ({
  attachmentRuntime: {
    cancelEntityVisibilityTransition: vi.fn(),
    cancelEntityOperation: vi.fn(),
    removeEntityTransform: vi.fn(),
    requestDetach: vi.fn(),
    prepareReattach: vi.fn(),
    commitReattach: vi.fn(),
    removeEntity: vi.fn(),
    beginEntityVisibilityTransition: vi.fn(),
    setEntityVisible: vi.fn(),
  },
}));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ refreshAttachmentPresentation: vi.fn() }));
vi.mock('./transform/performEntityTransform', () => ({ performEntityTransform: vi.fn() }));
// This cached Vitest version requires mock registration before loading the
// gameplay graph; dynamic imports keep real SDK/GUI initialization out of this
// CPU contract suite without mocking command/state transaction logic.
const { attachmentRuntime } = await import('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton');
const { WebGAL } = await import('@/Core/WebGAL');
const { stageEntity } = await import('./stageEntity');
const { performEntityTransform } = await import('./transform/performEntityTransform');
const { refreshAttachmentPresentation } = await import('@/Core/controller/stage/pixi/syncPixiStageState');

const figureKey = 'fig-center';
const attachmentId = 'test-hat';
const entityId = deriveLegacyAttachmentEntityId(figureKey, attachmentId);
const world = {
  space: 'world' as const,
  position: { x: 150, y: 250 },
  scale: { x: -2, y: 0.8 },
  rotation: 0.5,
  skew: { x: 0.1, y: -0.2 },
  opacity: 0.4,
  visible: true,
};
function sentence(action: string, args: Record<string, string | boolean | number> = {}): ISentence {
  return {
    command: commandType.stageEntity,
    commandRaw: 'stageEntity',
    content: action,
    args: Object.entries({ entity: entityId, ...args }).map(([key, value]) => ({ key, value })),
    sentenceAssets: [],
    subScene: [],
    inlineComment: '',
    isLineBreakHolder: false,
  };
}
function seed() {
  stageStateManager.replaceAllStageState({
    ...cloneDeep(initState),
    figName: 'figure/model.json',
    attachments: [{ figureKey, attachmentId, configId: 'hat', semanticAnchor: 'ear-left', visible: true }],
  });
}
function seedFree() {
  const result = stageStateManager.applyStageEntityTransaction({
    kind: 'promote-and-detach',
    entityId,
    expectedAttachment: stageStateManager.getCalculationStageState().attachments[0],
    visualState: world,
  });
  expect(result.applied).toBe(true);
  stageStateManager.commit();
}
function start(perform: ReturnType<typeof stageEntity>) {
  stageStateManager.commit();
  perform.isStarted = true;
  perform.startFunction?.();
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
function preparedReattach() {
  const prepared = { token: Symbol('reattach'), targetVisualState: { ...world, position: { x: 20, y: 30 } } };
  vi.mocked(attachmentRuntime.prepareReattach).mockResolvedValue(prepared as never);
  vi.mocked(performEntityTransform).mockReturnValue({
    performName: 'transform',
    duration: 500,
    isHoldOn: false,
    stopFunction: () => {},
    blockingNext: () => true,
    blockingAuto: () => true,
    removeTransform: vi.fn(),
    forceTransform: vi.fn(),
  });
  return prepared;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingCommittedStageEntities();
  stageStateManager.setCommitHandler(null);
  seed();
  vi.mocked(attachmentRuntime.beginEntityVisibilityTransition).mockReturnValue(true);
  vi.mocked(WebGAL.gameplay.pixiStage!.getActiveLive2DFigure).mockReturnValue({ status: 'ready' } as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  clearPendingCommittedStageEntities();
  vi.restoreAllMocks();
});

describe('Stage Entity commands on deferred host state', () => {
  it('detach neither samples Runtime nor changes state during calculation', async () => {
    const result = { entityId, figureKey, attachmentId, visualState: world } as AttachmentEntityDetachResult;
    vi.mocked(attachmentRuntime.requestDetach).mockImplementation(async (_id, finalize) => {
      finalize?.(result);
      return result;
    });
    const before = cloneDeep(stageStateManager.getCalculationStageState());
    const perform = stageEntity(sentence('detach', { continue: true }));
    expect(stageStateManager.getCalculationStageState()).toEqual(before);
    expect(attachmentRuntime.requestDetach).not.toHaveBeenCalled();
    expect(attachmentRuntime.cancelEntityOperation).not.toHaveBeenCalled();
    expect(perform.blockingStateCalculation?.()).toBe(true);
    start(perform);
    await flush();
    const state = stageStateManager.getViewStageState();
    expect(state.attachments).toHaveLength(0);
    expect(state.stageEntities[0].visualState).toEqual(world);
    expect(state.stageEntities[0].attachmentLink).toBe(null);
    expect(state.stageEntities[0].source.legacyAlias).toEqual({ originFigureKey: figureKey, attachmentId });
    expect(refreshAttachmentPresentation).toHaveBeenCalledTimes(1);
    expect(WebGAL.gameplay.performController.completePerform).toHaveBeenCalledWith(perform);
  });

  it('discarded detach leaves unchanged state and reports real-frame deferred, not success', () => {
    const before = cloneDeep(stageStateManager.getCalculationStageState());
    const perform = stageEntity(sentence('detach'));
    perform.onDiscard?.();
    expect(stageStateManager.getCalculationStageState()).toEqual(before);
    expect(attachmentRuntime.requestDetach).not.toHaveBeenCalled();
    expect(WebGAL.gameplay.performController.completePerform).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'STAGE_ENTITY_RUNTIME_SAMPLE_DEFERRED' }),
    );
  });

  it('detach subscribers see free state only after Runtime atomic ownership has finished', async () => {
    let runtimeOwnership = 'attached';
    const observed: string[] = [];
    const unsubscribe = stageStateManager.subscribe((state) => {
      if (state.stageEntities[0]?.attachmentLink === null) observed.push(runtimeOwnership);
    });
    try {
      vi.mocked(attachmentRuntime.requestDetach).mockImplementation(async (_id, finalize) => {
        const result = { entityId, figureKey, attachmentId, visualState: world } as AttachmentEntityDetachResult;
        finalize?.(result);
        expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).toBe(null);
        expect(observed).toEqual([]);
        runtimeOwnership = 'free';
        return result;
      });
      const perform = stageEntity(sentence('detach'));
      start(perform);
      await flush();
      expect(observed).toEqual(['free']);
    } finally {
      unsubscribe();
    }
  });

  it('failed detach does not emit a final-state notification or presentation refresh', async () => {
    const observer = vi.fn();
    const unsubscribe = stageStateManager.subscribe(observer);
    try {
      vi.mocked(attachmentRuntime.requestDetach).mockRejectedValue(new Error('frame failed before commit'));
      const perform = stageEntity(sentence('detach'));
      start(perform);
      const regularCommitCount = observer.mock.calls.length;
      await flush();
      expect(observer).toHaveBeenCalledTimes(regularCommitCount);
      expect(refreshAttachmentPresentation).not.toHaveBeenCalled();
      expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it.each(['detach', 'reattach'])('%s rejects explicit next with no Runtime access', (action) => {
    const perform = stageEntity(sentence(action, { next: true, figure: 'fig-left' }));
    expect(perform.performName).toBe('none');
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'STAGE_ENTITY_ASYNC_NEXT_FORBIDDEN' }));
    expect(attachmentRuntime.cancelEntityOperation).not.toHaveBeenCalled();
  });

  it.each([
    [{ space: 'world' }, 'ENTITY_SPACE_OVERRIDE_UNSUPPORTED'],
    [{ entity: ' invalid ' }, 'STAGE_ENTITY_MISSING_OR_INVALID_ID'],
    [{ entity: 'missing' }, 'ENTITY_NOT_FOUND'],
  ] as const)('rejects invalid identity/space before effects: %s', (args, code) => {
    stageEntity(sentence('hide', args));
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ code }));
    expect(attachmentRuntime.cancelEntityOperation).not.toHaveBeenCalled();
  });

  it.each(['hide', 'show'])('%s defaults to 500ms easeInOut and promotes only calculation', (action) => {
    const perform = stageEntity(sentence(action));
    expect(perform.duration).toBe(500);
    expect(stageStateManager.getCalculationStageState().stageEntities).toHaveLength(1);
    expect(stageStateManager.getViewStageState().stageEntities).toHaveLength(0);
    expect(attachmentRuntime.beginEntityVisibilityTransition).not.toHaveBeenCalled();
    start(perform);
    expect(attachmentRuntime.beginEntityVisibilityTransition).toHaveBeenCalledWith(
      entityId,
      action === 'show',
      500,
      'easeInOut',
    );
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink?.semanticAnchor).toBe('ear-left');
    perform.stopFunction('natural');
  });

  it.each([
    [-3, 0],
    ['0', 0],
    ['450', 450],
    [true, 500],
    ['', 500],
    ['   ', 500],
    [Infinity, 500],
    [NaN, 500],
  ] as const)('keeps finite-duration semantics for %s => %s', (input, expected) => {
    const perform = stageEntity(sentence('hide', { duration: input }));
    expect(perform.duration).toBe(expected);
    perform.onDiscard?.();
  });

  it('remove defaults instantaneous but Runtime deletion waits for commit', () => {
    const perform = stageEntity(sentence('remove'));
    expect(perform.duration).toBe(0);
    expect(stageStateManager.getCalculationStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    expect(attachmentRuntime.removeEntity).not.toHaveBeenCalled();
    start(perform);
    expect(attachmentRuntime.removeEntity).toHaveBeenCalledWith(entityId);
  });

  it('instant remove start cannot delete a later collected re-add', () => {
    const perform = stageEntity(sentence('remove'));
    seed();
    perform.startFunction?.();
    expect(attachmentRuntime.removeEntity).not.toHaveBeenCalled();
  });

  it('fade remove blocks calculation and preserves -next until completion', () => {
    const perform = stageEntity(sentence('remove', { duration: 200, next: true }));
    expect(perform.blockingStateCalculation?.()).toBe(true);
    expect(perform.goNextWhenOver).toBe(true);
    start(perform);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(1);
    const complete = vi.mocked(attachmentRuntime.beginEntityVisibilityTransition).mock.calls[0][4]!;
    complete();
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(WebGAL.gameplay.performController.completePerform).toHaveBeenCalledWith(perform);
  });

  it('fade removal notifies subscribers only after Runtime deletion completes', () => {
    let runtimeRemoved = false;
    const observed: boolean[] = [];
    const unsubscribe = stageStateManager.subscribe((state) => {
      if (!state.attachments.length && !state.stageEntities.length) observed.push(runtimeRemoved);
    });
    try {
      vi.mocked(attachmentRuntime.removeEntity).mockImplementation(() => {
        expect(observed).toEqual([]);
        runtimeRemoved = true;
        return true;
      });
      const perform = stageEntity(sentence('remove', { duration: 200 }));
      start(perform);
      vi.mocked(attachmentRuntime.beginEntityVisibilityTransition).mock.calls[0][4]!();
      expect(observed).toEqual([true]);
    } finally {
      unsubscribe();
    }
  });

  it('old detach finalizer cannot overwrite a changed entity declaration', async () => {
    let finalize!: NonNullable<Parameters<typeof attachmentRuntime.requestDetach>[1]>;
    vi.mocked(attachmentRuntime.requestDetach).mockImplementation((_id, callback) => {
      finalize = callback!;
      return new Promise(() => {});
    });
    const perform = stageEntity(sentence('detach'));
    start(perform);
    const hidden = stageEntity(sentence('hide', { duration: 0 }));
    start(hidden);
    const result = { entityId, figureKey, attachmentId, visualState: world } as AttachmentEntityDetachResult;
    expect(() => finalize(result)).toThrow('ENTITY_TRANSITION_TARGET_LOST');
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).not.toBe(null);
    perform.stopFunction('reset');
    hidden.stopFunction('natural');
    await flush();
  });

  it('start validation failure never cancels the new Runtime owner', async () => {
    const perform = stageEntity(sentence('detach'));
    stageStateManager.replaceAllStageState(cloneDeep(initState));
    perform.startFunction?.();
    await flush();
    expect(attachmentRuntime.cancelEntityOperation).not.toHaveBeenCalled();
    expect(attachmentRuntime.requestDetach).not.toHaveBeenCalled();
    expect(WebGAL.gameplay.performController.completePerform).toHaveBeenCalledWith(perform);
  });

  it('reattach validates parent only after commit and uses committed 500ms shared transform', async () => {
    seedFree();
    preparedReattach();
    const perform = stageEntity(
      sentence('reattach', { figure: 'fig-left', anchor: 'ear-left', profile: 'profile-b', continue: true }),
    );
    expect(attachmentRuntime.prepareReattach).not.toHaveBeenCalled();
    expect(WebGAL.gameplay.pixiStage!.getActiveLive2DFigure).not.toHaveBeenCalled();
    start(perform);
    await flush();
    expect(attachmentRuntime.prepareReattach).toHaveBeenCalledWith(
      entityId,
      'fig-left',
      undefined,
      'ear-left',
      'profile-b',
    );
    expect(performEntityTransform).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 500, ease: '', committed: true, holdNextUntilSettled: true }),
    );
    const nested = vi.mocked(WebGAL.gameplay.performController.arrangeNewPerform).mock.calls[0][1];
    expect(nested.args.some((arg) => arg.key === 'continue' || arg.key === 'next')).toBe(false);
    perform.stopFunction('reset');
  });

  it('reattach commits the normalized exact return-flight state and projection after Runtime finalizes', async () => {
    seedFree();
    preparedReattach();
    const local = { ...world, space: 'local' as const, position: { x: 0, y: 0 }, opacity: 0.7 };
    vi.mocked(attachmentRuntime.commitReattach).mockImplementation(async (_token, finalize) => {
      const result = {
        entityId,
        figureKey: 'fig-left',
        attachmentId,
        modelProfileId: 'profile-b',
        visualState: local,
      } as AttachmentEntityReattachResult;
      expect(refreshAttachmentPresentation).not.toHaveBeenCalled();
      finalize?.(result);
      expect(refreshAttachmentPresentation).not.toHaveBeenCalled();
      return result;
    });
    const perform = stageEntity(
      sentence('reattach', { figure: 'fig-left', anchor: 'ear-left', profile: 'profile-b', duration: 0 }),
    );
    start(perform);
    await flush();
    const request = vi.mocked(performEntityTransform).mock.calls[0][0];
    // CPU fixture supplies the shared performer's real normalized endpoint.
    const endpoint = stageStateManager.applyCommittedStageEntityEffect(stageStateManager.getViewStageState(), {
      target: entityId,
      transform: JSON.parse(request.animationString),
    });
    expect(endpoint.applied).toBe(true);
    const event = { reason: 'natural' as const, signal: new AbortController().signal };
    await request.onSettled?.(event);
    request.onCompleted?.(event);
    await flush();
    const state = stageStateManager.getViewStageState();
    expect(state.stageEntities[0].attachmentLink?.parentFigureKey).toBe('fig-left');
    expect(state.stageEntities[0].source.legacyAlias?.originFigureKey).toBe(figureKey);
    expect(state.attachments[0]).toMatchObject({
      figureKey: 'fig-left',
      entityId,
      semanticAnchor: 'ear-left',
      modelProfileId: 'profile-b',
    });
    expect(state.stageEntities[0].source.modelProfileId).toBe('profile-b');
    expect(state.stageEntities[0].visualState).toEqual(local);
    expect(refreshAttachmentPresentation).toHaveBeenCalledTimes(1);
    expect(perform.blockingNext()).toBe(false);
  });

  it('reattach retention starts only after committed validation and ends on reset with no stale resurrection', async () => {
    seedFree();
    const original = cloneDeep(stageStateManager.getViewStageState().stageEntities[0]);
    let resolvePrepare!: (value: Awaited<ReturnType<typeof attachmentRuntime.prepareReattach>>) => void;
    vi.mocked(attachmentRuntime.prepareReattach).mockReturnValue(
      new Promise((resolve) => {
        resolvePrepare = resolve;
      }),
    );
    const perform = stageEntity(sentence('reattach', { figure: 'fig-left' }));
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    start(perform);
    expect(getPendingCommittedStageEntityCount()).toBe(1);
    stageStateManager.applyCommittedStageEntityEffect(stageStateManager.getViewStageState(), {
      target: entityId,
      transform: { position: { x: 800, y: 900 } },
    });
    expect(createCommittedStageSnapshot(stageStateManager.getViewStageState()).stageEntities[0]).toEqual(original);
    perform.stopFunction('reset');
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    resolvePrepare({ token: Symbol('stale'), targetVisualState: world } as never);
    await flush();
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    expect(performEntityTransform).not.toHaveBeenCalled();
  });

  it('unstarted discard, stale committed target and preparation failure leave no persistence retention', async () => {
    seedFree();
    const discarded = stageEntity(sentence('reattach', { figure: 'fig-left' }));
    discarded.onDiscard?.();
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    const stale = stageEntity(sentence('reattach', { figure: 'fig-left' }));
    stageStateManager.updateEffect({ target: entityId, transform: { position: { x: 999 } } });
    start(stale);
    await flush();
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    expect(attachmentRuntime.prepareReattach).not.toHaveBeenCalled();
    vi.mocked(attachmentRuntime.prepareReattach).mockRejectedValue(new Error('prepare failed'));
    const failed = stageEntity(sentence('reattach', { figure: 'fig-left' }));
    start(failed);
    expect(getPendingCommittedStageEntityCount()).toBe(1);
    await flush();
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    expect(failed.blockingNext()).toBe(false);
  });

  it('return-flight conflict rejects finalization without rewriting the new declaration', async () => {
    seedFree();
    preparedReattach();
    vi.mocked(attachmentRuntime.commitReattach).mockImplementation(async (_token, finalize) => {
      const result = {
        entityId,
        figureKey: 'fig-left',
        attachmentId,
        visualState: { ...world, space: 'local' },
      } as AttachmentEntityReattachResult;
      finalize?.(result);
      return result;
    });
    const perform = stageEntity(sentence('reattach', { figure: 'fig-left' }));
    start(perform);
    await flush();
    const request = vi.mocked(performEntityTransform).mock.calls[0][0];
    stageStateManager.applyCommittedStageEntityEffect(stageStateManager.getViewStageState(), {
      target: entityId,
      transform: { position: { x: 999, y: 999 } },
    });
    const event = { reason: 'natural' as const, signal: new AbortController().signal };
    await request.onSettled?.(event);
    request.onCompleted?.(event);
    expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).toBe(null);
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.position).toEqual({ x: 999, y: 999 });
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENTITY_TRANSITION_TARGET_LOST' }));
    expect(perform.blockingNext()).toBe(false);
    expect(getPendingCommittedStageEntityCount()).toBe(0);
  });

  it('reattach subscriber sees attached state only after Runtime commits its internal maps', async () => {
    seedFree();
    preparedReattach();
    let runtimeOwnership = 'free';
    const observed: string[] = [];
    const unsubscribe = stageStateManager.subscribe((state) => {
      if (state.stageEntities[0]?.attachmentLink) observed.push(runtimeOwnership);
    });
    try {
      vi.mocked(attachmentRuntime.commitReattach).mockImplementation(async (_token, finalize) => {
        const result = {
          entityId,
          figureKey: 'fig-left',
          attachmentId,
          visualState: { ...world, space: 'local' },
        } as AttachmentEntityReattachResult;
        finalize?.(result);
        expect(observed).toEqual([]);
        runtimeOwnership = 'attached';
        return result;
      });
      const perform = stageEntity(sentence('reattach', { figure: 'fig-left' }));
      start(perform);
      await flush();
      const request = vi.mocked(performEntityTransform).mock.calls[0][0];
      stageStateManager.applyCommittedStageEntityEffect(stageStateManager.getViewStageState(), {
        target: entityId,
        transform: JSON.parse(request.animationString),
      });
      const event = { reason: 'natural' as const, signal: new AbortController().signal };
      await request.onSettled?.(event);
      request.onCompleted?.(event);
      await flush();
      expect(observed).toEqual(['attached']);
    } finally {
      unsubscribe();
    }
  });

  it('replacement transform retires only prepared reattach, not the new transform owner', async () => {
    seedFree();
    preparedReattach();
    const perform = stageEntity(sentence('reattach', { figure: 'fig-left' }));
    start(perform);
    await flush();
    const request = vi.mocked(performEntityTransform).mock.calls[0][0];
    const aborted = new AbortController();
    aborted.abort();
    const event = { reason: 'replaced' as const, signal: aborted.signal };
    await request.onSettled?.(event);
    request.onCompleted?.(event);
    expect(attachmentRuntime.commitReattach).not.toHaveBeenCalled();
    expect(attachmentRuntime.removeEntityTransform).not.toHaveBeenCalled();
    expect(perform.blockingNext()).toBe(false);
    expect(getPendingCommittedStageEntityCount()).toBe(0);
  });

  it.each(['absent', 'ambiguous', 'exiting', 'loading', 'unsupported'])(
    'reattach rejects %s parent and releases blocking',
    async (status) => {
      seedFree();
      vi.mocked(WebGAL.gameplay.pixiStage!.getActiveLive2DFigure).mockReturnValue({
        status,
        uuids: ['a', 'b'],
      } as never);
      const perform = stageEntity(sentence('reattach', { figure: 'fig-left' }));
      start(perform);
      await flush();
      expect(attachmentRuntime.prepareReattach).not.toHaveBeenCalled();
      expect(perform.blockingNext()).toBe(false);
      expect(stageStateManager.getViewStageState().stageEntities[0].attachmentLink).toBe(null);
      expect(getPendingCommittedStageEntityCount()).toBe(0);
    },
  );
});
