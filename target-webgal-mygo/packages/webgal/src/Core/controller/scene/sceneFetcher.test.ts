import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
const { default: axios } = await import('axios');
const { sceneFetcher } = await import('./sceneFetcher');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { location: { href: 'http://localhost/game/' } });
  vi.mocked(axios.get).mockResolvedValue({ data: 'scene text' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scene transport preserves native URL gate while forwarding cancellation', () => {
  it('accepts txt pathname with query/hash and forwards exact signal', async () => {
    const controller = new AbortController();
    expect(await sceneFetcher('./start.txt?version=1#x', { signal: controller.signal })).toBe('scene text');
    expect(axios.get).toHaveBeenCalledWith('./start.txt?version=1#x', { signal: controller.signal });
  });
  it.each(['', 'start.json', 'start.txt/child', 'http://[bad'])('rejects invalid scene pathname %s', async (url) => {
    await expect(sceneFetcher(url)).rejects.toBe('Scene file must be a txt file');
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('preserves transport rejection and string conversion', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('cancelled'));
    await expect(sceneFetcher('start.txt')).rejects.toThrow('cancelled');
    vi.mocked(axios.get).mockResolvedValueOnce({ data: 123 });
    expect(await sceneFetcher('start.txt')).toBe('123');
  });
});
