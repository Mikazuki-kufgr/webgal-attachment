import type { Live2DModelProfile } from '../profileTypes';

/** One ordinary outfit per concrete model path; alternate Profiles remain in advanced controls. */
export function creatorCharacterOutfits(
  profiles: readonly Live2DModelProfile[],
  available: ReadonlySet<string>,
  characterId: string,
) {
  const models = new Map<string, Live2DModelProfile>();
  for (const profile of profiles) {
    if (profile.characterId !== characterId || !available.has(profile.modelProfileId)) continue;
    const previous = models.get(profile.modelPath);
    if (
      !previous ||
      profile.anchors.length > previous.anchors.length ||
      (profile.anchors.length === previous.anchors.length && profile.modelProfileId < previous.modelProfileId)
    )
      models.set(profile.modelPath, profile);
  }
  return [...models.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}
