import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { inspectAbsolute, fail } from "./terre-path-guard.mjs";
import { BUILTIN_IDENTITIES, legacyBuiltinAlias } from "./builtin-identity.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex").toUpperCase(),
  json = (d) => Buffer.from(JSON.stringify(d, null, 2) + "\n"),
  parse = (b) => JSON.parse(b.toString("utf8").replace(/^\uFEFF/, ""));
const row = (p, b) => ({
  path: p,
  bytes: b.length,
  sha256: sha(b),
  ...(/\.(json|txt)$/.test(p)
    ? {
        normalizedSha256: sha(
          Buffer.from(
            b
              .toString("utf8")
              .replace(/^\uFEFF/, "")
              .replace(/\r\n/g, "\n")
          )
        ),
      }
    : {}),
});
function files(dir, prefix = "") {
  inspectAbsolute(dir, { kind: "directory" });
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (fs.lstatSync(p).isSymbolicLink())
      fail("CREATOR_IDENTITY_LINK_UNSUPPORTED");
    return e.isDirectory()
      ? files(p, prefix + e.name + "/")
      : [{ path: prefix + e.name, bytes: fs.readFileSync(p) }];
  });
}
/** Trusted project root only; whole preflight precedes directory changes. Backup remains outside active catalog. */
export function migrateBuiltinPackages(projectRoot, { fault = () => {} } = {}) {
  const root = inspectAbsolute(projectRoot, { kind: "directory" }).path,
    attachment = path.join(root, "game/attachments-v2"),
    portable = path.join(attachment, "portable");
  if (!fs.existsSync(portable)) return { status: "NO_PACKAGES", migrated: [] };
  inspectAbsolute(portable, { kind: "directory" });
  const ownPath = path.join(
      attachment,
      ".webgal-attachment-creator/game-save-v2.json"
    ),
    journal = path.join(attachment, ".builtin-identity-migration.json");
  if (fs.existsSync(journal))
    fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", journal);
  if (fs.existsSync(ownPath)) inspectAbsolute(ownPath, { kind: "file" });
  const ownBytes = fs.existsSync(ownPath)
      ? fs.readFileSync(ownPath)
      : undefined,
    own = ownBytes ? parse(ownBytes) : undefined,
    plans = [];
  for (const item of BUILTIN_IDENTITIES) {
    const oldRoot = path.join(portable, item.oldLeaf),
      newRoot = path.join(portable, item.leaf),
      docFile = path.join(oldRoot, "attachment.json");
    if (!fs.existsSync(docFile)) continue;
    inspectAbsolute(docFile, { kind: "file" });
    const doc = parse(fs.readFileSync(docFile));
    if (doc.compatibilityAliasFor === item.id) {
      if (!fs.existsSync(path.join(newRoot, "attachment.json")))
        fail("CREATOR_IDENTITY_ALIAS_TARGET_MISSING");
      continue;
    }
    if (fs.existsSync(newRoot))
      fail("CREATOR_IDENTITY_TARGET_CONFLICT", newRoot);
    if (
      doc.schema !== "webgal-live2d-attachment-package" ||
      doc.schemaVersion !== 2 ||
      !Array.isArray(doc.adaptations) ||
      !doc.adaptations.length ||
      doc.adaptations.some((a) => a.preset.presetId !== item.oldId)
    )
      fail("CREATOR_IDENTITY_REVIEW_REQUIRED", oldRoot);
    const original = files(oldRoot),
      mf = parse(
        original.find((x) => x.path === "manifest.json")?.bytes ??
          Buffer.from("{}")
      );
    if (
      !Array.isArray(mf.files) ||
      mf.presetId !== item.oldId ||
      mf.files.length + 1 !== original.length
    )
      fail("CREATOR_IDENTITY_REVIEW_REQUIRED", oldRoot);
    const oldPrefix = "game/attachments-v2/portable/" + item.oldLeaf + "/";
    for (const f of mf.files) {
      if (typeof f.path !== "string" || !f.path.startsWith(oldPrefix))
        fail("CREATOR_IDENTITY_REVIEW_REQUIRED", oldRoot);
      const rel = f.path.slice(oldPrefix.length),
        found = original.find((x) => x.path === rel);
      if (
        !found ||
        sha(found.bytes) !== f.sha256 ||
        found.bytes.length !== f.bytes
      )
        fail("CREATOR_IDENTITY_USER_EDIT_REVIEW", oldRoot);
    }
    for (const f of original) {
      const owned = own?.files?.find((x) => x.path === oldPrefix + f.path);
      if (!owned || owned.sha256 !== sha(f.bytes))
        fail("CREATOR_IDENTITY_OWNERSHIP_REVIEW", oldRoot);
    }
    const prefix = "game/attachments-v2/portable/",
      updated = structuredClone(doc);
    for (const a of updated.adaptations) a.preset.presetId = item.id;
    for (const key of ["layers", "attachedLayers"])
      for (const layer of Object.keys(updated.asset[key] ?? {}))
        updated.asset[key][layer] = updated.asset[key][layer].replace(
          prefix + item.oldLeaf + "/",
          prefix + item.leaf + "/"
        );
    const next = original
      .filter((x) => x.path !== "manifest.json")
      .map((f) => ({
        path: f.path,
        bytes:
          f.path === "attachment.json"
            ? json(updated)
            : f.path === "使用说明.txt"
            ? Buffer.from(
                f.bytes
                  .toString("utf8")
                  .replaceAll(item.oldId, item.id)
                  .replaceAll(item.oldLeaf, item.leaf)
              )
            : f.bytes,
      }));
    const newMf = {
      ...mf,
      presetId: item.id,
      commandSnippet: mf.commandSnippet?.replaceAll(item.oldId, item.id),
      files: next.map((f) => row(prefix + item.leaf + "/" + f.path, f.bytes)),
    };
    next.push({ path: "manifest.json", bytes: json(newMf) });
    plans.push({
      item,
      oldRoot,
      newRoot,
      original,
      next,
      alias: json(legacyBuiltinAlias(updated).document),
    });
  }
  if (!plans.length) return { status: "NO_OP", migrated: [] };
  if (
    own?.schema !== "webgal-attachment-creator-owned-files" ||
    own.schemaVersion !== 2 ||
    !own.ownerId?.startsWith("terre-project:") ||
    !Array.isArray(own.files)
  )
    fail("CREATOR_IDENTITY_OWNERSHIP_REVIEW");
  if (fs.existsSync(path.join(attachment, ".identity-backups")))
    inspectAbsolute(path.join(attachment, ".identity-backups"), {
      kind: "directory",
    });
  const backup = path.join(attachment, ".identity-backups", randomUUID());
  fs.mkdirSync(backup, { recursive: true });
  const intent = {
    schema: "webgal-builtin-identity-migration",
    backup,
    plans: plans.map((p) => ({ oldRoot: p.oldRoot, newRoot: p.newRoot })),
  };
  fs.writeFileSync(journal, json(intent), { flag: "wx" });
  const done = [];
  let writtenOwn;
  try {
    for (const p of plans) {
      if (files(p.oldRoot).length !== p.original.length)
        fail("CREATOR_IDENTITY_STALE");
      for (const f of p.original)
        if (sha(fs.readFileSync(path.join(p.oldRoot, f.path))) !== sha(f.bytes))
          fail("CREATOR_IDENTITY_STALE");
    }
    for (const p of plans) {
      const staging = path.join(backup, "new-" + p.item.leaf);
      fs.mkdirSync(staging);
      for (const f of p.next) {
        fs.mkdirSync(path.dirname(path.join(staging, f.path)), {
          recursive: true,
        });
        fs.writeFileSync(path.join(staging, f.path), f.bytes, { flag: "wx" });
      }
      fs.renameSync(p.oldRoot, path.join(backup, p.item.oldLeaf));
      done.push(p);
      fault("after-old-moved", p.item.id);
      if (fs.existsSync(p.newRoot)) fail("CREATOR_IDENTITY_TARGET_CONFLICT", p.newRoot);
      fs.renameSync(staging, p.newRoot);
      p.newInstalled = true;
      fs.mkdirSync(p.oldRoot);
      fs.writeFileSync(path.join(p.oldRoot, "attachment.json"), p.alias, {
        flag: "wx",
      });
      p.aliasWritten = true;
      fault("installed", p.item.id);
    }
    const prefixes = plans.map(
      (p) => "game/attachments-v2/portable/" + p.item.oldLeaf + "/"
    );
    const nextOwn = {
      ...own,
      files: own.files.filter(
        (f) => !prefixes.some((p) => f.path.startsWith(p))
      ),
    };
    for (const p of plans) {
      for (const f of p.next)
        nextOwn.files.push(
          row(
            "game/attachments-v2/portable/" + p.item.leaf + "/" + f.path,
            f.bytes
          )
        );
      nextOwn.files.push(
        row(
          "game/attachments-v2/portable/" + p.item.oldLeaf + "/attachment.json",
          p.alias
        )
      );
    }
    if (!fs.readFileSync(ownPath).equals(ownBytes))
      fail("CREATOR_IDENTITY_STALE");
    fs.copyFileSync(ownPath, path.join(backup, "ownership-before.json"));
    writtenOwn = json(nextOwn);
    fs.writeFileSync(ownPath, writtenOwn);
    fault("ledger");
    fs.unlinkSync(journal);
    return {
      status: "MIGRATED",
      migrated: plans.map((p) => p.item.id),
      backup,
    };
  } catch (error) {
    // A concurrently created/edited target is foreign. Preserve its original path;
    // retain the journal and backup when rollback cannot restore without touching it.
    const exactTree = (dir, expected) => {
      const actual = files(dir);
      return actual.length === expected.length && actual.every(f => {
        const row = expected.find(e => e.path === f.path);
        return row && sha(row.bytes) === sha(f.bytes);
      });
    };
    if (writtenOwn && !fs.readFileSync(ownPath).equals(writtenOwn))
      fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", journal);
    for (const p of done) {
      if (fs.existsSync(p.oldRoot) && (!p.aliasWritten || !exactTree(p.oldRoot, [{path:"attachment.json",bytes:p.alias}])))
        fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", journal);
      if (p.newInstalled && fs.existsSync(p.newRoot) && !exactTree(p.newRoot,p.next))
        fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", journal);
    }
    // Only directories actually installed by this transaction may be moved back.
    for (const p of done.reverse()) {
      if (fs.existsSync(p.oldRoot))
        fs.renameSync(
          p.oldRoot,
          path.join(backup, "failed-alias-" + p.item.leaf)
        );
      if (p.newInstalled && fs.existsSync(p.newRoot))
        fs.renameSync(
          p.newRoot,
          path.join(backup, "failed-new-" + p.item.leaf)
        );
      fs.renameSync(path.join(backup, p.item.oldLeaf), p.oldRoot);
    }
    if (writtenOwn) {
      if (!fs.readFileSync(ownPath).equals(writtenOwn))
        fail("CREATOR_IDENTITY_RECOVERY_REQUIRED", journal);
      fs.writeFileSync(ownPath, ownBytes);
    }
    fs.unlinkSync(journal);
    throw error;
  }
}
