import { fail } from './terre-path-guard.mjs';

export const AUTHORED_PROFILE_ID = /^user-profile-[a-f0-9-]{36}$/;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);
const label = value => typeof value === 'string' && value.trim() && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** No client path grants authority. Geometry is user-authored, not a server semantic certification. */
export function validateAuthoredProfile(p) {
  if (!p || p.schema !== 'webgal-live2d-model-profile' || p.schemaVersion !== 1 ||
      !AUTHORED_PROFILE_ID.test(p.modelProfileId) || !id(p.characterId) || !id(p.modelId) ||
      !Number.isSafeInteger(p.profileVersion) || p.profileVersion < 1 ||
      !Number.isInteger(p.fingerprint?.drawableCount) || p.fingerprint.drawableCount < 1 || p.fingerprint.drawableCount > 10000 ||
      !/^[a-f0-9]{64}$/i.test(p.fingerprint.modelJsonSha256 ?? '') || !/^[a-f0-9]{64}$/i.test(p.fingerprint.mocSha256 ?? '') ||
      !Array.isArray(p.anchors) || !p.anchors.length || p.anchors.length > 128)
    fail('CREATOR_ANCHOR_PROFILE_INVALID');
  const names = new Set(), identities = new Set();
  for (const a of p.anchors) {
    if (!id(a.name) || !id(a.anchorProfileId) || (a.displayName !== undefined && !label(a.displayName)) ||
        typeof a.drawableId !== 'string' || !a.drawableId || a.drawableId.length > 256 ||
        !Number.isInteger(a.vertexCount) || a.vertexCount < 3 || a.vertexCount > 100000 ||
        !Array.isArray(a.points) || a.points.length < 3 || a.points.length > 64 ||
        names.has(a.name) || identities.has(a.anchorProfileId)) fail('CREATOR_ANCHOR_PROFILE_INVALID');
    names.add(a.name); identities.add(a.anchorProfileId);
    const indices = new Set(); let sum = 0, x = 0, y = 0;
    for (const q of a.points) {
      if (!Number.isInteger(q.index) || q.index < 0 || q.index >= a.vertexCount || indices.has(q.index) ||
          !finite(q.weight) || q.weight <= 0 || !finite(q.neutral?.x) || !finite(q.neutral?.y)) fail('CREATOR_ANCHOR_POINT_INVALID');
      indices.add(q.index); sum += q.weight; x += q.weight * q.neutral.x; y += q.weight * q.neutral.y;
    }
    x /= sum; y /= sum;
    let xx = 0, yy = 0, xy = 0;
    for (const q of a.points) {
      const dx = q.neutral.x - x, dy = q.neutral.y - y, w = q.weight / sum;
      xx += dx * dx * w; yy += dy * dy * w; xy += dx * dy * w;
    }
    const trace = xx + yy;
    if (!finite(trace) || trace <= 0 || (xx * yy - xy * xy) / (trace * trace) < 1e-5)
      fail('CREATOR_ANCHOR_POINTS_UNSTABLE');
  }
  return p;
}
