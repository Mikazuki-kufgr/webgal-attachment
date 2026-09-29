export type AttachmentAction = 'add' | 'hide' | 'show' | 'remove';
export type StageEntityAction = 'detach' | 'reattach' | 'hide' | 'show' | 'remove';

export function attachmentActionPolicy(action: AttachmentAction) {
  return { acceptsAttachmentDefinition: action === 'add', hasTransition: true } as const;
}

export function stageEntityActionPolicy(action: StageEntityAction) {
  return { acceptsAttachmentTarget: action === 'reattach', hasTransition: action !== 'detach', isAsync: true } as const;
}
