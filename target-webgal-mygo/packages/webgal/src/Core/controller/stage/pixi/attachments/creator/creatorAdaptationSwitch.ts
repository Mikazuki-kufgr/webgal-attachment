import { draftFromProjectPreset, cloneCreatorDraft } from './creatorDraft';
import type { CreatorPackageAdaptation } from './creatorPackageBuilder';
import type { CreatorDraft } from './creatorTypes';
import type { Live2DModelProfile } from '../profileTypes';
import { migrateLegacyProfileAnchorName } from '../profileTypes';
import { applyCreatorDefaultParameters, type CreatorDefaultParameters } from './creatorDefaultParameters';

/** Keep content identity and images shared; only restore target-specific state. */
export function switchCreatorAdaptation(
  current: CreatorDraft,
  adaptations: readonly CreatorPackageAdaptation[],
  target: Live2DModelProfile,
  allowNew = false,
  defaults?: CreatorDefaultParameters,
  targetAnchorName?: string,
): { draft: CreatorDraft; created: boolean } {
  const requestedAnchor = targetAnchorName ?? (current.modelProfileId === target.modelProfileId ? current.anchorName : undefined);
  const matches = adaptations.filter((row) => row.modelProfile.modelProfileId === target.modelProfileId &&
    (requestedAnchor === undefined || migrateLegacyProfileAnchorName(row.preset.anchorName) === migrateLegacyProfileAnchorName(requestedAnchor)));
  if (matches.length > 1) throw new Error('CREATOR_ADAPTATION_AMBIGUOUS');
  const row = matches[0];
  if (!row && !requestedAnchor && current.modelProfileId === target.modelProfileId)
    return { draft: cloneCreatorDraft(current), created: false };
  if (!row && !allowNew) throw new Error('CREATOR_ADAPTATION_REQUIRED');
  if (
    row &&
    (row.preset.presetId !== current.presetId || row.preset.attachmentAssetId !== current.attachmentDefinitionId)
  ) {
    throw new Error('CREATOR_ADAPTATION_CONTENT_MISMATCH');
  }
  const restored = row
    ? draftFromProjectPreset(row.preset, current)
    : defaults
    ? applyCreatorDefaultParameters(current, defaults)
    : cloneCreatorDraft(current);
  return {
    draft: {
      ...cloneCreatorDraft(current),
      modelProfileId: target.modelProfileId,
      anchorName: target.anchors.some((anchor) => anchor.name === (requestedAnchor ?? restored.anchorName)) ? (requestedAnchor ?? restored.anchorName) : '',
      placement: restored.placement,
      visualState: restored.visualState,
      handBinding: row ? restored.handBinding : undefined,
      approvalStatus: row ? restored.approvalStatus : 'candidate',
    },
    created: !row,
  };
}
