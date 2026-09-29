import * as PIXI from 'pixi.js';
import { effectiveWorldOpacity, ownOpacityFilter } from './effectiveOpacity';

const DEFAULT_DETERMINANT_EPSILON = 1e-10;
const DEFAULT_MATRIX_TOLERANCE = 1e-5;
const DEFAULT_ALPHA_TOLERANCE = 1e-8;

export interface MatrixComponents {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface ReparentWorldState {
  matrix: MatrixComponents;
  determinant: number;
  worldAlpha: number;
  worldVisible: boolean;
  worldRenderable: boolean;
}

export interface ReparentPreserveWorldRequest {
  displayObject: PIXI.DisplayObject;
  newParent: PIXI.Container;
  identityToken?: string;
}

export type ReparentFailurePhase =
  | 'after-parent-change'
  | 'after-transform'
  | 'after-publish';

export interface ReparentFailureInjectionContext {
  phase: ReparentFailurePhase;
  index: number;
  identityToken: string;
  displayObject: PIXI.DisplayObject;
  newParent: PIXI.Container;
}

export interface ReparentPreserveWorldOptions {
  determinantEpsilon?: number;
  matrixTolerance?: number;
  alphaTolerance?: number;
  /** Test-only seam for proving transaction rollback at each commit phase. */
  failureInjector?: (context: ReparentFailureInjectionContext) => void;
}

export interface ReparentPreserveWorldEntryResult {
  identityToken: string;
  displayObject: PIXI.DisplayObject;
  oldParent: PIXI.Container;
  newParent: PIXI.Container;
  before: ReparentWorldState;
  after: ReparentWorldState;
  matrixDelta: number;
  worldAlphaDelta: number;
}

export interface ReparentPreserveWorldResult {
  entries: ReparentPreserveWorldEntryResult[];
  maxMatrixDelta: number;
  maxWorldAlphaDelta: number;
}

export class ReparentPreserveWorldError extends Error {
  public readonly cause: unknown;
  public readonly rollbackError: unknown;
  public readonly rolledBack: boolean;

  public constructor(cause: unknown, rollbackError?: unknown) {
    const causeText = cause instanceof Error ? cause.message : String(cause);
    const rollbackText = rollbackError
      ? `; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      : '';
    super(`Atomic preserve-world reparent failed: ${causeText}${rollbackText}`);
    this.name = 'ReparentPreserveWorldError';
    this.cause = cause;
    this.rollbackError = rollbackError;
    this.rolledBack = rollbackError === undefined;
  }
}

interface LocalTransformSnapshot {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  pivot: { x: number; y: number };
  skew: { x: number; y: number };
  rotation: number;
}

interface PreparedReparent {
  request: ReparentPreserveWorldRequest;
  identityToken: string;
  oldParent: PIXI.Container;
  oldChildIndex: number;
  oldTransform: LocalTransformSnapshot;
  oldAlpha: number;
  oldVisible: boolean;
  oldRenderable: boolean;
  before: ReparentWorldState;
  newLocal: PIXI.Matrix;
  newAlpha: number;
  newVisible: boolean;
  newRenderable: boolean;
}

function matrixComponents(matrix: PIXI.Matrix): MatrixComponents {
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    tx: matrix.tx,
    ty: matrix.ty,
  };
}

function matrixDeterminant(matrix: MatrixComponents): number {
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

function assertFiniteMatrix(matrix: PIXI.Matrix, label: string) {
  const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`${label} contains a non-finite matrix component`);
  }
}

function maximumMatrixDelta(left: MatrixComponents, right: MatrixComponents): number {
  return Math.max(
    Math.abs(left.a - right.a),
    Math.abs(left.b - right.b),
    Math.abs(left.c - right.c),
    Math.abs(left.d - right.d),
    Math.abs(left.tx - right.tx),
    Math.abs(left.ty - right.ty),
  );
}

function effectiveBoolean(
  displayObject: PIXI.DisplayObject,
  property: 'visible' | 'renderable',
): boolean {
  let current: PIXI.DisplayObject | null = displayObject;
  while (current) {
    if (!current[property]) return false;
    current = current.parent;
  }
  return true;
}

function captureWorldState(displayObject: PIXI.DisplayObject): ReparentWorldState {
  const matrix = matrixComponents(displayObject.worldTransform);
  return {
    matrix,
    determinant: matrixDeterminant(matrix),
    worldAlpha: effectiveWorldOpacity(displayObject),
    worldVisible: effectiveBoolean(displayObject, 'visible'),
    worldRenderable: effectiveBoolean(displayObject, 'renderable'),
  };
}

function captureLocalTransform(displayObject: PIXI.DisplayObject): LocalTransformSnapshot {
  return {
    position: { x: displayObject.position.x, y: displayObject.position.y },
    scale: { x: displayObject.scale.x, y: displayObject.scale.y },
    pivot: { x: displayObject.pivot.x, y: displayObject.pivot.y },
    skew: { x: displayObject.skew.x, y: displayObject.skew.y },
    rotation: displayObject.rotation,
  };
}

function restoreLocalTransform(
  displayObject: PIXI.DisplayObject,
  snapshot: LocalTransformSnapshot,
) {
  displayObject.position.set(snapshot.position.x, snapshot.position.y);
  displayObject.scale.set(snapshot.scale.x, snapshot.scale.y);
  displayObject.pivot.set(snapshot.pivot.x, snapshot.pivot.y);
  displayObject.skew.set(snapshot.skew.x, snapshot.skew.y);
  displayObject.rotation = snapshot.rotation;
}

function matrixSign(value: number, epsilon: number): number {
  return Math.abs(value) <= epsilon ? 0 : Math.sign(value);
}

function assertNoCycle(displayObject: PIXI.DisplayObject, newParent: PIXI.Container) {
  let current: PIXI.DisplayObject | null = newParent;
  while (current) {
    if (current === displayObject) {
      throw new RangeError('A display object cannot be reparented beneath itself or one of its descendants');
    }
    current = current.parent;
  }
}

function prepareRequest(
  request: ReparentPreserveWorldRequest,
  index: number,
  determinantEpsilon: number,
  alphaTolerance: number,
): PreparedReparent {
  const { displayObject, newParent } = request;
  const identityToken = request.identityToken ?? (displayObject.name || `proxy-${index}`);
  const oldParent = displayObject.parent;
  if (!oldParent) throw new RangeError(`${identityToken} must have an existing parent`);
  assertNoCycle(displayObject, newParent);

  // Container traversal skips invisible children. Publish the target itself so
  // a deliberately hidden proxy does not retain a stale/identity world matrix.
  displayObject.updateTransform();
  const oldWorld = displayObject.worldTransform.clone();
  const newParentWorld = newParent.worldTransform.clone();
  assertFiniteMatrix(oldWorld, `${identityToken} world transform`);
  assertFiniteMatrix(newParentWorld, `${identityToken} target parent world transform`);
  const newParentDeterminant = newParentWorld.a * newParentWorld.d - newParentWorld.b * newParentWorld.c;
  if (!Number.isFinite(newParentDeterminant) || Math.abs(newParentDeterminant) <= determinantEpsilon) {
    throw new RangeError(`${identityToken} target parent world transform is not invertible`);
  }

  // Pixi prepend computes `argument × this`, yielding inverse(parentWorld) × oldWorld.
  const newParentInverse = newParentWorld.clone().invert();
  const newLocal = oldWorld.clone().prepend(newParentInverse);
  assertFiniteMatrix(newLocal, `${identityToken} target local transform`);

  const before = captureWorldState(displayObject);
  if (!Number.isFinite(before.worldAlpha)) {
    throw new RangeError(`${identityToken} effective alpha is not finite`);
  }

  // Reparenting keeps the object's own AlphaFilter intact. Divide it out as
  // well as the new parent's effective opacity before writing ordinary alpha.
  const parentWorldAlpha = effectiveWorldOpacity(newParent) * ownOpacityFilter(displayObject);
  if (!Number.isFinite(parentWorldAlpha)) {
    throw new RangeError(`${identityToken} target parent alpha is not finite`);
  }
  let newAlpha: number;
  if (Math.abs(parentWorldAlpha) <= alphaTolerance) {
    if (Math.abs(before.worldAlpha) > alphaTolerance) {
      throw new RangeError(`${identityToken} effective alpha cannot be preserved under a zero-alpha parent`);
    }
    newAlpha = displayObject.alpha;
  } else {
    newAlpha = before.worldAlpha / parentWorldAlpha;
  }
  if (!Number.isFinite(newAlpha)) {
    throw new RangeError(`${identityToken} target local alpha is not finite`);
  }

  const parentVisible = effectiveBoolean(newParent, 'visible');
  if (before.worldVisible && !parentVisible) {
    throw new RangeError(`${identityToken} cannot remain visible beneath an invisible parent`);
  }
  const parentRenderable = effectiveBoolean(newParent, 'renderable');
  if (before.worldRenderable && !parentRenderable) {
    throw new RangeError(`${identityToken} cannot remain renderable beneath a non-renderable parent`);
  }

  return {
    request,
    identityToken,
    oldParent,
    oldChildIndex: oldParent.getChildIndex(displayObject),
    oldTransform: captureLocalTransform(displayObject),
    oldAlpha: displayObject.alpha,
    oldVisible: displayObject.visible,
    oldRenderable: displayObject.renderable,
    before,
    newLocal,
    newAlpha,
    newVisible: parentVisible ? before.worldVisible : displayObject.visible,
    newRenderable: parentRenderable ? before.worldRenderable : displayObject.renderable,
  };
}

function rollback(prepared: readonly PreparedReparent[], matrixTolerance: number) {
  for (const item of prepared) {
    item.request.displayObject.parent?.removeChild(item.request.displayObject);
  }

  const byOriginalParent = new Map<PIXI.Container, PreparedReparent[]>();
  for (const item of prepared) {
    const entries = byOriginalParent.get(item.oldParent) ?? [];
    entries.push(item);
    byOriginalParent.set(item.oldParent, entries);
  }
  for (const [parent, entries] of byOriginalParent) {
    entries.sort((left, right) => left.oldChildIndex - right.oldChildIndex);
    for (const item of entries) {
      parent.addChildAt(item.request.displayObject, Math.min(item.oldChildIndex, parent.children.length));
    }
  }

  for (const item of prepared) {
    const displayObject = item.request.displayObject;
    restoreLocalTransform(displayObject, item.oldTransform);
    displayObject.alpha = item.oldAlpha;
    displayObject.visible = item.oldVisible;
    displayObject.renderable = item.oldRenderable;
    displayObject.updateTransform();
    const restored = captureWorldState(displayObject);
    const delta = maximumMatrixDelta(item.before.matrix, restored.matrix);
    if (delta > matrixTolerance) {
      throw new Error(
        `${item.identityToken} rollback matrix delta ${delta} exceeds ${matrixTolerance}; ` +
          `before=${JSON.stringify(item.before.matrix)} restored=${JSON.stringify(restored.matrix)}`,
      );
    }
    if (
      restored.worldVisible !== item.before.worldVisible ||
      restored.worldRenderable !== item.before.worldRenderable
    ) {
      throw new Error(`${item.identityToken} rollback did not restore effective visibility`);
    }
  }
}

/**
 * Atomically reparents one or more Pixi display objects while keeping their
 * effective world transform, alpha, visibility, and renderability unchanged.
 * Callers must publish current ancestry transforms before invoking this
 * function; it deliberately captures the actual current-frame world state.
 */
export function reparentPreserveWorld(
  requests: readonly ReparentPreserveWorldRequest[],
  options: ReparentPreserveWorldOptions = {},
): ReparentPreserveWorldResult {
  const determinantEpsilon = options.determinantEpsilon ?? DEFAULT_DETERMINANT_EPSILON;
  const matrixTolerance = options.matrixTolerance ?? DEFAULT_MATRIX_TOLERANCE;
  const alphaTolerance = options.alphaTolerance ?? DEFAULT_ALPHA_TOLERANCE;
  if (determinantEpsilon <= 0 || matrixTolerance <= 0 || alphaTolerance <= 0) {
    throw new RangeError('Reparent tolerances must be positive');
  }

  const movingObjects = new Set<PIXI.DisplayObject>();
  for (const request of requests) {
    if (movingObjects.has(request.displayObject)) {
      throw new RangeError('A display object can appear only once in one reparent transaction');
    }
    movingObjects.add(request.displayObject);
  }
  for (const request of requests) {
    if (movingObjects.has(request.newParent)) {
      throw new RangeError('A moving display object cannot also be a target parent in the same transaction');
    }
  }

  const prepared = requests.map((request, index) =>
    prepareRequest(request, index, determinantEpsilon, alphaTolerance),
  );

  try {
    const entries: ReparentPreserveWorldEntryResult[] = [];
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const { displayObject, newParent } = item.request;
      if (displayObject.parent !== newParent) newParent.addChild(displayObject);
      options.failureInjector?.({
        phase: 'after-parent-change',
        index,
        identityToken: item.identityToken,
        displayObject,
        newParent,
      });

      displayObject.transform.setFromMatrix(item.newLocal);
      options.failureInjector?.({
        phase: 'after-transform',
        index,
        identityToken: item.identityToken,
        displayObject,
        newParent,
      });

      displayObject.alpha = item.newAlpha;
      displayObject.visible = item.newVisible;
      displayObject.renderable = item.newRenderable;
      displayObject.updateTransform();
      const after = captureWorldState(displayObject);
      const matrixDelta = maximumMatrixDelta(item.before.matrix, after.matrix);
      const worldAlphaDelta = Math.abs(item.before.worldAlpha - after.worldAlpha);
      if (matrixDelta > matrixTolerance) {
        throw new Error(`${item.identityToken} matrix delta ${matrixDelta} exceeds ${matrixTolerance}`);
      }
      if (worldAlphaDelta > alphaTolerance) {
        throw new Error(`${item.identityToken} alpha delta ${worldAlphaDelta} exceeds ${alphaTolerance}`);
      }
      if (
        after.worldVisible !== item.before.worldVisible ||
        after.worldRenderable !== item.before.worldRenderable
      ) {
        throw new Error(`${item.identityToken} effective visibility changed during reparent`);
      }
      if (
        matrixSign(after.determinant, determinantEpsilon) !==
        matrixSign(item.before.determinant, determinantEpsilon)
      ) {
        throw new Error(`${item.identityToken} determinant sign changed during reparent`);
      }

      options.failureInjector?.({
        phase: 'after-publish',
        index,
        identityToken: item.identityToken,
        displayObject,
        newParent,
      });
      entries.push({
        identityToken: item.identityToken,
        displayObject,
        oldParent: item.oldParent,
        newParent,
        before: item.before,
        after,
        matrixDelta,
        worldAlphaDelta,
      });
    }

    return {
      entries,
      maxMatrixDelta: entries.reduce((maximum, entry) => Math.max(maximum, entry.matrixDelta), 0),
      maxWorldAlphaDelta: entries.reduce(
        (maximum, entry) => Math.max(maximum, entry.worldAlphaDelta),
        0,
      ),
    };
  } catch (error) {
    let rollbackError: unknown;
    try {
      rollback(prepared, matrixTolerance);
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }
    throw new ReparentPreserveWorldError(error, rollbackError);
  }
}
