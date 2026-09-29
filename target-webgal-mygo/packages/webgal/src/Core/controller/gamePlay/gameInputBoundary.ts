// Creator and ordinary editable controls own their input; story advancement does not.
export const INPUT_BOUNDARY_ATTRIBUTE = 'data-webgal-game-input-boundary';
let activePointerId: number | undefined;
let suppressedClickPointerId: number | undefined;
let suppressionRevision = 0;
let suppressionTimer: ReturnType<typeof setTimeout> | undefined;
let decisionCount = 0;
let lastDecision: { type: string; ignore: boolean; reason: string } | undefined;
const advanceLocks = new Set<string>();

function pathOf(event: Event) {
  return typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
}
function matches(value: EventTarget | null, selector: string) {
  return typeof Element !== 'undefined' && value instanceof Element && value.closest(selector) !== null;
}
export function isGameInputBoundaryEvent(event: Event) {
  return pathOf(event).some((entry) => matches(entry, `[${INPUT_BOUNDARY_ATTRIBUTE}]`));
}
export function isGameAdvanceLocked() {
  return advanceLocks.size > 0;
}
export function shouldIgnoreGameAdvance(event: Event) {
  decisionCount += 1;
  let reason = 'game-owned';
  if (isGameAdvanceLocked()) reason = 'advance-locked';
  else if (
    isGameInputBoundaryEvent(event) ||
    pathOf(event).some((entry) =>
      matches(entry, 'input,textarea,select,button,[contenteditable="true"],[data-webgal-text-viewer]'),
    )
  ) {
    reason = 'boundary-or-editable';
  } else if (
    typeof PointerEvent !== 'undefined' &&
    event instanceof PointerEvent &&
    activePointerId === event.pointerId
  ) {
    reason = 'active-pointer';
  } else if (event.type === 'click' && suppressedClickPointerId !== undefined) {
    suppressedClickPointerId = undefined;
    suppressionRevision += 1;
    reason = 'synthetic-click';
  }
  const ignore = reason !== 'game-owned';
  lastDecision = { type: event.type, ignore, reason };
  return ignore;
}
export function acquireGameAdvanceLock(owner: string) {
  if (!owner.trim()) throw new Error('GAME_ADVANCE_LOCK_OWNER_REQUIRED');
  advanceLocks.add(owner.trim());
}
export function releaseGameAdvanceLock(owner: string) {
  return advanceLocks.delete(owner.trim());
}
export function beginGameInputBoundaryGesture(pointerId: number) {
  activePointerId = pointerId;
  suppressedClickPointerId = undefined;
  suppressionRevision += 1;
  clearTimeout(suppressionTimer);
}
export function finishGameInputBoundaryGesture(pointerId: number, suppressSyntheticClick: boolean) {
  if (activePointerId !== pointerId) return false;
  activePointerId = undefined;
  if (suppressSyntheticClick) {
    suppressedClickPointerId = pointerId;
    const revision = ++suppressionRevision;
    clearTimeout(suppressionTimer);
    suppressionTimer = setTimeout(() => {
      if (revision === suppressionRevision) suppressedClickPointerId = undefined;
      suppressionTimer = undefined;
    }, 0);
  }
  return true;
}
export function cancelGameInputBoundaryGesture(pointerId?: number) {
  if (pointerId !== undefined && activePointerId !== pointerId) return false;
  activePointerId = undefined;
  suppressedClickPointerId = undefined;
  suppressionRevision += 1;
  clearTimeout(suppressionTimer);
  suppressionTimer = undefined;
  return true;
}
export function gameInputBoundaryDiagnostics() {
  return {
    activePointerId,
    syntheticClickArmed: suppressedClickPointerId !== undefined,
    advanceLockOwners: Array.from(advanceLocks),
    decisionCount,
    lastDecision,
  };
}
