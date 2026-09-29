import { creatorScenePath } from '../runtime/creator-scene-name.mjs';
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixture,
  payload,
  mutateDocument,
  put,
  snapshot,
  encode,
  png,
  task,
} from "./creator-fixtures.mjs";
import {
  sha,
  jsonBytes,
  validatePayload,
} from "../runtime/creator-package.mjs";
import { createTerreProjectAccess } from "../runtime/terre-project-access.mjs";
import {
  buildCreatorPackage,
  createBlankCreatorDraft,
} from "../../16_creator-service-save/test-inputs/canonical-creator-producer.mjs";
const code = (fn, wanted) =>
  assert.throws(fn, (e) => (e.code ?? e.message).startsWith(wanted));
const own = "game/attachments-v2/.webgal-attachment-creator/game-save-v2.json";
const journal =
  "game/attachments-v2/.webgal-attachment-creator/transaction-v2.json";
const packageFile = "game/attachments-v2/portable/test-hat/attachment.json";
const scene = creatorScenePath("v2/test-hat", "中文附件");
function save(store, body) {
  let revision;
  try {
    revision = store.loadAttachment(body).revision;
  } catch (e) {
    if (e.code !== "CREATOR_SAVED_ATTACHMENT_NOT_FOUND") throw e;
  }
  return store.saveToGame({ ...body, expectedRevision: revision });
}

for (const mode of ["default", "custom", "portable"])
  test(`${mode}: ordinary source-only game, complete save/load/no-op, user scene untouched`, () => {
    const f = fixture(mode),
      s = f.store(),
      before = snapshot(f.project),
      body = payload({ both: true });
    const context = s.context();
    assert.equal(context.targetProjects.length, 1);
    assert.equal(context.targetProjects[0].writable, true);
    assert.equal(context.authoringWorkspace.status, "NOT_AUTHORIZED");
    const result = s.saveToGame(body);
    assert.equal(result.ok, true);
    assert.equal(result.created.length, 6);
    assert.equal(result.runtimeCompatibility, "NOT_VALIDATED");
    const loaded = s.loadAttachment(body);
    assert.equal(loaded.revision, result.revision);
    assert.equal(loaded.packageDocument.displayName, "中文附件");
    assert.equal(loaded.integrity, "HASH_VALIDATED");
    assert.equal(Object.keys(loaded.layers).length, 2);
    const after = snapshot(f.project);
    for (const [p, h] of Object.entries(before)) assert.equal(after[p], h);
    const again = save(s, body);
    assert.equal(again.noOp, true);
    assert.deepEqual(snapshot(f.project), after);
    assert.equal(s.context().savedAttachments.length, 1);
    s.close();
  });
test("same model path, distinct Profile IDs: A -> B -> A preserves two explicit adaptations and one PNG", () => {
  const f = fixture(),
    s = f.store();
  save(s, payload());
  save(s, payload({ profileId: "profile-b" }));
  const renamed = mutateDocument(
    payload({ displayName: "改名不改身份" }),
    (d) => (d.adaptations[0].preset.placement.offset.x = 23)
  );
  save(s, renamed);
  const l = s.loadAttachment(renamed);
  assert.deepEqual(
    l.packageDocument.adaptations.map((a) => a.modelProfile.modelProfileId),
    ["profile-a", "profile-b"]
  );
  assert.equal(l.packageDocument.adaptations[0].preset.placement.offset.x, 23);
  assert.equal(l.packageDocument.adaptations[1].preset.placement.offset.x, 0);
  assert.equal(l.presetId, "v2/test-hat");
  assert.equal(
    fs.readdirSync(f.project + "/game/attachments-v2/portable/test-hat/images")
      .length,
    1
  );
  s.close();
});
test("same Profile head and hand survive local save, reorder and a second head edit", () => {
  const pair = (anchor, x) => {
    const body = mutateDocument(payload(), (doc) => {
      const row = doc.adaptations[0];
      row.modelProfile.anchors.push({ name: "user.hand" });
      row.preset.anchorName = anchor;
      row.preset.placement.offset.x = x;
    });
    const file = body.files.find((f) => f.path.endsWith("/manifest.json"));
    const manifest = JSON.parse(Buffer.from(file.base64, "base64"));
    manifest.anchorName = anchor;
    Object.assign(file, encode(file.path, jsonBytes(manifest)));
    body.anchorName = anchor;
    return body;
  };
  const f = fixture(), store = f.store();
  save(store, pair("head", 11));
  save(store, pair("user.hand", 77));
  save(store, pair("head", 33));
  const loaded = store.loadAttachment(pair("head", 33));
  assert.deepEqual(loaded.packageDocument.adaptations.map((row) =>
    [row.preset.anchorName, row.preset.placement.offset.x]), [["head", 33], ["user.hand", 77]]);
  assert.equal(fs.readdirSync(f.project + "/game/attachments-v2/portable/test-hat/images").length, 1);
  store.close();
});
test("stale client revision cannot overwrite another client save", () => {
  const f = fixture(),
    a = f.store(),
    b = f.store(),
    p = payload(),
    r = save(a, p);
  save(b, payload({ displayName: "second" }));
  const before = snapshot(f.project);
  code(
    () => a.saveToGame({ ...p, expectedRevision: r.revision }),
    "CREATOR_STALE_DRAFT"
  );
  assert.deepEqual(snapshot(f.project), before);
  a.close();
  b.close();
});
for (const where of [
  "unowned-scene",
  "edited-owned-scene",
  "foreign-package-image",
])
  test(`preflight ${where}: all-or-nothing conflict, no new ownership/directory effects`, () => {
    const f = fixture(),
      s = f.store();
    if (where === "edited-owned-scene") save(s, payload());
    if (where === "foreign-package-image")
      put(
        f.project + "/game/attachments-v2/portable/test-hat/images/front.png",
        Buffer.from("foreign png")
      );
    else put(f.project + "/" + (where === "unowned-scene" ? creatorScenePath("v2/test-hat", "changed") : scene), "手改剧情;");
    const before = snapshot(f.project),
      result = save(s, payload({ displayName: "changed" }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "CREATOR_GAME_FILE_CONFLICT");
    assert.deepEqual(snapshot(f.project), before);
    assert.equal(fs.existsSync(f.project + "/" + journal), false);
    s.close();
  });
test("identical foreign file stays unowned and later differing save conflicts", () => {
  const f = fixture(),
    s = f.store(),
    p = payload();
  const file = p.files.find((x) => x.path.endsWith("/使用说明.txt"));
  put(f.project + "/" + file.path, Buffer.from(file.base64, "base64"));
  save(s, p);
  const ledger = JSON.parse(fs.readFileSync(f.project + "/" + own));
  assert.equal(
    ledger.files.some((x) => x.path === file.path),
    false
  );
  const modified = structuredClone(p),
    m = modified.files.find((x) => x.path === file.path);
  Object.assign(m, encode(m.path, Buffer.from("new description")));
  const manifest = modified.files.at(-1),
    doc = JSON.parse(Buffer.from(manifest.base64, "base64"));
  doc.files = modified.files
    .slice(0, -1)
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  Object.assign(manifest, encode(manifest.path, jsonBytes(doc)));
  const before = snapshot(f.project);
  assert.equal(save(s, modified).ok, false);
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
test("owned scene BOM/CRLF equivalence accepted, substantive edits conflict", () => {
  const f = fixture(),
    s = f.store();
  save(s, payload());
  const source = fs.readFileSync(f.project + "/" + scene, "utf8");
  put(f.project + "/" + scene, "\uFEFF" + source.replaceAll("\n", "\r\n"));
  assert.equal(save(s, payload({ displayName: "renamed" })).ok, true);
  put(f.project + "/" + scene, source + "user edit");
  assert.equal(save(s, payload()).ok, false);
  s.close();
});
for (const phase of ["staged", "before-commit", "installed"])
  for (let failAt = 1; failAt <= 6; failAt++)
    test(`new save rollback: ${phase} ${failAt}`, () => {
      let count = 0;
      const f = fixture(
          "default",
          {},
          {
            fault: (p) => {
              if (p === phase && ++count === failAt) throw Error("INJECTED_IO");
            },
          }
        ),
        s = f.store(),
        before = snapshot(f.project);
      assert.throws(() => s.saveToGame(payload()), /INJECTED_IO/);
      assert.deepEqual(snapshot(f.project), before);
      assert.equal(fs.existsSync(f.project + "/game/attachments-v2"), false);
      s.close();
    });
for (const phase of ["staged", "before-commit", "installed"])
  for (let failAt = 1; failAt <= 3; failAt++)
    test(`owned update rollback: ${phase} ${failAt}`, () => {
      let enabled = false,
        count = 0;
      const f = fixture(
          "default",
          {},
          {
            fault: (p) => {
              if (enabled && p === phase && ++count === failAt)
                throw Error("INJECTED_UPDATE");
            },
          }
        ),
        s = f.store();
      save(s, payload());
      const before = snapshot(f.project);
      enabled = true;
      assert.throws(
        () => save(s, payload({ displayName: "rename" })),
        /INJECTED_UPDATE/
      );
      assert.deepEqual(snapshot(f.project), before);
      s.close();
    });
test("late foreign creation is not overwritten during commit; recover only own changes", () => {
  let once = false;
  const f = fixture(
      "default",
      {},
      {
        fault: (phase, p) => {
          if (phase === "before-commit" && p === scene && !once) {
            once = true;
            put(f.project + "/" + scene, "foreign late creation");
          }
        },
      }
    ),
    s = f.store(),
    before = snapshot(f.project);
  code(() => s.saveToGame(payload()), "TERRE_WRITE_TARGET_CHANGED");
  const after = snapshot(f.project);
  assert.equal(after[scene], sha(Buffer.from("foreign late creation")));
  delete after[scene];
  assert.deepEqual(after, before);
  s.close();
});
test("changed installed file during rollback is preserved, journal retained and next write blocked", () => {
  let once = false;
  const f = fixture(
      "default",
      {},
      {
        fault: (phase, p) => {
          if (phase === "installed" && p === packageFile && !once) {
            once = true;
            put(f.project + "/" + packageFile, "foreign during rollback");
            throw Error("INJECTED");
          }
        },
      }
    ),
    s = f.store();
  code(() => s.saveToGame(payload()), "CREATOR_RECOVERY_REQUIRED");
  assert.equal(
    fs.readFileSync(f.project + "/" + packageFile, "utf8"),
    "foreign during rollback"
  );
  assert.ok(fs.existsSync(f.project + "/" + journal));
  s.close();
  const resumed = f.store(),
    pending = snapshot(f.project);
  code(() => resumed.saveToGame(payload()), "CREATOR_RECOVERY_REQUIRED");
  assert.deepEqual(snapshot(f.project), pending);
  resumed.close();
  const access = createTerreProjectAccess(f.options);
  assert.ok(
    access.planAttachmentWrite(access.openProject("测试 Demo"), journal).exists
  );
  access.close();
});
test("existing recovery journal blocks save without touching anything", () => {
  const f = fixture(),
    s = f.store();
  put(f.project + "/" + journal, "pending recovery");
  const before = snapshot(f.project);
  code(() => s.saveToGame(payload()), "CREATOR_RECOVERY_REQUIRED");
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
test("abort before transaction has zero writes", () => {
  const f = fixture(),
    s = f.store(),
    a = new AbortController();
  a.abort();
  const before = snapshot(f.project);
  code(
    () => s.saveToGame(payload(), { signal: a.signal }),
    "CREATOR_SAVE_ABORTED"
  );
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
for (const kind of ["parent-junction", "leaf-hardlink", "leaf-junction"])
  test(`${kind}: save refuses paths with foreign identity`, () => {
    const f = fixture(),
      s = f.store(),
      outside = f.base + "/outside";
    put(outside + "/keep.txt", "foreign");
    if (kind === "parent-junction")
      fs.symlinkSync(outside, f.project + "/game/attachments-v2", "junction");
    else {
      const target =
        f.project + "/game/attachments-v2/portable/test-hat/images/front.png";
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (kind === "leaf-hardlink") fs.linkSync(outside + "/keep.txt", target);
      else fs.symlinkSync(outside, target, "junction");
    }
    const before = snapshot(outside);
    assert.throws(() => s.saveToGame(payload()), /REPARSE|HARDLINK/);
    assert.deepEqual(snapshot(outside), before);
    s.close();
  });
for (const bad of [
  "../escape",
  "game/attachments-v2/x:ads",
  "game/attachments-v2/CON.json",
  "game/scene/start.txt",
  "game/attachments-v2/a%2fb",
])
  test(`invalid payload path ${bad}`, () => {
    const f = fixture(),
      s = f.store(),
      p = payload();
    p.files[0].path = bad;
    const before = snapshot(f.project);
    assert.throws(() => s.saveToGame(p));
    assert.deepEqual(snapshot(f.project), before);
    s.close();
  });
for (const mutation of [
  "hash",
  "size",
  "base64",
  "manifest",
  "duplicate-profile",
  "missing-anchor",
  "local-reference",
  "png",
  "oversize",
  "asset-id",
  "model-script",
])
  test(`payload validation ${mutation}`, () => {
    const f = fixture(),
      s = f.store();
    let p = payload();
    if (mutation === "hash") p.files[0].sha256 = "0".repeat(64);
    if (mutation === "size") p.files[0].bytes++;
    if (mutation === "base64") p.files[0].base64 += "!!";
    if (mutation === "manifest") p.files.pop();
    if (mutation === "duplicate-profile")
      p = mutateDocument(p, (d) =>
        d.adaptations.push(structuredClone(d.adaptations[0]))
      );
    if (mutation === "missing-anchor")
      p = mutateDocument(
        p,
        (d) => (d.adaptations[0].preset.anchorName = "nose")
      );
    if (mutation === "local-reference")
      p = mutateDocument(
        p,
        (d) => (d.asset.layers.front = "C:/private/picture.png")
      );
    if (mutation === "png") {
      const f = p.files[1];
      Object.assign(f, encode(f.path, Buffer.from("not png")));
    }
    if (mutation === "oversize") p.files[0].bytes = 99 * 1024 * 1024;
    if (mutation === "asset-id") p.attachmentAssetId = "wrong";
    if (mutation === "model-script")
      p = payload({ modelPath: "./game/figure/anon/inject;-next/model.json" });
    const before = snapshot(f.project);
    assert.throws(() => s.saveToGame(p));
    assert.deepEqual(snapshot(f.project), before);
    s.close();
  });
test("malformed ownership does not authorize arbitrary scene writes", () => {
  const f = fixture(),
    s = f.store();
  put(
    f.project + "/" + own,
    jsonBytes({
      schema: "webgal-attachment-creator-owned-files",
      schemaVersion: 2,
      ownerId: "terre-project:测试 Demo",
      files: [
        { path: "game/scene/start.txt", bytes: 1, sha256: "0".repeat(64) },
      ],
    })
  );
  const before = snapshot(f.project);
  code(() => s.saveToGame(payload()), "CREATOR_WRITE_SCOPE_INVALID");
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
test("read-only project and ungranted project cannot write or redirect via projectRoot body", () => {
  const f = fixture("default", {
      projectGrants: [{ name: "测试 Demo", access: "read" }],
    }),
    s = f.store(),
    before = snapshot(f.data);
  code(() => s.saveToGame(payload()), "TERRE_PROJECT_WRITE_NOT_AUTHORIZED");
  code(
    () =>
      s.saveToGame({
        ...payload(),
        projectName: "Other",
        projectRoot: f.project,
      }),
    "TERRE_PROJECT_NOT_AUTHORIZED"
  );
  assert.deepEqual(snapshot(f.data), before);
  s.close();
});
test("config root switches revoke existing save capability", () => {
  const f = fixture(),
    s = f.store();
  s.context();
  put(
    f.home + "/.webgal_terre/config.json",
    JSON.stringify({ userDataPath: f.base + "/switched" })
  );
  const before = snapshot(f.project);
  code(() => s.saveToGame(payload()), "TERRE_LAYOUT_CHANGED");
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
test("old v1 portable folder loads without false hash/visual claim; canonical/legacy duplicates fail closed", () => {
  const f = fixture(),
    s = f.store(),
    p = mutateDocument(payload(), (d) => {
      d.schemaVersion = 1;
      d.preset = d.adaptations[0].preset;
      d.modelProfile = d.adaptations[0].modelProfile;
      delete d.adaptations;
    });
  const root = "game/attachments-v2/portable/test-hat";
  for (const file of p.files)
    put(f.project + "/" + file.path, Buffer.from(file.base64, "base64"));
  put(
    f.project + "/" + root + "/manifest.json",
    jsonBytes({
      schema: "webgal-attachment-portable-folder",
      schemaVersion: 1,
      presetId: p.presetId,
      files: ["attachment.json", "images/front.png", "使用说明.txt"],
    })
  );
  assert.equal(
    s.loadAttachment(p).integrity,
    "LEGACY_FILESET_ONLY_NO_STORED_HASH"
  );
  put(
    f.project + "/game/attachments-v2/test-hat/attachment.json",
    Buffer.from(p.files[0].base64, "base64")
  );
  code(() => s.loadAttachment(p), "CREATOR_DUPLICATE_PACKAGE_LOCATION");
  s.close();
});
test("corrupted saved PNG is reported and cannot silently merge", () => {
  const f = fixture(),
    s = f.store(),
    p = payload();
  save(s, p);
  put(
    f.project + "/game/attachments-v2/portable/test-hat/images/front.png",
    "changed"
  );
  const before = snapshot(f.project);
  const review = s.loadAttachment(p);
  assert.equal(review.integrity, "USER_EDITED_REVIEW_REQUIRED");
  assert.deepEqual(review.integrityDifferences.map((row) => row.path), [
    "game/attachments-v2/portable/test-hat/images/front.png",
  ]);
  const overwrite = s.saveToGame({ ...p, expectedRevision: review.revision });
  assert.equal(overwrite.ok, false);
  assert.deepEqual(overwrite.conflicts, [
    "game/attachments-v2/portable/test-hat/images/front.png",
  ]);
  const context = s.context();
  assert.equal(context.rejected.length, 0);
  assert.equal(context.savedAttachments.length, 1);
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
test("explicit library import is transactional, source preserved, duplicate/unowned content conflicts", () => {
  const f = fixture(),
    s = f.store(),
    p = JSON.parse(Buffer.from(payload().files[0].base64, "base64"))
      .adaptations[0].modelProfile,
    source = "game/attachments-v2/model-profiles/profile-a.json";
  put(f.project + "/" + source, jsonBytes(p));
  const before = snapshot(f.project),
    body = { projectName: "测试 Demo", fileName: "profile-a.json" };
  assert.equal(s.importLibraryProfile(body).ok, true);
  assert.deepEqual(snapshot(f.project), before);
  assert.equal(s.library().profiles.length, 1);
  assert.equal(s.readLibraryProfile(body).profile.modelProfileId, "profile-a");
  assert.equal(s.importLibraryProfile(body).noOp, true);
  put(
    f.authoring + "/library/model-profiles/profile-a.json",
    jsonBytes({ ...p, characterId: "foreign" })
  );
  const lib = snapshot(f.authoring);
  assert.equal(s.importLibraryProfile(body).ok, false);
  assert.deepEqual(snapshot(f.authoring), lib);
  s.close();
});
test("library write requires independent authoring grant, discovery does not grant", () => {
  const f = fixture("default", { authorizedAuthoringRoot: undefined }),
    s = f.store(),
    p = JSON.parse(Buffer.from(payload().files[0].base64, "base64"))
      .adaptations[0].modelProfile;
  put(f.project + "/game/attachments-v2/model-profiles/a.json", jsonBytes(p));
  code(
    () =>
      s.importLibraryProfile({ projectName: "测试 Demo", fileName: "a.json" }),
    "TERRE_AUTHORING_WRITE_NOT_AUTHORIZED"
  );
  s.close();
});
test("scene namespace cannot plan original start or arbitrary generated path", () => {
  const f = fixture(),
    a = createTerreProjectAccess(f.options),
    h = a.openProject("测试 Demo");
  code(
    () => a.planAttachmentWrite(h, "game/scene/start.txt"),
    "TERRE_ATTACHMENT_WRITE_SCOPE_INVALID"
  );
  code(() => a.planCreatorSceneWrite(h, "../start"), "TERRE_NAME_INVALID");
  assert.ok(
    a
      .planCreatorSceneWrite(h, "hat-abc")
      .path.endsWith("ATTACHMENT-CREATOR-PREVIEW-hat-abc.txt")
  );
  a.close();
});
test("actual canonical Creator package producer -> new save -> reload, no handcrafted export bypass", async () => {
  const profile = JSON.parse(
    fs.readFileSync(
      path.join(
        task,
        "target-plugin/resources/global-library/model-profiles/anon-school_winter-2023-semantic-v1.json"
      )
    )
  );
  const draft = createBlankCreatorDraft(123456);
  Object.assign(draft, {
    figureKey: "anon",
    figureGeneration: "test-generation",
    modelProfileId: profile.modelProfileId,
    anchorName: "head",
    presetId: "v2/producer-123",
    attachmentDefinitionId: "producer-assets",
    attachmentInstanceId: "producer-instance",
  });
  draft.layers.front = {
    sourceFileName: "原始图片.png",
    outputFileName: "front.png",
    width: 1,
    height: 1,
    bytes: png.length,
    sha256: sha(png),
    mime: "image/png",
  };
  const produced = await buildCreatorPackage({
      draft,
      profile,
      front: { bytes: png },
      createdAt: "2026-09-04T00:00:00.000Z",
    }),
    body = {
      projectName: "测试 Demo",
      presetId: draft.presetId,
      attachmentAssetId: draft.attachmentDefinitionId,
      modelProfileId: profile.modelProfileId,
      files: produced.files.map((f) => encode(f.path, Buffer.from(f.bytes))),
    };
  const f = fixture(),
    s = f.store();
  put(
    f.project + "/" + profile.modelPath.replace(/^\.\//, ""),
    JSON.stringify({ motions: { "anon/idle01": [{ file: "idle.mtn" }] } })
  );
  put(
    f.project +
      "/" +
      path.posix.join(
        path.posix.dirname(profile.modelPath.replace(/^\.\//, "")),
        "idle.mtn"
      ),
    "fixture motion"
  );
  const result = s.saveToGame(body);
  assert.equal(result.ok, true);
  const loaded = s.loadAttachment(body);
  assert.equal(
    loaded.packageDocument.adaptations[0].modelProfile.modelProfileId,
    profile.modelProfileId
  );
  assert.equal(
    loaded.packageDocument.asset.layers.front,
    "./game/attachments-v2/portable/producer-123/images/front.png"
  );
  s.close();
});

test("owned package/readme BOM+CRLF normalization preserves content contract on load/save", () => {
  const f = fixture(),
    s = f.store(),
    p = payload();
  save(s, p);
  for (const file of [
    packageFile,
    "game/attachments-v2/portable/test-hat/使用说明.txt",
  ]) {
    const source = fs.readFileSync(f.project + "/" + file, "utf8");
    put(f.project + "/" + file, "\uFEFF" + source.replaceAll("\n", "\r\n"));
  }
  const l = s.loadAttachment(p);
  assert.equal(l.integrity, "HASH_VALIDATED");
  assert.equal(save(s, payload({ displayName: "new name" })).ok, true);
  s.close();
});
test("foreign BOM/CRLF edit requires review and can be explicitly accepted without content overwrite", () => {
  const f = fixture(),
    s = f.store(),
    p = payload();
  for (const file of p.files)
    put(f.project + "/" + file.path, Buffer.from(file.base64, "base64"));
  put(
    f.project + "/" + packageFile,
    "\uFEFF" +
      fs
        .readFileSync(f.project + "/" + packageFile, "utf8")
        .replaceAll("\n", "\r\n")
  );
  const changed = fs.readFileSync(f.project + "/" + packageFile);
  const review = s.loadAttachment(p);
  assert.equal(review.integrity, "USER_EDITED_REVIEW_REQUIRED");
  assert.deepEqual(review.integrityDifferences.map((row) => row.path), [packageFile]);
  const accepted = s.acceptAttachmentChanges({
    projectName: p.projectName,
    presetId: p.presetId,
    expectedRevision: review.revision,
  });
  assert.equal(accepted.integrity, "HASH_VALIDATED");
  assert.equal(accepted.contentOverwritten, false);
  assert.deepEqual(accepted.acceptedPaths, [packageFile]);
  assert.deepEqual(fs.readFileSync(f.project + "/" + packageFile), changed);
  s.close();
});
test("read-set changes after merge but before journal cannot be overwritten", () => {
  let enabled = false;
  const f = fixture(
      "default",
      {},
      {
        fault: (phase) => {
          if (enabled && phase === "preflight")
            put(f.project + "/" + packageFile, "concurrent edit");
        },
      }
    ),
    s = f.store();
  save(s, payload());
  enabled = true;
  code(
    () => save(s, payload({ displayName: "new name" })),
    "CREATOR_STALE_DRAFT_RELOAD_REQUIRED"
  );
  assert.equal(
    fs.readFileSync(f.project + "/" + packageFile, "utf8"),
    "concurrent edit"
  );
  assert.equal(fs.existsSync(f.project + "/" + journal), false);
  s.close();
});
test("abort while staging rolls back created files and journal", () => {
  const a = new AbortController(),
    f = fixture(
      "default",
      {},
      {
        fault: (phase) => {
          if (phase === "staged") a.abort();
        },
      }
    ),
    s = f.store(),
    before = snapshot(f.project);
  code(
    () => s.saveToGame(payload(), { signal: a.signal }),
    "CREATOR_SAVE_ABORTED"
  );
  assert.deepEqual(snapshot(f.project), before);
  s.close();
});
test("library same filename cannot change a Profile identity, nor consume reserved index.json", () => {
  const f = fixture(),
    s = f.store(),
    p = JSON.parse(Buffer.from(payload().files[0].base64, "base64"))
      .adaptations[0].modelProfile,
    source = f.project + "/game/attachments-v2/model-profiles/a.json",
    body = { projectName: "测试 Demo", fileName: "a.json" };
  put(source, jsonBytes(p));
  assert.equal(s.importLibraryProfile(body).ok, true);
  const before = snapshot(f.authoring);
  put(source, jsonBytes({ ...p, modelProfileId: "different-id" }));
  code(
    () => s.importLibraryProfile(body),
    "CREATOR_LIBRARY_PROFILE_ID_COLLISION"
  );
  assert.deepEqual(snapshot(f.authoring), before);
  code(
    () => s.importLibraryProfile({ ...body, fileName: "index.json" }),
    "CREATOR_LIBRARY_PROFILE_INVALID"
  );
  s.close();
});
test("throwing log callback cannot turn a persisted save into failure", () => {
  const f = fixture(
      "default",
      {},
      {
        log: () => {
          throw Error("LOG_OFFLINE");
        },
      }
    ),
    s = f.store();
  const r = s.saveToGame(payload());
  assert.equal(r.ok, true);
  assert.equal(s.loadAttachment(payload()).revision, r.revision);
  s.close();
});
