import { afterEach, expect, it, vi } from 'vitest';
import { createModelImportPanel } from './creatorModelImportPanel';

// DOM interaction harness only; does not establish browser or visual acceptance.
class Element {
  children: Element[] = [];
  style = {};
  dataset = {};
  value = '';
  textContent = '';
  disabled = false;
  files: File[] = [];
  onclick?: () => void;
  onchange?: () => void;
  constructor(public tag: string) {}
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren() { this.children = []; this.value = ''; }
  setAttribute() {}
  get options() { return this.children; }
  set selectedIndex(i: number) { this.value = this.children[i].value; }
}
afterEach(() => { vi.unstubAllGlobals(); });
it('keeps game-copy controls separate from import and reads the current game on each click', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  let target = '游戏甲';
  const copyCreatorModelToGame = vi.fn(async () => ({ ok: true, noOp: false }));
  const result = createModelImportPanel({
    client: { copyCreatorModelToGame } as never, signal: new AbortController().signal,
    context: () => ({ importedModels: [{ id:'model',modelPath:'game/figure/test/model.json' }] }) as never,
    selectedTarget: () => ({ name:target,writable:true }),
    selectedProfile: () => ({ modelPath:'game/figure/test/model.json' }) as never,
    copyableProfiles: () => [],
    imported: async () => {}, copied: async () => {},
  });
  const descendants = (node: Element): Element[] => node.children.flatMap(child => [child, ...descendants(child)]);
  expect(descendants(result.element as unknown as Element).some(e => e.textContent.includes('复制到这个游戏'))).toBe(false);
  const copy = result.gameCopyButton as unknown as Element;
  copy.onclick!(); await settle(() => copyCreatorModelToGame.mock.calls.length === 1 && !copy.disabled);
  expect(result.gameCopyStatusElement.textContent).toContain('人物已复制到“游戏甲”');
  target = '游戏乙';
  copyCreatorModelToGame.mockResolvedValue({ ok: true, noOp: true });
  copy.onclick!(); await settle(() => copyCreatorModelToGame.mock.calls.length === 2 && !copy.disabled);
  expect(copyCreatorModelToGame.mock.calls.map(args => args.slice(0,2))).toEqual([['model','游戏甲'],['model','游戏乙']]);
  expect(result.gameCopyStatusElement.textContent).toContain('游戏已具备相同人物文件，无需重复复制');
});
it('copies the selected built-in profile through the ordinary game-copy button', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const copyCreatorModelToGame = vi.fn(async () => ({ ok: true, noOp: false }));
  const result = createModelImportPanel({
    client: { copyCreatorModelToGame } as never, signal: new AbortController().signal,
    context: () => ({ importedModels: [] }) as never,
    selectedTarget: () => ({ name: '空游戏', writable: true }),
    selectedProfile: () => ({ modelProfileId: 'anon-school_winter-2023-semantic-v1', modelPath: './game/figure/anon/school_winter-2023/model.json' }) as never,
    copyableProfiles: () => [{ modelProfileId: 'anon-school_winter-2023-semantic-v1', modelPath: './game/figure/anon/school_winter-2023/model.json' } as never],
    imported: async () => {}, copied: async () => {},
  });
  (result.gameCopyButton as unknown as Element).onclick!();
  await settle(() => copyCreatorModelToGame.mock.calls.length === 1 && !(result.gameCopyButton as unknown as Element).disabled);
  expect(copyCreatorModelToGame.mock.calls[0].slice(0, 2)).toEqual(['profile:anon-school_winter-2023-semantic-v1', '空游戏']);
  expect(result.gameCopyStatusElement.textContent).toContain('game/figure/anon/school_winter-2023/model.json');
});
it('copies a saved custom attachment Profile through the matching library figure source', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const copyCreatorModelToGame = vi.fn(async () => ({ ok: true, noOp: false }));
  const result = createModelImportPanel({
    client: { copyCreatorModelToGame } as never, signal: new AbortController().signal,
    context: () => ({ importedModels: [] }) as never,
    selectedTarget: () => ({ name: '新的空游戏', writable: true }),
    selectedProfile: () => ({ modelProfileId: 'user-profile-hand', modelPath: './game/figure/anon/school_winter-2023/model.json' }) as never,
    copyableProfiles: () => [{ modelProfileId: 'anon-school_winter-2023-semantic-v1', modelPath: 'game/figure/anon/school_winter-2023/model.json' } as never],
    imported: async () => {}, copied: async () => {},
  });
  (result.gameCopyButton as unknown as Element).onclick!();
  await settle(() => copyCreatorModelToGame.mock.calls.length === 1 && !(result.gameCopyButton as unknown as Element).disabled);
  expect(copyCreatorModelToGame.mock.calls[0].slice(0, 2)).toEqual(['profile:anon-school_winter-2023-semantic-v1', '新的空游戏']);
});
it('keeps the game untouched when a custom Profile has no known figure source', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const copyCreatorModelToGame = vi.fn();
  const result = createModelImportPanel({
    client: { copyCreatorModelToGame } as never, signal: new AbortController().signal,
    context: () => ({ importedModels: [] }) as never,
    selectedTarget: () => ({ name: '空游戏', writable: true }),
    selectedProfile: () => ({ modelProfileId: 'user-profile-hand', modelPath: './game/figure/custom/model.json' }) as never,
    copyableProfiles: () => [{ modelProfileId: 'unrelated', modelPath: './game/figure/anon/model.json' } as never],
    imported: async () => {}, copied: async () => {},
  });
  (result.gameCopyButton as unknown as Element).onclick!();
  await settle(() => !(result.gameCopyButton as unknown as Element).disabled);
  expect(copyCreatorModelToGame).not.toHaveBeenCalled();
  expect(result.gameCopyStatusElement.textContent).toContain('没有可复制的模型来源');
});
it('reports committed model files separately from a failed game-status refresh', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const copyCreatorModelToGame = vi.fn(async () => ({ ok: true, noOp: false }));
  const notify = vi.fn();
  const result = createModelImportPanel({
    client: { copyCreatorModelToGame } as never, signal: new AbortController().signal,
    context: () => ({ importedModels: [] }) as never,
    selectedTarget: () => ({ name: '空游戏', writable: true }),
    selectedProfile: () => ({ modelProfileId: 'anon-school_winter-2023-semantic-v1', modelPath: './game/figure/anon/school_winter-2023/model.json' }) as never,
    copyableProfiles: () => [{ modelProfileId: 'anon-school_winter-2023-semantic-v1', modelPath: './game/figure/anon/school_winter-2023/model.json' } as never],
    imported: async () => {}, copied: async () => { throw new Error('refresh failed'); }, notify,
  });
  (result.gameCopyButton as unknown as Element).onclick!();
  await settle(() => notify.mock.calls.length === 1);
  expect(copyCreatorModelToGame).toHaveBeenCalledOnce();
  expect(result.gameCopyStatusElement.textContent).toContain('人物文件已在“空游戏”写入或核对相同');
  expect(result.gameCopyStatusElement.textContent).toContain('游戏状态刷新未完成');
  expect(notify.mock.calls[0][1]).toBe('warning');
});
it('announces a persisted model without anchors as a warning with an actionable next step', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const notify = vi.fn();
  const result = createModelImportPanel({
    client: { importCreatorModel: async () => ({ model: { dependencyCount: 3, profileIds: [], modelPath: 'new/model.json' }, profiles: [] }) } as never,
    signal: new AbortController().signal, context: () => undefined,
    selectedTarget: () => undefined, selectedProfile: () => undefined,
    copyableProfiles: () => [],
    imported: async () => {}, copied: async () => {}, notify,
  });
  const descendants = (node: Element): Element[] => node.children.flatMap(child => [child, ...descendants(child)]);
  const controls = descendants(result.element as unknown as Element);
  const picker = controls.find(e => e.tag === 'input')!;
  const entry = controls.find(e => e.tag === 'select')!;
  const upload = controls.find(e => e.textContent === '检查并复制到制作区')!;
  picker.files = [['model.json', JSON.stringify({ model: 'model.moc', textures: ['texture.png'] })], ['model.moc', 'moc'], ['texture.png', 'png']].map(([name, text]) => {
    const file = new File([text], name); Object.defineProperty(file, 'webkitRelativePath', { value: '角色/' + name }); return file;
  });
  picker.onchange!(); await settle(() => entry.options.length === 2 && !entry.disabled);
  entry.onchange!(); upload.onclick!(); await settle(() => notify.mock.calls.length > 0);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][1]).toBe('warning');
  expect(notify.mock.calls[0][0]).toContain('暂时不能制作随动附件');
  expect(notify.mock.calls[0][0]).toContain('目标立绘');
  expect(notify.mock.calls[0][0]).toContain('无需重新导入');
});
async function settle(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(check()).toBe(true);
}
it('blocks accidental re-import after persistence even if refreshing the list fails; another outfit remains available', async () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  const importCreatorModel = vi.fn(async () => ({ model: { dependencyCount: 3, profileIds: ['p'], modelPath: 'new/model.json' }, profiles: [] }));
  const imported = vi.fn(async () => { throw new Error('context refresh failed'); });
  const panel = createModelImportPanel({
    client: { importCreatorModel } as never, signal: new AbortController().signal,
    context: () => undefined, selectedTarget: () => undefined, selectedProfile: () => undefined,
    copyableProfiles: () => [],
    imported, copied: async () => {},
  }).element as unknown as Element;
  const descendants = (node: Element): Element[] => node.children.flatMap(child => [child, ...descendants(child)]);
  const picker = descendants(panel).find(e => e.tag === 'input')!;
  const entry = descendants(panel).find(e => e.tag === 'select')!;
  const upload = descendants(panel).find(e => e.textContent === '检查并复制到制作区')!;
  function file(p: string, text: string) {
    const f = new File([text], p.split('/').at(-1)!);
    Object.defineProperty(f, 'webkitRelativePath', { value: '角色/' + p });
    return f;
  }
  picker.files = ['winter', 'summer'].flatMap(outfit => [
    file(`${outfit}/model.json`, JSON.stringify({ model: 'model.moc', textures: ['texture.png'] })),
    file(`${outfit}/model.moc`, 'moc'), file(`${outfit}/texture.png`, 'png'),
  ]);
  picker.onchange!();
  await settle(() => entry.options.length === 3 && !entry.disabled);
  entry.value = 'winter/model.json'; entry.onchange!();
  expect(upload.disabled).toBe(false);
  upload.onclick!();
  await settle(() => imported.mock.calls.length === 1 && !entry.disabled);
  expect(upload.disabled).toBe(true);
  entry.value = 'summer/model.json'; entry.onchange!();
  expect(upload.disabled).toBe(false);
  entry.value = 'winter/model.json'; entry.onchange!();
  expect(upload.disabled).toBe(true);
  expect(importCreatorModel).toHaveBeenCalledOnce();
});



