import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { stageStateManager, initState } from '@/Core/Modules/stage/stageStateManager';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import type {
  AttachmentRuntimeEvent,
  AttachmentFirstValidPoseWaitResult,
  AttachmentInstanceSnapshot,
} from '@/Core/controller/stage/pixi/attachments/types';
import type { PerformController as ControllerType } from '@/Core/Modules/perform/performController';
vi.mock('@/Core/controller/gamePlay/nextSentence', () => ({ continueSentence: vi.fn() }));
vi.mock('@/Core/WebGAL', () => ({
  WebGAL: { sceneManager: { lockSceneWrite: false }, gameplay: { performController: undefined } },
}));
vi.mock('@/Core/gameScripts/stageEntity', () => ({
  stageEntity: vi.fn(() => ({
    performName: 'none',
    duration: 0,
    isHoldOn: false,
    stopFunction() {},
    blockingNext: () => false,
    blockingAuto: () => false,
  })),
}));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ refreshAttachmentPresentation: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton', () => ({
  attachmentRuntime: {
    get: vi.fn(),
    figureGeneration: vi.fn(() => 'g1'),
    subscribe: vi.fn(() => () => {}),
    waitForFirstValidPose: vi.fn(),
    beginEntityVisibilityTransition: vi.fn(() => true),
    cancelEntityVisibilityTransition: vi.fn(),
    setEntityVisible: vi.fn(() => true),
  },
}));
const { PerformController } = await import('@/Core/Modules/perform/performController');
const { WebGAL } = await import('@/Core/WebGAL');
const { attachmentRuntime: runtime } = await import(
  '@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton'
);
const { attachment } = await import('./attachment');
const { stageEntity } = await import('./stageEntity');
const { getPendingAttachmentAddIntentCount } = await import('./stageEntityCommandState');
const { deriveLegacyAttachmentEntityId } = await import('@/Core/controller/stage/pixi/attachments/stageEntityIdentity');
const {
  getAttachmentCommandPresentationCounts,
  projectAttachmentCommandPresentation,
  isAttachmentAddFailureCommandOwned,
} = await import('@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation');
let controller: ControllerType;
let listeners: Set<(event: AttachmentRuntimeEvent) => void>;
let fadeEnd: (() => void) | undefined;
const sentence = (action = 'add', extra: Record<string, string | number | boolean> = {}): ISentence => ({
  command: commandType.attachment,
  commandRaw: 'attachment',
  content: action,
  args: Object.entries({ figure: 'fig-center', id: 'hat', config: 'new', ...extra }).map(([key, value]) => ({
    key,
    value,
  })),
  sentenceAssets: [],
  subScene: [],
  inlineComment: '',
  isLineBreakHolder: false,
});
function collect(s: ISentence): IPerform {
  controller.beginCollectingPerforms();
  const p = attachment(s);
  controller.arrangeNewPerform(p, s);
  controller.endCollectingPerforms();
  return p;
}
function commit() {
  stageStateManager.commit();
  controller.commitPendingPerforms();
}
async function microtasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
function publish(phase: 'ready' | 'error', configId = 'new') {
  const snapshot: AttachmentInstanceSnapshot = {
    figureKey: 'fig-center',
    attachmentId: 'hat',
    entityId: 'attachment:fig-center:hat',
    figureGeneration: 'g1',
    configId,
    phase,
    firstValidPose: { status: 'pending' },
    visible: false,
    error: phase === 'error' ? 'bad config' : undefined,
  };
  // Actual derived IDs are intentionally not guessed here.
  delete snapshot.entityId;
  vi.mocked(runtime.get).mockReturnValue(snapshot);
  for (const listener of [...listeners])
    listener({ type: phase === 'error' ? 'instance-error' : 'instance-changed', instance: snapshot });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listeners = new Set();
  fadeEnd = undefined;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(runtime.get).mockReturnValue(undefined);
  vi.mocked(runtime.subscribe).mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  vi.mocked(runtime.waitForFirstValidPose).mockImplementation(async (figureKey, attachmentId) => {
    const instance = runtime.get(figureKey, attachmentId);
    if (!instance) throw new Error('mock attachment missing');
    return { status: 'ready', instance };
  });
  vi.mocked(runtime.beginEntityVisibilityTransition).mockImplementation((_id, _visible, _duration, _ease, done) => {
    fadeEnd = done;
    return true;
  });
  stageStateManager.setCommitHandler(null);
  stageStateManager.resetAllStageState({ ...cloneDeep(initState), figName: 'model.json' });
  controller = new PerformController();
  WebGAL.gameplay.performController = controller;
});
afterEach(() => {
  controller.removeAllPerform();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(getPendingAttachmentAddIntentCount()).toBe(0);
  expect(getAttachmentCommandPresentationCounts()).toEqual({ visibility: 0, visuals: 0, addFailures: 0 });
  expect(listeners.size).toBe(0);
});

describe('attachment commands with actual calculation/view and perform controller', () => {
  it('calculates hidden default add without Runtime, timers or view changes until commit', () => {
    collect(sentence());
    expect(stageStateManager.getCalculationStageState().attachments[0].visible).toBe(false);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(runtime.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    commit();
    expect(runtime.subscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });
  it('carries an explicit Profile identity from attachment:add into both persistent representations', () => {
    collect(sentence('add', { entity: 'entity-hat', profile: 'profile-b' }));
    const calculated = stageStateManager.getCalculationStageState();
    expect(calculated.attachments[0].modelProfileId).toBe('profile-b');
    expect(calculated.stageEntities[0].source.modelProfileId).toBe('profile-b');
    commit();
    expect(stageStateManager.getViewStageState().attachments[0].modelProfileId).toBe('profile-b');
    controller.removeAllPerform();
  });
  it('waits past fade duration, then requires both true fade completion and first-pose supervision', async () => {
    let resolvePose!: (value: { status: 'ready'; instance: AttachmentInstanceSnapshot }) => void;
    vi.mocked(runtime.waitForFirstValidPose).mockImplementationOnce(
      () => new Promise<AttachmentFirstValidPoseWaitResult>((resolve) => (resolvePose = resolve)),
    );
    collect(sentence());
    commit();
    vi.advanceTimersByTime(900);
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(false);
    expect(controller.performList).toHaveLength(1);
    publish('ready');
    expect(runtime.beginEntityVisibilityTransition).toHaveBeenCalledWith(
      expect.any(String),
      true,
      500,
      'easeInOut',
      expect.any(Function),
    );
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(true);
    expect(controller.performList).toHaveLength(1);
    fadeEnd?.();
    expect(controller.performList).toHaveLength(1);
    resolvePose({ status: 'ready', instance: runtime.get('fig-center', 'hat')! });
    await microtasks();
    expect(controller.performList).toHaveLength(0);
  });
  it('explicit add followed by calculated transform keeps readiness and latest endpoint state', () => {
    collect(sentence('add', { entity: 'entity-hat' }));
    stageStateManager.updateEffect({ target: 'entity-hat', transform: { position: { x: 70, y: 20 }, alpha: 0.6 } });
    commit();
    publish('ready');
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(true);
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.position).toEqual({ x: 70, y: 20 });
    expect(stageStateManager.getViewStageState().stageEntities[0].visualState.opacity).toBe(0.6);
    fadeEnd?.();
  });
  it('makes explicit zero duration visible in calculation and has no readiness owner', () => {
    collect(sentence('add', { duration: 0 }));
    expect(stageStateManager.getCalculationStageState().attachments[0].visible).toBe(true);
    commit();
    expect(runtime.subscribe).not.toHaveBeenCalled();
    expect(getPendingAttachmentAddIntentCount()).toBe(0);
    vi.runOnlyPendingTimers();
  });
  it.each([true, false, '', '   ', Infinity, NaN])('uses finite safe default for invalid duration %s', (duration) => {
    const p = collect(sentence('add', { duration }));
    expect(p.duration).toBe(500);
    controller.discardUncommittedNonHoldPerforms(true);
  });
  it('settles a discarded fast-preview add only in calculation, without Runtime', () => {
    collect(sentence());
    controller.discardUncommittedNonHoldPerforms(true);
    expect(stageStateManager.getCalculationStageState().attachments[0].visible).toBe(true);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(runtime.subscribe).not.toHaveBeenCalled();
  });
  it('settles explicit add visibility after a calculated entity transform without reverting its latest endpoint', () => {
    collect(sentence('add', { entity: 'entity-hat' }));
    stageStateManager.updateEffect({
      target: 'entity-hat',
      transform: { position: { x: 70, y: 20 }, alpha: 0.6 },
    });

    controller.discardUncommittedNonHoldPerforms(true);

    const calculated = stageStateManager.getCalculationStageState();
    expect(calculated.attachments[0].visible).toBe(true);
    expect(calculated.stageEntities[0].visualState.visible).toBe(true);
    expect(calculated.stageEntities[0].visualState.position).toEqual({ x: 70, y: 20 });
    expect(calculated.stageEntities[0].visualState.opacity).toBe(0.6);
    expect(calculated.effects.find((effect) => effect.target === 'entity-hat')?.transform).toMatchObject({
      position: { x: 70, y: 20 },
      alpha: 0.6,
    });
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(runtime.subscribe).not.toHaveBeenCalled();
  });
  it('does not let an older add settlement override a later hide after an entity transform', () => {
    collect(sentence('add', { entity: 'entity-hat' }));
    stageStateManager.updateEffect({ target: 'entity-hat', transform: { position: { x: 70, y: 20 }, alpha: 0.6 } });
    collect(sentence('hide'));

    controller.discardUncommittedNonHoldPerforms(true);

    const calculated = stageStateManager.getCalculationStageState();
    expect(calculated.attachments[0].visible).toBe(false);
    expect(calculated.stageEntities[0].visualState.visible).toBe(false);
    expect(calculated.stageEntities[0].visualState.position).toEqual({ x: 70, y: 20 });
    expect(calculated.stageEntities[0].visualState.opacity).toBe(0.6);
  });
  it('does not let an older add settlement resurrect an entity removed later in the same calculation', () => {
    collect(sentence('add', { entity: 'entity-hat' }));
    stageStateManager.updateEffect({ target: 'entity-hat', transform: { position: { x: 70, y: 20 } } });
    const beforeRemove = stageStateManager.getCalculationStageState();
    const expectedEntity = cloneDeep(beforeRemove.stageEntities[0]);
    const expectedAttachment = cloneDeep(beforeRemove.attachments[0]);
    expect(
      stageStateManager.applyStageEntityTransaction({
        kind: 'remove',
        entityId: 'entity-hat',
        expectedEntity,
        expectedAttachment,
      }).applied,
    ).toBe(true);
    controller.beginCollectingPerforms();
    controller.arrangeNewPerform(
      {
        performName: 'stage-entity-operation-entity-hat',
        duration: 0,
        isHoldOn: false,
        stopFunction() {},
        blockingNext: () => false,
        blockingAuto: () => false,
      },
      sentence('remove', { entity: 'entity-hat' }),
    );
    controller.endCollectingPerforms();

    controller.discardUncommittedNonHoldPerforms(true);

    expect(stageStateManager.getCalculationStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getCalculationStageState().stageEntities).toHaveLength(0);
  });
  it('settles only the latest same-ID add and preserves its transformed endpoint', () => {
    collect(sentence('add', { entity: 'entity-hat', config: 'A' }));
    stageStateManager.updateEffect({ target: 'entity-hat', transform: { position: { x: 70, y: 20 }, alpha: 0.6 } });
    collect(sentence('add', { entity: 'entity-hat', config: 'B' }));

    controller.discardUncommittedNonHoldPerforms(true);

    const calculated = stageStateManager.getCalculationStageState();
    expect(calculated.attachments[0]).toMatchObject({ configId: 'B', visible: true });
    expect(calculated.stageEntities[0].source.configId).toBe('B');
    expect(calculated.stageEntities[0].visualState).toMatchObject({
      visible: true,
      position: { x: 70, y: 20 },
      opacity: 0.6,
    });
  });
  it('settles a legacy add after entity-transform promotion while preserving the promoted endpoint', () => {
    collect(sentence('add'));
    const legacyAttachment = cloneDeep(stageStateManager.getCalculationStageState().attachments[0]);
    const entityId = deriveLegacyAttachmentEntityId(legacyAttachment.figureKey, legacyAttachment.attachmentId);
    expect(
      stageStateManager.applyStageEntityTransaction({
        kind: 'promote-and-set-visibility',
        expectedAttachment: legacyAttachment,
        entityId,
        visible: false,
      }).applied,
    ).toBe(true);
    stageStateManager.updateEffect({ target: entityId, transform: { position: { x: 70, y: 20 }, alpha: 0.6 } });

    controller.discardUncommittedNonHoldPerforms(true);

    const calculated = stageStateManager.getCalculationStageState();
    expect(calculated.attachments[0]).toMatchObject({ entityId, visible: true });
    expect(calculated.stageEntities[0].visualState).toMatchObject({
      visible: true,
      position: { x: 70, y: 20 },
      opacity: 0.6,
    });
  });
  it('retains only latest add in a collected A -> B -> A sequence', () => {
    collect(sentence('add', { config: 'A' }));
    collect(sentence('add', { config: 'B' }));
    collect(sentence('add', { config: 'A' }));
    commit();
    publish('ready', 'A');
    expect(runtime.subscribe).toHaveBeenCalledOnce();
    expect(stageStateManager.getViewStageState().attachments[0].configId).toBe('A');
    fadeEnd?.();
  });
  it('add -> hide in one calculation has no stale add callback or hidden-to-visible resurrection', () => {
    collect(sentence());
    collect(sentence('hide'));
    commit();
    publish('ready');
    vi.runOnlyPendingTimers();
    expect(stageStateManager.getViewStageState().attachments[0].visible).toBe(false);
    expect(runtime.subscribe).not.toHaveBeenCalled();
    expect(runtime.setEntityVisible).toHaveBeenCalledWith(expect.any(String), false);
  });
  it('new failed add removes only its own hidden row', () => {
    collect(sentence());
    commit();
    const row = stageStateManager.getViewStageState().attachments[0];
    expect(isAttachmentAddFailureCommandOwned(row)).toBe(true);
    publish('error');
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(controller.performList).toHaveLength(0);
  });
  it('reentrant visible publication cannot apply the old fallback to a newer same-ID add', () => {
    vi.mocked(runtime.beginEntityVisibilityTransition).mockReturnValue(false);
    collect(sentence());
    commit();
    let replaced = false;
    const unsubscribe = stageStateManager.subscribe((view) => {
      if (!replaced && view.attachments[0]?.visible) {
        replaced = true;
        collect(sentence('add', { config: 'replacement', duration: 0 }));
        commit();
      }
    });
    try {
      publish('ready');
      expect(replaced).toBe(true);
      expect(stageStateManager.getViewStageState().attachments[0].configId).toBe('replacement');
      expect(runtime.setEntityVisible).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
  it('failed explicit replacement restores prior entity visual/effect and anchor', () => {
    collect(sentence('add', { entity: 'entity-hat', config: 'old', duration: 0, anchor: 'ear-left' }));
    commit();
    vi.runOnlyPendingTimers();
    stageStateManager.updateEffect({ target: 'entity-hat', transform: { position: { x: 14, y: -22 }, alpha: 0.4 } });
    stageStateManager.commit();
    const previous = cloneDeep(stageStateManager.getViewStageState());
    collect(sentence('add', { entity: 'entity-hat' }));
    commit();
    publish('error');
    expect(stageStateManager.getViewStageState().stageEntities).toEqual(previous.stageEntities);
    expect(stageStateManager.getViewStageState().effects).toEqual(previous.effects);
    expect(stageStateManager.getViewStageState().attachments).toEqual(previous.attachments);
  });
  it('failed replacement restores last committed configuration, not an unstarted intermediate add', () => {
    collect(sentence('add', { config: 'old', duration: 0 }));
    commit();
    vi.runOnlyPendingTimers();
    collect(sentence('add', { config: 'A' }));
    collect(sentence('add', { config: 'new' }));
    commit();
    publish('error');
    expect(stageStateManager.getViewStageState().attachments[0]).toMatchObject({ configId: 'old', visible: true });
  });
  it('failure updates only committed view when a future calculation already advanced', () => {
    collect(sentence());
    commit();
    stageStateManager.setStage('showText', 'future dialogue');
    publish('error');
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
    expect(stageStateManager.getViewStageState().showText).toBe('');
    expect(stageStateManager.getCalculationStageState().showText).toBe('future dialogue');
    expect(stageStateManager.getCalculationStageState().attachments).toHaveLength(1);
  });
  it('readiness timeout is bounded and cleans listener, timer, row and perform', () => {
    collect(sentence());
    commit();
    vi.advanceTimersByTime(10000);
    expect(controller.performList).toHaveLength(0);
    expect(listeners.size).toBe(0);
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
  });
  it('reset cancels waiting add and later ready cannot resurrect it', () => {
    collect(sentence());
    commit();
    controller.removeAllPerform();
    stageStateManager.resetAllStageState(cloneDeep(initState));
    publish('ready');
    expect(runtime.beginEntityVisibilityTransition).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().attachments).toHaveLength(0);
  });
  it('early settle after first pose snaps to declared visible endpoint and retires once', async () => {
    collect(sentence());
    commit();
    publish('ready');
    await microtasks();
    controller.settleNonHoldPerforms(false);
    expect(runtime.cancelEntityVisibilityTransition).toHaveBeenCalledWith(expect.any(String), true);
    expect(controller.performList).toHaveLength(0);
    fadeEnd?.();
  });
  it('visibility reserves old presentation without changing final view or promoting lazy row', () => {
    collect(sentence('add', { duration: 0 }));
    commit();
    vi.runOnlyPendingTimers();
    collect(sentence('hide', { duration: 200 }));
    stageStateManager.commit();
    const view = stageStateManager.getViewStageState();
    expect(view.attachments[0].visible).toBe(false);
    expect(projectAttachmentCommandPresentation(view).attachments[0].visible).toBe(true);
    expect(view.stageEntities).toHaveLength(0);
    controller.commitPendingPerforms();
    expect(projectAttachmentCommandPresentation(view).attachments[0].visible).toBe(false);
    vi.runOnlyPendingTimers();
  });
  it('remove delegates the stable identity and only supported continuation arguments', () => {
    collect(sentence('add', { duration: 0 }));
    commit();
    vi.runOnlyPendingTimers();
    attachment(sentence('remove', { duration: 300, next: true, continue: true }));
    expect(stageEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'remove',
        args: expect.arrayContaining([
          { key: 'duration', value: 300 },
          { key: 'next', value: true },
          { key: 'continue', value: true },
        ]),
      }),
    );
  });
  it('invalid add parameters fail before state, Runtime and owner changes', () => {
    const p = attachment(sentence('add', { anchor: 'nonsense' }));
    expect(p.duration).toBe(0);
    expect(stageStateManager.getCalculationStageState().attachments).toHaveLength(0);
    expect(runtime.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
