import fs from "node:fs";
import os from 'node:os';
import { errorDiagnostic } from './lifecycle-diagnostics.mjs';
import { verifyInstalledHostCompatibility } from './host-compatibility.mjs';
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { fail, inspectAbsolute } from "./terre-path-guard.mjs";

const sha = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").toUpperCase();
const samePath = (a, b) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const LIFECYCLE_LOCK_NAME = ".webgal-attachment.lifecycle.lock";
const EMBEDDED_RELEASE_REVISION = "__WEBGAL_ATTACHMENT_RELEASE_REVISION__";
const LOADED_MODULE_PATH = fileURLToPath(import.meta.url);
const LOADED_MODULE_SHA256 = sha(fs.readFileSync(LOADED_MODULE_PATH));
function parseJsonBytes(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail(code);
  }
}
function loadConfig(configPath) {
  configPath = inspectAbsolute(configPath, { kind: "file" }).path;
  const bytes = fs.readFileSync(configPath),
    config = parseJsonBytes(bytes, "PRODUCT_LAUNCH_CONFIG_INVALID");
  if (
    config.schema !== "webgal-attachment-creator-launch" ||
    config.schemaVersion !== 1 ||
    !config.resources ||
    !config.workspace ||
    !config.terre ||
    !config.workbench ||
    !config.preview ||
    !Number.isInteger(config.port) ||
    config.port < 0 ||
    config.port > 65535
  )
    fail("PRODUCT_LAUNCH_CONFIG_INVALID");
  const managementRoot = inspectAbsolute(config.managementRoot, {
    kind: "directory",
  }).path;
  const expectedState = path.join(managementRoot, "creator-session-v1.json");
  if (
    !samePath(config.statePath, expectedState) ||
    !samePath(
      config.workspace.authoringRoot,
      config.terre.authorizedAuthoringRoot
    ) ||
    !samePath(
      config.workspace.authorizedWorkspaceRoot,
      path.join(config.workspace.authoringRoot, "workspace")
    )
  )
    fail("PRODUCT_LAUNCH_AUTHORITY_INVALID");
  const identity = config.installationIdentity;
  if (
    identity &&
    (identity.schema !== "webgal-attachment-installed-launch-identity" ||
      identity.schemaVersion !== 1 ||
      typeof identity.productVersion !== "string" ||
      typeof identity.releaseRevision !== "string" ||
      !/^[A-F0-9]{64}$/.test(identity.releaseManifestSha256 ?? "") ||
      !/^[A-F0-9]{64}$/.test(identity.installRequestSha256 ?? "") ||
      !/^[A-F0-9]{64}$/.test(identity.hostFingerprintSha256 ?? "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        identity.managerGenerationId ?? ""
      ) ||
      typeof identity.hostAdapterId !== "string")
  )
    fail("PRODUCT_LAUNCH_IDENTITY_INVALID");
  return {
    config,
    configPath,
    configSha256: sha(bytes),
    managementRoot,
    statePath: expectedState,
  };
}

function exactManagerRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("%") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("PRODUCT_MANAGER_MANIFEST_INVALID");
  return value;
}
function managerFileRows(root) {
  const rows = [];
  const visit = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name),
        relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fail("PRODUCT_MANAGER_FILE_UNSAFE", relative);
      if (stat.isDirectory()) visit(file, relative);
      else if (stat.isFile()) rows.push(relative);
      else fail("PRODUCT_MANAGER_FILE_UNSAFE", relative);
    }
  };
  visit(root);
  return rows.sort((a, b) => a.localeCompare(b, "en"));
}
function captureInstalledSnapshot(loaded) {
  const identity = loaded.config.installationIdentity;
  if (!identity) fail("PRODUCT_INSTALLED_LAUNCH_IDENTITY_REQUIRED");
  if (
    !samePath(
      loaded.configPath,
      path.join(loaded.managementRoot, "config", "creator-launch.json")
    )
  )
    fail("PRODUCT_LAUNCH_CONFIG_NOT_CANONICAL");
  const hostRoot = inspectAbsolute(loaded.config.terre.installRoot, {
    kind: "directory",
  }).path;
  const statePath = path.join(
    hostRoot,
    ".webgal-attachment",
    "install-state.json"
  );
  const manifestPath = path.join(
    loaded.managementRoot,
    "config",
    "installed-files.json"
  );
  let stateBytes, manifestBytes;
  try {
    stateBytes = fs.readFileSync(statePath);
    manifestBytes = fs.readFileSync(manifestPath);
  } catch {
    fail("PRODUCT_INSTALLED_LAUNCH_STATE_MISSING");
  }
  return {
    hostRoot,
    statePath,
    manifestPath,
    stateBytes,
    manifestBytes,
    stateSha256: sha(stateBytes),
    manifestSha256: sha(manifestBytes),
  };
}
function validateInstalledSnapshot(loaded, captured) {
  const current = captureInstalledSnapshot(loaded);
  if (
    loaded.configSha256 !== captured.configSha256 ||
    current.stateSha256 !== captured.stateSha256 ||
    current.manifestSha256 !== captured.manifestSha256
  )
    fail("PRODUCT_LAUNCH_SNAPSHOT_STALE");
  const identity = loaded.config.installationIdentity;
  if (
    !samePath(
      loaded.configPath,
      path.join(loaded.managementRoot, "config", "creator-launch.json")
    )
  )
    fail("PRODUCT_LAUNCH_CONFIG_NOT_CANONICAL");
  if (
    EMBEDDED_RELEASE_REVISION.startsWith("__WEBGAL_") ||
    identity.releaseRevision !== EMBEDDED_RELEASE_REVISION
  )
    fail("PRODUCT_LAUNCHER_RUNTIME_STALE");
  const state = parseJsonBytes(
    current.stateBytes,
    "PRODUCT_INSTALLED_LAUNCH_STATE_INVALID"
  );
  const manifest = parseJsonBytes(
    current.manifestBytes,
    "PRODUCT_MANAGER_MANIFEST_INVALID"
  );
  if (
    state.schema !== "webgal-attachment-install-state" ||
    state.schemaVersion !== 1 ||
    state.status !== "INSTALLED" ||
    !samePath(state.hostRoot, current.hostRoot) ||
    !samePath(state.managerRoot, loaded.managementRoot) ||
    state.productVersion !== identity.productVersion ||
    state.releaseRevision !== identity.releaseRevision ||
    state.releaseManifestSha256 !== identity.releaseManifestSha256 ||
    state.hostAdapterId !== identity.hostAdapterId ||
    state.hostFingerprintSha256 !== identity.hostFingerprintSha256 ||
    state.installRequestSha256 !== identity.installRequestSha256 ||
    state.managerGenerationId !== identity.managerGenerationId ||
    state.managerManifestSha256 !== current.manifestSha256
  )
    fail("PRODUCT_INSTALLED_LAUNCH_IDENTITY_MISMATCH");
  if (
    manifest.schema !== "webgal-attachment-installed-files" ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files)
  )
    fail("PRODUCT_MANAGER_MANIFEST_INVALID");
  const expected = new Map();
  for (const row of manifest.files) {
    exactManagerRelative(row.path);
    const key = row.path.toLowerCase();
    if (
      expected.has(key) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0 ||
      !/^[A-F0-9]{64}$/.test(row.sha256 ?? "")
    )
      fail("PRODUCT_MANAGER_MANIFEST_INVALID");
    expected.set(key, row);
    const file = path.join(loaded.managementRoot, ...row.path.split("/"));
    let stat, bytes;
    try {
      stat = fs.lstatSync(file);
      bytes = fs.readFileSync(file);
    } catch {
      fail("PRODUCT_MANAGER_FILE_MISSING", row.path);
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      bytes.length !== row.bytes ||
      sha(bytes) !== row.sha256
    )
      fail("PRODUCT_MANAGER_FILE_DRIFT", row.path);
  }
  const launcherRelative = "runtime/creator-launch.mjs",
    launcher = expected.get(launcherRelative);
  if (
    !launcher ||
    !samePath(
      LOADED_MODULE_PATH,
      path.join(loaded.managementRoot, ...launcherRelative.split("/"))
    ) ||
    launcher.sha256 !== LOADED_MODULE_SHA256
  )
    fail("PRODUCT_LAUNCHER_RUNTIME_STALE");
  const actual = managerFileRows(loaded.managementRoot);
  const expectedPaths = new Set([
    ...expected.keys(),
    "config/installed-files.json",
  ]);
  for (const relative of actual) {
    if (relative.toLowerCase() === "creator-session-v1.json")
      fail("PRODUCT_CREATOR_SESSION_ACTIVE");
    if (!expectedPaths.has(relative.toLowerCase()))
      fail("PRODUCT_MANAGER_EXTRA_FILE", relative);
  }
  if (actual.length !== expectedPaths.size)
    fail("PRODUCT_MANAGER_FILE_MISSING");
  const adapter = JSON.parse(fs.readFileSync(path.join(loaded.managementRoot, 'manifests/host-adapter.json'), 'utf8'));
  verifyInstalledHostCompatibility(current.hostRoot, adapter, state);
  return current;
}

async function loadRuntimeModules(runtimeRoot, generation = randomUUID()) {
  const load = (name) =>
    import(
      `${
        pathToFileURL(path.join(runtimeRoot, name)).href
      }?generation=${encodeURIComponent(generation)}`
    );
  const [service, resources, materialization, access, migration] =
    await Promise.all([
      load("creator-service.mjs"),
      load("product-resources.mjs"),
      load("product-materialization.mjs"),
      load("terre-project-access.mjs"),
      load("builtin-migration.mjs"),
    ]);
  return {
    createCreatorService: service.createCreatorService,
    loadProductResources: resources.loadProductResources,
    initializeAuthoringWorkspace: materialization.initializeAuthoringWorkspace,
    seedGlobalLibrary: materialization.seedGlobalLibrary,
    verifyAuthoringWorkspaceTemplate:
      materialization.verifyAuthoringWorkspaceTemplate,
    createTerreProjectAccess: access.createTerreProjectAccess,
    migrateBuiltinPackages: migration.migrateBuiltinPackages,
  };
}
function accessOptions(config) {
  return {
    ...config.terre,
    authorizedAuthoringRoot: config.workspace.authoringRoot,
    authorizedAuthoringWorkspaceRoot: config.workspace.authorizedWorkspaceRoot,
  };
}
function structuredLog(event) {
  process.stdout.write(`[WebGAL附件] ${event.message ?? event.type}\n`);
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`
  );
}
function unlinkExact(file, expected) {
  if (!fs.existsSync(file)) return;
  const bytes = fs.readFileSync(file);
  if (sha(bytes) === sha(expected)) fs.unlinkSync(file);
}
function assertNoPendingTransaction(hostRoot) {
  const pending = fs
    .readdirSync(hostRoot, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(".webgal-attachment.txn-"));
  if (pending.length) fail("PRODUCT_TRANSACTION_RECOVERY_REQUIRED");
}
function removeDeadCreatorSession(loaded) {
  if (!fs.existsSync(loaded.statePath)) return false;
  const bytes = fs.readFileSync(loaded.statePath),
    session = parseJsonBytes(bytes, "PRODUCT_CREATOR_SESSION_INVALID");
  const identity = loaded.config.installationIdentity;
  const hostRoot = inspectAbsolute(loaded.config.terre.installRoot, {
    kind: "directory",
  }).path;
  if (
    session.schema !== "webgal-attachment-creator-session" ||
    session.schemaVersion !== 1 ||
    typeof session.configPath !== "string" ||
    !samePath(session.configPath, loaded.configPath) ||
    typeof session.hostRoot !== "string" ||
    !samePath(session.hostRoot, hostRoot) ||
    session.managerGenerationId !== (identity?.managerGenerationId ?? null) ||
    !Number.isSafeInteger(session.pid) ||
    session.pid <= 0
  )
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  if (processIsAlive(session.pid)) fail("PRODUCT_CREATOR_SESSION_ACTIVE");
  let current;
  try {
    current = fs.readFileSync(loaded.statePath);
  } catch {
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  if (!current.equals(bytes)) fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  const quarantine = path.join(
    loaded.managementRoot,
    `.creator-session-recovery-${randomUUID()}.quarantine`
  );
  try {
    fs.renameSync(loaded.statePath, quarantine);
  } catch {
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  let moved;
  try {
    moved = fs.readFileSync(quarantine);
  } catch {
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  if (!moved.equals(bytes)) {
    try {
      if (!fs.existsSync(loaded.statePath))
        fs.renameSync(quarantine, loaded.statePath);
    } catch {}
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  try {
    fs.unlinkSync(quarantine);
  } catch {
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  }
  if (fs.existsSync(quarantine) || fs.existsSync(loaded.statePath))
    fail("PRODUCT_CREATOR_SESSION_REQUIRES_REVIEW");
  return true;
}
function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}
function acquireLifecycleGate(hostRoot, lockPath, token) {
  const gatePath = `${lockPath}.acquire`;
  let fd;
  try {
    fd = fs.openSync(gatePath, "wx");
    const record = Buffer.from(
      `${JSON.stringify(
        {
          schema: "webgal-attachment-lifecycle-gate",
          schemaVersion: 1,
          token,
          pid: process.pid,
          hostRoot,
          role: "creator",
          acquiredAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
    fs.writeFileSync(fd, record);
    fs.fsyncSync(fd);
    return { fd, gatePath, token, hostRoot };
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
      try {
        fs.unlinkSync(gatePath);
      } catch {}
    }
    if (error?.code !== "EEXIST") throw error;
    let owner;
    try {
      owner = JSON.parse(fs.readFileSync(gatePath, "utf8"));
    } catch {
      fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
    }
    if (
      owner?.schema !== "webgal-attachment-lifecycle-gate" ||
      owner.schemaVersion !== 1 ||
      typeof owner.token !== "string" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.hostRoot !== "string" ||
      !samePath(owner.hostRoot, hostRoot)
    )
      fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
    if (processIsAlive(owner.pid)) fail("PRODUCT_LIFECYCLE_BUSY");
    fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
  }
}
function releaseLifecycleGate(gate) {
  try {
    fs.closeSync(gate.fd);
  } catch {}
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(gate.gatePath, "utf8"));
  } catch {
    fail("PRODUCT_LIFECYCLE_LOCK_OWNERSHIP_LOST");
  }
  if (
    owner.token !== gate.token ||
    owner.pid !== process.pid ||
    !samePath(owner.hostRoot, gate.hostRoot)
  )
    fail("PRODUCT_LIFECYCLE_LOCK_OWNERSHIP_LOST");
  fs.unlinkSync(gate.gatePath);
}
function acquireLifecycleLock(config) {
  const hostRoot = inspectAbsolute(config.terre.installRoot, {
    kind: "directory",
  }).path;
  const lockPath = path.join(hostRoot, LIFECYCLE_LOCK_NAME),
    token = randomUUID();
  const gate = acquireLifecycleGate(hostRoot, lockPath, token);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        const record = Buffer.from(
          `${JSON.stringify(
            {
              schema: "webgal-attachment-lifecycle-lock",
              schemaVersion: 2,
              token,
              pid: process.pid,
              hostRoot,
              role: "creator",
              acquiredAt: new Date().toISOString(),
            },
            null,
            2
          )}\n`
        );
        try {
          fs.writeFileSync(fd, record);
          fs.fsyncSync(fd);
        } catch (error) {
          try {
            fs.closeSync(fd);
          } catch {}
          try {
            fs.unlinkSync(lockPath);
          } catch {}
          throw error;
        }
        return { fd, lockPath, token, hostRoot };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let owner;
        try {
          owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        } catch {
          fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
        }
        if (
          owner?.schema !== "webgal-attachment-lifecycle-lock" ||
          ![1, 2].includes(owner.schemaVersion) ||
          typeof owner.token !== "string" ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0 ||
          typeof owner.hostRoot !== "string" ||
          !samePath(owner.hostRoot, hostRoot)
        )
          fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
        if (processIsAlive(owner.pid)) fail("PRODUCT_LIFECYCLE_BUSY");
        if (owner.schemaVersion !== 2)
          fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
        const stale = `${lockPath}.stale-${token}`;
        try {
          fs.renameSync(lockPath, stale);
          const moved = JSON.parse(fs.readFileSync(stale, "utf8"));
          if (
            moved.schema !== owner.schema ||
            moved.schemaVersion !== owner.schemaVersion ||
            moved.token !== owner.token ||
            moved.pid !== owner.pid ||
            !samePath(moved.hostRoot, owner.hostRoot)
          )
            fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
          fs.rmSync(stale, { force: true });
        } catch (stealError) {
          if (["ENOENT", "EEXIST"].includes(stealError?.code)) continue;
          if (stealError?.code?.startsWith?.("PRODUCT_")) throw stealError;
          fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
        }
      }
    }
    fail("PRODUCT_LIFECYCLE_LOCK_REQUIRES_REVIEW");
  } finally {
    releaseLifecycleGate(gate);
  }
}
function releaseLifecycleLock(lock) {
  try {
    fs.closeSync(lock.fd);
  } catch {}
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(lock.lockPath, "utf8"));
  } catch {
    fail("PRODUCT_LIFECYCLE_LOCK_OWNERSHIP_LOST");
  }
  if (
    owner.token !== lock.token ||
    owner.pid !== process.pid ||
    !samePath(owner.hostRoot, lock.hostRoot)
  )
    fail("PRODUCT_LIFECYCLE_LOCK_OWNERSHIP_LOST");
  fs.unlinkSync(lock.lockPath);
}
function openBrowser(url) {
  const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

export async function checkCreatorLaunch(configPath) {
  const loaded = loadConfig(configPath);
  const runtime = await loadRuntimeModules(
    path.dirname(LOADED_MODULE_PATH),
    `check-${randomUUID()}`
  );
  const {
    loadProductResources,
    verifyAuthoringWorkspaceTemplate,
    createCreatorService,
  } = runtime;
  const resources = loadProductResources(loaded.config.resources);
  const template = verifyAuthoringWorkspaceTemplate(
    loaded.config.workspace.template
  );
  const service = createCreatorService(accessOptions(loaded.config), {
    workbench: loaded.config.workbench,
    preview: loaded.config.preview,
  });
  await service.close();
  return Object.freeze({
    ok: true,
    status: "CHECK_ONLY_NO_WRITES",
    resourceFiles: resources.rows.length,
    profileFiles: resources.manifest.counts["model-profile"],
    templateFiles: template.files,
    sdkBundled: false,
    modelBinariesBundled: false,
    guiOpened: false,
  });
}

export async function startCreatorLaunch(
  configPath,
  {
    open = false,
    log = structuredLog,
    testOnlySkipInstalledIdentity = false,
    testOnlyAfterInitialSnapshot = null,
  } = {}
) {
  const initial = loadConfig(configPath);
  const captured = testOnlySkipInstalledIdentity
    ? { configSha256: initial.configSha256 }
    : {
        configSha256: initial.configSha256,
        ...captureInstalledSnapshot(initial),
      };
  if (typeof testOnlyAfterInitialSnapshot === "function")
    await testOnlyAfterInitialSnapshot();
  const lifecycleLock = acquireLifecycleLock(initial.config);
  let service = null;
  let stateBytes;
  let lockedStatePath = null;
  try {
    const loaded = loadConfig(configPath);
    lockedStatePath = loaded.statePath;
    if (loaded.configSha256 !== captured.configSha256)
      fail("PRODUCT_LAUNCH_SNAPSHOT_STALE");
    if (!testOnlySkipInstalledIdentity) {
      const hostRoot = inspectAbsolute(loaded.config.terre.installRoot, {
        kind: "directory",
      }).path;
      assertNoPendingTransaction(hostRoot);
      removeDeadCreatorSession(loaded);
      validateInstalledSnapshot(loaded, captured);
    }
    const runtime = await loadRuntimeModules(
      testOnlySkipInstalledIdentity
        ? path.dirname(LOADED_MODULE_PATH)
        : path.join(loaded.managementRoot, "runtime"),
      loaded.config.installationIdentity?.managerGenerationId ??
        `test-${randomUUID()}`
    );
    const {
      createCreatorService,
      loadProductResources,
      initializeAuthoringWorkspace,
      seedGlobalLibrary,
      createTerreProjectAccess,
      migrateBuiltinPackages,
    } = runtime;
    const resources = loadProductResources(loaded.config.resources);
    const workspace = initializeAuthoringWorkspace({
      authoringRoot: loaded.config.workspace.authoringRoot,
      authorizedWorkspaceRoot: loaded.config.workspace.authorizedWorkspaceRoot,
      template: loaded.config.workspace.template,
    });
    const grants = accessOptions(loaded.config);
    service = createCreatorService(grants, {
      workbench: loaded.config.workbench,
      preview: loaded.config.preview,
      log,
    });
    const seedAccess = createTerreProjectAccess(grants);
    let seed;
    try {
      seed = seedGlobalLibrary({ access: seedAccess, resources });
    } finally {
      seedAccess.close();
    }
    let migrations = [];
    try {
      migrations = await migrateAuthorized(
        loaded,
        createTerreProjectAccess,
        migrateBuiltinPackages
      );
    } catch (error) {
      if (!String(error.code).startsWith("CREATOR_IDENTITY_")) throw error;
      log({
        type: "builtin.identity.review",
        result: "REVIEW",
        message:
          "附件名称迁移需要检查：已有内容保持可编辑，请从继续编辑列表载入核对；没有强制覆盖。",
        code: error.code,
      });
    }
    if (migrations.some((x) => x.status === "MIGRATED"))
      log({
        type: "builtin.identity.migrated",
        result: "MIGRATED",
        migrations,
      });
    const listening = await service.listen(loaded.config.port);
    stateBytes = Buffer.from(
      `${JSON.stringify(
        {
          schema: "webgal-attachment-creator-session",
          schemaVersion: 1,
          pid: listening.pid,
          origin: listening.origin,
          token: listening.token,
          launchUrl: listening.launchUrl,
          startedAt: new Date().toISOString(),
          configPath: loaded.configPath,
          hostRoot: loaded.config.terre.installRoot,
          managerGenerationId:
            loaded.config.installationIdentity?.managerGenerationId ?? null,
        },
        null,
        2
      )}\n`
    );
    fs.writeFileSync(loaded.statePath, stateBytes, { flag: "wx" });
    log({
      type: "launcher.ready",
      result: "READY",
      message: `附件制作器已启动：${listening.origin}`,
      workspace: workspace.status,
      library: seed.noOp ? "NO_OP" : "SEEDED",
    });
    if (open) openBrowser(listening.launchUrl);
    const stop = () => {
      void service.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await service.waitForClose();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    unlinkExact(loaded.statePath, stateBytes);
    log({
      type: "launcher.stopped",
      result: "STOPPED",
      message: "附件制作器已停止（仅关闭本次服务）",
    });
    return { ok: true, workspace, seed, listening };
  } catch (error) {
    await service?.close().catch(() => undefined);
    if (stateBytes && lockedStatePath) unlinkExact(lockedStatePath, stateBytes);
    throw error;
  } finally {
    releaseLifecycleLock(lifecycleLock);
  }
}

export async function stopCreatorLaunch(configPath) {
  const loaded = loadConfig(configPath);
  const cleanStopped = () => {
    const lock = acquireLifecycleLock(loaded.config);
    try {
      const cleaned = removeDeadCreatorSession(loaded);
      return Object.freeze({
        ok: true,
        status: cleaned ? "ALREADY_STOPPED_CLEANED" : "ALREADY_STOPPED",
        scope: "OWNED_SERVER_ONLY",
      });
    } finally {
      releaseLifecycleLock(lock);
    }
  };
  if (!fs.existsSync(loaded.statePath)) return cleanStopped();
  const state = parseJsonBytes(
    fs.readFileSync(loaded.statePath),
    "PRODUCT_CREATOR_SESSION_INVALID"
  );
  if (
    state.schema !== "webgal-attachment-creator-session" ||
    state.schemaVersion !== 1 ||
    typeof state.configPath !== "string" ||
    !samePath(state.configPath, loaded.configPath) ||
    typeof state.hostRoot !== "string" ||
    !samePath(state.hostRoot, loaded.config.terre.installRoot) ||
    state.managerGenerationId !==
      (loaded.config.installationIdentity?.managerGenerationId ?? null) ||
    !Number.isSafeInteger(state.pid) ||
    state.pid <= 0 ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(state.origin) ||
    !/^[A-Fa-f0-9]{64}$/.test(state.token)
  )
    fail("PRODUCT_CREATOR_SESSION_INVALID");
  if (!processIsAlive(state.pid)) return cleanStopped();
  try {
    const response = await fetch(`${state.origin}/__creator/shutdown`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Creator-Session": state.token,
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (!response.ok || body.shutdown !== "REQUESTED")
      fail("PRODUCT_CREATOR_STOP_FAILED");
    return Object.freeze({
      ok: true,
      status: "SHUTDOWN_REQUESTED",
      scope: "OWNED_SERVER_ONLY",
      pid: state.pid,
    });
  } catch (error) {
    if (!processIsAlive(state.pid)) return cleanStopped();
    fail(
      "PRODUCT_CREATOR_STOP_UNREACHABLE",
      `进程 PID ${
        state.pid
      } 仍在运行，但无法确认停止响应。请检查制作器日志窗口；没有强制结束任何进程。原因：${
        error.code ?? error.message
      }`
    );
  }
}

async function migrateAuthorized(
  loaded,
  accessFactory,
  migrateBuiltinPackages
) {
  const access = accessFactory(accessOptions(loaded.config));
  try {
    const handles = [
      ...(fs.existsSync(
        path.join(
          loaded.config.workspace.authorizedWorkspaceRoot,
          "game/attachments-v2/portable"
        )
      )
        ? [access.openAuthoringWorkspace()]
        : []),
      ...access
        .listProjects()
        .projects.filter((p) => p.authorizedAccess === "attachment-write")
        .map((p) => access.openProject(p.name)),
    ];
    return handles.map((h) => {
      const p = access.inspectProject(h);
      return { project: p.name, ...migrateBuiltinPackages(p.projectRoot) };
    });
  } finally {
    access.close();
  }
}
export async function migrateInstalledBuiltins(configPath) {
  const loaded = loadConfig(configPath),
    captured = {
      configSha256: loaded.configSha256,
      ...captureInstalledSnapshot(loaded),
    };
  const lock = acquireLifecycleLock(loaded.config);
  try {
    assertNoPendingTransaction(captured.hostRoot);
    removeDeadCreatorSession(loaded);
    validateInstalledSnapshot(loaded, captured);
    const runtime = await loadRuntimeModules(
      path.join(loaded.managementRoot, "runtime")
    );
    return {
      ok: true,
      migrations: await migrateAuthorized(
        loaded,
        runtime.createTerreProjectAccess,
        runtime.migrateBuiltinPackages
      ),
    };
  } finally {
    releaseLifecycleLock(lock);
  }
}

async function cli() {
  const args = process.argv.slice(2),
    at = args.indexOf("--config");
  if (at < 0 || !args[at + 1]) fail("PRODUCT_LAUNCH_CONFIG_REQUIRED");
  const configPath = args[at + 1];
  if (args.includes("--check")) return checkCreatorLaunch(configPath);
  if (args.includes("--stop")) return stopCreatorLaunch(configPath);
  if (args.includes("--migrate-builtins"))
    return migrateInstalledBuiltins(configPath);
  return startCreatorLaunch(configPath, { open: !args.includes("--no-open") });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli()
    .then((result) => {
      if (process.argv.includes("--human") && process.argv.includes("--stop"))
        process.stdout.write(
          result.status === "SHUTDOWN_REQUESTED"
            ? "[WebGAL附件] 已发送安全停止请求，请等待制作器日志窗口退出服务。\n"
            : "[WebGAL附件] 服务已经停止；已检查并清理本产品的死亡会话，无需重复关闭。\n"
        );
      else if (
        process.argv.includes("--check") ||
        process.argv.includes("--stop") ||
        process.argv.includes("--migrate-builtins")
      )
        process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      const diagnostic = errorDiagnostic(error, { stage: 'creator-launch', operation: 'launch' });
      let diagnosticPath;
      try {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'WebGAL-Attachment-creator-diagnostic-'));
        diagnosticPath = path.join(directory, 'result.json');
        fs.writeFileSync(diagnosticPath, JSON.stringify({ ok: false, code: error.code, detail: diagnostic }, null, 2) + '\n', { flag: 'wx' });
      } catch { /* Always retain the full diagnostic on stderr as a fallback. */ }
      process.stderr.write(
        `停止或启动未完成：${error.code ?? error.message ?? error}\n${diagnostic.message}\n${diagnostic.hint}\n` +
        (diagnosticPath ? `详细诊断（JSON）：${diagnosticPath}\n` : JSON.stringify(diagnostic) + '\n')
      );
      process.exitCode = 1;
    });
}
