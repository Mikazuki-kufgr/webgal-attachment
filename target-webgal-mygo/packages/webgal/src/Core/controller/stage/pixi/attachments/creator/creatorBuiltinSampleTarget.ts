/**
 * A bundled sample is a complete attachment template. Retargeting it to the
 * figure currently shown in Creator may replace the model Profile identity,
 * but must not replace the sample's semantic anchor or placement with state
 * left behind by the previously edited attachment.
 */
import type { Live2DModelProfile } from '../profileTypes';

/** Same outfit can have several different anchors. Preserve calibrated identity
 * when its original Profile describes the exact same model; never compensate by
 * guessing pixel offsets, and never reuse it for a different outfit/geometry. */
export function calibratedSampleProfileId(
  sampleProfileId: string,
  currentProfileId: string,
  profiles: ReadonlyMap<string, Live2DModelProfile>,
) {
  const sample = profiles.get(sampleProfileId), current = profiles.get(currentProfileId);
  if (sample && current && sample.characterId === current.characterId && sample.modelId === current.modelId &&
      sample.modelPath.replace(/^\.\//, '') === current.modelPath.replace(/^\.\//, '') &&
      sample.fingerprint.mocSha256 === current.fingerprint.mocSha256 &&
      sample.fingerprint.drawableCount === current.fingerprint.drawableCount) return sampleProfileId;
  return currentProfileId;
}

export function retargetBuiltinSampleDraft<T extends { modelProfileId: string }>(
  sampleDraft: T,
  currentProfileId: string,
): T {
  return { ...sampleDraft, modelProfileId: currentProfileId };
}
