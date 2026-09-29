import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCreatorProfiles,
  loadCreatorProfilesAfter,
  loadCreatorMotionInventory,
  selectCreatorLibraryProfileId,
} from './creatorCatalog';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const index = (profiles: string[]) => ({ schema: 'webgal-live2d-model-profile-index', schemaVersion: 1, profiles });
const profile = (id: string) => ({
  schema: 'webgal-live2d-model-profile',
  schemaVersion: 1,
  profileVersion: 1,
  modelProfileId: id,
  characterId: 'anon',
  modelId: 'winter',
  modelPath: 'game/figure/anon/model.json',
  fingerprint: { modelJsonSha256: 'A'.repeat(64), drawableCount: 1 },
  anchors: [
    {
      name: 'head',
      anchorProfileId: 'head',
      drawableId: 'head',
      vertexCount: 3,
      points: [
        { index: 0, weight: 1, neutral: { x: 0, y: 0 } },
        { index: 1, weight: 1, neutral: { x: 1, y: 0 } },
        { index: 2, weight: 1, neutral: { x: 0, y: 1 } },
      ],
    },
  ],
});
function id(url: RequestInfo | URL) {
  return String(url)
    .split('/')
    .pop()!
    .replace(/\.json$/, '');
}
afterEach(() => {
  vi.useRealTimers();
});

describe('5H catalog reads are bounded, cancellable, and never fake full-library success', () => {
  it('never silently selects a figure and only preserves an explicit still-available choice', () => {
    const available = ['anon-birthday_2024_ssr-semantic-v1', 'anon-school_winter-2023-semantic-v1'];
    expect(selectCreatorLibraryProfileId(available)).toBe('');
    expect(selectCreatorLibraryProfileId(available, 'anon-school_winter-2023-semantic-v1')).toBe(
      'anon-school_winter-2023-semantic-v1',
    );
    expect(selectCreatorLibraryProfileId(available, 'missing-profile')).toBe('');
    expect(selectCreatorLibraryProfileId([])).toBe('');
  });

  it('keeps all 97 distinct Profile identities even when model paths are identical, with 8-read concurrency', async () => {
    const ids = Array.from({ length: 97 }, (_, i) => `profile-${String(i).padStart(3, '0')}`);
    let active = 0,
      peak = 0;
    const requested: string[] = [];
    const values = await loadCreatorProfiles(undefined, {
      fetcher: (async (url) => {
        const name = id(url);
        requested.push(name);
        if (name === 'index') return response(index(ids));
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return response(profile(name));
      }) as typeof fetch,
    });
    expect([...values.keys()]).toEqual(ids);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
    expect(active).toBe(0);
    expect(requested).toHaveLength(98);
    expect(requested).not.toContain('anon-school-winter-2023-head-v1');
  });
  it('starts the catalog timeout scope only after the competing startup scan settles', async () => {
    let settle!: () => void;
    const prerequisite = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      response(id(url) === 'index' ? index(['profile-a']) : profile('profile-a')),
    ) as typeof fetch;
    const reading = loadCreatorProfilesAfter(prerequisite, undefined, { fetcher, timeoutMs: 10 });
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    settle();
    await expect(reading).resolves.toEqual(new Map([['profile-a', profile('profile-a')]]));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('required index HTTP failure is visible and makes no hardcoded legacy fallback requests', async () => {
    const fetcher = vi.fn(async () => response({}, 404));
    await expect(loadCreatorProfiles(undefined, { fetcher })).rejects.toMatchObject({
      code: 'CREATOR_PROFILE_INDEX_UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('malformed index, duplicate IDs, unsafe IDs and empty library fail closed', async () => {
    for (const [value, code] of [
      [{}, 'CREATOR_PROFILE_INDEX_INVALID'],
      [index(['a', 'a']), 'CREATOR_PROFILE_INDEX_INVALID'],
      [index(['../a']), 'CREATOR_PROFILE_INDEX_INVALID'],
      [index([]), 'CREATOR_MODEL_PROFILE_LIBRARY_EMPTY'],
    ] as const) {
      await expect(
        loadCreatorProfiles(undefined, { fetcher: (async () => response(value)) as typeof fetch }),
      ).rejects.toMatchObject({ code });
    }
  });
  it('partial profile failure reports successful count and failed identity instead of returning an incomplete Map', async () => {
    const fetcher = (async (url: RequestInfo | URL) => {
      const name = id(url);
      return name === 'index'
        ? response(index(['profile-a', 'profile-b']))
        : name === 'profile-a'
        ? response(profile(name))
        : response({}, 404);
    }) as typeof fetch;
    await expect(loadCreatorProfiles(undefined, { fetcher })).rejects.toMatchObject({
      code: 'CREATOR_MODEL_PROFILE_LIBRARY_PARTIAL_INVALID',
      succeeded: 1,
      failures: [{ modelProfileId: 'profile-b' }],
    });
  });
  it('requested Profile identity cannot be replaced by another file identity', async () => {
    const fetcher = (async (url: RequestInfo | URL) =>
      response(id(url) === 'index' ? index(['a']) : profile('b'))) as typeof fetch;
    await expect(loadCreatorProfiles(undefined, { fetcher })).rejects.toMatchObject({
      code: 'CREATOR_MODEL_PROFILE_LIBRARY_PARTIAL_INVALID',
      succeeded: 0,
      failures: [{ modelProfileId: 'a', cause: 'CREATOR_PROFILE_ID_MISMATCH' }],
    });
  });
  it('catalog total deadline includes streamed JSON body and releases timers', async () => {
    vi.useFakeTimers();
    const pending = new Promise<unknown>(() => {});
    const fetcher = (async () => ({ ok: true, json: () => pending })) as unknown as typeof fetch;
    const reading = loadCreatorProfiles(undefined, { fetcher, timeoutMs: 10 });
    const failed = expect(reading).rejects.toMatchObject({ code: 'CREATOR_CATALOG_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('workbench cancellation aborts in-flight profile bodies, not only index', async () => {
    const abort = new AbortController(),
      started: AbortSignal[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (id(url) === 'index') return response(index(['a', 'b']));
      started.push(init!.signal as AbortSignal);
      return { ok: true, json: () => new Promise(() => {}) } as Response;
    }) as typeof fetch;
    const reading = loadCreatorProfiles(undefined, { fetcher, signal: abort.signal });
    const failed = expect(reading).rejects.toMatchObject({ code: 'CREATOR_CATALOG_CANCELLED' });
    for (let i = 0; i < 20 && started.length < 2; i++) await Promise.resolve();
    expect(started).toHaveLength(2);
    abort.abort();
    await failed;
    expect(started.every((signal) => signal.aborted)).toBe(true);
  });
  it('a pre-cancelled catalog never starts fetch', async () => {
    const abort = new AbortController(),
      fetcher = vi.fn(async () => response({}));
    abort.abort();
    await expect(loadCreatorProfiles(undefined, { fetcher, signal: abort.signal })).rejects.toMatchObject({
      code: 'CREATOR_CATALOG_CANCELLED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('motions read real file inventory, preserve empty inventory, and reject invalid structure', async () => {
    expect(
      await loadCreatorMotionInventory('game/figure/a/model.json', (async () =>
        response({ motions: { z: [{ file: 'z.mtn' }], bad: [{}], a: [{ file: 'a.mtn' }] } })) as typeof fetch),
    ).toEqual(['a', 'z']);
    expect(
      await loadCreatorMotionInventory('game/figure/a/model.json', (async () =>
        response({ motions: {} })) as typeof fetch),
    ).toEqual([]);
    await expect(
      loadCreatorMotionInventory('game/figure/a/model.json', (async () => response({})) as typeof fetch),
    ).rejects.toMatchObject({ code: 'CREATOR_MODEL_MOTIONS_INVALID' });
  });
  it('motion request timeout/cancellation covers JSON body too', async () => {
    vi.useFakeTimers();
    const fetcher = (async () => ({ ok: true, json: () => new Promise(() => {}) })) as unknown as typeof fetch;
    const reading = loadCreatorMotionInventory('game/figure/a/model.json', fetcher, { timeoutMs: 10 });
    const failed = expect(reading).rejects.toMatchObject({ code: 'CREATOR_CATALOG_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });
});
