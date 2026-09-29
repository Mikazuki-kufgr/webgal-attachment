import { describe, expect, it } from 'vitest';

import { creatorErrorMessage } from './creatorErrorMessage';
import { CreatorProjectRequestError } from './creatorProject';

describe('creator error message', () => {
  it('keeps the service suggestion in ordinary workbench and CMD text', () => {
    const error = new CreatorProjectRequestError({
      code: 'CREATOR_TARGET_MODEL_MISSING',
      message: '目标游戏缺少人物模型文件：game/figure/anon/model.json',
      targetPath: 'game/figure/anon/model.json',
      suggestion: '请先把这套人物模型完整放入目标游戏的 game/figure，再重新保存；制作器不会静默复制人物模型。',
    });

    expect(creatorErrorMessage(error)).toBe(
      'CreatorProjectRequestError: CREATOR_TARGET_MODEL_MISSING: ' +
        '目标游戏缺少人物模型文件：game/figure/anon/model.json\n' +
        '建议操作：请先把这套人物模型完整放入目标游戏的 game/figure，再重新保存；' +
        '制作器不会静默复制人物模型。',
    );
  });

  it('does not duplicate details already present in the message', () => {
    const error = new CreatorProjectRequestError({
      code: 'EXAMPLE',
      message: '目标 x；底层 y；建议 z',
      targetPath: 'x',
      cause: 'y',
      suggestion: 'z',
    });
    expect(creatorErrorMessage(error)).toBe('CreatorProjectRequestError: EXAMPLE: 目标 x；底层 y；建议 z');
  });

  it('preserves ordinary errors and non-error values', () => {
    expect(creatorErrorMessage(new TypeError('bad'))).toBe('TypeError: bad');
    expect(creatorErrorMessage('plain')).toBe('plain');
  });
});
