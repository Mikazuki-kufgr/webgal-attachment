import fs from "node:fs";
import { creatorScenePath } from '../runtime/creator-scene-name.mjs';
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixture,
  payload,
  put,
  snapshot,
  mutateDocument,
} from "./creator-fixtures.mjs";
import { createCreatorStore } from "../runtime/creator-store.mjs";
import { createCreatorService } from "../runtime/creator-service.mjs";
import { createCreatorWebHost } from "../runtime/creator-web-host.mjs";
import { createTerreProjectAccess } from "../runtime/terre-project-access.mjs";
import { sha } from "../runtime/creator-package.mjs";

test("close during listen waits for bind and leaves no orphan listener", async () => {
  const f = workspace(),
    service = createCreatorService(f.options),
    reserve = net.createServer();
  await new Promise((resolve, reject) => {
    reserve.once("error", reject);
    reserve.listen(0, "127.0.0.1", resolve);
  });
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const listening = service.listen(port);
  const rejected = assert.rejects(listening, /CREATOR_SERVICE_CLOSED/);
  await service.close();
  await rejected;
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
});

function workspace(hooks = {}) {
  const f = fixture(),
    root = path.join(f.authoring, "workspace");
  put(root + "/game/config.txt", "Game_name:隔离作者工作区;");
  put(root + "/game/scene/start.txt", "保留作者原剧情;");
  put(
    root + "/game/figure/anon/test/model.json",
    JSON.stringify({ model: ".chara/model.moc", motions: { "anon/idle01": [{ file: "idle.mtn" }] } })
  );
  put(root + "/game/figure/anon/test/.chara/model.moc", "legacy moc fixture");
  put(root + "/game/figure/anon/test/idle.mtn", "fixture motion");
  put(
    root + "/game/figure/anon/.mtn_exp/motions/PARAM_IMPORT__37/anon/idle01.mtn",
    "legacy motion fixture"
  );
  const shared = {
    "assets/templates/Derivative_Engine/MyGO_v3.2.1/lib/live2d.min.js":
      "/* shared host resource fixture, not SDK */",
    "assets/templates/Derivative_Engine/MyGO_v3.2.1/icons/favicon.ico": "fixture icon",
  };
  for (const [relative, bytes] of Object.entries(shared)) {
    put(path.join(f.install, relative), bytes);
    f.options.hostFiles.push({ path: relative, sha256: sha(Buffer.from(bytes)) });
  }
  const options = { ...f.options, authorizedAuthoringWorkspaceRoot: root };
  return {
    ...f,
    root,
    options,
    store: () => createCreatorStore(options, hooks),
  };
}

test("local figure discovery tolerates editable JSON and separates modified moc for review", () => {
  const f = workspace(),
    moc = fs.readFileSync(f.root + "/game/figure/anon/test/.chara/model.moc"),
    profile = (id, mocSha256, modelPath = "./game/figure/anon/test/model.json") => ({
      schema: "webgal-live2d-model-profile",
      schemaVersion: 1,
      profileVersion: 1,
      modelProfileId: id,
      characterId: "anon",
      modelId: "test",
      modelPath,
      fingerprint: {
        // Deliberately unrelated: harmless model.json edits are not a geometry gate.
        modelJsonSha256: "A".repeat(64),
        mocSha256,
        drawableCount: 1,
      },
      anchors: [],
    }),
    profiles = {
      exact: profile("exact", sha(moc)),
      modified: profile("modified", "B".repeat(64)),
      missing: profile("missing", sha(moc), "./game/figure/anon/absent/model.json"),
    };
  put(
    f.authoring + "/library/model-profiles/index.json",
    JSON.stringify({
      schema: "webgal-live2d-model-profile-index",
      schemaVersion: 1,
      profiles: Object.keys(profiles),
    })
  );
  for (const [id, value] of Object.entries(profiles)) {
    put(f.authoring + `/library/model-profiles/${id}.json`, JSON.stringify(value));
  }
  const store = f.store(),
    context = store.context();
  assert.deepEqual(context.authoringWorkspace.availableModelProfileIds, ["exact"]);
  assert.deepEqual(context.authoringWorkspace.reviewModelProfileIds, ["modified"]);
  assert.equal(context.authoringWorkspace.unavailableModelProfileCount, 1);
  assert.equal(context.authoringWorkspace.modelAvailabilityStatus, "READY_WITH_USER_REVIEW_MODELS");
  store.close();
});
function build(root, label) {
  const entries = {
    "index.html": `<!doctype html><html><head><script type="module" src="./assets/main.js"></script></head><body>${label}</body></html>`,
    "assets/main.js": `export const fixture = ${JSON.stringify(label)};`,
    "assets/style.css": "body { color: black; }",
  };
  for (const [p, b] of Object.entries(entries)) put(root + "/" + p, b);
  return {
    root,
    files: Object.entries(entries).map(([p, b]) => ({
      path: p,
      sha256: sha(Buffer.from(b)),
    })),
  };
}

test('attachment-only inventory does not enumerate unrelated Profile library and keeps fresh saved rows', () => {
  const f=workspace(), store=f.store(), readdir=fs.readdirSync;
  let profileScans=0;
  fs.readdirSync=function(p,...args){if(String(p).includes('model-profiles'))profileScans++;return readdir.call(this,p,...args);};
  try {
    const result=store.authoringAttachments();
    assert.equal(result.ok,true);
    assert.deepEqual(result.savedAttachments,store.context().authoringWorkspace.savedAttachments);
    profileScans=0;
    store.authoringAttachments();
    assert.equal(profileScans,0);
  } finally {fs.readdirSync=readdir;store.close();}
});

test("authoring capability is exact, opaque and never inferred from library grant", async (t) => {
  await t.test("library grant alone does not grant workspace", () => {
    const f = workspace(),
      options = { ...f.options };
    delete options.authorizedAuthoringWorkspaceRoot;
    const access = createTerreProjectAccess(options);
    assert.throws(
      () => access.openAuthoringWorkspace(),
      /WORKSPACE_NOT_AUTHORIZED/
    );
    access.close();
  });
  await t.test(
    "workspace must be exact authoring child and require authoring grant",
    () => {
      const f = workspace();
      assert.throws(
        () =>
          createTerreProjectAccess({
            ...f.options,
            authorizedAuthoringWorkspaceRoot: f.project,
          }),
        /WORKSPACE_NOT_AUTHORIZED/
      );
      assert.throws(
        () =>
          createTerreProjectAccess({
            ...f.options,
            authorizedAuthoringRoot: undefined,
          }),
        /WORKSPACE_NOT_AUTHORIZED/
      );
    }
  );
  await t.test("opaque workspace handle and narrow scene write guard", () => {
    const f = workspace(),
      access = createTerreProjectAccess(f.options),
      h = access.openAuthoringWorkspace();
    assert.equal(access.inspectProject(h).projectRoot, f.root);
    assert.throws(() => access.inspectProject({ ...h }), /CAPABILITY_INVALID/);
    assert.throws(
      () => access.planAttachmentWrite(h, "game/scene/start.txt"),
      /WRITE_SCOPE_INVALID/
    );
    assert.match(
      access.planCreatorSceneWrite(h, "test-hat").path,
      /ATTACHMENT-CREATOR-PREVIEW-test-hat\.txt$/
    );
    access.close();
  });
  await t.test(
    "workspace generation replacement invalidates capability",
    () => {
      const f = workspace(),
        access = createTerreProjectAccess(f.options),
        h = access.openAuthoringWorkspace();
      fs.renameSync(f.root, f.root + "-previous");
      put(f.root + "/game/config.txt", "replacement");
      put(f.root + "/game/scene/start.txt", "replacement");
      assert.throws(
        () => access.inspectProject(h),
        /PROJECT_CHANGED_REAUTHORIZE/
      );
      access.close();
    }
  );
});

test("authoring load/apply reuses exact ownership/revision/merge transaction", async (t) => {
  await t.test(
    "new save then exact adaptation open; no original scene or game writes",
    () => {
      const f = workspace(),
        store = f.store(),
        before = snapshot(f.project),
        original = fs.readFileSync(f.root + "/game/scene/start.txt");
      assert.throws(
        () => store.applyAuthoringPackage(payload()),
        /EXPECTED_REVISION_REQUIRED/
      );
      const saved = store.applyAuthoringPackage({
        ...payload(),
        expectedRevision: null,
      });
      assert.equal(saved.ok, true);
      assert.equal(
        saved.exampleScene,
        creatorScenePath("v2/test-hat", "中文附件")
      );
      assert.equal(saved.previewUrl, "/preview/");
      assert.throws(
        () => store.openAuthoringProject({ presetId: "v2/test-hat" }),
        /EXPLICIT_ADAPTATION_REQUIRED/
      );
      assert.throws(
        () =>
          store.openAuthoringProject({
            presetId: "v2/test-hat",
            modelProfileId: "absent",
          }),
        /EXPLICIT_ADAPTATION_NOT_FOUND/
      );
      const opened = store.openAuthoringProject({
        presetId: "v2/test-hat",
        modelProfileId: "profile-a",
      });
      assert.equal(opened.revision, saved.revision);
      assert.equal(opened.profile.modelProfileId, "profile-a");
        assert.equal(opened.ownership.status, "CONTENT_VALIDATION_ON_SAVE");
        assert.equal(opened.project.safeCopy, false);
        assert.equal(opened.project.dedicatedWorkspace, true);
      assert.equal(
        store.context().authoringWorkspace.savedAttachments.length,
        1
      );
      assert.deepEqual(snapshot(f.project), before);
      assert.deepEqual(
        fs.readFileSync(f.root + "/game/scene/start.txt"),
        original
      );
      store.close();
    }
  );
  await t.test(
    "same path different Profile survives and selected Profile returned",
    () => {
      const f = workspace(),
        store = f.store();
      const a = store.applyAuthoringPackage({
        ...payload(),
        expectedRevision: null,
      });
      const b = store.applyAuthoringPackage({
        ...payload({ profileId: "profile-b" }),
        expectedRevision: a.revision,
      });
      assert.equal(b.ok, true);
      const opened = store.openAuthoringProject({
        presetId: "v2/test-hat",
        modelProfileId: "profile-b",
      });
      assert.equal(opened.packageDocument.adaptations.length, 2);
      assert.equal(opened.profile.modelProfileId, "profile-b");
      assert.throws(
        () =>
          store.applyAuthoringPackage({
            ...payload(),
            expectedRevision: a.revision,
          }),
        /STALE_DRAFT/
      );
      store.close();
    }
  );
  await t.test(
    "foreign files conflict before any authoring save writes",
    () => {
      const f = workspace(),
        store = f.store();
      put(
        f.root + "/game/attachments-v2/portable/test-hat/images/front.png",
        "user PNG text fixture"
      );
      const before = snapshot(f.root);
      const result = store.applyAuthoringPackage({
        ...payload(),
        expectedRevision: null,
      });
      assert.equal(result.ok, false);
      assert.deepEqual(snapshot(f.root), before);
      store.close();
    }
  );
  await t.test(
    "commit fault reverses authoring save and preserves project",
    () => {
      const f = workspace({
          fault(stage) {
            if (stage === "installed") throw new Error("injected");
          },
        }),
        store = f.store(),
        before = snapshot(f.root);
      assert.throws(
        () =>
          store.applyAuthoringPackage({ ...payload(), expectedRevision: null }),
        /injected/
      );
      assert.deepEqual(snapshot(f.root), before);
      store.close();
    }
  );
  await t.test(
    "selected workspace root cannot be supplied by browser body",
    () => {
      const f = workspace(),
        store = f.store(),
        before = snapshot(f.project);
      const result = store.applyAuthoringPackage({
        ...payload(),
        expectedRevision: null,
        projectRoot: f.project,
        projectName: "Other",
      });
      assert.equal(result.projectRoot, f.root);
      assert.deepEqual(snapshot(f.project), before);
      store.close();
    }
  );
  await t.test("missing model stays a visible pre-write error", () => {
    const f = workspace(),
      store = f.store(),
      before = snapshot(f.root);
    assert.throws(
      () =>
        store.applyAuthoringPackage({
          ...payload({ modelPath: "./game/figure/missing/model.json" }),
          expectedRevision: null,
        }),
      /MISSING/
    );
    assert.deepEqual(snapshot(f.root), before);
    store.close();
  });
  await t.test(
    "catalog embeds validated documents, respects workspace override and never writes or guesses model files",
    () => {
      const f = workspace(),
        store = f.store();
      const catalog = Buffer.from(
        '{"schema":"webgal-live2d-model-profile-index","schemaVersion":1,"profiles":[],"note":"existing library bytes"}'
      );
      put(f.authoring + "/library/model-profiles/index.json", catalog);
      const before = snapshot(f.root);
      assert.deepEqual(JSON.parse(store.readAuthoringResource("game/attachments-v2/model-profiles/index.json")),{...JSON.parse(catalog),profileDocuments:{}});
      assert.deepEqual(snapshot(f.root), before);
      put(
        f.root + "/game/attachments-v2/model-profiles/index.json",
        "workspace bytes first"
      );
      assert.throws(()=>store.readAuthoringResource("game/attachments-v2/model-profiles/index.json"), /JSON|Unexpected/);
      assert.throws(
        () => store.readAuthoringResource("game/figure/unknown/model.json"),
        /MISSING/
      );
      assert.throws(
        () =>
          store.readAuthoringResource(
            "game/attachments-v2/model-profiles/../index.json"
          ),
        /PATH_INVALID/
      );
      store.close();
    }
  );
});

test("pinned build resource resolver has no arbitrary source/fallback reads", async (t) => {
  const f = workspace(),
    store = f.store(),
    workbench = build(f.base + "/creator", "Creator fixture"),
    preview = build(f.base + "/preview", "Runtime fixture"),
    web = createCreatorWebHost({ workbench, preview }, store);
  await t.test("creator and normal runtime resources stay separate", () => {
    assert.match(
      web.read("/", "a".repeat(64)).bytes.toString(),
      /webgal-creator-session/
    );
    assert.doesNotMatch(
      web.read("/preview/", "a".repeat(64)).bytes.toString(),
      /webgal-creator-session/
    );
    assert.match(
      web.read("/preview/assets/main.js", "").bytes.toString(),
      /Runtime fixture/
    );
    assert.match(web.read("/game/config.txt", "").bytes.toString(), /隔离作者/);
    assert.match(
      web.read("/preview/game/config.txt", "").bytes.toString(),
      /隔离作者/
    );
    assert.match(
      web.read("/lib/live2d.min.js", "").bytes.toString(),
      /shared host resource/
    );
    assert.equal(web.read("/favicon.ico", "").bytes.toString(), "fixture icon");
    assert.throws(
      () => web.read("/game/figure/unknown/model.json", ""),
      /MISSING/
    );
    assert.equal(web.ensurePreview().runtimeCompatibility, "NOT_GUI_VALIDATED");
  });
  await t.test("exact MyGO legacy model resource directories remain readable", () => {
    assert.equal(
      web.read("/game/figure/anon/test/.chara/model.moc", "a".repeat(64)).bytes.toString(),
      "legacy moc fixture"
    );
    assert.equal(
      web
        .read(
          "/game/figure/anon/.mtn_exp/motions/PARAM_IMPORT__37/anon/idle01.mtn",
          "a".repeat(64)
        )
        .bytes.toString(),
      "legacy motion fixture"
    );
    for (const hidden of [
      "/game/figure/anon/.git/config.txt",
      "/game/figure/anon/test/.chara/.secret.txt",
      "/game/attachments-v2/.webgal-attachment-creator/ownership.json",
    ]) assert.throws(() => web.read(hidden, "a".repeat(64)), /STATIC_SCOPE_INVALID/);
  });
  for (const p of [
    "/../private.txt",
    "/%2e%2e/private.txt",
    "/game%2fconfig.txt",
    "/game/%252e%252e/private.txt",
    "/game/.secret.txt",
    "/assets/main.js.map",
    "/assets/unknown.js",
    "/WebGAL_Terre.exe",
    "//assets/main.js",
  ])
    await t.test("rejects " + p, () => assert.throws(() => web.read(p, "")));
  await t.test(
    "build tamper fails closed rather than shared-engine fallback",
    () => {
      put(workbench.root + "/assets/main.js", "changed");
      assert.throws(
        () => web.read("/assets/main.js", ""),
        /BUILD_CHANGED_RESTART_REQUIRED/
      );
    }
  );
  await t.test("build proof mandatory and mismatch rejected at factory", () => {
    assert.throws(
      () =>
        createCreatorWebHost(
          { workbench: { root: workbench.root, files: [] } },
          store
        ),
      /BUILD_PROOF_REQUIRED/
    );
    assert.throws(
      () => createCreatorWebHost({ workbench }, store),
      /BUILD_FINGERPRINT_MISMATCH/
    );
  });
  store.close();
});

test("optional font reads live host bytes without copying or pinning; missing uses fallback", () => {
  const f = workspace(), store = f.store();
  const workbench = build(f.base + "/font-creator", "Creator fixture");
  const web = createCreatorWebHost({ workbench, preview: workbench }, store);
  const relative = "assets/OPPOSans-R-tAcFw8I3.ttf";
  const target = path.join(f.install, "assets/templates/Derivative_Engine/MyGO_v3.2.1", relative);
  assert.equal(web.read('/' + relative, '').status, 404);
  put(target, 'user font fixture A');
  assert.equal(web.read('/' + relative, '').bytes.toString(), 'user font fixture A');
  put(target, 'user font fixture B');
  assert.equal(web.read('/preview/' + relative, '').bytes.toString(), 'user font fixture B');
  assert(!fs.existsSync(path.join(workbench.root, relative)));
  assert.throws(() => store.readOptionalHostFont('assets/other.ttf'), /PATH_INVALID/);
  for (const name of ['ResourceHanRoundedCN-Regular-C1HdCLVq.ttf','SourceHanSerifCN-Regular-B_f-kQ2u.ttf']) {
    assert.equal(web.read('/assets/' + name, '').status, 404);
    put(path.join(f.install, 'assets/templates/Derivative_Engine/MyGO_v3.2.1/assets', name), 'user optional font');
    assert.equal(web.read('/assets/' + name, '').bytes.toString(), 'user optional font');
  }
  assert.throws(() => web.read('/assets/other.ttf', ''), /STATIC_FILE_NOT_FOUND/);
  store.close();
});

test("complete built-in samples are exposed from exact read-only library paths", () => {
  const f = workspace(),
    store = f.store(),
    libraryFiles = {
      "placement-presets/anon-straw-hat-both-v1.json": "straw preset",
      "attachment-assets/builtin-straw-hat-both-v1.json": "straw asset",
      "files/builtin-samples/straw-hat/back.png": "straw back",
      "files/builtin-samples/straw-hat/front.png": "straw front",
      "placement-presets/anon-kemomimi-front-v1.json": "kemomimi preset",
      "attachment-assets/builtin-kemomimi-front-v1.json": "kemomimi asset",
      "files/builtin-samples/kemomimi/front.png": "kemomimi front",
      "placement-presets/anon-halo-front-v1.json": "halo preset",
      "attachment-assets/builtin-halo-front-v1.json": "halo asset",
      "files/builtin-samples/halo/front.png": "halo front",
      "placement-presets/anon-flower-front-v1.json": "flower preset",
      "attachment-assets/builtin-flower-front-v1.json": "flower asset",
      "files/builtin-samples/flower/front.png": "flower front",
      "placement-presets/anon-rose-front-v1.json": "rose preset",
      "attachment-assets/builtin-rose-front-v1.json": "rose asset",
      "files/builtin-samples/rose/front.png": "rose front",
    };
  for (const [relative, bytes] of Object.entries(libraryFiles))
    put(path.join(f.authoring, "library", relative), bytes);
  const before = snapshot(f.root),
    context = store.context();
  assert.deepEqual(
    context.builtinSamples.map((sample) => sample.id),
    ["flower", "rose", "straw-hat", "kemomimi", "halo"]
  );
  assert.equal(context.builtinSamplesStatus, "READY_FROM_READ_ONLY_LIBRARY");
  for (const id of ["flower", "rose"]) {
    assert.equal(store.readAuthoringResource(`game/attachments-v2/presets/anon-${id}-front-v1.json`).toString(), `${id} preset`);
    assert.equal(store.readAuthoringResource(`game/attachments-v2/files/builtin-samples/${id}/front.png`).toString(), `${id} front`);
  }
  assert.equal(
    store
      .readAuthoringResource(
        "game/attachments-v2/presets/anon-straw-hat-both-v1.json"
      )
      .toString(),
    "straw preset"
  );
  assert.equal(
    store
      .readAuthoringResource(
        "game/attachments-v2/files/builtin-samples/halo/front.png"
      )
      .toString(),
    "halo front"
  );
  put(
    path.join(
      f.root,
      "game/attachments-v2/files/builtin-samples/halo/front.png"
    ),
    "workspace override"
  );
  assert.equal(
    store
      .readAuthoringResource(
        "game/attachments-v2/files/builtin-samples/halo/front.png"
      )
      .toString(),
    "workspace override"
  );
  assert.throws(
    () =>
      store.readAuthoringResource(
        "game/attachments-v2/files/builtin-samples/unknown/front.png"
      ),
    /MISSING/
  );
  assert.deepEqual(snapshot(f.root), {
    ...before,
    "game/attachments-v2/files/builtin-samples/halo/front.png":
      snapshot(f.root)[
        "game/attachments-v2/files/builtin-samples/halo/front.png"
      ],
  });
  store.close();
});

test("bounded real HTTP launch/meta/API/static/authoring/events closes its own listener", async (t) => {
  const f = workspace(),
    events = [],
    workbench = build(f.base + "/creator", "Creator fixture"),
    preview = build(f.base + "/preview", "Runtime fixture");
  const builtinLibraryFiles = {
    "placement-presets/anon-straw-hat-both-v1.json": "straw preset",
    "attachment-assets/builtin-straw-hat-both-v1.json": "straw asset",
    "files/builtin-samples/straw-hat/back.png": "straw back",
    "files/builtin-samples/straw-hat/front.png": "straw front",
    "placement-presets/anon-kemomimi-front-v1.json": "kemomimi preset",
    "attachment-assets/builtin-kemomimi-front-v1.json": "kemomimi asset",
    "files/builtin-samples/kemomimi/front.png": "kemomimi front",
    "placement-presets/anon-halo-front-v1.json": "halo preset",
    "attachment-assets/builtin-halo-front-v1.json": "halo asset",
    "files/builtin-samples/halo/front.png": "halo front",
      "placement-presets/anon-flower-front-v1.json": "flower preset",
      "attachment-assets/builtin-flower-front-v1.json": "flower asset",
      "files/builtin-samples/flower/front.png": "flower front",
      "placement-presets/anon-rose-front-v1.json": "rose preset",
      "attachment-assets/builtin-rose-front-v1.json": "rose asset",
      "files/builtin-samples/rose/front.png": "rose front",
  };
  for (const [relative, bytes] of Object.entries(builtinLibraryFiles))
    put(path.join(f.authoring, "library", relative), bytes);
  const service = createCreatorService(f.options, {
      workbench,
      preview,
      log: (e) => events.push(e),
    }),
    address = await service.listen(0);
  let cookie;
  const request = (url, body, extra = {}) =>
    fetch(address.origin + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-creator-session": address.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
    });
  try {
    await t.test(
      "anonymous/foreign origin cannot read HTML or bootstrap token",
      async () => {
        const denied = await fetch(address.origin + "/");
        assert.equal(denied.status, 403);
        assert.ok(!(await denied.text()).includes(address.token));
        assert.equal(
          (
            await fetch(address.launchUrl, {
              headers: { Origin: "https://evil.example" },
              redirect: "manual",
            })
          ).status,
          403
        );
      }
    );
    await t.test(
      "secret launch establishes strict HttpOnly cookie, clean redirect, authenticated meta",
      async () => {
        const opened = await fetch(address.launchUrl, { redirect: "manual" });
        assert.equal(opened.status, 303);
        assert.equal(opened.headers.get("location"), "/");
        const raw = opened.headers.get("set-cookie");
        assert.match(raw, /HttpOnly; SameSite=Strict; Path=\//);
        cookie = raw.split(";")[0];
        const page = await fetch(address.origin + "/", {
          headers: { Cookie: cookie },
        });
        assert.equal(page.status, 200);
        assert.match(
          await page.text(),
          new RegExp(`name="webgal-creator-session" content="${address.token}"`)
        );
        assert.equal(page.headers.get("referrer-policy"), "no-referrer");
      }
    );
    await t.test(
      "cookie supports browser media but API requires session header",
      async () => {
        assert.equal(
          (
            await fetch(address.origin + "/assets/main.js", {
              headers: { Cookie: cookie },
            })
          ).status,
          200
        );
        assert.equal(
          (
            await fetch(address.origin + "/__creator/context", {
              headers: { Cookie: cookie },
            })
          ).status,
          403
        );
        assert.equal((await request("/__creator/context")).status, 200);
      }
    );
    await t.test(
      "built-in sample HTTP fallback succeeds without a false missing-path event",
      async () => {
        const resources = [
          "/game/attachments-v2/presets/anon-straw-hat-both-v1.json",
          "/game/attachments-v2/assets/builtin-straw-hat-both-v1.json",
          "/game/attachments-v2/files/builtin-samples/straw-hat/back.png",
          "/game/attachments-v2/files/builtin-samples/straw-hat/front.png",
          "/game/attachments-v2/presets/anon-kemomimi-front-v1.json",
          "/game/attachments-v2/assets/builtin-kemomimi-front-v1.json",
          "/game/attachments-v2/files/builtin-samples/kemomimi/front.png",
          "/game/attachments-v2/presets/anon-halo-front-v1.json",
          "/game/attachments-v2/assets/builtin-halo-front-v1.json",
          "/game/attachments-v2/files/builtin-samples/halo/front.png",
        ];
        const eventStart = events.length;
        for (const resource of resources) {
          const response = await fetch(address.origin + resource, {
            headers: { Cookie: cookie },
          });
          assert.equal(response.status, 200, resource);
          assert.ok((await response.arrayBuffer()).byteLength > 0, resource);
        }
        assert.deepEqual(
          events.slice(eventStart).filter((event) => event.type === "request.failed"),
          []
        );
      }
    );
    await t.test("missing optional font is HTTP fallback without false request.failed", async () => {
      const start = events.length;
      const response = await request('/assets/OPPOSans-R-tAcFw8I3.ttf');
      assert.equal(response.status, 404);
      assert.deepEqual(events.slice(start).filter(e => e.type === 'request.failed'), []);
    });
    await t.test(
      "real authoring apply/open/static preview routes",
      async () => {
        const save = await request("/__rc1/apply", {
          ...payload(),
          expectedRevision: null,
        });
        assert.equal(save.status, 200);
        const saved = await save.json();
        const opened = await request("/__rc1/project", {
          presetId: "v2/test-hat",
          modelProfileId: "profile-a",
        });
        assert.equal((await opened.json()).revision, saved.revision);
        const ready = await request("/__creator/ensure-preview", {});
        assert.equal(
          (await ready.json()).readiness,
          "PINNED_SOURCE_FILES_SERVED"
        );
        const scene = await request("/preview/" + saved.exampleScene);
        assert.match(await scene.text(), /attachment:add/);
      }
    );
    await t.test(
      "events sanitize terminal controls and do not claim Runtime success",
      async () => {
        const result = await request("/__creator/events", {
          type: "preview.open-saved",
          result: "requested",
          detail: "a\u001b[31m\nb",
        });
        assert.equal((await result.json()).logged, true);
        assert.ok(!JSON.stringify(events).includes("\\u001b"));
        assert.equal(
          (await request("/__creator/events", { type: "bad\nvalue" })).status,
          400
        );
      }
    );
    await t.test(
      "explicit authenticated shutdown acknowledges then closes only owned listener",
      async () => {
        const forbidden = await fetch(address.origin + "/__creator/shutdown", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: "{}",
        });
        assert.equal(forbidden.status, 403);
        const response = await request("/__creator/shutdown", {});
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          ok: true,
          shutdown: "REQUESTED",
          scope: "OWNED_SERVER_ONLY",
        });
        await service.close();
        await service.close();
      }
    );
  } finally {
    await service.close();
  }
  const port = Number(new URL(address.origin).port),
    probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  put(
    f.base + "/http-lifecycle.json",
    JSON.stringify({
      pid: process.pid,
      port,
      closed: true,
      rebindVerified: true,
      gui: false,
      fixtureOnly: true,
    })
  );
});
