import fs from "node:fs";
import { creatorScenePath } from '../runtime/creator-scene-name.mjs';
import net from "node:net";
import http from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, payload, snapshot, task } from "./creator-fixtures.mjs";
import { createCreatorService } from "../runtime/creator-service.mjs";
import {
  SceneParser,
  SCRIPT_CONFIG,
  ADD_NEXT_ARG_LIST,
} from "../../16_creator-service-save/test-inputs/target-parser.mjs";

test("actual bounded localhost HTTP: context/save/load/security/errors/explicit close + generated real target parser", async (t) => {
  const f = fixture(),
    events = [],
    service = createCreatorService(f.options, { log: (e) => events.push(e) });
  const address = await service.listen(0),
    port = Number(new URL(address.origin).port);
  const request = async (method, url, body, headers = {}) => {
    const res = await fetch(address.origin + url, {
      method,
      headers: {
        "x-creator-session": address.token,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await t.test("health/context require token; no wildcard CORS", async () => {
      const r = await request("GET", "/__rc1/health");
      assert.equal(r.status, 200);
      assert.equal(r.body.shutdownPolicy, "explicit-only");
      assert.equal(r.body.runtimeCompatibility, "NOT_VALIDATED");
      const denied = await fetch(address.origin + "/__creator/context");
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
      assert.equal(
        (await request("GET", "/__creator/context")).body.targetProjects.length,
        1
      );
    });
    await t.test(
      "Host rebinding and foreign Origin rejected before save",
      async () => {
        const before = snapshot(f.project);
        assert.equal(
          (
            await request("POST", "/__creator/save-to-game", payload(), {
              Origin: "https://evil.example",
            })
          ).status,
          403
        );
        const status = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port,
              path: "/__creator/context",
              headers: {
                Host: "evil.example",
                "x-creator-session": address.token,
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            }
          );
          req.on("error", reject);
          req.end();
        });
        assert.equal(status, 403);
        assert.deepEqual(snapshot(f.project), before);
      }
    );
    await t.test(
      "content type, malformed JSON, oversize, unknown/old preview endpoint are honest errors",
      async () => {
        assert.equal(
          (await request("POST", "/__creator/save-to-game", "broken")).status,
          400
        );
        assert.equal(
          (
            await request("POST", "/__creator/save-to-game", "{}", {
              "Content-Type": "text/plain",
            })
          ).status,
          415
        );
        assert.equal(
          (await request("POST", "/__creator/ensure-preview", {})).status,
          400
        );
        const status = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port,
              path: "/__creator/save-to-game",
              method: "POST",
              headers: {
                "x-creator-session": address.token,
                "Content-Type": "application/json",
                "Content-Length": 13 * 1024 * 1024,
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            }
          );
          req.on("error", reject);
          req.end();
        });
        assert.equal(status, 413);
      }
    );
    await t.test(
      "target selection checks core files only while save checks the selected motion",
      async () => {
        const dependency = f.project + "/game/figure/anon/test/idle.mtn";
        const held = dependency + ".held";
        fs.renameSync(dependency, held);
        try {
          const before = snapshot(f.project);
          const preflight = await request(
            "POST",
            "/__creator/check-target-model",
            {
              projectName: "测试 Demo",
              modelPath: "./game/figure/anon/test/model.json",
            }
          );
          assert.equal(preflight.status, 200);
          assert.equal(preflight.body.ok, true);
          const canonicalProfilePath = await request(
            "POST",
            "/__creator/check-target-model",
            {
              projectName: "测试 Demo",
              modelPath: "game/figure/anon/test/model.json",
            }
          );
          assert.equal(canonicalProfilePath.status, 200);
          assert.equal(canonicalProfilePath.body.ok, true);
          assert.equal(
            canonicalProfilePath.body.modelPath,
            "game/figure/anon/test/model.json"
          );
          const result = await request(
            "POST",
            "/__creator/save-to-game",
            payload()
          );
          assert.equal(result.status, 404);
          assert.equal(result.body.code, "CREATOR_TARGET_MODEL_MISSING");
          assert.equal(
            result.body.targetPath,
            "game/figure/anon/test/idle.mtn"
          );
          assert.deepEqual(snapshot(f.project), before);
        } finally {
          fs.renameSync(held, dependency);
        }
      }
    );
    await t.test(
      "missing target model dependency is a typed safe error and writes nothing",
      async () => {
        const dependency = f.project + "/game/figure/anon/test/model.moc";
        const held = dependency + ".held";
        fs.renameSync(dependency, held);
        try {
          const before = snapshot(f.project);
          const preflightEventStart = events.length;
          const preflight = await request(
            "POST",
            "/__creator/check-target-model",
            {
              projectName: "测试 Demo",
              modelPath: "./game/figure/anon/test/model.json",
            }
          );
          assert.equal(preflight.status, 200);
          assert.equal(preflight.body.ok, true);
          assert.equal(preflight.body.ready, false);
          assert.equal(preflight.body.status, "TARGET_MODEL_NOT_READY");
          assert.equal(
            preflight.body.warning.code,
            "CREATOR_TARGET_MODEL_MISSING"
          );
          assert.equal(
            preflight.body.warning.targetPath,
            "game/figure/anon/test/model.moc"
          );
          assert.match(
            preflight.body.warning.message,
            /目标游戏缺少人物模型文件/
          );
          assert.match(
            preflight.body.warning.suggestion,
            /制作器不会静默复制人物模型/
          );
          assert.deepEqual(
            events
              .slice(preflightEventStart)
              .filter((event) => event.type === "request.failed"),
            []
          );
          const saveEventStart = events.length;
          const result = await request(
            "POST",
            "/__creator/save-to-game",
            payload()
          );
          assert.equal(result.status, 404);
          assert.equal(result.body.code, "CREATOR_TARGET_MODEL_MISSING");
          assert.equal(
            result.body.targetPath,
            "game/figure/anon/test/model.moc"
          );
          assert.match(result.body.message, /目标游戏缺少人物模型文件/);
          assert.match(result.body.suggestion, /制作器不会静默复制人物模型/);
          assert.equal(JSON.stringify(result.body).includes(f.project), false);
          assert.deepEqual(
            events
              .slice(saveEventStart)
              .filter((event) => event.type === "request.failed")
              .map((event) => ({ result: event.result, code: event.code })),
            [
              {
                result: "ERROR",
                code: "CREATOR_TARGET_MODEL_MISSING",
              },
            ]
          );
          assert.deepEqual(snapshot(f.project), before);
        } finally {
          fs.renameSync(held, dependency);
        }
      }
    );
    let revision;
    await t.test(
      "ordinary export request persists and load returns original explicit adaptation",
      async () => {
        const r = await request("POST", "/__creator/save-to-game", payload());
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        assert.equal(r.body.runtimeCompatibility, "NOT_VALIDATED");
        revision = r.body.revision;
        const l = await request("POST", "/__creator/load-attachment", {
          projectName: "测试 Demo",
          presetId: "v2/test-hat",
        });
        assert.equal(l.body.revision, revision);
        assert.equal(
          l.body.packageDocument.adaptations[0].modelProfile.modelProfileId,
          "profile-a"
        );
      }
    );
    await t.test(
      "stale/missing revision reports conflict, subsequent explicit revision succeeds",
      async () => {
        const before = snapshot(f.project);
        const stale = await request(
          "POST",
          "/__creator/save-to-game",
          payload({ displayName: "new" })
        );
        assert.equal(stale.status, 409);
        assert.equal(stale.body.code, "CREATOR_STALE_DRAFT_RELOAD_REQUIRED");
        assert.deepEqual(snapshot(f.project), before);
        const r = await request("POST", "/__creator/save-to-game", {
          ...payload({ displayName: "new" }),
          expectedRevision: revision,
        });
        assert.equal(r.status, 200);
      }
    );
    await t.test(
      "generated verification scene parsed by actual migrated parser with new command ABI",
      () => {
        const parser = new SceneParser(
          () => {},
          (name) => name,
          ADD_NEXT_ARG_LIST,
          SCRIPT_CONFIG
        );
        const raw = fs.readFileSync(
          f.project + "/" + creatorScenePath("v2/test-hat", "中文附件"),
          "utf8"
        );
        const parsed = parser.parse(raw, "5G generated", "5G fixture");
        const attached = parsed.sentenceList.filter((s) => s.command === 36),
          entities = parsed.sentenceList.filter((s) => s.command === 37);
        assert.equal(attached.length, 2);
        assert.equal(entities.length, 5);
        assert.ok(!parsed.sentenceList.some((s) => s.command === 34));
        for (let i = 1; i <= 11; i++)
          assert.ok(raw.includes(`【${String(i).padStart(2, "0")}`));
        assert.ok(!raw.includes("bg.webp"));
        assert.ok(raw.includes("你在制作器中预期的位置"));
        const addLines = raw
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("attachment:add "));
        assert.equal(addLines.length, 2);
        for (const addLine of addLines) {
          assert.ok(addLine.includes(" -next;"));
          assert.ok(addLine.includes(" -profile=profile-a "));
          assert.ok(!addLine.includes("-duration="));
        }
        assert.ok(raw.includes("【01 准备／淡入】"));
        assert.ok(raw.includes("本说明不是异步完成屏障"));
        assert.ok(raw.includes("等附件实际出现并稳定后"));
        assert.ok(raw.includes("【10 删除后重新 attach：准备／淡入】"));
        assert.ok(raw.includes("等附件实际重新出现并稳定后"));
        assert.ok(!raw.includes("附件应已显示"));
        assert.ok(!/\bsleep\b/iu.test(raw));
      }
    );
    await t.test(
      "events contain persisted/error results without tokens/base64",
      () => {
        assert.ok(events.some((e) => e.result === "PERSISTED"));
        assert.ok(events.some((e) => e.type === "request.failed"));
        assert.ok(!JSON.stringify(events).includes(address.token));
        assert.ok(!JSON.stringify(events).includes("base64"));
      }
    );
  } finally {
    await service.close();
    await service.close();
  }
  await t.test(
    "own ephemeral listener is released, no resident Creator process",
    async () => {
      const probe = net.createServer();
      await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", resolve);
      });
      await new Promise((resolve) => probe.close(resolve));
      const lifecycleRoot =
        task +
        "/" +
        (process.env.WEBGAL_TEST_EVIDENCE_STAGE ||
          "16_creator-service-save/fixtures") +
        "/http-lifecycle";
      fs.mkdirSync(lifecycleRoot, {
        recursive: true,
      });
      fs.writeFileSync(
        lifecycleRoot + `/${process.pid}.json`,
        JSON.stringify(
          {
            pid: process.pid,
            host: "127.0.0.1",
            port,
            closed: true,
            rebindVerified: true,
            gui: false,
            residentService: false,
            scope: "owned bounded fixture only",
          },
          null,
          2
        ) + "\n"
      );
    }
  );
});
