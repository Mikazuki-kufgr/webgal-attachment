import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  absoluteRoot,
  decodeLogicalPath,
  fail,
  guardedPath,
  inspectAbsolute,
  relativePath,
  stamp,
  withDirectoryInspectionScope,
  directoryInspectionScope,
} from "./terre-path-guard.mjs";

export const TERRE_LAYOUT_ABI = "webgal-mygo3.2.1-terre4.6.4-project-paths-v1";
export const OPTIONAL_HOST_FONTS = Object.freeze([
  "assets/OPPOSans-R-tAcFw8I3.ttf",
  "assets/ResourceHanRoundedCN-Regular-C1HdCLVq.ttf",
  "assets/SourceHanSerifCN-Regular-B_f-kQ2u.ttf",
]);
const ENGINE = "assets/templates/WebGAL_Template";
const MYGO_ENGINE = "assets/templates/Derivative_Engine/MyGO_v3.2.1";
const DEFAULT_UI = "assets/templates/WebGAL_Default_Template";
const AUTHORING = "WebGAL-Attachment-Authoring";
const hash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();
const frozen = (object) => Object.freeze(object);
const equalPath = (a, b) => path.relative(a, b) === "";
function readSmallFile(info, max = 1024 * 1024) {
  if (!info.exists || !info.stat.isFile() || info.stat.size > BigInt(max))
    fail("TERRE_FILE_SIZE_OR_TYPE_INVALID", info.path);
  const data = fs.readFileSync(info.path);
  if (stamp(fs.lstatSync(info.path, { bigint: true })) !== info.stamp)
    fail("TERRE_FILE_CHANGED_DURING_READ", info.path);
  return data;
}

/** Read ONLY the specified installation and this host process's explicit home.
 * Never call UserDataService.initialize/getStatus: both can write directories/config.
 * No root defaults to the assistant's or Creator process's own home/cwd.
 */
export function discoverTerreLayout({
  installRoot: input,
  hostHomeRoot: homeInput,
}) {
  const installRoot = inspectAbsolute(input, { kind: "directory" }).path;
  const hostHomeRoot = inspectAbsolute(homeInput, { kind: "directory" }).path;
  const configRoot = path.join(hostHomeRoot, ".webgal_terre");
  const configFile = guardedPath(configRoot, "config.json", {
    missing: true,
    kind: "file",
  });
  const configBytes = configFile.exists
    ? readSmallFile(configFile, 65536)
    : null;
  let config = {};
  if (configBytes) {
    try {
      config = JSON.parse(configBytes.toString("utf8"));
    } catch {
      fail("TERRE_CONFIG_INVALID");
    }
    if (
      !config ||
      Array.isArray(config) ||
      typeof config !== "object" ||
      (config.userDataPath !== undefined &&
        typeof config.userDataPath !== "string")
    )
      fail("TERRE_CONFIG_INVALID");
  }
  // Upstream resolves relative configured paths against its app cwd. Do not expand %VAR%/~.
  const configuredValue = config.userDataPath;
  if (configuredValue && configuredValue.trim()) {
    if (path.isAbsolute(configuredValue)) absoluteRoot(configuredValue);
    else relativePath(configuredValue.replace(/\\/g, "/"));
  }
  const configuredUserDataRoot =
    configuredValue && configuredValue.trim()
      ? absoluteRoot(path.resolve(installRoot, configuredValue))
      : configRoot;
  const portableDataRoot = path.join(installRoot, "data");
  const portable = inspectAbsolute(portableDataRoot, {
    missing: true,
    kind: "directory",
  });
  const resolvedUserDataRoot = portable.exists
    ? portableDataRoot
    : configuredUserDataRoot;
  return frozen({
    abi: TERRE_LAYOUT_ABI,
    installRoot,
    hostHomeRoot,
    configRoot,
    configPath: configFile.path,
    configSha256: configBytes ? hash(configBytes) : null,
    defaultUserDataRoot: configRoot,
    configuredUserDataRoot,
    portableDataRoot,
    mode: portable.exists
      ? "portable"
      : equalPath(configuredUserDataRoot, configRoot)
      ? "default"
      : "custom",
    resolvedUserDataRoot,
    gamesRoot: path.join(resolvedUserDataRoot, "games"),
    userTemplateRoot: path.join(resolvedUserDataRoot, "templates"),
    derivativeEngineRoot: path.join(resolvedUserDataRoot, "derivative-engines"),
    exportRoot: path.join(resolvedUserDataRoot, "Exported_Games"),
    engineRoot: path.join(installRoot, ENGINE),
    attachmentEngineRoot: path.join(installRoot, MYGO_ENGINE),
    defaultTemplateRoot: path.join(installRoot, DEFAULT_UI),
    builtinTemplateRoot: path.join(installRoot, "public/templates"),
    // Preserve the old independent, user-owned Authoring area across data-root switches.
    // No automatic copying/moving/merging of a previous installation's library.
    defaultAuthoringRoot: path.join(installRoot, AUTHORING),
  });
}

/** All options are trusted launcher-side grants, never browser body/session JSON.
 * Discovery != authorization. The selected active root must exactly equal the grant.
 * Returns opaque project capabilities; no API here writes any bytes or starts a host.
 */
export function createTerreProjectAccess(options) {
  const config = structuredClone(options);
  const layout = discoverTerreLayout(config);
  const grantedRoot = absoluteRoot(config.authorizedUserDataRoot);
  if (!equalPath(layout.resolvedUserDataRoot, grantedRoot))
    fail("TERRE_USER_DATA_NOT_AUTHORIZED");
  inspectAbsolute(grantedRoot, { missing: true, kind: "directory" });
  const authoringRoot = config.authorizedAuthoringRoot
    ? absoluteRoot(config.authorizedAuthoringRoot)
    : layout.defaultAuthoringRoot;
  inspectAbsolute(authoringRoot, { missing: true, kind: "directory" });
  const workspaceRoot = path.join(authoringRoot, "workspace");
  if (
    config.authorizedAuthoringWorkspaceRoot &&
    (!config.authorizedAuthoringRoot ||
      !equalPath(
        absoluteRoot(config.authorizedAuthoringWorkspaceRoot),
        workspaceRoot
      ))
  )
    fail("TERRE_AUTHORING_WORKSPACE_NOT_AUTHORIZED");
  if (!Array.isArray(config.hostFiles) || config.hostFiles.length === 0)
    fail("TERRE_HOST_PROOF_REQUIRED");
  for (const required of [
    "WebGAL_Terre.exe",
    `${MYGO_ENGINE}/webgal-engine.json`,
    `${MYGO_ENGINE}/index.html`,
  ]) {
    if (!config.hostFiles.some((row) => row.path === required))
      fail("TERRE_HOST_PROOF_REQUIRED", required);
  }
  const pins = config.hostFiles.map((row) => {
    relativePath(row.path);
    if (!/^[A-Fa-f0-9]{64}$/.test(row.sha256)) fail("TERRE_HOST_PROOF_INVALID");
    const info = guardedPath(layout.installRoot, row.path, { kind: "file" });
    if (hash(fs.readFileSync(info.path)) !== row.sha256.toUpperCase())
      fail("TERRE_HOST_FINGERPRINT_MISMATCH", row.path);
    if (stamp(fs.lstatSync(info.path, { bigint: true })) !== info.stamp)
      fail("TERRE_HOST_CHANGED");
    return { relative: row.path, stamp: info.stamp };
  });
  const metadata = JSON.parse(
    readSmallFile(
      guardedPath(layout.attachmentEngineRoot, "webgal-engine.json", { kind: "file" })
    ).toString("utf8")
  );
  if (
    metadata.id !== "webgal-mygo.mygo" ||
      metadata.version !== "3.2.1" ||
      metadata.webgalVersion !== "4.6.4"
  )
    fail("TERRE_HOST_VERSION_MISMATCH");
  const rootWatches = [
    layout.installRoot,
    layout.hostHomeRoot,
  ].map((root) => ({
    root,
    identity: inspectAbsolute(root, { kind: "directory" }).identity,
  }));
  const optionalWatches = [
    layout.resolvedUserDataRoot,
    layout.gamesRoot,
    layout.engineRoot,
    layout.attachmentEngineRoot,
    layout.userTemplateRoot,
    layout.derivativeEngineRoot,
    layout.exportRoot,
    layout.defaultTemplateRoot,
    layout.builtinTemplateRoot,
    authoringRoot,
  ].map((root) => ({
    root,
    identity: inspectAbsolute(root, { missing: true, kind: "directory" })
      .identity,
  }));
  const grants = new Map();
  for (const row of config.projectGrants ?? []) {
    relativePath(row.name, { leaf: true });
    if (
      !["read", "attachment-write"].includes(row.access) ||
      grants.has(row.name.toLowerCase())
    )
      fail("TERRE_PROJECT_GRANT_INVALID");
    grants.set(row.name.toLowerCase(), row.access);
  }
  let closed = false;
  const handles = new WeakMap();
  const writePlans = new WeakMap();
  let verifiedScope, transactionContext = false;
  function fresh() {
    return withDirectoryInspectionScope(() => {
    if (closed) fail("TERRE_ACCESS_CLOSED");
    if (transactionContext) return;
    const scope = directoryInspectionScope();
    if (scope && verifiedScope === scope) return;
    const now = discoverTerreLayout(config);
    if (JSON.stringify(now) !== JSON.stringify(layout))
      fail("TERRE_LAYOUT_CHANGED_REAUTHORIZE");
    for (const watch of rootWatches)
      if (
        inspectAbsolute(watch.root, { kind: "directory" }).identity !==
        watch.identity
      )
        fail("TERRE_ROOT_REPLACED");
    for (const watch of optionalWatches) {
      const info = inspectAbsolute(watch.root, {
        missing: true,
        kind: "directory",
      });
      // Missing roots may be materialized later, but then pin their identity.
      if (watch.identity === "MISSING") watch.identity = info.identity;
      else if (info.identity !== watch.identity) fail("TERRE_ROOT_REPLACED");
    }
    for (const pin of pins)
      if (
        guardedPath(layout.installRoot, pin.relative, { kind: "file" })
          .stamp !== pin.stamp
      )
        fail("TERRE_HOST_CHANGED");
    verifiedScope = scope;
    });
  }
  function projectInfo(name, authoring = false) {
    if (!authoring) {
      relativePath(name, { leaf: true });
      if (name.startsWith(".")) fail("TERRE_PROJECT_NAME_HIDDEN");
    }
    const root = authoring
      ? inspectAbsolute(workspaceRoot, { kind: "directory" })
      : guardedPath(layout.gamesRoot, name, { kind: "directory" });
    guardedPath(root.path, "game/config.txt", { kind: "file" });
    const game = guardedPath(root.path, "game", { kind: "directory" });
    const scene = guardedPath(root.path, "game/scene", { kind: "directory" });
    const custom = guardedPath(root.path, "index.html", {
      missing: true,
      kind: "file",
    });
    return {
      name,
      authoring,
      projectRoot: root.path,
      gameRoot: game.path,
      rootIdentity: root.identity,
      gameIdentity: game.identity,
      sceneIdentity: scene.identity,
      customEngineStamp: custom.stamp,
      hasCustomEngine: custom.exists,
      engineRoot: custom.exists ? root.path : authoring ? layout.attachmentEngineRoot : layout.engineRoot,
      engineOrigin: custom.exists ? "project-custom" : "shared",
      runtimeCompatibility: "NOT_VALIDATED",
      logicalRoot: `/public/games/${name}`,
      previewUrlPath: `/games/${encodeURIComponent(name)}/`,
      authorizedAccess: authoring
        ? "attachment-write"
        : grants.get(name.toLowerCase()) ?? (config.projectSelectionPolicy === "explicit-action" ? "attachment-write" : null),
    };
  }
  function checked(handle, write = false) {
    return withDirectoryInspectionScope(() => {
    fresh();
    const granted = handles.get(handle);
    if (!granted) fail("TERRE_PROJECT_CAPABILITY_INVALID");
    if (write && granted.authorizedAccess !== "attachment-write")
      fail("TERRE_PROJECT_WRITE_NOT_AUTHORIZED");
    const now = projectInfo(granted.name, granted.authoring);
    for (const key of [
      "rootIdentity",
      "gameIdentity",
      "sceneIdentity",
      "customEngineStamp",
    ])
      if (now[key] !== granted[key]) fail("TERRE_PROJECT_CHANGED_REAUTHORIZE");
    return now;
    });
  }
  function plan(owner, target, purpose, refresh) {
    const result = frozen({
      path: target.path,
      exists: target.exists,
      owner,
      purpose,
      layoutAbi: TERRE_LAYOUT_ABI,
      contentOwnershipValidated: false,
      runtimeCompatibility: "NOT_VALIDATED",
    });
    if (refresh) writePlans.set(result, { refresh, stamp: target.stamp });
    return result;
  }
  return frozen({
    describe() {
      fresh();
      return frozen({
        ...layout,
        authoringRoot,
        libraryRoot: path.join(authoringRoot, "library"),
        workspaceRoot: path.join(authoringRoot, "workspace"),
      });
    },
    listProjects() {
      fresh();
      const root = inspectAbsolute(layout.gamesRoot, {
        missing: true,
        kind: "directory",
      });
      if (!root.exists)
        return frozen({ projects: frozen([]), rejected: frozen([]) });
      const projects = [],
        rejected = [];
      for (const entry of fs
        .readdirSync(root.path, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (
          entry.name.startsWith(".") ||
          (!entry.isDirectory() && !entry.isSymbolicLink())
        )
          continue;
        try {
          projects.push(frozen(projectInfo(entry.name)));
        } catch (error) {
          rejected.push(
            frozen({
              name: entry.name,
              code: error.code ?? "TERRE_PROJECT_INSPECTION_FAILED",
            })
          );
        }
      }
      fresh();
      return frozen({ projects: frozen(projects), rejected: frozen(rejected) });
    },
    openProject(name) {
      fresh();
      relativePath(name, { leaf: true });
      if (!grants.has(name.toLowerCase()) && config.projectSelectionPolicy !== "explicit-action")
        fail("TERRE_PROJECT_NOT_AUTHORIZED", name);
      const info = projectInfo(name),
        handle = frozen({ name: info.name });
      handles.set(handle, info);
      return handle;
    },
    openAuthoringWorkspace() {
      fresh();
      if (!config.authorizedAuthoringWorkspaceRoot)
        fail("TERRE_AUTHORING_WORKSPACE_NOT_AUTHORIZED");
      const info = projectInfo("authoring-workspace", true),
        handle = frozen({ authoring: true });
      handles.set(handle, info);
      return handle;
    },
    inspectProject(handle) {
      return frozen(checked(handle));
    },
    resolveProjectRead(handle, relative) {
      const p = checked(handle);
      relativePath(relative);
      // This is data access, not the engine fallback route.
      if (!relative.startsWith("game/") && !relative.startsWith("lib/"))
        fail("TERRE_PROJECT_READ_SCOPE_INVALID");
      return plan(
        p.projectRoot,
        guardedPath(p.projectRoot, relative, { kind: "file" }),
        "project-read"
      );
    },
    planAttachmentWrite(handle, relative) {
      const p = checked(handle, true);
      relativePath(relative);
      if (!relative.startsWith("game/attachments-v2/"))
        fail("TERRE_ATTACHMENT_WRITE_SCOPE_INVALID");
      return plan(
        p.projectRoot,
        guardedPath(p.projectRoot, relative, { missing: true, kind: "file" }),
        "attachment-write-plan-only",
        () => this.planAttachmentWrite(handle, relative)
      );
    },
    // User-requested model copies have their own namespace; never grant arbitrary figure writes.
    planCreatorModelWrite(handle, relative, selectedModelRoot) {
      const p = checked(handle, true);
      relativePath(relative);
      if (selectedModelRoot) {
        relativePath(selectedModelRoot);
        if (!selectedModelRoot.startsWith('game/figure/') || selectedModelRoot.split('/').length < 3 || !relative.startsWith(selectedModelRoot+'/')) fail('TERRE_MODEL_IMPORT_WRITE_SCOPE_INVALID');
      }
      if (!selectedModelRoot && !/^game\/figure\/(?:creator-imports\/model-[a-f0-9-]{36}|[^/]+\/[^/]+（导入-[a-f0-9]{8}）)\/.+/.test(relative))
        fail("TERRE_MODEL_IMPORT_WRITE_SCOPE_INVALID");
      return plan(p.projectRoot,
        guardedPath(p.projectRoot, relative, { missing: true, kind: "file" }),
        "creator-model-import-plan-only", () => this.planCreatorModelWrite(handle, relative, selectedModelRoot));
    },
    // A separate, bounded grant for generated verification scenes, never user start.txt.
    planCreatorSceneWrite(handle, presetLeaf) {
      const p = checked(handle, true);
      relativePath(presetLeaf, { leaf: true });
      if (
        !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(presetLeaf) ||
        presetLeaf.includes("..")
      )
        fail("TERRE_CREATOR_PRESET_INVALID");
      const relative = `game/scene/ATTACHMENT-CREATOR-PREVIEW-${presetLeaf}.txt`;
      return plan(
        p.projectRoot,
        guardedPath(p.projectRoot, relative, { missing: true, kind: "file" }),
        "creator-verification-scene-plan-only",
        () => this.planCreatorSceneWrite(handle, presetLeaf)
      );
    },
    planNamedCreatorSceneWrite(handle, relative) {
      const p = checked(handle, true); relativePath(relative);
      if (!/^game\/scene\/附件测试-[\p{L}\p{N}_-]{1,32}-[a-f0-9]{8}\.txt$/u.test(relative)) fail("TERRE_CREATOR_PRESET_INVALID");
      return plan(p.projectRoot, guardedPath(p.projectRoot, relative, { missing: true, kind: "file" }), "creator-verification-scene-plan-only", () => this.planNamedCreatorSceneWrite(handle, relative));
    },
    resolvePreviewFile(handle, relative = "") {
      const p = checked(handle);
      const request = relativePath(relative, { empty: true }) || "index.html";
      const isTemplate =
        request === "game/template" || request.startsWith("game/template/");
      const isProject = ["game", "lib"].some(
        (dir) => request === dir || request.startsWith(`${dir}/`)
      );
      const fallbackRoot = p.authoring ? layout.attachmentEngineRoot : layout.engineRoot;
      const candidates =
        p.hasCustomEngine && isTemplate
          ? [p.projectRoot]
          : p.hasCustomEngine || isProject
          ? [p.projectRoot, fallbackRoot]
          : [fallbackRoot];
      for (const root of candidates) {
        const target = guardedPath(root, request, { missing: true });
        if (target.exists && target.stat.isFile())
          return plan(root, target, "preview-read");
      }
      fail("TERRE_PREVIEW_FILE_MISSING", request);
    },
    resolveTemplateFile(name, relative) {
      fresh();
      relativePath(name, { leaf: true });
      relativePath(relative);
      const roots =
        name === "WebGAL_Default_Template"
          ? [layout.defaultTemplateRoot]
          : [
              path.join(layout.userTemplateRoot, name),
              path.join(layout.builtinTemplateRoot, name),
            ];
      for (const root of roots) {
        const target = guardedPath(root, relative, { missing: true });
        if (target.exists && target.stat.isFile())
          return plan(root, target, "template-read");
      }
      fail("TERRE_TEMPLATE_FILE_MISSING");
    },
    resolveOptionalHostFont(relative) {
      fresh();
      if (!OPTIONAL_HOST_FONTS.includes(relative))
        fail("TERRE_PATH_INVALID");
      const root = layout.attachmentEngineRoot;
      return plan(root, guardedPath(root, relative, { kind: "file" }), "optional-host-font-read");
    },
    resolveDerivativeEngineFile(name, relative) {
      fresh();
      relativePath(name, { leaf: true });
      relativePath(relative);
      const root = path.join(layout.derivativeEngineRoot, name);
      return plan(
        root,
        guardedPath(root, relative, { kind: "file" }),
        "derivative-engine-read"
      );
    },
    resolveLogicalProjectRead(handle, logical) {
      const p = checked(handle),
        decoded = decodeLogicalPath(logical);
      const parts = decoded.split("/");
      if (parts[0] === "public") parts.shift();
      if (parts.shift() !== "games" || parts.shift() !== p.name)
        fail("TERRE_LOGICAL_PROJECT_MISMATCH");
      return this.resolveProjectRead(handle, parts.join("/"));
    },
    describeExportSource(handle) {
      const p = checked(handle);
      return frozen({
        sourceRoot: p.engineRoot,
        engineOrigin: p.engineOrigin,
        gameRoot: p.gameRoot,
        exportRoot: guardedPath(layout.exportRoot, p.name, {
          missing: true,
          kind: "directory",
        }).path,
        exportValidated: false,
        writable: false,
      });
    },
    resolveLibraryRead(relative) {
      fresh();
      relativePath(relative);
      return plan(
        authoringRoot,
        guardedPath(authoringRoot, `library/${relative}`, { kind: "file" }),
        "library-read"
      );
    },
    planLibraryWrite(relative) {
      fresh();
      relativePath(relative);
      if (!config.authorizedAuthoringRoot)
        fail("TERRE_AUTHORING_WRITE_NOT_AUTHORIZED");
      return plan(
        authoringRoot,
        guardedPath(authoringRoot, `library/${relative}`, {
          missing: true,
          kind: "file",
        }),
        "library-write-plan-only",
        () => this.planLibraryWrite(relative)
      );
    },
    // A synchronous writer cannot change host configuration. Check it at both
    // phase boundaries, while every per-file plan still rechecks project identity,
    // all path ancestors, reparse points and the target stamp immediately before writing.
    withTransactionContext(operation) {
      if (transactionContext) fail('TERRE_TRANSACTION_CONTEXT_NESTED');
      fresh(); transactionContext = true;
      try { return operation(); }
      finally { transactionContext = false; fresh(); }
    },
    revalidateWritePlan(candidate) {
      return withDirectoryInspectionScope(() => {
      fresh();
      const prior = writePlans.get(candidate);
      if (!prior) fail("TERRE_WRITE_PLAN_INVALID");
      const next = prior.refresh();
      if (writePlans.get(next).stamp !== prior.stamp)
        fail("TERRE_WRITE_TARGET_CHANGED");
      return next;
      });
    },
    close() {
      closed = true;
    },
  });
}
