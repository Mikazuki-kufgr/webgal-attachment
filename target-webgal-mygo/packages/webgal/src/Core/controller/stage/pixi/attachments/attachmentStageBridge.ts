import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import type { IAttachmentState, IStageState } from '@/Core/Modules/stage/stageInterface';
import { FIGURE_KEYS, FIGURE_POSITIONS, figureStateKeyByPosition } from '@/Core/Modules/stage/stageInterface';
import type { StageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { applyStageEntityStateTransaction } from '@/Core/Modules/stage/stageEntityStateTransaction';
import type PixiStage from '../PixiController';
import type { Live2DFigureChangeEvent } from '../PixiController';
import type { AttachmentRuntime } from './AttachmentRuntime';
import type {
  AttachmentDeclaration,
  AttachmentInstanceSnapshot,
  AttachmentRuntimeEvent,
  FreeAttachmentDeclaration,
} from './types';
import { isPermanentAttachmentBindingError } from './attachmentErrorPolicy';
import { deriveLegacyAttachmentEntityId } from './stageEntityIdentity';
import {
  projectAttachmentCommandPresentation,
  isAttachmentAddFailureCommandOwned,
} from './attachmentCommandPresentation';

export type AttachmentBridgeHost = Pick<
  PixiStage,
  | 'currentApp'
  | 'getActiveLive2DFigure'
  | 'subscribeLive2DFigureChanges'
  | 'requestRender'
  | 'acquireExternalRenderActivity'
>;
export type AttachmentBridgeRuntime = Partial<Pick<AttachmentRuntime, 'setStageHost'>> &
  Pick<
    AttachmentRuntime,
    | 'registerFigure'
    | 'unregisterFigure'
    | 'beginFigureReplacement'
    | 'hasFigureGeneration'
    | 'figureGeneration'
    | 'reconcile'
    | 'subscribe'
    | 'getDiagnostics'
  >;
type BridgeStateManager = Pick<StageStateManager, 'getViewStageState' | 'compensateCommittedAttachmentRemoval'>;
export interface AttachmentBridgeDiagnostic {
  scope: 'webgal.attachment.runtime';
  code: string;
  reason: string;
  figureKey?: string;
  figureGeneration?: string;
  attachmentId?: string;
  configId?: string;
}

export function declaredAttachmentFigureSource(stage: IStageState, figureKey: string): string {
  const position = FIGURE_POSITIONS.find((value) => figureKey === `fig-${value}`);
  if (position) return stage[figureStateKeyByPosition[position]] ?? '';
  return stage.freeFigure.find((figure) => figure.key === figureKey)?.name ?? '';
}

export function attachmentDeclarationsFromStage(stage: IStageState): AttachmentDeclaration[] {
  return stage.attachments.map((row) => {
    const entity = row.entityId
      ? stage.stageEntities.find((candidate) => candidate.entityId === row.entityId)
      : undefined;
    const semanticAnchor = entity?.attachmentLink?.semanticAnchor ?? row.semanticAnchor;
    const modelProfileId = entity?.source.modelProfileId ?? row.modelProfileId;
    return {
      figureKey: row.figureKey,
      attachmentId: row.attachmentId,
      ...(row.entityId ? { entityId: row.entityId } : {}),
      configId: row.configId,
      ...(modelProfileId ? { modelProfileId } : {}),
      ...(row.slot ? { slot: row.slot } : {}),
      visible: row.visible,
      ...(semanticAnchor ? { semanticAnchor } : {}),
      ...(entity ? { visualState: cloneDeep(entity.visualState) } : {}),
    };
  });
}

export function freeAttachmentDeclarationsFromStage(stage: IStageState): FreeAttachmentDeclaration[] {
  return stage.stageEntities.flatMap((entity): FreeAttachmentDeclaration[] => {
    const alias = entity.source.legacyAlias;
    const local = entity.source.lastAttachedLocalVisualState;
    if (entity.attachmentLink || !alias || !local || entity.visualState.space !== 'world') return [];
    return [
      {
        figureKey: alias.originFigureKey,
        attachmentId: alias.attachmentId,
        entityId: entity.entityId,
        configId: entity.source.configId,
        ...(entity.source.modelProfileId ? { modelProfileId: entity.source.modelProfileId } : {}),
        ...(entity.source.slot ? { slot: entity.source.slot } : {}),
        visible: entity.visualState.visible,
        visualState: cloneDeep(entity.visualState) as FreeAttachmentDeclaration['visualState'],
        lastAttachedLocalVisualState: cloneDeep(local),
      },
    ];
  });
}

/**
 * View-only lifecycle adapter. Native sync commits are the sole declaration
 * input; figure events may replay that last presentation, never calculation
 * state or a notify-only commit. Slow resource loads do not serialize newer
 * view intents: AttachmentRuntime owns cancellation of superseded reconciles.
 */
export class AttachmentStageBridge {
  private presentationState: IStageState | undefined;
  private disposed = false;
  private queued = false;
  private releaseRenderActivity: (() => void) | undefined;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly generations = new Map<string, string>();
  private readonly warnings = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribeFigure: () => void;
  private readonly unsubscribeRuntime: () => void;

  constructor(
    private readonly host: AttachmentBridgeHost,
    private readonly runtime: AttachmentBridgeRuntime,
    private readonly manager: BridgeStateManager,
    private readonly report: (diagnostic: AttachmentBridgeDiagnostic) => void = (diagnostic) =>
      console.error(diagnostic),
  ) {
    this.unsubscribeFigure = host.subscribeLive2DFigureChanges((event) => this.figureChanged(event));
    this.unsubscribeRuntime = runtime.subscribe((event) => this.runtimeChanged(event));
    this.syncRenderActivity();
  }

  public syncCommittedView(stage: IStageState): void {
    if (this.disposed || stage !== this.manager.getViewStageState()) return;
    this.presentationState = projectAttachmentCommandPresentation(stage);
    this.reconcileNow();
  }

  /** Refresh only continuous values for already-presented, unchanged owners. */
  public observeCommittedEffects(stage: IStageState): void {
    const presented = this.presentationState;
    if (this.disposed || !presented || stage !== this.manager.getViewStageState()) return;
    stage = projectAttachmentCommandPresentation(stage);
    let updated = false;
    for (const entity of presented.stageEntities) {
      const current = stage.stageEntities.find((candidate) => candidate.entityId === entity.entityId);
      if (!current || !isEqual(current.source, entity.source)) continue;
      const previousLink = entity.attachmentLink;
      const currentLink = current.attachmentLink;
      if (Boolean(previousLink) !== Boolean(currentLink)) continue;
      if (
        previousLink &&
        currentLink &&
        (previousLink.parentFigureKey !== currentLink.parentFigureKey ||
          previousLink.semanticAnchor !== currentLink.semanticAnchor ||
          previousLink.placementPresetId !== currentLink.placementPresetId)
      )
        continue;
      const visible = entity.visualState.visible;
      entity.visualState = { ...cloneDeep(current.visualState), visible };
      if (previousLink && currentLink) {
        previousLink.attachedLocalVisualState = { ...cloneDeep(currentLink.attachedLocalVisualState), visible };
      }
      const effect = stage.effects.find((candidate) => candidate.target === entity.entityId);
      const index = presented.effects.findIndex((candidate) => candidate.target === entity.entityId);
      if (effect && index >= 0) presented.effects[index] = cloneDeep(effect);
      updated = true;
    }
    // Existing transform hosts may not exist yet while textures load. Update
    // their pending seed as well, using only the already-presented owners.
    if (updated) this.reconcileRuntime();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeFigure();
    this.unsubscribeRuntime();
    this.releaseRenderActivity?.();
    this.releaseRenderActivity = undefined;
    this.presentationState = undefined;
    for (const timer of this.warnings.values()) clearTimeout(timer);
    this.warnings.clear();
    this.generations.clear();
  }

  /** Test/diagnostic barrier only; production view commits never await it. */
  public async whenSettled(): Promise<void> {
    do {
      await Promise.resolve();
      await Promise.allSettled([...this.pending]);
    } while (this.queued || this.pending.size > 0);
  }

  private queueReconcile(): void {
    if (this.disposed || this.queued) return;
    this.queued = true;
    void Promise.resolve()
      .then(() => {
        this.queued = false;
        if (!this.disposed) this.reconcileNow();
      })
      .catch((error) => this.boundaryFailure('ATTACHMENT_RUNTIME_RECONCILE_EVENT_FAILED', error));
  }

  private reconcileNow(): void {
    const stage = this.presentationState;
    if (this.disposed || !stage) return;
    this.runtime.setStageHost?.(this.host as PixiStage);
    const rejected = new Set<string>();
    const keys = new Set([
      ...FIGURE_KEYS.filter((key) => declaredAttachmentFigureSource(stage, key)),
      ...stage.freeFigure.filter((figure) => figure.name).map((figure) => figure.key),
      ...stage.attachments.map((attachment) => attachment.figureKey),
    ]);
    for (const key of keys) {
      const result = this.host.getActiveLive2DFigure(key);
      if (result.status === 'absent') {
        if (!declaredAttachmentFigureSource(stage, key) && !this.runtime.hasFigureGeneration(key)) {
          rejected.add(key);
          this.rejectFigure(
            stage,
            key,
            'ATTACHMENT_TARGET_NOT_FOUND',
            'No declared or active figure generation exists',
          );
        }
      } else if (result.status === 'loading') {
        this.markPending(key, result.figure.uuid, stage);
      } else if (result.status === 'exiting') {
        // Clearing a path starts a transition, not the UUID's terminal removal.
        if (declaredAttachmentFigureSource(stage, key)) {
          rejected.add(key);
          this.rejectFigure(stage, key, 'ATTACHMENT_TARGET_EXITING', `Figure ${result.figure.uuid} is exiting`);
        }
      } else if (result.status === 'ready') {
        this.generations.set(key, result.figure.uuid);
        this.clearWarning(key);
        if (this.host.currentApp) {
          this.runtime.registerFigure({
            key: result.figure.key,
            generation: result.figure.uuid,
            sourcePath: result.figure.sourceUrl,
            app: this.host.currentApp,
            container: result.figure.outerContainer,
            model: result.figure.model,
            stage: this.host as PixiStage,
          });
        }
      } else {
        rejected.add(key);
        if ('uuid' in result) this.runtime.beginFigureReplacement(key, result.uuid);
        const code =
          result.status === 'ambiguous'
            ? 'ATTACHMENT_TARGET_AMBIGUOUS'
            : result.status === 'unsupported'
            ? 'ATTACHMENT_TARGET_UNSUPPORTED'
            : 'ATTACHMENT_TARGET_NOT_LIVE2D';
        this.rejectFigure(stage, key, code, `Target lookup returned ${result.status}`);
      }
    }
    // Rejections can compensate the presentation rows. Always use the latest
    // local presentation snapshot after that synchronous operation.
    this.reconcileRuntime(rejected);
  }

  private reconcileRuntime(rejected: ReadonlySet<string> = new Set()): void {
    const current = this.presentationState;
    if (!current || this.disposed) return;
    try {
      const operation = this.runtime
        .reconcile(
          attachmentDeclarationsFromStage(current).filter((row) => !rejected.has(row.figureKey)),
          freeAttachmentDeclarationsFromStage(current),
        )
        .catch((error) => this.boundaryFailure('ATTACHMENT_RUNTIME_RECONCILE_FAILED', error))
        .finally(() => {
          this.pending.delete(operation);
          if (!this.disposed) {
            this.syncRenderActivity();
            this.host.requestRender();
          }
        });
      this.pending.add(operation);
    } catch (error) {
      this.boundaryFailure('ATTACHMENT_RUNTIME_RECONCILE_FAILED', error);
    }
  }

  private figureChanged(event: Live2DFigureChangeEvent): void {
    if (this.disposed) return;
    if (event.type === 'created') {
      this.clearWarning(event.figureKey);
      this.generations.set(event.figureKey, event.uuid);
      this.runtime.beginFigureReplacement(event.figureKey, event.uuid);
      if (this.presentationState) this.markPending(event.figureKey, event.uuid, this.presentationState);
    } else if (event.type === 'removed') {
      const currentGeneration = this.generations.get(event.figureKey) ?? this.runtime.figureGeneration(event.figureKey);
      this.runtime.unregisterFigure(event.figureKey, event.uuid);
      if (currentGeneration === event.uuid) {
        this.generations.delete(event.figureKey);
        this.clearWarning(event.figureKey);
        const stage = this.presentationState;
        if (stage && !declaredAttachmentFigureSource(stage, event.figureKey)) {
          for (const row of stage.attachments.filter((item) => item.figureKey === event.figureKey)) {
            this.compensate(this.presentationState ?? stage, row);
          }
        }
      }
    }
    this.queueReconcile();
  }

  private runtimeChanged(event: AttachmentRuntimeEvent): void {
    if (this.disposed || event.type === 'frame') return;
    this.syncRenderActivity();
    this.host.requestRender();
    if (event.type !== 'instance-error') return;
    const instance = event.instance;
    this.report({
      scope: 'webgal.attachment.runtime',
      code: `ATTACHMENT_${instance.errorCode ?? 'RUNTIME_CREATE_FAILED'}`,
      figureKey: instance.figureKey,
      figureGeneration: instance.figureGeneration,
      attachmentId: instance.attachmentId,
      configId: instance.configId,
      reason: instance.error ?? 'Unknown attachment runtime failure',
    });
    if (!isPermanentAttachmentBindingError(instance.errorCode)) return;
    const stage = this.presentationState;
    if (!stage || this.runtime.figureGeneration(instance.figureKey) !== instance.figureGeneration) return;
    const row = stage.attachments.find((candidate) => this.instanceMatches(candidate, instance));
    if (row && this.compensate(stage, row)) this.queueReconcile();
  }

  private instanceMatches(row: IAttachmentState, instance: AttachmentInstanceSnapshot): boolean {
    return (
      row.figureKey === instance.figureKey &&
      row.attachmentId === instance.attachmentId &&
      row.configId === instance.configId &&
      row.slot === instance.slot &&
      row.visible === instance.visible &&
      (row.entityId ?? deriveLegacyAttachmentEntityId(row.figureKey, row.attachmentId)) === instance.entityId
    );
  }

  private compensate(presentation: IStageState, row: IAttachmentState): boolean {
    // A command-owned add must restore its previous row/entity/effect (I-11),
    // not race this generic remove-only binding failure compensation.
    if (isAttachmentAddFailureCommandOwned(row)) return false;
    if (this.presentationState !== presentation) return false;
    const view = this.manager.getViewStageState();
    const expectedEntity = row.entityId
      ? presentation.stageEntities.find((entity) => entity.entityId === row.entityId)
      : undefined;
    if (
      declaredAttachmentFigureSource(view, row.figureKey) !==
        declaredAttachmentFigureSource(presentation, row.figureKey) ||
      !view.attachments.some((candidate) => isEqual(candidate, row)) ||
      (expectedEntity && !view.stageEntities.some((entity) => isEqual(entity, expectedEntity)))
    )
      return false;
    try {
      const result = this.manager.compensateCommittedAttachmentRemoval(view, row, expectedEntity);
      if (!result.applied) return false;
      // A notified observer may synchronously commit a newer presentation.
      // The completed old removal has no authority to replace that snapshot.
      if (this.presentationState !== presentation) return false;
      const next = applyStageEntityStateTransaction(presentation, {
        kind: 'remove',
        expectedAttachment: row,
        ...(expectedEntity ? { entityId: expectedEntity.entityId, expectedEntity } : {}),
      });
      if (next.applied) this.presentationState = next.state;
      return next.applied;
    } catch (error) {
      this.boundaryFailure('ATTACHMENT_RUNTIME_STATE_COMPENSATION_FAILED', error);
      return false;
    }
  }

  private rejectFigure(stage: IStageState, key: string, code: string, reason: string): void {
    for (const row of stage.attachments.filter((item) => item.figureKey === key)) {
      this.report({
        scope: 'webgal.attachment.runtime',
        code,
        figureKey: key,
        attachmentId: row.attachmentId,
        configId: row.configId,
        reason,
      });
      this.compensate(this.presentationState ?? stage, row);
    }
    this.clearWarning(key);
  }

  private markPending(key: string, generation: string, stage: IStageState): void {
    const unchanged = this.generations.get(key) === generation;
    this.generations.set(key, generation);
    if (unchanged && this.warnings.has(key)) return;
    this.clearWarning(key);
    if (!stage.attachments.some((attachment) => attachment.figureKey === key)) return;
    this.warnings.set(
      key,
      setTimeout(() => {
        this.warnings.delete(key);
        if (!this.disposed && this.generations.get(key) === generation) {
          this.report({
            scope: 'webgal.attachment.runtime',
            code: 'ATTACHMENT_TARGET_PENDING',
            figureKey: key,
            figureGeneration: generation,
            reason: 'Live2D model has not become ready after 8000ms',
          });
        }
      }, 8000),
    );
  }

  private clearWarning(key: string): void {
    const timer = this.warnings.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.warnings.delete(key);
  }

  private boundaryFailure(code: string, error: unknown): void {
    this.report({
      scope: 'webgal.attachment.runtime',
      code,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  private syncRenderActivity(): void {
    // Conservative first-batch policy: a materialized free entity may animate
    // without any Live2D parent. Pending declarations alone never keep a ticker
    // alive. A later optimization can narrow this to active transitions.
    const needsFrames = !this.disposed && this.runtime.getDiagnostics().freeEntityCount > 0;
    if (needsFrames && !this.releaseRenderActivity)
      this.releaseRenderActivity = this.host.acquireExternalRenderActivity();
    else if (!needsFrames && this.releaseRenderActivity) {
      this.releaseRenderActivity();
      this.releaseRenderActivity = undefined;
    }
  }
}
