import { sha, jsonBytes, readChecked } from "./creator-package.mjs";
import { commitOwned } from "./creator-transaction.mjs";
import { fail } from "./terre-path-guard.mjs";
import { parseMeshLabels } from "./mesh-label-contract.generated.mjs";

/** Path is derived from a verified workspace model, never from a client filename. */
export function createMeshLabelStore({ access, modelFacts, emit, fault }) {
  const own = ".creator-mesh-labels-owned-v1.json",
    journal = ".creator-mesh-labels-transaction-v1.json";
  function plan(p) {
    if (
      p !== own &&
      p !== journal &&
      !/^mesh-labels\/[A-F0-9]{64}\.json$/.test(p)
    )
      fail("CREATOR_LIBRARY_WRITE_SCOPE_INVALID");
    return access.planLibraryWrite(p);
  }
  const relative = (f) => `mesh-labels/${sha(Buffer.from(f.modelPath))}.json`;
  return {
    readMeshLabels(body) {
      const facts = modelFacts(body.modelPath),
        p = plan(relative(facts));
      const bytes = p.exists ? readChecked(p, 4 * 1024 * 1024) : null;
      let document = null,
        diagnostic = "";
      if (bytes)
        try {
          document = parseMeshLabels(
            JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))
          );
        } catch {
          diagnostic =
            "本地网格名称文件格式无效，原文件已保留。锚点仍可编辑；请备份并修正名称文件，或在保存名称时明确接受覆盖。";
        }
      return {
        ok: true,
        document,
        diagnostic,
        fileName: relative(facts),
        sha256: bytes ? sha(bytes) : null,
      };
    },
    saveMeshLabels(body, { signal } = {}) {
      const document = parseMeshLabels(body.document),
        facts = modelFacts(document.modelPath);
      if (document.mocSha256 !== facts.mocSha256)
        fail("CREATOR_MESH_MODEL_CHANGED");
      const rel = relative(facts),
        p = plan(rel),
        bytes = p.exists ? readChecked(p, 4 * 1024 * 1024) : null;
      const expected = body.expectedSha256;
      if (expected !== null && !/^[A-F0-9]{64}$/.test(expected ?? ""))
        fail("CREATOR_MESH_EXPECTED_REVISION_REQUIRED");
      if ((bytes ? sha(bytes) : null) !== expected)
        fail("CREATOR_MESH_LABEL_SAVE_CONFLICT");
      const content = jsonBytes(document);
      if (content.length > 4 * 1024 * 1024)
        fail("CREATOR_MESH_LABEL_TOO_LARGE");
      const result = commitOwned({
        access,
        plan,
        ownerId: "creator-mesh-labels",
        ownershipPath: own,
        journalPath: journal,
        files: [{ path: rel, bytes: content }],
        acceptedCurrentPaths: body.acceptCurrent === true ? [rel] : [],
        signal,
        fault,
        validateReadSet: () => {
          if (modelFacts(document.modelPath).mocSha256 !== facts.mocSha256)
            fail("CREATOR_MESH_MODEL_CHANGED");
        },
      });
      emit({
        type: "mesh.labels.save",
        result: result.ok ? "PERSISTED" : "CONFLICT",
        modelPath: document.modelPath,
      });
      return { ...result, document, sha256: sha(content), fileName: rel };
    },
  };
}
