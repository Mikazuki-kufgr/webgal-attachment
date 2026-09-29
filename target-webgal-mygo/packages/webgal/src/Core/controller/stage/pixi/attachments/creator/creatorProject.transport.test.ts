import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCreatorProjectClient,
  type CreatorProjectClient,
  CreatorProjectRequestError,
  projectLayerBytes,
} from './creatorProject';
import type { CreatorPackage } from './creatorTypes';

const token = 'a'.repeat(64),
  revision = 'B'.repeat(64);
const clients: CreatorProjectClient[] = [];
function client(fetcher: typeof fetch, extra: Parameters<typeof createCreatorProjectClient>[0] = {}) {
  const value = createCreatorProjectClient({ token, fetcher, ...extra });
  clients.push(value);
  return value;
}
function json(value: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function packageValue(): CreatorPackage {
  return {
    preset: { presetId: 'v2/hat', attachmentAssetId: 'hat', modelProfileId: 'profile-a' },
    files: [
      {
        path: 'game/attachments-v2/portable/hat/images/front.png',
        bytes: new Uint8Array([0, 1, 2]),
        sha256: 'C'.repeat(64),
      },
      { path: 'diagnostics/plan.json', bytes: new Uint8Array([99]), sha256: 'D'.repeat(64) },
    ],
  } as CreatorPackage;
}
afterEach(() => {
  for (const value of clients.splice(0)) value.cancel();
  vi.useRealTimers();
});

describe('5H per-workbench service transport', () => {
  it('preserves server UNKNOWN commitment through actual JSON transport', async () => {
    const c = client((async () => json({ok:false,code:'WRITE_UNCERTAIN',message:'lost',commitState:'UNKNOWN'},503)) as typeof fetch);
    await expect(c.saveCreatorPackageLocally(packageValue(),null)).rejects.toMatchObject({detail:{code:'WRITE_UNCERTAIN',commitState:'UNKNOWN'}});
  });
  it.each(['invalid-json', 'unstructured-http'])('write reply %s cannot prove rollback', async kind => {
    const c = client((async () => kind === 'invalid-json' ? new Response('broken', {status: 200}) : json({}, 503)) as typeof fetch);
    await expect(c.saveCreatorPackageLocally(packageValue(), null)).rejects.toMatchObject({detail:{commitState:'UNKNOWN'}});
  });
  it('sends only same-origin routes with session header and explicit selections/revisions', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetcher = (async (path: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(path), init!]);
      return json();
    }) as typeof fetch;
    const c = client(fetcher);
    await c.loadCreatorServiceContext();
    await c.openRc1Project('v2/hat', 'profile-b');
    await c.loadCreatorSavedAttachment('中文游戏', 'v2/hat');
    await c.checkCreatorTargetModel('中文游戏', './game/figure/anon/test/model.json');
    await c.acceptCreatorSavedAttachmentChanges('中文游戏', 'v2/hat', revision);
    await c.ensureCreatorPreview();
    await c.applyRc1ProjectPackage(packageValue(), 'script;', null);
    await c.saveCreatorPackageToGame('中文游戏', packageValue(), 'script;', revision);
    c.recordCreatorOperation({ type: 'attachment.load', result: 'visible' });
    expect(calls.map(([p]) => p)).toEqual([
      '/__creator/context',
      '/__rc1/project',
      '/__creator/load-attachment',
      '/__creator/check-target-model',
      '/__creator/accept-attachment-changes',
      '/__creator/ensure-preview',
      '/__rc1/apply',
      '/__creator/save-to-game',
      '/__creator/events',
    ]);
    for (const [, init] of calls) {
      expect(new Headers(init.headers).get('x-creator-session')).toBe(token);
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('same-origin');
    }
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ presetId: 'v2/hat', modelProfileId: 'profile-b' });
    expect(JSON.parse(String(calls[3][1].body))).toEqual({
      projectName: '中文游戏',
      modelPath: './game/figure/anon/test/model.json',
    });
    expect(JSON.parse(String(calls[4][1].body))).toEqual({
      projectName: '中文游戏',
      presetId: 'v2/hat',
      expectedRevision: revision,
    });
    expect(JSON.parse(String(calls[5][1].body))).toEqual({});
    expect(JSON.parse(String(calls[6][1].body)).expectedRevision).toBeNull();
    const save = JSON.parse(String(calls[7][1].body));
    expect(save.expectedRevision).toBe(revision);
    expect(save.files).toHaveLength(1);
    expect(save.files[0].base64).toBe('AAEC');
    expect(c.diagnostics().activeRequestCount).toBe(0);
  });
  it('requires a bootstrap secret and never sends an unauthenticated request', async () => {
    const fetcher = vi.fn(async () => json());
    const c = client(fetcher as typeof fetch, { token: '' });
    await expect(c.loadCreatorServiceContext()).rejects.toMatchObject({
      detail: { code: 'CREATOR_SESSION_BOOTSTRAP_REQUIRED' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('explicit stop authenticates only the owned-server request and does not claim global cleanup', async () => {
    const fetcher = vi.fn(async () => json({ ok: true, shutdown: 'REQUESTED', scope: 'OWNED_SERVER_ONLY' }));
    const c = client(fetcher as typeof fetch);
    expect(await c.shutdownCreatorService()).toEqual({ ok: true, shutdown: 'REQUESTED', scope: 'OWNED_SERVER_ONLY' });
    const call = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(call[0]).toBe('/__creator/shutdown');
    expect(JSON.parse(String(call[1].body))).toEqual({});
    expect(new Headers(call[1].headers).get('x-creator-session')).toBe(token);
  });
  it('rejects omitted/invalid expected revision without requesting a newer revision', () => {
    const fetcher = vi.fn(async () => json()),
      c = client(fetcher as typeof fetch);
    expect(() => c.saveCreatorPackageToGame('A', packageValue(), '', undefined as never)).toThrow(
      'CREATOR_EXPECTED_REVISION_REQUIRED',
    );
    expect(() => c.applyRc1ProjectPackage(packageValue(), '', 'latest')).toThrow('CREATOR_EXPECTED_REVISION_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('disposing owner A cancels its pending read but leaves owner B intact', async () => {
    const aWait = deferred<Response>(),
      bWait = deferred<Response>();
    const a = client((() => aWait.promise) as typeof fetch),
      b = client((() => bWait.promise) as typeof fetch);
    const aRead = a.loadCreatorServiceContext(),
      bRead = b.loadCreatorServiceContext();
    const cancelled = expect(aRead).rejects.toMatchObject({ detail: { code: 'CREATOR_REQUEST_CANCELLED' } });
    expect(a.cancel()).toBe(1);
    await cancelled;
    expect(b.diagnostics()).toEqual({ activeRequestCount: 1, closed: false });
    bWait.resolve(json({ ok: true, targetProjects: ['B'] }));
    expect(await bRead).toMatchObject({ targetProjects: ['B'] });
    aWait.resolve(json());
    expect(a.diagnostics()).toEqual({ activeRequestCount: 0, closed: true });
  });
  it('keeps the read deadline until a slow JSON body completes', async () => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    const c = client((async () => ({ ok: true, json: () => body.promise })) as unknown as typeof fetch, {
      readTimeoutMs: 10,
    });
    const read = c.loadCreatorServiceContext();
    const failure = expect(read).rejects.toMatchObject({ detail: { code: 'CREATOR_REQUEST_TIMEOUT' } });
    await vi.advanceTimersByTimeAsync(11);
    await failure;
    body.resolve({ ok: true });
    expect(c.diagnostics().activeRequestCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('individual flow cancellation cannot cancel another request of the same owner', async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    let count = 0;
    const c = client((() => (++count === 1 ? first.promise : second.promise)) as typeof fetch);
    const signal = new AbortController();
    const a = c.loadCreatorSavedAttachment('A', 'v2/a', { signal: signal.signal });
    const b = c.loadCreatorSavedAttachment('A', 'v2/b');
    const rejected = expect(a).rejects.toBeInstanceOf(CreatorProjectRequestError);
    signal.abort();
    await rejected;
    second.resolve(json({ ok: true, presetId: 'v2/b' }));
    expect(await b).toMatchObject({ presetId: 'v2/b' });
    first.resolve(json());
    expect(c.diagnostics().activeRequestCount).toBe(0);
  });
  it('pre-cancelled and disposed owners cannot start new requests', async () => {
    const fetcher = vi.fn(async () => json()),
      c = client(fetcher as typeof fetch),
      abort = new AbortController();
    abort.abort();
    await expect(c.loadCreatorServiceContext({ signal: abort.signal })).rejects.toMatchObject({
      detail: { code: 'CREATOR_REQUEST_CANCELLED' },
    });
    c.cancel();
    await expect(c.loadCreatorServiceContext()).rejects.toBeInstanceOf(CreatorProjectRequestError);
    c.recordCreatorOperation({ type: 'closed' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancelled write reports unknown commitment rather than claiming no write', async () => {
    const wait = deferred<Response>(),
      c = client((() => wait.promise) as typeof fetch);
    const save = c.saveCreatorPackageToGame('A', packageValue(), '', null);
    const failed = expect(save).rejects.toMatchObject({
      detail: { code: 'CREATOR_REQUEST_CANCELLED', commitState: 'UNKNOWN' },
    });
    c.cancel();
    await failed;
    wait.resolve(json());
  });
  it('network-lost and invalid-JSON writes preserve unknown commitment', async () => {
    const c = client((async () => {
      throw new Error('network lost');
    }) as typeof fetch);
    await expect(c.applyRc1ProjectPackage(packageValue(), '', null)).rejects.toMatchObject({
      detail: { code: 'CREATOR_REQUEST_FAILED', commitState: 'UNKNOWN' },
    });
    const malformed = client((async () => new Response('{')) as typeof fetch);
    await expect(malformed.applyRc1ProjectPackage(packageValue(), '', null)).rejects.toMatchObject({
      detail: { code: 'CREATOR_RESPONSE_INVALID', commitState: 'UNKNOWN' },
    });
  });
  it('keeps exact server conflict and does not replace it with success', async () => {
    const c = client((async () =>
      json({ ok: false, code: 'CREATOR_STALE_DRAFT_RELOAD_REQUIRED', conflicts: ['user.txt'] }, 409)) as typeof fetch);
    await expect(c.saveCreatorPackageToGame('A', packageValue(), '', revision)).rejects.toMatchObject({
      detail: { code: 'CREATOR_STALE_DRAFT_RELOAD_REQUIRED', conflicts: ['user.txt'] },
    });
    expect(c.diagnostics().activeRequestCount).toBe(0);
  });
  it('rejects primitive/array response data and oversize request before fetch', async () => {
    const fetcher = vi.fn(async () => json([])),
      c = client(fetcher as typeof fetch);
    await expect(c.loadCreatorServiceContext()).rejects.toMatchObject({ detail: { code: 'CREATOR_RESPONSE_INVALID' } });
    fetcher.mockClear();
    await expect(
      c.saveCreatorPackageToGame('A', packageValue(), 'x'.repeat(12 * 1024 * 1024), null),
    ).rejects.toMatchObject({ detail: { code: 'CREATOR_REQUEST_TOO_LARGE' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('event logging remains best effort and layer byte length is checked', () => {
    const c = client((() => {
      throw new Error('audit offline');
    }) as typeof fetch);
    expect(() => c.recordCreatorOperation({ type: 'test' })).not.toThrow();
    expect(() => projectLayerBytes({ base64: 'AAEC', bytes: 4, path: 'front.png' } as never)).toThrow(
      'RC1_LAYER_BYTES_MISMATCH',
    );
    expect(projectLayerBytes({ base64: 'AAEC', bytes: 3 } as never)).toEqual(new Uint8Array([0, 1, 2]));
  });
});
