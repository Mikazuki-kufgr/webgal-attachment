import cloneDeep from 'lodash/cloneDeep';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENT_COMMAND_ABI,
  LEGACY_HOTFIX37_COMMAND_ABI,
  UPSTREAM_MYGO320_COMMAND_ABI,
  resolveSerializedCommandType,
} from 'webgal-parser';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import { deriveLegacyAttachmentEntityId } from '@/Core/controller/stage/pixi/attachments/stageEntityIdentity';
import {
  baseTransform,
  type IStageState,
  type StageEntityStateV0,
  type VisualStateV0,
  type IRunPerform,
} from './stageInterface';
import { initState } from './stageStateManager';
import { validateStageEntityStateInvariants } from './stageEntityStateTransaction';
import {
  clearPendingCommittedStageEntities,
  createCommittedStageSnapshot,
  getPendingCommittedStageEntityCount,
  inspectStageStateForRestore,
  releasePendingCommittedStageEntity,
  retainPendingCommittedStageEntity,
  sanitizeStageStateForRestore,
  StagePersistenceError,
} from './stageEntityPersistence';
import { sanitizeSerializedPerforms } from './stagePersistenceBoundary';

const id = 'entity-hat';
function visual(space: 'local' | 'world' = 'local'): VisualStateV0 {
  return {
    space,
    position: { x: 123, y: -45 },
    scale: { x: -2, y: 0.75 },
    rotation: 0.7,
    skew: { x: 0.1, y: -0.2 },
    opacity: 0.23,
    visible: false,
    appearance: {
      blur: 2,
      brightness: 1.2,
      contrast: 0.6,
      saturation: 0.8,
      gamma: 1.3,
      color: { red: 201, green: 152, blue: 103 },
      bevel: { strength: 0.4, thickness: 2, rotation: -0.5, softness: 0.7, color: { red: 51, green: 101, blue: 151 } },
      bloom: { strength: 0.8, brightness: 0.9, blur: 3, threshold: 0.2 },
      shockwave: 0.1,
      radiusAlpha: 0.2,
    },
  };
}
function entity(free = false): StageEntityStateV0 {
  const local = { ...visual(), space: 'local' as const };
  return {
    schemaVersion: 0,
    entityId: id,
    renderableKind: 'attachment-sprite-group',
    source: {
      configId: 'preset-hat',
      slot: 'ear',
      legacyAlias: { originFigureKey: 'fig-center', attachmentId: 'hat' },
      lastAttachedLocalVisualState: cloneDeep(local),
    },
    visualState: free ? visual('world') : cloneDeep(local),
    attachmentLink: free
      ? null
      : {
          schemaVersion: 0,
          parentKind: 'figure',
          parentFigureKey: 'fig-left',
          semanticAnchor: 'ear-left',
          placementPresetId: 'preset-hat',
          inheritancePolicy: { transform: true, opacity: true, visibility: true },
          attachedLocalVisualState: cloneDeep(local),
        },
  };
}
function stage(free = false): IStageState {
  return { ...cloneDeep(initState), stageEntities: [entity(free)] };
}
function sentence(
  command = commandType.say,
  commandRaw = commandType[command],
  args: ISentence['args'] = [],
  content = 'value',
): ISentence {
  return { command, commandRaw, args, content, sentenceAssets: [], subScene: [], inlineComment: '', isLineBreakHolder: false };
}
function perform(script = sentence(), performId = 'native'): IRunPerform {
  return { id: performId, isHoldOn: true, script };
}
function addPerform(
  row = { figure: 'fig-left', id: 'hat', config: 'preset-hat', slot: 'ear', anchor: 'ear-left', entity: id },
) {
  return perform(
    sentence(
      commandType.attachment,
      'attachment',
      Object.entries(row).map(([key, value]) => ({ key, value })),
      'add',
    ),
    'attachment:add',
  );
}

beforeEach(() => {
  clearPendingCommittedStageEntities();
});
afterEach(() => {
  clearPendingCommittedStageEntities();
});

describe('durable entity schema and canonical projections', () => {
  it('repairs attached projection/effect from canonical schema 0, preserving full appearance, skew and aliases', () => {
    const input = stage();
    input.attachments = [
      { figureKey: 'fig-right', attachmentId: 'wrong', entityId: id, configId: 'wrong', visible: true },
    ];
    input.effects.push({ target: id, transform: { alpha: 1, rotation: 9 } }, { target: id, transform: { alpha: 0 } });
    const sourceBefore = cloneDeep(input);
    const result = sanitizeStageStateForRestore(input, ATTACHMENT_COMMAND_ABI);
    expect(input).toEqual(sourceBefore);
    expect(result.stageEntities).toEqual(input.stageEntities);
    expect(result.attachments).toEqual([
      {
        figureKey: 'fig-left',
        attachmentId: 'hat',
        entityId: id,
        configId: 'preset-hat',
        slot: 'ear',
        semanticAnchor: 'ear-left',
        visible: false,
      },
    ]);
    expect(result.effects.filter((row) => row.target === id)).toHaveLength(1);
    expect(result.effects.find((row) => row.target === id)?.transform).toMatchObject({
      position: visual().position,
      scale: visual().scale,
      skew: visual().skew,
      alpha: 0.23,
      rotation: 0.7,
      blur: 2,
      brightness: 1.2,
      gamma: 1.3,
      bevelRotation: -0.5,
      bloom: 0.8,
      radiusAlphaFilter: 0.2,
    });
    expect(validateStageEntityStateInvariants(result)).toEqual([]);
  });

  it('preserves detached effective world opacity, visibility, signed scale and last attached local pose', () => {
    const input = stage(true);
    input.stageEntities[0].visualState.position = { x: 901, y: -802 };
    input.attachments = [
      { figureKey: 'fig-left', attachmentId: 'hat', entityId: id, configId: 'preset-hat', visible: true },
    ];
    const result = sanitizeStageStateForRestore(input);
    expect(result.stageEntities).toEqual(input.stageEntities);
    expect(result.attachments).toEqual([]);
    expect(result.stageEntities[0].visualState).toMatchObject({
      space: 'world',
      position: { x: 901, y: -802 },
      opacity: 0.23,
      visible: false,
      scale: { x: -2, y: 0.75 },
    });
    expect(validateStageEntityStateInvariants(result)).toEqual([]);
  });

  it('strips runtime-only functions, foreign stage fields and transient entity/link/source handles', () => {
    const input = stage();
    const raw = {
      ...input,
      timer: () => {},
      runtime: { pixi: true },
      stageEntities: [
        {
          ...input.stageEntities[0],
          pendingOperation: Symbol('runtime'),
          source: { ...input.stageEntities[0].source, texture: { alive: true } },
          attachmentLink: { ...input.stageEntities[0].attachmentLink!, generation: 42 },
        },
      ],
    };
    const result = sanitizeStageStateForRestore(raw);
    expect(result).not.toHaveProperty('timer');
    expect(result).not.toHaveProperty('runtime');
    expect(result.stageEntities[0]).toEqual(input.stageEntities[0]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('quarantines malformed/duplicate rows with diagnostics and removes only their effects', () => {
    const input = stage();
    const invalid = { ...entity(true), entityId: 'invalid', visualState: { ...visual('world'), opacity: NaN } };
    const duplicate = { ...entity(), source: { ...entity().source, configId: 'do-not-win' } };
    const result = inspectStageStateForRestore({
      ...input,
      stageEntities: [input.stageEntities[0], invalid, duplicate],
      effects: [
        ...input.effects,
        { target: 'invalid', transform: { alpha: 0.2 } },
        { target: 'native', transform: { alpha: 0.7 } },
      ],
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((item) => item.code === 'STAGE_ENTITY_ROW_QUARANTINED')).toBe(true);
    expect(result.state.stageEntities).toEqual(input.stageEntities);
    expect(result.state.effects.some((row) => row.target === 'invalid')).toBe(false);
    expect(result.state.effects).toContainEqual({ target: 'native', transform: { alpha: 0.7 } });
  });

  it('never lets malformed entity claims delete native reserved/free figure effects or performers', () => {
    const input = {
      ...cloneDeep(initState),
      freeFigure: [{ basePosition: 'left' as const, name: 'model.json', key: 'custom-figure' }],
      stageEntities: [
        { ...entity(), entityId: 'fig-center' },
        { ...entity(), entityId: 'custom-figure' },
      ],
      effects: [
        { target: 'fig-center', transform: { alpha: 0.6 } },
        { target: 'custom-figure', transform: { rotation: 2 } },
      ],
      PerformList: [
        perform(sentence(commandType.setTransform, 'setTransform', [{ key: 'target', value: 'custom-figure' }])),
      ],
    };
    const result = inspectStageStateForRestore(input);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.state.stageEntities).toEqual([]);
    expect(result.state.effects).toEqual(input.effects);
    expect(result.state.PerformList).toEqual(input.PerformList);
  });

  it('retains a valid lazy legacy derived-target effect while stripping its active transform replay', () => {
    const lazyId = deriveLegacyAttachmentEntityId('fig-center', 'old-hat');
    const legacy = {
      figureKey: 'fig-center',
      attachmentId: 'old-hat',
      configId: 'old-preset',
      semanticAnchor: 'left-ear',
      visible: true,
    };
    const input = {
      attachments: [legacy],
      effects: [{ target: lazyId, transform: { position: { x: 8 }, alpha: 0.3 } }],
      PerformList: [perform(sentence(commandType.setTransform, 'setTransform', [{ key: 'target', value: lazyId }]))],
    };
    const result = sanitizeStageStateForRestore(input);
    expect(result.attachments).toEqual([legacy]);
    expect(result.effects).toEqual(input.effects);
    expect(result.PerformList).toEqual([]);
    expect(result.stageEntities).toEqual([]);
  });
});

describe('native schema compatibility and corrupted storage rejection', () => {
  it('round-trips every populated upstream field, including all native collection schemas', () => {
    const native: IStageState = {
      ...cloneDeep(initState),
      oldBgName: 'old.webp',
      bgName: 'bg.webp',
      figName: 'center.json',
      figNameLeft: 'left.json',
      figNameRight: 'right.json',
      freeFigure: [{ basePosition: 'right', name: 'free.png', key: 'free-id' }],
      figureAssociatedAnimation: [
        {
          targetId: 'free-id',
          animationFlag: 'talking',
          mouthAnimation: { open: 'a', close: 'b', halfOpen: 'c' },
          blinkAnimation: { open: 'd', close: 'e' },
        },
      ],
      isRead: true,
      showText: '中文',
      showTextSize: 42,
      showName: '角色',
      command: 'say',
      choose: [{ key: '选项', targetScene: 'branch.txt', isSubScene: true }],
      vocal: 'voice.ogg',
      playVocal: 'playing.ogg',
      vocalVolume: 63,
      bgm: { src: 'song.ogg', enter: 321, volume: 45 },
      uiSe: 'tap.wav',
      miniAvatar: 'avatar.png',
      GameVar: { count: 4, flag: true, text: 'value', mixed: [0, false, 'text'] },
      effects: [
        {
          target: 'free-id',
          transform: {
            ...cloneDeep(baseTransform),
            alpha: 0.6,
            oldFilm: 0.4,
            position: { x: 2 },
            skew: { x: 0.1, y: -0.2 },
          },
        },
        { target: 'bg-main' },
      ],
      animationSettings: [
        {
          target: 'free-id',
          enterAnimationName: 'enter.json',
          exitAnimationName: 'exit.json',
          enterDuration: 12,
          exitDuration: 34,
          enterAnimationIgnoreDefault: true,
          exitAnimationIgnoreDefault: false,
        },
      ],
      bgTransform: '{"x":12}',
      bgFilter: 'filter',
      PerformList: [
        perform({
          ...sentence(commandType.say, '任意角色', [{ key: 'continue', value: true }]),
          sentenceAssets: [{ name: 'photo', type: 0, url: 'bg.webp', lineNumber: 4 }],
          subScene: ['sub.txt'],
          inlineComment: 'inline',
        }),
      ],
      currentDialogKey: 'dialogue',
      live2dMotion: [{ target: 'fig-center', motion: 'talk', skin: 'costume', overrideBounds: [-1, 2, 3, 4] }],
      live2dExpression: [{ target: 'fig-center', expression: 'smile' }],
      live2dBlink: [
        {
          target: 'fig-center',
          blink: {
            blinkInterval: 100,
            blinkIntervalRandom: 5,
            closingDuration: 10,
            closedDuration: 20,
            openingDuration: 30,
          },
        },
      ],
      live2dFocus: [{ target: 'fig-center', focus: { x: -0.5, y: 0.4, instant: true } }],
      currentConcatDialogPrev: 'previous',
      enableFilm: 'enabled',
      isDisableTextbox: true,
      replacedUIlable: { save: '保存' },
      figureMetaData: { 'free-id': { zIndex: -7, blendMode: 'multiply' }, 'fig-center': {} },
    };
    expect(sanitizeStageStateForRestore(native, ATTACHMENT_COMMAND_ABI)).toEqual(native);
    expect(native).not.toBe(initState);
  });

  it('adds actual host defaults for missing legacy arrays, metadata and inline comments without changing old values', () => {
    const oldPerform = {
      ...perform(),
      script: { command: commandType.say, commandRaw: '旧角色', content: '旧文本', args: [] },
    };
    const result = sanitizeStageStateForRestore(
      { bgName: 'old.png', showText: '旧文本', PerformList: [oldPerform] },
      LEGACY_HOTFIX37_COMMAND_ABI,
    );
    expect(result).toEqual({
      ...cloneDeep(initState),
      bgName: 'old.png',
      showText: '旧文本',
      PerformList: [
        { ...oldPerform, script: { ...oldPerform.script, sentenceAssets: [], subScene: [], inlineComment: '', isLineBreakHolder: false } },
      ],
    });
  });

  it.each([
    null,
    [],
    { effects: null },
    { attachments: {} },
    { stageEntities: null },
    { freeFigure: [{}] },
    { bgm: { src: 'x' } },
    { GameVar: { invalid: {} } },
    { effects: [{ target: 'x', transform: { constructor: 1 } }] },
    { showText: 42 },
    { PerformList: [null] },
    { PerformList: [{ ...perform(), script: { ...sentence(), args: null } }] },
    { PerformList: [{ ...perform(), script: { ...sentence(), args: [{ key: 'duration', value: Infinity }] } }] },
  ])('rejects malformed native/envelope input before exposing a state (%j)', (input) => {
    const before = cloneDeep(input);
    expect(() => sanitizeStageStateForRestore(input)).toThrow(StagePersistenceError);
    expect(input).toEqual(before);
  });

  it('rejects malformed args even for entity performers that would later be removed', () => {
    const input = {
      PerformList: [
        {
          ...perform(sentence(commandType.attachment, 'attachment')),
          script: { ...sentence(commandType.attachment, 'attachment'), args: [null] },
        },
      ],
    };
    expect(() => sanitizeStageStateForRestore(input, ATTACHMENT_COMMAND_ABI)).toThrow('PerformList[0].script.args[0]');
  });
});

describe('persisted command ABI, not numeric attachment guesses', () => {
  it('decodes legacy 34/35 with explicit metadata then strips entity operations', () => {
    const list = [perform(sentence(34, 'attachment')), perform(sentence(35, 'stageEntity'))];
    expect(sanitizeSerializedPerforms(list, LEGACY_HOTFIX37_COMMAND_ABI).map((row) => row.script.command)).toEqual([
      36, 37,
    ]);
    expect(sanitizeStageStateForRestore({ PerformList: list }, LEGACY_HOTFIX37_COMMAND_ABI).PerformList).toEqual([]);
  });

  it.each([undefined, ATTACHMENT_COMMAND_ABI, UPSTREAM_MYGO320_COMMAND_ABI])(
    'resolves native 34 as Steam but rejects its impossible durable replay row under %s',
    (abi) => {
      const input = {
        PerformList: [perform(sentence(34, 'callSteam', [{ key: 'target', value: id }], 'achievement'))],
      };
      expect(resolveSerializedCommandType({ command: 34, commandRaw: 'callSteam', sourceAbi: abi })).toMatchObject({
        ok: true,
        command: 34,
      });
      expect(() => sanitizeStageStateForRestore(input, abi)).toThrow('STAGE_PERFORM_NOT_REPLAYABLE');
    },
  );

  it.each([0, 1, 2, 4, 5, 7, 10, 12, 20, 25, 26, 27, 29, 31, 33])(
    'preserves actual named native durable command %i',
    (command) => {
      const list = [perform(sentence(command, commandType[command]))];
      expect(sanitizeSerializedPerforms(list, ATTACHMENT_COMMAND_ABI)).toEqual(list);
    },
  );

  it.each([3, 6, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 28, 30, 32, 34])(
    'rejects native None-only or unregistered command %i before replay',
    (command) => {
      const list = [perform(sentence(command, commandType[command]))];
      expect(() => sanitizeSerializedPerforms(list, ATTACHMENT_COMMAND_ABI)).toThrow('STAGE_PERFORM_NOT_REPLAYABLE');
    },
  );

  it('does not confuse native audio/video/dialogue performers with entity transforms by id or target', () => {
    const input = stage();
    input.PerformList = [commandType.say, commandType.video, commandType.playEffect].map((command) =>
      perform(sentence(command, commandType[command], [{ key: 'target', value: id }]), id),
    );
    input.PerformList.push(
      perform(sentence(commandType.setTransform, 'setTransform', [{ key: 'target', value: id }]), 'entity-tween'),
    );
    input.PerformList.push(
      perform(
        sentence(commandType.setTransform, 'setTransform', [{ key: 'target', value: 'fig-center' }]),
        'native-tween',
      ),
    );
    expect(sanitizeStageStateForRestore(input).PerformList.map((row) => row.id)).toEqual([id, id, id, 'native-tween']);
  });

  it.each([34, 35, 36])(
    'fails closed for unversioned ambiguous extension %i even if it would be stripped',
    (command) => {
      const script = { command, content: 'add', args: [{ key: 'entity', value: id }] };
      expect(() => sanitizeStageStateForRestore({ PerformList: [{ id: 'entity', isHoldOn: true, script }] })).toThrow(
        'COMMAND_ABI_AMBIGUOUS',
      );
    },
  );

  it('rejects unknown ABI on empty stage, contradictions and unsupported numeric commands', () => {
    expect(() => sanitizeStageStateForRestore({}, 'future-v99')).toThrow('COMMAND_ABI_UNSUPPORTED');
    expect(() =>
      sanitizeStageStateForRestore(
        { PerformList: [perform(sentence(34, 'attachment'))] },
        UPSTREAM_MYGO320_COMMAND_ABI,
      ),
    ).toThrow('COMMAND_ABI_RAW_MISMATCH');
    expect(() =>
      sanitizeStageStateForRestore({ PerformList: [perform(sentence(99, 'future'))] }, ATTACHMENT_COMMAND_ABI),
    ).toThrow('COMMAND_ABI_INVALID_COMMAND');
  });

  it('whitelists serialized performer fields and rejects invalid assets before replay', () => {
    const raw = { ...perform(), stopFunction: () => {}, script: { ...sentence(), sourceAbi: 'fake', nextTimer: 5 } };
    expect(sanitizeSerializedPerforms([raw])).toEqual([perform()]);
    expect(() =>
      sanitizeSerializedPerforms([
        { ...perform(), script: { ...sentence(), sentenceAssets: [{ name: 'x', type: 7, url: 'x', lineNumber: 0 }] } },
      ]),
    ).toThrow(StagePersistenceError);
  });
});

describe('pending operation durable capture', () => {
  it('turns the exact pending add hidden gate into declared visible without replaying the operation', () => {
    const input = stage();
    input.PerformList = [addPerform()];
    const result = sanitizeStageStateForRestore(input, ATTACHMENT_COMMAND_ABI);
    expect(result.PerformList).toEqual([]);
    expect(result.attachments[0].visible).toBe(true);
    expect(result.stageEntities[0].visualState.visible).toBe(true);
    expect(result.stageEntities[0].attachmentLink?.attachedLocalVisualState.visible).toBe(true);
    expect(result.stageEntities[0].source.lastAttachedLocalVisualState?.visible).toBe(true);
    expect(input.stageEntities[0].visualState.visible).toBe(false);
  });

  it('preserves user hidden state without the exact add identity and rejects duplicated witness arguments', () => {
    const input = stage();
    expect(sanitizeStageStateForRestore(input).stageEntities[0].visualState.visible).toBe(false);
    input.PerformList = [
      addPerform({
        figure: 'fig-left',
        id: 'hat',
        config: 'other-preset',
        slot: 'ear',
        anchor: 'ear-left',
        entity: id,
      }),
    ];
    expect(sanitizeStageStateForRestore(input, ATTACHMENT_COMMAND_ABI).stageEntities[0].visualState.visible).toBe(
      false,
    );
    input.PerformList = [addPerform()];
    input.PerformList[0].script.args.push({ key: 'anchor', value: 'ear-left' });
    expect(sanitizeStageStateForRestore(input, ATTACHMENT_COMMAND_ABI).stageEntities[0].visualState.visible).toBe(
      false,
    );
  });

  it('captures last actual free world state during reattach but never overlays an old backlog restore', () => {
    const input = stage(true),
      original = cloneDeep(input.stageEntities[0]);
    const token = retainPendingCommittedStageEntity(original);
    input.stageEntities[0].visualState.position = { x: 800, y: 900 };
    input.showText = 'native calculation preserved';
    expect(createCommittedStageSnapshot(input).stageEntities[0]).toEqual(original);
    expect(createCommittedStageSnapshot(input).showText).toBe(input.showText);
    expect(sanitizeStageStateForRestore(input).stageEntities[0].visualState.position).toEqual({ x: 800, y: 900 });
    expect(releasePendingCommittedStageEntity(token)).toBe(true);
    expect(createCommittedStageSnapshot(input).stageEntities[0].visualState.position).toEqual({ x: 800, y: 900 });
  });

  it('does not overwrite completed reattach or a replacement binding with an old pending pose', () => {
    retainPendingCommittedStageEntity(entity(true));
    const attached = stage();
    expect(createCommittedStageSnapshot(attached).stageEntities[0]).toEqual(attached.stageEntities[0]);
    const replaced = stage(true);
    replaced.stageEntities[0].source.configId = 'replacement';
    replaced.stageEntities[0].visualState.position.x = 999;
    expect(createCommittedStageSnapshot(replaced).stageEntities[0]).toEqual(replaced.stageEntities[0]);
  });

  it('uses exact token ownership and clears pending data without touching durable stage objects', () => {
    const input = stage(true),
      before = cloneDeep(input);
    const old = retainPendingCommittedStageEntity(input.stageEntities[0]);
    const current = retainPendingCommittedStageEntity(input.stageEntities[0]);
    expect(releasePendingCommittedStageEntity(old)).toBe(false);
    expect(getPendingCommittedStageEntityCount()).toBe(1);
    expect(releasePendingCommittedStageEntity(current)).toBe(true);
    expect(releasePendingCommittedStageEntity(current)).toBe(false);
    retainPendingCommittedStageEntity(input.stageEntities[0]);
    clearPendingCommittedStageEntities();
    expect(getPendingCommittedStageEntityCount()).toBe(0);
    expect(input).toEqual(before);
  });
});
