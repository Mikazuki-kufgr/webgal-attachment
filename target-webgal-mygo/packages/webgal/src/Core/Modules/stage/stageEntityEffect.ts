import cloneDeep from 'lodash/cloneDeep';
import type { IEffect, IStageState, ITransform, StageEntityStateV0 } from './stageInterface';
import { baseTransform } from './stageInterface';
import {
  validateStageEntityStateInvariants,
  type StageEntityStateTransactionResult,
  type StageStateInvariantViolation,
} from './stageEntityStateTransaction';
import { validateStageEntityStateShape } from './stageEntityStateValidation';

const NATIVE_ONLY_FILM_KEYS = new Set(['oldFilm', 'dotFilm', 'reflectionFilm', 'glitchFilm', 'rgbFilm', 'godrayFilm']);
const TRANSFORM_KEYS = new Set([...Object.keys(baseTransform), 'skew']);

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function failure(stage: IStageState, message: string): StageEntityStateTransactionResult {
  return { applied: false, state: stage, violations: [{ code: 'ENTITY_EFFECT_INCOMPATIBLE', message }] };
}

function validateState(stage: IStageState): StageStateInvariantViolation[] {
  const shape = validateStageEntityStateShape(stage);
  return shape.length > 0 ? shape : validateStageEntityStateInvariants(stage);
}

function validatePatch(transform: unknown, previous: ITransform): string | undefined {
  if (!record(transform)) return 'Entity effect transform must be an object';
  for (const [key, value] of Object.entries(transform)) {
    if (!TRANSFORM_KEYS.has(key)) return `Unsupported entity transform field ${key}`;
    if (value === undefined) continue;
    if (key === 'position' || key === 'scale' || key === 'skew') {
      if (!record(value)) return `Entity transform ${key} must be a vector object`;
      for (const [axis, component] of Object.entries(value)) {
        if (axis !== 'x' && axis !== 'y') return `Unsupported entity transform ${key}.${axis}`;
        if (component !== undefined && !finite(component)) return `Entity transform ${key}.${axis} must be finite`;
      }
      // MyGO 3.2.0 deep-merges only position and scale. An explicit skew is a
      // whole-vector replacement, not a per-axis merge or an implicit reset.
      if (key === 'skew' && (!finite(value.x) || !finite(value.y))) {
        return 'An explicit entity skew must supply finite x and y';
      }
    } else if (!finite(value)) {
      return `Entity transform ${key} must be finite`;
    } else if (NATIVE_ONLY_FILM_KEYS.has(key) && value !== (previous[key as keyof ITransform] ?? 0)) {
      return `Entity transform ${key} has no attachment appearance mapping`;
    }
  }
  if (transform.alpha !== undefined && (!finite(transform.alpha) || transform.alpha < 0 || transform.alpha > 1)) {
    // Reject rather than clamping only visual.opacity and leaving effect.alpha
    // inconsistent, as the legacy reducer could do for a malformed caller.
    return 'Entity transform alpha must be between 0 and 1';
  }
  return undefined;
}

function mergeDefined<T extends object>(target: T, patch: object): T {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (target as Record<string, unknown>)[key] = cloneDeep(value);
  }
  return target;
}

function syncEntity(entity: StageEntityStateV0, transform: ITransform): void {
  // Invariants require complete entity effects even though native host effects
  // accept partial transforms. Materialize canonical defaults at this boundary.
  entity.visualState.position = { x: transform.position?.x ?? 0, y: transform.position?.y ?? 0 };
  entity.visualState.scale = { x: transform.scale?.x ?? 1, y: transform.scale?.y ?? 1 };
  entity.visualState.rotation = transform.rotation ?? 0;
  entity.visualState.opacity = transform.alpha ?? 1;
  if (transform.skew !== undefined) entity.visualState.skew = { x: transform.skew.x ?? 0, y: transform.skew.y ?? 0 };
  else delete entity.visualState.skew;

  const bevel = {
    strength: transform.bevel ?? 0,
    thickness: transform.bevelThickness ?? 0,
    rotation: transform.bevelRotation ?? 0,
    softness: transform.bevelSoftness ?? 0,
    color: { red: transform.bevelRed ?? 255, green: transform.bevelGreen ?? 255, blue: transform.bevelBlue ?? 255 },
  };
  const hasBevel =
    bevel.strength !== 0 ||
    bevel.thickness !== 0 ||
    bevel.rotation !== 0 ||
    bevel.softness !== 0 ||
    bevel.color.red !== 255 ||
    bevel.color.green !== 255 ||
    bevel.color.blue !== 255;
  const bloom = {
    strength: transform.bloom ?? 0,
    brightness: transform.bloomBrightness ?? 1,
    blur: transform.bloomBlur ?? 0,
    threshold: transform.bloomThreshold ?? 0,
  };
  const hasBloom = bloom.strength !== 0 || bloom.brightness !== 1 || bloom.blur !== 0 || bloom.threshold !== 0;
  const contrast = transform.contrast ?? 1;
  const saturation = transform.saturation ?? 1;
  const gamma = transform.gamma ?? 1;
  const shockwave = transform.shockwaveFilter ?? 0;
  const radiusAlpha = transform.radiusAlphaFilter ?? 0;
  entity.visualState.appearance = {
    blur: transform.blur ?? 0,
    brightness: transform.brightness ?? 1,
    color: { red: transform.colorRed ?? 255, green: transform.colorGreen ?? 255, blue: transform.colorBlue ?? 255 },
    ...(contrast === 1 ? {} : { contrast }),
    ...(saturation === 1 ? {} : { saturation }),
    ...(gamma === 1 ? {} : { gamma }),
    ...(hasBevel ? { bevel } : {}),
    ...(hasBloom ? { bloom } : {}),
    ...(shockwave === 0 ? {} : { shockwave }),
    ...(radiusAlpha === 0 ? {} : { radiusAlpha }),
  };
  if (entity.attachmentLink) {
    entity.attachmentLink.attachedLocalVisualState = { ...cloneDeep(entity.visualState), space: 'local' };
  }
}

/**
 * Atomic calculation-state-only effect adapter. Native figure/stage effects stay
 * in StageStateManager's upstream path. No Pixi, perform, view commit or storage
 * side effects are performed here, including when a postcondition is rejected.
 */
export function applyStageEntityEffectTransaction(
  stage: IStageState,
  payload: IEffect,
): StageEntityStateTransactionResult {
  try {
    const currentViolations = validateState(stage);
    if (currentViolations.length > 0) return { applied: false, state: stage, violations: currentViolations };
    if (!record(payload) || typeof payload.target !== 'string')
      return failure(stage, 'Entity effect target is invalid');
    const entityIndex = stage.stageEntities.findIndex((entity) => entity.entityId === payload.target);
    if (entityIndex < 0) return failure(stage, `No stage entity owns effect target ${payload.target}`);
    const effectIndex = stage.effects.findIndex((effect) => effect.target === payload.target);
    const previous = stage.effects[effectIndex]?.transform;
    if (!previous) return failure(stage, `Entity ${payload.target} has no synchronized effect`);
    const patchError = validatePatch(payload.transform, previous);
    if (patchError) return failure(stage, patchError);
    const patch = payload.transform!;

    const next = cloneDeep(stage);
    const transform = cloneDeep(previous);
    const position = mergeDefined({ ...previous.position }, patch.position ?? {});
    const scale = mergeDefined({ ...previous.scale }, patch.scale ?? {});
    mergeDefined(transform, patch);
    transform.position = position;
    transform.scale = scale;
    next.effects[effectIndex].transform = transform;
    syncEntity(next.stageEntities[entityIndex], transform);
    const violations = validateState(next);
    return violations.length > 0
      ? { applied: false, state: stage, violations }
      : { applied: true, state: next, violations: [] };
  } catch (error) {
    return failure(stage, error instanceof Error ? error.message : String(error));
  }
}
