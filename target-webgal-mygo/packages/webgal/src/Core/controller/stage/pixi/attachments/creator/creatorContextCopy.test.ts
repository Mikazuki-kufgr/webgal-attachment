import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Creator context loading copy', () => {
  it('describes the full context work instead of only a save-path read', () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/Core/controller/stage/pixi/attachments/creator/AttachmentCreatorWorkbench.ts',
      ),
      'utf8',
    );
    expect(source).toContain('正在读取项目、附件与人物资料…');
    expect(source).toContain('暂时无法读取项目、附件与人物资料。');
    expect(source).not.toContain('正在读取保存位置…');
  });
});
