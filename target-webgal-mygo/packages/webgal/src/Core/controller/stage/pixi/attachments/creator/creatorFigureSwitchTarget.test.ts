import { describe, expect, it } from 'vitest';
import { creatorTargetAnchor, creatorTargetProfile } from './creatorFigureSwitchTarget';
import { switchCreatorAdaptation } from './creatorAdaptationSwitch';
import { createBlankCreatorDraft } from './creatorDraft';
import type { CreatorPackageAdaptation } from './creatorPackageBuilder';
import type { Live2DModelProfile } from '../profileTypes';

const target = {
  modelProfileId: 'outfit-b', modelPath: 'game/figure/anon/b/model.json',
  anchors: [{ name: 'head' }, { name: 'hand' }],
} as Live2DModelProfile;
function saved(anchorName: string, x: number) {
  const draft = createBlankCreatorDraft(2);
  draft.placement.offset.x = x;
  return {
    modelProfile: target,
    preset: {
      schema: 'webgal-live2d-attachment-preset', schemaVersion: 1,
      approvalStatus: 'candidate',
      modelProfileId: target.modelProfileId, anchorName,
      presetId: 'v2/hat', attachmentAssetId: 'hat',
      placement: draft.placement,
      fit: { scaleMode: draft.placement.scaleMode },
    },
  } as CreatorPackageAdaptation;
}

describe('outfit switch target adaptation', () => {
  it('restores the only saved target adaptation even when the outgoing anchor is also supported', () => {
    const draft = createBlankCreatorDraft(1);
    draft.modelProfileId = 'outfit-a'; draft.anchorName = 'head';
    draft.presetId = 'v2/hat'; draft.attachmentDefinitionId = 'hat';
    const row = saved('hand', 78);
    const anchor = creatorTargetAnchor(target, [row], 'head');
    expect(anchor).toBe('hand');
    const result = switchCreatorAdaptation(draft, [row], target, true, undefined, anchor);
    expect(result.created).toBe(false);
    expect(result.draft.anchorName).toBe('hand');
    expect(result.draft.placement.offset.x).toBe(78);
  });
  it('uses an outgoing supported anchor only when no target adaptation exists', () => {
    expect(creatorTargetAnchor(target, [], 'head')).toBe('head');
    expect(creatorTargetAnchor(target, [], 'missing')).toBe('head');
    expect(creatorTargetAnchor(target, [saved('hand', 78)], 'head', 'head')).toBe('head');
  });
  it('restores a unique saved custom Profile for the selected outfit model path', () => {
    const custom = { ...target, modelProfileId: 'user-hand-profile', anchors: [{ name: 'user.hand-state-contact' }] } as Live2DModelProfile;
    const row = { ...saved('user.hand-state-contact', 50), modelProfile: custom } as CreatorPackageAdaptation;
    row.preset.modelProfileId = custom.modelProfileId;
    const selected = creatorTargetProfile(target, [row]);
    expect(selected.modelProfileId).toBe('user-hand-profile');
    const draft = createBlankCreatorDraft(1);
    draft.modelProfileId = 'other-outfit'; draft.anchorName = 'head';
    draft.presetId = row.preset.presetId; draft.attachmentDefinitionId = row.preset.attachmentAssetId;
    const anchor = creatorTargetAnchor(selected, [row], draft.anchorName);
    const result = switchCreatorAdaptation(draft, [row], selected, true, undefined, anchor);
    expect(result.created).toBe(false);
    expect(result.draft.anchorName).toBe('user.hand-state-contact');
    expect(result.draft.placement.offset.x).toBe(50);
  });
  it('does not guess between multiple saved custom Profiles for one outfit path', () => {
    const first = { ...saved('hand', 50), modelProfile: { ...target, modelProfileId: 'custom-a' } } as CreatorPackageAdaptation;
    const second = { ...saved('head', 70), modelProfile: { ...target, modelProfileId: 'custom-b' } } as CreatorPackageAdaptation;
    expect(() => creatorTargetProfile(target, [first, second])).toThrow('多套已保存的附件适配');
  });
});
