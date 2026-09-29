import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import type { ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IAttachmentState, StageEntityStateV0 } from '@/Core/Modules/stage/stageInterface';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { WebGAL } from '@/Core/WebGAL';
import { acquireGameAdvanceLock, releaseGameAdvanceLock } from '@/Core/controller/gamePlay/gameInputBoundary';
import { attachmentRuntime } from '@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton';
import { protectAttachmentAddFailure } from '@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation';
import { resolveLegacyAttachmentTarget } from './legacyAttachmentProjection';
import {
  claimAttachmentAddIntent,
  retireEntityCommandIntent,
  commitCalculatedEntityTransaction,
  commitPresentedEntityTransaction,
  reportEntityCommandStateError,
  refreshAttachmentPresentation,
} from './stageEntityCommandState';

interface AddFadeOptions {
  figureKey: string;
  attachmentId: string;
  entityId: string;
  configId: string;
  slot: string;
  semanticAnchor: string;
  duration: number;
  ease: string;
  sentence: ISentence;
  expectedAttachment: IAttachmentState;
  expectedEntity?: StageEntityStateV0;
  previousAttachment?: IAttachmentState;
  previousEntity?: StageEntityStateV0;
}
const pendingBases = new Map<
  string,
  { ticket: symbol; previousAttachment?: IAttachmentState; previousEntity?: StageEntityStateV0 }
>();
let addAdvanceLockRevision = 0;

export function createInstantAddPerform(entityId: string): IPerform {
  return {
    performName: `stage-entity-operation-${entityId}`,
    duration: 0,
    isHoldOn: false,
    startFunction() {
      retireEntityCommandIntent(entityId);
      attachmentRuntime.cancelEntityVisibilityTransition(entityId, false);
      refreshAttachmentPresentation();
    },
    stopFunction() {},
    blockingNext: () => false,
    blockingAuto: () => false,
  };
}

/** Hidden declaration is calculated first. Readiness/fade/rollback have a single committed owner. */
export function createAddFadePerform(input: AddFadeOptions): IPerform {
  const options = cloneDeep(input),
    { entityId, sentence } = options;
  // Several adds collected in one forward have not committed intermediate A.
  // A superseding B inherits A's rollback base, not A's never-presented hidden row.
  const previous = pendingBases.get(entityId);
  if (previous) {
    options.previousAttachment = previous.previousAttachment;
    options.previousEntity = previous.previousEntity;
  }
  const ticket = Symbol(entityId);
  pendingBases.set(entityId, {
    ticket,
    previousAttachment: options.previousAttachment,
    previousEntity: options.previousEntity,
  });
  const protection = protectAttachmentAddFailure(options.expectedAttachment);
  let inactive = false,
    published = false,
    fadeCompleted = false,
    preparingVisibility = false,
    poseSupervisionSettled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let poseSupervision: AbortController | undefined;
  let owner: ReturnType<typeof claimAttachmentAddIntent> | undefined;
  const advanceLockOwner = `attachment-add-first-pose:${entityId}:${++addAdvanceLockRevision}`;
  let advanceLocked = false;
  const lockUserAdvance = () => {
    if (advanceLocked) return;
    advanceLocked = true;
    acquireGameAdvanceLock(advanceLockOwner);
  };
  const unlockUserAdvance = () => {
    if (!advanceLocked) return;
    advanceLocked = false;
    releaseGameAdvanceLock(advanceLockOwner);
  };
  const clearWait = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  };
  const clearPoseSupervision = () => {
    poseSupervision?.abort();
    poseSupervision = undefined;
  };
  const releasePending = () => {
    if (pendingBases.get(entityId)?.ticket === ticket) pendingBases.delete(entityId);
  };
  const binding = (entity: StageEntityStateV0 | undefined) =>
    entity
      ? {
          ...entity,
          visualState: undefined,
          attachmentLink: entity.attachmentLink
            ? { ...entity.attachmentLink, attachedLocalVisualState: undefined }
            : null,
        }
      : undefined;
  const sameAttachmentDeclaration = (attachment: IAttachmentState | undefined) => {
    if (isEqual(attachment, options.expectedAttachment)) return true;
    if (!attachment || options.expectedAttachment.entityId || attachment.entityId !== entityId) return false;
    const { entityId: promotedEntityId, ...promotedAttachment } = attachment;
    return promotedEntityId === entityId && isEqual(promotedAttachment, options.expectedAttachment);
  };
  const sameAddBinding = (state: ReturnType<typeof resolveLegacyAttachmentTarget>) => {
    if (state.invariantError || !sameAttachmentDeclaration(state.currentAttachment)) return false;
    if (options.expectedEntity) return isEqual(binding(state.legacyEntity), binding(options.expectedEntity));
    if (!state.legacyEntity) return true;
    const entity = state.legacyEntity;
    const expected = options.expectedAttachment;
    return (
      state.currentAttachment?.entityId === entityId &&
      entity.entityId === entityId &&
      entity.renderableKind === 'attachment-sprite-group' &&
      entity.source.configId === expected.configId &&
      entity.source.modelProfileId === expected.modelProfileId &&
      entity.source.slot === expected.slot &&
      entity.source.legacyAlias?.originFigureKey === expected.figureKey &&
      entity.source.legacyAlias?.attachmentId === expected.attachmentId &&
      entity.attachmentLink?.parentFigureKey === expected.figureKey &&
      entity.attachmentLink?.placementPresetId === expected.configId &&
      entity.attachmentLink?.semanticAnchor === (expected.semanticAnchor ?? 'head')
    );
  };
  const current = () => {
    if (inactive || !owner?.isCurrent()) return false;
    const state = resolveLegacyAttachmentTarget(
      stageStateManager.getViewStageState(),
      options.figureKey,
      options.attachmentId,
    );
    return sameAddBinding(state);
  };
  const finish = () => {
    if (inactive) return;
    inactive = true;
    unlockUserAdvance();
    clearWait();
    clearPoseSupervision();
    protection.release();
    owner?.release();
    releasePending();
    WebGAL.gameplay.performController.completePerform(perform, 'natural');
  };
  const finishWhenInspectable = () => {
    if (!published || !fadeCompleted || !poseSupervisionSettled) return;
    finish();
  };
  const fail = (error: unknown) => {
    if (inactive || !owner?.isCurrent()) return;
    if (current()) {
      const currentEntity = resolveLegacyAttachmentTarget(
        stageStateManager.getViewStageState(),
        options.figureKey,
        options.attachmentId,
      ).legacyEntity;
      attachmentRuntime.cancelEntityVisibilityTransition(entityId, false);
      const result = commitPresentedEntityTransaction(
        {
          kind: 'rollback-attachment-add',
          expectedAttachment: options.expectedAttachment,
          ...(currentEntity ? { expectedEntity: currentEntity } : {}),
          ...(options.previousAttachment ? { previousAttachment: options.previousAttachment } : {}),
          ...(options.previousEntity ? { previousEntity: options.previousEntity } : {}),
        },
        sentence,
      );
      if (!result.applied)
        reportEntityCommandStateError(
          sentence,
          'ATTACHMENT_ADD_ROLLBACK_FAILED',
          'Failed add no longer owns its exact committed declaration',
        );
      protection.release();
      refreshAttachmentPresentation();
    }
    reportEntityCommandStateError(
      sentence,
      'ATTACHMENT_ADD_FADE_FAILED',
      error instanceof Error ? error.message : String(error),
    );
    finish();
  };
  const ready = () => {
    if (preparingVisibility || published) return;
    if (!current()) {
      finish();
      return;
    }
    preparingVisibility = true;
    clearWait();
    try {
      const started = attachmentRuntime.beginEntityVisibilityTransition(
        entityId,
        true,
        options.duration,
        options.ease,
        () => {
          if (inactive || !owner?.isCurrent()) return;
          fadeCompleted = true;
          finishWhenInspectable();
        },
      );
      if (inactive || !owner?.isCurrent()) return;
      const currentEntity = resolveLegacyAttachmentTarget(
        stageStateManager.getViewStageState(),
        options.figureKey,
        options.attachmentId,
      ).legacyEntity;
      const result = commitPresentedEntityTransaction(
        {
          kind: 'set-visibility',
          visible: true,
          expectedAttachment: options.expectedAttachment,
          ...(currentEntity ? { entityId, expectedEntity: currentEntity } : {}),
        },
        sentence,
      );
      if (!result.applied) throw new Error('Attachment add fade visibility finalization rejected');
      // Publication can notify a synchronous newer command; it now owns Runtime.
      if (inactive || !owner?.isCurrent()) return;
      published = true;
      protection.release();
      if (!started) attachmentRuntime.setEntityVisible(entityId, true);
      refreshAttachmentPresentation();
      if (!started) fadeCompleted = true;
      const poseWait = new AbortController();
      poseSupervision = poseWait;
      void attachmentRuntime
        .waitForFirstValidPose(options.figureKey, options.attachmentId, 10_000, poseWait.signal)
        .then(
          () => {
            if (inactive || !owner?.isCurrent() || poseSupervision !== poseWait) return;
            poseSupervision = undefined;
            poseSupervisionSettled = true;
            unlockUserAdvance();
            // Keep next-settlement protection through first-pose supervision.
            // F02's hidden-state witness may already be gone after visible
            // publication; the controller API safely releases it if present
            // while always ending this perform's skip-next phase.
            WebGAL.gameplay.performController.releaseSkipNextCollect(perform);
            finishWhenInspectable();
          },
          (error) => {
            if (inactive || !owner?.isCurrent() || poseSupervision !== poseWait) return;
            poseSupervision = undefined;
            fail(error);
          },
        );
      finishWhenInspectable();
    } catch (error) {
      fail(error);
    }
  };
  const probe = () => {
    if (preparingVisibility || published) return;
    if (!current()) {
      finish();
      return;
    }
    const snapshot = attachmentRuntime.get(options.figureKey, options.attachmentId);
    if (!snapshot || snapshot.configId !== options.configId) return;
    if (snapshot.entityId && snapshot.entityId !== entityId) return;
    if (snapshot.figureGeneration !== attachmentRuntime.figureGeneration(options.figureKey)) return;
    if (snapshot.phase === 'ready') ready();
    else if (snapshot.phase === 'error') fail(new Error(snapshot.error ?? 'Attachment preparation failed'));
  };
  const perform: IPerform = {
    performName: `stage-entity-operation-${entityId}`,
    duration: options.duration,
    isHoldOn: false,
    manualCompletion: true,
    skipNextCollect: true,
    startFunction() {
      releasePending();
      owner = claimAttachmentAddIntent(entityId, () => {
        inactive = true;
        unlockUserAdvance();
        clearWait();
        clearPoseSupervision();
        protection.release();
      });
      if (!current()) {
        finish();
        return;
      }
      lockUserAdvance();
      unsubscribe = attachmentRuntime.subscribe((event) => {
        if (event.type === 'instance-changed' || event.type === 'instance-error') {
          if (event.instance.figureKey === options.figureKey && event.instance.attachmentId === options.attachmentId)
            probe();
        } else if (
          event.type === 'instance-removed' &&
          event.figureKey === options.figureKey &&
          event.attachmentId === options.attachmentId
        ) {
          // A committed hide/remove/superseding command can retire this add's
          // exact declaration before PerformController starts its replacement
          // owner. Runtime removal is then cancellation, not an add failure.
          if (current()) fail(new Error('Attachment removed before its add became ready'));
          else finish();
        }
      });
      timer = setTimeout(() => fail(new Error('Attachment readiness timed out after 10000 ms')), 10000);
      probe();
    },
    stopFunction(reason) {
      if (inactive) return;
      inactive = true;
      unlockUserAdvance();
      clearWait();
      clearPoseSupervision();
      releasePending();
      protection.release();
      owner?.release();
      attachmentRuntime.cancelEntityVisibilityTransition(entityId, reason === 'settled' || reason === 'natural');
    },
    onDiscard() {
      inactive = true;
      unlockUserAdvance();
      clearWait();
      clearPoseSupervision();
      releasePending();
      protection.release();
    },
    settleStateOnDiscard(ownsLatestIntent) {
      if (!ownsLatestIntent) return;
      const state = resolveLegacyAttachmentTarget(
        stageStateManager.getCalculationStageState(),
        options.figureKey,
        options.attachmentId,
      );
      if (sameAddBinding(state)) {
        commitCalculatedEntityTransaction(
          {
            kind: 'set-visibility',
            visible: true,
            expectedAttachment: state.currentAttachment,
            ...(state.legacyEntity ? { entityId, expectedEntity: state.legacyEntity } : {}),
          },
          sentence,
        );
      }
    },
    // Internal preview replay must remain free to calculate later sentences.
    // User input alone is held by gameInputBoundary until the first pose above
    // becomes inspectable, so queued browser clicks cannot outrun this add.
    blockingNext: () => false,
    blockingAuto: () => !inactive,
  };
  return perform;
}
