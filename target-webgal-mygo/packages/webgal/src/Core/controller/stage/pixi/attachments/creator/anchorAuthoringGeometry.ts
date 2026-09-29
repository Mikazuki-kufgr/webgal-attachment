import type { ModelProfileAnchor, ProfilePoint } from '../profileTypes';

export function anchorPointCloud(vertices: ArrayLike<number>): ProfilePoint[] {
  if (!vertices.length || vertices.length % 2 || vertices.length > 200000) throw new Error('ANCHOR_VERTEX_DATA_INVALID');
  const result: ProfilePoint[] = [];
  for (let i = 0; i < vertices.length; i += 2) {
    const x = vertices[i], y = vertices[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('ANCHOR_VERTEX_DATA_INVALID');
    result.push({ x, y });
  }
  return result;
}

/** Relative covariance rejects collinear/unstable fits independent of model units. */
export function validateAnchorGeometry(points: ModelProfileAnchor['points']) {
  if (points.length < 3 || points.length > 64) throw new Error('ANCHOR_NEEDS_3_TO_64_POINTS');
  if (new Set(points.map(p => p.index)).size !== points.length) throw new Error('ANCHOR_DUPLICATE_VERTEX');
  let total = 0, x = 0, y = 0;
  for (const p of points) {
    if (!Number.isInteger(p.index) || p.index < 0 || !Number.isFinite(p.weight) || p.weight <= 0 ||
        !Number.isFinite(p.neutral.x) || !Number.isFinite(p.neutral.y)) throw new Error('ANCHOR_POINT_INVALID');
    total += p.weight; x += p.neutral.x * p.weight; y += p.neutral.y * p.weight;
  }
  x /= total; y /= total;
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) {
    const dx = p.neutral.x - x, dy = p.neutral.y - y, w = p.weight / total;
    xx += w * dx * dx; xy += w * dx * dy; yy += w * dy * dy;
  }
  const trace = xx + yy;
  if (!Number.isFinite(trace) || trace <= 0 || (xx * yy - xy * xy) / (trace * trace) < 1e-5)
    throw new Error('ANCHOR_POINTS_COLLINEAR_OR_UNSTABLE');
  return { x, y };
}

/** Screen-space selection uses a fixed CSS-pixel tolerance, not model units. */
export function nearestAnchorVertex(points: readonly ProfilePoint[], target: ProfilePoint, radius = 14) {
  let best = -1, distance = radius * radius;
  points.forEach((p, i) => {
    const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (d <= distance) { distance = d; best = i; }
  });
  return best;
}

export function captureAuthoredAnchor(options: {
  name: string; displayName: string; anchorProfileId: string; drawableId: string;
  vertices: ArrayLike<number>; weights: ReadonlyMap<number, number>;
}): ModelProfileAnchor {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.name)) throw new Error('ANCHOR_ID_INVALID');
  const displayName = options.displayName.trim();
  if (!displayName || displayName.length > 80 || /[\x00-\x1f\x7f]/.test(displayName)) throw new Error('ANCHOR_LABEL_INVALID');
  const cloud = anchorPointCloud(options.vertices);
  const points = [...options.weights].map(([index, weight]) => {
    if (!cloud[index]) throw new Error('ANCHOR_VERTEX_OUT_OF_RANGE');
    return { index, weight, neutral: { ...cloud[index] } };
  });
  validateAnchorGeometry(points);
  return { name: options.name, displayName, anchorProfileId: options.anchorProfileId,
    drawableId: options.drawableId, vertexCount: cloud.length, points };
}
