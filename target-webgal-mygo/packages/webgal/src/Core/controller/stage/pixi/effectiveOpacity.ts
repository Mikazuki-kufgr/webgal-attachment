import type * as PIXI from 'pixi.js';

type OpacityTarget = PIXI.DisplayObject & { alphaFilterVal?: number };

/** MyGO 3.2.0's native AlphaFilter is not included in Pixi worldAlpha. */
export function ownOpacityFilter(displayObject: PIXI.DisplayObject): number {
  const target = displayObject as OpacityTarget;
  return 'alphaFilterVal' in target ? target.alphaFilterVal! : 1;
}

/** The entity's local opacity, excluding all inherited figure/stage gates. */
export function effectiveLocalOpacity(displayObject: PIXI.DisplayObject): number {
  return displayObject.alpha * ownOpacityFilter(displayObject);
}

/**
 * Sample the scalar opacity contract of the locked host: worldAlpha already
 * contains every ordinary alpha, so multiply only the native AlphaFilter
 * factor at each ancestry node. This is not a GPU/pixel-compositing assertion.
 * Callers must publish current-frame transforms before sampling worldAlpha.
 */
export function effectiveWorldOpacity(displayObject: PIXI.DisplayObject): number {
  let opacity = displayObject.worldAlpha;
  let current: PIXI.DisplayObject | null = displayObject;
  while (current) {
    opacity *= ownOpacityFilter(current);
    current = current.parent;
  }
  return opacity;
}

/**
 * A plugin-owned state write replaces local opacity, including a prior native
 * transform's AlphaFilter value. It does not change the native renderer or any
 * ancestor's filter. Normalizing to one channel prevents repeated snapshots
 * and proxy synchronization from multiplying the previous filter twice.
 */
export function applyLocalOpacity(displayObject: PIXI.DisplayObject, opacity: number) {
  const target = displayObject as OpacityTarget;
  if ('alphaFilterVal' in target) target.alphaFilterVal = 1;
  displayObject.alpha = opacity;
}
