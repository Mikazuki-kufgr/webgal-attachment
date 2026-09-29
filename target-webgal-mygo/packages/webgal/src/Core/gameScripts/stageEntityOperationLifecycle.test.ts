import { describe, expect, it, vi } from 'vitest';
import { createStageEntityOperationPerform } from './stageEntityOperationLifecycle';
import { StageEntityOperationError } from '@/Core/controller/stage/pixi/attachments/stageEntityOperationError';
import { startStageEntityRemovalTransition } from './stageEntityRemovalTransition';

function dependencies() {
  return {
    completePerform: vi.fn(),
    cancelRuntimeOperation: vi.fn(),
    removeTransformOwner: vi.fn(),
    reportError: vi.fn(),
    onStart: vi.fn(),
    onDiscard: vi.fn(),
    onTerminal: vi.fn(),
  };
}

describe('deferred Stage Entity operation lifecycle', () => {
  it.each(['failed', 'cancelled'] as const)(
    'does not consume continue after %s and aborts pending readiness',
    async (outcome) => {
      const ports = dependencies();
      let signal: AbortSignal | undefined;
      const perform = createStageEntityOperationPerform(
        'hat',
        (context) => {
          signal = context.signal;
          if (outcome === 'failed') context.finish(new Error('intentional failure'));
          else context.cancel();
        },
        ports,
      );
      perform.goNextWhenOver = true;
      perform.startFunction?.();
      await Promise.resolve();
      expect(perform.stateCalculationOutcome?.()).toBe(outcome);
      expect(perform.goNextWhenOver).toBe(false);
      expect(signal?.aborted).toBe(true);
      expect(ports.completePerform).toHaveBeenCalledTimes(1);
    },
  );
  it('constructs without ownership, timers, or Runtime access; discard never starts', () => {
    const ports = dependencies();
    const start = vi.fn();
    const perform = createStageEntityOperationPerform('hat', start, ports);
    for (const port of Object.values(ports)) expect(port).not.toHaveBeenCalled();
    expect(perform.manualCompletion).toBe(true);
    expect(perform.isHoldOn).toBe(false);
    expect(perform.blockingStateCalculation?.()).toBe(true);
    perform.onDiscard?.();
    perform.startFunction?.();
    expect(start).not.toHaveBeenCalled();
    expect(ports.onDiscard).toHaveBeenCalledTimes(1);
    expect(ports.cancelRuntimeOperation).not.toHaveBeenCalled();
    expect(perform.blockingNext()).toBe(false);
    expect(perform.stateCalculationOutcome?.()).toBe('discarded');
  });

  it('completes exactly once even with synchronous finish and later throw', async () => {
    const ports = dependencies();
    const perform = createStageEntityOperationPerform(
      'hat',
      ({ finish }) => {
        finish();
        finish(new Error('late'));
        throw new Error('also late');
      },
      ports,
    );
    perform.startFunction?.();
    await Promise.resolve();
    expect(ports.completePerform).toHaveBeenCalledTimes(1);
    expect(ports.completePerform).toHaveBeenCalledWith(perform);
    expect(ports.reportError).not.toHaveBeenCalled();
    expect(ports.cancelRuntimeOperation).not.toHaveBeenCalled();
    expect(perform.blockingNext()).toBe(false);
    expect(perform.blockingAuto()).toBe(false);
    expect(perform.stateCalculationOutcome?.()).toBe('completed');
  });

  it('owns asynchronous rejection, preserves typed errors, and attempts both cleanup ports', async () => {
    const ports = dependencies();
    ports.cancelRuntimeOperation.mockImplementation(() => {
      throw new Error('cleanup');
    });
    const error = new StageEntityOperationError('ENTITY_SLOT_CONFLICT', 'occupied');
    const perform = createStageEntityOperationPerform(
      'hat',
      async () => {
        throw error;
      },
      ports,
    );
    perform.startFunction?.();
    await Promise.resolve();
    expect(ports.removeTransformOwner).toHaveBeenCalledWith('hat');
    expect(ports.reportError.mock.calls[0][0].code).toBe('ENTITY_SLOT_CONFLICT');
    expect(ports.completePerform).toHaveBeenCalledTimes(1);
    expect(perform.blockingNext()).toBe(false);
    expect(perform.stateCalculationOutcome?.()).toBe('failed');
  });

  it('cancels a committed operation without clearing a newer transform owner or reporting failure', () => {
    const ports = dependencies();
    const perform = createStageEntityOperationPerform(
      'hat',
      ({ cancel }) => {
        cancel();
      },
      ports,
    );
    perform.startFunction?.();
    expect(perform.stateCalculationOutcome?.()).toBe('cancelled');
    expect(perform.blockingNext()).toBe(false);
    expect(ports.completePerform).toHaveBeenCalledWith(perform);
    expect(ports.cancelRuntimeOperation).not.toHaveBeenCalled();
    expect(ports.removeTransformOwner).not.toHaveBeenCalled();
    expect(ports.reportError).not.toHaveBeenCalled();
  });

  it('replacement marks inactive before cleanup and preserves sampled visibility', () => {
    const ports = dependencies();
    let finish!: (error?: unknown) => void;
    let inactive!: () => boolean;
    const perform = createStageEntityOperationPerform(
      'hat',
      (context) => {
        finish = context.finish;
        inactive = context.isInactive;
      },
      ports,
    );
    ports.cancelRuntimeOperation.mockImplementation(() => {
      expect(inactive()).toBe(true);
    });
    perform.startFunction?.();
    perform.stopFunction('replaced');
    perform.stopFunction('reset');
    finish(new Error('stale ready'));
    expect(ports.cancelRuntimeOperation).toHaveBeenCalledWith('hat', false);
    expect(ports.cancelRuntimeOperation).toHaveBeenCalledTimes(1);
    expect(ports.completePerform).not.toHaveBeenCalled();
    expect(ports.reportError).not.toHaveBeenCalled();
  });

  it('reset settles declared visibility, cancels transforms, and ignores a late Promise', async () => {
    const ports = dependencies();
    let reject!: (error: Error) => void;
    const perform = createStageEntityOperationPerform(
      'hat',
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
      ports,
    );
    perform.startFunction?.();
    perform.stopFunction('reset');
    reject(new Error('late failure'));
    await Promise.resolve();
    expect(ports.cancelRuntimeOperation).toHaveBeenCalledWith('hat', true);
    expect(ports.removeTransformOwner).toHaveBeenCalledTimes(1);
    expect(ports.reportError).not.toHaveBeenCalled();
    expect(perform.blockingStateCalculation?.()).toBe(false);
  });

  it('unstarted stop is harmless and start is idempotent', () => {
    const ports = dependencies();
    const start = vi.fn();
    const perform = createStageEntityOperationPerform('hat', start, ports);
    perform.stopFunction('cancelled');
    expect(ports.cancelRuntimeOperation).not.toHaveBeenCalled();
    perform.startFunction?.();
    perform.startFunction?.();
    expect(start).toHaveBeenCalledTimes(1);
  });
});

function removalPorts() {
  return {
    isInactive: vi.fn(() => false),
    startFade: vi.fn((_complete: () => void) => true),
    commitRemoval: vi.fn(),
    removeRuntime: vi.fn(),
    restoreDeclaredVisibility: vi.fn(),
    finish: vi.fn(),
  };
}

describe('fade-first Stage Entity removal', () => {
  it('keeps the declaration until fade completion and commits once', () => {
    const ports = removalPorts();
    startStageEntityRemovalTransition(ports);
    expect(ports.commitRemoval).not.toHaveBeenCalled();
    const complete = ports.startFade.mock.calls[0][0];
    complete();
    complete();
    expect(ports.commitRemoval).toHaveBeenCalledTimes(1);
    expect(ports.removeRuntime).toHaveBeenCalledTimes(1);
    expect(ports.finish).toHaveBeenCalledTimes(1);
  });

  it('handles already-hidden synchronous fade completion without duplicate deletion', () => {
    const ports = removalPorts();
    ports.startFade.mockImplementation((complete) => {
      complete();
      return true;
    });
    startStageEntityRemovalTransition(ports);
    expect(ports.commitRemoval).toHaveBeenCalledTimes(1);
    expect(ports.finish).toHaveBeenCalledTimes(1);
  });

  it('no live Runtime still finalizes its declared removal', () => {
    const ports = removalPorts();
    ports.startFade.mockReturnValue(false);
    startStageEntityRemovalTransition(ports);
    expect(ports.commitRemoval).toHaveBeenCalledTimes(1);
    expect(ports.removeRuntime).toHaveBeenCalledTimes(1);
  });

  it('cancelled completion cannot delete state', () => {
    const ports = removalPorts();
    startStageEntityRemovalTransition(ports);
    ports.isInactive.mockReturnValue(true);
    ports.startFade.mock.calls[0][0]();
    expect(ports.commitRemoval).not.toHaveBeenCalled();
    expect(ports.finish).not.toHaveBeenCalled();
  });

  it('state rejection restores declared visibility and never removes Runtime', () => {
    const ports = removalPorts();
    const error = new Error('precise owner changed');
    ports.commitRemoval.mockImplementation(() => {
      throw error;
    });
    startStageEntityRemovalTransition(ports);
    ports.startFade.mock.calls[0][0]();
    expect(ports.removeRuntime).not.toHaveBeenCalled();
    expect(ports.restoreDeclaredVisibility).toHaveBeenCalledTimes(1);
    expect(ports.finish).toHaveBeenCalledWith(error);
  });

  it('a reentrant replacement during state notification survives the old finalize stack', () => {
    const ports = removalPorts();
    ports.commitRemoval.mockImplementation(() => {
      ports.isInactive.mockReturnValue(true);
    });
    startStageEntityRemovalTransition(ports);
    ports.startFade.mock.calls[0][0]();
    expect(ports.commitRemoval).toHaveBeenCalledTimes(1);
    expect(ports.removeRuntime).not.toHaveBeenCalled();
    expect(ports.finish).not.toHaveBeenCalled();
  });

  it('fade creation failure has exactly one terminal error', () => {
    const ports = removalPorts();
    const error = new Error('fade unavailable');
    ports.startFade.mockImplementation(() => {
      throw error;
    });
    expect(startStageEntityRemovalTransition(ports)).toBe(false);
    expect(ports.finish).toHaveBeenCalledWith(error);
    expect(ports.finish).toHaveBeenCalledTimes(1);
  });

  it('visibility repair failure does not obscure the original rejection or escape callback', () => {
    const ports = removalPorts();
    const error = new Error('state owner conflict');
    ports.commitRemoval.mockImplementation(() => {
      throw error;
    });
    ports.restoreDeclaredVisibility.mockImplementation(() => {
      throw new Error('repair failure');
    });
    startStageEntityRemovalTransition(ports);
    expect(() => ports.startFade.mock.calls[0][0]()).not.toThrow();
    expect(ports.finish).toHaveBeenCalledWith(error);
  });
});
