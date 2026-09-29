export interface CreatorSavedAdaptationPresentation {
  multiple: boolean;
  adaptationFieldDisplay: 'grid' | 'none';
  rowGridTemplateColumns: string;
  loadButtonText: string;
}

export function creatorSavedAdaptationPresentation(adaptationCount: number): CreatorSavedAdaptationPresentation {
  const multiple = adaptationCount > 1;
  return {
    multiple,
    adaptationFieldDisplay: multiple ? 'grid' : 'none',
    rowGridTemplateColumns: multiple ? 'minmax(0,1fr) minmax(0,1fr) auto' : 'minmax(0,1fr) auto',
    loadButtonText: multiple ? '原样载入所选适配' : '一键载入附件',
  };
}
