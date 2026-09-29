import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { localLauncherAssets } from './web-export-local-assets';

const relativeFiles: Record<string, string> = {
  'LocalGame.ps1': '.webgal-local/LocalGame.ps1',
  'StartGame.cmd': '启动游戏.cmd',
  'StopGame.cmd': '关闭本地服务.cmd',
  'README.txt': '本地运行说明.txt',
};
const manifestPath = '.webgal-local/files.json';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** This only runs inside commitWebExport's private staging tree. Never replace
 * foreign or edited launcher files just because they share our display name. */
export async function writeLocalWebLauncher(stage: string): Promise<void> {
  let previous: { schema: string; files: Record<string, string> } | undefined;
  try { previous = JSON.parse(await fs.readFile(path.join(stage, manifestPath), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('WEB_LOCAL_LAUNCHER_MANIFEST_INVALID'); }
  if (previous && (previous.schema !== 'webgal-local-launcher-v1' || !previous.files || typeof previous.files !== 'object'))
    throw new Error('WEB_LOCAL_LAUNCHER_MANIFEST_INVALID');
  const files: Record<string, string> = {};
  for (const [source, relative] of Object.entries(relativeFiles)) {
    // BOM is necessary for Windows PowerShell 5.1 to read Chinese text correctly.
    const text = localLauncherAssets[source].replace(/\r?\n/g, '\r\n');
    const bytes = Buffer.from((source.endsWith('.ps1') ? '\ufeff' : '') + text, 'utf8');
    const target = path.join(stage, relative);
    let current: Buffer | undefined;
    try { current = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current && !current.equals(bytes) && previous?.files[relative] !== sha(current))
      throw new Error(`WEB_LOCAL_LAUNCHER_FILE_CONFLICT: ${relative}`);
    files[relative] = sha(bytes);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  await fs.writeFile(path.join(stage, manifestPath), JSON.stringify({ schema: 'webgal-local-launcher-v1', files }, null, 2));
}
