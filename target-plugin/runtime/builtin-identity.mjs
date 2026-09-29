export const BUILTIN_IDENTITIES = Object.freeze(
  [
    ["straw-hat-both-v1", "草帽"],
    ["kemomimi-front-v1", "兽耳"],
    ["halo-front-v1", "光环"],
    ["flower-front-v1", "花朵"],
    ["rose-front-v1", "玫瑰"],
  ].map(([leaf, name]) =>
    Object.freeze({
      leaf,
      name,
      oldLeaf: "anon-" + leaf,
      id: "v2/" + leaf,
      oldId: "v2/anon-" + leaf,
    })
  )
);
export function builtinIdentity(id) {
  return BUILTIN_IDENTITIES.find((x) => x.id === id || x.oldId === id);
}
export function canonicalBuiltinId(id) {
  return builtinIdentity(id)?.id ?? id;
}
export function legacyBuiltinAlias(document) {
  const id = document.adaptations?.[0]?.preset?.presetId,
    item = builtinIdentity(id);
  if (!item || id !== item.id) return undefined;
  const alias = structuredClone(document);
  alias.compatibilityAliasFor = item.id;
  for (const a of alias.adaptations) a.preset.presetId = item.oldId;
  return {
    path: `game/attachments-v2/portable/${item.oldLeaf}/attachment.json`,
    document: alias,
  };
}
