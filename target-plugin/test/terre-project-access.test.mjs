import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createTerreProjectAccess,
  discoverTerreLayout,
} from "../runtime/terre-project-access.mjs";
import {
  relativePath,
  absoluteRoot,
  decodeLogicalPath,
} from "../runtime/terre-path-guard.mjs";

const task = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const run = path.join(
  task,
  process.env.WEBGAL_TEST_EVIDENCE_STAGE || "15_terre-project-paths/fixtures",
  `run-${Date.now()}-${process.pid}`
);
fs.mkdirSync(run, { recursive: true });
const put = (file, text = "") => {
  assert.ok(file.startsWith(run + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const dir = (value) => {
  assert.ok(value.startsWith(run + path.sep));
  fs.mkdirSync(value, { recursive: true });
  return value;
};
const move = (from, to) => {
  assert.ok(from.startsWith(run + path.sep) && to.startsWith(run + path.sep));
  fs.renameSync(from, to);
};
const sha = (data) =>
  createHash("sha256").update(data).digest("hex").toUpperCase();
const expectCode = (fn, code) =>
  assert.throws(fn, (error) => error.code === code, code);
const engine = "assets/templates/WebGAL_Template";
let n = 0;
function fixture(mode = "default", extra = {}) {
  const base = dir(path.join(run, `case-${++n}`));
  const installRoot = dir(path.join(base, "Terre MyGO")),
    hostHomeRoot = dir(path.join(base, "用户 home"));
  const configRoot = dir(path.join(hostHomeRoot, ".webgal_terre"));
  const custom = path.join(base, "separate data");
  const data =
    mode === "portable"
      ? path.join(installRoot, "data")
      : mode === "custom"
      ? custom
      : configRoot;
  if (mode !== "default")
    put(
      path.join(configRoot, "config.json"),
      JSON.stringify({ version: "4.6.4", userDataPath: custom })
    );
  for (const sub of [
    "games",
    "templates",
    "derivative-engines",
    "Exported_Games",
  ])
    dir(path.join(data, sub));
  const host = {
    "WebGAL_Terre.exe": "fixture backend - not a production executable",
    [`${engine}/webgal-engine.json`]: JSON.stringify({
      id: "webgal-mygo.mygo",
      version: "3.2.1",
      webgalVersion: "4.6.4",
    }),
    [`${engine}/index.html`]: "shared engine index",
    [`${engine}/assets/main.js`]: "shared bundle",
    [`${engine}/game/template/UI/style.css`]: "shared game template",
    [`${engine}/lib/sdk.js`]: "shared lib",
    [`${engine}/game/scene/fallback.txt`]: "shared fallback",
    "assets/templates/WebGAL_Default_Template/template.json": "default UI",
    "public/templates/WebGAL_Classic/template.json": "builtin UI",
    "public/index.html": "editor UI",
  };
  for (const [p,b] of Object.entries(host)) if (p.startsWith(engine+'/')) host[p.replace(engine,'assets/templates/Derivative_Engine/MyGO_v3.2.1')]=b;
  for (const [relative, value] of Object.entries(host))
    put(path.join(installRoot, relative), value);
  function game(name = "Demo", customEngine = false) {
    const root = path.join(data, "games", name);
    put(
      path.join(root, "game/config.txt"),
      `Game_name:${name};Game_key:${name};`
    );
    put(path.join(root, "game/scene/start.txt"), "ordinary user scene");
    if (customEngine) put(path.join(root, "index.html"), "custom index");
    return root;
  }
  const project = game();
  const authoring = path.join(installRoot, "WebGAL-Attachment-Authoring");
  const options = {
    installRoot,
    hostHomeRoot,
    authorizedUserDataRoot: data,
    hostFiles: Object.keys(host)
      .filter(
        (p) =>
          p === "WebGAL_Terre.exe" ||
          p.endsWith("webgal-engine.json") ||
          p.endsWith('/index.html')
      )
      .map((p) => ({ path: p, sha256: sha(Buffer.from(host[p])) })),
    projectGrants: [{ name: "Demo", access: "attachment-write" }],
    ...extra,
  };
  return {
    base,
    installRoot,
    hostHomeRoot,
    configRoot,
    data,
    custom,
    project,
    authoring,
    game,
    options,
    access: () => createTerreProjectAccess(options),
  };
}

for (const mode of ["default", "custom", "portable"])
  test(`${mode}: exact roots, source-only project without index/assets`, () => {
    const f = fixture(mode),
      access = f.access(),
      roots = access.describe();
    assert.equal(roots.mode, mode);
    assert.equal(roots.resolvedUserDataRoot, f.data);
    assert.equal(roots.gamesRoot, path.join(f.data, "games"));
    assert.equal(roots.exportRoot, path.join(f.data, "Exported_Games"));
    assert.equal(roots.libraryRoot, path.join(f.authoring, "library"));
    const project = access.openProject("Demo");
    assert.equal(access.inspectProject(project).engineOrigin, "shared");
    assert.equal(
      access.resolvePreviewFile(project).path,
      path.join(f.installRoot, engine, "index.html")
    );
    assert.equal(
      access.resolveProjectRead(project, "game/scene/start.txt").path,
      path.join(f.project, "game/scene/start.txt")
    );
    assert.equal(
      access.planAttachmentWrite(
        project,
        "game/attachments-v2/portable/hat/images/front.png"
      ).exists,
      false
    );
    assert.equal(
      fs.existsSync(path.join(f.project, "game/attachments-v2")),
      false,
      "plan must not mkdir"
    );
    assert.equal(
      access.describeExportSource(project).sourceRoot,
      path.join(f.installRoot, engine)
    );
    assert.equal(access.describeExportSource(project).exportValidated, false);
  });

test("portable overrides configured custom path without reading inactive games", () => {
  const f = fixture("portable");
  put(path.join(f.custom, "games/Inactive/game/config.txt"), "inactive");
  assert.deepEqual(
    f
      .access()
      .listProjects()
      .projects.map((p) => p.name),
    ["Demo"]
  );
});
test("discovery reads config but never creates directories/config", () => {
  const f = fixture();
  move(f.configRoot, `${f.configRoot}-saved`);
  assert.equal(discoverTerreLayout(f.options).configSha256, null);
  assert.equal(fs.existsSync(f.configRoot), false);
});
test("relative config path uses install root, not Node cwd", () => {
  const f = fixture();
  put(
    path.join(f.configRoot, "config.json"),
    JSON.stringify({ userDataPath: "my data" })
  );
  assert.equal(
    discoverTerreLayout(f.options).resolvedUserDataRoot,
    path.join(f.installRoot, "my data")
  );
});
test("blank configured path selects default", () => {
  const f = fixture();
  put(
    path.join(f.configRoot, "config.json"),
    JSON.stringify({ userDataPath: "   " })
  );
  assert.equal(discoverTerreLayout(f.options).mode, "default");
});
for (const text of [
  "{oops",
  "null",
  "[]",
  "true",
  '{"userDataPath":4}',
  "\ufeff{}",
])
  test(`malformed config fails closed: ${JSON.stringify(text)}`, () => {
    const f = fixture();
    put(path.join(f.configRoot, "config.json"), text);
    expectCode(() => discoverTerreLayout(f.options), "TERRE_CONFIG_INVALID");
  });
test("oversized config is rejected", () => {
  const f = fixture();
  put(path.join(f.configRoot, "config.json"), " ".repeat(65537));
  expectCode(
    () => discoverTerreLayout(f.options),
    "TERRE_FILE_SIZE_OR_TYPE_INVALID"
  );
});
test("config data discovery is not filesystem authorization", () => {
  const f = fixture("custom");
  f.options.authorizedUserDataRoot = f.configRoot;
  expectCode(() => f.access(), "TERRE_USER_DATA_NOT_AUTHORIZED");
});
test("ancestor authorization is not exact-root authorization", () => {
  const f = fixture();
  f.options.authorizedUserDataRoot = f.base;
  expectCode(() => f.access(), "TERRE_USER_DATA_NOT_AUTHORIZED");
});
test("wrong old release rejected by fingerprint before project access", () => {
  const f = fixture();
  put(path.join(f.installRoot, "WebGAL_Terre.exe"), "old 3.0.0");
  expectCode(() => f.access(), "TERRE_HOST_FINGERPRINT_MISMATCH");
});
test("trusted host proof required even if marker filenames exist", () => {
  const f = fixture();
  f.options.hostFiles = [];
  expectCode(() => f.access(), "TERRE_HOST_PROOF_REQUIRED");
});
test("old host metadata cannot pass even with fixture hash", () => {
  const f = fixture();
  const p = 'assets/templates/Derivative_Engine/MyGO_v3.2.1/webgal-engine.json';
  const bytes =
    '{"id":"webgal-mygo.mygo","version":"3.0.0","webgalVersion":"4.5.15"}';
  put(path.join(f.installRoot, p), bytes);
  f.options.hostFiles.find((r) => r.path === p).sha256 = sha(bytes);
  expectCode(() => f.access(), "TERRE_HOST_VERSION_MISMATCH");
});
test("changing host file invalidates a running access session", () => {
  const f = fixture(),
    access = f.access();
  put(path.join(f.installRoot, engine, "index.html"), "changed");
  expectCode(() => access.listProjects(), "TERRE_HOST_CHANGED");
});
test("listing does not grant access; invalid/hidden projects do not pass", () => {
  const f = fixture();
  f.game("中文 剧情");
  dir(path.join(f.data, "games/Broken"));
  f.game(".hidden");
  const access = f.access(),
    list = access.listProjects();
  assert.deepEqual(
    list.projects.map((p) => p.name).sort(),
    ["Demo", "中文 剧情"].sort()
  );
  assert.equal(list.rejected[0].name, "Broken");
  expectCode(
    () => access.openProject("中文 剧情"),
    "TERRE_PROJECT_NOT_AUTHORIZED"
  );
});
test("explicit Unicode project selection gets correct encoded URL", () => {
  const f = fixture();
  f.game("中文 剧情");
  f.options.projectGrants.push({ name: "中文 剧情", access: "read" });
  const a = f.access(),
    h = a.openProject("中文 剧情");
  assert.equal(
    a.inspectProject(h).previewUrlPath,
    `/games/${encodeURIComponent("中文 剧情")}/`
  );
  assert.equal(
    a.resolveLogicalProjectRead(
      h,
      `/public/games/${encodeURIComponent("中文 剧情")}/game/config.txt`
    ).path,
    path.join(f.data, "games/中文 剧情/game/config.txt")
  );
});
test("project read capability cannot produce a write plan", () => {
  const f = fixture();
  f.options.projectGrants[0].access = "read";
  const a = f.access(),
    h = a.openProject("Demo");
  expectCode(
    () => a.planAttachmentWrite(h, "game/attachments-v2/x.json"),
    "TERRE_PROJECT_WRITE_NOT_AUTHORIZED"
  );
});
test("opaque handles cannot be forged or reused across sessions", () => {
  const f = fixture(),
    a = f.access(),
    b = f.access();
  const h = a.openProject("Demo");
  expectCode(
    () => a.inspectProject({ name: "Demo" }),
    "TERRE_PROJECT_CAPABILITY_INVALID"
  );
  expectCode(() => b.inspectProject(h), "TERRE_PROJECT_CAPABILITY_INVALID");
  a.close();
  expectCode(() => a.inspectProject(h), "TERRE_ACCESS_CLOSED");
});
test("grants are copied, caller mutation cannot escalate access", () => {
  const f = fixture();
  f.options.projectGrants[0].access = "read";
  const a = f.access();
  f.options.projectGrants[0].access = "attachment-write";
  expectCode(
    () =>
      a.planAttachmentWrite(
        a.openProject("Demo"),
        "game/attachments-v2/x.json"
      ),
    "TERRE_PROJECT_WRITE_NOT_AUTHORIZED"
  );
});
test("ordinary scene/config/original PNG/engine writes are not authorized", () => {
  const f = fixture(),
    a = f.access(),
    h = a.openProject("Demo");
  for (const p of [
    "game/scene/start.txt",
    "game/config.txt",
    "game/figure/original.png",
    "index.html",
    "assets/main.js",
    "game/attachments-v20/x.json",
  ]) {
    expectCode(
      () => a.planAttachmentWrite(h, p),
      "TERRE_ATTACHMENT_WRITE_SCOPE_INVALID"
    );
  }
  assert.equal(
    fs.readFileSync(path.join(f.project, "game/scene/start.txt"), "utf8"),
    "ordinary user scene"
  );
});
test("custom engine: own files first, missing ordinary assets fall back, template does not", () => {
  const f = fixture();
  put(path.join(f.project, "index.html"), "custom index");
  put(path.join(f.project, "game/template/local.css"), "local");
  const a = f.access(),
    h = a.openProject("Demo");
  assert.equal(a.inspectProject(h).engineOrigin, "project-custom");
  assert.equal(
    fs.readFileSync(a.resolvePreviewFile(h).path, "utf8"),
    "custom index"
  );
  assert.equal(
    a.resolvePreviewFile(h, "assets/main.js").owner,
    path.join(f.installRoot, engine)
  );
  assert.equal(
    a.resolvePreviewFile(h, "game/template/local.css").owner,
    f.project
  );
  expectCode(
    () => a.resolvePreviewFile(h, "game/template/UI/style.css"),
    "TERRE_PREVIEW_FILE_MISSING"
  );
  assert.equal(a.describeExportSource(h).sourceRoot, f.project);
});
test("shared engine: ignore project assets unless custom index exists", () => {
  const f = fixture();
  put(path.join(f.project, "assets/main.js"), "stray bundle");
  const a = f.access(),
    h = a.openProject("Demo");
  assert.equal(
    a.resolvePreviewFile(h, "assets/main.js").owner,
    path.join(f.installRoot, engine)
  );
  assert.equal(
    a.resolvePreviewFile(h, "lib/sdk.js").owner,
    path.join(f.installRoot, engine)
  );
  assert.equal(
    a.resolvePreviewFile(h, "game/scene/fallback.txt").owner,
    path.join(f.installRoot, engine)
  );
  expectCode(
    () => a.resolveProjectRead(h, "game/scene/fallback.txt"),
    "TERRE_PATH_MISSING"
  );
});
test("template per-file fallback and default UI special root match host", () => {
  const f = fixture();
  put(path.join(f.data, "templates/WebGAL_Classic/local.css"), "user");
  put(
    path.join(f.data, "templates/WebGAL_Default_Template/template.json"),
    "ignored override"
  );
  const a = f.access();
  assert.equal(
    a.resolveTemplateFile("WebGAL_Classic", "local.css").path,
    path.join(f.data, "templates/WebGAL_Classic/local.css")
  );
  assert.equal(
    a.resolveTemplateFile("WebGAL_Classic", "template.json").path,
    path.join(f.installRoot, "public/templates/WebGAL_Classic/template.json")
  );
  assert.equal(
    a.resolveTemplateFile("WebGAL_Default_Template", "template.json").path,
    path.join(
      f.installRoot,
      "assets/templates/WebGAL_Default_Template/template.json"
    )
  );
});
for (const change of [
  "config",
  "portable",
  "game",
  "game-data",
  "scene",
  "custom-engine",
  "games-root",
])
  test(`stale session/selection rejected after ${change} changes`, () => {
    const f = fixture(),
      a = f.access(),
      h = a.openProject("Demo");
    let code = "TERRE_PROJECT_CHANGED_REAUTHORIZE";
    if (change === "config") {
      put(
        path.join(f.configRoot, "config.json"),
        JSON.stringify({ userDataPath: f.custom })
      );
      code = "TERRE_LAYOUT_CHANGED_REAUTHORIZE";
    }
    if (change === "portable") {
      dir(path.join(f.installRoot, "data"));
      code = "TERRE_LAYOUT_CHANGED_REAUTHORIZE";
    }
    if (change === "game") {
      move(f.project, `${f.project}-old`);
      f.game();
    }
    if (change === "game-data") {
      move(path.join(f.project, "game"), path.join(f.project, "old-game"));
      f.game();
    }
    if (change === "scene") {
      move(
        path.join(f.project, "game/scene"),
        path.join(f.project, "game/old-scene")
      );
      dir(path.join(f.project, "game/scene"));
    }
    if (change === "custom-engine")
      put(path.join(f.project, "index.html"), "now custom");
    if (change === "games-root") {
      move(path.join(f.data, "games"), path.join(f.data, "games-old"));
      f.game();
      code = "TERRE_ROOT_REPLACED";
    }
    expectCode(() => a.inspectProject(h), code);
  });
test("restart honors changed custom root; library remains independent and untouched", () => {
  const f = fixture();
  put(
    path.join(f.authoring, "library/user-profile.json"),
    '{"userOwned":true}'
  );
  const a = f.access();
  const library = a.describe().libraryRoot;
  dir(path.join(f.custom, "games"));
  put(
    path.join(f.configRoot, "config.json"),
    JSON.stringify({ userDataPath: f.custom })
  );
  expectCode(() => a.listProjects(), "TERRE_LAYOUT_CHANGED_REAUTHORIZE");
  f.options.authorizedUserDataRoot = f.custom;
  const b = f.access();
  assert.equal(b.describe().libraryRoot, library);
  assert.equal(
    fs.readFileSync(b.resolveLibraryRead("user-profile.json").path, "utf8"),
    '{"userOwned":true}'
  );
});
test("explicit persistent library may survive installation changes; no automatic moves", () => {
  const f = fixture(),
    external = dir(path.join(f.base, "my persistent authoring"));
  put(path.join(external, "library/profile.json"), "{}");
  f.options.authorizedAuthoringRoot = external;
  const a = f.access();
  assert.equal(a.describe().authoringRoot, external);
  const plan = a.planLibraryWrite("new-profile.json");
  assert.equal(plan.exists, false);
  assert.equal(fs.existsSync(plan.path), false);
  const second = fixture("portable");
  second.options.authorizedAuthoringRoot = external;
  assert.equal(
    second.access().resolveLibraryRead("profile.json").path,
    a.resolveLibraryRead("profile.json").path
  );
});
test("implicit default library does not grant writes", () => {
  const f = fixture(),
    a = f.access();
  expectCode(
    () => a.planLibraryWrite("x.json"),
    "TERRE_AUTHORING_WRITE_NOT_AUTHORIZED"
  );
});

test("derivative engine data stays under authorized active user-data", () => {
  const f = fixture("custom");
  put(
    path.join(f.data, "derivative-engines/Custom/assets/main.js"),
    "custom engine"
  );
  const a = f.access();
  assert.equal(
    a.resolveDerivativeEngineFile("Custom", "assets/main.js").path,
    path.join(f.data, "derivative-engines/Custom/assets/main.js")
  );
  assert.throws(() =>
    a.resolveDerivativeEngineFile("../escape", "assets/main.js")
  );
});
test("write plan must be revalidated after awaits; forged/cross-session plans rejected", () => {
  const f = fixture(),
    a = f.access(),
    h = a.openProject("Demo");
  const p = a.planAttachmentWrite(h, "game/attachments-v2/new.json");
  assert.equal(a.revalidateWritePlan(p).path, p.path);
  expectCode(() => a.revalidateWritePlan({ ...p }), "TERRE_WRITE_PLAN_INVALID");
  expectCode(
    () => f.access().revalidateWritePlan(p),
    "TERRE_WRITE_PLAN_INVALID"
  );
  put(p.path, '{"userEdit":true}');
  expectCode(() => a.revalidateWritePlan(p), "TERRE_WRITE_TARGET_CHANGED");
});
test("write plan cannot survive later directory-link replacement", () => {
  const f = fixture(),
    a = f.access(),
    h = a.openProject("Demo");
  const p = a.planAttachmentWrite(h, "game/attachments-v2/new.json");
  const outside = dir(path.join(f.base, "outside"));
  fs.symlinkSync(
    outside,
    path.join(f.project, "game/attachments-v2"),
    "junction"
  );
  expectCode(() => a.revalidateWritePlan(p), "TERRE_REPARSE_POINT_BLOCKED");
});
test("planned existing file requires its exact prior identity/version", () => {
  const f = fixture();
  put(path.join(f.project, "game/attachments-v2/owned.json"), "original");
  const a = f.access(),
    p = a.planAttachmentWrite(
      a.openProject("Demo"),
      "game/attachments-v2/owned.json"
    );
  put(p.path, "user changed contents");
  expectCode(() => a.revalidateWritePlan(p), "TERRE_WRITE_TARGET_CHANGED");
});
test("missing games root is empty; later creation is pinned without any implicit mkdir", () => {
  const f = fixture();
  move(path.join(f.data, "games"), path.join(f.data, "old-games"));
  const a = f.access();
  assert.equal(a.listProjects().projects.length, 0);
  assert.equal(fs.existsSync(path.join(f.data, "games")), false);
  f.game();
  assert.equal(a.listProjects().projects.length, 1);
});
test("default/custom/portable sessions never enumerate old install/public/games", () => {
  const f = fixture("custom");
  put(path.join(f.installRoot, "public/games/Old/game/config.txt"), "old");
  dir(path.join(f.installRoot, "public/games/Old/game/scene"));
  assert.deepEqual(
    f
      .access()
      .listProjects()
      .projects.map((p) => p.name),
    ["Demo"]
  );
});

for (const input of [
  "../escape",
  "game/../outside",
  "/absolute",
  "C:/elsewhere",
  "C:relative",
  "game\\x",
  "game//x",
  "game/./x",
  "game/%2e%2e/x",
  "game/%252e/x",
  "game/NUL.json",
  "game/CON",
  "game/com1.png",
  "game/x:stream",
  "game/trailing.",
  "game/trailing ",
  "game/x\0y",
  "game/x?y",
  "game/x*y",
]) {
  test(`unsafe decoded filesystem name rejected: ${JSON.stringify(
    input
  )}`, () => expectCode(() => relativePath(input), "TERRE_PATH_INVALID"));
}
for (const input of [
  "/public/games/%2e%2e/x",
  "/public/games/Demo%2fother/game/a",
  "/public/games/Demo%5cother/game/a",
  "/public/games/Demo/%252e%252e/a",
  "/public/games/Demo/game/a?x=1",
  "/public/games/Demo/game/a#x",
  "/public/games/%zz/game/a",
]) {
  test(`unsafe logical URL rejected: ${input}`, () =>
    assert.throws(() => decodeLogicalPath(input)));
}
test("other project URL and physical install public/games are not aliases", () => {
  const f = fixture(),
    a = f.access(),
    h = a.openProject("Demo");
  expectCode(
    () => a.resolveLogicalProjectRead(h, "/public/games/Other/game/config.txt"),
    "TERRE_LOGICAL_PROJECT_MISMATCH"
  );
  expectCode(
    () =>
      a.resolveLogicalProjectRead(
        h,
        `${f.installRoot}/public/games/Demo/game/config.txt`
      ),
    "TERRE_LOGICAL_PATH_INVALID"
  );
});
test("absolute volume, UNC and device namespaces rejected", () => {
  assert.throws(() => absoluteRoot(path.parse(run).root));
  if (process.platform === "win32")
    for (const p of [
      "\\\\server\\share\\dir",
      "\\\\?\\D:\\dir",
      "\\\\.\\pipe\\foo",
    ])
      expectCode(
        () => absoluteRoot(p),
        "TERRE_NETWORK_OR_DEVICE_ROOT_UNSUPPORTED"
      );
});

for (const which of [
  "project",
  "game",
  "attachment-parent",
  "existing-leaf",
  "dangling-parent",
  "template",
  "data-root",
  "config-root",
  "inside-alias",
]) {
  test(`real filesystem reparse point denied: ${which}`, () => {
    const f = fixture();
    const outside = dir(path.join(f.base, "outside"));
    const a = f.access(),
      h = a.openProject("Demo");
    let link,
      target = outside,
      operation;
    if (which === "project") {
      move(f.project, `${f.project}-old`);
      link = f.project;
      operation = () => a.inspectProject(h);
    }
    if (which === "game") {
      move(path.join(f.project, "game"), path.join(f.project, "old-game"));
      link = path.join(f.project, "game");
      operation = () => a.inspectProject(h);
    }
    if (
      [
        "attachment-parent",
        "existing-leaf",
        "dangling-parent",
        "inside-alias",
      ].includes(which)
    ) {
      dir(path.join(f.project, "game/attachments-v2"));
      link = path.join(f.project, "game/attachments-v2/linked");
      if (which === "dangling-parent") target = path.join(outside, "missing");
      if (which === "inside-alias")
        target = dir(path.join(f.project, "game/attachments-v2/other"));
      operation = () =>
        a.planAttachmentWrite(
          h,
          `game/attachments-v2/linked${
            which === "existing-leaf" ? "" : "/payload.json"
          }`
        );
    }
    if (which === "template") {
      link = path.join(f.data, "templates/Linked");
      operation = () => a.resolveTemplateFile("Linked", "a.css");
    }
    if (which === "data-root") {
      move(f.data, `${f.data}-old`);
      link = f.data;
      operation = () => a.listProjects();
    }
    if (which === "config-root") {
      move(f.configRoot, `${f.configRoot}-old`);
      link = f.configRoot;
      operation = () => discoverTerreLayout(f.options);
    }
    fs.symlinkSync(target, link, "junction");
    expectCode(operation, "TERRE_REPARSE_POINT_BLOCKED");
  });
}
test("hardlinked project data rejected including leaf write plans", () => {
  const f = fixture(),
    a = f.access(),
    h = a.openProject("Demo");
  put(path.join(f.base, "original.json"), "{}");
  dir(path.join(f.project, "game/attachments-v2"));
  fs.linkSync(
    path.join(f.base, "original.json"),
    path.join(f.project, "game/attachments-v2/copied.json")
  );
  expectCode(
    () => a.planAttachmentWrite(h, "game/attachments-v2/copied.json"),
    "TERRE_HARDLINK_BLOCKED"
  );
});

test("enumeration never follows escaped junction into another project", () => {
  const f = fixture();
  const other = dir(path.join(f.base, "other games"));
  fs.symlinkSync(other, path.join(f.data, "games/Escape"), "junction");
  const listing = f.access().listProjects();
  assert.deepEqual(
    listing.projects.map((p) => p.name),
    ["Demo"]
  );
  assert.deepEqual(
    listing.rejected.map((p) => p.code),
    ["TERRE_REPARSE_POINT_BLOCKED"]
  );
});
