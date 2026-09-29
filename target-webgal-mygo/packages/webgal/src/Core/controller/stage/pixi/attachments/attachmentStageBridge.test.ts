import { describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import {
  initialLegacyAttachmentLocalVisualState,
  legacyAttachmentLink,
} from '@/Core/Modules/stage/stageEntityStateTransaction';
import type { IAttachmentState, StageEntityStateV0 } from '@/Core/Modules/stage/stageInterface';
import type { ActiveLive2DFigureResult, Live2DFigureChangeEvent } from '../PixiController';
import type {
  AttachmentDeclaration,
  AttachmentFigureTarget,
  AttachmentInstanceSnapshot,
  AttachmentRuntimeEvent,
  FreeAttachmentDeclaration,
} from './types';
import {
  AttachmentStageBridge,
  attachmentDeclarationsFromStage,
  freeAttachmentDeclarationsFromStage,
  type AttachmentBridgeHost,
  type AttachmentBridgeRuntime,
} from './attachmentStageBridge';
import { deriveLegacyAttachmentEntityId } from './stageEntityIdentity';
import {
  reserveEntityVisualPresentation,
  reserveEntityVisibilityPresentation,
  protectAttachmentAddFailure,
  projectAttachmentCommandPresentation,
} from './attachmentCommandPresentation';

function setup(explicit = false) {
  const manager = new StageStateManager();
  manager.setStage('figName', 'model-a.json');
  const row: IAttachmentState = { figureKey: 'fig-center', attachmentId: 'hat', configId: 'hat-a', visible: true };
  if (explicit) {
    row.entityId = 'entity-hat';
    const visual = initialLegacyAttachmentLocalVisualState(true);
    const entity: StageEntityStateV0 = {
      schemaVersion: 0,
      entityId: row.entityId,
      renderableKind: 'attachment-sprite-group',
      source: {
        configId: row.configId,
        legacyAlias: { originFigureKey: row.figureKey, attachmentId: row.attachmentId },
      },
      visualState: visual,
      attachmentLink: legacyAttachmentLink(row, visual),
    };
    manager.applyStageEntityTransaction({
      kind: 'upsert-explicit-attachment',
      attachment: { ...row, entityId: row.entityId },
      entity,
    });
  } else
    manager.applyStageEntityTransaction({
      kind: 'upsert-legacy-attachment',
      attachment: row,
      canonicalEntityId: deriveLegacyAttachmentEntityId(row.figureKey, row.attachmentId),
    });
  manager.commit();
  let figureListener: (event: Live2DFigureChangeEvent) => void = () => {};
  let runtimeListener: (event: AttachmentRuntimeEvent) => void = () => {};
  let lookup: ActiveLive2DFigureResult = { status: 'absent', figureKey: 'fig-center' };
  let freeEntityCount = 0;
  const generations = new Map<string, string>();
  const release = vi.fn();
  const unsubFigure = vi.fn();
  const unsubRuntime = vi.fn();
  const host = {
    currentApp: {},
    getActiveLive2DFigure: vi.fn(() => lookup),
    subscribeLive2DFigureChanges: vi.fn((listener: typeof figureListener) => {
      figureListener = listener;
      return unsubFigure;
    }),
    requestRender: vi.fn(),
    acquireExternalRenderActivity: vi.fn(() => release),
  };
  const runtime = {
    registerFigure: vi.fn((target: AttachmentFigureTarget) => {
      generations.set(target.key, target.generation);
    }),
    unregisterFigure: vi.fn((key: string, generation?: string) => {
      if (generations.get(key) !== generation) return false;
      generations.delete(key);
      return true;
    }),
    beginFigureReplacement: vi.fn((key: string, generation: string) => {
      if (generations.get(key) === generation) return false;
      generations.delete(key);
      return true;
    }),
    hasFigureGeneration: vi.fn((key: string) => generations.has(key)),
    figureGeneration: vi.fn((key: string) => generations.get(key)),
    reconcile: vi.fn(
      (
        _attached: readonly AttachmentDeclaration[],
        _free?: readonly FreeAttachmentDeclaration[],
      ): Promise<AttachmentInstanceSnapshot[]> => Promise.resolve([]),
    ),
    subscribe: vi.fn((listener: typeof runtimeListener) => {
      runtimeListener = listener;
      return unsubRuntime;
    }),
    getDiagnostics: vi.fn(() => ({ freeEntityCount })),
  };
  const report = vi.fn();
  const bridge = new AttachmentStageBridge(
    host as unknown as AttachmentBridgeHost,
    runtime as unknown as AttachmentBridgeRuntime,
    manager,
    report,
  );
  const commit = () => bridge.syncCommittedView(manager.getViewStageState());
  const figure = (type: Live2DFigureChangeEvent['type'], uuid = 'generation-a') =>
    figureListener({ type, uuid, figureKey: 'fig-center', sourceUrl: 'model-a.json' });
  const error = (overrides: Partial<AttachmentInstanceSnapshot> = {}) =>
    runtimeListener({
      type: 'instance-error',
      instance: {
        figureKey: row.figureKey,
        attachmentId: row.attachmentId,
        configId: row.configId,
        entityId: row.entityId ?? deriveLegacyAttachmentEntityId(row.figureKey, row.attachmentId),
        figureGeneration: 'generation-a',
        phase: 'error',
        errorCode: 'MODEL_INCOMPATIBLE',
        visible: true,
        ...overrides,
        firstValidPose: overrides.firstValidPose ?? { status: 'pending' },
      },
    });
  return {
    manager,
    bridge,
    runtime,
    host,
    report,
    row,
    generations,
    commit,
    figure,
    error,
    release,
    unsubFigure,
    unsubRuntime,
    setLookup: (value: ActiveLive2DFigureResult) => {
      lookup = value;
    },
    setFreeCount: (value: number) => {
      freeEntityCount = value;
    },
    event: (event: AttachmentRuntimeEvent) => runtimeListener(event),
  };
}

describe('view-only attachment bridge (structural host ports; no GPU claim)', () => {
  it('5D effects-only sync preserves pending transform starting pose until its actual host can start', async () => {
    const f = setup(true),
      before = cloneDeep(f.manager.getViewStageState().stageEntities[0].visualState);
    f.manager.updateEffect({ target: 'entity-hat', transform: { position: { x: 300, y: 90 } } });
    const expected = f.manager.getCalculationStageState().stageEntities[0];
    const reservation = reserveEntityVisualPresentation('entity-hat', expected, before);
    try {
      f.manager.commit();
      f.commit();
      f.bridge.observeCommittedEffects(f.manager.getViewStageState());
      await f.bridge.whenSettled();
      const latest = f.runtime.reconcile.mock.calls[f.runtime.reconcile.mock.calls.length - 1][0][0];
      expect(latest.visualState?.position).toEqual(before.position);
      expect(f.manager.getViewStageState().stageEntities[0].visualState.position).toEqual({ x: 300, y: 90 });
      reservation.release();
      f.commit();
      await f.bridge.whenSettled();
      expect(
        f.runtime.reconcile.mock.calls[f.runtime.reconcile.mock.calls.length - 1][0][0].visualState?.position,
      ).toEqual({ x: 300, y: 90 });
    } finally {
      reservation.release();
      f.bridge.dispose();
    }
  });
  it('5D visual and visibility reservations compose and an older release cannot erase a successor', () => {
    const f = setup(true),
      entity = f.manager.getViewStageState().stageEntities[0];
    const first = reserveEntityVisibilityPresentation('entity-hat', f.manager.getViewStageState(), false);
    const next = reserveEntityVisibilityPresentation('entity-hat', f.manager.getViewStageState(), true);
    const visual = reserveEntityVisualPresentation('entity-hat', entity, {
      ...entity.visualState,
      position: { x: 8, y: 9 },
      visible: false,
    });
    try {
      first.release();
      const projected = projectAttachmentCommandPresentation(f.manager.getViewStageState());
      expect(projected.attachments[0].visible).toBe(true);
      expect(projected.stageEntities[0].visualState.visible).toBe(true);
      expect(projected.stageEntities[0].visualState.position).toEqual({ x: 8, y: 9 });
      expect(f.manager.getViewStageState().stageEntities[0].visualState.position).not.toEqual({ x: 8, y: 9 });
    } finally {
      first.release();
      next.release();
      visual.release();
      f.bridge.dispose();
    }
  });
  it('5D command-owned add failure is not stolen by generic remove-only compensation', async () => {
    const f = setup();
    f.generations.set('fig-center', 'generation-a');
    f.commit();
    await f.bridge.whenSettled();
    const reservation = protectAttachmentAddFailure(f.manager.getViewStageState().attachments[0]);
    try {
      f.error();
      expect(f.manager.getViewStageState().attachments).toHaveLength(1);
      reservation.release();
      f.error();
      expect(f.manager.getViewStageState().attachments).toHaveLength(0);
      await f.bridge.whenSettled();
    } finally {
      reservation.release();
      f.bridge.dispose();
    }
  });
  it('ignores calculation state and accepts only the exact committed view', async () => {
    const f = setup();
    f.manager.setStage('showText', 'uncommitted');
    f.bridge.syncCommittedView(f.manager.getCalculationStageState());
    expect(f.runtime.reconcile).not.toHaveBeenCalled();
    f.commit();
    await f.bridge.whenSettled();
    expect(f.runtime.reconcile).toHaveBeenCalledTimes(1);
    expect(f.runtime.reconcile.mock.calls[0][0][0].configId).toBe('hat-a');
    f.bridge.dispose();
  });
  it('does not wait for a slow A before synchronously forwarding remove/B/A views', async () => {
    const f = setup();
    let finish!: (value: AttachmentInstanceSnapshot[]) => void;
    f.runtime.reconcile.mockImplementationOnce(
      () =>
        new Promise<AttachmentInstanceSnapshot[]>((resolve) => {
          finish = resolve;
        }),
    );
    f.commit();
    f.manager.applyStageEntityTransaction({ kind: 'remove', expectedAttachment: f.row });
    f.manager.commit();
    f.commit();
    expect(f.runtime.reconcile.mock.calls[1][0]).toEqual([]);
    for (const configId of ['hat-b', 'hat-a']) {
      const attachment = { ...f.row, configId };
      f.manager.applyStageEntityTransaction({
        kind: 'upsert-legacy-attachment',
        attachment,
        canonicalEntityId: deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId),
      });
      f.manager.commit();
      f.commit();
    }
    expect(f.runtime.reconcile.mock.calls.map((call) => call[0][0]?.configId)).toEqual([
      'hat-a',
      undefined,
      'hat-b',
      'hat-a',
    ]);
    finish([]);
    await f.bridge.whenSettled();
    f.bridge.dispose();
  });
  it('registers the exact ready model UUID and retires synchronously on created', async () => {
    const f = setup();
    f.setLookup({
      status: 'ready',
      figure: {
        key: 'fig-center',
        uuid: 'generation-a',
        sourceUrl: 'model-a.json',
        normalizedSourceUrl: 'model-a.json',
        isExiting: false,
        outerContainer: {},
        model: {},
      },
    } as unknown as ActiveLive2DFigureResult);
    f.commit();
    expect(f.runtime.registerFigure.mock.calls[0][0]).toMatchObject({
      key: 'fig-center',
      generation: 'generation-a',
      sourcePath: 'model-a.json',
    });
    f.figure('created', 'generation-b');
    expect(f.runtime.beginFigureReplacement).toHaveBeenLastCalledWith('fig-center', 'generation-b');
    f.setLookup({ status: 'absent', figureKey: 'fig-center' });
    await f.bridge.whenSettled();
    f.bridge.dispose();
  });
  it('keeps exiting attachment rows until their exact latest UUID is removed', async () => {
    const f = setup();
    f.generations.set('fig-center', 'generation-b');
    f.figure('created', 'generation-b');
    f.manager.setStage('figName', '');
    f.manager.commit();
    f.commit();
    f.figure('removed', 'generation-a');
    expect(f.manager.getViewStageState().attachments).toHaveLength(1);
    f.figure('removed', 'generation-b');
    expect(f.manager.getViewStageState().attachments).toEqual([]);
    await f.bridge.whenSettled();
    f.bridge.dispose();
  });
  it('rejects errors from an old UUID, different config or different entity', async () => {
    const f = setup();
    f.commit();
    f.generations.set('fig-center', 'generation-a');
    f.error({ figureGeneration: 'old-generation' });
    f.error({ configId: 'old-config' });
    f.error({ entityId: 'other' });
    expect(f.manager.getViewStageState().attachments).toHaveLength(1);
    await f.bridge.whenSettled();
    f.bridge.dispose();
  });
  it('compensates the matching displayed failure without publishing or erasing future calculation', async () => {
    const f = setup();
    f.commit();
    f.generations.set('fig-center', 'generation-a');
    f.manager.setStage('showText', 'future');
    const handler = vi.fn();
    f.manager.setCommitHandler(handler);
    f.error();
    await f.bridge.whenSettled();
    expect(f.manager.getViewStageState().attachments).toEqual([]);
    expect(f.manager.getViewStageState().showText).toBe('');
    expect(f.manager.getCalculationStageState().attachments).toHaveLength(1);
    expect(f.manager.getCalculationStageState().showText).toBe('future');
    expect(handler).not.toHaveBeenCalled();
    expect(f.runtime.reconcile.mock.calls.at(-1)?.[0]).toEqual([]);
    f.bridge.dispose();
  });
  it('figure events replay only the last Pixi view, not a notify-only model/config change', async () => {
    const f = setup();
    f.commit();
    const attachment = { ...f.row, configId: 'not-yet-presented' };
    f.manager.applyStageEntityTransaction({
      kind: 'upsert-legacy-attachment',
      attachment,
      canonicalEntityId: deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId),
    });
    f.manager.setStage('figName', 'model-b.json');
    f.manager.commit({ syncPixiStage: false, applyPixiEffects: false });
    f.figure('ready');
    await f.bridge.whenSettled();
    expect(f.runtime.reconcile.mock.calls.at(-1)?.[0][0].configId).toBe('hat-a');
    f.generations.set('fig-center', 'generation-a');
    f.error();
    expect(f.manager.getViewStageState().attachments[0].configId).toBe('not-yet-presented');
    f.bridge.dispose();
  });
  it('effects-only refreshes an existing pending seed without importing a new owner or visibility', async () => {
    const f = setup(true);
    f.commit();
    f.manager.updateEffect({ target: 'entity-hat', transform: { alpha: 0.5 } });
    f.manager.commit({ syncPixiStage: false, applyPixiEffects: true });
    f.bridge.observeCommittedEffects(f.manager.getViewStageState());
    expect(f.runtime.reconcile.mock.calls.at(-1)?.[0][0].visualState?.opacity).toBe(0.5);
    f.figure('ready');
    await f.bridge.whenSettled();
    expect(f.runtime.reconcile.mock.calls.at(-1)?.[0][0].visualState?.opacity).toBe(0.5);
    f.bridge.dispose();
  });
  it('clears invalid static targets with exact compensation and an explicit diagnosis', async () => {
    const f = setup();
    f.setLookup({ status: 'not-live2d', figureKey: 'fig-center', uuid: 'static-b', sourceType: 'img' });
    f.commit();
    await f.bridge.whenSettled();
    expect(f.runtime.beginFigureReplacement).toHaveBeenCalledWith('fig-center', 'static-b');
    expect(f.manager.getViewStageState().attachments).toEqual([]);
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'ATTACHMENT_TARGET_NOT_LIVE2D' }));
    f.bridge.dispose();
  });
  it('an observer exception after compensation cannot replay the removed declaration', async () => {
    const f = setup();
    f.commit();
    f.generations.set('fig-center', 'generation-a');
    f.manager.subscribe(() => {
      throw new Error('observer failure');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    f.error();
    await f.bridge.whenSettled();
    expect(f.manager.getViewStageState().attachments).toEqual([]);
    expect(f.runtime.reconcile.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ATTACHMENT_RUNTIME_STATE_OBSERVER_FAILED' }),
    );
    consoleError.mockRestore();
    f.bridge.dispose();
  });
  it('keeps free-only materialized entities ticking, not unmaterialized declarations', async () => {
    const f = setup();
    f.commit();
    await f.bridge.whenSettled();
    expect(f.host.acquireExternalRenderActivity).not.toHaveBeenCalled();
    f.setFreeCount(1);
    f.event({
      type: 'instance-changed',
      instance: {
        figureKey: 'fig-center',
        figureGeneration: 'generation-a',
        attachmentId: 'hat',
        configId: 'hat-a',
        phase: 'ready',
        firstValidPose: { status: 'ready', frame: 1, timestamp: 16 },
        visible: true,
      },
    });
    expect(f.host.acquireExternalRenderActivity).toHaveBeenCalledTimes(1);
    f.event({ type: 'figure-unregistered', figureKey: 'fig-center', figureGeneration: 'generation-a' });
    expect(f.host.acquireExternalRenderActivity).toHaveBeenCalledTimes(1);
    f.setFreeCount(0);
    f.event({
      type: 'instance-removed',
      figureKey: 'fig-center',
      figureGeneration: 'generation-a',
      attachmentId: 'hat',
    });
    expect(f.release).toHaveBeenCalledTimes(1);
    f.bridge.dispose();
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('preserves a newer view synchronously committed by a compensation observer', async () => {
    const f = setup();
    f.commit();
    f.generations.set('fig-center', 'generation-a');
    let replaced = false;
    f.manager.subscribe(() => {
      if (replaced) return;
      replaced = true;
      const attachment = { ...f.row, configId: 'observer-new' };
      f.manager.applyStageEntityTransaction({
        kind: 'upsert-legacy-attachment',
        attachment,
        canonicalEntityId: deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId),
      });
      f.manager.commit();
      f.commit();
    });
    f.error();
    f.figure('ready');
    await f.bridge.whenSettled();
    expect(f.manager.getViewStageState().attachments[0].configId).toBe('observer-new');
    expect(f.runtime.reconcile.mock.calls.at(-1)?.[0][0].configId).toBe('observer-new');
    f.bridge.dispose();
  });
  it('disposes subscriptions, pending warnings and the free render token idempotently', async () => {
    vi.useFakeTimers();
    const f = setup();
    try {
      f.setLookup({
        status: 'loading',
        figure: {
          key: 'fig-center',
          uuid: 'generation-a',
          sourceUrl: 'model-a.json',
          normalizedSourceUrl: 'model-a.json',
          isExiting: false,
          outerContainer: {},
        },
      } as unknown as ActiveLive2DFigureResult);
      f.setFreeCount(1);
      f.commit();
      await f.bridge.whenSettled();
      expect(vi.getTimerCount()).toBe(1);
      f.bridge.dispose();
      f.bridge.dispose();
      expect(vi.getTimerCount()).toBe(0);
      expect(f.unsubFigure).toHaveBeenCalledTimes(1);
      expect(f.unsubRuntime).toHaveBeenCalledTimes(1);
      expect(f.release).toHaveBeenCalledTimes(1);
    } finally {
      f.bridge.dispose();
      vi.useRealTimers();
    }
  });
});

describe('pure committed declaration projection', () => {
  it('copies canonical semantic anchor and visual seed without sharing mutable state', () => {
    const f = setup(true);
    const stage = f.manager.getViewStageState();
    const declarations = attachmentDeclarationsFromStage(stage);
    expect(declarations[0].semanticAnchor).toBe('head');
    declarations[0].visualState!.position.x = 500;
    expect(stage.stageEntities[0].visualState.position.x).toBe(0);
    f.bridge.dispose();
  });
  it('restores free world state and last attached local state without a legacy attached row', () => {
    const f = setup(true);
    const state = cloneDeep(f.manager.getViewStageState());
    const entity = state.stageEntities[0];
    entity.source.lastAttachedLocalVisualState = cloneDeep(entity.attachmentLink!.attachedLocalVisualState);
    entity.attachmentLink = null;
    entity.visualState.space = 'world';
    state.attachments = [];
    const declarations = freeAttachmentDeclarationsFromStage(state);
    expect(declarations[0]).toMatchObject({
      entityId: 'entity-hat',
      figureKey: 'fig-center',
      visualState: { space: 'world' },
      lastAttachedLocalVisualState: { space: 'local' },
    });
    declarations[0].visualState.position.x = 700;
    expect(entity.visualState.position.x).toBe(0);
    f.bridge.dispose();
  });
});
