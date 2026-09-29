const NAMED_SEMANTIC_ANCHORS = new Set([
  'head',
  'hair-top',
  'eyelid-upper-left',
  'eyelid-upper-right',
  'eye-center-left',
  'eye-center-right',
  'nose',
  'mouth',
  'ear-left',
  'ear-right',
  'chin',
]);

const COMPATIBILITY_ALIASES = new Map<string, string>([
  ['left-ear', 'ear-left'],
  ['right-ear', 'ear-right'],
]);
const AMBIGUOUS_LEGACY_EYE_ANCHORS = new Set(['left-eye', 'right-eye']);

const VERIFIED_DOTTED_ANCHORS = new Map<string, string>([['body.head.top', 'head']]);
const DOTTED_SEMANTIC_ANCHOR = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const USER_SEMANTIC_ANCHOR = /^user\.[a-z0-9][a-z0-9-]*$/;

/** Unknown dotted ids remain forward-compatible at parse time, then fail closed against a loaded preset. */
export function isAttachmentSemanticAnchorId(value: string) {
  const normalized = value.trim();
  return (
    NAMED_SEMANTIC_ANCHORS.has(normalized) ||
    COMPATIBILITY_ALIASES.has(normalized) ||
    AMBIGUOUS_LEGACY_EYE_ANCHORS.has(normalized) ||
    USER_SEMANTIC_ANCHOR.test(normalized) ||
    DOTTED_SEMANTIC_ANCHOR.test(normalized)
  );
}

export function attachmentNamedAnchor(value: string) {
  const normalized = value.trim();
  return (
    VERIFIED_DOTTED_ANCHORS.get(normalized) ??
    COMPATIBILITY_ALIASES.get(normalized) ??
    (NAMED_SEMANTIC_ANCHORS.has(normalized) ? normalized : undefined)
  );
}

export function attachmentSemanticAnchorMatchesPreset(requested: string | undefined, presetAnchor: string) {
  if (!requested) return true;
  const normalizedRequested = requested.trim();
  const normalizedPreset = presetAnchor.trim();
  // A custom label conveys no cross-model equivalence. Only the exact stable
  // ID already bound by the explicitly selected Profile/preset is accepted.
  if (USER_SEMANTIC_ANCHOR.test(normalizedRequested)) return normalizedRequested === normalizedPreset;
  if (normalizedRequested === 'left-eye') {
    return normalizedPreset === 'left-eye' || normalizedPreset === 'eyelid-upper-left';
  }
  if (normalizedRequested === 'right-eye') {
    return normalizedPreset === 'right-eye' || normalizedPreset === 'eyelid-upper-right';
  }
  const requestedNamedAnchor = attachmentNamedAnchor(requested);
  if (!requestedNamedAnchor) return false;
  const presetNamedAnchor = /^head(?:-[bc])?$/.test(presetAnchor) ? 'head' : presetAnchor;
  return requestedNamedAnchor === presetNamedAnchor;
}

export function isAmbiguousUnversionedEyeAnchor(value: string | undefined): boolean {
  return value !== undefined && AMBIGUOUS_LEGACY_EYE_ANCHORS.has(value.trim());
}
