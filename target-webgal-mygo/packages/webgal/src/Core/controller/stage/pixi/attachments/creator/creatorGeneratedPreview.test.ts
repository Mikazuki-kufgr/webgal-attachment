import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { creatorPreviewSceneName, startCreatorGeneratedScene } from './creatorGeneratedPreview';
import { Live2DCore } from '@/Core/live2DCore';
vi.mock('pixi-live2d-display-webgal', () => ({ Live2DModel: {}, SoundManager: {}, config: {}, Live2DLoader: { middlewares: [] } }));
afterEach(() => { vi.unstubAllGlobals(); });
const scene = 'ATTACHMENT-CREATOR-PREVIEW-flower-123.txt';
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
function inlineHtml() {
  const script = read('creator.html').match(/<script>([\s\S]*?)<\/script>/)![1];
  const scripts: Array<{ src: string; onload: () => void; onerror: () => void }> = [];
  const timers = new Map<number, () => void>();
  let sequence = 0;
  const window: Record<string, any> = {};
  const errors = vi.fn();
  vm.runInNewContext(script, {
    window,
    navigator: { userAgent: 'Windows', platform: 'Win32', maxTouchPoints: 0 },
    document: { createElement: () => ({ remove() {} }), head: { appendChild: (value: any) => scripts.push(value) } },
    console: { error: errors },
    setTimeout: (fn: () => void) => {
      timers.set(++sequence, fn);
      return sequence;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return { scripts, timers, window, errors };
}
describe('5H dedicated actual application entry', () => {
  it('preserves actual application roots and no landing input or cache workers', () => {
    const html = read('creator.html');
    for (const id of ['root', 'ebg', 'ebgOverlay', 'html-body__panic-overlay']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('src="/src/main.tsx"');
    for (const forbidden of [
      'PRESS THE SCREEN',
      'MouseEvent',
      'dispatchEvent',
      'startGame(',
      'start.txt',
      'serviceWorker',
      'sessionStorage',
      'localStorage',
      'caches.',
      'enterPromise',
      'rel="manifest"',
    ])
      expect(html, forbidden).not.toContain(forbidden);
  });
  it('executes only local SDK2/4 loads and passive render gate, clearing timers on success', async () => {
    const f = inlineHtml();
    expect(f.scripts.map((item) => item.src)).toEqual(['lib/live2d.min.js', 'lib/live2dcubismcore.min.js']);
    f.scripts.forEach((item) => item.onload());
    expect(await f.window.live2dPromise).toEqual([true, true]);
    expect(f.timers.size).toBe(0);
    expect(f.window.__WEBGAL_DEVICE_INFO__.isIOS).toBe(false);
    f.window.renderPromiseResolve();
    await f.window.renderPromise;
    expect(f.window.renderPromiseResolve).toBeUndefined();
  });
  it('SDK timeout fails closed without timer residue', async () => {
    const f = inlineHtml();
    [...f.timers.values()].forEach((fn) => fn());
    expect(await f.window.live2dPromise).toEqual([false, false]);
    expect(f.timers.size).toBe(0);
    expect(f.errors).toHaveBeenCalledTimes(2);
  });
  it('App gates save/menu/title component mounts and read history persistence for both isolated modes', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('__WEBGAL_CREATOR_PREVIEW__');
    expect(app).toContain('!isolatedCreatorRuntime');
    expect(app).toContain('<Stage />');
    expect(app.indexOf('<Menu />')).toBeGreaterThan(app.indexOf('<Stage />'));
    const history = read('src/Core/Modules/readHistory.ts');
    expect(history).toContain('__WEBGAL_CREATOR_PREVIEW__');
    expect(history).toContain('setStorage()');
  });
  it('actual Live2DCore waits through SDK module import before reporting ready', async () => {
    let resolve!: (value: [boolean, boolean]) => void;
    vi.stubGlobal('window', {
      live2dPromise: new Promise((r) => {
        resolve = r;
      }),
    });
    const core = new Live2DCore();
    expect(core.isAvailable).toBe(false);
    const pending = core.waitUntilReady();
    resolve([true, true]);
    expect(await pending).toBe(true);
    expect(core.isAvailable).toBe(true);
  });
  it('actual Live2DCore refuses missing SDK', async () => {
    vi.stubGlobal('window', { live2dPromise: Promise.resolve([true, false]) });
    const core = new Live2DCore();
    expect(await core.waitUntilReady()).toBe(false);
    expect(core.isAvailable).toBe(false);
  });
});
describe('5H exact independent scene entry', () => {
  it('accepts one canonical generated scene name', () =>
    expect(creatorPreviewSceneName('?scene=' + scene)).toBe(scene));
  it.each([
    '',
    '?scene=start.txt',
    '?scene=../' + scene,
    '?scene=' + scene + '&scene=' + scene,
    '?scene=ATTACHMENT-CREATOR-CURRENT-PREVIEW.txt',
    '?scene=ATTACHMENT-CREATOR-PREVIEW-a..b.txt',
    '?scene=ATTACHMENT-CREATOR-PREVIEW-a%2fb.txt',
    '?scene=ATTACHMENT-CREATOR-PREVIEW-a%252fb.txt',
    '?scene=ATTACHMENT-CREATOR-PREVIEW-a%0a.txt',
    '?scene=ATTACHMENT-CREATOR-PREVIEW-中文.txt',
  ])('rejects unsafe/missing/ambiguous scene %s', (search) =>
    expect(() => creatorPreviewSceneName(search)).toThrow('SCENE_INVALID'),
  );
  it('waits for SDK then invokes the real changeScene port with only the exact generated URL', async () => {
    const calls: unknown[] = [];
    let resolve!: (value: boolean) => void;
    const waiting = new Promise<boolean>((r) => {
      resolve = r;
    });
    const operation = startCreatorGeneratedScene(scene, {
      waitUntilLive2DReady: () => waiting,
      enterGame: () => calls.push('enter'),
      changeScene: async (url, name) => {
        calls.push([url, name]);
        return true;
      },
    });
    await Promise.resolve();
    expect(calls).toEqual([]);
    resolve(true);
    expect(await operation).toBe(scene);
    expect(calls).toEqual(['enter', ['./game/scene/' + scene, scene]]);
  });
  it('missing SDK cannot enter or call any scene', async () => {
    const enterGame = vi.fn();
    const changeScene = vi.fn();
    await expect(
      startCreatorGeneratedScene(scene, { waitUntilLive2DReady: async () => false, enterGame, changeScene }),
    ).rejects.toThrow('LIVE2D_NOT_READY');
    expect(enterGame).not.toHaveBeenCalled();
    expect(changeScene).not.toHaveBeenCalled();
  });
  it('real scene mutation failure is explicit', async () => {
    await expect(
      startCreatorGeneratedScene(scene, {
        waitUntilLive2DReady: async () => true,
        enterGame() {},
        changeScene: async () => false,
      }),
    ).rejects.toThrow('SCENE_LOAD_FAILED');
  });
  it('source entry invokes the real migrated changeScene instead of user startGame', () => {
    const source = read('src/Core/initializeScript.ts');
    expect(source).toContain("import { changeScene } from '@/Core/controller/scene/changeScene'");
    const branch = source.slice(
      source.indexOf('if (previewBundle) {'),
      source.indexOf('const { installAttachmentCreatorWorkbench }'),
    );
    expect(branch).toContain('startCreatorGeneratedScene(generatedScene');
    expect(branch).toContain('changeScene,');
    expect(branch).toContain('return;');
    expect(branch).not.toContain('startGame(');
    expect(branch).not.toContain('installAttachmentCreatorWorkbench(');
  });
});
