import { describe, expect, it } from 'vitest';
import { buildCreatorPackage, type CreatorPackageAdaptation } from './creatorPackageBuilder';
import { createBlankCreatorDraft } from './creatorDraft';
import { sha256Bytes } from './pngImport';
import { switchCreatorAdaptation } from './creatorAdaptationSwitch';
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

describe('same attachment character switching', () => {
  it('requires explicit creation; round trips A -> B -> A with distinct parameters and one image', async () => {
    const a = await build('profile-a', [], 15);
    const rows = doc(a).adaptations;
    const bProfile = {
      ...modelProfile('profile-b'),
      characterId: 'sakiko',
      modelPath: 'game/figure/sakiko/model.json',
    };
    expect(() => switchCreatorAdaptation(a.draft, rows, bProfile)).toThrow('CREATOR_ADAPTATION_REQUIRED');
    const b = switchCreatorAdaptation(a.draft, rows, bProfile, true);
    expect(b.created).toBe(true);
    expect(b.draft.presetId).toBe(a.draft.presetId);
    b.draft.placement.offset.x = 42;
    b.draft.placement.localScaleX = 0.6;
    b.draft.visualState.opacity = 0.7;
    const packed = await buildCreatorPackage({
      draft: b.draft,
      profile: bProfile,
      front: { metadata: b.draft.layers.front!, bytes: png },
      existingAdaptations: rows,
    });
    const saved = doc(packed);
    expect(saved.adaptations).toHaveLength(2);
    expect(packed.files.filter((f) => f.path.endsWith('.png'))).toHaveLength(1);
    const back = switchCreatorAdaptation(b.draft, saved.adaptations, modelProfile('profile-a'));
    expect(back.draft.placement.offset.x).toBe(15);
    expect(back.draft.visualState.opacity).toBe(1);
    const again = switchCreatorAdaptation(back.draft, saved.adaptations, bProfile);
    expect(again.draft.placement.offset.x).toBe(42);
    expect(again.draft.placement.localScaleX).toBe(0.6);
    expect(again.draft.visualState.opacity).toBe(0.7);
    expect(a.draft.placement.offset.x).toBe(15);
    expect(again.draft.layers).toEqual(a.draft.layers);
  });
  it('rejects duplicate and foreign attachment identities without changing input', async () => {
    const a = await build(),
      rows = doc(a).adaptations,
      before = JSON.stringify(a.draft);
    expect(() => switchCreatorAdaptation(a.draft, [...rows, ...rows], modelProfile('profile-a'))).toThrow('AMBIGUOUS');
    rows[0].preset.presetId = 'v2/other';
    expect(() => switchCreatorAdaptation(a.draft, rows, modelProfile('profile-a'))).toThrow('CONTENT_MISMATCH');
    expect(JSON.stringify(a.draft)).toBe(before);
  });
});
