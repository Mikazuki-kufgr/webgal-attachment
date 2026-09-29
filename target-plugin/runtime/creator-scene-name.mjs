import { createHash } from "node:crypto";
import { fail } from "./terre-path-guard.mjs";
export function creatorScenePath(presetId, displayName, previousPaths = []) {
  const suffix = createHash("sha256")
    .update(presetId)
    .digest("hex")
    .slice(0, 8);
  const existing = previousPaths.filter(
    (p) =>
      /^game\/scene\/附件测试-[\p{L}\p{N}_-]{1,32}-[a-f0-9]{8}\.txt$/u.test(
        p
      ) && p.endsWith(`-${suffix}.txt`)
  );
  if (existing.length > 1) fail("CREATOR_SCENE_IDENTITY_CONFLICT");
  const name =
    Array.from(String(displayName ?? "附件").replace(/[^\p{L}\p{N}_-]/gu, "_"))
      .slice(0, 32)
      .join("") || "附件";
  return existing[0] ?? `game/scene/附件测试-${name}-${suffix}.txt`;
}
