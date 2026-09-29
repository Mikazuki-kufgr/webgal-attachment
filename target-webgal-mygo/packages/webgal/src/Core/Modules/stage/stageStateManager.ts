import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import {
  applyStageEntityStateTransaction,
  validateStageEntityStateInvariants,
  type StageEntityStateTransaction,
  type StageEntityStateTransactionResult,
  type StageStateInvariantViolation,
} from './stageEntityStateTransaction';
import { applyStageEntityEffectTransaction } from './stageEntityEffect';
import type { StageStateInput } from './stageInterface';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import { isUndefined, omitBy } from 'lodash';
import { commandType } from '@/Core/controller/scene/sceneInterface';
import { STAGE_KEYS } from '@/Core/constants';
import { baseBlinkParam, baseFocusParam } from '@/Core/live2DCore';
import {
  baseTransform,
  FIGURE_KEYS,
  IEffect,
  IFigureMetadata,
  IFreeFigure,
  ILive2DBlink,
  ILive2DExpression,
  ILive2DFocus,
  ILive2DMotion,
  IRunPerform,
  IAttachmentState,
  StageEntityStateV0,
  ISetGameVar,
  IStageState,
  IUpdateAnimationSettingPayload,
} from '@/Core/Modules/stage/stageInterface';

type StageStateListener = (stageState: IStageState) => void;
export interface IStageCommitOptions {
  syncPixiStage?: boolean;
  applyPixiEffects?: boolean;
  notifyReact?: boolean;
  skipAnimation?: boolean;
}

export interface IResolvedStageCommitOptions {
  syncPixiStage: boolean;
  applyPixiEffects: boolean;
  notifyReact: boolean;
  skipAnimation: boolean;
}

type StageCommitHandler = (stageState: IStageState, options: IResolvedStageCommitOptions) => void;

declare const preparedStageEntityBrand: unique symbol;
/** Opaque, manager-owned, single-use plan; never serialize it or reuse it across awaits without rechecking. */
export interface PreparedStageEntityTransaction {
  readonly [preparedStageEntityBrand]: true;
}
export type StageEntityPreparation =
  | { prepared: true; plan: PreparedStageEntityTransaction }
  | { prepared: false; violations: StageStateInvariantViolation[] };

export interface CommittedAttachmentRemovalResult {
  applied: boolean;
  calculationApplied: boolean;
  violations: StageStateInvariantViolation[];
}

export class StageEntityStateError extends Error {
  constructor(public readonly violations: StageStateInvariantViolation[]) {
    super(violations.map((item) => item.code + ': ' + item.message).join('; '));
    this.name = 'StageEntityStateError';
  }
}

function assertEntityState(state: IStageState): void {
  const violations = validateStageEntityStateInvariants(state);
  if (violations.length) throw new StageEntityStateError(violations);
}

function normalizedStageInput(stage: StageStateInput): IStageState {
  const candidate = cloneDeep(stage);
  const normalized: IStageState = {
    ...candidate,
    attachments: candidate.attachments === undefined ? [] : candidate.attachments,
    stageEntities: candidate.stageEntities === undefined ? [] : candidate.stageEntities,
  };
  assertEntityState(normalized);
  return normalized;
}

export const initState: IStageState = {
  oldBgName: '',
  bgName: '',
  figName: '',
  figNameLeft: '',
  figNameRight: '',
  figNameLeft13: '',
  figNameRight13: '',
  figNameLeft14: '',
  figNameRight14: '',
  freeFigure: [],
  attachments: [],
  stageEntities: [],
  figureAssociatedAnimation: [],
  isRead: false,
  showText: '',
  showTextSize: -1,
  showName: '',
  command: '',
  choose: [],
  vocal: '',
  playVocal: '',
  vocalVolume: 100,
  bgm: {
    src: '',
    enter: 0,
    volume: 100,
  },
  uiSe: '',
  miniAvatar: '',
  GameVar: {},
  effects: [
    {
      target: 'stage-main',
      transform: baseTransform,
    },
  ],
  animationSettings: [],
  bgFilter: '',
  bgTransform: '',
  PerformList: [],
  currentDialogKey: 'initial',
  live2dMotion: [],
  live2dExpression: [],
  live2dBlink: [],
  live2dFocus: [],
  currentConcatDialogPrev: '',
  enableFilm: '',
  isDisableTextbox: false,
  replacedUIlable: {},
  figureMetaData: {},
};

/**
 * WebGAL 5 stage state machine.
 *
 * calculationStageState is mutated by script execution during forward.
 * viewStageState is the committed state observed by React/Pixi/audio views.
 */
export class StageStateManager {
  private calculationStageState: IStageState = cloneDeep(initState);
  private viewStageState: IStageState = cloneDeep(initState);
  private calculationAtViewCommit: IStageState = this.calculationStageState;
  private listeners = new Set<StageStateListener>();
  private commitHandler: StageCommitHandler | null = null;
  private isolatedCalculationDepth = 0;
  private entityPlans = new WeakMap<
    PreparedStageEntityTransaction,
    {
      calculation: IStageState;
      view: IStageState;
      expected: IStageState;
      next: IStageState;
    }
  >();

  /** Prepare on a detached snapshot; no calculation, view, listener or renderer mutation. */
  public prepareStageEntityTransaction(transaction: StageEntityStateTransaction): StageEntityPreparation {
    const result = applyStageEntityStateTransaction(this.calculationStageState, transaction);
    if (!result.applied) return { prepared: false, violations: result.violations };
    const plan = Object.freeze({}) as PreparedStageEntityTransaction;
    this.entityPlans.set(plan, {
      calculation: this.calculationStageState,
      view: this.viewStageState,
      expected: cloneDeep(this.calculationStageState),
      next: result.state,
    });
    return { prepared: true, plan };
  }

  /** Publish only calculation state. Rendering still belongs to the host's explicit commit(). */
  public commitPreparedStageEntityTransaction(plan: PreparedStageEntityTransaction): StageEntityStateTransactionResult {
    const pending = this.entityPlans.get(plan);
    this.entityPlans.delete(plan);
    if (
      !pending ||
      pending.calculation !== this.calculationStageState ||
      pending.view !== this.viewStageState ||
      !isEqual(pending.expected, this.calculationStageState)
    ) {
      return {
        applied: false,
        state: this.calculationStageState,
        violations: [
          {
            code: 'ENTITY_TRANSACTION_STALE',
            message: 'Prepared transaction is foreign, consumed, or its calculation/view snapshot changed',
          },
        ],
      };
    }
    const violations = validateStageEntityStateInvariants(pending.next);
    if (violations.length) return { applied: false, state: this.calculationStageState, violations };
    this.calculationStageState = pending.next;
    return { applied: true, state: this.calculationStageState, violations: [] };
  }

  public applyStageEntityTransaction(transaction: StageEntityStateTransaction): StageEntityStateTransactionResult {
    const preparation = this.prepareStageEntityTransaction(transaction);
    return preparation.prepared
      ? this.commitPreparedStageEntityTransaction(preparation.plan)
      : { applied: false, state: this.calculationStageState, violations: preparation.violations };
  }

  public getCalculationStageState(): IStageState {
    return this.calculationStageState;
  }

  public getViewStageState(): IStageState {
    return this.viewStageState;
  }

  public isCalculationSynchronizedWithView(): boolean {
    return (
      this.calculationAtViewCommit === this.calculationStageState &&
      isEqual(this.calculationStageState, this.viewStageState)
    );
  }

  /** Native animation setup can write figure effects after commit, before an
   * attachment's async terminal event. Those effects must survive without
   * preventing the same attachment declaration from reaching its final state.
   * Keep the calculation owner and every non-native-effect field exact: a
   * newer script transaction (even a same-value hide) must remain untouched.
   */
  private canSynchronizeCommittedEntityResult(): boolean {
    if (this.calculationAtViewCommit !== this.calculationStageState) return false;
    const { effects: calculationEffects, ...calculation } = this.calculationStageState;
    const { effects: viewEffects, ...view } = this.viewStageState;
    if (!isEqual(calculation, view)) return false;
    const nativeTargets = new Set<string>([
      STAGE_KEYS.STAGE_MAIN,
      STAGE_KEYS.BGMAIN,
      ...FIGURE_KEYS,
      ...view.freeFigure.map((figure) => figure.key),
    ]);
    // An explicit entity may share a native-looking ID; never ignore its effect.
    for (const entity of view.stageEntities) nativeTargets.delete(entity.entityId);
    return isEqual(
      calculationEffects.filter((effect) => !nativeTargets.has(effect.target)),
      viewEffects.filter((effect) => !nativeTargets.has(effect.target)),
    );
  }

  /** Retired presentation callbacks may sample/clean up, but cannot author a newer calculation. */
  public withIsolatedCalculation<T>(callback: () => T): T {
    const original = this.calculationStageState;
    const originalAnchor = this.calculationAtViewCommit;
    this.calculationStageState = cloneDeep(original);
    this.isolatedCalculationDepth++;
    try {
      return callback();
    } finally {
      this.isolatedCalculationDepth--;
      this.calculationStageState = original;
      this.calculationAtViewCommit = originalAnchor;
    }
  }

  /** An async terminal event owns one view transaction, never an entire future script calculation. */
  public applyCommittedStageEntityTransaction(
    expectedView: IStageState,
    transaction: StageEntityStateTransaction,
    options: { notify?: boolean } = {},
  ) {
    const stale = expectedView !== this.viewStageState || this.isolatedCalculationDepth > 0;
    const result: StageEntityStateTransactionResult = stale
      ? {
          applied: false,
          state: this.viewStageState,
          violations: [
            { code: 'ENTITY_TRANSACTION_STALE', message: 'Committed entity transaction lost its view owner' },
          ],
        }
      : applyStageEntityStateTransaction(this.viewStageState, transaction);
    return this.publishCommittedEntityResult(
      expectedView,
      result,
      () => applyStageEntityStateTransaction(this.calculationStageState, transaction),
      options.notify !== false,
    );
  }

  public applyCommittedStageEntityEffect(expectedView: IStageState, payload: IEffect) {
    const result: StageEntityStateTransactionResult =
      expectedView !== this.viewStageState || this.isolatedCalculationDepth > 0
        ? {
            applied: false,
            state: this.viewStageState,
            violations: [{ code: 'ENTITY_TRANSACTION_STALE', message: 'Committed entity effect lost its view owner' }],
          }
        : applyStageEntityEffectTransaction(this.viewStageState, payload);
    return this.publishCommittedEntityResult(expectedView, result, () =>
      applyStageEntityEffectTransaction(this.calculationStageState, payload),
    );
  }

  private publishCommittedEntityResult(
    expectedView: IStageState,
    result: StageEntityStateTransactionResult,
    calculate: () => StageEntityStateTransactionResult,
    notify = true,
  ) {
    if (!result.applied) return { ...result, calculationApplied: false };
    const calculation = this.canSynchronizeCommittedEntityResult() ? calculate() : undefined;
    this.viewStageState = result.state;
    if (calculation?.applied) {
      this.calculationStageState = calculation.state;
      this.calculationAtViewCommit = calculation.state;
    }
    // No commit handler/autosave here. The owning presenter refreshes after
    // Runtime's atomic finalizer has returned, not in the middle of reparent.
    if (notify) this.notifyCommittedEntityChange();
    return { ...result, calculationApplied: calculation?.applied ?? false };
  }

  public removeCommittedPerform(expected: IRunPerform): boolean {
    if (this.isolatedCalculationDepth > 0) return false;
    const matches = (row: IRunPerform) => row.id === expected.id && isEqual(row.script, expected.script);
    const viewHasExpected = this.viewStageState.PerformList.some(matches);
    const calculationHasExpected = this.calculationStageState.PerformList.some(matches);
    if (!viewHasExpected && !calculationHasExpected) return false;
    const synchronized = this.isCalculationSynchronizedWithView();
    if (viewHasExpected) {
      const next = cloneDeep(this.viewStageState);
      next.PerformList = next.PerformList.filter((row) => !matches(row));
      this.viewStageState = next;
    }
    if (synchronized) {
      this.calculationStageState = cloneDeep(this.viewStageState);
      this.calculationAtViewCommit = this.calculationStageState;
    } else if (calculationHasExpected) {
      this.calculationStageState.PerformList = this.calculationStageState.PerformList.filter((row) => !matches(row));
    }
    if (viewHasExpected) this.notifyCommittedEntityChange();
    return true;
  }

  public notifyCommittedEntityChange(): void {
    if (this.isolatedCalculationDepth > 0) return;
    try {
      this.notify();
    } catch (error) {
      console.error({
        scope: 'webgal.stage.committed',
        code: 'COMMITTED_STATE_OBSERVER_FAILED',
        reason: String(error),
      });
    }
  }

  /**
   * An asynchronous Runtime failure belongs to one committed view, not to a
   * script's possibly newer calculation state. Remove only its exact row from
   * each snapshot independently; never commit the rest of calculation state.
   * This deliberately bypasses the regular commit handler (including autosave).
   * The Runtime bridge reconciles the resulting view after this call.
   */
  public compensateCommittedAttachmentRemoval(
    expectedView: IStageState,
    expectedAttachment: IAttachmentState,
    expectedEntity?: StageEntityStateV0,
  ): CommittedAttachmentRemovalResult {
    if (
      expectedView !== this.viewStageState ||
      (expectedAttachment.entityId
        ? expectedEntity?.entityId !== expectedAttachment.entityId
        : expectedEntity !== undefined)
    ) {
      return {
        applied: false,
        calculationApplied: false,
        violations: [{ code: 'ENTITY_TRANSACTION_STALE', message: 'Runtime removal lost its exact committed owner' }],
      };
    }
    const transaction: StageEntityStateTransaction = {
      kind: 'remove',
      expectedAttachment,
      ...(expectedEntity ? { entityId: expectedEntity.entityId, expectedEntity } : {}),
    };
    const viewResult = applyStageEntityStateTransaction(this.viewStageState, transaction);
    if (!viewResult.applied) {
      return { applied: false, calculationApplied: false, violations: viewResult.violations };
    }
    // Fail closed if calculation advanced at all. The root-identity check
    // additionally rejects an explicit identical-row re-add (A -> B -> A).
    // Preserving a newer draft may cause a later retry; it must never erase
    // newer script intent merely because its attachment tuple looks equal.
    const unchangedCalculation =
      this.calculationAtViewCommit === this.calculationStageState && isEqual(this.calculationStageState, expectedView);
    const calculationResult = unchangedCalculation
      ? applyStageEntityStateTransaction(this.calculationStageState, transaction)
      : undefined;
    this.viewStageState = viewResult.state;
    if (calculationResult?.applied) {
      this.calculationStageState = calculationResult.state;
      this.calculationAtViewCommit = calculationResult.state;
    }
    // Publication is terminal even if a React observer fails. The bridge must
    // still receive applied=true so it cannot replay the retired declaration.
    try {
      this.notify();
    } catch (error) {
      console.error({
        scope: 'webgal.attachment.runtime',
        code: 'ATTACHMENT_RUNTIME_STATE_OBSERVER_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return { applied: true, calculationApplied: calculationResult?.applied ?? false, violations: [] };
  }

  public setStage<K extends keyof IStageState>(key: K, value: IStageState[K]) {
    const hasEntityState =
      this.calculationStageState.attachments.length > 0 || this.calculationStageState.stageEntities.length > 0;
    if (
      key === 'attachments' ||
      key === 'stageEntities' ||
      (hasEntityState && (key === 'effects' || key === 'freeFigure'))
    ) {
      const candidate = cloneDeep(this.calculationStageState);
      candidate[key] = cloneDeep(value);
      assertEntityState(candidate);
      this.calculationStageState = candidate;
      return;
    }
    this.calculationStageState[key] = value;
  }

  public setStageAndCommit<K extends keyof IStageState>(key: K, value: IStageState[K]) {
    this.setStage(key, value);
    this.commit();
  }

  public setStageVar(payload: ISetGameVar) {
    this.calculationStageState.GameVar[payload.key] = payload.value;
  }

  public setStageVarAndCommit(payload: ISetGameVar) {
    this.setStageVar(payload);
    this.commit();
  }

  public replaceCalculationStageState(stageState: StageStateInput) {
    this.calculationStageState = normalizedStageInput(stageState);
  }

  public replaceAllStageState(stageState: StageStateInput, options?: IStageCommitOptions) {
    this.replaceCalculationStageState(stageState);
    this.commit(options);
  }

  public resetCalculationStageState(stageState: StageStateInput) {
    this.replaceCalculationStageState(stageState);
  }

  public resetAllStageState(stageState: StageStateInput, options?: IStageCommitOptions) {
    this.replaceAllStageState(stageState, options);
  }

  public updateEffect(payload: IEffect) {
    const { target, transform } = payload;
    const state = this.calculationStageState;
    if (state.stageEntities.some((entity) => entity.entityId === target)) {
      const result = applyStageEntityEffectTransaction(state, payload);
      if (!result.applied) throw new StageEntityStateError(result.violations);
      this.calculationStageState = result.state;
      return;
    }
    const activeTargets = [
      STAGE_KEYS.STAGE_MAIN,
      STAGE_KEYS.BGMAIN,
      ...FIGURE_KEYS,
      ...state.freeFigure.map((figure) => figure.key),
    ];
    if (!activeTargets.includes(target)) return;

    const effectIndex = state.effects.findIndex((e) => e.target === target);
    if (effectIndex >= 0) {
      if (!state.effects[effectIndex].transform) {
        state.effects[effectIndex].transform = transform;
      } else if (transform) {
        const targetScale = state.effects[effectIndex].transform!.scale || {};
        const targetPosition = state.effects[effectIndex].transform!.position || {};
        const targetSkew = state.effects[effectIndex].transform!.skew || { x: 0, y: 0 };
        if (transform.scale) Object.assign(targetScale, omitBy(transform.scale, isUndefined));
        if (transform.position) Object.assign(targetPosition, omitBy(transform.position, isUndefined));
        if (transform.skew) Object.assign(targetSkew, omitBy(transform.skew, isUndefined));
        Object.assign(state.effects[effectIndex].transform!, omitBy(transform, isUndefined));
        state.effects[effectIndex].transform!.scale = targetScale;
        state.effects[effectIndex].transform!.position = targetPosition;
        if (transform.skew) state.effects[effectIndex].transform!.skew = targetSkew;
      }
    } else {
      state.effects.push({
        target,
        transform: transform ? { ...baseTransform, ...transform } : { ...baseTransform },
      });
    }
  }

  public updateEffectAndCommit(payload: IEffect) {
    this.updateEffect(payload);
    this.commit();
  }

  public removeEffectByTargetId(target: string) {
    // A live entity and its sole effect form one transaction unit.
    if (this.calculationStageState.stageEntities.some((entity) => entity.entityId === target)) return;
    const index = this.calculationStageState.effects.findIndex((e) => e.target === target);
    if (index >= 0) {
      this.calculationStageState.effects.splice(index, 1);
    }
  }

  public updateAnimationSettings(payload: IUpdateAnimationSettingPayload) {
    const { target, key, value } = payload;
    const state = this.calculationStageState;
    const animationIndex = state.animationSettings.findIndex((a) => a.target === target);
    if (animationIndex >= 0) {
      state.animationSettings[animationIndex] = {
        ...state.animationSettings[animationIndex],
        [key]: value,
      };
    } else {
      state.animationSettings.push({
        target,
        [key]: value,
      });
    }
  }

  public removeAnimationSettingsByTarget(target: string) {
    const state = this.calculationStageState;
    const index = state.animationSettings.findIndex((a) => a.target === target);
    if (index >= 0) {
      const prev = state.animationSettings[index];
      state.animationSettings.splice(index, 1);

      if (prev.exitAnimationName || prev.exitDuration !== undefined) {
        const prevTarget = `${target}-off`;
        const prevSetting = {
          ...prev,
          target: prevTarget,
        };
        const prevIndex = state.animationSettings.findIndex((a) => a.target === prevTarget);
        if (prevIndex >= 0) {
          state.animationSettings.splice(prevIndex, 1, prevSetting);
        } else {
          state.animationSettings.push(prevSetting);
        }
      }
    }
  }

  public removeAnimationSettingsByTargetOff(target: string) {
    const index = this.calculationStageState.animationSettings.findIndex((a) => a.target === target);
    if (index >= 0) {
      this.calculationStageState.animationSettings.splice(index, 1);
    }
  }

  public addPerform(performToAdd: IRunPerform) {
    const dupId = performToAdd.id;
    this.calculationStageState.PerformList = this.calculationStageState.PerformList.filter((p) => p.id !== dupId);
    this.calculationStageState.PerformList.push(performToAdd);
  }

  public removePerformByName(name: string) {
    this.calculationStageState.PerformList = this.calculationStageState.PerformList.filter(
      (performItem) => performItem.id !== name && !performItem.id.startsWith(name + '#'),
    );
  }

  public removePerformByPrefix(prefix: string) {
    this.calculationStageState.PerformList = this.calculationStageState.PerformList.filter(
      (performItem) => !performItem.id.startsWith(prefix),
    );
  }

  public removeAllPerform() {
    this.calculationStageState.PerformList.splice(0, this.calculationStageState.PerformList.length);
  }

  public removeAllPixiPerforms() {
    this.calculationStageState.PerformList = this.calculationStageState.PerformList.filter(
      (performItem) => performItem.script.command !== commandType.pixi,
    );
  }

  public setFreeFigureByKey(newFigure: IFreeFigure) {
    const state = this.calculationStageState;
    if (
      newFigure.name !== '' &&
      (state.stageEntities.some((entity) => entity.entityId === newFigure.key) ||
        state.attachments.some(
          (attachment) =>
            (attachment.entityId ?? deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId)) ===
            newFigure.key,
        ))
    ) {
      throw new StageEntityStateError([
        { code: 'ENTITY_ID_CONFLICT', message: 'Figure key is owned by a stage entity' },
      ]);
    }
    const currentFreeFigures = state.freeFigure;
    const index = currentFreeFigures.findIndex((figure) => figure.key === newFigure.key);
    if (index >= 0) {
      if (newFigure.name === '') {
        currentFreeFigures.splice(index, 1);
        const figureAssociatedAnimationIndex = state.figureAssociatedAnimation.findIndex(
          (a) => a.targetId === newFigure.key,
        );
        if (figureAssociatedAnimationIndex >= 0) {
          state.figureAssociatedAnimation.splice(figureAssociatedAnimationIndex, 1);
        }
      } else {
        currentFreeFigures[index].basePosition = newFigure.basePosition;
        currentFreeFigures[index].name = newFigure.name;
      }
    } else if (newFigure.name !== '') {
      currentFreeFigures.push(newFigure);
    }
  }

  public setLive2dMotion(payload: ILive2DMotion) {
    const { target, motion, skin, overrideBounds } = payload;
    const index = this.calculationStageState.live2dMotion.findIndex((e) => e.target === target);
    if (index < 0) {
      this.calculationStageState.live2dMotion.push({ target, motion, skin, overrideBounds });
    } else {
      this.calculationStageState.live2dMotion[index].motion = motion;
      this.calculationStageState.live2dMotion[index].skin = skin;
      // 绘制范围参与立绘身份判定，没指定就沿用旧值，否则只改动作也会被当成换了一张立绘
      if (overrideBounds !== undefined) {
        this.calculationStageState.live2dMotion[index].overrideBounds = overrideBounds;
      }
    }
  }

  public setLive2dExpression(payload: ILive2DExpression) {
    const { target, expression } = payload;
    const index = this.calculationStageState.live2dExpression.findIndex((e) => e.target === target);
    if (index < 0) {
      this.calculationStageState.live2dExpression.push({ target, expression });
    } else {
      this.calculationStageState.live2dExpression[index].expression = expression;
    }
  }

  public setLive2dBlink(payload: ILive2DBlink) {
    const { target, blink } = payload;
    const index = this.calculationStageState.live2dBlink.findIndex((e) => e.target === target);
    if (index < 0) {
      this.calculationStageState.live2dBlink.push({ target, blink: { ...baseBlinkParam, ...blink } });
    } else {
      this.calculationStageState.live2dBlink[index].blink = {
        ...this.calculationStageState.live2dBlink[index].blink,
        ...blink,
      };
    }
  }

  public setLive2dFocus(payload: ILive2DFocus) {
    const { target, focus } = payload;
    const index = this.calculationStageState.live2dFocus.findIndex((e) => e.target === target);
    if (index < 0) {
      this.calculationStageState.live2dFocus.push({ target, focus: { ...baseFocusParam, ...focus } });
    } else {
      this.calculationStageState.live2dFocus[index].focus = {
        ...this.calculationStageState.live2dFocus[index].focus,
        ...focus,
      };
    }
  }

  public replaceUIlable(payload: [string, string]) {
    this.calculationStageState.replacedUIlable[payload[0]] = payload[1];
  }

  public setFigureMetaData(payload: [string, keyof IFigureMetadata, any, undefined | boolean]) {
    if (payload[3]) {
      if (this.calculationStageState.figureMetaData[payload[0]]) {
        delete this.calculationStageState.figureMetaData[payload[0]];
      }
    } else {
      if (!this.calculationStageState.figureMetaData[payload[0]]) {
        this.calculationStageState.figureMetaData[payload[0]] = {};
      }
      this.calculationStageState.figureMetaData[payload[0]][payload[1]] = payload[2];
    }
  }

  public clearUncommittedNonHoldPerforms(retained: readonly IRunPerform[] = []) {
    const isRetained = (perform: IRunPerform) =>
      retained.some((expected) => expected.id === perform.id && isEqual(expected.script, perform.script));
    this.calculationStageState.PerformList = this.calculationStageState.PerformList.filter(
      (perform) => perform.isHoldOn || isRetained(perform),
    );
  }

  public removeNonHoldPerformsAndCommit() {
    this.clearUncommittedNonHoldPerforms();
    this.commit();
  }

  public commit(options: IStageCommitOptions = {}) {
    if (this.isolatedCalculationDepth > 0) {
      console.error({ scope: 'webgal.stage.committed', code: 'RETIRED_PERFORM_COMMIT_REJECTED' });
      return;
    }
    // Validate before publishing. A handler/observer error AFTER publication is not a rejected state transaction.
    // Pixi side-effect rollback is explicitly outside this state-only layer.
    assertEntityState(this.calculationStageState);
    const resolvedOptions: IResolvedStageCommitOptions = {
      syncPixiStage: options.syncPixiStage ?? true,
      applyPixiEffects: options.applyPixiEffects ?? true,
      notifyReact: options.notifyReact ?? true,
      skipAnimation: options.skipAnimation ?? false,
    };
    this.viewStageState = cloneDeep(this.calculationStageState);
    this.calculationAtViewCommit = this.calculationStageState;
    this.commitHandler?.(this.viewStageState, resolvedOptions);
    if (resolvedOptions.notifyReact) {
      this.notify();
    }
  }

  public applyCommittedPixiEffects() {
    this.commitHandler?.(this.viewStageState, {
      syncPixiStage: false,
      applyPixiEffects: true,
      notifyReact: false,
      skipAnimation: false,
    });
  }

  public setCommitHandler(handler: StageCommitHandler | null) {
    this.commitHandler = handler;
  }

  public subscribe(listener: StageStateListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const stageState = this.viewStageState;
    this.listeners.forEach((listener) => listener(stageState));
  }
}

export const stageStateManager = new StageStateManager();
