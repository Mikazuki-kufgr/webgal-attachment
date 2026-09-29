import type { Live2DLoader, Live2DLoaderContext } from 'pixi-live2d-display-webgal';

const loadedMoc = new WeakMap<object, string>();
const installed = new WeakSet<object>();
/** Hash the very buffer returned to createCoreModel, before the SDK consumes it. */
export function installLoadedModelEvidence(loader: typeof Live2DLoader) {
  if (installed.has(loader)) return;
  installed.add(loader);
  loader.middlewares.unshift(async (context: Live2DLoaderContext, next: () => Promise<void>) => {
    await next();
    if (context.target && context.type === 'arraybuffer' && context.settings?.moc === context.url && context.result instanceof ArrayBuffer) {
      const digest = await crypto.subtle.digest('SHA-256', context.result);
      loadedMoc.set(context.target, Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').toUpperCase());
    }
  });
}
export function requireLoadedMoc(model: object, expected: string) {
  const actual = loadedMoc.get(model);
  if (!actual) throw new Error('CREATOR_ANCHOR_LOADED_EVIDENCE_MISSING：请用本版入口重新载入立绘后再打开草稿。');
  if (actual !== expected.toUpperCase()) throw new Error('CREATOR_ANCHOR_MODEL_CHANGED：内存立绘与磁盘模型不同，请保留草稿并重新载入核验。');
}
