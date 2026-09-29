import {
  IPerform,
  type PerformStopReason,
  type StateCalculationOutcome,
} from '@/Core/Modules/perform/performInterface';
import { ISentence } from '@/Core/controller/scene/sceneInterface';
import { continueSentence } from '@/Core/controller/gamePlay/nextSentence';
import { WEBGAL_NONE } from '@/Core/constants';
import { getBooleanArgByKey } from '@/Core/util/getSentenceArg';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import type { IRunPerform } from '@/Core/Modules/stage/stageInterface';
import { isPendingAttachmentAddWitness } from '@/Core/Modules/stage/stageEntityPersistence';
import { WebGAL } from '@/Core/WebGAL';
import cloneDeep from 'lodash/cloneDeep';
import { PerformContinuationScheduler } from './performContinuationScheduler';

export const getRandomPerformName = (): string => Math.random().toString().substring(0, 10);

interface IPendingPerform {
  perform: IPerform;
  script: ISentence;
  state?: IRunPerform;
  intent: symbol;
}

export type StateCalculationBarrierResult = Exclude<StateCalculationOutcome, 'pending'> | 'aborted';

export interface StateCalculationBarrier {
  readonly wait: (signal?: AbortSignal) => Promise<StateCalculationBarrierResult>;
}

export class PerformController {
  public performList: Array<IPerform> = [];
  private pendingPerformList: IPendingPerform[] = [];
  private committingPendingList: IPendingPerform[] = [];
  private isCollectingPerforms = false;
  private commitDepth = 0;
  private isolatedStopDepth = 0;
  private deferredArrangements: Array<{ perform: IPerform; script: ISentence; sync: boolean; revision: number }> = [];
  private lifecycleRevision = 0;
  private resetDepth = 0;
  private records = new WeakMap<IPerform, IPendingPerform>();
  private terminal = new WeakSet<IPerform>();
  private latestIntent = new Map<string, symbol>();
  private deferredRetirements = new Map<IPerform, PerformStopReason>();
  private stopTimeoutMap = new WeakMap<IPerform, ReturnType<typeof setTimeout>>();
  private stateCalculationBarrierWaiters = new WeakMap<
    IPerform,
    Set<(result: StateCalculationBarrierResult) => void>
  >();
  private readonly continuationScheduler = new PerformContinuationScheduler({
    isBlocked: () =>
      this.isCollectingPerforms ||
      this.commitDepth > 0 ||
      WebGAL.sceneManager.lockSceneWrite ||
      this.hasBlockingNextPerform(),
    advance: () => continueSentence(),
  });

  private matchPerformName(performName: string, name: string): boolean {
    return performName === name || performName.startsWith(name + '#');
  }

  public beginCollectingPerforms() {
    this.cancelPendingContinuation();
    this.isCollectingPerforms = true;
  }

  public endCollectingPerforms() {
    this.isCollectingPerforms = false;
  }

  public arrangeNewPerform(perform: IPerform, script: ISentence, syncPerformState = true) {
    if (perform.performName === WEBGAL_NONE) return;
    if (this.resetDepth > 0) {
      try {
        perform.onDiscard?.();
      } catch (error) {
        this.reportFailure('PERFORM_DISCARD_FAILED', perform, error);
      }
      return;
    }
    if (this.isolatedStopDepth > 0) {
      this.deferredArrangements.push({
        perform,
        script: cloneDeep(script),
        sync: syncPerformState,
        revision: this.lifecycleRevision,
      });
      return;
    }
    // An opaque identity prevents identical scripts and A -> B -> A from
    // granting a late callback ownership of a reused perform name.
    const record: IPendingPerform = {
      perform,
      script: cloneDeep(script),
      intent: Symbol(perform.performName),
      ...(syncPerformState
        ? { state: { id: perform.performName, isHoldOn: perform.isHoldOn, script: cloneDeep(script) } }
        : {}),
    };
    this.latestIntent.set(perform.performName, record.intent);
    this.discardMatchingPending((candidate) => candidate.perform.performName === perform.performName);
    for (const previous of [...this.performList]) {
      if (previous.performName === perform.performName) this.retirePerform(previous, 'replaced');
    }
    if (!this.owns(record)) {
      this.discardRecord(record);
      return;
    }
    perform.isStarted = false;
    this.terminal.delete(perform);
    this.records.set(perform, record);
    if (record.state) stageStateManager.addPerform(cloneDeep(record.state));
    if (this.isCollectingPerforms) {
      this.pendingPerformList.push(record);
      return;
    }
    if (record.state) stageStateManager.commit({ applyPixiEffects: false });
    this.startPerform(record);
    if (!this.isCollectingPerforms) stageStateManager.applyCommittedPixiEffects();
  }

  /** The caller has committed the new view; only now may old runtime owners stop. */
  public commitPendingPerforms() {
    const revision = this.lifecycleRevision;
    this.commitDepth += 1;
    this.committingPendingList.push(...this.pendingPerformList);
    this.pendingPerformList = [];
    const retirements = [...this.deferredRetirements];
    this.deferredRetirements.clear();
    try {
      for (const [perform, reason] of retirements) {
        if (revision !== this.lifecycleRevision) return;
        this.completeNow(perform, reason, false, true);
      }
      while (this.committingPendingList.length && revision === this.lifecycleRevision) {
        const record = this.committingPendingList.shift()!;
        if (!this.owns(record)) {
          this.discardRecord(record);
          continue;
        }
        this.startPerform(record);
      }
    } finally {
      this.commitDepth -= 1;
    }
  }

  public discardUncommittedNonHoldPerforms(settleDiscardedState = false) {
    this.discardMatchingPending((record) => !record.perform.isHoldOn, settleDiscardedState);
  }

  public hasPendingBlockingStateCalculationPerform() {
    return [...this.pendingPerformList, ...this.committingPendingList].some(
      ({ perform }) => perform.blockingStateCalculation?.() ?? false,
    );
  }

  /**
   * Capture the exact pending Runtime-backed calculation owner before commit.
   * The returned waiter follows that object/token only; a same-name replacement
   * cannot satisfy it, and an AbortSignal retires the preview request without polling.
   */
  public capturePendingStateCalculationBarrier(): StateCalculationBarrier | undefined {
    const record = [...this.pendingPerformList, ...this.committingPendingList].find(
      ({ perform }) => perform.blockingStateCalculation?.() ?? false,
    );
    if (!record) return undefined;
    const { perform } = record;

    return {
      wait: (signal) => {
        const currentOutcome = perform.stateCalculationOutcome?.();
        if (currentOutcome && currentOutcome !== 'pending') return Promise.resolve(currentOutcome);
        if (signal?.aborted) return Promise.resolve('aborted');

        return new Promise<StateCalculationBarrierResult>((resolve) => {
          let waiters = this.stateCalculationBarrierWaiters.get(perform);
          if (!waiters) {
            waiters = new Set();
            this.stateCalculationBarrierWaiters.set(perform, waiters);
          }

          const settle = (result: StateCalculationBarrierResult) => {
            signal?.removeEventListener('abort', abort);
            resolve(result);
          };
          const abort = () => {
            waiters!.delete(settle);
            if (waiters!.size === 0) this.stateCalculationBarrierWaiters.delete(perform);
            settle('aborted');
          };
          waiters.add(settle);
          signal?.addEventListener('abort', abort, { once: true });

          const outcomeAfterRegistration = perform.stateCalculationOutcome?.();
          if (outcomeAfterRegistration && outcomeAfterRegistration !== 'pending') {
            waiters.delete(settle);
            if (waiters.size === 0) this.stateCalculationBarrierWaiters.delete(perform);
            settle(outcomeAfterRegistration);
          }
        });
      },
    };
  }

  public hasBlockingNextPerform() {
    return this.performList.some((perform) => perform.blockingNext());
  }

  public hasUnsettledNonHoldPerform() {
    return this.performList.some((perform) => !perform.isHoldOn && !perform.skipNextCollect);
  }

  public settleNonHoldPerforms(goNextWhenOver = true) {
    let continueRequested = false;
    const revision = this.lifecycleRevision;
    this.commitDepth += 1;
    try {
      for (const perform of [...this.performList]) {
        if (revision !== this.lifecycleRevision) break;
        if (perform.isHoldOn || perform.skipNextCollect) continue;
        const retired = this.retirePerform(perform, 'settled', false);
        continueRequested ||= retired && Boolean(perform.goNextWhenOver);
      }
    } finally {
      this.commitDepth -= 1;
    }
    if (continueRequested && goNextWhenOver && revision === this.lifecycleRevision)
      this.continuationScheduler.request();
  }

  public clearNonHoldPerformsFromStageState() {
    const attachments = stageStateManager.getCalculationStageState().attachments;
    const retained = this.performList.flatMap((perform) => {
      if (perform.isHoldOn || !perform.manualCompletion || !perform.skipNextCollect) return [];
      const record = this.records.get(perform);
      if (!record?.state || !this.owns(record)) return [];
      const state = record.state;
      return attachments.some((attachment) => !attachment.visible && isPendingAttachmentAddWitness(state, attachment))
        ? [state]
        : [];
    });
    stageStateManager.clearUncommittedNonHoldPerforms(retained);
  }

  /** End forward retention and remove the exact committed save witness without stopping the Runtime perform. */
  public releaseSkipNextCollect(perform: IPerform): boolean {
    perform.skipNextCollect = false;
    const record = this.records.get(perform);
    if (!record?.state || !this.owns(record)) return false;
    if (!stageStateManager.removeCommittedPerform(record.state)) return false;
    record.state = undefined;
    return true;
  }

  private startPerform(record: IPendingPerform) {
    const { perform, script } = record;
    if (!this.owns(record) || this.terminal.has(perform)) return;
    if (getBooleanArgByKey(script, 'continue') ?? false) perform.goNextWhenOver = true;
    // Register before user code: synchronous finish/reset/replacement cannot
    // resurrect this perform after startFunction returns.
    perform.isStarted = true;
    this.performList.push(perform);
    try {
      perform.startFunction?.();
    } catch (error) {
      this.reportFailure('PERFORM_START_FAILED', perform, error);
      this.completeNow(perform, 'start-failed', false);
      return;
    }
    if (!perform.isStarted || this.terminal.has(perform) || !this.performList.includes(perform)) return;
    if (perform.manualCompletion || perform.completionDriven || perform.isHoldOn) return;
    const stopTimeout = setTimeout(() => this.completePerform(perform, 'natural'), Math.max(0, perform.duration));
    this.stopTimeoutMap.set(perform, stopTimeout);
  }

  public unmountPerform(name: string, force = false) {
    this.unmountMatching((perform) => this.matchPerformName(perform.performName, name), force);
  }

  public unmountPerformByPrefix(prefix: string, force = false) {
    this.unmountMatching((perform) => perform.performName.startsWith(prefix), force);
  }

  private unmountMatching(matches: (perform: IPerform) => boolean, force: boolean) {
    const revision = this.lifecycleRevision;
    this.discardMatchingPending(({ perform }) => matches(perform) && (force || !perform.isHoldOn));
    let shouldContinue = false;
    for (const perform of [...this.performList]) {
      if (revision !== this.lifecycleRevision) break;
      if (!matches(perform) || (!force && perform.isHoldOn)) continue;
      const reason = force || this.isCollectingPerforms ? 'replaced' : 'settled';
      const retired = this.retirePerform(perform, reason, false);
      shouldContinue ||= retired && reason === 'settled' && Boolean(perform.goNextWhenOver);
    }
    if (shouldContinue && revision === this.lifecycleRevision) this.continuationScheduler.request();
  }

  /** Complete an exact object, never whichever object reused its name. */
  public completePerform(perform: IPerform, reason: PerformStopReason = 'natural') {
    return this.retirePerform(perform, reason);
  }

  public softUnmountPerformObject(perform: IPerform) {
    return this.completePerform(perform, 'natural');
  }

  private retirePerform(perform: IPerform, reason: PerformStopReason, continueWhenOver = true): boolean {
    if (!this.performList.includes(perform) || this.terminal.has(perform)) return false;
    if (this.isCollectingPerforms) {
      this.deferredRetirements.set(perform, reason);
      const record = this.records.get(perform);
      if (record?.state && this.owns(record)) stageStateManager.removePerformByName(record.state.id);
      return true;
    }
    return this.completeNow(perform, reason, continueWhenOver);
  }

  private completeNow(
    perform: IPerform,
    reason: PerformStopReason,
    continueWhenOver: boolean,
    preserveCalculation = false,
  ): boolean {
    const index = this.performList.indexOf(perform);
    if (index < 0 || this.terminal.has(perform)) return false;
    const record = this.records.get(perform);
    const revision = this.lifecycleRevision;
    const originalView = stageStateManager.getViewStageState();
    const synchronized = stageStateManager.isCalculationSynchronizedWithView();
    const canPublishNativeTerminal =
      !preserveCalculation &&
      !perform.manualCompletion &&
      synchronized &&
      (reason === 'natural' || reason === 'settled');
    this.terminal.add(perform);
    this.performList.splice(index, 1);
    this.deferredRetirements.delete(perform);
    this.clearPerformTimeout(perform);
    const wasStarted = perform.isStarted;
    perform.isStarted = false;
    if (wasStarted) {
      const stop = () => {
        if (reason === 'reset') this.resetDepth += 1;
        try {
          perform.stopFunction(reason);
        } catch (error) {
          this.reportFailure('PERFORM_STOP_FAILED', perform, error);
        } finally {
          if (reason === 'reset') this.resetDepth -= 1;
        }
      };
      // Retired animation endpoints must not overwrite a newer calculation.
      if (
        preserveCalculation ||
        reason === 'replaced' ||
        reason === 'reset' ||
        (!synchronized && !perform.manualCompletion)
      ) {
        this.isolatedStopDepth += 1;
        try {
          stageStateManager.withIsolatedCalculation(stop);
        } finally {
          this.isolatedStopDepth -= 1;
        }
      } else stop();
    }
    if (this.isolatedStopDepth === 0) this.flushDeferredArrangements();
    const stillOwns = record ? this.owns(record) : false;
    if (record?.state && stillOwns && revision === this.lifecycleRevision) {
      try {
        if (canPublishNativeTerminal && stageStateManager.getViewStageState() === originalView) {
          stageStateManager.removePerformByName(record.state.id);
          stageStateManager.commit();
        } else {
          stageStateManager.removeCommittedPerform(record.state);
        }
      } catch (error) {
        this.reportFailure('PERFORM_STATE_TERMINAL_FAILED', perform, error);
      }
    }
    const ownsAfterPublication = record ? this.owns(record) : false;
    if (ownsAfterPublication) this.latestIntent.delete(perform.performName);
    if (
      ownsAfterPublication &&
      revision === this.lifecycleRevision &&
      continueWhenOver &&
      perform.goNextWhenOver &&
      (reason === 'natural' || reason === 'settled')
    ) {
      this.continuationScheduler.request();
    }
    this.resolveStateCalculationBarrier(perform);
    return true;
  }

  public erasePerformFromState(name: string) {
    stageStateManager.removePerformByName(name);
  }

  public cancelPendingContinuation() {
    this.continuationScheduler.cancel();
  }

  public removeAllPerform() {
    this.lifecycleRevision += 1;
    this.cancelPendingContinuation();
    this.resetDepth += 1;
    try {
      this.discardMatchingPending(() => true);
      for (const perform of [...this.performList]) this.retirePerform(perform, 'reset', false);
      this.latestIntent.clear();
    } finally {
      this.resetDepth -= 1;
    }
  }

  private owns(record: IPendingPerform) {
    return this.latestIntent.get(record.perform.performName) === record.intent;
  }

  private flushDeferredArrangements() {
    const queued = this.deferredArrangements;
    this.deferredArrangements = [];
    for (const entry of queued) {
      if (entry.revision !== this.lifecycleRevision) {
        try {
          entry.perform.onDiscard?.();
        } catch (error) {
          this.reportFailure('PERFORM_DISCARD_FAILED', entry.perform, error);
        }
        continue;
      }
      this.arrangeNewPerform(entry.perform, entry.script, entry.sync);
    }
  }

  private discardMatchingPending(matches: (record: IPendingPerform) => boolean, settle = false) {
    const discarded = [...this.pendingPerformList, ...this.committingPendingList].filter(matches);
    this.pendingPerformList = this.pendingPerformList.filter((record) => !matches(record));
    this.committingPendingList = this.committingPendingList.filter((record) => !matches(record));
    for (const record of discarded) this.discardRecord(record, settle);
  }

  private discardRecord(record: IPendingPerform, settle = false) {
    if (this.terminal.has(record.perform)) return;
    this.terminal.add(record.perform);
    const owned = this.owns(record);
    if (owned) this.latestIntent.delete(record.perform.performName);
    if (owned && record.state) stageStateManager.removePerformByName(record.state.id);
    if (settle) {
      try {
        record.perform.settleStateOnDiscard?.(owned);
      } catch (error) {
        this.reportFailure('PERFORM_DISCARD_SETTLEMENT_FAILED', record.perform, error);
      }
    }
    try {
      record.perform.onDiscard?.();
    } catch (error) {
      this.reportFailure('PERFORM_DISCARD_FAILED', record.perform, error);
    }
    this.resolveStateCalculationBarrier(record.perform);
  }

  private resolveStateCalculationBarrier(perform: IPerform) {
    const waiters = this.stateCalculationBarrierWaiters.get(perform);
    if (!waiters?.size) return;
    this.stateCalculationBarrierWaiters.delete(perform);
    const declared = perform.stateCalculationOutcome?.();
    const result: StateCalculationBarrierResult = declared && declared !== 'pending' ? declared : 'cancelled';
    for (const resolve of waiters) resolve(result);
  }

  private clearPerformTimeout(perform: IPerform) {
    const timeout = this.stopTimeoutMap.get(perform);
    if (timeout !== undefined) clearTimeout(timeout);
    this.stopTimeoutMap.delete(perform);
  }

  private reportFailure(code: string, perform: IPerform, error: unknown) {
    try {
      console.error({ scope: 'webgal.perform', code, performName: perform.performName, error });
    } catch {
      /* A diagnostic sink cannot reopen a terminal owner. */
    }
  }
}
