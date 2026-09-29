import type { CreatorDraft } from './creatorTypes';
import type { CreatorPackageAdaptation } from './creatorPackageBuilder';
import { migrateLegacyProfileAnchorName } from '../profileTypes';

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function adaptationState(draft: CreatorDraft) {
  return canonical([draft.modelProfileId, draft.anchorName, draft.placement, draft.visualState, draft.handBinding]);
}

/** Figure generations and camera state are not authored attachment content. */
export function attachmentState(draft: CreatorDraft, rows: readonly CreatorPackageAdaptation[], defaults: unknown) {
  const { figureKey, figureGeneration, draftId, ...content } = draft;
  return canonical([content, rows, defaults]);
}

export function ordinarySavedAdaptation(
  rows: readonly CreatorPackageAdaptation[], modelPath: string,
  preference?: { modelProfileId: string; anchorName: string }, explicitId?: string,
  explicitAnchor?: string,
) {
  const matches = rows.filter(row => row.modelProfile.modelPath.replace(/^\.\//, '') === modelPath.replace(/^\.\//, ''));
  if (explicitId) {
    const selected = matches.filter(row => row.modelProfile.modelProfileId === explicitId &&
      (explicitAnchor === undefined || migrateLegacyProfileAnchorName(row.preset.anchorName) === migrateLegacyProfileAnchorName(explicitAnchor)));
    if (selected.length > 1) throw new Error('这套立绘有多套适配，请明确选择锚点。');
    const row = selected[0];
    if (!row) throw new Error('所选适配不属于当前立绘，请选择对应立绘或使用原样编辑。');
    return row;
  }
  const preferred = matches.find(row => row.modelProfile.modelProfileId === preference?.modelProfileId && row.preset.anchorName === preference.anchorName);
  if (preferred) return preferred;
  if (matches.length > 1) throw new Error('这套立绘有多套适配，且没有有效的保存选择。请在“编辑哪一套适配”中选择后再载入。');
  return matches[0];
}
