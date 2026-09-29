import type { ITransform } from '@/Core/Modules/stage/stageInterface';

/** Animation-frame controls are transient and must never enter saved stage effects. */
export function durableStageTransform(endpoint: unknown): ITransform {
  if (endpoint === null || typeof endpoint !== 'object' || Array.isArray(endpoint)) return {};
  const { duration: _duration, ease: _ease, ...transform } = endpoint as Record<string, unknown>;
  return transform as ITransform;
}
