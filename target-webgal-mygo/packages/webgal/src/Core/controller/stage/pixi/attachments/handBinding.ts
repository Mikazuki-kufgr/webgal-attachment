import type { AttachmentBindingAnchor, AttachmentPoint } from './types';

export interface AttachmentHandState {
  id: string;
  displayName: string;
  drawableId: string;
  /** Reference vertices in the unmodified model's source coordinates. */
  anchors: AttachmentBindingAnchor[];
  contact: { index: number; weight: number }[];
  insertion: 'before' | 'after';
  mirrorX: boolean;
  rotationOffsetRad: number;
  /** Axis in the neutral model-layout frame, after material calibration.
   * Offset is measured from the hand contact in the same units as placement. */
  /** Per-state correction after reflection, in neutral model-layout coordinates. */
  poseOffset?: AttachmentPoint;
  flipAxis?: { angleRad: number; offset: AttachmentPoint };
}

/** Optional adaptation data; images and logical instance identity stay shared. */
export interface AttachmentHandBinding {
  version: 1;
  runtime: 'cubism2';
  textureLayer: 'front' | 'back';
  transition: 'weighted-scenes';
  unsupportedState: 'hide-with-diagnostic';
  states: AttachmentHandState[];
}

function record(v: unknown, p: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`HAND_BINDING_INVALID:${p}`);
  return v as Record<string, unknown>;
}
function number(v: unknown, p: string) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`HAND_BINDING_INVALID:${p}`);
  return v;
}
function text(v: unknown, p: string) {
  if (typeof v !== 'string' || !v.trim() || v.length > 160) throw new TypeError(`HAND_BINDING_INVALID:${p}`);
  return v;
}
function point(v: unknown, p: string): AttachmentPoint {
  const r = record(v, p); return { x: number(r.x, p + '.x'), y: number(r.y, p + '.y') };
}
function vertex(v: unknown, p: string) {
  const n = number(v, p); if (!Number.isInteger(n) || n < 0) throw new TypeError(`HAND_BINDING_INVALID:${p}`); return n;
}
export function parseAttachmentHandBinding(value: unknown): AttachmentHandBinding {
  const r = record(value, 'handBinding');
  if (r.version !== 1 || r.runtime !== 'cubism2' || r.transition !== 'weighted-scenes' ||
      r.unsupportedState !== 'hide-with-diagnostic' || !['front','back'].includes(String(r.textureLayer)))
    throw new TypeError('HAND_BINDING_INVALID:version/runtime/transition/textureLayer/unsupportedState');
  if (!Array.isArray(r.states) || r.states.length < 1 || r.states.length > 8) throw new TypeError('HAND_BINDING_INVALID:states');
  const states = r.states.map((v, i): AttachmentHandState => {
    const s = record(v, `states[${i}]`);
    if (!Array.isArray(s.anchors) || s.anchors.length < 3 || s.anchors.length > 4096) throw new TypeError('HAND_BINDING_INVALID:anchors');
    const anchors = s.anchors.map((v, j) => { const a = record(v, `anchors[${j}]`), weight = number(a.weight, 'anchor.weight');
      if (weight <= 0) throw new TypeError('HAND_BINDING_INVALID:anchor.weight');
      return { index: vertex(a.index, 'anchor.index'), weight, neutral: point(a.neutral, 'anchor.neutral') }; });
    if (new Set(anchors.map(a => a.index)).size !== anchors.length) throw new TypeError('HAND_BINDING_INVALID:duplicate vertex');
    if (!Array.isArray(s.contact) || s.contact.length < 1 || s.contact.length > 8) throw new TypeError('HAND_BINDING_INVALID:contact');
    const contact = s.contact.map(v => { const c = record(v, 'contact'), weight = number(c.weight, 'contact.weight');
      if (weight < 0) throw new TypeError('HAND_BINDING_INVALID:contact.weight');
      const index = vertex(c.index, 'contact.index'); if (!anchors.some(a => a.index === index)) throw new TypeError('HAND_BINDING_INVALID:contact vertex not in reference');
      return { index, weight }; });
    const sum = contact.reduce((n, c) => n + c.weight, 0);
    if (Math.abs(sum - 1) > 1e-6 || new Set(contact.map(c => c.index)).size !== contact.length) throw new TypeError('HAND_BINDING_INVALID:contact weights');
    if (typeof s.mirrorX !== 'boolean' || (s.insertion !== 'before' && s.insertion !== 'after')) throw new TypeError('HAND_BINDING_INVALID:mirrorX/insertion');
    const axis=s.flipAxis===undefined?undefined:record(s.flipAxis,'state.flipAxis');
    return { id: text(s.id, 'state.id'), displayName: text(s.displayName, 'state.displayName'), drawableId: text(s.drawableId, 'state.drawableId'),
      anchors, contact, insertion: s.insertion, mirrorX: s.mirrorX, rotationOffsetRad: number(s.rotationOffsetRad, 'state.rotationOffsetRad'),
      ...(s.poseOffset===undefined?{}:{poseOffset:point(s.poseOffset,'state.poseOffset')}),
      ...(axis?{flipAxis:{angleRad:number(axis.angleRad,'flipAxis.angleRad'),offset:point(axis.offset,'flipAxis.offset')}}:{}) };
  });
  if (new Set(states.map(s => s.id)).size !== states.length || new Set(states.map(s => s.drawableId)).size !== states.length)
    throw new TypeError('HAND_BINDING_INVALID:duplicate state');
  return { version: 1, runtime: 'cubism2', textureLayer: r.textureLayer as 'front'|'back', transition: 'weighted-scenes', unsupportedState: 'hide-with-diagnostic', states };
}

export function cloneAttachmentHandBinding(value: AttachmentHandBinding) { return parseAttachmentHandBinding(value); }
import type { AttachmentEntityAppearanceState } from './stageEntityVisualState';

/** Hand insertion currently supports the PNG and opacity, without silently
 * dropping attachment-owned effects. Figure/stage effects still own the scene. */
export function handAppearanceSupported(a?: AttachmentEntityAppearanceState): boolean {
  if (!a) return true;
  return a.blur === 0 && a.brightness === 1 && (a.contrast ?? 1) === 1 &&
    (a.saturation ?? 1) === 1 && (a.gamma ?? 1) === 1 &&
    a.color.red === 255 && a.color.green === 255 && a.color.blue === 255 &&
    (a.bevel?.strength ?? 0) === 0 && (a.bloom?.strength ?? 0) === 0 &&
    (a.shockwave ?? 0) === 0 && (a.radiusAlpha ?? 0) === 0;
}
