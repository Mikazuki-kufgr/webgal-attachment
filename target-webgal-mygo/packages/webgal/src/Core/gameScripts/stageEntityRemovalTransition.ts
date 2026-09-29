export interface StageEntityRemovalTransitionPorts {
  isInactive(): boolean;
  startFade(onComplete: () => void): boolean;
  commitRemoval(): void;
  removeRuntime(): void;
  restoreDeclaredVisibility(): void;
  finish(error?: unknown): void;
}

/** Fade-first removal keeps the declaration until its precise finalizer succeeds. */
export function startStageEntityRemovalTransition(ports: StageEntityRemovalTransitionPorts): boolean {
  let terminal = false;
  const restoreAndFinish = (error: unknown) => {
    try {
      ports.restoreDeclaredVisibility();
    } catch {
      // A failed visual repair cannot hide the original finalization failure
      // or escape an animation callback as an unhandled exception.
    }
    ports.finish(error);
  };
  const fail = (error: unknown) => {
    if (terminal) return;
    terminal = true;
    restoreAndFinish(error);
  };
  const finalize = () => {
    if (terminal || ports.isInactive()) return;
    terminal = true;
    try {
      ports.commitRemoval();
      // Committed observers may synchronously install a replacement command.
      // Its Runtime owner must survive this older finalizer's return stack.
      if (ports.isInactive()) return;
      ports.removeRuntime();
      ports.finish();
    } catch (error) {
      restoreAndFinish(error);
    }
  };
  try {
    const started = ports.startFade(finalize);
    if (!started) finalize();
    return started;
  } catch (error) {
    fail(error);
    return false;
  }
}
