import type { IPerform } from '@/Core/Modules/perform/performInterface';
import {
  toStageEntityOperationError,
  type StageEntityOperationError,
} from '@/Core/controller/stage/pixi/attachments/stageEntityOperationError';

export interface StageEntityOperationStartContext {
  signal: AbortSignal;
  finish(error?: unknown): void;
  cancel(): void;
  isInactive(): boolean;
}

export interface StageEntityOperationLifecycleDependencies {
  completePerform(perform: IPerform): void;
  cancelRuntimeOperation(entityId: string, settleVisibility: boolean): void;
  removeTransformOwner(entityId: string): void;
  reportError(error: StageEntityOperationError): void;
  validateStart?(): void;
  onStart?(): void;
  onDiscard?(): void;
  onTerminal?(reason: 'settled' | 'cancelled' | 'discarded'): void;
}

/** Shared with attachment visibility/add: one committed operation per entity. */
export function stageEntityOperationPerformName(entityId: string): string {
  return `stage-entity-operation-${entityId}`;
}

/**
 * Pure construction. Runtime ownership is acquired only after host commit.
 * Explicit completion replaces the old zero-timeout + hold workaround.
 */
export function createStageEntityOperationPerform(
  entityId: string,
  start: (context: StageEntityOperationStartContext) => void | Promise<void>,
  dependencies: StageEntityOperationLifecycleDependencies,
): IPerform {
  let started = false;
  let acquired = false;
  let terminal = false;
  let outcome: 'pending' | 'completed' | 'failed' | 'cancelled' | 'discarded' = 'pending';
  let perform: IPerform;
  const abort = new AbortController();
  const notifyTerminal = (reason: 'settled' | 'cancelled' | 'discarded') => {
    abort.abort();
    try {
      dependencies.onTerminal?.(reason);
    } catch {
      // Observer failure cannot reopen a terminal operation.
    }
  };
  const clearOwners = (settleVisibility: boolean) => {
    try {
      dependencies.cancelRuntimeOperation(entityId, settleVisibility);
    } catch {
      // Attempt every owned cleanup independently.
    }
    try {
      dependencies.removeTransformOwner(entityId);
    } catch {
      // Runtime terminality does not depend on a transform diagnostic sink.
    }
  };
  const finish = (error?: unknown) => {
    if (!started || terminal) return;
    terminal = true;
    outcome = error === undefined ? 'completed' : 'failed';
    if (error !== undefined) {
      perform.goNextWhenOver = false;
      if (acquired) clearOwners(true);
      try {
        dependencies.reportError(toStageEntityOperationError(error, 'STAGE_ENTITY_OPERATION_FAILED', { entityId }));
      } catch {
        // Diagnostic failure must not leave a blocking perform mounted.
      }
    }
    notifyTerminal('settled');
    dependencies.completePerform(perform);
  };
  const cancel = () => {
    if (!started || terminal) return;
    terminal = true;
    outcome = 'cancelled';
    perform.goNextWhenOver = false;
    notifyTerminal('cancelled');
    dependencies.completePerform(perform);
  };
  perform = {
    performName: stageEntityOperationPerformName(entityId),
    duration: 0,
    isHoldOn: false,
    manualCompletion: true,
    blockingNext: () => !terminal,
    blockingAuto: () => !terminal,
    blockingStateCalculation: () => !terminal,
    stateCalculationOutcome: () => outcome,
    startFunction: () => {
      if (started || terminal) return;
      started = true;
      try {
        dependencies.validateStart?.();
        acquired = true;
        dependencies.onStart?.();
        const result = start({ finish, cancel, isInactive: () => terminal, signal: abort.signal });
        void Promise.resolve(result).catch(finish);
      } catch (error) {
        finish(error);
      }
    },
    stopFunction: (reason) => {
      if (!started || terminal) return;
      terminal = true;
      outcome = 'cancelled';
      // Replacement continues from the sampled fade instead of snapping.
      if (acquired) clearOwners(reason !== 'replaced');
      notifyTerminal('cancelled');
    },
    onDiscard: () => {
      if (started || terminal) return;
      terminal = true;
      outcome = 'discarded';
      try {
        dependencies.onDiscard?.();
      } finally {
        notifyTerminal('discarded');
      }
    },
  };
  return perform;
}
