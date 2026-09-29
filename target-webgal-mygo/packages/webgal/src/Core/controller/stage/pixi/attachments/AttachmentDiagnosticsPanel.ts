import type {AttachmentRuntime} from './AttachmentRuntime';

/** Explicit professional, read-only inspection. Never changes story/entity state. */
export function installAttachmentDiagnosticsPanel(runtime: AttachmentRuntime) {
  if (new URLSearchParams(window.location.search).get('attachmentDiagnostics') !== '1') return;
  const panel=document.createElement('details'),summary=document.createElement('summary'),button=document.createElement('button'),result=document.createElement('pre');
  summary.textContent='附件运行诊断';button.textContent='读取附件状态（含GPU）';result.textContent='点击读取当前实际Runtime状态。GPU检查会读取并清除当前WebGL错误标志，不能用来推定错误归属。';
  panel.style.cssText='position:fixed;right:8px;top:8px;z-index:2147483000;max-width:540px;max-height:80vh;overflow:auto;background:#152332;color:#eee;padding:8px;font:13px sans-serif';
  result.style.cssText='white-space:pre-wrap;user-select:text';result.setAttribute('aria-label','附件运行状态');result.setAttribute('data-webgal-text-viewer','true');
  button.onclick=event=>{event.stopPropagation();const instances=runtime.list();const figures=[...new Set(instances.map(i=>i.figureKey))];result.textContent=JSON.stringify({runtime:runtime.getDiagnostics(),instances:instances.map(i=>({...i,hand:runtime.getHandStateDetails(i.figureKey,i.attachmentId)})),handRenderers:figures.map(figureKey=>({figureKey,...runtime.getHandRenderDiagnostics(figureKey,true)})),transitions:runtime.captureTransitionTrace('read-only-panel')},null,2);};
  panel.onclick=event=>event.stopPropagation();panel.onkeydown=event=>event.stopPropagation();panel.append(summary,button,result);document.body.append(panel);
  window.addEventListener('pagehide',event=>{if(!event.persisted)panel.remove();},{once:true});
}
