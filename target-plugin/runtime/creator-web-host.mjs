import fs from "node:fs";
import path from "node:path";
import {
  guardedPath,
  inspectAbsolute,
  relativePath,
  decodeLogicalPath,
  fail,
} from "./terre-path-guard.mjs";
import { readChecked, sha } from "./creator-package.mjs";
import { OPTIONAL_HOST_FONTS } from "./terre-project-access.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".moc": "application/octet-stream",
  ".moc3": "application/octet-stream",
  ".mtn": "application/octet-stream",
  ".wasm": "application/wasm",
};

// Both manifests come from the trusted source build/launcher, never HTTP input.
// Every served build file is pinned. There is no shared-host bundle fallback.
function pinnedBuild(input) {
  if (!input) return null;
  const spec = structuredClone(input),
    root = inspectAbsolute(spec.root, { kind: "directory" });
  if (!Array.isArray(spec.files) || !spec.files.length)
    fail("CREATOR_BUILD_PROOF_REQUIRED");
  const files = new Map();
  for (const row of spec.files) {
    relativePath(row.path);
    if (
      files.has(row.path.toLowerCase()) ||
      !/^[a-f0-9]{64}$/i.test(row.sha256)
    )
      fail("CREATOR_BUILD_PROOF_INVALID");
    const file = guardedPath(root.path, row.path, { kind: "file" });
    if (sha(fs.readFileSync(file.path)) !== row.sha256.toUpperCase())
      fail("CREATOR_BUILD_FINGERPRINT_MISMATCH");
    files.set(row.path.toLowerCase(), {
      path: row.path,
      sha256: row.sha256.toUpperCase(),
    });
  }
  if (!files.has("index.html")) fail("CREATOR_BUILD_PROOF_REQUIRED");
  return {
    read(relative) {
      if (
        inspectAbsolute(root.path, { kind: "directory" }).identity !==
        root.identity
      )
        fail("CREATOR_BUILD_ROOT_CHANGED");
      const row = files.get(relative.toLowerCase());
      if (!row || row.path !== relative) fail("CREATOR_STATIC_FILE_NOT_FOUND");
      const file = guardedPath(root.path, relative, { kind: "file" });
      const bytes = readChecked(
        { owner: root.path, path: file.path },
        64 * 1024 * 1024
      );
      if (sha(bytes) !== row.sha256)
        fail("CREATOR_BUILD_CHANGED_RESTART_REQUIRED");
      return bytes;
    },
  };
}

export function createCreatorWebHost({ workbench, preview } = {}, store) {
  const creator = pinnedBuild(workbench),
    runtime = pinnedBuild(preview);
  return Object.freeze({
    enabled: Boolean(creator),
    ensurePreview() {
      if (!runtime) fail("CREATOR_PREVIEW_BUILD_NOT_CONFIGURED");
      store.describeAuthoringWorkspace();
      runtime.read("index.html");
      return {
        ok: true,
        restarted: false,
        previewUrl: "/preview/",
        previewPid: process.pid,
        readiness: "PINNED_SOURCE_FILES_SERVED",
        runtimeCompatibility: "NOT_GUI_VALIDATED",
      };
    },
    read(rawUrl, token) {
      if (!creator) fail("CREATOR_STATIC_NOT_CONFIGURED");
      const pathname = rawUrl.split("?")[0];
      let relative =
        pathname === "/" ? "" : decodeLogicalPath(pathname.replace(/\/$/, ""));
      const isPreview =
        relative === "preview" || relative.startsWith("preview/");
      if (isPreview)
        relative = relative.slice("preview".length).replace(/^\//, "");
      relative ||= "index.html";
      relativePath(relative);
      const hiddenSegments = relative
        .split("/")
        .filter((segment) => segment.startsWith("."));
      // MyGO Live2D 2 models use .chara for model bytes and .mtn_exp for
      // motions/expressions. Permit only those exact legacy resource directories
      // below game/figure; ownership ledgers and every other hidden path stay closed.
      const allowedModelHiddenPath =
        relative.startsWith("game/figure/") &&
        hiddenSegments.length === 1 &&
        [".chara", ".mtn_exp"].includes(hiddenSegments[0]);
      // Never expose ownership ledgers, journals, source files, or other hidden directories.
      if (
        (hiddenSegments.length > 0 && !allowedModelHiddenPath) ||
        /(?:\.map|\.mjs|\.ts|\.tsx)$/i.test(relative)
      )
        fail("CREATOR_STATIC_SCOPE_INVALID");
      const type = TYPES[path.posix.extname(relative).toLowerCase()];
      if (!type) fail("CREATOR_STATIC_TYPE_UNSUPPORTED");
      let bytes;
      if (OPTIONAL_HOST_FONTS.includes(relative)) {
        bytes = store.readOptionalHostFont(relative);
        if (bytes === null) return { bytes: Buffer.alloc(0), type, status: 404 };
      } else if (relative === "favicon.ico")
        bytes = store.readHostRuntimeResource("icons/favicon.ico");
      else if (relative.startsWith("game/") || relative.startsWith("lib/"))
        bytes = store.readAuthoringResource(relative);
      else {
        const build = isPreview ? runtime : creator;
        if (!build) fail("CREATOR_PREVIEW_BUILD_NOT_CONFIGURED");
        bytes = build.read(relative);
      }
      if (!isPreview && relative === "index.html") {
        const html = bytes.toString("utf8");
        if (!html.includes("</head>")) fail("CREATOR_BUILD_HTML_INVALID");
        bytes = Buffer.from(
          html.replace(
            "</head>",
            `<meta name="webgal-creator-session" content="${token}"></head>`
          )
        );
      }
      return { bytes, type };
    },
  });
}
