import {DataSheet, FileCodeOne, ListView, Terminal} from '@icon-park/react';
import s from './editorToolbar.module.scss';
import {useEffect, useState, useSyncExternalStore} from "react";
import {eventBus} from "@/utils/eventBus";
import {useGameEditorContext} from '@/store/useGameEditorStore';
import { t } from '@lingui/macro';
import { getSceneSaveStatus, subscribeSceneSaveStatus } from '@/utils/sceneSaveStatus';

export default function EditorToolbar({ targetPath }: { targetPath: string }) {
  const isCodeMode = useGameEditorContext((state) => state.isCodeMode);
  const isShowDebugger = useGameEditorContext((state)=> state.isShowDebugger);
  const updateIsCodeMode = useGameEditorContext((state)=> state.updateIsCodeMode);
  const updateIsShowDebugger = useGameEditorContext((state) => state.updateIsShowDebugger);

  const [textNum,setTextNum] = useState(0);
  const [lineNum,setLineNum] = useState(0);
  const saveState = useSyncExternalStore(
    subscribeSceneSaveStatus,
    () => getSceneSaveStatus(targetPath),
    () => getSceneSaveStatus(targetPath),
  );

  // 函数用于格式化数字，添加千分位分隔符
  function formatNumberWithCommas(num:number) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // 创建两个字符串
  const textNumString = formatNumberWithCommas(textNum);
  const lineNumString = formatNumberWithCommas(lineNum);

  const handleSetCodeMode = () => updateIsCodeMode(true);
  const handleSetGraphMode = () => updateIsCodeMode(false);

  useEffect(() => {
    const handleUpdagteScene = ({ scene }: { scene: string }) => {
      const wordsAndChars = scene.match(/[\w]+|[^\s\w]/g) || [];
      setTextNum(wordsAndChars.length);
      setLineNum(scene.split('\n').length);
    };

    eventBus.on('editor:update-scene', handleUpdagteScene);
    return () => {
      eventBus.off('editor:update-scene', handleUpdagteScene);
    };
  }, []);

  const switchDebugger = ()=>{
    updateIsShowDebugger(!isShowDebugger);
  };

  return <>
    {saveState?.status === 'error' && <div className={s.saveError} role="alert">
      <strong>场景未保存，当前修改仍在编辑器中。</strong>
      <span>请勿刷新或关闭页面；检查文件是否只读或被占用，恢复后再编辑或点击“执行到此句”重试。</span>
      <span>错误详情：{saveState.message ?? '未知写入错误'}</span>
    </div>}
    <div className={s.toolbar}>
    <div className={s.toolbar_button+ ' ' + (isShowDebugger  ? s.toolbar_button_active : '')} onClick={()=>switchDebugger()}>
      <Terminal theme="outline" size="20" fill={isShowDebugger ? 'var(--primary)' : "var(--text)"} strokeWidth={3}/>
      DEBUGGER
    </div>
    <div className={s.toolbar_button}>
      <DataSheet theme="outline" size="20" fill="var(--text)" strokeWidth={3}/>
      {lineNumString} {t`行脚本`}, {textNumString} {t`个字`}
    </div>
    {saveState && saveState.status !== 'error' && <div
      className={s.saveStatus}
      role="status"
      title={saveState.message}
    >
      {saveState.status === 'saving' && '正在保存场景…'}
      {saveState.status === 'saved' && '场景已保存'}
    </div>}
    <div onClick={handleSetCodeMode} className={s.toolbar_button + ' ' + (isCodeMode ? s.toolbar_button_active : '')}
      style={{marginLeft: 'auto'}}>
      <FileCodeOne theme="outline" size="20" fill={isCodeMode ? 'var(--primary)' : "var(--text)"} strokeWidth={3}/>
      {t`脚本编辑器`}
    </div>
    <div onClick={handleSetGraphMode} className={s.toolbar_button + ' ' + (!isCodeMode ? s.toolbar_button_active : '')}>
      <ListView theme="outline" size="20" fill={isCodeMode ? "var(--text)" : 'var(--primary)'} strokeWidth={3}/>
      {t`图形编辑器`}
    </div>
  </div></>;
}
