import { describe, it, expect } from 'vitest';
import { prepareCreatorModelUpload, modelImportError } from './creatorModelImportPanel';
import { modelImportDependencies } from './creatorModelFiles';
function file(p: string, data: string) {
  const f = new File([data], p.split('/').at(-1)!);
  Object.defineProperty(f, 'webkitRelativePath', { value: `选中的文件夹/${p}` });
  return f;
}
const model = { model: 'model.moc', textures: ['texture.png'],
  motions: { wave: [{ file: '../shared/wave.mtn' }] }, expressions: [{ file: '../shared/smile.exp.json' }] };
describe('local model ordinary upload contract', () => {
  it('copies all referenced motion/expression dependencies and excludes unrelated user files', async () => {
    const files = [file('人物/model.json', JSON.stringify(model)), file('人物/model.moc', 'binary moc'),
      file('人物/texture.png', 'binary image'), file('shared/wave.mtn', 'motion'), file('shared/smile.exp.json', '{}'),
      file('不要上传.txt', 'private unrelated file')];
    const upload = await prepareCreatorModelUpload(files, '人物/model.json', '自选人物');
    expect(upload.files).toHaveLength(5);
    expect(upload.files.some(f => f.path.endsWith('.mtn'))).toBe(true);
    expect(JSON.stringify(upload)).not.toContain('private unrelated file');
    expect(upload.displayName).toBe('自选人物');
  });
  it('detects missing shared files before any upload', async () => {
    await expect(prepareCreatorModelUpload([file('人物/model.json', JSON.stringify(model))], '人物/model.json', 'X'))
      .rejects.toThrow('DEPENDENCY_MISSING');
  });
  it('does not silently case-fold colliding local files', async () => {
    await expect(prepareCreatorModelUpload([file('Model.json', '{}'), file('model.json', '{}')], 'model.json', 'X'))
      .rejects.toThrow('DUPLICATE_PATH');
  });
  it.each(['https://other/model.moc', 'C:/data/model.moc', '/root/model.moc', '..\\model.moc'])('rejects foreign reference %s', reference => {
    expect(() => modelImportDependencies('model.json', { ...model, model: reference })).toThrow();
  });
  it('gives actionable Chinese guidance for shared-folder dependency and overwrite conflict', () => {
    expect(modelImportError(new Error('CREATOR_MODEL_IMPORT_OUTSIDE_FOLDER'))).toContain('上一级');
    expect(modelImportError(new Error('CREATOR_MODEL_IMPORT_TARGET_CONFLICT'))).toContain('原文件已保留');
  });
});
