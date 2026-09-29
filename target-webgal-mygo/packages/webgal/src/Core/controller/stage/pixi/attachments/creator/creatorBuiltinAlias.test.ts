import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttachmentProfileLoader } from '../profileLoader';
describe('shipped runtime loads neutral attachment and legacy compatibility entry', () => {
  it('both script IDs select the same profile, geometry placement and shared image paths', async () => {
    let m = process.cwd();
    while (!fs.existsSync(path.join(m, 'target-plugin/resources/product-resources.json'))) {
      const parent = path.dirname(m); if (parent === m) throw Error('fixture root'); m = parent;
    }
    const profile = JSON.parse(fs.readFileSync(path.join(m, 'target-plugin/resources/global-library/model-profiles/anon-school_winter-2023-semantic-v1.json'), 'utf8'));
    const sourcePreset = JSON.parse(fs.readFileSync(path.join(m, 'target-plugin/resources/global-library/placement-presets/anon-straw-hat-both-v1.json'), 'utf8'));
    const asset = { schema: 'webgal-live2d-attachment-asset', schemaVersion: 1, attachmentAssetId: 'builtin-straw-hat-both-v1', slot: 'headwear', layers: { front: './game/attachments-v2/portable/straw-hat-both-v1/images/front.png' } };
    const doc = (presetId: string) => ({ schema: 'webgal-live2d-attachment-package', schemaVersion: 2, asset,
      ...(presetId.includes('/anon-') ? { compatibilityAliasFor: 'v2/straw-hat-both-v1' } : {}),
      adaptations: [{ modelProfile: profile, preset: { ...sourcePreset, presetId, attachmentAssetId: asset.attachmentAssetId, modelProfileId: profile.modelProfileId, anchorName: 'head', placement: { ...sourcePreset.placement, offset: { x: -3, y: 176 }, localScale: 1.2 } } }] });
    const loader = new AttachmentProfileLoader({ fetcher: async (url) => new Response(JSON.stringify(doc(String(url).includes('/anon-') ? 'v2/anon-straw-hat-both-v1' : 'v2/straw-hat-both-v1')), { status: 200 }) });
    const neutral = await loader.load('v2/straw-hat-both-v1', profile.modelPath);
    const legacy = await loader.load('v2/anon-straw-hat-both-v1', profile.modelPath);
    expect(legacy.config.layers).toEqual(neutral.config.layers);
    expect(legacy.config.placement).toEqual(neutral.config.placement);
    expect(legacy.modelBinding?.modelProfileId).toBe(profile.modelProfileId);
  });
});
