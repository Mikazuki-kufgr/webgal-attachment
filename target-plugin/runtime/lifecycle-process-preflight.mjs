import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function findHostProcesses(rows, hostRoot, ownPid = process.pid) {
  const root = path.resolve(hostRoot).replaceAll('/', '\\').toLowerCase();
  const within = value => typeof value === 'string' && value.toLowerCase().startsWith(root + '\\');
  const ownAncestors = new Set();
  let cursor = ownPid;
  while (cursor && !ownAncestors.has(cursor)) {
    ownAncestors.add(cursor);
    cursor = rows.find(row => row.ProcessId === cursor)?.ParentProcessId;
  }
  return rows.filter(row => !ownAncestors.has(row.ProcessId) && (
    within(row.ExecutablePath) ||
    (/^(node|webgal_terre)\.exe$/i.test(row.Name ?? '') &&
      String(row.CommandLine ?? '').toLowerCase().includes(root + '\\'))
  )).map(row => ({ pid: row.ProcessId, parentPid: row.ParentProcessId,
    name: row.Name, executablePath: row.ExecutablePath ?? null }));
}

export function assertHostProcessesStopped(hostRoot) {
  if (process.platform !== 'win32') return;
  const query = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query],
    { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  let rows;
  try {
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
    rows = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(rows)) rows = [rows];
  } catch (cause) {
    throw Object.assign(new Error('无法读取 Windows 进程信息，尚未开始安装维护。'), {
      code: 'HOST_PROCESS_CHECK_FAILED', stage: 'process-preflight', operation: 'query-processes',
      path: hostRoot, detail: cause.message, writesApplied: 0,
      hint: '请确认系统允许读取本机进程信息，保留诊断；不要绕过检查强制安装。',
    });
  }
  const processes = findHostProcesses(rows, hostRoot);
  if (processes.length) throw Object.assign(new Error('请完全退出 WebGAL Terre。关闭浏览器页面还不够，还需关闭 Terre 启动的后台 CMD/PowerShell 窗口。'), {
    code: 'HOST_PROCESS_ACTIVE', stage: 'process-preflight', operation: 'check-host-processes',
    path: hostRoot, processes, writesApplied: 0,
    hint: '请完全退出 WebGAL Terre 和附件制作器后台后重试；安装器不会自动关闭您的进程。',
  });
}
