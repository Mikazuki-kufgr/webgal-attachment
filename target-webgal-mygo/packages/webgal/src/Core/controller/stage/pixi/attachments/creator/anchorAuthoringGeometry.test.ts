import { describe, expect, it } from 'vitest';
import { anchorPointCloud, captureAuthoredAnchor, nearestAnchorVertex, validateAnchorGeometry } from './anchorAuthoringGeometry';
import { parseLive2DModelProfile, createAttachmentProfileRegistry, resolveAttachmentPlacementPreset } from '../profileLoader';
import { attachmentSemanticAnchorMatchesPreset, isAttachmentSemanticAnchorId } from '../semanticAnchorContract';

const options = { name: 'user.a-test', displayName: '鸭舌帽帽檐', anchorProfileId: 'anchor-test', drawableId: 'D_CAP',
  vertices: [0, 0, 4, 0, 0, 4, 5, 5], weights: new Map([[0, 1], [1, 2], [2, 1]]) };
const profile = () => ({ schema: 'webgal-live2d-model-profile', schemaVersion: 1, profileVersion: 1,
  modelProfileId: 'user-profile-test', characterId: 'my-character', modelId: 'pony-tail', modelPath: 'game/figure/my/model.json',
  fingerprint: { modelJsonSha256: 'A'.repeat(64), mocSha256: 'B'.repeat(64), drawableCount: 1 }, anchors: [captureAuthoredAnchor(options)] });

describe('offline user-defined anchor geometry and formal Profile', () => {
  it('captures Chinese label, weights and immutable reference coordinates', () => {
    const a = captureAuthoredAnchor(options); expect(validateAnchorGeometry(a.points)).toEqual({ x: 2, y: 1 });
    expect(a.displayName).toBe('鸭舌帽帽檐'); expect(a.vertexCount).toBe(4);
    a.points[0].neutral.x = 77; expect(options.vertices[0]).toBe(0);
  });
  it('rejects collinear, duplicated, invalid or insufficient points', () => {
    expect(() => captureAuthoredAnchor({ ...options, vertices: [0, 0, 1, 1, 2, 2, 5, 5] })).toThrow(/COLLINEAR/);
    expect(() => captureAuthoredAnchor({ ...options, weights: new Map([[0, 1], [1, 1]]) })).toThrow(/3_TO_64/);
    expect(() => captureAuthoredAnchor({ ...options, weights: new Map([[0, 0], [1, 1], [2, 1]]) })).toThrow(/POINT_INVALID/);
    expect(() => captureAuthoredAnchor({ ...options, weights: new Map([[99, 1]]) })).toThrow(/OUT_OF_RANGE/);
    expect(() => anchorPointCloud([0, NaN])).toThrow(); expect(() => anchorPointCloud([1])).toThrow();
    const p = captureAuthoredAnchor(options).points; expect(() => validateAnchorGeometry([p[0], p[0], p[1]])).toThrow(/DUPLICATE/);
  });
  it('keeps the conditioning threshold independent of model scale', () => {
    for (const scale of [1e-6, 1, 1e6]) expect(() => captureAuthoredAnchor({ ...options, vertices: options.vertices.map(v => v * scale) })).not.toThrow();
  });
  it('picks vertices in CSS pixels with a bounded hit radius', () => {
    const cloud = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
    expect(nearestAnchorVertex(cloud, { x: 110, y: 100 })).toBe(0);
    expect(nearestAnchorVertex(cloud, { x: 150, y: 100 })).toBe(-1);
  });
  it('round-trips displayName without changing stable script identity', () => {
    const p = parseLive2DModelProfile(profile(), 'test'); p.anchors[0].displayName = '眼镜桥';
    const reopened = parseLive2DModelProfile(JSON.parse(JSON.stringify(p)), 'reopen');
    expect(reopened.anchors[0].name).toBe('user.a-test'); expect(reopened.anchors[0].displayName).toBe('眼镜桥');
    expect(() => parseLive2DModelProfile({ ...p, anchors: [{ ...p.anchors[0], displayName: 'bad\nlabel' }] }, 'bad')).toThrow();
  });
  it('accepts custom IDs only against the exact selected preset anchor, not a similar label', () => {
    expect(isAttachmentSemanticAnchorId('user.a-123')).toBe(true);
    expect(attachmentSemanticAnchorMatchesPreset('user.a-test', 'user.a-test')).toBe(true);
    expect(attachmentSemanticAnchorMatchesPreset('user.a-test', 'user.a-other')).toBe(false);
    expect(attachmentSemanticAnchorMatchesPreset('unknown.part', 'unknown.part')).toBe(false);
    expect(isAttachmentSemanticAnchorId('user.bad;command')).toBe(false);
  });
  it('resolves a custom anchor into the real attachment Runtime binding', () => {
    const p = parseLive2DModelProfile(profile(), 'test');
    const asset = { schema: 'webgal-live2d-attachment-asset' as const, schemaVersion: 1 as const, attachmentAssetId: 'hat', slot: 'headwear', layers: { front: './game/attachments-v2/images/hat.png' } };
    const preset = { schema: 'webgal-live2d-attachment-preset' as const, schemaVersion: 2 as const, presetId: 'v2/hat', approvalStatus: 'candidate' as const,
      attachmentAssetId: 'hat', modelProfileId: p.modelProfileId, anchorName: 'user.a-test', fit: { scaleMode: 'uniform' as const },
      placement: { spriteAnchor: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, rotationOffsetRad: 0, localScale: 1 } };
    const r = resolveAttachmentPlacementPreset(createAttachmentProfileRegistry({ modelProfiles: [p], attachmentAssets: [asset], presets: [preset] }), 'v2/hat');
    expect(r.modelBinding.drawableId).toBe('D_CAP'); expect(r.modelBinding.modelPath).toBe(p.modelPath);
    expect(r.config.target.anchorProfile.anchors.map(a => a.weight)).toEqual([1, 2, 1]);
  });
});
