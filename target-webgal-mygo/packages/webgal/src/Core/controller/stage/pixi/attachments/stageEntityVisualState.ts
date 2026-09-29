import type * as PIXI from 'pixi.js';
import { applyLocalOpacity, effectiveLocalOpacity } from '../effectiveOpacity';

export interface AttachmentEntityAppearanceState {
  blur: number;
  brightness: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  color: { red: number; green: number; blue: number };
  bevel?: {
    strength: number;
    thickness: number;
    rotation: number;
    softness: number;
    color: { red: number; green: number; blue: number };
  };
  bloom?: { strength: number; brightness: number; blur: number; threshold: number };
  shockwave?: number;
  radiusAlpha?: number;
}

export const DEFAULT_ATTACHMENT_ENTITY_APPEARANCE: AttachmentEntityAppearanceState = {
  blur: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  color: { red: 255, green: 255, blue: 255 },
  bevel: {
    strength: 0,
    thickness: 0,
    rotation: 0,
    softness: 0,
    color: { red: 255, green: 255, blue: 255 },
  },
  bloom: { strength: 0, brightness: 1, blur: 0, threshold: 0 },
  shockwave: 0,
  radiusAlpha: 0,
};

export const ATTACHMENT_VISUAL_CAPABILITY_MATRIX = Object.freeze({
  transform: Object.freeze({
    status: 'supported' as const,
    fields: Object.freeze(['position', 'scale', 'signedScale', 'rotation', 'skew', 'duration', 'easing']),
    implementation: 'shared-transform-performer',
  }),
  opacityVisibility: Object.freeze({
    status: 'supported' as const,
    implementation: 'logical-state-plus-effective-pixi-composition',
  }),
  colorBrightness: Object.freeze({
    status: 'supported' as const,
    fields: Object.freeze(['brightness', 'contrast', 'saturation', 'gamma', 'red', 'green', 'blue']),
    implementation: 'WebGALPixiContainer.adjustment',
  }),
  blur: Object.freeze({
    status: 'supported' as const,
    implementation: 'WebGALPixiContainer.blur',
  }),
  advancedFilters: Object.freeze({
    status: 'supported' as const,
    fields: Object.freeze(['bevel', 'bloom', 'shockwave', 'radiusAlpha']),
    implementation: 'WebGALPixiContainer filters',
  }),
  maskClip: Object.freeze({
    status: 'unsupported' as const,
    code: 'ATTACHMENT_VISUAL_CAPABILITY_UNSUPPORTED',
    reason: 'mask/clip ownership and lossless detach snapshots are not defined in MVP-3B',
  }),
});

export interface AttachmentEntityVisualState {
  space: 'local' | 'world';
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  skew?: { x: number; y: number };
  opacity: number;
  visible: boolean;
  appearance?: AttachmentEntityAppearanceState;
}

function record(value: unknown, path: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, fallback: number, path: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

// Parser diagnostics need the value, fallback, field path, and numeric bounds together.
// eslint-disable-next-line max-params
function ranged(value: unknown, fallback: number, path: string, min: number, max = Number.POSITIVE_INFINITY) {
  const result = finite(value, fallback, path);
  if (result < min || result > max) throw new TypeError(`${path} must be between ${min} and ${max}`);
  return result;
}

function boolean(value: unknown, fallback: boolean, path: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

function point(value: unknown, fallback: { x: number; y: number }, path: string) {
  if (value === undefined) return { ...fallback };
  const input = record(value, path);
  return { x: finite(input.x, fallback.x, `${path}.x`), y: finite(input.y, fallback.y, `${path}.y`) };
}

function rgb(value: unknown, fallback: { red: number; green: number; blue: number }, path: string) {
  if (value === undefined) return { ...fallback };
  const input = record(value, path);
  return {
    red: ranged(input.red, fallback.red, `${path}.red`, 0, 255),
    green: ranged(input.green, fallback.green, `${path}.green`, 0, 255),
    blue: ranged(input.blue, fallback.blue, `${path}.blue`, 0, 255),
  };
}

/** Strict, backward-compatible parser for Creator-authored local visual defaults. */
export function parseAttachmentEntityVisualState(
  value: unknown,
  path = 'initialVisualState',
): AttachmentEntityVisualState & { space: 'local' } {
  const input = record(value, path);
  if (input.space !== undefined && input.space !== 'local') {
    throw new TypeError(`${path}.space must be "local"`);
  }
  const appearanceInput = input.appearance === undefined ? {} : record(input.appearance, `${path}.appearance`);
  const bevelInput =
    appearanceInput.bevel === undefined ? {} : record(appearanceInput.bevel, `${path}.appearance.bevel`);
  const bloomInput =
    appearanceInput.bloom === undefined ? {} : record(appearanceInput.bloom, `${path}.appearance.bloom`);
  return {
    space: 'local',
    position: point(input.position, { x: 0, y: 0 }, `${path}.position`),
    scale: point(input.scale, { x: 1, y: 1 }, `${path}.scale`),
    rotation: finite(input.rotation, 0, `${path}.rotation`),
    skew: point(input.skew, { x: 0, y: 0 }, `${path}.skew`),
    opacity: ranged(input.opacity, 1, `${path}.opacity`, 0, 1),
    visible: boolean(input.visible, true, `${path}.visible`),
    appearance: {
      blur: ranged(appearanceInput.blur, 0, `${path}.appearance.blur`, 0),
      brightness: ranged(appearanceInput.brightness, 1, `${path}.appearance.brightness`, 0),
      contrast: ranged(appearanceInput.contrast, 1, `${path}.appearance.contrast`, 0),
      saturation: ranged(appearanceInput.saturation, 1, `${path}.appearance.saturation`, 0),
      gamma: ranged(appearanceInput.gamma, 1, `${path}.appearance.gamma`, Number.EPSILON),
      color: rgb(appearanceInput.color, { red: 255, green: 255, blue: 255 }, `${path}.appearance.color`),
      bevel: {
        strength: ranged(bevelInput.strength, 0, `${path}.appearance.bevel.strength`, 0),
        thickness: ranged(bevelInput.thickness, 0, `${path}.appearance.bevel.thickness`, 0),
        rotation: finite(bevelInput.rotation, 0, `${path}.appearance.bevel.rotation`),
        softness: ranged(bevelInput.softness, 0, `${path}.appearance.bevel.softness`, 0),
        color: rgb(bevelInput.color, { red: 255, green: 255, blue: 255 }, `${path}.appearance.bevel.color`),
      },
      bloom: {
        strength: ranged(bloomInput.strength, 0, `${path}.appearance.bloom.strength`, 0),
        brightness: ranged(bloomInput.brightness, 1, `${path}.appearance.bloom.brightness`, 0),
        blur: ranged(bloomInput.blur, 0, `${path}.appearance.bloom.blur`, 0),
        threshold: ranged(bloomInput.threshold, 0, `${path}.appearance.bloom.threshold`, 0),
      },
      shockwave: finite(appearanceInput.shockwave, 0, `${path}.appearance.shockwave`),
      radiusAlpha: finite(appearanceInput.radiusAlpha, 0, `${path}.appearance.radiusAlpha`),
    },
  };
}

type AppearanceContainer = PIXI.Container &
  Partial<{
    blur: number;
    brightness: number;
    contrast: number;
    saturation: number;
    gamma: number;
    colorRed: number;
    colorGreen: number;
    colorBlue: number;
    bevel: number;
    bevelThickness: number;
    bevelRotation: number;
    bevelSoftness: number;
    bevelRed: number;
    bevelGreen: number;
    bevelBlue: number;
    bloom: number;
    bloomBrightness: number;
    bloomBlur: number;
    bloomThreshold: number;
    shockwaveFilter: number;
    radiusAlphaFilter: number;
    containerFilters: Map<string, PIXI.Filter>;
  }>;

const attachmentAppearanceCache = new WeakMap<AppearanceContainer, string>();

function appearanceCacheKey(appearance: AttachmentEntityAppearanceState) {
  const bevel = appearance.bevel;
  const bloom = appearance.bloom;
  return [
    appearance.blur,
    appearance.brightness,
    appearance.contrast ?? 1,
    appearance.saturation ?? 1,
    appearance.gamma ?? 1,
    appearance.color.red,
    appearance.color.green,
    appearance.color.blue,
    bevel?.strength ?? 0,
    bevel?.thickness ?? 0,
    bevel?.rotation ?? 0,
    bevel?.softness ?? 0,
    bevel?.color.red ?? 255,
    bevel?.color.green ?? 255,
    bevel?.color.blue ?? 255,
    bloom?.strength ?? 0,
    bloom?.brightness ?? 1,
    bloom?.blur ?? 0,
    bloom?.threshold ?? 0,
    appearance.shockwave ?? 0,
    appearance.radiusAlpha ?? 0,
  ].join('|');
}

function readAppearance(container: AppearanceContainer): AttachmentEntityAppearanceState {
  return {
    blur: typeof container.blur === 'number' ? container.blur : 0,
    brightness: typeof container.brightness === 'number' ? container.brightness : 1,
    contrast: typeof container.contrast === 'number' ? container.contrast : 1,
    saturation: typeof container.saturation === 'number' ? container.saturation : 1,
    gamma: typeof container.gamma === 'number' ? container.gamma : 1,
    color: {
      red: typeof container.colorRed === 'number' ? container.colorRed : 255,
      green: typeof container.colorGreen === 'number' ? container.colorGreen : 255,
      blue: typeof container.colorBlue === 'number' ? container.colorBlue : 255,
    },
    bevel: {
      strength: typeof container.bevel === 'number' ? container.bevel : 0,
      thickness: typeof container.bevelThickness === 'number' ? container.bevelThickness : 0,
      rotation: typeof container.bevelRotation === 'number' ? container.bevelRotation : 0,
      softness: typeof container.bevelSoftness === 'number' ? container.bevelSoftness : 0,
      color: {
        red: typeof container.bevelRed === 'number' ? container.bevelRed : 255,
        green: typeof container.bevelGreen === 'number' ? container.bevelGreen : 255,
        blue: typeof container.bevelBlue === 'number' ? container.bevelBlue : 255,
      },
    },
    bloom: {
      strength: typeof container.bloom === 'number' ? container.bloom : 0,
      brightness: typeof container.bloomBrightness === 'number' ? container.bloomBrightness : 1,
      blur: typeof container.bloomBlur === 'number' ? container.bloomBlur : 0,
      threshold: typeof container.bloomThreshold === 'number' ? container.bloomThreshold : 0,
    },
    shockwave: typeof container.shockwaveFilter === 'number' ? container.shockwaveFilter : 0,
    radiusAlpha: typeof container.radiusAlphaFilter === 'number' ? container.radiusAlphaFilter : 0,
  };
}

// The explicit property map keeps every WebGAL transform field auditable and resettable.
// eslint-disable-next-line complexity
export function applyAttachmentEntityAppearance(
  container: AppearanceContainer,
  appearance: AttachmentEntityAppearanceState = DEFAULT_ATTACHMENT_ENTITY_APPEARANCE,
) {
  const cacheKey = appearanceCacheKey(appearance);
  if (attachmentAppearanceCache.get(container) === cacheKey) return;
  if ('blur' in container) container.blur = appearance.blur;
  if ('brightness' in container) container.brightness = appearance.brightness;
  if ('contrast' in container) container.contrast = appearance.contrast ?? 1;
  if ('saturation' in container) container.saturation = appearance.saturation ?? 1;
  if ('gamma' in container) container.gamma = appearance.gamma ?? 1;
  if ('colorRed' in container) container.colorRed = appearance.color.red;
  if ('colorGreen' in container) container.colorGreen = appearance.color.green;
  if ('colorBlue' in container) container.colorBlue = appearance.color.blue;
  const bevel = appearance.bevel;
  if ('bevel' in container) container.bevel = bevel?.strength ?? 0;
  if ('bevelThickness' in container) container.bevelThickness = bevel?.thickness ?? 0;
  if ('bevelRotation' in container) container.bevelRotation = bevel?.rotation ?? 0;
  if ('bevelSoftness' in container) container.bevelSoftness = bevel?.softness ?? 0;
  if ('bevelRed' in container) container.bevelRed = bevel?.color.red ?? 255;
  if ('bevelGreen' in container) container.bevelGreen = bevel?.color.green ?? 255;
  if ('bevelBlue' in container) container.bevelBlue = bevel?.color.blue ?? 255;
  const bloom = appearance.bloom;
  if ('bloom' in container) container.bloom = bloom?.strength ?? 0;
  if ('bloomBrightness' in container) container.bloomBrightness = bloom?.brightness ?? 1;
  if ('bloomBlur' in container) container.bloomBlur = bloom?.blur ?? 0;
  if ('bloomThreshold' in container) container.bloomThreshold = bloom?.threshold ?? 0;
  if ('shockwaveFilter' in container) container.shockwaveFilter = appearance.shockwave ?? 0;
  if ('radiusAlphaFilter' in container) container.radiusAlphaFilter = appearance.radiusAlpha ?? 0;
  attachmentAppearanceCache.set(container, cacheKey);
}

export function syncAttachmentEntityAppearance(source: AppearanceContainer, target: AppearanceContainer) {
  applyAttachmentEntityAppearance(target, readAppearance(source));
}

export function destroyAttachmentEntityAppearance(container: AppearanceContainer) {
  attachmentAppearanceCache.delete(container);
  const owned = container.containerFilters;
  if (!owned) return 0;
  const filters = [...owned.values()];
  for (const filter of filters) filter.destroy();
  owned.clear();
  container.filters = null;
  return filters.length;
}

export function readAttachmentEntityVisualState(
  container: PIXI.Container,
  space: AttachmentEntityVisualState['space'],
): AttachmentEntityVisualState {
  return {
    space,
    position: { x: container.x, y: container.y },
    scale: { x: container.scale.x, y: container.scale.y },
    rotation: container.rotation,
    skew: { x: container.skew.x, y: container.skew.y },
    opacity: effectiveLocalOpacity(container),
    visible: container.visible,
    appearance: readAppearance(container),
  };
}

export function applyAttachmentEntityVisualState(container: PIXI.Container, state: AttachmentEntityVisualState) {
  container.position.set(state.position.x, state.position.y);
  container.scale.set(state.scale.x, state.scale.y);
  container.rotation = state.rotation;
  container.skew.set(state.skew?.x ?? 0, state.skew?.y ?? 0);
  applyLocalOpacity(container, state.opacity);
  container.visible = state.visible;
  applyAttachmentEntityAppearance(container, state.appearance);
}

export function cloneAttachmentEntityVisualState(state: AttachmentEntityVisualState): AttachmentEntityVisualState {
  return {
    ...state,
    position: { ...state.position },
    scale: { ...state.scale },
    ...(state.skew ? { skew: { ...state.skew } } : {}),
    ...(state.appearance
      ? {
          appearance: {
            ...state.appearance,
            color: { ...state.appearance.color },
            ...(state.appearance.bevel
              ? {
                  bevel: {
                    ...state.appearance.bevel,
                    color: { ...state.appearance.bevel.color },
                  },
                }
              : {}),
            ...(state.appearance.bloom ? { bloom: { ...state.appearance.bloom } } : {}),
          },
        }
      : {}),
  };
}
