import type { ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IPerform } from '@/Core/Modules/perform/performInterface';
import { createNonePerform } from '@/Core/Modules/perform/performInterface';
import { getStringArgByKey } from '@/Core/util/getSentenceArg';
import type {
  IStageState,
  AttachmentLinkV0,
  StageEntityStateV0,
  VisualStateV0,
} from '@/Core/Modules/stage/stageInterface';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  deriveLegacyAttachmentEntityId,
  normalizeStageEntityId,
} from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import {
  getLegacyAttachmentAddProjectionConflict,
  LEGACY_ATTACHMENT_ADD_PROJECTION_CONFLICT_CODE,
  LEGACY_ATTACHMENT_INVARIANT_CODE,
  resolveLegacyAttachmentTarget,
} from './legacyAttachmentProjection';
import { stageEntity } from './stageEntity';
import { isAttachmentSemanticAnchorId } from '@/Core/controller/stage/pixi/attachments/semanticAnchorContract';
import {
  commitCalculatedEntityTransaction as commitAttachmentStateTransaction,
  createVisibilityCommandPerform,
  getEntityCommandDuration,
} from './stageEntityCommandState';
import { createAddFadePerform, createInstantAddPerform } from './attachmentAddPerform';
const createNoopPerform = () => createNonePerform();
const ATTACHMENT_ACTIONS = ['add', 'hide', 'show', 'remove'] as const;
type AttachmentAction = (typeof ATTACHMENT_ACTIONS)[number];
function isAttachmentAction(action: string): action is AttachmentAction {
  return ATTACHMENT_ACTIONS.includes(action as AttachmentAction);
}

function isFigureDeclared(stage: IStageState, figureKey: string): boolean {
  if (figureKey === 'fig-center') return stage.figName !== '';
  if (figureKey === 'fig-left') return stage.figNameLeft !== '';
  if (figureKey === 'fig-right') return stage.figNameRight !== '';
  return stage.freeFigure.some((figure) => figure.key === figureKey && figure.name !== '');
}

function reportAttachmentCommandError(code: string, message: string, sentence: ISentence): void {
  console.error({
    scope: 'webgal.attachment.command',
    code,
    message,
    action: sentence.content.trim(),
    args: sentence.args,
  });
}

function initialLocalVisualState(visible = true): VisualStateV0 & { space: 'local' } {
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

function createAttachmentLink(
  figureKey: string,
  configId: string,
  localVisualState: VisualStateV0 & { space: 'local' },
  semanticAnchor = 'head',
): AttachmentLinkV0 {
  return {
    schemaVersion: 0,
    parentKind: 'figure',
    parentFigureKey: figureKey,
    semanticAnchor,
    placementPresetId: configId,
    inheritancePolicy: { transform: true, opacity: true, visibility: true },
    attachedLocalVisualState: localVisualState,
  };
}

/**
 * Updates the serializable attachment declarations. The Pixi runtime reconciles
 * these declarations separately when the target Live2D figure is ready.
 */
export function attachment(sentence: ISentence): IPerform {
  const action = sentence.content.trim();
  if (!isAttachmentAction(action)) {
    reportAttachmentCommandError(
      'ATTACHMENT_UNKNOWN_ACTION',
      `Expected one of ${ATTACHMENT_ACTIONS.join(', ')}, received "${action}".`,
      sentence,
    );
    return createNoopPerform();
  }

  const figureKey = getStringArgByKey(sentence, 'figure')?.trim() ?? '';
  const attachmentId = getStringArgByKey(sentence, 'id')?.trim() ?? '';
  if (!figureKey || !attachmentId) {
    reportAttachmentCommandError(
      'ATTACHMENT_MISSING_ARGUMENT',
      'The attachment command requires non-empty -figure and -id arguments.',
      sentence,
    );
    return createNoopPerform();
  }

  const stage = stageStateManager.getCalculationStageState();
  const resolvedTarget = resolveLegacyAttachmentTarget(stage, figureKey, attachmentId);
  if (resolvedTarget.invariantError) {
    reportAttachmentCommandError(LEGACY_ATTACHMENT_INVARIANT_CODE, resolvedTarget.invariantError, sentence);
    return createNoopPerform();
  }
  const { legacyEntity, currentAttachment } = resolvedTarget;

  if (action === 'add') {
    const duration = getEntityCommandDuration(sentence, 500);
    const ease = getStringArgByKey(sentence, 'ease') ?? 'easeInOut';
    const projectionConflict = getLegacyAttachmentAddProjectionConflict(resolvedTarget, figureKey, attachmentId);
    if (projectionConflict) {
      reportAttachmentCommandError(LEGACY_ATTACHMENT_ADD_PROJECTION_CONFLICT_CODE, projectionConflict, sentence);
      return createNoopPerform();
    }
    if (!isFigureDeclared(stage, figureKey)) {
      reportAttachmentCommandError(
        'ATTACHMENT_TARGET_NOT_DECLARED',
        `Figure "${figureKey}" is not declared in the current stage state.`,
        sentence,
      );
      return createNoopPerform();
    }
    const configId = getStringArgByKey(sentence, 'config')?.trim() ?? '';
    const modelProfileId = getStringArgByKey(sentence, 'profile')?.trim() ?? '';
    const slot = getStringArgByKey(sentence, 'slot')?.trim() ?? '';
    const semanticAnchor = getStringArgByKey(sentence, 'anchor')?.trim() || 'head';
    if (!configId) {
      reportAttachmentCommandError(
        'ATTACHMENT_MISSING_ARGUMENT',
        'attachment:add requires a non-empty -config argument.',
        sentence,
      );
      return createNoopPerform();
    }
    if (!isAttachmentSemanticAnchorId(semanticAnchor)) {
      reportAttachmentCommandError(
        'ATTACHMENT_SEMANTIC_ANCHOR_INVALID',
        'attachment:add -anchor must be a supported named anchor, compatibility alias, or canonical dotted semantic anchor ID.',
        sentence,
      );
      return createNoopPerform();
    }

    const slotOwner = slot
      ? stage.attachments.find(
          (item) => item.figureKey === figureKey && item.slot === slot && item.attachmentId !== attachmentId,
        )
      : undefined;
    if (slotOwner) {
      reportAttachmentCommandError(
        'ATTACHMENT_SLOT_CONFLICT',
        `Slot "${slot}" on figure "${figureKey}" is already occupied by attachment "${slotOwner.attachmentId}".`,
        sentence,
      );
      return createNoopPerform();
    }

    const explicitEntityId = getStringArgByKey(sentence, 'entity') ?? '';
    let entityId: string;
    try {
      entityId = normalizeStageEntityId(explicitEntityId || deriveLegacyAttachmentEntityId(figureKey, attachmentId));
    } catch (error) {
      reportAttachmentCommandError(
        'ATTACHMENT_ENTITY_ID_INVALID',
        error instanceof Error ? error.message : String(error),
        sentence,
      );
      return createNoopPerform();
    }

    const entityById = stage.stageEntities.find((entity) => entity.entityId === entityId);
    if (
      legacyEntity?.attachmentLink === null ||
      (legacyEntity && legacyEntity.entityId !== entityId) ||
      (entityById && entityById !== legacyEntity)
    ) {
      reportAttachmentCommandError(
        legacyEntity?.attachmentLink === null ? 'ATTACHMENT_ENTITY_FREE_CONFLICT' : 'ATTACHMENT_ENTITY_ID_CONFLICT',
        legacyEntity?.attachmentLink === null
          ? `Legacy attachment (${figureKey}, ${attachmentId}) is currently a free stage entity.`
          : `Stage entity id "${entityId}" is already owned by another entity.`,
        sentence,
      );
      return createNoopPerform();
    }

    const attachmentState = {
      figureKey,
      attachmentId,
      configId,
      ...(modelProfileId ? { modelProfileId } : {}),
      ...(slot ? { slot } : {}),
      semanticAnchor,
      visible: duration === 0,
    };

    if (!explicitEntityId && !legacyEntity) {
      const committed = commitAttachmentStateTransaction(
        {
          kind: 'upsert-legacy-attachment',
          attachment: attachmentState,
          canonicalEntityId: entityId,
        },
        sentence,
      );
      if (!committed) return createNoopPerform();
      return duration > 0
        ? createAddFadePerform({
            figureKey,
            attachmentId,
            entityId,
            configId,
            slot,
            semanticAnchor,
            duration,
            ease,
            sentence,
            expectedAttachment: attachmentState,
            ...(currentAttachment ? { previousAttachment: currentAttachment } : {}),
          })
        : createInstantAddPerform(entityId);
    }

    const localVisualState = {
      ...(legacyEntity?.attachmentLink?.attachedLocalVisualState ?? initialLocalVisualState()),
      visible: duration === 0,
    };
    const stageEntity: StageEntityStateV0 = {
      schemaVersion: 0,
      entityId,
      renderableKind: 'attachment-sprite-group',
      source: {
        configId,
        ...(modelProfileId ? { modelProfileId } : {}),
        ...(slot ? { slot } : {}),
        legacyAlias: { originFigureKey: figureKey, attachmentId },
      },
      visualState: localVisualState,
      attachmentLink: createAttachmentLink(figureKey, configId, localVisualState, semanticAnchor),
    };

    const committed = commitAttachmentStateTransaction(
      {
        kind: 'upsert-explicit-attachment',
        entity: stageEntity,
        attachment: { ...attachmentState, entityId },
      },
      sentence,
    );
    if (!committed) return createNoopPerform();
    return duration > 0
      ? createAddFadePerform({
          figureKey,
          attachmentId,
          entityId,
          configId,
          slot,
          semanticAnchor,
          duration,
          ease,
          sentence,
          expectedAttachment: { ...attachmentState, entityId },
          expectedEntity: stageEntity,
          ...(currentAttachment ? { previousAttachment: currentAttachment } : {}),
          ...(legacyEntity ? { previousEntity: legacyEntity } : {}),
        })
      : createInstantAddPerform(entityId);
  }

  if (!currentAttachment && !legacyEntity) {
    return createNoopPerform();
  }

  const operationEntityId =
    legacyEntity?.entityId ?? currentAttachment?.entityId ?? deriveLegacyAttachmentEntityId(figureKey, attachmentId);
  if (action === 'remove') {
    return stageEntity({
      ...sentence,
      content: 'remove',
      args: [
        { key: 'entity', value: operationEntityId },
        ...sentence.args.filter((arg) => ['duration', 'ease', 'next', 'continue'].includes(arg.key)),
      ],
    });
  }
  return createVisibilityCommandPerform(
    sentence,
    {
      entityId: operationEntityId,
      entity: legacyEntity,
      ...(!legacyEntity && currentAttachment ? { legacyAttachment: currentAttachment } : {}),
    },
    action === 'show',
    getEntityCommandDuration(sentence, 0),
    getStringArgByKey(sentence, 'ease') ?? '',
    false,
  );
}
