import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, put, snapshot } from "./creator-fixtures.mjs";
import { createCreatorStore } from "../runtime/creator-store.mjs";
import { createCreatorService } from "../runtime/creator-service.mjs";
import {
  parseMeshLabels,
  meshLabelDiff,
} from "../runtime/mesh-label-contract.generated.mjs";
function setup() {
  const f = fixture("portable"),
    root = f.authoring + "/workspace",
    modelPath = "game/figure/中文 人物/model.json";
  put(root + "/game/config.txt", "Game_name:测试;");
  put(root + "/game/scene/start.txt", "原剧情;");
  put(
    root + "/" + modelPath,
    JSON.stringify({ model: "model.moc", textures: ["texture.png"] })
  );
  put(root + "/" + modelPath.replace("model.json", "model.moc"), "fixture moc");
  f.options.authorizedAuthoringWorkspaceRoot = root;
  const store = createCreatorStore(f.options),
    facts = store.readAnchorModel({ modelPath });
  const document = {
    schema: "webgal-mesh-labels",
    schemaVersion: 1,
    modelPath,
    mocSha256: facts.mocSha256,
    meshes: [
      {
        id: "D1",
        vertexCount: 3,
        topology: "A".repeat(64),
        label: "画面右手",
        note: "待对照手型",
        status: "suggested",
      },
    ],
  };
  return { ...f, root, store, document };
}
test("local names survive fresh store; original model, game, profiles untouched", () => {
  const f = setup(),
    before = snapshot(f.root),
    game = snapshot(f.project);
  assert.equal(
    f.store.readMeshLabels({ modelPath: f.document.modelPath }).document,
    null
  );
  const save = f.store.saveMeshLabels({
    document: f.document,
    expectedSha256: null,
  });
  assert(save.ok);
  const read = createCreatorStore(f.options).readMeshLabels({
    modelPath: f.document.modelPath,
  });
  assert.deepEqual(read.document, f.document);
  assert.equal(read.sha256, save.sha256);
  f.document.meshes[0].label = "右手·张开";
  assert(
    f.store.saveMeshLabels({
      document: f.document,
      expectedSha256: read.sha256,
    }).ok
  );
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(snapshot(f.project), game);
});
test("stale revision and missing revision cannot overwrite; changed model cannot save", () => {
  const f = setup();
  f.store.saveMeshLabels({ document: f.document, expectedSha256: null });
  const before = snapshot(f.authoring);
  for (const expectedSha256 of [null, undefined, "BAD"])
    assert.throws(
      () => f.store.saveMeshLabels({ document: f.document, expectedSha256 }),
      /CONFLICT|REVISION/
    );
  f.document.mocSha256 = "B".repeat(64);
  assert.throws(
    () =>
      f.store.saveMeshLabels({ document: f.document, expectedSha256: null }),
    /MODEL_CHANGED/
  );
  assert.deepEqual(snapshot(f.authoring), before);
});
test("manual edit readable, protected and explicitly acceptible without touching IDs", () => {
  const f = setup(),
    save = f.store.saveMeshLabels({
      document: f.document,
      expectedSha256: null,
    });
  const manual = structuredClone(f.document);
  manual.meshes[0].label = "用户手改";
  put(f.authoring + "/library/" + save.fileName, JSON.stringify(manual));
  const read = f.store.readMeshLabels({ modelPath: f.document.modelPath });
  assert.equal(read.document.meshes[0].label, "用户手改");
  const before = snapshot(f.authoring);
  assert.equal(
    f.store.saveMeshLabels({
      document: f.document,
      expectedSha256: read.sha256,
    }).ok,
    false
  );
  assert.deepEqual(snapshot(f.authoring), before);
  assert.equal(
    f.store.saveMeshLabels({
      document: f.document,
      expectedSha256: read.sha256,
      acceptCurrent: true,
    }).ok,
    true
  );
});
test("transaction fault rolls back names and ownership", () => {
  const f = setup(),
    before = snapshot(f.authoring);
  const store = createCreatorStore(f.options, {
    fault(stage) {
      if (stage === "installed") throw new Error("mesh fault");
    },
  });
  assert.throws(
    () => store.saveMeshLabels({ document: f.document, expectedSha256: null }),
    /mesh fault/
  );
  assert.deepEqual(snapshot(f.authoring), before);
});
test("corrupt name file reports diagnostic without breaking anchors or overwriting data", () => {
  const f = setup(),
    save = f.store.saveMeshLabels({
      document: f.document,
      expectedSha256: null,
    });
  put(f.authoring + "/library/" + save.fileName, "{invalid");
  const read = f.store.readMeshLabels({ modelPath: f.document.modelPath });
  assert.equal(read.document, null);
  assert.match(read.diagnostic, /格式无效/);
  assert.equal(
    f.store.readAnchorModel({ modelPath: f.document.modelPath }).mocSha256,
    f.document.mocSha256
  );
  const before = snapshot(f.authoring);
  assert.equal(
    f.store.saveMeshLabels({
      document: f.document,
      expectedSha256: read.sha256,
    }).ok,
    false
  );
  assert.deepEqual(snapshot(f.authoring), before);
});
for (const [label, mutate] of [
  ["traversal", (d) => (d.modelPath = "game/figure/../secret.json")],
  ["duplicate IDs", (d) => d.meshes.push({ ...d.meshes[0] })],
  ["control chars", (d) => (d.meshes[0].label = "a\nb")],
  ["unknown status", (d) => (d.meshes[0].status = "execute")],
  ["invalid topology", (d) => (d.meshes[0].topology = "invalid")],
  [
    "blank confirmed label",
    (d) => {
      d.meshes[0].label = " ";
      d.meshes[0].status = "confirmed";
    },
  ],
  ["oversized label", (d) => (d.meshes[0].label = "a".repeat(81))],
])
  test(label + " rejected before writes", () => {
    const f = setup(),
      before = snapshot(f.authoring);
    mutate(f.document);
    assert.throws(() =>
      f.store.saveMeshLabels({ document: f.document, expectedSha256: null })
    );
    assert.deepEqual(snapshot(f.authoring), before);
  });
test("suggestion comparison does not silently map unknown or changed topology; strips extra fields", () => {
  const f = setup(),
    incoming = structuredClone(f.document);
  incoming.meshes.push({ ...incoming.meshes[0], id: "OTHER" });
  incoming.meshes[0].topology = "B".repeat(64);
  assert(meshLabelDiff(f.document, incoming).every((r) => !r.compatible));
  incoming.exec = "ignore";
  assert.equal(parseMeshLabels(incoming).exec, undefined);
});
test("mesh HTTP read and save require session and persist independently of origin", async () => {
  const f = setup(),
    service = createCreatorService(f.options),
    a = await service.listen(0);
  const post = (route, body, token = a.token) =>
    fetch(a.origin + "/__creator/mesh-labels/" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-creator-session": token,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post(
          "save",
          { document: f.document, expectedSha256: null },
          "0".repeat(64)
        )
      ).status,
      403
    );
    assert.equal(
      (await post("save", { document: f.document, expectedSha256: null }))
        .status,
      200
    );
    const read = await post("read", { modelPath: f.document.modelPath });
    assert.deepEqual((await read.json()).document, f.document);
  } finally {
    await service.close();
  }
});
