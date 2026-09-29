// Generated from creator/meshLabelContract.ts by generate-mesh-contract.mjs.
function parseMeshLabels(raw) {
  const value = raw;
  const text = (s, max) => typeof s === "string" && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
  if (!value || value.schema !== "webgal-mesh-labels" || value.schemaVersion !== 1 || !text(value.modelPath, 1024) || !/^game\/figure\/.+\.json$/i.test(value.modelPath) || value.modelPath.split("/").some((p) => !p || p === "." || p === ".." || /[\\:]/.test(p)) || !/^[a-f0-9]{64}$/i.test(value.mocSha256) || !Array.isArray(value.meshes) || !value.meshes.length || value.meshes.length > 1e4)
    throw new Error("\u7F51\u683C\u540D\u79F0\u6587\u4EF6\u683C\u5F0F\u6216\u6A21\u578B\u6807\u8BC6\u65E0\u6548\u3002");
  const ids = /* @__PURE__ */ new Set();
  const meshes = value.meshes.map((r) => {
    if (!r || !text(r.id, 256) || !r.id || ids.has(r.id) || !Number.isInteger(r.vertexCount) || r.vertexCount < 1 || r.vertexCount > 1e5 || !/^[a-f0-9]{64}$/i.test(r.topology) || !text(r.label, 80) || !text(r.note, 300) || !["unreviewed", "suggested", "confirmed"].includes(r.status) || r.status === "confirmed" && !r.label.trim())
      throw new Error("\u7F51\u683C\u6761\u76EE\u65E0\u6548\uFF1A\u540D\u79F0\u6700\u591A80\u5B57\uFF0C\u8BF4\u660E\u6700\u591A300\u5B57\uFF1BID\u4E0D\u80FD\u91CD\u590D\uFF0C\u5DF2\u786E\u8BA4\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002");
    ids.add(r.id);
    return {
      id: r.id,
      vertexCount: r.vertexCount,
      topology: r.topology.toUpperCase(),
      label: r.label.trim(),
      note: r.note.trim(),
      status: r.status
    };
  });
  return {
    schema: "webgal-mesh-labels",
    schemaVersion: 1,
    modelPath: value.modelPath,
    mocSha256: value.mocSha256.toUpperCase(),
    meshes
  };
}
function meshLabelDiff(current, incoming) {
  const map = new Map(current.meshes.map((r) => [r.id, r]));
  return incoming.meshes.map((row) => {
    const old = map.get(row.id);
    const compatible = !!old && old.vertexCount === row.vertexCount && old.topology === row.topology;
    return {
      row,
      old,
      compatible,
      changed: !old || old.label !== row.label || old.note !== row.note || old.status !== row.status
    };
  });
}
export {
  meshLabelDiff,
  parseMeshLabels
};
