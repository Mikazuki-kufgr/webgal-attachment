export interface DragCoordinateContext {
  canvasCssWidth: number;
  canvasCssHeight: number;
  rendererWidth: number;
  rendererHeight: number;
  parentWorldTransform: { a: number; b: number; c: number; d: number };
}

export function cssDeltaToPlacementDelta(
  cssDelta: { x: number; y: number },
  context: DragCoordinateContext,
) {
  if (context.canvasCssWidth <= 0 || context.canvasCssHeight <= 0) throw new Error('CREATOR_DRAG_CANVAS_SIZE_INVALID');
  const worldX = cssDelta.x * context.rendererWidth / context.canvasCssWidth;
  const worldY = cssDelta.y * context.rendererHeight / context.canvasCssHeight;
  const { a, b, c, d } = context.parentWorldTransform;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-8) throw new Error('CREATOR_DRAG_PARENT_TRANSFORM_SINGULAR');
  return {
    x: (d * worldX - c * worldY) / determinant,
    y: (-b * worldX + a * worldY) / determinant,
  };
}
