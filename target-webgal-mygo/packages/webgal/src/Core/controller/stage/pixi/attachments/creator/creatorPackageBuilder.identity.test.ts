import { changeCreatorLayerMode } from './creatorLayerMode';
import { describe, expect, it } from 'vitest';
import { buildCreatorPackage, type CreatorPackageAdaptation } from './creatorPackageBuilder';
import { createBlankCreatorDraft } from './creatorDraft';
import { sha256Bytes } from './pngImport';
import { rekeyCreatorAdaptations } from './creatorDraftIdentity';
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

describe('5H actual Creator package producer exact adaptation identity', () => {
  it('Save As New rekeys every retained adaptation without mutating old identities or geometry', async () => {
    const a = await build(),
      old = doc(await build('profile-b', doc(a).adaptations, 22)).adaptations;
    const before = JSON.stringify(old);
    const changed = rekeyCreatorAdaptations(old, { presetId: 'v2/new-hat', attachmentDefinitionId: 'new-hat-asset' });
    expect(changed.map((a) => a.preset.presetId)).toEqual(['v2/new-hat', 'v2/new-hat']);
    expect(changed.map((a) => a.preset.attachmentAssetId)).toEqual(['new-hat-asset', 'new-hat-asset']);
    expect(changed.map((a) => a.modelProfile.modelProfileId)).toEqual(['profile-a', 'profile-b']);
    expect(changed.every((a) => a.preset.approvalStatus === 'candidate')).toBe(true);
    changed[0].preset.placement.offset.x = 99;
    changed[0].modelProfile.anchors[0].points[0].neutral.x = 88;
    expect(JSON.stringify(old)).toBe(before);
  });
  it('Save As New producer round-trip retains both adaptations with one new self-contained image set', async () => {
    const a = await build(),
      b = await build('profile-b', doc(a).adaptations, 22);
    const draft = structuredClone(b.draft);
    draft.presetId = 'v2/new-hat';
    draft.attachmentDefinitionId = 'new-hat-asset';
    draft.attachmentInstanceId = 'new-hat-instance';
    const result = await buildCreatorPackage({
      draft,
      profile: b.profile,
      front: { bytes: png, metadata: draft.layers.front! },
      existingAdaptations: rekeyCreatorAdaptations(doc(b).adaptations, draft),
      createdAt: '2026-09-04T00:00:00Z',
    });
    expect(
      doc(result).adaptations.map((a) => [
        a.preset.presetId,
        a.preset.attachmentAssetId,
        a.modelProfile.modelProfileId,
      ]),
    ).toEqual([
      ['v2/new-hat', 'new-hat-asset', 'profile-a'],
      ['v2/new-hat', 'new-hat-asset', 'profile-b'],
    ]);
    expect(result.files.filter((f) => f.mime === 'image/png')).toHaveLength(1);
    expect(result.files.every((f) => f.path.startsWith('game/attachments-v2/portable/new-hat/'))).toBe(true);
    expect(b.draft.presetId).toBe('v2/identity-hat');
  });
  it('A -> B -> A on the same model path retains both Profile IDs and only changes A', async () => {
    const a = await build(),
      b = await build('profile-b', doc(a).adaptations, 22);
    expect(doc(b).adaptations.map((v) => v.modelProfile.modelProfileId)).toEqual(['profile-a', 'profile-b']);
    const a2 = await build('profile-a', doc(b).adaptations, 11),
      values = doc(a2).adaptations;
    expect(values).toHaveLength(2);
    expect(values[0].preset.placement.offset.x).toBe(11);
    expect(values[1].preset.placement.offset.x).toBe(22);
    expect(a2.files.filter((f) => f.mime === 'image/png')).toHaveLength(1);
  });
  it('same Profile ID cannot silently replace a different model geometry', async () => {
    const a = await build(),
      previous = doc(a).adaptations;
    previous[0].modelProfile.modelPath = './game/figure/anon/revision-old/model.json';
    await expect(build('profile-a', previous)).rejects.toThrow('CREATOR_EXISTING_PROFILE_GEOMETRY_CONFLICT');
  });
  it('duplicate retained Profile IDs fail closed instead of arbitrarily dropping an adaptation', async () => {
    const a = doc(await build()).adaptations[0];
    await expect(build('profile-b', [a, structuredClone(a)])).rejects.toThrow(
      'CREATOR_EXISTING_ADAPTATION_ID_DUPLICATE',
    );
  });
  it('cross-preset and asset mismatches fail before export', async () => {
    const a = doc(await build()).adaptations;
    a[0].preset.presetId = 'v2/foreign';
    await expect(build('profile-b', a)).rejects.toThrow('CREATOR_EXISTING_ADAPTATION_BINDING_MISMATCH');
    a[0].preset.presetId = 'v2/identity-hat';
    a[0].preset.attachmentAssetId = 'foreign';
    await expect(build('profile-b', a)).rejects.toThrow('CREATOR_EXISTING_ADAPTATION_BINDING_MISMATCH');
  });
  it('malformed retained Profile geometry/anchor cannot be silently exported', async () => {
    const a = doc(await build()).adaptations;
    a[0].modelProfile.anchors[0].points = [];
    await expect(build('profile-b', a)).rejects.toThrow('points must contain at least three points');
  });
  it('canonical ordering and package creation do not mutate retained inputs', async () => {
    const a = doc(await build()).adaptations,
      before = JSON.stringify(a);
    const z = await build('profile-z', a);
    expect(JSON.stringify(a)).toBe(before);
    const same = await build('profile-z', [...doc(z).adaptations].reverse());
    expect(doc(same).adaptations.map((v) => v.modelProfile.modelProfileId)).toEqual(['profile-a', 'profile-z']);
    expect(same.files.map((f) => f.sha256)).toEqual(z.files.map((f) => f.sha256));
  });
  it('all self-contained single and double-layer files remain byte/hash-closed', async () => {
    for (const both of [false, true]) {
      const result = await build('profile-a', [], 0, both);
      expect(result.files).toHaveLength(both ? 5 : 4);
      for (const file of result.files) {
        expect(file.path.startsWith('game/attachments-v2/portable/identity-hat/')).toBe(true);
        expect(await sha256Bytes(file.bytes)).toBe(file.sha256);
      }
      for (const row of result.manifest.files) {
        const file = result.files.find((f) => f.path === row.path)!;
        expect(file.bytes.byteLength).toBe(row.bytes);
        expect(file.sha256).toBe(row.sha256);
      }
      expect(result.draft.presetId).toBe('v2/identity-hat');
      expect(doc(result).asset.attachmentAssetId).toBe('identity-hat-asset');
      expect(doc(result).displayName).toBe('中文附件');
    }
  });
});

it('layer reassignment exports one unchanged PNG with all character placements retained', async () => {
  const a = await build(),
    b = await build('profile-b', doc(a).adaptations, 22);
  const next = changeCreatorLayerMode(b.draft, { front: { bytes: png, metadata: b.draft.layers.front! } }, 'back-only');
  const result = await buildCreatorPackage({
    draft: next.draft,
    profile: b.profile,
    ...next.binaries,
    existingAdaptations: doc(b).adaptations,
    createdAt: '2026-09-13T00:00:00Z',
  });
  expect(doc(result).adaptations.map((x) => [x.modelProfile.modelProfileId, x.preset.placement])).toEqual(
    doc(b).adaptations.map((x) => [x.modelProfile.modelProfileId, x.preset.placement]),
  );
  expect(result.draft.layerMode).toBe('back-only');
  expect(result.files.filter((f) => f.mime === 'image/png')).toHaveLength(1);
  expect(result.files.find((f) => f.mime === 'image/png')!.bytes).toEqual(png);
  expect(JSON.stringify((doc(result) as any).asset)).toContain('back');
});
