import type { Live2DModel } from 'pixi-live2d-display-webgal';
import type { DisplayObject } from 'pixi.js';

interface LegacyMouthCoreModel {
  setParamFloat(id: string | number, value: number, weight?: number): unknown;
}

interface Cubism4MouthCoreModel {
  setParameterValueById(parameterId: string, value: number, weight?: number): void;
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Attachment layers are ordinary Pixi containers, so Live2D-only operations
 * must first narrow a wrapper child back to the actual Live2D model.
 */
export function isLive2DModelDisplayObject(displayObject: DisplayObject): displayObject is Live2DModel {
  const candidate = displayObject as unknown as Partial<Live2DModel>;
  return (
    candidate.internalModel !== undefined &&
    typeof candidate.motion === 'function' &&
    typeof candidate.expression === 'function'
  );
}

export function isLegacyMouthCoreModel(coreModel: unknown): coreModel is LegacyMouthCoreModel {
  return isObject(coreModel) && typeof coreModel.setParamFloat === 'function';
}

export function isCubism4MouthCoreModel(coreModel: unknown): coreModel is Cubism4MouthCoreModel {
  return isObject(coreModel) && typeof coreModel.setParameterValueById === 'function';
}
