import cloneDeep from 'lodash/cloneDeep';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStageObject } from './PixiController';
import type PixiStage from './PixiController';
import type { IResolvedStageCommitOptions } from '@/Core/Modules/stage/stageStateManager';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: { gameplay: { pixiStage: undefined, skipAnimation: false } },
}));
vi.mock('@/Core/Modules/animationFunctions', () => ({
  getExitAnimation: vi.fn(() => ({ duration: 120, animation: { duration: 120 } })),
}));
vi.mock('@/Core/util/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/Core/gameScripts/changeBg/setEbg', () => ({ setEbg: vi.fn() }));
vi.mock('@/Core/controller/stage/pixi/stageEffectTransform', () => ({ applyTransformToPixiContainer: vi.fn() }));
vi.mock('./attachments/attachmentStageBridge', () => ({
  AttachmentStageBridge: class {
    syncCommittedView = vi.fn();
    observeCommittedEffects = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('./attachments/attachmentRuntimeSingleton', () => ({
  attachmentRuntime: { setTransformTargetRemover: vi.fn(), reset: vi.fn() },
}));
vi.mock('@/Core/gameScripts/transform/performEntityTransform', () => ({ removeEntityTransformOnTarget: vi.fn() }));

const { WebGAL } = await import('@/Core/WebGAL');
const { initState } = await import('@/Core/Modules/stage/stageStateManager');
const { disposeAttachmentStageBridge, syncPixiStageState } = await import('./syncPixiStageState');

const previousWindow = globalThis.window;
(globalThis as unknown as { window: unknown }).window = { location: { origin: 'http://fixture.invalid' } };

afterAll(() => {
  disposeAttachmentStageBridge();
  (globalThis as unknown as { window: unknown }).window = previousWindow;
});

interface FigureFixture extends IStageObject {
  sourceUrl: string;
  isExiting: boolean;
}

function figureFixture(uuid: string, isExiting: boolean): FigureFixture {
  return {
    uuid,
    key: 'creator-current-preview',
    sourceUrl: 'anon/school_winter-2023/model.json',
    sourceType: 'live2d',
    figureIdentity: JSON.stringify(['anon/school_winter-2023/model.json', 'center', [0, 0, 0, 0]]),
    isExiting,
  } as FigureFixture;
}

function hostFixture(initial: FigureFixture) {
  const figures: FigureFixture[] = [initial];
  let sequence = 0;
  const host = {
    getStageObjByKey: vi.fn((key: string) => figures.find((figure) => figure.key === key)),
    getFigureObjects: vi.fn(() => figures),
    removeAnimationWithSetEffects: vi.fn(),
    removeAnimation: vi.fn(),
    removeStageObjectByUuid: vi.fn((uuid: string) => {
      const index = figures.findIndex((figure) => figure.uuid === uuid);
      if (index >= 0) figures.splice(index, 1);
    }),
    registerAnimation: vi.fn(),
    addLive2dFigure: vi.fn((key: string, sourceUrl: string) => {
      figures.push({
        uuid: `new-generation-${++sequence}`,
        key,
        sourceUrl,
        sourceType: 'live2d',
        isExiting: false,
      } as FigureFixture);
    }),
    setCommittedPixiState: vi.fn(),
    setCommittedPixiEffects: vi.fn(),
    changeSpineSkinByKey: vi.fn(),
    changeModelMotionByKey: vi.fn(),
    changeModelExpressionByKey: vi.fn(),
    changeModelBlinkByKey: vi.fn(),
    changeModelFocusByKey: vi.fn(),
  } as unknown as PixiStage;
  return { figures, host };
}

function committedFigureState() {
  const state = cloneDeep(initState);
  state.freeFigure = [
    {
      key: 'creator-current-preview',
      name: 'anon/school_winter-2023/model.json',
      basePosition: 'center',
    },
  ];
  state.effects = [];
  return state;
}

function commit(host: PixiStage, skipAnimation: boolean) {
  Object.assign(WebGAL.gameplay, { pixiStage: host });
  syncPixiStageState(committedFigureState(), {
    syncPixiStage: true,
    applyPixiEffects: false,
    notifyReact: false,
    skipAnimation,
  } satisfies IResolvedStageCommitOptions);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  Object.assign(WebGAL.gameplay, { pixiStage: null, skipAnimation: false });
});

describe('same-source figure generation reconciliation', () => {
  it('keeps an active same-source generation as a no-op', () => {
    const original = figureFixture('active-generation', false);
    const { figures, host } = hostFixture(original);

    commit(host, false);

    expect(host.addLive2dFigure).not.toHaveBeenCalled();
    expect(host.removeStageObjectByUuid).not.toHaveBeenCalled();
    expect(figures).toEqual([original]);
    expect(original.isExiting).toBe(false);
  });

  it('replaces a generation marked exiting between repeated same-source preview commits', () => {
    vi.useFakeTimers();
    const original = figureFixture('exiting-generation', false);
    const { figures, host } = hostFixture(original);

    commit(host, false);
    expect(host.addLive2dFigure).not.toHaveBeenCalled();

    // A reset without a Pixi commit followed by changeFigure replay marks the
    // retained view generation exiting before the target-scene commit.
    original.isExiting = true;
    commit(host, false);

    expect(host.addLive2dFigure).toHaveBeenCalledTimes(1);
    expect(host.addLive2dFigure).toHaveBeenCalledWith(
      'creator-current-preview',
      'anon/school_winter-2023/model.json',
      'center',
    );
    expect(figures.find((figure) => figure.uuid === 'new-generation-1')).toMatchObject({
      key: 'creator-current-preview',
      isExiting: false,
    });
    expect(original).toMatchObject({
      key: 'creator-current-preview-exiting-generation-off',
      attachmentFigureKey: 'creator-current-preview',
      isExiting: true,
    });
    vi.runAllTimers();
    expect(figures.map((figure) => figure.uuid)).toEqual(['new-generation-1']);
  });

  it('removes an exiting same-source generation by UUID before a skip-animation replacement', () => {
    const original = figureFixture('exiting-generation', true);
    const { figures, host } = hostFixture(original);

    commit(host, true);

    expect(host.removeStageObjectByUuid).toHaveBeenCalledWith('exiting-generation');
    expect(host.addLive2dFigure).toHaveBeenCalledTimes(1);
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({
      uuid: 'new-generation-1',
      key: 'creator-current-preview',
      sourceUrl: 'anon/school_winter-2023/model.json',
      isExiting: false,
    });
  });
});
