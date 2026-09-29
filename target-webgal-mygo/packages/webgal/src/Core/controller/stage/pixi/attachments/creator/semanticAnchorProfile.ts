export const SEMANTIC_ANCHOR_PROFILE_SCHEMA = 'webgal-semantic-anchor-profile' as const;
export const SEMANTIC_ANCHOR_PROFILE_VERSION = 1 as const;
export const SEMANTIC_UNKNOWN_FIELD_POLICY = 'reject' as const;
export const STANDARD_SEMANTIC_ANCHOR_IDS = [
  'body.center', 'body.head.center', 'body.head.top', 'body.face.center',
  'body.torso.chest', 'body.torso.back', 'body.hand.left.grip', 'body.hand.right.grip',
] as const;
export const SEMANTIC_CAPABILITY_VOCABULARY = [
  'fixed-position', 'direction', 'reference-scale', 'mirror', 'current-frame-mesh',
  'fit-rigid-2d', 'representative-motion', 'layer-host', 'visual-state',
] as const;

export type SemanticAnchorId = string;
export type ParentRenderableKind = 'static-image' | 'live2d';
export type SemanticCapability = (typeof SEMANTIC_CAPABILITY_VOCABULARY)[number];

export interface StaticImageFingerprint {
  kind: 'static-image';
  resourceIdentity: string;
  byteSha256: string;
  byteLength: number;
  naturalWidth: number;
  naturalHeight: number;
  format: 'png' | 'svg';
  mime: 'image/png' | 'image/svg+xml';
  cacheKey: string;
}
export interface Live2DAssetFingerprint { path: string; bytes: number; sha256: string }
export interface Live2DFingerprint {
  kind: 'live2d';
  modelJsonIdentity: string;
  modelJsonBytes: number;
  modelJsonSha256: string;
  assetManifest: Live2DAssetFingerprint[];
  assetAggregateSha256: string;
  runtimeFamily: 'pixi-live2d-display/cubism2' | 'pixi-live2d-display/cubism4';
  drawableCount: number;
  mocSha256?: string;
  cacheKey: string;
}
export type SemanticResourceFingerprint = StaticImageFingerprint | Live2DFingerprint;

export interface FixedImageFrameEvaluation {
  kind: 'fixed-image-frame';
  coordinateSpace: 'normalized-top-left-y-down';
  position: { x: number; y: number };
  directionRadians: number;
  referenceWidth: number;
  referenceScale: number;
  pivot: { x: number; y: number };
  mirrorBehavior: 'flip-direction' | 'keep-direction';
  naturalDimensions: { width: number; height: number };
}
export interface Live2DRigidFitEvaluation {
  kind: 'live2d-rigid-fit';
  modelProfileId: string;
  namedAnchor: string;
  referenceFrame: 'current-frame-mesh';
  fitAlgorithm: 'fitRigid2D';
}
export type SemanticAnchorEvaluation = FixedImageFrameEvaluation | Live2DRigidFitEvaluation;
export interface SemanticAnchorDefinition {
  id: SemanticAnchorId;
  displayName: Record<string, string>;
  categoryPath: string[];
  aliases?: string[];
  evaluation: SemanticAnchorEvaluation;
  capabilities: SemanticCapability[];
}
export interface SemanticAnchorProfileV1 {
  schema: typeof SEMANTIC_ANCHOR_PROFILE_SCHEMA;
  version: typeof SEMANTIC_ANCHOR_PROFILE_VERSION;
  profileId: string;
  parentRenderableKind: ParentRenderableKind;
  resourceFingerprint: SemanticResourceFingerprint;
  anchors: SemanticAnchorDefinition[];
}
export interface SemanticAnchorDiagnostic { code: string; path: string; message: string }
export interface SemanticAnchorValidation { valid: boolean; errors: SemanticAnchorDiagnostic[] }

const SHA256 = /^[0-9A-F]{64}$/;
const PROFILE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ANCHOR_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const ALIAS = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, issue: (code: string, path: string, message: string) => void) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issue('SEMANTIC_UNKNOWN_FIELD', path ? `${path}.${key}` : key, `unknown field ${key}`);
}

export function normalizeSemanticResourceIdentity(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-zA-Z]:/.test(normalized) ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized) || normalized.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    throw new Error('SEMANTIC_RESOURCE_IDENTITY_INVALID');
  }
  return normalized;
}

function validateFingerprint(fingerprint: unknown, parentKind: unknown, issue: (code: string, path: string, message: string) => void) {
  if (!record(fingerprint) || fingerprint.kind !== parentKind) {
    issue('FINGERPRINT_KIND_MISMATCH', 'resourceFingerprint.kind', 'fingerprint kind must equal parent kind');
    return;
  }
  if (fingerprint.kind === 'static-image') {
    rejectUnknownFields(fingerprint, ['kind', 'resourceIdentity', 'byteSha256', 'byteLength', 'naturalWidth', 'naturalHeight', 'format', 'mime', 'cacheKey'], 'resourceFingerprint', issue);
    try { if (typeof fingerprint.resourceIdentity !== 'string') throw new Error(); normalizeSemanticResourceIdentity(fingerprint.resourceIdentity); }
    catch { issue('SEMANTIC_RESOURCE_IDENTITY_INVALID', 'resourceFingerprint.resourceIdentity', 'stable relative identity required'); }
    if (typeof fingerprint.byteSha256 !== 'string' || !SHA256.test(fingerprint.byteSha256)) issue('STATIC_SHA_INVALID', 'resourceFingerprint.byteSha256', 'uppercase SHA-256 is required');
    if (!positiveInteger(fingerprint.byteLength)) issue('STATIC_BYTE_LENGTH_INVALID', 'resourceFingerprint.byteLength', 'positive byte length is required');
    if (!positiveInteger(fingerprint.naturalWidth) || !positiveInteger(fingerprint.naturalHeight)) issue('STATIC_DIMENSIONS_INVALID', 'resourceFingerprint', 'positive integer natural dimensions are required');
    const formatMimeValid = (fingerprint.format === 'png' && fingerprint.mime === 'image/png') || (fingerprint.format === 'svg' && fingerprint.mime === 'image/svg+xml');
    if (!formatMimeValid) issue('STATIC_FORMAT_MIME_MISMATCH', 'resourceFingerprint', 'format and MIME must agree');
    if (typeof fingerprint.cacheKey !== 'string' || !fingerprint.cacheKey) issue('SEMANTIC_CACHE_KEY_INVALID', 'resourceFingerprint.cacheKey', 'cache key is required');
    return;
  }
  if (fingerprint.kind === 'live2d') {
    rejectUnknownFields(fingerprint, ['kind', 'modelJsonIdentity', 'modelJsonBytes', 'modelJsonSha256', 'assetManifest', 'assetAggregateSha256', 'runtimeFamily', 'drawableCount', 'mocSha256', 'cacheKey'], 'resourceFingerprint', issue);
    try { if (typeof fingerprint.modelJsonIdentity !== 'string') throw new Error(); normalizeSemanticResourceIdentity(fingerprint.modelJsonIdentity); }
    catch { issue('SEMANTIC_RESOURCE_IDENTITY_INVALID', 'resourceFingerprint.modelJsonIdentity', 'stable relative model identity required'); }
    if (!positiveInteger(fingerprint.modelJsonBytes)) issue('LIVE2D_MODEL_BYTES_INVALID', 'resourceFingerprint.modelJsonBytes', 'positive model JSON byte length is required');
    if (typeof fingerprint.modelJsonSha256 !== 'string' || !SHA256.test(fingerprint.modelJsonSha256)) issue('LIVE2D_MODEL_SHA_INVALID', 'resourceFingerprint.modelJsonSha256', 'model JSON SHA-256 is required');
    if (typeof fingerprint.assetAggregateSha256 !== 'string' || !SHA256.test(fingerprint.assetAggregateSha256)) issue('LIVE2D_ASSET_SHA_INVALID', 'resourceFingerprint.assetAggregateSha256', 'asset aggregate SHA-256 is required');
    if (fingerprint.mocSha256 !== undefined && (typeof fingerprint.mocSha256 !== 'string' || !SHA256.test(fingerprint.mocSha256))) issue('LIVE2D_MOC_SHA_INVALID', 'resourceFingerprint.mocSha256', 'mocSha256 must be uppercase SHA-256');
    if (
      fingerprint.runtimeFamily !== 'pixi-live2d-display/cubism2' &&
      fingerprint.runtimeFamily !== 'pixi-live2d-display/cubism4'
    ) issue('LIVE2D_RUNTIME_UNSUPPORTED', 'resourceFingerprint.runtimeFamily', 'unsupported runtime family');
    if (!positiveInteger(fingerprint.drawableCount)) issue('LIVE2D_DRAWABLE_COUNT_INVALID', 'resourceFingerprint.drawableCount', 'positive drawable count is required');
    if (!Array.isArray(fingerprint.assetManifest) || fingerprint.assetManifest.length === 0) issue('LIVE2D_ASSET_MANIFEST_INVALID', 'resourceFingerprint.assetManifest', 'non-empty asset manifest required');
    else {
      let previous = ''; const paths = new Set<string>();
      for (const [index, raw] of fingerprint.assetManifest.entries()) {
        const path = `resourceFingerprint.assetManifest[${index}]`;
        if (!record(raw)) { issue('LIVE2D_ASSET_MANIFEST_INVALID', path, 'asset entry must be an object'); continue; }
        rejectUnknownFields(raw, ['path', 'bytes', 'sha256'], path, issue);
        let identity = '';
        try { if (typeof raw.path !== 'string') throw new Error(); identity = normalizeSemanticResourceIdentity(raw.path); }
        catch { issue('SEMANTIC_RESOURCE_IDENTITY_INVALID', `${path}.path`, 'stable relative asset path required'); }
        if (identity && (paths.has(identity) || identity.localeCompare(previous) < 0)) issue('LIVE2D_ASSET_MANIFEST_ORDER_INVALID', `${path}.path`, 'asset paths must be unique and sorted');
        paths.add(identity); previous = identity;
        if (!positiveInteger(raw.bytes)) issue('LIVE2D_ASSET_BYTES_INVALID', `${path}.bytes`, 'positive bytes required');
        if (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256)) issue('LIVE2D_ASSET_SHA_INVALID', `${path}.sha256`, 'uppercase SHA-256 required');
      }
    }
    if (typeof fingerprint.cacheKey !== 'string' || !fingerprint.cacheKey) issue('SEMANTIC_CACHE_KEY_INVALID', 'resourceFingerprint.cacheKey', 'cache key is required');
  }
}

export function validateSemanticAnchorProfile(input: unknown): SemanticAnchorValidation {
  const errors: SemanticAnchorDiagnostic[] = [];
  const issue = (code: string, path: string, message: string) => errors.push({ code, path, message });
  if (!record(input)) return { valid: false, errors: [{ code: 'PROFILE_NOT_OBJECT', path: '', message: 'profile must be an object' }] };
  rejectUnknownFields(input, ['schema', 'version', 'profileId', 'parentRenderableKind', 'resourceFingerprint', 'anchors'], '', issue);
  if (input.schema !== SEMANTIC_ANCHOR_PROFILE_SCHEMA) issue('SCHEMA_UNSUPPORTED', 'schema', 'unsupported semantic anchor schema');
  if (input.version !== SEMANTIC_ANCHOR_PROFILE_VERSION) issue('VERSION_UNSUPPORTED', 'version', 'unsupported semantic anchor version');
  if (typeof input.profileId !== 'string' || !PROFILE_ID.test(input.profileId)) issue('SEMANTIC_PROFILE_ID_INVALID', 'profileId', 'profileId must be a stable lowercase ID');
  if (input.parentRenderableKind !== 'static-image' && input.parentRenderableKind !== 'live2d') issue('PARENT_KIND_UNSUPPORTED', 'parentRenderableKind', 'unsupported parent renderable kind');
  validateFingerprint(input.resourceFingerprint, input.parentRenderableKind, issue);
  if (!Array.isArray(input.anchors) || input.anchors.length === 0) issue('ANCHORS_REQUIRED', 'anchors', 'at least one semantic anchor is required');
  const anchorRows = Array.isArray(input.anchors) ? input.anchors : [];
  const ids = anchorRows.filter((raw): raw is Record<string, unknown> => record(raw)).map((raw) => raw.id).filter((id): id is string => typeof id === 'string' && ANCHOR_ID.test(id));
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) issue('SEMANTIC_ANCHOR_ID_DUPLICATE', 'anchors', 'anchor IDs must be globally unique');
  const allAliases = new Set<string>();
  for (const [index, raw] of anchorRows.entries()) {
    const path = `anchors[${index}]`;
    if (!record(raw)) { issue('ANCHOR_NOT_OBJECT', path, 'anchor must be an object'); continue; }
    rejectUnknownFields(raw, ['id', 'displayName', 'categoryPath', 'aliases', 'evaluation', 'capabilities'], path, issue);
    if (typeof raw.id !== 'string' || !ANCHOR_ID.test(raw.id)) issue('SEMANTIC_ANCHOR_ID_INVALID', `${path}.id`, 'anchor ID must be a stable dotted ID');
    if (!record(raw.displayName) || Object.keys(raw.displayName).length === 0 || Object.values(raw.displayName).some((value) => typeof value !== 'string' || !value)) issue('DISPLAY_NAME_REQUIRED', `${path}.displayName`, 'localized display name is required');
    if (!Array.isArray(raw.categoryPath) || raw.categoryPath.length === 0 || raw.categoryPath.some((value) => typeof value !== 'string' || !value)) issue('CATEGORY_PATH_INVALID', `${path}.categoryPath`, 'category path must contain non-empty strings');
    const aliases = raw.aliases === undefined ? [] : raw.aliases;
    if (!Array.isArray(aliases)) issue('SEMANTIC_ANCHOR_ALIAS_INVALID', `${path}.aliases`, 'aliases must be an array');
    else for (const [aliasIndex, alias] of aliases.entries()) {
      const aliasPath = `${path}.aliases[${aliasIndex}]`;
      if (typeof alias !== 'string' || !ALIAS.test(alias)) issue('SEMANTIC_ANCHOR_ALIAS_INVALID', aliasPath, 'alias format is invalid');
      else if (allAliases.has(alias)) issue('SEMANTIC_ANCHOR_ALIAS_DUPLICATE', aliasPath, `duplicate alias ${alias}`);
      else if (idSet.has(alias)) issue('SEMANTIC_ANCHOR_ALIAS_COLLISION', aliasPath, `alias collides with anchor ID ${alias}`);
      else allAliases.add(alias);
    }
    const capabilities = raw.capabilities;
    if (!Array.isArray(capabilities) || capabilities.length === 0) issue('CAPABILITIES_REQUIRED', `${path}.capabilities`, 'non-empty capabilities are required');
    else {
      const seen = new Set<string>();
      for (const [capabilityIndex, capability] of capabilities.entries()) {
        const capabilityPath = `${path}.capabilities[${capabilityIndex}]`;
        if (typeof capability !== 'string' || !(SEMANTIC_CAPABILITY_VOCABULARY as readonly string[]).includes(capability)) issue('SEMANTIC_CAPABILITY_UNSUPPORTED', capabilityPath, `unsupported capability ${String(capability)}`);
        else if (seen.has(capability)) issue('SEMANTIC_CAPABILITY_DUPLICATE', capabilityPath, `duplicate capability ${capability}`);
        else seen.add(capability);
      }
    }
    const evaluation = raw.evaluation;
    if (!record(evaluation)) { issue('EVALUATION_REQUIRED', `${path}.evaluation`, 'evaluation is required'); continue; }
    if (evaluation.kind === 'fixed-image-frame') {
      rejectUnknownFields(evaluation, ['kind', 'coordinateSpace', 'position', 'directionRadians', 'referenceWidth', 'referenceScale', 'pivot', 'mirrorBehavior', 'naturalDimensions'], `${path}.evaluation`, issue);
      if (input.parentRenderableKind !== 'static-image') issue('EVALUATION_PARENT_MISMATCH', `${path}.evaluation.kind`, 'fixed evaluation requires static parent');
      if (evaluation.coordinateSpace !== 'normalized-top-left-y-down') issue('FIXED_COORDINATE_SPACE_INVALID', `${path}.evaluation.coordinateSpace`, 'coordinate origin must be top-left with y down');
      const position = evaluation.position; const pivot = evaluation.pivot; const dimensions = evaluation.naturalDimensions;
      if (!record(position) || !finite(position.x) || !finite(position.y) || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) issue('FIXED_POSITION_INVALID', `${path}.evaluation.position`, 'normalized position must be within [0,1]');
      if (!record(pivot) || !finite(pivot.x) || !finite(pivot.y) || pivot.x < 0 || pivot.x > 1 || pivot.y < 0 || pivot.y > 1) issue('FIXED_PIVOT_INVALID', `${path}.evaluation.pivot`, 'normalized pivot must be within [0,1]');
      if (!record(dimensions) || !positiveInteger(dimensions.width) || !positiveInteger(dimensions.height)) issue('FIXED_DIMENSIONS_INVALID', `${path}.evaluation.naturalDimensions`, 'positive integer natural dimensions required');
      if (record(input.resourceFingerprint) && input.resourceFingerprint.kind === 'static-image' && record(dimensions) && (dimensions.width !== input.resourceFingerprint.naturalWidth || dimensions.height !== input.resourceFingerprint.naturalHeight)) issue('FIXED_FINGERPRINT_DIMENSIONS_MISMATCH', `${path}.evaluation.naturalDimensions`, 'evaluation dimensions must equal fingerprint');
      if (!finite(evaluation.directionRadians) || !finite(evaluation.referenceWidth) || evaluation.referenceWidth <= 0 || !finite(evaluation.referenceScale) || evaluation.referenceScale <= 0) issue('FIXED_REFERENCE_INVALID', `${path}.evaluation`, 'finite direction and positive reference width/scale required');
      if (evaluation.mirrorBehavior !== 'flip-direction' && evaluation.mirrorBehavior !== 'keep-direction') issue('FIXED_MIRROR_BEHAVIOR_INVALID', `${path}.evaluation.mirrorBehavior`, 'unknown mirror behavior');
      for (const required of ['fixed-position', 'direction', 'reference-scale', 'mirror']) if (!Array.isArray(capabilities) || !capabilities.includes(required)) issue('MISSING_REQUIRED_CAPABILITY', `${path}.capabilities`, `missing ${required}`);
    } else if (evaluation.kind === 'live2d-rigid-fit') {
      rejectUnknownFields(evaluation, ['kind', 'modelProfileId', 'namedAnchor', 'referenceFrame', 'fitAlgorithm'], `${path}.evaluation`, issue);
      if (input.parentRenderableKind !== 'live2d') issue('EVALUATION_PARENT_MISMATCH', `${path}.evaluation.kind`, 'Live2D evaluation requires Live2D parent');
      if (typeof evaluation.modelProfileId !== 'string' || !PROFILE_ID.test(evaluation.modelProfileId) || typeof evaluation.namedAnchor !== 'string' || !ALIAS.test(evaluation.namedAnchor)) issue('LIVE2D_BINDING_REQUIRED', `${path}.evaluation`, 'valid model profile and named anchor are required');
      if (evaluation.referenceFrame !== 'current-frame-mesh' || evaluation.fitAlgorithm !== 'fitRigid2D') issue('LIVE2D_EVALUATION_UNSUPPORTED', `${path}.evaluation`, 'existing current-frame fitRigid2D path is required');
      for (const required of ['current-frame-mesh', 'fit-rigid-2d']) if (!Array.isArray(capabilities) || !capabilities.includes(required)) issue('MISSING_REQUIRED_CAPABILITY', `${path}.capabilities`, `missing ${required}`);
    } else issue('UNKNOWN_EVALUATION_KIND', `${path}.evaluation.kind`, 'unknown evaluation kind');
  }
  return { valid: errors.length === 0, errors };
}

function sortedObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]));
}
export function normalizeSemanticAnchorProfile(profile: SemanticAnchorProfileV1): SemanticAnchorProfileV1 {
  const validation = validateSemanticAnchorProfile(profile);
  if (!validation.valid) throw new Error(`SEMANTIC_ANCHOR_PROFILE_INVALID:${validation.errors.map((error) => error.code).join(',')}`);
  const fingerprint = profile.resourceFingerprint.kind === 'live2d' ? { ...profile.resourceFingerprint, assetManifest: [...profile.resourceFingerprint.assetManifest].sort((a, b) => a.path.localeCompare(b.path)) } : profile.resourceFingerprint;
  return sortedObject({ ...profile, resourceFingerprint: fingerprint, anchors: [...profile.anchors].sort((a, b) => a.id.localeCompare(b.id)).map((anchor) => ({ ...anchor, ...(anchor.aliases ? { aliases: [...anchor.aliases].sort() } : {}), capabilities: [...anchor.capabilities].sort() })) }) as SemanticAnchorProfileV1;
}
export function canonicalSemanticAnchorJson(profile: SemanticAnchorProfileV1): string { return `${JSON.stringify(normalizeSemanticAnchorProfile(profile), null, 2)}\n`; }
export function importSemanticAnchorProfile(json: string): SemanticAnchorProfileV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('SEMANTIC_ANCHOR_JSON_INVALID'); }
  const validation = validateSemanticAnchorProfile(parsed);
  if (!validation.valid) throw new Error(`SEMANTIC_ANCHOR_PROFILE_INVALID:${validation.errors.map((error) => error.code).join(',')}`);
  return normalizeSemanticAnchorProfile(parsed as SemanticAnchorProfileV1);
}
export function canonicalFingerprint(value: SemanticResourceFingerprint): string {
  const normalized = value.kind === 'live2d' ? { ...value, assetManifest: [...value.assetManifest].sort((a, b) => a.path.localeCompare(b.path)) } : value;
  return JSON.stringify(sortedObject(normalized));
}
export function compareSemanticFingerprint(expected: SemanticResourceFingerprint, observed: SemanticResourceFingerprint): SemanticAnchorDiagnostic[] {
  if (expected.kind !== observed.kind) return [{ code: 'RESOURCE_KIND_MISMATCH', path: 'resourceFingerprint.kind', message: 'parent kind mismatch' }];
  return canonicalFingerprint(expected) === canonicalFingerprint(observed) ? [] : [{ code: expected.kind === 'static-image' ? 'STATIC_FINGERPRINT_MISMATCH' : 'LIVE2D_FINGERPRINT_MISMATCH', path: 'resourceFingerprint', message: 'exact resource fingerprint mismatch; no fallback is allowed' }];
}
export function resolveSemanticAnchor(profile: SemanticAnchorProfileV1, semanticIdOrAlias: string) {
  const anchor = profile.anchors.find((candidate) => candidate.id === semanticIdOrAlias) ?? profile.anchors.find((candidate) => candidate.aliases?.includes(semanticIdOrAlias));
  if (!anchor) return { anchor: null, diagnostic: { code: 'SEMANTIC_ANCHOR_NOT_FOUND', path: 'anchors', message: semanticIdOrAlias } satisfies SemanticAnchorDiagnostic };
  return { anchor, diagnostic: null };
}

export interface StaticAffineMatrix { a: number; b: number; c: number; d: number; tx: number; ty: number }
export interface StaticParentTransform { position: { x: number; y: number }; scale: { x: number; y: number }; rotation: number; opacity: number; visible: boolean; renderedWidth: number; worldTransform?: StaticAffineMatrix }
export interface FixedImageRenderedFrame {
  origin?: { x: number; y: number };
  renderedWidth: number;
  renderedHeight?: number;
  parentScale?: { x: number; y: number };
}
export interface FixedImageLocalTransform {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  skew: { x: number; y: number };
  pivot: { x: number; y: number };
}
function parentMatrix(parent: StaticParentTransform): StaticAffineMatrix {
  if (parent.worldTransform) return { ...parent.worldTransform };
  const cos = Math.cos(parent.rotation); const sin = Math.sin(parent.rotation);
  return { a: cos * parent.scale.x, b: sin * parent.scale.x, c: -sin * parent.scale.y, d: cos * parent.scale.y, tx: parent.position.x, ty: parent.position.y };
}
function multiplyAffine(left: StaticAffineMatrix, right: StaticAffineMatrix): StaticAffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    tx: left.a * right.tx + left.c * right.ty + left.tx,
    ty: left.b * right.tx + left.d * right.ty + left.ty,
  };
}
function localMatrix(value: FixedImageLocalTransform): StaticAffineMatrix {
  const a = Math.cos(value.rotation + value.skew.y) * value.scale.x;
  const b = Math.sin(value.rotation + value.skew.y) * value.scale.x;
  const c = -Math.sin(value.rotation - value.skew.x) * value.scale.y;
  const d = Math.cos(value.rotation - value.skew.x) * value.scale.y;
  return { a, b, c, d, tx: value.position.x - value.pivot.x * a - value.pivot.y * c, ty: value.position.y - value.pivot.x * b - value.pivot.y * d };
}
export function evaluateFixedImageLocalTransform(
  evaluation: FixedImageFrameEvaluation,
  frame: FixedImageRenderedFrame,
): FixedImageLocalTransform {
  if (!Number.isFinite(frame.renderedWidth) || frame.renderedWidth <= 0) throw new Error('STATIC_RENDERED_WIDTH_INVALID');
  const renderedHeight = frame.renderedHeight ?? frame.renderedWidth * evaluation.naturalDimensions.height / evaluation.naturalDimensions.width;
  if (!Number.isFinite(renderedHeight) || renderedHeight <= 0) throw new Error('STATIC_RENDERED_HEIGHT_INVALID');
  const origin = frame.origin ?? { x: 0, y: 0 };
  const resizeScale = frame.renderedWidth / evaluation.referenceWidth;
  const parentScale = frame.parentScale ?? { x: 1, y: 1 };
  let rotation = evaluation.directionRadians;
  if (evaluation.mirrorBehavior === 'keep-direction') {
    if (Math.abs(parentScale.x) <= Number.EPSILON || Math.abs(parentScale.y) <= Number.EPSILON) throw new Error('STATIC_PARENT_SCALE_NOT_INVERTIBLE');
    rotation = Math.atan2(Math.sin(evaluation.directionRadians) / parentScale.y, Math.cos(evaluation.directionRadians) / parentScale.x);
  }
  return {
    position: { x: origin.x + evaluation.position.x * frame.renderedWidth, y: origin.y + evaluation.position.y * renderedHeight },
    scale: { x: evaluation.referenceScale * resizeScale, y: evaluation.referenceScale * resizeScale },
    rotation,
    skew: { x: 0, y: 0 },
    pivot: { x: evaluation.pivot.x * evaluation.naturalDimensions.width, y: evaluation.pivot.y * evaluation.naturalDimensions.height },
  };
}
export function evaluateFixedImageAnchor(anchor: SemanticAnchorDefinition, parent: StaticParentTransform) {
  if (anchor.evaluation.kind !== 'fixed-image-frame') throw new Error('SEMANTIC_ANCHOR_NOT_FIXED_IMAGE');
  const evaluation = anchor.evaluation;
  const localTransform = evaluateFixedImageLocalTransform(evaluation, { renderedWidth: parent.renderedWidth, parentScale: parent.scale });
  const matrix = parentMatrix(parent); const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const proxyWorldMatrix = multiplyAffine(matrix, localMatrix(localTransform));
  return { semanticAnchorId: anchor.id, position: { x: proxyWorldMatrix.tx, y: proxyWorldMatrix.ty }, rotation: Math.atan2(proxyWorldMatrix.b, proxyWorldMatrix.a), referenceScale: localTransform.scale.x * Math.sqrt(Math.abs(determinant)), opacity: parent.opacity, visible: parent.visible, mirrored: determinant < 0, worldMatrix: matrix, proxyWorldMatrix, localTransform };
}
/** Deterministic evaluator retained for tests; real Pixi ownership lives in StaticImageParentAdapter. */
export class StaticSemanticAnchorRuntime {
  private child: ReturnType<typeof evaluateFixedImageAnchor> | null = null;
  attach(anchor: SemanticAnchorDefinition, parent: StaticParentTransform) { this.child = evaluateFixedImageAnchor(anchor, parent); return this.state(); }
  update(anchor: SemanticAnchorDefinition, parent: StaticParentTransform) { if (!this.child) throw new Error('STATIC_CHILD_NOT_ATTACHED'); return this.attach(anchor, parent); }
  detach() { const previous = this.child; this.child = null; return previous; }
  state() { return this.child ? structuredClone(this.child) : null; }
}
export function resolveLive2DSemanticBinding(profile: SemanticAnchorProfileV1, semanticIdOrAlias: string, observed: Live2DFingerprint) {
  const diagnostics = compareSemanticFingerprint(profile.resourceFingerprint, observed);
  if (diagnostics.length) return { compatible: false as const, diagnostics, binding: null };
  const resolved = resolveSemanticAnchor(profile, semanticIdOrAlias);
  if (!resolved.anchor || resolved.anchor.evaluation.kind !== 'live2d-rigid-fit') return { compatible: false as const, diagnostics: [resolved.diagnostic ?? { code: 'SEMANTIC_ANCHOR_NOT_FOUND', path: 'anchors', message: semanticIdOrAlias }], binding: null };
  const evaluation = resolved.anchor.evaluation;
  return { compatible: true as const, diagnostics: [], binding: { semanticAnchorId: resolved.anchor.id, modelProfileId: evaluation.modelProfileId, namedAnchor: evaluation.namedAnchor, fitAlgorithm: evaluation.fitAlgorithm, referenceFrame: evaluation.referenceFrame } };
}
