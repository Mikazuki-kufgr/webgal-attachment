import * as PIXI from 'pixi.js';

import { WebGALPixiContainer } from '@/Core/controller/stage/pixi/WebGALPixiContainer';
import { isLive2DModelDisplayObject } from '@/Core/controller/stage/pixi/live2dTypeGuards';

export type Live2DFigureRenderPreparation = (renderer: PIXI.Renderer) => void;

/**
 * A Live2D-only figure adapter with one renderer-owned preparation phase.
 *
 * Renderer.render() has already bound the parent target when this hook runs,
 * while this figure's own filters have not calculated their bounds yet.
 */
export class Live2DFigureContainer extends WebGALPixiContainer {
  private renderPreparation?: Live2DFigureRenderPreparation;

  protected getReferenceBoundsChildren(): readonly PIXI.DisplayObject[] {
    return this.children.filter(isLive2DModelDisplayObject);
  }

  public setLive2DRenderPreparation(preparation: Live2DFigureRenderPreparation) {
    if (this.renderPreparation && this.renderPreparation !== preparation) {
      throw new Error('A Live2D figure already owns a render preparation hook');
    }
    this.renderPreparation = preparation;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.renderPreparation === preparation) this.renderPreparation = undefined;
    };
  }

  public render(renderer: PIXI.Renderer) {
    if (this.visible && this.renderable && this.worldAlpha > 0) {
      this.renderPreparation?.(renderer);
    }
    super.render(renderer);
  }

  public destroy(options?: boolean | PIXI.IDestroyOptions) {
    this.renderPreparation = undefined;
    super.destroy(options);
  }
}

export function isLive2DFigureContainer(value: unknown): value is Live2DFigureContainer {
  return value instanceof Live2DFigureContainer;
}
