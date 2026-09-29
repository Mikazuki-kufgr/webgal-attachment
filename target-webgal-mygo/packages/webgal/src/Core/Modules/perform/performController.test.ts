import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PerformController as PerformControllerType } from './performController';
import { PerformContinuationScheduler } from './performContinuationScheduler';
import type { IPerform } from './performInterface';
import { initState, stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import cloneDeep from 'lodash/cloneDeep';

vi.mock('@/Core/controller/gamePlay/nextSentence', () => ({ continueSentence: vi.fn() }));
vi.mock('@/Core/WebGAL', () => ({ WebGAL: { sceneManager: { lockSceneWrite: false } } }));
const { PerformController } = await import('./performController');
const { continueSentence } = await import('@/Core/controller/gamePlay/nextSentence');
const { WebGAL } = await import('@/Core/WebGAL');

const script = (content = 'one', continuation = false): ISentence => ({
  command: commandType.setTransform,
  commandRaw: 'setTransform',
  content,
  args: continuation ? [{ key: 'continue', value: true }] : [],
  sentenceAssets: [],
  subScene: [],
  inlineComment: '',
  isLineBreakHolder: false,
});
const attachmentAddScript = (config = 'cpu-hat'): ISentence => ({
  command: commandType.attachment,
  commandRaw: 'attachment',
  content: 'add',
  args: [
    { key: 'figure', value: 'fig-center' },
    { key: 'id', value: 'hat' },
    { key: 'config', value: config },
    { key: 'anchor', value: 'head' },
  ],
  sentenceAssets: [],
  subScene: [],
  inlineComment: '',
  isLineBreakHolder: false,
});
function installHiddenAttachment() {
  stageStateManager.setStage('attachments', [
    {
      figureKey: 'fig-center',
      attachmentId: 'hat',
      configId: 'cpu-hat',
      semanticAnchor: 'head',
      visible: false,
    },
  ]);
  stageStateManager.commit({ applyPixiEffects: false });
}
function perform(name = 'animation-hat', overrides: Partial<IPerform> = {}): IPerform {
  return {
    performName: name,
    duration: 500,
    isHoldOn: false,
    startFunction: vi.fn(),
    stopFunction: vi.fn(),
    blockingNext: () => false,
    blockingAuto: () => true,
    ...overrides,
  };
}
let controller: PerformControllerType;
function collect(p: IPerform, s = script()) {
  controller.beginCollectingPerforms();
  controller.arrangeNewPerform(p, s);
  controller.endCollectingPerforms();
}
function commit() {
  stageStateManager.commit({ applyPixiEffects: false });
  controller.commitPendingPerforms();
  stageStateManager.applyCommittedPixiEffects();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stageStateManager.setCommitHandler(null);
  stageStateManager.resetAllStageState(cloneDeep(initState));
  WebGAL.sceneManager.lockSceneWrite = false;
  controller = new PerformController();
});
afterEach(() => {
  controller.removeAllPerform();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('5D deferred perform execution and exact ownership', () => {
  it('completion-driven native animation is not retired by a duration timer and keeps native terminal cleanup', () => {
    const p = perform('animation-native', { completionDriven: true });
    collect(p); commit();
    vi.advanceTimersByTime(1000);
    expect(p.stopFunction).not.toHaveBeenCalled();
    expect(controller.performList).toContain(p);
    controller.completePerform(p, 'natural');
    expect(p.stopFunction).toHaveBeenCalledTimes(1);
    expect(controller.performList).not.toContain(p);
    controller.completePerform(p, 'natural');
    expect(p.stopFunction).toHaveBeenCalledTimes(1);
  });
  it('collects without start, stop, timer, or view publication', () => {
    const p = perform();
    const view = stageStateManager.getViewStageState();
    collect(p);
    expect(p.startFunction).not.toHaveBeenCalled();
    expect(p.stopFunction).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(stageStateManager.getViewStageState()).toBe(view);
    expect(stageStateManager.getCalculationStageState().PerformList).toHaveLength(1);
    commit();
    expect(p.startFunction).toHaveBeenCalledTimes(1);
    expect(p.isStarted).toBe(true);
  });
  it('only latest pending same-name intent starts and prior intent is discarded once', () => {
    const a = perform('same', { onDiscard: vi.fn() }),
      b = perform('same');
    collect(a);
    collect(b);
    expect(a.onDiscard).toHaveBeenCalledTimes(1);
    expect(a.stopFunction).not.toHaveBeenCalled();
    commit();
    expect(a.startFunction).not.toHaveBeenCalled();
    expect(b.startFunction).toHaveBeenCalledTimes(1);
    expect(controller.performList).toEqual([b]);
  });
  it('defers old running stop until after view commit and preserves newer calculation endpoints', () => {
    const old = perform('same', { stopFunction: vi.fn(() => stageStateManager.setStage('showText', 'OLD-END')) });
    controller.arrangeNewPerform(old, script('old'));
    const latest = perform('same', {
      startFunction: vi.fn(() => expect(stageStateManager.getViewStageState().showText).toBe('new')),
    });
    collect(latest, script('new'));
    stageStateManager.setStage('showText', 'new');
    expect(old.stopFunction).not.toHaveBeenCalled();
    commit();
    expect(old.stopFunction).toHaveBeenCalledWith('replaced');
    expect(stageStateManager.getCalculationStageState().showText).toBe('new');
    expect(stageStateManager.getViewStageState().showText).toBe('new');
  });
  it('defers explicit prefix retirement during collection and preserves unrelated native parallel owners', () => {
    const a = perform('animation-x#1'),
      b = perform('animation-x#2'),
      other = perform('animation-y#1');
    controller.arrangeNewPerform(a, script());
    controller.arrangeNewPerform(b, script());
    controller.arrangeNewPerform(other, script());
    controller.beginCollectingPerforms();
    controller.unmountPerform('animation-x', true);
    expect(a.stopFunction).not.toHaveBeenCalled();
    expect(b.stopFunction).not.toHaveBeenCalled();
    controller.endCollectingPerforms();
    commit();
    expect(controller.performList).toEqual([other]);
  });
  it('discards fast-preview history with only calc settlement and cleanup', () => {
    const p = perform('history', {
      onDiscard: vi.fn(),
      settleStateOnDiscard: vi.fn(() => stageStateManager.setStage('showText', 'endpoint')),
    });
    collect(p);
    const view = stageStateManager.getViewStageState();
    controller.discardUncommittedNonHoldPerforms(true);
    expect(p.settleStateOnDiscard).toHaveBeenCalledTimes(1);
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(p.startFunction).not.toHaveBeenCalled();
    expect(p.stopFunction).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState()).toBe(view);
    expect(stageStateManager.getCalculationStageState().showText).toBe('endpoint');
    commit();
    expect(controller.performList).toHaveLength(0);
  });
  it('ordinary discard does not run historical endpoint settlement', () => {
    const p = perform('history', { onDiscard: vi.fn(), settleStateOnDiscard: vi.fn() });
    collect(p);
    controller.discardUncommittedNonHoldPerforms();
    controller.discardUncommittedNonHoldPerforms(true);
    expect(p.settleStateOnDiscard).not.toHaveBeenCalled();
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
  });
  it('retains native hold performs through fast-preview discard', () => {
    const p = perform('held', { isHoldOn: true, onDiscard: vi.fn() });
    collect(p);
    controller.discardUncommittedNonHoldPerforms(true);
    commit();
    expect(p.startFunction).toHaveBeenCalledOnce();
    expect(p.onDiscard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(controller.performList).toEqual([p]);
  });
  it('manual async completion creates no duration timer and removes exact state', () => {
    const p = perform('async', { manualCompletion: true });
    collect(p);
    commit();
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.completePerform(p)).toBe(true);
    expect(controller.completePerform(p)).toBe(false);
    expect(p.stopFunction).toHaveBeenCalledTimes(1);
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
  });
  it('synchronous start completion is registered first and cannot resurrect', () => {
    const p = perform('sync', { manualCompletion: true });
    p.startFunction = () => controller.completePerform(p);
    collect(p);
    commit();
    expect(p.isStarted).toBe(false);
    expect(controller.performList).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(p.stopFunction).toHaveBeenCalledWith('natural');
  });
  it('synchronous reset inside first start discards the remaining commit batch', () => {
    const first = perform('first', { startFunction: () => controller.removeAllPerform() });
    const second = perform('second', { onDiscard: vi.fn() });
    collect(first);
    collect(second);
    commit();
    expect(second.startFunction).not.toHaveBeenCalled();
    expect(second.onDiscard).toHaveBeenCalledTimes(1);
    expect(first.stopFunction).toHaveBeenCalledWith('reset');
    expect(controller.performList).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('start failure cleans itself and does not prevent the next pending performer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = perform('failure', {
      startFunction: () => {
        throw Error('start');
      },
    });
    const second = perform('good');
    collect(first, script('bad', true));
    collect(second);
    commit();
    expect(first.stopFunction).toHaveBeenCalledWith('start-failed');
    expect(second.startFunction).toHaveBeenCalledOnce();
    expect(controller.performList).toEqual([second]);
    expect(continueSentence).not.toHaveBeenCalled();
  });
  it('throwing stop remains terminal and does not leave a timer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = perform('failure', {
      stopFunction: () => {
        throw Error('stop');
      },
    });
    controller.arrangeNewPerform(p, script());
    expect(() => controller.completePerform(p)).not.toThrow();
    expect(controller.performList).toHaveLength(0);
    expect(controller.completePerform(p)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('identical A -> B -> A cannot make old object completion delete the new owner', () => {
    const a = perform('same', { manualCompletion: true }),
      b = perform('same', { manualCompletion: true }),
      again = perform('same', { manualCompletion: true });
    controller.arrangeNewPerform(a, script());
    controller.arrangeNewPerform(b, script());
    controller.arrangeNewPerform(again, script());
    expect(controller.completePerform(a)).toBe(false);
    expect(controller.completePerform(b)).toBe(false);
    expect(controller.performList).toEqual([again]);
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(1);
  });
  it('late native timeout never removes replacement even with same script and name', () => {
    const a = perform('same', { duration: 10 }),
      b = perform('same', { duration: 200 });
    controller.arrangeNewPerform(a, script());
    vi.advanceTimersByTime(5);
    controller.arrangeNewPerform(b, script());
    vi.advanceTimersByTime(20);
    expect(controller.performList).toEqual([b]);
    expect(b.stopFunction).not.toHaveBeenCalled();
  });
  it('manual terminal removes committed perform without publishing any future calculation', () => {
    const p = perform('async', { manualCompletion: true });
    controller.arrangeNewPerform(p, script());
    stageStateManager.setStage('showText', 'FUTURE');
    const draft = stageStateManager.getCalculationStageState();
    controller.completePerform(p);
    expect(stageStateManager.getViewStageState().showText).toBe('');
    expect(stageStateManager.getCalculationStageState()).toBe(draft);
    expect(draft.showText).toBe('FUTURE');
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
  });
  it('native terminal writes publish when calculation is synchronized', () => {
    const p = perform('native', { stopFunction: () => stageStateManager.setStage('showText', 'native-end') });
    controller.arrangeNewPerform(p, script());
    controller.completePerform(p);
    expect(stageStateManager.getViewStageState().showText).toBe('native-end');
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
  });
  it('native terminal writes cannot overwrite an advanced calculation', () => {
    const p = perform('native', { stopFunction: () => stageStateManager.setStage('showText', 'old-end') });
    controller.arrangeNewPerform(p, script());
    stageStateManager.setStage('showText', 'future');
    controller.completePerform(p);
    expect(stageStateManager.getViewStageState().showText).toBe('');
    expect(stageStateManager.getCalculationStageState().showText).toBe('future');
  });
  it('reentrant replacement start runs outside isolated retired calculation scope', () => {
    const reentrant = perform('new', {
      startFunction: () => stageStateManager.setStageAndCommit('showText', 'reentrant'),
    });
    const old = perform('old', { stopFunction: () => controller.arrangeNewPerform(reentrant, script('new')) });
    controller.arrangeNewPerform(old, script('old'));
    controller.unmountPerform('old', true);
    expect(controller.performList).toEqual([reentrant]);
    expect(stageStateManager.getViewStageState().showText).toBe('reentrant');
    expect(stageStateManager.getViewStageState().PerformList.map((p) => p.id)).toEqual(['new']);
  });
  it('reset discards pending without runtime cleanup and stops running exactly once', () => {
    const running = perform('run'),
      pending = perform('pending', { onDiscard: vi.fn() });
    controller.arrangeNewPerform(running, script());
    collect(pending);
    controller.removeAllPerform();
    controller.removeAllPerform();
    expect(running.stopFunction).toHaveBeenCalledTimes(1);
    expect(pending.onDiscard).toHaveBeenCalledTimes(1);
    expect(pending.stopFunction).not.toHaveBeenCalled();
    expect(pending.startFunction).not.toHaveBeenCalled();
    expect(controller.performList).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reset cleanup cannot reentrantly resurrect a new runtime perform', () => {
    const stale = perform('stale', { onDiscard: vi.fn() });
    const old = perform('old', { stopFunction: () => controller.arrangeNewPerform(stale, script('stale')) });
    controller.arrangeNewPerform(old, script('old'));
    controller.removeAllPerform();
    expect(stale.onDiscard).toHaveBeenCalledTimes(1);
    expect(stale.startFunction).not.toHaveBeenCalled();
    expect(controller.performList).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reentrant later same-name intent wins over the outer replacement before it publishes', () => {
    const newest = perform('same', { manualCompletion: true });
    const first = perform('same', { stopFunction: () => controller.arrangeNewPerform(newest, script('newest')) });
    const intermediate = perform('same', { onDiscard: vi.fn() });
    controller.arrangeNewPerform(first, script('first'));
    controller.arrangeNewPerform(intermediate, script('intermediate'));
    expect(controller.performList).toEqual([newest]);
    expect(intermediate.onDiscard).toHaveBeenCalledTimes(1);
    expect(intermediate.startFunction).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().PerformList[0].script.content).toBe('newest');
  });
  it('same-name replacement from terminal publication observer suppresses stale continuation', () => {
    const old = perform('same', { manualCompletion: true }),
      newest = perform('same', { manualCompletion: true });
    controller.arrangeNewPerform(old, script('old', true));
    let replaced = false;
    const unsubscribe = stageStateManager.subscribe(() => {
      if (!replaced) {
        replaced = true;
        controller.arrangeNewPerform(newest, script('new'));
      }
    });
    try {
      controller.completePerform(old);
    } finally {
      unsubscribe();
    }
    expect(controller.performList).toEqual([newest]);
    expect(continueSentence).not.toHaveBeenCalled();
  });
  it('blocking state calculation is pending-only and independent of runtime next blocking', () => {
    const p = perform('async', {
      manualCompletion: true,
      blockingStateCalculation: () => true,
      blockingNext: () => true,
    });
    collect(p);
    expect(controller.hasPendingBlockingStateCalculationPerform()).toBe(true);
    expect(controller.hasBlockingNextPerform()).toBe(false);
    commit();
    expect(controller.hasPendingBlockingStateCalculationPerform()).toBe(false);
    expect(controller.hasBlockingNextPerform()).toBe(true);
  });
  it('waits for the exact captured state-calculation token and returns its declared completion', async () => {
    let outcome: 'pending' | 'completed' = 'pending';
    const p = perform('async', {
      manualCompletion: true,
      blockingStateCalculation: () => outcome === 'pending',
      stateCalculationOutcome: () => outcome,
    });
    collect(p);
    const barrier = controller.capturePendingStateCalculationBarrier();
    expect(barrier).toBeDefined();
    commit();
    outcome = 'completed';
    controller.completePerform(p);
    await expect(barrier!.wait()).resolves.toBe('completed');
  });
  it('does not let a same-name replacement satisfy an older captured state-calculation token', async () => {
    let outcome: 'pending' | 'discarded' = 'pending';
    const older = perform('async', {
      manualCompletion: true,
      blockingStateCalculation: () => outcome === 'pending',
      stateCalculationOutcome: () => outcome,
      onDiscard: () => {
        outcome = 'discarded';
      },
    });
    collect(older);
    const barrier = controller.capturePendingStateCalculationBarrier();
    const waiting = barrier!.wait();
    collect(perform('async', { manualCompletion: true }));
    await expect(waiting).resolves.toBe('discarded');
  });
  it('skipNextCollect survives settle and cannot spuriously request continuation', () => {
    const p = perform('media', { skipNextCollect: true, manualCompletion: true });
    controller.arrangeNewPerform(p, script('media', true));
    expect(controller.hasUnsettledNonHoldPerform()).toBe(false);
    controller.settleNonHoldPerforms();
    expect(controller.performList).toEqual([p]);
    expect(continueSentence).not.toHaveBeenCalled();
  });
  it('retains only the exact live pending attachment add witness across stage cleanup', () => {
    installHiddenAttachment();
    const add = perform('stage-entity-operation-entity-hat', {
      skipNextCollect: true,
      manualCompletion: true,
    });
    controller.arrangeNewPerform(add, attachmentAddScript());
    controller.clearNonHoldPerformsFromStageState();
    stageStateManager.commit({ applyPixiEffects: false });
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(1);

    controller.completePerform(add);
    const mismatched = perform('stage-entity-operation-wrong', {
      skipNextCollect: true,
      manualCompletion: true,
    });
    controller.arrangeNewPerform(mismatched, attachmentAddScript('wrong-config'));
    controller.clearNonHoldPerformsFromStageState();
    stageStateManager.commit({ applyPixiEffects: false });
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
    controller.completePerform(mismatched);

    const unrelated = perform('media', { skipNextCollect: true, manualCompletion: true });
    controller.arrangeNewPerform(unrelated, script('media'));
    controller.clearNonHoldPerformsFromStageState();
    stageStateManager.commit({ applyPixiEffects: false });
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
  });
  it('releases the pending add save witness without stopping its Runtime owner', () => {
    installHiddenAttachment();
    const add = perform('stage-entity-operation-entity-hat', {
      skipNextCollect: true,
      manualCompletion: true,
    });
    controller.arrangeNewPerform(add, attachmentAddScript());
    stageStateManager.setStage('showText', 'later uncommitted calculation');
    expect(controller.releaseSkipNextCollect(add)).toBe(true);
    expect(add.skipNextCollect).toBe(false);
    expect(controller.performList).toEqual([add]);
    expect(add.stopFunction).not.toHaveBeenCalled();
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
    expect(stageStateManager.getCalculationStageState().PerformList).toHaveLength(0);
    expect(stageStateManager.getCalculationStageState().showText).toBe('later uncommitted calculation');
    stageStateManager.commit({ applyPixiEffects: false });
    expect(stageStateManager.getViewStageState().showText).toBe('later uncommitted calculation');
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
    expect(controller.releaseSkipNextCollect(add)).toBe(false);
  });
  it('replacement and reset revoke an exact protected add witness', () => {
    installHiddenAttachment();
    const add = perform('stage-entity-operation-entity-hat', {
      skipNextCollect: true,
      manualCompletion: true,
    });
    controller.arrangeNewPerform(add, attachmentAddScript());
    const replacement = perform('stage-entity-operation-entity-hat', { manualCompletion: true });
    controller.arrangeNewPerform(replacement, script('replacement'));
    expect(stageStateManager.getViewStageState().PerformList.map((row) => row.script.content)).toEqual(['replacement']);
    expect(controller.releaseSkipNextCollect(add)).toBe(false);
    controller.removeAllPerform();
    expect(stageStateManager.getCalculationStageState().PerformList).toHaveLength(0);
    expect(stageStateManager.getViewStageState().PerformList).toHaveLength(0);
  });
});

describe('5D continuation ownership with native blockingNext semantics', () => {
  it.each(['settle', 'unmount'])('reset inside %s cleanup cannot issue a stale continuation', (mode) => {
    const p = perform('old', { stopFunction: () => controller.removeAllPerform() });
    controller.arrangeNewPerform(p, script('old', true));
    if (mode === 'settle') controller.settleNonHoldPerforms();
    else controller.unmountPerform('old');
    expect(continueSentence).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('coalesces two completed operations behind one blocker', () => {
    const blocker = perform('block', { manualCompletion: true, blockingNext: () => true });
    const a = perform('a', { manualCompletion: true }),
      b = perform('b', { manualCompletion: true });
    controller.arrangeNewPerform(blocker, script());
    controller.arrangeNewPerform(a, script('a', true));
    controller.arrangeNewPerform(b, script('b', true));
    controller.completePerform(a);
    controller.completePerform(b);
    expect(vi.getTimerCount()).toBe(1);
    controller.completePerform(blocker);
    vi.advanceTimersByTime(100);
    expect(continueSentence).toHaveBeenCalledTimes(1);
  });
  it('uses blockingNext rather than blockingAuto', () => {
    const nonblock = perform('native', { manualCompletion: true, blockingAuto: () => true });
    const p = perform('finished', { manualCompletion: true });
    controller.arrangeNewPerform(nonblock, script());
    controller.arrangeNewPerform(p, script('finished', true));
    controller.completePerform(p);
    expect(continueSentence).toHaveBeenCalledTimes(1);
  });
  it('waits scene-write lock and cancels pending continuation on reset', () => {
    const p = perform('finished', { manualCompletion: true });
    controller.arrangeNewPerform(p, script('finished', true));
    WebGAL.sceneManager.lockSceneWrite = true;
    controller.completePerform(p);
    expect(vi.getTimerCount()).toBe(1);
    controller.removeAllPerform();
    WebGAL.sceneManager.lockSceneWrite = false;
    vi.advanceTimersByTime(1000);
    expect(continueSentence).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not consume old continue on replacement or reset', () => {
    const a = perform('same'),
      b = perform('same');
    controller.arrangeNewPerform(a, script('a', true));
    controller.arrangeNewPerform(b, script('b', true));
    controller.removeAllPerform();
    vi.runAllTimers();
    expect(continueSentence).not.toHaveBeenCalled();
  });
  it('waits until all pending starts have run before synchronous finish continues', () => {
    const first = perform('first', { manualCompletion: true });
    first.startFunction = () => controller.completePerform(first);
    const blocker = perform('blocker', { manualCompletion: true, blockingNext: () => true });
    collect(first, script('first', true));
    collect(blocker);
    commit();
    vi.advanceTimersByTime(100);
    expect(continueSentence).not.toHaveBeenCalled();
    controller.completePerform(blocker);
    vi.advanceTimersByTime(100);
    expect(continueSentence).toHaveBeenCalledTimes(1);
  });
  it('internal settlement does not double-continue; user settlement continues once', () => {
    const a = perform('a');
    controller.arrangeNewPerform(a, script('a', true));
    controller.settleNonHoldPerforms(false);
    expect(continueSentence).not.toHaveBeenCalled();
    const b = perform('b');
    controller.arrangeNewPerform(b, script('b', true));
    controller.settleNonHoldPerforms(true);
    expect(continueSentence).toHaveBeenCalledTimes(1);
  });
  it('new forward invalidates a queued continuation', () => {
    const p = perform('a', { manualCompletion: true });
    controller.arrangeNewPerform(p, script('a', true));
    WebGAL.sceneManager.lockSceneWrite = true;
    controller.completePerform(p);
    controller.beginCollectingPerforms();
    controller.endCollectingPerforms();
    WebGAL.sceneManager.lockSceneWrite = false;
    vi.advanceTimersByTime(1000);
    expect(continueSentence).not.toHaveBeenCalled();
  });
  it('pure scheduler rejects even a manually delivered stale retry after cancel', () => {
    let retry: (() => void) | undefined;
    const advance = vi.fn();
    let blocked = true;
    const scheduler = new PerformContinuationScheduler({
      isBlocked: () => blocked,
      advance,
      schedule: (callback) => {
        retry = callback;
        return setTimeout(() => {}, 100);
      },
      cancel: clearTimeout,
    });
    scheduler.request();
    scheduler.cancel();
    blocked = false;
    retry?.();
    expect(advance).not.toHaveBeenCalled();
    expect(scheduler.snapshot().pending).toBe(false);
  });
});
