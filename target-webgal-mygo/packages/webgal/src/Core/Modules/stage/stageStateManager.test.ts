import { describe, it, expect, vi } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import {
  StageStateManager,
  StageEntityStateError,
  initState,
  type PreparedStageEntityTransaction,
} from './stageStateManager';
import {
  applyStageEntityStateTransaction,
  initialLegacyAttachmentLocalVisualState,
  legacyAttachmentLink,
  validateStageEntityStateInvariants,
  type StageEntityStateTransaction,
} from './stageEntityStateTransaction';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import type { IAttachmentState, StageEntityStateV0, VisualStateV0, IStageState, IRunPerform } from './stageInterface';

const performSentence = (content: string): ISentence => ({
  command: commandType.attachment,
  commandRaw: 'attachment',
  content,
  args: [],
  sentenceAssets: [],
  subScene: [],
  inlineComment: '',
  isLineBreakHolder: false,
});

const legacy = (id = 'hat', figure = 'fig-center'): IAttachmentState => ({
  attachmentId: id,
  figureKey: figure,
  configId: 'preset-' + id,
  semanticAnchor: 'ear-left',
  visible: true,
});
const lazy = (a = legacy()): StageEntityStateTransaction => ({
  kind: 'upsert-legacy-attachment',
  attachment: a,
  canonicalEntityId: deriveLegacyAttachmentEntityId(a.figureKey, a.attachmentId),
});
const world = (): VisualStateV0 => ({
  space: 'world',
  position: { x: 123, y: -45 },
  scale: { x: -2, y: 3 },
  rotation: 0.7,
  skew: { x: 0.1, y: -0.2 },
  opacity: 0.4,
  visible: false,
});
function explicit(
  id = 'entity-hat',
  a = legacy(),
): Extract<StageEntityStateTransaction, { kind: 'upsert-explicit-attachment' }> {
  const visual = initialLegacyAttachmentLocalVisualState(a.visible);
  return {
    kind: 'upsert-explicit-attachment',
    attachment: { ...a, entityId: id },
    entity: {
      schemaVersion: 0,
      entityId: id,
      renderableKind: 'attachment-sprite-group',
      source: {
        configId: a.configId,
        ...(a.slot ? { slot: a.slot } : {}),
        legacyAlias: { originFigureKey: a.figureKey, attachmentId: a.attachmentId },
      },
      visualState: visual,
      attachmentLink: legacyAttachmentLink(a, visual),
    },
  };
}
function seeded() {
  const m = new StageStateManager();
  expect(m.applyStageEntityTransaction(explicit()).applied).toBe(true);
  return m;
}
function entity(m: StageStateManager) {
  return cloneDeep(m.getCalculationStageState().stageEntities[0]);
}
function plan(m: StageStateManager, tx = lazy()) {
  const p = m.prepareStageEntityTransaction(tx);
  expect(p.prepared).toBe(true);
  if (!p.prepared) throw Error('prepare');
  return p.plan;
}
function unchanged(m: StageStateManager, fn: () => unknown) {
  const calc = m.getCalculationStageState(),
    view = m.getViewStageState(),
    before = cloneDeep(calc);
  fn();
  expect(m.getCalculationStageState()).toBe(calc);
  expect(calc).toEqual(before);
  expect(m.getViewStageState()).toBe(view);
}

describe('calculation/view transaction boundary', () => {
  it('publishes attachment visibility across late native effects without losing those effects', () => {
    const m = new StageStateManager();
    m.applyStageEntityTransaction(explicit('entity-hat', { ...legacy(), visible: false }));
    m.commit();
    m.updateEffect({ target: 'fig-center', transform: { alpha: 0.7, position: { x: 23, y: 41 } } });
    const nativeEffect = cloneDeep(m.getCalculationStageState().effects.find((row) => row.target === 'fig-center'));
    const view = m.getViewStageState();
    const result = m.applyCommittedStageEntityTransaction(view, {
      kind: 'set-visibility',
      entityId: 'entity-hat',
      expectedEntity: view.stageEntities[0],
      visible: true,
    });
    expect(result.calculationApplied).toBe(true);
    m.commit();
    expect(m.getViewStageState().stageEntities[0].visualState.visible).toBe(true);
    expect(m.getViewStageState().effects.find((row) => row.target === 'fig-center')).toEqual(nativeEffect);
  });
  it.each(['same-value-hide', 'transform', 'future-text'] as const)(
    'does not overwrite newer %s calculation while publishing visible view',
    (future) => {
      const m = new StageStateManager();
      m.applyStageEntityTransaction(explicit('entity-hat', { ...legacy(), visible: false }));
      m.commit();
      const view = m.getViewStageState();
      m.updateEffect({ target: 'fig-center', transform: { alpha: 0.7 } });
      if (future === 'same-value-hide')
        m.applyStageEntityTransaction({
          kind: 'set-visibility',
          entityId: 'entity-hat',
          expectedEntity: entity(m),
          visible: false,
        });
      if (future === 'transform') m.updateEffect({ target: 'entity-hat', transform: { alpha: 0.2 } });
      if (future === 'future-text') m.setStage('showText', 'future');
      const expectedCalculation = cloneDeep(m.getCalculationStageState());
      const result = m.applyCommittedStageEntityTransaction(view, {
        kind: 'set-visibility',
        entityId: 'entity-hat',
        expectedEntity: view.stageEntities[0],
        visible: true,
      });
      expect(result.applied).toBe(true);
      expect(result.calculationApplied).toBe(false);
      expect(m.getCalculationStageState()).toEqual(expectedCalculation);
    },
  );
  it('removes only the exact committed perform while preserving a same-id future calculation owner', () => {
    const m = new StageStateManager();
    const old: IRunPerform = { id: 'same', isHoldOn: false, script: performSentence('add') };
    const successor: IRunPerform = { id: 'same', isHoldOn: false, script: performSentence('hide') };
    m.addPerform(old);
    m.commit({ applyPixiEffects: false });
    m.setStage('showText', 'future calculation');
    m.addPerform(successor);

    expect(m.removeCommittedPerform(old)).toBe(true);
    expect(m.getViewStageState().PerformList).toEqual([]);
    expect(m.getCalculationStageState().PerformList).toEqual([successor]);
    expect(m.getCalculationStageState().showText).toBe('future calculation');
    m.commit({ applyPixiEffects: false });
    expect(m.getViewStageState().PerformList).toEqual([successor]);
  });
  it('preserves native setter reference semantics when no plugin state exists', () => {
    const m = new StageStateManager(),
      calc = m.getCalculationStageState();
    const effects = cloneDeep(initState.effects),
      figures: IStageState['freeFigure'] = [];
    m.setStage('effects', effects);
    m.setStage('freeFigure', figures);
    expect(m.getCalculationStageState()).toBe(calc);
    expect(calc.effects).toBe(effects);
    expect(calc.freeFigure).toBe(figures);
  });
  it('isolates initialization per manager and from the exported defaults', () => {
    const a = new StageStateManager(),
      b = new StageStateManager();
    a.setStage('showText', 'A');
    expect(b.getCalculationStageState().showText).toBe('');
    expect(a.getViewStageState().showText).toBe('');
    expect(initState.attachments).toEqual([]);
  });
  it('publishes no partial arrays and calls the host exactly once on explicit commit', () => {
    const m = new StageStateManager(),
      handler = vi.fn(),
      listener = vi.fn();
    m.setCommitHandler(handler);
    m.subscribe(listener);
    const tx = explicit();
    expect(m.applyStageEntityTransaction(tx).applied).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(m.getViewStageState().attachments).toEqual([]);
    m.commit();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(validateStageEntityStateInvariants(listener.mock.calls[0][0])).toEqual([]);
    tx.entity.visualState.position.x = 999;
    expect(entity(m).visualState.position.x).toBe(0);
    m.getCalculationStageState().stageEntities[0].visualState.position.x = 7;
    expect(m.getViewStageState().stageEntities[0].visualState.position.x).toBe(0);
  });
  it('preparation changes neither state and consumes only one manager-owned token', () => {
    const m = new StageStateManager(),
      foreign = new StageStateManager(),
      p = plan(m);
    expect(m.getCalculationStageState().attachments).toEqual([]);
    expect(foreign.commitPreparedStageEntityTransaction(p).applied).toBe(false);
    expect(m.commitPreparedStageEntityTransaction(p).applied).toBe(true);
    unchanged(m, () => expect(m.commitPreparedStageEntityTransaction(p).applied).toBe(false));
    unchanged(m, () =>
      expect(m.commitPreparedStageEntityTransaction({} as PreparedStageEntityTransaction).applied).toBe(false),
    );
  });
  it.each(['reset', 'replace', 'view-commit', 'host-mutation', 'transaction-ABA', 'effect-ABA'] as const)(
    'rejects stale plan after %s',
    (action) => {
      const m = seeded();
      const p = plan(m, lazy(legacy('second')));
      if (action === 'reset') m.resetCalculationStageState(initState);
      if (action === 'replace') m.replaceCalculationStageState(m.getCalculationStageState());
      if (action === 'view-commit') m.commit();
      if (action === 'host-mutation') m.setStage('showText', 'newer');
      if (action === 'transaction-ABA') {
        m.applyStageEntityTransaction({ kind: 'set-visibility', entityId: 'entity-hat', visible: false });
        m.applyStageEntityTransaction({ kind: 'set-visibility', entityId: 'entity-hat', visible: true });
      }
      if (action === 'effect-ABA') {
        m.updateEffect({ target: 'entity-hat', transform: { rotation: 2 } });
        m.updateEffect({ target: 'entity-hat', transform: { rotation: 0 } });
      }
      unchanged(m, () =>
        expect(m.commitPreparedStageEntityTransaction(p).violations[0].code).toBe('ENTITY_TRANSACTION_STALE'),
      );
    },
  );
  it('freezes expected input internally across caller mutation', () => {
    const m = new StageStateManager(),
      tx = explicit(),
      p = plan(m, tx);
    tx.entity.visualState.position.x = 800;
    expect(m.commitPreparedStageEntityTransaction(p).applied).toBe(true);
    expect(entity(m).visualState.position.x).toBe(0);
  });
  it('preserves native commit options and effect-only callback behavior', () => {
    const m = seeded(),
      handler = vi.fn(),
      listener = vi.fn();
    m.setCommitHandler(handler);
    const off = m.subscribe(listener);
    m.commit({ notifyReact: false, syncPixiStage: false, applyPixiEffects: false, skipAnimation: true });
    expect(listener).not.toHaveBeenCalled();
    expect(handler.mock.calls[0][1]).toEqual({
      notifyReact: false,
      syncPixiStage: false,
      applyPixiEffects: false,
      skipAnimation: true,
    });
    m.applyCommittedPixiEffects();
    expect(handler.mock.calls[1][1]).toEqual({
      notifyReact: false,
      syncPixiStage: false,
      applyPixiEffects: true,
      skipAnimation: false,
    });
    off();
    m.commit();
    expect(listener).not.toHaveBeenCalled();
  });
  it('documents handler failure after publication, not false rollback of external rendering', () => {
    const m = seeded();
    m.setCommitHandler(() => {
      throw Error('renderer failure');
    });
    expect(() => m.commit()).toThrow('renderer failure');
    expect(m.getViewStageState().stageEntities).toEqual(m.getCalculationStageState().stageEntities);
    expect(validateStageEntityStateInvariants(m.getViewStageState())).toEqual([]);
  });
  it('rejects invalid raw calculation state before exposing it to observers', () => {
    const m = seeded(),
      view = m.getViewStageState(),
      handler = vi.fn();
    m.setCommitHandler(handler);
    m.getCalculationStageState().effects = [];
    expect(() => m.commit()).toThrow(StageEntityStateError);
    expect(m.getViewStageState()).toBe(view);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('legacy identity and state transitions', () => {
  it('keeps legacy add lazy and retains semanticAnchor on promotion', () => {
    const m = new StageStateManager(),
      a = legacy();
    expect(m.applyStageEntityTransaction(lazy(a)).applied).toBe(true);
    expect(m.getCalculationStageState().stageEntities).toEqual([]);
    const id = deriveLegacyAttachmentEntityId(a.figureKey, a.attachmentId);
    expect(
      m.applyStageEntityTransaction({
        kind: 'promote-and-set-visibility',
        expectedAttachment: a,
        entityId: id,
        visible: false,
      }).applied,
    ).toBe(true);
    expect(entity(m).attachmentLink?.semanticAnchor).toBe('ear-left');
    expect(entity(m).visualState.visible).toBe(false);
  });
  it('promotes directly to a free world state and retains local history', () => {
    const m = new StageStateManager(),
      a = legacy();
    m.applyStageEntityTransaction(lazy(a));
    expect(
      m.applyStageEntityTransaction({
        kind: 'promote-and-detach',
        expectedAttachment: a,
        entityId: deriveLegacyAttachmentEntityId(a.figureKey, a.attachmentId),
        visualState: world(),
      }).applied,
    ).toBe(true);
    expect(entity(m).visualState).toEqual(world());
    expect(entity(m).source.lastAttachedLocalVisualState?.space).toBe('local');
    expect(m.getCalculationStageState().attachments).toEqual([]);
  });
  it('detaches, reattaches across parent, keeps origin alias and synchronizes effects', () => {
    const m = seeded(),
      before = entity(m);
    expect(
      m.applyStageEntityTransaction({
        kind: 'detach',
        entityId: before.entityId,
        expectedEntity: before,
        visualState: world(),
      }).applied,
    ).toBe(true);
    expect(entity(m).source.lastAttachedLocalVisualState).toEqual(before.visualState);
    const link = legacyAttachmentLink(legacy('hat', 'fig-right'), initialLegacyAttachmentLocalVisualState(false));
    link.attachedLocalVisualState.position = { x: 4, y: 5 };
    expect(
      m.applyStageEntityTransaction({
        kind: 'reattach',
        entityId: before.entityId,
        expectedEntity: entity(m),
        attachmentLink: link,
      }).applied,
    ).toBe(true);
    expect(entity(m).source.legacyAlias?.originFigureKey).toBe('fig-center');
    expect(m.getCalculationStageState().attachments[0].figureKey).toBe('fig-right');
    expect(entity(m).visualState).toEqual(link.attachedLocalVisualState);
    expect(validateStageEntityStateInvariants(m.getCalculationStageState())).toEqual([]);
  });
  it('replacement without skew clears the old entity/effect skew', () => {
    const m = seeded(),
      tx = explicit();
    tx.entity.visualState.skew = { x: 1, y: 2 };
    tx.entity.attachmentLink = legacyAttachmentLink(
      tx.attachment,
      tx.entity.visualState as ReturnType<typeof initialLegacyAttachmentLocalVisualState>,
    );
    expect(m.applyStageEntityTransaction(tx).applied).toBe(true);
    expect(m.applyStageEntityTransaction(explicit()).applied).toBe(true);
    expect(m.getCalculationStageState().effects.find((e) => e.target === 'entity-hat')?.transform?.skew).toEqual({
      x: 0,
      y: 0,
    });
    const cleared = explicit();
    delete cleared.entity.visualState.skew;
    delete cleared.entity.attachmentLink!.attachedLocalVisualState.skew;
    expect(m.applyStageEntityTransaction(cleared).applied).toBe(true);
    expect(
      m.getCalculationStageState().effects.find((e) => e.target === 'entity-hat')?.transform?.skew,
    ).toBeUndefined();
  });
  it('remove is one coherent entity/projection/effect deletion', () => {
    const m = seeded();
    expect(
      m.applyStageEntityTransaction({ kind: 'remove', entityId: 'entity-hat', expectedEntity: entity(m) }).applied,
    ).toBe(true);
    expect(m.getCalculationStageState().attachments).toEqual([]);
    expect(m.getCalculationStageState().stageEntities).toEqual([]);
    expect(m.getCalculationStageState().effects.map((e) => e.target)).toEqual(['stage-main']);
  });
  it('legacy visibility and removal use exact expected rows', () => {
    const m = new StageStateManager(),
      a = legacy();
    m.applyStageEntityTransaction(lazy(a));
    expect(
      m.applyStageEntityTransaction({ kind: 'set-visibility', expectedAttachment: a, visible: false }).applied,
    ).toBe(true);
    unchanged(m, () =>
      expect(m.applyStageEntityTransaction({ kind: 'remove', expectedAttachment: a }).applied).toBe(false),
    );
    expect(
      m.applyStageEntityTransaction({ kind: 'remove', expectedAttachment: { ...a, visible: false } }).applied,
    ).toBe(true);
  });
  it('failed new add rollback deletes only its own declaration', () => {
    const m = seeded(),
      a = cloneDeep(m.getCalculationStageState().attachments[0]),
      e = entity(m);
    expect(
      m.applyStageEntityTransaction({ kind: 'rollback-attachment-add', expectedAttachment: a, expectedEntity: e })
        .applied,
    ).toBe(true);
    expect(m.getCalculationStageState().stageEntities).toEqual([]);
  });
  it('failed replacement restores previous entity, projection and appearance', () => {
    const m = seeded(),
      previousEntity = entity(m),
      previousAttachment = cloneDeep(m.getCalculationStageState().attachments[0]);
    const tx = explicit();
    tx.attachment.configId = 'replacement';
    tx.entity.source.configId = 'replacement';
    tx.entity.attachmentLink!.placementPresetId = 'replacement';
    m.applyStageEntityTransaction(tx);
    expect(
      m.applyStageEntityTransaction({
        kind: 'rollback-attachment-add',
        expectedAttachment: tx.attachment,
        expectedEntity: tx.entity,
        previousAttachment,
        previousEntity,
      }).applied,
    ).toBe(true);
    expect(entity(m)).toEqual(previousEntity);
  });
  it('rejects stale compensation after a newer visibility change', () => {
    const m = seeded(),
      expectedEntity = entity(m),
      expectedAttachment = cloneDeep(m.getCalculationStageState().attachments[0]);
    m.applyStageEntityTransaction({ kind: 'set-visibility', entityId: 'entity-hat', visible: false });
    unchanged(m, () =>
      expect(
        m.applyStageEntityTransaction({ kind: 'rollback-attachment-add', expectedAttachment, expectedEntity }).applied,
      ).toBe(false),
    );
  });
  it.each(['slot', 'entity-id', 'destination-composite'] as const)(
    'rejects %s conflict without changing state',
    (kind) => {
      const m = seeded();
      if (kind === 'slot') {
        const a = explicit();
        a.attachment.slot = 'headwear';
        a.entity.source.slot = 'headwear';
        m.applyStageEntityTransaction(a);
        const b = explicit('another', { ...legacy('other'), slot: 'headwear' });
        unchanged(m, () => expect(m.applyStageEntityTransaction(b).applied).toBe(false));
      } else if (kind === 'entity-id') {
        unchanged(m, () =>
          expect(m.applyStageEntityTransaction(explicit('entity-hat', legacy('other'))).applied).toBe(false),
        );
      } else {
        m.applyStageEntityTransaction({ kind: 'detach', entityId: 'entity-hat', visualState: world() });
        m.applyStageEntityTransaction(lazy(legacy('hat', 'fig-right')));
        unchanged(m, () =>
          expect(
            m.applyStageEntityTransaction({
              kind: 'reattach',
              entityId: 'entity-hat',
              attachmentLink: legacyAttachmentLink(
                legacy('hat', 'fig-right'),
                initialLegacyAttachmentLocalVisualState(),
              ),
            }).applied,
          ).toBe(false),
        );
      }
    },
  );
  it('preserves attached exit timing and free entities when figure paths are cleared', () => {
    const m = seeded();
    m.setStage('figName', '');
    expect(m.getCalculationStageState().stageEntities).toHaveLength(1);
    m.applyStageEntityTransaction({ kind: 'detach', entityId: 'entity-hat', visualState: world() });
    m.setStage('figName', '');
    expect(entity(m).visualState).toEqual(world());
  });
  it('roundtrips serializable state without turning free entities into figures', () => {
    const m = seeded();
    m.applyStageEntityTransaction({ kind: 'detach', entityId: 'entity-hat', visualState: world() });
    const restored = new StageStateManager();
    restored.replaceCalculationStageState(JSON.parse(JSON.stringify(m.getCalculationStageState())));
    expect(restored.getCalculationStageState()).toEqual(m.getCalculationStageState());
    expect(restored.getViewStageState().stageEntities).toEqual([]);
  });
  it.each(['fig-center', 'stage-main', 'custom-figure'])('rejects collision with native target %s', (id) => {
    const m = new StageStateManager();
    if (id === 'custom-figure') m.setFreeFigureByKey({ key: id, name: 'person.png', basePosition: 'center' });
    unchanged(m, () => expect(m.applyStageEntityTransaction(explicit(id)).applied).toBe(false));
  });
  it('rejects free figure key collisions with lazy IDs before mutation', () => {
    const m = new StageStateManager(),
      a = legacy();
    m.applyStageEntityTransaction(lazy(a));
    unchanged(m, () =>
      expect(() =>
        m.setFreeFigureByKey({
          key: deriveLegacyAttachmentEntityId(a.figureKey, a.attachmentId),
          name: 'person.png',
          basePosition: 'center',
        }),
      ).toThrow(StageEntityStateError),
    );
  });
  it('strict tuple encoding is injective for delimiters and unicode', () => {
    const ids = [
      ['a:b', 'c'],
      ['a', 'b:c'],
      ['a%3Ab', 'c'],
      ['猫', '帽!'],
      ['a', 'b/c'],
    ].map(([a, b]) => deriveLegacyAttachmentEntityId(a, b));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('bounded invalid-input and replacement guards', () => {
  it('cannot pair a failed lazy add with an unrelated free entity for rollback', () => {
    const m = seeded();
    m.applyStageEntityTransaction({ kind: 'detach', entityId: 'entity-hat', visualState: world() });
    const a = legacy('another');
    m.applyStageEntityTransaction(lazy(a));
    unchanged(m, () =>
      expect(
        m.applyStageEntityTransaction({
          kind: 'rollback-attachment-add',
          expectedAttachment: a,
          expectedEntity: entity(m),
        }).applied,
      ).toBe(false),
    );
  });
  it('cannot restore a previous attachment from another composite', () => {
    const m = seeded(),
      expectedEntity = entity(m),
      expectedAttachment = cloneDeep(m.getCalculationStageState().attachments[0]);
    unchanged(m, () =>
      expect(
        m.applyStageEntityTransaction({
          kind: 'rollback-attachment-add',
          expectedAttachment,
          expectedEntity,
          previousAttachment: legacy('foreign'),
        }).applied,
      ).toBe(false),
    );
  });
  it('rejects invalid replacement before changing either calculation or view', () => {
    const m = seeded(),
      handler = vi.fn();
    m.setCommitHandler(handler);
    unchanged(m, () =>
      expect(() => m.replaceAllStageState({ ...m.getCalculationStageState(), effects: [] })).toThrow(
        StageEntityStateError,
      ),
    );
    expect(handler).not.toHaveBeenCalled();
  });
  it.each(['attachments', 'stageEntities', 'effects'] as const)(
    'rejects sparse %s without throwing from a pure transaction',
    (key) => {
      const bad = cloneDeep(initState);
      (bad[key] as unknown[]).length += 1;
      expect(applyStageEntityStateTransaction(bad, lazy()).applied).toBe(false);
    },
  );
  it('effect update failure keeps both snapshots and all notifications untouched', () => {
    const m = seeded(),
      handler = vi.fn(),
      listener = vi.fn();
    m.setCommitHandler(handler);
    m.subscribe(listener);
    unchanged(m, () =>
      expect(() => m.updateEffectAndCommit({ target: 'entity-hat', transform: { alpha: 2 } })).toThrow(
        StageEntityStateError,
      ),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
  it('valid effect update stays invisible until explicit commit', () => {
    const m = seeded();
    m.commit();
    m.updateEffect({ target: 'entity-hat', transform: { position: { x: 42 }, alpha: 0 } });
    expect(entity(m).visualState.position.x).toBe(42);
    expect(entity(m).visualState.opacity).toBe(0);
    expect(m.getViewStageState().stageEntities[0].visualState.position.x).toBe(0);
    m.commit();
    expect(m.getViewStageState().stageEntities[0].visualState.opacity).toBe(0);
  });
  it.each([
    null,
    {},
    { kind: 'unknown' },
    { kind: 'detach' },
    { kind: 'remove' },
    { kind: 'set-visibility', entityId: 'x', visible: 1 },
  ])('rejects malformed transaction %#', (bad) => {
    const m = seeded();
    unchanged(m, () => expect(m.applyStageEntityTransaction(bad as StageEntityStateTransaction).applied).toBe(false));
  });
  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])('rejects invalid opacity %s', (opacity) => {
    const m = seeded(),
      tx = explicit();
    tx.entity.visualState.opacity = opacity;
    unchanged(m, () => expect(m.applyStageEntityTransaction(tx).applied).toBe(false));
  });
  it.each(['source', 'visualState', 'attachmentLink'] as const)('rejects malformed nested %s', (key) => {
    const m = seeded(),
      tx = explicit();
    (tx.entity as unknown as Record<string, unknown>)[key] = {};
    unchanged(m, () => expect(m.applyStageEntityTransaction(tx).applied).toBe(false));
  });
  it('keeps missing plugin-array compatibility separate from malformed arrays', () => {
    const m = new StageStateManager(),
      s = cloneDeep(initState) as Partial<IStageState>;
    delete s.attachments;
    delete s.stageEntities;
    m.replaceCalculationStageState(s as IStageState);
    expect(m.getCalculationStageState().attachments).toEqual([]);
    unchanged(m, () =>
      expect(() =>
        m.replaceCalculationStageState({ ...initState, attachments: null } as unknown as IStageState),
      ).toThrow(StageEntityStateError),
    );
  });
  it.each(['attachments', 'stageEntities', 'effects'] as const)(
    'generic %s mutation cannot tear the atomic unit',
    (key) => {
      const m = seeded();
      unchanged(m, () => expect(() => m.setStage(key, [])).toThrow(StageEntityStateError));
    },
  );
  it('does not independently remove an entity effect', () => {
    const m = seeded();
    unchanged(m, () => m.removeEffectByTargetId('entity-hat'));
  });
  it('pure transaction never mutates source or payload on success or failure', () => {
    const s = cloneDeep(initState),
      tx = explicit(),
      source = cloneDeep(s),
      payload = cloneDeep(tx);
    const result = applyStageEntityStateTransaction(s, tx);
    expect(result.applied).toBe(true);
    expect(s).toEqual(source);
    expect(tx).toEqual(payload);
    const bad = explicit('entity-hat', legacy('other')),
      before = cloneDeep(result.state);
    expect(applyStageEntityStateTransaction(result.state, bad).state).toBe(result.state);
    expect(result.state).toEqual(before);
  });
  it('100 detach/reattach/remove cycles leave only original host effects', () => {
    const m = new StageStateManager();
    for (let i = 0; i < 100; i++) {
      expect(m.applyStageEntityTransaction(explicit()).applied).toBe(true);
      expect(
        m.applyStageEntityTransaction({
          kind: 'detach',
          entityId: 'entity-hat',
          expectedEntity: entity(m),
          visualState: world(),
        }).applied,
      ).toBe(true);
      expect(
        m.applyStageEntityTransaction({
          kind: 'reattach',
          entityId: 'entity-hat',
          expectedEntity: entity(m),
          attachmentLink: legacyAttachmentLink(legacy(), initialLegacyAttachmentLocalVisualState()),
        }).applied,
      ).toBe(true);
      expect(
        m.applyStageEntityTransaction({ kind: 'remove', entityId: 'entity-hat', expectedEntity: entity(m) }).applied,
      ).toBe(true);
      expect(validateStageEntityStateInvariants(m.getCalculationStageState())).toEqual([]);
    }
    expect(m.getCalculationStageState().effects).toEqual(initState.effects);
    expect(m.getCalculationStageState().stageEntities).toEqual([]);
  });
});
