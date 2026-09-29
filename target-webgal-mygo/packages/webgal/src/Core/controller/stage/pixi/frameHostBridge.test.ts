import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display-webgal';
import type { IStageState } from '@/Core/Modules/stage/stageInterface';

vi.mock('@/Core/WebGAL', () => ({
  Live2D: {
    isAvailable: true,
    Live2DModel: { from: vi.fn() },
    SoundManager: { volume: 1 },
    positioningType: 'M_3_1_0',
  },
  WebGAL: { stageWidth: 2560, stageHeight: 1440 },
}));
vi.mock('@/Core/initializeScript', () => ({ isIOS: false }));
vi.mock('@/Core/util/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/Core/controller/stage/pixi/spine', () => ({ addSpineBgImpl: vi.fn(), addSpineFigureImpl: vi.fn() }));
vi.mock('@/Core/Modules/stage/stageStateManager', () => ({
  stageStateManager: {
    getCalculationStageState: vi.fn(),
    getViewStageState: () => ({
      figureMetaData: {},
      live2dMotion: [],
      live2dExpression: [],
      live2dBlink: [],
      live2dFocus: [],
    }),
  },
}));

// CPU-only host adapter tests. Real Pixi containers/math and the actual frame driver
// are used; no Canvas/WebGL/SDK rendering or visual acceptance is claimed.
const previousWindow = globalThis.window;
const previousCreateCanvas = PIXI.settings.ADAPTER.createCanvas;
(globalThis as unknown as { window: unknown }).window = {};
PIXI.settings.ADAPTER.createCanvas = () => ({ getContext: () => null } as unknown as HTMLCanvasElement);
const { default: PixiStage } = await import('./PixiController');
const { Live2D } = await import('@/Core/WebGAL');
const { stageStateManager } = await import('@/Core/Modules/stage/stageStateManager');
const { WebGALPixiContainer } = await import('./WebGALPixiContainer');
const { Live2DFigureContainer } = await import('./Live2DFigureContainer');
const { ExternalStageObjectRegistry } = await import('./externalStageObjectRegistry');
const { startLive2DFrameDriver, getLive2DFrameDriverLifecycleStats } = await import('./live2dFrameDriver');
const { createLive2DAttachmentLayers, attachLive2DAttachmentLayers } = await import('./live2dAttachments');

afterAll(() => {
  (globalThis as unknown as { window: unknown }).window = previousWindow;
  PIXI.settings.ADAPTER.createCanvas = previousCreateCanvas;
});
beforeEach(() => {
  vi.clearAllMocks();
  Live2D.positioningType = 'M_3_1_0';
});

describe('COORD01 actual native layout bases', () => {
  it.each([
    ['left', 530, 540],
    ['center', 960, 540],
    ['right', 1390, 540],
  ] as const)('1920x1080 %s uses the host origin rather than a 2560x1440 constant', (position, x, y) => {
    const stage = Object.create(PixiStage.prototype);
    stage.stageWidth = 1920;
    stage.stageHeight = 1080;
    const container = new WebGALPixiContainer(),
      childContainer = modelFixture();
    stage.setContainerInitialPosition({
      container,
      childContainer,
      originalWidth: 1000,
      originalHeight: 2000,
      position,
      isLive2DFigure: true,
    });
    expect(container.getBasePosition()).toEqual({ x, y });
    container.destroy({ children: true });
  });
  it('named and multi-segment animation frames preserve sparse axes and convert author zero once', async () => {
    const { WebGAL } = await import('@/Core/WebGAL');
    const { getAnimationTimeline } = await import('@/Core/Modules/animationFunctions');
    const entity = { entityId: 'rose', attachmentLink: null, source: { freePositionOrigin: { x: 850, y: 800 } } };
    vi.mocked(stageStateManager.getCalculationStageState).mockReturnValue({
      stageEntities: [entity],
      effects: [{ target: 'rose', transform: { position: { x: 1000, y: 650 }, scale: { x: 1, y: 1 } } }],
    } as unknown as IStageState);
    Object.assign(WebGAL, {
      animationManager: {
        getAnimations: () => [
          {
            name: 'move',
            effects: [
              { position: { x: 0 }, duration: 0 },
              { position: { x: -180 }, duration: 900 },
            ],
          },
        ],
      },
    });
    expect(getAnimationTimeline('move', 'rose', false, false)?.map((frame) => frame.position)).toEqual([
      { x: 850 },
      { x: 670 },
    ]);
    expect(getAnimationTimeline('move', 'rose', false, true)?.map((frame) => frame.position)).toEqual([
      { x: 850, y: 650 },
      { x: 670, y: 650 },
    ]);
    expect(getAnimationTimeline('move', 'rose', true, true)?.map((frame) => frame.position)).toEqual([
      { x: 850, y: 800 },
      { x: 670, y: 800 },
    ]);
  });
  it.each([
    ['M_3_1_0', 'center', 1000, 2000, 1280, 720],
    ['M_3_1_0', 'left', 1000, 2000, 850, 720],
    ['M_3_1_0', 'right', 1000, 2000, 1710, 720],
    ['M_3_0_0', 'left', 4000, 1000, 850, 1040],
    ['M_2_4', 'left', 1000, 2000, 360, 720],
    ['M_2_4', 'right', 1000, 2000, 2200, 720],
    ['M_2_4', 'center', 4000, 1000, 1280, 1120],
    ['M_2_3', 'center', 1000, 2000, 0, 0],
    ['M_2_3', 'left', 1000, 2000, 540, 0],
    ['M_2_3', 'right', 1000, 2000, 2020, 0],
  ] as const)('%s %s %s x %s', (mode, position, originalWidth, originalHeight, x, y) => {
    Live2D.positioningType = mode;
    const stage = Object.create(PixiStage.prototype);
    stage.stageWidth = 2560;
    stage.stageHeight = 1440;
    const container = new WebGALPixiContainer(),
      childContainer = modelFixture();
    stage.setContainerInitialPosition({
      container,
      childContainer,
      originalWidth,
      originalHeight,
      position,
      isLive2DFigure: true,
    });
    expect(container.getBasePosition()).toEqual({ x, y });
    container.x = -180;
    container.y = -100;
    expect(container.position.x).toBe(x - 180);
    expect(container.position.y).toBe(y - 100);
    expect(container.getBasePosition()).toEqual({ x, y });
    container.destroy({ children: true });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function modelFixture() {
  const model = new PIXI.Container() as unknown as Live2DModel;
  const internal = new PIXI.utils.EventEmitter() as unknown as Live2DModel['internalModel'];
  Object.assign(internal, {
    destroyed: false,
    update: vi.fn(() => internal.emit('beforeMotionUpdate')),
    setBlinkParam: vi.fn(),
    focusController: { focus: vi.fn() },
    width: 100,
    height: 200,
  });
  Object.assign(model, {
    internalModel: internal,
    motion: vi.fn(),
    expression: vi.fn(),
    autoUpdate: true,
    deltaTime: 0,
    elapsedTime: 0,
    glContextID: 7,
    anchor: new PIXI.Point(),
    update: vi.fn((delta: number) => {
      model.deltaTime += delta;
      model.elapsedTime += delta;
    }),
  });
  vi.spyOn(model, 'destroy');
  vi.spyOn(model, 'getLocalBounds').mockReturnValue(new PIXI.Rectangle(-50, -100, 100, 200));
  return model;
}

function hostFixture() {
  const stage = Object.create(PixiStage.prototype) as InstanceType<typeof PixiStage>;
  const ticker = {
    started: false,
    start: vi.fn(function (this: { started: boolean }) {
      this.started = true;
    }),
    stop: vi.fn(function (this: { started: boolean }) {
      this.started = false;
    }),
    add: vi.fn(),
    remove: vi.fn(),
  };
  const main = new WebGALPixiContainer();
  Object.assign(stage, {
    figureObjects: [],
    backgroundObjects: [],
    figureContainer: new PIXI.Container(),
    backgroundContainer: new PIXI.Container(),
    mainStageContainer: main,
    mainStageObject: { uuid: 'stage', key: 'stage-main', pixiContainer: main, sourceType: 'stage' },
    stageAnimations: [],
    lockTransformTarget: [],
    live2dFigureRecorder: [],
    live2dFigureChangeListeners: new Set(),
    externalStageObjects: new ExternalStageObjectRegistry(),
    externalRenderActivities: new Set(),
    currentMouthValues: new Map(),
    referenceBoxWaiters: new Map(),
    isTickerUpdatePending: false,
    committedPixiStageState: stageStateManager.getViewStageState(),
    stageWidth: 2560,
    stageHeight: 1440,
    figureCash: [],
    assetLoader: { resources: {} },
    currentApp: { ticker, render: vi.fn() },
    requestRender: vi.fn(),
    loadAsset: (_url: string, run: () => void) => run(),
  });
  return { stage, ticker };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('5C exact figure generation adapter', () => {
  it('announces created before ready and retains new host positioning', async () => {
    const { stage } = hostFixture();
    const pending = deferred<Live2DModel>();
    vi.mocked(Live2D.Live2DModel.from).mockReturnValueOnce(pending.promise);
    const events: string[] = [];
    stage.subscribeLive2DFigureChanges((event) => events.push(event.type));
    stage.addLive2dFigure('fig-left', 'model.json', 'left');
    expect(stage.getActiveLive2DFigure('fig-left').status).toBe('loading');
    expect(events).toEqual(['created']);
    const model = modelFixture();
    pending.resolve(model);
    await flush();
    expect(events).toEqual(['created', 'ready']);
    expect(stage.getActiveLive2DFigure('fig-left').status).toBe('ready');
    expect(stage.figureObjects[0].pixiContainer?.getBasePosition().x).toBe(850);
    stage.removeStageObjectByUuid(stage.figureObjects[0].uuid);
    expect(events).toEqual(['created', 'ready', 'removed']);
  });

  it('destroys a late A model without changing replacement B', async () => {
    const { stage } = hostFixture();
    const a = deferred<Live2DModel>();
    const b = deferred<Live2DModel>();
    vi.mocked(Live2D.Live2DModel.from).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const ready: string[] = [];
    stage.subscribeLive2DFigureChanges((event) => {
      if (event.type === 'ready') ready.push(event.uuid);
    });
    stage.addLive2dFigure('fig-center', 'a.json', 'center');
    const oldUuid = stage.figureObjects[0].uuid;
    stage.addLive2dFigure('fig-center', 'b.json', 'center');
    const nextUuid = stage.figureObjects[0].uuid;
    const nextModel = modelFixture();
    b.resolve(nextModel);
    await flush();
    const lateModel = modelFixture();
    a.resolve(lateModel);
    await flush();
    expect(lateModel.destroy).toHaveBeenCalledTimes(1);
    expect(ready).toEqual([nextUuid]);
    expect(stage.figureObjects).toHaveLength(1);
    stage.removeStageObjectByUuid(oldUuid);
    expect(stage.getStageObjByUuid(nextUuid)?.pixiContainer?.children).toContain(nextModel);
    stage.removeStageObjectByUuid(nextUuid);
  });

  it('late model ready ignores a newer notify-only view until an explicit Pixi commit', async () => {
    const { stage } = hostFixture();
    const pending = deferred<Live2DModel>();
    vi.mocked(Live2D.Live2DModel.from).mockReturnValueOnce(pending.promise);
    const snapshot = {
      ...stageStateManager.getViewStageState(),
      live2dMotion: [{ target: 'hero', motion: 'committed-wave' }],
      live2dExpression: [{ target: 'hero', expression: 'committed-smile' }],
      figureMetaData: { hero: { zIndex: 3 } },
    } as IStageState;
    stage.setCommittedPixiState(snapshot);
    stage.addLive2dFigure('hero', 'a.json', 'center');
    snapshot.live2dMotion[0].motion = 'mutated-caller';
    const view = vi.spyOn(stageStateManager, 'getViewStageState').mockReturnValue({
      ...snapshot,
      live2dMotion: [{ target: 'hero', motion: 'notify-only-angry' }],
      live2dExpression: [{ target: 'hero', expression: 'notify-only-sad' }],
      figureMetaData: { hero: { zIndex: 10 } },
    });
    stage.setCommittedPixiEffects([]);
    const model = modelFixture();
    pending.resolve(model);
    await flush();
    expect(model.motion).toHaveBeenCalledWith('committed-wave', 0, 3);
    expect(model.expression).toHaveBeenCalledWith('committed-smile');
    expect(stage.getFigureMetadataByKey('hero')?.zIndex).toBe(3);
    stage.setCommittedPixiState(stageStateManager.getViewStageState());
    expect(stage.getFigureMetadataByKey('hero')?.zIndex).toBe(10);
    view.mockRestore();
    stage.removeStageObjectByUuid(stage.figureObjects[0].uuid);
  });

  it('late rejection cannot remove a new same-key generation', async () => {
    const { stage } = hostFixture();
    const a = deferred<Live2DModel>();
    vi.mocked(Live2D.Live2DModel.from).mockReturnValueOnce(a.promise).mockResolvedValueOnce(modelFixture());
    stage.addLive2dFigure('hero', 'a.json', 'center');
    stage.addLive2dFigure('hero', 'b.json', 'center');
    const nextUuid = stage.figureObjects[0].uuid;
    a.reject(new Error('late A failure'));
    await flush();
    expect(stage.figureObjects.map((item) => item.uuid)).toEqual([nextUuid]);
    stage.removeStageObjectByUuid(nextUuid);
  });

  it('reclaims a loaded model when initial positioning fails before container ownership', async () => {
    const { stage } = hostFixture();
    const model = modelFixture();
    vi.spyOn(model.anchor, 'set').mockImplementation(() => {
      throw new Error('position failure');
    });
    vi.mocked(Live2D.Live2DModel.from).mockResolvedValueOnce(model);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: string[] = [];
    stage.subscribeLive2DFigureChanges((event) => events.push(event.type));
    stage.addLive2dFigure('hero', 'failed.json', 'center');
    await flush();
    expect(model.destroy).toHaveBeenCalledTimes(1);
    expect(stage.figureObjects).toHaveLength(0);
    expect(events).toEqual(['created', 'removed']);
    log.mockRestore();
  });

  it('exit renaming keeps the logical removed key and refuses a late model', async () => {
    const { stage } = hostFixture();
    const pending = deferred<Live2DModel>();
    vi.mocked(Live2D.Live2DModel.from).mockReturnValueOnce(pending.promise);
    const events: Array<{ type: string; figureKey: string }> = [];
    stage.subscribeLive2DFigureChanges((event) => events.push(event));
    stage.addLive2dFigure('hero', 'a.json', 'center');
    const figure = stage.figureObjects[0];
    figure.key = 'hero-time-off';
    figure.isExiting = true;
    const lateModel = modelFixture();
    pending.resolve(lateModel);
    await flush();
    expect(lateModel.destroy).toHaveBeenCalledTimes(1);
    stage.removeStageObjectByUuid(figure.uuid);
    expect(events.map((event) => [event.type, event.figureKey])).toEqual([
      ['created', 'hero'],
      ['removed', 'hero'],
    ]);
  });

  it.each(['jsonl', 'wmdl'])('rejects %s attachment hosts while leaving native object intact', (sourceExt) => {
    const { stage } = hostFixture();
    const container = new WebGALPixiContainer();
    stage.figureObjects.push({
      uuid: 'aggregate',
      key: 'hero',
      pixiContainer: container,
      sourceType: 'live2d',
      sourceUrl: 'aggregate',
      sourceExt,
    });
    expect(stage.getActiveLive2DFigure('hero')).toEqual({
      status: 'unsupported',
      figureKey: 'hero',
      uuid: 'aggregate',
      sourceExt,
    });
    expect(container.destroyed).toBe(false);
    stage.removeStageObjectByUuid('aggregate');
  });

  it('isolates a throwing lifecycle subscriber and supports unsubscribe', () => {
    const { stage } = hostFixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const observer = vi.fn();
    stage.subscribeLive2DFigureChanges(() => {
      throw new Error('observer');
    });
    const unsubscribe = stage.subscribeLive2DFigureChanges(observer);
    const container = new Live2DFigureContainer();
    stage.figureObjects.push({
      uuid: 'a',
      key: 'hero',
      pixiContainer: container,
      sourceUrl: 'a.json',
      sourceExt: 'json',
      sourceType: 'live2d',
    });
    stage.removeStageObjectByUuid('a');
    unsubscribe();
    expect(observer).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('Live2D commands ignore front/back attachment containers', () => {
    const { stage } = hostFixture();
    const container = new Live2DFigureContainer();
    const model = modelFixture();
    container.addChild(new PIXI.Container(), model, new PIXI.Container());
    stage.figureObjects.push({
      uuid: 'a',
      key: 'hero',
      pixiContainer: container,
      sourceUrl: 'a.json',
      sourceExt: 'json',
      sourceType: 'live2d',
    });
    expect(() => {
      stage.changeModelMotionByKey('hero', 'wave');
      stage.changeModelExpressionByKey('hero', 'smile');
      stage.changeModelBlinkByKey('hero', {} as never);
      stage.changeModelFocusByKey('hero', { x: 0, y: 0, instant: true });
      stage.setModelMouthY('hero', 75);
      stage.resetMouthY('hero');
    }).not.toThrow();
    expect(model.motion).toHaveBeenCalledTimes(1);
    expect(model.expression).toHaveBeenCalledTimes(1);
    expect(stage.getActiveLive2DFigure('hero').status).toBe('ready');
    stage.removeStageObjectByUuid('a');
  });
});

describe('5C host reference bounds and external runtime ownership', () => {
  it('attachment planes do not enlarge native figure percentage reference bounds', () => {
    const container = new Live2DFigureContainer();
    const model = modelFixture();
    vi.spyOn(model, 'getLocalBounds').mockReturnValue(new PIXI.Rectangle(-50, -100, 100, 200));
    container.addChild(model);
    const before = container.getReferenceLocalBounds();
    const plane = new PIXI.Container();
    vi.spyOn(plane, 'getLocalBounds').mockReturnValue(new PIXI.Rectangle(-999, -999, 9999, 9999));
    container.addChild(plane);
    expect(container.getReferenceLocalBounds()).toEqual(before);
    const native = new WebGALPixiContainer();
    native.addChild(plane);
    expect(native.getReferenceLocalBounds()?.width).toBe(9999);
    expect(native.alphaFilterVal).toBe(1);
    expect(native.attachmentLocalAlpha).toBe(false);
    container.destroy({ children: true });
    native.destroy({ children: true });
  });

  it('external objects are addressable but never enter figure lifecycle lists', () => {
    const { stage } = hostFixture();
    const external = {
      uuid: 'e',
      key: 'hat',
      pixiContainer: new WebGALPixiContainer(),
      sourceUrl: '',
      sourceExt: '',
      sourceType: 'stage' as const,
    };
    stage.registerExternalStageObject(external);
    expect(stage.getStageObjByKey('hat')).toBe(external);
    expect(stage.getStageObjByUuid('e')).toBe(external);
    expect(stage.figureObjects).toHaveLength(0);
    expect(stage.getAllStageObj()).toContain(external);
    expect(() => stage.registerExternalStageObject({ ...external, key: 'stage-main' })).toThrow();
    stage.removeStageObjectByKey('hat');
    expect(stage.getExternalStageObjByKey('hat')).toBe(external);
    stage.unregisterExternalStageObjectByUuid('e');
    expect(stage.getStageObjByKey('hat')).toBeUndefined();
    external.pixiContainer.destroy();
  });

  it('activity tokens keep static/free work alive until the final idempotent release', async () => {
    const { stage, ticker } = hostFixture();
    const first = stage.acquireExternalRenderActivity();
    const second = stage.acquireExternalRenderActivity();
    await flush();
    expect(ticker.start).toHaveBeenCalledTimes(1);
    first();
    first();
    await flush();
    expect(ticker.stop).not.toHaveBeenCalled();
    second();
    await flush();
    expect(ticker.stop).toHaveBeenCalledTimes(1);
  });
});

describe('5C same-final-frame driver contract (instrumented renderer, not visual smoke)', () => {
  function driverFixture() {
    const model = modelFixture();
    const container = new Live2DFigureContainer();
    container.addChild(model);
    const layers = createLive2DAttachmentLayers(model);
    attachLive2DAttachmentLayers(container, model, layers);
    const rect = new PIXI.Rectangle(0, 0, 2560, 1440);
    const reset = () => ({ reset: vi.fn() });
    const renderer = {
      CONTEXT_UID: 7,
      framebuffer: { viewport: rect, reset: vi.fn() },
      batch: { flush: vi.fn(), reset: vi.fn() },
      geometry: reset(),
      shader: reset(),
      state: reset(),
      texture: reset(),
      renderTexture: { current: null, sourceFrame: rect, destinationFrame: rect, bind: vi.fn() },
      gl: { colorMask: vi.fn() },
    };
    let tick!: () => void;
    const ticker = {
      deltaMS: 16,
      add: vi.fn((callback: () => void) => {
        tick = callback;
      }),
      remove: vi.fn(),
    };
    const consumer = { update: vi.fn(), destroy: vi.fn(), syncVisualState: vi.fn() };
    const app = { ticker, renderer } as unknown as PIXI.Application;
    const driver = startLive2DFrameDriver({ app, key: 'hero', sourcePath: 'model.json', model, layers, consumer });
    const prepare = () =>
      (container as unknown as { renderPreparation: (value: unknown) => void }).renderPreparation(renderer);
    return { model, container, layers, renderer, ticker, consumer, driver, app, tick: () => tick(), prepare };
  }

  it('updates model once, final drawable state once, then both proxies in the same render', () => {
    const f = driverFixture();
    expect(f.model.autoUpdate).toBe(false);
    f.tick();
    expect(f.model.update).toHaveBeenCalledTimes(1);
    expect(f.model.internalModel.update).not.toHaveBeenCalled();
    const sequence: string[] = [];
    f.consumer.update.mockImplementation(() => sequence.push('consumer'));
    vi.spyOn(f.layers.back, 'updateTransform').mockImplementation(() => sequence.push('back'));
    vi.spyOn(f.layers.front, 'updateTransform').mockImplementation(() => sequence.push('front'));
    f.prepare();
    f.prepare();
    expect(f.model.internalModel.update).toHaveBeenCalledTimes(1);
    expect(f.consumer.update).toHaveBeenCalledTimes(1);
    expect(sequence).toEqual(['consumer', 'back', 'front']);
    expect(f.model.deltaTime).toBe(0);
    expect(f.driver.getStats().doubleUpdateCount).toBe(0);
    expect(
      startLive2DFrameDriver({
        app: f.app,
        key: 'hero',
        sourcePath: 'model.json',
        model: f.model,
        layers: f.layers,
        consumer: f.consumer,
      }),
    ).toBe(f.driver);
    f.driver.cleanup();
    f.driver.cleanup();
    expect(f.consumer.destroy).toHaveBeenCalledTimes(1);
    expect(f.model.autoUpdate).toBe(true);
    f.container.destroy({ children: true });
  });

  it('waits for native GL bootstrap then restores both planes even with zero delta', () => {
    const f = driverFixture();
    (f.model as unknown as { glContextID: number }).glContextID = -1;
    f.prepare();
    expect(f.layers.front.renderable).toBe(false);
    expect(f.layers.back.renderable).toBe(false);
    expect(f.model.internalModel.update).not.toHaveBeenCalled();
    (f.model as unknown as { glContextID: number }).glContextID = 7;
    f.prepare();
    expect(f.layers.front.renderable).toBe(true);
    expect(f.layers.back.renderable).toBe(true);
    f.driver.cleanup();
    f.container.destroy({ children: true });
  });

  it('a consumer can synchronously retire presentation without a stale layer access', () => {
    const f = driverFixture();
    f.consumer.update.mockImplementation(() => {
      f.driver.cleanup();
      f.layers.back.destroy();
      f.layers.front.destroy();
    });
    f.tick();
    expect(() => f.prepare()).not.toThrow();
    expect(f.consumer.destroy).toHaveBeenCalledTimes(1);
    expect(getLive2DFrameDriverLifecycleStats().driverCount).toBe(0);
    f.container.destroy({ children: true });
  });

  it('isolates internal-update failure, restores renderer state and disposes once', () => {
    const f = driverFixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(f.model.internalModel.update).mockImplementation(() => {
      throw new Error('SDK failure');
    });
    f.tick();
    expect(() => f.prepare()).not.toThrow();
    expect(f.renderer.renderTexture.bind).toHaveBeenCalledTimes(1);
    expect(f.model.deltaTime).toBe(0);
    expect(f.consumer.update).not.toHaveBeenCalled();
    expect(f.consumer.destroy).toHaveBeenCalledTimes(1);
    f.container.destroy({ children: true });
    log.mockRestore();
  });

  it('same model path in two figures owns two independent drivers and cleanups', () => {
    const a = driverFixture();
    const b = driverFixture();
    expect(getLive2DFrameDriverLifecycleStats().driverCount).toBe(2);
    a.tick();
    a.prepare();
    expect(a.consumer.update).toHaveBeenCalledTimes(1);
    expect(b.consumer.update).not.toHaveBeenCalled();
    a.driver.cleanup();
    b.tick();
    b.prepare();
    expect(b.consumer.update).toHaveBeenCalledTimes(1);
    b.driver.cleanup();
    expect(getLive2DFrameDriverLifecycleStats().driverCount).toBe(0);
    a.container.destroy({ children: true });
    b.container.destroy({ children: true });
  });

  it('one hundred rebuild cycles release every ticker and render hook exactly once', () => {
    const before = getLive2DFrameDriverLifecycleStats();
    for (let index = 0; index < 100; index += 1) {
      const f = driverFixture();
      f.tick();
      f.prepare();
      f.driver.cleanup();
      f.driver.cleanup();
      expect(f.ticker.remove).toHaveBeenCalledTimes(1);
      expect((f.container as unknown as { renderPreparation?: unknown }).renderPreparation).toBeUndefined();
      f.container.destroy({ children: true });
    }
    const after = getLive2DFrameDriverLifecycleStats();
    expect(after.driverCount).toBe(0);
    expect(after.createdCount - before.createdCount).toBe(100);
    expect(after.cleanupCount - before.cleanupCount).toBe(100);
  });
});
