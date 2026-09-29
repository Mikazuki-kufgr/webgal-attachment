import { describe, expect, it, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { StageStateManager } from './stageStateManager';
import { initialLegacyAttachmentLocalVisualState, legacyAttachmentLink } from './stageEntityStateTransaction';
import type { IAttachmentState, StageEntityStateV0 } from './stageInterface';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';

const row = (): IAttachmentState => ({
  figureKey: 'fig-center',
  attachmentId: 'hat',
  configId: 'hat-a',
  visible: true,
});
function seed(explicit = false) {
  const manager = new StageStateManager();
  const attachment = row();
  if (explicit) {
    attachment.entityId = 'entity-hat';
    const visual = initialLegacyAttachmentLocalVisualState(true);
    const entity: StageEntityStateV0 = {
      schemaVersion: 0,
      entityId: attachment.entityId,
      renderableKind: 'attachment-sprite-group',
      source: {
        configId: attachment.configId,
        legacyAlias: { originFigureKey: attachment.figureKey, attachmentId: attachment.attachmentId },
      },
      visualState: visual,
      attachmentLink: legacyAttachmentLink(attachment, visual),
    };
    manager.applyStageEntityTransaction({
      kind: 'upsert-explicit-attachment',
      attachment: { ...attachment, entityId: attachment.entityId },
      entity,
    });
  } else {
    manager.applyStageEntityTransaction({
      kind: 'upsert-legacy-attachment',
      attachment,
      canonicalEntityId: deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId),
    });
  }
  manager.commit();
  return manager;
}

describe('Runtime exact committed-view compensation (no renderer/autosave)', () => {
  it('removes only the failed row while preserving uncommitted future dialogue', () => {
    const manager = seed();
    const view = manager.getViewStageState();
    manager.setStage('showText', 'future dialogue');
    const handler = vi.fn();
    manager.setCommitHandler(handler);
    const listener = vi.fn();
    manager.subscribe(listener);
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0])).toMatchObject({
      applied: true,
      calculationApplied: false,
    });
    expect(manager.getViewStageState().showText).toBe('');
    expect(manager.getCalculationStageState().showText).toBe('future dialogue');
    expect(manager.getViewStageState().attachments).toEqual([]);
    expect(manager.getCalculationStageState().attachments).toEqual([row()]);
    expect(handler).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('does not erase a newer calculation declaration with the same composite', () => {
    const manager = seed();
    const view = manager.getViewStageState();
    const newer = { ...row(), configId: 'hat-b' };
    manager.applyStageEntityTransaction({
      kind: 'upsert-legacy-attachment',
      attachment: newer,
      canonicalEntityId: deriveLegacyAttachmentEntityId(newer.figureKey, newer.attachmentId),
    });
    const calculation = manager.getCalculationStageState();
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0])).toMatchObject({
      applied: true,
      calculationApplied: false,
    });
    expect(manager.getCalculationStageState()).toBe(calculation);
    expect(calculation.attachments[0].configId).toBe('hat-b');
    expect(manager.getViewStageState().attachments).toEqual([]);
  });
  it('rejects stale view tokens even after A to B to A', () => {
    const manager = seed();
    const view = manager.getViewStageState();
    manager.commit();
    const calculation = manager.getCalculationStageState();
    const currentView = manager.getViewStageState();
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0]).applied).toBe(false);
    expect(manager.getCalculationStageState()).toBe(calculation);
    expect(manager.getViewStageState()).toBe(currentView);
  });
  it('preserves a same-source identical-row re-add after the displayed declaration', () => {
    const manager = seed();
    const view = manager.getViewStageState();
    const attachment = row();
    manager.applyStageEntityTransaction({
      kind: 'upsert-legacy-attachment',
      attachment,
      canonicalEntityId: deriveLegacyAttachmentEntityId(attachment.figureKey, attachment.attachmentId),
    });
    const calculation = manager.getCalculationStageState();
    expect(calculation).toEqual(view);
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0])).toMatchObject({
      applied: true,
      calculationApplied: false,
    });
    expect(manager.getCalculationStageState()).toBe(calculation);
    expect(calculation.attachments).toEqual([row()]);
  });
  it('preserves an identical row calculated for a future different parent model', () => {
    const manager = seed();
    manager.setStage('figName', 'model-a.json');
    manager.commit();
    const view = manager.getViewStageState();
    manager.setStage('figName', 'model-b.json');
    const calculation = manager.getCalculationStageState();
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0])).toMatchObject({
      applied: true,
      calculationApplied: false,
    });
    expect(manager.getCalculationStageState()).toBe(calculation);
    expect(calculation.figName).toBe('model-b.json');
    expect(calculation.attachments[0]).toEqual(row());
    expect(manager.getViewStageState().attachments).toEqual([]);
  });
  it('removes entity, legacy projection and sole effect as one validated unit', () => {
    const manager = seed(true);
    const view = manager.getViewStageState();
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0], view.stageEntities[0]).applied).toBe(
      true,
    );
    for (const state of [manager.getViewStageState(), manager.getCalculationStageState()]) {
      expect(state.stageEntities).toEqual([]);
      expect(state.attachments).toEqual([]);
      expect(state.effects.some((effect) => effect.target === 'entity-hat')).toBe(false);
    }
  });
  it('requires the exact explicit entity and refuses unguarded removal', () => {
    const manager = seed(true);
    const view = manager.getViewStageState();
    const before = cloneDeep(view);
    expect(manager.compensateCommittedAttachmentRemoval(view, view.attachments[0]).applied).toBe(false);
    expect(
      manager.compensateCommittedAttachmentRemoval(view, view.attachments[0], {
        ...view.stageEntities[0],
        entityId: 'other',
      }).applied,
    ).toBe(false);
    expect(manager.getViewStageState()).toBe(view);
    expect(view).toEqual(before);
  });
  it('rejects a forged config row without publishing either state', () => {
    const manager = seed();
    const view = manager.getViewStageState();
    const calculation = manager.getCalculationStageState();
    expect(
      manager.compensateCommittedAttachmentRemoval(view, { ...view.attachments[0], configId: 'forged' }).applied,
    ).toBe(false);
    expect(manager.getViewStageState()).toBe(view);
    expect(manager.getCalculationStageState()).toBe(calculation);
  });
  it('invalidates previously prepared opaque plans', () => {
    const manager = seed();
    const view = manager.getViewStageState();
    const plan = manager.prepareStageEntityTransaction({ kind: 'remove', expectedAttachment: view.attachments[0] });
    if (!plan.prepared) throw new Error('expected valid plan');
    manager.compensateCommittedAttachmentRemoval(view, view.attachments[0]);
    expect(manager.commitPreparedStageEntityTransaction(plan.plan).applied).toBe(false);
  });
  it('cannot remove an unrelated free entity through the attachment-only API', () => {
    const manager = seed(true);
    const view = manager.getViewStageState();
    const wrong = { ...view.attachments[0], entityId: undefined };
    expect(manager.compensateCommittedAttachmentRemoval(view, wrong, view.stageEntities[0]).applied).toBe(false);
    expect(manager.getViewStageState()).toBe(view);
  });
});
