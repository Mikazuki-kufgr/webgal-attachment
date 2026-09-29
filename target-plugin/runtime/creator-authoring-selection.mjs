import { portableAdaptations } from './creator-contract.generated.mjs';

// Manifest selection is authoring metadata, never a Runtime fallback. Legacy
// manifests are usable only when every binding still agrees with the document.
export function authoringSelection(document, manifest) {
  if (manifest?.presetId !== portableAdaptations(document)[0]?.preset?.presetId ||
      manifest?.attachmentDefinitionId !== document.asset?.attachmentAssetId) return undefined;
  const rows = portableAdaptations(document).filter(row =>
    row.modelProfile.modelProfileId === manifest.modelProfileId &&
    row.preset.modelProfileId === manifest.modelProfileId &&
    row.preset.anchorName === manifest.anchorName &&
    row.modelProfile.anchors.some(anchor => anchor.name === manifest.anchorName));
  return rows.length === 1 ? { modelProfileId: manifest.modelProfileId, anchorName: manifest.anchorName } : undefined;
}

export function repairAuthoringSelection(document, manifest) {
  const selected = authoringSelection(document, manifest);
  if (!selected) {
    delete manifest.modelProfileId; delete manifest.anchorName; delete manifest.commandSnippet;
    manifest.authoringSelectionState = 'SELECTION_REQUIRED';
    return;
  }
  // Do not retain a stale or user-injected command. All values below come from
  // the validated package, using a deterministic, safe preview instance.
  manifest.commandSnippet = `attachment:add -figure=authoring-model -id=${manifest.presetId.slice(3)} -config=${manifest.presetId} -profile=${selected.modelProfileId} -anchor=${selected.anchorName} -slot=${document.asset.slot} -duration=500 -ease=easeInOut;`;
  delete manifest.authoringSelectionState;
}
