import { cloneCreatorDraft } from './creatorDraft';
import type { CreatorBinaryInput, CreatorDraft, CreatorLayerMode } from './creatorTypes';

export type CreatorLayerInputs = { back?: CreatorBinaryInput; front?: CreatorBinaryInput };

/** One image changes sides; two images keep their independent layer ownership. */
export function changeCreatorLayerMode(draft: CreatorDraft, inputs: CreatorLayerInputs, mode: CreatorLayerMode) {
  const nextDraft = cloneCreatorDraft(draft);
  const nextInputs = { ...inputs };
  nextDraft.layerMode = mode;
  if (mode !== 'both' && Boolean(inputs.front) !== Boolean(inputs.back)) {
    const target = mode === 'front-only' ? 'front' : 'back';
    const source = inputs.front ? 'front' : 'back';
    if (source !== target) {
      nextInputs[target] = inputs[source];
      delete nextInputs[source];
      nextDraft.layers[target] = { ...inputs[source]!.metadata };
      delete nextDraft.layers[source];
    }
  }
  return { draft: nextDraft, binaries: nextInputs };
}
