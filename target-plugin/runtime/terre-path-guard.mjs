import fs from "node:fs";
import path from "node:path";

export class TerrePathError extends Error {
  constructor(code, detail = "") {
    super(`${code}${detail ? `: ${detail}` : ""}`);
    this.name = "TerrePathError";
    this.code = code;
  }
}
export function fail(code, detail) {
  throw new TerrePathError(code, detail);
}

// Public relative-path arguments are already decoded filesystem names, NOT URLs.
// Reject ambiguous Windows spellings rather than normalizing to another file.
export function relativePath(value, { empty = false, leaf = false } = {}) {
  if (empty && value === "") return "";
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("%")
  ) {
    fail("TERRE_PATH_INVALID", String(value));
  }
  const parts = value.split("/");
  if (leaf && parts.length !== 1) fail("TERRE_NAME_INVALID", value);
  for (const part of parts) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      /[\u0000-\u001f<>:"|?*]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
        part
      )
    )
      fail("TERRE_PATH_INVALID", value);
  }
  return value;
}

export function absoluteRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value))
    fail("TERRE_ROOT_ABSOLUTE_REQUIRED");
  // This adapter's supported product target is Windows x64, local drives only.
  if (process.platform === "win32" && !/^[a-z]:[\\/]/i.test(value))
    fail("TERRE_NETWORK_OR_DEVICE_ROOT_UNSUPPORTED");
  const parsed = path.parse(value);
  const tail = value.slice(parsed.root.length).replace(/\\/g, "/");
  relativePath(tail.replace(/\/$/, ""));
  const result = path.resolve(value);
  if (result === parsed.root) fail("TERRE_VOLUME_ROOT_FORBIDDEN");
  return result;
}

export function inside(root, candidate, allowEqual = false) {
  const rel = path.relative(root, candidate);
  return (
    (allowEqual && rel === "") ||
    (rel !== "" &&
      rel !== ".." &&
      !rel.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(rel))
  );
}

function lstat(target) {
  try {
    return fs.lstatSync(target, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A single synchronous read-only inspection may visit the same directory hundreds
// of times. Reuse only directory observations inside that inspection; no cache
// survives a write, transaction phase, event-loop turn, or subsequent API call.
let directoryInspectionCache;
// Identity of the current synchronous read phase, never retained across a write/await.
export const directoryInspectionScope = () => directoryInspectionCache;
export function withDirectoryInspectionScope(readOnlyOperation) {
  if (directoryInspectionCache) return readOnlyOperation();
  directoryInspectionCache = new Map();
  try { return readOnlyOperation(); }
  finally { directoryInspectionCache = undefined; }
}

export function identity(stat) {
  return stat ? `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` : "MISSING";
}
export function stamp(stat) {
  return stat
    ? `${identity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
    : "MISSING";
}

// Check every existing ancestor, including the leaf and dangling reparse points.
// Reject even in-root links: no silent widening or alias to a different project.
export function inspectAbsolute(value, { missing = false, kind } = {}) {
  const target = absoluteRoot(value);
  const volume = path.parse(target).root;
  let current = volume,
    previousMissing = false,
    stat = null;
  const parts = path.relative(volume, target).split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const cachedDirectory = directoryInspectionCache?.get(current);
    stat = previousMissing ? null : cachedDirectory ?? lstat(current);
    if (!stat) {
      if (!missing) fail("TERRE_PATH_MISSING", current);
      previousMissing = true;
      continue;
    }
    if (stat.isSymbolicLink()) fail("TERRE_REPARSE_POINT_BLOCKED", current);
    if (i < parts.length - 1 && !stat.isDirectory())
      fail("TERRE_PARENT_NOT_DIRECTORY", current);
    if (stat.isFile() && stat.nlink > 1n)
      fail("TERRE_HARDLINK_BLOCKED", current);
    if (!stat.isFile() && !stat.isDirectory())
      fail("TERRE_SPECIAL_FILE_BLOCKED", current);
    const real = cachedDirectory ? current : fs.realpathSync.native(current);
    if (!inside(volume, real) || path.relative(current, real) !== "")
      fail("TERRE_CANONICAL_PATH_CHANGED", current);
    if (stat.isDirectory()) directoryInspectionCache?.set(current, stat);
  }
  if (
    stat &&
    kind &&
    !(kind === "directory" ? stat.isDirectory() : stat.isFile())
  )
    fail("TERRE_PATH_KIND_MISMATCH", target);
  return {
    path: target,
    exists: stat !== null,
    stat,
    identity: identity(stat),
    stamp: stamp(stat),
  };
}

export function guardedPath(root, relative = "", options = {}) {
  const base = absoluteRoot(root);
  relativePath(relative, { empty: true });
  const target = path.resolve(base, relative);
  if (!inside(base, target, true)) fail("TERRE_PATH_OUTSIDE_ROOT", relative);
  return inspectAbsolute(target, options);
}

export function decodeLogicalPath(value) {
  if (typeof value !== "string" || value.includes("\\") || /[?#]/.test(value))
    fail("TERRE_LOGICAL_PATH_INVALID");
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    fail("TERRE_LOGICAL_PATH_INVALID");
  }
  // Exactly one decode, encoded delimiters and double-encoded names are refused.
  if (/%(?:2f|5c)/i.test(value) || decoded.includes("%"))
    fail("TERRE_LOGICAL_PATH_INVALID");
  return relativePath(decoded.replace(/^\//, ""));
}
