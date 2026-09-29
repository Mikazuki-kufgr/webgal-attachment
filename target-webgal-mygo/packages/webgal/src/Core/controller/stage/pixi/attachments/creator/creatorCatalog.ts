import { AttachmentProfileLoader, parseLive2DModelProfile } from '../profileLoader';
import type { Live2DModelProfile } from '../profileTypes';
import type { CreatorProfileCatalogEntry } from './creatorTypes';

export const CREATOR_PROFILE_CATALOG: readonly CreatorProfileCatalogEntry[] = [
  {
    modelProfileId: 'anon-school-winter-2023-head-v1',
    sourcePresetByAnchor: {
      head: 'v2/anon-straw-hat-school-winter-2023',
      'head-b': 'v2/anon-straw-hat-school-winter-2023-b',
      'head-c': 'v2/anon-straw-hat-school-winter-2023-c',
    },
    representativeMotions: ['anon/idle01', 'anon/nf_left01', 'anon/nf_right01', 'anon/nf03', 'anon/bye01'],
  },
  {
    modelProfileId: 'sakiko-school-winter-2023',
    sourcePresetByAnchor: { head: 'v2/sakiko-straw-hat-school-winter-2023' },
    representativeMotions: ['sakiko/idle01', 'sakiko/nf_left01', 'sakiko/nf_right01', 'sakiko/smile04'],
  },
  {
    modelProfileId: 'sakiko-casual-2023',
    sourcePresetByAnchor: { head: 'v2/sakiko-straw-hat-casual-2023' },
    representativeMotions: ['sakiko/idle01', 'sakiko/nf_left01', 'sakiko/nf_right01', 'sakiko/smile04'],
  },
] as const;

export const CREATOR_CATALOG_TIMEOUT_MS = 30_000;
/** Preserve an explicit user choice; never silently pick a local figure. */
export function selectCreatorLibraryProfileId(availableIds: readonly string[], previous?: string) {
  if (previous && availableIds.includes(previous)) return previous;
  return '';
}

export interface CreatorCatalogRequestOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class CreatorCatalogError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly failures: readonly { modelProfileId: string; cause: string }[] = [],
    public readonly succeeded = 0,
  ) {
    super(`${code}: ${message}`);
    this.name = 'CreatorCatalogError';
  }
}

/** One bounded read scope owns index, all profile bodies, and its cancellation listeners. */
async function withCatalogScope<T>(
  options: CreatorCatalogRequestOptions,
  operation: (json: (url: string) => Promise<unknown>, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? CREATOR_CATALOG_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > CREATOR_CATALOG_TIMEOUT_MS)
    throw new Error('CREATOR_CATALOG_TIMEOUT_INVALID');
  const controller = new AbortController();
  let timedOut = false;
  const failure = () =>
    new CreatorCatalogError(
      timedOut ? 'CREATOR_CATALOG_TIMEOUT' : 'CREATOR_CATALOG_CANCELLED',
      timedOut ? '人物资料读取超时，请检查本轮制作器服务和资源。' : '本次工作台人物资料读取已取消。',
    );
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const fetcher = options.fetcher ?? fetch;
  async function json(url: string) {
    if (controller.signal.aborted) throw failure();
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort(failure());
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const response = (async () => {
        const result = await fetcher(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!result.ok) throw new CreatorCatalogError('CREATOR_CATALOG_HTTP_ERROR', `${url}: HTTP ${result.status}`);
        return result.json();
      })();
      const value = await Promise.race([response, aborted]);
      if (controller.signal.aborted) throw failure();
      return value;
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
    }
  }
  try {
    if (controller.signal.aborted) throw failure();
    const result = await operation(json, controller.signal);
    if (controller.signal.aborted) throw failure();
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw failure();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

export async function loadCreatorProfiles(
  loader = new AttachmentProfileLoader(),
  options: CreatorCatalogRequestOptions = {},
) {
  return withCatalogScope(options, async (json, signal) => {
    let raw;
    try {
      raw = await json(loader.urlForModelProfileIndex());
    } catch (error) {
      if (signal.aborted) throw error;
      throw new CreatorCatalogError(
        'CREATOR_PROFILE_INDEX_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
    const index = raw as { schema?: unknown; schemaVersion?: unknown; profiles?: unknown; profileDocuments?: Record<string, unknown> } | null;
    if (
      !index ||
      index.schema !== 'webgal-live2d-model-profile-index' ||
      index.schemaVersion !== 1 ||
      !Array.isArray(index.profiles)
    ) {
      throw new CreatorCatalogError(
        'CREATOR_PROFILE_INDEX_INVALID',
        '必须提供当前资料库的有效索引；未回退到历史角色样例。',
      );
    }
    const ids: string[] = [];
    for (const value of index.profiles) {
      if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
        value.includes('..') ||
        ids.includes(value)
      ) {
        throw new CreatorCatalogError('CREATOR_PROFILE_INDEX_INVALID', 'Profile ID 不安全或重复。');
      }
      ids.push(value);
    }
    if (!ids.length)
      throw new CreatorCatalogError('CREATOR_MODEL_PROFILE_LIBRARY_EMPTY', '当前资料库索引没有 Profile。');
    const profiles = new Map<string, Live2DModelProfile>(),
      failures: { modelProfileId: string; cause: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length && !signal.aborted) {
        const id = ids[next++];
        try {
          const url = loader.urlForModelProfile(id),
            profile = parseLive2DModelProfile(index.profileDocuments?.[id] ?? await json(url), url);
          if (profile.modelProfileId !== id) throw new Error('CREATOR_PROFILE_ID_MISMATCH');
          // Same model path is not an identity: all distinct Profile IDs are retained.
          profiles.set(id, profile);
        } catch (error) {
          if (signal.aborted) throw error;
          failures.push({ modelProfileId: id, cause: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
    if (failures.length)
      throw new CreatorCatalogError(
        'CREATOR_MODEL_PROFILE_LIBRARY_PARTIAL_INVALID',
        `已验证 ${profiles.size}/${ids.length} 套；${failures.length} 套读取或身份校验失败（${failures
          .map((f) => f.modelProfileId)
          .join(', ')}）。未把不完整角色库标记为成功。`,
        failures,
        profiles.size,
      );
    return new Map(ids.map((id) => [id, profiles.get(id)!]));
  });
}

/** Start the catalog's bounded read scope only after another startup scan has settled. */
export async function loadCreatorProfilesAfter(
  prerequisite: PromiseLike<unknown>,
  loader = new AttachmentProfileLoader(),
  options: CreatorCatalogRequestOptions = {},
) {
  await prerequisite;
  return loadCreatorProfiles(loader, options);
}

export function creatorCatalogEntry(modelProfileId: string) {
  return CREATOR_PROFILE_CATALOG.find((entry) => entry.modelProfileId === modelProfileId);
}

export async function loadCreatorMotionInventory(
  modelPath: string,
  fetcher: typeof fetch = fetch,
  options: Omit<CreatorCatalogRequestOptions, 'fetcher'> = {},
): Promise<string[]> {
  return withCatalogScope({ ...options, fetcher }, async (json) => {
    const model = (await json(modelPath)) as { motions?: Record<string, unknown> } | null;
    if (!model?.motions || typeof model.motions !== 'object' || Array.isArray(model.motions)) {
      throw new CreatorCatalogError('CREATOR_MODEL_MOTIONS_INVALID', modelPath);
    }
    return Object.entries(model.motions)
      .filter(
        ([, entries]) =>
          Array.isArray(entries) &&
          entries.some((entry) => {
            const value = entry as { file?: unknown };
            return typeof value?.file === 'string' && value.file.length > 0;
          }),
      )
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));
  });
}
