import cloneDeep from 'lodash/cloneDeep';
import { resolveSerializedCommandType } from 'webgal-parser';
import { commandType, type ISentence } from '@/Core/controller/scene/sceneInterface';
import { initState } from './stageStateManager';
import { baseTransform, type IRunPerform, type IStageState } from './stageInterface';

export interface StagePersistenceDiagnostic {
  code: string;
  path: string;
  message: string;
}
export class StagePersistenceError extends Error {
  constructor(public readonly code: string, public readonly diagnostics: StagePersistenceDiagnostic[]) {
    super(`${code}: ${diagnostics.map((item) => `${item.path}: ${item.message}`).join('; ')}`);
    this.name = 'StagePersistenceError';
  }
}
type Row = Record<string, unknown>;
export function persistenceRecord(value: unknown): value is Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function fail(path: string, message: string, code = 'STAGE_RESTORE_INVALID'): never {
  throw new StagePersistenceError(code, [{ code, path, message }]);
}
type ReadValue = (value: unknown, path: string) => unknown;
const text: ReadValue = (value, path) => (typeof value === 'string' ? value : fail(path, 'Expected string'));
const bool: ReadValue = (value, path) => (typeof value === 'boolean' ? value : fail(path, 'Expected boolean'));
const number: ReadValue = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(path, 'Expected finite number');
const identifier: ReadValue = (value, path) =>
  typeof value === 'string' && value.trim() && !value.includes('\u0000')
    ? value.trim()
    : fail(path, 'Expected non-empty identifier');
function list(value: unknown, path: string, read: ReadValue): unknown[] {
  if (!Array.isArray(value) || value.length > 100000) fail(path, 'Expected bounded array');
  return Array.from(value, (item, index) => read(item, `${path}[${index}]`));
}
function record(
  value: unknown,
  path: string,
  required: Record<string, ReadValue>,
  optional: Record<string, ReadValue> = {},
): Row {
  if (!persistenceRecord(value)) fail(path, 'Expected plain object');
  const result: Row = {};
  for (const [key, read] of Object.entries(required)) result[key] = read(value[key], `${path}.${key}`);
  for (const [key, read] of Object.entries(optional))
    if (value[key] !== undefined) result[key] = read(value[key], `${path}.${key}`);
  return result;
}
const fullVector: ReadValue = (value, path) => record(value, path, { x: number, y: number });
const partialVector: ReadValue = (value, path) => {
  if (!persistenceRecord(value) || Object.keys(value).some((key) => key !== 'x' && key !== 'y'))
    fail(path, 'Expected x/y vector');
  return record(value, path, {}, { x: number, y: number });
};
const transform: ReadValue = (value, path) => {
  if (!persistenceRecord(value)) fail(path, 'Expected transform object');
  const result: Row = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(baseTransform, key) && key !== 'skew')
      fail(`${path}.${key}`, 'Unsupported saved transform field');
    if (item === undefined) continue;
    result[key] =
      key === 'position' || key === 'scale'
        ? partialVector(item, `${path}.${key}`)
        : key === 'skew'
        ? fullVector(item, `${path}.${key}`)
        : number(item, `${path}.${key}`);
  }
  return result;
};
const stringMap: ReadValue = (value, path) => {
  if (!persistenceRecord(value)) fail(path, 'Expected string dictionary');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, text(item, `${path}.${key}`)]));
};
const primitive: ReadValue = (value, path) =>
  typeof value === 'string' || typeof value === 'boolean' ? value : number(value, path);
const gameVars: ReadValue = (value, path) => {
  if (!persistenceRecord(value)) fail(path, 'Expected variable dictionary');
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      Array.isArray(item) ? list(item, `${path}.${key}`, primitive) : primitive(item, `${path}.${key}`),
    ]),
  );
};

/** Validate ABI even for an empty list. Never stamp legacy input with the running host ABI. */
const NON_REPLAYABLE_COMMANDS = new Set<commandType>([
  commandType.bgm,
  commandType.pixiInit,
  commandType.miniAvatar,
  commandType.changeScene,
  commandType.end,
  commandType.setFilter,
  commandType.label,
  commandType.jumpLabel,
  commandType.chooseLabel,
  commandType.setVar,
  commandType.if,
  commandType.callScene,
  commandType.unlockCg,
  commandType.unlockBgm,
  commandType.filmMode,
  commandType.setTextbox,
  commandType.comment,
  commandType.setTransition,
  commandType.applyStyle,
  commandType.callSteam,
  commandType.return,
]);
export function sanitizeSerializedPerforms(input: unknown, commandAbi?: unknown): IRunPerform[] {
  const abiCheck = resolveSerializedCommandType({ command: 0, sourceAbi: commandAbi });
  if (!abiCheck.ok) fail('commandAbi', 'Unknown saved command ABI', abiCheck.code);
  return list(input === undefined ? [] : input, 'PerformList', (raw, path) => {
    if (!persistenceRecord(raw) || !persistenceRecord(raw.script)) fail(path, 'Expected serialized perform and script');
    const script = raw.script;
    if (script.isLineBreakHolder !== undefined && script.isLineBreakHolder !== false)
      fail(`${path}.script.isLineBreakHolder`, 'Continuation lines cannot be replayed', 'STAGE_PERFORM_NOT_REPLAYABLE');
    const resolved = resolveSerializedCommandType({
      command: script.command,
      commandRaw: script.commandRaw,
      sourceAbi: commandAbi,
    });
    if (!resolved.ok)
      fail(`${path}.script.command`, 'Saved command cannot be resolved without ambiguity', resolved.code);
    // These commands never produce a durable perform in this locked host.
    // In particular ABI 34 still means Steam, but a forged replay row must not
    // unlock an achievement or change scenes while restore is being prepared.
    if (NON_REPLAYABLE_COMMANDS.has(resolved.command as unknown as commandType))
      fail(`${path}.script.command`, 'Command is not a durable replay performer', 'STAGE_PERFORM_NOT_REPLAYABLE');
    const args = list(script.args, `${path}.script.args`, (arg, argPath) =>
      record(arg, argPath, { key: identifier, value: primitive }),
    );
    const assets = list(
      script.sentenceAssets === undefined ? [] : script.sentenceAssets,
      `${path}.script.sentenceAssets`,
      (asset, assetPath) => {
        const item = record(asset, assetPath, { name: text, type: number, url: text, lineNumber: number });
        if (
          !Number.isInteger(item.type) ||
          (item.type as number) < 0 ||
          (item.type as number) > 6 ||
          !Number.isInteger(item.lineNumber)
        )
          fail(assetPath, 'Invalid asset enum or lineNumber');
        return item;
      },
    );
    const cleanScript = {
      command: resolved.command as unknown as commandType,
      commandRaw:
        script.commandRaw === undefined
          ? commandType[resolved.command]
          : text(script.commandRaw, `${path}.script.commandRaw`),
      content: text(script.content, `${path}.script.content`),
      args,
      sentenceAssets: assets,
      subScene: list(script.subScene === undefined ? [] : script.subScene, `${path}.script.subScene`, text),
      inlineComment:
        script.inlineComment === undefined ? '' : text(script.inlineComment, `${path}.script.inlineComment`),
      isLineBreakHolder: false,
    } as ISentence;
    return {
      id: identifier(raw.id, `${path}.id`),
      isHoldOn: bool(raw.isHoldOn, `${path}.isHoldOn`),
      script: cleanScript,
    };
  }) as IRunPerform[];
}

/** Whitelist the locked host schema; absent old fields get actual upstream defaults. */
export function sanitizeNativeStageFields(input: unknown, commandAbi?: unknown): IStageState {
  if (!persistenceRecord(input)) fail('stage', 'Expected plain saved stage object');
  const next = cloneDeep(initState),
    result = next as unknown as Row;
  const arrays: Record<string, ReadValue> = {
    freeFigure: (v, p) => {
      const row = record(v, p, { basePosition: text, name: text, key: identifier });
      if (!['left', 'center', 'right', 'left13', 'right13', 'left14', 'right14'].includes(row.basePosition as string)) fail(p, 'Invalid basePosition');
      return row;
    },
    figureAssociatedAnimation: (v, p) =>
      record(v, p, {
        targetId: identifier,
        animationFlag: text,
        mouthAnimation: (x, y) => record(x, y, { open: text, close: text, halfOpen: text }),
        blinkAnimation: (x, y) => record(x, y, { open: text, close: text }),
      }),
    choose: (v, p) => record(v, p, { key: text, targetScene: text, isSubScene: bool }),
    effects: (v, p) => record(v, p, { target: identifier }, { transform }),
    animationSettings: (v, p) =>
      record(
        v,
        p,
        { target: identifier },
        {
          enterAnimationName: text,
          exitAnimationName: text,
          enterDuration: number,
          exitDuration: number,
          enterAnimationIgnoreDefault: bool,
          exitAnimationIgnoreDefault: bool,
        },
      ),
    live2dMotion: (v, p) =>
      record(
        v,
        p,
        { target: identifier, motion: text },
        {
          skin: text,
          overrideBounds: (x, y) => {
            const bounds = list(x, y, number);
            if (bounds.length !== 4) fail(y, 'Expected four bounds');
            return bounds;
          },
        },
      ),
    live2dExpression: (v, p) => record(v, p, { target: identifier, expression: text }),
    live2dBlink: (v, p) =>
      record(v, p, {
        target: identifier,
        blink: (x, y) =>
          record(x, y, {
            blinkInterval: number,
            blinkIntervalRandom: number,
            closingDuration: number,
            closedDuration: number,
            openingDuration: number,
          }),
      }),
    live2dFocus: (v, p) =>
      record(v, p, { target: identifier, focus: (x, y) => record(x, y, { x: number, y: number, instant: bool }) }),
  };
  const objects: Record<string, ReadValue> = {
    bgm: (v, p) => record(v, p, { src: text, enter: number, volume: number }),
    GameVar: gameVars,
    replacedUIlable: stringMap,
    figureMetaData: (v, p) => {
      if (!persistenceRecord(v)) fail(p, 'Expected metadata dictionary');
      return Object.fromEntries(
        Object.entries(v).map(([key, item]) => [
          key,
          record(item, `${p}.${key}`, {}, { zIndex: number, blendMode: text }),
        ]),
      );
    },
  };
  for (const [key, base] of Object.entries(initState)) {
    if (['attachments', 'stageEntities', 'PerformList'].includes(key) || input[key] === undefined) continue;
    const value = input[key],
      path = `stage.${key}`;
    result[key] =
      typeof base === 'string'
        ? text(value, path)
        : typeof base === 'boolean'
        ? bool(value, path)
        : typeof base === 'number'
        ? number(value, path)
        : arrays[key]
        ? list(value, path, arrays[key])
        : objects[key]
        ? objects[key](value, path)
        : fail(path, 'Unsupported host field');
  }
  next.PerformList = sanitizeSerializedPerforms(input.PerformList, commandAbi);
  return next;
}
