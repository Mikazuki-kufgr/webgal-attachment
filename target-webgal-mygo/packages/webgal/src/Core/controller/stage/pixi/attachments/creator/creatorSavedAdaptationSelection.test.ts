import { describe, expect, it } from 'vitest';
import { selectCreatorSavedAdaptation } from './creatorSavedAdaptationSelection';
import type { CreatorPackageAdaptation } from './creatorPackageBuilder';

function adaptation(id: string, modelPath = 'game/figure/shared/model.json'): CreatorPackageAdaptation {
  return {
    modelProfile: { modelProfileId: id, modelPath },
    preset: { modelProfileId: id },
  } as CreatorPackageAdaptation;
}
describe('5H explicit saved adaptation selection', () => {
  it('reordering between context and load does not change the chosen Profile', () => {
    const a = adaptation('profile-a'),
      b = adaptation('profile-b');
    expect(selectCreatorSavedAdaptation([b, a], 'profile-a')).toEqual({ adaptation: a, index: 1 });
  });
  it('insertions and same model path cannot retarget selection', () => {
    const a = adaptation('profile-a'),
      b = adaptation('profile-b'),
      c = adaptation('profile-c');
    expect(selectCreatorSavedAdaptation([c, a, b], 'profile-b')).toEqual({ adaptation: b, index: 2 });
  });
  it('deleted Profile and empty list fail instead of choosing the first remaining row', () => {
    expect(() => selectCreatorSavedAdaptation([adaptation('a')], 'b')).toThrow(
      'CREATOR_SAVED_ATTACHMENT_ADAPTATION_NOT_FOUND',
    );
    expect(() => selectCreatorSavedAdaptation([], 'a')).toThrow('CREATOR_SAVED_ATTACHMENT_ADAPTATION_NOT_FOUND');
  });
  it('duplicate IDs are rejected even when duplicate is not the selected row', () => {
    expect(() => selectCreatorSavedAdaptation([adaptation('a'), adaptation('b'), adaptation('b')], 'a')).toThrow(
      'CREATOR_SAVED_ATTACHMENT_ADAPTATION_ID_DUPLICATE',
    );
  });
  it('missing explicit selection or mismatched Profile binding fails closed', () => {
    expect(() => selectCreatorSavedAdaptation([adaptation('a')], '')).toThrow('CREATOR_EXPLICIT_ADAPTATION_REQUIRED');
    expect(() => selectCreatorSavedAdaptation([adaptation('a')], ' a ')).toThrow(
      'CREATOR_EXPLICIT_ADAPTATION_REQUIRED',
    );
    const broken = adaptation('a');
    broken.preset.modelProfileId = 'b';
    expect(() => selectCreatorSavedAdaptation([broken], 'a')).toThrow(
      'CREATOR_SAVED_ATTACHMENT_ADAPTATION_BINDING_INVALID',
    );
  });
  it('selection does not mutate caller-owned document or normalize its chosen identity', () => {
    const values = [adaptation('a'), adaptation('b')],
      before = JSON.stringify(values);
    expect(selectCreatorSavedAdaptation(values, 'a').adaptation).toBe(values[0]);
    expect(JSON.stringify(values)).toBe(before);
    expect(() => selectCreatorSavedAdaptation(values, 'A')).toThrow('CREATOR_SAVED_ATTACHMENT_ADAPTATION_NOT_FOUND');
  });
});
