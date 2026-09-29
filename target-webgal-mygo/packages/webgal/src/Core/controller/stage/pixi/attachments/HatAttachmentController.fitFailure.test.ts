import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';

import { WebGALPixiContainer } from '../WebGALPixiContainer';
import { HatAttachmentController } from './HatAttachmentController';
import type { AttachmentConfig } from './types';

const config: AttachmentConfig = {
  schema: 'webgal-live2d-attachment-v1',
  configId: 'fit-failure-policy',
  target: {
    modelPath: 'game/figure/fit-failure/model.json',
    anchorProfile: {
      drawableId: 'head',
      anchors: [
        { index: 0, weight: 1, neutral: { x: -10, y: 0 } },
        { index: 1, weight: 1, neutral: { x: 10, y: 0 } },
        { index: 2, weight: 1, neutral: { x: 0, y: 20 } },
      ],
    },
  },
  fit: { scaleMode: 'uniform' },
  layers: { front: 'game/attachments/fit-failure/front.png' },
  placement: {
    spriteAnchor: { x: 0.5, y: 0.5 },
    offset: { x: 0, y: 0 },
    rotationOffsetRad: 0,
    localScale: 1,
  },
};

const validVertices = new Float32Array([-10, 0, 10, 0, 0, 20]);
const invalidVertices = new Float32Array([Number.NaN, 0, 10, 0, 0, 20]);
const cleanups: Array<() => void> = [];
let restoreCanvas: () => void;

beforeAll(() => {
  const probe = vi
    .spyOn(PIXI.settings.ADAPTER, 'createCanvas')
    .mockImplementation(() => ({ getContext: () => null } as unknown as HTMLCanvasElement));
  restoreCanvas = () => probe.mockRestore();
});

afterAll(() => restoreCanvas());

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup(options: { drawableExists?: boolean } = {}) {
  const back = new PIXI.Container();
  const front = new PIXI.Container();
  const transformHost = new WebGALPixiContainer();
  const getDrawableVertices = vi.fn(() => validVertices);
  const model = Object.assign(new PIXI.Container(), {
    internalModel: {
      localTransform: new PIXI.Matrix(),
      getDrawableIndex: () => (options.drawableExists === false ? -1 : 0),
      getDrawableVertices,
    },
  });
  const onError = vi.fn();
  const controller = new HatAttachmentController({
    instanceId: 'fit-failure-instance',
    model: model as never,
    layers: { back, front },
    config,
    textures: { front: PIXI.Texture.EMPTY },
    transformHost,
    onError,
  });

  cleanups.push(() => {
    controller.destroy();
    back.destroy({ children: true });
    front.destroy({ children: true });
    transformHost.destroy({ children: true });
    model.destroy({ children: true });
  });

  const update = () => controller.update({} as never, {} as never);
  return { back, controller, front, getDrawableVertices, onError, update };
}

describe('HatAttachmentController terminal fit failure policy', () => {
  it('reports the third identical retryable fit failure exactly once and destroys its proxies', () => {
    const f = setup();
    f.getDrawableVertices.mockReturnValue(invalidVertices);

    f.update();
    f.update();
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.controller.getTransitionVisualSnapshot().state).toBe('attached');

    f.update();
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onError.mock.calls[0][0]).toMatchObject({
      code: 'VERTEX_OUT_OF_RANGE',
      message: 'Drawable vertex 0 is unavailable or non-finite',
    });
    expect(f.controller.getTransitionVisualSnapshot().state).toBe('destroyed');
    expect(f.back.children).toHaveLength(0);
    expect(f.front.children).toHaveLength(0);

    f.update();
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.getDrawableVertices).toHaveBeenCalledTimes(3);
  });

  it('recovers after one or two retryable failures without reporting or destroying the controller', () => {
    const f = setup();
    f.getDrawableVertices
      .mockReturnValueOnce(invalidVertices)
      .mockReturnValueOnce(validVertices)
      .mockReturnValueOnce(invalidVertices)
      .mockReturnValueOnce(invalidVertices)
      .mockReturnValueOnce(validVertices);

    f.update();
    f.update();
    f.update();
    f.update();
    f.update();

    expect(f.onError).not.toHaveBeenCalled();
    expect(f.controller.getLastError()).toBeUndefined();
    expect(f.controller.getLastFit()).toBeDefined();
    expect(f.controller.getTransitionVisualSnapshot().state).toBe('attached');
    expect(f.back.children).toHaveLength(1);
    expect(f.front.children).toHaveLength(1);
  });

  it('reports a structural drawable failure immediately and exactly once', () => {
    const f = setup({ drawableExists: false });

    f.update();
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onError.mock.calls[0][0]).toMatchObject({
      code: 'DRAWABLE_NOT_FOUND',
      message: 'Attachment drawable is unavailable: head',
    });
    expect(f.controller.getTransitionVisualSnapshot().state).toBe('destroyed');
    expect(f.getDrawableVertices).not.toHaveBeenCalled();

    f.update();
    expect(f.onError).toHaveBeenCalledTimes(1);
  });
});
