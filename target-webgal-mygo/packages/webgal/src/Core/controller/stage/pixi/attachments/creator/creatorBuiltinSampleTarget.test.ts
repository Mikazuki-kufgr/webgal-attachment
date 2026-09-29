import { describe, expect, it } from 'vitest';
import { calibratedSampleProfileId, retargetBuiltinSampleDraft } from './creatorBuiltinSampleTarget';

describe('calibratedSampleProfileId', () => {
  const profile = (id: string, changes = {}) => ({ modelProfileId: id, characterId: 'anon', modelId: 'winter',
    modelPath: './game/figure/anon/winter/model.json', fingerprint: { mocSha256: 'A'.repeat(64), drawableCount: 155 }, ...changes });
  it('preserves the original calibration for the same outfit despite a different default semantic anchor', () => {
    const p = new Map<string, any>([['old', profile('old')], ['semantic', profile('semantic')]]);
    expect(calibratedSampleProfileId('old', 'semantic', p)).toBe('old');
  });
  it.each([
    { characterId: 'sakiko' }, { modelId: 'summer' }, { modelPath: './game/figure/other/model.json' },
    { fingerprint: { mocSha256: 'B'.repeat(64), drawableCount: 155 } },
  ])('does not reuse a calibration for different geometry or outfit: %j', (change) => {
    const p = new Map<string, any>([['old', profile('old')], ['semantic', profile('semantic', change)]]);
    expect(calibratedSampleProfileId('old', 'semantic', p)).toBe('semantic');
  });
  it('does not invent an absent source Profile', () => {
    expect(calibratedSampleProfileId('old', 'semantic', new Map())).toBe('semantic');
  });
});

describe('retargetBuiltinSampleDraft', () => {
  it('keeps the bundled sample head anchor when the previous attachment used mouth', () => {
    const sample = {
      modelProfileId: 'bundled-profile',
      anchorName: 'head',
      placement: { offset: { x: -8, y: 176 }, localScale: 1.2 },
    };

    const result = retargetBuiltinSampleDraft(sample, 'current-compatible-profile');

    expect(result).toEqual({
      modelProfileId: 'current-compatible-profile',
      anchorName: 'head',
      placement: { offset: { x: -8, y: 176 }, localScale: 1.2 },
    });
    expect(result.anchorName).not.toBe('mouth');
    expect(sample.modelProfileId).toBe('bundled-profile');
  });

  it.each(['草帽', '兽耳', '光环'])('does not mutate the complete %s template', (displayName) => {
    const sample = {
      displayName,
      modelProfileId: 'bundled-profile',
      anchorName: 'head',
      placement: { rotationOffsetRad: 0 },
    };
    const before = JSON.stringify(sample);

    const result = retargetBuiltinSampleDraft(sample, 'current-compatible-profile');

    expect(JSON.stringify(sample)).toBe(before);
    expect(result).not.toBe(sample);
    expect(result.anchorName).toBe('head');
    expect(result.placement).toEqual(sample.placement);
  });
});
