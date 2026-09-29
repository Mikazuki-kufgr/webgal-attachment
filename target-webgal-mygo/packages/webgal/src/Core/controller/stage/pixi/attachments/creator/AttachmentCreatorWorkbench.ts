import { captureAnonWinterHandBinding, profileForHandBinding } from './creatorHandBinding';
import { parseAttachmentHandBinding, cloneAttachmentHandBinding, type AttachmentHandBinding } from '../handBinding';
import {resolveHandFlipAxis} from '../handLocalFlip';
import * as PIXI from 'pixi.js';
import { readableCreatorPresetId } from './creatorDraft';
import { changeCreatorLayerMode } from './creatorLayerMode';
import { WebGAL } from '@/Core/WebGAL';
import { stopAll } from '@/Core/controller/gamePlay/fastSkip';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { replaceCreatorFigure, cancelCreatorFigureReplacement, waitForCreatorHandRenderer } from './creatorRuntimeHost';
import { writeCreatorPackage, type CreatorDirectoryHandle } from './creatorExport';
import { CreatorRevisionBook } from './creatorRevisionBook';
import { createCreatorViewport } from './creatorViewport';
import { createModelImportPanel } from './creatorModelImportPanel';
import { CreatorNoticeOwnership } from './creatorNoticeOwnership';
import { rekeyCreatorAdaptations } from './creatorDraftIdentity';
import { selectCreatorSavedAdaptation } from './creatorSavedAdaptationSelection';
import type { ActiveLive2DFigureResult } from '@/Core/controller/stage/pixi/PixiController';
import { setVisibility } from '@/store/GUIReducer';
import { webgalStore } from '@/store/store';
import {
  acquireGameAdvanceLock,
  beginGameInputBoundaryGesture,
  cancelGameInputBoundaryGesture,
  finishGameInputBoundaryGesture,
  gameInputBoundaryDiagnostics,
  INPUT_BOUNDARY_ATTRIBUTE,
  releaseGameAdvanceLock,
} from '@/Core/controller/gamePlay/gameInputBoundary';

import type { AttachmentRuntime } from '../AttachmentRuntime';
import { createAnchorAuthoringPanel } from './anchorAuthoringPanel';
import {
  AttachmentProfileLoader,
  parseAttachmentAssetDefinition,
  parseAttachmentPlacementPreset,
  parseLive2DModelProfile,
} from '../profileLoader';
import { compatibleAnchorNames, type AttachmentPlacementPreset, type Live2DModelProfile } from '../profileTypes';
import { creatorCatalogEntry, loadCreatorMotionInventory, loadCreatorProfilesAfter } from './creatorCatalog';
import { CreatorDiagnosticsOverlay, type CreatorDiagnosticsFlags } from './creatorDiagnostics';
import {
  cloneCreatorDraft,
  createBlankCreatorDraft,
  creatorPresetLeaf,
  degreesToRadians,
  draftFromPreset,
  draftFromProjectPreset,
  profileMatchesModelPath,
  radiansToDegrees,
  validateCreatorDraft,
} from './creatorDraft';
import { buildCreatorPackage, type CreatorPackageAdaptation } from './creatorPackageBuilder';
import { adaptationState, attachmentState, ordinarySavedAdaptation } from './creatorAuthoringState';
import { creatorLifecycleScript } from './creatorPackageBuilder';
import {
  createCreatorProjectClient,
  CreatorProjectRequestError,
  projectLayerBytes,
  type CreatorSaveToGameResult,
  type CreatorSavedAttachmentSummary,
  type CreatorSavedAttachmentResult,
  type CreatorServiceContext,
  type Rc1ApplyResult,
  type Rc1ProjectSnapshot,
} from './creatorProject';
import { installCreatorWorkbenchLayout } from './creatorPanelLayout';
import { creatorTargetModelPresentation } from './creatorTargetModelReadiness';
import { creatorSavedAdaptationPresentation } from './creatorSavedAdaptationPresentation';
import { CreatorPreviewAdapter } from './creatorPreviewAdapter';
import { CREATOR_PNG_MAX_TOTAL_BYTES, CreatorPngError, importPngFile, importProjectPngBytes, sha256Bytes } from './pngImport';
import type { CreatorBinaryInput, CreatorDraft, CreatorFigureView, CreatorPackage } from './creatorTypes';
import { cssDeltaToPlacementDelta, type DragCoordinateContext } from './creatorDragCoordinates';
import { CreatorPreviewFlowOwnership } from './creatorPreviewFlowOwnership';
import { parseAttachmentEntityVisualState } from '../stageEntityVisualState';
import { captureCreatorPerformance } from './creatorPerformanceProbe';
import { creatorErrorMessage } from './creatorErrorMessage';
import { creatorAdvancedEffectsActive } from './creatorAdvancedEffects';
import { calibratedSampleProfileId, retargetBuiltinSampleDraft } from './creatorBuiltinSampleTarget';
import { switchCreatorAdaptation } from './creatorAdaptationSwitch';
import { commitCreatorFigureSelection } from './creatorFigureCommit';
import { creatorCharacterOutfits } from './creatorCharacterCatalog';
import { creatorTargetAnchor, creatorTargetProfile } from './creatorFigureSwitchTarget';
import {
  defaultParametersFromDraft,
  defaultParametersFromPreset,
  parseCreatorDefaultParameters,
  applyCreatorDefaultParameters,
} from './creatorDefaultParameters';

declare const __WEBGAL_MVP2B_CREATOR__: boolean;
declare const __WEBGAL_MVP2B_APPROVED_ASSET_ROOT__: string;
declare const __WEBGAL_CREATOR_RELEASE_VERSION__: string;

const ROOT_ID = 'webgal-attachment-creator-workbench';
const AUTO_OPEN = typeof __WEBGAL_MVP2B_CREATOR__ !== 'undefined' && __WEBGAL_MVP2B_CREATOR__;
const PREVIEW_ID = '__mvp2b_creator_preview__';

const CHARACTER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  anon: '千早爱音',
  tomori: '高松灯',
  taki: '椎名立希',
  soyo: '长崎素世',
  rana: '要乐奈',
  sakiko: '丰川祥子',
  mutsumi: '若叶睦',
  uika: '三角初华',
  umiri: '八幡海铃',
  nyamu: '祐天寺若麦',
  mana: '纯田真奈',
});

function characterLabel(characterId: string) {
  const display = CHARACTER_LABELS[characterId.toLowerCase()];
  return display ? `${display}（${characterId}）` : characterId;
}

function defaultProfileLabel(profile: Live2DModelProfile) {
  const kind =
    profile.modelProfileId.startsWith('user-profile-')
      ? `用户自建锚点组${profile.anchors.length === 1 ? ' · ' + anchorLabel(profile.anchors[0]) : ''}`
      : profile.anchors.length >= 8 || profile.modelProfileId.includes('semantic') ? '语义锚点组' : '旧版/专项锚点组';
  return `${characterLabel(profile.characterId)} / ${profile.modelId} · ${profile.anchors.length} 个锚点 · ${kind}`;
}

function anchorLabel(anchor: Live2DModelProfile['anchors'][number]) {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    'left-ear': '耳部 · 画面左侧（角色右耳）',
    'right-ear': '耳部 · 画面右侧（角色左耳）',
    'ear-left': '耳部 · 画面左侧（角色右耳）',
    'ear-right': '耳部 · 画面右侧（角色左耳）',
    'left-eye': '上眼睑 · 画面左侧（旧 ID）',
    'right-eye': '上眼睑 · 画面右侧（旧 ID）',
    'eyelid-upper-left': '上眼睑 · 画面左侧（睫毛/眼影）',
    'eyelid-upper-right': '上眼睑 · 画面右侧（睫毛/眼影）',
    'eye-center-left': '眼球中心 · 画面左侧（随瞳孔）',
    'eye-center-right': '眼球中心 · 画面右侧（随瞳孔）',
    head: '头部 · 主锚点',
    'hair-top': '头发顶部',
    nose: '鼻部',
    mouth: '嘴部',
    chin: '下巴',
  });
  const description = anchor.displayName ?? labels[anchor.name] ?? anchor.name;
  const legacyNote = /^(left|right)-(ear|eye)$/.test(anchor.name) ? ` · 兼容旧 ID：${anchor.name}` : '';
  return `${description}${legacyNote}`;
}

interface CreatorWindow extends Window {
  __WEBGAL_MVP2B_CREATOR_STATE__?: () => unknown;
}

function el<K extends keyof HTMLElementTagNameMap>(name: K, text?: string) {
  const element = document.createElement(name);
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text: string) {
  const result = el('button', text);
  result.type = 'button';
  result.style.cssText =
    'padding:6px 9px;border:1px solid #526070;border-radius:5px;background:#202b38;color:#eef;cursor:pointer';
  return result;
}

function field(labelText: string, type: 'text' | 'number' = 'text') {
  const label = el('label');
  label.style.cssText = 'display:grid;grid-template-columns:142px 1fr;gap:8px;align-items:center';
  const labelNode = el('span', labelText);
  const input = el('input');
  input.type = type;
  input.setAttribute('aria-label', labelText);
  input.style.cssText = 'min-width:0;padding:4px;background:#111923;color:#eef;border:1px solid #526070';
  label.append(labelNode, input);
  return { label, input };
}

function selectField(labelText: string) {
  const label = el('label');
  label.style.cssText = 'display:grid;grid-template-columns:142px 1fr;gap:8px;align-items:center';
  const labelNode = el('span', labelText);
  const select = el('select');
  select.setAttribute('aria-label', labelText);
  select.style.cssText = 'min-width:0;padding:4px;background:#111923;color:#eef;border:1px solid #526070';
  label.append(labelNode, select);
  return { label, select };
}

function section(title: string) {
  const root = el('section');
  root.style.cssText = 'display:grid;gap:7px;padding:9px;border:1px solid #3c4858;border-radius:7px';
  const heading = el('h3', title);
  heading.style.cssText = 'color:#8ee8ff;font-size:14px;margin:0';
  root.append(heading);
  return root;
}

function disclosure(summaryText: string, ...children: Node[]) {
  const details = el('details');
  details.style.cssText = 'border:1px solid #3c4858;border-radius:7px;background:#0b1119;overflow:hidden';
  const summary = el('summary', summaryText);
  summary.style.cssText =
    'cursor:pointer;padding:9px 10px;color:#bce6ff;font-weight:650;user-select:none;list-style-position:inside';
  const content = el('div');
  content.style.cssText = 'display:grid;gap:7px;padding:0 10px 10px';
  content.append(...children);
  details.append(summary, content);
  return details;
}

function replaceSectionContents(root: HTMLElement, title: string, ...children: Node[]) {
  const heading = el('h3', title);
  heading.style.cssText = 'color:#8ee8ff;font-size:14px;margin:0';
  root.replaceChildren(heading, ...children);
}

function helperText(text: string) {
  const result = el('div', text);
  result.style.cssText = 'color:#c7d2df;line-height:1.5';
  return result;
}

const errorMessage = creatorErrorMessage;

function readyFigure(result: ActiveLive2DFigureResult) {
  return result.status === 'ready' ? result.figure : undefined;
}

export function installAttachmentCreatorWorkbench(runtime: AttachmentRuntime) {
  function importedFor(profile: Live2DModelProfile) {
    return serviceContext?.importedModels?.find(m => m.modelPath === profile.modelPath.replace(/^(\.\/)+/, ''));
  }
  function profileLabel(profile: Live2DModelProfile) {
    const imported = importedFor(profile);
    return imported ? imported.displayName + ' / ' + (imported.appearanceName || imported.entryPath.split('/').slice(-2,-1)[0] || '自定义外观') + ' · ' + profile.anchors.length + ' 个锚点' : defaultProfileLabel(profile);
  }
  if (!AUTO_OPEN || document.getElementById(ROOT_ID)) return () => {};
  let destroyed = false;
  const lifetime = new AbortController();
  const client = createCreatorProjectClient();
  const {
    applyRc1ProjectPackage,
    acceptCreatorSavedAttachmentChanges,
    checkCreatorTargetModel,
    ensureCreatorPreview,
    loadCreatorSavedAttachment,
    loadCreatorFactorySample,
    loadCreatorServiceContext,
    loadCreatorTargetProjects,
    loadCreatorAuthoringAttachments,
    loadCreatorProjectAttachments,
    openRc1Project,
    recordCreatorOperation,
    saveCreatorPackageToGame,
    saveCreatorPackageLocally,
    shutdownCreatorService,
  } = client;
  const revisions = new CreatorRevisionBook();
  let serviceContextRevision = 0;
  let targetModelCheckRevision = 0;
  let targetModelCheck:
    | { key: string; state: 'checking' | 'ready' | 'warning' | 'failed'; message: string }
    | undefined;
  let copyFeedbackTimer: number | undefined;
  const root = el('aside');
  root.id = ROOT_ID;
  root.dataset.mvp2b = 'attachment-creator';
  root.setAttribute(INPUT_BOUNDARY_ATTRIBUTE, 'attachment-creator');
  const creatorSessionId =
    globalThis.crypto?.randomUUID?.() ?? `creator-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const gameAdvanceLockOwner = `attachment-creator-workbench:${creatorSessionId}`;
  const audit = (type: string, target?: string, result?: string, detail?: string, durationMs?: number) =>
    recordCreatorOperation({ sessionId: creatorSessionId, type, target, result, detail, durationMs });
  root.style.cssText =
    'position:fixed;right:0;top:0;z-index:2147483646;width:50vw;max-width:none;height:100vh;overflow:auto;' +
    'box-sizing:border-box;padding:12px;background:rgba(10,15,22,.98);color:#eef;font:13px/1.42 system-ui;' +
    'box-shadow:-8px 0 24px #0008;display:grid;grid-auto-rows:max-content;align-content:start;gap:9px';
  const title = el('h2', '附件制作器');
  title.style.cssText = 'margin:0;color:#fff;font-size:20px';
  const releaseBadge = el('span', `当前 release：${__WEBGAL_CREATOR_RELEASE_VERSION__}`);
  releaseBadge.dataset.creatorRole = 'release-version';
  releaseBadge.style.cssText = 'color:#9de8ff;font-weight:600';
  const intro = el(
    'div',
    '按顺序操作：选角色和服装 → 载入附件或图片 → 调整 → 保存附件。需要在游戏使用时，再单独添加到游戏。',
  );
  intro.dataset.creatorRole = 'flow-guide';
  intro.style.cssText = 'color:#dbe8f7;padding:8px 10px;border-radius:7px;background:#142235;border:1px solid #34526f';

  const notification = el('section');
  notification.id = 'webgal-creator-global-notification';
  notification.dataset.creatorRole = 'global-notification';
  notification.setAttribute(INPUT_BOUNDARY_ATTRIBUTE, 'attachment-creator-notification');
  notification.hidden = true;
  notification.style.cssText =
    'position:fixed;z-index:2147483647;left:75%;top:14px;transform:translateX(-50%);' +
    'width:calc(50vw - 24px);box-sizing:border-box;padding:10px 12px;border-radius:10px;' +
    'background:#102219;color:#f4fff7;border:1px solid #4fba7c;box-shadow:0 14px 38px #000b;' +
    'font:14px/1.45 system-ui;pointer-events:auto';
  const notificationHead = el('div');
  notificationHead.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center';
  const notificationIcon = el('strong', '✓');
  notificationIcon.style.cssText = 'font-size:18px;color:#86efac';
  const notificationMessage = el('div', '准备就绪');
  notificationMessage.dataset.creatorRole = 'global-notification-message';
  notificationMessage.style.cssText = 'font-weight:650;overflow-wrap:anywhere';
  const notificationClose = button('关闭');
  notificationClose.dataset.creatorRole = 'global-notification-close';
  notificationClose.style.padding = '3px 7px';
  notificationHead.append(notificationIcon, notificationMessage, notificationClose);
  const notificationDetails = el('details');
  notificationDetails.style.marginTop = '6px';
  const notificationDetailsSummary = el('summary', '查看完整详情');
  notificationDetailsSummary.style.cssText = 'cursor:pointer;color:#bce6ff';
  const notificationDetailsText = el('pre');
  notificationDetailsText.dataset.creatorRole = 'global-notification-details';
  notificationDetailsText.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;margin:6px 0 0;padding:8px;' +
    'background:#08100d;border-radius:6px;user-select:text';
  notificationDetails.append(notificationDetailsSummary, notificationDetailsText);
  notification.append(notificationHead, notificationDetails);
  document.body.append(notification);

  const status = el('pre', '初始化…');
  status.dataset.creatorRole = 'status';
  status.tabIndex = 0;
  status.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;cursor:text;margin:0;padding:8px;' +
    'background:#0b1119;border:1px solid #526070;min-height:72px;height:96px;max-height:420px;' +
    'overflow:auto;resize:vertical;box-sizing:border-box';
  const copyErrorButton = button('复制完整错误');
  copyErrorButton.dataset.creatorRole = 'copy-full-error';
  copyErrorButton.hidden = true;
  const resetPanelSizesButton = button('重置全部面板');
  resetPanelSizesButton.dataset.creatorRole = 'reset-panel-sizes';
  const resetWorkbenchButton = button('重置右侧主面板');
  resetWorkbenchButton.dataset.creatorRole = 'reset-workbench-panel';
  resetWorkbenchButton.title = '只恢复右侧 Creator 主工作台宽度';
  const resetStatusButton = button('重置顶部状态区');
  resetStatusButton.dataset.creatorRole = 'reset-status-panel';
  resetStatusButton.title = '只恢复顶部状态与错误区域高度';
  const statusActions = el('div');
  statusActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  const stopServiceButton = button('停止本制作器服务');
  stopServiceButton.dataset.creatorRole = 'stop-service';
  statusActions.append(
    copyErrorButton,
    resetWorkbenchButton,
    resetStatusButton,
    resetPanelSizesButton,
    stopServiceButton,
  );
  let lastFullError = '';
  const statusHistory: string[] = [];
  type StatusTone = boolean | 'info' | 'warning';
  const statusOwner = new CreatorNoticeOwnership();
  const setStatus = (message: string, tone: StatusTone = true, owner?: string) => {
    if (destroyed) return;
    statusOwner.publish(owner);
    const kind = tone === false ? 'error' : tone === true ? 'success' : tone;
    const normalized = message.trim() || (kind === 'error' ? '操作失败。' : '操作已完成。');
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const concise = lines.find((line) => !/^[A-Z0-9_:-]+$/.test(line)) ?? lines[0] ?? normalized;
    const timestamp = new Date().toLocaleTimeString();
    const labels = { success: '成功', error: '失败', info: '进行中', warning: '请注意' } as const;
    const colors = {
      success: { border: '#4fba7c', background: '#102219', icon: '✓', iconColor: '#86efac' },
      error: { border: '#e86d6d', background: '#2a1114', icon: '!', iconColor: '#ff9da7' },
      info: { border: '#63a8ff', background: '#102138', icon: 'i', iconColor: '#9dc9ff' },
      warning: { border: '#d89b4d', background: '#2b2110', icon: '!', iconColor: '#ffd38a' },
    } as const;
    const palette = colors[kind];
    statusHistory.unshift(`[${timestamp}] ${labels[kind]}\n${normalized}`);
    if (statusHistory.length > 20) statusHistory.length = 20;
    status.textContent = statusHistory.join('\n\n');
    status.title = normalized;
    status.style.borderColor = palette.border;
    status.style.background = palette.background;
    lastFullError = kind === 'error' ? normalized : '';
    copyErrorButton.hidden = kind !== 'error';
    notification.hidden = false;
    notification.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    notification.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    notification.dataset.creatorNotificationTone = kind;
    notification.style.borderColor = palette.border;
    notification.style.background = palette.background;
    notificationIcon.textContent = palette.icon;
    notificationIcon.style.color = palette.iconColor;
    notificationMessage.textContent = concise;
    notificationDetailsText.textContent = normalized;
    notificationDetails.hidden = lines.length <= 1;
    notificationDetails.open = false;
    audit('status', concise, kind, normalized);
  };
  notificationClose.onclick = () => {
    notification.hidden = true;
  };
  copyErrorButton.onclick = async () => {
    if (!lastFullError) return;
    try {
      await navigator.clipboard.writeText(lastFullError);
      if (destroyed) return;
      copyErrorButton.textContent = '完整错误已复制';
      window.clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = window.setTimeout(() => {
        if (!destroyed) copyErrorButton.textContent = '复制完整错误';
      }, 1200);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(status);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  };

  const profileLoader = new AttachmentProfileLoader();
  const preview = new CreatorPreviewAdapter(runtime);
  const diagnostics = new CreatorDiagnosticsOverlay(runtime);
  let profiles = new Map<string, Live2DModelProfile>();
  let copyableLibraryProfiles = new Map<string, Live2DModelProfile>();
  let editingProfile: Live2DModelProfile | undefined;
  let figures: CreatorFigureView[] = [];
  let draft = createBlankCreatorDraft();
  let initialDraft = cloneCreatorDraft(draft);
  let attachmentDefaults: ReturnType<typeof defaultParametersFromDraft> | undefined;
  let packageCreatedAt = new Date().toISOString();
  let adaptationBaseline = adaptationState(draft);
  let adaptationConfirmed = false;
  let savedState = '';
  let pendingSave: { built: CreatorPackage; fork: boolean; liveState: string } | undefined;
  const pendingAdaptationDrafts = new Map<string, CreatorDraft>();
  let binaries: { back?: CreatorBinaryInput; front?: CreatorBinaryInput } = {};
  let retainedAdaptations: CreatorPackageAdaptation[] = [];
  let initialBinaries = { ...binaries };
  let initialAdaptations: CreatorPackageAdaptation[] = [];
  let initialDefaults = attachmentDefaults;
  let initialProfile: Live2DModelProfile | undefined;
  function rememberDraftBaseline() {
    initialDraft = cloneCreatorDraft(draft);
    initialBinaries = { ...binaries };
    initialAdaptations = structuredClone(retainedAdaptations);
    initialDefaults = structuredClone(attachmentDefaults);
    initialProfile = editingProfile;
    savedState = attachmentState(draft, retainedAdaptations, attachmentDefaults);
    adaptationBaseline = adaptationState(draft);
  }
  function attachmentDirty() {
    const hasContent = binaries.front || binaries.back || initialBinaries.front || initialBinaries.back ||
      draft.displayName !== initialDraft.displayName || draft.slot !== initialDraft.slot;
    return Boolean(pendingSave) || Boolean(hasContent && attachmentState(draft, retainedAdaptations, attachmentDefaults) !== savedState);
  }
  function requestAttachmentReplace() {
    if (pendingSave) { setStatus('上次保存结果尚未确认，请先点击“核对未确认的保存”。', 'warning'); return false; }
    return !attachmentDirty() || window.confirm('附件有未保存的修改。放弃这些修改并继续？取消可返回保存。');
  }
  let packageResult: CreatorPackage | undefined;
  let exportRevision = 0;
  let packageRevision = -1;
  let canonicalExportJson = '';
  let projectSnapshot: Rc1ProjectSnapshot | undefined;
  let lastApplyResult: Rc1ApplyResult | undefined;
  let serviceContext: CreatorServiceContext | undefined;
  let lastGameSave: CreatorSaveToGameResult | undefined;
  let projectDirty = false;
  let libraryFigureSwitchRevision = 0;
  let libraryFigureSwitchInProgress = false;
  let queuedLibraryProfileId = '';
  let queuedLibraryDiscardApproved = false;
  const previewFlow = new CreatorPreviewFlowOwnership(
    () => preview.invalidatePending(),
    () => !destroyed,
  );

  const projectSection = section('制作区的上次保存');
  const openProjectButton = button('读取制作区保存记录');
  const loadProjectPresetButton = button('继续编辑上次保存的附件');
  loadProjectPresetButton.disabled = true;
  const projectActions = el('div');
  projectActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  projectActions.append(openProjectButton, loadProjectPresetButton);
  const projectFacts = el(
    'pre',
    '尚未读取制作区保存记录。\n普通用户不需要操作这里；直接在第 4 步保存附件，第 5 步按需添加到游戏即可。',
  );
  projectFacts.dataset.creatorRole = 'project-facts';
  projectFacts.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;margin:0;padding:8px;background:#0b1119;border:1px solid #d89b4d;color:#dbe8f7;max-height:320px;overflow:auto';
  projectSection.append(projectActions, projectFacts);

  const storageFacts = el('div', '正在读取项目、附件与人物资料…');
  storageFacts.dataset.creatorRole = 'storage-paths';
  storageFacts.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;padding:9px 10px;border-radius:7px;' +
    'background:#102219;border:1px solid #3f8f63;color:#dffbea;user-select:text';
  const tutorialDetails = disclosure(
    '第一次使用：点这里查看完整步骤',
    helperText(
      '1. 先选择角色，再选择该角色的服装/立绘，人物会自动载入；“载入所选立绘”可用于重试。没有本地资源时，展开导入区，选择包含模型及依赖的完整目录。',
    ),
    helperText('2. 点击下方样例可以直接试用；制作自己的附件就选择 PNG。原图片不会被移动或删除。'),
    helperText('3. 在画面里拖动附件，或者填写位置、大小和旋转。可以播放人物动作检查跟随。'),
    helperText(
      '4. 点击“保存附件”，将图片和全部立绘参数保存在制作器资料库；不需要选择游戏。需要独立副本时点“另存为新附件”。',
    ),
    helperText(
      '5. 按需选择游戏，缺少人物时先复制人物，再点“添加 / 更新到这个游戏”。结果会给出附件目录与独立验证剧情，原剧情不变。',
    ),
  );
  tutorialDetails.open = true;

  const targetProjectField = selectField('添加到哪个游戏');
  targetProjectField.label.dataset.creatorRole = 'target-game-field';
  const targetSavePath = el('div', '正在查找可以保存的游戏…');
  targetSavePath.dataset.creatorRole = 'target-save-path';
  targetSavePath.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;border-radius:6px;background:#111923;color:#dbe8f7';
  const refreshStorageButton = button('重新读取游戏列表');
  const savedAttachmentField = selectField('打开原附件，新增人物或锚点');
  const savedAdaptationField = selectField('编辑哪一套适配');
  const loadSavedAttachmentButton = button('载入附件（用于当前立绘）');
  const loadExactAdaptationButton = button('原样编辑所选适配（切换到其立绘）');
  const savedAttachmentRow = el('div');
  savedAttachmentRow.style.cssText =
    'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:7px;align-items:center';
  savedAttachmentRow.append(savedAttachmentField.label, loadSavedAttachmentButton);
  savedAttachmentRow.append(savedAdaptationField.label);
  const exactAdaptationDetails = disclosure(
    '高级：原样编辑指定适配',
    loadExactAdaptationButton,
  );

  const targetSection = section('1. 选择角色、外观与锚点');
  const figureField = selectField('当前舞台人物');
  const profileField = selectField('人物外观 / 锚点组');
  const anchorField = selectField('附件跟随位置');
  const characterField = selectField('角色');
  characterField.select.dataset.creatorRole = 'character-select';
  const libraryProfileField = selectField('服装 / 立绘');
  libraryProfileField.select.dataset.creatorRole = 'outfit-select';
  const modelLocation = helperText('先选择角色，再选择该角色的服装。');
  modelLocation.dataset.creatorRole = 'model-location';
  const showLibraryProfileButton = button('重新载入所选立绘');
  showLibraryProfileButton.dataset.creatorRole = 'load-figure';

  const refreshFiguresButton = button('刷新活动 figure');
  const targetFacts = el('pre');
  targetFacts.dataset.creatorRole = 'target-facts';
  targetFacts.style.cssText = 'white-space:pre-wrap;margin:0;color:#bce6ff';
  const targetGuidance = el('div', '正在读取活动 figure…');
  targetGuidance.dataset.creatorRole = 'target-guidance';
  targetGuidance.style.cssText =
    'padding:7px;border-radius:5px;background:#141d28;color:#dbe8f7;border:1px solid #526070';
  const profileGuidance = helperText(
    '先在普通区域明确选择本地人物与外观并显示，再选择该人物的外观锚点组。新版语义锚点组含 11 个位置（含上眼睑与眼球中心）；旧版专项锚点组可能只有 1–3 个位置。左右均以画面方向显示，并同时注明角色自身方向。',
  );
  const targetActions = el('div');
  targetActions.style.display = 'flex';
  targetActions.style.gap = '6px';
  targetActions.append(refreshFiguresButton);
  targetSection.append(
    targetGuidance,
    profileGuidance,
    figureField.label,
    profileField.label,
    anchorField.label,
    libraryProfileField.label,
    showLibraryProfileButton,
    targetActions,
    targetFacts,
  );

  const newDraftButton = button('从图片新建附件（新身份）');
  const saveAsNewDraftButton = button('另存为新附件（生成新技术 ID）');
  saveAsNewDraftButton.title = '保留当前图片、位置和显示名称，但生成一套不会覆盖原附件的稳定技术 ID';
  const copyPresetButton = button('从当前 approved/candidate preset 载入为副本');
  const resetDraftButton = button('恢复载入时 placement');
  resetDraftButton.title = '恢复本次新建或载入 preset 时的全部初始参数';
  const clearDraftButton = button('清空草稿与预览');
  const draftActions = el('div');
  draftActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  draftActions.append(newDraftButton, saveAsNewDraftButton, copyPresetButton, resetDraftButton, clearDraftButton);
  const assetId = field('图片资源技术 ID（共享图片定义）');
  const presetId = field('配置 ID（剧情引用；高级）');
  const displayName = field('附件显示名称（列表中看到的名字）');
  const instanceId = field('剧情实例默认 ID');
  const slot = field('附件槽位');
  const layerMode = selectField('图片放在人物哪里');
  for (const [value, text] of [
    ['front-only', '单张图片 · 人物前面（常用）'],
    ['back-only', '单张图片 · 人物后面'],
    ['both', '两张图片 · 人物夹在中间'],
  ]) {
    const option = el('option', text);
    option.value = value;
    layerMode.select.append(option);
  }
  const pngSection = section('3. 选择 PNG（新建附件；编辑已有附件时可替换图片）');
  const approvedPath = el(
    'div',
    `已批准草帽参考路径：${
      typeof __WEBGAL_MVP2B_APPROVED_ASSET_ROOT__ === 'undefined'
        ? 'public/game/attachments/sakiko-straw-hat'
        : __WEBGAL_MVP2B_APPROVED_ASSET_ROOT__
    }`,
  );
  approvedPath.style.color = '#ffe09a';
  const previewResourceFacts = el('div', '预览资源：当前草稿尚未引用仓库 PNG。');
  previewResourceFacts.dataset.creatorRole = 'preview-resource-state';
  previewResourceFacts.style.cssText = 'white-space:pre-wrap;color:#bce6ff';
  const exportMaterialFacts = el('div', '导出素材：back 未明确选择；front 未明确选择。导出预览将在选择后启用。');
  exportMaterialFacts.dataset.creatorRole = 'export-material-state';
  exportMaterialFacts.style.cssText = 'white-space:pre-wrap;color:#ffe09a';
  const layerSelectionSummary = el('div', '尚未选择附件图片。');
  layerSelectionSummary.dataset.creatorRole = 'layer-selection-summary';
  layerSelectionSummary.style.cssText = 'padding:7px 9px;border-radius:6px;background:#111923;color:#c7d2df';
  const backInput = el('input');
  backInput.type = 'file';
  backInput.accept = '.png,image/png';
  backInput.setAttribute('aria-label', '选择 back PNG');
  const frontInput = el('input');
  frontInput.type = 'file';
  frontInput.accept = '.png,image/png';
  frontInput.setAttribute('aria-label', '选择 front PNG');
  const clearBack = button('清除');
  const clearFront = button('清除');
  const chooseBack = button('选择或替换图片');
  const chooseFront = button('选择或替换图片');
  chooseBack.onclick = () => backInput.click();
  chooseFront.onclick = () => frontInput.click();
  backInput.hidden = true;
  frontInput.hidden = true;
  const backFacts = el('pre', 'back: 未选择');
  const frontFacts = el('pre', 'front: 未选择');
  for (const item of [backFacts, frontFacts]) item.style.cssText = 'white-space:pre-wrap;margin:0;color:#c8d4df';
  const backRow = el('div');
  backRow.style.cssText = 'display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:6px;align-items:center';
  backRow.append(el('strong', '后层图片'), chooseBack, clearBack, backInput);
  const frontRow = el('div');
  frontRow.style.cssText = 'display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:6px;align-items:center';
  frontRow.append(el('strong', '前层图片'), chooseFront, clearFront, frontInput);
  const updateLayerRows = () => {
    const mode = layerMode.select.value as CreatorDraft['layerMode'];
    backRow.style.display = mode === 'front-only' ? 'none' : 'grid';
    frontRow.style.display = mode === 'back-only' ? 'none' : 'grid';
  };
  pngSection.append(approvedPath, previewResourceFacts, exportMaterialFacts, backRow, backFacts, frontRow, frontFacts);

  const placementSection = section('4. 实时 placement 与画布拖动');
  const offsetX = field('水平位置', 'number');
  const offsetY = field('垂直位置', 'number');
  const localScaleX = field('水平大小 X', 'number');
  const localScaleY = field('垂直大小 Y', 'number');
  const rotationDeg = field('旋转角度', 'number');
  const skewXDeg = field('水平斜切 X', 'number');
  const skewYDeg = field('垂直斜切 Y', 'number');
  const opacity = field('透明度', 'number');
  const blurAmount = field('模糊度', 'number');
  const brightness = field('亮度', 'number');
  const contrast = field('对比度', 'number');
  const saturation = field('饱和度', 'number');
  const gamma = field('伽马', 'number');
  const colorRed = field('色调 R', 'number');
  const colorGreen = field('色调 G', 'number');
  const colorBlue = field('色调 B', 'number');
  const bevelStrength = field('倒角强度', 'number');
  const bevelThickness = field('倒角厚度', 'number');
  const bevelRotation = field('倒角角度', 'number');
  const bevelSoftness = field('倒角柔和度', 'number');
  const bevelRed = field('倒角 R', 'number');
  const bevelGreen = field('倒角 G', 'number');
  const bevelBlue = field('倒角 B', 'number');
  const bloomStrength = field('辉光强度', 'number');
  const bloomBrightness = field('辉光亮度', 'number');
  const bloomBlur = field('辉光模糊', 'number');
  const bloomThreshold = field('辉光阈值', 'number');
  const shockwave = field('冲击波相位', 'number');
  const radiusAlpha = field('径向透明半径', 'number');
  const pivotX = field('pivot X', 'number');
  const pivotY = field('pivot Y', 'number');
  const advancedEffectsEnabled = el('input');
  advancedEffectsEnabled.type = 'checkbox';
  advancedEffectsEnabled.checked = false;
  advancedEffectsEnabled.dataset.creatorRole = 'advanced-effects-enabled';
  const advancedEffectsToggle = el('label');
  advancedEffectsToggle.style.cssText =
    'display:flex;align-items:center;gap:7px;padding:9px;border:1px solid #3c4858;border-radius:7px;background:#111923;color:#ffe09a';
  advancedEffectsToggle.append(
    advancedEffectsEnabled,
    document.createTextNode('启用高级画面效果（斜切、色彩、模糊与滤镜）'),
  );
  const decimalFields = [
    offsetX,
    offsetY,
    localScaleX,
    localScaleY,
    rotationDeg,
    skewXDeg,
    skewYDeg,
    pivotX,
    pivotY,
    opacity,
    blurAmount,
    brightness,
    contrast,
    saturation,
    gamma,
    bevelStrength,
    bevelThickness,
    bevelRotation,
    bevelSoftness,
    bloomStrength,
    bloomBrightness,
    bloomBlur,
    bloomThreshold,
    shockwave,
    radiusAlpha,
  ];
  for (const item of decimalFields) item.input.step = '0.01';
  for (const item of [colorRed, colorGreen, colorBlue, bevelRed, bevelGreen, bevelBlue]) {
    item.input.step = '1';
    item.input.min = '0';
    item.input.max = '255';
  }
  opacity.input.min = '0';
  opacity.input.max = '1';
  for (const item of [localScaleX, localScaleY, gamma]) item.input.min = '0.01';
  for (const item of [
    blurAmount,
    brightness,
    contrast,
    saturation,
    bevelStrength,
    bevelThickness,
    bevelSoftness,
    bloomStrength,
    bloomBrightness,
    bloomBlur,
    bloomThreshold,
  ])
    item.input.min = '0';
  const scaleMode = selectField('scale mode');
  for (const value of ['fixed', 'uniform']) {
    const option = el('option', value);
    option.value = value;
    scaleMode.select.append(option);
  }
  const startPreview = button('启动 / 刷新 shared-runtime 预览');
  const toggleDrag = button('开启画布拖动');
  const previewHide = button('隐藏预览');
  const previewShow = button('显示预览');
  const previewDelete = button('删除预览');
  const resetPlacement = button('恢复默认参数');
  resetPlacement.title = '位置 0,0 / 大小 X,Y=1 / 旋转与斜切 0 / 透明度 1 / 色彩与滤镜默认';
  const placementActions = el('div');
  placementActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  placementActions.append(startPreview, toggleDrag, previewHide, previewShow, previewDelete, resetPlacement);
  const previewFacts = el('pre');
  previewFacts.dataset.creatorRole = 'preview-diagnostics';
  previewFacts.style.cssText = 'white-space:pre-wrap;margin:0;color:#aef3ff';
  placementSection.append(
    placementActions,
    offsetX.label,
    offsetY.label,
    localScaleX.label,
    localScaleY.label,
    rotationDeg.label,
    skewXDeg.label,
    skewYDeg.label,
    opacity.label,
    blurAmount.label,
    brightness.label,
    contrast.label,
    saturation.label,
    gamma.label,
    colorRed.label,
    colorGreen.label,
    colorBlue.label,
    pivotX.label,
    pivotY.label,
    scaleMode.label,
    previewFacts,
  );

  const debugSection = section('5. 调试显示与 motion');
  const debugFlags: Record<keyof CreatorDiagnosticsFlags, HTMLInputElement> = {} as Record<
    keyof CreatorDiagnosticsFlags,
    HTMLInputElement
  >;
  const debugRow = el('div');
  debugRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  for (const [key, text] of [
    ['anchor', 'selected anchor'],
    ['vertices', 'anchor vertices'],
    ['axes', '局部坐标轴'],
    ['pivot', 'sprite pivot'],
    ['bounds', 'attachment bounds'],
  ] as const) {
    const label = el('label');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = false;
    debugFlags[key] = input;
    label.append(input, document.createTextNode(` ${text}`));
    debugRow.append(label);
  }
  const motion = selectField('选择人物动作');
  const playMotion = button('播放动作');
  const idleMotion = button('回到待机动作');
  const motionStatus = el('div', '尚未播放动作。');
  motionStatus.dataset.creatorRole = 'motion-status';
  motionStatus.style.cssText = 'white-space:pre-wrap;margin:0;color:#c8d4df';
  const motionActions = el('div');
  motionActions.style.cssText = 'display:flex;gap:6px';
  motionActions.append(playMotion, idleMotion);
  debugSection.append(debugRow, motion.label, motionActions, motionStatus);

  const performanceMeasureButton = button('测量当前状态 10 秒');
  performanceMeasureButton.dataset.creatorRole = 'performance-measure';
  const performanceResult = el('pre', '尚未测量。先保持页面可见，并关闭辅助线和高级效果。');
  performanceResult.dataset.creatorRole = 'performance-result';
  performanceResult.dataset.webgalTextViewer = 'true';
  performanceResult.tabIndex = 0;
  performanceResult.style.cssText =
    'white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-height:360px;overflow:auto;' +
    'padding:8px;background:#090e15;color:#b8ffc9;user-select:text';

  // Package round-trip details remain internal to the normal "保存到这个游戏"
  // transaction. There is deliberately no second custom-directory export UI.
  const exportSummary = el('pre', 'ROUND-TRIP：尚未生成');
  exportSummary.dataset.creatorRole = 'export-summary';
  exportSummary.style.cssText = 'white-space:pre-wrap;margin:0;color:#b8ffc9';
  const exportPreview = el('pre', '尚未生成导出计划');
  exportPreview.dataset.creatorRole = 'export-preview';
  exportPreview.dataset.webgalTextViewer = 'true';
  exportPreview.tabIndex = 0;
  exportPreview.style.cssText =
    'white-space:pre;margin:0;min-height:96px;max-height:520px;overflow:auto;resize:vertical;background:#090e15;padding:8px;user-select:text;cursor:text;box-sizing:border-box;width:100%';
  const applySection = section('7. 保存到游戏');
  const saveApplyButton = button('添加 / 更新到这个游戏');
  const saveLocalButton = button('保存附件');
  saveLocalButton.dataset.creatorRole = 'save-local';
  const exportFolderButton = button('导出完整附件文件夹');
  const exportLocationSummary = helperText('导出后会在此保留所选目录名称和附件子文件夹。');
  exportLocationSummary.dataset.creatorRole = 'export-location';
  const localSaveSummary = helperText('保存到制作器本地资料库，无需选择游戏。');
  localSaveSummary.dataset.creatorRole = 'local-save-summary';
  const localSaveSection = section('4. 保存附件');
  const openPreviewButton = button('打开刚保存的预览');
  const copyScriptButton = button('复制调用语句');
  openPreviewButton.disabled = true;
  openPreviewButton.hidden = true;
  copyScriptButton.disabled = true;
  const applyActions = el('div');
  applyActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  applyActions.append(saveApplyButton, openPreviewButton, copyScriptButton);
  const applySummary = el('div', '选择游戏后，点“添加 / 更新到这个游戏”。本地保存使用上方“保存附件”。');
  const testSceneHint = helperText('添加成功后会自动生成独立测试剧情，不会修改你的正式剧情。');
  testSceneHint.dataset.creatorRole = 'test-scene-hint';
  applySummary.dataset.creatorRole = 'apply-summary';
  applySummary.style.cssText = 'white-space:pre-wrap;margin:0;color:#b8ffc9';
  const scriptPreview = el('pre', '正式脚本将在载入配置后显示。');
  scriptPreview.dataset.creatorRole = 'script-preview';
  scriptPreview.dataset.webgalTextViewer = 'true';
  scriptPreview.tabIndex = 0;
  scriptPreview.style.cssText =
    'white-space:pre;margin:0;min-height:96px;max-height:420px;overflow:auto;resize:vertical;background:#090e15;padding:8px;user-select:text;cursor:text;box-sizing:border-box;width:100%';
  applySection.append(applyActions, applySummary, scriptPreview);

  const quickStartActions = el('div');
  quickStartActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px';
  copyPresetButton.textContent = '试用草帽（前后两层）';
  const kemomimiSampleButton = button('试用兽耳（单张图片）');
  const haloSampleButton = button('试用光环（单张图片）');
  const flowerSampleButton = button('试用花朵（单张图片）');
  const roseSampleButton = button('试用玫瑰（嘴部）');
  newDraftButton.textContent = '制作自己的附件';
  quickStartActions.append(
    copyPresetButton,
    kemomimiSampleButton,
    haloSampleButton,
    flowerSampleButton,
    roseSampleButton,
  );
  const newDraftActions = el('div');
  newDraftActions.style.cssText = 'display:grid;grid-template-columns:1fr;margin-top:8px';
  newDraftButton.style.width = '100%';
  newDraftActions.append(newDraftButton);
  const projectDetails = disclosure(
    '技术信息：制作区文件与上次配置',
    refreshStorageButton,
    projectActions,
    projectFacts,
  );
  const manualTargetDetails = disclosure(
    '手动选择人物、Profile 与锚点',
    profileGuidance,
    figureField.label,
    profileField.label,
    anchorField.label,
    targetActions,
    targetFacts,
  );
  const draftIdentityDetails = disclosure(
    '高级：配置身份与草稿管理',
    helperText('显示名称用于列表和新附件文件夹；已有附件改显示名称不会改旧路径或剧情引用。“另存为新附件”自动生成新文件夹和全套 ID，无需手动改配置 ID。配置 ID 是剧情调用的稳定身份，手动修改可能使旧剧情失效。'),
    draftActions,
    assetId.label,
    presetId.label,
    displayName.label,
    instanceId.label,
    slot.label,
  );
  const modelImportPanel = createModelImportPanel({
    client,
    signal: lifetime.signal,
    context: () => serviceContext,
    selectedTarget: selectedTargetProject,
    selectedProfile,
    copyableProfiles: () => [...copyableLibraryProfiles.values()],
    notify: (message, tone) => setStatus(message, tone),
    imported: async (imported) => {
      for (const raw of imported) {
        const profile = parseLive2DModelProfile(raw, raw.modelPath);
        profiles.set(profile.modelProfileId, profile);
      }
      await refreshServiceContext();
    },
    copied: async () => {
      targetModelCheck = undefined;
      await preflightSelectedTargetModel();
    },
  });
  replaceSectionContents(
    targetSection,
    '1. 选择角色和服装',
    helperText('先确定要显示的立绘，再到第2步选择附件。服装决定具体模型，系统同时准备对应锚点。'),
    modelImportPanel.element,
    characterField.label,
    libraryProfileField.label,
    showLibraryProfileButton,
    modelLocation,
    targetGuidance,
    manualTargetDetails,
    disclosure('使用说明与本地资料', tutorialDetails, storageFacts, projectDetails),
  );
  targetSection.dataset.creatorStep = '1';

  const materialDetails = disclosure(
    '查看素材与校验详情',
    approvedPath,
    previewResourceFacts,
    exportMaterialFacts,
    backFacts,
    frontFacts,
  );
  replaceSectionContents(
    pngSection,
    '2. 选择附件或图片',
    helperText(
      '载入已有附件或试用样例。已有当前立绘参数会恢复；没有时使用固定默认参数，请调整后保存。图片共用，各立绘参数分别保留。',
    ),
    savedAttachmentRow,
    exactAdaptationDetails,
    quickStartActions,
    newDraftActions,
    draftIdentityDetails,
    helperText('可以从电脑任意位置选择 PNG。原图片不会被移动或删除；保存时会把图片复制进这个附件自己的完整文件夹。'),
    displayName.label,
    helperText(
      '新附件文件夹按显示名称生成，并加短后缀避免重名；不需要手动填写英文名。已有附件保持原目录和剧情引用；需要新名称目录时使用“另存为新附件”。',
    ),
    layerMode.label,
    layerSelectionSummary,
    backRow,
    frontRow,
    materialDetails,
  );
  pngSection.dataset.creatorStep = '2';

  const primaryPlacementActions = el('div');
  primaryPlacementActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px';
  startPreview.textContent = '重新载入附件预览';
  toggleDrag.textContent = '开启拖动';
  resetPlacement.textContent = '恢复附件默认摆放';
  primaryPlacementActions.append(toggleDrag, resetPlacement);
  const placementGrid = el('div');
  placementGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px';
  for (const item of [offsetX, offsetY, localScaleX, localScaleY, rotationDeg, opacity]) {
    item.label.style.gridTemplateColumns = '92px 1fr';
    placementGrid.append(item.label);
  }
  const colorGrid = el('div');
  colorGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px';
  for (const item of [blurAmount, brightness, contrast, saturation, gamma, colorRed, colorGreen, colorBlue]) {
    item.label.style.gridTemplateColumns = '92px 1fr';
    colorGrid.append(item.label);
  }
  const transformGrid = el('div');
  transformGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px';
  for (const item of [skewXDeg, skewYDeg]) {
    item.label.style.gridTemplateColumns = '92px 1fr';
    transformGrid.append(item.label);
  }
  const filterGrid = el('div');
  filterGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px';
  for (const item of [
    bevelStrength,
    bevelThickness,
    bevelRotation,
    bevelSoftness,
    bevelRed,
    bevelGreen,
    bevelBlue,
    bloomStrength,
    bloomBrightness,
    bloomBlur,
    bloomThreshold,
    shockwave,
    radiusAlpha,
  ]) {
    item.label.style.gridTemplateColumns = '92px 1fr';
    filterGrid.append(item.label);
  }
  const previewVisibilityActions = el('div');
  previewVisibilityActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  previewVisibilityActions.append(previewHide, previewShow, previewDelete);
  const placementAdvanced = disclosure(
    '高级位置与预览诊断',
    startPreview,
    previewVisibilityActions,
    pivotX.label,
    pivotY.label,
    scaleMode.label,
    transformGrid,
    previewFacts,
  );
  const colorAdvanced = disclosure(
    '色彩与画面效果（透明度、模糊、色调等）',
    helperText(
      '这些值会实时作用于 shared-runtime 预览，并随附件 adaptation 保存。RGB 范围 0–255，其余默认值旁可用“恢复默认参数”重置。',
    ),
    colorGrid,
  );
  const engineFilterAdvanced = disclosure(
    '高级 WebGAL 滤镜（倒角、辉光、冲击波、径向透明）',
    helperText('高级滤镜与 WebGALPixiContainer 的正式参数一一对应；非默认滤镜可能增加渲染开销。'),
    filterGrid,
  );
  const advancedEffectFields = [
    skewXDeg,
    skewYDeg,
    blurAmount,
    brightness,
    contrast,
    saturation,
    gamma,
    colorRed,
    colorGreen,
    colorBlue,
    bevelStrength,
    bevelThickness,
    bevelRotation,
    bevelSoftness,
    bevelRed,
    bevelGreen,
    bevelBlue,
    bloomStrength,
    bloomBrightness,
    bloomBlur,
    bloomThreshold,
    shockwave,
    radiusAlpha,
  ];
  const updateAdvancedEffectsUi = () => {
    const enabled = advancedEffectsEnabled.checked;
    for (const item of advancedEffectFields) item.input.disabled = !enabled;
    colorAdvanced.style.opacity = enabled ? '1' : '0.62';
    engineFilterAdvanced.style.opacity = enabled ? '1' : '0.62';
  };
  const motionPreviewBox = el('div');
  motionPreviewBox.dataset.creatorRole = 'motion-preview';
  motionPreviewBox.style.cssText =
    'display:grid;gap:7px;padding:9px;border-radius:7px;background:#142235;border:1px solid #34526f';
  motionPreviewBox.append(
    el('strong', '可选：让人物动起来，检查附件是否跟随'),
    helperText('选择一个动作再播放。播放过程中附件应该继续贴在刚才选择的位置上。'),
    motion.label,
    motionActions,
    motionStatus,
  );
  replaceSectionContents(
    placementSection,
    '3. 调整位置',
    anchorField.label,
    helperText(
      '工作台打开期间，点击、滚轮和按键不会推进剧情或清除附件预览。需要拖拽时先点“开启拖动”；调整完再关闭。也可以直接精确填写位置、大小和旋转。',
    ),
    primaryPlacementActions,
    placementGrid,
    advancedEffectsToggle,
    colorAdvanced,
    engineFilterAdvanced,
    motionPreviewBox,
    placementAdvanced,
  );
  placementSection.dataset.creatorStep = '3';

  const applyPrimaryActions = el('div');
  applyPrimaryActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px';
  modelImportPanel.gameCopyButton.style.cssText += ';flex:1 1 180px;min-width:0';
  saveApplyButton.style.cssText += ';flex:2 1 260px;min-width:0';
  saveApplyButton.textContent = '添加 / 更新到这个游戏';
  saveAsNewDraftButton.textContent = '另存为新附件';
  const localActions = el('div');
  localActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px';
  localActions.append(saveLocalButton, saveAsNewDraftButton);
  localSaveSection.append(
    helperText('图片和全部立绘适配保存在制作器资料库；添加到游戏是下面的独立操作。'),
    localActions,
    localSaveSummary,
    disclosure(
      '更多：复制与分享附件',
      exportFolderButton,
      exportLocationSummary,
      helperText('导出保留同一附件身份，另存为则创建新身份。导出不会修改资料库或游戏。'),
    ),
  );
  localSaveSection.dataset.creatorStep = '4-save';
  openPreviewButton.textContent = '打开刚保存的预览';
  applyPrimaryActions.append(modelImportPanel.gameCopyButton, saveApplyButton, openPreviewButton);
  const scriptDetails = disclosure('进阶：脚本方式调用（普通用户不需要）', copyScriptButton, scriptPreview);
  replaceSectionContents(
    applySection,
    '5. 添加到游戏（可选）',
    helperText(
      '选择游戏后，明确添加或更新当前附件并生成独立验证剧情。此操作不会保存或覆盖资料库版本，也不会自动添加其他样例。',
    ),
    targetProjectField.label,
    refreshStorageButton,
    targetSavePath,
    modelImportPanel.gameCopyElement,
    applyPrimaryActions,
    modelImportPanel.gameCopyStatusElement,
    testSceneHint,
    applySummary,
    scriptDetails,
  );
  applySection.dataset.creatorStep = '5-game';

  const messageHistoryDetails = disclosure('操作记录与完整错误', status, statusActions);
  messageHistoryDetails.dataset.creatorRole = 'message-history';
  replaceSectionContents(debugSection, '辅助线与内部诊断', debugRow);
  const semanticToolHost = el('div');
  const advancedTools = disclosure(
    '高级工具与诊断（默认收起）',
    helperText(`版本：${__WEBGAL_CREATOR_RELEASE_VERSION__}。普通附件制作不需要打开这里。`),
    debugSection,
    disclosure(
      '本地性能测量（P01）',
      helperText(
        '只统计当前页面 10 秒内的真实帧间隔，不联网、不保存，也不会自动删除或载入附件。' +
          '请分别在“已删除附件预览”和“普通中性附件已显示”状态各测一次，并使用同一个 motion。',
      ),
      performanceMeasureButton,
      performanceResult,
    ),
    semanticToolHost,
  );
  advancedTools.dataset.creatorRole = 'advanced-tools';

  const stickyHeader = el('header');
  stickyHeader.style.cssText =
    'position:sticky;top:-12px;z-index:3;display:grid;gap:7px;margin:-12px -12px 0;padding:12px;' +
    'background:linear-gradient(#0a0f16 88%,transparent);border-bottom:1px solid #2d4053';
  stickyHeader.append(title, intro);
  const moduleStyles = el('style');
  moduleStyles.textContent = `
    [data-creator-module] { border:2px solid var(--module-accent); border-left:7px solid var(--module-accent); border-radius:10px; overflow:hidden; background:#0d151e; min-width:0; scroll-margin-top:160px; }
    [data-creator-module] > summary { cursor:pointer; padding:13px 12px; color:var(--module-accent); font-size:16px; font-weight:700; background:#15212c; }
    [data-creator-module] > summary small { display:block; margin:5px 0 0 18px; color:#c4cfda; font-size:12px; font-weight:400; }
    [data-creator-module] > section { border:0!important; padding:12px!important; }
    [data-creator-module] button[data-primary-action] { background:#24485b!important; border:2px solid var(--module-accent)!important; font-weight:700; }
    [data-creator-module] input:focus-visible, [data-creator-module] select:focus-visible, [data-creator-module] button:focus-visible { outline:2px solid var(--module-accent); outline-offset:2px; }
    [data-creator-module="anchors"] > :not(summary):not(style) { margin-left:12px; margin-right:12px; }
  `;
  function moduleCard(id: string, heading: string, description: string, content: HTMLElement, accent: string) {
    const card = el('details'); card.open = true;
    card.dataset.creatorModule = id; card.style.setProperty('--module-accent', accent);
    const summary = el('summary', heading); summary.append(el('small', description));
    const oldHeading = content.querySelector(':scope > h3'); oldHeading?.remove();
    card.append(summary, content); return card;
  }
  const targetCard = moduleCard('model', '1. 人物与服装', '导入模型 · 选择角色与外观 · 载入人物', targetSection, '#81cfff');
  const pngCard = moduleCard('material', '2. 附件与图片', '打开附件 · 修改名称 · 选择前后层图片', pngSection, '#c5a5ff');
  const placementCard = moduleCard('placement', '3. 摆放与随动', '选择锚点 · 调整位置与大小 · 检查动作', placementSection, '#ffcc85');
  const saveCard = moduleCard('save', '4. 保存附件', '保存到本地资料库 · 另存为 · 复制分享', localSaveSection, '#91ddb2');
  const applyCard = moduleCard('game', '5. 添加到游戏', '选择目标游戏 · 复制人物 · 添加或更新附件', applySection, '#f2a9bd');
  const moduleNavigation = el('nav'); moduleNavigation.setAttribute('aria-label', '工作台模块定位');
  moduleNavigation.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
  for (const [label, card] of [['人物', targetCard], ['附件 / 改名', pngCard], ['摆放', placementCard], ['保存', saveCard], ['游戏', applyCard]] as const) {
    const jump = button(label); jump.onclick = () => { card.open = true; card.scrollIntoView({ block:'start' }); };
    moduleNavigation.append(jump);
  }
  const renameHere = button('修改附件名称');
  renameHere.onclick = () => { pngCard.open = true; displayName.input.scrollIntoView({ block:'center' }); displayName.input.focus(); };
  localSaveSection.prepend(renameHere);
  for (const primary of [showLibraryProfileButton, loadSavedAttachmentButton, saveLocalButton, saveAsNewDraftButton, saveApplyButton]) primary.dataset.primaryAction = 'true';
  stickyHeader.append(moduleNavigation);
  root.append(
    moduleStyles,
    stickyHeader,
    targetCard,
    pngCard,
    placementCard,
    saveCard,
    applyCard,
    messageHistoryDetails,
    advancedTools,
  );
  document.body.append(root);
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const value =
      target instanceof HTMLInputElement && target.type === 'file'
        ? Array.from(target.files ?? [])
            .map((file) => file.name)
            .join(', ')
        : target instanceof HTMLInputElement && target.type === 'checkbox'
        ? String(target.checked)
        : target.value;
    const label =
      target.closest('label')?.textContent?.trim().slice(0, 120) || target.dataset.creatorRole || target.type;
    audit('field.change', label, 'accepted', value);
  });
  const isolatedEvents = [
    'wheel',
    'contextmenu',
    'keydown',
    'keyup',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
  ] as const;
  const stopCreatorEvent = (event: Event) => event.stopPropagation();
  for (const eventName of isolatedEvents) {
    root.addEventListener(eventName, stopCreatorEvent);
    notification.addEventListener(eventName, stopCreatorEvent);
  }
  const panelLayout = installCreatorWorkbenchLayout(
    root,
    status,
    resetPanelSizesButton,
    resetWorkbenchButton,
    resetStatusButton,
  );
  const resetNativeTextRegionSizes = (event: Event) => {
    const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind;
    if (kind !== 'all') return;
    for (const region of [scriptPreview]) {
      region.style.height = '';
      region.style.width = '100%';
    }
  };
  window.addEventListener('webgal-creator-panel-layout-reset', resetNativeTextRegionSizes);
  const anchorStudio = createAnchorAuthoringPanel({
    client, signal: lifetime.signal,
    active: () => activeReadyFigure(),
    onPickingStart: () => { modelViewport.stopMoving(); setDraggingEnabled(false); },
    renderer: () => WebGAL.gameplay.pixiStage?.currentApp?.renderer,
    profiles: () => [...profiles.values()], context: () => serviceContext,
    reload: async () => {
      if (!(await refreshServiceContext())) throw new Error('未能刷新制作器资料，请查看后台连接错误。');
      const loaded = await loadCreatorProfilesAfter(Promise.resolve(), undefined, { signal: lifetime.signal });
      if (destroyed) return;
      copyableLibraryProfiles = loaded;
      profiles = new Map([...profiles, ...loaded]);
      renderLibraryProfiles(); await refreshFigures();
    },
    loadModel: async modelPath => {
      const stage = WebGAL.gameplay.pixiStage;
      if (!stage) throw new Error('CREATOR_STAGE_NOT_READY');
      await captureCurrentAdaptation();
      if (!(await clearPreview())) throw new Error('附件预览未能清理，未切换立绘。');
      setDraggingEnabled(false);
      const ready = await replaceCreatorFigure({ stage, manager: stageStateManager, runtime, profile: { modelPath },
        selectedKey: draft.figureKey, signal: lifetime.signal });
      draft.figureKey = ready.figureKey; draft.figureGeneration = ready.generation;
      figureField.select.value = ready.figureKey;
      await refreshFigures();
    },
    playMotion: async (figure, requested) => {
      const result = await WebGAL.gameplay.pixiStage?.replayModelMotionByKey(figure.key, requested, figure.uuid);
      if (!result?.started) throw new Error(result?.reason ?? 'CREATOR_MOTION_FAILED');
    },
    apply: async (profile, anchorName) => {
      profiles.set(profile.modelProfileId, profile);
      if (!(await showSelectedLibraryFigure(true, profile, anchorName))) throw new Error('锚点组未完成应用，请查看工作台错误。已保存文件仍保留。');
    },
    saved: async profile => {
      profiles.set(profile.modelProfileId, profile);
      await refreshServiceContext();
      await refreshFigures();
    },
    audit: (result, detail) => { audit('anchor.authoring', 'local-profile', result, detail); },
  });
  const handPanel=el('details');handPanel.dataset.creatorHandBinding='true';
  handPanel.append(el('summary','手部状态随动与模型内遮挡（试用）'));
  const handHelp=el('p','手部配置属于当前人物适配：每种手型保留自己的接点、方向、镜像和遮挡位置，并按模型真实透明度交接。原模型不改；未配置手型暂不显示附件。当前支持Cubism2和单张素材，先关闭附件自身滤镜；人物整体滤镜保持宿主处理。');
  const handSample=button('启用爱音冬服两手型样本'),handDisable=button('停用手部状态随动'),handPose3=button('检查手型3'),handPose4=button('检查手型4'),handPoseRestore=button('恢复原有动作');
  const handTransition=field('两手型交接检查（0—1）','number');handTransition.input.min='0';handTransition.input.max='1';handTransition.input.step='0.05';handTransition.input.value='0';
  const handState=selectField('编辑已配置手型'),handMirror=el('input');handMirror.type='checkbox';
  const handMirrorLabel=el('label','此手型左右翻转');handMirrorLabel.append(handMirror);
  const handPoseX=field('此手型水平微调','number'),handPoseY=field('此手型垂直微调','number');
  const handAngle=field('此手型方向偏置（度）','number');handAngle.input.step='1';
  const handPoseHelp=el('p','先用上方摆放参数调整整张素材，再分别校准手型的位置和角度。这里的微调在翻转之后生效，只改变所选手型；修改立即预览，保存附件才写入资料库。选择编辑手型不会切换人物姿态；检查手型或交接数值才临时固定姿态，播放动作自动退出。');
  const handInputStatus=el('p');handInputStatus.setAttribute('aria-live','polite');
  let handInputsValid=true;
  const handAxisAngle=field('手部翻转轴方向（度）','number'),handAxisX=field('翻转轴水平位置（相对接点）','number'),handAxisY=field('翻转轴垂直位置（相对接点）','number');
  const handAxisHelp=el('p','翻转作用于已经调整好旋转、位置和大小的整张附件。轴方向0°为水平、90°为竖直，位置相对手部接点；爱音样本轴由腕部到掌部参考点生成，仅为可校准起点。其他未标轴配置暂用局部竖轴，请复核。');
  const handAxisShow=el('input');handAxisShow.type='checkbox';const handAxisShowLabel=el('label','显示手部翻转轴与网格（仅预览）');handAxisShowLabel.append(handAxisShow);
  let handAxisOverlay:PIXI.Container|undefined;let handAxisModel:PIXI.Container|undefined;
  function clearHandAxisOverlay(){if(handAxisOverlay&&!handAxisOverlay.destroyed){handAxisOverlay.parent?.removeChild(handAxisOverlay);handAxisOverlay.destroy({children:true});}handAxisOverlay=undefined;handAxisModel=undefined;}
  function updateHandAxisOverlay(){
    const figure=activeReadyFigure();if(!handAxisShow.checked||!draft.handBinding||!figure){clearHandAxisOverlay();return;}
    if(handAxisModel!==figure.model){clearHandAxisOverlay();handAxisOverlay=new PIXI.Container();handAxisModel=figure.model;figure.model.addChild(handAxisOverlay);}
    const overlay=handAxisOverlay!;for(const child of overlay.removeChildren())child.destroy();
    for(const row of preview.handAxisPreview()){
      const g=new PIXI.Graphics();g.alpha=row.weight;g.lineStyle(2,0xffd34e);const dx=Math.cos(row.angleRad)*110,dy=Math.sin(row.angleRad)*110;
      g.moveTo(row.origin.x-dx,row.origin.y-dy);g.lineTo(row.origin.x+dx,row.origin.y+dy);g.beginFill(0xffd34e).drawCircle(row.origin.x,row.origin.y,4).endFill();overlay.addChild(g);
      row.vertices.forEach((p,index)=>{const label=new PIXI.Text(String(index),{fontSize:35,fill:0x77e5ff});label.position.set(p.x,p.y);label.alpha=row.weight;overlay.addChild(label);});
    }
  }
  handAxisShow.onchange=updateHandAxisOverlay;
  const handInsertion=selectField('相对该手型的位置');for(const [v,n]of [['before','被该手型遮挡'],['after','遮挡该手型']]){const o=el('option',n);o.value=v;handInsertion.select.append(o);}
  const handStatus=el('pre');
  handStatus.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;min-width:0';
  handPanel.style.minWidth='0';
  const handJson=el('textarea');handJson.rows=8;handJson.setAttribute('aria-label','手部状态配置JSON');handJson.style.width='100%';
  const handJsonApply=button('检查并应用手部配置JSON');
  handPanel.append(handHelp,handSample,handDisable,handPose3,handPose4,handPoseRestore,handTransition.label,handState.label,handPoseHelp,handMirrorLabel,handPoseX.label,handPoseY.label,handAngle.label,handInsertion.label,handInputStatus,disclosure('高级：翻转轴与网格',handAxisHelp,handAxisShowLabel,handAxisAngle.label,handAxisX.label,handAxisY.label),handStatus,disclosure('高级：检查／编辑手部配置',handJson,handJsonApply));
  placementSection.append(handPanel);
  let handPoseCleanup:(()=>void)|undefined;
  function stopHandPose(){handPoseCleanup?.();handPoseCleanup=undefined;handTransition.input.value='';handInputStatus.textContent='正在使用人物原有动作；编辑手型不会改变人物姿态。';}
  function previewHandPose(value:number){
    const figure=activeReadyFigure();if(!figure||figure.uuid!==draft.figureGeneration)throw new Error('请等待当前人物完成载入');
    if(!selectedProfile()?.modelPath.replace(/\\/g,'/').endsWith('anon/school_winter-2023/model.json'))throw new Error('这两个姿态检查仅适用爱音冬服样本；其他配置请播放自己的动作');
    if(!Number.isFinite(value))throw new Error('请完成交接数值输入（0—1）');
    stopHandPose();const internal=figure.model.internalModel,core=(internal as any).coreModel,t=Math.max(0,Math.min(1,value));handTransition.input.value=String(t);
    const handler=()=>{for(let i=1;i<=7;i++)core.setParamFloat('PARAM_HAND_L_'+String(i).padStart(2,'0')+'_001',i===3?1-t:i===4?t:0);core.setParamFloat('PARAM_ARM_L_01_002',0);core.setParamFloat('PARAM_ARM_L_CHANGE',0);};
    internal.on('beforeModelUpdate',handler);handPoseCleanup=()=>{internal.off('beforeModelUpdate',handler);figure.model.off('destroy',stopHandPose);};
    figure.model.once('destroy',stopHandPose);
    handStatus.textContent='仅工作台临时检查姿态；点击恢复原有动作即可退出，不写入模型或附件动作。';
  }
  function renderHandInputs(){
    handSample.disabled = Boolean(draft.handBinding);
    handJson.value=draft.handBinding?JSON.stringify(draft.handBinding,null,2):'';const previous=handState.select.value;handState.select.replaceChildren();
    for(const state of draft.handBinding?.states??[]){const option=el('option',state.displayName);option.value=state.id;handState.select.append(option);}if(draft.handBinding?.states.some(s=>s.id===previous))handState.select.value=previous;renderHandState();
    handStatus.textContent=draft.handBinding?'已启用 '+draft.handBinding.states.length+' 个手型；保存后配置随该人物适配一起恢复。未配置手型不显示附件。':'当前使用普通单锚点与人物前后层附件。';
  }
  function renderHandState(){const state=draft.handBinding?.states.find(s=>s.id===handState.select.value);handMirror.checked=state?.mirrorX??false;handAngle.input.value=String((state?.rotationOffsetRad??0)*180/Math.PI);handInsertion.select.value=state?.insertion??'before';
    const figure=activeReadyFigure(),profile=selectedProfile(),axis=state?resolveHandFlipAxis(state,profile?.modelPath??'',figure?.model.internalModel.localTransform??{a:1,b:0,c:0,d:1}):undefined;
    handAxisAngle.input.value=String((axis?.angleRad??Math.PI/2)*180/Math.PI);handAxisX.input.value=String(axis?.offset.x??0);handAxisY.input.value=String(axis?.offset.y??0);
    handPoseX.input.value=String(state?.poseOffset?.x??0);handPoseY.input.value=String(state?.poseOffset?.y??0);
    for(const input of [handPoseX.input,handPoseY.input,handAngle.input,handMirror,handInsertion.select])input.disabled=!state;
    updateHandAxisEnablement();handInputsValid=true;handInputStatus.textContent=state?'正在编辑 '+state.displayName+'；参数修改立即预览。':'';
  }
  async function applyHandBinding(binding:AttachmentHandBinding,createProfile:boolean){
    readDraftInputs();const figure=activeReadyFigure(),base=selectedProfile();if(!figure||!base||figure.uuid!==draft.figureGeneration)throw new Error('请先载入当前人物与图片');
    if(draft.layerMode==='both'||!draft.layers[binding.textureLayer])throw new Error('手部内部遮挡使用一张图片，请先选择匹配的前层或后层素材。');
    const previous=cloneCreatorDraft(draft),previousEditing=editingProfile;let createdId:string|undefined;
    try{if(!(await clearPreview()))throw new Error('旧预览未完成清理');
      if(createProfile){const generated=profileForHandBinding(base,binding);editingProfile=generated.profile;createdId=generated.profile.modelProfileId;profiles.set(createdId,generated.profile);draft.modelProfileId=createdId;draft.anchorName=generated.anchorName;await refreshFigures();refreshProfiles(createdId);refreshAnchors(generated.anchorName);}
      draft.handBinding=cloneAttachmentHandBinding(binding);writeDraftInputs();
      if(!(await bindPreview())){const failure=preview.bindFailure();throw new Error(failure?failure.code+'：'+failure.message:'手部预览未出现：请检查已配置手型是否可见、网格及素材是否匹配。');}
      audit('hand.binding','current-adaptation','OK','状态配置已应用，视觉待检查');setStatus('手部状态配置已应用到当前适配。请检查方向、交接与遮挡，再保存。');
    }catch(error){
      draft=previous;editingProfile=previousEditing;if(createdId)profiles.delete(createdId);
      if(createProfile&&!previous.handBinding)stopHandPose();
      await refreshFigures();refreshProfiles(previous.modelProfileId);refreshAnchors(previous.anchorName);writeDraftInputs();
      if(activeReadyFigure()?.uuid===previous.figureGeneration){
        try{if(!(await bindPreview()))throw new Error('原适配预览未恢复');}
        catch(restoreError){throw new Error(errorMessage(error)+'；恢复原预览失败：'+errorMessage(restoreError));}
      }
      throw error;
    }
  }
  handSample.onclick=async()=>{try{readDraftInputs();const figure=activeReadyFigure(),profile=selectedProfile();if(!figure||!profile)throw new Error('请先载入爱音冬服和一张附件图片');const binding=captureAnonWinterHandBinding(figure.model,profile,draft.layerMode==='back-only'?'back':'front');previewHandPose(0);await applyHandBinding(binding,true);}catch(error){setStatus(errorMessage(error),false);}};
  handDisable.onclick=async()=>{try{stopHandPose();if(!(await clearPreview()))return;delete draft.handBinding;writeDraftInputs();if(!(await bindPreview()))return;setStatus('已停用手部状态随动；恢复当前语义锚点的普通附件路径。请保存后检查。');}catch(error){setStatus(errorMessage(error),false);}};
  function updateHandAxisEnablement(){
    for(const input of [handAxisAngle.input,handAxisX.input,handAxisY.input])input.disabled=!draft.handBinding||!handMirror.checked;
    handAxisHelp.textContent='翻转作用于已经摆放好的整张附件；仅勾选此手型左右翻转时轴参数生效。0°和180°是同一水平轴，90°为竖轴；轴位置相对手部接点。爱音样本提供腕部到掌部的校准起点。';
  }
  function selectHandPose(value:number){
    previewHandPose(value);const id=value===0?'D_PSD1.97':'D_PSD1.98';
    const state=draft.handBinding?.states.find(s=>s.drawableId===id);if(state){handState.select.value=state.id;renderHandState();}
  }
  handPose3.onclick=()=>{try{selectHandPose(0);}catch(error){setStatus(errorMessage(error),false);}};
  handPose4.onclick=()=>{try{selectHandPose(1);}catch(error){setStatus(errorMessage(error),false);}};
  handTransition.input.oninput=()=>{try{const value=handTransition.input.valueAsNumber;previewHandPose(value);handInputStatus.textContent=value>0&&value<1?'当前两手型混合；微调只改变所选手型。建议先校准0和1两个端点。':'当前为交接端点；请确认编辑的手型与显示姿态一致。';}catch(error){handInputStatus.textContent=errorMessage(error);}};
  handPoseRestore.onclick=()=>{stopHandPose();handStatus.textContent='已恢复模型原有动作；未配置手型暂不显示附件，请选择覆盖范围内的动作。';};
  handState.select.onchange=()=>{renderHandState();handInputStatus.textContent='正在编辑所选手型；人物姿态保持不变。需要固定姿态时，请明确点击检查手型或交接检查。';};
  function applyHandStateInputs(){
    updateHandAxisEnablement();
    try{
      if(!draft.handBinding)throw new Error('请先启用手部状态随动');
      const figure=activeReadyFigure();if(!figure||figure.uuid!==draft.figureGeneration)throw new Error('请等待当前人物完成载入');
      const binding=cloneAttachmentHandBinding(draft.handBinding),state=binding.states.find(s=>s.id===handState.select.value);
      if(!state)throw new Error('请选择手型');
      const read=(input:HTMLInputElement)=>{if(!Number.isFinite(input.valueAsNumber))throw new Error('请完成数字输入；预览保留最后有效值，暂不能保存');return input.valueAsNumber;};
      state.mirrorX=handMirror.checked;state.rotationOffsetRad=degreesToRadians(read(handAngle.input));
      state.poseOffset={x:read(handPoseX.input),y:read(handPoseY.input)};
      if(handMirror.checked)state.flipAxis={angleRad:degreesToRadians(read(handAxisAngle.input)),offset:{x:read(handAxisX.input),y:read(handAxisY.input)}};
      state.insertion=handInsertion.select.value as 'before'|'after';
      const candidate={...draft,handBinding:parseAttachmentHandBinding(binding)};
      if(!preview.applyHandCalibration(candidate))throw new Error('当前预览尚未绑定；请重新载入当前附件后调整');
      draft.handBinding=candidate.handBinding;handInputsValid=true;handJson.value=JSON.stringify(draft.handBinding,null,2);
      handInputStatus.textContent=state.displayName+' 已即时预览；请保存附件保留修改。';renderPreviewFacts();
    }catch(error){handInputsValid=false;handInputStatus.textContent=errorMessage(error);}
  }
  for(const input of [handPoseX.input,handPoseY.input,handAngle.input,handAxisAngle.input,handAxisX.input,handAxisY.input])input.oninput=applyHandStateInputs;
  handMirror.onchange=applyHandStateInputs;handInsertion.select.onchange=applyHandStateInputs;
  handJsonApply.onclick=async()=>{try{const binding=parseAttachmentHandBinding(JSON.parse(handJson.value));await applyHandBinding(binding,!draft.handBinding);}catch(error){setStatus(errorMessage(error),false);}};
  lifetime.signal.addEventListener('abort',stopHandPose,{once:true});
  const handDiagnosticTimer = window.setInterval(() => {
    updateHandAxisOverlay();
    if (!draft.handBinding) return;
    const state = preview.handStateDiagnostic();
    handStatus.textContent = state === 'unsupported-state'
      ? 'HAND_STATE_NOT_CONFIGURED：当前手型未配置，附件暂不显示；请选择已配置手型或补充适配。'
      : state === 'supported'
      ? '当前手型已配置；交接按模型真实透明度。分离等待稳定手型帧，持续混合或未配置手型会给出诊断。'
      : '手部配置已保留；当前尚无已绑定预览，请载入并检查已配置手型。';
  }, 250);
  lifetime.signal.addEventListener('abort', () => {window.clearInterval(handDiagnosticTimer);clearHandAxisOverlay();}, {once:true});
  const modelViewport = createCreatorViewport({
    app: () => WebGAL.gameplay.pixiStage?.currentApp ?? undefined,
    active: () => activeReadyFigure(),
    beginPan: () => { setDraggingEnabled(false); anchorStudio.stopPicking(); },
  });
  targetSection.prepend(modelViewport.controls);
  anchorStudio.panel.dataset.creatorModule = 'anchors';
  anchorStudio.panel.style.setProperty('--module-accent', '#92d4cb');
  const anchorHeading = anchorStudio.panel.querySelector(':scope > summary');
  if (anchorHeading) {
    anchorHeading.textContent = '锚点制作器';
    anchorHeading.append(el('small', '自定义部位与外观专属锚点 · 按需展开'));
  }
  root.insertBefore(anchorStudio.panel, pngCard);
  const anchorJump = button('锚点');
  anchorJump.onclick = () => { anchorStudio.panel.open = true; anchorStudio.panel.scrollIntoView({ block:'start' }); };
  moduleNavigation.append(anchorJump);
  semanticToolHost.remove();

  const targetDependentButtons = [
    newDraftButton,
    copyPresetButton,
    kemomimiSampleButton,
    haloSampleButton,
    flowerSampleButton,
    roseSampleButton,
    loadSavedAttachmentButton,
    startPreview,
    toggleDrag,
    previewHide,
    previewShow,
    previewDelete,
    resetPlacement,
    playMotion,
    idleMotion,
    saveApplyButton,
  ];
  let activeBusyControl: HTMLButtonElement | HTMLSelectElement | undefined;
  let completionNotice: (() => void) | undefined;
  let performanceProbeAbort: AbortController | undefined;

  function setButtonEnabled(control: HTMLButtonElement, enabled: boolean, reason: string) {
    const actuallyEnabled = enabled && !activeBusyControl;
    control.disabled = !actuallyEnabled;
    control.style.cursor = actuallyEnabled ? 'pointer' : 'not-allowed';
    control.style.opacity = actuallyEnabled ? '1' : '0.48';
    control.title = actuallyEnabled ? '' : activeBusyControl ? '请等待当前操作完成。' : reason;
  }

  async function withBusyButton<T>(
    control: HTMLButtonElement | HTMLSelectElement,
    busyText: string,
    operation: () => Promise<T>,
    allowFigureChoice = false,
  ): Promise<T | undefined> {
    if (destroyed) return;
    if (activeBusyControl) {
      setStatus(`请等待“${activeBusyControl.textContent ?? '当前操作'}”完成。`, 'info');
      return undefined;
    }
    const previousText = control.textContent ?? '';
    const startedAt = performance.now();
    audit('interaction.start', previousText, 'started', busyText);
    activeBusyControl = control;
    completionNotice = undefined;
    cancelDrag();
    // Keep the captured load/save draft stable while its request commits.
    const restoreInteraction = allowFigureChoice
      ? keepOnlyFigureChoicesInteractive()
      : (() => { root.setAttribute('inert', ''); return () => root.removeAttribute('inert'); })();
    control.dataset.creatorBusy = 'true';
    control.disabled = true;
    if (control.tagName !== 'SELECT') control.textContent = busyText;
    updateTargetAvailability();
    try {
      return await operation();
    } catch (error) {
      completionNotice = undefined;
      setStatus(errorMessage(error), false);
      return undefined;
    } finally {
      restoreInteraction();
      delete control.dataset.creatorBusy;
      if (control.tagName !== 'SELECT') control.textContent = previousText;
      activeBusyControl = undefined;
      control.disabled = false;
      if (!destroyed) {
        updateTargetAvailability();
        (completionNotice as (() => void) | undefined)?.();
      }
      completionNotice = undefined;
      audit('interaction.end', previousText, 'settled', 'handler complete; not a GPU paint measurement', Math.round(performance.now() - startedAt));
    }
  }

  function keepOnlyFigureChoicesInteractive() {
    const allowed = [characterField.select, libraryProfileField.select];
    const changed: HTMLElement[] = [];
    function visit(node: HTMLElement) {
      if (allowed.includes(node as HTMLSelectElement)) return;
      if (!allowed.some(select => node.contains(select))) {
        if (!node.hasAttribute('inert')) { node.setAttribute('inert', ''); changed.push(node); }
        return;
      }
      for (const child of node.children) if (child instanceof HTMLElement) visit(child);
    }
    for (const child of root.children) if (child instanceof HTMLElement) visit(child);
    return () => { for (const node of changed) node.removeAttribute('inert'); };
  }

  function emptyOption(select: HTMLSelectElement, label: string) {
    const option = el('option', label);
    option.value = '';
    option.disabled = true;
    option.selected = true;
    select.replaceChildren(option);
  }

  function selectedTargetProject() {
    return serviceContext?.targetProjects.find((project) => project.name === targetProjectField.select.value);
  }

  function selectedSavedAttachment(): CreatorSavedAttachmentSummary | undefined {
    return [
      ...(serviceContext?.authoringWorkspace.savedAttachments ?? []),
      ...(serviceContext?.savedAttachments ?? []),
    ].find((item) => item.key === savedAttachmentField.select.value);
  }

  function selectedSavedAdaptationIndex() {
    const parsed = Number.parseInt(savedAdaptationField.select.value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error('CREATOR_ADAPTATION_SELECTION_REQUIRED');
    return parsed;
  }

  function renderSavedAdaptations() {
    const selected = selectedSavedAttachment();
    const sameAttachment = savedAdaptationField.select.dataset.attachmentKey === selected?.key;
    const preferredPair = sameAttachment
      ? savedAdaptationField.select.selectedOptions[0]?.dataset.pair
      : undefined;
    savedAdaptationField.select.dataset.attachmentKey = selected?.key ?? '';
    savedAdaptationField.select.replaceChildren();
    const auto = el('option', '自动恢复最近保存的适配'); auto.value = ''; savedAdaptationField.select.append(auto);
    for (let index = 0; index < (selected?.adaptationCount ?? 0); index += 1) {
      const profileId = selected?.modelProfileIds[index] ?? `adaptation-${index + 1}`;
      const anchorName = selected?.anchorNames?.[index] ?? '';
      const modelPath = selected?.modelPaths[index] ?? '';
      const profile = profiles.get(profileId);
      const readable = selected?.adaptationDisplayNames?.[index];
      const option = el('option', `${index + 1}. ${readable ?? (profile ? profileLabel(profile) : profileId)}${!readable && anchorName ? ` · ${anchorName}` : ''}`);
      option.value = String(index);
      option.dataset.profileId = profileId;
      option.dataset.pair = JSON.stringify([profileId, anchorName]);
      option.title = modelPath;
      savedAdaptationField.select.append(option);
    }
    const preferred = [...savedAdaptationField.select.options].find(
      (option) => option.dataset.pair === preferredPair,
    );
    if (preferred) {
      savedAdaptationField.select.value = preferred.value;
    }
    if (!selected?.adaptationCount) emptyOption(savedAdaptationField.select, '没有可编辑的适配');
    const presentation = creatorSavedAdaptationPresentation(selected?.adaptationCount ?? 0);
    savedAdaptationField.label.hidden = !presentation.multiple;
    // The field has an authored inline `display:grid`; `hidden` alone can be
    // overridden by that author style and leave a ghost column in this row.
    savedAdaptationField.label.style.display = presentation.adaptationFieldDisplay;
    savedAttachmentRow.style.gridTemplateColumns = presentation.rowGridTemplateColumns;
    loadSavedAttachmentButton.textContent = '载入附件（用于当前立绘）';
    savedAttachmentRow.style.gridTemplateColumns = 'minmax(0,1fr) auto';
    savedAdaptationField.label.style.gridColumn = '1 / -1';
  }

  function renderLibraryProfiles() {
    const previous = libraryProfileField.select.value;
    const previousCharacter = characterField.select.value;
    const available = new Set([
      ...(serviceContext?.authoringWorkspace.availableModelProfileIds ?? []),
      ...(serviceContext?.authoringWorkspace.reviewModelProfileIds ?? []),
    ]);
    const all = [...profiles.values()];
    characterField.select.replaceChildren();
    const prompt = el('option', '请选择角色');
    prompt.value = '';
    characterField.select.append(prompt);
    for (const id of [
      ...new Set(all.filter((p) => available.has(p.modelProfileId)).map((p) => p.characterId)),
    ].sort()) {
      const model = all.find(p=>p.characterId===id && importedFor(p));
      const option = el('option', model ? importedFor(model)!.displayName : characterLabel(id));
      option.value = id;
      characterField.select.append(option);
    }
    characterField.select.value = previousCharacter;
    libraryProfileField.select.replaceChildren();
    const outfitPrompt = el('option', previousCharacter ? '请选择服装 / 立绘' : '请先选择角色');
    outfitPrompt.value = '';
    libraryProfileField.select.append(outfitPrompt);
    for (const profile of creatorCharacterOutfits(all, available, characterField.select.value)) {
      const imported = serviceContext?.importedModels?.find((m) => m.profileIds.includes(profile.modelProfileId));
      const name = imported ? (imported.appearanceName || imported.entryPath.split('/').slice(-2,-1)[0] || imported.displayName) : profile.modelId;
      const option = el('option', name + (imported ? '（已导入）' : ''));
      option.value = profile.modelProfileId;
      option.title = profile.modelPath;
      libraryProfileField.select.append(option);
    }
    if ([...libraryProfileField.select.options].some((o) => o.value === previous))
      libraryProfileField.select.value = previous;
    libraryProfileField.select.disabled = !characterField.select.value;
    renderModelLocation();
  }

  function renderModelLocation() {
    const selected = profiles.get(libraryProfileField.select.value);
    modelLocation.textContent = selected ? '所选立绘模型：' + selected.modelPath : '先选择角色，再选择服装并载入立绘。';
  }

  function syncCharacterSelection(profile: Live2DModelProfile) {
    characterField.select.value = profile.characterId;
    renderLibraryProfiles();
    const exact = [...libraryProfileField.select.options].find((o) => o.value === profile.modelProfileId);
    const sameModel = [...libraryProfileField.select.options].find(
      (o) => profiles.get(o.value)?.modelPath === profile.modelPath,
    );
    libraryProfileField.select.value = exact?.value ?? sameModel?.value ?? '';
    renderModelLocation();
  }

  function renderSavedAttachments() {
    const previous = savedAttachmentField.select.value;
    const items = [
      ...(serviceContext?.savedAttachments ?? []),
      ...(serviceContext?.authoringWorkspace.savedAttachments ?? []),
    ];
    savedAttachmentField.select.replaceChildren();
    for (const item of items) {
      const option = el(
        'option',
        `[${item.projectName}] ${item.displayName} · ${item.adaptationCount} 套人物/立绘适配`,
      );
      option.value = item.key;
      option.title = `${item.presetId}\n${item.modelProfileIds.join('\n')}`;
      savedAttachmentField.select.append(option);
    }
    if (previous && items.some((item) => item.key === previous)) {
      savedAttachmentField.select.value = previous;
    }
    if (!items.length) emptyOption(savedAttachmentField.select, '还没有已保存的附件模型');
    renderSavedAdaptations();
  }

  function renderStoragePaths() {
    if (!serviceContext) {
      storageFacts.textContent = '暂时无法读取项目、附件与人物资料。请关闭这个网页，再运行 02_打开附件制作器.cmd。';
      storageFacts.style.borderColor = '#d89b4d';
      emptyOption(targetProjectField.select, '没有读取到游戏');
      emptyOption(savedAttachmentField.select, '后台未连接');
      targetSavePath.textContent = '尚未找到可以保存的游戏。';
      return;
    }
    storageFacts.style.borderColor = '#3f8f63';
    storageFacts.textContent = [
      '你的原始 PNG：仍留在你选择它的原文件夹，不会被移动或删除。',
      '制作器和 Terre 的附件选择器只列出“可用附件配置”；人物模型与内部锚点资料不会混入附件列表。',
      'attachment.json、PNG、人物适配与 placement 都是正式可编辑接口；手工修改后重新载入时，制作器会先展示差异并请你确认。',
      '内置样例载入后也是普通用户附件；升级只更新未改动的出厂默认，不覆盖你改过的活动资料。',
      `本地附件资料库：${serviceContext.authoringWorkspace.attachmentRoot}/portable。每个子文件夹都是可整体复制的完整附件。`,
      '中文显示名称与稳定技术文件夹的对应关系会在保存结果中明确列出。',
    ].join('\n');
    renderTargetProjects();
    renderSavedAttachments();
    renderTargetSavePath();
  }

  function renderTargetProjects() {
    if (!serviceContext) return;
    const previous = targetProjectField.select.value;
    targetProjectField.select.replaceChildren();
    for (const project of serviceContext.targetProjects) {
      const option = el('option', project.name);
      option.value = project.name;
      targetProjectField.select.append(option);
    }
    if (previous && serviceContext.targetProjects.some((project) => project.name === previous)) {
      targetProjectField.select.value = previous;
    }
    if (!serviceContext.targetProjects.length) emptyOption(targetProjectField.select, '没有找到可保存的游戏');
  }

  function renderTargetSavePath() {
    const project = selectedTargetProject();
    if (!project) {
      targetSavePath.textContent = '请先选择一个游戏。';
      return;
    }
    const profile = selectedProfile();
    const key = profile ? `${project.name}\u0000${profile.modelPath}` : '';
    const check = key && targetModelCheck?.key === key ? `\n\n人物模型预检：${targetModelCheck.message}` : '';
    targetSavePath.textContent = `便携附件目录：\n${project.attachmentRoot}\n\n在 Terre 中只需进入 portable 下对应的技术文件夹并选择 attachment.json，不需要进入 assets、files、model-profiles、presets 等内部资料目录。每个附件文件夹内都有 attachment.json、PNG 和说明；复制整个文件夹即可迁移。${check}`;
  }

  async function preflightSelectedTargetModel() {
    const project = selectedTargetProject();
    const profile = selectedProfile();
    if (!project?.writable || !profile) {
      targetModelCheck = undefined;
      renderTargetSavePath();
      return;
    }
    const key = `${project.name}\u0000${profile.modelPath}`;
    if (targetModelCheck?.key === key && targetModelCheck.state !== 'failed') return;
    const revision = ++targetModelCheckRevision;
    targetModelCheck = { key, state: 'checking', message: '正在核对当前人物及其必要文件…' };
    renderTargetSavePath();
    try {
      const result = await checkCreatorTargetModel(project.name, profile.modelPath, { signal: lifetime.signal });
      if (destroyed || revision !== targetModelCheckRevision) return;
      const presentation = creatorTargetModelPresentation(result, project.name);
      targetModelCheck = { key, state: presentation.state, message: presentation.message };
      if (presentation.notice) setStatus(presentation.notice, 'warning', key);
      else if (statusOwner.resolve(key)) {
        // Retire only this model check's warning, never a newer save/import error.
        notification.hidden = true;
      }
    } catch (error) {
      if (destroyed || revision !== targetModelCheckRevision) return;
      targetModelCheck = { key, state: 'failed', message: errorMessage(error) };
      setStatus(`目标游戏人物模型尚未就绪：${errorMessage(error)}`, 'warning', key);
    }
    renderTargetSavePath();
  }

  async function refreshServiceContext(announce = false) {
    const revision = ++serviceContextRevision;
    try {
      const next = await loadCreatorServiceContext({ signal: lifetime.signal });
      if (destroyed || revision !== serviceContextRevision) return;
      serviceContext = next;
      anchorStudio.refresh();
      modelImportPanel.refresh();
      for (const row of [...next.savedAttachments, ...next.authoringWorkspace.savedAttachments]) {
        revisions.observe(row.projectName, row.presetId, row.revision);
      }
      renderStoragePaths();
      renderLibraryProfiles();
      updateTargetAvailability();
      void preflightSelectedTargetModel();
      if (announce) setStatus(`已找到 ${serviceContext.targetProjects.length} 个可以保存的游戏。`);
      return true;
    } catch (error) {
      if (destroyed || revision !== serviceContextRevision) return;
      serviceContext = undefined;
      anchorStudio.refresh();
      renderStoragePaths();
      renderLibraryProfiles();
      updateTargetAvailability();
      setStatus(`无法读取制作器后台：${errorMessage(error)}。请核对本轮制作器入口和可见服务日志。`, false);
      return false;
    }
  }

  async function refreshLocalSavedAttachments(presetId: string) {
    // A completed local write does not invalidate model availability or game grants.
    // Refresh only its inventory, without discarding the last usable context on failure.
    const latest = await loadCreatorAuthoringAttachments({ signal: lifetime.signal });
    if (destroyed) return false;
    if (!serviceContext) throw new Error('后台资料暂不可用，请刷新资料列表；已保存文件不受影响。');
    if (!latest.savedAttachments.some(item => item.presetId === presetId))
      throw new Error('本次已保存附件尚未出现在资料列表，请刷新列表核对。');
    serviceContext.authoringWorkspace.savedAttachments = latest.savedAttachments;
    for (const row of latest.savedAttachments) revisions.observe(row.projectName, row.presetId, row.revision);
    renderStoragePaths();
    return true;
  }

  async function refreshGameSavedAttachments(projectName: string, presetId: string) {
    const latest = await loadCreatorProjectAttachments(projectName, { signal: lifetime.signal });
    if (destroyed) return false;
    if (!serviceContext || !latest.savedAttachments.some(row => row.projectName === projectName && row.presetId === presetId))
      throw new Error('本次已写入游戏的附件尚未出现在列表，请刷新列表核对；已保存文件不受影响。');
    serviceContext.savedAttachments = [
      ...serviceContext.savedAttachments.filter(row => row.projectName !== projectName),
      ...latest.savedAttachments,
    ];
    for (const row of latest.savedAttachments) revisions.observe(row.projectName, row.presetId, row.revision);
    renderStoragePaths();
    return true;
  }

  function updateTargetAvailability(announce = false) {
    const figure = selectedFigure();
    const profile = selectedProfile();
    const anchor = anchorField.select.value;
    const hasFigures = figures.length > 0;
    const gameStarted = Boolean(WebGAL.gameplay.pixiStage);
    const compatible = Boolean(figure && profile && profileMatchesModelPath(profile, figure.modelPath));
    const selectedOutfit = profiles.get(libraryProfileField.select.value);
    const selectionReady = Boolean(
      selectedOutfit && figure && profileMatchesModelPath(selectedOutfit, figure.modelPath),
    );
    const ready =
      selectionReady &&
      !libraryFigureSwitchInProgress &&
      figure?.state === 'ready' &&
      compatible &&
      Boolean(profile?.anchors.some((item) => compatibleAnchorNames(anchor).includes(item.name)));

    figureField.select.disabled = !hasFigures;
    profileField.select.disabled = !figure || compatibleProfiles(figure).length === 0;
    anchorField.select.disabled = !profile || profile.anchors.length === 0;

    let code = 'READY';
    let guidance = '人物与跟随位置已准备好，可以载入可用附件或选择自己的 PNG。';
    if (!hasFigures) {
      code = gameStarted ? 'NO_ACTIVE_FIGURE' : 'GAME_NOT_STARTED';
      guidance = gameStarted
        ? '当前场景没有可用人物。请先在上方选择本地人物与外观，系统会自动载入。'
        : '制作舞台仍在初始化，请查看顶部错误和服务日志；不会自动执行游戏剧情。';
    } else if (!figure) {
      code = 'FIGURE_ABSENT';
      guidance = '当前没有可选择的人物。请加载测试人物后重试。';
    } else if (figure.state === 'loading') {
      code = 'FIGURE_LOADING';
      guidance = '人物正在加载，完成后工作台会自动刷新。';
    } else if (figure.state === 'exiting') {
      code = 'FIGURE_DESTROYED_OR_EXITING';
      guidance = '人物正在切换，请稍等片刻。';
    } else if (figure.state === 'ambiguous') {
      code = 'FIGURE_AMBIGUOUS';
      guidance = '检测到重复的人物实例。请重新加载测试人物后再试。';
    } else if (figure.state !== 'ready') {
      code = 'FIGURE_INCOMPATIBLE';
      guidance = '当前人物还不能制作附件，请等待人物完全出现后再试。';
    } else if (!compatible) {
      code = 'NO_COMPATIBLE_MODEL_PROFILE';
      guidance = '当前人物还没有锚点组。可在第 1 步打开“锚点制作器”，自行点选并保存；不会自动猜测部位。';
    } else if (!anchor) {
      code = 'ANCHOR_ABSENT';
      guidance = '当前 Profile 没有可用的跟随位置，需要有效的模型适配资料。';
    }

    if (!selectionReady && !libraryFigureSwitchInProgress) {
      code = 'SELECTED_MODEL_NOT_LOADED';
      guidance = '请选择角色和服装并等待自动载入；若失败，可点击“重新载入所选立绘”。附件将用于实际载入的立绘。';
    }
    targetGuidance.textContent = guidance;
    targetGuidance.style.borderColor = ready ? '#4fba7c' : '#d89b4d';
    const disabledReason = `${code}：${guidance}`;
    for (const control of targetDependentButtons) setButtonEnabled(control, ready, disabledReason);
    setButtonEnabled(
      loadSavedAttachmentButton,
      ready && Boolean(selectedSavedAttachment()),
      ready ? '还没有可载入的已保存附件；先保存一个附件或重新读取游戏列表。' : disabledReason,
    );
    setButtonEnabled(
      loadExactAdaptationButton,
      Boolean(selectedSavedAttachment()) && !libraryFigureSwitchInProgress,
      '请先选择已有附件。',
    );
    const locallySavable = Boolean(
      serviceContext?.authoringWorkspace.status === 'AUTHORIZED_EXISTING_WORKSPACE' &&
        draft.modelProfileId &&
        (binaries.front || binaries.back),
    );
    setButtonEnabled(saveLocalButton, locallySavable, '请先载入附件或图片并确定有效适配。');
    setButtonEnabled(saveAsNewDraftButton, locallySavable, '请先载入附件或图片。');
    setButtonEnabled(exportFolderButton, locallySavable, '请先载入附件或图片。');
    setButtonEnabled(
      saveApplyButton,
      ready && Boolean(selectedTargetProject()?.writable),
      ready ? '请先在第 4 步选择要保存到哪个游戏。' : disabledReason,
    );
    setButtonEnabled(
      showLibraryProfileButton,
      gameStarted && Boolean(libraryProfileField.select.value) && !libraryFigureSwitchInProgress,
      gameStarted ? '请先明确选择制作区中实际存在的本地人物与外观。' : '制作舞台尚未准备好。',
    );
    for (const [control, id] of [
      [copyPresetButton, 'straw-hat'],
      [kemomimiSampleButton, 'kemomimi'],
      [haloSampleButton, 'halo'],
      [flowerSampleButton, 'flower'],
      [roseSampleButton, 'rose'],
    ] as const) {
      const sample = serviceContext?.builtinSamples.find((item) => item.id === id);
      setButtonEnabled(control, ready && Boolean(sample), '本制作区尚未提供这个完整样例；可以打开已有附件或导入 PNG。');
    }
    if (announce) setStatus(guidance, ready ? true : 'warning');
  }

  function selectedFigure() {
    return figures.find((figure) => figure.figureKey === figureField.select.value);
  }

  function selectedProfile() {
    return editingProfile?.modelProfileId === profileField.select.value ? editingProfile : profiles.get(profileField.select.value);
  }

  function compatibleProfiles(figure: CreatorFigureView | undefined) {
    return figure?.compatibleProfiles ?? [];
  }

  function renderProjectFacts() {
    if (!projectSnapshot) {
      projectFacts.textContent =
        '尚未读取制作区保存记录。\n普通用户不需要操作这里；直接在第 4 步保存附件，第 5 步按需添加到游戏即可。';
      projectFacts.style.borderColor = '#d89b4d';
      loadProjectPresetButton.disabled = true;
      openPreviewButton.disabled = true;
      return;
    }
    const project = projectSnapshot.project;
    projectFacts.textContent = [
      '已经读取制作区保存记录',
      `release 版本：${project.releaseVersion}`,
      `release 根目录：${project.releaseRoot}`,
      `制作区根目录：${project.root}`,
      `项目入口：${project.projectEntry}`,
      `可写状态：${project.writable ? '可以保存' : '不可写'}`,
      `release manifest：${project.releaseManifestPath}`,
      `ownership 状态：${project.ownershipStatus}`,
      '原始游戏：受保护，不连接、不修改',
      `figure：${draft.figureKey || '等待游戏 figure 注册'}`,
      `model profile：${draft.modelProfileId || projectSnapshot.profile.modelProfileId}`,
      `semantic anchor：${draft.anchorName || projectSnapshot.preset.anchorName}`,
      `attachment asset：${draft.attachmentDefinitionId || projectSnapshot.asset.attachmentAssetId}`,
      `placement preset：${draft.presetId || projectSnapshot.preset.presetId}`,
      `未保存修改：${projectDirty ? '是' : '否'}`,
      `正式配置：${projectSnapshot.ownership.manifestPath}`,
      `最近保存：${lastApplyResult?.appliedAt ?? projectSnapshot.appliedAt ?? '初始配置'}`,
    ].join('\n');
    projectFacts.style.borderColor = '#4fba7c';
    loadProjectPresetButton.disabled = false;
    openPreviewButton.disabled = !lastApplyResult;
  }

  async function loadRc1ProjectPreset() {
    if (!projectSnapshot) return setStatus('请先读取明确选择的制作区附件和适配。', 'warning');
    await loadSelectedSavedAttachment(projectSnapshot);
  }

  async function ensureProfileFigure(profile: Live2DModelProfile, flowRevision: number) {
    const stage = WebGAL.gameplay.pixiStage;
    if (!stage) throw new Error('CREATOR_STAGE_NOT_READY');
    const active = stage.getActiveLive2DFigure(draft.figureKey);
    if (
      active.status === 'ready' &&
      profileMatchesModelPath(profile, active.figure.normalizedSourceUrl) &&
      runtime.figureGeneration(draft.figureKey) === active.figure.uuid
    ) {
      return { figureKey: draft.figureKey, generation: active.figure.uuid };
    }
    const previousSwitchGuard = libraryFigureSwitchInProgress;
    libraryFigureSwitchInProgress = true;
    try {
      const ready = await replaceCreatorFigure({
        stage,
        manager: stageStateManager,
        runtime,
        profile,
        selectedKey: figureField.select.value || draft.figureKey,
        signal: lifetime.signal,
      });
      if (!isPreviewFlowCurrent(flowRevision)) throw new Error('CREATOR_FIGURE_SELECTION_SUPERSEDED');
      return ready;
    } finally {
      libraryFigureSwitchInProgress = previousSwitchGuard;
    }
  }

  async function commitProfileFigure(
    profile: Live2DModelProfile,
    nextDraft: CreatorDraft,
    revision: number,
    commitContent = () => {},
    modelChangeApproved = false,
  ) {
    if (!modelChangeApproved && !anchorStudio.requestModelChange(profile.modelPath)) return false;
    return commitCreatorFigureSelection({
      suspend: () => {
        const previous = libraryFigureSwitchInProgress;
        libraryFigureSwitchInProgress = true;
        return () => {
          libraryFigureSwitchInProgress = previous;
        };
      },
      acquire: () => { stopHandPose(); return ensureProfileFigure(profile, revision); },
      refresh: () => refreshFigures(),
      current: () => isPreviewFlowCurrent(revision),
      commit: (ready) => {
        nextDraft.figureKey = ready.figureKey;
        nextDraft.figureGeneration = ready.generation;
        draft = nextDraft;
        editingProfile = profile;
        figureField.select.value = ready.figureKey;
        commitContent();
        for (const figure of figures) {
          if (profileMatchesModelPath(profile, figure.modelPath)) figure.compatibleProfiles = [...figure.compatibleProfiles.filter(p => p.modelProfileId !== profile.modelProfileId), profile];
        }
        refreshProfiles(profile.modelProfileId);
        syncCharacterSelection(profile);
        writeDraftInputs();
        invalidateExportPlan('已切换立绘与对应参数，请保存后检查。');
        updateTargetFacts();
      },
    });
  }

  function invalidateExportPlan(reason?: string) {
    exportRevision += 1;
    packageRevision = -1;
    packageResult = undefined;
    canonicalExportJson = '';
    exportSummary.textContent = 'ROUND-TRIP：尚未生成';
    lastGameSave = undefined;
    lastApplyResult = undefined;
    openPreviewButton.disabled = true;
    if (reason) exportPreview.textContent = `${reason}\n请重新生成导出预览 / round-trip。`;
    if (projectSnapshot) {
      projectDirty = true;
      renderProjectFacts();
    }
  }

  function readDraftInputs() {
    draft.attachmentDefinitionId = assetId.input.value.trim();
    draft.presetId = presetId.input.value.trim();
    draft.displayName = displayName.input.value;
    draft.attachmentInstanceId = instanceId.input.value.trim();
    draft.slot = slot.input.value.trim();
    draft.layerMode = layerMode.select.value as CreatorDraft['layerMode'];
    draft.placement.offset.x = offsetX.input.valueAsNumber;
    draft.placement.offset.y = offsetY.input.valueAsNumber;
    draft.placement.localScaleX = localScaleX.input.valueAsNumber;
    draft.placement.localScaleY = localScaleY.input.valueAsNumber;
    // Preserve a useful fallback for older readers that only know uniform localScale.
    draft.placement.localScale = draft.placement.localScaleX;
    draft.placement.rotationOffsetRad = degreesToRadians(rotationDeg.input.valueAsNumber);
    draft.placement.spriteAnchor.x = pivotX.input.valueAsNumber;
    draft.placement.spriteAnchor.y = pivotY.input.valueAsNumber;
    draft.placement.scaleMode = scaleMode.select.value as CreatorDraft['placement']['scaleMode'];
    const advancedEnabled = advancedEffectsEnabled.checked;
    draft.visualState.skew = advancedEnabled
      ? {
          x: degreesToRadians(skewXDeg.input.valueAsNumber),
          y: degreesToRadians(skewYDeg.input.valueAsNumber),
        }
      : { x: 0, y: 0 };
    draft.visualState.opacity = opacity.input.valueAsNumber;
    draft.visualState.appearance = advancedEnabled
      ? {
          blur: blurAmount.input.valueAsNumber,
          brightness: brightness.input.valueAsNumber,
          contrast: contrast.input.valueAsNumber,
          saturation: saturation.input.valueAsNumber,
          gamma: gamma.input.valueAsNumber,
          color: {
            red: colorRed.input.valueAsNumber,
            green: colorGreen.input.valueAsNumber,
            blue: colorBlue.input.valueAsNumber,
          },
          bevel: {
            strength: bevelStrength.input.valueAsNumber,
            thickness: bevelThickness.input.valueAsNumber,
            rotation: bevelRotation.input.valueAsNumber,
            softness: bevelSoftness.input.valueAsNumber,
            color: {
              red: bevelRed.input.valueAsNumber,
              green: bevelGreen.input.valueAsNumber,
              blue: bevelBlue.input.valueAsNumber,
            },
          },
          bloom: {
            strength: bloomStrength.input.valueAsNumber,
            brightness: bloomBrightness.input.valueAsNumber,
            blur: bloomBlur.input.valueAsNumber,
            threshold: bloomThreshold.input.valueAsNumber,
          },
          shockwave: shockwave.input.valueAsNumber,
          radiusAlpha: radiusAlpha.input.valueAsNumber,
        }
      : {
          blur: 0,
          brightness: 1,
          contrast: 1,
          saturation: 1,
          gamma: 1,
          color: { red: 255, green: 255, blue: 255 },
          bevel: {
            strength: 0,
            thickness: 0,
            rotation: 0,
            softness: 0,
            color: { red: 255, green: 255, blue: 255 },
          },
          bloom: { strength: 0, brightness: 1, blur: 0, threshold: 0 },
          shockwave: 0,
          radiusAlpha: 0,
        };
    invalidateExportPlan();
  }

  function writeDraftInputs() {
    renderHandInputs();
    invalidateExportPlan();
    assetId.input.value = draft.attachmentDefinitionId;
    presetId.input.value = draft.presetId;
    displayName.input.value = draft.displayName;
    instanceId.input.value = draft.attachmentInstanceId;
    slot.input.value = draft.slot;
    layerMode.select.value = draft.layerMode;
    updateLayerRows();
    offsetX.input.value = String(draft.placement.offset.x);
    offsetY.input.value = String(draft.placement.offset.y);
    localScaleX.input.value = String(draft.placement.localScaleX ?? draft.placement.localScale);
    localScaleY.input.value = String(draft.placement.localScaleY ?? draft.placement.localScale);
    rotationDeg.input.value = String(radiansToDegrees(draft.placement.rotationOffsetRad));
    pivotX.input.value = String(draft.placement.spriteAnchor.x);
    pivotY.input.value = String(draft.placement.spriteAnchor.y);
    scaleMode.select.value = draft.placement.scaleMode;
    const appearance = draft.visualState.appearance;
    const bevel = appearance?.bevel;
    const bloom = appearance?.bloom;
    advancedEffectsEnabled.checked = creatorAdvancedEffectsActive(draft.visualState);
    skewXDeg.input.value = String(radiansToDegrees(draft.visualState.skew?.x ?? 0));
    skewYDeg.input.value = String(radiansToDegrees(draft.visualState.skew?.y ?? 0));
    opacity.input.value = String(draft.visualState.opacity);
    blurAmount.input.value = String(appearance?.blur ?? 0);
    brightness.input.value = String(appearance?.brightness ?? 1);
    contrast.input.value = String(appearance?.contrast ?? 1);
    saturation.input.value = String(appearance?.saturation ?? 1);
    gamma.input.value = String(appearance?.gamma ?? 1);
    colorRed.input.value = String(appearance?.color.red ?? 255);
    colorGreen.input.value = String(appearance?.color.green ?? 255);
    colorBlue.input.value = String(appearance?.color.blue ?? 255);
    bevelStrength.input.value = String(bevel?.strength ?? 0);
    bevelThickness.input.value = String(bevel?.thickness ?? 0);
    bevelRotation.input.value = String(bevel?.rotation ?? 0);
    bevelSoftness.input.value = String(bevel?.softness ?? 0);
    bevelRed.input.value = String(bevel?.color.red ?? 255);
    bevelGreen.input.value = String(bevel?.color.green ?? 255);
    bevelBlue.input.value = String(bevel?.color.blue ?? 255);
    bloomStrength.input.value = String(bloom?.strength ?? 0);
    bloomBrightness.input.value = String(bloom?.brightness ?? 1);
    bloomBlur.input.value = String(bloom?.blur ?? 0);
    bloomThreshold.input.value = String(bloom?.threshold ?? 0);
    shockwave.input.value = String(appearance?.shockwave ?? 0);
    radiusAlpha.input.value = String(appearance?.radiusAlpha ?? 0);
    updateAdvancedEffectsUi();
    renderLayerFacts();
    renderPreviewFacts();
    updateTargetAvailability();
  }

  function renderLayerFacts() {
    const render = (name: 'back' | 'front', facts: HTMLPreElement) => {
      const metadata = draft.layers[name];
      facts.textContent = metadata
        ? `${name}: ${metadata.sourceFileName}\nMIME: ${metadata.mime}\nbytes: ${metadata.bytes}\n${metadata.width}×${
            metadata.height
          }\nSHA-256: ${metadata.sha256}\n输出: ${metadata.outputPath ?? metadata.outputFileName}\ndecode: success`
        : `${name}: 未选择`;
    };
    render('back', backFacts);
    render('front', frontFacts);
    const selectedLayers = (['back', 'front'] as const)
      .filter((layer) => Boolean(binaries[layer]))
      .map((layer) => `${layer === 'back' ? '后层' : '前层'}：${binaries[layer]!.metadata.sourceFileName}`);
    layerSelectionSummary.textContent = selectedLayers.length
      ? `已载入 ${selectedLayers.join('；')}。现在可以拖动位置并保存。`
      : '尚未选择附件图片；点击草帽、兽耳或光环会自动载入图片。';
    layerSelectionSummary.style.color = selectedLayers.length ? '#b8ffc9' : '#c7d2df';
    const repositoryPreview = Boolean(draft.sourcePresetId || preview.binding());
    previewResourceFacts.textContent = repositoryPreview
      ? '预览资源：已从当前仓库引用 back/front，可用于 shared-runtime 预览。'
      : '预览资源：当前草稿尚未引用仓库 PNG。';
    const describe = (name: 'back' | 'front') => {
      const input = binaries[name];
      return input
        ? `${name}：已选择 ${input.metadata.sourceFileName} / ${input.bytes.byteLength} bytes / ${input.metadata.sha256}`
        : `${name}：未明确选择`;
    };
    exportMaterialFacts.textContent = `导出素材：\n${describe('back')}\n${describe('front')}\n${
      binaries.back && binaries.front
        ? '可生成导出预览。'
        : '导出预览将在所需 PNG 明确选择后启用。当前仓库预览不等于已加入导出包。'
    }`;
  }

  function renderPreviewFacts() {
    previewFacts.textContent = JSON.stringify(
      {
        ...preview.diagnostics(),
        validation: validateCreatorDraft(draft, selectedProfile()),
      },
      null,
      2,
    );
  }

  let motionInventoryRevision = 0;
  async function refreshMotionOptions() {
    const revision = ++motionInventoryRevision;
    const previous = motion.select.value;
    motion.select.replaceChildren();
    const profile = selectedProfile();
    const fallback = creatorCatalogEntry(profileField.select.value)?.representativeMotions ?? [];
    let values: readonly string[] = fallback;
    try {
      if (profile?.modelPath)
        values = await loadCreatorMotionInventory(profile.modelPath, undefined, { signal: lifetime.signal });
    } catch (error) {
      if (revision === motionInventoryRevision) {
        motionStatus.textContent = `动作列表读取失败，已显示代表动作：${errorMessage(error)}`;
      }
    }
    if (destroyed || revision !== motionInventoryRevision) return;
    for (const value of values) {
      const option = el('option', value);
      option.value = value;
      motion.select.append(option);
    }
    if (previous && values.includes(previous)) motion.select.value = previous;
    if (!values.length) emptyOption(motion.select, '这个人物没有可播放的动作');
  }

  function refreshAnchors(preferred?: string) {
    anchorField.select.replaceChildren();
    const profile = selectedProfile();
    for (const anchor of profile?.anchors ?? []) {
      const option = el('option', anchorLabel(anchor));
      option.value = anchor.name;
      option.title = `稳定锚点 ID：${anchor.name}\n锚点配置：${anchor.anchorProfileId}\n绑定 drawable：${anchor.drawableId}`;
      anchorField.select.append(option);
    }
    const compatiblePreferred = preferred ? compatibleAnchorNames(preferred) : [];
    const preferredAnchor =
      profile?.anchors.find((anchor) => anchor.name === preferred) ??
      profile?.anchors.find((anchor) => compatiblePreferred.includes(anchor.name));
    if (preferredAnchor) {
      anchorField.select.value = preferredAnchor.name;
    }
    if (!profile?.anchors.length) emptyOption(anchorField.select, '无 named anchor');
    if (preferred === '' && (binaries.front || binaries.back)) {
      const missing = el('option', '请选择当前立绘可用的跟随部位');
      missing.value = '';
      anchorField.select.append(missing);
      anchorField.select.value = '';
    }
    if (preferred && !preferredAnchor) {
      const missing = el('option', `原锚点尚不可用：${preferred}`);
      missing.value = preferred;
      missing.disabled = true;
      anchorField.select.append(missing);
      anchorField.select.value = preferred;
    }
    draft.anchorName = anchorField.select.value;
    void refreshMotionOptions();
  }

  function refreshProfiles(preferred?: string) {
    profileField.select.replaceChildren();
    const figure = selectedFigure();
    for (const profile of compatibleProfiles(figure)) {
      const option = el('option', profileLabel(profile));
      option.value = profile.modelProfileId;
      option.title = `稳定 Profile ID：${profile.modelProfileId}\n模型路径：${profile.modelPath}`;
      profileField.select.append(option);
    }
    if (preferred && compatibleProfiles(figure).some((profile) => profile.modelProfileId === preferred)) {
      profileField.select.value = preferred;
    }
    if (!compatibleProfiles(figure).length) emptyOption(profileField.select, '无 compatible profile');
    if (preferred && !compatibleProfiles(figure).some((profile) => profile.modelProfileId === preferred)) {
      const missing = el('option', `原 Profile 尚不可用：${preferred}`);
      missing.value = preferred;
      missing.disabled = true;
      profileField.select.append(missing);
      profileField.select.value = preferred;
    }
    draft.modelProfileId = profileField.select.value;
    refreshAnchors(draft.anchorName);
    if (figure && !compatibleProfiles(figure).length) {
      setStatus(
        '这套立绘尚无锚点组；可以在第 1 步“锚点制作器”中自行创建。人物载入未失败。',
        'warning',
      );
    }
  }

  function updateTargetFacts() {
    const figure = selectedFigure();
    const profile = selectedProfile();
    targetFacts.textContent = JSON.stringify(
      {
        figureKey: figure?.figureKey ?? null,
        generation: figure?.generation ?? null,
        generationShort: figure?.generationShort ?? null,
        modelPath: figure?.modelPath ?? null,
        sourceType: figure?.sourceType ?? null,
        state: figure?.state ?? 'absent',
        compatible: Boolean(profile && figure && profileMatchesModelPath(profile, figure.modelPath)),
        modelProfileId: profile?.modelProfileId ?? null,
        namedAnchors: profile?.anchors.map((anchor) => anchor.name) ?? [],
        runtimeFingerprint: profile?.fingerprint ?? null,
      },
      null,
      2,
    );
  }

  async function refreshFigures(announce = false) {
    if (destroyed) return;
    anchorStudio.refresh();
    const previousFigureKey = draft.figureKey;
    const previousFigureGeneration = draft.figureGeneration;
    const previousTarget = [draft.figureKey, draft.figureGeneration, draft.modelProfileId, draft.anchorName].join('|');
    const stage = WebGAL.gameplay.pixiStage;
    const next: CreatorFigureView[] = [];
    if (!stage) {
      figures = [];
      draft.figureKey = '';
      draft.figureGeneration = '';
      // Preserve the explicit adaptation identity while its figure is absent.
      if (previousTarget !== '|||') {
        invalidateExportPlan('游戏舞台已销毁，旧导出计划已失效。');
      }
      emptyOption(figureField.select, '无活动 figure · GAME_NOT_STARTED');
      emptyOption(profileField.select, '无 compatible profile');
      emptyOption(anchorField.select, '无 named anchor');
      updateTargetFacts();
      updateTargetAvailability(announce);
      return;
    }
    for (const item of stage.figureObjects) {
      const active = stage.getActiveLive2DFigure(item.key);
      const figure = 'figure' in active ? active.figure : undefined;
      const modelPath = figure?.normalizedSourceUrl ?? item.sourceUrl;
      next.push({
        figureKey: item.key,
        generation: item.uuid,
        generationShort: item.uuid.slice(0, 8),
        modelPath,
        sourceType: item.sourceType,
        state:
          item.sourceType !== 'live2d'
            ? 'not-live2d'
            : item.isExiting
            ? 'exiting'
            : active.status === 'ready'
            ? 'ready'
            : active.status === 'ambiguous'
            ? 'ambiguous'
            : 'loading',
        compatibleProfiles: [...new Map([...profiles, ...(editingProfile ? [[editingProfile.modelProfileId, editingProfile] as const] : [])]).values()].filter((profile) => profileMatchesModelPath(profile, modelPath)),
      });
    }
    figures = next;
    const previous = figureField.select.value || draft.figureKey;
    figureField.select.replaceChildren();
    for (const figure of figures) {
      const option = el('option', `${figure.figureKey} · ${figure.generationShort} · ${figure.state}`);
      option.value = figure.figureKey;
      figureField.select.append(option);
    }
    if (!figures.length) emptyOption(figureField.select, '无活动 figure · GAME_NOT_STARTED');
    if (figures.some((figure) => figure.figureKey === previous)) figureField.select.value = previous;
    if (libraryFigureSwitchInProgress) {
      updateTargetAvailability();
      return;
    }
    const figure = selectedFigure();
    draft.figureKey = figure?.figureKey ?? '';
    draft.figureGeneration = figure?.state === 'ready' ? figure.generation : '';
    anchorStudio.refresh();
    refreshProfiles(draft.modelProfileId);
    const nextTarget = [draft.figureKey, draft.figureGeneration, draft.modelProfileId, draft.anchorName].join('|');
    if (nextTarget !== previousTarget) {
      invalidateExportPlan('活动 figure/profile/anchor 绑定已改变，旧导出计划已失效。');
    }
    updateTargetFacts();
    renderPreviewFacts();
    updateTargetAvailability(announce);
    void preflightSelectedTargetModel();
    if (
      previousFigureKey === draft.figureKey &&
      previousFigureGeneration &&
      draft.figureGeneration &&
      previousFigureGeneration !== draft.figureGeneration &&
      (binaries.back || binaries.front) &&
      !libraryFigureSwitchInProgress
    ) {
      if (!(await clearPreview())) return;
      const revision = beginPreviewFlow();
      const rebound = await bindPreview(revision);
      if (!isPreviewFlowCurrent(revision)) return;
      audit(
        'preview.rebind',
        draft.figureKey,
        rebound ? 'visible' : 'failed',
        `${previousFigureGeneration} -> ${draft.figureGeneration}`,
      );
    }
  }

  function activeReadyFigure() {
    const stage = WebGAL.gameplay.pixiStage;
    const active = stage?.getActiveLive2DFigure(draft.figureKey);
    return active ? readyFigure(active) : undefined;
  }

  function updateDiagnosticsBinding() {
    const flags = Object.fromEntries(
      Object.entries(debugFlags).map(([key, input]) => [key, input.checked]),
    ) as unknown as CreatorDiagnosticsFlags;
    diagnostics.setFlags(flags);
    if (!Object.values(flags).some(Boolean)) {
      diagnostics.clear();
      return;
    }
    const active = activeReadyFigure();
    const profile = selectedProfile();
    if (!active || !profile || active.uuid !== draft.figureGeneration) {
      diagnostics.clear();
      return;
    }
    diagnostics.bind({
      figureKey: draft.figureKey,
      generation: draft.figureGeneration,
      model: active.model,
      outerContainer: active.outerContainer,
      profile,
      anchorName: draft.anchorName,
    });
  }

  async function waitForPreviewPaint() {
    // commitVisible owns exact Runtime-frame acknowledgement and its bounded cancellation.
    if (destroyed) throw new Error('CREATOR_WORKBENCH_CLOSED');
  }

  function beginPreviewFlow() {
    return previewFlow.begin();
  }

  function isPreviewFlowCurrent(revision: number) {
    return previewFlow.isCurrent(revision);
  }

  async function clearPreview(expectedRevision?: number) {
    diagnostics.clear();
    return previewFlow.clear(() => preview.clear(), expectedRevision);
  }

  async function bindPreview(flowRevision = beginPreviewFlow()) {
    readDraftInputs();
    if (!binaries.back && !binaries.front) {
      setStatus('请先选择至少一张 PNG；空白附件不会创建或导出。', 'warning');
      return false;
    }
    const profile = selectedProfile();
    if (!profile) {
      setStatus('当前人物没有可用的模型 Profile；无法建立随动预览。', false);
      return false;
    }
    if (!profileMatchesModelPath(profile, selectedFigure()?.modelPath ?? '')) {
      setStatus('PRESET_MODEL_INCOMPATIBLE：所选 profile 与当前 figure model path 不一致。', false);
      return false;
    }
    if (draft.handBinding) {
      const stage = WebGAL.gameplay.pixiStage;
      if (!stage) throw new Error('CREATOR_STAGE_NOT_READY');
      if (!(await waitForCreatorHandRenderer({
        stage, figureKey: draft.figureKey, generation: draft.figureGeneration,
        current: () => isPreviewFlowCurrent(flowRevision), signal: lifetime.signal,
      }))) return false;
    }
    const capturedDraft = cloneCreatorDraft(draft);
    const capturedBinaries = { ...binaries, layerMode: capturedDraft.layerMode };
    const bound = await preview.bind(capturedDraft, profile);
    if (!isPreviewFlowCurrent(flowRevision)) return false;
    if (!bound) {
      const failure = preview.bindFailure();
      const detail = failure ? `${failure.code}：${failure.message}` : 'PREVIEW_NOT_READY：附件运行时未能创建预览';
      setStatus(`shared runtime preview 创建失败：${detail}`, false);
      return false;
    }
    preview.setVisible(false);
    const textureCommitted = await preview.replaceTextures(capturedBinaries);
    if (!isPreviewFlowCurrent(flowRevision)) return false;
    if (!textureCommitted) {
      if (!(await clearPreview(flowRevision))) return false;
      setStatus('PREVIEW_TEXTURE_COMMIT_FAILED：PNG 已读取，但没有提交到当前人物；未显示旧附件。', false);
      return false;
    }
    if (!preview.applyPlacement(capturedDraft)) {
      if (!(await clearPreview(flowRevision))) return false;
      setStatus('PREVIEW_PLACEMENT_COMMIT_FAILED：PNG 已读取，但位置没有提交；预览已安全清理。', false);
      return false;
    }
    await waitForPreviewPaint();
    if (!isPreviewFlowCurrent(flowRevision)) return false;
    if (!(await preview.commitVisible(true, capturedDraft))) {
      if (!isPreviewFlowCurrent(flowRevision)) return false;
      if (!(await clearPreview(flowRevision))) return false;
      setStatus('PREVIEW_VISIBILITY_COMMIT_FAILED：预览无法显示，已安全清理。', false);
      return false;
    }
    if (!isPreviewFlowCurrent(flowRevision)) return false;
    updateDiagnosticsBinding();
    renderPreviewFacts();
    audit('preview.bind', draft.presetId, 'visible', `${draft.figureKey}@${draft.figureGeneration}`);
    setStatus(preview.handStateDiagnostic()==='unsupported-state' ? '附件已载入；当前手型未配置，暂不显示。请播放已配置手型的动作或明确点击检查手型。' : '附件预览已经显示，可以调整位置。', preview.handStateDiagnostic()==='unsupported-state' ? 'warning' : true);
    return true;
  }

  async function importLayer(layer: 'back' | 'front', input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const flowRevision = beginPreviewFlow();
    let imageLoaded = false;
    try {
      setStatus(`正在读取${layer === 'front' ? '前层' : '后层'}图片…`, 'info');
      const imported = await importPngFile(file, layer);
      if (!isPreviewFlowCurrent(flowRevision)) return;
      const otherLayer = layer === 'front' ? binaries.back : binaries.front;
      const combinedBytes = imported.bytes.byteLength + (otherLayer?.bytes.byteLength ?? 0);
      if (combinedBytes > CREATOR_PNG_MAX_TOTAL_BYTES) {
        throw new CreatorPngError(
          'TOTAL_BYTES_TOO_LARGE',
          `前后层 PNG 合计不能超过 ${CREATOR_PNG_MAX_TOTAL_BYTES / 1024 / 1024} MiB（当前 ${(
            combinedBytes /
            1024 /
            1024
          ).toFixed(2)} MiB）；请压缩图片后重试`,
        );
      }
      binaries[layer] = imported;
      draft.layers[layer] = { ...imported.metadata };
      imageLoaded = true;
      invalidateExportPlan(`${layer} PNG 已改变，旧导出计划已失效。`);
      renderLayerFacts();
      let previewUpdated = false;
      if (preview.binding()) {
        preview.setVisible(false);
        const committed = await preview.replaceTextures({ ...binaries, layerMode: draft.layerMode });
        if (!isPreviewFlowCurrent(flowRevision)) return;
        if (!committed || !preview.applyPlacement(draft)) {
          if (!(await clearPreview(flowRevision))) return;
          throw new Error('PREVIEW_TEXTURE_COMMIT_FAILED');
        }
        await waitForPreviewPaint();
        if (!isPreviewFlowCurrent(flowRevision)) return;
        if (!(await preview.commitVisible(true, draft))) {
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (!(await clearPreview(flowRevision))) return;
          throw new Error('PREVIEW_VISIBILITY_COMMIT_FAILED');
        }
        if (!isPreviewFlowCurrent(flowRevision)) return;
        renderPreviewFacts();
        previewUpdated = true;
      } else if (selectedFigure()?.state === 'ready') {
        const previewReady = await bindPreview(flowRevision);
        if (!previewReady) {
          const failure = preview.bindFailure();
          const detail = failure ? `${failure.code}：${failure.message}` : 'PREVIEW_NOT_READY：附件运行时未能创建预览';
          setStatus(`图片已经读取，但预览没有显示：${detail}。请点“重新载入附件预览”重试。`, false);
          return;
        }
        previewUpdated = true;
      }
      audit('image.import', layer, previewUpdated ? 'visible' : 'loaded', file.name);
      setStatus(`图片已经读取${previewUpdated ? '并显示在人物画面上' : ''}。原图片仍保留在原文件夹。`);
    } catch (error) {
      if (!isPreviewFlowCurrent(flowRevision)) return;
      input.value = '';
      setStatus(`${imageLoaded ? '图片已读取，但附件绑定或预览失败' : '图片读取失败'}：${errorMessage(error)}`, false);
    }
  }

  async function loadPresetBinaries(preset: AttachmentPlacementPreset) {
    const assetResponse = await fetch(profileLoader.urlForAttachmentAsset(preset.attachmentAssetId), {
      cache: 'no-store',
    });
    if (!assetResponse.ok) throw new Error(`BUILTIN_SAMPLE_ASSET_HTTP_${assetResponse.status}`);
    const asset = parseAttachmentAssetDefinition(await assetResponse.json(), assetResponse.url);
    const inputs: { back?: CreatorBinaryInput; front?: CreatorBinaryInput } = {};
    for (const layer of ['back', 'front'] as const) {
      const source = asset.layers[layer] ?? asset.attachedLayers?.[layer];
      if (!source) continue;
      const url = new URL(source, document.baseURI);
      if (url.origin !== window.location.origin) {
        throw new Error(`BUILTIN_SAMPLE_CROSS_ORIGIN_LAYER:${source}`);
      }
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`BUILTIN_SAMPLE_LAYER_HTTP_${response.status}:${url.pathname}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const sourceFileName = decodeURIComponent(url.pathname.split('/').pop() ?? `${layer}.png`);
      inputs[layer] = await importProjectPngBytes({
        bytes,
        layer,
        sourceFileName,
        outputPath: source.replace(/^\.\//, ''),
      });
    }
    if (!inputs.back && !inputs.front) throw new Error(`BUILTIN_SAMPLE_HAS_NO_PNG:${preset.presetId}`);
    return { inputs, slot: asset.slot };
  }

  async function loadCurrentPresetAsCopy(configIdOverride?: string, sampleName?: string) {
    const entry = creatorCatalogEntry(profileField.select.value);
    const configId = configIdOverride ?? entry?.sourcePresetByAnchor[anchorField.select.value];
    const figure = selectedFigure();
    if (!configId || !figure) return setStatus('当前人物还没有准备好，请先选择本地人物与外观并载入所选立绘。', false);
    setStatus(`正在读取${sampleName ?? '现成附件'}的最新参数…`, 'info');
    const latest = await loadCreatorAuthoringAttachments({ signal: lifetime.signal });
    if (destroyed) return;
    const savedItems = latest.savedAttachments;
    if (serviceContext) serviceContext.authoringWorkspace.savedAttachments = savedItems;
    const savedSample =
      savedItems?.find((item) => item.presetId === configId) ??
      (/^v2\/(straw-hat-both|kemomimi-front|halo-front|flower-front|rose-front)-v1$/.test(configId)
        ? savedItems?.find((item) => item.presetId === configId.replace('v2/', 'v2/anon-'))
        : undefined);
    if (savedSample) {
      savedAttachmentField.select.value = savedSample.key;
      renderSavedAdaptations();
      return loadSelectedSavedAttachment(undefined, false, savedSample);
    }
    const factory = serviceContext?.builtinSamples?.find(sample => sample.presetId === configId);
    if (factory?.completeFolder) {
      const packageResult = await loadCreatorFactorySample(factory.id, { signal: lifetime.signal });
      const rows = (packageResult.packageDocument as { adaptations: CreatorPackageAdaptation[] }).adaptations;
      const summary: CreatorSavedAttachmentSummary = {
        key: `factory-library|${configId}`, projectName: 'factory-library', presetId: configId,
        displayName: factory.name, revision: packageResult.revision, adaptationCount: rows.length,
        modelProfileIds: rows.map(row => row.modelProfile.modelProfileId),
        anchorNames: rows.map(row => row.preset.anchorName),
        modelPaths: rows.map(row => row.modelProfile.modelPath),
      };
      return loadSelectedSavedAttachment(undefined, false, summary, packageResult);
    }
    if (!requestAttachmentReplace()) return;
    const flowRevision = beginPreviewFlow();
    try {
      setStatus(`正在载入${sampleName ?? '现成附件'}…`, 'info');
      const selectedProfileId = profileField.select.value;
      const response = await fetch(profileLoader.urlForPreset(configId));
      if (!isPreviewFlowCurrent(flowRevision)) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const preset = parseAttachmentPlacementPreset(await response.json(), response.url);
      if (!isPreviewFlowCurrent(flowRevision)) return;
      // Some historical calibrated Profiles are intentionally absent from the
      // ordinary outfit index. Resolve the template's explicit identity on demand.
      if (!profiles.has(preset.modelProfileId)) {
        const profileResponse = await fetch(profileLoader.urlForModelProfile(preset.modelProfileId), {
          cache: 'no-store', signal: lifetime.signal,
        });
        if (!isPreviewFlowCurrent(flowRevision)) return;
        if (profileResponse.ok) {
          const original = parseLive2DModelProfile(await profileResponse.json(), profileResponse.url);
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (original.modelProfileId !== preset.modelProfileId) throw new Error('CREATOR_PROFILE_ID_MISMATCH');
          profiles.set(original.modelProfileId, original);
          if (profileMatchesModelPath(original, figure.modelPath)) figure.compatibleProfiles.push(original);
        } else if (profileResponse.status !== 404) throw new Error(`HTTP ${profileResponse.status}`);
      }
      const calibratedProfileId = calibratedSampleProfileId(preset.modelProfileId, selectedProfileId, profiles);
      const selectedTargetProfile = profiles.get(selectedProfileId);
      const targetProfileId = selectedTargetProfile && !selectedTargetProfile.anchors.some(anchor => anchor.name === preset.anchorName)
        ? selectedProfileId
        : calibratedProfileId;
      const nextDraft = retargetBuiltinSampleDraft(
        draftFromPreset(preset, {
          figureKey: figure.figureKey,
          figureGeneration: figure.generation,
          displayName: sampleName,
        }),
        targetProfileId,
      );
      const targetProfile = profiles.get(targetProfileId);
      let selectedFallbackAnchor = false;
      if (targetProfile && !targetProfile.anchors.some(anchor => anchor.name === nextDraft.anchorName)) {
        const selectedAnchor = anchorField.select.value;
        nextDraft.anchorName = targetProfile.anchors.some(anchor => anchor.name === selectedAnchor)
          ? selectedAnchor
          : targetProfile.anchors[0]?.name ?? '';
        selectedFallbackAnchor = Boolean(nextDraft.anchorName);
      }
      nextDraft.presetId = preset.presetId;
      nextDraft.attachmentDefinitionId = preset.attachmentAssetId;
      nextDraft.sourcePresetId = preset.presetId;
      // Built-ins are ordinary complete attachment templates. Their images and
      // starting placement are imported in one click. A target Profile without
      // the sample's anchor starts at its selected or first valid anchor.
      const resource = await loadPresetBinaries(preset);
      const nextBinaries = resource.inputs;
      if (!isPreviewFlowCurrent(flowRevision)) return;
      nextDraft.layerMode =
        nextBinaries.back && nextBinaries.front ? 'both' : nextBinaries.back ? 'back-only' : 'front-only';
      nextDraft.layers = {
        back: nextBinaries.back ? { ...nextBinaries.back.metadata } : undefined,
        front: nextBinaries.front ? { ...nextBinaries.front.metadata } : undefined,
      };
      draft = nextDraft;
      draft.slot = resource.slot;
      editingProfile = profiles.get(draft.modelProfileId);
      packageCreatedAt = new Date().toISOString();
      adaptationConfirmed = preset.modelProfileId === targetProfileId && !selectedFallbackAnchor;
      binaries = nextBinaries;
      retainedAdaptations = [];
      pendingAdaptationDrafts.clear();
      attachmentDefaults = defaultParametersFromPreset(preset);
      rememberDraftBaseline();
      refreshProfiles(draft.modelProfileId);
      writeDraftInputs();
      if (!nextDraft.anchorName) {
        setStatus(`${sampleName ?? '附件'}图片已载入，但这套立绘没有可用锚点；请先制作或选择跟随部位，再预览和保存。`, 'warning');
        return;
      }
      const previewReady = await bindPreview(flowRevision);
      if (!isPreviewFlowCurrent(flowRevision)) return;
      if (!previewReady) {
        const failure = preview.bindFailure();
        const detail = failure ? `${failure.code}：${failure.message}` : 'PREVIEW_NOT_READY：附件运行时未能创建预览';
        setStatus(
          `${sampleName ?? '附件'}已经载入，但画面预览没有创建成功：${detail}。请点“重新载入附件预览”重试。`,
          false,
        );
        return;
      }
      audit('attachment.load', configId, 'visible', sampleName ?? '现成附件');
      setStatus(
        [
          `${sampleName ?? '现成附件'}已经载入。需要拖动时请明确点击“开启拖动”。`,
          preset.modelProfileId !== targetProfileId
            ? '所选人物尚未单独校准：目前借用样例参数，请调整后保存；以后从已保存附件继续增加其他人物适配。'
            : '它会作为正式附件模型保存；图片和配置会放进同一个文件夹。',
          selectedFallbackAnchor ? '原样例锚点在当前组不可用，现使用本组的有效锚点作为未校准起点。' : '',
          '调整完成后，在第 4 步保存附件，第 5 步按需添加到游戏。',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (error) {
      if (!isPreviewFlowCurrent(flowRevision)) return;
      setStatus(errorMessage(error), false);
    }
  }

  async function loadSelectedSavedAttachment(
    snapshot?: Rc1ProjectSnapshot,
    exact = Boolean(snapshot),
    selectedOverride?: CreatorSavedAttachmentSummary,
    preloaded?: CreatorSavedAttachmentResult,
  ) {
    if (!requestAttachmentReplace()) return;
    const targetProfile = exact ? undefined : selectedProfile();
    if (!exact && !targetProfile) return setStatus('请先选择角色和服装并载入立绘。', 'warning');
    const selected =
      selectedOverride ??
      (snapshot
        ? {
            projectName: 'authoring-workspace',
            presetId: snapshot.preset.presetId,
            displayName: snapshot.preset.presetId,
          }
        : selectedSavedAttachment());
    if (!selected) return setStatus('请先选择已保存附件及具体适配。', 'warning');
    const requestedProfileId =
      snapshot?.profile.modelProfileId ??
      (exact
        ? selectedSavedAttachment()?.modelProfileIds[selectedSavedAdaptationIndex()]
        : targetProfile?.modelProfileId ?? selectedOverride?.modelProfileIds[0]);
    if (!requestedProfileId) throw new Error('CREATOR_EXPLICIT_ADAPTATION_REQUIRED');
    const requestedAnchorName = snapshot?.preset.anchorName ??
      (savedAdaptationField.select.value !== '' ? selectedSavedAttachment()?.anchorNames?.[selectedSavedAdaptationIndex()] : undefined);
    const loadRevision = beginPreviewFlow();
    setStatus(`正在载入“${selected.displayName}”的图片和全部已有适配…`, 'info');
    let result = preloaded ?? (snapshot
      ? {
          presetId: snapshot.preset.presetId,
          packageDocument: snapshot.packageDocument,
          layers: snapshot.layers,
          revision: snapshot.revision,
          preferredSelection: undefined,
          createdAt: undefined,
          integrity: 'HASH_VALIDATED' as const,
          integrityDifferences: [],
          ownershipRequiresReview: false,
          ownershipDifferences: [],
        }
      : await loadCreatorSavedAttachment(selected.projectName, selected.presetId, { signal: lifetime.signal }));
    if (!isPreviewFlowCurrent(loadRevision)) return;
    if (!snapshot && (result.integrity === 'USER_EDITED_REVIEW_REQUIRED' || result.ownershipRequiresReview)) {
      const contentChanged = result.integrity === 'USER_EDITED_REVIEW_REQUIRED';
      const differences = result.integrityDifferences.map((row) => `- ${row.path}（${row.status}）`).join('\n');
      const accepted = window.confirm(
        [
          contentChanged ? '检测到附件文件在制作器之外被修改。' : '这份附件尚未登记为本机可编辑附件，可能是从别人分享的目录复制来的。',
          contentChanged ? '这些修改不会被覆盖。请检查下列差异；选择“确定”会接受磁盘上的当前内容，并重建校验与保存基线：' : '选择“确定”会登记当前附件，然后继续编辑。附件内容、图片、技术身份和其他附件都不会改变：',
          contentChanged ? differences : (result.ownershipDifferences ?? []).map(path => `- ${path}`).join('\n'),
          '选择“取消”将保持文件和基线不变。',
        ].join('\n\n'),
      );
      if (!accepted) {
        setStatus('已取消载入；磁盘文件与制作器基线都没有改变。', 'warning');
        return;
      }
      result = await acceptCreatorSavedAttachmentChanges(selected.projectName, selected.presetId, result.revision, {
        signal: lifetime.signal,
      });
      if (!isPreviewFlowCurrent(loadRevision)) return;
      setStatus(contentChanged ? '已接受磁盘上的当前附件内容并重建校验基线；attachment.json、PNG 和说明文件均未被覆盖。' : '已登记这份附件，可继续编辑和保存；原有内容与技术身份保持。', 'info');
    }
    if (
      !result.packageDocument ||
      typeof result.packageDocument !== 'object' ||
      Array.isArray(result.packageDocument)
    ) {
      throw new Error('CREATOR_SAVED_ATTACHMENT_PACKAGE_INVALID');
    }
    const document = result.packageDocument as Record<string, unknown>;
    const sourceUrl = `creator://saved/${encodeURIComponent(selected.projectName)}/${encodeURIComponent(
      selected.presetId,
    )}`;
    const asset = parseAttachmentAssetDefinition(document.asset, `${sourceUrl}/asset`);
    const rawAdaptations =
      document.schemaVersion === 2
        ? document.adaptations
        : [{ preset: document.preset, modelProfile: document.modelProfile }];
    if (!Array.isArray(rawAdaptations) || rawAdaptations.length === 0) {
      throw new Error('CREATOR_SAVED_ATTACHMENT_ADAPTATIONS_MISSING');
    }
    const adaptations = rawAdaptations.map((value, index): CreatorPackageAdaptation => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`CREATOR_SAVED_ATTACHMENT_ADAPTATION_INVALID:${index}`);
      }
      const record = value as Record<string, unknown>;
      const parsed = {
        preset: parseAttachmentPlacementPreset(record.preset, `${sourceUrl}/adaptations/${index}/preset`),
        modelProfile: parseLive2DModelProfile(record.modelProfile, `${sourceUrl}/adaptations/${index}/modelProfile`),
      };
      if (
        parsed.preset.presetId !== result.presetId ||
        parsed.preset.attachmentAssetId !== asset.attachmentAssetId ||
        parsed.preset.modelProfileId !== parsed.modelProfile.modelProfileId
      ) {
        throw new Error(`CREATOR_SAVED_ATTACHMENT_ADAPTATION_BINDING_INVALID:${index}`);
      }
      return parsed;
    });
    const defaultsSource = adaptations.find(row => row.modelProfile.modelProfileId === result.preferredSelection?.modelProfileId && row.preset.anchorName === result.preferredSelection.anchorName) ?? [...adaptations].sort((a, b) =>
      a.modelProfile.modelProfileId.localeCompare(b.modelProfile.modelProfileId),
    )[0];
    const loadedDefaults = parseCreatorDefaultParameters(document.defaultParameters, defaultsSource.preset);
    // A sample shortcut honors the currently selected Profile; a same-path
    // saved adaptation from another anchor group is only a source of defaults.
    const sampleTargetRows = selectedOverride && targetProfile
      ? adaptations.filter(row => row.modelProfile.modelProfileId === targetProfile.modelProfileId &&
          targetProfile.anchors.some(anchor => compatibleAnchorNames(row.preset.anchorName).includes(anchor.name)))
      : [];
    const selectedSampleRows = sampleTargetRows.length > 1
      ? sampleTargetRows.filter(row => row.preset.anchorName === anchorField.select.value)
      : sampleTargetRows;
    if (selectedSampleRows.length > 1) throw new Error('CREATOR_ADAPTATION_AMBIGUOUS');
    const ordinary = !exact && targetProfile
      ? selectedOverride
        ? selectedSampleRows[0]
        : ordinarySavedAdaptation(adaptations, targetProfile.modelPath, result.preferredSelection,
            savedAdaptationField.select.value !== '' ? selectedSavedAttachment()?.modelProfileIds[selectedSavedAdaptationIndex()] : undefined,
            requestedAnchorName)
      : undefined;
    const matching = ordinary ? [ordinary] : [];
    const useDefaults = !exact && !matching.length;
    if (useDefaults && document.defaultParameters === undefined && adaptations.length > 1 && !result.preferredSelection)
      throw new Error('旧附件没有明确默认参数，无法为新立绘猜测起点。请原样编辑一套适配，设置附件默认参数并保存后再继续。');
    const { adaptation: starter, index: adaptationIndex } = selectCreatorSavedAdaptation(
      adaptations,
      exact
        ? requestedProfileId
        : matching[0]?.modelProfile.modelProfileId ?? defaultsSource.modelProfile.modelProfileId,
      exact ? requestedAnchorName : matching[0]?.preset.anchorName ?? defaultsSource.preset.anchorName,
    );
    const desiredProfile = exact || matching.length ? starter.modelProfile : targetProfile!;
    let nextDraft = draftFromPreset(starter.preset, {
      figureKey: '',
      figureGeneration: '',
      displayName: typeof document.displayName === 'string' ? document.displayName : selected.displayName,
    });
    nextDraft.attachmentDefinitionId = asset.attachmentAssetId;
    nextDraft.presetId = result.presetId;
    nextDraft.displayName = typeof document.displayName === 'string' ? document.displayName : selected.displayName;
    nextDraft.slot = asset.slot;
    nextDraft.modelProfileId = starter.modelProfile.modelProfileId;
    nextDraft.anchorName = starter.preset.anchorName;
    nextDraft.approvalStatus = starter.preset.approvalStatus;
    nextDraft.sourcePresetId = result.presetId;
    if (useDefaults) {
      nextDraft = applyCreatorDefaultParameters(nextDraft, loadedDefaults);
      nextDraft.modelProfileId = desiredProfile.modelProfileId;
      if (!desiredProfile.anchors.some((a) => compatibleAnchorNames(nextDraft.anchorName).includes(a.name))) {
        const selectedAnchor = anchorField.select.value;
        nextDraft.anchorName = desiredProfile.anchors.some(anchor => anchor.name === selectedAnchor)
          ? selectedAnchor
          : desiredProfile.anchors[0]?.name ?? '';
      }
    }
    const loadedBinaries: { back?: CreatorBinaryInput; front?: CreatorBinaryInput } = {};
    for (const layer of ['back', 'front'] as const) {
      const source = result.layers[layer];
      if (!source) continue;
      loadedBinaries[layer] = await importProjectPngBytes({
        bytes: projectLayerBytes(source),
        layer,
        sourceFileName: source.fileName,
        outputPath: source.path,
      });
      if (!isPreviewFlowCurrent(loadRevision)) return;
      nextDraft.layers[layer] = { ...loadedBinaries[layer]!.metadata };
    }
    if (!loadedBinaries.back && !loadedBinaries.front) {
      throw new Error('CREATOR_SAVED_ATTACHMENT_HAS_NO_IMAGES');
    }
    nextDraft.layerMode =
      loadedBinaries.back && loadedBinaries.front ? 'both' : loadedBinaries.back ? 'back-only' : 'front-only';
    if (!(await clearPreview(loadRevision))) return;
    const flowRevision = beginPreviewFlow();
    // Embedded snapshots belong to this attachment, never the library registry.
    if (
      !(await commitProfileFigure(desiredProfile, nextDraft, flowRevision, () => {
        binaries = loadedBinaries;
        retainedAdaptations = adaptations;
        pendingAdaptationDrafts.clear();
        attachmentDefaults = loadedDefaults;
        packageCreatedAt = result.createdAt ?? new Date().toISOString();
        adaptationConfirmed = !useDefaults;
      }))
    )
      return;
    revisions.accept(selected.projectName, result.presetId, result.revision);
    rememberDraftBaseline();
    refreshProfiles(desiredProfile.modelProfileId);
    refreshAnchors(nextDraft.anchorName);
    writeDraftInputs();
    setDraggingEnabled(false, false);
    if (!nextDraft.anchorName) {
      setStatus('附件默认部位在当前模型不可用，请选择有效的跟随部位后预览和保存。', 'warning');
      return;
    }
    stopHandPose();
    const previewReady = await bindPreview(flowRevision);
    if (!isPreviewFlowCurrent(flowRevision)) return;
    if (!previewReady) throw new Error('CREATOR_SAVED_ATTACHMENT_PREVIEW_FAILED');
    projectDirty = false;
    renderProjectFacts();
    audit(
      'attachment.load.saved',
      `${selected.projectName}/${selected.presetId}`,
      'exact-adaptation',
      `${starter.modelProfile.modelProfileId}/${draft.anchorName}; index=${adaptationIndex}; retained=${adaptations.length}`,
    );
    setStatus(
      [
        useDefaults
          ? '已载入附件默认参数，尚未针对当前立绘调整；保存后新增当前立绘适配，其他参数保留。'
          : `已载入附件“${draft.displayName}”的第 ${adaptationIndex + 1}/${adaptations.length} 套适配。`,
        result.integrity === 'FACTORY_USER_EDITED' ? '样例文件已被本地编辑；使用当前内容，原文件保持不变。' : '',
        nextDraft.handBinding ? '已保留人物原有动作；需要固定手型时，请在手部面板明确点击检查。未配置手型暂不显示附件。' : '',
        `Profile：${desiredProfile.modelProfileId}；锚点：${draft.anchorName}。`,
        document.defaultParameters === undefined
          ? `旧附件默认起点来自固定适配：${defaultsSource.modelProfile.modelProfileId}；本次保存会写入独立默认参数。`
          : '默认起点来自附件保存的 defaultParameters。',
        '保存会更新这一套适配，不会由当前工作台状态静默改成其他 Profile 或锚点，也不会复制 PNG。',
      ].join('\n'),
      useDefaults || result.integrity === 'FACTORY_USER_EDITED' ? 'warning' : true,
    );
  }

  async function buildPackage(announce = true, fork = false) {
    if(draft.handBinding&&!handInputsValid)throw new Error('请完成手型参数输入或重新选择手型恢复最后有效值，再保存附件。');
    readDraftInputs();
    if (!fork && draft.sourcePresetId !== draft.presetId && /^v2\/(?:custom-attachment-|.*-copy-)/.test(draft.presetId)) {
      draft.presetId = readableCreatorPresetId(draft.displayName, draft.attachmentInstanceId);
      retainedAdaptations = rekeyCreatorAdaptations(retainedAdaptations, draft);
      for (const pending of pendingAdaptationDrafts.values()) pending.presetId = draft.presetId;
      presetId.input.value = draft.presetId;
    }
    for (const pending of pendingAdaptationDrafts.values()) {
      if ((pending.modelProfileId !== draft.modelProfileId || pending.anchorName !== draft.anchorName) &&
          !validateCreatorDraft(pending, retainedAdaptations.find(row => row.modelProfile.modelProfileId === pending.modelProfileId)?.modelProfile ?? profiles.get(pending.modelProfileId)).valid) {
        return setStatus('其他立绘还有未完成的参数，请切回补齐跟随部位或数值后再保存；草稿仍保留。', 'warning');
      }
    }
    const requestedRevision = exportRevision;
    const profile = selectedProfile();
    if (!profile) return setStatus('NO_COMPATIBLE_MODEL_PROFILE', false);
    try {
      const identity = fork ? createBlankCreatorDraft() : undefined;
      const packageDraft = identity
        ? { ...cloneCreatorDraft(draft), draftId: identity.draftId, attachmentDefinitionId: identity.attachmentDefinitionId,
          presetId: readableCreatorPresetId(draft.displayName, identity.attachmentInstanceId),
          attachmentInstanceId: identity.attachmentInstanceId, sourcePresetId: undefined, approvalStatus: 'candidate' as const }
        : cloneCreatorDraft(draft);
      const built = await buildCreatorPackage({
        draft: packageDraft,
        profile,
        ...binaries,
        overwrite: false,
        existingAdaptations: fork ? rekeyCreatorAdaptations(retainedAdaptations, packageDraft) : retainedAdaptations,
        defaultParameters: attachmentDefaults,
        createdAt: fork ? undefined : packageCreatedAt,
      });
      if (requestedRevision !== exportRevision) {
        throw new Error('CREATOR_EXPORT_STALE：导出计划生成期间草稿已改变；旧计划已丢弃。');
      }
      packageResult = built;
      packageRevision = requestedRevision;
      const resolved = packageResult.resolvedConfig;
      const structuredResult = {
        paths: packageResult.files.map((file) => ({
          path: file.path,
          bytes: file.bytes.byteLength,
          sha256: file.sha256,
        })),
        attachmentPackage: JSON.parse(
          new TextDecoder().decode(packageResult.files.find((file) => file.path.endsWith('/attachment.json'))!.bytes),
        ),
        preset: packageResult.preset,
        manifest: packageResult.manifest,
        command: packageResult.commandSnippet,
        roundTrip: {
          configId: resolved.config.configId,
          modelProfileId: resolved.modelBinding.modelProfileId,
          anchorName: resolved.modelBinding.anchorName,
          layers: resolved.config.layers,
          placement: resolved.config.placement,
        },
      };
      canonicalExportJson = JSON.stringify(structuredResult, null, 2);
      exportPreview.textContent = canonicalExportJson;
      scriptPreview.textContent = creatorLifecycleScript(packageDraft);
      copyScriptButton.disabled = false;
      const totalBytes = packageResult.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
      exportSummary.textContent = `ROUND-TRIP PASS\nvalid：true\n文件数：${packageResult.files.length}\n总字节数：${totalBytes}\n错误：0\n警告：0`;
      if (announce) {
        setStatus(`导出检查通过：${packageResult.files.length} 个文件，尚未写入。下一步请选择目录并确认导出。`);
      }
      return packageResult;
    } catch (error) {
      if (requestedRevision === exportRevision) {
        packageResult = undefined;
        packageRevision = -1;
      }
      const validation = validateCreatorDraft(draft, profile);
      canonicalExportJson = JSON.stringify(validation, null, 2);
      const missingLayers = validation.errors
        .filter((issue) => issue.code === 'LAYER_REQUIRED')
        .map((issue) => issue.field.replace('layers.', ''));
      const missingMessage = missingLayers.length
        ? `还需要选择 ${missingLayers.map((layer) => `${layer} PNG`).join(' 和 ')}。`
        : '请按结构化校验修正导出字段。';
      exportPreview.textContent = `无法生成导出预览：\n${missingMessage}\n当前帽子预览来自仓库引用，不等于已经加入导出包。\n\n结构化校验：\n${canonicalExportJson}`;
      exportSummary.textContent = `ROUND-TRIP FAIL\nvalid：${validation.valid}\n错误：${validation.errors.length}\n警告：${validation.warnings.length}`;
      setStatus(`还不能保存：${missingMessage}\n${errorMessage(error)}`, false);
    }
  }

  for (const control of [
    assetId.input,
    presetId.input,
    displayName.input,
    instanceId.input,
    slot.input,
    offsetX.input,
    offsetY.input,
    localScaleX.input,
    localScaleY.input,
    rotationDeg.input,
    skewXDeg.input,
    skewYDeg.input,
    opacity.input,
    blurAmount.input,
    brightness.input,
    contrast.input,
    saturation.input,
    gamma.input,
    colorRed.input,
    colorGreen.input,
    colorBlue.input,
    bevelStrength.input,
    bevelThickness.input,
    bevelRotation.input,
    bevelSoftness.input,
    bevelRed.input,
    bevelGreen.input,
    bevelBlue.input,
    bloomStrength.input,
    bloomBrightness.input,
    bloomBlur.input,
    bloomThreshold.input,
    shockwave.input,
    radiusAlpha.input,
    pivotX.input,
    pivotY.input,
    scaleMode.select,
  ]) {
    control.addEventListener('input', () => {
      readDraftInputs();
      updateLayerRows();
      if (validateCreatorDraft(draft, selectedProfile()).valid) preview.applyPlacement(draft);
      renderPreviewFacts();
    });
  }
  advancedEffectsEnabled.addEventListener('change', () => {
    updateAdvancedEffectsUi();
    readDraftInputs();
    if (validateCreatorDraft(draft, selectedProfile()).valid) preview.applyPlacement(draft);
    renderPreviewFacts();
    setStatus(
      advancedEffectsEnabled.checked
        ? '高级画面效果已启用；非中性效果可能增加渲染开销。'
        : '高级画面效果已关闭并恢复中性值；位置、大小、旋转和透明度保持不变。',
      'info',
    );
  });
  layerMode.select.addEventListener('change', () => {
    const requestedMode = layerMode.select.value as CreatorDraft['layerMode'];
    // The generic input handler must not overwrite the committed mode first.
    layerMode.select.value = draft.layerMode;
    void withBusyButton(layerMode.select, '正在切换图片层…', async () => {
      const flowRevision = beginPreviewFlow();
      readDraftInputs();
      const previousDraft = cloneCreatorDraft(draft);
      const previousBinaries = { ...binaries };
      const next = changeCreatorLayerMode(draft, binaries, requestedMode);
      draft = next.draft;
      binaries = next.binaries;
      writeDraftInputs();
      try {
        if (preview.binding() && (binaries.back || binaries.front)) {
          preview.setVisible(false);
          if (!(await preview.replaceTextures({ ...binaries, layerMode: draft.layerMode })))
            throw new Error('PREVIEW_TEXTURE_COMMIT_FAILED');
          if (!isPreviewFlowCurrent(flowRevision)) return;
          preview.applyPlacement(draft);
          await waitForPreviewPaint();
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (!(await preview.commitVisible(true, draft))) throw new Error('PREVIEW_VISIBILITY_COMMIT_FAILED');
          if (!isPreviewFlowCurrent(flowRevision)) return;
        }
        renderLayerFacts();
        renderPreviewFacts();
        const label =
          requestedMode === 'back-only' ? '人物后面' : requestedMode === 'front-only' ? '人物前面' : '前后两层';
        completionNotice = () =>
          setStatus(
            '图片已切换到' +
              label +
              '，位置和大小保持不变。' +
              (requestedMode === 'back-only' ? '被人物挡住的部分不可见，这是正常遮挡。' : '') +
              (requestedMode !== 'both' && binaries.front && binaries.back
                ? '另一层图片暂留本次工作台，切回前后两层可恢复；保存和导出只包含所选层。'
                : '') +
              (requestedMode === 'both' && (!binaries.front || !binaries.back)
                ? '请补充缺少的另一层图片后再保存。'
                : ''),
          );
      } catch (error) {
        if (!isPreviewFlowCurrent(flowRevision)) return;
        draft = previousDraft;
        binaries = previousBinaries;
        writeDraftInputs();
        let restored = !preview.binding();
        try {
          if (preview.binding()) {
            restored = await preview.replaceTextures({ ...binaries, layerMode: draft.layerMode });
            if (!isPreviewFlowCurrent(flowRevision)) return;
            preview.applyPlacement(draft);
            restored = restored && (await preview.commitVisible(true, draft));
          }
        } catch {
          restored = false;
        }
        if (!isPreviewFlowCurrent(flowRevision)) return;
        setStatus(
          '切换图片层失败，原图片与参数已保留。' +
            (restored ? '已恢复原预览。' : '预览未恢复，请重新载入已保存附件。') +
            ' 原因：' +
            errorMessage(error),
          false,
        );
      }
    });
  });
  figureField.select.onchange = async () => {
    if (!anchorStudio.requestModelChange(selectedFigure()?.modelPath)) { figureField.select.value = draft.figureKey; return; }
    invalidateExportPlan('目标 figure 已改变，旧导出计划已失效。');
    if (!(await clearPreview())) return;
    const figure = selectedFigure();
    draft.figureKey = figure?.figureKey ?? '';
    draft.figureGeneration = figure?.state === 'ready' ? figure.generation : '';
    refreshProfiles();
    updateTargetFacts();
    updateTargetAvailability(true);
    anchorStudio.refresh();
  };
  targetProjectField.select.onchange = () => {
    lastGameSave = undefined;
    renderTargetSavePath();
    updateTargetAvailability();
    void preflightSelectedTargetModel();
  };
  savedAttachmentField.select.onchange = () => {
    renderSavedAdaptations();
    updateTargetAvailability();
  };
  loadExactAdaptationButton.onclick = () =>
    void withBusyButton(loadExactAdaptationButton, '正在原样载入…', () => loadSelectedSavedAttachment(undefined, true));
  loadSavedAttachmentButton.onclick = () =>
    void withBusyButton(loadSavedAttachmentButton, '正在载入…', () =>
      loadSelectedSavedAttachment().catch((error) => setStatus(`载入已有附件失败：${errorMessage(error)}`, false)),
    );
  refreshStorageButton.onclick = () =>
    void withBusyButton(refreshStorageButton, '正在读取…', async () => {
      try {
        const next = await loadCreatorTargetProjects({ signal: lifetime.signal });
        if (destroyed) return;
        if (!serviceContext) {
          setStatus('后台尚未准备好，请等待制作器初始化后再试。', 'warning');
          return;
        }
        const previous = targetProjectField.select.value;
        serviceContext.targetProjects = next.targetProjects;
        renderTargetProjects();
        renderTargetSavePath();
        if (targetProjectField.select.value !== previous) lastGameSave = undefined;
        updateTargetAvailability();
        void preflightSelectedTargetModel();
        setStatus(`游戏列表已刷新，找到 ${next.targetProjects.length} 个游戏；当前附件草稿保留。`);
      } catch (error) {
        if (!destroyed) setStatus(`刷新游戏列表失败：${errorMessage(error)}；保留原列表和附件草稿。`, false);
      }
    });
  openProjectButton.onclick = () =>
    void withBusyButton(openProjectButton, '正在连接…', async () => {
      try {
        setStatus('正在读取制作区上次保存的附件…', 'info');
        const selected = selectedSavedAttachment();
        if (!selected || selected.projectName !== 'authoring-workspace') {
          throw new Error('CREATOR_AUTHORING_SELECTION_REQUIRED：请先在已保存附件列表选择制作区附件及适配。');
        }
        const profileId = selected.modelProfileIds[selectedSavedAdaptationIndex()];
        if (!profileId) throw new Error('CREATOR_EXPLICIT_ADAPTATION_REQUIRED');
        const snapshot = await openRc1Project(selected.presetId, profileId, { signal: lifetime.signal }, selected.anchorNames?.[selectedSavedAdaptationIndex()]);
        if (destroyed) return;
        projectSnapshot = snapshot;
        lastApplyResult = undefined;
        projectDirty = false;
        renderProjectFacts();
        setStatus(`已经读取制作区：${projectSnapshot.project.root}\n没有修改任何文件。`);
      } catch (error) {
        projectSnapshot = undefined;
        renderProjectFacts();
        if (error instanceof CreatorProjectRequestError) {
          const detail = error.detail;
          setStatus(
            [
              `错误代码：${detail.code}`,
              `简短说明：${detail.message}`,
              `完整目标路径：${detail.targetPath ?? '服务未提供路径'}`,
              `底层错误：${detail.cause ?? errorMessage(error)}`,
              `建议操作：${detail.suggestion ?? '请使用当前 release 的恢复入口后重试。'}`,
              `时间：${detail.time ?? new Date().toISOString()}`,
            ].join('\n'),
            false,
          );
        } else {
          setStatus(
            `无法读取制作区保存记录。普通保存不受影响；仍可直接在第 4 步保存附件，第 5 步按需添加到游戏。\n${errorMessage(
              error,
            )}`,
            false,
          );
        }
      }
    });
  loadProjectPresetButton.onclick = () =>
    void withBusyButton(loadProjectPresetButton, '正在读取…', () =>
      loadRc1ProjectPreset().catch((error) => setStatus(errorMessage(error), false)),
    );
  profileField.select.onchange = async () => {
    const target = profiles.get(profileField.select.value);
    profileField.select.value = draft.modelProfileId;
    if (target) {
      libraryProfileField.select.value = target.modelProfileId;
      await showSelectedLibraryFigure(true, target);
    }
  };
  async function changeSelectedAnchor() {
    if (destroyed || activeBusyControl || libraryFigureSwitchInProgress) {
      anchorField.select.value = draft.anchorName;
      return;
    }
    const anchor = anchorField.select.value;
    let previous = cloneCreatorDraft(draft);
    invalidateExportPlan('named anchor 已改变，旧导出计划已失效。');
    let flowRevision = beginPreviewFlow();
    try {
      const profile = selectedProfile();
      if (binaries.front || binaries.back) {
        if (!profile?.anchors.some(item => compatibleAnchorNames(anchor).includes(item.name))) {
          anchorField.select.value = previous.anchorName;
          return setStatus('请选择当前立绘可用的跟随部位；已载入的图片和参数仍保留。', 'warning');
        }
        anchorField.select.value = previous.anchorName;
        await captureCurrentAdaptation();
        previous = cloneCreatorDraft(draft);
        anchorField.select.value = anchor;
        const targetRows = retainedAdaptations.filter(row => row.modelProfile.modelProfileId === profile.modelProfileId && row.preset.anchorName === anchor);
        if (!targetRows.length && !attachmentDefaults && retainedAdaptations.length > 1)
          throw new Error('当前附件有多套不同适配但没有明确默认参数，无法猜测新锚点的摆放起点。');
        const seed = attachmentDefaults ?? (retainedAdaptations.length === 1
          ? defaultParametersFromPreset(retainedAdaptations[0].preset) : undefined);
        const selected = switchCreatorAdaptation(draft, retainedAdaptations, profile, true, seed, anchor);
        const cached = pendingAdaptationDrafts.get(JSON.stringify([profile.modelProfileId, anchor]));
        draft = cached ? cloneCreatorDraft(cached) : selected.draft;
        adaptationConfirmed = Boolean(targetRows.length);
      } else {
        readDraftInputs();
        draft.anchorName = anchor;
      }
      const cleared = clearPreview(flowRevision);
      // clear owns a new revision; subsequent binding belongs to that same operation.
      flowRevision = previewFlow.currentRevision();
      if (!(await cleared)) throw new Error('CREATOR_PREVIEW_CLEAR_FAILED');
      if (!isPreviewFlowCurrent(flowRevision)) return;
      updateTargetFacts();
      updateTargetAvailability();
      if (!binaries.front && !binaries.back) {
        setStatus('已选择跟随部位；可以继续载入附件或图片。', 'info');
        return;
      }
      if (!profile?.anchors.some((item) => compatibleAnchorNames(anchor).includes(item.name))) {
        setStatus('请选择当前立绘可用的跟随部位；已载入的图片和参数仍保留。', 'warning');
        return;
      }
      if (!(await bindPreview(flowRevision)) || !isPreviewFlowCurrent(flowRevision)) throw new Error('CREATOR_ANCHOR_PREVIEW_FAILED');
      writeDraftInputs();
      setStatus(adaptationConfirmed ? '已恢复这个锚点保存的摆放参数。' : '已在新锚点使用未校准起点；请调整后保存。');
    } catch (error) {
      if (isPreviewFlowCurrent(flowRevision)) {
        draft = previous;
        refreshAnchors(previous.anchorName);
        writeDraftInputs();
        const retryRevision = beginPreviewFlow();
        if (binaries.front || binaries.back) await bindPreview(retryRevision).catch(() => false);
        if (isPreviewFlowCurrent(retryRevision)) setStatus(`切换跟随部位失败：${errorMessage(error)}；原附件内容和目标已恢复。`, false);
      }
    }
  }
  anchorField.select.onchange = () => void changeSelectedAnchor();
  refreshFiguresButton.onclick = () => void refreshFigures(true);
  characterField.select.onchange = () => {
    renderLibraryProfiles();
    const first = libraryProfileField.select.options.item(1);
    if (!first?.value) {
      restoreCommittedLibrarySelection();
      updateTargetAvailability();
      setStatus('这个角色在制作区没有可载入的服装 / 立绘；当前人物与附件草稿保留。', 'warning');
      return;
    }
    libraryProfileField.select.value = first.value;
    renderModelLocation();
    void switchSelectedLibraryFigure();
  };
  libraryProfileField.select.onchange = () => {
    renderModelLocation();
    void switchSelectedLibraryFigure();
  };
  async function switchSelectedLibraryFigure(approvedDiscard?: boolean) {
    const profile = profiles.get(libraryProfileField.select.value);
    if (!profile) return setStatus('请选择制作区中实际存在的本地人物与外观。', 'info');
    if (activeBusyControl) {
      if (activeBusyControl === showLibraryProfileButton) {
        if (binaries.front || binaries.back) readDraftInputs();
        if (pendingSave) {
          restoreCommittedLibrarySelection();
          setStatus('上次保存结果尚未确认，请先点击“核对未确认的保存”。', 'warning');
          return;
        }
        const discard = attachmentDirty();
        if (discard && !window.confirm('当前附件参数未保存，是否放弃修改并切换立绘？取消可返回保存。')) {
          restoreCommittedLibrarySelection();
          return;
        }
        queuedLibraryProfileId = profile.modelProfileId;
        queuedLibraryDiscardApproved = discard;
        libraryFigureSwitchRevision++;
        beginPreviewFlow();
        const stage = WebGAL.gameplay.pixiStage;
        if (stage) cancelCreatorFigureReplacement(stage);
        setStatus('已收到新的立绘选择，正在结束上一轮载入…', 'info');
      } else restoreCommittedLibrarySelection();
      return;
    }
    const active = selectedFigure();
    const live = draft.figureKey ? WebGAL.gameplay.pixiStage?.getActiveLive2DFigure(draft.figureKey) : undefined;
    if (draft.modelProfileId === profile.modelProfileId && active?.state === 'ready' &&
      profileMatchesModelPath(profile, active.modelPath) && active.generation === draft.figureGeneration &&
      live?.status === 'ready' && profileMatchesModelPath(profile, live.figure.normalizedSourceUrl) &&
      live.figure.uuid === draft.figureGeneration && runtime.figureGeneration(draft.figureKey) === live.figure.uuid) {
      updateTargetAvailability();
      return;
    }
    // Read the visible fields before judging dirtiness; some numeric controls do
    // not commit to the draft until a preview or save operation runs.
    if (binaries.front || binaries.back) readDraftInputs();
    if (pendingSave) {
      setStatus('上次保存结果尚未确认，请先点击“核对未确认的保存”。', 'warning');
      restoreCommittedLibrarySelection();
      return;
    }
    const discard = approvedDiscard ?? attachmentDirty();
    if (discard && approvedDiscard !== true && !window.confirm('当前附件参数未保存，是否放弃修改并切换立绘？取消可返回保存。')) {
      restoreCommittedLibrarySelection();
      return;
    }
    const previousProfileId = draft.modelProfileId;
    let previewCleared = false;
    const switched = await showSelectedLibraryFigure(true, profile, undefined, discard, () => { previewCleared = true; }, true);
    if (queuedLibraryProfileId && !destroyed) {
      const queued = profiles.get(queuedLibraryProfileId);
      const queuedDiscard = queuedLibraryDiscardApproved;
      queuedLibraryProfileId = '';
      queuedLibraryDiscardApproved = false;
      if (queued) {
        characterField.select.value = queued.characterId;
        renderLibraryProfiles();
        libraryProfileField.select.value = queued.modelProfileId;
        renderModelLocation();
        await switchSelectedLibraryFigure(queuedDiscard);
      }
      return;
    }
    if (!switched && !destroyed) {
      restoreCommittedLibrarySelection();
      const committed = profiles.get(draft.modelProfileId);
      const live = draft.figureKey ? WebGAL.gameplay.pixiStage?.getActiveLive2DFigure(draft.figureKey) : undefined;
      if (committed && (live?.status !== 'ready' ||
        !profileMatchesModelPath(committed, live.figure.normalizedSourceUrl) ||
        runtime.figureGeneration(draft.figureKey) !== live.figure.uuid)) {
        try {
          const revision = beginPreviewFlow();
          if (await commitProfileFigure(committed, cloneCreatorDraft(draft), revision, () => {}, true)) {
            const previewRecovered = !binaries.front && !binaries.back || await bindPreview(revision);
            setStatus(previewRecovered
              ? '目标立绘未载入；已恢复原人物与附件草稿。请检查上一条具体错误后重试。'
              : '目标立绘未载入；原人物和草稿已恢复，但附件预览未恢复。请点击预览重试并查看具体错误。', 'warning');
          }
        } catch (error) {
          setStatus(`目标立绘未载入；附件草稿仍保留，但原人物未能自动恢复：${errorMessage(error)}。请恢复连接后点击“重新载入所选立绘”重试。`, false);
        }
      } else if (previewCleared && draft.modelProfileId === previousProfileId &&
        (binaries.front || binaries.back)) {
        const recovered = await bindPreview(beginPreviewFlow()).catch(() => false);
        if (!recovered) setStatus('目标立绘未载入；原附件草稿仍保留，但预览未恢复。请检查错误后点击预览重试。', false);
      }
      // A failed rollback can leave the stage empty. Its loading event disabled
      // the retry control while the guard was active; release it after settling.
      updateTargetAvailability();
    }
  }
  function restoreCommittedLibrarySelection() {
    const current = profiles.get(draft.modelProfileId) ??
      (editingProfile?.modelProfileId === draft.modelProfileId ? editingProfile : undefined) ??
      retainedAdaptations.find(row => row.modelProfile.modelProfileId === draft.modelProfileId)?.modelProfile;
    if (current) syncCharacterSelection(current);
    else {
      characterField.select.value = '';
      renderLibraryProfiles();
    }
    updateTargetAvailability();
  }
  async function captureCurrentAdaptation() {
    if (!binaries.front && !binaries.back) return;
    readDraftInputs();
    if (!adaptationConfirmed && adaptationState(draft) === adaptationBaseline) return;
    const profile = selectedProfile();
    pendingAdaptationDrafts.set(JSON.stringify([draft.modelProfileId, draft.anchorName]), cloneCreatorDraft(draft));
    if (!profile || !validateCreatorDraft(draft, profile).valid) return;
    const built = await buildCreatorPackage({
      draft: cloneCreatorDraft(draft),
      profile,
      ...binaries,
      existingAdaptations: retainedAdaptations,
    });
    retainedAdaptations = [
      ...retainedAdaptations.filter((row) => row.modelProfile.modelProfileId !== profile.modelProfileId || row.preset.anchorName !== draft.anchorName),
      { preset: built.preset, modelProfile: profile },
    ];
  }

  const showSelectedLibraryFigure = (_allowNew = true, explicitProfile?: Live2DModelProfile, explicitAnchor?: string,
    discardUnsaved = false, onPreviewCleared?: () => void, preferSavedOutfit = false) =>
    withBusyButton(showLibraryProfileButton, '正在切换人物…', async () => {
      const selectedProfile = explicitProfile ?? profiles.get(libraryProfileField.select.value);
      const stage = WebGAL.gameplay.pixiStage;
      if (!selectedProfile || !stage) throw new Error('CREATOR_PROFILE_OR_STAGE_NOT_READY');
      if (explicitAnchor !== undefined && !selectedProfile.anchors.some(anchor => anchor.name === explicitAnchor))
        throw new Error('CREATOR_ANCHOR_NOT_FOUND:' + selectedProfile.modelProfileId + '/' + explicitAnchor);
      if (!anchorStudio.requestModelChange(selectedProfile.modelPath)) return false;
      const switchBinaries = discardUnsaved ? initialBinaries : binaries;
      let switchAdaptations = discardUnsaved ? structuredClone(initialAdaptations) : retainedAdaptations;
      const switchDefaults = discardUnsaved ? structuredClone(initialDefaults) : attachmentDefaults;
      const switchDraft = discardUnsaved ? cloneCreatorDraft(initialDraft) : draft;
      const hasImages = Boolean(switchBinaries.front || switchBinaries.back);
      if (!discardUnsaved) {
        await captureCurrentAdaptation();
        switchAdaptations = retainedAdaptations;
      }
      const profile = preferSavedOutfit && hasImages && explicitAnchor === undefined
        ? creatorTargetProfile(selectedProfile, switchAdaptations) : selectedProfile;
      let nextDraft = cloneCreatorDraft(switchDraft);
      let created = false;
      let selectedFallbackAnchor = false;
      if (hasImages) {
        const profileRows = switchAdaptations.filter(row => row.modelProfile.modelProfileId === profile.modelProfileId);
        const targetAnchor = creatorTargetAnchor(profile, profileRows, anchorField.select.value, explicitAnchor);
        const result = switchCreatorAdaptation(switchDraft, switchAdaptations, profile, true,
          switchDefaults ?? { ...defaultParametersFromDraft(createBlankCreatorDraft()), anchorName: '' }, targetAnchor);
        nextDraft = result.draft;
        created = result.created;
        const cached = discardUnsaved ? undefined : pendingAdaptationDrafts.get(JSON.stringify([profile.modelProfileId, targetAnchor]));
        if (cached) {
          const cachedAnchor = profile.anchors.some(anchor => anchor.name === cached.anchorName)
            ? cached.anchorName
            : profile.anchors[0]?.name ?? '';
          selectedFallbackAnchor = cachedAnchor !== cached.anchorName && Boolean(cachedAnchor);
          nextDraft = {
            ...nextDraft,
            anchorName: cachedAnchor,
            placement: structuredClone(cached.placement),
            visualState: structuredClone(cached.visualState),
          };
          created = false;
        } else if (created && !profile.anchors.some(anchor => anchor.name === nextDraft.anchorName)) {
          nextDraft.anchorName = profile.anchors[0]?.name ?? '';
          selectedFallbackAnchor = Boolean(nextDraft.anchorName);
        }
      }
      // A fresh image has no saved adaptation to protect. Never carry a missing
      // default (e.g. head) into a custom-only Profile. An explicit authoring
      // selection also overrides an existing adaptation's anchor, keeping its content.
      if (explicitAnchor !== undefined) nextDraft.anchorName = explicitAnchor;
      else if (!hasImages && !profile.anchors.some(anchor => anchor.name === nextDraft.anchorName))
        nextDraft.anchorName = profile.anchors[0]?.name ?? '';
      // A hand-state attachment has no safe generic head placement on a new
      // outfit. Keep the images/default parameters, but require a deliberate
      // target anchor or hand-state adaptation before displaying it.
      if (created && switchDraft.handBinding && explicitAnchor === undefined)
        nextDraft.anchorName = '';
      const switchRevision = ++libraryFigureSwitchRevision;
      if (!(await clearPreview()) || switchRevision !== libraryFigureSwitchRevision) return;
      onPreviewCleared?.();
      const flowRevision = beginPreviewFlow();
      setStatus('正在显示 ' + profileLabel(profile) + '…', 'info');
      const targetSnapshot = explicitAnchor !== undefined ? profile : switchAdaptations.find(row =>
        row.modelProfile.modelProfileId === profile.modelProfileId && row.preset.anchorName === nextDraft.anchorName)?.modelProfile ?? profile;
      if (!(await commitProfileFigure(targetSnapshot, nextDraft, flowRevision, () => {
        if (discardUnsaved) {
          binaries = { ...switchBinaries };
          retainedAdaptations = switchAdaptations;
          attachmentDefaults = switchDefaults;
          pendingAdaptationDrafts.clear();
        }
      }, true))) return;
      adaptationBaseline = adaptationState(draft);
      adaptationConfirmed = retainedAdaptations.some(row => row.modelProfile.modelProfileId === profile.modelProfileId &&
        row.preset.anchorName === nextDraft.anchorName);
      updateTargetAvailability();
      const anchorReady = profile.anchors.some(anchor => anchor.name === draft.anchorName);
      if (hasImages && anchorReady) {
        if (!(await bindPreview(flowRevision)) || !isPreviewFlowCurrent(flowRevision)) return;
      }
      audit(
        'figure.switch',
        profile.modelProfileId,
        created ? 'new-adaptation' : 'restored-adaptation',
        draft.figureKey + '@' + draft.figureGeneration,
      );
      if (hasImages && !anchorReady) {
        setStatus(created && switchDraft.handBinding
          ? '已显示所选立绘；这套外观没有已保存的手部适配，枪暂不显示。图片和默认参数仍保留；请明确选择跟随部位并校准手型后再保存。'
          : '已显示所选立绘，图片和附件参数仍保留。请选择这套立绘可用的跟随部位，再预览、调整并保存适配。', 'warning');
        return true;
      }
      if (hasImages && selectedFallbackAnchor && explicitAnchor === undefined) {
        setStatus('已显示所选立绘，图片和附件参数仍保留；已先放到本组第一个可用锚点。这个位置尚未校准，请调整后保存。', 'warning');
        return true;
      }
      setStatus(
        created
          ? '已显示所选立绘。当前附件使用固定默认参数，尚未针对这套立绘调整；保存后新增适配，其他立绘参数保留。'
          : hasImages
          ? '已恢复这个人物的附件参数。其他适配与未保存的调整仍保留在本次草稿中；请保存附件。'
          : '测试人物已准备好，可以载入附件或选择PNG。',
        created ? 'warning' : true,
      );
      return true;
    }, true);
  showLibraryProfileButton.onclick = () => void showSelectedLibraryFigure();
  newDraftButton.onclick = async () => {
    if (!requestAttachmentReplace()) return;
    const figure = selectedFigure();
    const profile = profiles.get(draft.modelProfileId) ?? selectedProfile();
    editingProfile = undefined;
    const anchorName = anchorField.select.value;
    if (!(await clearPreview())) return;
    draft = createBlankCreatorDraft();
    draft.figureKey = figure?.figureKey ?? '';
    draft.figureGeneration = figure?.state === 'ready' ? figure.generation : '';
    draft.modelProfileId = profile?.modelProfileId ?? '';
    draft.anchorName = profile?.anchors.some(anchor => anchor.name === anchorName) ? anchorName : profile?.anchors[0]?.name ?? '';
    binaries = {};
    retainedAdaptations = [];
    pendingAdaptationDrafts.clear();
    attachmentDefaults = undefined;
    packageCreatedAt = new Date().toISOString();
    adaptationConfirmed = false;
    await refreshFigures();
    rememberDraftBaseline();
    writeDraftInputs();
    setDraggingEnabled(false, false);
    audit('draft.new', draft.presetId, 'created', `${draft.figureKey}@${draft.figureGeneration}`);
    setStatus('空白草稿已创建；请选择 PNG 后启动预览。');
  };
  saveAsNewDraftButton.onclick = () =>
    void withBusyButton(saveAsNewDraftButton, '正在另存…', () => saveLocalAttachment(true));
  copyPresetButton.onclick = () =>
    void withBusyButton(copyPresetButton, '正在载入…', () => loadCurrentPresetAsCopy('v2/straw-hat-both-v1', '草帽'));
  kemomimiSampleButton.onclick = () =>
    void withBusyButton(kemomimiSampleButton, '正在载入…', () =>
      loadCurrentPresetAsCopy('v2/kemomimi-front-v1', '兽耳'),
    );
  flowerSampleButton.onclick = () =>
    void withBusyButton(flowerSampleButton, '正在载入…', () => loadCurrentPresetAsCopy('v2/flower-front-v1', '花朵'));
  roseSampleButton.onclick = () =>
    void withBusyButton(roseSampleButton, '正在载入…', () => loadCurrentPresetAsCopy('v2/rose-front-v1', '玫瑰'));
  haloSampleButton.onclick = () =>
    void withBusyButton(haloSampleButton, '正在载入…', () => loadCurrentPresetAsCopy('v2/halo-front-v1', '光环'));
  resetDraftButton.onclick = () =>
    void withBusyButton(resetDraftButton, '正在恢复草稿…', async () => {
      if (!requestAttachmentReplace()) return;
      if (!(await clearPreview())) return;
      const flowRevision = beginPreviewFlow();
      const restored = cloneCreatorDraft(initialDraft);
      const profile = initialProfile ?? profiles.get(restored.modelProfileId);
      if (profile) {
        if (!(await commitProfileFigure(profile, restored, flowRevision))) return;
      }
      draft = restored;
      binaries = { ...initialBinaries };
      retainedAdaptations = structuredClone(initialAdaptations);
      pendingAdaptationDrafts.clear();
      attachmentDefaults = structuredClone(initialDefaults);
      adaptationConfirmed = retainedAdaptations.some(row => row.modelProfile.modelProfileId === draft.modelProfileId &&
        row.preset.anchorName === draft.anchorName);
      adaptationBaseline = adaptationState(draft);
      refreshProfiles(restored.modelProfileId);
      writeDraftInputs();
      if (profile && (binaries.back || binaries.front)) {
        const ready = await bindPreview(flowRevision);
        if (!isPreviewFlowCurrent(flowRevision)) return;
        if (!ready) return;
      }
      setStatus('草稿字段、图片和全部适配已恢复到本次新建/载入时的状态。');
    });
  clearDraftButton.onclick = async () => {
    if (!requestAttachmentReplace()) return;
    editingProfile = undefined;
    packageCreatedAt = new Date().toISOString();
    adaptationConfirmed = false;
    if (!(await clearPreview())) return;
    diagnostics.clear();
    draft = createBlankCreatorDraft();
    binaries = {};
    retainedAdaptations = [];
    backInput.value = '';
    pendingAdaptationDrafts.clear();
    attachmentDefaults = undefined;
    frontInput.value = '';
    rememberDraftBaseline();
    writeDraftInputs();
    setDraggingEnabled(false, false);
    setStatus('草稿、预览纹理、Object URL 与运行时 preview 已清理。');
  };
  backInput.onchange = () => void withBusyButton(startPreview, '正在读取图片…', () => importLayer('back', backInput));
  frontInput.onchange = () =>
    void withBusyButton(startPreview, '正在读取图片…', () => importLayer('front', frontInput));
  clearBack.onclick = async () => {
    const flowRevision = beginPreviewFlow();
    try {
      invalidateExportPlan('back PNG 已清除，旧导出计划已失效。');
      delete binaries.back;
      delete draft.layers.back;
      backInput.value = '';
      renderLayerFacts();
      if (preview.binding()) {
        if (!binaries.front) {
          if (!(await clearPreview(flowRevision))) return;
          setStatus('后层 PNG 已清除，预览和导出内容已更新。');
          return;
        } else {
          preview.setVisible(false);
          const committed = await preview.replaceTextures({ ...binaries, layerMode: draft.layerMode });
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (!committed) throw new Error('PREVIEW_TEXTURE_COMMIT_FAILED');
          await waitForPreviewPaint();
          if (!isPreviewFlowCurrent(flowRevision)) return;
          const visible = await preview.commitVisible(true, draft);
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (!visible) throw new Error('PREVIEW_VISIBILITY_COMMIT_FAILED');
        }
      }
      setStatus('后层 PNG 已清除，预览和导出内容已更新。');
    } catch (error) {
      if (!isPreviewFlowCurrent(flowRevision)) return;
      setStatus(`清除后层 PNG 失败：${errorMessage(error)}`, false);
    }
  };
  clearFront.onclick = async () => {
    const flowRevision = beginPreviewFlow();
    try {
      invalidateExportPlan('front PNG 已清除，旧导出计划已失效。');
      delete binaries.front;
      delete draft.layers.front;
      frontInput.value = '';
      renderLayerFacts();
      if (preview.binding()) {
        if (!binaries.back) {
          if (!(await clearPreview(flowRevision))) return;
          setStatus('前层 PNG 已清除，预览和导出内容已更新。');
          return;
        } else {
          preview.setVisible(false);
          const committed = await preview.replaceTextures({ ...binaries, layerMode: draft.layerMode });
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (!committed) throw new Error('PREVIEW_TEXTURE_COMMIT_FAILED');
          await waitForPreviewPaint();
          if (!isPreviewFlowCurrent(flowRevision)) return;
          const visible = await preview.commitVisible(true, draft);
          if (!isPreviewFlowCurrent(flowRevision)) return;
          if (!visible) throw new Error('PREVIEW_VISIBILITY_COMMIT_FAILED');
        }
      }
      setStatus('前层 PNG 已清除，预览和导出内容已更新。');
    } catch (error) {
      if (!isPreviewFlowCurrent(flowRevision)) return;
      setStatus(`清除前层 PNG 失败：${errorMessage(error)}`, false);
    }
  };
  startPreview.onclick = () =>
    void withBusyButton(startPreview, '正在刷新…', async () => {
      setStatus('正在创建或刷新人物附件预览…', 'info');
      await bindPreview();
    });
  previewHide.onclick = () => {
    beginPreviewFlow();
    preview.setVisible(false);
    renderPreviewFacts();
    setStatus('附件预览已暂时隐藏。');
  };
  previewShow.onclick = async () => {
    const flowRevision = beginPreviewFlow();
    const visible = await preview.commitVisible(true, draft);
    if (!isPreviewFlowCurrent(flowRevision)) return;
    if (!visible) {
      setStatus('PREVIEW_VISIBILITY_COMMIT_FAILED：预览无法显示。', false);
      return;
    }
    renderPreviewFacts();
    setStatus('附件预览已显示。');
  };
  previewDelete.onclick = async () => {
    await clearPreview();
    diagnostics.clear();
    renderPreviewFacts();
    setStatus('preview 已删除；runtime/controller/Object URL 已释放或恢复。');
  };
  resetPlacement.onclick = () => {
    if (destroyed || activeBusyControl) return;
    beginPreviewFlow();
    const defaults = applyCreatorDefaultParameters(draft, attachmentDefaults ?? defaultParametersFromDraft(createBlankCreatorDraft()));
    draft.placement = defaults.placement;
    draft.visualState = defaults.visualState;
    invalidateExportPlan('已恢复附件默认摆放，请重新保存。');
    writeDraftInputs();
    preview.applyPlacement(draft);
    renderPreviewFacts();
    setStatus('当前立绘的摆放已恢复为该附件的固定默认值；请检查效果后保存。');
  };
  let draggingEnabled = false;
  let dragStart:
    | {
        pointerId: number;
        x: number;
        y: number;
        offsetX: number;
        offsetY: number;
        captureTarget?: Element;
        coordinates: DragCoordinateContext;
        moved: boolean;
      }
    | undefined;
  let completedDragCount = 0;
  let abnormalEndCount = 0;
  function setDraggingEnabled(enabled: boolean, announce = true) {
    if (enabled) modelViewport.stopMoving();
    draggingEnabled = enabled;
    toggleDrag.textContent = draggingEnabled ? '关闭拖动' : '开启拖动';
    if (announce) {
      setStatus(draggingEnabled ? '现在可以直接在人物画面上拖动附件。' : '画面拖动已经关闭。', 'info');
    }
  }
  toggleDrag.onclick = () => {
    setDraggingEnabled(!draggingEnabled);
    audit('drag.toggle', draft.presetId, draggingEnabled ? 'enabled' : 'disabled');
  };
  const canvasPointerDown = (event: PointerEvent) => {
    if (destroyed || activeBusyControl || libraryFigureSwitchInProgress) return;
    if (!draggingEnabled || !preview.binding()) return;
    const target = event.target;
    if (target instanceof Node && root.contains(target)) return;
    const canvas = WebGAL.gameplay.pixiStage?.currentApp?.view as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      return;
    const binding = preview.binding();
    const app = WebGAL.gameplay.pixiStage?.currentApp;
    if (!binding || !app) return;
    const contentName = `__webgal_attachment_${encodeURIComponent(binding.figureKey)}_${encodeURIComponent(
      binding.attachmentId,
    )}_front_content__`;
    const findNamed = (node: { name?: string; children?: unknown[] }): any => {
      if (node.name === contentName) return node;
      for (const child of node.children ?? []) {
        const found = findNamed(child as { name?: string; children?: unknown[] });
        if (found) return found;
      }
      return undefined;
    };
    const content = findNamed(app.stage);
    const matrix = content?.parent?.worldTransform;
    if (!matrix) return setStatus('CREATOR_DRAG_PARENT_TRANSFORM_NOT_READY', false);
    const captureTarget = event.target instanceof Element ? event.target : undefined;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: draft.placement.offset.x,
      offsetY: draft.placement.offset.y,
      captureTarget,
      coordinates: {
        canvasCssWidth: bounds.width,
        canvasCssHeight: bounds.height,
        rendererWidth: app.renderer.screen.width,
        rendererHeight: app.renderer.screen.height,
        parentWorldTransform: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d },
      },
      moved: false,
    };
    beginGameInputBoundaryGesture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (destroyed || activeBusyControl || libraryFigureSwitchInProgress) {
      cancelDrag();
      return;
    }
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    if (!dragStart.moved && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 3) return;
    if (
      !dragStart.moved &&
      dragStart.captureTarget instanceof HTMLElement &&
      dragStart.captureTarget.setPointerCapture
    ) {
      dragStart.captureTarget.setPointerCapture(dragStart.pointerId);
    }
    dragStart.moved = true;
    invalidateExportPlan('placement 已通过画布拖动改变，旧导出计划已失效。');
    const delta = cssDeltaToPlacementDelta(
      { x: event.clientX - dragStart.x, y: event.clientY - dragStart.y },
      dragStart.coordinates,
    );
    draft.placement.offset.x = dragStart.offsetX + delta.x;
    draft.placement.offset.y = dragStart.offsetY + delta.y;
    offsetX.input.value = String(Math.round(draft.placement.offset.x * 100) / 100);
    offsetY.input.value = String(Math.round(draft.placement.offset.y * 100) / 100);
    preview.applyPlacement(draft);
  };
  const finishDrag = (event: PointerEvent) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const finished = dragStart;
    dragStart = undefined;
    // While canvas dragging is enabled, even a click without movement belongs to
    // the Creator. Suppress its synthetic game click so an accidental tap cannot
    // advance/reconcile the scene and remove the live attachment preview.
    finishGameInputBoundaryGesture(finished.pointerId, true);
    if (
      finished.captureTarget instanceof HTMLElement &&
      finished.captureTarget.hasPointerCapture?.(finished.pointerId)
    ) {
      finished.captureTarget.releasePointerCapture(finished.pointerId);
    }
    if (finished.moved) {
      completedDragCount += 1;
      audit(
        'placement.drag',
        draft.presetId,
        'completed',
        `offset=(${draft.placement.offset.x},${draft.placement.offset.y})`,
      );
      setStatus(`拖动完成：offset=(${draft.placement.offset.x},${draft.placement.offset.y})`);
    }
  };
  const cancelDrag = (pointerId?: number) => {
    if (!dragStart || (pointerId !== undefined && dragStart.pointerId !== pointerId)) return;
    const cancelled = dragStart;
    dragStart = undefined;
    cancelGameInputBoundaryGesture(cancelled.pointerId);
    abnormalEndCount += 1;
  };
  const pointerCancel = (event: PointerEvent) => cancelDrag(event.pointerId);
  const lostPointerCapture = (event: PointerEvent) => cancelDrag(event.pointerId);
  const windowBlur = () => cancelDrag();
  const visibilityChange = () => {
    if (document.hidden) cancelDrag();
  };
  window.addEventListener('pointerdown', canvasPointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', pointerCancel);
  window.addEventListener('lostpointercapture', lostPointerCapture, true);
  window.addEventListener('blur', windowBlur);
  document.addEventListener('visibilitychange', visibilityChange);
  for (const input of Object.values(debugFlags)) {
    input.onchange = updateDiagnosticsBinding;
  }
  performanceMeasureButton.onclick = async () => {
    if (document.visibilityState !== 'visible') {
      setStatus('性能测量需要保持当前制作器标签页可见；请切回本页后重试。', 'warning');
      return;
    }
    const enabledDiagnostics = Object.entries(debugFlags)
      .filter(([, input]) => input.checked)
      .map(([key]) => key);
    if (enabledDiagnostics.length) {
      setStatus(`请先关闭所有辅助线与内部诊断：${enabledDiagnostics.join(', ')}。`, 'warning');
      return;
    }
    if (advancedEffectsEnabled.checked) {
      setStatus('P01 基线测量前请关闭“启用高级画面效果”；高级效果将在单独条件中验证。', 'warning');
      return;
    }
    const stage = WebGAL.gameplay.pixiStage;
    const app = stage?.currentApp;
    const active = stage?.getActiveLive2DFigure(draft.figureKey);
    const requestedMotion = motion.select.value;
    if (!stage || !app || active?.status !== 'ready' || active.figure.uuid !== draft.figureGeneration) {
      setStatus('人物尚未完全就绪，不能开始性能测量。', 'warning');
      return;
    }
    if (!requestedMotion) {
      setStatus('请先选择一个人物动作；两次 A/B 必须使用同一个动作。', 'warning');
      return;
    }

    await withBusyButton(performanceMeasureButton, '正在测量 10 秒…', async () => {
      performanceProbeAbort?.abort();
      const controller = new AbortController();
      performanceProbeAbort = controller;
      const previewState = preview.diagnostics();
      const condition = previewState.runtimeAttachmentCount > 0 ? 'ordinary-attachment' : 'figure-only';
      stopHandPose();
      const motionStart = await stage.replayModelMotionByKey(draft.figureKey, requestedMotion, draft.figureGeneration);
      if (!motionStart.started) {
        throw new Error(
          `CREATOR_PERFORMANCE_MOTION_NOT_STARTED:${motionStart.reason}; models=${motionStart.modelCount}; accepted=${motionStart.acceptedCount}`,
        );
      }
      setStatus(
        `正在测量：${condition === 'figure-only' ? '纯人物' : '普通附件'}；motion=${requestedMotion}。` +
          '请保持此标签页在前台，10 秒内不要点击或滚动。',
        'info',
      );
      try {
        const sample = await captureCreatorPerformance(10_000, app.ticker, controller.signal);
        if (destroyed || controller.signal.aborted) return;
        const renderer = app.renderer;
        const detail = {
          schemaVersion: 1,
          condition,
          motion: requestedMotion,
          figureKey: draft.figureKey,
          figureGeneration: draft.figureGeneration,
          preview: previewState,
          diagnosticsEnabled: enabledDiagnostics,
          advancedEffectsEnabled: false,
          rendererType: renderer.type,
          rendererResolution: renderer.resolution,
          sample,
        };
        const serialized = JSON.stringify(detail, null, 2);
        performanceResult.textContent = serialized;
        audit('performance.sample', `${condition}/${requestedMotion}`, 'OK', JSON.stringify(detail), 10_000);
        setStatus(
          `性能测量完成：${condition === 'figure-only' ? '纯人物' : '普通附件'}；` +
            `rAF ${sample.raf.averageFps} fps，p95 ${sample.raf.p95FrameMs} ms；` +
            `Pixi ${sample.pixiTicker.averageFps} fps，p95 ${sample.pixiTicker.p95FrameMs} ms。\n` +
            '完整结果已写入本区和 CMD；请不要只凭单次数字判定根因。',
        );
      } finally {
        if (performanceProbeAbort === controller) performanceProbeAbort = undefined;
      }
    }).catch((error) => {
      if (!destroyed) setStatus(`性能测量失败：${errorMessage(error)}`, false);
    });
  };
  playMotion.onclick = async () => {
    const stage = WebGAL.gameplay.pixiStage;
    const requested = motion.select.value;
    const active = stage?.getActiveLive2DFigure(draft.figureKey);
    if (!stage || !requested || active?.status !== 'ready' || active.figure.uuid !== draft.figureGeneration) {
      motionStatus.textContent = '人物正在切换，请等人物完全出现后再试。';
      setStatus(motionStatus.textContent, 'warning');
      return;
    }
    try {
      const figureKey = draft.figureKey,
        generation = draft.figureGeneration;
      stopHandPose();
      const result = await stage.replayModelMotionByKey(figureKey, requested, generation);
      if (destroyed || draft.figureKey !== figureKey || draft.figureGeneration !== generation) return;
      if (!result.started)
        throw new Error(`${result.reason}: models=${result.modelCount}, accepted=${result.acceptedCount}`);
      motionStatus.textContent = `正在播放：${requested}\n请观察附件是否一直跟随人物。`;
      audit('motion.play', requested, 'started', `models=${result.modelCount}, accepted=${result.acceptedCount}`);
      setStatus(`动作已经播放：${requested}。请观察附件是否跟随。`);
    } catch (error) {
      motionStatus.textContent = `动作播放失败：${errorMessage(error)}`;
      setStatus(motionStatus.textContent, false);
    }
  };
  idleMotion.onclick = async () => {
    stopHandPose();
    const profileIdle = selectedProfile()?.characterId + '/idle01';
    const idle = creatorCatalogEntry(draft.modelProfileId)?.representativeMotions[0] ??
      [...motion.select.options].find(option => option.value === profileIdle)?.value;
    if (!idle) { motionStatus.textContent='已退出临时检查，但此人物未提供明确的待机动作；请选择一个原生动作播放。'; return; }
    try {
      const figureKey = draft.figureKey,
        generation = draft.figureGeneration;
      stopHandPose();
      const result = await WebGAL.gameplay.pixiStage?.replayModelMotionByKey(figureKey, idle, generation);
      if (destroyed || draft.figureKey !== figureKey || draft.figureGeneration !== generation) return;
      if (!result?.started)
        throw new Error(
          `${result?.reason ?? 'PIXI_STAGE_NOT_READY'}: models=${result?.modelCount ?? 0}, accepted=${
            result?.acceptedCount ?? 0
          }`,
        );
      motionStatus.textContent = `已经回到待机动作：${idle}`;
      audit('motion.idle', idle, 'started', `models=${result.modelCount}, accepted=${result.acceptedCount}`);
      setStatus('人物已经回到待机动作。');
    } catch (error) {
      motionStatus.textContent = `恢复待机失败：${errorMessage(error)}`;
      setStatus(motionStatus.textContent, false);
    }
  };
  copyScriptButton.onclick = async () => {
    const script = creatorLifecycleScript(draft);
    scriptPreview.textContent = script;
    try {
      await navigator.clipboard.writeText(script);
      setStatus('正式 WebGAL 脚本已复制：add / hide / show / remove。');
    } catch (error) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(scriptPreview);
      selection?.removeAllRanges();
      selection?.addRange(range);
      setStatus(`脚本复制失败，已选中脚本，请按 Ctrl+C：${errorMessage(error)}`, false);
    }
  };
  async function ensureWriteRevision(project: string, presetId: string, assetId: string) {
    try {
      return revisions.expected(project, presetId);
    } catch (error) {
      if (!errorMessage(error).includes('CREATOR_TARGET_REOPEN_REQUIRED')) throw error;
      let existing = await loadCreatorSavedAttachment(project, presetId, { signal: lifetime.signal });
      const document = existing.packageDocument as { asset?: { attachmentAssetId?: string }; displayName?: string };
      if (document.asset?.attachmentAssetId !== assetId)
        throw new Error('目标同名附件的内容身份不同，请另存为新附件，不能直接覆盖。');
      const destination = project === 'authoring-workspace' ? '本地资料库' : `游戏“${project}”`;
      if (
        !window.confirm(
          `${destination}已有这个附件“${
            document.displayName ?? presetId
          }”。将以工作台图片和当前适配更新它，其他立绘适配保留。确认更新？`,
        )
      ) {
        setStatus('已取消更新，目标文件保持不变。', 'warning');
        return undefined;
      }
      if (existing.integrity === 'USER_EDITED_REVIEW_REQUIRED' || existing.ownershipRequiresReview) {
        if (
          !window.confirm(
            (existing.integrity === 'USER_EDITED_REVIEW_REQUIRED' ? '目标附件有外部编辑：\n' : '目标附件尚未登记为本机可编辑附件：\n') +
              [...existing.integrityDifferences.map((row) => row.path), ...(existing.ownershipDifferences ?? [])].join('\n') +
              '\n保留这些当前文件并登记为保存基线，再执行刚才确认的更新？',
          )
        )
          return undefined;
        existing = await acceptCreatorSavedAttachmentChanges(project, presetId, existing.revision, {
          signal: lifetime.signal,
        });
      }
      revisions.accept(project, presetId, existing.revision);
      return existing.revision;
    }
  }

  function acceptSavedPackage(built: CreatorPackage, fork: boolean) {
    draft = cloneCreatorDraft(built.draft);
    binaries = {};
    for (const layer of ['back', 'front'] as const) {
      const metadata = draft.layers[layer];
      const file = metadata && built.files.find(row => row.path.endsWith('/images/' + metadata.outputFileName));
      if (metadata && file) binaries[layer] = { metadata: { ...metadata }, bytes: file.bytes };
    }
    const document = JSON.parse(new TextDecoder().decode(built.files.find(file => file.path.endsWith('/attachment.json'))!.bytes));
    retainedAdaptations = document.adaptations;
    attachmentDefaults = document.defaultParameters;
    packageCreatedAt = built.manifest.createdAt;
    pendingAdaptationDrafts.clear(); pendingSave = undefined;
    adaptationConfirmed = true; projectDirty = false;
    rememberDraftBaseline(); writeDraftInputs();
    if (fork) audit('draft.save-as-new', draft.presetId, 'persisted', draft.displayName);
  }
  async function saveLocalAttachment(fork = false) {
    if (pendingSave) return setStatus('保存结果尚未确认，请先核对，不能重复写入或另存。', 'warning');
    let candidate: CreatorPackage | undefined;
    let attemptedState = '';
    let attemptedPreset = draft.presetId;
    let saved: CreatorSaveToGameResult | undefined;
    try {
      const built = await buildPackage(false, fork);
      if (!built || destroyed) return;
      candidate = built;
      attemptedState = attachmentState(draft, retainedAdaptations, attachmentDefaults);
      attemptedPreset = built.preset.presetId;
      const expected = await ensureWriteRevision(
        'authoring-workspace',
        attemptedPreset,
        built.preset.attachmentAssetId,
      );
      if (expected === undefined || destroyed) return;
      setStatus('正在保存附件到本地资料库…', 'info');
      saved = await saveCreatorPackageLocally(built, expected, { signal: lifetime.signal });
      revisions.accept('authoring-workspace', attemptedPreset, saved.revision);
      if (destroyed) return;
      acceptSavedPackage(built, fork);
      localSaveSummary.textContent = `附件已保存到本地资料库：${saved.attachmentRoot}\n名称：${built.draft.displayName}\n稳定 ID：${saved.presetId}；图片与各立绘参数已一起保存。`;
      setStatus('附件已写入，正在刷新列表并恢复操作…', 'info');
      audit('attachment.save.local', attemptedPreset, 'persisted', saved.attachmentRoot);
      if (!(await refreshLocalSavedAttachments(attemptedPreset))) return;
      const current = serviceContext?.authoringWorkspace.savedAttachments.find(
        (item) => item.presetId === attemptedPreset,
      );
      if (current) {
        savedAttachmentField.select.value = current.key;
        renderSavedAdaptations();
      }
      updateTargetAvailability();
      completionNotice = () => setStatus(localSaveSummary.textContent ?? '', true);
    } catch (error) {
      if (saved) {
        audit('attachment.save.refresh', attemptedPreset, 'warning', errorMessage(error));
        completionNotice = () => setStatus(
          `附件已保存，但列表刷新未完成。可以继续编辑；请刷新资料列表，无需重复保存。\n${localSaveSummary.textContent}\n${errorMessage(error)}`,
          'warning',
        );
        return;
      }
      const uncertain = error instanceof CreatorProjectRequestError && error.detail.commitState === 'UNKNOWN';
      if (uncertain) { revisions.markUncertain('authoring-workspace', attemptedPreset); if (candidate) pendingSave = { built: candidate, fork, liveState: attemptedState }; }
      setStatus(
        `${
          saved
            ? '附件已保存，但列表刷新未完成。'
            : uncertain
            ? '保存结果尚未确认，请重新载入核对后再保存。'
            : '本地附件保存未完成，草稿仍保留。'
        }\n${errorMessage(error)}`,
        false,
      );
    }
  }
  saveLocalButton.onclick = () => void withBusyButton(saveLocalButton, '正在保存…', () => saveLocalAttachment());
  const reconcileSave = button('核对未确认的保存');
  saveLocalButton.parentElement?.append(reconcileSave);
  reconcileSave.onclick = () => void withBusyButton(reconcileSave, '正在核对…', async () => {
    if (!pendingSave) return setStatus('没有待核对的保存。', 'info');
    const pending = pendingSave;
    try {
      const loaded = await loadCreatorSavedAttachment('authoring-workspace', pending.built.preset.presetId, { signal: lifetime.signal });
      const expected = await sha256Bytes(new TextEncoder().encode(JSON.stringify(pending.built.files.map(file => [file.path, file.sha256]).sort(), null, 2) + '\n'));
      if (loaded.revision !== expected) throw new Error('磁盘版本与待确认的保存不一致，草稿与候选身份继续保留，请检查完整错误后重开对应附件。');
      if (attachmentState(draft, retainedAdaptations, attachmentDefaults) !== pending.liveState &&
        !window.confirm('已确认刚才保存成功，但你又修改了草稿。放弃后续修改并恢复刚才保存的内容？取消会保留当前草稿和待核对记录。')) return;
      revisions.accept('authoring-workspace', pending.built.preset.presetId, loaded.revision);
      acceptSavedPackage(pending.built, pending.fork);
      await refreshLocalSavedAttachments(draft.presetId);
      setStatus('已核对保存成功，当前编辑身份和保存基线已恢复。');
    } catch (error) {
      if (errorMessage(error).includes('CREATOR_SAVED_ATTACHMENT_NOT_FOUND')) {
        revisions.confirmAbsent('authoring-workspace', pending.built.preset.presetId);
        pendingSave = undefined;
        setStatus('已确认目标未保存，原草稿保留，可以重新保存。', 'warning');
      } else throw error;
    }
  });
  const setDefaultsButton = button('将当前部位与摆放设为附件默认参数');
  setDefaultsButton.title = '新附件首次保存以当前部位和摆放作为默认起点。之后保存其他适配不会自动改动默认参数；可用此按钮明确更新。';
  saveLocalButton.parentElement?.append(setDefaultsButton);
  setDefaultsButton.onclick = () => {
    readDraftInputs(); attachmentDefaults = defaultParametersFromDraft(draft);
    invalidateExportPlan(); setStatus('已设置附件默认参数；保存后用于尚无适配的新立绘。当前模型不支持该部位时仍需选择有效锚点。');
  };

  exportFolderButton.onclick = () =>
    void withBusyButton(exportFolderButton, '正在导出…', async () => {
      try {
        const picker = (
          window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<CreatorDirectoryHandle> }
        ).showDirectoryPicker;
        if (!picker)
          return setStatus(
            '当前浏览器不支持目录选择。请先保存附件，再按保存结果中的路径复制完整附件文件夹。',
            'warning',
          );
        const destination = await picker.call(window, { mode: 'readwrite' });
        const built = await buildPackage(false);
        if (!built || destroyed) return;
        const prefix = 'game/attachments-v2/portable/';
        if (!built.files.every((file) => file.path.startsWith(prefix))) throw new Error('CREATOR_EXPORT_PATH_INVALID');
        await writeCreatorPackage(
          destination,
          { ...built, files: built.files.map((file) => ({ ...file, path: file.path.slice(prefix.length) })) },
          false,
        );
        const parentName = (destination as CreatorDirectoryHandle & { name?: string }).name ?? '所选目录';
        exportLocationSummary.textContent = `导出位置：${parentName}/${creatorPresetLeaf(
          built.preset.presetId,
        )}\n这是所选目录内的完整附件文件夹；浏览器仅提供目录名称，未提供绝对路径。附件身份保留。`;
        completionNotice = () =>
          setStatus(`完整附件导出成功。\n${exportLocationSummary.textContent}\n资料库和游戏均未改动。`, true);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return setStatus('已取消导出。', 'info');
        setStatus(
          `导出未完成：${errorMessage(error)}。不会覆盖已有同名文件；若发生写入故障，请检查目标中的未完成文件夹。`,
          false,
        );
      }
    });

  saveApplyButton.onclick = () =>
    void withBusyButton(saveApplyButton, '正在保存…', async () => {
      const target = selectedTargetProject();
      if (!target?.writable) return setStatus('请选择已授权可写的目标游戏。', 'warning');
      const capturedName = draft.displayName;
      let attemptedPreset = draft.presetId;
      let saved: CreatorSaveToGameResult | undefined;
      try {
        setStatus(`正在添加 / 更新到游戏“${target.name}”…`, 'info');
        const built = packageResult && packageRevision === exportRevision ? packageResult : await buildPackage(false);
        if (!built || destroyed) return;
        attemptedPreset = built.preset.presetId;
        const targetRevision = await ensureWriteRevision(
          target.name,
          built.preset.presetId,
          built.preset.attachmentAssetId,
        );
        if (targetRevision === undefined || destroyed) return;
        const lifecycleScript = creatorLifecycleScript(cloneCreatorDraft(draft));
        saved = await saveCreatorPackageToGame(target.name, built, lifecycleScript, targetRevision, {
          signal: lifetime.signal,
        });
        revisions.accept(target.name, saved.presetId, saved.revision);
        if (destroyed) return;
        lastGameSave = saved;
        audit(
          'game.save',
          target.name,
          'files-written',
          `preset=${saved.presetId}; created=${saved.created.length}; updated=${saved.updated.length}; unchanged=${saved.unchanged.length}`,
        );
        lastApplyResult = undefined;
        openPreviewButton.disabled = true;
        const message = [
          `已添加 / 更新到游戏“${saved.projectName}”。`,
          `名称 → 完整附件文件夹：${capturedName} → ${saved.attachmentRoot}`,
          `稳定技术 ID：${saved.presetId}`,
          ...(saved.exampleScene ? [
            `独立测试剧情文件：${saved.exampleScene.split('/').pop()}`,
            `独立测试剧情路径：${saved.projectRoot.replaceAll('\\', '/').replace(/\/$/, '')}/${saved.exampleScene}`,
            '请到 Terre 的场景资源中搜索“附件测试”或附件名，打开此独立测试剧情。',
          ] : ['本次没有生成独立测试剧情，请检查操作记录。']),
          '只写入本附件受管文件和独立验证剧情；原图、原剧情不变。',
          `本次附带样例数量：${saved.builtinPresetIds.length}；未提供的样例不会自动安装。`,
          '新版 Terre 图形界面与最终视觉效果仍待后续验证。',
          '资料库未改动；如需保留工作台调整，请另点“保存附件”。',
        ]
          .filter(Boolean)
          .join('\n');
        applySummary.textContent = message;
        scriptPreview.textContent = lifecycleScript;
        setStatus('游戏文件已写入，正在刷新列表并恢复操作…', 'info');
        if (!(await refreshGameSavedAttachments(saved.projectName, saved.presetId))) throw new Error('制作器列表刷新未完成，请重新载入核对。');
        completionNotice = () => setStatus(message, true);
      } catch (error) {
        if (error instanceof CreatorProjectRequestError && error.detail.commitState === 'UNKNOWN') {
          revisions.markUncertain(target.name, attemptedPreset);
        }
        const uncertain = error instanceof CreatorProjectRequestError && error.detail.commitState === 'UNKNOWN';
        const prefix = saved
          ? '游戏文件已保存，但后续操作未完成。'
          : uncertain
          ? '保存响应中断，磁盘结果尚未确认。不要直接重复保存；请重新打开目标附件核对。'
          : '保存未完成，请按下列错误检查目标与版本；没有把失败登记为成功。';
        audit('game.save', target.name, uncertain ? 'outcome-unknown' : 'failed', errorMessage(error));
        applySummary.textContent = `${prefix}\n${errorMessage(error)}`;
        setStatus(applySummary.textContent, false);
      }
    });
  openPreviewButton.onclick = () =>
    void withBusyButton(openPreviewButton, '正在检查预览…', async () => {
      const applied = lastApplyResult;
      if (!applied) return setStatus('请先成功同步制作区附件再打开预览。', 'warning');
      const opened = window.open('about:blank', '_blank');
      if (!opened) return setStatus('浏览器阻止了新标签，请允许后重试。', false);
      opened.opener = null;
      try {
        const service = await ensureCreatorPreview({ signal: lifetime.signal });
        if (destroyed || lastApplyResult !== applied) {
          opened.close();
          return;
        }
        const url = new URL(service.previewUrl, window.location.origin);
        if (url.origin !== window.location.origin || url.pathname !== '/preview/')
          throw new Error('CREATOR_PREVIEW_URL_INVALID');
        url.searchParams.set('scene', applied.exampleScene.replace(/^game\/scene\//, ''));
        opened.location.href = url.href;
        audit('preview.open-saved', url.pathname, service.readiness);
        setStatus('已打开独立 Runtime 预览标签。服务文件已核验；请实际观察画面，尚未登记人工验收。');
      } catch (error) {
        opened.close();
        throw error;
      }
    });
  stopServiceButton.onclick = () =>
    void withBusyButton(stopServiceButton, '正在停止本服务…', async () => {
      if (pendingSave) return setStatus('保存结果尚未确认，请先核对后停止服务。', 'warning');
      if (anchorStudio.isBusy()) return setStatus('锚点操作尚未完成，请等待结果后再停止服务。', 'warning');
      if ((attachmentDirty() || anchorStudio.hasUnsavedChanges()) && !window.confirm('附件或锚点有未保存的修改。放弃这些修改并停止服务？取消可返回保存。')) return;
      await shutdownCreatorService({ signal: lifetime.signal });
      cleanup();
      const notice = el('div', '已请求停止本制作器服务。请关闭此标签；未停止其他程序或服务。');
      notice.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#101820;color:white;padding:40px;font:18px system-ui';
      document.body.append(notice);
    });

  const stage = WebGAL.gameplay.pixiStage;
  const unsubscribeFigures = stage?.subscribeLive2DFigureChanges(() => void refreshFigures());
  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    lifetime.abort();
    performanceProbeAbort?.abort();
    performanceProbeAbort = undefined;
    client.cancel();
    window.clearTimeout(copyFeedbackTimer);
    serviceContextRevision += 1;
    motionInventoryRevision += 1;
    libraryFigureSwitchRevision += 1;
    if (WebGAL.gameplay.pixiStage) cancelCreatorFigureReplacement(WebGAL.gameplay.pixiStage);
    anchorStudio.dispose();
    modelViewport.dispose();
    panelLayout.cleanup();
    window.removeEventListener('webgal-creator-panel-layout-reset', resetNativeTextRegionSizes);
    unsubscribeFigures?.();
    diagnostics.clear();
    void clearPreview();
    window.removeEventListener('pointermove', pointerMove);
    cancelDrag();
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', pointerCancel);
    window.removeEventListener('lostpointercapture', lostPointerCapture, true);
    window.removeEventListener('blur', windowBlur);
    document.removeEventListener('visibilitychange', visibilityChange);
    releaseGameAdvanceLock(gameAdvanceLockOwner);
    window.removeEventListener('pointerdown', canvasPointerDown);
    for (const eventName of isolatedEvents) {
      root.removeEventListener(eventName, stopCreatorEvent);
      notification.removeEventListener(eventName, stopCreatorEvent);
    }
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('beforeunload', attachmentBeforeUnload);
    root.remove();
    notification.remove();
    delete (window as CreatorWindow).__WEBGAL_MVP2B_CREATOR_STATE__;
  };
  // Acquire only after every synchronous mount step has succeeded. The
  // browser cannot dispatch a game-input event in the middle of this call,
  // and delaying acquisition prevents an initialization exception from
  // leaving the game permanently locked without a cleanup owner.
  stopAll();
  acquireGameAdvanceLock(gameAdvanceLockOwner);
  // beforeunload is cancelable. A canceled refresh must retain the whole workbench.
  // BFCache preserves this page and its in-memory draft; do not destroy on persisted pagehide.
  const pageHide = (event: PageTransitionEvent) => { if (!event.persisted) cleanup(); };
  window.addEventListener('pagehide', pageHide);
  const attachmentBeforeUnload = (event: BeforeUnloadEvent) => {
    if (attachmentDirty()) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', attachmentBeforeUnload);
  (window as CreatorWindow).__WEBGAL_MVP2B_CREATOR_STATE__ = () => ({
    draft: cloneCreatorDraft(draft),
    preview: preview.diagnostics(),
    attachmentDirty: attachmentDirty(),
    pendingSavePreset: pendingSave?.built.preset.presetId,
    editingDrawable: selectedProfile()?.anchors[0]?.drawableId,
    package: packageResult
      ? {
          files: packageResult.files.map((file) => ({
            path: file.path,
            bytes: file.bytes.byteLength,
            sha256: file.sha256,
          })),
          command: packageResult.commandSnippet,
          roundTrip: packageResult.resolvedConfig,
        }
      : null,
    exportRevision,
    packageRevision,
    targetStatus: targetGuidance.textContent,
    inputIsolation: {
      ...gameInputBoundaryDiagnostics(),
      dragging: Boolean(dragStart),
      completedDragCount,
      abnormalEndCount,
      boundaryListenerCount: isolatedEvents.length,
    },
    canonicalExportJson,
    panelLayout: panelLayout.diagnostics(),
    serviceContext: serviceContext ?? null,
    lastGameSave: lastGameSave ?? null,
    project: projectSnapshot
      ? {
          ...projectSnapshot.project,
          dirty: projectDirty,
          appliedAt: lastApplyResult?.appliedAt ?? projectSnapshot.appliedAt,
          lastApply: lastApplyResult ?? null,
        }
      : null,
  });
  writeDraftInputs();
  projectDirty = false;
  renderProjectFacts();
  emptyOption(figureField.select, '无活动 figure · 正在检查游戏状态');
  emptyOption(profileField.select, '无 compatible profile');
  emptyOption(anchorField.select, '无 named anchor');
  emptyOption(targetProjectField.select, '正在查找游戏…');
  updateTargetAvailability();
  // The local Creator service performs path/ownership checks synchronously. Starting
  // the project scan and all Profile reads together makes them contend for the same
  // event loop, so the catalog's own deadline can expire while it is merely queued.
  // Give each independent bounded read scope its own turn and timeout budget.
  void loadCreatorProfilesAfter(refreshServiceContext(), undefined, { signal: lifetime.signal })
    .then((loaded) => {
      if (destroyed) return;
      copyableLibraryProfiles = loaded;
      profiles = new Map([...loaded, ...profiles]);
      renderLibraryProfiles();
      return refreshFigures();
    })
    .catch((error) => {
      if (!destroyed) setStatus(errorMessage(error), false);
    });
  webgalStore.dispatch(setVisibility({ component: 'isEnterGame', visibility: true }));
  webgalStore.dispatch(setVisibility({ component: 'showTitle', visibility: false }));
  webgalStore.dispatch(setVisibility({ component: 'showTextBox', visibility: false }));
  webgalStore.dispatch(setVisibility({ component: 'showControls', visibility: false }));
  return cleanup;
}
