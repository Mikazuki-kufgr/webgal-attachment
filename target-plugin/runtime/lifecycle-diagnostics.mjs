// Shared diagnostics for native filesystem failures and authoring bootstrap.
export function errorDiagnostic(error, { stage = 'preflight', operation = 'check' } = {}) {
  return {
    stage: error.stage ?? stage,
    operation: error.operation ?? operation,
    path: error.path ?? null,
    dest: error.dest ?? null,
    syscall: error.syscall ?? null,
    nativeCode: error.nativeCode ?? error.code ?? null,
    message: error.message ?? String(error),
    ...(error.relativePath ? { relativePath: error.relativePath } : {}),
    ...(error.expectedHash !== undefined ? {
      expectedHash: error.expectedHash, actualHash: error.actualHash,
      expectedSize: error.expectedSize, actualSize: error.actualSize,
    } : {}),
    ...(error.processes ? { processes: error.processes } : {}),
    hint: error.hint ?? (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)
      ? '请完全退出目标 Terre 和附件制作器后台，再重试；保留诊断，不要手动删除用户游戏、安装状态或事务目录。'
      : '请保留诊断，按具体原因处理；不要删除用户游戏或安装状态。'),
  };
}
