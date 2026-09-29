/** Historical MVP-4N developer sandbox is not a production Creator feature.
 * Its old Redux/static-image/save-load code also reset the shared Runtime on cleanup.
 * Do not import that sandbox into the migrated host or claim a second runtime family.
 * Pure semanticAnchorProfile validation/import/export utilities and the ordinary
 * workbench's Live2D semantic anchor selection/placement remain available separately.
 */
export const LEGACY_SEMANTIC_SANDBOX_STATUS = 'CREATOR_LEGACY_SEMANTIC_SANDBOX_NOT_MIGRATED' as const;

export function installSemanticAnchorMakerSection(creatorRoot: HTMLElement) {
  if (!import.meta.env.DEV) return () => undefined;
  const notice = document.createElement('p');
  notice.dataset.testid = 'legacy-semantic-sandbox-unavailable';
  notice.dataset.status = LEGACY_SEMANTIC_SANDBOX_STATUS;
  notice.textContent =
    '开发工具说明：历史 MVP-4N 静态图 / 语义锚点实验沙盒尚未迁移，当前不可运行。' +
    '普通制作器的 Live2D 语义部位选择与位置编辑不受影响；本提示不代表已支持第二 Runtime。';
  creatorRoot.append(notice);
  // Only this notice is owned here. Never touch stage objects, saves, profiles,
  // listeners, timers or the shared attachment Runtime while removing it.
  return () => notice.remove();
}
