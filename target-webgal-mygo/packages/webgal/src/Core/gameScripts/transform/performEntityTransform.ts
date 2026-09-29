import * as popmotion from 'popmotion';
import { wallClockDriver } from '@/Core/controller/stage/pixi/animations/wallClockDriver';
import { WebGAL } from '@/Core/WebGAL';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { attachmentRuntime } from '@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton';
import { reserveEntityVisualPresentation } from '@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import { applyStageEntityStateTransaction } from '@/Core/Modules/stage/stageEntityStateTransaction';
import {
  createEntityTransformPerformer,
  planEntityTransform,
  type EntityTransformRequest,
} from './entityTransformCore';
export type { EntityTransformRequest, EntityTransformPerform, EntityTransformSettleEvent } from './entityTransformCore';

const easings: Record<string, popmotion.Easing> = {
  easeInOut: popmotion.easeInOut,
  easeIn: popmotion.easeIn,
  easeOut: popmotion.easeOut,
  circInOut: popmotion.circInOut,
  circIn: popmotion.circIn,
  circOut: popmotion.circOut,
  backInOut: popmotion.backInOut,
  backIn: popmotion.backIn,
  backOut: popmotion.backOut,
  bounceInOut: popmotion.bounceInOut,
  bounceIn: popmotion.bounceIn,
  bounceOut: popmotion.bounceOut,
  linear: popmotion.linear,
  anticipate: popmotion.anticipate,
};
const performer = createEntityTransformPerformer({
  manager: stageStateManager,
  runtime: attachmentRuntime,
  host: () => WebGAL.gameplay.pixiStage,
  animate: (duration, ease, update, complete) =>
    popmotion.animate({
      from: 0,
      to: 1,
      duration,
      driver: wallClockDriver,
      ease: easings[ease] ?? popmotion.easeInOut,
      onUpdate: update,
      onComplete: complete,
    }),
  complete: (perform, reason) =>
    WebGAL.gameplay.performController.completePerform(perform, reason === 'forced' ? 'settled' : reason),
  reserve: reserveEntityVisualPresentation,
  report: (code, message) => console.error({ scope: 'webgal.entity.transform', code, message }),
});

export function performEntityTransform(request: EntityTransformRequest) {
  if (!request.committed) promoteLegacyEntityTransformTarget(request);
  return performer.perform(request);
}
export const removeEntityTransformOnTarget = performer.removeTarget;

/** Recognition is calculation-only. An ordinary native target never enters the entity adapter. */
export function isEntityTransformTarget(target: string): boolean {
  const stage = stageStateManager.getCalculationStageState();
  return (
    stage.stageEntities.some((entity) => entity.entityId === target) ||
    stage.attachments.some(
      (attachment) =>
        (attachment.entityId ?? deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId)) ===
        target,
    )
  );
}

/** Legacy rows are promoted transactionally, preserving their explicit anchor and stable alias. */
function promoteLegacyEntityTransformTarget(request: EntityTransformRequest): void {
  const target = request.target;
  const stage = stageStateManager.getCalculationStageState();
  if (stage.stageEntities.some((entity) => entity.entityId === target)) return;
  const attachment = stage.attachments.find(
    (row) => deriveLegacyAttachmentEntityId(row.figureKey, row.attachmentId) === target,
  );
  if (!attachment) throw new Error(`ENTITY_STATE_INCOMPATIBLE: no legacy attachment owns ${target}`);
  const transaction = {
    kind: 'promote-and-set-visibility' as const,
    entityId: target,
    expectedAttachment: attachment,
    visible: attachment.visible,
  };
  const candidate = applyStageEntityStateTransaction(stage, transaction);
  if (!candidate.applied) throw new Error(candidate.violations.map((v) => `${v.code}: ${v.message}`).join('; '));
  planEntityTransform(candidate.state, request);
  const result = stageStateManager.applyStageEntityTransaction(transaction);
  if (!result.applied) throw new Error(result.violations.map((v) => `${v.code}: ${v.message}`).join('; '));
}
