import type { ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import { createNonePerform } from '@/Core/Modules/perform/performInterface';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import type { StageEntityStateTransaction } from '@/Core/Modules/stage/stageEntityStateTransaction';
import { attachmentRuntime } from '@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton';
import { reserveEntityVisibilityPresentation } from '@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation';
import { refreshAttachmentPresentation as refreshHostPresentation } from '@/Core/controller/stage/pixi/syncPixiStageState';
import { resolveStageEntityIdentity, type StageEntityIdentityResolution } from './legacyAttachmentProjection';
export function refreshAttachmentPresentation(notify = false): void {
  refreshHostPresentation();
  if (notify) stageStateManager.notifyCommittedEntityChange();
}

const addOwners = new Map<string, { token: symbol; cancel: () => void }>();
export function retireEntityCommandIntent(id: string): void {
  const owner = addOwners.get(id);
  if (!owner) return;
  addOwners.delete(id);
  owner.cancel();
}
export function claimAttachmentAddIntent(id: string, cancel: () => void) {
  retireEntityCommandIntent(id);
  const token = Symbol(id);
  addOwners.set(id, { token, cancel });
  return {
    isCurrent: () => addOwners.get(id)?.token === token,
    release: () => {
      if (addOwners.get(id)?.token === token) addOwners.delete(id);
    },
  };
}
export function getPendingAttachmentAddIntentCount() {
  return addOwners.size;
}

/** P2-05 scoped to migrated commands; no changes to unrelated native argument parsing. */
export function getEntityCommandDuration(sentence: ISentence, fallback: number): number {
  const value = sentence.args.find((arg) => arg.key === 'duration')?.value;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}
export function reportEntityCommandStateError(sentence: ISentence, code: string, message: string): void {
  console.error({ scope: 'webgal.attachment.command', code, message, action: sentence.content, args: sentence.args });
}
export function commitCalculatedEntityTransaction(
  transaction: StageEntityStateTransaction,
  sentence: ISentence,
): boolean {
  const result = stageStateManager.applyStageEntityTransaction(transaction);
  if (!result.applied)
    reportEntityCommandStateError(
      sentence,
      result.violations[0]?.code ?? 'ENTITY_TRANSACTION_REJECTED',
      result.violations[0]?.message ?? 'Entity calculation rejected',
    );
  return result.applied;
}
export function commitPresentedEntityTransaction(
  transaction: StageEntityStateTransaction,
  sentence: ISentence,
  options: { notify?: boolean } = {},
) {
  const result = stageStateManager.applyCommittedStageEntityTransaction(
    stageStateManager.getViewStageState(),
    transaction,
    options,
  );
  if (!result.applied)
    reportEntityCommandStateError(
      sentence,
      result.violations[0]?.code ?? 'ENTITY_TRANSACTION_REJECTED',
      result.violations[0]?.message ?? 'Entity finalization rejected',
    );
  return result;
}

export function createVisibilityCommandPerform(
  sentence: ISentence,
  resolution: StageEntityIdentityResolution,
  visible: boolean,
  duration: number,
  ease: string,
  promote: boolean,
): IPerform {
  const { entityId, entity, legacyAttachment } = resolution;
  if (!entity && !legacyAttachment) return createNonePerform();
  const transaction: StageEntityStateTransaction = entity
    ? { kind: 'set-visibility', entityId, expectedEntity: entity, visible }
    : promote
    ? { kind: 'promote-and-set-visibility', entityId, expectedAttachment: legacyAttachment!, visible }
    : { kind: 'set-visibility', expectedAttachment: legacyAttachment!, visible };
  const presented = resolveStageEntityIdentity(stageStateManager.getViewStageState(), entityId);
  const beforeVisible =
    presented.entity?.visualState.visible ??
    presented.legacyAttachment?.visible ??
    entity?.visualState.visible ??
    legacyAttachment!.visible;
  if (!commitCalculatedEntityTransaction(transaction, sentence)) return createNonePerform();
  const reservation = reserveEntityVisibilityPresentation(
    entityId,
    stageStateManager.getCalculationStageState(),
    beforeVisible,
  );
  let started = false;
  return {
    performName: `stage-entity-operation-${entityId}`,
    duration,
    isHoldOn: false,
    startFunction() {
      started = true;
      retireEntityCommandIntent(entityId);
      attachmentRuntime.cancelEntityVisibilityTransition(entityId, false);
      const transition =
        duration > 0 && attachmentRuntime.beginEntityVisibilityTransition(entityId, visible, duration, ease);
      reservation.release();
      if (!transition) attachmentRuntime.setEntityVisible(entityId, visible);
      refreshAttachmentPresentation();
    },
    stopFunction(reason) {
      reservation.release();
      if (started)
        attachmentRuntime.cancelEntityVisibilityTransition(entityId, reason === 'natural' || reason === 'settled');
    },
    onDiscard() {
      reservation.release();
    },
    blockingNext: () => false,
    blockingAuto: () => duration > 0,
  };
}
