import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display-webgal';

import { AttachmentFirstValidPoseWaitError, AttachmentRuntime } from './AttachmentRuntime';
import { AttachmentConfigLoader } from './configLoader';
import { Live2DFigureContainer } from '../Live2DFigureContainer';
import type { AttachmentConfig, LoadedAttachmentConfig } from './types';

const modelPath = 'game/figure/pose-test/model.json';
const config: AttachmentConfig = {
  schema: 'webgal-live2d-attachment-v1',
  configId: 'pose-test',
  target: {
    modelPath,
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
  layers: { front: 'game/attachments/pose-test/front.png' },
  placement: {
    spriteAnchor: { x: 0.5, y: 0.5 },
    offset: { x: 0, y: 0 },
    rotationOffsetRad: 0,
    localScale: 1,
  },
};
const loaded: LoadedAttachmentConfig = {
  sourceUrl: 'game/attachments/pose-test/attachment.json',
  config,
  modelBinding: {
    modelProfileId: 'pose-profile',
    characterId: 'pose-character',
    modelId: 'pose-model',
    modelPath,
    profileVersion: 1,
    presetApprovalStatus: 'approved',
    fingerprint: { modelJsonSha256: '0'.repeat(64), drawableCount: 1 },
    anchorName: 'head',
    anchorProfileId: 'pose-head',
    drawableId: 'head',
    vertexCount: 3,
    anchorVertexIndices: [0, 1, 2],
  },
};

interface PoseFixture {
  runtime: AttachmentRuntime;
  model: Live2DModel;
  container: Live2DFigureContainer;
  ancestor: PIXI.Container;
  tick(): void;
  prepare(): void;
  render(): void;
  setContextReady(ready: boolean): void;
  setViewport(width: number, height: number): void;
}

function createFixture(): PoseFixture {
  const loader = new AttachmentConfigLoader({
    fetcher: async () => new Response('fixture config is registered in memory', { status: 404 }),
  });
  loader.registerEphemeral('pose-test', loaded);
  const internalModel = Object.assign(new PIXI.utils.EventEmitter(), {
    destroyed: false,
    viewport: new Float32Array([0, 0, 1920, 1080]),
    width: 1920,
    height: 1080,
    localTransform: new PIXI.Matrix(),
    getDrawableIDs: () => ['head'],
    getDrawableIndex: (id: string) => (id === 'head' ? 0 : -1),
    getDrawableVertices: () => new Float32Array([-10, 0, 10, 0, 0, 20]),
    update: vi.fn(function (this: PIXI.utils.EventEmitter) {
      this.emit('beforeMotionUpdate');
    }),
  });
  const model = Object.assign(new PIXI.Container(), {
    internalModel,
    autoUpdate: true,
    deltaTime: 0,
    elapsedTime: 0,
    glContextID: -1,
    update(delta: number) {
      this.deltaTime += delta;
      this.elapsedTime += delta;
    },
  }) as unknown as Live2DModel;
  const container = new Live2DFigureContainer();
  const root = new PIXI.Container();
  root.addChild(container);
  container.addChild(model);
  const viewport = new PIXI.Rectangle(0, 0, 1920, 1080);
  const reset = () => ({ reset: vi.fn() });
  const renderer = {
    CONTEXT_UID: 7,
    framebuffer: { viewport, reset: vi.fn() },
    batch: { flush: vi.fn(), reset: vi.fn() },
    geometry: reset(),
    shader: reset(),
    state: reset(),
    texture: reset(),
    renderTexture: {
      current: null,
      sourceFrame: viewport,
      destinationFrame: viewport,
      bind: vi.fn(),
    },
    gl: { colorMask: vi.fn() },
  };
  let tickerCallback: (() => void) | undefined;
  const ticker = {
    deltaMS: 16,
    add: vi.fn((callback: () => void) => {
      tickerCallback = callback;
    }),
    remove: vi.fn(),
  };
  const app = { ticker, renderer } as unknown as PIXI.Application;
  const runtime = new AttachmentRuntime({
    configLoader: loader,
    textureLoader: async () => PIXI.Texture.EMPTY,
  });
  runtime.registerFigure({
    key: 'fig-center',
    generation: 'pose-g1',
    sourcePath: modelPath,
    app,
    container,
    model,
  });
  return {
    runtime,
    model,
    container,
    ancestor: root,
    tick() {
      tickerCallback?.();
    },
    prepare() {
      const parent = root.enableTempParent();
      try {
        root.updateTransform();
        (
          container as unknown as {
            renderPreparation?: (value: unknown) => void;
          }
        ).renderPreparation?.(renderer);
      } finally {
        root.disableTempParent(parent);
      }
    },
    render() {
      const parent = root.enableTempParent();
      try {
        root.updateTransform();
        root.render(renderer as unknown as PIXI.Renderer);
      } finally {
        root.disableTempParent(parent);
      }
    },
    setContextReady(ready: boolean) {
      (model as unknown as { glContextID: number }).glContextID = ready ? 7 : -1;
    },
    setViewport(width: number, height: number) {
      viewport.width = width;
      viewport.height = height;
    },
  };
}

let fixtures: PoseFixture[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.spyOn(PIXI.settings.ADAPTER, 'createCanvas').mockImplementation(
    () => ({ getContext: () => null } as unknown as HTMLCanvasElement),
  );
});

afterEach(() => {
  for (const fixture of fixtures) {
    fixture.runtime.destroy();
    fixture.container.parent?.destroy({ children: true });
  }
  fixtures = [];
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function readyFixture() {
  const fixture = createFixture();
  fixtures.push(fixture);
  const snapshot = await fixture.runtime.upsert({
    figureKey: 'fig-center',
    attachmentId: 'hat',
    entityId: 'entity-hat',
    configId: 'pose-test',
    visible: true,
    semanticAnchor: 'head',
  });
  expect(snapshot).toMatchObject({
    phase: 'ready',
    firstValidPose: { status: 'pending' },
  });
  return fixture;
}

function captureWaitResources(fixture: PoseFixture) {
  const diagnostics = fixture.runtime.getDiagnostics();
  return {
    runtimeObserverCount: diagnostics.runtimeObserverCount,
    pendingFrameOperationCount: diagnostics.pendingFrameOperationCount,
  };
}

function expectActiveWait(fixture: PoseFixture, baseline: ReturnType<typeof captureWaitResources>): void {
  expect(captureWaitResources(fixture)).toEqual({
    runtimeObserverCount: baseline.runtimeObserverCount + 1,
    pendingFrameOperationCount: baseline.pendingFrameOperationCount,
  });
}

function expectWaitResourcesRestored(fixture: PoseFixture, baseline: ReturnType<typeof captureWaitResources>): void {
  expect(captureWaitResources(fixture)).toEqual(baseline);
}

describe('5L F03 exact-generation first valid pose supervision', () => {
  it('does not promote resource readiness or bootstrap wait; the formal render hook promotes the first valid pose', async () => {
    const fixture = await readyFixture();
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 100);
    expectActiveWait(fixture, baseline);

    fixture.tick();
    fixture.prepare();
    expect(fixture.runtime.get('fig-center', 'hat')).toMatchObject({
      phase: 'ready',
      firstValidPose: { status: 'pending' },
    });

    fixture.setContextReady(true);
    // No test calls consumer.update directly: this preparation callback is the
    // real Live2DFigureContainer -> Live2DFrameDriver render-hook route.
    fixture.prepare();
    await expect(waiting).resolves.toMatchObject({
      status: 'ready',
      instance: {
        figureGeneration: 'pose-g1',
        firstValidPose: { status: 'ready', frame: 1 },
      },
    });
    expectWaitResourcesRestored(fixture, baseline);
  });

  it('reports a bounded foreground timeout without changing resource phase to error', async () => {
    const fixture = await readyFixture();
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 25);
    expectActiveWait(fixture, baseline);
    const rejected = expect(waiting).rejects.toMatchObject({
      code: 'ATTACHMENT_FIRST_VALID_POSE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(fixture.runtime.get('fig-center', 'hat')).toMatchObject({
      phase: 'ready',
      firstValidPose: { status: 'timed-out', reason: 'no-valid-frame' },
    });
    expectWaitResourcesRestored(fixture, baseline);
  });

  it.each([
    [
      'attachment-hidden',
      (fixture: PoseFixture): void => {
        fixture.runtime.setVisible('fig-center', 'hat', false);
      },
    ],
    [
      'figure-not-renderable',
      (fixture: PoseFixture): void => {
        fixture.model.renderable = false;
      },
    ],
  ] as const)('settles %s as deferred rather than a false runtime failure', async (reason, suspend) => {
    const fixture = await readyFixture();
    suspend(fixture);
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 25);
    expectActiveWait(fixture, baseline);
    await vi.advanceTimersByTimeAsync(25);
    await expect(waiting).resolves.toMatchObject({ status: 'deferred', reason });
    expect(fixture.runtime.get('fig-center', 'hat')).toMatchObject({
      phase: 'ready',
      firstValidPose: { status: 'deferred', reason },
    });
    expectWaitResourcesRestored(fixture, baseline);
  });

  it.each([
    [
      'figure container hidden',
      (fixture: PoseFixture): void => {
        fixture.container.visible = false;
      },
    ],
    [
      'figure container non-renderable',
      (fixture: PoseFixture): void => {
        fixture.container.renderable = false;
      },
    ],
    [
      'figure container zero world alpha',
      (fixture: PoseFixture): void => {
        fixture.container.alpha = 0;
      },
    ],
    [
      'figure ancestor hidden',
      (fixture: PoseFixture): void => {
        fixture.ancestor.visible = false;
      },
    ],
    [
      'figure ancestor non-renderable',
      (fixture: PoseFixture): void => {
        fixture.ancestor.renderable = false;
      },
    ],
    [
      'figure ancestor zero world alpha',
      (fixture: PoseFixture): void => {
        fixture.ancestor.alpha = 0;
      },
    ],
  ] as const)('defers when the actual render traversal suppresses a %s', async (_label, suppress) => {
    const fixture = await readyFixture();
    fixture.setContextReady(true);
    fixture.tick();
    suppress(fixture);
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 25);
    expectActiveWait(fixture, baseline);

    // Use the actual Pixi parent -> Live2DFigureContainer.render traversal.
    // A suppressed container/ancestor must prevent its preparation hook.
    fixture.render();
    expect(fixture.runtime.get('fig-center', 'hat')?.firstValidPose.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(25);
    await expect(waiting).resolves.toMatchObject({
      status: 'deferred',
      reason: 'figure-not-renderable',
    });
    expectWaitResourcesRestored(fixture, baseline);
  });

  it.each([
    ['zero-width', 0, 1080],
    ['zero-height', 1920, 0],
  ] as const)('defers a %s render surface after the formal hook declines the frame', async (_label, width, height) => {
    const fixture = await readyFixture();
    fixture.setContextReady(true);
    fixture.setViewport(width, height);
    fixture.tick();
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 25);
    expectActiveWait(fixture, baseline);
    fixture.prepare();
    expect(fixture.runtime.get('fig-center', 'hat')?.firstValidPose.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(25);
    await expect(waiting).resolves.toMatchObject({
      status: 'deferred',
      reason: 'render-surface-unavailable',
    });
    expectWaitResourcesRestored(fixture, baseline);
  });

  it('settles a background document as deferred without emitting a timeout error', async () => {
    const fixture = await readyFixture();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'hidden' },
    });
    try {
      const baseline = captureWaitResources(fixture);
      const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 25);
      expectActiveWait(fixture, baseline);
      await vi.advanceTimersByTimeAsync(25);
      await expect(waiting).resolves.toMatchObject({ status: 'deferred', reason: 'document-hidden' });
      expect(fixture.runtime.get('fig-center', 'hat')).toMatchObject({
        phase: 'ready',
        firstValidPose: { status: 'deferred', reason: 'document-hidden' },
      });
      expectWaitResourcesRestored(fixture, baseline);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'document', previous);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('promotes a background-deferred attachment to a valid pose on the first later foreground render', async () => {
    const fixture = await readyFixture();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'hidden' },
    });
    try {
      const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(waiting).resolves.toMatchObject({ status: 'deferred', reason: 'document-hidden' });
      expect(fixture.runtime.get('fig-center', 'hat')?.firstValidPose).toMatchObject({
        status: 'deferred',
        reason: 'document-hidden',
      });

      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { visibilityState: 'visible' },
      });
      fixture.setContextReady(true);
      fixture.tick();
      fixture.prepare();

      expect(fixture.runtime.get('fig-center', 'hat')?.firstValidPose.status).toBe('ready');
    } finally {
      if (previous) Object.defineProperty(globalThis, 'document', previous);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('cancels the exact old waiter on remove and cannot accept a same-id re-add', async () => {
    const fixture = await readyFixture();
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 100);
    expectActiveWait(fixture, baseline);
    const rejected = expect(waiting).rejects.toBeInstanceOf(AttachmentFirstValidPoseWaitError);
    fixture.runtime.remove('fig-center', 'hat');
    await rejected;
    expectWaitResourcesRestored(fixture, baseline);
    await fixture.runtime.upsert({
      figureKey: 'fig-center',
      attachmentId: 'hat',
      entityId: 'entity-hat',
      configId: 'pose-test',
      visible: true,
      semanticAnchor: 'head',
    });
    fixture.setContextReady(true);
    fixture.tick();
    fixture.prepare();
    expect(fixture.runtime.get('fig-center', 'hat')?.firstValidPose.status).toBe('ready');
  });

  it('cancels an explicit abort without retaining an observer or pending frame operation', async () => {
    const fixture = await readyFixture();
    const baseline = captureWaitResources(fixture);
    const controller = new AbortController();
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 100, controller.signal);
    expectActiveWait(fixture, baseline);
    const rejected = expect(waiting).rejects.toMatchObject({
      code: 'ATTACHMENT_FIRST_VALID_POSE_CANCELLED',
    });
    controller.abort();
    await rejected;
    expectWaitResourcesRestored(fixture, baseline);
    await vi.advanceTimersByTimeAsync(100);
    expectWaitResourcesRestored(fixture, baseline);
  });

  it('does not let a retired generation formal render callback publish stale pose evidence', async () => {
    const fixture = await readyFixture();
    const readyEvents: string[] = [];
    const unsubscribe = fixture.runtime.subscribe((event) => {
      if (event.type === 'instance-changed' && event.instance.firstValidPose.status === 'ready') {
        readyEvents.push(event.instance.figureGeneration);
      }
    });
    expect(fixture.runtime.beginFigureReplacement('fig-center', 'pose-g2')).toBe(true);
    fixture.setContextReady(true);
    fixture.tick();
    fixture.prepare();
    expect(readyEvents).toEqual([]);
    expect(fixture.runtime.captureTransitionTrace()).toContainEqual(
      expect.objectContaining({
        figureGeneration: 'pose-g1',
        figureTransitionState: 'retiring',
        firstValidPoseStatus: 'pending',
      }),
    );
    unsubscribe();
  });

  it.each(['reset', 'replacement'] as const)('cancels pending supervision on %s', async (operation) => {
    const fixture = await readyFixture();
    const baseline = captureWaitResources(fixture);
    const waiting = fixture.runtime.waitForFirstValidPose('fig-center', 'hat', 100);
    expectActiveWait(fixture, baseline);
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'ATTACHMENT_FIRST_VALID_POSE_STALE' });
    if (operation === 'reset') fixture.runtime.reset();
    else fixture.runtime.beginFigureReplacement('fig-center', 'pose-g2');
    await rejected;
    expectWaitResourcesRestored(fixture, baseline);
  });
});
