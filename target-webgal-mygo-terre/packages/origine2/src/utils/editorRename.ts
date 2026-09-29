import type { ITag } from '../types/gameEditor';
import type { RenameFileResult } from '@/api/Api';

export function normalizeRenameName(value: string): string {
  return value.trim();
}

export function assertRenameSucceeded(response: { data?: RenameFileResult }): RenameFileResult {
  if (response.data?.ok !== true) throw new Error('磁盘改名未确认成功，编辑器身份未迁移。');
  return response.data;
}

export function renameEditorTags(tags: ITag[], currentTag: ITag | null, source: string, target: string) {
  const map = (tag: ITag): ITag => {
    if (tag.path !== source && !tag.path.startsWith(source + '/')) return tag;
    const path = target + tag.path.slice(source.length);
    return { ...tag, path, name: path.split('/').at(-1)! };
  };
  // A pre-existing clean target tab is replaced by the renamed tab.
  const moved = tags.filter(t => t.path === source || t.path.startsWith(source + '/')).map(map);
  const destinations = new Set(moved.map(t => t.path));
  const next = tags.filter(t => !destinations.has(t.path)).map(map);
  return { tags: next, currentTag: currentTag ? map(currentTag) : null };
}

let busy = false;
const listeners = new Set<() => void>();
export const isEditorRenaming = () => busy;
export const subscribeEditorRename = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function setEditorRenaming(value: boolean) {
  busy = value;
  listeners.forEach(listener => listener());
}
