import * as path from 'path';
import * as fs from 'fs';

export function resolveStartupRoot(
  args: string[],
  inheritedCwd: string,
  executable: string,
  packaged: boolean,
): string {
  const index = args.indexOf('--cwd');
  const explicit = index !== -1;
  if (explicit && (!args[index + 1]?.trim() || args[index + 1].startsWith('--'))) {
    throw new Error('TERRE_STARTUP_CWD_REQUIRED: --cwd 后必须指定安装目录。');
  }
  const root = explicit
    ? path.resolve(inheritedCwd, args[index + 1])
    : packaged
      ? path.dirname(executable)
      : inheritedCwd;
  // Packaged releases must fail before logger/template/user-data initialization.
  // Source development keeps its existing working-directory convention.
  if (packaged) {
    let valid = false;
    try {
      valid = fs.statSync(path.join(root, 'public', 'index.html')).isFile();
    } catch {}
    if (!valid) {
      throw new Error(
        `TERRE_STARTUP_ROOT_INVALID: 安装目录缺少 public/index.html：${root}。请从完整 release 目录启动，或用 --cwd 指定完整安装目录。尚未初始化日志或用户数据。`,
      );
    }
  }
  return root;
}
