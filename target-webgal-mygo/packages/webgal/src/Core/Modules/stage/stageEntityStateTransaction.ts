import {
  deriveLegacyAttachmentEntityId,
  normalizeStageEntityId,
} from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import type {
  AttachmentLinkV0,
  AttachedLocalVisualStateV0,
  IAttachmentState,
  IEffect,
  IStageState,
  StageEntityStateV0,
  VisualStateV0,
} from '@/Core/Modules/stage/stageInterface';
import { baseTransform } from '@/Core/Modules/stage/stageInterface';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import { validateStageEntityStateShape, validateStageEntityTransactionShape } from './stageEntityStateValidation';

export type StageEntityStateTransaction =
  | {
      kind: 'upsert-legacy-attachment';
      attachment: IAttachmentState;
      canonicalEntityId: string;
    }
  | {
      kind: 'upsert-explicit-attachment';
      attachment: IAttachmentState & { entityId: string };
      entity: StageEntityStateV0;
    }
  | {
      kind: 'promote-and-detach';
      expectedAttachment: IAttachmentState;
      entityId: string;
      visualState: VisualStateV0;
      freePositionOrigin?: { x: number; y: number };
    }
  | {
      kind: 'promote-and-set-visibility';
      expectedAttachment: IAttachmentState;
      entityId: string;
      visible: boolean;
    }
  | {
      kind: 'detach';
      entityId: string;
      expectedEntity?: StageEntityStateV0;
      visualState: VisualStateV0;
      freePositionOrigin?: { x: number; y: number };
    }
  | {
      kind: 'reattach';
      entityId: string;
      expectedEntity?: StageEntityStateV0;
      attachmentLink: AttachmentLinkV0;
      modelProfileId?: string;
    }
  | {
      kind: 'set-visibility';
      visible: boolean;
      entityId?: string;
      expectedEntity?: StageEntityStateV0;
      expectedAttachment?: IAttachmentState;
    }
  | {
      kind: 'remove';
      entityId?: string;
      expectedEntity?: StageEntityStateV0;
      expectedAttachment?: IAttachmentState;
    }
  | {
      kind: 'rollback-attachment-add';
      expectedAttachment: IAttachmentState;
      expectedEntity?: StageEntityStateV0;
      previousAttachment?: IAttachmentState;
      previousEntity?: StageEntityStateV0;
    };

export interface StageStateInvariantViolation {
  code:
    | 'ATTACHMENT_COMPOSITE_DUPLICATE'
    | 'ENTITY_ID_CONFLICT'
    | 'ENTITY_ID_INVALID'
    | 'ENTITY_LEGACY_ALIAS_DUPLICATE'
    | 'ENTITY_PROJECTION_INCOMPATIBLE'
    | 'ENTITY_SLOT_CONFLICT'
    | 'ENTITY_STATE_INCOMPATIBLE'
    | 'ENTITY_EFFECT_INCOMPATIBLE'
    | 'ENTITY_TRANSACTION_STALE';
  message: string;
}

export interface StageEntityStateTransactionResult {
  applied: boolean;
  state: IStageState;
  violations: StageStateInvariantViolation[];
}

function cloneVisualStateWithSpace<TSpace extends VisualStateV0['space']>(
  visualState: VisualStateV0,
  space: TSpace,
): VisualStateV0 & { space: TSpace } {
  return { ...cloneDeep(visualState), space };
}

export function initialLegacyAttachmentLocalVisualState(visible = true): AttachedLocalVisualStateV0 {
  return {
    space: 'local',
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    skew: { x: 0, y: 0 },
    opacity: 1,
    visible,
  };
}

export function legacyAttachmentLink(
  attachment: Pick<IAttachmentState, 'figureKey' | 'configId' | 'semanticAnchor'>,
  localVisualState: AttachedLocalVisualStateV0,
): AttachmentLinkV0 {
  return {
    schemaVersion: 0,
    parentKind: 'figure',
    parentFigureKey: attachment.figureKey,
    semanticAnchor: attachment.semanticAnchor ?? 'head',
    placementPresetId: attachment.configId,
    inheritancePolicy: { transform: true, opacity: true, visibility: true },
    attachedLocalVisualState: cloneDeep(localVisualState),
  };
}

function attachedEntityFromLegacyAttachment(
  attachment: IAttachmentState,
  entityId: string,
  visible: boolean,
): StageEntityStateV0 {
  const visualState = initialLegacyAttachmentLocalVisualState(visible);
  return {
    schemaVersion: 0,
    entityId,
    renderableKind: 'attachment-sprite-group',
    source: {
      configId: attachment.configId,
      ...(attachment.modelProfileId ? { modelProfileId: attachment.modelProfileId } : {}),
      ...(attachment.slot ? { slot: attachment.slot } : {}),
      lastAttachedLocalVisualState: cloneDeep(visualState),
      legacyAlias: {
        originFigureKey: attachment.figureKey,
        attachmentId: attachment.attachmentId,
      },
    },
    visualState,
    attachmentLink: legacyAttachmentLink(attachment, visualState),
  };
}

function effectTransformFromEntity(
  entity: StageEntityStateV0,
  previous?: IEffect['transform'],
): NonNullable<IEffect['transform']> {
  const transform = cloneDeep(previous ?? baseTransform);
  transform.position = cloneDeep(entity.visualState.position);
  transform.scale = cloneDeep(entity.visualState.scale);
  if (entity.visualState.skew !== undefined) transform.skew = cloneDeep(entity.visualState.skew);
  else delete transform.skew;
  transform.rotation = entity.visualState.rotation;
  transform.alpha = entity.visualState.opacity;
  const appearance = entity.visualState.appearance;
  transform.blur = appearance?.blur ?? 0;
  transform.brightness = appearance?.brightness ?? 1;
  transform.contrast = appearance?.contrast ?? 1;
  transform.saturation = appearance?.saturation ?? 1;
  transform.gamma = appearance?.gamma ?? 1;
  transform.colorRed = appearance?.color.red ?? 255;
  transform.colorGreen = appearance?.color.green ?? 255;
  transform.colorBlue = appearance?.color.blue ?? 255;
  transform.bevel = appearance?.bevel?.strength ?? 0;
  transform.bevelThickness = appearance?.bevel?.thickness ?? 0;
  transform.bevelRotation = appearance?.bevel?.rotation ?? 0;
  transform.bevelSoftness = appearance?.bevel?.softness ?? 0;
  transform.bevelRed = appearance?.bevel?.color.red ?? 255;
  transform.bevelGreen = appearance?.bevel?.color.green ?? 255;
  transform.bevelBlue = appearance?.bevel?.color.blue ?? 255;
  transform.bloom = appearance?.bloom?.strength ?? 0;
  transform.bloomBrightness = appearance?.bloom?.brightness ?? 1;
  transform.bloomBlur = appearance?.bloom?.blur ?? 0;
  transform.bloomThreshold = appearance?.bloom?.threshold ?? 0;
  transform.shockwaveFilter = appearance?.shockwave ?? 0;
  transform.radiusAlphaFilter = appearance?.radiusAlpha ?? 0;
  return transform;
}

function syncEffectFromEntity(stage: IStageState, entity: StageEntityStateV0): void {
  const matches = stage.effects
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => effect.target === entity.entityId);
  const transform = effectTransformFromEntity(entity, matches[0]?.effect.transform);
  if (matches.length === 0) stage.effects.push({ target: entity.entityId, transform });
  else {
    stage.effects[matches[0].index].transform = transform;
    for (let i = matches.length - 1; i >= 1; i--) stage.effects.splice(matches[i].index, 1);
  }
}

function removeEffect(stage: IStageState, entityId: string): void {
  for (let i = stage.effects.length - 1; i >= 0; i--) {
    if (stage.effects[i].target === entityId) stage.effects.splice(i, 1);
  }
}

function compositeKey(attachment: Pick<IAttachmentState, 'figureKey' | 'attachmentId'>): string {
  return `${attachment.figureKey}\u0000${attachment.attachmentId}`;
}

function aliasKey(entity: StageEntityStateV0): string | undefined {
  const alias = entity.source.legacyAlias;
  return alias ? `${alias.originFigureKey}\u0000${alias.attachmentId}` : undefined;
}

function findExactAttachment(stage: IStageState, expected: IAttachmentState): IAttachmentState | undefined {
  const attachment = stage.attachments.find((candidate) => compositeKey(candidate) === compositeKey(expected));
  return attachment && isEqual(attachment, expected) ? attachment : undefined;
}

function upsertAttachment(stage: IStageState, attachment: IAttachmentState): void {
  const index = stage.attachments.findIndex((candidate) => compositeKey(candidate) === compositeKey(attachment));
  if (index >= 0) stage.attachments[index] = cloneDeep(attachment);
  else stage.attachments.push(cloneDeep(attachment));
}

function upsertEntity(stage: IStageState, entity: StageEntityStateV0): void {
  const index = stage.stageEntities.findIndex((candidate) => candidate.entityId === entity.entityId);
  if (index >= 0) stage.stageEntities[index] = cloneDeep(entity);
  else stage.stageEntities.push(cloneDeep(entity));
  syncEffectFromEntity(stage, entity);
}

function visualStateMatchesEffect(entity: StageEntityStateV0, effect: IEffect): boolean {
  const transform = effect.transform;
  if (!transform) return false;
  const visualSkew = entity.visualState.skew ?? { x: 0, y: 0 };
  const effectSkew = transform.skew ?? { x: 0, y: 0 };
  const appearance = entity.visualState.appearance;
  return (
    isEqual(transform.position, entity.visualState.position) &&
    isEqual(transform.scale, entity.visualState.scale) &&
    isEqual(effectSkew, visualSkew) &&
    transform.rotation === entity.visualState.rotation &&
    transform.alpha === entity.visualState.opacity &&
    transform.blur === (appearance?.blur ?? 0) &&
    transform.brightness === (appearance?.brightness ?? 1) &&
    transform.contrast === (appearance?.contrast ?? 1) &&
    transform.saturation === (appearance?.saturation ?? 1) &&
    transform.gamma === (appearance?.gamma ?? 1) &&
    transform.colorRed === (appearance?.color.red ?? 255) &&
    transform.colorGreen === (appearance?.color.green ?? 255) &&
    transform.colorBlue === (appearance?.color.blue ?? 255) &&
    transform.bevel === (appearance?.bevel?.strength ?? 0) &&
    transform.bevelThickness === (appearance?.bevel?.thickness ?? 0) &&
    transform.bevelRotation === (appearance?.bevel?.rotation ?? 0) &&
    transform.bevelSoftness === (appearance?.bevel?.softness ?? 0) &&
    transform.bevelRed === (appearance?.bevel?.color.red ?? 255) &&
    transform.bevelGreen === (appearance?.bevel?.color.green ?? 255) &&
    transform.bevelBlue === (appearance?.bevel?.color.blue ?? 255) &&
    transform.bloom === (appearance?.bloom?.strength ?? 0) &&
    transform.bloomBrightness === (appearance?.bloom?.brightness ?? 1) &&
    transform.bloomBlur === (appearance?.bloom?.blur ?? 0) &&
    transform.bloomThreshold === (appearance?.bloom?.threshold ?? 0) &&
    transform.shockwaveFilter === (appearance?.shockwave ?? 0) &&
    transform.radiusAlphaFilter === (appearance?.radiusAlpha ?? 0)
  );
}

/** Validates cross-array invariants before calculation-state publication. */
export function validateStageEntityStateInvariants(stage: IStageState): StageStateInvariantViolation[] {
  const shapeViolations = validateStageEntityStateShape(stage);
  if (shapeViolations.length) return shapeViolations;
  const violations: StageStateInvariantViolation[] = [];
  const composites = new Map<string, IAttachmentState>();
  const entitiesById = new Map<string, StageEntityStateV0>();
  const aliases = new Map<string, StageEntityStateV0>();

  for (const entity of stage.stageEntities) {
    try {
      normalizeStageEntityId(entity.entityId);
    } catch (error) {
      violations.push({
        code: 'ENTITY_ID_INVALID',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (entitiesById.has(entity.entityId)) {
      violations.push({ code: 'ENTITY_ID_CONFLICT', message: `Duplicate stage entity id ${entity.entityId}` });
    } else entitiesById.set(entity.entityId, entity);
    const key = aliasKey(entity);
    if (key) {
      if (aliases.has(key)) {
        violations.push({
          code: 'ENTITY_LEGACY_ALIAS_DUPLICATE',
          message: `Duplicate legacy alias ${JSON.stringify(key.split('\u0000'))}`,
        });
      } else aliases.set(key, entity);
    }
  }

  const unpromotedIds = new Map<string, IAttachmentState>();
  for (const attachment of stage.attachments) {
    const key = compositeKey(attachment);
    if (composites.has(key)) {
      violations.push({
        code: 'ATTACHMENT_COMPOSITE_DUPLICATE',
        message: `Duplicate legacy attachment composite (${attachment.figureKey}, ${attachment.attachmentId})`,
      });
    } else composites.set(key, attachment);

    if (attachment.entityId) {
      const entity = entitiesById.get(attachment.entityId);
      if (!entity) {
        violations.push({
          code: 'ENTITY_PROJECTION_INCOMPATIBLE',
          message: `Attachment projection ${key} references missing entity ${attachment.entityId}`,
        });
      }
    } else {
      try {
        const derived = deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId);
        const prior = unpromotedIds.get(derived);
        if (prior && compositeKey(prior) !== key) {
          violations.push({ code: 'ENTITY_ID_CONFLICT', message: `Legacy tuples collide at ${derived}` });
        } else unpromotedIds.set(derived, attachment);
        if (entitiesById.has(derived)) {
          violations.push({
            code: 'ENTITY_ID_CONFLICT',
            message: `Unpromoted legacy attachment ${key} collides with entity ${derived}`,
          });
        }
        if (aliases.has(key)) {
          violations.push({
            code: 'ENTITY_LEGACY_ALIAS_DUPLICATE',
            message: `Unpromoted legacy row ${key} exists beside a promoted alias`,
          });
        }
      } catch (error) {
        violations.push({
          code: 'ENTITY_ID_INVALID',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  for (const entity of stage.stageEntities) {
    const projections = stage.attachments.filter((attachment) => attachment.entityId === entity.entityId);
    const link = entity.attachmentLink;
    if (link) {
      if (entity.visualState.space !== 'local' || !isEqual(entity.visualState, link.attachedLocalVisualState)) {
        violations.push({
          code: 'ENTITY_STATE_INCOMPATIBLE',
          message: `Attached entity ${entity.entityId} has divergent local visual state`,
        });
      }
      const alias = entity.source.legacyAlias;
      if (alias) {
        if (projections.length !== 1) {
          violations.push({
            code: 'ENTITY_PROJECTION_INCOMPATIBLE',
            message: `Attached legacy entity ${entity.entityId} has ${projections.length} current projections`,
          });
        } else {
          const projection = projections[0];
          if (
            projection.figureKey !== link.parentFigureKey ||
            projection.attachmentId !== alias.attachmentId ||
            projection.configId !== entity.source.configId ||
            projection.modelProfileId !== entity.source.modelProfileId ||
            projection.slot !== entity.source.slot ||
            (projection.semanticAnchor ?? 'head') !== link.semanticAnchor ||
            projection.visible !== entity.visualState.visible
          ) {
            violations.push({
              code: 'ENTITY_PROJECTION_INCOMPATIBLE',
              message: `Projection for ${entity.entityId} does not match its current link/source/visual state`,
            });
          }
        }
      } else if (projections.length > 0) {
        violations.push({
          code: 'ENTITY_PROJECTION_INCOMPATIBLE',
          message: `Entity ${entity.entityId} has a legacy projection but no legacy alias`,
        });
      }
    } else {
      if (entity.visualState.space !== 'world') {
        violations.push({
          code: 'ENTITY_STATE_INCOMPATIBLE',
          message: `Free entity ${entity.entityId} is not world-space`,
        });
      }
      if (projections.length !== 0) {
        violations.push({
          code: 'ENTITY_PROJECTION_INCOMPATIBLE',
          message: `Free entity ${entity.entityId} still owns ${projections.length} attachment projections`,
        });
      }
    }

    const effects = stage.effects.filter((effect) => effect.target === entity.entityId);
    if (effects.length !== 1 || !visualStateMatchesEffect(entity, effects[0])) {
      violations.push({
        code: 'ENTITY_EFFECT_INCOMPATIBLE',
        message: `Entity ${entity.entityId} does not have exactly one synchronized effect`,
      });
    }
  }

  const slotOwners = new Map<string, string>();
  const claimSlot = (figureKey: string, slot: string | undefined, owner: string) => {
    if (!slot) return;
    const key = `${figureKey}\u0000${slot}`;
    const prior = slotOwners.get(key);
    if (prior && prior !== owner) {
      violations.push({
        code: 'ENTITY_SLOT_CONFLICT',
        message: `Slot (${figureKey}, ${slot}) is owned by both ${prior} and ${owner}`,
      });
    } else slotOwners.set(key, owner);
  };
  for (const attachment of stage.attachments) {
    let owner = attachment.entityId;
    if (!owner) {
      try {
        owner = deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId);
      } catch {
        owner = `invalid:${compositeKey(attachment)}`;
      }
    }
    claimSlot(attachment.figureKey, attachment.slot, owner);
  }
  for (const entity of stage.stageEntities) {
    if (!entity.attachmentLink || !entity.source.slot) continue;
    const projected = stage.attachments.some(
      (attachment) =>
        attachment.entityId === entity.entityId &&
        attachment.figureKey === entity.attachmentLink?.parentFigureKey &&
        attachment.slot === entity.source.slot,
    );
    if (!projected) claimSlot(entity.attachmentLink.parentFigureKey, entity.source.slot, entity.entityId);
  }

  return violations;
}

function failure(
  state: IStageState,
  code: StageStateInvariantViolation['code'],
  message: string,
): StageEntityStateTransactionResult {
  return { applied: false, state, violations: [{ code, message }] };
}

/**
 * Applies a complete projection/entity/effect mutation to a detached clone.
 * StageStateManager publishes the clone only when
 * preconditions and all post-state invariants pass.
 */
export function applyStageEntityStateTransaction(
  stage: IStageState,
  transaction: StageEntityStateTransaction,
): StageEntityStateTransactionResult {
  const payloadViolations = validateStageEntityTransactionShape(transaction);
  if (payloadViolations.length) return { applied: false, state: stage, violations: payloadViolations };
  const currentViolations = validateStageEntityStateInvariants(stage);
  if (currentViolations.length > 0) return { applied: false, state: stage, violations: currentViolations };
  const next = cloneDeep(stage);

  if (transaction.kind === 'upsert-legacy-attachment') {
    if (transaction.attachment.entityId) {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Lazy legacy attachment must not carry entityId');
    }
    let canonical: string;
    try {
      canonical = deriveLegacyAttachmentEntityId(transaction.attachment.figureKey, transaction.attachment.attachmentId);
    } catch (error) {
      return failure(stage, 'ENTITY_ID_INVALID', error instanceof Error ? error.message : String(error));
    }
    if (canonical !== transaction.canonicalEntityId) {
      return failure(
        stage,
        'ENTITY_ID_CONFLICT',
        `Expected canonical id ${canonical}, received ${transaction.canonicalEntityId}`,
      );
    }
    upsertAttachment(next, transaction.attachment);
  } else if (transaction.kind === 'upsert-explicit-attachment') {
    if (transaction.attachment.entityId !== transaction.entity.entityId) {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Attachment and entity ids differ');
    }
    const alias = transaction.entity.source.legacyAlias;
    if (
      !transaction.entity.attachmentLink ||
      !alias ||
      alias.originFigureKey !== transaction.attachment.figureKey ||
      alias.attachmentId !== transaction.attachment.attachmentId
    ) {
      return failure(
        stage,
        'ENTITY_PROJECTION_INCOMPATIBLE',
        'Explicit attachment add must establish its origin alias and link',
      );
    }
    const existing = next.stageEntities.find((entity) => entity.entityId === transaction.entity.entityId);
    if (existing && aliasKey(existing) !== aliasKey(transaction.entity)) {
      return failure(stage, 'ENTITY_ID_CONFLICT', `Entity id ${transaction.entity.entityId} belongs to another alias`);
    }
    const movedProjection = next.attachments.find(
      (attachment) =>
        attachment.entityId === transaction.entity.entityId &&
        compositeKey(attachment) !== compositeKey(transaction.attachment),
    );
    if (movedProjection) {
      return failure(
        stage,
        'ENTITY_PROJECTION_INCOMPATIBLE',
        `Entity ${transaction.entity.entityId} is projected on another composite`,
      );
    }
    upsertEntity(next, transaction.entity);
    upsertAttachment(next, transaction.attachment);
  } else if (transaction.kind === 'promote-and-detach') {
    if (transaction.expectedAttachment.entityId || !findExactAttachment(next, transaction.expectedAttachment)) {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Legacy promotion source changed or is already promoted');
    }
    let canonical: string;
    try {
      canonical = deriveLegacyAttachmentEntityId(
        transaction.expectedAttachment.figureKey,
        transaction.expectedAttachment.attachmentId,
      );
    } catch (error) {
      return failure(stage, 'ENTITY_ID_INVALID', error instanceof Error ? error.message : String(error));
    }
    if (
      canonical !== transaction.entityId ||
      next.stageEntities.some((entity) => entity.entityId === transaction.entityId)
    ) {
      return failure(stage, 'ENTITY_ID_CONFLICT', `Cannot promote legacy attachment as ${transaction.entityId}`);
    }
    next.attachments = next.attachments.filter(
      (attachment) => compositeKey(attachment) !== compositeKey(transaction.expectedAttachment),
    );
    const entity: StageEntityStateV0 = {
      schemaVersion: 0,
      entityId: transaction.entityId,
      renderableKind: 'attachment-sprite-group',
      source: {
        configId: transaction.expectedAttachment.configId,
        ...(transaction.freePositionOrigin ? { freePositionOrigin: cloneDeep(transaction.freePositionOrigin) } : {}),
        ...(transaction.expectedAttachment.slot ? { slot: transaction.expectedAttachment.slot } : {}),
        lastAttachedLocalVisualState: initialLegacyAttachmentLocalVisualState(transaction.expectedAttachment.visible),
        legacyAlias: {
          originFigureKey: transaction.expectedAttachment.figureKey,
          attachmentId: transaction.expectedAttachment.attachmentId,
        },
      },
      visualState: cloneVisualStateWithSpace(transaction.visualState, 'world'),
      attachmentLink: null,
    };
    upsertEntity(next, entity);
  } else if (transaction.kind === 'promote-and-set-visibility') {
    if (transaction.expectedAttachment.entityId || !findExactAttachment(next, transaction.expectedAttachment)) {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Legacy promotion source changed or is already promoted');
    }
    let canonical: string;
    try {
      canonical = deriveLegacyAttachmentEntityId(
        transaction.expectedAttachment.figureKey,
        transaction.expectedAttachment.attachmentId,
      );
    } catch (error) {
      return failure(stage, 'ENTITY_ID_INVALID', error instanceof Error ? error.message : String(error));
    }
    if (
      canonical !== transaction.entityId ||
      next.stageEntities.some((entity) => entity.entityId === transaction.entityId)
    ) {
      return failure(stage, 'ENTITY_ID_CONFLICT', `Cannot promote legacy attachment as ${transaction.entityId}`);
    }
    const entity = attachedEntityFromLegacyAttachment(
      transaction.expectedAttachment,
      transaction.entityId,
      transaction.visible,
    );
    upsertEntity(next, entity);
    upsertAttachment(next, {
      ...cloneDeep(transaction.expectedAttachment),
      entityId: transaction.entityId,
      visible: transaction.visible,
    });
  } else if (transaction.kind === 'detach') {
    const entity = next.stageEntities.find((candidate) => candidate.entityId === transaction.entityId);
    if (!entity?.attachmentLink || (transaction.expectedEntity && !isEqual(entity, transaction.expectedEntity))) {
      return failure(stage, 'ENTITY_STATE_INCOMPATIBLE', `Entity ${transaction.entityId} changed before detach commit`);
    }
    entity.source.lastAttachedLocalVisualState = cloneDeep(entity.attachmentLink.attachedLocalVisualState);
    if (transaction.freePositionOrigin) entity.source.freePositionOrigin = cloneDeep(transaction.freePositionOrigin);
    else delete entity.source.freePositionOrigin;
    entity.visualState = cloneVisualStateWithSpace(transaction.visualState, 'world');
    entity.attachmentLink = null;
    next.attachments = next.attachments.filter((attachment) => attachment.entityId !== transaction.entityId);
    syncEffectFromEntity(next, entity);
  } else if (transaction.kind === 'reattach') {
    const entity = next.stageEntities.find((candidate) => candidate.entityId === transaction.entityId);
    if (
      !entity ||
      entity.attachmentLink ||
      (transaction.expectedEntity && !isEqual(entity, transaction.expectedEntity))
    ) {
      return failure(
        stage,
        'ENTITY_STATE_INCOMPATIBLE',
        `Entity ${transaction.entityId} changed before reattach commit`,
      );
    }
    const link = cloneDeep(transaction.attachmentLink);
    link.attachedLocalVisualState = cloneVisualStateWithSpace(link.attachedLocalVisualState, 'local');
    entity.visualState = cloneDeep(link.attachedLocalVisualState);
    entity.attachmentLink = link;
    delete entity.source.freePositionOrigin;
    if (transaction.modelProfileId) entity.source.modelProfileId = transaction.modelProfileId;
    entity.source.lastAttachedLocalVisualState = cloneDeep(link.attachedLocalVisualState);
    const alias = entity.source.legacyAlias;
    if (alias) {
      const targetComposite = `${link.parentFigureKey}\u0000${alias.attachmentId}`;
      const conflict = next.attachments.find(
        (attachment) => compositeKey(attachment) === targetComposite && attachment.entityId !== entity.entityId,
      );
      if (conflict) {
        return failure(
          stage,
          'ENTITY_PROJECTION_INCOMPATIBLE',
          `Reattach target composite ${targetComposite} is occupied`,
        );
      }
      upsertAttachment(next, {
        figureKey: link.parentFigureKey,
        attachmentId: alias.attachmentId,
        entityId: entity.entityId,
        configId: entity.source.configId,
        ...(entity.source.modelProfileId ? { modelProfileId: entity.source.modelProfileId } : {}),
        ...(entity.source.slot ? { slot: entity.source.slot } : {}),
        semanticAnchor: link.semanticAnchor,
        visible: entity.visualState.visible,
      });
    }
    syncEffectFromEntity(next, entity);
  } else if (transaction.kind === 'set-visibility') {
    if (transaction.entityId) {
      const entity = next.stageEntities.find((candidate) => candidate.entityId === transaction.entityId);
      if (!entity || (transaction.expectedEntity && !isEqual(entity, transaction.expectedEntity))) {
        return failure(
          stage,
          'ENTITY_STATE_INCOMPATIBLE',
          `Entity ${transaction.entityId} changed before visibility commit`,
        );
      }
      entity.visualState.visible = transaction.visible;
      if (entity.attachmentLink) entity.attachmentLink.attachedLocalVisualState.visible = transaction.visible;
      for (const attachment of next.attachments) {
        if (attachment.entityId === entity.entityId) attachment.visible = transaction.visible;
      }
    } else if (transaction.expectedAttachment) {
      const attachment = findExactAttachment(next, transaction.expectedAttachment);
      if (!attachment || attachment.entityId) {
        return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Legacy visibility target changed before commit');
      }
      attachment.visible = transaction.visible;
    } else {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Visibility transaction has no target');
    }
  } else if (transaction.kind === 'rollback-attachment-add') {
    // Compensation is scoped to the failed declaration, never an unrelated free entity.
    if (transaction.expectedEntity && transaction.expectedAttachment.entityId !== transaction.expectedEntity.entityId) {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Rollback entity does not own the failed attachment');
    }
    if (
      transaction.previousAttachment &&
      compositeKey(transaction.previousAttachment) !== compositeKey(transaction.expectedAttachment)
    ) {
      return failure(
        stage,
        'ENTITY_PROJECTION_INCOMPATIBLE',
        'Rollback previous attachment belongs to another composite',
      );
    }
    if (
      transaction.previousEntity &&
      (transaction.previousEntity.entityId !== transaction.expectedEntity?.entityId ||
        (transaction.previousEntity.attachmentLink &&
          transaction.previousAttachment?.entityId !== transaction.previousEntity.entityId))
    ) {
      return failure(
        stage,
        'ENTITY_PROJECTION_INCOMPATIBLE',
        'Rollback previous entity is not part of this declaration',
      );
    }
    const currentAttachment = findExactAttachment(next, transaction.expectedAttachment);
    if (!currentAttachment) {
      return failure(
        stage,
        'ENTITY_PROJECTION_INCOMPATIBLE',
        'Failed attachment:add declaration changed before rollback',
      );
    }
    if (transaction.expectedEntity) {
      const currentEntity = next.stageEntities.find(
        (candidate) => candidate.entityId === transaction.expectedEntity!.entityId,
      );
      if (!currentEntity || !isEqual(currentEntity, transaction.expectedEntity)) {
        return failure(stage, 'ENTITY_STATE_INCOMPATIBLE', 'Failed attachment:add entity changed before rollback');
      }
      next.stageEntities = next.stageEntities.filter(
        (candidate) => candidate.entityId !== transaction.expectedEntity!.entityId,
      );
      removeEffect(next, transaction.expectedEntity.entityId);
    } else if (currentAttachment.entityId) {
      return failure(
        stage,
        'ENTITY_PROJECTION_INCOMPATIBLE',
        'Failed legacy attachment:add was promoted before rollback',
      );
    }
    next.attachments = next.attachments.filter(
      (candidate) => compositeKey(candidate) !== compositeKey(transaction.expectedAttachment),
    );
    if (transaction.previousEntity) upsertEntity(next, transaction.previousEntity);
    if (transaction.previousAttachment) upsertAttachment(next, transaction.previousAttachment);
  } else if (transaction.kind === 'remove') {
    if (transaction.entityId) {
      const entity = next.stageEntities.find((candidate) => candidate.entityId === transaction.entityId);
      if (!entity || (transaction.expectedEntity && !isEqual(entity, transaction.expectedEntity))) {
        return failure(stage, 'ENTITY_STATE_INCOMPATIBLE', `Entity ${transaction.entityId} changed before removal`);
      }
      if (transaction.expectedAttachment && !findExactAttachment(next, transaction.expectedAttachment)) {
        return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Entity projection changed before removal');
      }
      next.stageEntities = next.stageEntities.filter((candidate) => candidate.entityId !== transaction.entityId);
      next.attachments = next.attachments.filter((attachment) => attachment.entityId !== transaction.entityId);
      removeEffect(next, transaction.entityId);
    } else if (transaction.expectedAttachment) {
      const attachment = findExactAttachment(next, transaction.expectedAttachment);
      if (!attachment || attachment.entityId) {
        return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Legacy removal target changed before commit');
      }
      next.attachments = next.attachments.filter(
        (candidate) => compositeKey(candidate) !== compositeKey(transaction.expectedAttachment!),
      );
    } else {
      return failure(stage, 'ENTITY_PROJECTION_INCOMPATIBLE', 'Removal transaction has no target');
    }
  }

  const violations = validateStageEntityStateInvariants(next);
  return violations.length === 0
    ? { applied: true, state: next, violations: [] }
    : { applied: false, state: stage, violations };
}
