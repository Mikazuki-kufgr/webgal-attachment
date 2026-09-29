import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve('resources/global-library');
const manifestPath = path.resolve('resources/product-resources.json');
const index = JSON.parse(fs.readFileSync(path.join(root, 'library-index.json'), 'utf8'));
const product = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const names = new Map([
  ['straw-hat-both', '草帽'], ['kemomimi-front', '兽耳'], ['halo-front', '光环'],
  ['flower-front', '花朵'], ['rose-front', '玫瑰'],
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const generated = [];
for (const sample of index.builtinSamples) {
  const displayName = names.get(sample.id);
  if (!displayName) throw new Error(`Unknown sample ${sample.id}`);
  const preset = JSON.parse(fs.readFileSync(path.join(root, sample.placementPreset), 'utf8'));
  const sourceAsset = JSON.parse(fs.readFileSync(path.join(root, sample.attachmentAsset), 'utf8'));
  const modelProfile = JSON.parse(fs.readFileSync(path.join(root, sample.modelProfile), 'utf8'));
  if (preset.modelProfileId !== modelProfile.modelProfileId || preset.attachmentAssetId !== sourceAsset.attachmentAssetId)
    throw new Error(`Sample binding mismatch: ${sample.id}`);
  const leaf = sample.id + '-v1';
  const gameRoot = `game/attachments-v2/portable/${leaf}`;
  const logicalRoot = `portable-samples/${displayName}/${leaf}`;
  const output = path.join(root, ...logicalRoot.split('/'));
  fs.mkdirSync(path.join(output, 'images'), { recursive: true });
  const presetId = `v2/${leaf}`;
  const layers = {};
  const rows = [];
  for (const layer of ['back', 'front']) {
    const source = sourceAsset.layers?.[layer];
    if (!source) continue;
    const sourceFile = sample.files.find(file => file.endsWith(`/${layer}.png`));
    if (!sourceFile) throw new Error(`Missing ${layer} image for ${sample.id}`);
    const bytes = fs.readFileSync(path.join(root, sourceFile));
    layers[layer] = `./${gameRoot}/images/${layer}.png`;
    rows.push([`${logicalRoot}/images/${layer}.png`, bytes, 'factory-sample-image']);
  }
  const asset = { ...sourceAsset, layers, attachedLayers: { ...layers } };
  const document = {
    schema: 'webgal-live2d-attachment-package', schemaVersion: 2, displayName, asset,
    adaptations: [{ preset: { ...preset, presetId }, modelProfile }],
    defaultParameters: { anchorName: preset.anchorName, fit: preset.fit, placement: preset.placement,
      ...(preset.initialVisualState ? { initialVisualState: preset.initialVisualState } : {}) },
  };
  rows.push([`${logicalRoot}/attachment.json`, json(document), 'factory-sample-document']);
  rows.push([`${logicalRoot}/使用说明.txt`, Buffer.from(
    `${displayName}\n这是可复制的完整附件。将“${leaf}”文件夹整体复制到游戏的 game/attachments-v2/portable/。\n图片只保存一份；人物与锚点参数在 attachment.json 的 adaptations 中。\n制作器中打开它后，可给同一附件新增目标，保存会保留原身份和已有参数。\n`, 'utf8'), 'factory-sample-guide']);
  const manifest = {
    schema: 'webgal-attachment-creator-export-manifest', schemaVersion: 1,
    toolVersion: 'factory-sample-v1', createdAt: '2026-09-24T00:00:00.000Z',
    attachmentDefinitionId: asset.attachmentAssetId, presetId,
    modelProfileId: modelProfile.modelProfileId, anchorName: preset.anchorName,
    displayName, files: rows.map(([logical, bytes]) => ({
      path: `${gameRoot}/${logical.slice(logicalRoot.length + 1)}`, bytes: bytes.length, sha256: sha(bytes),
    })),
  };
  rows.push([`${logicalRoot}/manifest.json`, json(manifest), 'factory-sample-manifest']);
  for (const [logical, bytes, role] of rows) {
    const file = path.join(root, ...logical.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    generated.push({ path: logical, role, bytes: bytes.length, sha256: sha(bytes) });
  }
  sample.completeFolder = logicalRoot;
}
fs.writeFileSync(path.join(root, 'library-index.json'), json(index));
const old = product.files.filter(row => !row.path.startsWith('portable-samples/'));
const indexBytes = fs.readFileSync(path.join(root, 'library-index.json'));
for (const row of old) if (row.path === 'library-index.json') {
  row.bytes = indexBytes.length; row.sha256 = sha(indexBytes);
}
product.files = [...old, ...generated].sort((a, b) => a.path.localeCompare(b.path));
for (const role of new Set(generated.map(row => row.role)))
  product.counts[role] = generated.filter(row => row.role === role).length;
product.source.factorySamples = 'SELF_CONTAINED_FROM_LOCKED_LEGACY_RESOURCE_SET_20260924';
fs.writeFileSync(manifestPath, json(product));
