import { describe, expect, it } from 'vitest';
import { buildCreatorPackage, type CreatorPackageAdaptation } from './creatorPackageBuilder';
import { createBlankCreatorDraft } from './creatorDraft';
import { sha256Bytes } from './pngImport';
import { switchCreatorAdaptation } from './creatorAdaptationSwitch';
import { defaultParametersFromPreset, parseCreatorDefaultParameters } from './creatorDefaultParameters';
import { creatorCharacterOutfits } from './creatorCharacterCatalog';
import type { Live2DModelProfile } from '../profileTypes';
import type { CreatorPackage } from './creatorTypes';

const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MuoAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);
const modelProfile = (id: string): Live2DModelProfile => ({
  schema: 'webgal-live2d-model-profile',
  schemaVersion: 1,
  profileVersion: 1,
  modelProfileId: id,
  characterId: 'anon',
  modelId: 'winter',
  modelPath: 'game/figure/anon/model.json',
  fingerprint: { modelJsonSha256: 'A'.repeat(64), drawableCount: 1 },
  anchors: [
    {
      name: 'head',
      anchorProfileId: 'head',
      drawableId: 'head',
      vertexCount: 3,
      points: [
        { index: 0, weight: 1, neutral: { x: 0, y: 0 } },
        { index: 1, weight: 1, neutral: { x: 1, y: 0 } },
        { index: 2, weight: 1, neutral: { x: 0, y: 1 } },
      ],
    },
  ],
});
async function build(id = 'profile-a', existingAdaptations: CreatorPackageAdaptation[] = [], x = 0, both = false) {
  const profile = modelProfile(id),
    draft = createBlankCreatorDraft(1234);
  Object.assign(draft, {
    figureKey: 'anon',
    figureGeneration: 'g1',
    modelProfileId: id,
    anchorName: 'head',
    presetId: 'v2/identity-hat',
    attachmentDefinitionId: 'identity-hat-asset',
    attachmentInstanceId: 'identity-hat-instance',
    displayName: '中文附件',
  });
  draft.placement.offset.x = x;
  const metadata = {
    sourceFileName: '用户原图.png',
    outputFileName: 'front.png',
    width: 1,
    height: 1,
    bytes: png.length,
    sha256: await sha256Bytes(png),
    mime: 'image/png',
  };
  draft.layers.front = metadata;
  if (both) {
    draft.layerMode = 'both';
    draft.layers.back = { ...metadata, outputFileName: 'back.png' };
  }
  return buildCreatorPackage({
    draft,
    profile,
    front: { bytes: png, metadata },
    ...(both ? { back: { bytes: png, metadata: draft.layers.back! } } : {}),
    existingAdaptations,
    createdAt: '2026-09-04T00:00:00Z',
  });
}
function doc(value: CreatorPackage): {
  adaptations: CreatorPackageAdaptation[];
  asset: { attachmentAssetId: string };
  displayName: string;
} {
  return JSON.parse(new TextDecoder().decode(value.files.find((f) => f.path.endsWith('/attachment.json'))!.bytes));
}

describe('character first defaults and catalog', () => {
  it('uses a fixed default instead of edited A placement and preserves it on B save', async () => {
    const a = await build('profile-a', [], 12),
      defaults = defaultParametersFromPreset(a.preset);
    a.draft.placement.offset.x = 999;
    const b = switchCreatorAdaptation(a.draft, doc(a).adaptations, modelProfile('profile-b'), true, defaults);
    expect(b.draft.placement.offset.x).toBe(12);
    b.draft.placement.offset.x = 45;
    const saved = await buildCreatorPackage({
      draft: b.draft,
      profile: modelProfile('profile-b'),
      front: { metadata: b.draft.layers.front!, bytes: png },
      existingAdaptations: doc(a).adaptations,
      defaultParameters: defaults,
    });
    const document = JSON.parse(
      new TextDecoder().decode(saved.files.find((f) => f.path.endsWith('/attachment.json'))!.bytes),
    );
    expect(document.defaultParameters.placement.offset.x).toBe(12);
    expect(
      document.adaptations.find((r: any) => r.modelProfile.modelProfileId === 'profile-a').preset.placement.offset.x,
    ).toBe(12);
    expect(
      document.adaptations.find((r: any) => r.modelProfile.modelProfileId === 'profile-b').preset.placement.offset.x,
    ).toBe(45);
    expect(parseCreatorDefaultParameters(document.defaultParameters, saved.preset).placement.offset.x).toBe(12);
    expect(defaults.placement.offset.x).toBe(12);
  });
  it('validates explicit defaults and accepts an old document fallback without changing it', async () => {
    const a = await build();
    const before = JSON.stringify(a.preset);
    expect(parseCreatorDefaultParameters(undefined, a.preset)).toEqual(defaultParametersFromPreset(a.preset));
    expect(() =>
      parseCreatorDefaultParameters({ anchorName: 'head', placement: { offset: { x: NaN } } }, a.preset),
    ).toThrow();
    expect(JSON.stringify(a.preset)).toBe(before);
  });
  it('filters by character, deduplicates a model with legacy/semantic Profiles, keeps distinct outfits', () => {
    const a = modelProfile('legacy'),
      semantic = { ...modelProfile('semantic'), anchors: [...a.anchors, ...a.anchors] };
    const summer = { ...modelProfile('summer'), modelId: 'summer', modelPath: 'game/figure/anon/summer/model.json' };
    const sakiko = { ...modelProfile('sakiko'), characterId: 'sakiko' };
    const unavailable = modelProfile('missing');
    const rows = creatorCharacterOutfits(
      [a, semantic, summer, sakiko, unavailable],
      new Set(['legacy', 'semantic', 'summer', 'sakiko']),
      'anon',
    );
    expect(rows.map((r) => r.modelProfileId).sort()).toEqual(['semantic', 'summer']);
  });
});
