import cloneDeep from 'lodash/cloneDeep';
import { baseTransform, type ITransform } from '@/Core/Modules/stage/stageInterface';
import type { AttachmentEntityVisualState } from '@/Core/controller/stage/pixi/attachments/stageEntityVisualState';

/** The same persisted appearance vocabulary as StageEntityEffect, without a Pixi dependency. */
export function entityVisualToTransform(visual: AttachmentEntityVisualState): ITransform {
  const a = visual.appearance;
  return {
    ...cloneDeep(baseTransform),
    position: { ...visual.position },
    scale: { ...visual.scale },
    rotation: visual.rotation,
    skew: { ...(visual.skew ?? { x: 0, y: 0 }) },
    alpha: visual.opacity,
    blur: a?.blur ?? 0,
    brightness: a?.brightness ?? 1,
    contrast: a?.contrast ?? 1,
    saturation: a?.saturation ?? 1,
    gamma: a?.gamma ?? 1,
    colorRed: a?.color.red ?? 255,
    colorGreen: a?.color.green ?? 255,
    colorBlue: a?.color.blue ?? 255,
    bevel: a?.bevel?.strength ?? 0,
    bevelThickness: a?.bevel?.thickness ?? 0,
    bevelRotation: a?.bevel?.rotation ?? 0,
    bevelSoftness: a?.bevel?.softness ?? 0,
    bevelRed: a?.bevel?.color.red ?? 255,
    bevelGreen: a?.bevel?.color.green ?? 255,
    bevelBlue: a?.bevel?.color.blue ?? 255,
    bloom: a?.bloom?.strength ?? 0,
    bloomBrightness: a?.bloom?.brightness ?? 1,
    bloomBlur: a?.bloom?.blur ?? 0,
    bloomThreshold: a?.bloom?.threshold ?? 0,
    shockwaveFilter: a?.shockwave ?? 0,
    radiusAlphaFilter: a?.radiusAlpha ?? 0,
  };
}

export function transformToEntityVisual(
  transform: ITransform,
  previous: AttachmentEntityVisualState,
): AttachmentEntityVisualState {
  return {
    ...cloneDeep(previous),
    position: { x: transform.position?.x ?? 0, y: transform.position?.y ?? 0 },
    scale: { x: transform.scale?.x ?? 1, y: transform.scale?.y ?? 1 },
    rotation: transform.rotation ?? 0,
    skew: { x: transform.skew?.x ?? 0, y: transform.skew?.y ?? 0 },
    opacity: transform.alpha ?? 1,
    appearance: {
      blur: transform.blur ?? 0,
      brightness: transform.brightness ?? 1,
      contrast: transform.contrast ?? 1,
      saturation: transform.saturation ?? 1,
      gamma: transform.gamma ?? 1,
      color: { red: transform.colorRed ?? 255, green: transform.colorGreen ?? 255, blue: transform.colorBlue ?? 255 },
      bevel: {
        strength: transform.bevel ?? 0,
        thickness: transform.bevelThickness ?? 0,
        rotation: transform.bevelRotation ?? 0,
        softness: transform.bevelSoftness ?? 0,
        color: { red: transform.bevelRed ?? 255, green: transform.bevelGreen ?? 255, blue: transform.bevelBlue ?? 255 },
      },
      bloom: {
        strength: transform.bloom ?? 0,
        brightness: transform.bloomBrightness ?? 1,
        blur: transform.bloomBlur ?? 0,
        threshold: transform.bloomThreshold ?? 0,
      },
      shockwave: transform.shockwaveFilter ?? 0,
      radiusAlpha: transform.radiusAlphaFilter ?? 0,
    },
  };
}

export function mergeEntityTransform(previous: ITransform, patch: ITransform): ITransform {
  return {
    ...cloneDeep(previous),
    ...cloneDeep(patch),
    position: { ...previous.position, ...patch.position },
    scale: { ...previous.scale, ...patch.scale },
  };
}

/** Only authored axes are animated in parallel/ignoreDefault mode. No skew component is silently dropped. */
export function interpolateEntityTransform(
  from: ITransform,
  to: ITransform,
  patch: ITransform,
  progress: number,
): ITransform {
  const result: Record<string, unknown> = {};
  const source = from as Record<string, unknown>,
    destination = to as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (key === 'position' || key === 'scale' || key === 'skew') {
      const vector: Record<string, number> = {};
      for (const axis of Object.keys(patch[key] ?? {})) {
        const start = (source[key] as Record<string, number> | undefined)?.[axis] ?? (key === 'scale' ? 1 : 0);
        const end = (destination[key] as Record<string, number> | undefined)?.[axis] ?? start;
        vector[axis] = start + (end - start) * progress;
      }
      result[key] = vector;
    } else {
      const start = typeof source[key] === 'number' ? (source[key] as number) : 0;
      const end = typeof destination[key] === 'number' ? (destination[key] as number) : start;
      let value = start + (end - start) * progress;
      // Back/bounce easing may overshoot; persisted/raster appearance ranges remain valid.
      if (key === 'alpha') value = Math.max(0, Math.min(1, value));
      if (['colorRed', 'colorGreen', 'colorBlue', 'bevelRed', 'bevelGreen', 'bevelBlue'].includes(key))
        value = Math.max(0, Math.min(255, value));
      if (
        [
          'blur',
          'brightness',
          'contrast',
          'saturation',
          'bevel',
          'bevelThickness',
          'bevelSoftness',
          'bloom',
          'bloomBrightness',
          'bloomBlur',
          'bloomThreshold',
        ].includes(key)
      )
        value = Math.max(0, value);
      if (key === 'gamma') value = Math.max(Number.EPSILON, value);
      result[key] = value;
    }
  }
  return result as ITransform;
}
