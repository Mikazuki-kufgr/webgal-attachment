import { describe, it, expect, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { StageStateManager, initState } from './stageStateManager';
import type { IStageState } from './stageInterface';
import type { ISentence } from '@/Core/controller/scene/sceneInterface';
function fixture(): IStageState {
  return {
    ...cloneDeep(initState),
    figName: 'model.json',
    attachments: [{ figureKey: 'fig-center', attachmentId: 'hat', configId: 'hat', visible: false }],
  };
}
describe('committed entity command transactions', () => {
  it('publishes one view transaction and synchronized calculation without renderer/autosave', () => {
    const manager = new StageStateManager(),
      handler = vi.fn();
    manager.replaceAllStageState(fixture());
    manager.setCommitHandler(handler);
    const view = manager.getViewStageState();
    const result = manager.applyCommittedStageEntityTransaction(view, {
      kind: 'set-visibility',
      expectedAttachment: view.attachments[0],
      visible: true,
    });
    expect(result.applied).toBe(true);
    expect(result.calculationApplied).toBe(true);
    expect(manager.getViewStageState().attachments[0].visible).toBe(true);
    expect(manager.getCalculationStageState().attachments[0].visible).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
  it('never publishes or overwrites an advanced future calculation', () => {
    const manager = new StageStateManager();
    manager.replaceAllStageState(fixture());
    const view = manager.getViewStageState();
    manager.setStage('showText', 'future');
    const result = manager.applyCommittedStageEntityTransaction(view, {
      kind: 'set-visibility',
      expectedAttachment: view.attachments[0],
      visible: true,
    });
    expect(result.applied).toBe(true);
    expect(result.calculationApplied).toBe(false);
    expect(manager.getViewStageState().showText).toBe('');
    expect(manager.getCalculationStageState().showText).toBe('future');
    expect(manager.getCalculationStageState().attachments[0].visible).toBe(false);
  });
  it('rejects consumed view and identical-value newly calculated root ABA', () => {
    const manager = new StageStateManager();
    manager.replaceAllStageState(fixture());
    const view = manager.getViewStageState();
    manager.applyStageEntityTransaction({
      kind: 'set-visibility',
      expectedAttachment: manager.getCalculationStageState().attachments[0],
      visible: false,
    });
    const result = manager.applyCommittedStageEntityTransaction(view, {
      kind: 'set-visibility',
      expectedAttachment: view.attachments[0],
      visible: true,
    });
    expect(result.calculationApplied).toBe(false);
    expect(
      manager.applyCommittedStageEntityTransaction(view, { kind: 'remove', expectedAttachment: view.attachments[0] })
        .applied,
    ).toBe(false);
  });
  it('isolates old stop endpoint writes and refuses publication from retired callback', () => {
    const manager = new StageStateManager();
    manager.replaceAllStageState(fixture());
    const calc = manager.getCalculationStageState(),
      view = manager.getViewStageState();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    manager.withIsolatedCalculation(() => {
      manager.setStage('showText', 'retired');
      manager.commit();
    });
    expect(manager.getCalculationStageState()).toBe(calc);
    expect(manager.getViewStageState()).toBe(view);
    expect(calc.showText).toBe('');
    expect(diagnostic).toHaveBeenCalled();
    diagnostic.mockRestore();
  });
  it('restores exact roots on throwing nested retirement', () => {
    const manager = new StageStateManager();
    manager.replaceAllStageState(fixture());
    const calc = manager.getCalculationStageState();
    expect(() =>
      manager.withIsolatedCalculation(() =>
        manager.withIsolatedCalculation(() => {
          manager.setStage('showText', 'bad');
          throw new Error('cleanup');
        }),
      ),
    ).toThrow('cleanup');
    expect(manager.getCalculationStageState()).toBe(calc);
    expect(manager.isCalculationSynchronizedWithView()).toBe(true);
  });
  it('removes the exact perform from both snapshots without exposing unrelated future state', () => {
    const manager = new StageStateManager();
    const state = fixture();
    const script = {
      command: 35,
      commandRaw: 'attachment',
      content: 'add',
      args: [],
      sentenceAssets: [],
      subScene: [],
      inlineComment: '',
      isLineBreakHolder: false,
    } as unknown as ISentence;
    const row = { id: 'operation', isHoldOn: false, script };
    state.PerformList = [row];
    manager.replaceAllStageState(state);
    manager.setStage('showText', 'future');
    expect(manager.removeCommittedPerform(row)).toBe(true);
    expect(manager.getViewStageState().PerformList).toEqual([]);
    expect(manager.getViewStageState().showText).toBe('');
    expect(manager.getCalculationStageState().PerformList).toEqual([]);
    expect(manager.getCalculationStageState().showText).toBe('future');
    expect(manager.removeCommittedPerform(row)).toBe(false);
  });
});
