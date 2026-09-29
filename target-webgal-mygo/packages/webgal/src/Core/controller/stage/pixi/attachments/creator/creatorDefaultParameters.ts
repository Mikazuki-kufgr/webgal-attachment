import { parseAttachmentPlacementPreset } from '../profileLoader';
import type { AttachmentPlacementPreset } from '../profileTypes';
import { draftFromProjectPreset } from './creatorDraft';
import type { CreatorDraft } from './creatorTypes';

export type CreatorDefaultParameters = Pick<
  AttachmentPlacementPreset,
  'anchorName' | 'fit' | 'placement' | 'initialVisualState'
>;
export function defaultParametersFromPreset(preset: AttachmentPlacementPreset): CreatorDefaultParameters {
  return structuredClone({
    anchorName: preset.anchorName,
    fit: preset.fit,
    placement: preset.placement,
    initialVisualState: preset.initialVisualState,
  });
}
export function defaultParametersFromDraft(draft: CreatorDraft): CreatorDefaultParameters {
  const { scaleMode, ...placement } = draft.placement;
  return structuredClone({
    anchorName: draft.anchorName,
    fit: { scaleMode },
    placement,
    initialVisualState: draft.visualState,
  });
}
export function parseCreatorDefaultParameters(
  raw: unknown,
  fallback: AttachmentPlacementPreset,
): CreatorDefaultParameters {
  if (raw === undefined) return defaultParametersFromPreset(fallback);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('CREATOR_DEFAULT_PARAMETERS_INVALID');
  const row = raw as Record<string, unknown>;
  return defaultParametersFromPreset(
    parseAttachmentPlacementPreset(
      {
        ...fallback,
        anchorName: row.anchorName,
        fit: row.fit,
        placement: row.placement,
        initialVisualState: row.initialVisualState,
      },
      'creator://default-parameters',
    ),
  );
}
export function applyCreatorDefaultParameters(draft: CreatorDraft, defaults: CreatorDefaultParameters): CreatorDraft {
  const restored = draftFromProjectPreset(
    {
      schema: 'webgal-live2d-attachment-preset',
      schemaVersion: 2,
      presetId: draft.presetId,
      attachmentAssetId: draft.attachmentDefinitionId,
      modelProfileId: draft.modelProfileId,
      approvalStatus: 'candidate',
      ...defaults,
    },
    draft,
  );
  return {
    ...draft,
    anchorName: restored.anchorName,
    placement: restored.placement,
    visualState: restored.visualState,
    handBinding: undefined,
    approvalStatus: 'candidate',
  };
}
