import type { CreatorPackageAdaptation } from './creatorPackageBuilder';
import type { Live2DModelProfile } from '../profileTypes';
import { profileMatchesModelPath } from './creatorDraft';

/** The outfit picker may use a bundled Profile while a saved attachment owns a custom Profile for the same model. */
export function creatorTargetProfile(
  selected: Live2DModelProfile,
  adaptations: readonly CreatorPackageAdaptation[],
): Live2DModelProfile {
  const sameModel = adaptations.filter(row => profileMatchesModelPath(row.modelProfile, selected.modelPath));
  const exact = sameModel.filter(row => row.modelProfile.modelProfileId === selected.modelProfileId);
  if (exact.length === 1) return exact[0].modelProfile;
  if (exact.length > 1) return selected;
  if (sameModel.length === 1) return sameModel[0].modelProfile;
  if (sameModel.length > 1)
    throw new Error('这套立绘有多套已保存的附件适配，请在已保存附件列表明确选择要原样编辑的适配。');
  return selected;
}

/** A single saved target adaptation outranks the outgoing figure's anchor. */
export function creatorTargetAnchor(
  profile: Live2DModelProfile,
  targetRows: readonly CreatorPackageAdaptation[],
  outgoingAnchor: string,
  explicitAnchor?: string,
): string | undefined {
  if (explicitAnchor !== undefined) return explicitAnchor;
  if (targetRows.length === 1) return targetRows[0].preset.anchorName;
  if (targetRows.length > 1)
    return targetRows.some(row => row.preset.anchorName === outgoingAnchor) ? outgoingAnchor : undefined;
  return profile.anchors.some(anchor => anchor.name === outgoingAnchor)
    ? outgoingAnchor : profile.anchors[0]?.name;
}
