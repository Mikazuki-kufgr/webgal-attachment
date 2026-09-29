import cloneDeep from 'lodash/cloneDeep';
import type { ITransform, StageEntityStateV0 } from './stageInterface';

/** Only author boundaries convert coordinates; durable state and Runtime remain world based. */
function convert(entity: StageEntityStateV0 | undefined, transform: ITransform, direction: 1 | -1): ITransform {
  const result = cloneDeep(transform);
  const origin = entity && !entity.attachmentLink ? entity.source.freePositionOrigin : undefined;
  if (origin && result.position) {
    for (const axis of ['x', 'y'] as const) {
      // Sparse updates must not author the untouched axis (parallel animations and dragging).
      if (result.position[axis] !== undefined) result.position[axis]! += direction * origin[axis];
    }
  }
  return result;
}

export const toEntityWorldTransform = (entity: StageEntityStateV0 | undefined, transform: ITransform): ITransform =>
  convert(entity, transform, 1);
export const toEntityAuthorTransform = (entity: StageEntityStateV0 | undefined, transform: ITransform): ITransform =>
  convert(entity, transform, -1);
