import { expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installLoadedModelEvidence, requireLoadedMoc } from './loadedModelEvidence';

it('binds the exact core-model buffer to its model object; disk replacements and other models cannot borrow evidence', async () => {
  const loader: any = { middlewares: [] }, model = {}, other = {};
  installLoadedModelEvidence(loader); installLoadedModelEvidence(loader);
  expect(loader.middlewares).toHaveLength(1);
  const bytes = new TextEncoder().encode('moc M1').buffer;
  const expected = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const context: any = { target: model, type: 'arraybuffer', settings: { moc: 'model.moc' }, url: 'model.moc' };
  await loader.middlewares[0](context, async () => { context.result = bytes; });
  expect(() => requireLoadedMoc(model, expected)).not.toThrow();
  expect(() => requireLoadedMoc(model, 'A'.repeat(64))).toThrow('MODEL_CHANGED');
  expect(() => requireLoadedMoc(other, expected)).toThrow('EVIDENCE_MISSING');
});

it('ignores motion/optional data and does not substitute a second disk read for loaded bytes', async () => {
  const loader: any = { middlewares: [] }, target = {};
  installLoadedModelEvidence(loader);
  await loader.middlewares[0]({ target, type: 'arraybuffer', settings: { moc: 'model.moc' }, url: 'motion.mtn', result: new ArrayBuffer(5) }, async () => {});
  expect(() => requireLoadedMoc(target, 'A'.repeat(64))).toThrow('EVIDENCE_MISSING');
});
