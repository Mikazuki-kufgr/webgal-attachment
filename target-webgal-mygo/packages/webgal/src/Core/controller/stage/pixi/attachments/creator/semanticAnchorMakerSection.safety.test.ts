import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_SEMANTIC_SANDBOX_STATUS } from './semanticAnchorMakerSection';

describe('5H historical developer sandbox exclusion', () => {
  it('explicitly labels the sandbox unavailable, not an implemented runtime family', () => {
    expect(LEGACY_SEMANTIC_SANDBOX_STATUS).toBe('CREATOR_LEGACY_SEMANTIC_SANDBOX_NOT_MIGRATED');
  });
  it('has no runtime imports or mutation calls and only disposes its own notice', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/Core/controller/stage/pixi/attachments/creator/semanticAnchorMakerSection.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/import\s*\(/);
    expect(source).not.toMatch(
      /\.reset\(|\.dispatch\(|loadGameFromStageData|runScript\(|removeStageObject|addFigure\(/,
    );
    expect(source).toContain('if (!import.meta.env.DEV) return () => undefined');
    expect(source).toContain('return () => notice.remove()');
  });
});
