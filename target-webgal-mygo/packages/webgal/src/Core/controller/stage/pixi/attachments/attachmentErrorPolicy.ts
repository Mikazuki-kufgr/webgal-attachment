import type { AttachmentInstanceSnapshot, AttachmentRuntimeErrorCode } from './types';

const PERMANENT_ATTACHMENT_BINDING_ERRORS: ReadonlySet<AttachmentRuntimeErrorCode> = new Set([
  'MODEL_INCOMPATIBLE',
  'PRESET_MODEL_INCOMPATIBLE',
  'MODEL_FINGERPRINT_MISMATCH',
  'MODEL_PROFILE_NOT_FOUND',
  'MODEL_PROFILE_INVALID',
  'ANCHOR_NOT_FOUND',
  'DRAWABLE_NOT_FOUND',
  'VERTEX_OUT_OF_RANGE',
  'ENTITY_ID_CONFLICT',
]);

/** Permanent binding failures must remove only the failing compound-key declaration. */
export function isPermanentAttachmentBindingError(
  code: AttachmentRuntimeErrorCode | undefined,
) {
  return code !== undefined && PERMANENT_ATTACHMENT_BINDING_ERRORS.has(code);
}

export function permanentAttachmentRemovalTarget(
  instance: Pick<AttachmentInstanceSnapshot, 'figureKey' | 'attachmentId' | 'errorCode'>,
) {
  if (!isPermanentAttachmentBindingError(instance.errorCode)) return undefined;
  return { figureKey: instance.figureKey, attachmentId: instance.attachmentId };
}
