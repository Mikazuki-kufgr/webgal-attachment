import { commandType } from './interface/sceneInterface';

/** Stamp new serialized data at the host boundary, not on ordinary script text. */
export const ATTACHMENT_COMMAND_ABI = 'webgal-mygo3.2.1-attachment-v1' as const;
export const MYGO320_ATTACHMENT_COMMAND_ABI = 'webgal-mygo3.2.0-attachment-v1' as const;
export const UPSTREAM_MYGO321_COMMAND_ABI = 'webgal-mygo3.2.1' as const;
export const LEGACY_HOTFIX37_COMMAND_ABI = 'webgal-mygo3.0.0-hotfix37' as const;
export const UPSTREAM_MYGO320_COMMAND_ABI = 'webgal-mygo3.2.0' as const;

export type CommandAbiDiagnostic =
  | 'COMMAND_ABI_UNSUPPORTED'
  | 'COMMAND_ABI_INVALID_COMMAND'
  | 'COMMAND_ABI_INVALID_RAW'
  | 'COMMAND_ABI_RAW_MISMATCH'
  | 'COMMAND_ABI_AMBIGUOUS';

export type CommandAbiResolution =
  | { ok: true; command: commandType; migrated: boolean }
  | { ok: false; code: CommandAbiDiagnostic };

const extensionNames = ['callSteam', 'return', 'attachment', 'stageEntity'] as const;
type ExtensionName = (typeof extensionNames)[number];
const currentIds: Record<ExtensionName, commandType> = {
  callSteam: commandType.callSteam,
  return: commandType.return,
  attachment: commandType.attachment,
  stageEntity: commandType.stageEntity,
};

/**
 * Resolve only the numeric command ABI, without mutating or loading a save.
 * A caller must identify the source ABI from its validated envelope/provenance;
 * it must NOT stamp old data with the current ABI just because this parser runs.
 * Unversioned extension IDs need an exact commandRaw witness. No action/target
 * heuristics: 34 can mean legacy attachment or upstream callSteam, and 35 can
 * mean legacy stageEntity or current attachment.
 * This is not a sentence/save validator or an installed storage migration hook.
 */
export function resolveSerializedCommandType(input: {
  readonly command: unknown;
  readonly commandRaw?: unknown;
  readonly sourceAbi?: unknown;
}): CommandAbiResolution {
  const { command, commandRaw, sourceAbi } = input;
  if (
    sourceAbi !== undefined &&
    sourceAbi !== ATTACHMENT_COMMAND_ABI &&
    sourceAbi !== LEGACY_HOTFIX37_COMMAND_ABI &&
    sourceAbi !== MYGO320_ATTACHMENT_COMMAND_ABI &&
    sourceAbi !== UPSTREAM_MYGO321_COMMAND_ABI &&
    sourceAbi !== UPSTREAM_MYGO320_COMMAND_ABI
  ) {
    return { ok: false, code: 'COMMAND_ABI_UNSUPPORTED' };
  }
  if (
    typeof command !== 'number' ||
    !Number.isInteger(command) ||
    command < 0 ||
    command > commandType.stageEntity
  ) {
    return { ok: false, code: 'COMMAND_ABI_INVALID_COMMAND' };
  }
  if (commandRaw !== undefined && typeof commandRaw !== 'string') {
    return { ok: false, code: 'COMMAND_ABI_INVALID_RAW' };
  }
  // The locked old/new host command range 0..33 is unchanged. Preserve it;
  // arbitrary speaker names in commandRaw must remain valid for dialogue.
  if (command <= commandType.wait) {
    return { ok: true, command, migrated: false };
  }

  const raw = typeof commandRaw === 'string' ? commandRaw.trim() : '';
  let name: ExtensionName | undefined;
  if (sourceAbi === LEGACY_HOTFIX37_COMMAND_ABI) {
    name =
      command === 34
        ? 'attachment'
        : command === 35
        ? 'stageEntity'
        : undefined;
  } else if (sourceAbi === UPSTREAM_MYGO320_COMMAND_ABI) {
    name = command === 34 ? 'callSteam' : undefined;
  } else if (sourceAbi === UPSTREAM_MYGO321_COMMAND_ABI) {
    name = command === 34 ? 'callSteam' : command === 35 ? 'return' : undefined;
  } else if (sourceAbi === MYGO320_ATTACHMENT_COMMAND_ABI) {
    name = command === 34 ? 'callSteam' : command === 35 ? 'attachment' : command === 36 ? 'stageEntity' : undefined;
  } else if (sourceAbi === ATTACHMENT_COMMAND_ABI) {
    name = extensionNames.find(
      (candidate) => currentIds[candidate] === command,
    );
  } else {
    name = extensionNames.find((candidate) => candidate === raw);
    if (!name) return { ok: false, code: 'COMMAND_ABI_AMBIGUOUS' };
    const matchingId =
      name === 'callSteam'
        ? command === 34
        : name === 'return'
        ? command === 35
        : name === 'attachment'
        ? command === 34 || command === 35 || command === 36
        : command === 35 || command === 36 || command === 37;
    if (!matchingId) return { ok: false, code: 'COMMAND_ABI_RAW_MISMATCH' };
  }
  if (!name) return { ok: false, code: 'COMMAND_ABI_INVALID_COMMAND' };
  if (raw && raw !== name)
    return { ok: false, code: 'COMMAND_ABI_RAW_MISMATCH' };
  const resolved = currentIds[name];
  return { ok: true, command: resolved, migrated: resolved !== command };
}
