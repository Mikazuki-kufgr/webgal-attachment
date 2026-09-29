export function lifecycleUserSuccessMessage(result) {
  const identity = `${result.productVersion ?? '未知版本'} / ${result.releaseRevision ?? '未知修订'}`;
  const entry = result.creatorEntryPath ? `制作器入口：${result.creatorEntryPath}` : '请从安装后的 WebGAL-Attachment-Manager 目录启动制作器。';
  if (result.code === 'PREFLIGHT_ONLY') return '[WebGAL附件] 预检查通过，尚未执行安装维护。';
  if (result.code === 'ALREADY_UNINSTALLED') return '[WebGAL附件] 此宿主已卸载插件，无需重复卸载；没有修改宿主或用户资料。';
  if (result.mode === 'Validate')
    return `[WebGAL附件] 验证成功：插件文件、安装状态和当前 WebGAL 主机一致。版本：${identity}\n${entry}`;
  if (result.mode === 'Uninstall')
    return `[WebGAL附件] 卸载成功：插件受管文件已移除，安装前的宿主文件已按记录恢复。版本：${identity}`;
  if (result.mode === 'Repair')
    return `[WebGAL附件] 修复成功：已重新校验插件文件和安装状态。版本：${identity}\n${entry}`;
  if (result.mode === 'Recover')
    return `[WebGAL附件] 恢复检查完成：未完成事务已按记录处理。版本：${identity}`;
  if (result.noOp) return `[WebGAL附件] 已经安装且内容完整，不需要重复写入。版本：${identity}\n${entry}`;
  return `[WebGAL附件] 安装或升级成功。版本：${identity}\n${entry}`;
}

export function lifecycleUserFailureMessage({ mode, code, writesApplied, rolledBack, recoveryRequired }) {
  const operation =
    {
      Install: '安装或升级',
      Validate: '验证',
      Repair: '修复',
      Uninstall: '卸载',
      Recover: '恢复',
    }[mode] ?? '操作';
  const dataStatus =
    rolledBack
      ? '已回滚本次产品写入。'
      : writesApplied === 0
        ? '没有执行产品写入。'
        : recoveryRequired
          ? '需要先按上方错误完成恢复检查，不要反复重试。'
          : '请保留本窗口并按上方错误检查；不要把本次操作视为成功。';
  const busy = ['LIFECYCLE_BUSY', 'PRODUCT_LIFECYCLE_BUSY', 'PRODUCT_CREATOR_SESSION_ACTIVE'].includes(code);
  const advice = busy ? '制作器后台或安装维护进程仍占用此宿主（网页关闭不代表后台已退出）。请先运行“05_停止附件服务.cmd”，或等待当前安装维护完成，再验证；不要重复安装或手动删除锁文件。' : code === 'REPAIR_COMPLETE_PACKAGE_REQUIRED'
    ? '管理工具自身有文件缺失。请重新解压与当前安装版本相同的完整插件包，从完整包运行“04_修复安装.cmd”，并使用原安装请求文件；不要覆盖现有管理目录或删除用户资料。'
    : ({
      HOST_DEPENDENCY_INCOMPATIBLE: '插件需要的只读运行依赖缺失或发生变化；当前版本尚无法安全确认这类改装的接口兼容性，不等于您的引擎损坏。请保留原文件，在标准引擎副本试用或提供详细诊断以补充适配，不要强制覆盖。',
      HOST_FINGERPRINT_MISMATCH: '安装计划将替换的核心文件存在额外内容或改装，当前安装器无法自动合并，继续会覆盖您的修改，因此已停止。不是因为普通字体、样例或外加文件不同，也不代表您的引擎损坏。请保留改装，在引擎副本试装或提供具体文件供适配；冲突路径见详细诊断。',
      HOST_ADAPTER_UPGRADE_UNSUPPORTED: '不能把现有宿主与另一宿主的安装计划混合升级。请保留旧安装，在独立的受支持 3.2.1 宿主中安装。',
      OWNED_FILE_DRIFT: '已安装的受管文件发生变化。请先备份并检查改动；修复只恢复可证明属于插件的缺失文件，不覆盖手改内容。',
      HOST_PROCESS_ACTIVE: '请完全退出 WebGAL Terre。关闭浏览器页面还不够，还需关闭 Terre 启动的后台 CMD/PowerShell 窗口，然后重试。',
      ENGINE_LIBRARY_SYNC_REQUIRED: '新建游戏模板尚未纳入同步。请从完整安装包运行“04_修复安装.cmd”，更新用户资料目录中的引擎模板；已有游戏可在安装后的管理目录运行“07_更新已有游戏引擎.cmd”。',
      ENGINE_LIBRARY_USER_MODIFICATION_CONFLICT: '新建游戏模板或目标游戏的引擎入口存在手工改装，已停止覆盖。请保留原文件，根据具体冲突路径检查改装；可在标准引擎副本测试，不要删除人物、附件或剧情。',
      ENGINE_LIBRARY_VALIDATION_FAILED: '用户资料目录中的新建游戏引擎模板与安装记录不一致。缺失文件可通过完整包修复；手工改装需要先检查冲突，不会强行覆盖。',
      ENGINE_LIBRARY_DEPENDENCY_MISSING: '新建游戏或目标游戏缺少必要引擎资源。请先使用完整包修复模板，再更新所选游戏引擎；不要重新导入或删除用户剧情。',
      ENGINE_LIBRARY_ROOT_CHANGED: '用户资料目录与授权记录不一致。请先重新绑定正确资料目录，再执行维护；本次没有向旧目录静默写入。',
      ENGINE_LIBRARY_CONCURRENT_DRIFT: '引擎模板或目标游戏在更新期间发生了变化。请停止其他复制/修改操作并检查诊断；用户改动不会被强行覆盖。',
    }[code] ?? '');
  return `[WebGAL附件] ${operation}未完成（${code}）。${dataStatus}${advice}`;
}

export function lifecycleHumanLines(result, { target, diagnosticPath, diagnosticError } = {}) {
  const lines = [result.ok ? lifecycleUserSuccessMessage(result) : lifecycleUserFailureMessage(result)];
  if (target) lines.push(`目标 WebGAL Terre：${target}`);
  if (!result.ok && result.detail) {
    if (typeof result.detail === 'object') {
      lines.push(`具体原因：${result.detail.message}`);
      if (result.detail.path) lines.push(`相关路径：${result.detail.path}`);
      if (result.detail.processes?.length) lines.push(`相关进程：${result.detail.processes.map(p => `${p.name} (PID ${p.pid})`).join('、')}`);
      if (result.detail.hint) lines.push(result.detail.hint);
    } else lines.push(`具体原因：${result.detail}`);
  }
  if (result.ok && result.code !== 'PREFLIGHT_ONLY' && result.mode === 'Uninstall')
    lines.push('用户人物、附件与剧情已保留；无需删除游戏目录。');
  if (result.ok && result.code !== 'PREFLIGHT_ONLY' && ['Install','Repair','Validate'].includes(result.mode)) {
    lines.push('请使用上方已安装 Manager 的制作器入口；下载包中的入口会说明正确启动位置。');
    lines.push('从已安装 Manager 验证通过后，下载 ZIP 和安装包解压目录可以删除，正常运行不依赖它们。');
    lines.push('请保留实际宿主、Manager、Authoring 和游戏资料；需要的随包说明、演示素材请先另存。');
    lines.push('原 ZIP 可选留作离线修复备份；删除后如需完整包修复，请重新下载对应版本。');
  }
  if (diagnosticPath) lines.push(`详细诊断（JSON）：${diagnosticPath}`);
  if (diagnosticError) {
    lines.push(`诊断文件未能写入：${diagnosticError}。操作结果以上方结论为准，以下保留完整诊断：`);
    lines.push(JSON.stringify(result));
  }
  return lines;
}
