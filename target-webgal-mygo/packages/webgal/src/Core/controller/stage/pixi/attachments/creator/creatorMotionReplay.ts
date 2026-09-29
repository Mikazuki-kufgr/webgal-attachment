import type { ActiveLive2DFigureResult } from '../../PixiController';

const owners = new WeakMap<object, Map<string, symbol>>();
export function invalidateCreatorMotionReplay(host: object, key: string) {
  owners.get(host)?.delete(key);
}

/** Explicit repeat uses the real model.motion Promise, guarded against late UUID/intent results. */
export async function replayCreatorMotion(
  host: object,
  getActive: (key: string) => ActiveLive2DFigureResult,
  record: (key: string, motion: string) => void,
  key: string,
  motion: string,
  expectedGeneration?: string,
) {
  const failure = (reason: string, modelCount = 0, acceptedCount = 0) => ({
    started: false,
    modelCount,
    acceptedCount,
    reason,
  });
  const active = getActive(key);
  if (active.status !== 'ready') return failure('LIVE2D_TARGET_NOT_READY');
  if (expectedGeneration !== undefined && active.figure.uuid !== expectedGeneration)
    return failure('FIGURE_GENERATION_CHANGED');
  if (!motion || /[\x00-\x1f]/.test(motion)) return failure('LIVE2D_MOTION_INVALID');
  const token = Symbol('creator-motion');
  let byKey = owners.get(host);
  if (!byKey) owners.set(host, (byKey = new Map()));
  byKey.set(key, token);
  const stillCurrent = () => {
    const current = getActive(key);
    return (
      byKey!.get(key) === token &&
      current.status === 'ready' &&
      current.figure.uuid === active.figure.uuid &&
      current.figure.model === active.figure.model
    );
  };
  try {
    active.figure.model.internalModel?.motionManager?.stopAllMotions?.();
    const accepted = await active.figure.model.motion(motion, 0, 3);
    if (!stillCurrent()) return failure('CREATOR_MOTION_SUPERSEDED', 1, accepted ? 1 : 0);
    if (!accepted) return failure('LIVE2D_MOTION_REJECTED', 1);
    record(key, motion);
    return { started: true, modelCount: 1, acceptedCount: 1, reason: undefined };
  } finally {
    if (byKey.get(key) === token) byKey.delete(key);
  }
}
