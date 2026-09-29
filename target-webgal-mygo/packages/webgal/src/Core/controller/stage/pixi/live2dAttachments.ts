import type { Live2DModel } from 'pixi-live2d-display-webgal';
import * as PIXI from 'pixi.js';

export const ATTACHMENT_BACK_NAME = '__webgal_attachment_back__';
export const ATTACHMENT_FRONT_NAME = '__webgal_attachment_front__';
export const ATTACHMENT_DEBUG_MARKER_NAME = '__webgal_attachment_debug_marker__';

const SAKIKO_CASUAL_MODEL_PATH = 'game/figure/sakiko/casual-2023/model.json';

function normalizeGameAssetPath(sourcePath: string) {
  return sourcePath.replace(/\\/g, '/').replace(/^(\.\/)+/, '').split(/[?#]/, 1)[0];
}

export function isSakikoCasualModelPath(sourcePath: string) {
  return normalizeGameAssetPath(sourcePath) === SAKIKO_CASUAL_MODEL_PATH;
}

function copyLocalDisplayState(source: Live2DModel, target: PIXI.Container) {
  target.position.copyFrom(source.position);
  target.scale.copyFrom(source.scale);
  target.pivot.copyFrom(source.pivot);
  target.skew.copyFrom(source.skew);
  target.rotation = source.rotation;
  target.alpha = source.alpha;
  target.visible = source.visible;
  target.renderable = source.renderable;
}

function createDebugMarker(model: Live2DModel) {
  const marker = new PIXI.Graphics();
  marker.name = ATTACHMENT_DEBUG_MARKER_NAME;
  marker.position.set(model.internalModel.width * 0.5, model.internalModel.height * 0.2);
  marker.lineStyle(8, 0x00e5ff, 1);
  marker.beginFill(0x00e5ff, 0.25);
  marker.drawCircle(0, 0, 48);
  marker.endFill();
  marker.moveTo(-72, 0);
  marker.lineTo(72, 0);
  marker.moveTo(0, -72);
  marker.lineTo(0, 72);
  return marker;
}

export interface Live2DAttachmentLayers {
  back: PIXI.Container;
  front: PIXI.Container;
}

export interface CreateLive2DAttachmentLayersOptions {
  debugMarker?: boolean;
}

export function syncAttachmentLayersFromModel(model: Live2DModel, layers: Live2DAttachmentLayers) {
  copyLocalDisplayState(model, layers.back);
  copyLocalDisplayState(model, layers.front);
}

/** Create the shared back/front planes for all attachments on one figure. */
export function createLive2DAttachmentLayers(
  model: Live2DModel,
  options: CreateLive2DAttachmentLayersOptions = {},
): Live2DAttachmentLayers {
  const back = new PIXI.Container();
  back.name = ATTACHMENT_BACK_NAME;

  const front = new PIXI.Container();
  front.name = ATTACHMENT_FRONT_NAME;
  if (import.meta.env.DEV && options.debugMarker) front.addChild(createDebugMarker(model));

  const layers = { back, front };
  syncAttachmentLayersFromModel(model, layers);
  return layers;
}

/** Install layers in the outer WebGAL figure container as back -> model -> front. */
export function attachLive2DAttachmentLayers(
  container: PIXI.Container,
  model: Live2DModel,
  layers: Live2DAttachmentLayers,
) {
  layers.back.parent?.removeChild(layers.back);
  layers.front.parent?.removeChild(layers.front);

  if (model.parent !== container) {
    model.parent?.removeChild(model);
    container.addChild(layers.back, model, layers.front);
    return;
  }

  const modelIndex = container.getChildIndex(model);
  container.addChildAt(layers.back, modelIndex);
  container.addChildAt(layers.front, container.getChildIndex(model) + 1);
}

export function destroyLive2DAttachmentLayers(layers: Live2DAttachmentLayers) {
  for (const layer of [layers.back, layers.front]) {
    layer.parent?.removeChild(layer);
    layer.destroy({ children: true, texture: false, baseTexture: false });
  }
}

/** DEV-only POC for one exact model; production and all other figures stay unchanged. */
export function createSakikoAttachmentLayers(
  sourcePath: string,
  model: Live2DModel,
): Live2DAttachmentLayers | undefined {
  if (!import.meta.env.DEV || !isSakikoCasualModelPath(sourcePath)) {
    return undefined;
  }

  return createLive2DAttachmentLayers(model, { debugMarker: true });
}
