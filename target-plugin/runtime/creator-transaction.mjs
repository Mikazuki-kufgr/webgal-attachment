import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inspectAbsolute, fail, withDirectoryInspectionScope } from "./terre-path-guard.mjs";
import { sha, jsonBytes, readChecked, MAX_BODY } from "./creator-package.mjs";
const active = new Set();
const normalized = (bytes) =>
  Buffer.from(
    bytes
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
  );
const textFile = (p) => /\.(?:json|txt)$/i.test(p);
const facts = (p, b) => ({
  path: p,
  bytes: b.length,
  sha256: sha(b),
  ...(textFile(p) ? { normalizedSha256: sha(normalized(b)) } : {}),
});
function same(row, bytes) {
  return row.bytes === bytes.length && row.sha256 === sha(bytes);
}
function owned(row, p, bytes) {
  return (
    row &&
    (same(row, bytes) ||
      (textFile(p) && row.normalizedSha256 === sha(normalized(bytes))))
  );
}
function readPlan(plan, max = MAX_BODY) {
  return plan.exists
    ? readChecked({ owner: plan.owner, path: plan.path }, max)
    : null;
}
function exclusive(p, bytes) {
  const fd = fs.openSync(p, "wx"),
    created = fs.fstatSync(fd, { bigint: true });
  let error;
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (e) {
    error = e;
  } finally {
    fs.closeSync(fd);
  }
  if (error) {
    const now = fs.lstatSync(p, { bigint: true });
    if (
      now.dev === created.dev &&
      now.ino === created.ino &&
      now.birthtimeNs === created.birthtimeNs
    )
      fs.unlinkSync(p);
    throw error;
  }
}

/** Synchronous commit, exclusive durable intent record, exact content ownership.
 * Recovery on process/power loss is intentionally fail-closed, not guessed on next startup.
 * A hostile local process can still race pathname checks; this is not an OS sandbox.
 */
export function commitOwned({
  access,
  plan,
  ownerId,
  ownershipPath,
  journalPath,
  files,
  acceptedCurrentPaths = [],
  releasePaths = [],
  signal,
  validateReadSet = () => {},
  fault = () => {},
  maxFileBytes = MAX_BODY,
}) {
  const ledgerPlan = plan(ownershipPath),
    journalPlan = plan(journalPath),
    key = ledgerPlan.path.toLowerCase();
  if (active.has(key)) fail("CREATOR_SAVE_BUSY");
  if (journalPlan.exists) fail("CREATOR_RECOVERY_REQUIRED", journalPlan.path);
  active.add(key);
  const createdDirs = [],
    staged = [],
    nonce = randomUUID();
  let journalCreated = false,
    committed = false;
  const abort = () => {
    if (signal?.aborted) fail("CREATOR_SAVE_ABORTED");
  };
  const mkdir = (dir) => {
    const info = inspectAbsolute(dir, { missing: true, kind: "directory" });
    if (info.exists) return;
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir);
    createdDirs.push({
      path: dir,
      identity: inspectAbsolute(dir, { kind: "directory" }).identity,
    });
  };
  const unlinkOwned = (p, hash) => {
    const info = inspectAbsolute(p, { missing: true, kind: "file" });
    if (!info.exists) return;
    if (sha(fs.readFileSync(p)) !== hash) fail("CREATOR_RECOVERY_REQUIRED", p);
    fs.unlinkSync(p);
  };
  try {
    abort();
    const oldBytes = readPlan(ledgerPlan);
    let old = {
      schema: "webgal-attachment-creator-owned-files",
      schemaVersion: 2,
      ownerId,
      files: [],
    };
    if (oldBytes) {
      try {
        old = JSON.parse(oldBytes.toString("utf8").replace(/^\uFEFF/, ""));
      } catch {
        fail("CREATOR_OWNERSHIP_INVALID");
      }
    }
    if (
      old.schema !== "webgal-attachment-creator-owned-files" ||
      old.schemaVersion !== 2 ||
      old.ownerId !== ownerId ||
      !Array.isArray(old.files)
    )
      fail("CREATOR_OWNERSHIP_INVALID");
    const owners = new Map();
    withDirectoryInspectionScope(() => {
    for (const row of old.files) {
      if (
        typeof row.path !== "string" ||
        owners.has(row.path.toLowerCase()) ||
        row.path === ownershipPath ||
        row.path === journalPath ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0 ||
        !/^[A-F0-9]{64}$/.test(row.sha256) ||
        (row.normalizedSha256 !== undefined &&
          !/^[A-F0-9]{64}$/.test(row.normalizedSha256))
      )
        fail("CREATOR_OWNERSHIP_INVALID");
      plan(row.path); // All historical ledger entries must still be in the exact allowed namespace.
      owners.set(row.path.toLowerCase(), row);
    }
    });
    const accepted = new Set();
    for (const relative of acceptedCurrentPaths) {
      if (typeof relative !== "string" || accepted.has(relative.toLowerCase()))
        fail("CREATOR_ACCEPTED_PATHS_INVALID");
      plan(relative);
      accepted.add(relative.toLowerCase());
    }
    const released = new Set();
    for (const relative of releasePaths) {
      if (typeof relative !== "string" || released.has(relative.toLowerCase()))
        fail("CREATOR_RELEASE_PATHS_INVALID");
      plan(relative);
      released.add(relative.toLowerCase());
      owners.delete(relative.toLowerCase());
    }
    const seen = new Set(),
      results = [],
      conflicts = [],
      changes = [];
    withDirectoryInspectionScope(() => {
    for (const file of files) {
      if (
        seen.has(file.path.toLowerCase()) ||
        file.path === ownershipPath ||
        file.path === journalPath
      )
        fail("CREATOR_TRANSACTION_FILE_SET_INVALID");
      seen.add(file.path.toLowerCase());
      const target = plan(file.path),
        before = readPlan(target, maxFileBytes),
        previous = owners.get(file.path.toLowerCase());
      const unchanged = before !== null && before.equals(file.bytes);
      const explicitlyAccepted = accepted.has(file.path.toLowerCase());
      const permitted =
        before === null || explicitlyAccepted || owned(previous, file.path, before);
      const status =
        before === null
          ? "created"
          : unchanged
          ? "unchanged"
          : permitted
          ? "updated"
          : "conflict";
      results.push({ ...facts(file.path, file.bytes), status });
      if (status === "conflict") {
        conflicts.push(file.path);
        continue;
      }
      // Identical foreign files remain foreign; stale ownership must never be revived by a no-op.
      if (permitted)
        owners.set(
          file.path.toLowerCase(),
          facts(file.path, unchanged ? before : file.bytes)
        );
      else owners.delete(file.path.toLowerCase());
      if (!unchanged) changes.push({ ...file, plan: target, before });
    }
    });
    if ([...accepted].some((relative) => !seen.has(relative)))
      fail("CREATOR_ACCEPTED_PATHS_INVALID");
    if (conflicts.length)
      return {
        ok: false,
        code: "CREATOR_GAME_FILE_CONFLICT",
        conflicts,
        files: results,
        wrote: false,
      };
    const appliedAt = new Date().toISOString();
    const next = {
      schema: old.schema,
      schemaVersion: 2,
      ownerId,
      appliedAt,
      files: [...owners.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
    // A true no-op does not rewrite timestamps or acquire ownership of identical foreign files.
    if (
      !changes.length &&
      oldBytes &&
      JSON.stringify(old.files) === JSON.stringify(next.files)
    ) {
      validateReadSet();
      abort();
      return { ok: true, files: results, appliedAt: old.appliedAt, noOp: true };
    }
    const nextBytes = jsonBytes(next);
    changes.push({
      path: ownershipPath,
      bytes: nextBytes,
      plan: ledgerPlan,
      before: oldBytes,
    });
    withDirectoryInspectionScope(() => {
    for (const row of changes) {
      row.tmp = row.plan.path + ".creator-tmp-" + nonce;
      row.backup = row.plan.path + ".creator-bak-" + nonce;
      row.installed = false;
      row.backedUp = false;
      row.staged = false;
      for (const p of [row.tmp, row.backup])
        if (inspectAbsolute(p, { missing: true, kind: "file" }).exists)
          fail("CREATOR_TEMP_COLLISION");
    }
    });
    const journalBytes = jsonBytes({
      schema: "webgal-attachment-creator-transaction",
      schemaVersion: 1,
      ownerId,
      nonce,
      createdAt: appliedAt,
      recovery: "MANUAL_REVIEW_REQUIRED_AFTER_INTERRUPTION",
      files: changes.map((r) => ({
        path: r.path,
        target: r.plan.path,
        tmp: r.tmp,
        backup: r.backup,
        before: r.before ? facts(r.path, r.before) : null,
        after: facts(r.path, r.bytes),
      })),
    });
    fault("preflight");
    abort();
    validateReadSet();
    access.revalidateWritePlan(journalPlan);
    mkdir(path.dirname(journalPlan.path));
    exclusive(journalPlan.path, journalBytes);
    journalCreated = true;
    validateReadSet();
    const writePhase = fn => access.withTransactionContext ? access.withTransactionContext(fn) : fn();
    const preparedParents = new Set();
    writePhase(() => {
    for (const row of changes) {
      access.revalidateWritePlan(row.plan);
      const parent = path.dirname(row.tmp);
      if (!preparedParents.has(parent)) { mkdir(parent); preparedParents.add(parent); }
      exclusive(row.tmp, row.bytes);
      row.staged = true;
      staged.push(row);
      fault("staged", row.path);
      abort();
    }
    });
    withDirectoryInspectionScope(() => {
      for (const row of changes) access.revalidateWritePlan(row.plan);
    });
    validateReadSet();
    writePhase(() => {
    for (const row of staged) {
      fault("before-commit", row.path);
      abort();
      access.revalidateWritePlan(row.plan);
      if (row.before) {
        fs.renameSync(row.plan.path, row.backup);
        row.backedUp = true;
        if (
          sha(
            fs.readFileSync(inspectAbsolute(row.backup, { kind: "file" }).path)
          ) !== sha(row.before)
        )
          fail("CREATOR_WRITE_TARGET_CHANGED");
      }
      // link is exclusive: unlike rename it cannot silently replace a newly appeared file.
      fs.linkSync(row.tmp, row.plan.path);
      row.installed = true;
      fs.unlinkSync(row.tmp);
      row.staged = false;
      fault("installed", row.path);
    }
    });
    committed = true;
    const warnings = [];
    try {
      for (const row of staged)
        if (row.backedUp) unlinkOwned(row.backup, sha(row.before));
      unlinkOwned(journalPlan.path, sha(journalBytes));
      journalCreated = false;
    } catch (error) {
      warnings.push({
        code: "CREATOR_COMMITTED_CLEANUP_PENDING",
        journalPath: journalPlan.path,
        cause: error.code ?? error.message,
      });
    }
    return { ok: true, files: results, appliedAt, noOp: false, warnings };
  } catch (error) {
    if (committed) throw error;
    let rollbackError;
    for (const row of [...staged].reverse()) {
      try {
        if (row.installed) {
          unlinkOwned(row.plan.path, sha(row.bytes));
          row.installed = false;
        }
        if (row.backedUp) {
          inspectAbsolute(row.backup, { kind: "file" });
          if (sha(fs.readFileSync(row.backup)) !== sha(row.before))
            fail("CREATOR_RECOVERY_REQUIRED");
          inspectAbsolute(row.plan.path, { missing: true, kind: "file" });
          fs.linkSync(row.backup, row.plan.path);
          fs.unlinkSync(row.backup);
          row.backedUp = false;
        }
        if (row.staged) unlinkOwned(row.tmp, sha(row.bytes));
      } catch (e) {
        rollbackError = e;
      }
    }
    if (!rollbackError && journalCreated) {
      try {
        inspectAbsolute(journalPlan.path, { kind: "file" });
        const j = JSON.parse(fs.readFileSync(journalPlan.path));
        if (j.nonce !== nonce) fail("CREATOR_RECOVERY_REQUIRED");
        fs.unlinkSync(journalPlan.path);
        journalCreated = false;
      } catch (e) {
        rollbackError = e;
      }
    }
    if (!rollbackError)
      for (const dir of [...createdDirs].reverse()) {
        try {
          if (
            inspectAbsolute(dir.path, { kind: "directory" }).identity ===
              dir.identity &&
            fs.readdirSync(dir.path).length === 0
          )
            fs.rmdirSync(dir.path);
        } catch {
          /* Do not remove a replaced/non-empty directory. */
        }
      }
    if (rollbackError) {
      const failure = new Error("CREATOR_RECOVERY_REQUIRED");
      failure.code = "CREATOR_RECOVERY_REQUIRED";
      failure.journalPath = journalPlan.path;
      failure.cause = error;
      throw failure;
    }
    throw error;
  } finally {
    active.delete(key);
  }
}
