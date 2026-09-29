export const AUTHORING_ACTIONS = ['full-demo', 'add', 'attach', 'detach', 'reattach', 'transform', 'transfer', 'hide', 'show', 'remove'] as const;
export type AuthoringAction = (typeof AUTHORING_ACTIONS)[number];

export interface AttachmentAuthoringCommandInput {
  action: AuthoringAction;
  entityId: string;
  parentFigureKey: string;
  transferFigureKey: string;
  attachmentId: string;
  configId: string;
  slot: string;
  semanticAnchor: string;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  durationMs: number;
  easing: string;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const CANONICAL_ANCHOR = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export function validateAttachmentAuthoringInput(input: AttachmentAuthoringCommandInput) {
  const errors: string[] = [];
  for (const [name, value] of [
    ['entityId', input.entityId], ['parentFigureKey', input.parentFigureKey], ['transferFigureKey', input.transferFigureKey],
    ['attachmentId', input.attachmentId], ['configId', input.configId], ['slot', input.slot], ['easing', input.easing],
  ] as const) if (!TOKEN.test(value)) errors.push(`MVP5A_${name.toUpperCase()}_INVALID`);
  if (!CANONICAL_ANCHOR.test(input.semanticAnchor)) errors.push('MVP5A_SEMANTIC_ANCHOR_NOT_CANONICAL');
  for (const value of [input.position.x, input.position.y, input.scale.x, input.scale.y, input.rotation, input.durationMs]) if (!Number.isFinite(value)) errors.push('MVP5A_NUMERIC_FIELD_INVALID');
  if (input.durationMs < 0) errors.push('MVP5A_DURATION_NEGATIVE');
  return [...new Set(errors)];
}

export function buildAttachmentAuthoringScript(input: AttachmentAuthoringCommandInput) {
  const errors = validateAttachmentAuthoringInput(input);
  if (errors.length) throw new Error(errors.join(','));
  const add = `attachment:add -figure=${input.parentFigureKey} -id=${input.attachmentId} -entity=${input.entityId} -config=${input.configId} -slot=${input.slot} -anchor=${input.semanticAnchor} -duration=${input.durationMs} -ease=${input.easing} -next;`;
  const attach = `stageEntity:reattach -entity=${input.entityId} -figure=${input.parentFigureKey} -anchor=${input.semanticAnchor} -duration=${input.durationMs} -ease=${input.easing} -continue;`;
  const detach = `stageEntity:detach -entity=${input.entityId} -continue;`;
  const transform = `setTransform:${JSON.stringify({ position: input.position, scale: input.scale, rotation: input.rotation })} -duration=${input.durationMs} -ease=${input.easing} -target=${input.entityId} -continue;`;
  const transfer = `${detach}\nstageEntity:reattach -entity=${input.entityId} -figure=${input.transferFigureKey} -anchor=${input.semanticAnchor} -duration=${input.durationMs} -ease=${input.easing} -continue;`;
  const hide = `stageEntity:hide -entity=${input.entityId} -duration=${input.durationMs} -ease=${input.easing};`;
  const show = `stageEntity:show -entity=${input.entityId} -duration=${input.durationMs} -ease=${input.easing};`;
  const remove = `stageEntity:remove -entity=${input.entityId} -duration=${input.durationMs} -ease=${input.easing} -continue;`;
  const byAction: Record<Exclude<AuthoringAction, 'full-demo'>, string> = { add, attach, detach, reattach: attach, transform, transfer, hide, show, remove };
  if (input.action !== 'full-demo') return byAction[input.action];
  const parentMove = `setTransform:${JSON.stringify({ position: { x: -180, y: 40 }, scale: { x: 0.94, y: 1.06 }, rotation: 0.18 })} -duration=${input.durationMs} -ease=${input.easing} -target=${input.parentFigureKey} -continue;`;
  return [add, parentMove, transform, detach, transform, transfer, hide, show, remove].join('\n');
}

export function defaultAttachmentAuthoringInput(): AttachmentAuthoringCommandInput {
  return { action: 'full-demo', entityId: 'mvp5a:technical-hat', parentFigureKey: 'anon', transferFigureKey: 'anon-b', attachmentId: 'mvp5a-technical-hat', configId: 'v2/anon-straw-hat-school-winter-2023', slot: 'headwear', semanticAnchor: 'body.head.top', position: { x: 24, y: -18 }, scale: { x: 0.96, y: 0.96 }, rotation: 0.12, durationMs: 650, easing: 'easeInOut' };
}
