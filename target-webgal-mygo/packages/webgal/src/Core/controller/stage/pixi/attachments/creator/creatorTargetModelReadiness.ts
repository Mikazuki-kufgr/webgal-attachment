import type { CreatorTargetModelCheckResult } from './creatorProject';

export type CreatorTargetModelPresentation = {
  state: 'ready' | 'warning';
  message: string;
  notice?: string;
};

export function creatorTargetModelPresentation(
  result: CreatorTargetModelCheckResult,
  projectName: string,
): CreatorTargetModelPresentation {
  if (result.ready) {
    return {
      state: 'ready',
      message: `已就绪（模型 JSON + ${result.dependencyCount} 个必要文件）。`,
    };
  }
  return {
    state: 'warning',
    message: `添加到游戏前需要补齐：${result.warning.targetPath}`,
    notice: [
      '附件仍可在工作台继续编辑；添加到该游戏前需要补齐人物模型。',
      `目标游戏：${projectName}`,
      `缺少文件：${result.warning.targetPath}`,
      `建议操作：${
        result.modelPath.includes('/figure/creator-imports/')
          ? '回到“导入自己的人物模型”，点击“将当前导入人物复制到第 5 步所选游戏”，等待完成后再添加附件到游戏。'
          : result.warning.suggestion
      }`,
      `诊断代码：${result.warning.code}`,
    ].join('\n'),
  };
}
