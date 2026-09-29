import { describe, expect, it } from 'vitest';
import { StageStateManager } from './stageStateManager';
import { initialLegacyAttachmentLocalVisualState, legacyAttachmentLink } from './stageEntityStateTransaction';
import { validateStageEntityStateShape } from './stageEntityStateValidation';
import { createCommittedStageSnapshot, inspectStageStateForRestore } from './stageEntityPersistence';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import { toEntityAuthorTransform, toEntityWorldTransform } from './stageEntityAuthorCoordinates';
import { planEntityTransform } from '@/Core/gameScripts/transform/entityTransformCore';
import { createTargetTransformBaselineManager } from '@/Core/util/syncWithEditor/runtime/targetTransformBaseline';
import { queryStageObjectReferenceBox } from '@/Core/controller/stage/pixi/referenceBox';
import {
  createFrameFromReferenceBox,
  createTransformFromReferenceFrame,
} from '../../../../../../../target-webgal-mygo-terre/packages/origine2/src/pages/editor/TransformableBox/referenceBoxGeometry';

function fixture(origin: { x: number; y: number } | undefined = { x: 850, y: 800 }) {
  const manager = new StageStateManager();
  const attachment = { figureKey: 'actor', attachmentId: 'rose', entityId: 'rose', configId: 'rose', visible: true };
  const local = initialLegacyAttachmentLocalVisualState();
  const link = legacyAttachmentLink(attachment, local);
  expect(
    manager.applyStageEntityTransaction({
      kind: 'upsert-explicit-attachment',
      attachment,
      entity: {
        schemaVersion: 0,
        entityId: 'rose',
        renderableKind: 'attachment-sprite-group',
        source: { configId: 'rose', legacyAlias: { originFigureKey: 'actor', attachmentId: 'rose' } },
        visualState: local,
        attachmentLink: link,
      },
    }).applied,
  ).toBe(true);
  expect(
    manager.applyStageEntityTransaction({
      kind: 'detach',
      entityId: 'rose',
      freePositionOrigin: origin,
      visualState: { ...local, space: 'world', position: { x: 1000, y: 650 } },
    }).applied,
  ).toBe(true);
  manager.commit();
  return { manager, link, state: manager.getViewStageState(), entity: manager.getViewStageState().stageEntities[0] };
}

describe('free attachment native author coordinates', () => {
  it('promotes a legacy attachment with its frozen origin and preserves that contract through restore', () => {
    const manager = new StageStateManager();
    const attachment = { figureKey: 'actor', attachmentId: 'rose', configId: 'rose', visible: true };
    const entityId = deriveLegacyAttachmentEntityId('actor', 'rose');
    expect(
      manager.applyStageEntityTransaction({ kind: 'upsert-legacy-attachment', attachment, canonicalEntityId: entityId })
        .applied,
    ).toBe(true);
    expect(
      manager.applyStageEntityTransaction({
        kind: 'promote-and-detach',
        expectedAttachment: attachment,
        entityId,
        visualState: { ...initialLegacyAttachmentLocalVisualState(), space: 'world', position: { x: 650, y: 450 } },
        freePositionOrigin: { x: 530, y: 540 },
      }).applied,
    ).toBe(true);
    manager.commit();
    const saved = createCommittedStageSnapshot(manager.getViewStageState());
    manager.resetAllStageState(JSON.parse(JSON.stringify(saved)));
    const restored = manager.getViewStageState();
    expect(
      planEntityTransform(restored, { target: entityId, animationString: '{"position":{"x":0,"y":0}}' }).terminal
        .position,
    ).toEqual({ x: 530, y: 540 });
    delete saved.stageEntities[0].source.freePositionOrigin;
    manager.resetAllStageState(saved);
    expect(
      planEntityTransform(manager.getViewStageState(), {
        target: entityId,
        animationString: '{"position":{"x":0,"y":0}}',
      }).terminal.position,
    ).toEqual({ x: 0, y: 0 });
    saved.stageEntities[0].source.freePositionOrigin = { x: Infinity, y: 0 };
    const invalid = inspectStageStateForRestore(saved);
    expect(invalid.state.stageEntities).toHaveLength(0);
    expect(invalid.diagnostics.some((d) => d.code === 'STAGE_ENTITY_ROW_QUARANTINED')).toBe(true);
  });
  it.each([
    { x: 0, y: 0 },
    { x: -180, y: -100 },
    { x: 180, y: 100 },
  ])('authors native target $x,$y without moving the detach pose', (position) => {
    const { state, entity } = fixture();
    const plan = planEntityTransform(state, { target: 'rose', animationString: JSON.stringify({ position }) });
    expect(plan.terminal.position).toEqual({ x: 850 + position.x, y: 800 + position.y });
    expect(entity.visualState.position).toEqual({ x: 1000, y: 650 });
    expect(toEntityAuthorTransform(entity, plan.terminal).position).toEqual(position);
  });
  it.each([{ parallel: true }, { ignoreDefault: true }, {}])('keeps untouched y with sparse x %j', (options) => {
    const { state } = fixture();
    const plan = planEntityTransform(state, { target: 'rose', animationString: '{"position":{"x":-180}}', ...options });
    expect(plan.terminal.position).toEqual({ x: 670, y: 650 });
    if (options.parallel || options.ignoreDefault) expect(plan.endPatch.position).toEqual({ x: 670 });
  });
  it('writeDefault means author zero rather than world zero; internal return flights are already world', () => {
    const { state } = fixture();
    expect(
      planEntityTransform(state, { target: 'rose', animationString: '{}', writeDefault: true }).terminal.position,
    ).toEqual({ x: 850, y: 800 });
    expect(
      planEntityTransform(state, { target: 'rose', animationString: '{"position":{"x":50,"y":60}}', committed: true })
        .terminal.position,
    ).toEqual({ x: 50, y: 60 });
  });
  it('legacy saves keep absolute coordinates and finite origins are required', () => {
    const f = fixture();
    delete f.entity.source.freePositionOrigin;
    expect(toEntityWorldTransform(f.entity, { position: { x: -180, y: -100 } }).position).toEqual({ x: -180, y: -100 });
    f.entity.source.freePositionOrigin = { x: NaN, y: 1 };
    expect(validateStageEntityStateShape(f.state).length).toBeGreaterThan(0);
  });
  it('save/restore freezes origin independently of the parent and reattach/detach captures a new origin', () => {
    const f = fixture(),
      saved = JSON.parse(JSON.stringify(createCommittedStageSnapshot(f.state)));
    f.manager.resetAllStageState(saved);
    expect(f.manager.getViewStageState().stageEntities[0].source.freePositionOrigin).toEqual({ x: 850, y: 800 });
    expect(
      f.manager.applyStageEntityTransaction({ kind: 'reattach', entityId: 'rose', attachmentLink: f.link }).applied,
    ).toBe(true);
    expect(f.manager.getCalculationStageState().stageEntities[0].source.freePositionOrigin).toBeUndefined();
    expect(
      f.manager.applyStageEntityTransaction({
        kind: 'detach',
        entityId: 'rose',
        freePositionOrigin: { x: 1710, y: 720 },
        visualState: f.entity.visualState,
      }).applied,
    ).toBe(true);
    expect(f.manager.getCalculationStageState().stageEntities[0].source.freePositionOrigin).toEqual({
      x: 1710,
      y: 720,
    });
  });
  it('editor baseline and reference box compose to the same world position at every viewport scale', () => {
    const { state, entity } = fixture();
    const baselines = createTargetTransformBaselineManager();
    baselines.acceptRevision('r');
    baselines.captureSnapshot('r', state);
    baselines.publishCapturedSnapshot('r');
    const transform = baselines.getReadyTransformBaselineOverride('rose')!;
    expect(transform.position).toEqual({ x: 150, y: -150 });
    const result = queryStageObjectReferenceBox(
      'rose',
      {
        sourceType: 'img',
        pixiContainer: {
          getBasePosition: () => ({ x: 0, y: 0 }),
          getReferenceLocalBounds: () => ({ x: -20, y: -10, width: 40, height: 20 }),
        },
      },
      { width: 2560, height: 1440 },
      entity.source.freePositionOrigin,
    );
    if (result.status !== 'ready') throw Error('Expected ready reference box');
    for (const zoom of [0.25, 0.5, 1]) {
      const size = { width: 2560 * zoom, height: 1440 * zoom };
      const frame = createFrameFromReferenceBox(result.box, transform, size);
      frame.translate[0] += 50 * zoom;
      const dragged = createTransformFromReferenceFrame(result.box, frame, size);
      expect(dragged.position).toEqual({ x: 200, y: -150 });
      expect(toEntityWorldTransform(entity, dragged).position).toEqual({ x: 1050, y: 650 });
    }
    expect(toEntityWorldTransform(entity, { position: { x: 200 } })).toEqual({ position: { x: 1050 } });
  });
});
