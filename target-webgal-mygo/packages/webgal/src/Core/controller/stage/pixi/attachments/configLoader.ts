import { parseAttachmentHandBinding } from './handBinding';
import {
  ATTACHMENT_CONFIG_SCHEMA,
  type AttachmentBindingAnchor,
  type AttachmentConfig,
  type AttachmentPoint,
  type AttachmentRuntimeErrorCode,
  type LoadedAttachmentConfig,
} from '@/Core/controller/stage/pixi/attachments/types';
import { AttachmentProfileError, AttachmentProfileLoader, isLayeredAttachmentConfigId } from './profileLoader';
import { parseAttachmentEntityVisualState } from './stageEntityVisualState';

export type AttachmentConfigFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AttachmentConfigLoaderOptions {
  baseUrl?: string;
  profileBaseUrl?: string;
  fetcher?: AttachmentConfigFetcher;
}

export class AttachmentConfigError extends Error {
  public constructor(
    message: string,
    public readonly sourceUrl: string,
    public readonly code: AttachmentRuntimeErrorCode = 'CONFIG_INVALID',
    options?: ErrorOptions,
  ) {
    super(`${sourceUrl}: ${message}`, options);
    this.name = 'AttachmentConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string, sourceUrl: string) {
  if (!isRecord(value)) throw new AttachmentConfigError(`${path} must be an object`, sourceUrl);
  return value;
}

function requireString(value: unknown, path: string, sourceUrl: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AttachmentConfigError(`${path} must be a non-empty string`, sourceUrl);
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string, sourceUrl: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AttachmentConfigError(`${path} must be a finite number`, sourceUrl);
  }
  return value;
}

function requirePositiveNumber(value: unknown, path: string, sourceUrl: string) {
  const result = requireFiniteNumber(value, path, sourceUrl);
  if (result <= 0) throw new AttachmentConfigError(`${path} must be greater than zero`, sourceUrl);
  return result;
}

function readPoint(value: unknown, path: string, sourceUrl: string): AttachmentPoint {
  const point = requireRecord(value, path, sourceUrl);
  return {
    x: requireFiniteNumber(point.x, `${path}.x`, sourceUrl),
    y: requireFiniteNumber(point.y, `${path}.y`, sourceUrl),
  };
}

function readAnchor(value: unknown, index: number, sourceUrl: string): AttachmentBindingAnchor {
  const path = `target.anchorProfile.anchors[${index}]`;
  const anchor = requireRecord(value, path, sourceUrl);
  const vertexIndex = requireFiniteNumber(anchor.index, `${path}.index`, sourceUrl);
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0) {
    throw new AttachmentConfigError(`${path}.index must be a non-negative integer`, sourceUrl);
  }
  return {
    index: vertexIndex,
    weight: requirePositiveNumber(anchor.weight, `${path}.weight`, sourceUrl),
    neutral: readPoint(anchor.neutral, `${path}.neutral`, sourceUrl),
  };
}

export function normalizeGameAssetPath(sourcePath: string) {
  return sourcePath
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .split(/[?#]/, 1)[0];
}

function resolveAssetUrl(configUrl: string, assetUrl: string) {
  if (/^(?:[a-z]+:)?\/\//i.test(assetUrl) || assetUrl.startsWith('/') || assetUrl.startsWith('data:')) {
    return assetUrl;
  }
  if (assetUrl.startsWith('./game/') || assetUrl.startsWith('game/')) return assetUrl;

  const cleanConfigUrl = configUrl.split(/[?#]/, 1)[0];
  const slash = cleanConfigUrl.lastIndexOf('/');
  return slash >= 0 ? `${cleanConfigUrl.slice(0, slash + 1)}${assetUrl.replace(/^\.\//, '')}` : assetUrl;
}

function readOptionalLayer(value: unknown, path: string, sourceUrl: string): string | undefined {
  return value === undefined ? undefined : resolveAssetUrl(sourceUrl, requireString(value, path, sourceUrl));
}

/** Validate and normalize the canonical production contract. */
export function parseAttachmentConfig(value: unknown, sourceUrl: string): AttachmentConfig {
  const raw = requireRecord(value, 'config', sourceUrl);
  if (raw.schema !== ATTACHMENT_CONFIG_SCHEMA) {
    throw new AttachmentConfigError(`schema must be ${JSON.stringify(ATTACHMENT_CONFIG_SCHEMA)}`, sourceUrl);
  }

  const target = requireRecord(raw.target, 'target', sourceUrl);
  const anchorProfile = requireRecord(target.anchorProfile, 'target.anchorProfile', sourceUrl);
  const fit = requireRecord(raw.fit, 'fit', sourceUrl);
  const attachedLayersRaw = raw.attachedLayers ?? raw.layers;
  const layers = requireRecord(attachedLayersRaw, raw.attachedLayers ? 'attachedLayers' : 'layers', sourceUrl);
  const placement = requireRecord(raw.placement, 'placement', sourceUrl);

  if (!Array.isArray(anchorProfile.anchors) || anchorProfile.anchors.length < 3) {
    throw new AttachmentConfigError('target.anchorProfile.anchors must contain at least three points', sourceUrl);
  }
  const anchors = anchorProfile.anchors.map((anchor, index) => readAnchor(anchor, index, sourceUrl));
  if (new Set(anchors.map((anchor) => anchor.index)).size !== anchors.length) {
    throw new AttachmentConfigError('target.anchorProfile.anchors must not repeat a vertex index', sourceUrl);
  }

  if (fit.scaleMode !== 'fixed' && fit.scaleMode !== 'uniform') {
    throw new AttachmentConfigError('fit.scaleMode must be "fixed" or "uniform"', sourceUrl);
  }

  const layerPath = raw.attachedLayers ? 'attachedLayers' : 'layers';
  const back = readOptionalLayer(layers.back, `${layerPath}.back`, sourceUrl);
  const front = readOptionalLayer(layers.front, `${layerPath}.front`, sourceUrl);
  if (!back && !front) throw new AttachmentConfigError('at least one layer texture is required', sourceUrl);
  const freeRenderableRaw =
    raw.freeRenderable === undefined ? undefined : requireRecord(raw.freeRenderable, 'freeRenderable', sourceUrl);
  const full = freeRenderableRaw
    ? readOptionalLayer(freeRenderableRaw.full, 'freeRenderable.full', sourceUrl)
    : undefined;
  if (freeRenderableRaw && !full) {
    throw new AttachmentConfigError('freeRenderable.full is required', sourceUrl);
  }

  return {
    schema: ATTACHMENT_CONFIG_SCHEMA,
    ...(raw.handBinding === undefined ? {} : { handBinding: parseAttachmentHandBinding(raw.handBinding) }),
    configId: requireString(raw.configId, 'configId', sourceUrl),
    target: {
      modelPath: normalizeGameAssetPath(requireString(target.modelPath, 'target.modelPath', sourceUrl)),
      anchorProfile: {
        drawableId: requireString(anchorProfile.drawableId, 'target.anchorProfile.drawableId', sourceUrl),
        anchors,
      },
    },
    fit: { scaleMode: fit.scaleMode },
    layers: { back, front },
    attachedLayers: { back, front },
    ...(full ? { freeRenderable: { full } } : {}),
    placement: {
      spriteAnchor: readPoint(placement.spriteAnchor, 'placement.spriteAnchor', sourceUrl),
      offset: readPoint(placement.offset, 'placement.offset', sourceUrl),
      rotationOffsetRad: requireFiniteNumber(placement.rotationOffsetRad, 'placement.rotationOffsetRad', sourceUrl),
      localScale: requirePositiveNumber(placement.localScale, 'placement.localScale', sourceUrl),
      ...(placement.localScaleX === undefined
        ? {}
        : {
            localScaleX: requirePositiveNumber(placement.localScaleX, 'placement.localScaleX', sourceUrl),
          }),
      ...(placement.localScaleY === undefined
        ? {}
        : {
            localScaleY: requirePositiveNumber(placement.localScaleY, 'placement.localScaleY', sourceUrl),
          }),
    },
    ...(raw.initialVisualState === undefined
      ? {}
      : {
          initialVisualState: parseAttachmentEntityVisualState(raw.initialVisualState, 'initialVisualState'),
        }),
  };
}

/**
 * Test/migration helper only. Runtime loading never invokes this legacy normalizer.
 */
export function normalizeLegacyHatCalibration(value: unknown, sourceUrl: string, configId: string): AttachmentConfig {
  const raw = requireRecord(value, 'legacy config', sourceUrl);
  if (raw.schema !== 'webgal-sakiko-hat-calibration-v1') {
    throw new AttachmentConfigError('not a legacy hat calibration', sourceUrl);
  }
  const legacySprite = requireRecord(raw.sprite, 'sprite', sourceUrl);
  const legacyTextures = requireRecord(raw.textures, 'textures', sourceUrl);
  const legacyFit = requireRecord(raw.fit, 'fit', sourceUrl);
  const anchors = Array.isArray(raw.anchors)
    ? raw.anchors.map((anchor, index) => {
        const record = requireRecord(anchor, `anchors[${index}]`, sourceUrl);
        return { ...record, neutral: record.neutralCore };
      })
    : raw.anchors;
  return parseAttachmentConfig(
    {
      schema: ATTACHMENT_CONFIG_SCHEMA,
      configId,
      target: {
        modelPath: raw.modelPath,
        anchorProfile: { drawableId: raw.drawableId, anchors },
      },
      fit: { scaleMode: legacyFit.scaleMode },
      layers: legacyTextures,
      placement: {
        spriteAnchor: legacySprite.anchor,
        offset: legacySprite.offset,
        rotationOffsetRad: legacySprite.rotationOffsetRad,
        localScale: legacySprite.localScale,
      },
    },
    sourceUrl,
  );
}

function validateConfigId(configId: string) {
  const normalized = configId.replace(/\\/g, '/');
  if (
    normalized !== configId ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(configId) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid attachment config id: ${JSON.stringify(configId)}`);
  }
  return normalized;
}

export class AttachmentConfigLoader {
  private readonly baseUrl: string;
  private readonly fetcher: AttachmentConfigFetcher;
  private readonly profileLoader: AttachmentProfileLoader;
  private readonly cache = new Map<string, Promise<LoadedAttachmentConfig>>();
  /** Creator-only, memory-resident configs. They are never persisted as game data. */
  private readonly ephemeral = new Map<string, LoadedAttachmentConfig>();

  public constructor(options: AttachmentConfigLoaderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? './game/attachments').replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.profileLoader = new AttachmentProfileLoader({
      baseUrl: options.profileBaseUrl,
      fetcher: this.fetcher,
    });
  }

  public urlFor(configId: string) {
    if (isLayeredAttachmentConfigId(configId)) return this.profileLoader.urlForPreset(configId);
    return `${this.baseUrl}/${validateConfigId(configId)}.json`;
  }

  public load(configId: string, observedModelPath?: string, modelProfileId?: string, anchorName?: string): Promise<LoadedAttachmentConfig> {
    const ephemeral = this.ephemeral.get(configId);
    if (ephemeral) {
      if ((modelProfileId && ephemeral.modelBinding?.modelProfileId !== modelProfileId) ||
          (anchorName && ephemeral.modelBinding?.anchorName !== anchorName)) {
        return Promise.reject(
          new AttachmentConfigError(
            `ephemeral config does not provide model Profile ${JSON.stringify(modelProfileId)}`,
            ephemeral.sourceUrl,
            'PRESET_MODEL_INCOMPATIBLE',
          ),
        );
      }
      return Promise.resolve(ephemeral);
    }
    if (isLayeredAttachmentConfigId(configId)) {
      return this.profileLoader.load(configId, observedModelPath, modelProfileId, anchorName).catch((error) => {
        if (error instanceof AttachmentProfileError) {
          throw new AttachmentConfigError(error.message, error.sourceUrl, error.code, { cause: error });
        }
        throw error;
      });
    }
    const sourceUrl = this.urlFor(configId);
    if (modelProfileId) {
      return Promise.reject(
        new AttachmentConfigError(
          `legacy config does not provide model Profile ${JSON.stringify(modelProfileId)}`,
          sourceUrl,
          'PRESET_MODEL_INCOMPATIBLE',
        ),
      );
    }
    const existing = this.cache.get(sourceUrl);
    if (existing) return existing;

    const pending = this.fetchAndParse(configId, sourceUrl).catch((error) => {
      this.cache.delete(sourceUrl);
      throw error;
    });
    this.cache.set(sourceUrl, pending);
    return pending;
  }

  public clear(configId?: string) {
    if (configId === undefined) {
      this.cache.clear();
      this.profileLoader.clear();
      this.ephemeral.clear();
      return;
    }
    if (isLayeredAttachmentConfigId(configId)) {
      this.profileLoader.clear(configId);
      return;
    }
    this.cache.delete(this.urlFor(configId));
  }

  public registerEphemeral(configId: string, loaded: LoadedAttachmentConfig) {
    if (loaded.config.configId !== configId) {
      throw new Error(`Ephemeral config id mismatch: ${JSON.stringify(configId)}`);
    }
    this.ephemeral.set(configId, loaded);
  }

  public unregisterEphemeral(configId: string) {
    return this.ephemeral.delete(configId);
  }

  private async fetchAndParse(configId: string, sourceUrl: string): Promise<LoadedAttachmentConfig> {
    let response: Response;
    try {
      response = await this.fetcher(sourceUrl);
    } catch (error) {
      throw new AttachmentConfigError('request failed', sourceUrl, 'CONFIG_NOT_FOUND', { cause: error });
    }
    if (!response.ok) {
      throw new AttachmentConfigError(`request returned HTTP ${response.status}`, sourceUrl, 'CONFIG_NOT_FOUND');
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new AttachmentConfigError('response is not valid JSON', sourceUrl, 'CONFIG_INVALID', {
        cause: error,
      });
    }
    const config = parseAttachmentConfig(value, sourceUrl);
    if (config.configId !== configId) {
      throw new AttachmentConfigError(
        `configId ${JSON.stringify(config.configId)} does not match request ${JSON.stringify(configId)}`,
        sourceUrl,
      );
    }
    return { sourceUrl, config };
  }
}
