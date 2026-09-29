import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fixture, put, snapshot, task, run } from "./creator-fixtures.mjs";
import { createTerreProjectAccess } from "../runtime/terre-project-access.mjs";
import { loadProductResources, resourceSelection } from "../runtime/product-resources.mjs";
import {
  adoptLegacyOwnership,
  initializeAuthoringWorkspace,
  materializeProductSelection,
  seedGlobalLibrary,
  verifyAuthoringWorkspaceTemplate,
} from "../runtime/product-materialization.mjs";
import { checkCreatorLaunch, startCreatorLaunch, stopCreatorLaunch } from "../runtime/creator-launch.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const resourcesSpec = {
  root: path.join(task, "target-plugin/resources/global-library"),
  manifestPath: path.join(task, "target-plugin/resources/product-resources.json"),
};
const pinTree = (root, sourceKind) => {
  const files = [];
  const walk = (at = root) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const absolute = path.join(at, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({ path: path.relative(root, absolute).split(path.sep).join("/"), bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  };
  walk(); files.sort((a, b) => a.path.localeCompare(b.path));
  return { root, ...(sourceKind ? { sourceKind } : {}), files };
};
const resources = () => loadProductResources(resourcesSpec);
const errorCode = (fn, code) => assert.throws(fn, (error) => error.code === code || error.message === code);

test("resource catalog pins the accepted payload while excluding SDK and model binaries", () => {
  const loaded = resources();
  assert.equal(loaded.rows.length, 144);
  assert.equal(loaded.manifest.counts["model-profile"], 102);
  assert.equal(loaded.rows.filter((r) => r.role === "model-profile" && /-semantic-v1\.json$/.test(r.path)).length, 97);
  assert.equal(loaded.manifest.distribution.live2dSdk, "PENDING_PERMISSION_EXCLUDED");
  assert.equal(loaded.manifest.distribution.modelBinaries, "NOT_BUNDLED");
  assert.deepEqual(["default", ...loaded.index.builtinSamples.map((s) => s.id)], ["default", "straw-hat-both", "kemomimi-front", "halo-front", "flower-front", "rose-front"]);
  assert.equal(resourceSelection(loaded, "halo-front").files.length, 1);
  errorCode(() => resourceSelection(loaded, "missing"), "PRODUCT_SAMPLE_NOT_FOUND");
});

test("resource tamper and SDK-shaped manifest entry fail closed", () => {
  const f = fixture(), clone = path.join(f.base, "resource-clone");
  fs.cpSync(resourcesSpec.root, clone, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(resourcesSpec.manifestPath));
  put(path.join(f.base, "manifest.json"), JSON.stringify(manifest));
  fs.appendFileSync(path.join(clone, "library-index.json"), " ");
  errorCode(() => loadProductResources({ root: clone, manifestPath: path.join(f.base, "manifest.json") }), "PRODUCT_RESOURCE_HASH_MISMATCH");
  fs.cpSync(resourcesSpec.root, clone, { recursive: true, force: true });
  put(path.join(clone, "Live2D.js"), "sdk");
  manifest.files.push({ path: "Live2D.js", role: "attachment-image", bytes: 3, sha256: hash(Buffer.from("sdk")) });
  put(path.join(f.base, "manifest-sdk.json"), JSON.stringify(manifest));
  errorCode(() => loadProductResources({ root: clone, manifestPath: path.join(f.base, "manifest-sdk.json") }), "PRODUCT_RESOURCE_NOT_ALLOWED");
});

test("global library seed is transactional, repeatable, and does not adopt equal foreign bytes", () => {
  const f = fixture(), access = createTerreProjectAccess(f.options), loaded = resources();
  const first = seedGlobalLibrary({ access, resources: loaded });
  assert.equal(first.ok, true); assert.equal(first.noOp, false);
  const before = snapshot(path.join(f.authoring, "library"));
  const second = seedGlobalLibrary({ access, resources: loaded });
  assert.equal(second.noOp, true); assert.deepEqual(snapshot(path.join(f.authoring, "library")), before);
  access.close();

  const foreign = fixture(), equal = loaded.read("library-index.json");
  put(path.join(foreign.authoring, "library/library-index.json"), equal);
  const foreignAccess = createTerreProjectAccess(foreign.options);
  const seeded = seedGlobalLibrary({ access: foreignAccess, resources: loaded });
  assert.equal(seeded.ok, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(foreign.authoring, "library/.webgal-attachment-product/resource-ownership-v1.json")));
  assert.equal(ledger.files.some((row) => row.path === "library-index.json"), false);
  foreignAccess.close();
});
test('complete factory sample opens through ordinary package data and user edits survive reseed', () => {
  const f = fixture(), access = createTerreProjectAccess(f.options), loaded = resources();
  seedGlobalLibrary({ access, resources: loaded });
  const store = f.store();
  const sample = store.loadFactorySample({ sampleId: 'flower' });
  assert.equal(sample.integrity, 'HASH_VALIDATED');
  assert.equal(sample.packageDocument.adaptations[0].preset.presetId, 'v2/flower-front-v1');
  assert.equal(sample.layers.front.bytes > 0, true);
  const file = path.join(f.authoring, 'library/portable-samples/花朵/flower-front-v1/attachment.json');
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  document.displayName = '用户改过的花';
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
  const current = fs.readFileSync(file);
  const edited = store.loadFactorySample({ sampleId: 'flower' });
  assert.equal(edited.integrity, 'FACTORY_USER_EDITED');
  assert.equal(edited.packageDocument.displayName, '用户改过的花');
  seedGlobalLibrary({ access, resources: loaded });
  assert.deepEqual(fs.readFileSync(file), current);
  store.close(); access.close();
});

test("fresh global library seed never publishes or deletes externally changed staging", () => {
  const tinyBytes = Buffer.from("tiny library index");
  const tinyResources = {
    rows: [{ path: "library-index.json" }],
    read(relative) { assert.equal(relative, "library-index.json"); return tinyBytes; },
    manifest: { resourceSetId: "test-stage-race" },
  };

  const added = fixture(), addedAccess = createTerreProjectAccess(added.options);
  let addedSentinel;
  errorCode(() => seedGlobalLibrary({
    access: addedAccess,
    resources: tinyResources,
    fault(phase, context) {
      if (phase === "preflight") {
        addedSentinel = path.join(context.stage, "external-stage.txt");
        fs.writeFileSync(addedSentinel, "external library stage");
      }
    },
  }), "PRODUCT_LIBRARY_STAGE_CHANGED");
  assert.equal(fs.existsSync(path.join(added.authoring, "library")), false);
  assert.equal(fs.readFileSync(addedSentinel, "utf8"), "external library stage");
  addedAccess.close();

  const replaced = fixture(), replacedAccess = createTerreProjectAccess(replaced.options);
  let movedStage, replacementSentinel;
  errorCode(() => seedGlobalLibrary({
    access: replacedAccess,
    resources: tinyResources,
    fault(phase, context) {
      if (phase === "preflight") {
        movedStage = `${context.stage}.externally-moved`;
        fs.renameSync(context.stage, movedStage);
        fs.mkdirSync(context.stage);
        replacementSentinel = path.join(context.stage, "replacement.txt");
        fs.writeFileSync(replacementSentinel, "replacement library stage");
      }
    },
  }), "PRODUCT_LIBRARY_STAGE_CHANGED");
  assert.equal(fs.existsSync(path.join(replaced.authoring, "library")), false);
  assert.equal(fs.readFileSync(replacementSentinel, "utf8"), "replacement library stage");
  assert.equal(fs.existsSync(path.join(movedStage, "library-index.json")), true);
  replacedAccess.close();
});

test("project selection writes only attachments-v2, preserves user scene, and repeats as a byte no-op", () => {
  const f = fixture(), access = createTerreProjectAccess(f.options), handle = access.openProject("测试 Demo");
  const start = fs.readFileSync(path.join(f.project, "game/scene/start.txt"));
  const first = materializeProductSelection({ access, handle, resources: resources(), sampleId: "straw-hat-both", ownerId: "product:test-project" });
  assert.equal(first.ok, true); assert.equal(first.noOp, false);
  assert.deepEqual(fs.readFileSync(path.join(f.project, "game/scene/start.txt")), start);
  assert.ok(fs.existsSync(path.join(f.project, "game/attachments-v2/files/builtin-samples/straw-hat/back.png")));
  const before = snapshot(f.project), second = materializeProductSelection({ access, handle, resources: resources(), sampleId: "straw-hat-both", ownerId: "product:test-project" });
  assert.equal(second.noOp, true); assert.deepEqual(snapshot(f.project), before);
  access.close();
});

test("materialized user edits are preserved and fault injection rolls back", () => {
  const f = fixture(), access = createTerreProjectAccess(f.options), handle = access.openProject("测试 Demo"), loaded = resources();
  materializeProductSelection({ access, handle, resources: loaded, sampleId: "halo-front", ownerId: "product:conflict" });
  const asset = path.join(f.project, "game/attachments-v2/assets/builtin-halo-front-v1.json");
  fs.writeFileSync(asset, "user changed");
  const before = snapshot(f.project);
  const preserved = materializeProductSelection({ access, handle, resources: loaded, sampleId: "halo-front", ownerId: "product:conflict" });
  assert.equal(preserved.ok, true);
  assert.deepEqual(preserved.preservedUserFiles, ["game/attachments-v2/assets/builtin-halo-front-v1.json"]);
  assert.equal(fs.readFileSync(asset, "utf8"), "user changed");
  const after = snapshot(f.project);
  delete before["game/attachments-v2/.webgal-attachment-product/project-owned-v2.json"];
  delete after["game/attachments-v2/.webgal-attachment-product/project-owned-v2.json"];
  assert.deepEqual(after, before);
  const ownership = JSON.parse(
    fs.readFileSync(
      path.join(
        f.project,
        "game/attachments-v2/.webgal-attachment-product/project-owned-v2.json"
      ),
      "utf8"
    )
  );
  assert.equal(
    ownership.files.some(
      (row) =>
        row.path === "game/attachments-v2/assets/builtin-halo-front-v1.json"
    ),
    false
  );
  access.close();

  const g = fixture(), ga = createTerreProjectAccess(g.options), gh = ga.openProject("测试 Demo"), initial = snapshot(g.project);
  assert.throws(() => materializeProductSelection({ access: ga, handle: gh, resources: loaded, sampleId: "kemomimi-front", ownerId: "product:rollback", fault(phase, file) { if (phase === "installed" && /front\.png$/.test(file)) throw new Error("FAULT"); } }), /FAULT/);
  assert.deepEqual(snapshot(g.project), initial); ga.close();
});

test("legacy ownership adoption requires exact manifest/project/release/current-byte proof", () => {
  const setup = (changed = false) => {
    const f = fixture(), relative = "game/attachments-v2/assets/legacy.json", bytes = Buffer.from("legacy-owned");
    put(path.join(f.project, relative), changed ? "user edit" : bytes);
    const legacy = { schema: "webgal-attachment-creator-owned-files", schemaVersion: 1,
      projectId: "webgal-attachment-target-测试 Demo", releaseVersion: "B3-R1.8-USER-TRIAL-FIXES.37",
      files: [{ path: relative, bytes: bytes.length, sha256: hash(bytes) }] };
    const legacyPath = "game/attachments-v2/.webgal-attachment-creator/game-save-v1.json";
    const manifestBytes = Buffer.from(`${JSON.stringify(legacy)}\n`);
    put(path.join(f.project, legacyPath), manifestBytes);
    return { f, legacyPath, manifestBytes };
  };
  const a = setup(), access = createTerreProjectAccess(a.f.options), handle = access.openProject("测试 Demo");
  errorCode(() => adoptLegacyOwnership({ access, handle, ownerId: "product:legacy", evidence: {} }), "LEGACY_OWNERSHIP_EVIDENCE_INSUFFICIENT");
  const adopted = adoptLegacyOwnership({ access, handle, ownerId: "product:legacy", evidence: {
    authority: "EXACT_HISTORICAL_HASH_LEDGER", legacyPath: a.legacyPath, legacyManifestSha256: hash(a.manifestBytes),
    expectedProjectId: "webgal-attachment-target-测试 Demo", expectedReleaseVersion: "B3-R1.8-USER-TRIAL-FIXES.37",
  } });
  assert.equal(adopted.status, "ADOPTED_EXACT_HASH_PROOF"); access.close();
  const b = setup(true), ba = createTerreProjectAccess(b.f.options), bh = ba.openProject("测试 Demo");
  errorCode(() => adoptLegacyOwnership({ access: ba, handle: bh, ownerId: "product:legacy", evidence: {
    authority: "EXACT_HISTORICAL_HASH_LEDGER", legacyPath: b.legacyPath, legacyManifestSha256: hash(b.manifestBytes),
    expectedProjectId: "webgal-attachment-target-测试 Demo", expectedReleaseVersion: "B3-R1.8-USER-TRIAL-FIXES.37",
  } }), "LEGACY_OWNERSHIP_CURRENT_BYTES_CHANGED"); ba.close();
});

test("authoring workspace is one-time copied then user-owned and never silently adopts an existing directory", () => {
  const f = fixture(), templateRoot = path.join(f.base, "template");
  put(path.join(templateRoot, "index.html"), "engine"); put(path.join(templateRoot, "game/scene/start.txt"), "template scene");
  const template = pinTree(templateRoot, "USER_LOCAL_PROJECT");
  assert.equal(verifyAuthoringWorkspaceTemplate(template).files, 2);
  fs.rmdirSync(f.authoring);
  const first = initializeAuthoringWorkspace({ authoringRoot: f.authoring, authorizedWorkspaceRoot: path.join(f.authoring, "workspace"), template });
  assert.equal(first.status, "CREATED_USER_OWNED");
  assert.equal(fs.existsSync(f.authoring), true);
  fs.writeFileSync(path.join(f.authoring, "workspace/game/scene/start.txt"), "user changed");
  const second = initializeAuthoringWorkspace({ authoringRoot: f.authoring, authorizedWorkspaceRoot: path.join(f.authoring, "workspace"), template: null });
  assert.equal(second.status, "REUSED_USER_OWNED"); assert.equal(fs.readFileSync(path.join(f.authoring, "workspace/game/scene/start.txt"), "utf8"), "user changed");
  const g = fixture(); fs.mkdirSync(path.join(g.authoring, "workspace"));
  errorCode(() => initializeAuthoringWorkspace({ authoringRoot: g.authoring, authorizedWorkspaceRoot: path.join(g.authoring, "workspace"), template }), "AUTHORING_WORKSPACE_UNCLAIMED");

  const linked = fixture(), linkedWorkspace = path.join(linked.authoring, "workspace");
  fs.mkdirSync(linkedWorkspace);
  const externalMarker = path.join(linked.base, "external-marker.json");
  put(externalMarker, `${JSON.stringify({
    schema: "webgal-attachment-authoring-workspace", schemaVersion: 2, userOwned: true,
  })}\n`);
  fs.linkSync(externalMarker, path.join(linkedWorkspace, ".webgal-attachment-authoring-workspace.json"));
  const linkedBefore = snapshot(linked.base);
  errorCode(() => initializeAuthoringWorkspace({
    authoringRoot: linked.authoring,
    authorizedWorkspaceRoot: linkedWorkspace,
    template: null,
  }), "TERRE_HARDLINK_BLOCKED");
  assert.deepEqual(snapshot(linked.base), linkedBefore);

  const h = fixture(), conflictingTemplateRoot = path.join(h.base, "conflicting-template");
  put(path.join(conflictingTemplateRoot, ".webgal-attachment-authoring-workspace.json"), "template collision");
  const conflictingTemplate = pinTree(conflictingTemplateRoot, "USER_LOCAL_PROJECT");
  fs.rmdirSync(h.authoring);
  assert.throws(
    () => initializeAuthoringWorkspace({ authoringRoot: h.authoring, authorizedWorkspaceRoot: path.join(h.authoring, "workspace"), template: conflictingTemplate }),
    (error) => error.code === "EEXIST"
  );
  assert.equal(fs.existsSync(path.join(h.authoring, "workspace")), false);
  if (fs.existsSync(h.authoring)) assert.deepEqual(fs.readdirSync(h.authoring), []);
});

test("first authoring initialization preserves external root and staging race evidence", () => {
  const prepare = () => {
    const f = fixture(), templateRoot = path.join(f.base, "first-start-template");
    put(path.join(templateRoot, "index.html"), "engine");
    put(path.join(templateRoot, "game/scene/start.txt"), "template scene");
    const template = pinTree(templateRoot, "USER_LOCAL_PROJECT");
    fs.rmdirSync(f.authoring);
    return { f, template, templateRoot };
  };

  const tampered = prepare();
  fs.appendFileSync(path.join(tampered.templateRoot, "index.html"), "changed");
  errorCode(() => initializeAuthoringWorkspace({
    authoringRoot: tampered.f.authoring,
    authorizedWorkspaceRoot: path.join(tampered.f.authoring, "workspace"),
    template: tampered.template,
  }), "AUTHORING_TEMPLATE_HASH_MISMATCH");
  assert.equal(fs.existsSync(tampered.f.authoring), false);

  const appeared = prepare(), rootSentinel = path.join(appeared.f.authoring, "external-root.txt");
  errorCode(() => initializeAuthoringWorkspace({
    authoringRoot: appeared.f.authoring,
    authorizedWorkspaceRoot: path.join(appeared.f.authoring, "workspace"),
    template: appeared.template,
    fault(phase, context) {
      if (phase === "before-root-create") {
        fs.mkdirSync(context.authoringRoot);
        fs.writeFileSync(rootSentinel, "external root");
      }
    },
  }), "AUTHORING_ROOT_APPEARED");
  assert.equal(fs.readFileSync(rootSentinel, "utf8"), "external root");

  const added = prepare();
  let addedSentinel;
  errorCode(() => initializeAuthoringWorkspace({
    authoringRoot: added.f.authoring,
    authorizedWorkspaceRoot: path.join(added.f.authoring, "workspace"),
    template: added.template,
    fault(phase, context) {
      if (phase === "before-workspace-commit") {
        addedSentinel = path.join(context.stage, "external-stage.txt");
        fs.writeFileSync(addedSentinel, "external stage");
      }
    },
  }), "AUTHORING_WORKSPACE_STAGE_CHANGED");
  assert.equal(fs.existsSync(path.join(added.f.authoring, "workspace")), false);
  assert.equal(fs.readFileSync(addedSentinel, "utf8"), "external stage");

  const replaced = prepare();
  let replacementSentinel, movedStage;
  errorCode(() => initializeAuthoringWorkspace({
    authoringRoot: replaced.f.authoring,
    authorizedWorkspaceRoot: path.join(replaced.f.authoring, "workspace"),
    template: replaced.template,
    fault(phase, context) {
      if (phase === "before-workspace-commit") {
        movedStage = `${context.stage}.externally-moved`;
        fs.renameSync(context.stage, movedStage);
        fs.mkdirSync(context.stage);
        replacementSentinel = path.join(context.stage, "replacement.txt");
        fs.writeFileSync(replacementSentinel, "replacement stage");
      }
    },
  }), "AUTHORING_WORKSPACE_STAGE_CHANGED");
  assert.equal(fs.existsSync(path.join(replaced.f.authoring, "workspace")), false);
  assert.equal(fs.readFileSync(replacementSentinel, "utf8"), "replacement stage");
  assert.equal(fs.existsSync(path.join(movedStage, ".webgal-attachment-authoring-workspace.json")), true);
});

function launcherConfig(f) {
  const templateRoot = path.join(f.base, "template-launch");
  put(path.join(templateRoot, "index.html"), "local template");
  put(path.join(templateRoot, "game/scene/start.txt"), "authoring only");
  const buildRoot = path.join(task, "build-output");
  const managementRoot = path.join(f.base, "management"); fs.mkdirSync(managementRoot);
  return {
    schema: "webgal-attachment-creator-launch", schemaVersion: 1, port: 0,
    managementRoot, statePath: path.join(managementRoot, "creator-session-v1.json"), resources: resourcesSpec,
    workspace: { authoringRoot: f.authoring, authorizedWorkspaceRoot: path.join(f.authoring, "workspace"), template: pinTree(templateRoot, "USER_LOCAL_PROJECT") },
    terre: { ...f.options, authorizedAuthoringRoot: f.authoring, authorizedAuthoringWorkspaceRoot: path.join(f.authoring, "workspace") },
    workbench: pinTree(path.join(buildRoot, "creator")), preview: pinTree(path.join(buildRoot, "preview")),
  };
}

test("launcher obeys the shared lifecycle lock before user or manager writes", async () => {
  const f = fixture(), config = launcherConfig(f), configPath = path.join(f.base, "creator-launch.json");
  put(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const lockPath = path.join(f.install, ".webgal-attachment.lifecycle.lock");
  put(lockPath, `${JSON.stringify({
    schema: "webgal-attachment-lifecycle-lock", schemaVersion: 1, token: "test-live-installer",
    pid: process.pid, hostRoot: f.install, role: "installer", acquiredAt: new Date().toISOString(),
  }, null, 2)}\n`);
  const before = snapshot(f.base);
  await assert.rejects(startCreatorLaunch(configPath, { open: false, log: () => undefined, testOnlySkipInstalledIdentity: true }),
    (error) => error.code === "PRODUCT_LIFECYCLE_BUSY");
  assert.deepEqual(snapshot(f.base), before);
  fs.rmSync(lockPath);
});

test("launcher fails closed for a dead legacy v1 lifecycle lock", async () => {
  const f = fixture(), config = launcherConfig(f), configPath = path.join(f.base, "creator-launch.json");
  put(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const lockPath = path.join(f.install, ".webgal-attachment.lifecycle.lock");
  put(lockPath, `${JSON.stringify({
    schema: "webgal-attachment-lifecycle-lock", schemaVersion: 1, token: "test-dead-legacy-installer",
    pid: 2147483647, hostRoot: f.install, role: "installer", acquiredAt: new Date().toISOString(),
  }, null, 2)}\n`);
  const before = snapshot(f.base);
  await assert.rejects(startCreatorLaunch(configPath, { open: false, log: () => undefined, testOnlySkipInstalledIdentity: true }),
    (error) => error.code === "PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
  assert.deepEqual(snapshot(f.base), before);
  fs.rmSync(lockPath);
});

test("launcher rejects a config generation change between snapshot and lifecycle lock", async () => {
  const f = fixture(), config = launcherConfig(f), configPath = path.join(f.base, "creator-launch.json");
  put(configPath, `${JSON.stringify(config, null, 2)}\n`);
  let afterChange;
  await assert.rejects(startCreatorLaunch(configPath, {
    open: false, log: () => undefined, testOnlySkipInstalledIdentity: true,
    testOnlyAfterInitialSnapshot: async () => {
      put(configPath, `${JSON.stringify({ ...config, port: 1 }, null, 2)}\n`);
      afterChange = snapshot(f.base);
    },
  }), (error) => error.code === "PRODUCT_LAUNCH_SNAPSHOT_STALE");
  assert.deepEqual(snapshot(f.base), afterChange);
  assert.equal(fs.existsSync(path.join(f.install, ".webgal-attachment.lifecycle.lock")), false);
  assert.equal(fs.existsSync(path.join(f.install, ".webgal-attachment.lifecycle.lock.acquire")), false);
});

test("launcher check has no writes; isolated start logs, serves, authenticates stop, removes state, and releases port", async () => {
  const f = fixture(), config = launcherConfig(f), configPath = path.join(f.base, "creator-launch.json");
  put(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const before = snapshot(f.base), checked = await checkCreatorLaunch(configPath);
  assert.equal(checked.status, "CHECK_ONLY_NO_WRITES"); assert.equal(checked.resourceFiles, 144); assert.deepEqual(snapshot(f.base), before);
  const logs = [], running = startCreatorLaunch(configPath, {
    open: false, log: (event) => logs.push(event), testOnlySkipInstalledIdentity: true,
  });
  const statePath = config.statePath;
  for (let i = 0; i < 200 && !fs.existsSync(statePath); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(fs.existsSync(statePath));
  const lifecycleLockPath = path.join(f.install, ".webgal-attachment.lifecycle.lock");
  const lifecycleLock = JSON.parse(fs.readFileSync(lifecycleLockPath, "utf8"));
  assert.equal(lifecycleLock.schemaVersion, 2); assert.equal(lifecycleLock.role, "creator");
  assert.equal(fs.existsSync(`${lifecycleLockPath}.acquire`), false);
  const state = JSON.parse(fs.readFileSync(statePath));
  const health = await fetch(`${state.origin}/__rc1/health`, { headers: { "X-Creator-Session": state.token } }).then((r) => r.json());
  assert.equal(health.ok, true); assert.equal(health.workbenchConfigured, true);
  const stopped = await stopCreatorLaunch(configPath); assert.equal(stopped.scope, "OWNED_SERVER_ONLY");
  const result = await running; assert.equal(result.ok, true); assert.equal(fs.existsSync(statePath), false);
  assert.equal(fs.existsSync(lifecycleLockPath), false);
  assert.deepEqual(logs.map((x) => x.type), ["launcher.ready", "launcher.stopped"]);
  const port = Number(new URL(state.origin).port), probe = (await import("node:http")).createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(port, "127.0.0.1", resolve));
  await new Promise((resolve, reject) => probe.close((e) => e ? reject(e) : resolve()));
});

test.after(() => {
  assert.ok(path.resolve(run).startsWith(path.resolve(task) + path.sep));
});


test('stop is idempotent for absent/dead owned session and refuses live unreachable/foreign state', async () => {
 const f=fixture(),config=launcherConfig(f),p=path.join(f.base,'creator-launch.json');put(p,JSON.stringify(config));
 assert.equal((await stopCreatorLaunch(p)).status,'ALREADY_STOPPED');
 const state={schema:'webgal-attachment-creator-session',schemaVersion:1,configPath:p,hostRoot:f.install,managerGenerationId:null,pid:2147483647,origin:'http://127.0.0.1:1',token:'a'.repeat(64)};
 put(config.statePath,JSON.stringify(state));assert.equal((await stopCreatorLaunch(p)).status,'ALREADY_STOPPED_CLEANED');assert.equal(fs.existsSync(config.statePath),false);
 put(config.statePath,JSON.stringify({...state,pid:process.pid}));const before=fs.readFileSync(config.statePath);await assert.rejects(()=>stopCreatorLaunch(p),{code:'PRODUCT_CREATOR_STOP_UNREACHABLE'});assert.ok(fs.readFileSync(config.statePath).equals(before));
 put(config.statePath,JSON.stringify({...state,hostRoot:path.join(f.install,'foreign')}));await assert.rejects(()=>stopCreatorLaunch(p),{code:'PRODUCT_CREATOR_SESSION_INVALID'});assert.ok(fs.existsSync(config.statePath));
});
