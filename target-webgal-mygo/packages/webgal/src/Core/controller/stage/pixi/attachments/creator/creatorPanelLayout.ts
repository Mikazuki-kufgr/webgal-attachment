import {
  beginGameInputBoundaryGesture,
  cancelGameInputBoundaryGesture,
  finishGameInputBoundaryGesture,
  INPUT_BOUNDARY_ATTRIBUTE,
} from '@/Core/controller/gamePlay/gameInputBoundary';

export const CREATOR_PANEL_LAYOUT_STORAGE_KEY = 'webgal.creator.panel-layout.v1';

export interface CreatorPanelLayout {
  workbenchWidth: number;
  statusHeight: number;
  historyWidth: number;
  historyHeight: number;
  stressWidth: number;
  stressHeight: number;
}

export type CreatorPanelKind = 'all' | 'workbench' | 'status' | 'history' | 'stress';

export const CREATOR_PANEL_LAYOUT_DEFAULTS: CreatorPanelLayout = {
  workbenchWidth: 520,
  statusHeight: 96,
  historyWidth: 330,
  historyHeight: 330,
  stressWidth: 310,
  stressHeight: 250,
};

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function within(value: number, min: number, max: number) {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
}

export function clampCreatorPanelLayout(
  input: Partial<CreatorPanelLayout> | undefined,
  viewport: { width: number; height: number },
): CreatorPanelLayout {
  const width = Math.max(640, finite(viewport.width, 1600));
  const height = Math.max(480, finite(viewport.height, 900));
  const workbenchMin = Math.min(420, Math.max(340, width - 300));
  const workbenchMax = Math.max(workbenchMin, Math.min(700, width - 320));
  const debugMaxWidth = Math.max(280, Math.min(620, width - 24));
  const debugMaxHeight = Math.max(180, Math.min(650, height - 104));
  return {
    workbenchWidth: within(finite(input?.workbenchWidth, CREATOR_PANEL_LAYOUT_DEFAULTS.workbenchWidth), workbenchMin, workbenchMax),
    statusHeight: within(finite(input?.statusHeight, CREATOR_PANEL_LAYOUT_DEFAULTS.statusHeight), 72, Math.min(420, height * 0.65)),
    historyWidth: within(finite(input?.historyWidth, CREATOR_PANEL_LAYOUT_DEFAULTS.historyWidth), 280, debugMaxWidth),
    historyHeight: within(finite(input?.historyHeight, CREATOR_PANEL_LAYOUT_DEFAULTS.historyHeight), 180, debugMaxHeight),
    stressWidth: within(finite(input?.stressWidth, CREATOR_PANEL_LAYOUT_DEFAULTS.stressWidth), 280, debugMaxWidth),
    stressHeight: within(finite(input?.stressHeight, CREATOR_PANEL_LAYOUT_DEFAULTS.stressHeight), 180, debugMaxHeight),
  };
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function readCreatorPanelLayout(): CreatorPanelLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(CREATOR_PANEL_LAYOUT_STORAGE_KEY) ?? '{}');
    return clampCreatorPanelLayout(parsed, viewport());
  } catch {
    return clampCreatorPanelLayout(undefined, viewport());
  }
}

function persistCreatorPanelLayout(next: CreatorPanelLayout) {
  try {
    localStorage.setItem(CREATOR_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A disabled storage area must not make the Creator unusable.
  }
}

function updateCreatorPanelLayout(patch: Partial<CreatorPanelLayout>) {
  const next = clampCreatorPanelLayout({ ...readCreatorPanelLayout(), ...patch }, viewport());
  persistCreatorPanelLayout(next);
  return next;
}

export function creatorPanelResetPatch(kind: CreatorPanelKind = 'all'): Partial<CreatorPanelLayout> {
  return kind === 'all'
    ? CREATOR_PANEL_LAYOUT_DEFAULTS
    : kind === 'workbench' ? { workbenchWidth: CREATOR_PANEL_LAYOUT_DEFAULTS.workbenchWidth }
    : kind === 'status' ? { statusHeight: CREATOR_PANEL_LAYOUT_DEFAULTS.statusHeight }
    : kind === 'history' ? { historyWidth: CREATOR_PANEL_LAYOUT_DEFAULTS.historyWidth, historyHeight: CREATOR_PANEL_LAYOUT_DEFAULTS.historyHeight }
    : { stressWidth: CREATOR_PANEL_LAYOUT_DEFAULTS.stressWidth, stressHeight: CREATOR_PANEL_LAYOUT_DEFAULTS.stressHeight };
}

export function resetCreatorPanelLayout(kind: CreatorPanelKind = 'all') {
  const current = readCreatorPanelLayout();
  const patch = creatorPanelResetPatch(kind);
  const next = clampCreatorPanelLayout({ ...current, ...patch }, viewport());
  persistCreatorPanelLayout(next);
  window.dispatchEvent(new CustomEvent('webgal-creator-panel-layout-reset', { detail: { kind } }));
  return next;
}

export function installCreatorWorkbenchLayout(
  root: HTMLElement,
  status: HTMLElement,
  resetAllButton: HTMLButtonElement,
  resetWorkbenchButton: HTMLButtonElement,
  resetStatusButton: HTMLButtonElement,
) {
  resetWorkbenchButton.remove();
  const apply = () => {
    root.style.width = '50vw'; root.style.maxWidth = 'none';
    status.style.height = readCreatorPanelLayout().statusHeight + 'px';
  };
  apply();
  const all = () => resetCreatorPanelLayout('all');
  const resetStatus = () => resetCreatorPanelLayout('status');
  resetAllButton.addEventListener('click', all);
  resetStatusButton.addEventListener('click', resetStatus);
  window.addEventListener('webgal-creator-panel-layout-reset', apply);
  const observer = new ResizeObserver(() => {
    const height = status.getBoundingClientRect().height;
    if (height > 0) updateCreatorPanelLayout({ statusHeight: height });
  });
  observer.observe(status);
  return {
    diagnostics: () => ({ layout: { ...readCreatorPanelLayout(), workbenchWidth: window.innerWidth / 2 }, dragging: false, fixedSplit: true }),
    cleanup: () => {
      observer.disconnect();
      resetAllButton.removeEventListener('click', all);
      resetStatusButton.removeEventListener('click', resetStatus);
      window.removeEventListener('webgal-creator-panel-layout-reset', apply);
    },
  };
}

export function installResizableDebugPanel(
  panel: HTMLElement,
  kind: 'history' | 'stress',
) {
  panel.setAttribute(INPUT_BOUNDARY_ATTRIBUTE, `creator-${kind}-debug`);
  panel.dataset.creatorResizablePanel = kind;
  panel.title = '拖拽右下角可调整宽度和高度';
  panel.style.resize = 'none';
  panel.style.overflow = 'auto';
  panel.style.boxSizing = 'border-box';
  panel.style.minWidth = '280px';
  panel.style.minHeight = '180px';
  panel.style.maxWidth = 'calc(100vw - 24px)';
  panel.style.maxHeight = 'calc(100vh - 104px)';
  const apply = () => {
    const next = readCreatorPanelLayout();
    panel.style.width = `${kind === 'history' ? next.historyWidth : next.stressWidth}px`;
    panel.style.height = `${kind === 'history' ? next.historyHeight : next.stressHeight}px`;
  };
  apply();
  const grip = document.createElement('div');
  grip.dataset.creatorRole = `${kind}-resize-handle`;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-label', `调整${kind === 'history' ? '历史' : '压力测试'}面板宽度和高度`);
  grip.title = '拖拽调整宽度和高度';
  grip.style.cssText =
    'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;' +
    'background:linear-gradient(135deg,transparent 42%,#68d5ff 44%,#68d5ff 52%,transparent 54%,transparent 64%,#68d5ff 66%);z-index:3';
  panel.append(grip);
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = '重置此面板';
  resetButton.dataset.creatorRole = `${kind}-reset`;
  resetButton.title = `只恢复${kind === 'history' ? '左上历史' : '左下压力测试'}面板尺寸`;
  resetButton.style.cssText = 'position:absolute;right:22px;top:6px;z-index:4;font:11px system-ui;padding:2px 6px;cursor:pointer';
  panel.append(resetButton);
  const requestReset = (event?: Event) => { event?.stopPropagation(); resetCreatorPanelLayout(kind); };
  const doubleClick = (event: MouseEvent) => { event.preventDefault(); requestReset(event); };
  resetButton.addEventListener('click', requestReset);
  grip.addEventListener('dblclick', doubleClick);
  let drag: { pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number; moved: boolean } | undefined;
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: bounds.width,
      startHeight: bounds.height,
      moved: false,
    };
    grip.setPointerCapture?.(event.pointerId);
    beginGameInputBoundaryGesture(event.pointerId);
    document.body.style.userSelect = 'none';
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    drag.moved = true;
    const patch = kind === 'history'
      ? { historyWidth: drag.startWidth + dx, historyHeight: drag.startHeight + dy }
      : { stressWidth: drag.startWidth + dx, stressHeight: drag.startHeight + dy };
    const next = updateCreatorPanelLayout(patch);
    panel.style.width = `${kind === 'history' ? next.historyWidth : next.stressWidth}px`;
    panel.style.height = `${kind === 'history' ? next.historyHeight : next.stressHeight}px`;
  };
  const finish = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completed = drag;
    drag = undefined;
    document.body.style.userSelect = '';
    finishGameInputBoundaryGesture(completed.pointerId, completed.moved);
    if (grip.hasPointerCapture?.(completed.pointerId)) grip.releasePointerCapture(completed.pointerId);
  };
  const cancel = (pointerId?: number) => {
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    const cancelled = drag;
    drag = undefined;
    document.body.style.userSelect = '';
    cancelGameInputBoundaryGesture(cancelled.pointerId);
  };
  const pointerCancel = (event: PointerEvent) => cancel(event.pointerId);
  const lostCapture = (event: PointerEvent) => cancel(event.pointerId);
  const blur = () => cancel();
  grip.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', pointerCancel);
  grip.addEventListener('lostpointercapture', lostCapture);
  window.addEventListener('blur', blur);
  let muted = false;
  const observer = new ResizeObserver(() => {
    if (muted) return;
    const bounds = panel.getBoundingClientRect();
    updateCreatorPanelLayout(kind === 'history'
      ? { historyWidth: bounds.width, historyHeight: bounds.height }
      : { stressWidth: bounds.width, stressHeight: bounds.height });
  });
  observer.observe(panel);
  const clamp = () => { muted = true; apply(); requestAnimationFrame(() => { muted = false; }); };
  const isolated = ['wheel', 'contextmenu', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'] as const;
  const stop = (event: Event) => event.stopPropagation();
  for (const name of isolated) panel.addEventListener(name, stop);
  window.addEventListener('resize', clamp);
  window.addEventListener('webgal-creator-panel-layout-reset', clamp);
  return () => {
    cancel();
    observer.disconnect();
    grip.removeEventListener('pointerdown', pointerDown);
    grip.removeEventListener('dblclick', doubleClick);
    resetButton.removeEventListener('click', requestReset);
    grip.removeEventListener('lostpointercapture', lostCapture);
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', pointerCancel);
    window.removeEventListener('blur', blur);
    for (const name of isolated) panel.removeEventListener(name, stop);
    window.removeEventListener('resize', clamp);
    window.removeEventListener('webgal-creator-panel-layout-reset', clamp);
  };
}
