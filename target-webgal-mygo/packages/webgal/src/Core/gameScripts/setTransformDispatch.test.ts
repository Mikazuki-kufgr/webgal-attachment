import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { stageStateManager, initState } from '@/Core/Modules/stage/stageStateManager';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import { getAttachmentCommandPresentationCounts } from '@/Core/controller/stage/pixi/attachments/attachmentCommandPresentation';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';

vi.mock('@/Core/WebGAL', () => ({
  WebGAL: {
    animationManager: { addAnimation: vi.fn() },
    gameplay: {
      performController: { unmountPerform: vi.fn(), completePerform: vi.fn() },
      pixiStage: {
        stopPresetAnimationOnTarget: vi.fn(),
        registerAnimation: vi.fn(),
        removeAnimation: vi.fn(),
        removeAnimationWithoutSetEndState: vi.fn(),
      },
    },
  },
}));
vi.mock('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton', () => ({
  attachmentRuntime: {
    getEntity: vi.fn(),
    setEntityVisualState: vi.fn(),
    subscribe: vi.fn(),
  },
}));
vi.mock('@/Core/controller/stage/pixi/animations/generateTransformAnimationObj', () => ({
  generateTransformAnimationObj: vi.fn(() => [{ duration: 123, ease: 'linear' }]),
}));
vi.mock('@/Core/Modules/animationFunctions', () => ({
  applyAnimationEndState: vi.fn(() => [{ duration: 123, ease: 'linear' }]),
  getAnimateDuration: vi.fn(() => 123),
}));
vi.mock('@/Core/controller/stage/pixi/animations/timeline', () => ({
  generateTimelineObj: vi.fn(() => ({ setStartState: () => {}, setEndState: () => {}, tickerFunc: () => {} })),
}));
vi.mock('uuid', () => ({ v4: () => 'test-native-uuid' }));
vi.mock('@/Core/util/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/Core/controller/stage/pixi/PixiController', () => ({ default: {} }));
vi.mock('@/Core/controller/stage/pixi/syncPixiStageState', () => ({ refreshAttachmentPresentation: vi.fn() }));

// Cached Vitest 0.28 requires explicit registration before entering the gameplay graph.
const { setTransform } = await import('./setTransform');
const { WebGAL } = await import('@/Core/WebGAL');
const { generateTransformAnimationObj } = await import(
  '@/Core/controller/stage/pixi/animations/generateTransformAnimationObj'
);
const { applyAnimationEndState } = await import('@/Core/Modules/animationFunctions');
const { generateTimelineObj } = await import('@/Core/controller/stage/pixi/animations/timeline');
const { attachmentRuntime } = await import('@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  stageStateManager.resetAllStageState(cloneDeep(initState));
});
afterEach(() => {
  vi.useRealTimers();
});
function sentence(
  target: string,
  options: Record<string, string | boolean | number> = {},
  content = '{"position":{"x":20}}',
): ISentence {
  return {
    command: commandType.setTransform,
    commandRaw: 'setTransform',
    content,
    args: [{ key: 'target', value: target }, ...Object.entries(options).map(([key, value]) => ({ key, value }))],
    sentenceAssets: [],
    subScene: [],
    inlineComment: '',
    isLineBreakHolder: false,
  };
}
function legacy() {
  const row = {
    figureKey: 'fig-center',
    attachmentId: 'hat',
    configId: 'ear-preset',
    semanticAnchor: 'ear-left',
    visible: false,
  };
  const id = deriveLegacyAttachmentEntityId(row.figureKey, row.attachmentId);
  stageStateManager.applyStageEntityTransaction({
    kind: 'upsert-legacy-attachment',
    attachment: row,
    canonicalEntityId: id,
  });
  stageStateManager.commit();
  return { row, id };
}

describe('setTransform actual command front door', () => {
  it('recognizes exact legacy derived identity, promotes only calculation, and preserves anchor/alias/visibility', () => {
    const { id } = legacy(),
      view = stageStateManager.getViewStageState();
    const p = setTransform(sentence(id));
    expect(stageStateManager.getViewStageState()).toBe(view);
    const entity = stageStateManager.getCalculationStageState().stageEntities[0];
    expect(entity.entityId).toBe(id);
    expect(entity.attachmentLink?.semanticAnchor).toBe('ear-left');
    expect(entity.source.legacyAlias).toEqual({ originFigureKey: 'fig-center', attachmentId: 'hat' });
    expect(entity.visualState.visible).toBe(false);
    expect(entity.visualState.position.x).toBe(20);
    expect(generateTransformAnimationObj).not.toHaveBeenCalled();
    expect(WebGAL.gameplay.performController.unmountPerform).not.toHaveBeenCalled();
    expect(attachmentRuntime.getEntity).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    p.onDiscard?.();
    expect(getAttachmentCommandPresentationCounts().visuals).toBe(0);
  });
  it('validates an invalid legacy transform against virtual promotion without changing any state', () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { id } = legacy(),
      calc = stageStateManager.getCalculationStageState(),
      view = stageStateManager.getViewStageState();
    const p = setTransform(sentence(id, {}, '{"mask":{}}'));
    expect(p.blockingAuto()).toBe(false);
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENTITY_EFFECT_INCOMPATIBLE' }));
    expect(stageStateManager.getCalculationStageState()).toBe(calc);
    expect(stageStateManager.getViewStageState()).toBe(view);
    expect(calc.stageEntities).toHaveLength(0);
    expect(getAttachmentCommandPresentationCounts().visuals).toBe(0);
    diagnostic.mockRestore();
  });
  it('entity duration accepts finite numeric strings but rejects booleans, blank and nonfinite coercion', () => {
    const { id } = legacy();
    for (const value of [true, false, '', '  ', Number.NaN, Number.POSITIVE_INFINITY, 'Infinity']) {
      const p = setTransform(sentence(id, { duration: value }));
      expect(p.duration).toBe(500);
      p.onDiscard?.();
    }
    for (const [value, expected] of [
      ['450', 450],
      [-20, 0],
      [0, 0],
    ] as const) {
      const p = setTransform(sentence(id, { duration: value }));
      expect(p.duration).toBe(expected);
      p.onDiscard?.();
    }
  });
  it('invalid explicit entity transforms report a typed command diagnostic without throwing or changing state', () => {
    const { id } = legacy();
    setTransform(sentence(id)).onDiscard?.();
    const calc = stageStateManager.getCalculationStageState(),
      view = stageStateManager.getViewStageState();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const content of ['not json', '{"alpha":2}', '{"oldFilm":1}']) {
      expect(() => setTransform(sentence(id, {}, content))).not.toThrow();
      expect(stageStateManager.getCalculationStageState()).toBe(calc);
      expect(stageStateManager.getViewStageState()).toBe(view);
    }
    expect(diagnostic).toHaveBeenCalledTimes(3);
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENTITY_EFFECT_INCOMPATIBLE' }));
    diagnostic.mockRestore();
  });
  it('does not fuzzy-match an attachment display/id fragment to an entity', () => {
    legacy();
    const p = setTransform(sentence('hat'));
    expect(p.performName).toBe('animation-hat');
    expect(generateTransformAnimationObj).toHaveBeenCalledWith('hat', expect.any(Object), 500, '', true);
    expect(stageStateManager.getCalculationStageState().stageEntities).toHaveLength(0);
  });
  it('native default mode retains upstream replacement, duration, defaults, registration and terminal write', () => {
    const p = setTransform(sentence('fig-center', { duration: 450, ease: 'linear', writeDefault: true }));
    expect(WebGAL.gameplay.performController.unmountPerform).toHaveBeenCalledWith('animation-fig-center', true);
    expect(generateTransformAnimationObj).toHaveBeenCalledWith('fig-center', expect.any(Object), 450, 'linear', true);
    expect(applyAnimationEndState).toHaveBeenCalledWith('test-native-uuid', 'fig-center', true, true);
    expect(p.duration).toBe(123);
    expect(p.isHoldOn).toBe(false);
    expect(p.blockingAuto()).toBe(true);
    expect(WebGAL.gameplay.pixiStage!.registerAnimation).not.toHaveBeenCalled();
    p.startFunction?.();
    expect(generateTimelineObj).toHaveBeenCalledWith(expect.any(Array), 'fig-center', 123, expect.any(Function));
    const finish = vi.mocked(generateTimelineObj).mock.calls[0][3];
    finish?.();
    expect(WebGAL.gameplay.performController.completePerform).toHaveBeenCalledWith(p, 'natural');
    p.stopFunction();
    expect(WebGAL.gameplay.pixiStage!.removeAnimation).toHaveBeenCalledWith(
      'fig-center-test-native-uuid-123',
    );
  });
  it('native parallel keep mode retains unique name, partial effects and freeze-on-stop/restart suppression', () => {
    const p = setTransform(sentence('bg-main', { parallel: true, keep: true }));
    expect(p.performName).toBe('animation-bg-main#test-native-uuid');
    expect(p.isHoldOn).toBe(true);
    expect(p.blockingAuto()).toBe(false);
    expect(WebGAL.gameplay.performController.unmountPerform).not.toHaveBeenCalled();
    expect(generateTransformAnimationObj).toHaveBeenCalledWith('bg-main', expect.any(Object), 500, '', false);
    expect(applyAnimationEndState).toHaveBeenCalledWith('test-native-uuid', 'bg-main', false, false);
    p.startFunction?.();
    vi.mocked(generateTimelineObj).mock.calls[0][3]?.();
    expect(WebGAL.gameplay.performController.completePerform).not.toHaveBeenCalled();
    p.stopFunction();
    p.startFunction?.();
    expect(WebGAL.gameplay.pixiStage!.registerAnimation).toHaveBeenCalledTimes(1);
    expect(WebGAL.gameplay.pixiStage!.removeAnimationWithoutSetEndState).toHaveBeenCalledWith(
      'bg-main-test-native-uuid-123',
    );
    expect(WebGAL.gameplay.pixiStage!.removeAnimation).not.toHaveBeenCalled();
  });
  it('native ignoreDefault remains partial while ordinary replacement still occurs', () => {
    const p = setTransform(sentence('fig-left', { ignoreDefault: true }));
    expect(p.performName).toBe('animation-fig-left');
    expect(applyAnimationEndState).toHaveBeenCalledWith('test-native-uuid', 'fig-left', false, false);
    expect(WebGAL.gameplay.performController.unmountPerform).toHaveBeenCalledWith('animation-fig-left', true);
  });
});
