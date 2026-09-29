import type { CreatorDraft } from './creatorTypes';

export function creatorAdvancedEffectsActive(visualState: CreatorDraft['visualState']): boolean {
  const appearance = visualState.appearance;
  const bevel = appearance?.bevel;
  const bloom = appearance?.bloom;
  return Boolean(
    (visualState.skew?.x ?? 0) !== 0 ||
      (visualState.skew?.y ?? 0) !== 0 ||
      (appearance?.blur ?? 0) !== 0 ||
      (appearance?.brightness ?? 1) !== 1 ||
      (appearance?.contrast ?? 1) !== 1 ||
      (appearance?.saturation ?? 1) !== 1 ||
      (appearance?.gamma ?? 1) !== 1 ||
      (appearance?.color.red ?? 255) !== 255 ||
      (appearance?.color.green ?? 255) !== 255 ||
      (appearance?.color.blue ?? 255) !== 255 ||
      (bevel?.strength ?? 0) !== 0 ||
      (bevel?.thickness ?? 0) !== 0 ||
      (bevel?.rotation ?? 0) !== 0 ||
      (bevel?.softness ?? 0) !== 0 ||
      (bevel?.color.red ?? 255) !== 255 ||
      (bevel?.color.green ?? 255) !== 255 ||
      (bevel?.color.blue ?? 255) !== 255 ||
      (bloom?.strength ?? 0) !== 0 ||
      (bloom?.brightness ?? 1) !== 1 ||
      (bloom?.blur ?? 0) !== 0 ||
      (bloom?.threshold ?? 0) !== 0 ||
      (appearance?.shockwave ?? 0) !== 0 ||
      (appearance?.radiusAlpha ?? 0) !== 0,
  );
}
