import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import { WEBGAL_NONE } from '@/Core/constants';
import type { ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import type { AttachmentLinkV0, StageEntityStateV0, VisualStateV0 } from '@/Core/Modules/stage/stageInterface';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import type { StageEntityStateTransaction } from '@/Core/Modules/stage/stageEntityStateTransaction';
import { applyStageEntityEffectTransaction } from '@/Core/Modules/stage/stageEntityEffect';
import { attachmentRuntime } from '@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton';
import { normalizeStageEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import {
  StageEntityOperationError,
  stageEntityOperationDiagnostic,
} from '@/Core/controller/stage/pixi/attachments/stageEntityOperationError';
import type { AttachmentEntityVisualState } from '@/Core/controller/stage/pixi/attachments/stageEntityVisualState';
import { isAttachmentSemanticAnchorId } from '@/Core/controller/stage/pixi/attachments/semanticAnchorContract';
import { getBooleanArgByKey, getStringArgByKey } from '@/Core/util/getSentenceArg';
import { WebGAL } from '@/Core/WebGAL';
import { resolveStageEntityIdentity, type StageEntityIdentityResolution } from './legacyAttachmentProjection';
import { createStageEntityOperationPerform, stageEntityOperationPerformName } from './stageEntityOperationLifecycle';
import { startStageEntityRemovalTransition } from './stageEntityRemovalTransition';
import {
  commitCalculatedEntityTransaction,
  commitPresentedEntityTransaction,
  createVisibilityCommandPerform,
  getEntityCommandDuration,
  refreshAttachmentPresentation,
  retireEntityCommandIntent,
} from './stageEntityCommandState';
import { performEntityTransform } from './transform/performEntityTransform';
import {
  retainPendingCommittedStageEntity,
  releasePendingCommittedStageEntity,
  type PendingCommittedStageEntityToken,
} from '@/Core/Modules/stage/stageEntityPersistence';

const ACTIONS = ['detach', 'reattach', 'hide', 'show', 'remove'] as const;
type Action = (typeof ACTIONS)[number];

function noop(): IPerform {
  return {
    performName: WEBGAL_NONE,
    duration: 0,
    isHoldOn: false,
    stopFunction: () => {},
    blockingNext: () => false,
    blockingAuto: () => false,
  };
}

function report(code: string, message: string, sentence: ISentence, error?: StageEntityOperationError) {
  console.error({
    scope: 'webgal.stage-entity.command',
    code,
    message,
    action: sentence.content.trim(),
    args: sentence.args,
    ...(error ? { operationError: stageEntityOperationDiagnostic(error) } : {}),
  });
}

function changed(entityId: string, operation: string): StageEntityOperationError {
  return new StageEntityOperationError(
    'ENTITY_TRANSITION_TARGET_LOST',
    `Stage entity ${entityId} changed before ${operation}`,
    {
      details: { entityId, operation },
    },
  );
}

function currentPresented(expected: StageEntityIdentityResolution): StageEntityIdentityResolution {
  const current = resolveStageEntityIdentity(stageStateManager.getViewStageState(), expected.entityId);
  if (
    current.invariantError ||
    !isEqual(current.entity, expected.entity) ||
    !isEqual(current.legacyAttachment, expected.legacyAttachment)
  )
    throw changed(expected.entityId, 'committed-command-start');
  return current;
}

function commitPresented(transaction: StageEntityStateTransaction, sentence: ISentence, entityId: string) {
  // Runtime commits its entity maps after this synchronous finalizer returns.
  // Do not let a subscriber launch a new command into that half-committed gap.
  const result = commitPresentedEntityTransaction(transaction, sentence, { notify: false });
  if (!result.applied) {
    const violation = result.violations[0];
    const code =
      violation?.code === 'ENTITY_ID_CONFLICT' ||
      violation?.code === 'ENTITY_LEGACY_ALIAS_DUPLICATE' ||
      violation?.code === 'ENTITY_SLOT_CONFLICT'
        ? violation.code
        : 'ENTITY_TRANSITION_TARGET_LOST';
    throw new StageEntityOperationError(
      code,
      violation?.message ?? `Stage entity ${entityId} state finalizer rejected`,
      {
        details: { entityId, operation: 'state-finalize', stateViolationCode: violation?.code },
      },
    );
  }
}

function operation(
  sentence: ISentence,
  resolution: StageEntityIdentityResolution,
  start: (
    finish: (error?: unknown) => void,
    isInactive: () => boolean,
    current: StageEntityIdentityResolution,
    cancel: () => void,
    signal: AbortSignal,
  ) => void | Promise<void>,
  onTerminal?: () => void,
): IPerform {
  const expected = cloneDeep(resolution);
  let presented: StageEntityIdentityResolution;
  const perform = createStageEntityOperationPerform(
    expected.entityId,
    ({ finish, cancel, isInactive, signal }) => {
      return start(finish, isInactive, presented, cancel, signal);
    },
    {
      completePerform: (owner) => {
        // Fast preview owns advancement after its exact barrier; a second
        // -continue scheduler must not run past the requested target.
        if (WebGAL.gameplay.isFastPreview) owner.goNextWhenOver = false;
        WebGAL.gameplay.performController.completePerform(owner);
      },
      validateStart: () => {
        presented = currentPresented(expected);
      },
      onStart: () => {
        retireEntityCommandIntent(expected.entityId);
        attachmentRuntime.cancelEntityVisibilityTransition(expected.entityId, false);
        attachmentRuntime.cancelEntityOperation(expected.entityId);
      },
      cancelRuntimeOperation: (entityId, settleVisibility) => {
        try {
          attachmentRuntime.cancelEntityVisibilityTransition(entityId, settleVisibility);
        } finally {
          attachmentRuntime.cancelEntityOperation(entityId);
        }
      },
      removeTransformOwner: (entityId) => {
        attachmentRuntime.removeEntityTransform(entityId);
      },
      reportError: (error) => report(error.code, error.message, sentence, error),
      onTerminal,
      onDiscard: () =>
        report(
          'STAGE_ENTITY_RUNTIME_SAMPLE_DEFERRED',
          'This uncommitted operation needs a real Runtime frame; preview discarded it without inventing a world pose or changing attachment state.',
          sentence,
        ),
    },
  );
  // A blocking remove can inherit attachment's parser default -next. Resume
  // only after real fade completion, rather than silently dropping that intent.
  if (getBooleanArgByKey(sentence, 'next') ?? false) perform.goNextWhenOver = true;
  return perform;
}

function detach(sentence: ISentence, resolution: StageEntityIdentityResolution): IPerform {
  const coordinates = getStringArgByKey(sentence, 'coordinates')?.trim() || 'figure';
  if (coordinates !== 'figure' && coordinates !== 'world') {
    report('STAGE_ENTITY_COORDINATES_INVALID', 'detach -coordinates must be figure or world.', sentence);
    return noop();
  }
  if (resolution.entity && !resolution.entity.attachmentLink) {
    report('ENTITY_STATE_INCOMPATIBLE', `Stage entity "${resolution.entityId}" is already free.`, sentence);
    return noop();
  }
  return operation(sentence, resolution, async (finish, isInactive, current, _cancel, signal) => {
    await attachmentRuntime.requestDetach(
      current.entityId,
      (result) => {
        if (isInactive()) throw changed(current.entityId, 'detach-state-finalize');
        const authorCoordinates =
          coordinates === 'figure'
            ? { freePositionOrigin: cloneDeep(result.freePositionOrigin ?? { x: 0, y: 0 }) }
            : {};
        const transaction: StageEntityStateTransaction = current.entity
          ? {
              kind: 'detach',
              entityId: current.entityId,
              expectedEntity: current.entity,
              visualState: cloneDeep(result.visualState),
              ...authorCoordinates,
            }
          : {
              kind: 'promote-and-detach',
              entityId: current.entityId,
              expectedAttachment: current.legacyAttachment!,
              visualState: cloneDeep(result.visualState),
              ...authorCoordinates,
            };
        commitPresented(transaction, sentence, current.entityId);
        return true;
      },
      signal,
    );
    if (isInactive()) return;
    refreshAttachmentPresentation(true);
    finish();
  });
}

function parentReady(entityId: string, figureKey: string) {
  const stage = WebGAL.gameplay.pixiStage;
  if (!stage) throw new StageEntityOperationError('ENTITY_PARENT_NOT_FOUND', `No Pixi stage can resolve ${figureKey}`);
  const result = stage.getActiveLive2DFigure(figureKey);
  if (result.status === 'ready') return;
  const code =
    result.status === 'ambiguous'
      ? 'ENTITY_PARENT_AMBIGUOUS'
      : result.status === 'exiting'
      ? 'ENTITY_PARENT_EXITING'
      : result.status === 'loading'
      ? 'ENTITY_PARENT_LOADING_TIMEOUT'
      : 'ENTITY_PARENT_NOT_FOUND';
  throw new StageEntityOperationError(code, `Reattach parent ${figureKey} is ${result.status}`, {
    details: {
      entityId,
      operation: 'reattach-parent-resolve',
      figureKey,
      parentStatus: result.status,
      ...(result.status === 'ambiguous' ? { activeUuids: result.uuids } : {}),
    },
  });
}

function link(entity: StageEntityStateV0, figureKey: string, local: VisualStateV0, anchor: string): AttachmentLinkV0 {
  return {
    schemaVersion: 0,
    parentKind: 'figure',
    parentFigureKey: figureKey,
    semanticAnchor: anchor,
    placementPresetId: entity.source.configId,
    inheritancePolicy: { transform: true, opacity: true, visibility: true },
    attachedLocalVisualState: { ...cloneDeep(local), space: 'local' },
  };
}

function transformFrame(state: AttachmentEntityVisualState) {
  const appearance = state.appearance;
  return JSON.stringify({
    position: state.position,
    scale: state.scale,
    rotation: state.rotation,
    ...(state.skew ? { skew: state.skew } : {}),
    alpha: state.opacity,
    ...(appearance
      ? {
          blur: appearance.blur,
          brightness: appearance.brightness,
          contrast: appearance.contrast ?? 1,
          saturation: appearance.saturation ?? 1,
          gamma: appearance.gamma ?? 1,
          colorRed: appearance.color.red,
          colorGreen: appearance.color.green,
          colorBlue: appearance.color.blue,
          bevel: appearance.bevel?.strength ?? 0,
          bevelThickness: appearance.bevel?.thickness ?? 0,
          bevelRotation: appearance.bevel?.rotation ?? 0,
          bevelSoftness: appearance.bevel?.softness ?? 0,
          bevelRed: appearance.bevel?.color.red ?? 255,
          bevelGreen: appearance.bevel?.color.green ?? 255,
          bevelBlue: appearance.bevel?.color.blue ?? 255,
          bloom: appearance.bloom?.strength ?? 0,
          bloomBrightness: appearance.bloom?.brightness ?? 1,
          bloomBlur: appearance.bloom?.blur ?? 0,
          bloomThreshold: appearance.bloom?.threshold ?? 0,
          shockwaveFilter: appearance.shockwave ?? 0,
          radiusAlphaFilter: appearance.radiusAlpha ?? 0,
        }
      : {}),
  });
}

function reattach(sentence: ISentence, resolution: StageEntityIdentityResolution): IPerform {
  const entity = resolution.entity;
  if (!entity || entity.attachmentLink) {
    report('ENTITY_STATE_INCOMPATIBLE', `Stage entity "${resolution.entityId}" is already attached.`, sentence);
    return noop();
  }
  const figureKey = getStringArgByKey(sentence, 'figure')?.trim() ?? '';
  if (!figureKey) {
    report('STAGE_ENTITY_MISSING_ARGUMENT', 'stageEntity:reattach requires -figure.', sentence);
    return noop();
  }
  const anchor = getStringArgByKey(sentence, 'anchor')?.trim() || 'head';
  const modelProfileId = getStringArgByKey(sentence, 'profile')?.trim() || undefined;
  if (!isAttachmentSemanticAnchorId(anchor)) {
    report(
      'STAGE_ENTITY_SEMANTIC_ANCHOR_INVALID',
      'stageEntity:reattach -anchor must identify a supported semantic anchor.',
      sentence,
    );
    return noop();
  }
  const duration = getEntityCommandDuration(sentence, 500);
  const ease = getStringArgByKey(sentence, 'ease') ?? '';
  let persistenceToken: PendingCommittedStageEntityToken | undefined;
  return operation(
    sentence,
    resolution,
    async (finish, isInactive, current, cancel) => {
      const source = current.entity!;
      // Capture only after the exact committed owner is validated. A save during
      // the return flight must not mistake its authored endpoint for a completed link.
      persistenceToken = retainPendingCommittedStageEntity(source);
      parentReady(source.entityId, figureKey);
      const prepared = await attachmentRuntime.prepareReattach(
        source.entityId,
        figureKey,
        undefined,
        anchor,
        modelProfileId,
      );
      if (isInactive()) return;
      const flightFrame = transformFrame({
        ...prepared.targetVisualState,
        ...(source.visualState.appearance ? { appearance: source.visualState.appearance } : {}),
      });
      // Use the same pure effect normalizer as shared setTransform. It may make
      // appearance defaults explicit; raw geometry equality would reject a
      // successful return flight merely because of that schema normalization.
      const flightPlan = applyStageEntityEffectTransaction(stageStateManager.getViewStageState(), {
        target: source.entityId,
        transform: JSON.parse(flightFrame),
      });
      if (!flightPlan.applied) throw changed(source.entityId, 'reattach-flight-plan');
      const expectedAfterFlight = flightPlan.state.stageEntities.find((row) => row.entityId === source.entityId)!;
      let returnFlightError: unknown;
      let returnFlightCancelled = false;
      const transform = performEntityTransform({
        target: source.entityId,
        duration,
        ease,
        committed: true,
        deferCommittedEffectUntilSettled: true,
        holdNextUntilSettled: true,
        animationString: flightFrame,
        onProgress: (progress) => attachmentRuntime.setReattachFlightProgress(prepared.token, progress),
        onSettled: async (event) => {
          if (isInactive()) return;
          if (event.reason !== 'natural' || event.signal.aborted) {
            attachmentRuntime.cancelEntityOperation(source.entityId);
            returnFlightCancelled = true;
            return;
          }
          try {
            await attachmentRuntime.commitReattach(prepared.token, (result) => {
              if (isInactive() || event.signal.aborted) throw changed(source.entityId, 'reattach-state-finalize');
              const actual = resolveStageEntityIdentity(stageStateManager.getViewStageState(), source.entityId).entity;
              if (!isEqual(actual, expectedAfterFlight)) throw changed(source.entityId, 'reattach-return-flight');
              commitPresented(
                {
                  kind: 'reattach',
                  entityId: source.entityId,
                  expectedEntity: actual!,
                  attachmentLink: link(source, figureKey, result.visualState, anchor),
                  ...(result.modelProfileId ? { modelProfileId: result.modelProfileId } : {}),
                },
                sentence,
                source.entityId,
              );
              return true;
            });
            if (isInactive()) return;
            refreshAttachmentPresentation(true);
          } catch (error) {
            returnFlightError = error;
          }
        },
        onCompleted: () => {
          if (isInactive()) return;
          if (returnFlightCancelled) cancel();
          else finish(returnFlightError);
        },
      });
      if (isInactive()) {
        transform.removeTransform();
        return;
      }
      WebGAL.gameplay.performController.arrangeNewPerform(
        transform,
        {
          ...sentence,
          args: sentence.args.filter((argument) => argument.key !== 'next' && argument.key !== 'continue'),
        },
        false,
      );
    },
    () => {
      if (persistenceToken) releasePendingCommittedStageEntity(persistenceToken);
    },
  );
}

function removalTransaction(resolution: StageEntityIdentityResolution): StageEntityStateTransaction {
  return {
    kind: 'remove',
    ...(resolution.entity ? { entityId: resolution.entityId, expectedEntity: resolution.entity } : {}),
    ...(resolution.legacyAttachment ? { expectedAttachment: resolution.legacyAttachment } : {}),
  };
}

function restoreVisibility(entityId: string) {
  const current = resolveStageEntityIdentity(stageStateManager.getViewStageState(), entityId);
  const visible = current.entity?.visualState.visible ?? current.legacyAttachment?.visible;
  if (visible !== undefined) attachmentRuntime.setEntityVisible(entityId, visible);
}

function remove(sentence: ISentence, resolution: StageEntityIdentityResolution): IPerform {
  const duration = getEntityCommandDuration(sentence, 0);
  if (duration === 0) {
    if (!commitCalculatedEntityTransaction(removalTransaction(resolution), sentence)) return noop();
    return {
      performName: stageEntityOperationPerformName(resolution.entityId),
      duration: 0,
      isHoldOn: false,
      startFunction: () => {
        // A later collected add owns the final view: never remove its Runtime.
        const current = resolveStageEntityIdentity(stageStateManager.getViewStageState(), resolution.entityId);
        if (current.entity || current.legacyAttachment) return;
        retireEntityCommandIntent(resolution.entityId);
        attachmentRuntime.removeEntity(resolution.entityId);
        refreshAttachmentPresentation();
      },
      stopFunction: () => {},
      blockingNext: () => false,
      blockingAuto: () => false,
    };
  }
  const ease = getStringArgByKey(sentence, 'ease') ?? '';
  return operation(sentence, resolution, (finish, isInactive, current) => {
    startStageEntityRemovalTransition({
      isInactive,
      startFade: (complete) =>
        attachmentRuntime.beginEntityVisibilityTransition(current.entityId, false, duration, ease, complete),
      commitRemoval: () => commitPresented(removalTransaction(current), sentence, current.entityId),
      removeRuntime: () => {
        const after = resolveStageEntityIdentity(stageStateManager.getViewStageState(), current.entityId);
        if (after.entity || after.legacyAttachment) return;
        attachmentRuntime.removeEntity(current.entityId);
        refreshAttachmentPresentation(true);
      },
      restoreDeclaredVisibility: () => restoreVisibility(current.entityId),
      finish,
    });
  });
}

/** Calculation-only dispatch; all Runtime access resides in committed starts. */
export function stageEntity(sentence: ISentence): IPerform {
  const action = sentence.content.trim() as Action;
  if (!ACTIONS.includes(action)) {
    report('STAGE_ENTITY_UNKNOWN_ACTION', `Expected ${ACTIONS.join(', ')}; received "${action}".`, sentence);
    return noop();
  }
  if ((action === 'detach' || action === 'reattach') && (getBooleanArgByKey(sentence, 'next') ?? false)) {
    report('STAGE_ENTITY_ASYNC_NEXT_FORBIDDEN', 'Use -continue; async stageEntity commands reject -next.', sentence);
    return noop();
  }
  if (getStringArgByKey(sentence, 'space') !== null) {
    report(
      'ENTITY_SPACE_OVERRIDE_UNSUPPORTED',
      'Local/world space follows attached/free state; explicit -space is unsupported.',
      sentence,
    );
    return noop();
  }
  let entityId: string;
  try {
    entityId = normalizeStageEntityId(getStringArgByKey(sentence, 'entity') ?? '');
  } catch (error) {
    report('STAGE_ENTITY_MISSING_OR_INVALID_ID', error instanceof Error ? error.message : String(error), sentence);
    return noop();
  }
  const resolution = resolveStageEntityIdentity(stageStateManager.getCalculationStageState(), entityId);
  if (resolution.invariantError) {
    report('ENTITY_ID_CONFLICT', resolution.invariantError, sentence);
    return noop();
  }
  if (!resolution.entity && !resolution.legacyAttachment) {
    report('ENTITY_NOT_FOUND', `Stage entity "${entityId}" does not exist.`, sentence);
    return noop();
  }
  if (action === 'detach') return detach(sentence, resolution);
  if (action === 'reattach') return reattach(sentence, resolution);
  if (action === 'remove') return remove(sentence, resolution);
  return createVisibilityCommandPerform(
    sentence,
    resolution,
    action === 'show',
    getEntityCommandDuration(sentence, 500),
    getStringArgByKey(sentence, 'ease') ?? 'easeInOut',
    true,
  );
}
