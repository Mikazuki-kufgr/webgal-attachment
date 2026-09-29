import {
  modelImportDependencies,
  modelImportPath,
  MODEL_IMPORT_MAX_BYTES,
  MODEL_IMPORT_MAX_FILES,
} from './creatorModelFiles';
import type { CreatorServiceContext, createCreatorProjectClient } from './creatorProject';
import type { Live2DModelProfile } from '../profileTypes';

const errorCopy: Record<string, string> = {
  CREATOR_MODEL_IMPORT_RUNTIME_UNSUPPORTED:
    '这份文件属于 model3.json / Cubism 3+。当前附件公测路线支持 Cubism 2 model.json，暂不能为它导入附件适配。',
  CREATOR_MODEL_IMPORT_OUTSIDE_FOLDER: '模型引用了所选文件夹外的资源。请重新选择同时包含模型和共用资源的上一级文件夹。',
  CREATOR_MODEL_IMPORT_DEPENDENCY_MISSING:
    '模型缺少必要文件。请选取完整模型文件夹；共用动作或表情在上级目录时，请改选上一级。',
  CREATOR_MODEL_IMPORT_TOO_LARGE:
    '这套模型超过导入上限（96 MiB 或 2048 个依赖文件）。请缩小所选范围或使用现有手工模型流程。',
  CREATOR_MODEL_IMPORT_TARGET_CONFLICT:
    '目标游戏中的同一路径已有不同内容，原文件已保留。请先检查两份人物内容，不能直接覆盖。',
  CREATOR_MODEL_IMPORT_PATH_INVALID: '模型含不支持或不安全的文件路径，请检查文件名与引用。',
  CREATOR_MODEL_IMPORT_REFERENCE_INVALID: '模型含绝对路径、网络地址或不支持的引用。请使用所选文件夹内的相对文件路径。',
  CREATOR_MODEL_IMPORT_MODEL_INVALID: '文件不是完整的 Cubism 2 模型入口（需要 model.moc 引用及 textures 列表）。',
  CREATOR_MODEL_IMPORT_RESOURCE_UNSUPPORTED: '模型引用的资源类型不受当前导入流程支持。',
};

export function modelImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/CREATOR_[A-Z0-9_]+/)?.[0] ?? '';
  return `${errorCopy[code] ?? '未能完成导入或复制，请检查下面的错误信息。'}\n${message}`;
}

export async function prepareCreatorModelUpload(files: readonly File[], entryPath: string, displayName: string) {
  const map = new Map<string, File>(),
    folded = new Set<string>();
  for (const file of files) {
    const relative = file.webkitRelativePath;
    // The top folder name is not part of model references or the destination namespace.
    const p = modelImportPath(relative.slice(relative.indexOf('/') + 1));
    if (folded.has(p.toLowerCase())) throw new Error('CREATOR_MODEL_IMPORT_DUPLICATE_PATH');
    folded.add(p.toLowerCase());
    map.set(p, file);
  }
  const entry = map.get(entryPath);
  if (!entry || entry.size > 1024 * 1024) throw new Error('CREATOR_MODEL_IMPORT_MODEL_INVALID');
  const deps = modelImportDependencies(entryPath, JSON.parse((await entry.text()).replace(/^\uFEFF/, '')));
  let total = 0;
  for (const p of deps) {
    const file = map.get(p);
    if (!file) throw new Error(`CREATOR_MODEL_IMPORT_DEPENDENCY_MISSING: ${p}`);
    total += file.size;
  }
  if (total > MODEL_IMPORT_MAX_BYTES || deps.length > MODEL_IMPORT_MAX_FILES)
    throw new Error('CREATOR_MODEL_IMPORT_TOO_LARGE');
  const encoded: Array<{ path: string; base64: string }> = [];
  for (const p of deps) {
    const bytes = new Uint8Array(await map.get(p)!.arrayBuffer());
    const chunks: string[] = [];
    for (let n = 0; n < bytes.length; n += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(n, n + 0x8000)));
    encoded.push({ path: p, base64: btoa(chunks.join('')) });
  }
  return { entryPath, displayName, sourceFolderName: files[0]?.webkitRelativePath.split('/')[0], files: encoded };
}

export function createModelImportPanel(options: {
  client: ReturnType<typeof createCreatorProjectClient>;
  signal: AbortSignal;
  context: () => CreatorServiceContext | undefined;
  selectedTarget: () => { name: string; writable: boolean } | undefined;
  selectedProfile: () => Live2DModelProfile | undefined;
  copyableProfiles: () => readonly Live2DModelProfile[];
  imported: (profiles: Live2DModelProfile[]) => Promise<void>;
  copied: () => Promise<void>;
  notify?: (message: string, tone: boolean | 'warning') => void;
}) {
  const panel = document.createElement('details'),
    title = document.createElement('summary');
  title.textContent = '导入自己的人物模型';
  panel.dataset.creatorRole = 'model-import-panel';
  panel.style.cssText = 'border:1px solid #344a60;border-radius:8px;padding:10px;background:#101a23;min-width:0';
  title.style.cssText = 'color:#a9e5ff;font-weight:600;cursor:pointer;padding:3px 0';
  panel.append(title);
  const help = document.createElement('p');
  help.textContent =
    '① 选择角色文件夹（需包含共用动作/表情，如 .mtn_exp）→ ② 选择一套外观的 model.json → ③ 复制到制作区。选择整个目录是为了找到依赖，本次只导入选中的一套外观；其他衣服需另选入口导入。原模型不改动。';
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.setAttribute('webkitdirectory', '');
  picker.hidden = true;
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.textContent = '选择模型文件夹';
  const entry = document.createElement('select');
  entry.setAttribute('aria-label', '要导入的模型入口');
  const emptyEntry = document.createElement('option'); emptyEntry.value = ''; emptyEntry.textContent = '请先选择模型文件夹'; entry.append(emptyEntry);
  const name = document.createElement('input');
  name.placeholder = '人物显示名称';
  name.setAttribute('aria-label', '导入人物显示名称');
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.textContent = '检查并复制到制作区';
  upload.disabled = true;
  const status = document.createElement('pre');
  status.style.whiteSpace = 'pre-wrap';
  status.setAttribute('aria-live', 'polite');
  const inventory = document.createElement('pre');
  inventory.style.whiteSpace = 'pre-wrap';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制当前人物到游戏';
  const copyHelp = document.createElement('p');
  copyHelp.textContent =
    '当前人物无论是随包提供还是自行导入，都可先复制到上方所选游戏，再添加附件。游戏已有相同人物文件时不会重复写入；同路径内容不同时停止并保留原文件。';
  const steps = document.createElement('div');
  steps.style.cssText = 'display:grid;gap:10px;margin-top:10px;min-width:0';
  help.textContent = '选择完整人物文件夹，再选择其中一套服装的模型。只复制所需文件，原模型保持不变。';
  const row = (label: string, control: HTMLElement) => {
    const wrap = document.createElement('label'); wrap.textContent = label;
    wrap.style.cssText = 'display:grid;gap:5px;min-width:0'; wrap.append(control); return wrap;
  };
  for (const control of [entry, name, choose, upload, copy]) {
    control.style.cssText = 'box-sizing:border-box;min-width:0;max-width:100%;padding:8px;background:#182938;color:#eef;border:1px solid #526070;border-radius:6px;font:inherit';
  }
  for (const text of [help, copyHelp, status, inventory]) text.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:#c4d4e3;font:inherit;min-width:0';
  entry.style.width = name.style.width = '100%';
  status.style.cssText += ';padding:8px;border-left:3px solid #78c9e8;background:#0c141e';
  status.textContent = '尚未选择人物文件夹。当前支持 Cubism 2 的 model.json。';
  const advanced = document.createElement('div');
  advanced.style.cssText = 'display:grid;gap:8px;border-top:1px solid #344a60;padding-top:8px';
  const copyStatus = document.createElement('pre');
  copyStatus.setAttribute('aria-live', 'polite');
  copyStatus.style.cssText = status.style.cssText;
  advanced.dataset.creatorRole = 'copy-model-to-selected-game';
  advanced.append(copyHelp);
  const imported = document.createElement('details'), importedTitle = document.createElement('summary');
  importedTitle.textContent = '已导入人物与模型路径'; imported.append(importedTitle, inventory);
  steps.append(help, row('1. 选择来源', choose), picker, row('2. 选择服装 / 模型入口', entry), row('3. 人物显示名称', name), upload, status, imported);
  panel.append(steps);
  let files: File[] = [],
    scan = 0,
    busy = false;
  const importedEntries = new Set<string>();
  const run = async (operation: () => Promise<void>, operationStatus = status) => {
    if (busy || options.signal.aborted) return;
    busy = true;
    choose.disabled = upload.disabled = copy.disabled = entry.disabled = name.disabled = true;
    try {
      const started = performance.now();
      let polling = false;
      const timer = globalThis.setInterval(() => {
        if (!busy || polling) return;
        polling = true;
        void options.client.modelOperationStatus({signal:options.signal}).then(progress => {
          if (busy && progress.active) operationStatus.textContent = progress.phase + (progress.processed ? '：已完成 '+progress.processed+' 个文件' : '') + '\n已等待 ' + Math.floor((performance.now()-started)/1000) + ' 秒；请勿同时手工复制或重复提交。';
        }).catch(()=>{}).finally(()=>{polling=false;});
      }, 1000);
      try { await operation(); } finally { globalThis.clearInterval(timer); }
    } catch (error) {
      operationStatus.textContent = modelImportError(error);
      options.notify?.(operationStatus.textContent, false);
    } finally {
      busy = false;
      choose.disabled = copy.disabled = entry.disabled = name.disabled = false;
      upload.disabled = !entry.value || importedEntries.has(entry.value);
    }
  };
  choose.onclick = () => {
    picker.value = '';
    picker.click();
  };
  picker.onchange = () => {
    void run(async () => {
      const revision = ++scan;
      files = Array.from(picker.files ?? []);
      entry.replaceChildren();
      importedEntries.clear();
      if (!files.length) return;
      if (files.length > 10000) throw new Error('CREATOR_MODEL_IMPORT_TOO_LARGE');
      status.textContent = '正在查找模型入口…';
      name.value = files[0].webkitRelativePath.split('/')[0];
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '请选择模型入口';
      entry.append(placeholder);
      for (const file of files) {
        if (!/\.json$/i.test(file.name) || file.size > 1024 * 1024) continue;
        try {
          const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
          if (revision !== scan || options.signal.aborted) return;
          if (!raw || (typeof raw.model !== 'string' && !raw.FileReferences)) continue;
          const option = document.createElement('option');
          option.value = file.webkitRelativePath.split('/').slice(1).join('/');
          option.textContent = option.value + (raw.FileReferences ? '（当前附件不支持 model3）' : '');
          entry.append(option);
        } catch {
          /* Resource JSON is not necessarily a model entry. */
        }
      }
      if (entry.options.length === 2) entry.selectedIndex = 1;
      status.textContent =
        entry.options.length > 1
          ? '请选择要导入的人物入口。复制前会检查全部依赖。'
          : '未找到模型入口，请选择包含 model.json 的完整文件夹。';
    });
  };
  entry.onchange = () => {
    upload.disabled = busy || !entry.value || importedEntries.has(entry.value);
    if (importedEntries.has(entry.value))
      status.textContent = '这套外观已经导入，请在上方选择人物并显示。若确实需要独立副本，请重新选择文件夹后导入。';
  };
  upload.onclick = () => {
    void run(async () => {
      status.textContent = '正在检查模型与依赖并复制到制作区…';
      const body = await prepareCreatorModelUpload(files, entry.value, name.value);
      const result = await options.client.importCreatorModel(body, { signal: options.signal });
      importedEntries.add(entry.value);
      await options.imported(result.profiles);
      status.textContent =
        `文件已复制：${result.model.dependencyCount} 个\n${result.model.modelPath}\n` +
        (result.model.profileIds.length
          ? '人物已加入下方角色列表；选择角色和服装后会自动载入。同一模型可能列出多份锚点配置：11锚点语义配置覆盖更多部位，1–3锚点为旧版/专项配置，不是多复制了人物。请优先选择语义配置。该外观已导入，无需再次点击；重新选文件夹再导入会创建独立副本。'
          : '需要锚点：模型已保留，暂时不能制作随动附件。展开第 1 步“锚点制作器”，点击“刷新立绘列表”，在“目标立绘”选择本模型并载入，然后自行点选、命名和保存锚点组，无需 AI。');
      options.notify?.(
        result.model.profileIds.length
          ? '人物导入完成。请在下方选择角色和服装，人物会自动载入。'
          : '人物文件已导入，但缺少跟随锚点，暂时不能制作随动附件。请展开第 1 步“锚点制作器”，点击“刷新立绘列表”，在“目标立绘”选择这套模型并载入，然后新建、点选并保存锚点组。无需重新导入模型。',
        result.model.profileIds.length ? true : 'warning',
      );
      refresh();
    });
  };
  copy.onclick = () => {
    void run(async () => {
      const target = options.selectedTarget(),
        profile = options.selectedProfile();
      const modelPath = profile?.modelPath.replace(/^(\.\/)+/, '');
      const row = options
        .context()
        ?.importedModels?.find((m) => m.modelPath === modelPath);
      // A saved attachment may select its own Profile. Copying the figure still
      // needs an identity in the model library, not that attachment's Profile ID.
      const matchingCopyProfiles = row ? [] : options.copyableProfiles()
        .filter((candidate) => candidate.modelPath.replace(/^(\.\/)+/, '') === modelPath)
        .sort((a, b) => a.modelProfileId.localeCompare(b.modelProfileId));
      const copyProfile = matchingCopyProfiles.find((candidate) => candidate.modelProfileId === profile?.modelProfileId)
        ?? matchingCopyProfiles[0];
      if (!target?.writable || !profile) {
        copyStatus.textContent = '请先载入一个具备锚点的人物，并在上方选择可写入的目标游戏。';
        return;
      }
      if (!row && !copyProfile) {
        copyStatus.textContent = '当前人物没有可复制的模型来源。请先在第 1 步选择完整模型文件夹并导入制作区，再复制到游戏；已保存的附件适配不会被改动。';
        options.notify?.(copyStatus.textContent, 'warning');
        return;
      }
      copyStatus.textContent = `正在复制人物到游戏“${target.name}”…`;
      const result = await options.client.copyCreatorModelToGame(row?.id ?? `profile:${copyProfile!.modelProfileId}`, target.name, { signal: options.signal });
      try {
        await options.copied();
      } catch (error) {
        copyStatus.textContent = `人物文件已在“${target.name}”写入或核对相同，但游戏状态刷新未完成。请刷新游戏列表后检查，勿手工覆盖人物文件。\n${modelImportError(error)}`;
        options.notify?.(copyStatus.textContent, 'warning');
        return;
      }
      copyStatus.textContent = `${result.noOp ? '游戏已具备相同人物文件，无需重复复制。' : `人物已复制到“${target.name}”。`}现在可以添加附件到游戏。\n${row?.modelPath ?? profile!.modelPath.replace(/^(\.\/)+/, '')}`;
    }, copyStatus);
  };
  function refresh() {
    inventory.textContent = (options.context()?.importedModels ?? [])
      .map((m) => `${m.displayName} / ${m.appearanceName ?? m.entryPath.split('/').slice(-2,-1)[0] ?? '自定义外观'} · ${m.profileIds.length ? '已有锚点，视觉待检查' : '需要 Profile'}\n${m.modelPath}`)
      .join('\n');
  }
  options.signal.addEventListener(
    'abort',
    () => {
      scan++;
      files = [];
      picker.value = '';
    },
    { once: true },
  );
  return { element: panel, gameCopyElement: advanced, gameCopyButton: copy, gameCopyStatusElement: copyStatus, refresh };
}

