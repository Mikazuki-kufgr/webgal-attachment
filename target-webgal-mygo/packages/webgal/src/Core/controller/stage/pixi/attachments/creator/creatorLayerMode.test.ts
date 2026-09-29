import fs from 'node:fs';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import { changeCreatorLayerMode } from './creatorLayerMode';
import { createBlankCreatorDraft, cloneCreatorDraft } from './creatorDraft';
import type { CreatorBinaryInput } from './creatorTypes';
const image: CreatorBinaryInput = {
  bytes: new Uint8Array([1, 2, 3]),
  metadata: {
    sourceFileName: 'rose.png',
    outputFileName: 'front.png',
    mime: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
    sha256: 'A'.repeat(64),
  },
};
function fixture() {
  const draft = createBlankCreatorDraft(123);
  draft.layers.front = image.metadata;
  draft.placement.offset.x = 15;
  draft.anchorName = 'mouth';
  return draft;
}
describe('layer material ownership', () => {
  it('front to back to front preserves content, identity and placement', () => {
    const original = fixture(),
      back = changeCreatorLayerMode(original, { front: image }, 'back-only');
    expect(back.binaries).toEqual({ back: image });
    expect(back.draft.layers).toEqual({ back: image.metadata });
    expect(back.draft.placement).toEqual(original.placement);
    expect(back.draft.presetId).toBe(original.presetId);
    expect(back.draft.anchorName).toBe('mouth');
    expect(changeCreatorLayerMode(back.draft, back.binaries, 'front-only').draft).toEqual(original);
    expect(back.binaries.back?.bytes).toBe(image.bytes);
  });
  it('two images are never overwritten and both can be restored', () => {
    const other = { ...image, bytes: new Uint8Array([4]) };
    const draft = fixture();
    draft.layerMode = 'both';
    draft.layers.back = other.metadata;
    const single = changeCreatorLayerMode(draft, { front: image, back: other }, 'back-only');
    expect(single.binaries.front).toBe(image);
    expect(single.binaries.back).toBe(other);
    expect(changeCreatorLayerMode(single.draft, single.binaries, 'both').draft).toEqual(draft);
  });
  it('empty and incomplete drafts never invent images', () => {
    expect(changeCreatorLayerMode(createBlankCreatorDraft(123), {}, 'back-only').binaries).toEqual({});
    const both = changeCreatorLayerMode(fixture(), { front: image }, 'both');
    expect(both.binaries).toEqual({ front: image });
    expect(changeCreatorLayerMode(both.draft, both.binaries, 'back-only').binaries).toEqual({ back: image });
  });
});
function environment(fail = false) {
  let callback: () => void = () => {};
  const statuses: string[] = [];
  const env: any = {
    draft: fixture(),
    binaries: { front: image },
    completionNotice: undefined,
    changeCreatorLayerMode,
    cloneCreatorDraft,
    beginPreviewFlow: () => 1,
    isPreviewFlowCurrent: () => true,
    layerMode: { select: { value: 'back-only', addEventListener: (_type: string, fn: () => void) => (callback = fn) } },
    readDraftInputs: () => {
      env.draft.layerMode = env.layerMode.select.value;
    },
    writeDraftInputs: () => {
      env.layerMode.select.value = env.draft.layerMode;
    },
    withBusyButton: (_c: any, _s: string, operation: () => Promise<void>) => (env.pending = operation()),
    waitForPreviewPaint: async () => {},
    renderLayerFacts: () => {},
    renderPreviewFacts: () => {},
    setStatus: (s: string) => statuses.push(s),
    errorMessage: (e: Error) => e.message,
    preview: {
      binding: () => true,
      setVisible: () => {},
      replaceTextures: vi.fn(async () => true),
      applyPlacement: vi.fn(),
      commitVisible: vi.fn().mockResolvedValueOnce(!fail).mockResolvedValue(true),
    },
  };
  const source = fs.readFileSync(new URL('./AttachmentCreatorWorkbench.ts', import.meta.url), 'utf8');
  const begin = source.indexOf("  layerMode.select.addEventListener('change',"),
    end = source.indexOf('  figureField.select.onchange', begin);
  const code = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('env', 'with(env){' + code + '}')(env);
  return {
    env,
    statuses,
    run: () => {
      callback();
      return env.pending;
    },
  };
}
describe('shipped workbench event', () => {
  it('moves bytes before visibility and defers success until busy release', async () => {
    const f = environment();
    await f.run();
    expect(f.env.preview.replaceTextures.mock.calls[0][0]).toEqual({ back: image, layerMode: 'back-only' });
    expect(f.statuses).toEqual([]);
    f.env.completionNotice();
    expect(f.statuses[0]).toContain('人物后面');
  });
  it('visibility failure restores dropdown, content and preview without success', async () => {
    const f = environment(true);
    await f.run();
    expect(f.env.draft).toEqual(fixture());
    expect(f.env.binaries).toEqual({ front: image });
    expect(f.env.layerMode.select.value).toBe('front-only');
    expect(f.env.preview.replaceTextures).toHaveBeenCalledTimes(2);
    expect(f.env.completionNotice).toBeUndefined();
    expect(f.statuses[0]).toContain('已恢复原预览');
  });
});
