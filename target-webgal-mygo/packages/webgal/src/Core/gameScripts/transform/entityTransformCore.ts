import { toEntityAuthorTransform, toEntityWorldTransform } from '@/Core/Modules/stage/stageEntityAuthorCoordinates';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import type { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  baseTransform,
  type IStageState,
  type ITransform,
  type StageEntityStateV0,
} from '@/Core/Modules/stage/stageInterface';
import { applyStageEntityEffectTransaction } from '@/Core/Modules/stage/stageEntityEffect';
import type { AttachmentEntityVisualState } from '@/Core/controller/stage/pixi/attachments/stageEntityVisualState';
import type { AttachmentRuntime } from '@/Core/controller/stage/pixi/attachments/AttachmentRuntime';
import type { IAnimationObject } from '@/Core/controller/stage/pixi/PixiController';
import { parseSetTransformFrame } from '../parseTransformFrame';
import {
  entityVisualToTransform,
  interpolateEntityTransform,
  mergeEntityTransform,
  transformToEntityVisual,
} from './entityTransformValues';

export type EntityTransformSettleReason = 'natural' | 'forced' | 'replaced' | 'cancelled';
export interface EntityTransformSettleEvent {
  reason: EntityTransformSettleReason;
  signal: AbortSignal;
}
export interface EntityTransformRequest {
  animationString: string;
  target: string;
  duration?: number | null;
  ease?: string | null;
  keep?: boolean | null;
  parallel?: boolean | null;
  writeDefault?: boolean | null;
  ignoreDefault?: boolean | null;
  /** Nested reattach starts from committed state and never authors a future calculation. */
  committed?: true;
  /** Reattach: author the durable world endpoint only after a real terminal sample. */
  deferCommittedEffectUntilSettled?: true;
  holdNextUntilSettled?: boolean;
  /** Reattach's Runtime frame consumer tracks a moving destination with this eased progress. */
  onProgress?(progress: number): void;
  onSettled?(event: EntityTransformSettleEvent): void | Promise<void>;
  /** Runs only after the exact transform perform has left its controller. */
  onCompleted?(event: EntityTransformSettleEvent): void;
}
export interface EntityTransformPerform extends IPerform {
  removeTransform(): void;
  forceTransform(): void;
}
export interface EntityTransformHost {
  getStageObjByKey(key: string): { uuid: string; pixiContainer: unknown } | undefined;
  registerAnimation(animation: IAnimationObject, key: string, target: string): void;
  removeAnimationWithoutSetEndState(key: string): void;
  acquireExternalRenderActivity(): () => void;
  requestRender(): void;
}
export interface EntityTransformDependencies {
  manager: StageStateManager;
  runtime: Pick<AttachmentRuntime, 'getEntity' | 'setEntityVisualState' | 'subscribe'>;
  host(): EntityTransformHost | undefined | null;
  animate(duration: number, ease: string, update: (progress: number) => void, complete: () => void): { stop(): void };
  complete(perform: IPerform, reason: EntityTransformSettleReason): void;
  reserve(entityId: string, expected: StageEntityStateV0, previous: AttachmentEntityVisualState): { release(): void };
  report(code: string, message: string): void;
}
type Control = { token: symbol; stop(reason: EntityTransformSettleReason): void };

function sameBinding(a: StageEntityStateV0 | undefined, b: StageEntityStateV0): boolean {
  return (
    !!a &&
    a.entityId === b.entityId &&
    a.renderableKind === b.renderableKind &&
    isEqual(a.source, b.source) &&
    isEqual(
      a.attachmentLink && {
        ...a.attachmentLink,
        attachedLocalVisualState: undefined,
      },
      b.attachmentLink && { ...b.attachmentLink, attachedLocalVisualState: undefined },
    )
  );
}

/** Preflight can run against a virtual legacy promotion before any calculation write. */
export function planEntityTransform(before: IStageState, request: EntityTransformRequest) {
  const target = request.target;
  const frame = parseSetTransformFrame(request.animationString);
  if (!frame) throw new Error('ENTITY_EFFECT_INCOMPATIBLE: malformed entity transform JSON');
  const { duration: unusedDuration, ease: unusedEase, ...authored } = frame;
  const entity = before.stageEntities.find((row) => row.entityId === target);
  if (!entity) throw new Error(`ENTITY_STATE_INCOMPATIBLE: missing entity transform target ${target}`);
  const previousEffect = before.effects.find((row) => row.target === target)?.transform;
  if (!previousEffect) throw new Error(`ENTITY_EFFECT_INCOMPATIBLE: missing effect ${target}`);
  const writeFull = !request.parallel && !request.ignoreDefault;
  const baseline = request.writeDefault
    ? { ...cloneDeep(baseTransform), skew: { x: 0, y: 0 } }
    : request.committed
    ? previousEffect
    : toEntityAuthorTransform(entity, previousEffect);
  const authorPatch = writeFull ? mergeEntityTransform(baseline, authored) : authored;
  // Reattach's internal flight already supplies world values.
  const endPatch = request.committed ? authorPatch : toEntityWorldTransform(entity, authorPatch);
  const planned = applyStageEntityEffectTransaction(before, { target, transform: endPatch });
  if (!planned.applied) throw new Error(planned.violations.map((v) => `${v.code}: ${v.message}`).join('; '));
  return {
    entity,
    endPatch,
    expected: cloneDeep(planned.state.stageEntities.find((row) => row.entityId === target)!),
    terminal: cloneDeep(planned.state.effects.find((row) => row.target === target)!.transform!),
  };
}

/** Deferred entity-only performer. Native figure/background setTransform remains upstream-owned. */
export function createEntityTransformPerformer(dependencies: EntityTransformDependencies) {
  const active = new Map<string, Map<symbol, Control>>();
  let sequence = 0;
  const removeTarget = (target: string) => {
    const controls = [...(active.get(target)?.values() ?? [])];
    controls.forEach((control) => control.stop('cancelled'));
    return controls.length > 0;
  };
  const perform = (request: EntityTransformRequest): EntityTransformPerform => {
    const { manager, runtime } = dependencies;
    const target = request.target;
    const duration = Number.isFinite(request.duration ?? 500) ? Math.max(0, request.duration ?? 500) : 500;
    const before = request.committed ? manager.getViewStageState() : manager.getCalculationStageState();
    const { entity, endPatch, expected, terminal } = planEntityTransform(before, request);
    const deferredCommittedSource =
      request.committed && request.deferCommittedEffectUntilSettled ? cloneDeep(entity) : undefined;
    const previousView = manager.getViewStageState().stageEntities.find((row) => row.entityId === target);
    let reservation: { release(): void } | undefined;
    if (!request.committed) {
      manager.updateEffect({ target, transform: endPatch });
      reservation = dependencies.reserve(target, expected, cloneDeep(previousView?.visualState ?? entity.visualState));
    }

    const token = Symbol(target),
      id = ++sequence,
      key = `entity-transform-${target}-${id}`;
    const abort = new AbortController();
    let phase: 'pending' | 'waiting' | 'running' | 'held' | 'settling' | 'done' = 'pending';
    let host: EntityTransformHost | undefined | null;
    let targetObject: ReturnType<EntityTransformHost['getStageObjByKey']>;
    let expectedView: IStageState | undefined;
    let driver: { stop(): void } | undefined;
    let unsubscribe: (() => void) | undefined;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    let releaseRender: (() => void) | undefined;
    let registered = false;
    let from: ITransform | undefined;
    let stopped = false;
    const safely = (step: string, callback: () => void) => {
      try {
        callback();
      } catch (error) {
        dependencies.report('ENTITY_TRANSFORM_CLEANUP_FAILED', `${step}: ${String(error)}`);
      }
    };
    const owns = () => active.get(target)?.get(token)?.token === token;
    const ownsObject = () =>
      owns() &&
      host === dependencies.host() &&
      !!targetObject &&
      host?.getStageObjByKey(target)?.uuid === targetObject.uuid &&
      host.getStageObjByKey(target)?.pixiContainer === targetObject.pixiContainer;
    const cleanupWait = () => {
      safely('unsubscribe-ready', () => unsubscribe?.());
      unsubscribe = undefined;
      if (waitTimer) clearTimeout(waitTimer);
      waitTimer = undefined;
    };
    const releaseReservation = () => {
      safely('release-presentation', () => reservation?.release());
      reservation = undefined;
    };
    const apply = (progress: number) => {
      if (!ownsObject() || !from) return false;
      const snapshot = runtime.getEntity(target);
      const current = snapshot?.visualState;
      if (!current) return false;
      const patch = interpolateEntityTransform(from, terminal, endPatch, progress);
      const visual = transformToEntityVisual(mergeEntityTransform(entityVisualToTransform(current), patch), current);
      // A hide transition temporarily keeps the host visible. Preserve the
      // Runtime declaration, not that transient render gate, while animating.
      visual.visible = snapshot?.visible ?? current.visible;
      if (!runtime.setEntityVisualState(target, visual)) return false;
      request.onProgress?.(progress);
      host?.requestRender();
      return true;
    };
    const finish = (reason: EntityTransformSettleReason) => {
      if (phase === 'done') return;
      if (phase === 'settling') {
        if (reason !== 'natural') abort.abort();
        return;
      }
      const wasStarted = phase !== 'pending';
      phase = 'settling';
      cleanupWait();
      safely('stop-animation-driver', () => driver?.stop());
      driver = undefined;
      if (reason !== 'natural') abort.abort();
      let ownedTerminalSample = false;
      if (wasStarted && reason !== 'cancelled' && !request.keep)
        safely('apply-terminal-state', () => {
          ownedTerminalSample = apply(1) && ownsObject();
        });
      if (registered) {
        safely('unregister-owned-animation', () => host?.removeAnimationWithoutSetEndState(key));
        registered = false;
      }
      safely('release-render-activity', () => releaseRender?.());
      releaseRender = undefined;
      releaseReservation();
      // Cleanup hooks may synchronously start a same-ID replacement. A deferred
      // return flight has no authority to publish across that new owner.
      const ownsDeferredTerminal =
        ownedTerminalSample &&
        ownsObject() &&
        active.get(target)?.size === 1 &&
        (reason !== 'natural' || !abort.signal.aborted);
      active.get(target)?.delete(token);
      if (active.get(target)?.size === 0) active.delete(target);
      // Ordinary transforms retain the captured view guard. Reattach can span
      // an unrelated native commit, but only its exact unchanged entity and
      // owned terminal Runtime sample may publish the deferred endpoint.
      const terminalView = deferredCommittedSource ? manager.getViewStageState() : expectedView;
      const canPublishTerminal = deferredCommittedSource
        ? ownsDeferredTerminal &&
          isEqual(
            terminalView?.stageEntities.find((row) => row.entityId === target),
            deferredCommittedSource,
          )
        : expectedView === manager.getViewStageState();
      if (wasStarted && terminalView && reason !== 'cancelled' && !request.keep && canPublishTerminal) {
        safely('publish-terminal-effect', () =>
          manager.applyCommittedStageEntityEffect(terminalView, { target, transform: endPatch }),
        );
      }
      let settled: void | Promise<void> = undefined;
      try {
        settled = request.onSettled?.({ reason, signal: abort.signal });
      } catch (error) {
        dependencies.report('ENTITY_TRANSFORM_SETTLEMENT_FAILED', String(error));
      }
      Promise.resolve(settled)
        .catch((error) => dependencies.report('ENTITY_TRANSFORM_SETTLEMENT_FAILED', String(error)))
        .finally(() => {
          phase = 'done';
          try {
            if (wasStarted) dependencies.complete(result, reason);
          } finally {
            try {
              request.onCompleted?.({ reason, signal: abort.signal });
            } catch (error) {
              dependencies.report('ENTITY_TRANSFORM_COMPLETION_OBSERVER_FAILED', String(error));
            }
          }
        });
    };
    const tryStart = () => {
      if (phase !== 'waiting') return;
      const viewEntity = manager.getViewStageState().stageEntities.find((row) => row.entityId === target);
      if (!sameBinding(viewEntity, expected)) {
        finish('cancelled');
        return;
      }
      host = dependencies.host();
      targetObject = host?.getStageObjByKey(target);
      const current = runtime.getEntity(target);
      if (!host || !targetObject || !current?.visualState) return;
      cleanupWait();
      expectedView = manager.getViewStageState();
      from = entityVisualToTransform(current.visualState);
      phase = 'running';
      releaseRender = host.acquireExternalRenderActivity();
      const animation: IAnimationObject = {
        setStartState: () => {
          apply(0);
        },
        setEndState: () => {
          driver?.stop();
          apply(1);
        },
        tickerFunc: () => {
          if (!ownsObject()) finish('cancelled');
        },
        forceStopWithoutSetEndState: () => {
          safely('host-stop-animation-driver', () => driver?.stop());
        },
        getEndStateEffect: () => cloneDeep(endPatch),
      };
      registered = true;
      host.registerAnimation(animation, key, target);
      releaseReservation();
      if (request.committed && !request.deferCommittedEffectUntilSettled) {
        const published = manager.applyCommittedStageEntityEffect(expectedView, { target, transform: endPatch });
        if (!published.applied) {
          finish('cancelled');
          return;
        }
        expectedView = manager.getViewStageState();
      }
      const complete = () => {
        if (phase !== 'running') return;
        try {
          if (!apply(1)) {
            finish('cancelled');
            return;
          }
        } catch (error) {
          dependencies.report('ENTITY_TRANSFORM_UPDATE_FAILED', String(error));
          finish('cancelled');
          return;
        }
        if (request.keep) {
          phase = 'held';
          safely('stop-kept-animation', () => driver?.stop());
          driver = undefined;
          safely('release-kept-render-activity', () => releaseRender?.());
          releaseRender = undefined;
        } else finish('natural');
      };
      if (duration === 0) complete();
      else {
        const created = dependencies.animate(
          duration,
          request.ease ?? '',
          (value) => {
            if (phase !== 'running') return;
            try {
              if (!apply(value)) finish('cancelled');
            } catch (error) {
              dependencies.report('ENTITY_TRANSFORM_UPDATE_FAILED', String(error));
              finish('cancelled');
            }
          },
          complete,
        );
        if (phase === 'running') driver = created;
        else created.stop();
      }
    };
    const result: EntityTransformPerform = {
      performName: `animation-${target}${request.parallel ? '#' + id : ''}`,
      duration,
      isHoldOn: !!request.keep || !!request.holdNextUntilSettled,
      manualCompletion: true,
      startFunction: () => {
        if (phase !== 'pending') return;
        if (!request.parallel) [...(active.get(target)?.values() ?? [])].forEach((control) => control.stop('replaced'));
        if (!active.has(target)) active.set(target, new Map());
        active.get(target)!.set(token, { token, stop: finish });
        phase = 'waiting';
        unsubscribe = runtime.subscribe((event) => {
          if (phase === 'waiting') {
            if (event.type === 'instance-error' && event.instance.entityId === target) {
              dependencies.report('ENTITY_TRANSFORM_TARGET_FAILED', `Entity ${target} failed before transform start`);
              finish('cancelled');
            } else tryStart();
          } else if ((phase === 'running' || phase === 'held') && !ownsObject()) finish('cancelled');
        });
        waitTimer = setTimeout(() => {
          dependencies.report('ENTITY_TRANSFORM_TARGET_TIMEOUT', `Entity ${target} not ready within 10000 ms`);
          finish('cancelled');
        }, 10000);
        try {
          tryStart();
        } catch (error) {
          dependencies.report('ENTITY_TRANSFORM_START_FAILED', String(error));
          finish('cancelled');
        }
      },
      stopFunction: (reason) => {
        if (!stopped) {
          stopped = true;
          finish(
            reason === 'replaced'
              ? 'replaced'
              : ['cancelled', 'reset', 'start-failed'].includes(reason ?? '')
              ? 'cancelled'
              : 'forced',
          );
        }
      },
      onDiscard: () => {
        releaseReservation();
        phase = 'done';
        abort.abort();
      },
      blockingNext: () => phase === 'waiting' || (!!request.holdNextUntilSettled && phase !== 'done'),
      blockingAuto: () => !request.keep && phase !== 'done',
      removeTransform: () => finish('cancelled'),
      forceTransform: () => finish('forced'),
    };
    return result;
  };
  return { perform, removeTarget };
}
