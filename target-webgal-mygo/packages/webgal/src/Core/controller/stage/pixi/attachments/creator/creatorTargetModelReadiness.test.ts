import { describe, expect, it } from 'vitest';
import { creatorTargetModelPresentation } from './creatorTargetModelReadiness';

describe('Creator target model readiness presentation', () => {
  it('keeps a ready result compact', () => {
    expect(
      creatorTargetModelPresentation(
        {
          ok: true,
          ready: true,
          projectName: '测试游戏',
          modelPath: 'game/figure/anon/model.json',
          dependencyCount: 4,
          status: 'TARGET_MODEL_READY',
        },
        '测试游戏',
      ),
    ).toEqual({
      state: 'ready',
      message: '已就绪（模型 JSON + 4 个必要文件）。',
    });
  });

  it('presents a missing target model as an actionable non-blocking warning', () => {
    const presentation = creatorTargetModelPresentation(
      {
        ok: true,
        ready: false,
        projectName: '测试游戏',
        modelPath: 'game/figure/anon/model.json',
        status: 'TARGET_MODEL_NOT_READY',
        warning: {
          code: 'CREATOR_TARGET_MODEL_MISSING',
          message: '目标游戏缺少人物模型文件：game/figure/anon/model.moc',
          targetPath: 'game/figure/anon/model.moc',
          suggestion: '请先补齐人物模型，再重新保存；制作器不会静默复制人物模型。',
        },
      },
      '测试游戏',
    );

    expect(presentation.state).toBe('warning');
    expect(presentation.message).toBe('添加到游戏前需要补齐：game/figure/anon/model.moc');
    expect(presentation.notice).toMatch(/^附件仍可在工作台继续编辑；添加到该游戏前需要补齐人物模型。/);
    expect(presentation.notice).toContain('目标游戏：测试游戏');
    expect(presentation.notice).toContain('缺少文件：game/figure/anon/model.moc');
    expect(presentation.notice).toContain('制作器不会静默复制人物模型');
    expect(presentation.notice).toContain('诊断代码：CREATOR_TARGET_MODEL_MISSING');
  });
});
