import { parseAttachmentHandBinding, cloneAttachmentHandBinding } from './handBinding';
import {
  ATTACHMENT_ASSET_SCHEMA,
  ATTACHMENT_PRESET_SCHEMA,
  ATTACHMENT_PRESET_SCHEMA_VERSION,
  ATTACHMENT_PROFILE_SCHEMA_VERSION,
  LAYERED_ATTACHMENT_CONFIG_PREFIX,
  MODEL_PROFILE_SCHEMA,
  type AttachmentAssetDefinition,
  type AttachmentPlacementPreset,
  type AttachmentProfileErrorCode,
  type Live2DModelProfile,
  type ModelFingerprint,
  type ModelProfileAnchor,
  type ModelProfileAnchorPoint,
  type ObservedAttachmentModelBinding,
  type ProfilePoint,
  type ResolvedAttachmentModelBinding,
  compatibleAnchorNames,
  isAmbiguousLegacyEyeAnchor,
  migrateLegacyProfileAnchorName,
} from './profileTypes';
import { ATTACHMENT_CONFIG_SCHEMA, type AttachmentConfig, type LoadedAttachmentConfig } from './types';
import { cloneAttachmentEntityVisualState, parseAttachmentEntityVisualState } from './stageEntityVisualState';

export type AttachmentProfileFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AttachmentProfileLoaderOptions {
  baseUrl?: string;
  fetcher?: AttachmentProfileFetcher;
}

export interface AttachmentProfileRegistryInput {
  modelProfiles?: readonly Live2DModelProfile[];
  attachmentAssets?: readonly AttachmentAssetDefinition[];
  presets?: readonly AttachmentPlacementPreset[];
}

export interface AttachmentProfileRegistry {
  modelProfiles: ReadonlyMap<string, Live2DModelProfile>;
  attachmentAssets: ReadonlyMap<string, AttachmentAssetDefinition>;
  presets: ReadonlyMap<string, AttachmentPlacementPreset>;
}

export interface ResolvedAttachmentPreset {
  config: AttachmentConfig;
  modelBinding: ResolvedAttachmentModelBinding;
}

export class AttachmentProfileError extends Error {
  public constructor(
    message: string,
    public readonly sourceUrl: string,
    public readonly code: AttachmentProfileErrorCode,
    options?: ErrorOptions,
  ) {
    super(`${sourceUrl}: ${message}`, options);
    this.name = 'AttachmentProfileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  if (!isRecord(value)) throw new AttachmentProfileError(`${path} must be an object`, sourceUrl, code);
  return value;
}

function requireString(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AttachmentProfileError(`${path} must be a non-empty string`, sourceUrl, code);
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AttachmentProfileError(`${path} must be a finite number`, sourceUrl, code);
  }
  return value;
}

function requirePositiveNumber(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  const result = requireFiniteNumber(value, path, sourceUrl, code);
  if (result <= 0) {
    throw new AttachmentProfileError(`${path} must be greater than zero`, sourceUrl, code);
  }
  return result;
}

function requirePositiveInteger(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  const result = requirePositiveNumber(value, path, sourceUrl, code);
  if (!Number.isInteger(result)) {
    throw new AttachmentProfileError(`${path} must be an integer`, sourceUrl, code);
  }
  return result;
}

function readPoint(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode): ProfilePoint {
  const point = requireRecord(value, path, sourceUrl, code);
  return {
    x: requireFiniteNumber(point.x, `${path}.x`, sourceUrl, code),
    y: requireFiniteNumber(point.y, `${path}.y`, sourceUrl, code),
  };
}

function readSchemaVersion(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  if (value !== ATTACHMENT_PROFILE_SCHEMA_VERSION) {
    throw new AttachmentProfileError(`${path} must be ${ATTACHMENT_PROFILE_SCHEMA_VERSION}`, sourceUrl, code);
  }
  return ATTACHMENT_PROFILE_SCHEMA_VERSION;
}

function readPresetSchemaVersion(value: unknown, sourceUrl: string): 1 | typeof ATTACHMENT_PRESET_SCHEMA_VERSION {
  if (value !== 1 && value !== ATTACHMENT_PRESET_SCHEMA_VERSION) {
    throw new AttachmentProfileError(
      `schemaVersion must be 1 or ${ATTACHMENT_PRESET_SCHEMA_VERSION}`,
      sourceUrl,
      'CONFIG_INVALID',
    );
  }
  return value;
}

function readSha256(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  const hash = requireString(value, path, sourceUrl, code);
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new AttachmentProfileError(`${path} must be a SHA-256 hex digest`, sourceUrl, code);
  }
  return hash.toUpperCase();
}

function validateLeafId(value: unknown, path: string, sourceUrl: string, code: AttachmentProfileErrorCode) {
  const id = requireString(value, path, sourceUrl, code);
  if (id.includes('/') || id.includes('\\') || id.includes('?') || id.includes('#') || id === '.' || id === '..') {
    throw new AttachmentProfileError(`${path} must not contain path traversal`, sourceUrl, 'PATH_TRAVERSAL');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new AttachmentProfileError(`${path} contains unsupported characters`, sourceUrl, code);
  }
  return id;
}

function validatePresetId(value: unknown, path: string, sourceUrl: string) {
  const id = requireString(value, path, sourceUrl, 'CONFIG_INVALID');
  if (!id.startsWith(LAYERED_ATTACHMENT_CONFIG_PREFIX)) {
    throw new AttachmentProfileError(
      `${path} must use the explicit ${JSON.stringify(LAYERED_ATTACHMENT_CONFIG_PREFIX)} namespace`,
      sourceUrl,
      'CONFIG_INVALID',
    );
  }
  const leaf = id.slice(LAYERED_ATTACHMENT_CONFIG_PREFIX.length);
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._（）()-]*$/u.test(leaf) || leaf.includes('..') || leaf.length > 96)
    throw new AttachmentProfileError('unsafe preset filename', sourceUrl, 'PATH_TRAVERSAL');
  return id;
}

function splitAndValidateGamePath(value: unknown, path: string, sourceUrl: string) {
  const raw = requireString(value, path, sourceUrl, 'CONFIG_INVALID');
  if (
    raw.includes('\\') ||
    raw.includes('%') ||
    raw.includes('?') ||
    raw.includes('#') ||
    /^(?:[a-z]+:)?\/\//i.test(raw) ||
    raw.startsWith('/')
  ) {
    throw new AttachmentProfileError(`${path} must be a game-root relative path`, sourceUrl, 'PATH_TRAVERSAL');
  }
  const withoutDot = raw.startsWith('./') ? raw.slice(2) : raw;
  const segments = withoutDot.split('/');
  if (
    !withoutDot.startsWith('game/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new AttachmentProfileError(`${path} must remain under game/`, sourceUrl, 'PATH_TRAVERSAL');
  }
  return { raw, normalized: withoutDot };
}

function readLayerPath(value: unknown, path: string, sourceUrl: string) {
  return splitAndValidateGamePath(value, path, sourceUrl).raw;
}

export function normalizeLayeredModelPath(value: string, sourceUrl = 'modelPath') {
  return splitAndValidateGamePath(value, 'modelPath', sourceUrl).normalized;
}

export function isLayeredAttachmentConfigId(configId: string) {
  return configId.startsWith(LAYERED_ATTACHMENT_CONFIG_PREFIX);
}

export function layeredAttachmentPresetFileId(configId: string, sourceUrl = 'configId') {
  const validated = validatePresetId(configId, 'configId', sourceUrl);
  return validated.slice(LAYERED_ATTACHMENT_CONFIG_PREFIX.length);
}

function readModelProfileAnchor(value: unknown, index: number, sourceUrl: string): ModelProfileAnchor {
  const code: AttachmentProfileErrorCode = 'MODEL_PROFILE_INVALID';
  const path = `anchors[${index}]`;
  const raw = requireRecord(value, path, sourceUrl, code);
  const vertexCount = requirePositiveInteger(raw.vertexCount, `${path}.vertexCount`, sourceUrl, code);
  if (!Array.isArray(raw.points) || raw.points.length < 3) {
    throw new AttachmentProfileError(`${path}.points must contain at least three points`, sourceUrl, code);
  }
  const points: ModelProfileAnchorPoint[] = raw.points.map((point, pointIndex) => {
    const pointPath = `${path}.points[${pointIndex}]`;
    const pointRaw = requireRecord(point, pointPath, sourceUrl, code);
    const vertexIndex = requireFiniteNumber(pointRaw.index, `${pointPath}.index`, sourceUrl, code);
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount) {
      throw new AttachmentProfileError(`${pointPath}.index must be an integer in [0, ${vertexCount})`, sourceUrl, code);
    }
    return {
      index: vertexIndex,
      weight: requirePositiveNumber(pointRaw.weight, `${pointPath}.weight`, sourceUrl, code),
      neutral: readPoint(pointRaw.neutral, `${pointPath}.neutral`, sourceUrl, code),
    };
  });
  if (new Set(points.map((point) => point.index)).size !== points.length) {
    throw new AttachmentProfileError(`${path}.points repeats a vertex index`, sourceUrl, 'DUPLICATE_ID');
  }
  return {
    name: migrateLegacyProfileAnchorName(validateLeafId(raw.name, `${path}.name`, sourceUrl, code)),
    ...(raw.displayName === undefined ? {} : { displayName: readAnchorDisplayName(raw.displayName, sourceUrl) }),
    anchorProfileId: validateLeafId(raw.anchorProfileId, `${path}.anchorProfileId`, sourceUrl, code),
    drawableId: requireString(raw.drawableId, `${path}.drawableId`, sourceUrl, code),
    vertexCount,
    points,
  };
}

function readAnchorDisplayName(value: unknown, sourceUrl: string) {
  const name = requireString(value, 'anchor.displayName', sourceUrl, 'MODEL_PROFILE_INVALID');
  if (name.length > 80 || /[\x00-\x1f\x7f]/.test(name))
    throw new AttachmentProfileError('anchor displayName must be at most 80 printable characters', sourceUrl, 'MODEL_PROFILE_INVALID');
  return name;
}

export function parseLive2DModelProfile(value: unknown, sourceUrl: string, allowEmptyDraftAnchors = false): Live2DModelProfile {
  const code: AttachmentProfileErrorCode = 'MODEL_PROFILE_INVALID';
  const raw = requireRecord(value, 'model profile', sourceUrl, code);
  if (raw.schema !== MODEL_PROFILE_SCHEMA) {
    throw new AttachmentProfileError(`schema must be ${JSON.stringify(MODEL_PROFILE_SCHEMA)}`, sourceUrl, code);
  }
  if (!Array.isArray(raw.anchors) || (!allowEmptyDraftAnchors && raw.anchors.length === 0)) {
    throw new AttachmentProfileError('anchors must be a non-empty array', sourceUrl, code);
  }
  const anchors = raw.anchors.map((anchor, index) => readModelProfileAnchor(anchor, index, sourceUrl));
  if (new Set(anchors.map((anchor) => anchor.name)).size !== anchors.length) {
    throw new AttachmentProfileError('anchors repeats a named anchor', sourceUrl, 'DUPLICATE_ID');
  }

  const fingerprintRaw = requireRecord(raw.fingerprint, 'fingerprint', sourceUrl, code);
  const fingerprint: ModelFingerprint = {
    modelJsonSha256: readSha256(fingerprintRaw.modelJsonSha256, 'fingerprint.modelJsonSha256', sourceUrl, code),
    drawableCount: requirePositiveInteger(fingerprintRaw.drawableCount, 'fingerprint.drawableCount', sourceUrl, code),
  };
  if (fingerprintRaw.mocSha256 !== undefined) {
    fingerprint.mocSha256 = readSha256(fingerprintRaw.mocSha256, 'fingerprint.mocSha256', sourceUrl, code);
  }

  return {
    schema: MODEL_PROFILE_SCHEMA,
    schemaVersion: readSchemaVersion(raw.schemaVersion, 'schemaVersion', sourceUrl, code),
    profileVersion: requirePositiveInteger(raw.profileVersion, 'profileVersion', sourceUrl, code),
    modelProfileId: validateLeafId(raw.modelProfileId, 'modelProfileId', sourceUrl, code),
    characterId: validateLeafId(raw.characterId, 'characterId', sourceUrl, code),
    modelId: validateLeafId(raw.modelId, 'modelId', sourceUrl, code),
    modelPath: normalizeLayeredModelPath(requireString(raw.modelPath, 'modelPath', sourceUrl, code), sourceUrl),
    fingerprint,
    anchors,
  };
}
export function modelProfileGeometryKey(profile: Live2DModelProfile) {
  return JSON.stringify([profile.modelPath, [...profile.anchors].sort((a, b) => a.name.localeCompare(b.name)).map(anchor =>
    [anchor.name, anchor.anchorProfileId, anchor.drawableId, anchor.vertexCount,
      [...anchor.points].sort((a, b) => a.index - b.index).map(point => [point.index, point.weight, point.neutral.x, point.neutral.y])])]);
}

export function parseAttachmentAssetDefinition(value: unknown, sourceUrl: string): AttachmentAssetDefinition {
  const raw = requireRecord(value, 'attachment asset', sourceUrl, 'CONFIG_INVALID');
  if (raw.schema !== ATTACHMENT_ASSET_SCHEMA) {
    throw new AttachmentProfileError(
      `schema must be ${JSON.stringify(ATTACHMENT_ASSET_SCHEMA)}`,
      sourceUrl,
      'CONFIG_INVALID',
    );
  }
  const attachedLayersRaw = raw.attachedLayers ?? raw.layers;
  const layerPath = raw.attachedLayers ? 'attachedLayers' : 'layers';
  const layersRaw = requireRecord(attachedLayersRaw, layerPath, sourceUrl, 'CONFIG_INVALID');
  const back = layersRaw.back === undefined ? undefined : readLayerPath(layersRaw.back, `${layerPath}.back`, sourceUrl);
  const front =
    layersRaw.front === undefined ? undefined : readLayerPath(layersRaw.front, `${layerPath}.front`, sourceUrl);
  if (!back && !front) {
    throw new AttachmentProfileError('at least one asset layer is required', sourceUrl, 'CONFIG_INVALID');
  }
  const freeRenderableRaw =
    raw.freeRenderable === undefined
      ? undefined
      : requireRecord(raw.freeRenderable, 'freeRenderable', sourceUrl, 'CONFIG_INVALID');
  const full = freeRenderableRaw ? readLayerPath(freeRenderableRaw.full, 'freeRenderable.full', sourceUrl) : undefined;
  return {
    schema: ATTACHMENT_ASSET_SCHEMA,
    schemaVersion: readSchemaVersion(raw.schemaVersion, 'schemaVersion', sourceUrl, 'CONFIG_INVALID'),
    attachmentAssetId: validateLeafId(raw.attachmentAssetId, 'attachmentAssetId', sourceUrl, 'CONFIG_INVALID'),
    slot: validateLeafId(raw.slot, 'slot', sourceUrl, 'CONFIG_INVALID'),
    layers: { back, front },
    attachedLayers: { back, front },
    ...(full ? { freeRenderable: { full } } : {}),
  };
}

export function parseAttachmentPlacementPreset(value: unknown, sourceUrl: string): AttachmentPlacementPreset {
  const raw = requireRecord(value, 'attachment preset', sourceUrl, 'CONFIG_INVALID');
  if (raw.schema !== ATTACHMENT_PRESET_SCHEMA) {
    throw new AttachmentProfileError(
      `schema must be ${JSON.stringify(ATTACHMENT_PRESET_SCHEMA)}`,
      sourceUrl,
      'CONFIG_INVALID',
    );
  }
  const schemaVersion = readPresetSchemaVersion(raw.schemaVersion, sourceUrl);
  const rawAnchorName = validateLeafId(raw.anchorName, 'anchorName', sourceUrl, 'CONFIG_INVALID');
  if (schemaVersion === ATTACHMENT_PRESET_SCHEMA_VERSION && isAmbiguousLegacyEyeAnchor(rawAnchorName)) {
    throw new AttachmentProfileError(
      `anchorName ${JSON.stringify(rawAnchorName)} is ambiguous in schema v${schemaVersion}; use ` +
        'eyelid-upper-left/right or eye-center-left/right',
      sourceUrl,
      'CONFIG_INVALID',
    );
  }
  const fit = requireRecord(raw.fit, 'fit', sourceUrl, 'CONFIG_INVALID');
  if (fit.scaleMode !== 'fixed' && fit.scaleMode !== 'uniform') {
    throw new AttachmentProfileError('fit.scaleMode must be "fixed" or "uniform"', sourceUrl, 'CONFIG_INVALID');
  }
  const placement = requireRecord(raw.placement, 'placement', sourceUrl, 'CONFIG_INVALID');
  if (raw.approvalStatus !== 'approved' && raw.approvalStatus !== 'candidate') {
    throw new AttachmentProfileError('approvalStatus must be "approved" or "candidate"', sourceUrl, 'CONFIG_INVALID');
  }
  return {
    schema: ATTACHMENT_PRESET_SCHEMA,
    schemaVersion,
    ...(raw.handBinding === undefined ? {} : { handBinding: parseAttachmentHandBinding(raw.handBinding) }),
    presetId: validatePresetId(raw.presetId, 'presetId', sourceUrl),
    approvalStatus: raw.approvalStatus,
    attachmentAssetId: validateLeafId(raw.attachmentAssetId, 'attachmentAssetId', sourceUrl, 'CONFIG_INVALID'),
    modelProfileId: validateLeafId(raw.modelProfileId, 'modelProfileId', sourceUrl, 'CONFIG_INVALID'),
    anchorName: schemaVersion === 1 ? migrateLegacyProfileAnchorName(rawAnchorName) : rawAnchorName,
    fit: { scaleMode: fit.scaleMode },
    placement: {
      spriteAnchor: readPoint(placement.spriteAnchor, 'placement.spriteAnchor', sourceUrl, 'CONFIG_INVALID'),
      offset: readPoint(placement.offset, 'placement.offset', sourceUrl, 'CONFIG_INVALID'),
      rotationOffsetRad: requireFiniteNumber(
        placement.rotationOffsetRad,
        'placement.rotationOffsetRad',
        sourceUrl,
        'CONFIG_INVALID',
      ),
      localScale: requirePositiveNumber(placement.localScale, 'placement.localScale', sourceUrl, 'CONFIG_INVALID'),
      ...(placement.localScaleX === undefined
        ? {}
        : {
            localScaleX: requirePositiveNumber(
              placement.localScaleX,
              'placement.localScaleX',
              sourceUrl,
              'CONFIG_INVALID',
            ),
          }),
      ...(placement.localScaleY === undefined
        ? {}
        : {
            localScaleY: requirePositiveNumber(
              placement.localScaleY,
              'placement.localScaleY',
              sourceUrl,
              'CONFIG_INVALID',
            ),
          }),
    },
    ...(raw.initialVisualState === undefined
      ? {}
      : {
          initialVisualState: parseAttachmentEntityVisualState(raw.initialVisualState, 'initialVisualState'),
        }),
  };
}

function uniqueMap<T>(kind: string, values: readonly T[], getId: (value: T) => string, sourceUrl: string) {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (result.has(id)) {
      throw new AttachmentProfileError(`duplicate ${kind} id ${JSON.stringify(id)}`, sourceUrl, 'DUPLICATE_ID');
    }
    result.set(id, value);
  }
  return result;
}

export function createAttachmentProfileRegistry(
  input: AttachmentProfileRegistryInput,
  sourceUrl = 'attachment profile registry',
): AttachmentProfileRegistry {
  return {
    modelProfiles: uniqueMap(
      'model profile',
      input.modelProfiles ?? [],
      (profile) => profile.modelProfileId,
      sourceUrl,
    ),
    attachmentAssets: uniqueMap(
      'attachment asset',
      input.attachmentAssets ?? [],
      (asset) => asset.attachmentAssetId,
      sourceUrl,
    ),
    presets: uniqueMap('attachment preset', input.presets ?? [], (preset) => preset.presetId, sourceUrl),
  };
}

export function resolveAttachmentPlacementPreset(
  registry: AttachmentProfileRegistry,
  presetId: string,
  sourceUrl = 'attachment profile registry',
): ResolvedAttachmentPreset {
  const preset = registry.presets.get(presetId);
  if (!preset) {
    throw new AttachmentProfileError(`preset ${JSON.stringify(presetId)} was not found`, sourceUrl, 'CONFIG_NOT_FOUND');
  }
  const profile = registry.modelProfiles.get(preset.modelProfileId);
  if (!profile) {
    throw new AttachmentProfileError(
      `model profile ${JSON.stringify(preset.modelProfileId)} was not found`,
      sourceUrl,
      'MODEL_PROFILE_NOT_FOUND',
    );
  }
  const asset = registry.attachmentAssets.get(preset.attachmentAssetId);
  if (!asset) {
    throw new AttachmentProfileError(
      `attachment asset ${JSON.stringify(preset.attachmentAssetId)} was not found`,
      sourceUrl,
      'CONFIG_NOT_FOUND',
    );
  }
  const compatibleNames = compatibleAnchorNames(preset.anchorName);
  const anchor = profile.anchors.find((candidate) => compatibleNames.includes(candidate.name));
  if (!anchor) {
    throw new AttachmentProfileError(
      `anchor ${JSON.stringify(preset.anchorName)} was not found in ${profile.modelProfileId}`,
      sourceUrl,
      'ANCHOR_NOT_FOUND',
    );
  }

  return {
    config: {
      schema: ATTACHMENT_CONFIG_SCHEMA,
      configId: preset.presetId,
      target: {
        modelPath: profile.modelPath,
        anchorProfile: {
          drawableId: anchor.drawableId,
          anchors: anchor.points.map((point) => ({
            index: point.index,
            weight: point.weight,
            neutral: { ...point.neutral },
          })),
        },
      },
      ...(preset.handBinding ? { handBinding: cloneAttachmentHandBinding(preset.handBinding) } : {}),
      fit: { ...preset.fit },
      layers: { ...asset.layers },
      attachedLayers: { ...(asset.attachedLayers ?? asset.layers) },
      ...(asset.freeRenderable ? { freeRenderable: { ...asset.freeRenderable } } : {}),
      placement: {
        spriteAnchor: { ...preset.placement.spriteAnchor },
        offset: { ...preset.placement.offset },
        rotationOffsetRad: preset.placement.rotationOffsetRad,
        localScale: preset.placement.localScale,
        ...(preset.placement.localScaleX === undefined ? {} : { localScaleX: preset.placement.localScaleX }),
        ...(preset.placement.localScaleY === undefined ? {} : { localScaleY: preset.placement.localScaleY }),
      },
      ...(preset.initialVisualState
        ? {
            initialVisualState: cloneAttachmentEntityVisualState(
              preset.initialVisualState,
            ) as AttachmentConfig['initialVisualState'],
          }
        : {}),
    },
    modelBinding: {
      modelProfileId: profile.modelProfileId,
      characterId: profile.characterId,
      modelId: profile.modelId,
      modelPath: profile.modelPath,
      profileVersion: profile.profileVersion,
      presetApprovalStatus: preset.approvalStatus,
      fingerprint: { ...profile.fingerprint },
      anchorName: anchor.name,
      anchorProfileId: anchor.anchorProfileId,
      drawableId: anchor.drawableId,
      vertexCount: anchor.vertexCount,
      anchorVertexIndices: anchor.points.map((point) => point.index),
    },
  };
}

function hashMismatch(expected: string | undefined, actual: string | undefined) {
  return actual !== undefined && expected?.toUpperCase() !== actual.toUpperCase();
}

/** Runtime/preflight check; expensive file hashes are compared only when supplied. */
export function assertAttachmentModelBinding(
  binding: ResolvedAttachmentModelBinding,
  observed: ObservedAttachmentModelBinding,
  sourceUrl = binding.modelProfileId,
) {
  let observedPath: string;
  try {
    observedPath = normalizeLayeredModelPath(observed.modelPath, sourceUrl);
  } catch (error) {
    throw new AttachmentProfileError(
      `observed model path is invalid: ${error instanceof Error ? error.message : String(error)}`,
      sourceUrl,
      'PRESET_MODEL_INCOMPATIBLE',
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (observedPath !== binding.modelPath) {
    throw new AttachmentProfileError(
      `preset targets ${binding.modelPath}, not ${observedPath}`,
      sourceUrl,
      'PRESET_MODEL_INCOMPATIBLE',
    );
  }
  if (
    hashMismatch(binding.fingerprint.modelJsonSha256, observed.modelJsonSha256) ||
    hashMismatch(binding.fingerprint.mocSha256, observed.mocSha256) ||
    (observed.drawableCount !== undefined && observed.drawableCount !== binding.fingerprint.drawableCount)
  ) {
    throw new AttachmentProfileError(
      'model fingerprint does not match the selected profile',
      sourceUrl,
      'MODEL_FINGERPRINT_MISMATCH',
    );
  }
  const vertexCount = observed.getDrawableVertexCount(binding.drawableId);
  if (vertexCount === undefined) {
    throw new AttachmentProfileError(
      `profile drawable ${JSON.stringify(binding.drawableId)} is unavailable`,
      sourceUrl,
      'DRAWABLE_NOT_FOUND',
    );
  }
  if (vertexCount !== binding.vertexCount) {
    throw new AttachmentProfileError(
      `profile drawable ${binding.drawableId} has ${vertexCount} vertices; expected ${binding.vertexCount}`,
      sourceUrl,
      'MODEL_FINGERPRINT_MISMATCH',
    );
  }
  if (binding.anchorVertexIndices.some((index) => index < 0 || index >= vertexCount)) {
    throw new AttachmentProfileError(
      `anchor ${JSON.stringify(binding.anchorName)} contains an out-of-range vertex`,
      sourceUrl,
      'MODEL_PROFILE_INVALID',
    );
  }
}

/** Explicit v2 namespace loader. Legacy v1 loading remains in AttachmentConfigLoader. */
export class AttachmentProfileLoader {
  private readonly baseUrl: string;
  private readonly fetcher: AttachmentProfileFetcher;
  private readonly presetCache = new Map<string, Promise<LoadedAttachmentConfig>>();
  private readonly profileCache = new Map<string, Promise<Live2DModelProfile>>();
  private readonly assetCache = new Map<string, Promise<AttachmentAssetDefinition>>();

  public constructor(options: AttachmentProfileLoaderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? './game/attachments-v2').replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  public urlForPreset(configId: string) {
    return `${this.baseUrl}/presets/${layeredAttachmentPresetFileId(configId)}.json`;
  }

  public urlForPackage(configId: string) {
    return `${this.baseUrl}/portable/${layeredAttachmentPresetFileId(configId)}/attachment.json`;
  }

  public urlForLegacyPackage(configId: string) {
    return `${this.baseUrl}/${layeredAttachmentPresetFileId(configId)}/attachment.json`;
  }

  public urlForModelProfile(modelProfileId: string) {
    return `${this.baseUrl}/model-profiles/${validateLeafId(
      modelProfileId,
      'modelProfileId',
      'modelProfileId',
      'MODEL_PROFILE_INVALID',
    )}.json`;
  }

  public urlForModelProfileIndex() {
    return `${this.baseUrl}/model-profiles/index.json`;
  }

  public urlForAttachmentAsset(attachmentAssetId: string) {
    return `${this.baseUrl}/assets/${validateLeafId(
      attachmentAssetId,
      'attachmentAssetId',
      'attachmentAssetId',
      'CONFIG_INVALID',
    )}.json`;
  }

  public load(configId: string, observedModelPath?: string, modelProfileId?: string, anchorName?: string): Promise<LoadedAttachmentConfig> {
    const sourceUrl = this.urlForPackage(configId);
    const normalizedObserved = observedModelPath ? normalizeLayeredModelPath(observedModelPath, sourceUrl) : '';
    const selectedProfileId = modelProfileId
      ? validateLeafId(modelProfileId, 'modelProfileId', sourceUrl, 'PRESET_MODEL_INCOMPATIBLE')
      : '';
    const selectedAnchor = anchorName
      ? migrateLegacyProfileAnchorName(validateLeafId(anchorName, 'anchorName', sourceUrl, 'ANCHOR_NOT_FOUND'))
      : '';
    const cacheKey = `${sourceUrl}#model=${encodeURIComponent(normalizedObserved)}#profile=${encodeURIComponent(
      selectedProfileId,
    )}#anchor=${encodeURIComponent(selectedAnchor)}`;
    const existing = this.presetCache.get(cacheKey);
    if (existing) return existing;
    let pending: Promise<LoadedAttachmentConfig>;
    pending = this.loadPackageOrLegacyPreset(configId, sourceUrl, normalizedObserved, selectedProfileId, selectedAnchor).catch(
      (error) => {
        if (this.presetCache.get(cacheKey) === pending) this.presetCache.delete(cacheKey);
        throw error;
      },
    );
    this.presetCache.set(cacheKey, pending);
    return pending;
  }

  public clear(configId?: string) {
    if (configId === undefined) {
      this.presetCache.clear();
      this.profileCache.clear();
      this.assetCache.clear();
      return;
    }
    const prefix = `${this.urlForPackage(configId)}#model=`;
    for (const key of this.presetCache.keys()) if (key.startsWith(prefix)) this.presetCache.delete(key);
  }

  private async loadPackageOrLegacyPreset(
    configId: string,
    sourceUrl: string,
    observedModelPath: string,
    modelProfileId: string,
    requestedAnchor: string,
  ): Promise<LoadedAttachmentConfig> {
    let response: Response;
    let effectiveSourceUrl = sourceUrl;
    try {
      response = await this.fetcher(sourceUrl);
    } catch (error) {
      throw new AttachmentProfileError(
        'request failed',
        sourceUrl,
        'CONFIG_NOT_FOUND',
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    if (response.status === 404) {
      effectiveSourceUrl = this.urlForLegacyPackage(configId);
      try {
        response = await this.fetcher(effectiveSourceUrl);
      } catch (error) {
        throw new AttachmentProfileError(
          'request failed',
          effectiveSourceUrl,
          'CONFIG_NOT_FOUND',
          error instanceof Error ? { cause: error } : undefined,
        );
      }
      if (response.status === 404) {
        const legacyUrl = this.urlForPreset(configId);
        return this.loadPreset(configId, legacyUrl, requestedAnchor);
      }
    }
    if (!response.ok) {
      throw new AttachmentProfileError(
        `request returned HTTP ${response.status}`,
        effectiveSourceUrl,
        'CONFIG_NOT_FOUND',
      );
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      throw new AttachmentProfileError(
        'response is not valid JSON',
        effectiveSourceUrl,
        'CONFIG_INVALID',
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    sourceUrl = effectiveSourceUrl;
    const document = requireRecord(raw, 'attachment package', sourceUrl, 'CONFIG_INVALID');
    if (
      document.schema !== 'webgal-live2d-attachment-package' ||
      (document.schemaVersion !== 1 && document.schemaVersion !== 2)
    ) {
      throw new AttachmentProfileError('unsupported attachment package schema', sourceUrl, 'CONFIG_INVALID');
    }
    const asset = parseAttachmentAssetDefinition(document.asset, sourceUrl);
    let preset: AttachmentPlacementPreset;
    let profile: Live2DModelProfile;
    let uncalibrated = false;
    if (document.schemaVersion === 1) {
      preset = parseAttachmentPlacementPreset(document.preset, sourceUrl);
      profile = parseLive2DModelProfile(document.modelProfile, sourceUrl);
      if (requestedAnchor && preset.anchorName !== requestedAnchor) {
        if (!profile.anchors.some(anchor => anchor.name === requestedAnchor))
          throw new AttachmentProfileError(`anchor ${JSON.stringify(requestedAnchor)} was not found in ${profile.modelProfileId}`, sourceUrl, 'ANCHOR_NOT_FOUND');
        preset = { ...preset, anchorName: requestedAnchor, approvalStatus: 'candidate' };
        uncalibrated = true;
      }
    } else {
      if (!Array.isArray(document.adaptations) || document.adaptations.length === 0) {
        throw new AttachmentProfileError(
          'schema v2 adaptations must be a non-empty array',
          sourceUrl,
          'CONFIG_INVALID',
        );
      }
      const adaptations = document.adaptations.map((value, index) => {
        const adaptation = requireRecord(value, `adaptations[${index}]`, sourceUrl, 'CONFIG_INVALID');
        return {
          preset: parseAttachmentPlacementPreset(adaptation.preset, `${sourceUrl}#adaptation=${index}`),
          profile: parseLive2DModelProfile(adaptation.modelProfile, `${sourceUrl}#adaptation=${index}`),
        };
      });
      const matching = modelProfileId
        ? adaptations.filter((adaptation) => adaptation.profile.modelProfileId === modelProfileId)
        : observedModelPath
        ? adaptations.filter((adaptation) => adaptation.profile.modelPath === observedModelPath)
        : adaptations;
      const pairs = new Set<string>();
      const geometry = new Map<string, string>();
      for (const adaptation of adaptations) {
        if (adaptation.preset.presetId !== configId || adaptation.preset.attachmentAssetId !== asset.attachmentAssetId ||
            adaptation.preset.modelProfileId !== adaptation.profile.modelProfileId)
          throw new AttachmentProfileError('adaptation identity does not match its package', sourceUrl, 'CONFIG_INVALID');
        const pair = JSON.stringify([adaptation.profile.modelProfileId, adaptation.preset.anchorName]);
        if (pairs.has(pair)) throw new AttachmentProfileError(`duplicate adaptation ${pair}`, sourceUrl, 'DUPLICATE_ID');
        pairs.add(pair);
        const identity = modelProfileGeometryKey(adaptation.profile);
        const previous = geometry.get(adaptation.profile.modelProfileId);
        if (previous && previous !== identity)
          throw new AttachmentProfileError(`conflicting geometry for Profile ${adaptation.profile.modelProfileId}`, sourceUrl, 'MODEL_PROFILE_INVALID');
        geometry.set(adaptation.profile.modelProfileId, identity);
      }
      const distinctProfiles = new Set(matching.map((adaptation) => adaptation.profile.modelProfileId));
      if (matching.length === 0 && modelProfileId)
        throw new AttachmentProfileError(`model Profile ${JSON.stringify(modelProfileId)} was not found in this attachment`, sourceUrl, 'MODEL_PROFILE_NOT_FOUND');
      if (distinctProfiles.size !== 1 || matching.length === 0) {
        const candidates = adaptations.map((adaptation) => adaptation.profile.modelProfileId).join(', ');
        throw new AttachmentProfileError(
          modelProfileId
            ? `model Profile ${JSON.stringify(
                modelProfileId,
              )} does not uniquely identify an adaptation; available Profiles: ${candidates}`
            : `adaptation selection is ambiguous${
                observedModelPath ? ` for ${JSON.stringify(observedModelPath)}` : ''
              }; add -profile=<modelProfileId>. Available Profiles: ${candidates}`,
          sourceUrl,
          'PRESET_MODEL_INCOMPATIBLE',
        );
      }
      const profileRows = matching;
      const selectedProfile = profileRows[0].profile;
      const named = requestedAnchor
        ? profileRows.filter((adaptation) => adaptation.preset.anchorName === requestedAnchor)
        : profileRows;
      let selected = named.length === 1 ? named[0] : undefined;
      if (requestedAnchor && !selected) {
        if (!selectedProfile.anchors.some((anchor) => anchor.name === requestedAnchor))
          throw new AttachmentProfileError(`anchor ${JSON.stringify(requestedAnchor)} was not found in ${selectedProfile.modelProfileId}`, sourceUrl, 'ANCHOR_NOT_FOUND');
        const defaults = document.defaultParameters;
        if (defaults === undefined && adaptations.length !== 1)
          throw new AttachmentProfileError('no defaultParameters for unsaved anchor; choose a calibrated -anchor or define defaults', sourceUrl, 'CONFIG_INVALID');
        const seed = defaults === undefined ? profileRows[0].preset : parseAttachmentPlacementPreset({
          ...profileRows[0].preset, ...requireRecord(defaults, 'defaultParameters', sourceUrl, 'CONFIG_INVALID'),
          anchorName: requestedAnchor,
        }, sourceUrl);
        selected = { profile: selectedProfile, preset: { ...seed, anchorName: requestedAnchor, approvalStatus: 'candidate' } };
        uncalibrated = true;
      }
      if (!selected) {
        throw new AttachmentProfileError('multiple anchors match this Profile; add -anchor=<anchorName>', sourceUrl, 'PRESET_MODEL_INCOMPATIBLE');
      }
      ({ preset, profile } = selected);
      if (observedModelPath && profile.modelPath !== observedModelPath) {
        throw new AttachmentProfileError(
          `selected model Profile ${JSON.stringify(modelProfileId)} targets ${JSON.stringify(
            profile.modelPath,
          )}, not ${JSON.stringify(observedModelPath)}`,
          sourceUrl,
          'PRESET_MODEL_INCOMPATIBLE',
        );
      }
    }
    if (preset.presetId !== configId) {
      throw new AttachmentProfileError(
        `presetId ${JSON.stringify(preset.presetId)} does not match request ${JSON.stringify(configId)}`,
        sourceUrl,
        'CONFIG_INVALID',
      );
    }
    const resolved = resolveAttachmentPlacementPreset(
      createAttachmentProfileRegistry(
        { modelProfiles: [profile], attachmentAssets: [asset], presets: [preset] },
        sourceUrl,
      ),
      configId,
      sourceUrl,
    );
    return { sourceUrl, config: resolved.config, modelBinding: resolved.modelBinding,
      calibrationStatus: uncalibrated ? 'default-uncalibrated' : 'saved' };
  }

  private async loadPreset(configId: string, sourceUrl: string, requestedAnchor = ''): Promise<LoadedAttachmentConfig> {
    let preset = parseAttachmentPlacementPreset(await this.fetchJson(sourceUrl, 'CONFIG_NOT_FOUND'), sourceUrl);
    if (preset.presetId !== configId) {
      throw new AttachmentProfileError(
        `presetId ${JSON.stringify(preset.presetId)} does not match request ${JSON.stringify(configId)}`,
        sourceUrl,
        'CONFIG_INVALID',
      );
    }
    const [profile, asset] = await Promise.all([
      this.loadModelProfile(preset.modelProfileId),
      this.loadAttachmentAsset(preset.attachmentAssetId),
    ]);
    let uncalibrated = false;
    if (requestedAnchor && preset.anchorName !== requestedAnchor) {
      if (!profile.anchors.some(anchor => anchor.name === requestedAnchor))
        throw new AttachmentProfileError(`anchor ${JSON.stringify(requestedAnchor)} was not found in ${profile.modelProfileId}`, sourceUrl, 'ANCHOR_NOT_FOUND');
      preset = { ...preset, anchorName: requestedAnchor, approvalStatus: 'candidate' };
      uncalibrated = true;
    }
    const resolved = resolveAttachmentPlacementPreset(
      createAttachmentProfileRegistry(
        {
          modelProfiles: [profile],
          attachmentAssets: [asset],
          presets: [preset],
        },
        sourceUrl,
      ),
      configId,
      sourceUrl,
    );
    return { sourceUrl, config: resolved.config, modelBinding: resolved.modelBinding,
      calibrationStatus: uncalibrated ? 'default-uncalibrated' : 'saved' };
  }

  private loadModelProfile(modelProfileId: string) {
    const sourceUrl = this.urlForModelProfile(modelProfileId);
    const existing = this.profileCache.get(sourceUrl);
    if (existing) return existing;
    const pending = this.fetchJson(sourceUrl, 'MODEL_PROFILE_NOT_FOUND')
      .then((value) => parseLive2DModelProfile(value, sourceUrl))
      .then((profile) => {
        if (profile.modelProfileId !== modelProfileId) {
          throw new AttachmentProfileError(
            `modelProfileId ${JSON.stringify(profile.modelProfileId)} does not match request ${JSON.stringify(
              modelProfileId,
            )}`,
            sourceUrl,
            'MODEL_PROFILE_INVALID',
          );
        }
        return profile;
      })
      .catch((error) => {
        this.profileCache.delete(sourceUrl);
        throw error;
      });
    this.profileCache.set(sourceUrl, pending);
    return pending;
  }

  private loadAttachmentAsset(attachmentAssetId: string) {
    const sourceUrl = this.urlForAttachmentAsset(attachmentAssetId);
    const existing = this.assetCache.get(sourceUrl);
    if (existing) return existing;
    const pending = this.fetchJson(sourceUrl, 'CONFIG_NOT_FOUND')
      .then((value) => parseAttachmentAssetDefinition(value, sourceUrl))
      .then((asset) => {
        if (asset.attachmentAssetId !== attachmentAssetId) {
          throw new AttachmentProfileError(
            `attachmentAssetId ${JSON.stringify(asset.attachmentAssetId)} does not match request ${JSON.stringify(
              attachmentAssetId,
            )}`,
            sourceUrl,
            'CONFIG_INVALID',
          );
        }
        return asset;
      })
      .catch((error) => {
        this.assetCache.delete(sourceUrl);
        throw error;
      });
    this.assetCache.set(sourceUrl, pending);
    return pending;
  }

  private async fetchJson(sourceUrl: string, notFoundCode: AttachmentProfileErrorCode) {
    let response: Response;
    try {
      response = await this.fetcher(sourceUrl);
    } catch (error) {
      throw new AttachmentProfileError(
        'request failed',
        sourceUrl,
        notFoundCode,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    if (!response.ok) {
      throw new AttachmentProfileError(`request returned HTTP ${response.status}`, sourceUrl, notFoundCode);
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new AttachmentProfileError(
        'response is not valid JSON',
        sourceUrl,
        notFoundCode === 'MODEL_PROFILE_NOT_FOUND' ? 'MODEL_PROFILE_INVALID' : 'CONFIG_INVALID',
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }
}
