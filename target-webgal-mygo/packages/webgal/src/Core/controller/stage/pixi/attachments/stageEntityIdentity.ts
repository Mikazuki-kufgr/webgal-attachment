const STAGE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/%-]*$/;

/**
 * Percent-encodes one legacy identity component without leaving any character
 * that is outside the Stage Entity id alphabet. encodeURIComponent deliberately
 * leaves !'()*~ unescaped, so it is not sufficient for this namespace.
 */
export function strictEncodeLegacyEntityIdComponent(value: string): string {
  if (value.length === 0) {
    throw new Error('Legacy stage entity identity components must be non-empty');
  }
  return encodeURIComponent(value).replace(
    /[!'()*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function deriveLegacyAttachmentEntityId(figureKey: string, attachmentId: string): string {
  const entityId =
    `legacy-attachment:${strictEncodeLegacyEntityIdComponent(figureKey)}:` +
    strictEncodeLegacyEntityIdComponent(attachmentId);
  // Keep the derivation fail-closed if the public Stage Entity alphabet changes.
  return normalizeStageEntityId(entityId);
}

export function normalizeStageEntityId(value: string): string {
  if (value !== value.trim()) {
    throw new Error(`Invalid stage entity id with surrounding whitespace: ${JSON.stringify(value)}`);
  }
  const entityId = value;
  if (!entityId || !STAGE_ENTITY_ID_PATTERN.test(entityId)) {
    throw new Error(`Invalid stage entity id: ${JSON.stringify(value)}`);
  }
  return entityId;
}
