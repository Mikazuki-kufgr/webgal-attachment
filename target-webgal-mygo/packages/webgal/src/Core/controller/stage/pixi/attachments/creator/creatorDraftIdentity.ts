import type { CreatorPackageAdaptation } from './creatorPackageBuilder';

/** Save As New changes portable identities together, keeping all Profile/anchor adaptations and one image set. */
export function rekeyCreatorAdaptations(rows: readonly CreatorPackageAdaptation[], identity: {
  presetId: string; attachmentDefinitionId: string;
}): CreatorPackageAdaptation[] {
  return rows.map((row) => {
    const copy = structuredClone(row);
    copy.preset.presetId = identity.presetId;
    copy.preset.attachmentAssetId = identity.attachmentDefinitionId;
    copy.preset.approvalStatus = 'candidate';
    return copy;
  });
}
