import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import { createTerreProjectAccess } from "../runtime/terre-project-access.mjs";

const task = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(import.meta.url);
const ts = require(path.join(
  task,
  "target-webgal-mygo/node_modules/typescript"
));
const sourceRoot = path.join(
  task,
  "target-webgal-mygo-terre/packages/terre2/src"
);
const run = path.join(
  task,
  process.env.WEBGAL_TEST_EVIDENCE_STAGE || "15_terre-project-paths/fixtures",
  `parity-${Date.now()}-${process.pid}`
);
fs.mkdirSync(run, { recursive: true });
const sha = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();
const engine = "assets/templates/WebGAL_Template";
const checkFixture = (p) =>
  assert.ok(
    path.resolve(p).startsWith(run + path.sep),
    "host test write outside fixture"
  );
const put = (p, text) => {
  checkFixture(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
function loadTS(relative, imports, globals = {}) {
  const filename = path.join(sourceRoot, relative);
  const text = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
    fileName: filename,
  });
  const exports = {};
  const context = vm.createContext({
    exports,
    process: globals.process,
    Buffer,
    console,
    require: (name) => {
      if (name in imports) return imports[name];
      throw Error("Unexpected host import: " + name);
    },
    ...globals,
  });
  new vm.Script(compiled.outputText, { filename }).runInContext(context);
  return exports;
}
const noop = () => () => {};
const nest = {
  ConsoleLogger: class {},
  Injectable: noop,
  Controller: noop,
  Get: noop,
  Param: noop,
  Req: noop,
  Res: noop,
  NotFoundException: class extends Error {},
  BadRequestException: class extends Error {},
};

for (const mode of ["default", "custom", "portable"])
  for (const customEngine of [false, true]) {
    test(`actual locked Terre differential: ${mode}, customEngine=${customEngine}`, async () => {
      const base = path.join(run, `${mode}-${customEngine}`),
        installRoot = path.join(base, "install"),
        hostHomeRoot = path.join(base, "home");
      const configRoot = path.join(hostHomeRoot, ".webgal_terre"),
        customRoot = path.join(base, "external-data");
      const dataRoot =
        mode === "portable"
          ? path.join(installRoot, "data")
          : mode === "custom"
          ? customRoot
          : configRoot;
      fs.mkdirSync(configRoot, { recursive: true });
      if (mode !== "default")
        put(
          path.join(configRoot, "config.json"),
          JSON.stringify({ version: "4.6.4", userDataPath: customRoot })
        );
      for (const dir of [
        "games",
        "templates",
        "derivative-engines",
        "Exported_Games",
      ])
        fs.mkdirSync(path.join(dataRoot, dir), { recursive: true });
      const files = {
        "WebGAL_Terre.exe": "fixture not real exe",
        [`${engine}/index.html`]: "shared index",
        [`${engine}/webgal-engine.json`]: JSON.stringify({
          id: "webgal-mygo.mygo",
          version: "3.2.1",
          webgalVersion: "4.6.4",
        }),
        [`${engine}/assets/engine.js`]: "engine",
        [`${engine}/game/scene/fallback.txt`]: "fallback",
        [`${engine}/game/template/builtin.css`]: "base template",
        [`${engine}/lib/sdk.js`]: "lib",
        "assets/templates/WebGAL_Default_Template/template.json": "default",
        "public/templates/WebGAL_Classic/template.json": "builtin classic",
        "public/templates/WebGAL_Classic/only-builtin.css": "builtin-only",
      };
      for (const [p,b] of Object.entries(files)) if (p.startsWith(engine+'/')) files[p.replace(engine,'assets/templates/Derivative_Engine/MyGO_v3.2.1')]=b;
      for (const [p, value] of Object.entries(files))
        put(path.join(installRoot, p), value);
      const project = path.join(dataRoot, "games", "Demo");
      for (const [p, value] of Object.entries({
        "game/config.txt": "Game_name:Demo;",
        "game/scene/start.txt": "start",
        "assets/engine.js": "stray/custom",
        "game/template/local.css": "local",
      }))
        put(path.join(project, p), value);
      if (customEngine) put(path.join(project, "index.html"), "custom index");
      put(
        path.join(dataRoot, "templates/WebGAL_Classic/template.json"),
        "user overrides builtin"
      );
      const UserDataService = loadTS(
        "Modules/user-data/user-data.service.ts",
        {
          "@nestjs/common": nest,
          fs: fs,
          "fs/promises": {
            ...fsp,
            mkdir: async (p, opts) => {
              checkFixture(p);
              return fsp.mkdir(p, opts);
            },
          },
          os: { homedir: () => hostHomeRoot, platform: () => "win32" },
          path,
          "../../util/open": {
            _open: () => {
              throw Error("GUI forbidden");
            },
          },
          "../../version": loadTS("version.ts", {}),
          "../../util/pathSafety": loadTS("util/pathSafety.ts", { '@nestjs/common': nest, fs, path }, { process: { platform: 'win32' } }),
        },
        { process: { cwd: () => installRoot } }
      ).UserDataService;
      const state = await UserDataService.createState();
      UserDataService.state = state;
      const access = createTerreProjectAccess({
        installRoot,
        hostHomeRoot,
        authorizedUserDataRoot: dataRoot,
        hostFiles: [
          "WebGAL_Terre.exe",
          'assets/templates/Derivative_Engine/MyGO_v3.2.1/index.html',
          'assets/templates/Derivative_Engine/MyGO_v3.2.1/webgal-engine.json',
        ].map((p) => ({ path: p, sha256: sha(files[p]) })),
        projectGrants: [{ name: "Demo", access: "read" }],
      });
      const layout = access.describe();
      assert.equal(layout.installRoot, state.appRoot);
      assert.equal(layout.configPath, state.configPath);
      assert.equal(layout.resolvedUserDataRoot, state.activeUserDataRoot);
      assert.equal(layout.configuredUserDataRoot, state.configuredUserDataRoot);
      assert.equal(layout.gamesRoot, UserDataService.getGameRoot());
      assert.equal(layout.engineRoot, UserDataService.getEngineTemplateRoot());
      assert.equal(
        layout.defaultTemplateRoot,
        UserDataService.getDefaultTemplateRoot()
      );
      assert.equal(layout.exportRoot, UserDataService.getExportRoot());
      assert.equal(
        layout.derivativeEngineRoot,
        UserDataService.getDerivativeEngineRoot()
      );
      assert.equal(
        layout.userTemplateRoot,
        UserDataService.getUserTemplateRoot()
      );
      const Controller = loadTS(
        "Modules/user-data/logical-static.controller.ts",
        {
          "@nestjs/common": nest,
          "@nestjs/swagger": { ApiExcludeController: noop },
          "fs/promises": fsp,
          path,
          "./user-data.service": { UserDataService },
          "../../util/pathSafety": loadTS("util/pathSafety.ts", { '@nestjs/common': nest, fs, path }, { process: { platform: 'win32' } }),
        }
      ).LogicalStaticController;
      const controller = new Controller();
      // Actual selection/stat/fallback code, substituting ONLY HTTP send (no listener/GUI).
      controller.sendFile = async (candidate) => candidate;
      const handle = access.openProject("Demo");
      for (const file of [
        "",
        "index.html",
        "assets/engine.js",
        "lib/sdk.js",
        "game/config.txt",
        "game/scene/start.txt",
        "game/scene/fallback.txt",
        "game/template/local.css",
        "game/template/builtin.css",
        "missing.txt",
      ]) {
        let actual, expected;
        try {
          actual = access.resolvePreviewFile(handle, file).path;
        } catch {
          actual = "MISSING";
        }
        try {
          expected = await controller.sendGameFile("Demo", file, {});
        } catch {
          expected = "MISSING";
        }
        assert.equal(actual, expected, `actual native fallback ${file}`);
      }
      for (const [name, file] of [
        ["WebGAL_Default_Template", "template.json"],
        ["WebGAL_Classic", "template.json"],
        ["WebGAL_Classic", "only-builtin.css"],
      ]) {
        assert.equal(
          access.resolveTemplateFile(name, file).path,
          await UserDataService.resolveReadableTemplateFile(name, file)
        );
      }
      assert.equal(
        access.resolveLogicalProjectRead(
          handle,
          "/public/games/Demo/game/config.txt"
        ).path,
        UserDataService.resolveLogicalPath("/public/games/Demo/game/config.txt")
      );
      assert.equal(
        access.resolveLogicalProjectRead(handle, "/games/Demo/game/config.txt")
          .path,
        UserDataService.resolveLogicalPath("/games/Demo/game/config.txt")
      );
    });
  }

test("read-only historical 3.2.0 host probe", { skip: 'Historical fixture is not the 3.2.1 target; covered by candidate isolated lifecycle test.' }, () => {
  const root = path.resolve(task, "../..");
  const manifest = JSON.parse(
    fs
      .readFileSync(
        path.join(task, "08_host-rebuild-smoke/host-hashes.json"),
        "utf8"
      )
      .replace(/^\uFEFF/, "")
  );
  const hostHomeRoot = path.join(
    root,
    "host-data/mygo3.2.0/hostfix1/config-home"
  );
  const bytes = fs.readFileSync(
    path.join(hostHomeRoot, ".webgal_terre/config.json")
  );
  const dataRoot = JSON.parse(bytes.toString("utf8")).userDataPath;
  // Paths derive from the already frozen isolated-host record, not disk scanning.
  assert.ok(
    path.resolve(dataRoot).startsWith(path.join(root, "host-data") + path.sep)
  );
  const access = createTerreProjectAccess({
    installRoot: manifest.host,
    hostHomeRoot,
    authorizedUserDataRoot: dataRoot,
    hostFiles: manifest.files.filter((f) =>
      [
        "WebGAL_Terre.exe",
        `${engine}/index.html`,
        `${engine}/webgal-engine.json`,
      ].includes(f.path)
    ),
    projectGrants: [],
  });
  const list = access.listProjects();
  assert.ok(list.projects.length > 0);
  assert.equal(list.rejected.length, 0);
  assert.ok(
    list.projects.every(
      (p) =>
        p.authorizedAccess === null &&
        p.runtimeCompatibility === "NOT_VALIDATED"
    )
  );
  assert.ok(
    fs
      .readFileSync(path.join(hostHomeRoot, ".webgal_terre/config.json"))
      .equals(bytes)
  );
});
