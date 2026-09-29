/** Portable human/AI suggestions. Text only: never evaluate imported content. */
export interface MeshLabelRow {
  id: string;
  vertexCount: number;
  topology: string;
  label: string;
  note: string;
  status: 'unreviewed' | 'suggested' | 'confirmed';
}
export interface MeshLabelDocument {
  schema: 'webgal-mesh-labels';
  schemaVersion: 1;
  modelPath: string;
  mocSha256: string;
  meshes: MeshLabelRow[];
}
export function parseMeshLabels(raw: unknown): MeshLabelDocument {
  const value = raw as MeshLabelDocument;
  const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
  if (
    !value ||
    value.schema !== 'webgal-mesh-labels' ||
    value.schemaVersion !== 1 ||
    !text(value.modelPath, 1024) ||
    !/^game\/figure\/.+\.json$/i.test(value.modelPath) ||
    value.modelPath.split('/').some((p) => !p || p === '.' || p === '..' || /[\\:]/.test(p)) ||
    !/^[a-f0-9]{64}$/i.test(value.mocSha256) ||
    !Array.isArray(value.meshes) ||
    !value.meshes.length ||
    value.meshes.length > 10000
  )
    throw new Error('网格名称文件格式或模型标识无效。');
  const ids = new Set<string>();
  const meshes = value.meshes.map((r) => {
    if (
      !r ||
      !text(r.id, 256) ||
      !r.id ||
      ids.has(r.id) ||
      !Number.isInteger(r.vertexCount) ||
      r.vertexCount < 1 ||
      r.vertexCount > 100000 ||
      !/^[a-f0-9]{64}$/i.test(r.topology) ||
      !text(r.label, 80) ||
      !text(r.note, 300) ||
      !['unreviewed', 'suggested', 'confirmed'].includes(r.status) ||
      (r.status === 'confirmed' && !r.label.trim())
    )
      throw new Error('网格条目无效：名称最多80字，说明最多300字；ID不能重复，已确认名称不能为空。');
    ids.add(r.id);
    return {
      id: r.id,
      vertexCount: r.vertexCount,
      topology: r.topology.toUpperCase(),
      label: r.label.trim(),
      note: r.note.trim(),
      status: r.status,
    };
  });
  return {
    schema: 'webgal-mesh-labels',
    schemaVersion: 1,
    modelPath: value.modelPath,
    mocSha256: value.mocSha256.toUpperCase(),
    meshes,
  };
}
export function meshLabelDiff(current: MeshLabelDocument, incoming: MeshLabelDocument) {
  const map = new Map(current.meshes.map((r) => [r.id, r]));
  return incoming.meshes.map((row) => {
    const old = map.get(row.id);
    const compatible = !!old && old.vertexCount === row.vertexCount && old.topology === row.topology;
    return {
      row,
      old,
      compatible,
      changed: !old || old.label !== row.label || old.note !== row.note || old.status !== row.status,
    };
  });
}
