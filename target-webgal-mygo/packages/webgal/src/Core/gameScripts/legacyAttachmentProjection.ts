import type { IAttachmentState, IStageState, StageEntityStateV0 } from '@/Core/Modules/stage/stageInterface';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';

export const LEGACY_ATTACHMENT_INVARIANT_CODE = 'ENTITY_LEGACY_ALIAS_DUPLICATE';
export const LEGACY_ATTACHMENT_ADD_PROJECTION_CONFLICT_CODE = 'ATTACHMENT_ENTITY_PROJECTION_CONFLICT';

export interface LegacyAttachmentTargetResolution {
  legacyEntity?: StageEntityStateV0;
  currentAttachment?: IAttachmentState;
  invariantError?: string;
}

export interface StageEntityIdentityResolution {
  entityId: string;
  entity?: StageEntityStateV0;
  legacyAttachment?: IAttachmentState;
  invariantError?: string;
}

export type LegacyAttachmentMutationPlan =
  | {
      kind: 'remove';
      attachment?: Pick<IAttachmentState, 'figureKey' | 'attachmentId'>;
      entityId?: string;
    }
  | {
      kind: 'visibility';
      visible: boolean;
      attachment?: Pick<IAttachmentState, 'figureKey' | 'attachmentId'>;
      entityId?: string;
    };

/**
 * Resolves a legacy (origin figure, attachment id) composite to the single
 * current projection row. The row may have moved to another parent after a
 * stage-entity detach/reattach cycle.
 */
export function resolveLegacyAttachmentTarget(
  stage: IStageState,
  figureKey: string,
  attachmentId: string,
): LegacyAttachmentTargetResolution {
  const directAttachments = stage.attachments.filter(
    (item) => item.figureKey === figureKey && item.attachmentId === attachmentId,
  );
  if (directAttachments.length > 1) {
    return { invariantError: `Legacy composite (${figureKey}, ${attachmentId}) has duplicate attachment rows` };
  }
  const directAttachment = directAttachments[0];
  const aliasEntities = stage.stageEntities.filter(
    (entity) =>
      entity.source.legacyAlias?.originFigureKey === figureKey &&
      entity.source.legacyAlias.attachmentId === attachmentId,
  );
  if (aliasEntities.length > 1) {
    return {
      invariantError: `Legacy composite (${figureKey}, ${attachmentId}) resolves to multiple stage entities`,
    };
  }

  const directEntity = directAttachment?.entityId
    ? stage.stageEntities.find((entity) => entity.entityId === directAttachment.entityId)
    : undefined;
  const aliasEntity = aliasEntities[0];
  if (aliasEntity && directEntity && aliasEntity.entityId !== directEntity.entityId) {
    return {
      invariantError:
        `Legacy composite (${figureKey}, ${attachmentId}) resolves to entity ${aliasEntity.entityId} ` +
        `but its direct projection belongs to ${directEntity.entityId}`,
    };
  }

  const legacyEntity = aliasEntity ?? directEntity;
  if (!legacyEntity) return { currentAttachment: directAttachment };
  const projections = stage.attachments.filter((item) => item.entityId === legacyEntity.entityId);
  if (projections.length > 1) {
    return {
      invariantError: `Stage entity ${legacyEntity.entityId} has multiple legacy attachment projections`,
    };
  }
  const projection = projections[0];
  if (aliasEntity && directAttachment && (!projection || directAttachment !== projection)) {
    return {
      invariantError:
        `Legacy composite (${figureKey}, ${attachmentId}) exists beside the projection for ` +
        `stage entity ${legacyEntity.entityId}`,
    };
  }
  return {
    legacyEntity,
    currentAttachment: projection ?? directAttachment,
  };
}

/**
 * Resolves the Stage Entity command namespace across persisted entities and
 * lazy legacy rows. Entity-bearing attachment rows are projections, not a
 * second identity source.
 */
export function resolveStageEntityIdentity(stage: IStageState, entityId: string): StageEntityIdentityResolution {
  const entities = stage.stageEntities.filter((entity) => entity.entityId === entityId);
  const legacyRows: IAttachmentState[] = [];
  for (const attachment of stage.attachments) {
    if (attachment.entityId) continue;
    try {
      if (deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId) === entityId) {
        legacyRows.push(attachment);
      }
    } catch {
      // Invalid old rows are diagnosed by the state invariant validator; they
      // cannot silently alias a valid Stage Entity command target.
    }
  }
  if (entities.length > 1 || legacyRows.length > 1 || (entities.length === 1 && legacyRows.length === 1)) {
    return {
      entityId,
      invariantError: `Stage entity id ${JSON.stringify(entityId)} resolves to multiple serializable owners`,
    };
  }
  return { entityId, entity: entities[0], legacyAttachment: legacyRows[0] };
}

export function createLegacyAttachmentMutationPlan(
  action: 'hide' | 'show' | 'remove',
  resolution: LegacyAttachmentTargetResolution,
): LegacyAttachmentMutationPlan {
  const attachment = resolution.currentAttachment
    ? {
        figureKey: resolution.currentAttachment.figureKey,
        attachmentId: resolution.currentAttachment.attachmentId,
      }
    : undefined;
  const entityId = resolution.legacyEntity?.entityId;
  if (action === 'remove') return { kind: 'remove', attachment, entityId };
  return {
    kind: 'visibility',
    visible: action === 'show',
    attachment,
    entityId,
  };
}

/**
 * Legacy add is an upsert by composite key. Rejecting a moved projection here
 * prevents that upsert from creating a second row for the same stage entity.
 */
export function getLegacyAttachmentAddProjectionConflict(
  resolution: LegacyAttachmentTargetResolution,
  figureKey: string,
  attachmentId: string,
): string | undefined {
  const projection = resolution.currentAttachment;
  const entityId = resolution.legacyEntity?.entityId;
  if (!entityId || !projection || (projection.figureKey === figureKey && projection.attachmentId === attachmentId)) {
    return undefined;
  }
  return (
    `Stage entity "${entityId}" is already projected as legacy attachment ` +
    `(${projection.figureKey}, ${projection.attachmentId}); refusing to create a second projection ` +
    `for (${figureKey}, ${attachmentId}).`
  );
}
