import fs from 'node:fs';
import path from 'node:path';
import { it, expect } from 'vitest';
import { buildCreatorPackage } from './creatorPackageBuilder';
import { draftFromPreset } from './creatorDraft';
import { switchCreatorAdaptation } from './creatorAdaptationSwitch';
import { inspectPngBytes, sha256Bytes } from './pngImport';
import { AttachmentProfileLoader } from '../profileLoader';
import type { CreatorBinaryInput } from './creatorTypes';

const local = process.env.WEBGAL_ADAPTATION_LOCAL_WORKSPACE;
it.skipIf(!local)('round trips actual local hat and two Profiles without modifying user files', async () => {
  const root = path.resolve(local!);
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, ''));
  const base = 'workspace/game/attachments-v2/';
  const preset = read(base + 'presets/anon-straw-hat-both-v1.json');
  const a = read('library/model-profiles/' + preset.modelProfileId + '.json');
  const b = read(base + 'model-profiles/' + process.env.WEBGAL_ADAPTATION_LOCAL_PROFILE + '.json');
  const draft = draftFromPreset(preset, {
    figureKey: 'local-fixture',
    figureGeneration: 'fixture',
    displayName: '双人物技术夹具',
  });
  draft.layerMode = 'both';
  const inputs: { front?: CreatorBinaryInput; back?: CreatorBinaryInput } = {};
  for (const layer of ['front', 'back'] as const) {
    const bytes = new Uint8Array(
      fs.readFileSync(path.join(root, 'library/files/builtin-samples/straw-hat', layer + '.png')),
    );
    const metadata = {
      ...inspectPngBytes(bytes),
      bytes: bytes.length,
      sha256: await sha256Bytes(bytes),
      mime: 'image/png',
      sourceFileName: layer + '.png',
      outputFileName: layer + '.png',
    };
    inputs[layer] = { bytes, metadata };
    draft.layers[layer] = metadata;
  }
  const first = await buildCreatorPackage({ draft, profile: a, ...inputs });
  const document = (p: typeof first) =>
    JSON.parse(new TextDecoder().decode(p.files.find((f) => f.path.endsWith('/attachment.json'))!.bytes));
  const rows = document(first).adaptations;
  const second = switchCreatorAdaptation(first.draft, rows, b, true).draft;
  // Distinct sentinel values prove isolation, not a visually calibrated Sakiko fit.
  second.placement.offset.x += 31;
  second.placement.localScaleX = 0.67;
  const final = await buildCreatorPackage({ draft: second, profile: b, ...inputs, existingAdaptations: rows });
  const doc = document(final);
  const loader = new AttachmentProfileLoader({ fetcher: async () => new Response(JSON.stringify(doc)) });
  const loadedA = await loader.load(draft.presetId, a.modelPath);
  const loadedB = await loader.load(draft.presetId, b.modelPath);
  expect(loadedA.config.placement.offset.x).toBe(preset.placement.offset.x);
  expect(loadedB.config.placement.offset.x).toBe(preset.placement.offset.x + 31);
  expect(doc.adaptations).toHaveLength(2);
  expect(final.files.filter((f) => f.path.endsWith('.png'))).toHaveLength(2);
  expect(switchCreatorAdaptation(second, doc.adaptations, a).draft.placement.offset.x).toBe(preset.placement.offset.x);
});
