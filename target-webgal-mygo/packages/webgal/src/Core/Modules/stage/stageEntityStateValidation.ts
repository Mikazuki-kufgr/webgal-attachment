import type { StageStateInvariantViolation } from './stageEntityStateTransaction';
import {
  normalizeStageEntityId,
  deriveLegacyAttachmentEntityId,
} from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import { STAGE_KEYS } from '@/Core/constants';
import { FIGURE_KEYS } from './stageInterface';

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.includes('\u0000');
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): boolean => number(value) && value >= 0;
const positiveGamma = (value: unknown): boolean => number(value) && value >= Number.EPSILON;
const vector = (value: unknown): boolean => row(value) && number(value.x) && number(value.y);
const color = (value: unknown): boolean =>
  row(value) &&
  ['red', 'green', 'blue'].every((key) => {
    const n = value[key];
    return number(n) && n >= 0 && n <= 255;
  });
const optional = (value: unknown, predicate: (value: unknown) => boolean): boolean =>
  value === undefined || predicate(value);
const fields = (value: Row, keys: string[]): boolean => keys.every((key) => number(value[key]));

function visual(value: unknown): boolean {
  if (
    !row(value) ||
    (value.space !== 'local' && value.space !== 'world') ||
    !vector(value.position) ||
    !vector(value.scale) ||
    !optional(value.skew, vector) ||
    !number(value.rotation) ||
    !number(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 1 ||
    typeof value.visible !== 'boolean'
  )
    return false;
  if (value.appearance === undefined) return true;
  const a = value.appearance;
  if (
    !row(a) ||
    !nonnegative(a.blur) ||
    !nonnegative(a.brightness) ||
    !color(a.color) ||
    !['contrast', 'saturation'].every((key) => optional(a[key], nonnegative)) ||
    !optional(a.gamma, positiveGamma) ||
    !['shockwave', 'radiusAlpha'].every((key) => optional(a[key], number))
  )
    return false;
  if (
    a.bevel !== undefined &&
    (!row(a.bevel) || !fields(a.bevel, ['strength', 'thickness', 'rotation', 'softness']) || !color(a.bevel.color))
  )
    return false;
  if (a.bloom !== undefined && (!row(a.bloom) || !fields(a.bloom, ['strength', 'brightness', 'blur', 'threshold'])))
    return false;
  if (row(a.bevel) && !['strength', 'thickness', 'softness'].every((key) => nonnegative((a.bevel as Row)[key])))
    return false;
  if (row(a.bloom) && !Object.values(a.bloom).every(nonnegative)) return false;
  return true;
}

function attachment(value: unknown): boolean {
  return (
    row(value) &&
    ['figureKey', 'attachmentId', 'configId'].every((key) => text(value[key])) &&
    optional(value.entityId, text) &&
    optional(value.modelProfileId, text) &&
    optional(value.slot, text) &&
    optional(value.semanticAnchor, text) &&
    typeof value.visible === 'boolean'
  );
}

function link(value: unknown): boolean {
  return (
    row(value) &&
    value.schemaVersion === 0 &&
    value.parentKind === 'figure' &&
    ['parentFigureKey', 'semanticAnchor', 'placementPresetId'].every((key) => text(value[key])) &&
    row(value.inheritancePolicy) &&
    ['transform', 'opacity', 'visibility'].every((key) => (value.inheritancePolicy as Row)[key] === true) &&
    visual(value.attachedLocalVisualState) &&
    (value.attachedLocalVisualState as Row).space === 'local'
  );
}

function entity(value: unknown): boolean {
  if (
    !row(value) ||
    value.schemaVersion !== 0 ||
    value.renderableKind !== 'attachment-sprite-group' ||
    !text(value.entityId) ||
    !row(value.source) ||
    !text(value.source.configId) ||
    !optional(value.source.modelProfileId, text) ||
    !optional(value.source.slot, text) ||
    !visual(value.visualState) ||
    (value.attachmentLink !== null && !link(value.attachmentLink))
  )
    return false;
  if (
    value.source.lastAttachedLocalVisualState !== undefined &&
    (!visual(value.source.lastAttachedLocalVisualState) ||
      (value.source.lastAttachedLocalVisualState as Row).space !== 'local')
  )
    return false;
  if (!optional(value.source.freePositionOrigin, vector)) return false;
  const alias = value.source.legacyAlias;
  return alias === undefined || (row(alias) && text(alias.originFigureKey) && text(alias.attachmentId));
}

const invalid = (message: string): StageStateInvariantViolation[] => [{ code: 'ENTITY_STATE_INCOMPATIBLE', message }];

/** Bounded attachment-state validation, not a whole save-file or model/Profile validator. */
export function validateStageEntityStateShape(stage: unknown): StageStateInvariantViolation[] {
  if (
    !row(stage) ||
    !Array.isArray(stage.attachments) ||
    !Array.isArray(stage.stageEntities) ||
    !Array.isArray(stage.effects) ||
    !Array.isArray(stage.freeFigure)
  )
    return invalid('Stage attachment/entity/effect arrays are required');
  if (!Array.from(stage.attachments).every(attachment) || !Array.from(stage.stageEntities).every(entity))
    return invalid('Malformed attachment or entity state');
  if (!Array.from(stage.effects).every((effect) => row(effect) && text(effect.target)))
    return invalid('Malformed effect target');
  const hostIds = new Set<string>([...Object.values(STAGE_KEYS), ...FIGURE_KEYS]);
  for (const figure of stage.freeFigure) if (row(figure) && text(figure.key)) hostIds.add(figure.key);
  try {
    for (const a of stage.attachments as Row[]) {
      const id =
        a.entityId === undefined
          ? deriveLegacyAttachmentEntityId(a.figureKey as string, a.attachmentId as string)
          : normalizeStageEntityId(a.entityId as string);
      if (hostIds.has(id))
        return [
          { code: 'ENTITY_ID_CONFLICT', message: 'Attachment identity collides with a native stage target: ' + id },
        ];
    }
    for (const e of stage.stageEntities as Row[]) {
      normalizeStageEntityId(e.entityId as string);
      if (hostIds.has(e.entityId as string))
        return [
          { code: 'ENTITY_ID_CONFLICT', message: 'Entity identity collides with a native stage target: ' + e.entityId },
        ];
      for (const effect of stage.effects as Row[]) {
        if (effect.target !== e.entityId) continue;
        if (!row(effect.transform) || !vector(effect.transform.position) || !vector(effect.transform.scale))
          return invalid('Entity effect requires complete position and scale');
        for (const [key, value] of Object.entries(effect.transform)) {
          if (value === undefined) continue;
          if (['position', 'scale', 'skew'].includes(key) ? !vector(value) : !number(value))
            return invalid('Entity effect contains invalid numeric field: ' + key);
        }
      }
    }
  } catch (error) {
    return [{ code: 'ENTITY_ID_INVALID', message: error instanceof Error ? error.message : String(error) }];
  }
  return [];
}

/** Typed JS callers still receive diagnostics for unknown kinds or malformed payloads. */
export function validateStageEntityTransactionShape(value: unknown): StageStateInvariantViolation[] {
  if (!row(value)) return invalid('Transaction must be an object');
  let valid = false;
  switch (value.kind) {
    case 'upsert-legacy-attachment':
      valid = attachment(value.attachment) && text(value.canonicalEntityId);
      break;
    case 'upsert-explicit-attachment':
      valid = attachment(value.attachment) && text((value.attachment as Row).entityId) && entity(value.entity);
      break;
    case 'promote-and-detach':
      valid =
        attachment(value.expectedAttachment) &&
        text(value.entityId) &&
        visual(value.visualState) &&
        optional(value.freePositionOrigin, vector);
      break;
    case 'promote-and-set-visibility':
      valid = attachment(value.expectedAttachment) && text(value.entityId) && typeof value.visible === 'boolean';
      break;
    case 'detach':
      valid =
        text(value.entityId) &&
        optional(value.expectedEntity, entity) &&
        visual(value.visualState) &&
        optional(value.freePositionOrigin, vector);
      break;
    case 'reattach':
      valid =
        text(value.entityId) &&
        optional(value.expectedEntity, entity) &&
        optional(value.modelProfileId, text) &&
        link(value.attachmentLink);
      break;
    case 'set-visibility':
    case 'remove':
      valid =
        (text(value.entityId) || attachment(value.expectedAttachment)) &&
        optional(value.entityId, text) &&
        optional(value.expectedEntity, entity) &&
        optional(value.expectedAttachment, attachment) &&
        (value.kind !== 'set-visibility' || typeof value.visible === 'boolean');
      break;
    case 'rollback-attachment-add':
      valid =
        attachment(value.expectedAttachment) &&
        optional(value.expectedEntity, entity) &&
        optional(value.previousAttachment, attachment) &&
        optional(value.previousEntity, entity);
      break;
    default:
      return invalid('Unknown stage entity transaction kind');
  }
  return valid ? [] : invalid('Malformed ' + String(value.kind) + ' transaction');
}
