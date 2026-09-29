import * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display-webgal';
import type { ActiveLive2DFigureResult } from '../../PixiController';
import { parseLive2DModelProfile } from '../profileLoader';
import type { Live2DModelProfile, ModelProfileAnchor } from '../profileTypes';
import type { createCreatorProjectClient, CreatorServiceContext } from './creatorProject';
import { loadCreatorMotionInventory } from './creatorCatalog';
import { anchorPointCloud, captureAuthoredAnchor, nearestAnchorVertex, validateAnchorGeometry } from './anchorAuthoringGeometry';
import { requireLoadedMoc } from './loadedModelEvidence';
import { createMeshLabelPanel } from './meshLabelPanel';

type ReadyFigure = Extract<ActiveLive2DFigureResult, { status: 'ready' }>['figure'];
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const e = document.createElement(tag); if (text) e.textContent = text; return e;
};
const button = (text: string) => { const b = node('button', text); b.type = 'button'; return b; };
const uuid = () => crypto.randomUUID();
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const errorHelp: Record<string, string> = {
  ANCHOR_NEEDS_3_TO_64_POINTS: '请选择 3–64 个顶点；通常先选 3–6 个分散的点即可。',
  ANCHOR_POINTS_COLLINEAR_OR_UNSTABLE: '这些点太接近一条直线，无法稳定跟随旋转。请换成能围出一小块面积的点。',
  ANCHOR_POINT_INVALID: '顶点权重必须是大于 0 的有限数字，请检查权重输入。',
  ANCHOR_LABEL_INVALID: '请填写不超过 80 字符的锚点名称，不要含换行或控制字符。',
  ANCHOR_VERTEX_OUT_OF_RANGE: '顶点不属于当前网格，请重新选择网格并点选。',
  CREATOR_ANCHOR_MODEL_CHANGED: '磁盘模型已改变，请重新载入并检查锚点，不要直接覆盖旧配置。',
  CREATOR_ANCHOR_SAVE_CONFLICT: '文件已被别处修改或保存。请重新打开核对；也可以从 Profile 文件打开副本，保留双方内容。',
  CREATOR_ANCHOR_PROFILE_INVALID: '锚点组格式不完整，请检查高级标识和锚点数据；原文件未覆盖。',
  CREATOR_MESH_LABEL_SAVE_CONFLICT: '网格名称已被别处修改。请先导出当前名称备份，再重新读取本地名称、导入比较；未覆盖原文件。',
  CREATOR_MESH_MODEL_CHANGED: '模型几何已改变，请重新载入模型并复核名称后保存；未覆盖原文件。',
};

/** User-directed editing of the real runtime mesh. No semantic inference or alternate renderer. */
export function createAnchorAuthoringPanel(options: {
  client: ReturnType<typeof createCreatorProjectClient>;
  signal: AbortSignal;
  active: () => ReadyFigure | undefined;
  onPickingStart?: () => void;
  renderer: () => PIXI.AbstractRenderer | undefined;
  profiles: () => Live2DModelProfile[];
  context: () => CreatorServiceContext | undefined;
  reload?: () => Promise<void>;
  loadModel: (modelPath: string) => Promise<void>;
  playMotion: (figure: ReadyFigure, motion: string) => Promise<void>;
  apply: (profile: Live2DModelProfile, anchorName: string) => Promise<void>;
  saved: (profile: Live2DModelProfile) => Promise<void>;
  audit: (result: string, detail: string) => void;
}) {
  const panel = node('details'), summary = node('summary', '锚点制作器（试用）：自定义部位 / 外观专属锚点');
  panel.dataset.anchorAuthoringPanel = 'true';
  const styles = node('style');
  styles.textContent = `
    [data-anchor-authoring-panel] { min-width:0; overflow-wrap:anywhere; }
    [data-anchor-authoring-panel] .anchor-step { margin:12px 0; padding:12px; border:1px solid #354554; border-radius:8px; min-width:0; }
    [data-anchor-authoring-panel] .anchor-step h4 { margin:0 0 10px; color:#89d9ed; }
    [data-anchor-authoring-panel] .anchor-actions { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    [data-anchor-authoring-panel] button { white-space:normal; max-width:100%; padding:7px 10px; border:1px solid #405364; border-radius:5px; background:#202d39; color:#e3edf5; font:inherit; cursor:pointer; }
    [data-anchor-authoring-panel] button:hover:not(:disabled) { background:#2b4051; border-color:#82cbdc; }
    [data-anchor-authoring-panel] button:disabled { opacity:.5; cursor:wait; }
    [data-anchor-authoring-panel] input, [data-anchor-authoring-panel] select { box-sizing:border-box; min-width:0; max-width:100%; padding:6px 8px; border:1px solid #405364; border-radius:4px; background:#101a23; color:#e3edf5; font:inherit; }
    [data-anchor-authoring-panel] input:focus-visible, [data-anchor-authoring-panel] select:focus-visible, [data-anchor-authoring-panel] button:focus-visible { outline:2px solid #89d9ed; outline-offset:2px; }
    [data-anchor-authoring-panel] input[type=checkbox] { accent-color:#89d9ed; }
    [data-anchor-authoring-panel] h4, [data-anchor-authoring-panel] summary { scroll-margin-top:120px; }
    [data-mesh-labels] { padding:10px; border:1px solid #354554; border-radius:6px; }
    [data-mesh-labels] > summary { color:#89d9ed; cursor:pointer; }
    [data-anchor-authoring-panel] label { gap:5px; margin:8px 0; }
    [data-anchor-authoring-panel] pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; }
    [data-anchor-authoring-panel] .anchor-weights { display:grid; grid-template-columns:repeat(auto-fit,minmax(135px,1fr)); gap:8px; }
    [data-anchor-authoring-panel] .anchor-weights label { display:grid; gap:4px; margin:0; }
    [data-anchor-authoring-panel] .anchor-weights p { grid-column:1/-1; }
    [data-anchor-authoring-panel] .anchor-mode { padding:8px; border-left:3px solid #89d9ed; background:#15232e; }
  `;
  panel.append(summary);
  const help = node('p', '直接为左侧当前立绘新建锚点组，无需重复载入，也不用寻找它改自哪套默认模型。再暂停选网格和顶点、命名、观察动作，最后保存。名称由你决定；同名不代表其他立绘也能使用。选点仅是几何绑定，不是模型识别。');
  const modelSelect = node('select'), load = button('载入所选立绘（无需现成锚点）'), refresh = button('刷新立绘列表');
  modelSelect.setAttribute('aria-label', '锚点制作目标立绘');
  const start = button('为画面中的立绘新建锚点组'), existing = node('select'), open = button('打开已有锚点组');
  const recover = button('恢复保留草稿到当前同模型'), backup = button('备份未保存草稿（含未确认选点）');
  existing.setAttribute('aria-label', '已有锚点组');
  const file = node('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  const importButton = button('从 Profile 文件打开副本');
  const facts = node('pre'); facts.style.whiteSpace = 'pre-wrap';
  const character = node('input'), appearance = node('input');
  const label = (text: string, field: HTMLElement) => { const l = node('label', text); l.style.display = 'grid'; l.append(field); return l; };
  const identity = node('details'); identity.append(node('summary', '高级：角色 / 外观技术标识'),
    label('角色 ID（英文字母、数字、横线）', character), label('外观 ID（仅当前模型，不自动套用其他衣服）', appearance));
  const anchorSelect = node('select'), edit = button('编辑选中锚点'), add = button('新建另一个锚点'), remove = button('从本草稿移除锚点');
  anchorSelect.setAttribute('aria-label', '草稿中的锚点');
  const name = node('input'); name.maxLength = 80; name.placeholder = '例如：单马尾根部、眼镜桥、鸭舌帽帽檐';
  const mesh = node('select'), search = node('input'); search.placeholder = '筛选网格 ID（可留空）'; mesh.setAttribute('aria-label', '跟随网格');
  const near = button('在画面点击，查找附近网格'), all = button('显示全部网格');
  const pick = button('暂停并选点 / 重设参考姿态'), resume = button('继续动作，停止选点');
  const pointHelp = node('p', '选定网格后点击“暂停并选点”。点击黄点选择/取消至少 3 个分散且不在一条线上的点；绿色十字为加权中心。重设参考会统一重采样当前选中点，不自动恢复中性姿态，请先选好姿态。');
  const points = node('div'), capture = button('确认这个锚点到草稿'), motion = node('select'), play = button('播放动作检查随动');
  motion.setAttribute('aria-label', '锚点验证动作');
  const save = button('保存锚点组到本地资料库'), use = button('用已保存锚点制作附件'), download = button('导出 Profile 文件');
  const status = node('pre'); status.style.whiteSpace = 'pre-wrap'; status.setAttribute('aria-live', 'polite');
  const scopeHelp = node('p', '保存只记录这一套具体模型。修改已有组不会自动改写过去保存的附件；应用后需重新保存相应附件。先检查转头、低头和相关部位动作，技术校验不代表语义/视觉已正确。关闭本折叠区会恢复模型播放并隐藏选点层，草稿保留。');
  const actions = (...items: HTMLElement[]) => { const row = node('div'); row.className = 'anchor-actions'; row.append(...items); return row; };
  const step = (title: string, ...items: HTMLElement[]) => { const block = node('section'); block.className = 'anchor-step'; block.append(node('h4', title), ...items); return block; };
  const technical = node('details'); technical.append(node('summary', '模型路径与锚点组技术信息'), facts, identity);
  const modeStatus = node('p', '当前模式：观察动作'); modeStatus.className = 'anchor-mode'; modeStatus.setAttribute('role', 'status');
  const draftStatus = node('p', '尚未打开锚点组。'); draftStatus.setAttribute('role', 'status');
  points.className = 'anchor-weights';
  const meshDetails = node('div');
  panel.append(styles, help, draftStatus,
    step('1. 为当前立绘制作锚点', actions(refresh), label('目标立绘', modelSelect), actions(load, start), label('当前立绘已有的锚点组', existing), actions(open, importButton), file, actions(recover, backup), technical),
    step('2. 选择部位与参考点', label('草稿中的锚点', anchorSelect), actions(edit, add, remove), label('锚点显示名称（可中文）', name), label('筛选网格', search), label('跟随网格', mesh), actions(near, all), meshDetails, modeStatus, actions(pick, resume), pointHelp, points, actions(capture)),
    step('3. 动作检查', label('验证动作', motion), actions(play), scopeHelp),
    step('4. 保存并使用', actions(save, use, download)), status);
  for (const select of [modelSelect, existing, anchorSelect, mesh, motion]) select.style.width = '100%';

  let draft: Live2DModelProfile | undefined, expectedHash: string | null = null;
  let bound: ReadyFigure | undefined, editingName = '', editingIdentity = '', reference: number[] = [];
  let referenceDrawableId = '', referenceGeneration = '';
  let weights = new Map<number, number>(), dirty = false, pointDirty = false, busy = false, epoch = 0;
  let mode: 'observe' | 'near' | 'points' = 'observe';
  let paused: { model: Live2DModel; previous: boolean } | undefined;
  let disposed = false, lastDrawError = '';
  let frameRenderer: PIXI.AbstractRenderer | undefined;
  const overlay = node('canvas'); overlay.dataset.anchorAuthoringOverlay = 'true';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;display:none;touch-action:none';
  overlay.setAttribute('aria-label', '立绘网格选点层'); document.body.append(overlay);
  const ctx = overlay.getContext('2d')!;
  const say = (text: string, failed = false) => {
    status.textContent = text;
    if (failed) options.audit('ERROR', text);
  };
  function live() {
    const active = options.active();
    return bound && active && active.uuid === bound.uuid && active.model === bound.model &&
      active.normalizedSourceUrl === draft?.modelPath && !active.model.destroyed ? active : undefined;
  }
  function requireLive() { const f = live(); if (!f) throw new Error('立绘已经切换，请重新打开该模型的锚点组。草稿仍保留。'); return f; }
  function stopPicking() {
    if (paused && !paused.model.destroyed) paused.model.autoUpdate = paused.previous;
    paused = undefined; mode = 'observe'; overlay.style.pointerEvents = 'none';
    modeStatus.textContent = '当前模式：观察动作（点击画面不会修改参考点）';
  }
  const run = async (fn: () => Promise<void> | void) => {
    if (busy || disposed) return;
    busy = true;
    const controls = [...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')];
    const disabled = controls.map(c => c.disabled); controls.forEach(c => { c.disabled = true; });
    try { await fn(); } catch (error) {
      if (!disposed) {
        const message = error instanceof Error ? error.message : String(error), code = message.match(/(?:CREATOR_ANCHOR|CREATOR_MESH|ANCHOR)_[A-Z0-9_]+/)?.[0];
        say(code && errorHelp[code] ? `${errorHelp[code]}\n${message}` : message, true);
      }
    }
    finally { busy = false; controls.forEach((c, i) => { c.disabled = disabled[i]; }); }
  };
  const inspector = createMeshLabelPanel({ client:options.client, signal:options.signal, run, say,
    current:()=>{const f=live();return f?{model:f.model,uuid:f.uuid}:undefined;},
    changed:()=>fillMeshes(), screenPoints:screenCloud,
    frame:()=>new Promise<HTMLCanvasElement>((resolve,reject)=>{
      const renderer=options.renderer();if(!renderer)return reject(new Error('渲染器不可用'));
      const done=()=>{clearTimeout(timer);const view=renderer.view as HTMLCanvasElement,rect=view.getBoundingClientRect(),c=node('canvas');c.width=Math.round(rect.width);c.height=Math.round(rect.height);c.getContext('2d')!.drawImage(view,0,0,c.width,c.height);resolve(c);};
      const timer=setTimeout(()=>{renderer.off('postrender',done);reject(new Error('等待人物参考帧超时，请恢复画面后重试。'));},5000);
      renderer.once('postrender',done);
    }),
  });
  meshDetails.append(inspector.root);search.placeholder='搜索网格名称或技术 ID';
  function discard() { return inspector.canLeave() && ((!dirty && !pointDirty) || window.confirm('放弃当前未保存的锚点修改？已保存的文件不会被删除。')); }
  function requestModelChange(modelPath?: string) {
    if (modelPath === draft?.modelPath && live()) return true;
    if (busy) { say('锚点操作尚未完成，请稍后切换立绘。'); return false; }
    if (!inspector.canLeave()) return false;
    if ((dirty || pointDirty) && !window.confirm('切换立绘后将保留未保存的锚点草稿。返回同一模型后请点击“恢复保留草稿到当前同模型”；现在切换？')) return false;
    stopPicking(); return true;
  }
  async function requestExit() {
    if (busy) { say('锚点操作尚未完成，请等待结果后再停止服务。'); return false; }
    if (!inspector.canLeave()) return false;
    if (!dirty && !pointDirty) return true;
    if (window.confirm('锚点修改尚未保存。确定：先保存再停止；取消：选择放弃或留在页面。')) {
      let saved = false; await run(async () => { await persist(); saved = true; }); return saved;
    }
    return window.confirm('放弃未保存的锚点修改并停止服务？取消可留在页面继续编辑。');
  }
  function renderFacts() {
    draftStatus.textContent = draft ? `${draft.anchors.length} 个已确认锚点 · ${dirty || pointDirty ? '有未保存修改' : '无未保存修改'}${pointDirty ? ' · 当前选点或名称尚未确认' : ''}` : '尚未打开锚点组。先载入立绘，再新建或打开锚点组。';
    facts.textContent = draft ? `只适用：${draft.modelPath}\n锚点组：${draft.modelProfileId}\n${draft.anchors.length} 个已确认锚点；${dirty || pointDirty ? '有未保存修改' : '未修改'}。` : '尚未打开锚点组。先载入一套立绘。';
    character.value = draft?.characterId ?? ''; appearance.value = draft?.modelId ?? '';
  }
  function renderAnchorList() {
    const previous = anchorSelect.value; anchorSelect.replaceChildren();
    for (const a of draft?.anchors ?? []) { const o = node('option', a.displayName ?? a.name); o.value = a.name; anchorSelect.append(o); }
    if ([...anchorSelect.options].some(o => o.value === previous)) anchorSelect.value = previous;
    renderFacts();
  }
  function renderPoints() {
    points.replaceChildren();
    for (const [index, weight] of weights) {
      const row = node('label', `顶点 ${index} 权重 `), input = node('input');
      input.type = 'number'; input.min = '0.001'; input.step = '0.1'; input.value = String(weight); input.style.width = '85px';
      input.onchange = () => { weights.set(index, Number(input.value)); pointDirty = true; renderFacts(); };
      row.append(input); points.append(row);
    }
    points.append(node('p', `已选 ${weights.size} 个顶点。显示名可以重命名，技术 ID 不变。`));
  }
  function fillMeshes(ids?: string[]) {
    const previous = mesh.value; mesh.replaceChildren();
    const f = live(); if (!f) return;
    const candidates = ids ?? f.model.internalModel.getDrawableIDs().filter(id => `${id} ${inspector.label(id)}`.toLowerCase().includes(search.value.toLowerCase()));
    // A filter is a view operation, not permission to retarget retained reference points.
    if (referenceDrawableId && !candidates.includes(referenceDrawableId)) candidates.unshift(referenceDrawableId);
    if (inspector.dirty() && inspector.selected() && !candidates.includes(inspector.selected())) candidates.unshift(inspector.selected());
    for (const id of candidates) {
      const count = f.model.internalModel.getDrawableVertices(id).length / 2;
      if (count < 3) continue;
      const display = inspector.label(id);
      const o = node('option', `${display || '待命名'} · ${id} · ${count} 个点`); o.value = id; mesh.append(o);
    }
    if ([...mesh.options].some(o => o.value === previous)) mesh.value = previous;
    if (!inspector.select(mesh.value)) mesh.value=inspector.selected();
  }
  function newAnchor() {
    stopPicking(); editingName = 'user.a-' + uuid(); editingIdentity = 'anchor-' + uuid(); name.value = '';
    weights.clear(); reference = []; referenceDrawableId = referenceGeneration = ''; pointDirty = false; renderPoints();
  }
  async function bindProfile(profile: Live2DModelProfile, hash: string | null, preserve = false) {
    stopPicking(); const f = options.active();
    if (!f || f.normalizedSourceUrl !== profile.modelPath) throw new Error('请先载入这份 Profile 对应的立绘，再打开它。不会自动套用到别的外观。');
    const revision = ++epoch;
    const facts = await options.client.readAnchorModel(profile.modelPath, { signal: options.signal });
    if (disposed || revision !== epoch || options.active()?.uuid !== f.uuid || options.active()?.model !== f.model) throw new Error('人物已切换，本次读取取消。');
    requireLoadedMoc(f.model, facts.mocSha256);
    if (profile.fingerprint.mocSha256?.toUpperCase() !== facts.mocSha256 || profile.fingerprint.drawableCount !== f.model.internalModel.getDrawableIDs().length)
      throw new Error('模型几何版本不同。请为这套立绘新建锚点组，不自动迁移原锚点。');
    for (const a of profile.anchors) {
      if (f.model.internalModel.getDrawableIndex(a.drawableId) < 0 || f.model.internalModel.getDrawableVertices(a.drawableId).length / 2 !== a.vertexCount)
        throw new Error(`锚点“${a.displayName ?? a.name}”所需网格不匹配，请保留原文件并另建锚点组。`);
    }
    if (preserve && reference.length && (!referenceDrawableId || f.model.internalModel.getDrawableIndex(referenceDrawableId) < 0 || f.model.internalModel.getDrawableVertices(referenceDrawableId).length !== reference.length))
      throw new Error('草稿参考网格不匹配，请保留备份。');
    draft = copy(profile); draft.modelPath = f.normalizedSourceUrl; bound = f; expectedHash = hash;
    // Entry JSON may legitimately change without changing moc geometry. Explicit reopen refreshes its evidence.
    dirty = (preserve && dirty) || draft.fingerprint.modelJsonSha256 !== facts.modelJsonSha256;
    draft.fingerprint.modelJsonSha256 = facts.modelJsonSha256;
    await inspector.bind(f.model, f.uuid, f.normalizedSourceUrl, facts.mocSha256);
    if(disposed || revision !== epoch || !live()) throw new Error('人物已切换，网格名称读取取消。');
    if (!preserve) newAnchor();
    else if (reference.length) {
      referenceGeneration = f.uuid;
    }
    fillMeshes(); renderAnchorList();
    let motions: string[] = [];
    try { motions = await loadCreatorMotionInventory(profile.modelPath, undefined, { signal: options.signal }); }
    catch { /* No motion is not a failure to open a static/unfinished user model. */ }
    if (disposed || revision !== epoch || !live()) throw new Error('人物已切换，本次读取取消；已取得的草稿仍保留，可在同模型恢复。');
    motion.replaceChildren(...motions.map(m => { const o = node('option', m); o.value = m; return o; }));
    say('锚点组已打开。可以新增锚点，或选已有锚点后点击编辑。' + (motions.length ? '' : '未取得动作列表，动态效果仍待检查。'));
  }
  function readProfile() {
    requireLive(); if (!draft) throw new Error('请先新建或打开锚点组。');
    if (pointDirty) throw new Error('当前点选或名称修改还未确认。请先点击“确认这个锚点到草稿”。');
    const p = parseLive2DModelProfile({ ...draft, characterId: character.value, modelId: appearance.value }, '用户锚点草稿');
    for (const a of p.anchors) validateAnchorGeometry(a.points);
    return p;
  }
  function confirmAnchor() {
    const f = requireLive(); if (!draft || !reference.length) throw new Error('请先选择网格并暂停选点。');
    if (referenceDrawableId !== mesh.value || referenceGeneration !== f.uuid || f.model.internalModel.getDrawableVertices(mesh.value).length !== reference.length)
      throw new Error('参考点与所选网格或立绘实例不一致，请重新暂停选点。');
    const anchor = captureAuthoredAnchor({ name: editingName, displayName: name.value, anchorProfileId: editingIdentity,
      drawableId: mesh.value, vertices: reference, weights });
    const index = draft.anchors.findIndex(a => a.name === anchor.name);
    if (index < 0) draft.anchors.push(anchor); else draft.anchors[index] = anchor;
    dirty = true; pointDirty = false; renderAnchorList(); anchorSelect.value = anchor.name;
    say('已确认到草稿，尚未写入文件。继续动作检查后再保存。');
  }
  function editAnchor() {
    if (pointDirty && !window.confirm('放弃尚未确认的点选修改？')) return;
    requireLive(); const a = draft?.anchors.find(a => a.name === anchorSelect.value); if (!a) return;
    if (!inspector.select(a.drawableId)) return;
    stopPicking(); search.value = ''; referenceDrawableId = a.drawableId; referenceGeneration = requireLive().uuid;
    fillMeshes(); mesh.value = a.drawableId; editingName = a.name; editingIdentity = a.anchorProfileId;
    inspector.select(mesh.value);
    name.value = a.displayName ?? a.name;
    reference = Array.from(requireLive().model.internalModel.getDrawableVertices(a.drawableId));
    for (const p of a.points) { reference[p.index * 2] = p.neutral.x; reference[p.index * 2 + 1] = p.neutral.y; }
    weights = new Map(a.points.map(p => [p.index, p.weight])); pointDirty = false; renderPoints();
    say('已载入原参考点；改名称/权重不会重采样姿态。需要换点时点击“暂停并选点 / 重设参考姿态”。');
  }
  function screenCloud(drawableId: string) {
    const f = requireLive(), renderer = options.renderer(); if (!renderer) throw new Error('渲染器不可用');
    const rect = (renderer.view as HTMLCanvasElement).getBoundingClientRect(), matrix = f.model.internalModel.localTransform;
    return anchorPointCloud(f.model.internalModel.getDrawableVertices(drawableId)).map(p => {
      // Match the Live2D renderer: model world transform * internal model transform.
      // Authoring must work before any attachment planes have been created.
      const global = f.model.toGlobal(matrix.apply(new PIXI.Point(p.x, p.y)));
      return { x: global.x * rect.width / renderer.screen.width, y: global.y * rect.height / renderer.screen.height };
    });
  }
  function draw() {
    if (disposed) return;
    inspector.tick();
    if (panel.open && live() && mesh.value) {
      const renderer = options.renderer(), rect = (renderer?.view as HTMLCanvasElement | undefined)?.getBoundingClientRect();
      if (rect?.width && rect.height) {
        overlay.style.display = 'block'; overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`; overlay.style.height = `${rect.height}px`;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (overlay.width !== Math.round(rect.width * ratio) || overlay.height !== Math.round(rect.height * ratio)) {
          overlay.width = Math.round(rect.width * ratio); overlay.height = Math.round(rect.height * ratio);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
        try {
          const cloud = screenCloud(mesh.value); let x = 0, y = 0, sum = 0;
          cloud.forEach((p, i) => {
            ctx.fillStyle = weights.has(i) ? '#33ffaa' : '#ffe86c'; ctx.beginPath(); ctx.arc(p.x, p.y, weights.has(i) ? 5 : 2.5, 0, Math.PI * 2); ctx.fill();
            if (weights.has(i)) { const w = weights.get(i)!; x += p.x * w; y += p.y * w; sum += w; ctx.fillStyle = 'white'; ctx.fillText(String(i), p.x + 7, p.y - 7); }
          });
          if (sum > 0) { x /= sum; y /= sum; ctx.strokeStyle = '#33ffaa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke(); }
          lastDrawError = '';
        } catch (error) {
          stopPicking();
          const message = String(error);
          if (message !== lastDrawError) { lastDrawError = message; say(message, true); }
        }
      }
    } else { overlay.style.display = 'none'; stopPicking(); }
  }
  function watchFrames() {
    const renderer = options.renderer();
    if (renderer === frameRenderer) return;
    frameRenderer?.off('postrender', draw); frameRenderer = renderer;
    frameRenderer?.on('postrender', draw);
  }
  overlay.onpointerdown = event => {
    event.stopPropagation(); event.preventDefault();
    if (busy || mode === 'observe') return;
    void run(() => {
      const f = requireLive(), rect = overlay.getBoundingClientRect(), target = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (mode === 'near') {
        const candidates = f.model.internalModel.getDrawableIDs().filter(id => f.model.internalModel.getDrawableVertices(id).length >= 6).map(id => {
          const cloud = screenCloud(id); return { id, distance: cloud.reduce((d, p) => Math.min(d, Math.hypot(p.x - target.x, p.y - target.y)), Infinity) };
        }).filter(c => c.distance <= 100).sort((a, b) => a.distance - b.distance).slice(0, 25);
        stopPicking(); weights.clear(); reference = []; referenceDrawableId = referenceGeneration = ''; fillMeshes(candidates.map(c => c.id)); pointDirty = true; renderPoints();
        say(candidates.length ? '已列出附近网格候选（包含遮挡/隐藏网格，不是语义识别）。逐个选择并观察黄点，再自行确认。' : '附近没有可用网格。可显示全部并手动选择。');
      } else {
        const index = nearestAnchorVertex(screenCloud(mesh.value), target);
        if (index < 0) return;
        if (weights.has(index)) weights.delete(index); else if (weights.size < 64) weights.set(index, 1);
        pointDirty = true; renderPoints(); renderFacts();
      }
    });
  };
  panel.ontoggle = () => { if (panel.open) { refreshLists(); draw(); } else { stopPicking(); overlay.style.display = 'none'; } };
  function refreshLists() {
    if (disposed) return;
    watchFrames();
    const previous = modelSelect.value, previousProfile = existing.value, paths = new Map<string, string>();
    const available = new Set([...(options.context()?.authoringWorkspace.availableModelProfileIds ?? []), ...(options.context()?.authoringWorkspace.reviewModelProfileIds ?? [])]);
    for (const p of options.profiles()) if (available.has(p.modelProfileId)) paths.set(p.modelPath.replace(/^(\.\/)+/, ''), `${p.characterId} / ${p.modelId}`);
    for (const m of options.context()?.importedModels ?? []) paths.set(m.modelPath.replace(/^(\.\/)+/, ''), m.displayName + ' / ' + (m.appearanceName || m.entryPath.split('/').slice(-2,-1)[0] || '自定义外观') + '（已导入）');
    const active = options.active();
    if (active) paths.set(active.normalizedSourceUrl, paths.get(active.normalizedSourceUrl) ?? '当前画面中的立绘');
    modelSelect.replaceChildren(node('option', '请选择一套立绘')); modelSelect.options[0].value = '';
    for (const [path, label] of paths) { const o = node('option', label); o.value = path; o.title = path; modelSelect.append(o); }
    modelSelect.value = active?.normalizedSourceUrl ?? (paths.has(previous) ? previous : '');
    existing.replaceChildren();
    for (const p of options.profiles().filter(p => p.modelPath.replace(/^(\.\/)+/, '') === options.active()?.normalizedSourceUrl)) {
      const o = node('option', `${paths.get(p.modelPath.replace(/^(\.\/)+/, '')) ?? '当前立绘'} · 锚点组 ${existing.options.length + 1} · ${p.anchors.length} 个锚点`); o.value = p.modelProfileId; existing.append(o);
    }
    if ([...existing.options].some(o => o.value === previousProfile)) existing.value = previousProfile;
  }
  refresh.onclick = () => void run(async () => { await options.reload?.(); refreshLists(); say('已重新读取立绘与锚点组列表。'); });
  load.onclick = () => {
    if (!modelSelect.value || !requestModelChange(modelSelect.value)) return;
    void run(async () => { stopPicking(); ++epoch; await options.loadModel(modelSelect.value); refreshLists(); renderFacts();
      say(draft ? '立绘已载入，原草稿与未确认选点已保留。返回同一模型后可点击“恢复保留草稿到当前同模型”。' : '立绘已载入，现在可以新建锚点组。');
    });
  };
  start.onclick = () => void run(async () => {
    if (!discard()) return; const f = options.active(); if (!f) throw new Error('请先载入立绘，等它完全出现。');
    const facts = await options.client.readAnchorModel(f.normalizedSourceUrl, { signal: options.signal });
    if (disposed || options.active()?.uuid !== f.uuid) return;
    const base = options.profiles().find(p => p.modelPath.replace(/^(\.\/)+/, '') === f.normalizedSourceUrl), unique = uuid();
    await bindProfile({ schema: 'webgal-live2d-model-profile', schemaVersion: 1, profileVersion: 1, modelProfileId: 'user-profile-' + unique,
      characterId: base?.characterId ?? 'user-' + unique, modelId: base?.modelId ?? 'appearance-' + unique,
      modelPath: facts.modelPath, fingerprint: { modelJsonSha256: facts.modelJsonSha256, mocSha256: facts.mocSha256, drawableCount: f.model.internalModel.getDrawableIDs().length }, anchors: [] }, null);
    dirty = true; renderFacts(); say('新建草稿只针对当前外观。选择网格、暂停选点并填写名称。');
  });
  open.onclick = () => void run(async () => {
    if (!discard()) return; const p = options.profiles().find(p => p.modelProfileId === existing.value); if (!p) return;
    if (p.modelProfileId.startsWith('user-profile-')) {
      const read = await options.client.readAnchorProfile(p.modelProfileId, { signal: options.signal });
      await bindProfile(parseLive2DModelProfile(read.profile, '本地锚点组'), read.sha256);
    } else { const cloned = copy(p); cloned.modelProfileId = 'user-profile-' + uuid(); await bindProfile(cloned, null); dirty = true; say('已打开为用户副本；不会覆盖随包或其他来源的 Profile。'); }
    renderFacts();
  });
  importButton.onclick = () => { file.value = ''; file.click(); };
  file.onchange = () => void run(async () => {
    const f = file.files?.[0]; if (!f || !discard()) return; if (f.size > 1024 * 1024) throw new Error('Profile 超过 1 MiB 上限。');
    const raw = JSON.parse((await f.text()).replace(/^\uFEFF/, ''));
    const isBackup = raw.schema === 'webgal-anchor-authoring-draft';
    const p = parseLive2DModelProfile(isBackup ? raw.profile : raw, f.name, isBackup);
    const e = isBackup ? raw.editing : undefined;
    if (isBackup && (raw.schemaVersion !== 1 || !e || typeof e.name !== 'string' || e.name.length > 80 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(e.editingName) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(e.editingIdentity) ||
      typeof e.referenceDrawableId !== 'string' || !Array.isArray(e.reference) || e.reference.length > 1000000 || e.reference.length % 2 || !e.reference.every(Number.isFinite) ||
      !Array.isArray(e.weights) || e.weights.length > 64 || e.weights.some((w: unknown) => !Array.isArray(w) || w.length !== 2 || !Number.isInteger(w[0]) || w[0] < 0 || w[0] * 2 >= e.reference.length || !Number.isFinite(w[1]) || w[1] <= 0) ||
      new Set(e.weights.map((w: number[]) => w[0])).size !== e.weights.length)) throw new Error('草稿备份的编辑数据无效；当前草稿未替换。');
    const active = options.active();
    if (e?.reference.length && (!active || active.model.internalModel.getDrawableIndex(e.referenceDrawableId) < 0 || active.model.internalModel.getDrawableVertices(e.referenceDrawableId).length !== e.reference.length))
      throw new Error('草稿备份参考网格与当前立绘不一致。');
    p.modelProfileId = 'user-profile-' + uuid(); await bindProfile(p, null); dirty = true; renderFacts(); say('已打开文件副本，原文件不改。请检查后保存。');
    if (e) {
      editingName = e.editingName; editingIdentity = e.editingIdentity; name.value = e.name;
      reference = e.reference; referenceDrawableId = e.referenceDrawableId; referenceGeneration = requireLive().uuid;
      weights = new Map(e.weights); pointDirty = Boolean(e.pointDirty); search.value = ''; fillMeshes();
      if (referenceDrawableId) mesh.value = referenceDrawableId; renderPoints(); renderFacts();
      say('已恢复未验证草稿副本和未确认选点；请检查、确认后再保存正式锚点组。');
    }
  });
  edit.onclick = () => void run(editAnchor);
  add.onclick = () => { if (!pointDirty || window.confirm('放弃未确认的点选修改，新增一个锚点？')) newAnchor(); };
  remove.onclick = () => { if (draft && window.confirm(anchorSelect.value === editingName && pointDirty ? '删除当前锚点并放弃它尚未确认的编辑？' : '从草稿移除选中的锚点？保存前不会修改文件。')) {
    const target = anchorSelect.value; draft.anchors = draft.anchors.filter(a => a.name !== target); dirty = true;
    if (target === editingName) newAnchor(); renderAnchorList();
  } };
  search.oninput = () => { stopPicking(); fillMeshes(); };
  all.onclick = () => { search.value = ''; fillMeshes(); };
  mesh.onchange = () => { if(!inspector.select(mesh.value)){mesh.value=inspector.selected();return;} stopPicking(); weights.clear(); reference = []; referenceDrawableId = referenceGeneration = ''; pointDirty = true; renderPoints(); };
  name.oninput = () => { pointDirty = true; renderFacts(); };
  character.oninput = () => { if (draft) draft.characterId = character.value; dirty = true; renderFacts(); };
  appearance.oninput = () => { if (draft) draft.modelId = appearance.value; dirty = true; renderFacts(); };
  near.onclick = () => void run(() => { requireLive(); if (pointDirty && !window.confirm('查找附近网格会清除未确认的选点，继续？')) return; stopPicking(); mode = 'near'; options.onPickingStart?.(); modeStatus.textContent = '当前模式：点击人物，查找附近网格'; overlay.style.pointerEvents = 'auto'; say('请点击人物上的目标部位，再从候选列表中确认网格。'); });
  pick.onclick = () => void run(() => {
    const f = requireLive(); if (!mesh.value) throw new Error('请先选择网格。'); stopPicking();
    paused = { model: f.model, previous: f.model.autoUpdate }; f.model.autoUpdate = false;
    // SDK consumes pending ticker delta in _render even after autoUpdate is disabled.
    // Drop only the unrendered delta so the next frame keeps this reference pose.
    (f.model as unknown as { deltaTime: number }).deltaTime = 0;
    referenceDrawableId = mesh.value; referenceGeneration = f.uuid;
    reference = Array.from(f.model.internalModel.getDrawableVertices(mesh.value)); mode = 'points'; options.onPickingStart?.(); overlay.style.pointerEvents = 'auto'; pointDirty = true;
    modeStatus.textContent = '当前模式：人物已暂停，点击黄点选择或取消参考点'; renderFacts();
    say('人物已暂停，当前姿态作为参考。请在黄点上点击选择，再确认锚点。');
  });
  resume.onclick = stopPicking; capture.onclick = () => void run(confirmAnchor);
  play.onclick = () => void run(async () => { const f = requireLive(); stopPicking(); if (!motion.value) throw new Error('没有选中动作'); await options.playMotion(f, motion.value); if (live()) say('动作已开始。请观察绿色中心是否一直位于你定义的部位；工具不会替你判断语义是否正确。'); });
  async function persist() {
    const p = readProfile(); stopPicking(); const f = requireLive();
    let result;
    try { result = await options.client.saveAnchorProfile(p, expectedHash, { signal: options.signal }); }
    catch (error) {
      // A lost response may follow a successful commit. Reconcile this exact ID/content;
      // never blindly repeat a write or generate a second Profile.
      try {
        const read = await options.client.readAnchorProfile(p.modelProfileId, { signal: options.signal });
        if (JSON.stringify(parseLive2DModelProfile(read.profile, '保存结果核对')) !== JSON.stringify(p)) throw error;
        result = { ok: true, profile: p, sha256: read.sha256, conflicts: [] };
      } catch { throw error; }
    }
    if (!result.ok) throw new Error('保存遇到文件所有权冲突，原文件未覆盖：' + (result.conflicts ?? []).join(', '));
    if (disposed) return;
    expectedHash = result.sha256; draft = result.profile; dirty = false;
    await options.saved(result.profile); if (disposed) return;
    renderFacts(); refreshLists(); options.audit('PERSISTED', result.profile.modelProfileId);
    say(`锚点组已保存到本地资料库，可重开或导出。${options.active()?.uuid !== f.uuid ? '人物已切换，未自动应用。' : '点击“用已保存锚点制作附件”可继续。'}`);
  }
  save.onclick = () => void run(persist);
  use.onclick = () => void run(async () => {
    const p = readProfile();
    if (dirty || !expectedHash) throw new Error('请先保存锚点组，再用于附件制作；未保存的新模型配置不会被冒充为资料库中的适配。');
    const anchor = p.anchors.find(a => a.name === anchorSelect.value) ?? p.anchors[0];
    if (!anchor) throw new Error('锚点组没有可应用的锚点，请先创建并保存。');
    stopPicking(); await options.apply(p, anchor.name);
    say(`已将“${anchor.displayName ?? anchor.name}”提供给附件工作台。检查摆放后再保存附件；旧附件文件不会自动改变。`);
  });
  download.onclick = () => void run(() => {
    const p = readProfile(), url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
    const a = node('a'); a.href = url; a.download = exportName(p.modelPath) + '-锚点.json'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); say('已交给浏览器下载 Profile。下载是否保留请检查浏览器；本地资料库不会因此改变。');
  });
  recover.onclick = () => void run(async () => { if (!draft) throw new Error('没有可恢复的草稿。'); await bindProfile(draft, expectedHash, true); say('已核验并恢复同模型草稿，原参考点、权重和技术身份保留。'); });
  backup.onclick = () => void run(() => {
    if (!draft) throw new Error('没有可备份的草稿。');
    const data = { schema: 'webgal-anchor-authoring-draft', schemaVersion: 1, unverified: true, profile: draft,
      editing: { editingName, editingIdentity, name: name.value, reference, referenceDrawableId, weights: [...weights], pointDirty } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = node('a'); a.href = url; a.download = exportName(draft.modelPath) + '-锚点草稿.json'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); say('已交给浏览器下载未验证草稿备份；可通过“从 Profile 文件打开副本”恢复，不是可直接应用的正式 Profile。');
  });
  function exportName(modelPath: string) {
    const model = options.context()?.importedModels?.find(m => m.modelPath.replace(/^(\.\/)+/, '') === modelPath.replace(/^(\.\/)+/, ''));
    return (model ? `${model.displayName}-${model.appearanceName || '立绘'}` : modelPath.split('/').slice(-2, -1)[0] || '当前立绘').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100);
  }
  const beforeUnload = (event: BeforeUnloadEvent) => { if (busy || dirty || pointDirty || inspector.dirty()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  function dispose() { disposed = true; ++epoch; inspector.dispose(); frameRenderer?.off('postrender', draw); frameRenderer = undefined; stopPicking(); overlay.remove(); window.removeEventListener('beforeunload', beforeUnload); }
  options.signal.addEventListener('abort', dispose, { once: true });
  renderFacts(); return { panel, refresh: refreshLists, dispose, requestModelChange, requestExit, stopPicking,
    isBusy: () => busy, hasUnsavedChanges: () => dirty || pointDirty || inspector.dirty() };
}
