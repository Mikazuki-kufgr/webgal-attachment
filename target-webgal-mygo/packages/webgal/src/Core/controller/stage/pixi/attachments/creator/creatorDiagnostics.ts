import type { Live2DModel } from 'pixi-live2d-display-webgal';
import * as PIXI from 'pixi.js';

import type { AttachmentRuntime } from '../AttachmentRuntime';
import { ATTACHMENT_FRONT_NAME } from '../../live2dAttachments';
import { compatibleAnchorNames, type Live2DModelProfile } from '../profileTypes';

export interface CreatorDiagnosticsFlags {
  anchor: boolean;
  vertices: boolean;
  axes: boolean;
  pivot: boolean;
  bounds: boolean;
}

function walk(container: PIXI.Container, result: PIXI.DisplayObject[]) {
  for (const child of container.children) {
    result.push(child);
    if (child instanceof PIXI.Container) walk(child, result);
  }
}

/** DEV-only explanatory overlay. It observes the shared frame stream and never updates the model. */
export class CreatorDiagnosticsOverlay {
  private graphics?: PIXI.Graphics;
  private unsubscribe?: () => void;
  private bindingRevision = 0;
  private flags: CreatorDiagnosticsFlags = {
    anchor: false,
    vertices: false,
    axes: false,
    pivot: false,
    bounds: false,
  };

  public constructor(private readonly runtime: AttachmentRuntime) {}

  public setFlags(flags: CreatorDiagnosticsFlags) {
    this.flags = { ...flags };
  }

  public bind(options: {
    figureKey: string;
    generation: string;
    model: Live2DModel;
    outerContainer: PIXI.Container;
    profile: Live2DModelProfile;
    anchorName: string;
  }) {
    this.clear();
    const front = options.outerContainer.children.find(
      (child): child is PIXI.Container =>
        child instanceof PIXI.Container && child.name === ATTACHMENT_FRONT_NAME,
    );
    if (!front) return false;
    const graphics = new PIXI.Graphics();
    const bindingRevision = ++this.bindingRevision;
    graphics.name = '__webgal_mvp2b_creator_diagnostics__';
    front.addChild(graphics);
    this.graphics = graphics;
    const draw = () => {
      if (
        bindingRevision !== this.bindingRevision ||
        this.graphics !== graphics ||
        graphics.destroyed ||
        front.destroyed
      ) {
        return;
      }
      this.draw({ ...options, front, graphics });
    };
    this.unsubscribe = this.runtime.subscribe((event) => {
      if (
        event.type === 'frame' &&
        event.figureKey === options.figureKey &&
        event.figureGeneration === options.generation
      ) {
        draw();
      }
    });
    draw();
    return true;
  }

  public clear() {
    this.bindingRevision += 1;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const graphics = this.graphics;
    this.graphics = undefined;
    if (!graphics || graphics.destroyed) return;
    graphics.parent?.removeChild(graphics);
    graphics.destroy();
  }

  private draw(options: {
    model: Live2DModel;
    profile: Live2DModelProfile;
    anchorName: string;
    front: PIXI.Container;
    graphics: PIXI.Graphics;
  }) {
    const { model, profile, anchorName, front, graphics } = options;
    if (graphics.destroyed || front.destroyed || this.graphics !== graphics) return;
    graphics.clear();
    const compatibleNames = compatibleAnchorNames(anchorName);
    const anchor = profile.anchors.find((candidate) => compatibleNames.includes(candidate.name));
    if (!anchor) return;
    const internal = model.internalModel;
    const drawableIndex = internal.getDrawableIndex(anchor.drawableId);
    if (drawableIndex < 0) return;
    const vertices = internal.getDrawableVertices(drawableIndex);
    const matrix = internal.localTransform;
    const points = anchor.points.map((point) => {
      const x = vertices[point.index * 2];
      const y = vertices[point.index * 2 + 1];
      return {
        x: matrix.a * x + matrix.c * y + matrix.tx,
        y: matrix.b * x + matrix.d * y + matrix.ty,
      };
    });
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
    const centroid = points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
    if (this.flags.anchor && points.length) {
      graphics.lineStyle(4, 0x5cf2ff, 0.9);
      graphics.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
    }
    if (this.flags.vertices) {
      graphics.beginFill(0xffe45c, 0.95);
      for (const point of points) graphics.drawCircle(point.x, point.y, 7);
      graphics.endFill();
    }
    if (this.flags.axes) {
      graphics.lineStyle(4, 0xff5555, 0.9);
      graphics.moveTo(centroid.x, centroid.y);
      graphics.lineTo(centroid.x + 90, centroid.y);
      graphics.lineStyle(4, 0x55ff88, 0.9);
      graphics.moveTo(centroid.x, centroid.y);
      graphics.lineTo(centroid.x, centroid.y + 90);
    }
    const descendants: PIXI.DisplayObject[] = [];
    walk(front, descendants);
    const sprites = descendants.filter(
      (child): child is PIXI.Sprite =>
        child instanceof PIXI.Sprite && child.name.includes('__webgal_attachment_') && child.name.endsWith('_sprite__'),
    );
    for (const sprite of sprites) {
      if (this.flags.pivot) {
        const local = front.toLocal(sprite.toGlobal(new PIXI.Point(0, 0)));
        graphics.lineStyle(3, 0xff66dd, 0.95);
        graphics.moveTo(local.x - 16, local.y);
        graphics.lineTo(local.x + 16, local.y);
        graphics.moveTo(local.x, local.y - 16);
        graphics.lineTo(local.x, local.y + 16);
      }
      if (this.flags.bounds && sprite.visible) {
        const bounds = sprite.getBounds();
        const topLeft = front.toLocal(new PIXI.Point(bounds.left, bounds.top));
        const bottomRight = front.toLocal(new PIXI.Point(bounds.right, bounds.bottom));
        graphics.lineStyle(3, 0xaa88ff, 0.75);
        graphics.drawRect(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y,
        );
      }
    }
  }
}
