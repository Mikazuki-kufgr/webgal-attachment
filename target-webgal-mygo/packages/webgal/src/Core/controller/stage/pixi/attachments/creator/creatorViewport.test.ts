import { describe, expect, it } from 'vitest';
import { creatorViewFit } from './creatorViewport';

describe('author-space rectangle in the Creator viewport', () => {
  it.each([0, Math.PI / 6, Math.PI / 2, -Math.PI / 3, Math.PI])('fits all rotated corners with padding at %s', angle => {
    const width = 1440, height = 1800, scale = creatorViewFit(width, height, 500, 800, angle);
    for (const x of [-width / 2, width / 2]) for (const y of [-height / 2, height / 2]) {
      const px = 250 + scale * (x * Math.cos(angle) - y * Math.sin(angle));
      const py = 400 + scale * (x * Math.sin(angle) + y * Math.cos(angle));
      expect(px).toBeGreaterThanOrEqual(24 - 1e-8); expect(px).toBeLessThanOrEqual(476 + 1e-8);
      expect(py).toBeGreaterThanOrEqual(24 - 1e-8); expect(py).toBeLessThanOrEqual(776 + 1e-8);
    }
  });
  it('does not make the camera singular when the window is temporarily tiny', () => {
    expect(creatorViewFit(1440, 1800, 0, 0)).toBeGreaterThan(0);
  });
});
