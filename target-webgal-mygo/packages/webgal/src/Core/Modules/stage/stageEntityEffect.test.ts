import { describe, expect, it } from 'vitest';
import cloneDeep from 'lodash/cloneDeep';
import { applyStageEntityEffectTransaction } from './stageEntityEffect';
import { validateStageEntityStateInvariants } from './stageEntityStateTransaction';
import { validateStageEntityStateShape } from './stageEntityStateValidation';
import {
  baseTransform,
  type IEffect,
  type IStageState,
  type ITransform,
  type StageEntityStateV0,
} from './stageInterface';

function makeEntity(entityId: string, attached: boolean): StageEntityStateV0 {
  const local = {
    space: 'local' as const,
    position: { x: 12, y: -7 },
    scale: { x: -2, y: 3 },
    rotation: 0.4,
    skew: { x: 0.2, y: -0.3 },
    opacity: 0.7,
    visible: false,
  };
  return {
    schemaVersion: 0,
    entityId,
    renderableKind: 'attachment-sprite-group',
    source: { configId: `${entityId}-preset`, lastAttachedLocalVisualState: cloneDeep(local) },
    visualState: { ...cloneDeep(local), space: attached ? 'local' : 'world' },
    attachmentLink: attached
      ? {
          schemaVersion: 0,
          parentKind: 'figure',
          parentFigureKey: 'fig-center',
          semanticAnchor: 'ear-left',
          placementPresetId: `${entityId}-preset`,
          inheritancePolicy: { transform: true, opacity: true, visibility: true },
          attachedLocalVisualState: cloneDeep(local),
        }
      : null,
  };
}

function makeStage(attached = true): IStageState {
  const entities = [makeEntity('entity-a', attached), makeEntity('entity-b', false)];
  return {
    oldBgName: '',
    bgName: '',
    figName: 'test.model.json',
    figNameLeft: '',
    figNameRight: '',
    figNameLeft13: '',
    figNameRight13: '',
    figNameLeft14: '',
    figNameRight14: '',
    freeFigure: [],
    attachments: [],
    stageEntities: entities,
    figureAssociatedAnimation: [],
    isRead: false,
    showText: 'Untouched dialogue',
    showTextSize: -1,
    showName: '',
    command: '',
    choose: [],
    vocal: '',
    playVocal: '',
    vocalVolume: 100,
    bgm: { src: '', enter: 0, volume: 100 },
    uiSe: '',
    miniAvatar: '',
    GameVar: { counter: 42 },
    effects: [
      { target: 'stage-main', transform: cloneDeep(baseTransform) },
      ...entities.map((entity) => ({
        target: entity.entityId,
        transform: {
          ...cloneDeep(baseTransform),
          position: cloneDeep(entity.visualState.position),
          scale: cloneDeep(entity.visualState.scale),
          rotation: entity.visualState.rotation,
          skew: cloneDeep(entity.visualState.skew),
          alpha: entity.visualState.opacity,
        },
      })),
      { target: 'fig-right', transform: { alpha: 0.2 } },
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
}

function assertValid(stage: IStageState): void {
  expect(validateStageEntityStateShape(stage)).toEqual([]);
  expect(validateStageEntityStateInvariants(stage)).toEqual([]);
}

function apply(stage: IStageState, transform: ITransform) {
  return applyStageEntityEffectTransaction(stage, { target: 'entity-a', transform });
}

function freezeDeep(value: unknown): void {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
}

describe('atomic Stage Entity effect adaptation', () => {
  it('merges defined position/scale axes using the new upstream partial-transform rules', () => {
    const stage = makeStage();
    const payload: IEffect = {
      target: 'entity-a',
      transform: { position: { x: 0, y: undefined }, scale: { x: undefined, y: -4 }, rotation: undefined, alpha: 0 },
    };
    const before = cloneDeep(stage);
    const payloadBefore = cloneDeep(payload);
    freezeDeep(stage);
    freezeDeep(payload);
    const result = applyStageEntityEffectTransaction(stage, payload);
    expect(result.applied).toBe(true);
    expect(stage).toEqual(before);
    expect(payload).toEqual(payloadBefore);
    expect(result.state).not.toBe(stage);
    const entity = result.state.stageEntities[0];
    expect(entity.visualState.position).toEqual({ x: 0, y: -7 });
    expect(entity.visualState.scale).toEqual({ x: -2, y: -4 });
    expect(entity.visualState.rotation).toBe(0.4);
    expect(entity.visualState.opacity).toBe(0);
    expect(entity.visualState.visible).toBe(false);
    expect(entity.attachmentLink?.attachedLocalVisualState).toEqual(entity.visualState);
    expect(entity.attachmentLink?.attachedLocalVisualState).not.toBe(entity.visualState);
    expect(entity.source.lastAttachedLocalVisualState).toEqual(
      before.stageEntities[0].source.lastAttachedLocalVisualState,
    );
    assertValid(result.state);
  });

  it('does not mutate caller-owned patch objects after successful application', () => {
    const patch = { position: { x: 20 }, skew: { x: 0.5, y: 0.8 } };
    const result = apply(makeStage(), patch);
    expect(result.applied).toBe(true);
    patch.position.x = 999;
    patch.skew.y = 999;
    expect(result.state.stageEntities[0].visualState.position.x).toBe(20);
    expect(result.state.stageEntities[0].visualState.skew?.y).toBe(0.8);
  });

  it.each([{}, { skew: undefined }])('preserves omitted/undefined skew in a partial patch: %j', (patch) => {
    const result = apply(makeStage(), { ...patch, position: { x: 4 } });
    expect(result.applied).toBe(true);
    expect(result.state.stageEntities[0].visualState.skew).toEqual({ x: 0.2, y: -0.3 });
    assertValid(result.state);
  });

  it('replaces explicit complete skew, including an explicit zero reset', () => {
    const result = apply(makeStage(), { skew: { x: 0, y: 0 } });
    expect(result.applied).toBe(true);
    expect(result.state.stageEntities[0].visualState.skew).toEqual({ x: 0, y: 0 });
    expect(result.state.effects[1].transform?.skew).toEqual({ x: 0, y: 0 });
    assertValid(result.state);
  });

  it('keeps absent skew absent rather than adding an implicit transform', () => {
    const stage = makeStage(false);
    delete stage.stageEntities[0].visualState.skew;
    delete stage.effects[1].transform!.skew;
    assertValid(stage);
    const result = apply(stage, { rotation: 0 });
    expect(result.applied).toBe(true);
    expect(result.state.stageEntities[0].visualState).not.toHaveProperty('skew');
    expect(result.state.effects[1].transform).not.toHaveProperty('skew');
    assertValid(result.state);
  });

  it('retains native effects, other entities, order, and unrelated state without filtering', () => {
    const stage = makeStage();
    const before = cloneDeep(stage);
    const result = apply(stage, { scale: { x: 0 }, brightness: 2 });
    expect(result.applied).toBe(true);
    expect(result.state.effects.map((effect) => effect.target)).toEqual(before.effects.map((effect) => effect.target));
    for (const index of [0, 2, 3]) expect(result.state.effects[index]).toEqual(before.effects[index]);
    expect(result.state.stageEntities[1]).toEqual(before.stageEntities[1]);
    expect(result.state.attachments).toEqual(before.attachments);
    expect(result.state.GameVar).toEqual(before.GameVar);
    expect(result.state.showText).toBe(before.showText);
    assertValid(result.state);
  });

  it('updates free world visual state without changing the remembered attached-local pose', () => {
    const stage = makeStage(false);
    const result = apply(stage, { position: { y: 100 }, alpha: 1 });
    expect(result.applied).toBe(true);
    expect(result.state.stageEntities[0].visualState.space).toBe('world');
    expect(result.state.stageEntities[0].attachmentLink).toBeNull();
    expect(result.state.stageEntities[0].source).toEqual(stage.stageEntities[0].source);
    assertValid(result.state);
  });

  it('projects all supported appearance channels and removes optional neutral groups when explicitly reset', () => {
    const result = apply(makeStage(), {
      blur: 2,
      brightness: 0.5,
      contrast: 1.5,
      saturation: 0,
      gamma: 2,
      colorRed: 0,
      colorGreen: 120,
      colorBlue: 255,
      bevel: 1,
      bevelThickness: 3,
      bevelRotation: -0.4,
      bevelSoftness: 0.2,
      bevelRed: 100,
      bevelGreen: 101,
      bevelBlue: 102,
      bloom: 0.4,
      bloomBrightness: 1.2,
      bloomBlur: 4,
      bloomThreshold: 0.5,
      shockwaveFilter: -1,
      radiusAlphaFilter: 3,
    });
    expect(result.applied).toBe(true);
    expect(result.state.stageEntities[0].visualState.appearance).toEqual({
      blur: 2,
      brightness: 0.5,
      contrast: 1.5,
      saturation: 0,
      gamma: 2,
      color: { red: 0, green: 120, blue: 255 },
      bevel: { strength: 1, thickness: 3, rotation: -0.4, softness: 0.2, color: { red: 100, green: 101, blue: 102 } },
      bloom: { strength: 0.4, brightness: 1.2, blur: 4, threshold: 0.5 },
      shockwave: -1,
      radiusAlpha: 3,
    });
    assertValid(result.state);
    const reset = apply(result.state, cloneDeep(baseTransform));
    expect(reset.applied).toBe(true);
    expect(reset.state.stageEntities[0].visualState.appearance).toEqual({
      blur: 0,
      brightness: 1,
      color: { red: 255, green: 255, blue: 255 },
    });
    // The full neutral snapshot now explicitly supplies zero skew. Omitted
    // skew patches remain non-resetting, as checked separately above.
    expect(reset.state.stageEntities[0].visualState.skew).toEqual({ x: 0, y: 0 });
    assertValid(reset.state);
  });

  it.each([
    { alpha: Number.NaN },
    { alpha: Number.POSITIVE_INFINITY },
    { alpha: -0.1 },
    { alpha: 1.1 },
    { alpha: null },
    { alpha: '0.5' },
    { position: null },
    { position: { x: Number.NEGATIVE_INFINITY } },
    { position: { x: true } },
    { scale: { y: Number.NaN } },
    { skew: { x: 1 } },
    { skew: { x: 1, y: undefined } },
    { skew: null },
    { rotation: Number.NaN },
    { brightness: Number.POSITIVE_INFINITY },
    { colorRed: 256 },
    { blur: -1 },
    { gamma: 0 },
    { position: { z: 3 } },
    { unsupportedField: 1 },
    { mask: 'not-supported' },
  ])('rejects a malformed/unsupported patch atomically: %j', (patch) => {
    const stage = makeStage();
    const before = cloneDeep(stage);
    const result = apply(stage, patch as unknown as ITransform);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(stage);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(stage).toEqual(before);
  });

  it.each(['oldFilm', 'dotFilm', 'reflectionFilm', 'glitchFilm', 'rgbFilm', 'godrayFilm'] as const)(
    'fails closed instead of claiming an attachment mapping for %s',
    (key) => {
      const stage = makeStage();
      const result = apply(stage, { [key]: 1 });
      expect(result.applied).toBe(false);
      expect(result.state).toBe(stage);
      expect(result.violations[0].code).toBe('ENTITY_EFFECT_INCOMPATIBLE');
      const unchanged = apply(stage, { [key]: 0, rotation: 0.2 });
      expect(unchanged.applied).toBe(true);
      expect(unchanged.state.effects[1].transform?.[key]).toBe(0);
    },
  );

  it('preserves an existing native-only field without silently deleting or changing it', () => {
    const stage = makeStage();
    stage.effects[1].transform!.oldFilm = 0.4;
    assertValid(stage);
    const result = apply(stage, { oldFilm: 0.4, rotation: 2 });
    expect(result.applied).toBe(true);
    expect(result.state.effects[1].transform?.oldFilm).toBe(0.4);
    const rejectedReset = apply(stage, { oldFilm: 0 });
    expect(rejectedReset.applied).toBe(false);
    expect(rejectedReset.state).toBe(stage);
  });

  it.each([
    null,
    {},
    { target: 123, transform: {} },
    { target: 'stage-main', transform: { alpha: 0.3 } },
    { target: 'missing-entity', transform: {} },
    { target: 'entity-a' },
    { target: 'entity-a', transform: null },
    { target: 'entity-a', transform: [] },
  ])('does not route malformed/native/nonexistent targets into an entity update: %j', (payload) => {
    const stage = makeStage();
    const before = cloneDeep(stage);
    const result = applyStageEntityEffectTransaction(stage, payload as unknown as IEffect);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(stage);
    expect(stage).toEqual(before);
  });

  it('refuses a pre-existing cross-array conflict rather than repairing/deleting it incidentally', () => {
    const stage = makeStage();
    stage.effects.push(cloneDeep(stage.effects[2]));
    const before = cloneDeep(stage);
    const result = apply(stage, { alpha: 1 });
    expect(result.applied).toBe(false);
    expect(result.state).toBe(stage);
    expect(result.violations.some((violation) => violation.code === 'ENTITY_EFFECT_INCOMPATIBLE')).toBe(true);
    expect(stage).toEqual(before);
  });

  it('isolates a rejected nested vector before any earlier valid field can escape', () => {
    const stage = makeStage();
    const before = cloneDeep(stage);
    const result = apply(stage, { rotation: 1, scale: { x: 6 }, position: { y: Number.NaN } });
    expect(result.applied).toBe(false);
    expect(result.state).toBe(stage);
    expect(stage).toEqual(before);
  });

  it('blocks unknown prototype-bearing transform objects without running a partial write', () => {
    const stage = makeStage();
    const patch = Object.create({ alpha: 0.2 }) as ITransform;
    patch.rotation = 3;
    const result = apply(stage, patch);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(stage);
  });
});
