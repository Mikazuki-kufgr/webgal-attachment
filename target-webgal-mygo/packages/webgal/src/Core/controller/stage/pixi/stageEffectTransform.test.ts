import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { assignPixiTransform, applyTransformToPixiContainer } from './stageEffectTransform';

describe('5C attachment effect adapter keeps native alpha and Pixi vector identity', () => {
  it('keeps native filter alpha conversion unchanged', () => {
    const target = { alpha: 0.3, alphaFilterVal: 0.8 };
    assignPixiTransform(target, { alpha: 0.4 });
    expect(target).toEqual({ alpha: 1, alphaFilterVal: 0.4 });
  });
  it('normalizes only explicitly owned attachment local opacity', () => {
    const target = { alpha: 1, alphaFilterVal: 0.2, attachmentLocalAlpha: true };
    assignPixiTransform(target, { alpha: 0.4 });
    expect(target.alpha).toBe(0.4);
    expect(target.alphaFilterVal).toBe(1);
    assignPixiTransform(target, { alpha: 0 });
    expect(target.alpha).toBe(0);
    expect(target.alphaFilterVal).toBe(1);
  });
  it('preserves the original no-conversion option', () => {
    const target = { alpha: 1, alphaFilterVal: 0.8 };
    assignPixiTransform(target, { alpha: 0.4 }, false);
    expect(target.alpha).toBe(0.4);
    expect(target.alphaFilterVal).toBe(0.8);
  });
  it('keeps actual Pixi scale/position/skew objects and defined partial axes', () => {
    const target = new Container();
    target.position.set(2, 3);
    target.scale.set(4, 5);
    target.skew.set(0.1, 0.2);
    const vectors = [target.position, target.scale, target.skew];
    assignPixiTransform(
      target,
      { position: { x: 9 }, scale: { y: 8 }, skew: { x: 0.4, y: undefined } as never },
      false,
    );
    expect([target.position, target.scale, target.skew]).toEqual(vectors);
    expect(target.position).toBe(vectors[0]);
    expect(target.scale).toBe(vectors[1]);
    expect(target.skew).toBe(vectors[2]);
    expect([target.x, target.y, target.scale.x, target.scale.y, target.skew.x, target.skew.y]).toEqual([
      9, 3, 4, 8, 0.4, 0.2,
    ]);
  });
  it('applies position mapping and explicit zero skew without touching omitted alpha', () => {
    const target = Object.assign(new Container(), { attachmentLocalAlpha: true, alphaFilterVal: 1 });
    target.alpha = 0.35;
    target.skew.set(0.3, 0.5);
    applyTransformToPixiContainer(target as never, { position: { x: 42, y: 18 }, skew: { x: 0, y: 0 } });
    expect([target.x, target.y, target.skew.x, target.skew.y, target.alpha]).toEqual([42, 18, 0, 0, 0.35]);
  });
});
