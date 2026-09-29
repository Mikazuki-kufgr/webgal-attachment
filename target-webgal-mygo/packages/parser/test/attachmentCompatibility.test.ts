import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import SceneParser, {
  ADD_NEXT_ARG_LIST,
  SCRIPT_CONFIG,
  sceneTextPreProcess,
  ATTACHMENT_COMMAND_ABI,
  MYGO320_ATTACHMENT_COMMAND_ABI,
  UPSTREAM_MYGO321_COMMAND_ABI,
  LEGACY_HOTFIX37_COMMAND_ABI,
  UPSTREAM_MYGO320_COMMAND_ABI,
  resolveSerializedCommandType,
} from '../src/index';
import { commandType } from '../src/interface/sceneInterface';

const parser = new SceneParser(
  () => {},
  (file) => file,
  ADD_NEXT_ARG_LIST,
  SCRIPT_CONFIG,
);
const parse = (text: string) =>
  parser.parse(text, 'migration-test', '/migration-test.txt');
const sentence = (text: string) => parse(text).sentenceList[0];
// Locked upstream f6a3976 enum order, deliberately independent of our config.
const upstreamNames = [
  'say',
  'changeBg',
  'changeFigure',
  'bgm',
  'video',
  'pixi',
  'pixiInit',
  'intro',
  'miniAvatar',
  'changeScene',
  'choose',
  'end',
  'setComplexAnimation',
  'setFilter',
  'label',
  'jumpLabel',
  'chooseLabel',
  'setVar',
  'if',
  'callScene',
  'showVars',
  'unlockCg',
  'unlockBgm',
  'filmMode',
  'setTextbox',
  'setAnimation',
  'playEffect',
  'setTempAnimation',
  'comment',
  'setTransform',
  'setTransition',
  'getUserInput',
  'applyStyle',
  'wait',
  'callSteam',
  'return',
] as const;

describe('locked command ABI', () => {
  test.each(upstreamNames.map((name, value) => [name, value] as const))(
    '%s retains upstream %i',
    (name, value) => {
      expect(commandType[name]).toBe(value);
    },
  );
  test('extension IDs are appended and unique', () => {
    expect(commandType.attachment).toBe(36);
    expect(commandType.stageEntity).toBe(37);
    const numeric = Object.values(commandType).filter(
      (value) => typeof value === 'number',
    );
    expect(numeric).toHaveLength(38);
    expect(new Set(numeric).size).toBe(numeric.length);
    expect(new Set(SCRIPT_CONFIG.map((item) => item.scriptString)).size).toBe(
      SCRIPT_CONFIG.length,
    );
    expect(new Set(SCRIPT_CONFIG.map((item) => item.scriptType)).size).toBe(
      SCRIPT_CONFIG.length,
    );
  });
  test('host enum is identical without importing or executing the runtime', () => {
    const source = readFileSync(
      new URL(
        '../../webgal/src/Core/controller/scene/sceneInterface.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const body = source.match(/export enum commandType\s*\{([^}]+)\}/)?.[1];
    expect(body).toBeDefined();
    let value = -1;
    const entries = body!
      .replace(/\/\/[^\r\n]*/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const host = Object.fromEntries(
      entries.map((entry) => {
        const [name, explicit] = entry.split('=').map((item) => item.trim());
        value = explicit === undefined ? value + 1 : Number(explicit);
        return [name, value];
      }),
    );
    expect(host).toEqual(
      Object.fromEntries(
        Object.entries(commandType).filter(([, v]) => typeof v === 'number'),
      ),
    );
  });
  test('callSteam retains native command and automatic next', () => {
    const row = sentence('callSteam:achievement -id=test; // native');
    expect(row.command).toBe(34);
    expect(row.args).toEqual([
      { key: 'next', value: true },
      { key: 'id', value: 'test' },
    ]);
    expect(row.inlineComment).toBe('// native');
  });
});

describe('attachment script syntax only (not performer timing)', () => {
  test.each(['add', 'show', 'hide', 'remove'])(
    'attachment:%s retains its legacy default next',
    (action) => {
      const row = sentence(`attachment:${action} -id=flower -target=fig-left;`);
      expect(row.command).toBe(commandType.attachment);
      expect(row.commandRaw).toBe('attachment');
      expect(row.content).toBe(action);
      expect(row.args[0]).toEqual({ key: 'next', value: true });
    },
  );
  test.each(['show', 'hide', 'detach', 'reattach', 'transform', 'remove'])(
    'stageEntity:%s does not gain default next',
    (action) => {
      const row = sentence(`stageEntity:${action} -id=flower;`);
      expect(row.command).toBe(commandType.stageEntity);
      expect(row.args.some((arg) => arg.key === 'next')).toBe(false);
    },
  );
  test.each(['attachment', 'stageEntity'])(
    '%s preserves duration and configuration arguments',
    (command) => {
      const row = sentence(
        `${command}:add -config=attachments-v2/portable/flower/preset.json -duration=0 -anchor=ear-left -slot=earpiece -entity=flower-1; 中文说明;第二段`,
      );
      expect(row.args).toEqual(
        expect.arrayContaining([
          {
            key: 'config',
            value: 'attachments-v2/portable/flower/preset.json',
          },
          { key: 'duration', value: 0 },
          { key: 'anchor', value: 'ear-left' },
          { key: 'slot', value: 'earpiece' },
          { key: 'entity', value: 'flower-1' },
        ]),
      );
      expect(row.inlineComment).toBe('中文说明;第二段');
      expect(row.sentenceAssets).toEqual([]);
      expect(row.subScene).toEqual([]);
      expect(
        sentence(`${command}:show -id=flower;`).args.some(
          (arg) => arg.key === 'duration',
        ),
      ).toBe(false);
    },
  );
  test.each(['-next', '-next=true', '-next=false'])(
    'explicit %s remains typed',
    (flag) => {
      const row = sentence(`stageEntity:show -id=flower ${flag};`);
      expect(row.args.find((arg) => arg.key === 'next')?.value).toBe(
        flag !== '-next=false',
      );
    },
  );
  test('attachment explicit false preserves upstream/legacy argument ordering, without redefining effective next', () => {
    expect(sentence('attachment:show -next=false;').args).toEqual([
      { key: 'next', value: true },
      { key: 'next', value: false },
    ]);
  });
  test('escaped semicolon and inline comments round-trip as upstream text', () => {
    const row = sentence(
      String.raw`stageEntity:show -id=flower\;a; // keep;rest`,
    );
    expect(row.args).toContainEqual({ key: 'id', value: 'flower;a' });
    expect(row.inlineComment).toBe('// keep;rest');
    expect(sentence('; comment only').command).toBe(commandType.comment);
  });
  test('multiline preprocessor and original resource line numbers survive extension commands', () => {
    const input =
      'attachment:add -id=flower\n  -duration=0\n\nchangeFigure:model.json -id=actor; // actor\nchangeBg:bg.png;';
    const parsed = parse(sceneTextPreProcess(input));
    expect(parsed.sentenceList[0].args).toContainEqual({
      key: 'duration',
      value: 0,
    });
    expect(parsed.sentenceList[3].sentenceAssets[0].lineNumber).toBe(3);
    expect(parsed.sentenceList[4].sentenceAssets[0].lineNumber).toBe(4);
    expect(parsed.sentenceList[3].inlineComment).toBe('// actor');
  });
  test('ordinary dialogue, unknown speaker, and explicit duration values stay untouched', () => {
    expect(sentence('爱音:你好; // 对话').args).toContainEqual({
      key: 'speaker',
      value: '爱音',
    });
    expect(sentence('someUnknownName:hello;').command).toBe(commandType.say);
    expect(
      sentence('stageEntity:show -duration=450 -ease=easeInOut;').args,
    ).toContainEqual({ key: 'duration', value: 450 });
  });
});

describe('serialized ABI boundary, deliberately not wired into save/load', () => {
  test.each([
    [LEGACY_HOTFIX37_COMMAND_ABI, 34, 36],
    [LEGACY_HOTFIX37_COMMAND_ABI, 35, 37],
    [MYGO320_ATTACHMENT_COMMAND_ABI, 35, 36],
    [MYGO320_ATTACHMENT_COMMAND_ABI, 36, 37],
    [UPSTREAM_MYGO321_COMMAND_ABI, 35, 35],
    [ATTACHMENT_COMMAND_ABI, 34, 34],
    [ATTACHMENT_COMMAND_ABI, 35, 35],
    [ATTACHMENT_COMMAND_ABI, 36, 36],
    [ATTACHMENT_COMMAND_ABI, 37, 37],
    [UPSTREAM_MYGO320_COMMAND_ABI, 34, 34],
  ])(
    'identified %s command %i resolves to %i',
    (sourceAbi, command, expected) => {
      expect(resolveSerializedCommandType({ sourceAbi, command })).toEqual({
        ok: true,
        command: expected,
        migrated: command !== expected,
      });
    },
  );
  test.each([
    [34, 'attachment', 36],
    [35, 'attachment', 36],
    [36, 'attachment', 36],
    [35, 'stageEntity', 37],
    [36, 'stageEntity', 37],
    [37, 'stageEntity', 37],
    [35, 'return', 35],
    [34, 'callSteam', 34],
  ])('unversioned %i/%s has a witness', (command, commandRaw, expected) => {
    expect(resolveSerializedCommandType({ command, commandRaw })).toEqual({
      ok: true,
      command: expected,
      migrated: command !== expected,
    });
  });
  test.each([34, 35, 36])(
    'unversioned numeric %i alone is rejected',
    (command) => {
      expect(resolveSerializedCommandType({ command })).toEqual({
        ok: false,
        code: 'COMMAND_ABI_AMBIGUOUS',
      });
    },
  );
  test.each([
    {
      sourceAbi: LEGACY_HOTFIX37_COMMAND_ABI,
      command: 34,
      commandRaw: 'callSteam',
    },
    {
      sourceAbi: ATTACHMENT_COMMAND_ABI,
      command: 35,
      commandRaw: 'stageEntity',
    },
    { command: 37, commandRaw: 'attachment' },
    { command: 35, commandRaw: 'callSteam' },
  ])('contradictory row fails closed: %j', (row) => {
    expect(resolveSerializedCommandType(row)).toEqual({
      ok: false,
      code: 'COMMAND_ABI_RAW_MISMATCH',
    });
  });
  test.each([NaN, Infinity, -1, 1.5, 38, '34', true, null])(
    'invalid numeric command %s is not coerced',
    (command) => {
      expect(resolveSerializedCommandType({ command })).toEqual({
        ok: false,
        code: 'COMMAND_ABI_INVALID_COMMAND',
      });
    },
  );
  test.each([0, 33])(
    'stable command %i is preserved even with a speaker name',
    (command) => {
      expect(
        resolveSerializedCommandType({ command, commandRaw: '爱音' }),
      ).toEqual({ ok: true, command, migrated: false });
    },
  );
  test('unknown ABI is rejected even for a stable command', () => {
    expect(
      resolveSerializedCommandType({ sourceAbi: 'future-unknown', command: 0 }),
    ).toEqual({ ok: false, code: 'COMMAND_ABI_UNSUPPORTED' });
  });
  test('invalid raw field and out-of-range source ABI command are rejected', () => {
    expect(
      resolveSerializedCommandType({ command: 34, commandRaw: 34 }),
    ).toEqual({ ok: false, code: 'COMMAND_ABI_INVALID_RAW' });
    expect(
      resolveSerializedCommandType({
        sourceAbi: LEGACY_HOTFIX37_COMMAND_ABI,
        command: 36,
      }),
    ).toEqual({ ok: false, code: 'COMMAND_ABI_INVALID_COMMAND' });
    expect(
      resolveSerializedCommandType({
        sourceAbi: UPSTREAM_MYGO320_COMMAND_ABI,
        command: 35,
      }),
    ).toEqual({ ok: false, code: 'COMMAND_ABI_INVALID_COMMAND' });
  });
  test('does not mutate input; migration is idempotent with the destination ABI/witness', () => {
    const original = Object.freeze({
      command: 34,
      commandRaw: 'attachment',
      sourceAbi: LEGACY_HOTFIX37_COMMAND_ABI,
    });
    const result = resolveSerializedCommandType(original);
    expect(result).toEqual({ ok: true, command: 36, migrated: true });
    expect(original.command).toBe(34);
    expect(
      resolveSerializedCommandType({
        command: 36,
        commandRaw: 'attachment',
        sourceAbi: ATTACHMENT_COMMAND_ABI,
      }),
    ).toEqual({ ok: true, command: 36, migrated: false });
  });
});
