import { afterEach, expect, it, vi } from 'vitest';
vi.mock('pixi.js', () => ({ Point: class { constructor(public x: number, public y: number) {} } }));
vi.mock('./creatorCatalog', () => ({ loadCreatorMotionInventory: vi.fn(async () => ['idle']) }));
import { installLoadedModelEvidence } from './loadedModelEvidence';
import { createHash } from 'node:crypto';
import { createAnchorAuthoringPanel } from './anchorAuthoringPanel';

// Deterministic DOM interaction harness. NOT browser/Live2D/GPU or visual acceptance.
class Element {
  children: Element[] = []; style: Record<string, unknown> = {}; dataset = {}; value = ''; textContent = ''; disabled = false; open = false;
  files: File[] = []; onclick?: () => void; onchange?: () => void; oninput?: () => void; ontoggle?: () => void;
  constructor(public tag: string) {}
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; this.value = items[0]?.value ?? ''; }
  context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillText: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  setAttribute() {} remove() {} getContext() { return this.context; } get options() { return this.children; }
  querySelectorAll(): Element[] { return this.children.flatMap(c => [...(['input', 'select', 'button'].includes(c.tag) ? [c] : []), ...c.querySelectorAll()]); }
}
const descendants = (e: Element): Element[] => e.children.flatMap(c => [c, ...descendants(c)]);
afterEach(() => { vi.unstubAllGlobals(); });
async function settle(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise(r => setTimeout(r, 1));
  expect(check()).toBe(true);
}
function harness() {
  const window = { confirm: vi.fn(() => true), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('window', window); vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag), body: new Element('body') });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const frames: (() => void)[] = []; vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { frames.push(fn); return frames.length; });
  const audit = vi.fn();
  const controller = new AbortController();
  let active: any = { key: 'figure', uuid: 'g1', normalizedSourceUrl: 'game/figure/a/model.json', model: { destroyed: false, autoUpdate: true,
    toGlobal: vi.fn((p: { x: number; y: number }) => ({ x: p.x * 2 + 10, y: p.y * 3 + 20 })),
    internalModel: { localTransform: { apply: (p: { x: number; y: number }) => ({ x: p.x + 1, y: p.y + 2 }) }, getDrawableIDs: () => ['D1'], getDrawableIndex: () => 0, getDrawableVertices: () => new Float32Array([0, 0, 4, 0, 0, 4]) } } };
  const mocHash = createHash('sha256').update('').digest('hex').toUpperCase(), loader: any = { middlewares: [] };
  installLoadedModelEvidence(loader);
  const evidenceReady = loader.middlewares[0]({ target: active.model, type: 'arraybuffer', url: 'm.moc', settings: { moc: 'm.moc' }, result: new ArrayBuffer(0) }, async () => {});
  const existing = { schema: 'webgal-live2d-model-profile', schemaVersion: 1, profileVersion: 1,
    modelProfileId: 'user-profile-11111111-1111-1111-1111-111111111111', characterId: 'a', modelId: 'hair', modelPath: active.normalizedSourceUrl,
    fingerprint: { modelJsonSha256: 'A'.repeat(64), mocSha256: mocHash, drawableCount: 1 },
    anchors: [{ name: 'user.a-hair', displayName: '马尾', anchorProfileId: 'hair-anchor', drawableId: 'D1', vertexCount: 3,
      points: [{ index: 0, weight: 1, neutral: { x: 0, y: 0 } }, { index: 1, weight: 1, neutral: { x: 4, y: 0 } }, { index: 2, weight: 1, neutral: { x: 0, y: 4 } }] }] };
  const saveAnchorProfile = vi.fn(async (profile: any, expected: string) => ({ ok: true, profile, sha256: expected + '-next' }));
  let render: () => void = () => {};
  const renderer = { on: (_: string, fn: () => void) => { render = fn; }, off: () => {}, view: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) }, screen: { width: 100, height: 100 } };
  const panelApi = createAnchorAuthoringPanel({ signal: controller.signal, active: () => active, renderer: () => renderer as never,
    profiles: () => [existing] as never, context: () => undefined, loadModel: async () => {}, playMotion: async () => {}, apply: async () => {}, saved: async () => {}, audit,
    client: { readMeshLabels: async()=>({document:null,sha256:null}), readAnchorProfile: async () => ({ profile: existing, sha256: 'HASH' }), readAnchorModel: async () => ({ modelPath: active.normalizedSourceUrl, modelJsonSha256: 'A'.repeat(64), mocSha256: mocHash }), saveAnchorProfile } as never });
  panelApi.refresh();
  const panel = panelApi.panel as unknown as Element;
  const find = (text: string) => descendants(panel).find(c => c.textContent === text)!;
  const existingSelect = descendants(panel).find(c => c.tag === 'select' && c.options.some(o => o.value === existing.modelProfileId))!; existingSelect.value = existing.modelProfileId;
  const status = descendants(panel).filter(c => c.tag === 'pre').at(-1)!;
  async function open() {
    await evidenceReady;
    find('打开已有锚点组').onclick!(); await settle(() => status.textContent.includes('已打开')).catch(e => { throw new Error(status.textContent, { cause: e }); });
    const anchorSelect = descendants(panel).filter(c => c.tag === 'select')[2]; anchorSelect.value = 'user.a-hair';
    find('编辑选中锚点').onclick!(); await settle(() => status.textContent.includes('原参考点'));
  }
  return { active: () => active, replace: () => { active = { ...active, uuid: 'g2' }; }, panelApi, panel, find, status, open, controller, saveAnchorProfile, frame: () => render(), audit };
}
it('draws model vertices without attachment planes and does not cancel picking on each frame', async () => {
  const h = harness(); await h.open(); h.panel.open = true; h.panel.ontoggle!();
  const overlay = (document.body as unknown as Element).children[0];
  expect(overlay.context.arc).toHaveBeenCalledWith(24, 26, 5, 0, Math.PI * 2);
  h.find('暂停并选点 / 重设参考姿态').onclick!(); await settle(() => !h.active().model.autoUpdate);
  h.frame(); expect(h.active().model.autoUpdate).toBe(false); expect(h.audit).not.toHaveBeenCalled();
  h.find('继续动作，停止选点').onclick!(); expect(h.active().model.autoUpdate).toBe(true); h.controller.abort();
});
it('reports a persistent drawing error once, not every animation frame', async () => {
  const h = harness(); await h.open(); h.active().model.toGlobal.mockImplementation(() => { throw new Error('draw failed'); });
  h.panel.open = true; h.panel.ontoggle!(); h.frame(); h.frame();
  expect(h.audit).toHaveBeenCalledTimes(1); h.controller.abort();
});
it('reopen, rename, confirm and save preserves stable IDs and expected revision', async () => {
  const h = harness(); await h.open();
  const input = descendants(h.panel).find(c => c.tag === 'label' && c.textContent.startsWith('锚点显示'))!.children[0];
  input.value = '眼镜桥'; input.oninput!(); h.find('确认这个锚点到草稿').onclick!(); await settle(() => h.status.textContent.includes('尚未写入'));
  h.find('保存锚点组到本地资料库').onclick!(); await settle(() => h.status.textContent.includes('已保存到本地'));
  expect(h.saveAnchorProfile).toHaveBeenCalledOnce(); const [p, expected] = h.saveAnchorProfile.mock.calls[0];
  expect(p.anchors[0].name).toBe('user.a-hair'); expect(p.anchors[0].displayName).toBe('眼镜桥'); expect(expected).toBe('HASH'); h.controller.abort();
});
it('pause is owned by this tool and restored on abort; a new generation blocks saves', async () => {
  const h = harness(); await h.open(); h.find('暂停并选点 / 重设参考姿态').onclick!();
  await settle(() => !h.active().model.autoUpdate); h.replace(); h.find('保存锚点组到本地资料库').onclick!();
  await settle(() => h.status.textContent.includes('立绘已经切换')); expect(h.saveAnchorProfile).not.toHaveBeenCalled();
  h.controller.abort(); expect(h.active().model.autoUpdate).toBe(true);
});
it('unconfirmed edits block save instead of silently saving an old anchor', async () => {
  const h = harness(); await h.open(); h.find('暂停并选点 / 重设参考姿态').onclick!(); await settle(() => !h.active().model.autoUpdate);
  h.find('保存锚点组到本地资料库').onclick!(); await settle(() => h.status.textContent.includes('还未确认'));
  expect(h.saveAnchorProfile).not.toHaveBeenCalled(); h.controller.abort();
});

it('cancel switch and exit preserves unconfirmed edits; restored generation keeps original neutral points', async () => {
  const h = harness(); await h.open();
  const input = descendants(h.panel).find(c => c.tag === 'label' && c.textContent.startsWith('锚点显示'))!.children[0];
  input.value = '保留草稿'; input.oninput!();
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(h.panelApi.requestModelChange('game/figure/other/model.json')).toBe(false);
  expect(await h.panelApi.requestExit()).toBe(false); expect(input.value).toBe('保留草稿');
  h.replace(); h.find('恢复保留草稿到当前同模型').onclick!(); await settle(() => h.status.textContent.includes('已核验并恢复'));
  expect(input.value).toBe('保留草稿');
  h.find('确认这个锚点到草稿').onclick!(); await settle(() => h.status.textContent.includes('尚未写入'));
  h.find('保存锚点组到本地资料库').onclick!(); await settle(() => h.status.textContent.includes('已保存到本地'));
  expect(h.saveAnchorProfile.mock.calls[0][0].anchors[0].points[1].neutral).toEqual({x:4,y:0});h.controller.abort();
});

it('save-before-exit refuses unconfirmed edits and then persists the confirmed draft', async () => {
  const h = harness(); await h.open();
  const input = descendants(h.panel).find(c => c.tag === 'label' && c.textContent.startsWith('锚点显示'))!.children[0];
  input.value = '退出前保存'; input.oninput!();
  expect(await h.panelApi.requestExit()).toBe(false);expect(h.saveAnchorProfile).not.toHaveBeenCalled();
  h.find('确认这个锚点到草稿').onclick!(); await settle(() => h.status.textContent.includes('尚未写入'));
  expect(await h.panelApi.requestExit()).toBe(true);expect(h.saveAnchorProfile).toHaveBeenCalledOnce();h.controller.abort();
});
