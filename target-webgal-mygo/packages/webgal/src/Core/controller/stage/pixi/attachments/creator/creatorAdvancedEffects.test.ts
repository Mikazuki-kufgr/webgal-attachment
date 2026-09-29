import { describe, expect, it } from 'vitest';
import { createBlankCreatorDraft } from './creatorDraft';
import { creatorAdvancedEffectsActive } from './creatorAdvancedEffects';

describe('creatorAdvancedEffectsActive', () => {
  it('keeps a new neutral attachment on the default-off path', () => {
    const draft = createBlankCreatorDraft();
    expect(creatorAdvancedEffectsActive(draft.visualState)).toBe(false);
  });

  it('restores the advanced editor when an existing attachment has non-neutral values', () => {
    const draft = createBlankCreatorDraft();
    const appearance = draft.visualState.appearance;
    const skew = draft.visualState.skew;
    if (!appearance || !skew) throw new Error('neutral Creator draft must include appearance and skew');
    appearance.blur = 3;
    expect(creatorAdvancedEffectsActive(draft.visualState)).toBe(true);

    appearance.blur = 0;
    skew.x = 0.2;
    expect(creatorAdvancedEffectsActive(draft.visualState)).toBe(true);
  });

  it('treats non-neutral nested color and bloom values as preserved advanced state', () => {
    const draft = createBlankCreatorDraft();
    const appearance = draft.visualState.appearance;
    if (!appearance?.bloom) throw new Error('neutral Creator draft must include appearance and bloom');
    appearance.color.blue = 240;
    expect(creatorAdvancedEffectsActive(draft.visualState)).toBe(true);

    appearance.color.blue = 255;
    appearance.bloom.threshold = 0.4;
    expect(creatorAdvancedEffectsActive(draft.visualState)).toBe(true);
  });
});
