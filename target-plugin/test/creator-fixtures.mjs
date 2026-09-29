import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { sha, jsonBytes } from "../runtime/creator-package.mjs";
import { createCreatorStore } from "../runtime/creator-store.mjs";
export const task = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
export const run = path.join(
  task,
  process.env.WEBGAL_TEST_EVIDENCE_STAGE || "16_creator-service-save/fixtures",
  `creator-${Date.now()}-${process.pid}`
);
let serial = 0;
export function put(p, b) {
  assert.ok(path.resolve(p).startsWith(run + path.sep));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, b);
}
export function snapshot(root) {
  const result = {};
  if (!fs.existsSync(root)) return result;
  const walk = (rel = "") => {
    for (const e of fs.readdirSync(path.join(root, rel), {
      withFileTypes: true,
    })) {
      const p = rel ? rel + "/" + e.name : e.name;
      if (e.isSymbolicLink())
        result[p] = "LINK:" + fs.readlinkSync(path.join(root, p));
      else if (e.isDirectory()) walk(p);
      else result[p] = sha(fs.readFileSync(path.join(root, p)));
    }
  };
  walk();
  return result;
}
export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
  "base64"
);
export const encode = (p, b) => ({
  path: p,
  bytes: b.length,
  sha256: sha(b),
  base64: b.toString("base64"),
});
export function payload({
  profileId = "profile-a",
  displayName = "中文附件",
  leaf = "test-hat",
  both = false,
  modelPath = "./game/figure/anon/test/model.json",
} = {}) {
  const presetId = "v2/" + leaf,
    attachmentAssetId = "shared-hat-asset",
    root = "game/attachments-v2/portable/" + leaf;
  const preset = {
    schema: "webgal-live2d-attachment-preset",
    schemaVersion: 2,
    presetId,
    attachmentAssetId,
    modelProfileId: profileId,
    anchorName: "head",
    placement: { offset: { x: 0, y: 0 } },
  };
  const profile = {
    schema: "webgal-live2d-model-profile",
    schemaVersion: 1,
    modelProfileId: profileId,
    modelPath,
    characterId: "anon",
    anchors: [{ name: "head" }],
  };
  const asset = {
    schema: "webgal-live2d-attachment-asset",
    schemaVersion: 1,
    attachmentAssetId,
    slot: "headwear",
    layers: {
      front: "./" + root + "/images/front.png",
      ...(both ? { back: "./" + root + "/images/back.png" } : {}),
    },
  };
  const document = {
    schema: "webgal-live2d-attachment-package",
    schemaVersion: 2,
    displayName,
    asset,
    adaptations: [{ preset, modelProfile: profile }],
  };
  const files = [
    encode(root + "/attachment.json", jsonBytes(document)),
    encode(root + "/images/front.png", png),
    ...(both ? [encode(root + "/images/back.png", png)] : []),
    encode(root + "/使用说明.txt", Buffer.from("完整复制本附件文件夹。")),
  ];
  files.push(
    encode(
      root + "/manifest.json",
      jsonBytes({
        schema: "webgal-attachment-creator-export-manifest",
        schemaVersion: 1,
        presetId,
        attachmentDefinitionId: attachmentAssetId,
        modelProfileId: profileId,
        files: files.map(({ path, bytes, sha256 }) => ({
          path,
          bytes,
          sha256,
        })),
      })
    )
  );
  return {
    projectName: "测试 Demo",
    presetId,
    attachmentAssetId,
    modelProfileId: profileId,
    files,
  };
}
export function mutateDocument(body, fn) {
  const clone = structuredClone(body),
    f = clone.files.find((f) => f.path.endsWith("/attachment.json")),
    doc = JSON.parse(Buffer.from(f.base64, "base64"));
  fn(doc);
  Object.assign(f, encode(f.path, jsonBytes(doc)));
  const m = clone.files.find((f) => f.path.endsWith("/manifest.json")),
    manifest = JSON.parse(Buffer.from(m.base64, "base64"));
  manifest.files = clone.files
    .filter((f) => f !== m)
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  Object.assign(m, encode(m.path, jsonBytes(manifest)));
  return clone;
}
export function fixture(mode = "default", overrides = {}, hooks = {}) {
  const base = path.join(run, `case-${++serial}`),
    install = base + "/Terre",
    home = base + "/home",
    data =
      mode === "portable"
        ? install + "/data"
        : mode === "custom"
        ? base + "/custom"
        : home + "/.webgal_terre";
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  if (mode !== "default")
    put(
      home + "/.webgal_terre/config.json",
      JSON.stringify({
        userDataPath: mode === "portable" ? base + "/unused" : data,
      })
    );
  const engine = "assets/templates/WebGAL_Template";
  const host = {
    "WebGAL_Terre.exe": "fixture NOT executable",
    [engine + "/index.html"]: "fixture shared engine",
    [engine + "/webgal-engine.json"]: JSON.stringify({
      id: "webgal-mygo.mygo",
      version: "3.2.1",
      webgalVersion: "4.6.4",
    }),
  };
  for (const [p, b] of Object.entries(host)) put(install + "/" + p, b);
  for (const [p,b] of Object.entries(host)) if (p.startsWith(engine+'/')) {
    const selected=p.replace(engine,'assets/templates/Derivative_Engine/MyGO_v3.2.1');host[selected]=b;put(install+'/'+selected,b);
  }
  const project = data + "/games/测试 Demo",
    other = data + "/games/Other";
  for (const root of [project, other]) {
    put(root + "/game/config.txt", "Game_name:测试;");
    put(root + "/game/scene/start.txt", "用户原剧情不变;");
    put(
      root + "/game/figure/anon/test/model.json",
      JSON.stringify({ model: "model.moc", motions: { "anon/idle01": [{ file: "idle.mtn" }] } })
    );
    put(root + "/game/figure/anon/test/model.moc", "fixture moc");
    put(root + "/game/figure/anon/test/idle.mtn", "fixture motion");
  }
  const authoring = base + "/authoring";
  fs.mkdirSync(authoring, { recursive: true });
  const options = {
    installRoot: install,
    hostHomeRoot: home,
    authorizedUserDataRoot: data,
    authorizedAuthoringRoot: authoring,
    hostFiles: Object.entries(host).map(([p, b]) => ({
      path: p,
      sha256: sha(Buffer.from(b)),
    })),
    projectGrants: [{ name: "测试 Demo", access: "attachment-write" }],
    ...overrides,
  };
  return {
    base,
    install,
    home,
    data,
    project,
    other,
    authoring,
    options,
    store: () => createCreatorStore(options, hooks),
  };
}
