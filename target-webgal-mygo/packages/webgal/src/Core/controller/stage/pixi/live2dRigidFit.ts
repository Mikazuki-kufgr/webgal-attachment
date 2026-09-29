export interface Point2D {
  x: number;
  y: number;
}

export interface RigidCorrespondence {
  index: number;
  weight: number;
  reference: Point2D;
  current: Point2D;
}

export interface RigidCorrespondenceResult extends RigidCorrespondence {
  predicted: Point2D;
  residual: Point2D;
  residualLength: number;
}

export interface RigidFit2D {
  referenceCentroid: Point2D;
  currentCentroid: Point2D;
  translation: Point2D;
  rotation: number;
  scale: number;
  uniformScale: number;
  rmsError: number;
  maxError: number;
  correspondences: RigidCorrespondenceResult[];
}

const EPSILON = 1e-9;

function assertFinitePoint(point: Point2D, label: string) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must contain finite x/y coordinates`);
  }
}

function transformPoint(point: Point2D, rotation: number, scale: number, translation: Point2D): Point2D {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: scale * (cosine * point.x - sine * point.y) + translation.x,
    y: scale * (sine * point.x + cosine * point.y) + translation.y,
  };
}

/**
 * Fits a non-reflecting 2D rigid transform. The optional uniform scale is
 * calculated every time for diagnostics, but is applied only when
 * `followUniformScale` is true.
 */
export function fitRigid2D(
  correspondences: readonly RigidCorrespondence[],
  followUniformScale: boolean,
): RigidFit2D {
  if (correspondences.length < 3) {
    throw new RangeError('A rigid attachment fit requires at least three correspondences');
  }

  const seenIndices = new Set<number>();
  let totalWeight = 0;
  let referenceX = 0;
  let referenceY = 0;
  let currentX = 0;
  let currentY = 0;
  for (const item of correspondences) {
    if (!Number.isInteger(item.index) || item.index < 0 || seenIndices.has(item.index)) {
      throw new RangeError('Correspondence indices must be unique non-negative integers');
    }
    seenIndices.add(item.index);
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new RangeError('Correspondence weights must be finite and positive');
    }
    assertFinitePoint(item.reference, `Reference vertex ${item.index}`);
    assertFinitePoint(item.current, `Current vertex ${item.index}`);
    totalWeight += item.weight;
    referenceX += item.reference.x * item.weight;
    referenceY += item.reference.y * item.weight;
    currentX += item.current.x * item.weight;
    currentY += item.current.y * item.weight;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= EPSILON) {
    throw new RangeError('Correspondence weights are degenerate');
  }

  const referenceCentroid = { x: referenceX / totalWeight, y: referenceY / totalWeight };
  const currentCentroid = { x: currentX / totalWeight, y: currentY / totalWeight };
  let dot = 0;
  let cross = 0;
  let referenceEnergy = 0;
  for (const item of correspondences) {
    const qx = item.reference.x - referenceCentroid.x;
    const qy = item.reference.y - referenceCentroid.y;
    const px = item.current.x - currentCentroid.x;
    const py = item.current.y - currentCentroid.y;
    dot += item.weight * (qx * px + qy * py);
    cross += item.weight * (qx * py - qy * px);
    referenceEnergy += item.weight * (qx * qx + qy * qy);
  }
  if (!Number.isFinite(referenceEnergy) || referenceEnergy <= EPSILON) {
    throw new RangeError('Reference vertices are degenerate');
  }
  const correlation = Math.hypot(dot, cross);
  if (!Number.isFinite(correlation) || correlation <= EPSILON) {
    throw new RangeError('Current vertices do not define a stable rigid orientation');
  }

  const rotation = Math.atan2(cross, dot);
  const uniformScale = correlation / referenceEnergy;
  if (!Number.isFinite(uniformScale) || uniformScale <= EPSILON) {
    throw new RangeError('Best-fit uniform scale is invalid');
  }
  const scale = followUniformScale ? uniformScale : 1;
  const rotatedReferenceCentroid = transformPoint(referenceCentroid, rotation, scale, { x: 0, y: 0 });
  const translation = {
    x: currentCentroid.x - rotatedReferenceCentroid.x,
    y: currentCentroid.y - rotatedReferenceCentroid.y,
  };

  let weightedSquaredError = 0;
  let maxError = 0;
  const results = correspondences.map((item): RigidCorrespondenceResult => {
    const predicted = transformPoint(item.reference, rotation, scale, translation);
    const residual = { x: item.current.x - predicted.x, y: item.current.y - predicted.y };
    const residualLength = Math.hypot(residual.x, residual.y);
    weightedSquaredError += item.weight * residualLength * residualLength;
    maxError = Math.max(maxError, residualLength);
    return {
      index: item.index,
      weight: item.weight,
      reference: { ...item.reference },
      current: { ...item.current },
      predicted,
      residual,
      residualLength,
    };
  });

  return {
    referenceCentroid,
    currentCentroid,
    translation,
    rotation,
    scale,
    uniformScale,
    rmsError: Math.sqrt(weightedSquaredError / totalWeight),
    maxError,
    correspondences: results,
  };
}
