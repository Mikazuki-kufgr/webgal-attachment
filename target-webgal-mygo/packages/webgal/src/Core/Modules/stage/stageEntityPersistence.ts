import { commandType } from '@/Core/controller/scene/sceneInterface';
import { isAttachmentSemanticAnchorId } from '@/Core/controller/stage/pixi/attachments/semanticAnchorContract';
import { normalizeStageEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import type {
  AttachmentLinkV0,
  AttachedLocalVisualStateV0,
  IAttachmentState,
  IEffect,
  IRunPerform,
  IStageState,
  StageEntityStateV0,
  VisualStateV0,
} from '@/Core/Modules/stage/stageInterface';
import { baseTransform } from '@/Core/Modules/stage/stageInterface';
import { validateStageEntityStateInvariants } from '@/Core/Modules/stage/stageEntityStateTransaction';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import { ATTACHMENT_COMMAND_ABI } from 'webgal-parser';
import { STAGE_KEYS } from '@/Core/constants';
import { FIGURE_KEYS } from './stageInterface';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import {
  sanitizeNativeStageFields,
  persistenceRecord,
  StagePersistenceError,
  type StagePersistenceDiagnostic,
} from './stagePersistenceBoundary';
export { StagePersistenceError } from './stagePersistenceBoundary';

const pendingCommittedEntities = new Map<string, { token: symbol; entity: StageEntityStateV0 }>();

export interface PendingCommittedStageEntityToken {
  entityId: string;
  token: symbol;
}

/** Runtime-only rollback point used when a save races an async detach/reattach. */
export function retainPendingCommittedStageEntity(entity: StageEntityStateV0): PendingCommittedStageEntityToken {
  const token = Symbol(entity.entityId);
  pendingCommittedEntities.set(entity.entityId, { token, entity: cloneDeep(entity) });
  return { entityId: entity.entityId, token };
}

export function releasePendingCommittedStageEntity(handle: PendingCommittedStageEntityToken): boolean {
  const current = pendingCommittedEntities.get(handle.entityId);
  if (!current || current.token !== handle.token) return false;
  pendingCommittedEntities.delete(handle.entityId);
  return true;
}

export function clearPendingCommittedStageEntities(): void {
  pendingCommittedEntities.clear();
}

export function getPendingCommittedStageEntityCount(): number {
  return pendingCommittedEntities.size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return persistenceRecord(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized === '' || normalized.includes('\u0000') ? undefined : normalized;
}

function stageEntityId(value: unknown): string | undefined {
  const candidate = stringValue(value);
  if (!candidate) return undefined;
  try {
    return normalizeStageEntityId(candidate);
  } catch {
    return undefined;
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function vector(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = finite(value.x);
  const y = finite(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function visualState(value: unknown, forcedSpace?: VisualStateV0['space']): VisualStateV0 | undefined {
  if (!isRecord(value)) return undefined;
  const space = forcedSpace ?? (value.space === 'local' || value.space === 'world' ? value.space : undefined);
  const position = vector(value.position);
  const scale = vector(value.scale);
  const rotation = finite(value.rotation);
  const opacity = finite(value.opacity);
  if (
    !space ||
    !position ||
    !scale ||
    rotation === undefined ||
    opacity === undefined ||
    typeof value.visible !== 'boolean'
  ) {
    return undefined;
  }
  const skew = value.skew === undefined ? undefined : vector(value.skew);
  if (value.skew !== undefined && !skew) return undefined;
  let appearance: VisualStateV0['appearance'];
  if (value.appearance !== undefined) {
    if (!isRecord(value.appearance) || !isRecord(value.appearance.color)) return undefined;
    const blur = finite(value.appearance.blur);
    const brightness = finite(value.appearance.brightness);
    const contrast = value.appearance.contrast === undefined ? undefined : finite(value.appearance.contrast);
    const saturation = value.appearance.saturation === undefined ? undefined : finite(value.appearance.saturation);
    const gamma = value.appearance.gamma === undefined ? undefined : finite(value.appearance.gamma);
    const red = finite(value.appearance.color.red);
    const green = finite(value.appearance.color.green);
    const blue = finite(value.appearance.color.blue);
    if (
      blur === undefined ||
      brightness === undefined ||
      (value.appearance.contrast !== undefined && contrast === undefined) ||
      (value.appearance.saturation !== undefined && saturation === undefined) ||
      (value.appearance.gamma !== undefined && gamma === undefined) ||
      red === undefined ||
      green === undefined ||
      blue === undefined
    ) {
      return undefined;
    }
    appearance = {
      blur: Math.max(0, blur),
      brightness: Math.max(0, brightness),
      ...(contrast === undefined ? {} : { contrast: Math.max(0, contrast) }),
      ...(saturation === undefined ? {} : { saturation: Math.max(0, saturation) }),
      ...(gamma === undefined ? {} : { gamma: Math.max(Number.EPSILON, gamma) }),
      color: {
        red: Math.max(0, Math.min(255, red)),
        green: Math.max(0, Math.min(255, green)),
        blue: Math.max(0, Math.min(255, blue)),
      },
    };
    if (value.appearance.bevel !== undefined) {
      if (!isRecord(value.appearance.bevel) || !isRecord(value.appearance.bevel.color)) return undefined;
      const bevel = value.appearance.bevel;
      const bevelColor = bevel.color as Record<string, unknown>;
      const strength = finite(bevel.strength);
      const thickness = finite(bevel.thickness);
      const bevelRotation = finite(bevel.rotation);
      const softness = finite(bevel.softness);
      const bevelRed = finite(bevelColor.red);
      const bevelGreen = finite(bevelColor.green);
      const bevelBlue = finite(bevelColor.blue);
      if (
        [strength, thickness, bevelRotation, softness, bevelRed, bevelGreen, bevelBlue].some(
          (item) => item === undefined,
        )
      )
        return undefined;
      appearance.bevel = {
        strength: Math.max(0, strength!),
        thickness: Math.max(0, thickness!),
        rotation: bevelRotation!,
        softness: Math.max(0, softness!),
        color: {
          red: Math.max(0, Math.min(255, bevelRed!)),
          green: Math.max(0, Math.min(255, bevelGreen!)),
          blue: Math.max(0, Math.min(255, bevelBlue!)),
        },
      };
    }
    if (value.appearance.bloom !== undefined) {
      if (!isRecord(value.appearance.bloom)) return undefined;
      const bloom = value.appearance.bloom;
      const strength = finite(bloom.strength);
      const bloomBrightness = finite(bloom.brightness);
      const bloomBlur = finite(bloom.blur);
      const threshold = finite(bloom.threshold);
      if ([strength, bloomBrightness, bloomBlur, threshold].some((item) => item === undefined)) return undefined;
      appearance.bloom = {
        strength: Math.max(0, strength!),
        brightness: Math.max(0, bloomBrightness!),
        blur: Math.max(0, bloomBlur!),
        threshold: Math.max(0, threshold!),
      };
    }
    const shockwave = value.appearance.shockwave === undefined ? undefined : finite(value.appearance.shockwave);
    const radiusAlpha = value.appearance.radiusAlpha === undefined ? undefined : finite(value.appearance.radiusAlpha);
    if (
      (value.appearance.shockwave !== undefined && shockwave === undefined) ||
      (value.appearance.radiusAlpha !== undefined && radiusAlpha === undefined)
    )
      return undefined;
    if (shockwave !== undefined) appearance.shockwave = shockwave;
    if (radiusAlpha !== undefined) appearance.radiusAlpha = radiusAlpha;
  }
  return {
    space,
    position,
    scale,
    rotation,
    ...(skew ? { skew } : {}),
    opacity: Math.max(0, Math.min(1, opacity)),
    visible: value.visible,
    ...(appearance ? { appearance } : {}),
  };
}

function localVisualState(value: unknown): AttachedLocalVisualStateV0 | undefined {
  return visualState(value, 'local') as AttachedLocalVisualStateV0 | undefined;
}

function attachmentLink(value: unknown, canonicalLocal: AttachedLocalVisualStateV0): AttachmentLinkV0 | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.schemaVersion !== 0 ||
    value.parentKind !== 'figure' ||
    !isRecord(value.inheritancePolicy) ||
    !['transform', 'opacity', 'visibility'].every(
      (key) => value.inheritancePolicy && (value.inheritancePolicy as Record<string, unknown>)[key] === true,
    )
  )
    return undefined;
  const parentFigureKey = stringValue(value.parentFigureKey);
  const semanticAnchor = stringValue(value.semanticAnchor);
  const placementPresetId = stringValue(value.placementPresetId);
  if (!parentFigureKey || !semanticAnchor || !placementPresetId || !isAttachmentSemanticAnchorId(semanticAnchor)) {
    return undefined;
  }
  return {
    schemaVersion: 0,
    parentKind: 'figure',
    parentFigureKey,
    semanticAnchor,
    placementPresetId,
    inheritancePolicy: { transform: true, opacity: true, visibility: true },
    attachedLocalVisualState: cloneDeep(canonicalLocal),
  };
}

function stageEntity(value: unknown): StageEntityStateV0 | undefined {
  if (!isRecord(value) || !isRecord(value.source)) return undefined;
  const entityId = stageEntityId(value.entityId);
  const configId = stringValue(value.source.configId);
  const modelProfileId =
    value.source.modelProfileId === undefined ? undefined : stringValue(value.source.modelProfileId);
  if (!entityId || !configId || value.schemaVersion !== 0 || value.renderableKind !== 'attachment-sprite-group') {
    return undefined;
  }
  if (value.source.modelProfileId !== undefined && !modelProfileId) return undefined;
  const rawVisual = visualState(value.visualState);
  if (!rawVisual) return undefined;
  const slot = value.source.slot === undefined ? undefined : stringValue(value.source.slot);
  if (value.source.slot !== undefined && !slot) return undefined;
  let legacyAlias: StageEntityStateV0['source']['legacyAlias'];
  if (value.source.legacyAlias !== undefined) {
    if (!isRecord(value.source.legacyAlias)) return undefined;
    const originFigureKey = stringValue(value.source.legacyAlias.originFigureKey);
    const attachmentId = stringValue(value.source.legacyAlias.attachmentId);
    if (!originFigureKey || !attachmentId) return undefined;
    legacyAlias = { originFigureKey, attachmentId };
  }
  const savedLocal =
    value.source.lastAttachedLocalVisualState === undefined
      ? undefined
      : localVisualState(value.source.lastAttachedLocalVisualState);
  if (value.source.lastAttachedLocalVisualState !== undefined && !savedLocal) return undefined;
  const freePositionOrigin =
    value.source.freePositionOrigin === undefined ? undefined : vector(value.source.freePositionOrigin);
  if (value.source.freePositionOrigin !== undefined && !freePositionOrigin) return undefined;

  if (value.attachmentLink === null) {
    const world = { ...rawVisual, space: 'world' as const };
    return {
      schemaVersion: 0,
      entityId,
      renderableKind: 'attachment-sprite-group',
      source: {
        configId,
        ...(modelProfileId ? { modelProfileId } : {}),
        ...(slot ? { slot } : {}),
        ...(savedLocal ? { lastAttachedLocalVisualState: savedLocal } : {}),
        ...(freePositionOrigin ? { freePositionOrigin } : {}),
        ...(legacyAlias ? { legacyAlias } : {}),
      },
      visualState: world,
      attachmentLink: null,
    };
  }

  const local = { ...rawVisual, space: 'local' as const };
  const link = attachmentLink(value.attachmentLink, local);
  if (!link) return undefined;
  return {
    schemaVersion: 0,
    entityId,
    renderableKind: 'attachment-sprite-group',
    source: {
      configId,
      ...(modelProfileId ? { modelProfileId } : {}),
      ...(slot ? { slot } : {}),
      lastAttachedLocalVisualState: cloneDeep(local),
      ...(legacyAlias ? { legacyAlias } : {}),
    },
    visualState: local,
    attachmentLink: link,
  };
}

function legacyAttachment(value: unknown): IAttachmentState | undefined {
  if (!isRecord(value)) return undefined;
  const figureKey = stringValue(value.figureKey);
  const attachmentId = stringValue(value.attachmentId);
  const configId = stringValue(value.configId);
  const modelProfileId = value.modelProfileId === undefined ? undefined : stringValue(value.modelProfileId);
  const entityId = value.entityId === undefined ? undefined : stageEntityId(value.entityId);
  const slot = value.slot === undefined ? undefined : stringValue(value.slot);
  const semanticAnchor = value.semanticAnchor === undefined ? undefined : stringValue(value.semanticAnchor);
  if (!figureKey || !attachmentId || !configId || typeof value.visible !== 'boolean') return undefined;
  if (value.entityId !== undefined && !entityId) return undefined;
  if (value.slot !== undefined && !slot) return undefined;
  if (value.modelProfileId !== undefined && !modelProfileId) return undefined;
  if (value.semanticAnchor !== undefined && (!semanticAnchor || !isAttachmentSemanticAnchorId(semanticAnchor))) {
    return undefined;
  }
  return {
    figureKey,
    attachmentId,
    ...(entityId ? { entityId } : {}),
    configId,
    ...(modelProfileId ? { modelProfileId } : {}),
    ...(slot ? { slot } : {}),
    ...(semanticAnchor ? { semanticAnchor } : {}),
    visible: value.visible,
  };
}

function projection(entity: StageEntityStateV0): IAttachmentState | undefined {
  const alias = entity.source.legacyAlias;
  const link = entity.attachmentLink;
  if (!alias || !link) return undefined;
  return {
    figureKey: link.parentFigureKey,
    attachmentId: alias.attachmentId,
    entityId: entity.entityId,
    configId: entity.source.configId,
    ...(entity.source.modelProfileId ? { modelProfileId: entity.source.modelProfileId } : {}),
    ...(entity.source.slot ? { slot: entity.source.slot } : {}),
    semanticAnchor: link.semanticAnchor,
    visible: entity.visualState.visible,
  };
}

function effectForEntity(entity: StageEntityStateV0, previous?: IEffect['transform']): IEffect {
  const transform = cloneDeep(previous ?? baseTransform);
  transform.position = cloneDeep(entity.visualState.position);
  transform.scale = cloneDeep(entity.visualState.scale);
  if (entity.visualState.skew) transform.skew = cloneDeep(entity.visualState.skew);
  else delete transform.skew;
  transform.rotation = entity.visualState.rotation;
  transform.alpha = entity.visualState.opacity;
  transform.blur = entity.visualState.appearance?.blur ?? 0;
  transform.brightness = entity.visualState.appearance?.brightness ?? 1;
  transform.contrast = entity.visualState.appearance?.contrast ?? 1;
  transform.saturation = entity.visualState.appearance?.saturation ?? 1;
  transform.gamma = entity.visualState.appearance?.gamma ?? 1;
  transform.colorRed = entity.visualState.appearance?.color.red ?? 255;
  transform.colorGreen = entity.visualState.appearance?.color.green ?? 255;
  transform.colorBlue = entity.visualState.appearance?.color.blue ?? 255;
  transform.bevel = entity.visualState.appearance?.bevel?.strength ?? 0;
  transform.bevelThickness = entity.visualState.appearance?.bevel?.thickness ?? 0;
  transform.bevelRotation = entity.visualState.appearance?.bevel?.rotation ?? 0;
  transform.bevelSoftness = entity.visualState.appearance?.bevel?.softness ?? 0;
  transform.bevelRed = entity.visualState.appearance?.bevel?.color.red ?? 255;
  transform.bevelGreen = entity.visualState.appearance?.bevel?.color.green ?? 255;
  transform.bevelBlue = entity.visualState.appearance?.bevel?.color.blue ?? 255;
  transform.bloom = entity.visualState.appearance?.bloom?.strength ?? 0;
  transform.bloomBrightness = entity.visualState.appearance?.bloom?.brightness ?? 1;
  transform.bloomBlur = entity.visualState.appearance?.bloom?.blur ?? 0;
  transform.bloomThreshold = entity.visualState.appearance?.bloom?.threshold ?? 0;
  transform.shockwaveFilter = entity.visualState.appearance?.shockwave ?? 0;
  transform.radiusAlphaFilter = entity.visualState.appearance?.radiusAlpha ?? 0;
  return { target: entity.entityId, transform };
}

const STAGE_ENTITY_TARGET_COMMANDS = new Set<commandType>([
  commandType.setComplexAnimation,
  commandType.setFilter,
  commandType.setAnimation,
  commandType.setTempAnimation,
  commandType.setTransform,
]);
function performTargetsStageEntity(perform: IRunPerform, ids: Set<string>): boolean {
  if (perform.script.command === commandType.stageEntity || perform.script.command === commandType.attachment)
    return true;
  return (
    STAGE_ENTITY_TARGET_COMMANDS.has(perform.script.command) &&
    perform.script.args.some(
      (arg) => arg.key === 'target' && typeof arg.value === 'string' && ids.has(arg.value.trim()),
    )
  );
}
function argument(perform: IRunPerform, key: string): string | undefined {
  const matches = perform.script.args.filter((arg) => arg.key === key);
  return matches.length === 1 && typeof matches[0].value === 'string' ? matches[0].value.trim() : undefined;
}
export function isPendingAttachmentAddWitness(perform: IRunPerform, attachment: IAttachmentState): boolean {
  if (perform.script.command !== commandType.attachment || perform.script.content.trim() !== 'add') return false;
  if (
    ['figure', 'id', 'config', 'profile', 'slot', 'anchor', 'entity'].some(
      (key) => perform.script.args.filter((arg) => arg.key === key).length > 1,
    )
  )
    return false;
  const entity = argument(perform, 'entity');
  return (
    argument(perform, 'figure') === attachment.figureKey &&
    argument(perform, 'id') === attachment.attachmentId &&
    argument(perform, 'config') === attachment.configId &&
    (argument(perform, 'profile') || undefined) === attachment.modelProfileId &&
    (argument(perform, 'slot') || undefined) === attachment.slot &&
    (argument(perform, 'anchor') || 'head') === (attachment.semanticAnchor ?? 'head') &&
    (entity || deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId)) ===
      (attachment.entityId ?? deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId))
  );
}

/** Historical restoration never reads live operation tokens. It is a pure schema/ABI boundary. */
export function inspectStageStateForRestore(
  input: unknown,
  commandAbi?: unknown,
): {
  state: IStageState;
  diagnostics: StagePersistenceDiagnostic[];
} {
  const next = sanitizeNativeStageFields(input, commandAbi);
  if (!isRecord(input)) throw new StagePersistenceError('STAGE_RESTORE_INVALID', []);
  for (const field of ['attachments', 'stageEntities']) {
    if (input[field] !== undefined && (!Array.isArray(input[field]) || (input[field] as unknown[]).length > 100000))
      throw new StagePersistenceError('STAGE_RESTORE_INVALID', [
        { code: 'STAGE_RESTORE_INVALID', path: field, message: 'Expected bounded array' },
      ]);
  }
  const diagnostics: StagePersistenceDiagnostic[] = [];
  const quarantine = (path: string, reason: string) =>
    diagnostics.push({ code: 'STAGE_ENTITY_ROW_QUARANTINED', path, message: reason });
  const rawEntities = (input.stageEntities ?? []) as unknown[];
  const rawAttachments = (input.attachments ?? []) as unknown[];
  const hostIds = new Set<string>([...Object.values(STAGE_KEYS), ...FIGURE_KEYS, ...next.freeFigure.map((row) => row.key)]);
  const entityIds = new Set<string>(),
    aliases = new Set<string>(),
    slots = new Set<string>();
  const claimedEntityIds = new Set<string>();
  for (const raw of [...rawEntities, ...rawAttachments]) {
    const id = isRecord(raw) ? stageEntityId(raw.entityId) : undefined;
    if (id && !hostIds.has(id)) claimedEntityIds.add(id);
  }
  const entities: StageEntityStateV0[] = [];
  rawEntities.forEach((raw, index) => {
    const entity = stageEntity(raw);
    if (!entity || hostIds.has(entity.entityId) || entityIds.has(entity.entityId)) {
      quarantine(`stageEntities[${index}]`, 'Invalid entity schema/identity or duplicate/native owner');
      return;
    }
    const alias = entity.source.legacyAlias;
    const aliasKey = alias ? `${alias.originFigureKey}\u0000${alias.attachmentId}` : undefined;
    const slotKey =
      entity.attachmentLink && entity.source.slot
        ? `${entity.attachmentLink.parentFigureKey}\u0000${entity.source.slot}`
        : undefined;
    if ((aliasKey && aliases.has(aliasKey)) || (slotKey && slots.has(slotKey))) {
      quarantine(`stageEntities[${index}]`, 'Duplicate legacy alias or attached slot');
      return;
    }
    entityIds.add(entity.entityId);
    if (aliasKey) aliases.add(aliasKey);
    if (slotKey) slots.add(slotKey);
    entities.push(entity);
  });
  const attachments: IAttachmentState[] = [],
    composites = new Set<string>(),
    validLazyIds = new Set<string>();
  for (const entity of entities) {
    const item = projection(entity);
    if (!item) continue;
    composites.add(`${item.figureKey}\u0000${item.attachmentId}`);
    attachments.push(item);
  }
  rawAttachments.forEach((raw, index) => {
    const item = legacyAttachment(raw);
    if (!item) {
      quarantine(`attachments[${index}]`, 'Invalid attachment schema');
      return;
    }
    // Explicit rows are projections; the canonical entity above determines them.
    if (item.entityId) {
      if (!entityIds.has(item.entityId)) quarantine(`attachments[${index}]`, 'Missing valid explicit entity');
      return;
    }
    const key = `${item.figureKey}\u0000${item.attachmentId}`,
      slotKey = item.slot ? `${item.figureKey}\u0000${item.slot}` : undefined;
    const id = deriveLegacyAttachmentEntityId(item.figureKey, item.attachmentId);
    if (
      hostIds.has(id) ||
      entityIds.has(id) ||
      composites.has(key) ||
      aliases.has(key) ||
      (slotKey && slots.has(slotKey))
    ) {
      quarantine(`attachments[${index}]`, 'Duplicate legacy identity/composite/slot');
      return;
    }
    composites.add(key);
    if (slotKey) slots.add(slotKey);
    attachments.push(item);
    claimedEntityIds.add(id);
    validLazyIds.add(id);
  });
  // A pending add's hidden readiness gate is not a user-authored hide. Its exact
  // validated command is the witness for durable visible=true before replay is stripped.
  for (const item of attachments) {
    if (item.visible || !next.PerformList.some((perform) => isPendingAttachmentAddWitness(perform, item))) continue;
    item.visible = true;
    const entity = entities.find((row) => row.entityId === item.entityId);
    if (entity) {
      entity.visualState.visible = true;
      if (entity.attachmentLink) entity.attachmentLink.attachedLocalVisualState.visible = true;
      if (entity.source.lastAttachedLocalVisualState) entity.source.lastAttachedLocalVisualState.visible = true;
    }
  }
  next.attachments = attachments;
  next.stageEntities = entities;
  next.effects = [
    ...next.effects.filter((effect) => !claimedEntityIds.has(effect.target) || validLazyIds.has(effect.target)),
    ...entities.map((entity) => effectForEntity(entity)),
  ];
  const operationTargets = new Set([...entityIds, ...claimedEntityIds]);
  next.PerformList = next.PerformList.filter((perform) => !performTargetsStageEntity(perform, operationTargets));
  const violations = validateStageEntityStateInvariants(next);
  if (violations.length)
    throw new StagePersistenceError(
      'STAGE_ENTITY_RESTORE_INVARIANT_FAILED',
      violations.map((v) => ({ code: v.code, path: 'stage', message: v.message })),
    );
  return { state: next, diagnostics };
}
export function sanitizeStageStateForRestore(input: unknown, commandAbi?: unknown): IStageState {
  return inspectStageStateForRestore(input, commandAbi).state;
}

function samePersistenceOwner(current: StageEntityStateV0, previous: StageEntityStateV0): boolean {
  const identity = (entity: StageEntityStateV0) => ({
    entityId: entity.entityId,
    renderableKind: entity.renderableKind,
    source: {
      configId: entity.source.configId,
      modelProfileId: entity.source.modelProfileId,
      slot: entity.source.slot,
      legacyAlias: entity.source.legacyAlias,
      freePositionOrigin: entity.source.freePositionOrigin,
    },
    link: entity.attachmentLink ? { ...entity.attachmentLink, attachedLocalVisualState: undefined } : null,
  });
  return isEqual(identity(current), identity(previous));
}

/** Live capture only: a pending reattach retains its actual pre-flight world pose. */
export function createCommittedStageSnapshot(stage: IStageState): IStageState {
  const candidate = cloneDeep(stage);
  for (const { entity } of pendingCommittedEntities.values()) {
    const index = candidate.stageEntities.findIndex((row) => row.entityId === entity.entityId);
    if (index >= 0 && samePersistenceOwner(candidate.stageEntities[index], entity))
      candidate.stageEntities[index] = cloneDeep(entity);
  }
  return sanitizeStageStateForRestore(candidate, ATTACHMENT_COMMAND_ABI);
}
export function committedStageSnapshotViolations(stage: IStageState) {
  return validateStageEntityStateInvariants(createCommittedStageSnapshot(stage));
}
