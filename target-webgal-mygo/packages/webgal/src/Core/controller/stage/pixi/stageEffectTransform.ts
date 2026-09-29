import { baseTransform } from '@/Core/Modules/stage/stageInterface';
import type { ITransform } from '@/Core/Modules/stage/stageInterface';
import { isUndefined, omitBy } from 'lodash';
import type { WebGALPixiContainer } from './WebGALPixiContainer';

type PixiTransformPatch = ITransform & {
  x?: number;
  y?: number;
  alphaFilterVal?: number;
  /** Only Runtime-owned external attachment hosts opt into serializable local opacity. */
  attachmentLocalAlpha?: boolean;
};

export function assignPixiTransform<T extends PixiTransformPatch>(
  target: T | undefined,
  source?: PixiTransformPatch,
  convertAlpha = true,
) {
  if (!target || !source) return;
  const targetScale = target.scale;
  const targetPosition = target.position;
  const targetSkew = target.skew;
  if (targetScale) Object.assign(targetScale, omitBy(source.scale || {}, isUndefined));
  if (targetPosition) Object.assign(targetPosition, omitBy(source.position || {}, isUndefined));
  if (targetSkew) Object.assign(targetSkew, omitBy(source.skew || {}, isUndefined));
  // PIXI vector setters copy every axis. Passing the partial source again
  // would erase the omitted axes we just preserved on the original vectors.
  Object.assign(
    target,
    omitBy(
      {
        ...source,
        scale: targetScale,
        position: targetPosition,
        ...(targetSkew ? { skew: targetSkew } : {}),
      },
      isUndefined,
    ),
  );
  target.scale = targetScale;
  target.position = targetPosition;
  if (targetSkew) target.skew = targetSkew;
  if (convertAlpha) {
    const sourceAlpha = source.alpha;
    if (sourceAlpha !== undefined) {
      if (target.attachmentLocalAlpha) {
        // Attachment state snapshots use local opacity; never compose the same
        // effect once as container alpha and again through the host AlphaFilter.
        target.alpha = sourceAlpha;
        target.alphaFilterVal = 1;
      } else {
        target.alpha = 1;
        target.alphaFilterVal = sourceAlpha;
      }
    }
  }
}

function toPixiTransformPatch(transform: ITransform): PixiTransformPatch {
  const { position, ...rest } = transform;
  return omitBy({ ...rest, x: position?.x, y: position?.y }, isUndefined);
}

export function applyTransformToPixiContainer(
  container: WebGALPixiContainer | null | undefined,
  transform?: ITransform,
) {
  if (!container) return;
  // A committed effect is a state snapshot, whereas assignPixiTransform is a
  // partial patch. Old snapshots omit skew; clear it when reusing a container.
  const state = transform ?? baseTransform;
  assignPixiTransform(container, toPixiTransformPatch({ ...state, skew: { x: 0, y: 0, ...state.skew } }));
}
