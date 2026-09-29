import TagsManager from './TagsManager';
import EditArea from './EditArea';
import styles from './mainArea.module.scss';
import { useSyncExternalStore } from 'react';
import { isEditorRenaming, subscribeEditorRename } from '@/utils/editorRename';

export default function MainArea() {
  const renaming = useSyncExternalStore(subscribeEditorRename, isEditorRenaming);
  return (
    <div className={styles.MainArea_main}>
      {renaming && <div role="status">正在重命名，请稍候…</div>}
      <div style={{ display: 'contents' }} ref={element => element?.toggleAttribute('inert', renaming)}>
      <TagsManager />
      <EditArea />
      </div>
    </div>
  );
}
