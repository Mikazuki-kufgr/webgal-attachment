import { Worker } from "node:worker_threads";
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { MAX_BODY } from "./creator-package.mjs";
import { MODEL_IMPORT_BODY_BYTES } from "./creator-model-files.generated.mjs";
import { fail } from "./terre-path-guard.mjs";
import { createCreatorStore } from "./creator-store.mjs";
import { createCreatorWebHost } from "./creator-web-host.mjs";

/** Explicit launcher entry point. Import is inert; no environment/cwd grants, child process,
 * GUI, heartbeat exit or port reuse is performed here. Optional separately pinned source
 * builds serve the full Creator and normal Runtime from this one owned listener.
 * Keep the user-visible launcher console open until explicit shutdown in the later launcher layer.
 */
export function createCreatorService(
  grants,
  {
    log = () => {},
    token = randomBytes(32).toString("hex"),
    workbench,
    preview,
  } = {}
) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token))
    fail("CREATOR_SESSION_TOKEN_INVALID");
  let modelJob, modelProgress = { active:false, phase:'', processed:0 };
  function modelOperation(operation, body, {signal}) {
    if (modelJob) fail('CREATOR_SAVE_BUSY');
    const abort = new SharedArrayBuffer(4), flag = new Int32Array(abort);
    const cancel = () => Atomics.store(flag,0,1);
    signal?.addEventListener('abort',cancel,{once:true});
    modelProgress = { active:true, phase:'正在读取人物依赖', processed:0 };
    modelJob = new Promise((resolve,reject) => {
      const worker = new Worker(new URL('./creator-model-worker.mjs',import.meta.url), { workerData:{ grants, operation, body, abort } });
      let settled=false;
      worker.on('message', message => {
        if(message.progress) modelProgress={active:true,...message.progress};
        if(message.event) { try { log(message.event); } catch {} }
        if(message.result) { settled=true; resolve(message.result); }
        if(message.error) { settled=true; reject(Object.assign(new Error(message.error.message),message.error)); }
      });
      worker.on('error',reject);
      worker.on('exit',code=>{if(!settled)reject(new Error('CREATOR_MODEL_WORKER_EXIT:'+code));});
    }).finally(()=>{modelJob=undefined;modelProgress={...modelProgress,active:false};signal?.removeEventListener('abort',cancel);});
    return modelJob;
  }
  const store = createCreatorStore(grants, { log });
  const web = createCreatorWebHost({ workbench, preview }, store);
  const cookieName = `webgal_creator_${randomBytes(8).toString("hex")}`;
  const tokenMatches = (supplied) =>
    typeof supplied === "string" &&
    /^[a-f0-9]{64}$/i.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  let authority,
    origin,
    closed = false,
    closePromise,
    listenPromise;
  let resolveClosed;
  const closedSignal = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      if (modelJob) await modelJob.catch(() => {});
      store.close();
      if (listenPromise) await listenPromise.catch(() => undefined);
      if (server.listening)
        await new Promise((resolve, reject) => {
          server.close((e) => (e ? reject(e) : resolve()));
          server.closeAllConnections();
        });
    })().finally(() => resolveClosed());
    return closePromise;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (!res.destroyed) {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify(value));
      }
    };
    try {
      if (closed) fail("CREATOR_SERVICE_CLOSED");
      if (req.headers.host !== authority)
        return send(403, { ok: false, code: "CREATOR_SESSION_FORBIDDEN" });
      if (
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return send(403, { ok: false, code: "CREATOR_ORIGIN_FORBIDDEN" });
      // Only a trusted launcher receives this unguessable initial URL. Redirect removes
      // the secret from the visible document URL; no token is put in query/storage.
      if (
        web.enabled &&
        req.method === "GET" &&
        req.url === `/__creator/open/${token}`
      ) {
        res.writeHead(303, {
          Location: "/",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Set-Cookie": `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        res.end();
        return;
      }
      const cookies = String(req.headers.cookie ?? "")
        .split(";")
        .map((part) => part.trim());
      const cookie = cookies
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      const api = req.url?.startsWith("/__");
      if (
        !(api
          ? tokenMatches(req.headers["x-creator-session"])
          : tokenMatches(req.headers["x-creator-session"]) ||
            tokenMatches(cookie))
      )
        return send(403, { ok: false, code: "CREATOR_SESSION_FORBIDDEN" });
      if (!api) {
        if (req.method !== "GET" && req.method !== "HEAD")
          return send(405, { ok: false, code: "CREATOR_METHOD_NOT_ALLOWED" });
        const file = web.read(req.url, token);
        res.writeHead(file.status ?? 200, {
          "Content-Type": file.type,
          "Content-Length": file.bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "SAMEORIGIN",
        });
        res.end(req.method === "HEAD" ? undefined : file.bytes);
        return;
      }
      const routes = {
        "GET /__rc1/health": () => ({
          ok: true,
          service: "webgal-attachment-creator",
          contract: "creator-mygo3.2.0-save-v1",
          shutdownPolicy: "explicit-only",
          runtimeCompatibility: "NOT_VALIDATED",
          workbenchConfigured: web.enabled,
        }),
        "GET /__creator/context": () => store.context(),
        "GET /__creator/target-projects": () => store.targetProjects(),
        "GET /__creator/authoring-attachments": () => store.authoringAttachments(),
        "POST /__creator/project-attachments": (b) => store.projectAttachments(b),
        "GET /__creator/library": () => store.library(),
        "POST /__creator/load-attachment": (b) => store.loadAttachment(b),
        "POST /__creator/load-factory-sample": (b) => store.loadFactorySample(b),
        "POST /__creator/check-target-model": (b) => store.checkTargetModel(b),
        "POST /__creator/import-model": (b, o) => modelOperation("import", b, o),
        "POST /__creator/copy-model-to-game": (b, o) => modelOperation("copy", b, o),
        "GET /__creator/model-operation": () => ({ ok:true, ...modelProgress }),
        "POST /__creator/accept-attachment-changes": (b, o) =>
          store.acceptAttachmentChanges(b, o),
        "POST /__creator/save-to-game": (b, o) => store.saveToGame(b, o),
        "POST /__creator/save-local": (b, o) => store.saveAuthoringAttachment(b, o),
        "POST /__creator/load-local": (b) => store.loadAuthoringAttachment(b),
        "POST /__creator/accept-local-changes": (b, o) => store.acceptAuthoringAttachmentChanges(b, o),
        "POST /__rc1/project": (b) => store.openAuthoringProject(b),
        "POST /__rc1/apply": (b, o) => store.applyAuthoringPackage(b, o),
        "POST /__creator/ensure-preview": () => web.ensurePreview(),
        "POST /__creator/shutdown": () => {
          setImmediate(() => {
            void close().catch(() => {
              try {
                log({
                  time: new Date().toISOString(),
                  type: "service.shutdown",
                  result: "ERROR",
                  code: "CREATOR_SHUTDOWN_FAILED",
                });
              } catch {}
            });
          });
          return {
            ok: true,
            shutdown: "REQUESTED",
            scope: "OWNED_SERVER_ONLY",
          };
        },
        "POST /__creator/events": (b) => {
          if (
            typeof b.type !== "string" ||
            !/^[a-z0-9._-]{1,96}$/i.test(b.type)
          )
            fail("CREATOR_EVENT_INVALID");
          const event = { time: new Date().toISOString(), type: b.type };
          for (const key of ["sessionId", "target", "result", "detail"])
            if (typeof b[key] === "string")
              event[key] = b[key]
                .slice(0, 2048)
                .replace(/[\u0000-\u001f\u007f]/g, " ");
          if (
            typeof b.durationMs === "number" &&
            Number.isFinite(b.durationMs) &&
            b.durationMs >= 0
          )
            event.durationMs = b.durationMs;
          try {
            log(event);
          } catch {
            return { ok: true, logged: false };
          }
          return { ok: true, logged: true };
        },
        "POST /__creator/library/profile": (b) => store.readLibraryProfile(b),
        "POST /__creator/anchors/model": b => store.readAnchorModel(b),
        "POST /__creator/mesh-labels/read": b => store.readMeshLabels(b),
        "POST /__creator/mesh-labels/save": (b,o) => store.saveMeshLabels(b,o),
        "POST /__creator/anchors/save": (b, o) => store.saveAnchorProfile(b, o),
        "POST /__creator/library/import-profile": (b, o) =>
          store.importLibraryProfile(b, o),
      };
      const route = routes[`${req.method} ${req.url}`];
      if (!route)
        return send(404, { ok: false, code: "CREATOR_API_NOT_FOUND" });
      const abort = new AbortController();
      req.once("aborted", () => abort.abort());
      let body;
      if (req.method === "POST") {
        const maxBody = req.url === "/__creator/import-model" ? MODEL_IMPORT_BODY_BYTES : MAX_BODY;
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")
        )
          return send(415, { ok: false, code: "CREATOR_JSON_REQUIRED" });
        if (
          req.headers["content-length"] &&
          Number(req.headers["content-length"]) > maxBody
        )
          return send(413, { ok: false, code: "CREATOR_REQUEST_TOO_LARGE" });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBody) fail("CREATOR_REQUEST_TOO_LARGE");
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          fail("CREATOR_JSON_INVALID");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail("CREATOR_JSON_INVALID");
      }
      if (modelJob && req.method === 'POST' && !['/__creator/events','/__creator/shutdown'].includes(req.url)) fail('CREATOR_SAVE_BUSY');
      const result = await route(body, { signal: abort.signal });
      send(result.ok === false ? 409 : 200, result);
    } catch (error) {
      const raw = error.code ?? error.message ?? "CREATOR_INTERNAL_ERROR",
        code = String(raw).split(":")[0];
      const safe = /^(CREATOR|TERRE|RC1)_[A-Z0-9_]+$/.test(code)
        ? code
        : "CREATOR_INTERNAL_ERROR";
      const status = /TOO_LARGE/.test(safe)
        ? 413
        : /CONFLICT|STALE|CHANGED|RECOVERY|BUSY|REAUTHORIZE/.test(safe)
        ? 409
        : /NOT_FOUND|MISSING/.test(safe)
        ? 404
        : safe === "CREATOR_INTERNAL_ERROR"
        ? 500
        : 400;
      try {
        log({
          time: new Date().toISOString(),
          type: "request.failed",
          result: "ERROR",
          code: safe,
        });
      } catch {}
      send(status, {
        ok: false,
        code: safe,
        message:
          typeof error.userMessage === "string"
            ? error.userMessage
            : safe === "CREATOR_TARGET_MODEL_MISSING"
            ? "目标游戏缺少这套人物模型的必要文件。"
            : safe,
        ...(typeof error.targetPath === "string" &&
        error.targetPath.startsWith("game/figure/") &&
        !error.targetPath.split("/").some((part) => !part || part === "." || part === "..")
          ? { targetPath: error.targetPath }
          : {}),
        ...(typeof error.suggestion === "string"
          ? { suggestion: error.suggestion }
          : {}),
        committed: false,
        ...(error.journalPath ? { journalPath: error.journalPath } : {}),
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.timeout = 0;
  server.maxHeadersCount = 40;
  return Object.freeze({
    async listen(port = 0) {
      if (closed || server.listening || authority || listenPromise)
        fail("CREATOR_SERVICE_LIFECYCLE_INVALID");
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        fail("CREATOR_PORT_INVALID");
      listenPromise = new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      await listenPromise;
      if (closed) fail("CREATOR_SERVICE_CLOSED");
      authority = `127.0.0.1:${server.address().port}`;
      origin = `http://${authority}`;
      return {
        origin,
        token,
        pid: process.pid,
        contract: "creator-mygo3.2.0-save-v1",
        ...(web.enabled
          ? {
              launchUrl: `${origin}/__creator/open/${token}`,
              previewUrl: `${origin}/preview/`,
            }
          : {}),
      };
    },
    close,
    waitForClose() {
      return closedSignal;
    },
  });
}
