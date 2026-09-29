import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { WebGALPixiContainer } from './WebGALPixiContainer';
import { applyLocalOpacity, effectiveLocalOpacity, effectiveWorldOpacity } from './effectiveOpacity';
import { reparentPreserveWorld } from './reparentPreserveWorld';
import { HatAttachmentController } from './attachments/HatAttachmentController';
import {
  applyAttachmentEntityVisualState,
  readAttachmentEntityVisualState,
  type AttachmentEntityVisualState,
} from './attachments/stageEntityVisualState';
import { attachLive2DAttachmentLayers, createLive2DAttachmentLayers } from './live2dAttachments';
import type { AttachmentConfig } from './attachments/types';
import type { Live2DCurrentFrame, Live2DFrameDriverStats } from './live2dFrameDriver';

// The tests execute real Pixi containers, matrices and production controllers.
// No WebGL context is created: this is scalar/CPU contract evidence, not a
// renderer screenshot or proof of pixel compositing/subjective visual quality.
let restoreCanvasProbe: () => void;
beforeAll(() => {
  const canvasProbe = vi
    .spyOn(PIXI.settings.ADAPTER, 'createCanvas')
    .mockImplementation(() => ({ getContext: () => null } as unknown as HTMLCanvasElement));
  restoreCanvasProbe = () => canvasProbe.mockRestore();
});
afterAll(() => restoreCanvasProbe());

function publish(root: PIXI.Container) {
  const temporaryParent = root.enableTempParent();
  root.updateTransform();
  root.disableTempParent(temporaryParent);
  const descendants = (parent: PIXI.Container) => {
    for (const child of parent.children) {
      child.updateTransform();
      if (child instanceof PIXI.Container) descendants(child);
    }
  };
  descendants(root);
}

function localState(opacity: number): AttachmentEntityVisualState {
  return { space: 'local', position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity, visible: true };
}

function reparentFixture() {
  const root = new WebGALPixiContainer();
  const previous = new WebGALPixiContainer();
  const target = new WebGALPixiContainer();
  const child = new WebGALPixiContainer();
  root.alpha = 0.8;
  root.alphaFilterVal = 0.5;
  previous.alpha = 0.5;
  previous.alphaFilterVal = 0.4;
  target.alpha = 0.8;
  target.alphaFilterVal = 0.5;
  child.alpha = 0.6;
  child.alphaFilterVal = 0.25;
  root.addChild(previous, target);
  previous.addChild(child);
  publish(root);
  return { root, previous, target, child };
}

describe('locked native AlphaFilter scalar composition', () => {
  it('keeps ordinary Pixi ancestry unchanged', () => {
    const root = new PIXI.Container();
    const child = new PIXI.Container();
    root.alpha = 0.5;
    child.alpha = 0.4;
    root.addChild(child);
    publish(root);
    expect(effectiveLocalOpacity(child)).toBe(0.4);
    expect(effectiveWorldOpacity(child)).toBeCloseTo(0.2);
  });

  it.each([0, 0.2, 0.5, 1])('includes parent native filter %s exactly once', (factor) => {
    const root = new WebGALPixiContainer();
    const child = new PIXI.Container();
    root.alphaFilterVal = factor;
    child.alpha = 0.4;
    root.addChild(child);
    publish(root);
    expect(child.worldAlpha).toBe(0.4);
    expect(effectiveWorldOpacity(child)).toBeCloseTo(0.4 * factor);
    expect(root.alphaFilterVal).toBe(factor);
  });

  it('includes own and nested ancestor filters without counting ordinary alpha twice', () => {
    const { child } = reparentFixture();
    expect(effectiveWorldOpacity(child)).toBeCloseTo(0.8 * 0.5 * 0.6 * 0.5 * 0.4 * 0.25);
    expect(effectiveLocalOpacity(child)).toBeCloseTo(0.15);
  });

  it('state reads exclude inherited filters and applying replaces both local channels', () => {
    const { root, child } = reparentFixture();
    expect(readAttachmentEntityVisualState(child, 'local').opacity).toBeCloseTo(0.15);
    applyAttachmentEntityVisualState(child, localState(0.7));
    expect(child.alpha).toBe(0.7);
    expect(child.alphaFilterVal).toBe(1);
    expect(readAttachmentEntityVisualState(child, 'local').opacity).toBe(0.7);
    expect(root.alphaFilterVal).toBe(0.5);
  });

  it('does not compound a native transform filter across repeated state round trips', () => {
    const child = new WebGALPixiContainer();
    child.alphaFilterVal = 0.4;
    for (let index = 0; index < 100; index += 1) {
      applyAttachmentEntityVisualState(child, readAttachmentEntityVisualState(child, 'local'));
    }
    expect(effectiveLocalOpacity(child)).toBeCloseTo(0.4);
    expect(child.alphaFilterVal).toBe(1);
  });

  it('ordinary containers receive no invented filter channel', () => {
    const child = new PIXI.Container();
    applyLocalOpacity(child, 0.3);
    expect(child.alpha).toBe(0.3);
    expect('alphaFilterVal' in child).toBe(false);
  });
});

describe('atomic reparent with native opacity filters', () => {
  it('preserves effective world opacity and own filter', () => {
    const { child, target } = reparentFixture();
    const before = effectiveWorldOpacity(child);
    const result = reparentPreserveWorld([{ displayObject: child, newParent: target }]);
    expect(child.alpha).toBeCloseTo(0.3);
    expect(child.alphaFilterVal).toBe(0.25);
    expect(effectiveWorldOpacity(child)).toBeCloseTo(before);
    expect(result.entries[0].before.worldAlpha).toBeCloseTo(before);
    expect(result.maxWorldAlphaDelta).toBeLessThan(1e-12);
  });

  it.each(['after-parent-change', 'after-transform', 'after-publish'] as const)(
    'restores exact channels and parent on %s failure',
    (failurePhase) => {
      const { root, child, previous, target } = reparentFixture();
      const before = effectiveWorldOpacity(child);
      expect(() =>
        reparentPreserveWorld([{ displayObject: child, newParent: target }], {
          failureInjector: ({ phase }) => {
            if (phase === failurePhase) throw new Error('injected');
          },
        }),
      ).toThrow('injected');
      publish(root);
      expect(child.parent).toBe(previous);
      expect(child.alpha).toBe(0.6);
      expect(child.alphaFilterVal).toBe(0.25);
      expect(effectiveWorldOpacity(child)).toBeCloseTo(before);
    },
  );

  it('rejects a zero-opacity destination before mutation', () => {
    const { root, child, previous, target } = reparentFixture();
    target.alphaFilterVal = 0;
    publish(root);
    expect(() => reparentPreserveWorld([{ displayObject: child, newParent: target }])).toThrow('zero-alpha parent');
    expect(child.parent).toBe(previous);
    expect(child.alphaFilterVal).toBe(0.25);
  });

  it('preserves zero own-filter opacity without dividing by zero', () => {
    const { root, child, target } = reparentFixture();
    child.alphaFilterVal = 0;
    publish(root);
    reparentPreserveWorld([{ displayObject: child, newParent: target }]);
    expect(child.alpha).toBe(0.6);
    expect(child.alphaFilterVal).toBe(0);
    expect(effectiveWorldOpacity(child)).toBe(0);
  });
});

function attachmentFixture(full = false) {
  const root = new WebGALPixiContainer();
  const freeParent = new WebGALPixiContainer();
  const figure = new WebGALPixiContainer();
  const model = new PIXI.Container() as PIXI.Container & { internalModel: Record<string, unknown> };
  model.internalModel = {
    localTransform: new PIXI.Matrix(),
    getDrawableIndex: () => 0,
    getDrawableVertices: () => new Float32Array([0, 0, 100, 0, 0, 100]),
  };
  root.alphaFilterVal = 0.5;
  freeParent.alphaFilterVal = 0.8;
  figure.alphaFilterVal = 0.5;
  root.addChild(freeParent);
  freeParent.addChild(figure);
  figure.addChild(model);
  const layers = createLive2DAttachmentLayers(model as never);
  attachLive2DAttachmentLayers(figure, model as never, layers);
  const host = new WebGALPixiContainer();
  host.alphaFilterVal = 0.4;
  const config: AttachmentConfig = {
    schema: 'webgal-live2d-attachment-v1',
    configId: 'opacity',
    target: {
      modelPath: 'game/figure/opacity/model.json',
      anchorProfile: {
        drawableId: 'head',
        anchors: [
          { index: 0, weight: 1, neutral: { x: 0, y: 0 } },
          { index: 1, weight: 1, neutral: { x: 100, y: 0 } },
          { index: 2, weight: 1, neutral: { x: 0, y: 100 } },
        ],
      },
    },
    fit: { scaleMode: 'uniform' },
    layers: { back: 'back.png', front: 'front.png' },
    placement: { spriteAnchor: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, rotationOffsetRad: 0, localScale: 1 },
  };
  const controller = new HatAttachmentController({
    instanceId: 'opacity-test',
    model: model as never,
    layers,
    config,
    transformHost: host,
    textures: { back: PIXI.Texture.EMPTY, front: PIXI.Texture.EMPTY, ...(full ? { full: PIXI.Texture.EMPTY } : {}) },
  });
  const tick = () => {
    publish(root);
    controller.update({} as Live2DCurrentFrame, {} as Live2DFrameDriverStats);
    controller.syncVisualStateForRender();
    publish(root);
  };
  tick();
  return { root, freeParent, figure, model, layers, host, controller, tick };
}

describe('production attachment controller CPU opacity lifecycle', () => {
  it.each([false, true])('preserves detach opacity with full representation=%s', (full) => {
    const { figure, freeParent, host, controller, root } = attachmentFixture(full);
    const before = controller.getTransitionVisualSnapshot();
    expect(before.attachmentLocalOpacity).toBeCloseTo(0.4);
    expect(before.back.worldAlpha).toBeCloseTo(0.08);
    expect(before.front.worldAlpha).toBeCloseTo(0.08);
    const result = controller.detachToFree(freeParent);
    publish(root);
    expect(result.visualState.opacity).toBeCloseTo(0.2);
    expect(effectiveWorldOpacity(host)).toBeCloseTo(0.08);
    expect(host.alphaFilterVal).toBe(1);
    expect(figure.alphaFilterVal).toBe(0.5);
    expect(result.reparent.maxWorldAlphaDelta).toBeLessThan(1e-12);
    if (full) {
      const fullProxy = host.children.find((child) => child.name.endsWith('_full_proxy__'));
      expect(fullProxy).toBeDefined();
      expect(effectiveWorldOpacity(fullProxy!)).toBeCloseTo(0.08);
    }
    for (const proxy of result.presentation.proxies) {
      expect(proxy.before.worldAlpha).toBeCloseTo(0.08);
      expect(proxy.afterReparent.worldAlpha).toBeCloseTo(0.08);
    }
    controller.destroy();
  });

  it.each([false, true])('measures and reattaches without doubling filters (full=%s)', (full) => {
    const { root, freeParent, model, layers, host, controller, tick } = attachmentFixture(full);
    controller.detachToFree(freeParent);
    publish(root);
    const target = controller.measureAttachedTarget(model as never, layers, freeParent, localState(0.4));
    expect(target.opacity).toBeCloseTo(0.2);
    const result = controller.reattachFromFree(model as never, layers, localState(0.4));
    tick();
    expect(result.visualState.opacity).toBeCloseTo(0.4);
    expect(effectiveLocalOpacity(host)).toBeCloseTo(0.4);
    expect(controller.getTransitionVisualSnapshot().back.worldAlpha).toBeCloseTo(0.08);
    expect(result.reparent.maxWorldAlphaDelta).toBeLessThan(1e-12);
    controller.destroy();
  });

  it('samples a newer native transform filter on both proxies in the next frame', () => {
    const { host, controller, tick } = attachmentFixture();
    host.alpha = 1;
    host.alphaFilterVal = 0.7;
    tick();
    const snapshot = controller.getTransitionVisualSnapshot();
    expect(snapshot.attachmentLocalOpacity).toBeCloseTo(0.7);
    expect(snapshot.back.worldAlpha).toBeCloseTo(0.14);
    expect(snapshot.front.worldAlpha).toBeCloseTo(0.14);
    tick();
    expect(controller.getTransitionVisualSnapshot().back.worldAlpha).toBeCloseTo(0.14);
    expect(host.alphaFilterVal).toBe(0.7);
    controller.destroy();
  });

  it('fails readiness for a visually zero-alpha figure even when Pixi worldAlpha is nonzero', () => {
    const { figure, freeParent, controller, tick } = attachmentFixture();
    figure.alphaFilterVal = 0;
    tick();
    expect(figure.worldAlpha).toBe(1);
    expect(controller.getDetachFrameReadiness(freeParent).reason).toBe('source-ancestry-alpha-unavailable');
    controller.destroy();
  });

  it('rollback restores the native host opacity channels exactly', () => {
    const { freeParent, host, controller } = attachmentFixture();
    expect(() =>
      controller.detachToFree(freeParent, {
        failureInjector: () => {
          throw new Error('opacity rollback');
        },
      }),
    ).toThrow('opacity rollback');
    expect(host.parent).toBeNull();
    expect(host.alpha).toBe(1);
    expect(host.alphaFilterVal).toBe(0.4);
    expect(controller.getPresentationState()).toBe('attached');
    controller.destroy();
  });
});
