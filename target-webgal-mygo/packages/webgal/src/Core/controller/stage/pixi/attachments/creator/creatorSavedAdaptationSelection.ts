import type { CreatorPackageAdaptation } from './creatorPackageBuilder';
import { migrateLegacyProfileAnchorName } from '../profileTypes';

/** UI list order is not identity. Resolve the Profile selected at click time
 * against the newly loaded document, even if another writer reordered it.
 */
export function selectCreatorSavedAdaptation(
  adaptations: readonly CreatorPackageAdaptation[],
  requestedProfileId: string,
  requestedAnchorName?: string,
) {
  if (
    typeof requestedProfileId !== 'string' ||
    !requestedProfileId ||
    requestedProfileId.trim() !== requestedProfileId
  ) {
    throw new Error('CREATOR_EXPLICIT_ADAPTATION_REQUIRED');
  }
  const seen = new Set<string>();
  let selectedIndex = -1;
  for (let index = 0; index < adaptations.length; index++) {
    const row = adaptations[index];
    const id = row.modelProfile.modelProfileId;
    if (!id || row.preset.modelProfileId !== id) throw new Error('CREATOR_SAVED_ATTACHMENT_ADAPTATION_BINDING_INVALID');
    const pair = JSON.stringify([id, migrateLegacyProfileAnchorName(row.preset.anchorName)]);
    if (seen.has(pair)) throw new Error('CREATOR_SAVED_ATTACHMENT_ADAPTATION_ID_DUPLICATE');
    seen.add(pair);
    if (id === requestedProfileId &&
      (requestedAnchorName === undefined || migrateLegacyProfileAnchorName(row.preset.anchorName) === migrateLegacyProfileAnchorName(requestedAnchorName))) {
      if (selectedIndex >= 0) throw new Error('CREATOR_SAVED_ATTACHMENT_ADAPTATION_AMBIGUOUS:choose an anchor');
      selectedIndex = index;
    }
  }
  if (selectedIndex < 0) throw new Error(`CREATOR_SAVED_ATTACHMENT_ADAPTATION_NOT_FOUND:${requestedProfileId}`);
  return { adaptation: adaptations[selectedIndex], index: selectedIndex };
}
