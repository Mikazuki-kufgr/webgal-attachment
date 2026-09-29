import * as PIXI from 'pixi.js';
import { beginGameInputBoundaryGesture, finishGameInputBoundaryGesture, cancelGameInputBoundaryGesture } from '@/Core/controller/gamePlay/gameInputBoundary';

/** Fit a rotated author-space rectangle into a CSS-sized preview without changing author data. */
export function creatorViewFit(width: number, height: number, viewWidth: number, viewHeight: number, radians = 0) {
  const c = Math.abs(Math.cos(radians)), s = Math.abs(Math.sin(radians));
  return Math.min(Math.max(1, viewWidth - 48) / Math.max(1, width * c + height * s),
    Math.max(1, viewHeight - 48) / Math.max(1, width * s + height * c));
}

export function createCreatorViewport(options: {
  app: () => PIXI.Application | undefined;
  active: () => { uuid: string; model: PIXI.Container } | undefined;
  beginPan: () => void;
}) {
  const viewport = document.createElement('div');
  viewport.dataset.creatorRole = 'model-viewport';
  viewport.style.cssText = 'position:fixed;inset:0 50% 0 0;overflow:hidden;background:#080d13;z-index:1';
  document.body.append(viewport);
  const controls = document.createElement('section');
  controls.dataset.creatorRole = 'view-controls';
  controls.style.cssText = 'padding:10px;border:1px solid #34526f;border-radius:8px;background:#142235;display:grid;gap:8px';
  const heading = document.createElement('strong'); heading.textContent = '人物视图';
  const help = document.createElement('div'); help.textContent = '左侧滚轮缩放；开启移动后拖动人物视图。仅调整查看范围，不改锚点和附件保存参数。';
  help.style.cssText = 'font-size:12px;color:#b9cbdc';
  const fields = document.createElement('div'); fields.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px';
  const field = (label: string, value: string, step: string) => {
    const wrap = document.createElement('label'); wrap.textContent = label;
    wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:6px;min-width:0';
    const input = document.createElement('input'); input.type = 'number'; input.value = value; input.step = step;
    input.setAttribute('aria-label', label); input.style.cssText = 'width:100%;min-width:0;box-sizing:border-box;background:#101a23;color:#eef;border:1px solid #526070;padding:6px;border-radius:5px';
    wrap.append(input); fields.append(wrap); return input;
  };
  const x = field('视图水平位置', '0', '10'), y = field('视图垂直位置', '0', '10');
  const zoom = field('视图缩放（%）', '100', '10'), angle = field('视图旋转（°）', '0', '5');
  zoom.min = '5'; zoom.max = '1000';
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  const button = (text: string) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.style.cssText = 'background:#203347;color:#eef;border:1px solid #526070;border-radius:6px;padding:7px 10px;cursor:pointer';
    actions.append(b); return b;
  };
  const pan = button('开启人物视图移动'), fit = button('看全人物'), reset = button('恢复默认视图');
  controls.append(heading, help, fields, actions);
  let attached: PIXI.Application | undefined, restore: (() => void) | undefined;
  let generation = '', baseScale = 1, center = { x: 0, y: 0 }, extent = { width: 1, height: 1 };
  let moving = false, disposed = false, frame = 0;
  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | undefined;
  const number = (input: HTMLInputElement, fallback: number) => Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : fallback;
  const cancel = () => { if (drag) cancelGameInputBoundaryGesture(drag.id); drag = undefined; };
  const setMoving = (value: boolean) => {
    cancel(); moving = value; pan.textContent = moving ? '关闭人物视图移动' : '开启人物视图移动';
    pan.setAttribute('aria-pressed', String(value)); viewport.style.cursor = value ? 'grab' : '';
  };
  const apply = () => {
    if (!attached) return;
    const scale = baseScale * Math.min(1000, Math.max(5, number(zoom, 100))) / 100;
    attached.stage.pivot.set(center.x, center.y);
    attached.stage.position.set(viewport.clientWidth / 2 + number(x, 0), viewport.clientHeight / 2 + number(y, 0));
    attached.stage.scale.set(scale);
    attached.stage.rotation = number(angle, 0) * Math.PI / 180;
  };
  const fitView = (neutral = false) => {
    const active = options.active(); if (!attached || !active) return;
    if (neutral) angle.value = '0';
    // Convert exact model-local corners back into author stage space, cancelling the current camera.
    const b = active.model.getLocalBounds();
    const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([px, py]) => attached!.stage.toLocal(active.model.toGlobal(new PIXI.Point(px, py))));
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
    if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return;
    center = { x: (left + right) / 2, y: (top + bottom) / 2 }; extent = { width: right - left, height: bottom - top };
    baseScale = creatorViewFit(extent.width, extent.height, viewport.clientWidth, viewport.clientHeight, number(angle, 0) * Math.PI / 180);
    x.value = y.value = '0'; zoom.value = '100'; apply();
  };
  pan.onclick = () => { if (!moving) options.beginPan(); setMoving(!moving); };
  fit.onclick = () => fitView(); reset.onclick = () => { setMoving(false); fitView(true); };
  for (const f of [x, y, zoom, angle]) f.oninput = apply;
  const inside = (event: MouseEvent) => event.clientX >= 0 && event.clientX < window.innerWidth / 2 && event.clientY >= 0 && event.clientY < window.innerHeight;
  const down = (event: PointerEvent) => {
    if (!moving || !inside(event) || event.button !== 0 || !options.active()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: number(x, 0), startY: number(y, 0), moved: false };
    beginGameInputBoundaryGesture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.moved ||= Math.hypot(dx, dy) > 2;
    x.value = String(Math.round(drag.startX + dx)); y.value = String(Math.round(drag.startY + dy)); apply();
  };
  const up = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    event.stopImmediatePropagation(); finishGameInputBoundaryGesture(drag.id, drag.moved); drag = undefined;
  };
  const wheel = (event: WheelEvent) => {
    if (!inside(event) || !options.active()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    zoom.value = String(Math.round(Math.min(1000, Math.max(5, number(zoom, 100) * Math.exp(-event.deltaY * 0.001))))); apply();
  };
  window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  const resize = () => {
    if (!attached) return;
    attached.renderer.resize(viewport.clientWidth, viewport.clientHeight);
    baseScale = creatorViewFit(extent.width, extent.height, viewport.clientWidth, viewport.clientHeight, number(angle, 0) * Math.PI / 180);
    apply();
  };
  window.addEventListener('resize', resize);
  const tick = () => {
    if (disposed) return;
    const app = options.app();
    if (app && app !== attached) {
      restore?.(); attached = app; generation = '';
      const canvas = app.view as HTMLCanvasElement, parent = canvas.parentNode, next = canvas.nextSibling;
      const style = canvas.style.cssText, width = app.renderer.screen.width, height = app.renderer.screen.height;
      const transform = app.stage.localTransform.clone();
      viewport.append(canvas); canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;touch-action:none';
      restore = () => {
        if (!app.stage.destroyed) app.stage.transform.setFromMatrix(transform);
        if (parent?.isConnected) parent.insertBefore(canvas, next?.parentNode === parent ? next : null);
        canvas.style.cssText = style;
        if (app.renderer) app.renderer.resize(width, height);
      };
      resize();
    }
    const active = options.active();
    if (active && active.uuid !== generation) { generation = active.uuid; cancel(); fitView(true); }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { controls, stopMoving: () => setMoving(false), dispose: () => {
    disposed = true; cancelAnimationFrame(frame); cancel();
    window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
    window.removeEventListener('wheel', wheel, true); window.removeEventListener('resize', resize);
    restore?.(); viewport.remove(); controls.remove();
  } };
}
