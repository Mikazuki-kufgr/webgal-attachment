import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import type { IAttachmentState, IStageState, StageEntityStateV0 } from '@/Core/Modules/stage/stageInterface';
import type { AttachmentEntityVisualState } from './stageEntityVisualState';
import { deriveLegacyAttachmentEntityId } from './stageEntityIdentity';

export interface PresentationReservation {
  release(): void;
}
interface Reservation<T> {
  token: symbol;
  expected: unknown;
  value: T;
}
const visibility = new Map<string, Reservation<boolean>>();
const visuals = new Map<string, Reservation<AttachmentEntityVisualState>>();
const addFailures = new Map<string, { token: symbol; expected: IAttachmentState }>();
function rowId(row: IAttachmentState): string {
  return row.entityId ?? deriveLegacyAttachmentEntityId(row.figureKey, row.attachmentId);
}
function entityBinding(entity: StageEntityStateV0) {
  const link = entity.attachmentLink;
  return {
    entityId: entity.entityId,
    source: entity.source,
    renderableKind: entity.renderableKind,
    link: link ? { ...link, attachedLocalVisualState: undefined } : null,
  };
}
function identity(stage: IStageState, id: string): unknown {
  const entity = stage.stageEntities.find((item) => item.entityId === id);
  if (entity) return entityBinding(entity);
  const row = stage.attachments.find((item) => rowId(item) === id);
  return row ? { ...row, visible: undefined } : undefined;
}
function reserve<T>(
  map: Map<string, Reservation<T>>,
  id: string,
  expected: unknown,
  value: T,
): PresentationReservation {
  const token = Symbol(id);
  map.set(id, { token, expected: cloneDeep(expected), value: cloneDeep(value) });
  return {
    release() {
      if (map.get(id)?.token === token) map.delete(id);
    },
  };
}

/** Pure pending metadata: no Runtime, timer, or view writes during forward(). */
export function reserveEntityVisibilityPresentation(id: string, stage: IStageState, before: boolean) {
  return reserve(visibility, id, identity(stage, id), before);
}
export function reserveEntityVisualPresentation(
  id: string,
  expectedEntity: StageEntityStateV0,
  previousVisual: AttachmentEntityVisualState,
) {
  return reserve(visuals, id, entityBinding(expectedEntity), previousVisual);
}
export function protectAttachmentAddFailure(row: IAttachmentState): PresentationReservation {
  const id = rowId(row),
    token = Symbol(id);
  addFailures.set(id, { token, expected: cloneDeep(row) });
  return {
    release() {
      if (addFailures.get(id)?.token === token) addFailures.delete(id);
    },
  };
}
export function isAttachmentAddFailureCommandOwned(row: IAttachmentState): boolean {
  return isEqual(addFailures.get(rowId(row))?.expected, row);
}

/** Only bridge presentation is projected. Persisted view/calculation always retain their actual declarations. */
export function projectAttachmentCommandPresentation(stage: IStageState): IStageState {
  const projected = cloneDeep(stage);
  for (const [id, item] of visuals) {
    if (!isEqual(identity(stage, id), item.expected)) continue;
    const entity = projected.stageEntities.find((row) => row.entityId === id);
    if (!entity || entity.visualState.space !== item.value.space) continue;
    const visible = entity.visualState.visible;
    entity.visualState = { ...cloneDeep(item.value), visible };
    if (entity.attachmentLink)
      entity.attachmentLink.attachedLocalVisualState = { ...cloneDeep(item.value), space: 'local', visible };
  }
  for (const [id, item] of visibility) {
    if (!isEqual(identity(stage, id), item.expected)) continue;
    projected.attachments
      .filter((row) => rowId(row) === id)
      .forEach((row) => {
        row.visible = item.value;
      });
    const entity = projected.stageEntities.find((row) => row.entityId === id);
    if (entity) {
      entity.visualState.visible = item.value;
      if (entity.attachmentLink) entity.attachmentLink.attachedLocalVisualState.visible = item.value;
    }
  }
  return projected;
}

export function getAttachmentCommandPresentationCounts() {
  return { visibility: visibility.size, visuals: visuals.size, addFailures: addFailures.size };
}
