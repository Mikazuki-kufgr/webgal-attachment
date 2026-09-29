import type PixiStage from '../../PixiController';
import type { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import type { AttachmentRuntime } from '../AttachmentRuntime';
import { normalizeGameAssetPath } from '../configLoader';
import { hasCubism2HandRenderCapability } from '../Cubism2HandRenderer';

type CreatorStage = Pick<
  PixiStage,
  'getActiveLive2DFigure' | 'getStageObjByKey' | 'removeStageObjectByUuid' | 'subscribeLive2DFigureChanges'
>;
type CreatorManager = Pick<
  StageStateManager,
  'getViewStageState' | 'isCalculationSynchronizedWithView' | 'setStage' | 'commit'
>;
const replacements = new WeakMap<object, AbortController>();

/** Wait only for this exact model generation's Cubism2 draw context. */
export async function waitForCreatorHandRenderer(options: {
  stage: Pick<CreatorStage, 'getActiveLive2DFigure'>;
  figureKey: string;
  generation: string;
  current: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  while (options.current() && !options.signal?.aborted) {
    const active = options.stage.getActiveLive2DFigure(options.figureKey);
    if (active.status !== 'ready' || active.figure.uuid !== options.generation)
      throw new Error('CREATOR_FIGURE_GENERATION_CHANGED');
    if (hasCubism2HandRenderCapability(active.figure.model)) return true;
    if (Date.now() >= deadline)
      throw new Error('HAND_RUNTIME_CAPABILITY_TIMEOUT:当前立绘的手部绘制能力未就绪；请重新载入立绘或检查模型兼容性');
    await new Promise<void>(resolve => setTimeout(resolve, 16));
  }
  return false;
}

export function cancelCreatorFigureReplacement(stage: CreatorStage) {
  replacements.get(stage)?.abort();
  replacements.delete(stage);
}

/** One explicit Creator replacement through the real committed stage path. No polling or private sprite. */
export async function replaceCreatorFigure(options: {
  stage: CreatorStage;
  manager: CreatorManager;
  runtime: Pick<AttachmentRuntime, 'waitForFigureGeneration' | 'figureGeneration'>;
  profile: { modelPath: string };
  selectedKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ figureKey: string; generation: string }> {
  const { stage, manager, runtime, signal } = options;
  cancelCreatorFigureReplacement(stage);
  if (signal?.aborted) throw new Error('CREATOR_FIGURE_REPLACEMENT_CANCELLED');
  if (!manager.isCalculationSynchronizedWithView()) throw new Error('CREATOR_STAGE_CALCULATION_PENDING');
  const source = normalizeGameAssetPath(options.profile.modelPath);
  if (
    !source.startsWith('game/figure/') ||
    !source.toLowerCase().endsWith('.json') ||
    source.split('/').some((segment) => !segment || segment === '..' || segment === '.') ||
    /[\x00-\x1f?#]/.test(options.profile.modelPath)
  )
    throw new Error('CREATOR_FIGURE_MODEL_PATH_INVALID');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('CREATOR_FIGURE_TIMEOUT_INVALID');
  const state = manager.getViewStageState();
  const selected =
    state.freeFigure.find((figure) => figure.key === options.selectedKey) ??
    state.freeFigure.find((figure) => figure.key === 'authoring-model') ??
    state.freeFigure[0];
  const figureKey = selected?.key ?? 'authoring-model';
  const old = stage.getStageObjByKey(figureKey);
  const legacy =
    figureKey === 'creator-library-preview' ? undefined : stage.getStageObjByKey('creator-library-preview');
  const controller = new AbortController();
  replacements.set(stage, controller);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + timeoutMs;
  let unsubscribe: () => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  let settled = false;
  const cancelled = () => {
    if (settled) return;
    settled = true;
    rejectReady(new Error('CREATOR_FIGURE_REPLACEMENT_CANCELLED'));
  };
  controller.signal.addEventListener('abort', cancelled, { once: true });
  try {
    const generation = await new Promise<string>((resolve, reject) => {
      rejectReady = reject;
      const inspect = () => {
        if (settled || controller.signal.aborted) return;
        const active = stage.getActiveLive2DFigure(figureKey);
        if (
          active.status === 'ready' &&
          active.figure.uuid !== old?.uuid &&
          active.figure.normalizedSourceUrl === source
        ) {
          settled = true;
          resolve(active.figure.uuid);
        } else if (active.status === 'ambiguous' || active.status === 'unsupported' || active.status === 'not-live2d') {
          settled = true;
          reject(new Error(`CREATOR_FIGURE_${active.status.toUpperCase().replace(/-/g, '_')}`));
        }
      };
      unsubscribe = stage.subscribeLive2DFigureChanges((event) => {
        if (event.figureKey === figureKey) inspect();
      });
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`CREATOR_LIBRARY_FIGURE_READY_TIMEOUT:${figureKey}`));
        }
      }, timeoutMs);
      try {
        // Validation occurs before removing the outgoing Pixi owner. These
        // synchronous operations cannot be interleaved by a later UI request.
        manager.setStage('freeFigure', [
          ...state.freeFigure.filter((figure) => figure.key !== figureKey && figure.key !== 'creator-library-preview'),
          { key: figureKey, name: `./${source}`, basePosition: selected?.basePosition ?? 'center' },
        ]);
        if (old) stage.removeStageObjectByUuid(old.uuid);
        if (legacy) stage.removeStageObjectByUuid(legacy.uuid);
        manager.commit({ skipAnimation: true });
        inspect();
      } catch (error) {
        settled = true;
        reject(error);
      }
    });
    clearTimeout(timer);
    unsubscribe();
    await runtime.waitForFigureGeneration(figureKey, generation, Math.max(1, deadline - Date.now()), controller.signal);
    const active = stage.getActiveLive2DFigure(figureKey);
    if (controller.signal.aborted || replacements.get(stage) !== controller)
      throw new Error('CREATOR_FIGURE_REPLACEMENT_CANCELLED');
    if (
      active.status !== 'ready' ||
      active.figure.uuid !== generation ||
      active.figure.normalizedSourceUrl !== source ||
      runtime.figureGeneration(figureKey) !== generation
    )
      throw new Error('CREATOR_FIGURE_GENERATION_CHANGED');
    return { figureKey, generation };
  } finally {
    clearTimeout(timer);
    unsubscribe();
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancelled);
    if (replacements.get(stage) === controller) replacements.delete(stage);
  }
}
