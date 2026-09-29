import type { CreatorExportFile, CreatorPackage } from './creatorTypes';

interface CreatorFileHandle {
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

export interface CreatorDirectoryHandle {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<CreatorDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<CreatorFileHandle>;
}

export interface CreatorWriteResult {
  path: string;
  bytes: number;
  sha256: string;
  status: 'written' | 'overwritten';
}

export interface CreatorDownloadAdapter {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  clickDownload(url: string, fileName: string): void;
  queueRelease(callback: () => void): void;
}

export interface CreatorDownloadResult {
  path: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

function pathSegments(path: string) {
  const segments = path.split('/');
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`UNSAFE_EXPORT_PATH:${path}`);
  }
  return segments;
}

async function parentDirectory(
  root: CreatorDirectoryHandle,
  path: string,
  create: boolean,
) {
  const segments = pathSegments(path);
  const fileName = segments.pop()!;
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return { directory, fileName };
}

async function fileExists(root: CreatorDirectoryHandle, path: string) {
  try {
    const { directory, fileName } = await parentDirectory(root, path, false);
    await directory.getFileHandle(fileName, { create: false });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}

export async function findCreatorExportConflicts(
  root: CreatorDirectoryHandle,
  files: readonly CreatorExportFile[],
) {
  const conflicts: string[] = [];
  for (const file of files) if (await fileExists(root, file.path)) conflicts.push(file.path);
  return conflicts;
}

export async function writeCreatorPackage(
  root: CreatorDirectoryHandle,
  packageResult: CreatorPackage,
  overwrite: boolean,
): Promise<CreatorWriteResult[]> {
  const conflicts = await findCreatorExportConflicts(root, packageResult.files);
  if (conflicts.length && !overwrite) {
    throw new Error(`CREATOR_EXPORT_CONFLICT:${conflicts.join('|')}`);
  }
  const results: CreatorWriteResult[] = [];
  for (const file of packageResult.files) {
    const { directory, fileName } = await parentDirectory(root, file.path, true);
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.bytes);
    await writable.close();
    results.push({
      path: file.path,
      bytes: file.bytes.byteLength,
      sha256: file.sha256,
      status: conflicts.includes(file.path) ? 'overwritten' : 'written',
    });
  }
  return results;
}

const browserDownloadAdapter: CreatorDownloadAdapter = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  clickDownload: (url, fileName) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  },
  queueRelease: (callback) => queueMicrotask(callback),
};

export function downloadCreatorPackageFiles(
  packageResult: CreatorPackage,
  adapter: CreatorDownloadAdapter = browserDownloadAdapter,
): CreatorDownloadResult[] {
  const results: CreatorDownloadResult[] = [];
  for (const file of packageResult.files) {
    const blob = new Blob([file.bytes], { type: file.mime });
    const url = adapter.createObjectURL(blob);
    const fileName = file.path.replaceAll('/', '__');
    adapter.clickDownload(url, fileName);
    adapter.queueRelease(() => adapter.revokeObjectURL(url));
    results.push({
      path: file.path,
      fileName,
      bytes: file.bytes.byteLength,
      sha256: file.sha256,
    });
  }
  return results;
}
