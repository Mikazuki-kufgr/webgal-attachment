/**
 * @file 引擎初始化时会执行的脚本，包括获取游戏信息，初始化运行时变量，初始化用户数据存储
 */
import { logger } from './util/logger';
import { infoFetcher } from './util/coreInitialFunction/infoFetcher';
import { assetSetter, fileType } from './util/gameAssetsAccess/assetSetter';
import { sceneFetcher } from './controller/scene/sceneFetcher';
import { sceneParser } from './parser/sceneParser';
import { bindExtraFunc } from '@/Core/util/coreInitialFunction/bindExtraFunc';
import { startPreviewSyncRuntime } from '@/Core/util/syncWithEditor/previewSyncRuntime';
import PixiStage from '@/Core/controller/stage/pixi/PixiController';
import { syncPixiStageState } from '@/Core/controller/stage/pixi/syncPixiStageState';
import axios from 'axios';
import { __INFO } from '@/config/info';
import { WebGAL, Live2D } from '@/Core/WebGAL';
import { loadTemplate } from '@/Core/util/coreInitialFunction/templateLoader';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { autoFastSaveGame } from './controller/storage/fastSaveLoad';
import { useIsWaiting } from './controller/gamePlay/isWaiting';
import {
  beginSceneMutation,
  commitSceneMutation,
  isSceneMutationCurrent,
} from '@/Core/controller/scene/sceneMutationEpoch';
import { bootstrapCreatorRuntime } from '@/Core/controller/stage/pixi/attachments/creator/creatorBootstrap';
import { WebgalParser } from '@/Core/parser/sceneParser';
import { attachmentRuntime } from '@/Core/controller/stage/pixi/attachments/attachmentRuntimeSingleton';
import {
  creatorPreviewSceneName,
  startCreatorGeneratedScene,
} from '@/Core/controller/stage/pixi/attachments/creator/creatorGeneratedPreview';
import { changeScene } from '@/Core/controller/scene/changeScene';
import { webgalStore } from '@/store/store';
import { setVisibility } from '@/store/GUIReducer';

declare const __WEBGAL_MVP2B_CREATOR__: boolean;
declare const __WEBGAL_CREATOR_PREVIEW__: boolean;

export const isIOS = window.__WEBGAL_DEVICE_INFO__?.isIOS ?? false; // 判断是否是 iOS 终端

/**
 * 引擎初始化函数
 */
export const initializeScript = async (): Promise<void> => {
  // Creator is an explicit production bundle, never enabled by DEV or a URL
  // alone. Return before story reads, save storage, autosave or editor sync.
  const creatorBundle = typeof __WEBGAL_MVP2B_CREATOR__ !== 'undefined' && __WEBGAL_MVP2B_CREATOR__;
  const previewBundle = typeof __WEBGAL_CREATOR_PREVIEW__ !== 'undefined' && __WEBGAL_CREATOR_PREVIEW__;
  if (creatorBundle || previewBundle) {
    let generatedScene = '';
    await bootstrapCreatorRuntime({
      readConfig: async () => {
        if (creatorBundle && previewBundle) throw new Error('CREATOR_ENTRY_FLAGS_CONFLICT');
        if (previewBundle) generatedScene = creatorPreviewSceneName(window.location.search);
        return (await axios.get('./game/config.txt', { timeout: 30_000 })).data;
      },
      parseConfig: (text) => WebgalParser.parseConfig(text),
      configure: (config) => {
        WebGAL.gameKey = 'webgal-attachment-creator-ephemeral';
        if (config.stageWidth !== undefined) WebGAL.stageWidth = config.stageWidth;
        if (config.stageHeight !== undefined) WebGAL.stageHeight = config.stageHeight;
        if (config.positioningType !== undefined) Live2D.positioningType = config.positioningType;
        if (config.legacyExpressionBlendMode !== undefined)
          Live2D.legacyExpressionBlendMode = config.legacyExpressionBlendMode;
        if (config.autoRotate !== undefined) WebGAL.autoRotate = config.autoRotate;
      },
      initializeStage: () => {
        if (WebGAL.gameplay.pixiStage) throw new Error('CREATOR_STAGE_ALREADY_INITIALIZED');
        WebGAL.gameplay.pixiStage = new PixiStage();
        installAttachmentDiagnosticsPanel(attachmentRuntime);
        stageStateManager.setCommitHandler((stageState, options) => syncPixiStageState(stageState, options));
        stageStateManager.commit({ skipAnimation: true });
      },
      releaseRenderGate: () => {
        const gate = (window as Window & { renderPromiseResolve?: () => void }).renderPromiseResolve;
        gate?.();
      },
      mountWorkbench: async () => {
        if (previewBundle) {
          await startCreatorGeneratedScene(generatedScene, {
            waitUntilLive2DReady: () => Live2D.waitUntilReady(),
            enterGame: () => {
              webgalStore.dispatch(setVisibility({ component: 'isEnterGame', visibility: true }));
              webgalStore.dispatch(setVisibility({ component: 'showTitle', visibility: false }));
              webgalStore.dispatch(setVisibility({ component: 'showTextBox', visibility: true }));
              useIsWaiting(WebGAL);
              window.addEventListener(
                'beforeunload',
                () => {
                  if (WebGAL.gameplay.isWaitingInterval !== null) clearInterval(WebGAL.gameplay.isWaitingInterval);
                },
                { once: true },
              );
            },
            changeScene,
          });
          return;
        }
        if (!(await Live2D.waitUntilReady())) throw new Error('CREATOR_LIVE2D_NOT_READY');
        const { installAttachmentCreatorWorkbench } = await import(
          './controller/stage/pixi/attachments/creator/AttachmentCreatorWorkbench'
        );
        installAttachmentCreatorWorkbench(attachmentRuntime);
      },
      reportFailure: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('CREATOR_INITIALIZATION_FAILED', error);
        const failure = document.createElement('div');
        failure.setAttribute('role', 'alert');
        failure.style.cssText =
          'position:fixed;inset:16px;z-index:2147483647;background:#351b1b;color:white;padding:24px;white-space:pre-wrap';
        failure.textContent = `附件工具初始化失败：${message}\n请保留日志并重新启动。此入口不会加载用户 start.txt；预览只允许独立验证剧情。`;
        document.body.appendChild(failure);
      },
    });
    return;
  }
  const initialMutation = beginSceneMutation('initialize');
  // 打印初始log信息
  logger.info(`WebGAL v${__INFO.version}`);
  logger.info('Github: https://github.com/OpenWebGAL/WebGAL ');
  logger.info('Made with ❤ by OpenWebGAL');
  loadTemplate();
  // 激活强制缩放
  // 在调整窗口大小时重新计算宽高，设计稿按照 1600*900。
  if (isIOS && window.innerWidth <= window.innerHeight) {
    /**
     * iOS
     */
    alert(
      `iOS 用户请横屏后刷新页面，以获得最佳体验
| Please rotate to landscape and refresh the page on iOS for the best experience
| iOS ユーザーは横画面にしてからページを再読み込みしてください`,
    );
  }

  // 获得 userAnimation
  loadStyle('./game/userStyleSheet.css');
  // 获得 user Animation
  getUserAnimation();
  // 获取start场景
  const sceneUrl: string = assetSetter('start.txt', fileType.scene);
  // 场景写入到运行时
  void WebGAL.sceneManager
    .trackSceneWrite(
      initialMutation,
      (async () => {
        const rawScene = await sceneFetcher(sceneUrl, { signal: initialMutation.signal });
        if (!isSceneMutationCurrent(initialMutation)) return;
        const initialScene = sceneParser(rawScene, 'start.txt', sceneUrl);
        commitSceneMutation(initialMutation, () => {
          WebGAL.sceneManager.sceneData.currentScene = initialScene;
          WebGAL.sceneManager.settledScenes.add(sceneUrl);
          WebGAL.flowchartManager.waitForCurrentSceneDialog();
        });
      })(),
    )
    .catch((error) => {
      if (isSceneMutationCurrent(initialMutation)) logger.error('初始化场景读取失败', error);
    });
  // 获取游戏信息
  await infoFetcher('./game/config.txt');
  /**
   * 启动Pixi
   */
  WebGAL.gameplay.pixiStage = new PixiStage();
  installAttachmentDiagnosticsPanel(attachmentRuntime);
  stageStateManager.setCommitHandler((stageState, options) => {
    syncPixiStageState(stageState, options);
    if (options.notifyReact) autoFastSaveGame();
  });

  /**
   * iOS 设备 卸载所有 Service Worker
   */
  // if ('serviceWorker' in navigator && isIOS) {
  //   navigator.serviceWorker.getRegistrations().then((registrations) => {
  //     for (const registration of registrations) {
  //       registration.unregister().then(() => {
  //         logger.info('已卸载 Service Worker');
  //       });
  //     }
  //   });
  // }
  useIsWaiting(WebGAL);
  /**
   * 绑定工具函数
   */
  bindExtraFunc();
  startPreviewSyncRuntime();
};

function loadStyle(url: string) {
  const link = document.createElement('link');
  link.type = 'text/css';
  link.rel = 'stylesheet';
  link.href = url;
  const head = document.getElementsByTagName('head')[0];
  head.appendChild(link);
}

function getUserAnimation() {
  axios.get('./game/animation/animationTable.json').then((res) => {
    const animations: Array<string> = res.data;
    for (const animationName of animations) {
      axios.get(`./game/animation/${animationName}.json`).then((res) => {
        if (res.data) {
          const userAnimation = {
            name: animationName,
            effects: res.data,
          };
          WebGAL.animationManager.addAnimation(userAnimation);
        }
      });
    }
  });
}
import { installAttachmentDiagnosticsPanel } from './controller/stage/pixi/attachments/AttachmentDiagnosticsPanel';
